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
const STANDARD = new Set(["SPEC", "INFRA", "TEST"]);
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
const warnings = [];

// R1: bad references
for (const { file, spec, fr } of badRefs) {
  errors.push(`R1 dangling @covers ${spec}/${fr} in ${file.replace(ROOT + "/", "")} — no such FR in ${spec}`);
}

// R2: coverage completeness.
//   - incremental (default): partial coverage WARNS (adopt FR by FR).
//   - strict: every FR of every non-empty spec MUST be covered, else error.
for (const [spec, frs] of specs) {
  const cov = covered.get(spec) ?? new Set();
  if (cov.size === 0) {
    const msg = `${spec}: 0/${frs.size} FRs covered (not yet implemented)`;
    if (STRICT && frs.size > 0) errors.push(`R2(strict) ${msg}`);
    else warnings.push(msg);
    continue;
  }
  const missing = [...frs].filter((fr) => !cov.has(fr));
  if (missing.length) {
    const msg = `${spec}: ${cov.size}/${frs.size} FRs covered — missing ${missing.join(", ")}`;
    if (STRICT) errors.push(`R2(strict) ${msg}`);
    else warnings.push(msg);
  } else {
    warnings.push(`${spec}: ${cov.size}/${frs.size} FRs covered ✓`);
  }
}

// 4. Report.
const totalFR = [...specs.values()].reduce((n, s) => n + s.size, 0);
const totalCov = [...covered.values()].reduce((n, s) => n + s.size, 0);
const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
console.log(`FR coverage gate — specs:${specs.size} FRs:${totalFR} covered:${totalCov} mode:${STRICT ? "strict" : "incremental"} config:${cfgTag}`);
for (const w of warnings) console.log(`  · ${w}`);
if (errors.length) {
  console.error("\nFR coverage violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("FR coverage gate: OK");
