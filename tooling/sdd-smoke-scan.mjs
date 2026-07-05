#!/usr/bin/env node
// ─── smoke 증거 자동 수집 (SPEC-010) ────────────────────────
// smokeManifest(SPEC-007)의 비-unit 검증 엔트리를 손으로 잇지 않는다 — 증거가 사는
// 파일(테스트·CI 정의·스크립트·runbook 어디든)에 태그를 두면 이 도구가 수집한다:
//   <주석> @verifies <SPEC-ID>/<FR-ID> <method>: <evidence>
// method=deferred면 evidence 자리가 reason. 주석 스타일 무관(태그 텍스트만 본다).
// 기본 모드 = check: 태그 파생 엔트리와 매니페스트의 드리프트를 검증(exit 1).
// --write     = 매니페스트 결정적 재생성: 태그 파생 엔트리 + 태그 없는 수동 엔트리 보존.
// 원칙: evidence의 질은 기계가 못 본다 — 존재·문법만 강제(질은 리뷰 몫, SPEC-007).
// 레포 밖 실증거(빌드 로그 등)는 레포 안 태그가 가리켜야 수집된다(정직한 경계).
//
// Usage: node scripts/sdd-smoke-scan.mjs [--write]
//   스캔 범위 = smokeScanDirs(미설정이면 scanDirs). 태그도 매니페스트도 없으면 no-op.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const WRITE = process.argv.includes("--write");
const TAG_TOKEN = "@veri" + "fies"; // 자기 소스가 스캔에 걸리지 않게 분절

// 1. spec별 선언 FR 수집(키 검증용 — fr 게이트와 동일 문법 파생, SPEC-006).
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const specs = new Map(); // SPEC-ID -> Set(FR-ID)
let specNames = [];
try { specNames = readdirSync(SPEC_DIR).sort(); } catch { /* spec 없음 — 태그가 있으면 dangling */ }
for (const f of specNames) {
  if (!f.endsWith(".md")) continue;
  const id = f.match(cfg.__specIdRe)?.[0];
  if (!id) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const frs = new Set();
  for (const m of text.matchAll(cfg.__frDeclRe)) frs.add(m[1]);
  specs.set(id, frs);
}

// 2. 태그 수집 — smokeScanDirs(기본 scanDirs)의 전 파일(테스트 한정 아님).
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
const scanDirs = cfg.smokeScanDirs || cfg.scanDirs;
const manifestRel = cfg.smokeManifest ? String(cfg.smokeManifest) : null;
// 유효 키가 따라오는 태그만 캡처(산문 언급은 무시 — @covers와 동일 관례).
// 키 뒤 형식(메서드·콜론·본문)이 어긋나면 조용히 버리지 않고 V0 에러.
const tagRe = new RegExp(`${TAG_TOKEN}\\s+((?:${cfg.__idAlt})-\\d{3})\\/((?:${cfg.__reqAlt})-\\d{3}[a-z]?)\\b([^\\n]*)`, "g");
const restRe = /^\s+([A-Za-z0-9_-]+)\s*:\s*(\S.*)$/;

const errors = [];
const byKey = new Map(); // "SPEC/FR" -> Map(method -> [{path, text}])
let tagCount = 0;
for (const d of [...new Set(scanDirs)]) {
  for (const f of walkAll(resolveFromRoot(cfg, d), d)) {
    if (manifestRel && f === manifestRel) continue; // 매니페스트 자신은 소스 아님
    let text;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const m of text.matchAll(tagRe)) {
      tagCount++;
      const [, spec, fr, rest] = m;
      const key = `${spec}/${fr}`;
      if (!specs.has(spec) || !specs.get(spec).has(fr)) {
        errors.push(`V1 dangling ${TAG_TOKEN} ${key} in ${f} — no such FR in ${spec}`);
        continue;
      }
      const r = rest.match(restRe);
      if (!r) {
        errors.push(`V0 태그 형식 위반 in ${f} — "${TAG_TOKEN} ${key} <method>: <evidence>" 형식이어야 함(빈 값 불가)`);
        continue;
      }
      const [, method, body] = r;
      if (!byKey.has(key)) byKey.set(key, new Map());
      const methods = byKey.get(key);
      if (!methods.has(method)) methods.set(method, []);
      methods.get(method).push({ path: f, text: body.trim() });
    }
  }
}

// 3. 태그 → 엔트리 (결정적: 경로·본문 정렬 후 " · " 결합, 파일 경로가 provenance).
const tagEntries = new Map(); // key -> entry
for (const [key, methods] of [...byKey].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  if (methods.size > 1) {
    errors.push(`V3 "${key}": method 충돌(${[...methods.keys()].sort().join(" vs ")}) — 한 FR의 태그 method는 하나여야 함`);
    continue;
  }
  const [method, sites] = [...methods][0];
  const joined = sites
    .map(({ path, text }) => `${path} — ${text}`)
    .sort()
    .join(" · ");
  tagEntries.set(key, method === "deferred" ? { method, reason: joined } : { method, evidence: joined });
}

// 4. 매니페스트 대조/재생성.
const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
if (!manifestRel) {
  if (tagCount > 0) {
    console.error(`✗ ${TAG_TOKEN} 태그 ${tagCount}건 발견인데 smokeManifest 미설정 — sdd.config.json에 매니페스트 경로 선언 필요`);
    process.exit(1);
  }
  console.log(`Smoke-scan — tags:0 keys:0 manifest:미설정 mode:${WRITE ? "write" : "check"} config:${cfgTag}`);
  console.log("Smoke-scan: no-op — 태그도 매니페스트도 없음.");
  process.exit(0);
}
let manifest = {};
let manifestMissing = false;
try {
  const rawM = readFileSync(resolveFromRoot(cfg, manifestRel), "utf8");
  try { manifest = JSON.parse(rawM); }
  catch (e) { console.error(`✗ M0 smokeManifest JSON 파싱 실패: ${manifestRel} — ${e.message}`); process.exit(1); }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    console.error(`✗ M0 smokeManifest 최상위는 객체여야 함: ${manifestRel}`);
    process.exit(1);
  }
} catch { manifestMissing = true; }
if (manifestMissing && !WRITE) {
  if (tagEntries.size > 0) errors.push(`S1 매니페스트 파일 없음(${manifestRel})인데 태그 파생 엔트리 ${tagEntries.size}건 — --write로 생성`);
  manifest = {};
}

console.log(`Smoke-scan — tags:${tagCount} keys:${tagEntries.size} manifest:${manifestMissing ? 0 : Object.keys(manifest).length} mode:${WRITE ? "write" : "check"} config:${cfgTag}`);

if (errors.length) {
  console.error("\nSmoke-scan violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (WRITE) {
  // 결정적 재생성: 태그 파생 엔트리 + 태그 없는 키의 기존(수동) 엔트리 보존. 키 정렬.
  const next = {};
  let added = 0, updated = 0, kept = 0;
  const keys = [...new Set([...Object.keys(manifest), ...tagEntries.keys()])].sort();
  for (const key of keys) {
    if (tagEntries.has(key)) {
      const entry = tagEntries.get(key);
      if (!(key in manifest)) added++;
      else if (!same(manifest[key], entry)) updated++;
      else kept++;
      next[key] = entry;
    } else { next[key] = manifest[key]; kept++; }
  }
  writeFileSync(resolveFromRoot(cfg, manifestRel), JSON.stringify(next, null, 2) + "\n");
  console.log(`Smoke-scan: ${manifestRel} 재생성 — added:${added} updated:${updated} kept:${kept}`);
  process.exit(0);
}

// check: 태그 파생 엔트리가 매니페스트에 그대로 있어야 한다(수동 엔트리는 자유).
const drift = [];
for (const [key, entry] of tagEntries) {
  if (!(key in manifest)) drift.push(`S1 "${key}": manifest에 없음(태그 파생 엔트리 누락) — --write로 재생성`);
  else if (!same(manifest[key], entry)) drift.push(`S1 "${key}": 값 불일치(태그 ↔ manifest) — --write로 재생성`);
}
if (drift.length) {
  console.error("\nSmoke-scan violations:");
  for (const e of drift) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`Smoke-scan: OK — 태그 파생 엔트리 ${tagEntries.size}건이 매니페스트와 일치(수동 엔트리 ${Object.keys(manifest).length - tagEntries.size}건 보존).`);
