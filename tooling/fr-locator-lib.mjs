// tooling/fr-locator-lib.mjs
// FR 로케이터 순수 코어 (SPEC-062) — "지금 바꾸려는 이것은 **어느 FR**인가"에 답한다.
//
// 왜 이 축이 필요한가(실측 제보): spec-first 강제는 이미 편집 시점에 발화한다
// (`check-pre-edit.mjs`가 매 편집마다 파일→소유 스펙을 계산). 그런데 그 출력은 **스펙 ID까지만**
// 좁히고 "그 스펙의 FR/Edge Cases/Change Log를 보라"에서 멈춘다 — 어느 FR인지는 사람·에이전트가
// **스펙 통독**으로 찾아야 했다. 킷 자신은 스펙당 FR이 최대 11개라 통독이 싸지만, 소비 프로젝트
// (gsn-ai-pm-management-tool)는 `maxFRsPerSpec: 50`이라 같은 절차가 5배 비싸다. 오너 제보:
// "뭐 하나 바꾸는데 너무 오래 걸린다 — 변경할 때 FR 찾는 게 너무 오래 걸리는 것 같다."
//
// 재료는 이미 전부 계산되고 있었다 — 다만 **이 질문에 답하는 자리가 없었다**:
//   · 테스트의 `@covers <SPEC>/<FR>` 태그(SPEC-007 회계·SPEC-018 retire가 이미 인덱스를 만든다)
//   · FR 라인이 백틱으로 **지목한 구현체**(SPEC-046 impl-reference가 이미 뽑는다)
//   · FR 라인의 **굵은 키 앵커**(SPEC-023이 이미 강제한다)
// `sdd/OWNERSHIP_MAP.md`(SPEC-028)는 키→가드 맵이라 이 질문에 답하지 못한다 — 축이 다르다.
//
// ⚠ 이 코어는 **판정기가 아니라 조회기**다. 그래서 두 규율을 지킨다:
//   ① **추측하지 않는다.** 근거 4종은 전부 결정적 대조다(태그 멤버십·이름 일치·앵커 대응·부분문자열).
//      "비슷해 보이는 FR"을 유사도로 추천하지 않는다 — 틀린 확신은 통독보다 나쁘다.
//   ② **못 좁혔으면 못 좁혔다고 말한다.** 근거 0건인 FR은 후보로 **반환하지 않는다**(소비자가
//      "N개 중 0개로 좁힘 = 통독 필요"를 말할 수 있게 전체 수는 따로 센다). 근거 없는 것을
//      후보로 섞으면 목록이 길어지면서 조회의 의미가 사라진다.
//
// 파일 IO 없음(순수) — 스펙 읽기·테스트 스캔·경로 정규화는 소비자(`sdd-where.mjs`·
// `check-pre-edit.mjs`)가 한다. 설계: SPEC-062.

import { extractAnchors, isFrDeclLine } from "./key-anchor-lib.mjs";
import { isFileLikeSurface, symbolCandidates } from "./ownership-reality-lib.mjs";
import { namedImplementations } from "./impl-reference-lib.mjs";
import { isAuditTrailSection } from "./grammar-lib.mjs";

// 근거 등급 — 점수는 **직접성** 순서다(유사도가 아니라 결속의 강도).
//   covers   : 이 파일을 참조하는 테스트가 그 FR을 스스로 태깅했다 — 저자가 명시한 결속이다.
//   named-fn : FR이 이름으로 지목한 함수가 이 파일에 있다 — FR이 이 코드를 직접 부른다.
//   named-mod: FR이 이름으로 지목한 모듈이 이 파일이다.
//   anchor   : FR의 굵은 키 앵커가 이 파일에 대응한다(파일형 surface 키).
//   keyword  : FR 선언 라인이 그 도메인 단어를 담는다(키워드 모드 — 파일이 아직 없을 때의 입구).
export const EVIDENCE_RANK = Object.freeze({
  covers: 3,
  "named-fn": 3,
  "named-mod": 2,
  anchor: 2,
  keyword: 2,
});

// covers 근거의 **판별력 감쇠** — 실측(도그푸딩 첫 실행): `deploy-window-lib.mjs`를 조회하니
// SPEC-060의 FR 6개가 **전부** 후보로 떴다. 테스트 파일 하나(`deploy-window.test.mjs`)가 그
// 스펙의 FR 6개를 모두 태깅하고 그 파일을 언급하기 때문이다. 그 태그가 말하는 것은 "이 FR이다"가
// 아니라 "이 파일이 이 스펙 전반을 검증한다"이므로, 넓게 태깅한 테스트의 covers는 **약한 근거**다.
// 임의 임계로 자르지 않고 태깅 폭(breadth)으로 나눈다 — 좁게 태깅한 테스트가 하나라도 있으면
// 그 쪽이 점수를 지배하고(min을 쓴다), 전 FR을 덮는 태그는 자연히 1/N로 묻힌다.
export function coversScore(breadth) {
  const n = Number(breadth);
  return EVIDENCE_RANK.covers / (Number.isFinite(n) && n > 0 ? n : 1);
}

// 스펙 본문에서 FR 선언 라인을 뽑는다 — [{frId, line}](선언 순).
// `frDeclarations`(SPEC-013)는 **ID만** 주므로 라인 본문이 필요한 이 축이 따로 모은다. 범위 판정은
// 같은 규칙을 쓴다(`isFrDeclLine` — 섹션 밖·산문 인용을 선언으로 세지 않는 정본, SPEC-056).
export function frDeclLines(specText, frDeclRe, reqAlt = "FR") {
  const re = new RegExp(frDeclRe && frDeclRe.source ? frDeclRe.source : String(frDeclRe));
  const out = [];
  for (const line of String(specText || "").split("\n")) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    const m = line.match(re);
    if (m) out.push({ frId: m[1], line: line.trim() });
  }
  return out;
}

// 경로의 basename(디렉토리 제거) — 확장자는 유지한다.
function baseOf(p) {
  const s = String(p || "").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i === -1 ? s : s.slice(i + 1);
}

// 확장자 제거형 — 앵커 키가 확장자 없이 모듈을 지목하는 표기(`chat` ← `chat.ts`)를 위해.
function stripExt(p) {
  const b = String(p || "");
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

// 앵커 토큰이 이 경로에 대응하는가 — `symbolCandidates`(SPEC-029 ①의 결정적 변환: 원문 +
// 점→슬래시)를 **역방향 대조**에 그대로 쓴다. 같은 대응 규칙을 두 곳에 적으면 한쪽이 뒤처지고
// 그때 두 축이 서로 다른 답을 낸다(R13이 보는 결함) — 그래서 새 규칙을 만들지 않는다.
function anchorMatchesPath(token, relPath) {
  if (!isFileLikeSurface(token)) return false;              // `POST /x`·`event:` 류는 파일이 아니다
  const rel = String(relPath || "").toLowerCase();
  const targets = new Set([rel, baseOf(rel), stripExt(rel), stripExt(baseOf(rel))]);
  return symbolCandidates(token).some((c) => targets.has(c));
}

// 부분문자열 대조용 이스케이프 — 도메인 키워드는 한글·기호를 담을 수 있다(정규식 특수문자 무해화).
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// FR 후보 산출.
//
// frUnits: [{specId, frId, line}] — 소비자가 (보통 소유 스펙들에서) 모아 넘긴 FR 선언 라인들.
// probe:
//   path        (선택) 변경 대상 상대 경로 — named-mod·anchor 대조의 좌변.
//   pathText    (선택) 그 파일의 내용 — named-fn 대조용(FR이 지목한 함수가 이 파일에 등장하는가).
//   coversBy    (선택) Map<"<SPEC>/<FR>", [{file, breadth}...]> — covers 근거와 그 출처.
//               breadth = **그 테스트가 이 스펙에서 태깅한 FR 총 개수**(판별력 감쇠용 — 위 coversScore).
//   keyword     (선택) 도메인 단어 — FR 선언 라인 부분문자열 대조(대소문자 무시).
//   isTestName  (선택) 모듈명이 테스트 자산인지 판정(그 이름은 구현체가 아니라 검증 자산이다).
//   moduleExtensions (선택) 모듈형 백틱 스팬으로 인정할 확장자(config `implModuleExtensions`).
//
// 반환: [{specId, frId, line, evidence:[{kind, detail}], score}] — score desc → specId asc →
// frId asc(결정적 정렬). **근거 0건은 반환하지 않는다**(위 규율 ②).
export function locateFrs(frUnits, probe = {}) {
  const { path = null, pathText = "", coversBy = null, keyword = null, isTestName, moduleExtensions = null } = probe;
  const kwRe = keyword ? new RegExp(escapeRegExp(String(keyword).trim()), "i") : null;
  const baseLower = path ? baseOf(String(path)).toLowerCase() : null;
  const out = [];

  for (const { specId, frId, line } of frUnits || []) {
    const evidence = [];

    // ① covers — 저자가 테스트에 적어둔 결속. 어느 테스트가 그 말을 했는지와 **그 태그의 폭**까지
    // 근거로 남긴다(폭이 넓으면 "이 FR이다"가 아니라 "이 스펙 전반이다"라는 뜻 — coversScore가 감쇠).
    if (coversBy) {
      const tests = coversBy.get(`${specId}/${frId}`);
      if (tests && tests.length) {
        const narrowest = Math.min(...tests.map((t) => (Number(t.breadth) > 0 ? Number(t.breadth) : 1)));
        const detail = tests.map((t) => `${t.file}${Number(t.breadth) > 1 ? `→FR ${t.breadth}개 태깅` : ""}`).join(", ");
        evidence.push({ kind: "covers", detail, weight: coversScore(narrowest) });
      }
    }

    // ②③ FR이 백틱으로 지목한 구현체 — 함수는 파일 내용에서, 모듈은 basename에서 찾는다.
    if (path || pathText) {
      for (const { name, kind } of namedImplementations(line, isTestName, moduleExtensions)) {
        if (kind === "fn" && pathText && new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}([^A-Za-z0-9_$]|$)`).test(pathText)) {
          evidence.push({ kind: "named-fn", detail: name });
        } else if (kind === "mod" && baseLower && name.toLowerCase() === baseLower) {
          evidence.push({ kind: "named-mod", detail: name });
        }
      }
    }

    // ④ 굵은 키 앵커가 이 파일에 대응 — SPEC-023이 이미 강제해 둔 결속을 조회에 쓴다.
    if (path) {
      for (const token of new Set(extractAnchors(line))) {
        if (anchorMatchesPath(token, path)) evidence.push({ kind: "anchor", detail: token });
      }
    }

    // ⑤ 도메인 키워드 — 파일이 아직 없는 변경(신규 기능)의 입구. 스펙 **전문** grep과 다른 점은
    // 대조 범위가 FR 선언 라인뿐이라는 것이다(Change Log·근거 문단의 인용이 섞이지 않는다).
    if (kwRe && kwRe.test(line)) evidence.push({ kind: "keyword", detail: String(keyword).trim() });

    if (!evidence.length) continue;
    // 근거별 가중치 — covers는 태깅 폭으로 감쇠된 weight를 들고 오고, 나머지는 등급표를 쓴다.
    const score = evidence.reduce((s, e) => s + (typeof e.weight === "number" ? e.weight : (EVIDENCE_RANK[e.kind] || 0)), 0);
    out.push({ specId, frId, line, evidence, score });
  }

  return out.sort((a, b) => b.score - a.score
    || (a.specId < b.specId ? -1 : a.specId > b.specId ? 1 : 0)
    || (a.frId < b.frId ? -1 : a.frId > b.frId ? 1 : 0));
}

// 키워드가 **어느 스펙의 어느 절**에 나타나는가 — 스펙 단위 조회.
//
// 왜 FR 라인 대조만으로는 부족한가(도그푸딩 실측): 이 킷은 **FR 정본이 영어**(EARS)이고 한글
// 서술은 User Story·Edge Cases·Change Log에 산다. 그래서 한국어로 일하는 사람이 "배포창"으로
// 찾으면 FR 라인 매치는 **0건**이 나온다 — 실제로 SPEC-060이 그 개념의 주인인데도. 정본 언어와
// 작업 언어의 간극은 규범의 결함이 아니므로(영어 정본은 SPEC-002의 결정) 조회기가 메운다.
//
// 반환: [{specId, path, frLineHits, sections:[절 이름...], frTotal}] — frLineHits 내림차순 →
// specId 오름차순. sections는 **FR 선언 라인 밖**에서 키워드가 나타난 절(중복 제거·등장 순).
// FR을 특정하지 못한다는 사실이 그대로 드러나는 형태다("이 스펙이다, FR은 그 안에서 고르라").
export function locateSpecsByKeyword(specs, keyword, { frDeclRe, reqAlt = "FR", buildSectionMap } = {}) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];
  const re = new RegExp(escapeRegExp(kw), "i");
  const out = [];
  for (const { specId, path, text } of specs || []) {
    const body = String(text || "");
    if (!re.test(body)) continue;
    const lines = body.split("\n");
    const sections = typeof buildSectionMap === "function" ? buildSectionMap(body) : [];
    const sectionAt = (lineNo) => {          // 1-based — buildSectionMap의 계약과 같다
      let cur = null;
      for (const s of sections) { if (s.start <= lineNo) cur = s.name; else break; }
      return cur;
    };
    let frLineHits = 0;
    const hitSections = [];
    const auditSections = [];
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      if (frDeclRe && isFrDeclLine(line, reqAlt)) { frLineHits += 1; return; }
      const name = sectionAt(i + 1);
      if (!name) return;
      // 감사 트레일(Change Log·Review Log·Dedup-Review)의 언급은 **과거 기록**이다 — 그 개념의
      // 현재 주인이라는 뜻이 아니다(실측: "유령 entity"로 조회하니 그 개념을 지금 소유한 SPEC-026
      // 옆에 과거에 한 번 언급한 SPEC-001·002·030이 같은 무게로 섞여 나왔다). 절 목록의 정본은
      // grammar-lib이고 SPEC-016의 마커 스캔도 같은 규율을 쓴다.
      const bucket = isAuditTrailSection(name) ? auditSections : hitSections;
      if (!bucket.includes(name)) bucket.push(name);
    });
    const frTotal = frDeclRe ? frDeclLines(body, frDeclRe, reqAlt).length : 0;
    out.push({ specId, path, frLineHits, sections: hitSections, auditSections, frTotal });
  }
  // 정렬: FR 라인 직접 매치 → 정본 절 매치 → (감사 절만인 것은 뒤로) → specId. 과거 기록만 가진
  // 스펙이 현재 주인보다 위로 오지 않게 한다.
  return out.sort((a, b) => b.frLineHits - a.frLineHits
    || b.sections.length - a.sections.length
    || (a.specId < b.specId ? -1 : a.specId > b.specId ? 1 : 0));
}

// 후보 한 줄 요약 — 소비자(조회기·훅)가 같은 문구를 쓰도록 여기서 만든다(두 소비처의 표기가
// 갈리면 같은 사실이 두 모양으로 보인다). width로 FR 선언 라인을 자른다(0이면 자르지 않음).
export function formatCandidate({ specId, frId, line, evidence }, width = 100) {
  const why = evidence.map((e) => `${e.kind}${e.detail ? `(${e.detail})` : ""}`).join(" + ");
  const body = String(line).replace(/^-\s*/, "").replace(/\s+/g, " ").trim();
  const shown = width > 0 && body.length > width ? `${body.slice(0, width)}…` : body;
  return `${specId}/${frId} — ${shown}  [근거: ${why}]`;
}
