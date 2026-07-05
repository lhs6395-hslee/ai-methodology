#!/usr/bin/env node
// ─── 재도출 소스 회계 게이트 (SPEC-009) ─────────────────────
// "재생성(reverse-engineer)이 무엇을 읽었는가"를 선언으로 강제한다 — 모든 소스
// 클래스(derivation-lib SOURCE_CLASSES)가 mapped ∨ none ∨ deferred로 회계되어야
// 하고, 검출 가능한 클래스(code·iac·ci·ops-docs·prior-traceability)는 레포 실재와
// 교차검사한다: **파일이 실재하는데 none 선언 = exit 1** (조용한 미인제스트 금지).
// 실측 근거: 두 프로젝트 재생성 비교에서 초기 재도출이 src/ 밖(IaC/CI)을 아예
// 읽지 않아 INFRA FR이 통째로 손실됐다 — 그 실패 모드를 회계로 기계 차단한다.
// 레포 밖 실체(build-evidence·vcs-history·human-intent)는 검출 불가 — 존재 회계만
// 강제하고 evidence/reason의 질은 리뷰 몫(과장 금지).
//
// Usage: node scripts/check-derivation.mjs
//   derivationManifest 미설정(null) → no-op(하위호환).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, isTestFile, DEFAULTS } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { SOURCE_CLASSES, GLOB_DETECTABLE, validateManifest } from "./derivation-lib.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;

if (!cfg.derivationManifest) {
  console.log("Derivation 게이트: derivationManifest 미설정 — no-op");
  process.exit(0);
}

// D0: 매니페스트 로드.
const rel = String(cfg.derivationManifest);
let raw;
try { raw = readFileSync(resolveFromRoot(cfg, rel), "utf8"); }
catch { console.error(`✗ D0 derivationManifest 파일 없음: ${rel}`); process.exit(1); }
let data;
try { data = JSON.parse(raw); }
catch (e) { console.error(`✗ D0 derivationManifest JSON 파싱 실패: ${rel} — ${e.message}`); process.exit(1); }
if (typeof data !== "object" || data === null || Array.isArray(data)) {
  console.error(`✗ D0 derivationManifest 최상위는 객체여야 함: ${rel}`);
  process.exit(1);
}

const errors = validateManifest(data);
const warnings = [];

// 클래스 글롭: DEFAULTS ⊕ 사용자 config(클래스 단위 교체). 미정의 클래스 키는 D1.
const userGlobs = cfg.derivationClassGlobs || {};
for (const key of Object.keys(userGlobs)) {
  if (!GLOB_DETECTABLE.includes(key)) errors.push(`D1 derivationClassGlobs 미정의 클래스 "${key}" — ${GLOB_DETECTABLE.join("|")}만 글롭 검출 대상`);
}
const classGlobs = {};
for (const cls of GLOB_DETECTABLE) {
  classGlobs[cls] = (userGlobs[cls] || DEFAULTS.derivationClassGlobs[cls] || []).map(compileGlob);
}

// 레포 실재 검출 — 루트 1회 순회(ignoreDirs 제외, 정렬 순회로 결정성).
const IGNORE = new Set(cfg.ignoreDirs);
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
const allFiles = walkAll(ROOT);
const detected = {}; // class -> { count, example }
for (const cls of GLOB_DETECTABLE) {
  const hits = allFiles.filter((f) => classGlobs[cls].some((re) => re.test(f)));
  detected[cls] = { count: hits.length, example: hits[0] || null };
}
// code: scanDirs에 파일이 하나라도 실재하는가.
{
  const hits = [];
  for (const d of cfg.scanDirs) {
    for (const f of walkAll(resolveFromRoot(cfg, d), d)) { hits.push(f); if (hits.length) break; }
    if (hits.length) break;
  }
  detected["code"] = { count: hits.length, example: hits[0] || null };
}
// prior-traceability: scanDirs 테스트 파일의 @covers 태그 실재.
{
  let count = 0, example = null;
  for (const d of cfg.scanDirs) {
    for (const f of walkAll(resolveFromRoot(cfg, d), d)) {
      if (!isTestFile(f.split("/").pop(), cfg)) continue;
      const text = readFileSync(join(ROOT, f), "utf8");
      if (new RegExp(cfg.__coversRe.source).test(text)) { count++; if (!example) example = f; }
    }
  }
  detected["prior-traceability"] = { count, example };
}

// D3 교차검사: 검출됐는데 none 선언 = 에러 / mapped 선언인데 검출 0 = 경고(레포 밖 실체 허용).
const counts = { mapped: 0, none: 0, deferred: 0 };
let accounted = 0;
for (const cls of SOURCE_CLASSES) {
  const v = data[cls];
  const status = v && typeof v === "object" && !Array.isArray(v) ? String(v.status ?? "").trim() : "";
  if (!["mapped", "none", "deferred"].includes(status)) continue;
  accounted++;
  counts[status]++;
  const det = detected[cls];
  if (!det) continue; // 검출 불가 클래스 — 존재 회계만
  if (status === "none" && det.count > 0) {
    errors.push(`D3 ${cls}: none 선언인데 검출 ${det.count}건(예: ${det.example}) — 스캔 누락(조용한 미인제스트) 금지`);
  } else if (status === "mapped" && det.count === 0) {
    warnings.push(`${cls}: mapped 선언이나 레포 내 검출 0건 — 레포 밖 실체(evidence로 확인) 또는 정리 대상`);
  }
}

const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
console.log(`Derivation 게이트 — classes:${SOURCE_CLASSES.length} accounted:${accounted} (mapped:${counts.mapped} none:${counts.none} deferred:${counts.deferred}) config:${cfgTag}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
if (errors.length) {
  console.error("\nDerivation violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("Derivation 게이트: OK — 전 소스 클래스 회계됨.");
