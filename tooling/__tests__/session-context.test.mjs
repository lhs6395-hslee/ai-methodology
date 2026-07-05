// @covers SPEC-004/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

test("session-context: 궤도·진입규칙·PREFIX·spec위치를 출력", () => {
  const out = execFileSync("sh", [join(process.cwd(), "tooling/harness/sdd-session-context.sh")], { encoding: "utf8" });
  assert.match(out, /spec.?→.?code.?→.?test.?→.?sync/i); // 궤도
  assert.match(out, /MODULE_MAP/);                        // 진입 규칙
  assert.match(out, /SPEC.*INFRA.*TEST/);                 // PREFIX 표준
  assert.match(out, /sdd\/specs/);                        // spec 위치
});

test("session-context: 광고된 게이트 목록 = 실제 스위트 전종(품질·보강·spec-first·회계·재도출)", () => {
  const out = execFileSync("sh", [join(process.cwd(), "tooling/harness/sdd-session-context.sh")], { encoding: "utf8" });
  // 광고 목록이 실제 게이트 스위트보다 좁으면 세션 컨텍스트가 낡은 궤도를 가르친다(드리프트).
  for (const gate of [
    "check-fr-coverage", "check-ownership", "check-spec-cohesion", "check-spec-completeness",
    "check-spec-consistency", "check-test-adequacy", "check-converge-drift", "check-orphan-surfaces",
    "check-spec-sync", "check-derivation", "sdd-smoke-scan",
  ]) assert.match(out, new RegExp(gate), `${gate}가 SessionStart 광고에 포함`);
});
