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
import { join, relative } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection, normalizeKey, validateKey } from "./ownership-keys.mjs";
import { ownershipCategoriesFindings, exemptGlobFindings } from "./grammar-lib.mjs";
import { parseRelationEntry, relationTypeFinding, resolveRelations, findCycles } from "./relation-lib.mjs";
import { capabilityCheckActive, capabilityInertReasons, capabilityOwnershipFindings } from "./capability-ownership-lib.mjs";
import { compileGlob , parseFilesLine} from "./spec-sync-lib.mjs";
import { schemaBackingActive, schemaBackingInertReasons, validateSchemaPatterns, extractSchemaEntities, schemaBackingFindings } from "./schema-backing-lib.mjs";
import { specSlug, specSlugSourceDeclared, symbolRealityActive, symbolRealityInertReasons, symbolRealityFindings, isFileLikeSurface } from "./ownership-reality-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");

const CATEGORIES = cfg.ownershipCategories;
// 역할은 config 선언(ownershipCategoryRoles)에서 오고 미선언 시 이름 폴백(SPEC-001 FR-010) —
// 이름 정규식 폴백이 3개 파일에 복붙돼 있던 것(감사 F8: 개명+순서 조합에서 엉뚱한 카테고리 조준)을 없앴다.
const ROLES = cfg.__roles;
const ENT_CAT = ROLES.entity || CATEGORIES[0];
// Capability 귀속(SPEC-024) — 스펙 경계는 entity 기준: capability x.verb는 entity x 소유 스펙만.
// entity·capability류 카테고리가 둘 다 있을 때만 활성(비-웹 카테고리 무영향).
const CAP_CAT = ROLES.capability;
const CAP_POLICY = cfg.capabilityOwnershipPolicy || "advisory";
if (!["off", "advisory", "hard"].includes(CAP_POLICY)) {
  console.error(`✗ capabilityOwnershipPolicy 값 위반 "${CAP_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const CAP_ACTIVE = CAP_POLICY !== "off" && capabilityCheckActive(ROLES);
// 정책이 off가 아닌데 판정이 성립하지 않으면(inert) 사유를 반드시 출력한다 — hard면 차단(거짓 안전).
const CAP_INERT = capabilityInertReasons(CAP_POLICY, ROLES);
const capFindings = []; // {specId, capability, entity}

// Entity 스키마 백킹(SPEC-026) — 소유 entity가 구조 SSOT에 실재하는지 대조(유령 entity 차단).
const SB_POLICY = cfg.entitySchemaBackingPolicy || "off";
if (!["off", "advisory", "hard"].includes(SB_POLICY)) {
  console.error(`✗ entitySchemaBackingPolicy 값 위반 "${SB_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const SB_SOURCES = cfg.entitySchemaSources || [];
const SB_ACTIVE = schemaBackingActive(SB_POLICY, SB_SOURCES, ROLES);
const SB_INERT = schemaBackingInertReasons(SB_POLICY, SB_SOURCES, ROLES);
const sbOwned = []; // {specId, entities:[raw...], slug}

// 심볼 실재(SPEC-029 ②) — 선언된 소스 루트 아래 실재하는 파일/디렉토리 basename과 대조.
// surface 실재의 **정방향** 판정이다(orphan-surface는 역방향만 봐서 감사 M-2로 남아 있었다).
const SR_POLICY = String(cfg.symbolRealityPolicy ?? "off");
if (!["off", "advisory", "hard"].includes(SR_POLICY)) {
  console.error(`✗ symbolRealityPolicy 값 위반 "${SR_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const SR_ROOTS = cfg.ownershipSourceRoots || [];
const SR_ACTIVE = symbolRealityActive(SR_POLICY, SR_ROOTS, ROLES);
const SR_INERT = symbolRealityInertReasons(SR_POLICY, SR_ROOTS, ROLES);
const SUR_CAT = ROLES && ROLES.surface;
const srOwned = []; // {specId, surfaces:[raw...]}

// 구조 문법 잔여 3종(감사 후속 G1·G2·G3) — 결정적 중복차단의 남은 구멍. 기본 advisory(신규 채택
// 소급 범람 방지), 킷은 config에서 hard(자기 닫음). 순수 신규 검출(G2·G3)이라 위반 추가만 함.
//   G1 ownershipRequiredPolicy — 모든 스펙의 Ownership 선언 강제(미선언 = dedup 사각).
//   G2 crossCategoryDedupPolicy — 같은 정규화 키가 2+ 카테고리에 소유되는 것(카테고리 간 중복).
//   G3 filesOverlapPolicy — 2+ 스펙의 Files glob이 같은 실파일을 소유하는 것(실코드 중복 소유).
const ORQ_POLICY = String(cfg.ownershipRequiredPolicy ?? "advisory");
const XCAT_POLICY = String(cfg.crossCategoryDedupPolicy ?? "advisory");
const FOV_POLICY = String(cfg.filesOverlapPolicy ?? "advisory");
for (const [n, v] of [["ownershipRequiredPolicy", ORQ_POLICY], ["crossCategoryDedupPolicy", XCAT_POLICY], ["filesOverlapPolicy", FOV_POLICY]]) {
  if (!["off", "advisory", "hard"].includes(v)) {
    console.error(`✗ ${n} 값 위반 "${v}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
}
const filesBySpec = []; // {specId, globs:[...]} — G3 Files 겹침 판정용

// ownershipCategories에 Files 금지(SPEC-013, DEDUP.md §3) — 글롭이 dedup 키로 유입되면
// 유일성·형식검증이 오판한다. 문서의 "금지"를 config 검증으로 기계 강제.
const catErrors = ownershipCategoriesFindings(CATEGORIES);
if (catErrors.length) {
  console.error("✗ ownershipCategories 위반:");
  for (const e of catErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// specSyncExemptGlobs 무결성(SPEC-013 FR-007) — 면제 목록이 강제 자체를 무력화하는 것을 막는다.
// config 자기면제·전면 면제는 프로즈로만 금지돼 있었고(감사 A-4 실측: 소비 프로젝트가 실제 등재),
// 그러면 정책 하향·면제 확대·상한 상향이 전부 영속 흔적 0으로 실행된다. 위 카테고리 검증과 동형.
const exemptErrors = exemptGlobFindings(
  cfg.specSyncExemptGlobs,
  cfg.__path ? relative(ROOT, cfg.__path) : "sdd.config.json",
);
if (exemptErrors.length) {
  console.error("✗ specSyncExemptGlobs 위반:");
  for (const e of exemptErrors) console.error(`  ✗ ${e}`);
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
let relStructCount = 0, relFreeCount = 0; // 관계 판정 발화량(침묵 표면화용)
let declaredCount = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];

  // G3: Files glob 수집(Ownership 선언 유무와 무관 — Files만 있는 스펙도 겹침 대상).
  // 인라인 주석(#) 제거, 쉼표 분리. Files는 관례상 Ownership 블록에만 나타난다.
  {
    const globs = parseFilesLine(text);   // Files 라인 문법은 spec-sync-lib 단일 사이트(SPEC-038 실수확)
    if (globs.length) filesBySpec.push({ specId, globs });
  }

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
  if (SB_ACTIVE && (own[ENT_CAT] || []).length) sbOwned.push({ specId, entities: own[ENT_CAT], slug: specSlug(file) });

  // 심볼 실재(SPEC-029 ②): 소유 surface 중 **파일형 키만** 수집 — HTTP·이벤트·잡·경로
  // 표면은 파일이 아니므로 이 문법의 대상이 아니다(웹 레포 오발동 금지).
  if (SR_ACTIVE && (own[SUR_CAT] || []).length) {
    const fileLike = own[SUR_CAT].filter(isFileLikeSurface);
    if (fileLike.length) srOwned.push({ specId, surfaces: fileLike });
  }

  // Parse Dependencies section — do NOT add to owners (not a dedup target).
  // `EntityName (relation-type)` 항목만 구조화 관계로 뽑아 SPEC-017 판정에 넘긴다 — 괄호 없는
  // 레거시 자유참조는 여기서도 관여하지 않는다(하위호환, 관여 없음 = 무해).
  const deps = parseSection(text, "Dependencies", CATEGORIES);
  // ⚠ 관계 대상 이름은 **소유자 색인과 같은 정규화**를 거쳐야 한다. `owners`는
  // `normalizeKey`로 채워지는데(위) 여기서 원문을 그대로 쓰면 대소문자만 달라도
  // 조회가 실패해 hard `missing-target` 오차단이 난다 — 스펙이 소유 키를 글자 그대로
  // 베껴 써도 막힌다(실측: 소비 프로젝트 finops의 `IacActionRun`). 킷 자기적용으로는
  // 영구히 안 보였다 — 킷의 entity 키(`retag`·`key-anchor`)가 이미 소문자라서다.
  const relParsed = (deps[ENT_CAT] || []).map(parseRelationEntry)
    .map((e) => (e.type ? { ...e, name: normalizeKey(ENT_CAT, e.name, cfg) } : e));
  const relEntities = relParsed.filter((e) => e.type);
  if (relEntities.length) specDeps.push({ specId, entities: relEntities });
  // 자유참조(타입 없는 항목) 집계 — 관계 판정(SPEC-017)은 구조화 관계에만 발화하므로,
  // 전부 자유참조인 레포에서는 대상 실재 검증이 **한 번도 돌지 않는다**. 그 침묵을 표면화한다.
  relFreeCount += relParsed.length - relEntities.length;
  relStructCount += relEntities.length;
}

// 충돌(같은 키를 2+ spec이 소유) 수집
const conflicts = [];
for (const cat of CATEGORIES) {
  for (const [key, specs] of owners[cat]) {
    if (specs.length > 1) conflicts.push({ cat, key, specs: [...new Set(specs)] });
  }
}

// G2: 카테고리 간 동일 정규화 키(같은 문자열이 2+ 카테고리에 소유) — 카테고리 내부 dedup의 사각.
const xcatConflicts = [];
if (XCAT_POLICY !== "off") {
  const byKey = new Map(); // key → Map(cat → Set(spec))
  for (const cat of CATEGORIES) {
    for (const [key, specs] of owners[cat]) {
      if (!byKey.has(key)) byKey.set(key, new Map());
      byKey.get(key).set(cat, new Set(specs));
    }
  }
  for (const [key, catMap] of byKey) {
    if (catMap.size > 1) {
      const cats = [...catMap.keys()].sort();
      const specs = [...new Set([].concat(...cats.map((c) => [...catMap.get(c)])))].sort();
      xcatConflicts.push({ key, cats, specs });
    }
  }
  xcatConflicts.sort((a, b) => a.key.localeCompare(b.key));
}

// G3: 두 스펙의 Files glob이 같은 실파일을 소유(실코드 중복 소유) — Files는 dedup 밖이라 사각이었다.
const filesOverlap = [];
if (FOV_POLICY !== "off" && filesBySpec.length) {
  const IGNORE = new Set(cfg.ignoreDirs);
  const allRel = [];
  (function walk(dir, rel = "") {
    let entries; try { entries = readdirSync(dir).sort(); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name), r = rel ? `${rel}/${name}` : name;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!IGNORE.has(name)) walk(p, r); }
      else allRel.push(r);
    }
  })(ROOT);
  const fileToSpecs = new Map();
  for (const { specId, globs } of filesBySpec) {
    const rxs = globs.map(compileGlob);
    for (const rel of allRel) {
      if (rxs.some((rx) => rx.test(rel))) {
        if (!fileToSpecs.has(rel)) fileToSpecs.set(rel, new Set());
        fileToSpecs.get(rel).add(specId);
      }
    }
  }
  for (const [rel, specs] of [...fileToSpecs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (specs.size > 1) filesOverlap.push({ file: rel, specs: [...specs].sort() });
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

// 축이 여럿인 게이트다 — 개별 축의 inert는 각자 줄로 나오고(아래), 게이트 전체 판정은 여기서 낸다.
if (!files.length) verdict(VERDICT_KINDS.INERT, "판정 대상 스펙 0건 — specDir이 비었거나 읽지 못했다");
else judged(0);  // 위반 건수는 아래 축별 집계 뒤 갱신된다
console.log(`Ownership 게이트: spec ${files.length}개 중 ${declaredCount}개가 Ownership 선언.`);
if (missing.length) {
  const tag = (STRICT || ORQ_POLICY === "hard") ? "✗" : "⚠";
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

// 선언된 정책이 아무것도 판정하지 않으면(inert) 사유를 고지한다(SPEC-002 FR-010) — 침묵 금지.
// hard는 ✗+차단("hard 선언 + 무판정"은 거짓 안전), advisory는 플레인 `·` 고지(정책 기본값 프로젝트의
// 하네스 flagged 판정을 오염시키지 않는다 — 소급 범람 금지), 명시적 off는 이 함수가 사유를 안 낸다.
if (CAP_INERT.length) {
  console.log(`${CAP_POLICY === "hard" ? "✗" : "·"} Capability 귀속(capabilityOwnershipPolicy=${CAP_POLICY}): 판정 불가(inert) — ${CAP_INERT.join("; ")}`);
}
if (SB_INERT.length) {
  console.log(`${SB_POLICY === "hard" ? "✗" : "·"} Entity 스키마 백킹(entitySchemaBackingPolicy=${SB_POLICY}): 판정 불가(inert) — ${SB_INERT.join("; ")}`);
}
if (CAP_POLICY === "hard" && CAP_INERT.length) {
  console.error(`\n✗ capabilityOwnershipPolicy=hard인데 판정이 성립하지 않는다(위 사유) — hard 선언 + 무판정은 거짓 안전이다. ownershipCategories에 entity류·capability류 카테고리를 두어 판정을 성립시키거나, 이 프로젝트에 capability 개념이 없으면 정책을 off로 명시하라(SPEC-024).`);
  process.exit(1);
}
if (SB_POLICY === "hard" && SB_INERT.length) {
  console.error(`\n✗ entitySchemaBackingPolicy=hard인데 판정이 성립하지 않는다(위 사유) — hard 선언 + 무판정은 거짓 안전이다. entitySchemaSources에 구조 SSOT 어댑터를 선언하고 entity류 카테고리를 두어 판정을 성립시키거나, 스키마가 없는 프로젝트면 정책을 off로 명시하라(SPEC-026).`);
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
  // 모듈 문법(SPEC-029 ①) — `{kind:"spec-slug"}` 소스가 선언되면 스펙 파일명 슬러그도
  // 실재 근거가 된다. 스펙별 대조이므로 slugBySpec 맵으로 넘긴다(전역 집합 아님).
  const slugBySpec = specSlugSourceDeclared(SB_SOURCES)
    ? Object.fromEntries(sbOwned.map((o) => [o.specId, o.slug]))
    : null;
  sbFindings = schemaBackingFindings(sbOwned, extractSchemaEntities(units), exemptSet, slugBySpec);
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

// ── 심볼 실재(SPEC-029 ②) ─────────────────────────────────────────────
// inert는 백킹과 동형으로 매 실행 표면화한다 — "hard 선언 + 무판정"은 거짓 안전이다.
if (SR_INERT.length) {
  console.log(`· 심볼 실재(symbolRealityPolicy=${SR_POLICY}): 판정 불가(inert) — ${SR_INERT.join(" / ")}`);
}
let srFindings = [];
if (SR_ACTIVE) {
  // 소스 루트 아래 실재 집합(재귀, ignoreDirs 제외). 세 형태를 담는다:
  //   ① basename(`lib.mjs`) — 디렉토리도 표면일 수 있어 함께 넣는다(`go-gate` 실측)
  //   ② 루트 기준 상대경로(`cli/x.py`)
  //   ③ 확장자 없는 상대경로(`cli/x`) — **점 표기 모듈 경로 해석에 필요**하다
  //      (`src.cli.x` → 후보 `src/cli/x`; 소비 프로젝트 finops 실측)
  // ③이 없으면 점 표기 키는 어떤 소스 루트 설정으로도 매치하지 않는다(오탐률 100%).
  const IGNORE2 = new Set(cfg.ignoreDirs);
  const realSet = new Set();
  for (const root of SR_ROOTS) {
    (function walk(dir, rel) {
      let entries;
      try { entries = readdirSync(dir).sort(); } catch { return; }
      for (const name of entries) {
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        const r = rel ? `${rel}/${name}` : name;
        realSet.add(name.toLowerCase());
        realSet.add(r.toLowerCase());
        realSet.add(r.replace(/\.[^./]+$/, "").toLowerCase());
        if (st.isDirectory() && !IGNORE2.has(name)) walk(p, r);
      }
    })(join(ROOT, root), root);
  }
  srFindings = symbolRealityFindings(srOwned, realSet);
}
const srHard = SR_POLICY === "hard" && srFindings.length > 0;
if (SR_ACTIVE && srFindings.length) {
  console.log(`심볼 실재(symbolRealityPolicy=${SR_POLICY}): 위반 ${srFindings.length}건 — 소유 surface가 소스 루트에 실재하지 않음`);
  for (const f of srFindings) {
    console.log(`  ${srHard ? "✗" : "⚠"} [${f.specId}] Surfaces "${f.symbol}" — ${SR_ROOTS.join("·")} 아래에 그 이름의 파일·디렉토리가 없음: 실제 파일이면 키를 실물 이름에 맞추고(또는 파일을 만들고), 다른 루트에 있으면 ownershipSourceRoots에 선언하라(SPEC-029)`);
  }
}
if (srHard) {
  console.error(`\n✗ symbolRealityPolicy=hard: 소유 surface(파일형 키)는 선언된 소스 루트 아래 실재해야 한다 — 면제 목록이 아니라 데이터 교정으로 닫아라(SPEC-029).`);
  process.exit(1);
}
if (SR_POLICY === "hard" && SR_INERT.length) {
  console.error(`\n✗ symbolRealityPolicy=hard인데 판정이 성립하지 않는다(위 사유) — hard 선언 + 무판정은 거짓 안전이다. ownershipSourceRoots를 선언하고 surface류 카테고리를 두어 판정을 성립시키거나, 정책을 off로 명시하라(SPEC-029).`);
  process.exit(1);
}

// 관계 판정이 한 번도 발화하지 않은 상태를 표면화 — Dependencies는 쓰는데 전부 자유참조면
// SPEC-017의 대상 실재 검증(FR-002)·순환 탐지가 **아무것도 보지 않는다**(실측: 소비 프로젝트
// 두 곳이 구조화 0건 · 자유참조 101건). 침묵은 근거가 아니므로 수치로 적는다.
if (relStructCount === 0 && relFreeCount > 0) {
  console.log(`· Entity 관계(SPEC-017): 판정 0건 — Dependencies 참조 ${relFreeCount}건이 전부 자유참조(타입 없음)라 대상 실재 검증·순환 탐지가 발화하지 않았다. \`이름 (relation-type)\` 형식으로 적으면 판정 대상이 된다`);
}
for (const c of relationCycles) console.log(`⚠ 관계 순환 참조: ${c.join(" → ")} — aggregate 간 참조는 한 방향이어야 한다(설계 검토)`);
if (relationErrors.length) {
  console.error(`\n✗ Entity 관계(SPEC-017) 위반 ${relationErrors.length}건:`);
  for (const e of relationErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// G2 리포트(카테고리 간 동일 키) — hard면 ✗, advisory면 ⚠.
const xcatHard = XCAT_POLICY === "hard" && xcatConflicts.length > 0;
if (xcatConflicts.length) {
  console.log(`${xcatHard ? "✗" : "⚠"} 카테고리 간 동일 키(crossCategoryDedupPolicy=${XCAT_POLICY}) ${xcatConflicts.length}건 — 같은 정규화 키가 여러 카테고리에 소유:`);
  for (const c of xcatConflicts) console.log(`  ${xcatHard ? "✗" : "⚠"} "${c.key}" ← ${c.cats.join("+")} (${c.specs.join(", ")}) → 한 카테고리로 통합하거나 키를 구분(같은 실체면 한 역할)`);
}
// G3 리포트(Files 겹침) — hard면 ✗, advisory면 ⚠.
const fovHard = FOV_POLICY === "hard" && filesOverlap.length > 0;
if (filesOverlap.length) {
  console.log(`${fovHard ? "✗" : "⚠"} Files 겹침(filesOverlapPolicy=${FOV_POLICY}) ${filesOverlap.length}건 — 한 실파일을 2+ 스펙이 소유:`);
  for (const c of filesOverlap) console.log(`  ${fovHard ? "✗" : "⚠"} ${c.file} ← ${c.specs.join(" + ")} → Files glob을 좁혀 한 스펙만 소유하게`);
}

if (conflicts.length) {
  console.error(`\n✗ 중복 소유(구조적 중복) ${conflicts.length}건:`);
  for (const c of conflicts) {
    console.error(`  [${c.cat}] "${c.key}" ← ${c.specs.join(" + ")}  → 한 spec으로 통합/개정 필요`);
  }
  process.exit(1);
}

// G1: Ownership 선언 강제(미선언 = dedup 사각). ORQ hard면 --strict 없이도 차단.
const orqHard = ORQ_POLICY === "hard" && missing.length > 0;
if (orqHard) console.error(`\n✗ ownershipRequiredPolicy=hard: 모든 스펙이 Ownership을 선언해야 한다(미선언 ${missing.length}건: ${missing.join(", ")}) — 미선언 스펙은 중복 검사의 사각이다.`);
if (xcatHard) console.error(`\n✗ crossCategoryDedupPolicy=hard: 카테고리 간 동일 키는 구조적 중복이다 — 위 항목 해소 필요.`);
if (fovHard) console.error(`\n✗ filesOverlapPolicy=hard: 한 실파일은 한 스펙만 소유해야 한다 — 위 Files 겹침 해소 필요.`);

if (STRICT && (missing.length || formatIssues.length)) {
  if (missing.length) console.error(`\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.`);
  if (formatIssues.length) console.error(`\n✗ --strict: 형식 위반이 있음 — 수정 필요.`);
  process.exit(1);
}
if (orqHard || xcatHard || fovHard) process.exit(1);

console.log(`✓ 구조적 중복 없음 — 모든 ${CATEGORIES.join("/")} 키가 유일.`);

