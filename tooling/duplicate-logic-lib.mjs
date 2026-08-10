// tooling/duplicate-logic-lib.mjs
// 구현 중복 판정 순수 코어 (SPEC-038) — dedup이 못 보는 축.
//
// 실측 제보(operations-dashboard, 2026-08-03): QA 티켓 20여 건을 **병렬 서브에이전트**로 처리하다
// 같은 규칙(`이름 뒤 괄호 영문 별칭 제거`)이 세 갈래로 갈렸다 — upstream의 `stripNameAlias()`,
// 병렬 에이전트가 **같은 파일에** 추가한 `stripAlias()`, 그 이전의 인라인 `replace(/\s*\(.*\)$/,"")`
// 3곳. **같은 파일 안에 이름만 다르고 하는 일이 같은 export 두 개**가 공존했는데 ownership·cohesion·
// fr·consistency 전부 green이었다. 통합하던 사람이 또 하나를 만든 것이 두 번째 사고다.
//
// 왜 기존 게이트가 못 봤나: 현재 dedup은 **선언 단위**다 — "같은 파일을 두 스펙이 주장하는가",
// "entity 키가 유일한가". SDD가 spec-first라 *스펙 중복*엔 촘촘한데 *구현 중복*은 사각이었다.
// 그리고 유발 조건(격리 지시 + 동시 upstream + 각자 성실한 헬퍼 생성)은 병렬 실행을 권장하는
// 방법론에서 **예외가 아니라 정상 경로**다.
//
// ── 층을 나눈다(SPEC-033과 같은 판단) ──
//   ① 결정적: 동일 **정규식 리터럴**이 2곳 이상 — 같은 규칙이 두 번 구현됐다는 가장 값싼 신호.
//      제보 실측에서 사고 1이 이 층만으로 잡혔다. 정책 강도대로 차단한다.
//   ② 확률적: 프로젝트가 주입하는 중복 탐지 도구(`duplicateLogicCommand`) — jscpd·similarity-ts 등.
//      **어떤 강도에서도 차단하지 않는다.** 오탐이 빌드를 깨면 사람이 그 층을 떼어낸다.
//
// **AST 해시는 킷이 하지 않는다.** 제보의 A-② 제안이지만 그러려면 TS/JS 파서를 번들해야 하고,
// 그 순간 킷은 (a) 의존성 0을 잃고 (b) 언어 무관을 잃는다(Python·Go 프로젝트에서 통째로 inert).
// 대신 그 일을 **어댑터로 위임**한다 — 도구를 아는 것은 프로젝트이고, 킷은 계약만 정한다.
//
// 순수 함수(IO 없음) — 파일 읽기·명령 실행은 소비 게이트. 언어 무관(정규식 리터럴 문법은
// `duplicateLiteralPatterns`로 교체 가능).

// 정규식 리터럴 추출 기본 패턴 — JS/TS의 `/.../flags`. 다른 언어는 config로 교체한다
// (Python `re.compile(r"…")`·Go `regexp.MustCompile(`…`)` 등).
// 캡처그룹 1이 **비교 대상 본문**이어야 한다(플래그는 제외 — 같은 규칙을 다른 플래그로 쓴 것도 중복이다).
export const DEFAULT_DUPLICATE_LITERAL_PATTERNS = [
  "(?<![\\w$)\\]])/((?:[^/\\\\\\n\\[]|\\\\.|\\[(?:[^\\]\\\\]|\\\\.)*\\])+)/[gimsuyd]*",
];

// 사소한 정규식은 정당하게 반복된다 — `\s+`·`,`·`^`는 중복이 아니라 어휘다.
// 길이 하한으로 가른다(기본 8): 실측 사고의 `\s*\(.*\)$`는 11자로 잡히고 `\s+`는 3자로 빠진다.
export const DEFAULT_DUPLICATE_MIN_LENGTH = 8;

// 판정 대상 파일 — 기본 패턴이 JS/TS 정규식 문법이므로 그 계열만 본다.
// 문서·셸·JSON에서 슬래시를 정규식으로 읽으면 오탐이 쏟아진다(실측: 킷 자기적용에서 jq 표현식과
// 마크다운 표가 잡혔다). 언어를 바꾸면 `duplicateLiteralPatterns`와 **함께** 이것도 바꾼다.
export const DEFAULT_DUPLICATE_FILE_REGEX = ["\\.(?:m|c)?[jt]sx?$"];

// 파일 텍스트에서 리터럴 본문을 뽑는다. 반환 [{literal, line}] — 선언 순.
// 주석·문자열 안의 우연한 슬래시를 완벽히 가르지는 않는다(파서가 아니다) — 대신 **양쪽 모두**에
// 나타나야 신호가 되므로, 한쪽의 오추출은 짝이 없어 조용히 사라진다.
export function extractLiterals(text, patterns = DEFAULT_DUPLICATE_LITERAL_PATTERNS, minLength = DEFAULT_DUPLICATE_MIN_LENGTH) {
  const out = [];
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^\s*(?:\/\/|#|\*)/.test(line)) continue;          // 주석 라인 — 설명은 구현이 아니다
    // **문자열 리터럴을 먼저 지운다**(파서 없이 오탐을 줄이는 핵심). 실측: 킷 자기적용에서
    // `.replace(/^\.\//, "") : "defaults(JS/TS)"` 같은 줄이 따옴표 사이 슬래시 때문에 정규식으로
    // 오추출됐고, jq 표현식·셸 경로도 같은 방식으로 걸렸다. 지우면 그 부류가 통째로 사라진다.
    line = line.replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, '""');
    // **줄 끝 주석도 지운다** — 설명은 구현이 아니다(전줄 주석은 위에서 이미 건너뛴다).
    // 실측: `continue;  // 미커버는 R1/R2의 몫`이 두 축에 나란히 적혀 있었고 `/ 미커버는 R1/`이
    // 정규식 리터럴로 오추출돼 "같은 규칙이 2곳에" 위반이 됐다. 문자열을 먼저 비웠으므로
    // `"https://…"`의 `//`는 여기 남지 않고, 앞이 공백·구분자인 `//`만 자르므로 `/[//]/` 같은
    // 문자클래스 안의 슬래시는 건드리지 않는다.
    line = line.replace(/(^|[\s;{}(),])\/\/.*$/, "$1");
    for (const p of patterns) {
      let re;
      try { re = new RegExp(p, "g"); } catch { continue; }  // 잘못된 패턴은 config 리뷰 몫
      for (const m of line.matchAll(re)) {
        const lit = m[1];
        if (!lit || lit.length < minLength) continue;
        // `/* …`는 블록 주석 시작이지 정규식이 아니다. `//`도 정규식 본문이 될 수 없다.
        if (lit.startsWith("*") || lit.startsWith("/")) continue;
        out.push({ literal: lit, line: i + 1 });
      }
    }
  }
  return out;
}

// 파일별 리터럴 → 중복 findings.
//   files: [{path, literals:[{literal, line}]}]
//   allow: { "<literal>": "<사유>" } — 사유 빈 값 금지(다른 면제 항목과 같은 기조)
// 반환 {findings, errors}
//   findings: [{literal, sites:[{path, line}], files:number}] — 리터럴 사전순(결정적)
// **같은 파일 안의 반복도 센다** — 실측 사고 1은 같은 파일에 같은 규칙이 두 함수로 있었다.
export function duplicateLiteralFindings(files, allow = {}) {
  const errors = [];
  for (const [lit, reason] of Object.entries(allow || {})) {
    if (!String(reason ?? "").trim()) {
      errors.push(`duplicateLogicAllow "${lit}" — 사유 필수(왜 이 중복이 정당한가; 빈 값은 무언의 면제다)`);
    }
  }
  const bucket = new Map(); // literal -> [{path, line}]
  for (const f of files || []) {
    for (const l of f.literals || []) {
      if (!bucket.has(l.literal)) bucket.set(l.literal, []);
      bucket.get(l.literal).push({ path: f.path, line: l.line });
    }
  }
  const allowed = new Set(Object.keys(allow || {}));
  const findings = [];
  for (const lit of [...bucket.keys()].sort()) {
    const sites = bucket.get(lit);
    if (sites.length < 2 || allowed.has(lit)) continue;
    findings.push({ literal: lit, sites, files: new Set(sites.map((s) => s.path)).size });
  }
  return { findings, errors };
}

// 낡은 면제 표면화 — 더 이상 중복이 아닌 리터럴이 allow에 남아 있으면 다음 면제도 못 믿는다
// (supportLayerSpecs·synonymReviewLedger와 같은 기조: 등록부는 최신일 때만 등록부다).
export function staleAllowEntries(files, allow = {}) {
  const seen = new Map();
  for (const f of files || []) for (const l of f.literals || []) seen.set(l.literal, (seen.get(l.literal) || 0) + 1);
  return Object.keys(allow || {}).filter((lit) => (seen.get(lit) || 0) < 2).sort();
}

// ② 확률적 층 — 주입 어댑터의 stdout 한 줄 = 하나의 후보(SPEC-032·033과 같은 계약).
// 형식: `<경로>:<라인>\t<경로>:<라인>\t<설명>` (탭 구분, 설명은 선택).
// **비-0 종료는 skipped(사유)** — 도구가 없거나 실패한 것을 "중복 없음"으로 읽지 않는다.
export function parseDuplicateCandidates(stdout) {
  const out = [];
  for (const raw of String(stdout || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    out.push({ a: cells[0], b: cells[1], note: cells.slice(2).join(" ") });
  }
  return out;
}
