#!/usr/bin/env node
// ─── 추적 태그 마이그레이션 (SPEC-011) ──────────────────────
// 재도출(재생성)이 FR 키를 재번호하면 기존 @covers/@verifies 태그의 재연결 비용이
// 남는다 — 그 비용을 결정적 치환으로 제거한다. 기본 원칙은 **키 보존**(기존 태그가
// 참조하는 키를 새 스펙이 그대로 쓴다)이고, 재번호가 불가피할 때만 마이그레이션 맵을
// 이 도구에 넣는다:  { "OLD-SPEC/OLD-FR": "NEW-SPEC/NEW-FR" | null }
//   value=null = FR 폐기 선언 — 태그는 기계 삭제하지 않고(주변 코드 파손 위험)
//   "수동 제거 대상"으로 보고만 한다(잔존 태그는 fr 게이트 R1이 그물).
// 기본 = dry-run(계획 출력). --write = 파일·smokeManifest 키에 실제 적용.
// 검증 실패 시 아무것도 쓰지 않는다(all-or-nothing).
//
// Usage: node scripts/sdd-retag.mjs <map.json> [--write]

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const MAP_PATH = args.filter((a) => !a.startsWith("--"))[0];
if (!MAP_PATH) { console.error("usage: sdd-retag <map.json> [--write]"); process.exit(2); }
const COVERS_TOKEN = "@cov" + "ers";   // 자기 소스가 fr 게이트 스캔에 걸리지 않게 분절
const VERIFIES_TOKEN = "@veri" + "fies";

// 1. 맵 로드·검증(T1 문법 · T2 대상 실재).
let map;
try { map = JSON.parse(readFileSync(MAP_PATH, "utf8")); }
catch (e) { console.error(`✗ T0 맵 로드 실패: ${MAP_PATH} — ${e.message}`); process.exit(1); }
if (typeof map !== "object" || map === null || Array.isArray(map)) {
  console.error(`✗ T0 맵 최상위는 객체여야 함: ${MAP_PATH}`);
  process.exit(1);
}
const keyRe = new RegExp(`^((?:${cfg.__idAlt})-\\d{3})\\/((?:${cfg.__reqAlt})-\\d{3}[a-z]?)$`);
const errors = [];
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const specs = new Map(); // SPEC-ID -> Set(FR-ID) — 대상(new) 실재 검증용
let specNames = [];
try { specNames = readdirSync(SPEC_DIR).sort(); } catch { /* spec 없음 */ }
for (const f of specNames) {
  if (!f.endsWith(".md")) continue;
  const id = f.match(cfg.__specIdRe)?.[0];
  if (!id) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const frs = new Set();
  for (const m of text.matchAll(cfg.__frDeclRe)) frs.add(m[1]);
  specs.set(id, frs);
}
for (const [oldKey, newKey] of Object.entries(map)) {
  if (!keyRe.test(oldKey)) errors.push(`T1 맵 키 형식 위반 "${oldKey}" — "SPEC-NNN/FR-NNN" 형식이어야 함`);
  if (newKey === null) continue; // 폐기 선언 — 수동 제거 대상으로 보고
  if (typeof newKey !== "string" || !keyRe.test(newKey)) {
    errors.push(`T1 맵 값 형식 위반 "${oldKey}" → ${JSON.stringify(newKey)} — "SPEC-NNN/FR-NNN" 또는 null(폐기)`);
    continue;
  }
  const m = newKey.match(keyRe);
  if (!specs.has(m[1]) || !specs.get(m[1]).has(m[2])) {
    errors.push(`T2 dangling 대상 "${oldKey}" → "${newKey}" — no such FR(현재 spec에 실재해야 함)`);
  }
}

const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
if (errors.length) {
  console.log(`Retag — map:${Object.keys(map).length}키 mode:${WRITE ? "write" : "dry-run"} config:${cfgTag}`);
  console.error("\nRetag violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// 2. 스캔·치환 계획 — scanDirs ∪ smokeScanDirs의 전 파일, 태그 위치만(경계 강제:
//    OLD 키 뒤 [a-z0-9]면 다른 키(FR-001 vs FR-001a) — 치환 금지).
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
const esc = (s) => s.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
const dirs = [...new Set([...cfg.scanDirs, ...(cfg.smokeScanDirs || [])])];
const manifestRel = cfg.smokeManifest ? String(cfg.smokeManifest) : null;
const plans = [];   // {path, line, tag, oldKey, newKey}
const removals = []; // {path, line, tag, oldKey}
const seen = new Map(); // oldKey -> occurrence count
for (const k of Object.keys(map)) seen.set(k, 0);
const files = [];
for (const d of dirs) for (const f of walkAll(resolveFromRoot(cfg, d), d)) files.push(f);
for (const f of [...new Set(files)].sort()) {
  if (manifestRel && f === manifestRel) continue; // 매니페스트 키는 아래에서 별도 처리
  let text;
  try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const tag of [COVERS_TOKEN, VERIFIES_TOKEN]) {
      for (const [oldKey, newKey] of Object.entries(map)) {
        const re = new RegExp(`${esc(tag)}\\s+${esc(oldKey)}(?![a-z0-9])`);
        if (!re.test(line)) continue;
        seen.set(oldKey, seen.get(oldKey) + 1);
        if (newKey === null) removals.push({ path: f, line: i + 1, tag, oldKey });
        else plans.push({ path: f, line: i + 1, tag, oldKey, newKey });
      }
    }
  });
}
// smokeManifest 키 치환 계획.
const manifestPlans = []; // {oldKey, newKey|null}
let manifest = null;
if (manifestRel) {
  try { manifest = JSON.parse(readFileSync(resolveFromRoot(cfg, manifestRel), "utf8")); } catch { manifest = null; }
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    for (const [oldKey, newKey] of Object.entries(map)) {
      if (!(oldKey in manifest)) continue;
      seen.set(oldKey, seen.get(oldKey) + 1);
      manifestPlans.push({ oldKey, newKey });
    }
  } else manifest = null;
}

console.log(`Retag — map:${Object.keys(map).length}키 rewrites:${plans.length + manifestPlans.filter((p) => p.newKey !== null).length} manual-removal:${removals.length + manifestPlans.filter((p) => p.newKey === null).length} mode:${WRITE ? "write" : "dry-run"} config:${cfgTag}`);
for (const p of plans) console.log(`  · ${p.path}:${p.line} ${p.tag} ${p.oldKey} → ${p.newKey}`);
for (const p of manifestPlans) console.log(p.newKey === null
  ? `  · ${manifestRel} 키 ${p.oldKey} → (폐기 — 수동 제거 대상)`
  : `  · ${manifestRel} 키 ${p.oldKey} → ${p.newKey}`);
for (const r of removals) console.log(`  · ${r.path}:${r.line} ${r.tag} ${r.oldKey} → (폐기 — 수동 제거 대상, 잔존 시 fr 게이트 R1이 차단)`);
for (const [oldKey, n] of seen) if (n === 0) console.log(`  ⚠ "${oldKey}": 참조 0건 — 이미 이행됐거나 오타`);

if (!WRITE) {
  console.log("Retag: dry-run — 적용하려면 --write.");
  process.exit(0);
}

// 3. 적용(--write) — 파일 단위 일괄 치환 후 저장, 매니페스트 키 rename.
const byFile = new Map();
for (const p of plans) {
  if (!byFile.has(p.path)) byFile.set(p.path, []);
  byFile.get(p.path).push(p);
}
for (const [f, ps] of byFile) {
  let text = readFileSync(join(ROOT, f), "utf8");
  for (const { tag, oldKey, newKey } of ps) {
    const re = new RegExp(`(${esc(tag)}\\s+)${esc(oldKey)}(?![a-z0-9])`, "g");
    text = text.replace(re, `$1${newKey}`);
  }
  writeFileSync(join(ROOT, f), text);
}
if (manifest && manifestPlans.some((p) => p.newKey !== null)) {
  const next = {};
  const rename = new Map(manifestPlans.filter((p) => p.newKey !== null).map((p) => [p.oldKey, p.newKey]));
  for (const key of Object.keys(manifest).map((k) => [k, rename.get(k) || k]).sort((a, b) => (a[1] < b[1] ? -1 : 1)).map(([k]) => k)) {
    next[rename.get(key) || key] = manifest[key];
  }
  writeFileSync(resolveFromRoot(cfg, manifestRel), JSON.stringify(next, null, 2) + "\n");
}
console.log(`Retag: 적용 완료 — 파일 ${byFile.size}개 치환, manifest 키 ${manifestPlans.filter((p) => p.newKey !== null).length}건 rename.`);
