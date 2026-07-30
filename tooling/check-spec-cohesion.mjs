#!/usr/bin/env node
// ─── Spec cohesion 게이트 (under-fragmentation / cramming 차단) ───
// check-ownership(dedup)의 거울상: dedup은 "2 spec이 같은 키"(과편화/중복),
// 이 게이트는 "1 spec이 키/FR 과다"(under-fragmentation = 한 spec에 여러 기능
// 욱여넣기)를 잡는다. 한 spec = 한 응집 capability 묶음(STRUCTURE.md).
//
// 신호(advisory, --strict로 강제):
//   · 카테고리별 소유 키 수 > maxKeysPerCategoryPerSpec (기본 4)
//   · FR 수 > maxFRsPerSpec (기본 8)
// 둘 다 sdd.config.json에서 조정. Ownership 없는 spec은 키 신호 건너뜀(FR만).
// 키 종류는 ownershipCategories를 그대로 따른다(비-웹 카테고리도 동일 적용).
//
// Usage: node scripts/check-spec-cohesion.mjs [--strict]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { frDeclarations } from "./grammar-lib.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");
const CATEGORIES = cfg.ownershipCategories;
const MAX_KEYS = cfg.maxKeysPerCategoryPerSpec;
const MAX_FRS = cfg.maxFRsPerSpec;
function specFiles() {
  let names;
  try { names = readdirSync(SPEC_DIR); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`);
    process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => join(SPEC_DIR, n));
}

// aggregate root 카테고리: config의 **역할 선언**(ownershipCategoryRoles)이 정본이고,
// 미선언이면 이름 정규식 폴백(`__roles`가 이미 수행) → 그것도 실패하면 첫 카테고리.
const ENT_CAT = cfg.__roles.entity || CATEGORIES[0]; // 역할 선언 우선(SPEC-001 FR-010)

// 고유 FR-ID 수 — 문법은 config의 requirementIdPrefixes에서 파생(coverage와 동일 사이트 통일).
// 정의(**FR-NNN**)만 — Change Log/근거의 FR 인용은 제외(SPEC-013 frDeclarations가 범위를 판정).
// 전문 스캔은 이력의 FR 인용까지 세어 FR 수를 부풀렸다(maxFRsPerSpec 거짓 초과 신호).
function countFRs(text) {
  return new Set(frDeclarations(text, cfg.__frDeclRe, cfg.__reqAlt)).size;
}

const files = specFiles();
const violations = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];
  const frs = countFRs(text);
  if (frs > MAX_FRS) violations.push({ specId, kind: "FR", n: frs, max: MAX_FRS });
  const own = parseSection(text, "Ownership", CATEGORIES);
  const hasOwnership = text.search(/^##\s+Ownership/m) !== -1;
  if (hasOwnership) {
    // 신규: Entities(aggregate root) 다수 = 여러 aggregate 삼킴 신호. 임계는 config(기본 1).
    const MAX_AGG = cfg.maxAggregateRootsPerSpec ?? 1;
    if (own[ENT_CAT] && own[ENT_CAT].length > MAX_AGG)
      violations.push({ specId, kind: `${ENT_CAT}(aggregate)`, n: own[ENT_CAT].length, max: MAX_AGG });
    // 신규: aggregate root 최소 하한(owner #1 "entity 없이 묶임"). entity **역할**이 선언됐는데
    // 키를 하나라도 소유하면서 그 칸이 비면 위반 — Surface/Capability만 번들한 'entity 없는 스펙'을
    // 차단(MAX의 거울). 역할 미정의(순수 lib·entity 개념 없음)면 건너뜀(하위호환). 폴백 CATEGORIES[0] 아님.
    const ENT_ROLE = cfg.__roles.entity;
    if (ENT_ROLE) {
      const ownsAny = CATEGORIES.some((c) => own[c] && own[c].length > 0);
      if (ownsAny && (!own[ENT_ROLE] || own[ENT_ROLE].length === 0))
        violations.push({ specId, kind: `${ENT_ROLE}(min)`, n: 0, max: 1 });
    }
    // 카테고리별 키 > MAX_KEYS. 단 capability 역할 카테고리는 **entity별**로 센다 —
    // SPEC-024가 한 entity의 verb를 같은 스펙에 강제하므로, 총 capability 수로 캡을 걸면
    // 정상 full-CRUD aggregate나 다-entity 스펙이 거짓 분할 신호를 받는다(감사 oc-3·gran-4의 모순).
    // entity별 카운트는 순수 완화다(entity별 최대 ≤ 총합 → 위반을 추가하지 않고 거짓양성만 제거).
    const CAP_CAT = cfg.__roles.capability;
    for (const cat of CATEGORIES) {
      if (CAP_CAT && cat === CAP_CAT) {
        const byEnt = {};
        for (const k of own[cat]) { const e = String(k).split(".")[0].trim().toLowerCase(); byEnt[e] = (byEnt[e] || 0) + 1; }
        let top = null;
        for (const [e, n] of Object.entries(byEnt)) if (!top || n > top.n) top = { e, n };
        if (top && top.n > MAX_KEYS)
          violations.push({ specId, kind: `${cat}(entity:${top.e})`, n: top.n, max: MAX_KEYS });
      } else if (own[cat].length > MAX_KEYS) {
        violations.push({ specId, kind: cat, n: own[cat].length, max: MAX_KEYS });
      }
    }
  }
}

console.log(`Spec 입도(cohesion) 게이트: spec ${files.length}개 검사 (키>${MAX_KEYS}/카테고리, FR>${MAX_FRS}).`);

if (violations.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} 과대 spec(분할 권고) ${violations.length}건:`);
  for (const v of violations) {
    if (v.kind.includes("(min)"))
      console.log(`  ${tag} ${v.specId}: aggregate root(${v.kind.replace("(min)", "")}) 0개 — 스펙은 entity(aggregate root)를 최소 1개 소유해야 한다(entity 없이 Surface/Capability만 번들 금지). entity를 소유하거나, 남의 entity 능력이면 그 소유 스펙으로 이관(SPEC-024)`);
    else if (v.kind.includes("aggregate"))
      console.log(`  ${tag} ${v.specId}: ${v.kind} ${v.n}개 > ${v.max} — 여러 aggregate 삼킴 의심 → root 1개만 남기고 나머지는 Dependencies의 \`이름 (relation-type)\`으로 이관(SPEC-017), 그래도 남으면 분할 검토`);
    else
      console.log(`  ${tag} ${v.specId}: ${v.kind} ${v.n}개 > ${v.max} → capability별 분할 검토`);
  }
  if (STRICT) {
    console.error(`\n✗ --strict: 과대 spec은 분할 필요.`);
    process.exit(1);
  }
  process.exit(0);
}

console.log(`✓ 모든 spec이 입도 기준 내 — 분할 권고 없음.`);
