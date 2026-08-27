// tooling/ownership-keys.mjs
// 공통 키 라이브러리 — 파싱·정규화·형식검증. check-ownership/cohesion/consistency 공유.
// 설계: docs/design/2026-06-30-ownership-key-derivation-design.md §4

// 카테고리 → 역할 해석(SPEC-001 FR-010) — 순수 함수. 반환 {entity, surface, capability}(카테고리명 or null).
// 방법론 판정 다수가 "어느 카테고리가 aggregate root/표면/능력인가"에 걸려 있는데, 그동안 카테고리
// **이름**을 정규식으로 추측했다. 그래서 이름을 바꾸면 판정이 조용히 inert가 되고(감사 A-1),
// 킷 자신처럼 Modules/Symbols를 쓰는 프로젝트는 규칙 전체를 자기에게 적용할 수 없었다(도그푸딩 공백).
// 선언 우선(대소문자 무관 카테고리 매칭) → 선언에 없는 역할만 이름 정규식 폴백(하위호환).
// 미해석 역할은 null이며 소비 게이트는 이를 "이 프로젝트엔 그 역할이 없음"으로 읽는다.
// 이 파생을 한 곳에 두어 ENT_CAT 폴백이 3개 파일에 복붙돼 있던 것(감사 F8)을 없앤다.
export function resolveCategoryRoles(categories, roles) {
  const cats = categories || [];
  // engine·event(SPEC-030)는 **선언 전용**(이름 정규식 폴백 없음) — 옵트인이라 명시 선언 없으면
  // 항상 inert(기존 프로젝트 무영향). entity/surface/capability만 이름 폴백을 유지한다.
  const out = { entity: null, surface: null, capability: null, engine: null, event: null };
  for (const [cat, role] of Object.entries(roles || {})) {
    const r = String(role || "").trim().toLowerCase();
    if (!(r in out)) continue; // 미지의 역할은 무시 — 오타가 판정을 뒤집지 않게
    const match = cats.find((c) => String(c).trim().toLowerCase() === String(cat).trim().toLowerCase());
    if (match && !out[r]) out[r] = match;
  }
  for (const [role, re] of Object.entries(ROLE_NAME_PATTERNS)) {
    if (!out[role]) out[role] = cats.find((c) => re.test(c)) || null;
  }
  return out;
}

// 이름 정규식 폴백의 **단일 정본**. 두 곳에 적으면 판정과 출처 보고가 갈라진다(R13).
export const ROLE_NAME_PATTERNS = Object.freeze({
  entity: /entit/i, surface: /surface/i, capability: /capabilit/i,
});

// 역할이 **어디서 왔는가** — declared | inferred | unresolved.
//
// 왜 필요한가: 이름 정규식 폴백(FR-010)은 **성공했을 때 조용하다.** 실패하면 사유가 남지만
// (capability-ownership의 "이름 폴백 실패"), 성공하면 판정이 **추측 위에서** 진행되고 아무도 모른다.
// 카테고리를 개명하면(Entities → Aggregates) 조준 대상이 바뀌는데 운영자는 그 사실을 통보받지 못한다.
// **추측이 금지인 방법론에서 추측의 성공은 침묵할 수 없다** — 판정 입력의 출처를 같이 낸다.
// 순수 함수 — 판정에 쓰이는 것과 **같은 규칙**으로 계산한다(다른 규칙으로 계산하면 보고가 거짓이 된다).
export function categoryRoleProvenance(categories, roles) {
  const cats = categories || [];
  const out = {};
  const declaredFor = {};
  for (const [cat, role] of Object.entries(roles || {})) {
    const r = String(role || "").trim().toLowerCase();
    const match = cats.find((c) => String(c).trim().toLowerCase() === String(cat).trim().toLowerCase());
    if (match && !declaredFor[r]) declaredFor[r] = match;
  }
  for (const role of Object.keys(ROLE_NAME_PATTERNS)) {
    if (declaredFor[role]) out[role] = "declared";
    else if (cats.find((c) => ROLE_NAME_PATTERNS[role].test(c))) out[role] = "inferred";
    else out[role] = "unresolved";
  }
  return out;
}

// Ownership 선언 **앞** 본문만 — 키가 자기 선언으로 근거를 얻는 것을 막는 공유 규칙.
// consistency(키 근거 대조)와 ownership-map(FR 라인 수집)이 같은 경계를 봐야 하므로 정본은 하나다
// (R13 실측: 두 게이트에 같은 정규식이 복제돼 있었다 — 한쪽만 고치면 두 판정의 경계가 어긋난다).
export function bodyBeforeOwnership(text, heading = "Ownership") {
  const at = String(text || "").search(new RegExp(`^##\\s+${heading}\\b`, "m"));
  return at === -1 ? String(text || "") : String(text).slice(0, at);
}

// `## <heading>` 섹션을 잘라 카테고리별 키 배열로. 헤더 다음~다음 ## 전까지.
export function parseSection(text, heading, categories) {
  const start = text.search(new RegExp(`^##\\s+${escapeRegExp(heading)}\\b`, "m"));
  const out = Object.fromEntries(categories.map((c) => [c, []]));
  if (start === -1) return out;
  const after = text.slice(start);
  const body = after.slice(after.indexOf("\n") + 1);
  const nextSec = body.search(/^##\s/m);
  const block = nextSec === -1 ? body : body.slice(0, nextSec);
  for (const cat of categories) {
    // 카테고리 불릿을 **전부** 수집한다(과거엔 첫 줄만 — 두 번째 불릿·줄바꿈 뒷부분이 dedup
    // 대상에서 무음 소실했다). 각 불릿은 다음 불릿(또는 블록 끝)까지 이어붙여 여러 줄에 걸친
    // 키 목록도 온전히 읽는다. 카테고리명은 정규식 이스케이프(`C++ Symbols` 류에서 Node 크래시
    // → Python `re.escape` 미러와 패리티).
    const re = new RegExp(`^[ \t]*-\\s*\\*\\*${escapeRegExp(cat)}\\*\\*\\s*:\\s*([\\s\\S]*?)(?=^[ \t]*-\\s*\\*\\*|\\n[ \t]*\\n|(?![\\s\\S]))`, "gim");
    const keys = [];
    for (const m of block.matchAll(re)) {
      // 줄바꿈으로 이어진 목록을 한 줄로 접는다(들여쓴 연속 줄 = 같은 불릿).
      const flat = m[1].replace(/\s*\n[ \t]*/g, " ").trim();
      for (const k of splitKeys(flat)) keys.push(k);
    }
    out[cat] = keys;
  }
  return out;
}

// 정규식 메타문자 이스케이프 — 카테고리·헤딩 이름을 정규식에 보간하기 전에 통과시킨다.
// Python판은 `re.escape`를 이미 쓰는데 Node판은 비이스케이프였다(미문서화 패리티 파괴 + 크래시).
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 키 목록 문자열을 쉼표로 나눈다 — 단 **괄호 안 쉼표는 구분자가 아니다**.
// 실측 결함: `POST /api/x (SPEC-013), ui:y (SPEC-013, 셸)`가
// ["… (SPEC-013)", "ui:y (SPEC-013", "셸)"]로 쪼개져 앵커 keySet을 쓰레기 토큰으로 오염시켰다.
// 플레이스홀더(`—`·`-`·`[…]`·`[TBD]` 등 대괄호만으로 둘러싼 토큰)는 키가 아니라 제외하되,
// `[id]`·`[level]/page.tsx` 같은 **정당한 대괄호 키는 보존**한다(과거엔 `[`로 시작하면 전부 폐기).
export function splitKeys(raw) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(raw)) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((k) => k.trim()).filter((k) => k && !isPlaceholder(k));
}

// 플레이스홀더 판정 — 값 없음 표기(`—`·`-`)와 "대괄호로만 둘러싼 자리표시"(`[…]`·`[TBD]`·`[미정]`).
// `[id]/page.tsx`처럼 대괄호 뒤에 실체가 이어지는 것은 플레이스홀더가 아니다(정당한 경로 키).
export function isPlaceholder(k) {
  const t = String(k).trim();
  if (!t || t === "—" || t === "-") return true;
  return /^\[[^\]]*\]$/.test(t);
}

// 카테고리별 결정적 정규화(§4 표).
export function normalizeKey(category, raw, cfg) {
  // 유니코드 정규화(NFC) — 같은 글자의 NFC/NFD 두 표현이 서로 다른 키로 갈리는 것을 막는다.
  // 실측: macOS(NFD 성향)와 Linux CI를 섞어 쓰거나 클립보드 경유로 붙여넣은 한글 키가 갈리면
  // 눈으로 동일한 entity를 두 스펙이 소유해도 dedup이 충돌을 놓쳤다(중복 누락).
  const s = String(raw).normalize("NFC").trim();
  if (category === "Surfaces") {
    const style = (cfg && cfg.surfaceFormat) || "http";
    if (style !== "http") {
      // 파일경로/자유형 Surface — 소문자 + trailing slash 제거(HTTP METHOD 파싱 안함).
      return s.toLowerCase().replace(/\/+$/, "") || s.toLowerCase();
    }
    // "<METHOD> <path>" 또는 "event:.."/"job:.." — 메서드 대문자, path 소문자, param 표준형, trailing slash 제거
    const m = s.match(/^(\S+)\s+(.+)$/);
    if (!m) return s.toLowerCase();
    const method = m[1].toUpperCase();
    const paramRepl = cfg.surfacePathParam.includes("name") ? cfg.surfacePathParam.replace("name", "$1") : "{$1}";
    // [id] — Next.js 파일 라우팅 param 문법(이슈 #21 M-12). 빠지면 :id·{id}·[id]가 서로
    // 다른 키가 되어 같은 라우트를 두 스펙이 나눠 소유해도 dedup이 못 잡는다.
    let path = m[2].toLowerCase().replace(/[:{<[]([a-z0-9_-]+)[>}\]]?/g, paramRepl);
    path = path.replace(/\/+$/, "") || "/";
    return `${method} ${path}`;
  }
  // Entity·Capability = 소문자 + 내부 공백 정리
  return s.toLowerCase().replace(/\s+/g, " ");
}

// 형식 검증 — 위반이면 이유 문자열, OK면 null.
export function validateKey(category, key, cfg) {
  if (category === "Capabilities") {
    const parts = key.split(".");
    if (parts.length !== 2) return `Capability는 entity.verb 형식(점 1개)이어야 함: "${key}"`;
    if (!cfg.__allVerbs.has(parts[1])) return `미등록 verb "${parts[1]}" — capabilityVerbs에 등록 필요: "${key}"`;
    return null;
  }
  if (category === "Surfaces") {
    const style = (cfg && cfg.surfaceFormat) || "http";
    if (style === "any") return null;
    if (style === "path") {
      // 파일경로 Surface: 공백 없는 경로형 토큰(슬래시·점·하이픈·[param]·glob·@scope 허용).
      return /^[\w.\-/\[\]@*]+$/.test(key)
        ? null
        : `Surface(path)는 공백 없는 파일경로 형식이어야 함: "${key}"`;
    }
    if (!/^[A-Z]+ \S/.test(key) && !/^(event|job):/.test(key))
      return `Surface는 "<METHOD> <path>" 또는 "event:/job:" 형식이어야 함: "${key}"`;
    return null;
  }
  return null; // Entity는 형식 제약 없음(스키마 식별자 그대로)
}
