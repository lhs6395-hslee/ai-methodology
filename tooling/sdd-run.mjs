#!/usr/bin/env node
// ─── SDD generic command runner (한 CI를 모든 언어에) ──────────
// 언어별 lint/typecheck/test 명령을 sdd.config.json의 `commands`에 선언해 두면
// 이 러너가 stage별로 실행한다. 그래서 CI 워크플로우(sdd-gates.yml)는 언어를
// 모른 채 `node sdd-run.mjs <stage>`만 호출하면 된다 — Python·Go·Rust·Java 동일.
//
// 명령이 없는 stage는 **건너뛴다(실패 아님)** — 프로젝트는 가진 stage만 선언.
//
// Usage: node scripts/sdd-run.mjs <stage>
//   stage: setup | lint | typecheck | test (또는 commands 아래 임의 키)

import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";

const stage = process.argv[2];
if (!stage) {
  console.error("usage: node sdd-run.mjs <stage>   (setup|lint|typecheck|test|…)");
  process.exit(2);
}

const cfg = loadConfig();
const cmd = cfg.commands?.[stage];
if (!cmd) {
  console.log(`· sdd-run: '${stage}' 명령 미설정 — 건너뜀`);
  process.exit(0);
}

console.log(`▶ sdd-run ${stage}: ${cmd}`);
try {
  execSync(cmd, { stdio: "inherit", cwd: cfg.__root, shell: true });
} catch (e) {
  console.error(`✗ sdd-run ${stage} 실패 (exit ${e.status ?? 1})`);
  process.exit(e.status ?? 1);
}
