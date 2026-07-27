// @covers SPEC-021/FR-001
// @covers SPEC-021/FR-002
// @covers SPEC-021/FR-003
// @covers SPEC-021/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRunVerdict, RUN_TESTS_ENUM } from "../check-test-run.mjs";

// ── 순수 판정 코어 ──
test("FR-001: off → 실행 안 함, exit 0, '수동 실행 권장' 안내", () => {
  const v = testRunVerdict("off", true, null);
  assert.equal(v.exit, 0);
  assert.match(v.line, /runTestsPolicy:off/);
  assert.match(v.line, /회계 ≠ 실행 결과/);
});

test("FR-002: hard + 명령 green(exit 0) → exit 0", () => {
  assert.equal(testRunVerdict("hard", true, 0).exit, 0);
  assert.match(testRunVerdict("hard", true, 0).line, /green/);
});

test("FR-002: hard + 명령 실패 → exit 1, advisory + 실패 → exit 0(경고)", () => {
  const h = testRunVerdict("hard", true, 1);
  assert.equal(h.exit, 1);
  assert.match(h.line, /✗.*실패 \(exit 1/);
  const a = testRunVerdict("advisory", true, 2);
  assert.equal(a.exit, 0);
  assert.match(a.line, /⚠.*실패 \(exit 2/);
});

test("FR-003: 명령 미선언 → hard=exit 1 / advisory=exit 0, '검증 불가'", () => {
  assert.equal(testRunVerdict("hard", false, null).exit, 1);
  assert.match(testRunVerdict("hard", false, null).line, /미선언.*검증 불가/);
  assert.equal(testRunVerdict("advisory", false, null).exit, 0);
});

test("FR-004: enum 밖 값 → valid=false, exit 1", () => {
  const v = testRunVerdict("bogus", true, 0);
  assert.equal(v.valid, false);
  assert.equal(v.exit, 1);
  assert.match(v.line, /runTestsPolicy 값 위반/);
  assert.deepEqual(RUN_TESTS_ENUM, ["off", "advisory", "hard"]);
});

// ── 게이트 e2e (실제 명령 실행) ──
function runGate(cfg) {
  const root = mkdtempSync(join(tmpdir(), "sdd-testrun-"));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-test-run.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("게이트 e2e: hard + 실제 green 명령 → exit 0", () => {
  const r = runGate({ runTestsPolicy: "hard", commands: { test: "true" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /green/);
});

test("게이트 e2e: hard + 실패 명령 → exit 1", () => {
  const r = runGate({ runTestsPolicy: "hard", commands: { test: "false" } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /실패/);
});

test("게이트 e2e: off(기본) → 실행 안 함 exit 0", () => {
  const r = runGate({ commands: { test: "false" } }); // off라 false여도 안 돌림
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /off/);
});

// 회귀(감사 M-8): 게이트 stdout = 판정 줄만. 러너 출력이 stdout에 섞이면 하네스(sdd-sync)가
// stdout 전체를 ⚠/✗로 스캔하다 green인 게이트를 "확인 필요"로 읽는다(킷 자신의 테스트 이름에
// ⚠·✗가 들어 있어 R5가 항상 ⚠였던 실측). 러너 출력은 stderr로 보존(진단 가치 유지).
test("게이트 e2e: 러너 출력은 stdout이 아니라 stderr로 — 판정 줄만 stdout(M-8 회귀)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-testrun-io-"));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", runTestsPolicy: "hard",
    commands: { test: "printf '⚠ 러너가 낸 경고 텍스트\\n✗ 러너가 낸 실패 텍스트\\n'" },
  }));
  try {
    const r = spawnSync("node", [join(process.cwd(), "tooling/check-test-run.mjs")],
      { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1, `stdout은 판정 한 줄이어야 함: ${JSON.stringify(r.stdout)}`);
    assert.match(r.stdout, /green/);
    assert.ok(!/[⚠✗]/.test(r.stdout), `green 판정의 stdout에 ⚠/✗가 새면 하네스가 오독한다: ${JSON.stringify(r.stdout)}`);
    assert.match(r.stderr, /러너가 낸 경고 텍스트/); // 진단은 stderr에 보존
  } finally { rmSync(root, { recursive: true, force: true }); }
});
