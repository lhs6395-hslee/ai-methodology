#!/usr/bin/env node
// ─── Test adequacy gate (level 1) ─────────────────────────
// @covers 태그를 단 테스트 파일이 단언(assertion)을 하나도 안 하면 잡는다.
// FR↔test 게이트는 "태깅됨"만 보므로 빈 껍데기 테스트가 거짓 green을 만든다 —
// 이 게이트가 그 틈을 메운다. 파일 단위 coarse 검사(단언 토큰 ≥1).
// 기본 advisory(warn, exit 0), --strict에서 exit 1. config: assertionPatterns.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { loadConfig, resolveFromRoot, isTestFile, walkFiles } from "./sdd-config.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const ROOT = cfg.__root;
const SCAN_DIRS = cfg.scanDirs.map((d) => resolveFromRoot(cfg, d));
const IGNORE = new Set(cfg.ignoreDirs);
const STRICT = process.argv.includes("--strict");
const ASSERT = cfg.assertionPatterns.map((s) => new RegExp(s));

// 정본 순회 + 테스트 파일 필터 — 순회 규칙 복제 대신 필터만 호출자가 갖는다(R13 구조 중복).
const walk = (dir) => walkFiles(dir, IGNORE).filter((r) => isTestFile(basename(r), cfg)).map((r) => join(dir, r));

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
judged(offenders.length);
console.log(`Test adequacy gate — @covers files:${withCovers} no-assertion:${offenders.length} mode:${STRICT ? "strict" : "advisory"} config:${cfgTag}`);
for (const o of offenders) console.log(`  · ${o}: @covers 있으나 단언 없음(빈 껍데기 의심)`);
if (offenders.length && STRICT) {
  console.error("\n✗ test adequacy 위반(strict): 위 파일에 단언 추가 또는 @covers 제거");
  process.exit(1);
}
console.log("Test adequacy gate: OK");
