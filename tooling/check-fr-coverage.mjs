#!/usr/bin/env node
// ─── FR ↔ test traceability gate ──────────────────────────
// Closes the seam SSOT.md §4 identifies: Superpowers locks code↔test, but
// FR↔test is otherwise manual. This script enforces it mechanically.
//
// It scans (paths/patterns come from sdd.config.json — language/stack-agnostic):
//   - <specDir>/<PREFIX>-*.md       → declared FR-IDs per spec
//   - <scanDirs>/** test files      → `<comment> @covers <SPEC-ID>/FR-NNN` tags
//     (comment style — // or # or -- — is irrelevant; only the tag text matters)
//   <PREFIX> defaults to SPEC; extend via specIdPrefixes in sdd.config.json
//   (e.g. ["SPEC","TEST","INFRA"]) so non-app specs are first-class without a fork.
//
// Rules (exit non-zero on violation):
//   R1. Every @covers tag must reference a FR that actually exists in that spec.
//   R2. Implemented specs (those with ≥1 covering test) must have EVERY FR covered.
//       Specs with ZERO covering tests are treated as "not yet implemented" and
//       only warn (so we can adopt the gate incrementally, spec by spec).
//
// Language/stack is config-driven: testFileRegex/scanDirs/ignoreDirs/specDir in
// sdd.config.json. No config → JS/TS defaults (backward compatible).
//
// Usage: node scripts/check-fr-coverage.mjs [--strict]
//   --strict : also fail when a spec has zero covering tests (full enforcement)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot, isTestFile, DEFAULTS, isE2eFile} from "./sdd-config.mjs";
import { loadManifest, classify } from "./verification-accounting.mjs";
import { parseStatus } from "./lifecycle-lib.mjs";
import { compileGlob, stripInlineComment } from "./spec-sync-lib.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { INFRA_SOURCE_CLASSES, prefixClassFinding, validateExemptions } from "./prefix-class-lib.mjs";
import { numberingIssues, frNumberingIssues } from "./numbering-lib.mjs";
import { changeLogFrRefs, changeLogFrFindings } from "./changelog-fr-lib.mjs";
import { evidencePathsOf, coversBacklinkFindings, coversBacklinkVerdict } from "./covers-backlink-lib.mjs";
import { frDeclarations } from "./grammar-lib.mjs";
import { testInfraFinding } from "./test-domain-lib.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const SCAN_DIRS = cfg.scanDirs.map((d) => resolveFromRoot(cfg, d));
const IGNORE = new Set(cfg.ignoreDirs);
const STRICT = process.argv.includes("--strict");

const FR_DECL = cfg.__frDeclRe;          // **FR-006**, **FR-003a** in spec prose — 문법은 requirementIdPrefixes에서 파생(사이트 간 통일)
const SPEC_ID = cfg.__specIdRe;          // e.g. /(?:SPEC|TEST|INFRA)-\d{3}/ (from specIdPrefixes)
const COVERS = cfg.__coversRe;           // @covers <PREFIX>-NNN/FR-NNN (from specIdPrefixes)
const PREFIXES = cfg.specIdPrefixes && cfg.specIdPrefixes.length ? cfg.specIdPrefixes : DEFAULTS.specIdPrefixes;

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (IGNORE.has(name)) continue;
      walk(p, acc);
    } else if (isTestFile(name, cfg)) {
      acc.push(p);
    }
  }
  return acc;
}

// 0. PREFIX whitelist pre-check — must run before spec collection.
//    Scans ALL ^[A-Z]+-NNN.md files; unregistered prefix → exit 1 (no silent skip).
//    Non-standard prefix without rationale → exit 1.
const STANDARD = new Set(["SPEC", "INFRA", "TEST", "CICD"]);
const allowed = new Set(cfg.specIdPrefixes && cfg.specIdPrefixes.length ? cfg.specIdPrefixes : DEFAULTS.specIdPrefixes);
const rationale = cfg.prefixRationale || {};
const prefixErrors = [];

for (const f of readdirSync(SPEC_DIR)) {
  const m = f.match(/^([A-Z]+)-\d{3}/);
  if (!f.endsWith(".md") || !m) continue;
  const pfx = m[1];
  if (!allowed.has(pfx)) {
    prefixErrors.push(`미등록 접두어 "${pfx}" (${f}) — 표준 SPEC/INFRA/TEST/CICD. 임의 생성 금지, 필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가`);
  } else if (!STANDARD.has(pfx) && !(rationale[pfx] && String(rationale[pfx]).trim())) {
    prefixErrors.push(`표준 밖 접두어 "${pfx}" — prefixRationale["${pfx}"]에 도입 사유 필요(빈 값 불가)`);
  }
}
// 0b. 접두어↔클래스 정합(SPEC-012): 소유(Files) 비-테스트 실파일이 **전적으로** iac/ci
//     클래스인 스펙은 INFRA- 접두어여야 한다 — STORAGE §2.2의 접두어 의미(readopt 착지
//     규칙 iac/ci→INFRA)를 기계 강제. 비-인프라 소유 파일이 하나라도 있으면 통과(전체성
//     임계 — 기능 SPEC-의 부수 IaC/CI 소유는 정당). 면제는 prefixClassExemptions(사유 필수).
const exemptions = cfg.prefixClassExemptions || {};
const specMdNames = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".md") && /^[A-Z]+-\d{3}/.test(f)).sort();
const knownIds = new Set(specMdNames.map((f) => f.match(SPEC_ID)?.[0]).filter(Boolean));
prefixErrors.push(...validateExemptions(exemptions, knownIds));
const classGlobs = {};
{
  const userGlobs = cfg.derivationClassGlobs || {};
  for (const cls of INFRA_SOURCE_CLASSES) classGlobs[cls] = (userGlobs[cls] || DEFAULTS.derivationClassGlobs[cls] || []).map(compileGlob);
}
// 레포 실재 순회 — ignoreDirs 제외·정렬(check-derivation과 동형, 결정성).
function walkAll(dir, relBase = "", acc = []) {
  let entries;
  try { entries = readdirSync(dir).sort(); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    const r = relBase ? `${relBase}/${name}` : name;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (IGNORE.has(name)) continue;
      walkAll(p, r, acc);
    } else acc.push(r);
  }
  return acc;
}
const allRepoFiles = walkAll(ROOT);
const testInfraGlobs = (cfg.testInfraGlobs || []).map(compileGlob); // SPEC-015: 테스트 인프라 네임스페이스
const prefixClassWarnings = [];
for (const f of specMdNames) {
  const id = f.match(SPEC_ID)?.[0];
  if (!id) continue; // 미등록 접두어는 위 0단계가 이미 에러 처리
  const pfx = f.match(/^([A-Z]+)-/)[1];
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const globs = parseSection(text, "Ownership", ["Files"]).Files.map(stripInlineComment).filter(Boolean).map(compileGlob);
  const owned = globs.length
    ? allRepoFiles.filter((p) => !isTestFile(p.split("/").pop(), cfg) && globs.some((re) => re.test(p))).sort()
    : [];
  const finding = prefixClassFinding(pfx, owned, classGlobs);
  const exempted = !!String(exemptions[id] ?? "").trim();
  if (finding && finding.kind === "error") {
    if (!exempted) prefixErrors.push(`접두어↔클래스 부정합 "${id}" — 소유 실파일 ${finding.infra.length}건 전부 인프라-계열(예: ${finding.infra[0]}) → ${finding.expected.join("/")}- 접두어여야 함(STORAGE §2.2: iac→INFRA·ci→CICD). 부수 소유가 정당하면 prefixClassExemptions["${id}"]에 사유 등록`);
    continue;
  }
  if (exempted) prefixClassWarnings.push(`prefixClassExemptions["${id}"]: 현재 접두어↔클래스 위반 아님 — 선등록이 아니면 정리 대상`);
  if (finding && finding.kind === "warn") prefixClassWarnings.push(`${id}: ${finding.prefix}- 접두어인데 소유 Files의 해당 클래스(${finding.prefix === "INFRA" ? "iac" : "ci"}) 검출 0건 — 레포 밖 실체(evidence로 확인) 또는 접두어 재검토`);
  // 테스트 인프라 격리(SPEC-015): testInfraGlobs 매치 파일은 TEST 스펙만 소유.
  const tiFinding = testInfraFinding(pfx, owned, testInfraGlobs);
  if (tiFinding) prefixErrors.push(`테스트 인프라 격리 위반 "${id}" — testInfraGlobs 매치 파일(예: ${tiFinding.files[0]})은 TEST 스펙이 소유해야 함(제품 스펙 소유 금지, SPEC-015)`);
}
// 0c. 접두어별 spec-ID 번호 무결성(SPEC-014): 중복·001미시작 hard, 내부 gap advisory(--strict 승격).
{
  const { hard, advisory } = numberingIssues([...knownIds], cfg.retiredIds);
  prefixErrors.push(...hard);
  for (const a of advisory) (STRICT ? prefixErrors : prefixClassWarnings).push(a);
}
if (prefixErrors.length) {
  console.error("✗ PREFIX 위반:");
  for (const e of prefixErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// 1. Collect declared FRs per spec.
//    "선언"의 범위는 SPEC-013 frDeclarations 단일 정의 — `## Functional Requirements` 섹션 안의
//    라인 시작(불릿 유무 무관). 문서 전문 스캔은 Change Log의 이관·흡수 이력(`FR-011→**FR-037**`)을
//    선언으로 집계해 거짓 "FR 번호 중복" hard를 냈다(PM tool 실측 12건). 문법(cfg.__frDeclRe)은
//    SPEC-001 FR-009 공유 자산이라 손대지 않는다 — 좁힌 것은 범위뿐.
const specs = new Map();    // SPEC-ID -> Set(FR-ID)
const frDecls = new Map();
const clRefs = new Map();  // SPEC-ID -> {declared:Map, retired:Set} (SPEC-037)
const frEvidence = new Map(); // "SPEC/FR" -> [검증 경로…] (SPEC-039 대조 축)
const coverTags = [];         // {file, specId, frId} — 양방향 결속 판정 입력  // SPEC-ID -> [FR-ID,...] 선언 순서 그대로(중복 판정용 — Set은 중복을 삼킨다)
for (const f of readdirSync(SPEC_DIR)) {
  if (!f.endsWith(".md") || !PREFIXES.some((p) => f.startsWith(p + "-"))) continue;
  const id = f.match(SPEC_ID)?.[0];
  if (!id) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const list = frDeclarations(text, FR_DECL, cfg.__reqAlt);
  frDecls.set(id, list);
  specs.set(id, new Set(list));
  // FR 선언 라인별 `[검증: 경로]` — @covers 양방향 결속의 대조 축(SPEC-039). 새 문법 없음.
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|")) continue;                 // 표 행(Change Log)은 이력이지 선언이 아니다
    cfg.__frDeclRe.lastIndex = 0;
    const fr = cfg.__frDeclRe.exec(t);
    cfg.__frDeclRe.lastIndex = 0;
    if (!fr) continue;
    const paths = evidencePathsOf(t);
    if (paths.length) frEvidence.set(`${id}/${fr[1]}`, paths);
  }
  // Change Log가 **선언한** FR 집합(SPEC-037) — 새 검사와 결번 advisory가 같은 소스를 쓴다.
  clRefs.set(id, changeLogFrRefs(text, cfg.__reqAlt, cfg.__idAlt, {
    neu: cfg.changeLogNewVerbs, rev: cfg.changeLogReviseVerbs, ret: cfg.changeLogRetireVerbs,
  }));
}

// 1b. FR 번호 무결성(SPEC-014 FR-005/006): 스펙별 001 연번 — 중복 hard, 001미시작·결번 advisory.
//     FR 선언 파싱은 cfg.__frDeclRe 단일 문법(SPEC-001 FR-009)을 그대로 소비한다(자체 정규식 없음).
const frNumHard = [], frNumAdvisory = [];
const clFindings = [];
const CL_POLICY = String(cfg.changeLogFrRefPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(CL_POLICY)) {
  console.error(`✗ changeLogFrRefPolicy 값 위반 "${CL_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
for (const id of [...frDecls.keys()].sort()) {
  const refs = clRefs.get(id) || { declared: new Map(), retired: new Set() };
  // 결번 advisory는 선언 집합을 참조해 문구가 갈린다(SPEC-037 FR-003) — 폐기 흔적(정당)과
  // "선언했는데 본문 없음"(결함)이 같은 문장으로 나오던 것을 끊는다. 판정 소스는 하나다.
  const { hard, advisory } = frNumberingIssues(id, frDecls.get(id),
    CL_POLICY === "off" ? new Set() : new Set(refs.declared.keys()));
  frNumHard.push(...hard);
  frNumAdvisory.push(...advisory);
  if (CL_POLICY !== "off") clFindings.push(...changeLogFrFindings(id, refs.declared, frDecls.get(id)));
}

// 2. Collect @covers tags from test files.
const covered = new Map();   // SPEC-ID -> Set(FR-ID covered)
const coverSeen = new Set();       // "SPEC/FR" — 커버 태그가 하나라도 있는 FR
const runnableCovered = new Set(); // "SPEC/FR" — e2e가 **아닌** 파일이 커버한 FR
const badRefs = [];          // tags pointing to nonexistent FRs
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(COVERS)) {
      const [, spec, fr] = m;
      if (!covered.has(spec)) covered.set(spec, new Set());
      covered.get(spec).add(fr);
      // e2e-only 판정용: FR별로 "e2e가 아닌 커버 파일"이 하나라도 있었는지 기록.
      const key = `${spec}/${fr}`;
      coverSeen.add(key);
      coverTags.push({ file: file.replace(ROOT + "/", ""), specId: spec, frId: fr });
      if (!isE2eFile(file, cfg)) runnableCovered.add(key);
      const declared = specs.get(spec);
      if (!declared || !declared.has(fr)) {
        badRefs.push({ file, spec, fr });
      }
    }
  }
}

// 커밋 스테이징 집합(있으면) — 위반의 **귀속**을 가르는 데만 쓴다. 판정 집합은 워킹트리 전역이다.
// null = 알 수 없음(커밋 밖 실행·git 없음·CI) → 종전대로 전부 hard.
let commitScope = null;
try {
  const out = execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const staged = out.split("\n").map((x) => x.trim()).filter(Boolean);
  if (staged.length) commitScope = new Set(staged);
} catch { /* git 없음·저장소 아님 — 귀속 판정 불가 */ }

// 3. Evaluate rules.
const errors = [];
const warnings = [...prefixClassWarnings]; // 0b의 advisory(미사용 면제·INFRA 검출 0건)

// FR 번호 무결성(1b) 배선 — 중복은 정책 knob 없이 항상 hard, advisory는 `--strict`에서만 승격.
errors.push(...frNumHard);
for (const a of frNumAdvisory) (STRICT ? errors : warnings).push(a);
// Change Log ↔ FR 실재(SPEC-037): 선언만 하고 본문을 안 쓴 것. 처방을 함께 낸다 —
// 계약을 FR로 착지시키거나, 진짜 폐기라면 폐기로 표기해 정당한 흔적으로 만든다.
for (const f of clFindings) {
  const msg = `[${f.specId}] Change Log가 ${f.id} ${f.verb}를 선언했으나 FR 절에 본문 없음 — 계약을 FR로 착지시키거나, 폐기라면 "${f.id} 폐기"로 표기하라(changeLogFrRefPolicy=${CL_POLICY})`;
  (CL_POLICY === "hard" || STRICT ? errors : warnings).push(msg);
}

// R1: bad references
for (const { file, spec, fr } of badRefs) {
  // 귀속 분리(제보 곁가지 판정): 판정 집합은 **워킹트리 전역**을 유지한다 — 범위를 staged로 좁히면
  // 커밋 밖 파일의 dangling 태그가 영구히 안 보이고, 그 손실을 선택지로 내미는 것은 완화를 권장으로
  // 올리는 것과 같다(HARNESS 불변). 대신 **강도를 귀속으로 가른다**: 이 커밋이 건드리지 않은 파일의
  // 위반은 advisory로 낮춘다. 실측 제보: 커밋과 무관한 untracked 파일이 커밋을 막아 "파일을 잠시
  // 옮겨 커밋"이라는 우회를 유발했다 — 우회를 유발하는 강제는 강제가 아니다.
  // 스테이징 집합을 알 수 없으면(커밋 밖 실행·git 없음·CI) 종전대로 hard다 — CI는 전부 막는다.
  const relFile = file.replace(ROOT + "/", "");
  const msg = `R1 dangling @covers ${spec}/${fr} in ${relFile} — no such FR in ${spec}`;
  if (commitScope && !commitScope.has(relFile)) {
    warnings.push(`${msg} · **이 커밋 범위 밖**이라 차단하지 않는다(남아 있다 — 그 파일을 커밋할 때 막힌다)`);
  } else {
    errors.push(msg);
  }
}

// R1b: `@covers` 양방향 결속(SPEC-039) — 태그가 가리키는 FR과 FR이 인정하는 증거가 서로를 아는가.
// R1(dangling)은 **실재**만 본다: 번호가 겹치기만 하면 통과한다(실측 제보: 다른 세션이 무관한 기능을
// 같은 번호로 착지시킨 순간 위반이 사라지고 초록이 됐다). 실재는 동일성이 아니다.
const BL_POLICY = String(cfg.coversBacklinkPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(BL_POLICY)) {
  console.error(`✗ coversBacklinkPolicy 값 위반 "${BL_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (BL_POLICY !== "off") {
  const declaredKeys = new Set();
  for (const [sid, frs] of specs) for (const f of frs) declaredKeys.add(`${sid}/${f}`);
  const bl = coversBacklinkFindings(coverTags, frEvidence, declaredKeys,
    (pattern, path) => { try { return compileGlob(pattern).test(path); } catch { return false; } });
  const v = coversBacklinkVerdict(BL_POLICY, bl.counts);
  const cap = Number(cfg.coversBacklinkListCap) || 12;
  // 헤더는 **버킷 합과 맞아야 한다** — 태그 총량만 적으면 (파일,FR) 중복분이 사라진 것처럼 읽히고,
  // 그 외형이 곧 "조용한 누락"이다. 유일 건수와 총량을 함께 적어 차이를 설명한다.
  const uniq = bl.counts.matched + bl.counts.mismatch + bl.counts.unlabeled;
  const dedup = coverTags.length - uniq;
  console.log(`@covers 결속(coversBacklinkPolicy=${BL_POLICY}): 태그 ${coverTags.length}건 → 판정 ${uniq}건`
    + (dedup > 0 ? `(같은 파일이 같은 FR을 재태깅한 ${dedup}건은 1건으로 셈)` : "")
    + ` — 일치 ${bl.counts.matched}·불일치 ${bl.counts.mismatch}·미표기 ${bl.counts.unlabeled}`);
  const mism = bl.findings.filter((f) => f.kind === "mismatch");
  for (const f of mism.slice(0, cap)) {
    const msg = `[${f.specId}/${f.frId}] ${f.file} — FR의 검증 목록(${f.evidence.join(", ")})이 이 파일을 인정하지 않는다: **번호 충돌 의심**(태그와 FR이 서로 다른 것을 말하고 있다)`;
    (v.blocking ? errors : warnings).push(msg);
  }
  if (mism.length > cap) (v.blocking ? errors : warnings).push(`@covers 결속 불일치 … 외 ${mism.length - cap}건 (coversBacklinkListCap 상향으로 확인)`);
  // 미표기는 **위반이 아니다** — 표기 부채라 어떤 강도에서도 차단하지 않는다.
  // 섞으면 도입 첫날 수백 건이 쏟아져 본 신호(불일치)가 묻히고, 그러면 사람이 정책을 끈다.
  if (bl.counts.unlabeled) {
    console.log(`  · backlink 미표기 ${bl.counts.unlabeled}건(부채·비차단) — 해당 FR에 \`[검증: <경로>]\`가 없어 대조할 축이 없다. 표기하면 그 FR은 이 검사의 보호를 받는다.`);
  }
  if (!mism.length) console.log("  ✓ 결속 불일치 0건 — 태그와 FR이 서로를 인정한다(미표기는 위 별도 집계).");
}

// 3b. 검증 회계(SPEC-007): smokeManifest 로드·검증 + strictSpecs 검증.
//     manifest 미설정 && requireAccounting=false && strictSpecs=[] → 현행 동작(출력 동일).
const { entries: manifest, errors: manifestErrors } = loadManifest(cfg, specs);
errors.push(...manifestErrors);
const strictSpecs = new Set(cfg.strictSpecs || []);
for (const id of [...strictSpecs].sort()) {
  if (!specs.has(id)) errors.push(`strictSpecs에 존재하지 않는 spec "${id}" — 오타/삭제 확인(조용한 스킵 금지)`);
}
const accountingActive = manifest !== null || !!cfg.requireAccounting;
// SPEC-018 FR-005: Status: Planned 스펙 — 미커버 FR을 planned로 회계(R3 미검증 아님).
const plannedSpecs = new Set();
for (const f of specMdNames) {
  const id = f.match(SPEC_ID)?.[0]; if (!id) continue;
  if (parseStatus(readFileSync(join(SPEC_DIR, f), "utf8")) === "Planned") plannedSpecs.add(id);
}
const e2eOnly = new Set([...coverSeen].filter((k) => !runnableCovered.has(k)));
const acct = accountingActive ? classify(specs, covered, manifest, plannedSpecs, e2eOnly) : null;
// Planned↔커버리지 모순(SPEC-018 FR-007): Planned는 "안 지음" 선언인데 unit 커버 FR이 실재하면 모순 —
// Active→Planned 뒤집기로 strictSpecs·R3를 침묵시키는 "회계 침묵기" 경로를 hard 차단(감사 T2).
for (const spec of [...plannedSpecs].sort()) {
  const cov = covered.get(spec);
  if (cov && cov.size > 0) {
    errors.push(`Planned 모순 ${spec}: Status Planned인데 unit 커버 FR ${cov.size}개 — 구현이면 Status 승격, 폐기면 sdd-retire(Planned=의도적 미구현 선언, SPEC-018)`);
  }
}

// R2: coverage completeness.
//   - incremental (default): partial coverage WARNS (adopt FR by FR).
//   - strict / strictSpecs 등재: every FR MUST be unit-covered(smoke/deferred 대체 불가), else error.
for (const [spec, frs] of specs) {
  const cov = covered.get(spec) ?? new Set();
  const hard = STRICT || strictSpecs.has(spec);
  const label = STRICT ? "R2(strict)" : "R2(strictSpecs)";
  if (cov.size === 0) {
    const planned = plannedSpecs.has(spec);
    const msg = `${spec}: 0/${frs.size} FRs covered (${planned ? "planned — 의도적 미구현" : "not yet implemented"})`;
    if (hard && frs.size > 0 && !planned) errors.push(`${label} ${msg}`);
    else warnings.push(msg);
    continue;
  }
  // 정렬 필수(Python판 sdd_gates.py는 sorted — SPEC-006 패리티). 선언 순서로 두면 FR을 번호 순이
  // 아니게 선언한 스펙에서 양판 출력이 갈린다(소비 프로젝트 PM SPEC-004·SPEC-010 실측).
  const missing = [...frs].filter((fr) => !cov.has(fr)).sort();
  if (missing.length) {
    const msg = `${spec}: ${cov.size}/${frs.size} FRs covered — missing ${missing.join(", ")}`;
    if (hard) errors.push(`${label} ${msg}`);
    else warnings.push(msg);
  } else {
    warnings.push(`${spec}: ${cov.size}/${frs.size} FRs covered ✓`);
  }
}

// e2e-only 표면화: 태그는 있지만 로컬 스위트가 실행하지 않는 FR. e2e 실행 축(SPEC-021 확장,
// `e2eTestsPolicy`)이 꺼져 있으면 **아무도 이 FR들을 실행 검증하지 않는다** — 그 사실을 매 실행
// 드러낸다(감춰지면 "covered ✓"가 실행 green으로 오인된다).
if (acct && acct.counts.e2e > 0) {
  const axis = String(cfg.e2eTestsPolicy || "off");
  const list = [...acct.classes].filter(([, c]) => c === "e2e").map(([k]) => k).sort();
  if (axis === "off") {
    warnings.push(`⚠ e2e-only ${acct.counts.e2e}건 — e2e로만 커버돼 실행 검증하는 게이트가 없다(e2eTestsPolicy:off). commands.e2e 선언 후 정책을 켜거나, 실행 불가면 evidence로 회계하라: ${list.slice(0, 8).join(", ")}${list.length > 8 ? ` 외 ${list.length - 8}건` : ""}`);
  } else {
    warnings.push(`· e2e-only ${acct.counts.e2e}건 — e2e 실행 축(e2eTestsPolicy:${axis})이 판정한다`);
  }
}

// R3(requireAccounting): 모든 FR이 unit ∨ smoke ∨ deferred — "조용히 미검증" 제거.
if (cfg.requireAccounting) {
  for (const [spec, frs] of specs) {
    for (const fr of [...frs].sort()) {
      if (acct.classes.get(`${spec}/${fr}`) === "unaccounted") {
        errors.push(`R3 unaccounted ${spec}/${fr} — unit·smoke·deferred 어느 것도 아님(requireAccounting)`);
      }
    }
  }
}

// 4. Report.
const totalFR = [...specs.values()].reduce((n, s) => n + s.size, 0);
const totalCov = [...covered.values()].reduce((n, s) => n + s.size, 0);
const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
const acctTag = acct ? ` accounted(unit:${acct.counts.unit} e2e:${acct.counts.e2e} smoke:${acct.counts.smoke} deferred:${acct.counts.deferred} planned:${acct.counts.planned} unaccounted:${acct.counts.unaccounted})` : "";
console.log(`FR coverage gate — specs:${specs.size} FRs:${totalFR} covered:${totalCov}${acctTag} mode:${STRICT ? "strict" : "incremental"} config:${cfgTag}`);
for (const w of warnings) console.log(`  · ${w}`);
if (errors.length) {
  console.error("\nFR coverage violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("FR coverage gate: OK");
