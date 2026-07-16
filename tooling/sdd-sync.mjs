#!/usr/bin/env node
// ─── SDD 하네스 — detect 집계기 ───────────────────────────────
// HARNESS.md 규칙표의 detect 단계: 규칙별 detector 게이트를 일괄 실행하고
// "확인 필요/clean"을 규칙별로 리포트한다. 스킬 /sdd-sync 과 pre-push 훅이 소비.
// advisory(기본): 리포트 + exit 0. --strict: 발견 있으면 exit 1.
// --json: 기계 판독 리포트(스키마 v1)만 stdout에 출력(사람 텍스트 억제) — ask 층이 소비.
//
// 탐지 로직은 게이트에 있다(판정 신규 0). 이 파일은 오케스트레이션만.
// Usage: node scripts/sdd-sync.mjs [--strict] [--json]

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
// fileURLToPath: 한글 등 비-ASCII 경로에서 URL.pathname은 %-인코딩돼 게이트가 조용히 스킵된다(도그푸딩 발견).
const HERE = dirname(fileURLToPath(import.meta.url));

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

// 규칙별 detector 실행 → 데이터 모델(사람/JSON 공통). rule id는 안정 계약(R1/R2/R3).
const rules = RULES.map(({ rule, gates }) => {
  const sp = rule.indexOf(" ");
  const id = rule.slice(0, sp); // "R1"
  const title = rule.slice(sp + 1); // "spec→code"
  const gateResults = gates.map((g) => {
    const r = runGate(g);
    return { gate: g, flagged: r.flagged, summary: r.last };
  });
  return { id, title, flagged: gateResults.some((g) => g.flagged), gates: gateResults };
});
const flaggedRules = rules.filter((r) => r.flagged).map((r) => r.id);
const clean = flaggedRules.length === 0;

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, clean, flaggedRules, rules }, null, 2) + "\n");
} else {
  console.log("SDD sync 리포트 — detector 일괄 실행 (HARNESS.md 규칙표)");
  for (const r of rules) {
    console.log(`\n● ${r.id} ${r.title}: ${r.flagged ? "⚠ 확인 필요" : "✓ clean"}`);
    for (const g of r.gates) console.log(`    [${g.gate}] ${g.summary}`);
  }
  console.log(
    clean
      ? `\n요약: 전부 sync ✓`
      : `\n요약: 확인 필요 — ${rules.filter((r) => r.flagged).map((r) => `${r.id} ${r.title}`).join(", ")} → node scripts/sdd-sync.mjs 리포트로 의사결정(Claude Code: /sdd-sync)`
  );
}
if (STRICT && !clean) process.exit(1);
