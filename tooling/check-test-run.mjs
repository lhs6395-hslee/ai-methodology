#!/usr/bin/env node
// ─── 테스트 스위트 실행 게이트 (SPEC-021) ─────────────────────
// 커버리지 태그 회계(check-fr-coverage)·단언 존재(check-test-adequacy)는 "태깅됨"·"단언함"만
// 볼 뿐 스위트를 실제로 실행하지 않는다 — "커버리지 green"이 "실행 green"으로 오인된다.
// 이 게이트는 runTestsPolicy(off|advisory|hard)로 `commands.test`(로컬 안전 tier)를 실제 실행해
// exit 0(green)을 확인한다. 러너/언어 중립 — 선언된 명령을 그대로 돌리고 exit code만 판정.
// 실행이 느려 pre-commit엔 배선하지 않는다(완료 시점·CI·pre-push opt-in).
// 설계: SPEC-021 (Python판 sdd_gates.py testrun이 동일 동작을 미러 — SPEC-006 패리티).
import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";

export const RUN_TESTS_ENUM = ["off", "advisory", "hard"];

// 순수 판정: 정책 × 명령유무 × exit code → {valid, exit, line}. line이 출력 바이트의 정본.
export function testRunVerdict(policy, hasCommand, exitCode) {
  if (!RUN_TESTS_ENUM.includes(policy)) {
    return { valid: false, exit: 1, line: `✗ runTestsPolicy 값 위반 "${policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)` };
  }
  if (policy === "off") {
    return { valid: true, exit: 0, line: "테스트 실행 게이트 — runTestsPolicy:off (실행 안 함; 완료 주장 전 commands.test 수동 실행 권장 — 커버리지 회계 ≠ 실행 결과)" };
  }
  const hard = policy === "hard";
  if (!hasCommand) {
    return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "⚠"} 테스트 실행 게이트 — runTestsPolicy:${policy}인데 commands.test 미선언 — 실행으로 검증 불가(커버리지 회계 ≠ 실행 결과)` };
  }
  if (exitCode === 0) {
    return { valid: true, exit: 0, line: `테스트 실행 게이트 — commands.test green (runTestsPolicy:${policy})` };
  }
  return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "⚠"} 테스트 실행 게이트 — commands.test 실패 (exit ${exitCode}, runTestsPolicy:${policy})` };
}

// 게이트 진입(직접 실행 시에만) — import 시엔 순수 함수만 노출.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const policy = cfg.runTestsPolicy || "off";
  const cmd = (cfg.commands || {}).test;
  let exitCode = null;
  if (RUN_TESTS_ENUM.includes(policy) && policy !== "off" && cmd) {
    try { execSync(cmd, { cwd: cfg.__root, stdio: "inherit" }); exitCode = 0; }
    catch (e) { exitCode = typeof e.status === "number" ? e.status : 1; }
  }
  const v = testRunVerdict(policy, !!cmd, exitCode);
  (v.valid ? console.log : console.error)(v.line);
  process.exit(v.exit);
}
