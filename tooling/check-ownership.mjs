#!/usr/bin/env node
// ─── Cross-spec ownership uniqueness gate ─────────────────
// 방법론 최대 빈칸을 기계로 메운다: "spec 간 중복인가?"를 사람 판단이 아니라
// **소유권 키 유일성**으로 결정·강제한다. (DEDUP.md, STRUCTURE.md 중복 규칙)
//
// 각 spec은 `## Ownership` 블록에 자신이 **소유하는 키**를 선언한다:
//   ## Ownership
//   - **Entities**: pjt_projects, pjt_project_staff
//   - **Surfaces**: POST /api/pjt/recommend, GET /tools/pjt-management/new
//   - **Capabilities**: project.create, staff.assign
//
// ## Dependencies 블록은 다른 spec이 소유한 키를 '참조'로 선언한다.
// Dependencies 키는 dedup 대상이 아님(거짓양성 방지).
//
// 규칙(같은 카테고리 내에서 위반 시 exit 1):
//   하나의 Entity / Surface / Capability 키는 **정확히 한 spec**만 소유한다.
//   2개 이상 spec이 같은 키를 선언하면 = 구조적 중복 → 실패.
//
// Ownership 블록이 없는 spec은 **warn**(점진 도입 — spec마다 채워가며 켠다).
// 의미적 중복(키는 다른데 의도 같음)은 이 게이트가 못 잡는다 → 같은 Entity
// 이웃 spec과 좁힌 리뷰로 보완(SPEC_REVIEW.md). 이 게이트는 구조적 중복 전담.
//
// 키 종류(CATEGORIES)·spec 위치는 sdd.config.json에서 온다 — 웹/CRUD가 아닌
// 프로젝트는 ownershipCategories를 바꿔 쓴다(예: Modules/Symbols/Artifacts).
// config 없으면 기존 Entities/Surfaces/Capabilities 기본값(하위호환).
//
// Usage: node scripts/check-ownership.mjs [--strict]
//   --strict : Ownership 블록 없는 spec도 실패(완전 강제), 형식위반도 실패

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection, normalizeKey, validateKey } from "./ownership-keys.mjs";
import { ownershipCategoriesFindings } from "./grammar-lib.mjs";
import { parseRelationEntry, relationTypeFinding, resolveRelations, findCycles } from "./relation-lib.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");

const CATEGORIES = cfg.ownershipCategories;
const ENT_CAT = CATEGORIES.find((c) => /entit/i.test(c)) || CATEGORIES[0];

// ownershipCategories에 Files 금지(SPEC-013, DEDUP.md §3) — 글롭이 dedup 키로 유입되면
// 유일성·형식검증이 오판한다. 문서의 "금지"를 config 검증으로 기계 강제.
const catErrors = ownershipCategoriesFindings(CATEGORIES);
if (catErrors.length) {
  console.error("✗ ownershipCategories 위반:");
  for (const e of catErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

function specFiles() {
  let names;
  try { names = readdirSync(SPEC_DIR); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`);
    process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => join(SPEC_DIR, n));
}

const files = specFiles();
const owners = Object.fromEntries(CATEGORIES.map((c) => [c, new Map()]));
const missing = [], formatIssues = [];
const specDeps = []; // {specId, entities:[{name,type}]} — 관계 판정용(SPEC-017)
let declaredCount = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];

  // Parse Ownership section (dedup target)
  const own = parseSection(text, "Ownership", CATEGORIES);
  const hasAny = CATEGORIES.some((c) => own[c].length);

  if (!hasAny) { missing.push(specId); continue; }
  declaredCount++;

  for (const cat of CATEGORIES) {
    for (const raw of own[cat]) {
      const key = normalizeKey(cat, raw, cfg);
      const bad = validateKey(cat, key, cfg);
      if (bad) formatIssues.push({ specId, cat, bad });
      if (!owners[cat].has(key)) owners[cat].set(key, []);
      owners[cat].get(key).push(specId);
    }
  }

  // Parse Dependencies section — do NOT add to owners (not a dedup target).
  // `EntityName (relation-type)` 항목만 구조화 관계로 뽑아 SPEC-017 판정에 넘긴다 — 괄호 없는
  // 레거시 자유참조는 여기서도 관여하지 않는다(하위호환, 관여 없음 = 무해).
  const deps = parseSection(text, "Dependencies", CATEGORIES);
  const relEntities = (deps[ENT_CAT] || []).map(parseRelationEntry).filter((e) => e.type);
  if (relEntities.length) specDeps.push({ specId, entities: relEntities });
}

// 충돌(같은 키를 2+ spec이 소유) 수집
const conflicts = [];
for (const cat of CATEGORIES) {
  for (const [key, specs] of owners[cat]) {
    if (specs.length > 1) conflicts.push({ cat, key, specs: [...new Set(specs)] });
  }
}

// entity 레지스트리(SPEC-002 FR-009, P3): PREFIX 거버넌스와 동일 패턴 — 등록 = config 변경 = 리뷰 관문.
// 비어 있으면 비활성(현행). 채워지면 aggregate-root 카테고리의 소유 키는 등록된 것만, 사유는 빈 값 불가.
const REGISTRY = cfg.entityRegistry || {};
const entityErrors = [];
const registryWarns = [];
if (Object.keys(REGISTRY).length) {
  const reg = new Map(Object.keys(REGISTRY).map((k) => [normalizeKey(ENT_CAT, k, cfg), String(REGISTRY[k] ?? "").trim()]));
  for (const [key, rationale] of reg) {
    if (!rationale) entityErrors.push(`entityRegistry["${key}"] — 도입 사유 필요(빈 값 불가)`);
  }
  for (const [key, specIds] of owners[ENT_CAT]) {
    if (!reg.has(key)) entityErrors.push(`미등록 entity "${key}" (${[...new Set(specIds)].join(" + ")}) — entityRegistry에 사유와 함께 등록 필요(임의 신설 금지)`);
  }
  for (const key of reg.keys()) {
    if (!owners[ENT_CAT].has(key)) registryWarns.push(`entityRegistry의 "${key}"를 소유한 spec 없음 — 선등록이 아니면 정리 대상`);
  }
}

// Entity 관계(SPEC-017): 대상 실재·소유 spec 해석 = hard, 순환 참조 = advisory.
// relationTypes가 비어있으면 어휘 무제한(capabilityVerbs 동형) — 형식(kebab 토큰)만 relation-lib가 이미 강제.
const RELATION_TYPES = cfg.relationTypes || [];
const relationErrors = [];
for (const { specId, entities } of specDeps) {
  for (const { type } of entities) {
    const bad = relationTypeFinding(type, RELATION_TYPES);
    if (bad) relationErrors.push(`[${specId}] ${bad}`);
  }
}
const entityOwnerIndex = new Map([...owners[ENT_CAT].entries()].map(([key, specIds]) => [key, specIds[0]]));
const { edges: relationEdges, missing: relationMissing } = resolveRelations(specDeps, entityOwnerIndex);
for (const { specId, entity, type } of relationMissing) {
  relationErrors.push(`[${specId}] 관계 대상 Entity "${entity}" (${type}) — 어느 spec의 Ownership에도 없음(오타·삭제 확인)`);
}
const relationCycles = findCycles(relationEdges);

console.log(`Ownership 게이트: spec ${files.length}개 중 ${declaredCount}개가 Ownership 선언.`);
if (missing.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} Ownership 블록 없음(${missing.length}): ${missing.join(", ")}`);
}

if (formatIssues.length) {
  const tag = STRICT ? "✗" : "⚠";
  for (const f of formatIssues) console.log(`${tag} [${f.specId}] ${f.bad}`);
}

for (const w of registryWarns) console.log(`⚠ ${w}`);
if (entityErrors.length) {
  console.error(`\n✗ ENTITY 레지스트리 위반 ${entityErrors.length}건:`);
  for (const e of entityErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

for (const c of relationCycles) console.log(`⚠ 관계 순환 참조: ${c.join(" → ")} — aggregate 간 참조는 한 방향이어야 한다(설계 검토)`);
if (relationErrors.length) {
  console.error(`\n✗ Entity 관계(SPEC-017) 위반 ${relationErrors.length}건:`);
  for (const e of relationErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

if (conflicts.length) {
  console.error(`\n✗ 중복 소유(구조적 중복) ${conflicts.length}건:`);
  for (const c of conflicts) {
    console.error(`  [${c.cat}] "${c.key}" ← ${c.specs.join(" + ")}  → 한 spec으로 통합/개정 필요`);
  }
  process.exit(1);
}

if (STRICT && (missing.length || formatIssues.length)) {
  if (missing.length) console.error(`\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.`);
  if (formatIssues.length) console.error(`\n✗ --strict: 형식 위반이 있음 — 수정 필요.`);
  process.exit(1);
}

console.log(`✓ 구조적 중복 없음 — 모든 ${CATEGORIES.join("/")} 키가 유일.`);
