// tooling/synonym-lib.mjs
// 동의어·형태 변이 판정 순수 코어 (SPEC-033) — 의미적 중복의 결정적 포획층.
//
// 문제: dedup(SPEC-002)은 **키 문자열의 유일성**만 본다. `order`/`orders`/`pjt_order`처럼 형태만
// 다른 같은 실체, `user`/`member`처럼 말만 다른 같은 개념은 통과한다(감사 semantic-dup 6건).
//
// 설계 원칙 — **LLM/임베딩은 판정자가 아니라 후보 생성기다.** 확률적 판정이 빌드를 깨거나 키를
// 자동 병합하면 그 실수가 곧 방법론의 오류가 된다. 그래서 3층으로 가른다:
//   ① 형태 변이(lexical) — 정규화 후 충돌. **결정적** → hard 가능.
//   ② 선언 동의어(declared) — 사람이 정본·별칭을 사유와 함께 선언. **결정적** → hard 가능.
//   ③ 유사 후보(probabilistic) — 외부 툴(SBERT·LLM·WordNet) 주입 결과. **영원히 advisory**이며
//      사람이 ①②로 착지시키거나 **기각 원장**에 사유와 함께 남겨야만 사라진다(조용한 소실 없음).
// 즉 확률적 층은 "무엇을 볼지"만 정하고, "무엇이 참인지"는 결정적 층만 정한다.
// 순수 함수(IO 없음) — 외부 툴 실행은 소비 게이트. Python 미러(SPEC-006).

import { createHash } from "node:crypto";
const sha1hex = (s) => createHash("sha1").update(String(s), "utf8").digest("hex");

// 단수화: 보수적으로만 — 오탐이 정본을 흔들면 안 된다. `status`·`class`·`analysis`는 건드리지 않는다.
const KEEP_SUFFIX = /(ss|us|is|os)$/i;
export function singularize(word) {
  const w = String(word || "");
  if (w.length <= 3 || KEEP_SUFFIX.test(w)) return w;
  if (/ies$/i.test(w)) return w.replace(/ies$/i, "y");
  if (/(ches|shes|xes|zes|ses)$/i.test(w)) return w.replace(/es$/i, "");
  if (/s$/i.test(w)) return w.replace(/s$/i, "");
  return w;
}

// 키 → 정본형(canonical form). snake/camel/kebab 토큰화 → 소문자 → 접두어 제거 → 단수화 → 재결합.
// prefixes: 프로젝트 접두어 목록(예: ["pjt", "fin"]) — 비면 접두어 제거 없음(과잉 병합 금지).
export function canonicalForm(key, prefixes = []) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  const tokens = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase 분리
    .split(/[\s._\-/]+/)                       // snake·kebab·dot·slash 분리
    .map((t) => t.toLowerCase())
    .filter(Boolean);
  const pfx = new Set((prefixes || []).map((p) => String(p).toLowerCase()));
  const body = tokens.filter((t, i) => !(i === 0 && pfx.has(t)));
  const kept = body.length ? body : tokens;     // 전부 접두어면 원형 유지
  return kept.map(singularize).join("_");
}

// ① 형태 변이 충돌: 서로 다른 소유 키가 같은 정본형으로 접히면 위반(결정적).
//   owned: [{specId, category, key}] (정규화 전 원문)
// 반환 [{canonical, members:[{specId, category, key}]}] — 정본형 사전순.
export function lexicalCollisions(owned, prefixes = []) {
  const byCanon = new Map();
  for (const o of owned || []) {
    const c = canonicalForm(o.key, prefixes);
    if (!c) continue;
    if (!byCanon.has(c)) byCanon.set(c, []);
    byCanon.get(c).push(o);
  }
  const out = [];
  for (const [canonical, members] of [...byCanon.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const distinct = new Set(members.map((m) => String(m.key).trim().toLowerCase()));
    if (distinct.size > 1) out.push({ canonical, members });
  }
  return out;
}

// registry 무결성(결정적) — LLM이 조용히 흔들 수 없게 사유·모순·실재를 검사한다.
//   registry: { "<정본키>": { aliases: [...], reason: "..." } }
//   ownedKeys: Set(정규화된 소유 키) — 정본이 실재하는지 대조(없는 정본 선언 금지)
// 반환 에러 문자열 배열.
export function validateSynonymRegistry(registry, ownedKeys) {
  const errors = [];
  const aliasOwner = new Map(); // alias → canonical(첫 선언)
  for (const [canonical, entry] of Object.entries(registry || {})) {
    const c = String(canonical).trim().toLowerCase();
    const aliases = (entry && entry.aliases) || [];
    const reason = String((entry && entry.reason) || "").trim();
    if (!reason) errors.push(`synonymRegistry["${canonical}"] — 통합 사유 필요(빈 값 불가: 왜 같은 개념인가)`);
    if (!Array.isArray(aliases) || !aliases.length) errors.push(`synonymRegistry["${canonical}"] — aliases 최소 1개 필요`);
    if (ownedKeys && ownedKeys.size && !ownedKeys.has(c)) {
      errors.push(`synonymRegistry["${canonical}"] — 정본 키가 어느 스펙에도 소유되지 않음(실재하지 않는 정본 선언 금지)`);
    }
    for (const a of aliases) {
      const al = String(a).trim().toLowerCase();
      if (al === c) { errors.push(`synonymRegistry["${canonical}"] — 별칭 "${a}"가 정본과 동일`); continue; }
      if (aliasOwner.has(al) && aliasOwner.get(al) !== c) {
        errors.push(`별칭 "${al}"가 두 정본에 걸림("${aliasOwner.get(al)}" vs "${c}") — 모순 선언`);
      }
      aliasOwner.set(al, c);
    }
  }
  return errors;
}

// ② 선언 동의어 위반: 소유 키가 어떤 정본의 **별칭**이면 정본으로 통일해야 한다(결정적).
// 반환 [{specId, category, key, canonical}] — 선언 순.
export function declaredSynonymFindings(owned, registry) {
  const aliasMap = new Map();
  for (const [canonical, entry] of Object.entries(registry || {})) {
    for (const a of (entry && entry.aliases) || []) {
      aliasMap.set(String(a).trim().toLowerCase(), String(canonical).trim().toLowerCase());
    }
  }
  const out = [];
  for (const o of owned || []) {
    const k = String(o.key).trim().toLowerCase();
    const canonical = aliasMap.get(k);
    if (canonical) out.push({ specId: o.specId, category: o.category, key: k, canonical });
  }
  return out;
}

// 후보 쌍 파싱 — 외부 툴 stdout 한 줄 = 후보 하나. 구분자는 탭·`|`·`,`(첫 두 필드만 사용).
// 셋째 필드가 있으면 점수로 함께 싣는다(정렬·표시용, 판정엔 쓰지 않는다).
export function parseCandidatePairs(stdout) {
  const out = [];
  for (const line of String(stdout || "").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\t|\||,/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const [a, b, score] = parts;
    const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
    if (x === y) continue;
    out.push({ a: x, b: y, score: score || "" });
  }
  // 중복 쌍 제거(결정적 순서 유지)
  const seen = new Set();
  return out.filter((p) => { const k = `${p.a}::${p.b}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 후보 목록의 신선도 — 확률적 산출물에 대한 **결정적** 검사.
// 후보 목록은 낡는다: entity가 34건일 때 만든 목록이 47건이 된 뒤에도 그대로면 게이트는
// "미결 후보 0"을 찍고 사람은 다 봤다고 믿는다(SPEC-028이 없애려던 그 착각). 그래서 생성기가
// 자기가 본 entity 집합을 stdout 헤더로 함께 선언하게 하고, 게이트가 현재 집합과 대조한다.
//   생성기 헤더 형식: `# entity-set: <건수> <해시>`
export function entitySetFingerprint(keys) {
  const norm = [...new Set((keys || []).map((k) => String(k).trim().toLowerCase()))].sort();
  return { count: norm.length, hash: sha1hex(norm.join("\n")).slice(0, 12) };
}

export function parseCandidateHeader(stdout) {
  for (const line of String(stdout || "").split("\n")) {
    const m = line.match(/^\s*#\s*entity-set:\s*(\d+)\s+([0-9a-f]{6,40})\s*$/i);
    if (m) return { count: Number(m[1]), hash: m[2].toLowerCase() };
  }
  return null;
}

// null = 최신 / {kind:"undeclared"} / {kind:"stale", declared, current}
// 판정 결과는 **언제나 advisory**다 — 목록이 낡았다고 커밋을 막으면 새 entity를 추가할 때마다
// LLM 세션이 커밋의 선행 조건이 된다. 그러면 사람은 ③을 통째로 떼어낸다(회피 유발 = 설계 실패).
export function candidateFreshness(declared, current) {
  if (!declared) return { kind: "undeclared" };
  if (declared.hash !== current.hash) return { kind: "stale", declared, current };
  return null;
}

// ③ 후보 분류 — **판정이 아니라 미결 목록이다.** 이미 결정된 쌍(정본·별칭 관계 ∨ 기각 원장)은
// 소멸하고, 나머지만 "사람이 결정해야 할 것"으로 남는다. 확률적 층이 차단력을 갖지 않는 이유:
// 이 함수의 반환은 소비 게이트에서 **언제나 advisory**로만 소비된다(hard여도 exit 1 아님).
//   pairs: parseCandidatePairs 결과 / registry: ② 선언 / ledger: { "a::b": "기각 사유" }
// 반환 {unresolved:[{a,b,score}], resolvedByRegistry:n, resolvedByLedger:n}
export function classifyCandidates(pairs, registry, ledger) {
  const same = new Set();
  for (const [canonical, entry] of Object.entries(registry || {})) {
    const c = String(canonical).trim().toLowerCase();
    for (const a of (entry && entry.aliases) || []) {
      const [x, y] = [c, String(a).trim().toLowerCase()].sort();
      same.add(`${x}::${y}`);
    }
  }
  const rejected = new Set(Object.keys(ledger || {}).map((k) => {
    const [a, b] = String(k).split("::").map((s) => s.trim().toLowerCase());
    return [a, b].sort().join("::");
  }));
  const unresolved = [];
  let byRegistry = 0, byLedger = 0;
  for (const p of pairs || []) {
    const key = `${p.a}::${p.b}`;
    if (same.has(key)) { byRegistry++; continue; }
    if (rejected.has(key)) { byLedger++; continue; }
    unresolved.push(p);
  }
  return { unresolved, resolvedByRegistry: byRegistry, resolvedByLedger: byLedger };
}

// 기각 원장 무결성 — 사유 없는 기각은 "조용한 묵살"이라 금지(registry와 동형 관문).
export function validateLedger(ledger) {
  const errors = [];
  for (const [pair, reason] of Object.entries(ledger || {})) {
    if (!String(pair).includes("::")) errors.push(`synonymReviewLedger["${pair}"] — 키 형식은 "keyA::keyB"`);
    if (!String(reason || "").trim()) errors.push(`synonymReviewLedger["${pair}"] — 기각 사유 필요(빈 값 불가: 왜 다른 개념인가)`);
  }
  return errors;
}
