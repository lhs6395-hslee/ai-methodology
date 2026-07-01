// tooling/ownership-keys.mjs
// 공통 키 라이브러리 — 파싱·정규화·형식검증. check-ownership/cohesion/consistency 공유.
// 설계: docs/superpowers/specs/2026-06-30-ownership-key-derivation-design.md §4

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
    if (!/^[A-Z]+ \S/.test(key) && !/^(event|job):/.test(key))
      return `Surface는 "<METHOD> <path>" 또는 "event:/job:" 형식이어야 함: "${key}"`;
    return null;
  }
  return null; // Entity는 형식 제약 없음(스키마 식별자 그대로)
}
