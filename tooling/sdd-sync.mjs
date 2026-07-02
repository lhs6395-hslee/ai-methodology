#!/usr/bin/env node
// ─── SDD 하네스 — detect 집계기 ───────────────────────────────
// HARNESS.md 규칙표의 detect 단계: 규칙별 detector 게이트를 일괄 실행하고
// "확인 필요/clean"을 규칙별로 리포트한다. 스킬 /sdd-sync 과 pre-push 훅이 소비.
// advisory(기본): 리포트 + exit 0. --strict: 발견 있으면 exit 1.
//
// 탐지 로직은 게이트에 있다(판정 신규 0). 이 파일은 오케스트레이션만.
// Usage: node scripts/sdd-sync.mjs [--strict]

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const STRICT = process.argv.includes("--strict");
const HERE = dirname(new URL(import.meta.url).pathname);

// 규칙 → detector 게이트(HARNESS.md 규칙표). 같은 디렉토리에서 게이트를 찾는다.
const RULES = [
  { rule: "R1 spec→code", gates: ["check-fr-coverage.mjs"] },
  { rule: "R2 code→spec", gates: ["check-converge-drift.mjs", "check-orphan-surfaces.mjs", "check-spec-sync.mjs"] },
  { rule: "R3 dedup+입도+완전성+일관성", gates: ["check-ownership.mjs", "check-spec-cohesion.mjs", "check-spec-completeness.mjs", "check-spec-consistency.mjs"] },
];

function runGate(file) {
  const path = join(HERE, file);
  if (!existsSync(path)) return { flagged: false, last: `(없음: ${file})` };
  try {
    // stdio: stderr를 캡처(부모로 inherit 금지) — 게이트가 크래시해도 누출 없이 리포트에 담는다.
    const out = execFileSync("node", [path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { flagged: /[⚠✗]/.test(out), last: out.trim().split("\n").pop() || "" };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    return { flagged: true, last: out.trim().split("\n").pop() || "(비정상 종료)" };
  }
}

console.log("SDD sync 리포트 — detector 일괄 실행 (HARNESS.md 규칙표)");
const flaggedRules = [];
for (const { rule, gates } of RULES) {
  let flagged = false;
  const lines = [];
  for (const g of gates) {
    const r = runGate(g);
    if (r.flagged) flagged = true;
    lines.push(`    [${g}] ${r.last}`);
  }
  console.log(`\n● ${rule}: ${flagged ? "⚠ 확인 필요" : "✓ clean"}`);
  for (const l of lines) console.log(l);
  if (flagged) flaggedRules.push(rule);
}

console.log(
  flaggedRules.length
    ? `\n요약: 확인 필요 — ${flaggedRules.join(", ")} → '/sdd-sync'로 의사결정`
    : `\n요약: 전부 sync ✓`
);
if (STRICT && flaggedRules.length) process.exit(1);
