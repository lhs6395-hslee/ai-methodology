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
import { loadConfig, resolveFromRoot, isTestFile, DEFAULTS } from "./sdd-config.mjs";
import { loadManifest, classify } from "./verification-accounting.mjs";
import { compileGlob, stripInlineComment } from "./spec-sync-lib.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { INFRA_SOURCE_CLASSES, prefixClassFinding, validateExemptions } from "./prefix-class-lib.mjs";
import { numberingIssues } from "./numbering-lib.mjs";
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
    prefixErrors.push(`미등록 접두어 "${pfx}" (${f}) — 표준 SPEC/INFRA/TEST. 임의 생성 금지, 필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가`);
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
  const { hard, advisory } = numberingIssues([...knownIds]);
  prefixErrors.push(...hard);
  for (const a of advisory) (STRICT ? prefixErrors : prefixClassWarnings).push(a);
}
if (prefixErrors.length) {
  console.error("✗ PREFIX 위반:");
  for (const e of prefixErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// 1. Collect declared FRs per spec.
const specs = new Map(); // SPEC-ID -> Set(FR-ID)
for (const f of readdirSync(SPEC_DIR)) {
  if (!f.endsWith(".md") || !PREFIXES.some((p) => f.startsWith(p + "-"))) continue;
  const id = f.match(SPEC_ID)?.[0];
  if (!id) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const frs = new Set();
  for (const m of text.matchAll(FR_DECL)) frs.add(m[1]);
  specs.set(id, frs);
}

// 2. Collect @covers tags from test files.
const covered = new Map();   // SPEC-ID -> Set(FR-ID covered)
const badRefs = [];          // tags pointing to nonexistent FRs
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(COVERS)) {
      const [, spec, fr] = m;
      if (!covered.has(spec)) covered.set(spec, new Set());
      covered.get(spec).add(fr);
      const declared = specs.get(spec);
      if (!declared || !declared.has(fr)) {
        badRefs.push({ file, spec, fr });
      }
    }
  }
}

// 3. Evaluate rules.
const errors = [];
const warnings = [...prefixClassWarnings]; // 0b의 advisory(미사용 면제·INFRA 검출 0건)

// R1: bad references
for (const { file, spec, fr } of badRefs) {
  errors.push(`R1 dangling @covers ${spec}/${fr} in ${file.replace(ROOT + "/", "")} — no such FR in ${spec}`);
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
const acct = accountingActive ? classify(specs, covered, manifest) : null;

// R2: coverage completeness.
//   - incremental (default): partial coverage WARNS (adopt FR by FR).
//   - strict / strictSpecs 등재: every FR MUST be unit-covered(smoke/deferred 대체 불가), else error.
for (const [spec, frs] of specs) {
  const cov = covered.get(spec) ?? new Set();
  const hard = STRICT || strictSpecs.has(spec);
  const label = STRICT ? "R2(strict)" : "R2(strictSpecs)";
  if (cov.size === 0) {
    const msg = `${spec}: 0/${frs.size} FRs covered (not yet implemented)`;
    if (hard && frs.size > 0) errors.push(`${label} ${msg}`);
    else warnings.push(msg);
    continue;
  }
  const missing = [...frs].filter((fr) => !cov.has(fr));
  if (missing.length) {
    const msg = `${spec}: ${cov.size}/${frs.size} FRs covered — missing ${missing.join(", ")}`;
    if (hard) errors.push(`${label} ${msg}`);
    else warnings.push(msg);
  } else {
    warnings.push(`${spec}: ${cov.size}/${frs.size} FRs covered ✓`);
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
const acctTag = acct ? ` accounted(unit:${acct.counts.unit} smoke:${acct.counts.smoke} deferred:${acct.counts.deferred} unaccounted:${acct.counts.unaccounted})` : "";
console.log(`FR coverage gate — specs:${specs.size} FRs:${totalFR} covered:${totalCov}${acctTag} mode:${STRICT ? "strict" : "incremental"} config:${cfgTag}`);
for (const w of warnings) console.log(`  · ${w}`);
if (errors.length) {
  console.error("\nFR coverage violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("FR coverage gate: OK");
