// @covers SPEC-021/FR-001
// @covers SPEC-021/FR-002
// @covers SPEC-021/FR-003
// @covers SPEC-021/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync , existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { e2eRunVerdict, testRunVerdict, RUN_TESTS_ENUM } from "../check-test-run.mjs";

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
    // stdout = 판정 줄만(러너 텍스트 0). 축이 둘이라 3줄 — e2e 축(off 명시) + 스위트 판정 + 판정 타입.
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 3, `stdout은 판정 줄만이어야 함: ${JSON.stringify(r.stdout)}`);
    assert.match(lines[0], /e2e 실행 축 — e2eTestsPolicy:off/);
    // 사람 요약은 판정 타입 줄 **앞**이 마지막이다 — 하네스가 판정 줄을 걷어내고 요약을 뽑는다(SPEC-040).
    assert.match(lines[1], /green/);
    assert.equal(lines[2], "판정: JUDGED — 위반 0건");
    assert.ok(!/[⚠✗]/.test(r.stdout), `green 판정의 stdout에 ⚠/✗가 새면 하네스가 오독한다: ${JSON.stringify(r.stdout)}`);
    assert.match(r.stderr, /러너가 낸 경고 텍스트/); // 진단은 stderr에 보존
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── e2e 실행 축 (SPEC-021 확장) ──
// 실측 결함(소비 프로젝트 PM): testFileRegex가 e2e를 포함해 회계는 "검증됨"으로 세는데
// commands.test는 e2e를 실행하지 않았다. e2e 57개가 전부 로그인 단계에서 죽어 있는 동안
// R5는 계속 green이었고 FR 58건이 covered로 집계됐다. 실행하지 않는 것을 검증됐다고 세면
// 거짓 안전이므로, 회계와 실행 계약이 같이 닫혀야 한다.
// @covers SPEC-021/FR-005
test("e2e 판정: off·미선언·green·실패·skipped — hard에서 미판정은 거짓 안전이라 실패", () => {
  assert.equal(e2eRunVerdict("off", true)[Symbol.iterator] ? 0 : 0, 0); // 형태 확인용 no-op
  const off = e2eRunVerdict("off", false);
  assert.equal(off.exit, 0); assert.match(off.line, /판정 안 함/);

  const noCmd = e2eRunVerdict("hard", false);
  assert.equal(noCmd.exit, 1); assert.match(noCmd.line, /거짓 안전/); // 정책만 켜고 명령 없음

  assert.equal(e2eRunVerdict("advisory", true, { exitCode: 0 }).exit, 0);
  assert.match(e2eRunVerdict("advisory", true, { exitCode: 0 }).line, /green/);

  const fail = e2eRunVerdict("hard", true, { exitCode: 3 });
  assert.equal(fail.exit, 1); assert.match(fail.line, /실패 \(exit 3/);
  assert.equal(e2eRunVerdict("advisory", true, { exitCode: 3 }).exit, 0); // advisory는 경고만

  // ★ 핵심 계약 — "판정 못 함"과 "통과"를 섞지 않는다(SPEC-032 live-reality와 같은 원칙).
  const skipAdv = e2eRunVerdict("advisory", true, { skipped: "앱 미기동" });
  assert.equal(skipAdv.exit, 0); assert.match(skipAdv.line, /\[skipped\] 앱 미기동/);
  assert.match(skipAdv.line, /판정 못 함이지 '통과'가 아니다/);
  const skipHard = e2eRunVerdict("hard", true, { skipped: "앱 미기동" });
  assert.equal(skipHard.exit, 1, "hard에서 skipped는 거짓 안전이라 실패여야 한다");

  assert.equal(e2eRunVerdict("strict", true).valid, false); // enum 밖
});

// @covers SPEC-021/FR-005
test("게이트 e2e: precheck 실패 → 테스트를 돌리지 않고 skipped(사유)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-e2e-"));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", runTestsPolicy: "off", e2eTestsPolicy: "advisory",
    e2ePrecheck: "sh -c 'echo BASE_URL 응답 없음 >&2; exit 7'",
    commands: { e2e: "sh -c 'echo E2E가_실행됨 > ran.txt'" },
  }));
  try {
    const r = spawnSync("node", [join(process.cwd(), "tooling/check-test-run.mjs")],
      { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[skipped\] 실행 전제 미충족/);
    assert.match(r.stdout, /BASE_URL 응답 없음/);
    assert.ok(!existsSync(join(root, "ran.txt")), "precheck 실패면 e2e 명령을 실행하지 않아야 한다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
