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

test("session-context: 광고된 게이트 목록에 check-fr-coverage·check-spec-consistency가 포함", () => {
  const out = execFileSync("sh", [join(process.cwd(), "tooling/harness/sdd-session-context.sh")], { encoding: "utf8" });
  assert.match(out, /check-fr-coverage/, "check-fr-coverage가 SessionStart 광고에 포함");
  assert.match(out, /check-spec-consistency/, "check-spec-consistency가 SessionStart 광고에 포함");
  assert.match(out, /check-ownership/, "check-ownership이 SessionStart 광고에 포함");
  assert.match(out, /check-spec-cohesion/, "check-spec-cohesion이 SessionStart 광고에 포함");
});
