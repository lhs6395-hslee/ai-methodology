#!/usr/bin/env node
// ─── Orphan-surface gate (reverse coverage) ───────────────
// surfaceGlobs로 지정한 "표면 파일"이 어떤 스펙의 ## Ownership Surfaces에
// 선언돼 있는지 확인. 없으면 스펙 없는 코드(고아) 경고 — "spec=SSOT"의 역방향.
// surfaceGlobs 비면 no-op. 기본 advisory(exit 0), --strict에서 exit 1.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const STRICT = process.argv.includes("--strict");
const globs = (cfg.surfaceGlobs ?? []).map((s) => new RegExp(s));

if (!globs.length) { console.log("Orphan-surface gate: surfaceGlobs 미설정 — no-op"); process.exit(0); }

// 1. 모든 스펙의 Ownership Surfaces 키 수집(소문자 정규화).
const norm = (s) => s.trim().toLowerCase();
const declared = new Set();
const specDir = resolveFromRoot(cfg, cfg.specDir);
for (const f of (() => { try { return readdirSync(specDir); } catch { return []; } })()) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(join(specDir, f), "utf8");
  const m = text.match(/-\s*\*\*Surfaces\*\*\s*:\s*([^\n]+)/i);
  if (m) for (const k of m[1].split(",")) { const v = norm(k); if (v && !v.startsWith("[") && v !== "—") declared.add(v); }
}

// 2. 표면 파일 수집(ROOT 상대경로, surfaceGlobs 매칭).
const IGNORE = new Set(cfg.ignoreDirs);
function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}
const orphans = [];
let surfaces = 0;
for (const p of walk(ROOT)) {
  const rel = p.replace(ROOT + "/", "");
  if (!globs.some((re) => re.test(rel))) continue;
  surfaces++;
  // 표면이 선언 집합 중 하나와 일치(부분 일치 허용 — 선언은 경로로 표기)
  const claimed = [...declared].some((d) => d === norm(rel) || norm(rel).includes(d) || d.includes(norm(rel)));
  if (!claimed) orphans.push(rel);
}

console.log(`Orphan-surface gate — surfaces:${surfaces} declared:${declared.size} orphans:${orphans.length} mode:${STRICT ? "strict" : "advisory"}`);
for (const o of orphans) console.log(`  · ${o}: 어떤 스펙 Ownership(Surfaces)에도 없음 → 스펙 누락 의심`);
if (orphans.length && STRICT) { console.error("\n✗ orphan-surface(strict): 표면을 소유하는 스펙 작성 또는 Ownership 등록"); process.exit(1); }
console.log("Orphan-surface gate: OK");
