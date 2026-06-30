#!/usr/bin/env node
// ─── Test adequacy gate (level 1) ─────────────────────────
// @covers 태그를 단 테스트 파일이 단언(assertion)을 하나도 안 하면 잡는다.
// FR↔test 게이트는 "태깅됨"만 보므로 빈 껍데기 테스트가 거짓 green을 만든다 —
// 이 게이트가 그 틈을 메운다. 파일 단위 coarse 검사(단언 토큰 ≥1).
// 기본 advisory(warn, exit 0), --strict에서 exit 1. config: assertionPatterns.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, isTestFile } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const SCAN_DIRS = cfg.scanDirs.map((d) => resolveFromRoot(cfg, d));
const IGNORE = new Set(cfg.ignoreDirs);
const STRICT = process.argv.includes("--strict");
const ASSERT = cfg.assertionPatterns.map((s) => new RegExp(s));

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else if (isTestFile(name, cfg)) acc.push(p);
  }
  return acc;
}

const offenders = [];
let withCovers = 0;
for (const dir of SCAN_DIRS) {
  for (const f of walk(dir)) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("@covers")) continue;
    withCovers++;
    if (!ASSERT.some((re) => re.test(text))) offenders.push(f.replace(ROOT + "/", ""));
  }
}

const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
console.log(`Test adequacy gate — @covers files:${withCovers} no-assertion:${offenders.length} mode:${STRICT ? "strict" : "advisory"} config:${cfgTag}`);
for (const o of offenders) console.log(`  · ${o}: @covers 있으나 단언 없음(빈 껍데기 의심)`);
if (offenders.length && STRICT) {
  console.error("\n✗ test adequacy 위반(strict): 위 파일에 단언 추가 또는 @covers 제거");
  process.exit(1);
}
console.log("Test adequacy gate: OK");
