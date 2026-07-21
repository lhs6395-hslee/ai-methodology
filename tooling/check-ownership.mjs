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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection, normalizeKey, validateKey } from "./ownership-keys.mjs";
import { ownershipCategoriesFindings } from "./grammar-lib.mjs";
import { parseRelationEntry, relationTypeFinding, resolveRelations, findCycles } from "./relation-lib.mjs";
import { capabilityCheckActive, capabilityOwnershipFindings } from "./capability-ownership-lib.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { schemaBackingActive, validateSchemaPatterns, extractSchemaEntities, schemaBackingFindings } from "./schema-backing-lib.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");

const CATEGORIES = cfg.ownershipCategories;
const ENT_CAT = CATEGORIES.find((c) => /entit/i.test(c)) || CATEGORIES[0];
// Capability 귀속(SPEC-024) — 스펙 경계는 entity 기준: capability x.verb는 entity x 소유 스펙만.
// entity·capability류 카테고리가 둘 다 있을 때만 활성(비-웹 카테고리 무영향).
const CAP_CAT = CATEGORIES.find((c) => /capabilit/i.test(c));
const CAP_POLICY = cfg.capabilityOwnershipPolicy || "advisory";
if (!["off", "advisory", "hard"].includes(CAP_POLICY)) {
  console.error(`✗ capabilityOwnershipPolicy 값 위반 "${CAP_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const CAP_ACTIVE = CAP_POLICY !== "off" && capabilityCheckActive(CATEGORIES);
const capFindings = []; // {specId, capability, entity}

// Entity 스키마 백킹(SPEC-026) — 소유 entity가 구조 SSOT에 실재하는지 대조(유령 entity 차단).
const SB_POLICY = cfg.entitySchemaBackingPolicy || "off";
if (!["off", "advisory", "hard"].includes(SB_POLICY)) {
  console.error(`✗ entitySchemaBackingPolicy 값 위반 "${SB_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const SB_SOURCES = cfg.entitySchemaSources || [];
const SB_ACTIVE = schemaBackingActive(SB_POLICY, SB_SOURCES, CATEGORIES);
const sbOwned = []; // {specId, entities:[raw...]}

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

  // Capability 귀속(SPEC-024): 소유 capability의 entity 조각이 소유 entity에 없으면 위반 —
  // entity 0개+capability 소유(기술 계층 스펙)와 남의 entity 위 capability를 모두 잡는다.
  if (CAP_ACTIVE && CAP_CAT) {
    for (const f of capabilityOwnershipFindings(own[ENT_CAT], own[CAP_CAT])) {
      capFindings.push({ specId, ...f });
    }
  }

  // Entity 스키마 백킹(SPEC-026): 소유 entity 수집 — 아래에서 구조 SSOT 실재 집합과 대조.
  if (SB_ACTIVE && (own[ENT_CAT] || []).length) sbOwned.push({ specId, entities: own[ENT_CAT] });

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

// Capability 귀속 리포트(SPEC-024) — 스펙 경계는 entity 기준.
const capHard = CAP_POLICY === "hard" && capFindings.length > 0;
if (CAP_ACTIVE && capFindings.length) {
  console.log(`Capability 귀속(capabilityOwnershipPolicy=${CAP_POLICY}): 위반 ${capFindings.length}건 — capability는 그 entity를 소유한 스펙에 귀속`);
  for (const f of capFindings) {
    console.log(`  ${capHard ? "✗" : "⚠"} [${f.specId}] Capabilities "${f.capability}" — entity "${f.entity}"를 이 스펙이 소유하지 않음: 그 entity 소유 스펙으로 이관(verb가 달라도 같은 스펙에 FR 신설), 이 스펙이 그 aggregate면 Entities에 소유 선언`);
  }
}
if (capHard) {
  console.error(`\n✗ capabilityOwnershipPolicy=hard: entity 없는 capability 소유(기술 계층 스펙) 금지 — 위 능력을 소유 aggregate 스펙으로 이관하라(SPEC-024).`);
  process.exit(1);
}

// Entity 스키마 백킹 리포트(SPEC-026) — 소유 entity가 구조 SSOT(스키마)에 실재하는가.
const sbErrors = [];
let sbFindings = [];
let sbExemptUsed = []; // 사용 중(소유된) 면제 entity — 항상 표면화(부채, 조용한 '완료' 방지)
if (SB_ACTIVE) {
  const EXEMPT = cfg.entitySchemaExemptEntities || {};
  const exemptSet = new Set();
  for (const [k, v] of Object.entries(EXEMPT)) {
    if (!String(v ?? "").trim()) sbErrors.push(`entitySchemaExemptEntities["${k}"] — 면제 사유 필요(빈 값 불가)`);
    const key = String(k).trim().toLowerCase();
    if (key) exemptSet.add(key);
  }
  // 잘못된 정규식은 크래시 대신 명확히 보고(엔진별 메시지 미포함 — 패리티).
  for (const e of validateSchemaPatterns(SB_SOURCES)) {
    sbErrors.push(`entitySchemaSources[${e.index}].patterns "${e.pattern}" — 잘못된 정규식(문법 오류): 이 knob의 추출 패턴을 확인하라`);
  }
  // 구조 SSOT 파일 수집(루트 1회 순회, ignoreDirs 제외) 후 소스별 글롭 매치·패턴 추출.
  const IGNORE = new Set(cfg.ignoreDirs);
  const allFiles = [];
  (function walk(dir, rel = "") {
    let entries;
    try { entries = readdirSync(dir).sort(); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name), r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!IGNORE.has(name)) walk(p, r); }
      else allFiles.push(r);
    }
  })(ROOT);
  const units = [];
  for (const src of SB_SOURCES) {
    const globs = (src.globs || []).map(compileGlob);
    const patterns = src.patterns || [];
    if (!globs.length || !patterns.length) continue;
    for (const rel of allFiles) {
      if (!globs.some((rx) => rx.test(rel))) continue;
      try { units.push({ text: readFileSync(join(ROOT, rel), "utf8"), patterns }); } catch { /* skip */ }
    }
  }
  sbFindings = schemaBackingFindings(sbOwned, extractSchemaEntities(units), exemptSet);
  sbExemptUsed = [...exemptSet].filter((e) => owners[ENT_CAT].has(e)).sort();
}
const sbHard = SB_POLICY === "hard" && sbFindings.length > 0;
if (SB_ACTIVE && sbFindings.length) {
  console.log(`Entity 스키마 백킹(entitySchemaBackingPolicy=${SB_POLICY}): 위반 ${sbFindings.length}건 — 소유 entity가 구조 SSOT에 없음(유령 entity 의심)`);
  for (const f of sbFindings) {
    console.log(`  ${sbHard ? "✗" : "⚠"} [${f.specId}] Entities "${f.entity}" — 구조 SSOT(스키마)에 실재하지 않음: 실제 테이블이면 스키마에 존재해야 하고, UI/흐름 개념이면 Surface로 강등하고 capability를 실 entity로 재키(SPEC-026)`);
  }
}
// 면제는 조용히 '완료'가 되지 않게 항상 표면화(부채·리뷰 대상). 대량 면제는 entity를 aggregate가
// 아니라 개념 단위로 쪼갠 신호 — 면제로 우회하지 말고 UI/흐름은 Surface, 인프라/proto는 해당 구조
// SSOT를 entitySchemaSources에 추가하라(실측: 소비 프로젝트가 40건을 일괄 면제하고 hard 승격).
if (SB_ACTIVE && sbExemptUsed.length) {
  console.log(`Entity 스키마 백킹: 스키마 대조 면제 ${sbExemptUsed.length}건(부채·리뷰 대상 — UI/흐름 개념은 Surface 강등+실 entity 재키, 인프라/proto는 해당 구조 SSOT를 entitySchemaSources에 추가; 면제는 스키마 밖 실 외부 aggregate에만): ${sbExemptUsed.join(", ")}`);
}
if (sbErrors.length) {
  console.error(`\n✗ entitySchemaExemptEntities 위반 ${sbErrors.length}건:`);
  for (const e of sbErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
if (sbHard) {
  console.error(`\n✗ entitySchemaBackingPolicy=hard: 소유 entity는 구조 SSOT에 실재해야 한다 — 유령 entity(지어낸 개념)에 capability를 얹지 말고 실 entity로 재구성하라(SPEC-026).`);
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
