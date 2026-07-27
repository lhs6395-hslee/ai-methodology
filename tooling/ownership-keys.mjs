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
  const out = { entity: null, surface: null, capability: null };
  for (const [cat, role] of Object.entries(roles || {})) {
    const r = String(role || "").trim().toLowerCase();
    if (!(r in out)) continue; // 미지의 역할은 무시 — 오타가 판정을 뒤집지 않게
    const match = cats.find((c) => String(c).trim().toLowerCase() === String(cat).trim().toLowerCase());
    if (match && !out[r]) out[r] = match;
  }
  if (!out.entity) out.entity = cats.find((c) => /entit/i.test(c)) || null;
  if (!out.surface) out.surface = cats.find((c) => /surface/i.test(c)) || null;
  if (!out.capability) out.capability = cats.find((c) => /capabilit/i.test(c)) || null;
  return out;
}

// `## <heading>` 섹션을 잘라 카테고리별 키 배열로. 헤더 다음~다음 ## 전까지.
export function parseSection(text, heading, categories) {
  const start = text.search(new RegExp(`^##\\s+${heading}\\b`, "m"));
  const out = Object.fromEntries(categories.map((c) => [c, []]));
  if (start === -1) return out;
  const after = text.slice(start);
  const body = after.slice(after.indexOf("\n") + 1);
  const nextSec = body.search(/^##\s/m);
  const block = nextSec === -1 ? body : body.slice(0, nextSec);
  for (const cat of categories) {
    const line = block.match(new RegExp(`-\\s*\\*\\*${cat}\\*\\*\\s*:\\s*([^\\n]+)`, "i"));
    out[cat] = line
      ? line[1].split(",").map((k) => k.trim()).filter((k) => k && k !== "—" && k !== "[…]" && !k.startsWith("["))
      : [];
  }
  return out;
}

// 카테고리별 결정적 정규화(§4 표).
export function normalizeKey(category, raw, cfg) {
  const s = String(raw).trim();
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
    let path = m[2].toLowerCase().replace(/[:{<]([a-z0-9_-]+)[>}]?/g, paramRepl);
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
