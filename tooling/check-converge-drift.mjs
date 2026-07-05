#!/usr/bin/env node
// ─── Converge-drift gate ──────────────────────────────────
// 변경 범위에 코드(scanDirs)는 있는데 스펙(specDir)은 없으면 경고.
// hotfix 후 /converge 미실행으로 스펙↔코드가 벌어지는 이음매를 가시화.
// 기본 advisory(exit 0), --strict에서 exit 1. git 없으면 skip.
import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";

const cfg = loadConfig();
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const base = args.find((a) => !a.startsWith("--")) || process.env.SDD_DIFF_BASE || "origin/main";

let changed;
try {
  // core.quotepath=off: 비ASCII 경로 인용이 디렉토리 귀속 판정을 깨는 것 방지(spec-sync와 동일).
  changed = execSync(`git -c core.quotepath=off diff --name-only ${base}...HEAD`, { cwd: cfg.__root, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
} catch {
  console.log(`· converge-drift: git diff(${base}) 불가 — 건너뜀`);
  process.exit(0);
}

const inDir = (p, d) => p === d || p.startsWith(d.replace(/\/$/, "") + "/");
const codeChanged = changed.filter((p) => cfg.scanDirs.some((d) => inDir(p, d)));
const specChanged = changed.some((p) => inDir(p, cfg.specDir));

console.log(`Converge-drift gate — base:${base} changed:${changed.length} code:${codeChanged.length} spec-changed:${specChanged} mode:${STRICT ? "strict" : "advisory"}`);
if (codeChanged.length && !specChanged) {
  console.log(`  · 코드 ${codeChanged.length}건 변경인데 스펙 무변경 — /converge 로 갭 표면화 후 spec 갱신 검토`);
  for (const p of codeChanged.slice(0, 10)) console.log(`    - ${p}`);
  if (STRICT) { console.error("\n✗ converge-drift(strict): 스펙 동반 변경 또는 의도적 면제 필요"); process.exit(1); }
}
console.log("Converge-drift gate: OK");
