// tooling/__tests__/completion-signal.test.mjs
// 완료 판정의 신호 강도(SPEC-055) — **무엇을 보고 "됐다"고 말했는가.**
// 실측 제보: 파이프라인 로그에 성공 줄이 있고 CI가 초록이어서 배포 완료로 보고했는데,
// migrate Job이 실패해 배포 스테이지가 스킵된 상태였다. 로그와 상태는 대상이 아니다.
// @covers SPEC-055/FR-001
// @covers SPEC-055/FR-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGNAL_KINDS, COMPLETION_MIN_SIGNAL, signalRank, parseSignal, completionFindings,
  SIGNAL_FINDING_TEXT, SIGNAL_KIND_TEXT,
} from "../completion-signal-lib.mjs";
import { importClosure } from "../import-wiring-lib.mjs";

const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");

test("종류는 셋뿐이고 순서가 곧 등급이다 — 별도 랭크 표를 두면 둘이 갈라진다", () => {
  assert.deepEqual([...SIGNAL_KINDS], ["target-state", "derived", "self-report"]);
  assert.ok(signalRank("target-state") > signalRank("derived"));
  assert.ok(signalRank("derived") > signalRank("self-report"));
  assert.equal(signalRank("없는종류"), -1);
  // 완료의 하한은 **대상 상태**다 — 파생 신호는 완료의 근거가 아니다.
  assert.equal(COMPLETION_MIN_SIGNAL, "target-state");
  // 모든 종류에 사람이 읽는 설명이 있다(설명 없는 열거는 선언을 유도하지 못한다).
  for (const k of SIGNAL_KINDS) assert.ok(String(SIGNAL_KIND_TEXT[k] || "").trim(), k);
});

test("선언이 없으면 추정하지 않는다 — 추정한 기본값은 조용히 정답이 된다", () => {
  assert.equal(parseSignal(undefined), null);
  assert.equal(parseSignal(""), null);
  assert.equal(parseSignal("  "), null);
  assert.equal(parseSignal(" derived "), "derived");
});

test("완료를 주장하지 않는 검사는 이 축의 대상이 아니다 — 모든 검사에 신호를 요구하면 소음이 된다", () => {
  assert.deepEqual(completionFindings([{ id: "a", assertsCompletion: false }]), []);
  assert.deepEqual(completionFindings([]), []);
  assert.deepEqual(completionFindings(null), []);
});

test("파생·자기신고만으로 완료를 주장하면 위반 — 제보가 겪은 형태 그대로", () => {
  const f = completionFindings([
    { id: "deploy-log", assertsCompletion: true, signal: "derived" },
    { id: "agent-said", assertsCompletion: true, signal: "self-report" },
    { id: "kubectl-get", assertsCompletion: true, signal: "target-state" },
  ]);
  assert.deepEqual(f, [
    { kind: "weak-signal", id: "deploy-log", got: "derived" },
    { kind: "weak-signal", id: "agent-said", got: "self-report" },
  ]);
});

test("신호 미선언·열거 밖은 각각 다른 위반이다 — 오타는 조용한 무발화가 된다", () => {
  assert.deepEqual(completionFindings([{ id: "x", assertsCompletion: true }]),
    [{ kind: "no-signal", id: "x" }]);
  assert.deepEqual(completionFindings([{ id: "y", assertsCompletion: true, signal: "targetstate" }]),
    [{ kind: "bad-signal", id: "y", got: "targetstate" }]);
  // id가 없어도 판정은 사라지지 않는다 — 무명 항목이 조용히 빠지면 그것이 사각이다.
  assert.deepEqual(completionFindings([{ assertsCompletion: true }]),
    [{ kind: "no-signal", id: "(무명)" }]);
});

test("모든 위반 종류에 사람이 읽는 문장이 있다 — 문장 없는 kind는 undefined를 출력한다", () => {
  for (const k of ["no-signal", "bad-signal", "weak-signal"]) {
    assert.ok(String(SIGNAL_FINDING_TEXT[k] || "").trim(), k);
  }
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
const LIBS = importClosure(["check-completion-signal.mjs"], KIT_SRC);
function repo(config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-csig-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...config }));
  return root;
}
function run(root) {
  const gate = join(root, "scripts", "check-completion-signal.mjs");
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// @covers SPEC-055/FR-003
test("게이트: 파생 신호 완료 주장을 hard에서 **실제로 막는다**", () => {
  const checks = [{ id: "deploy", command: "true", assertsCompletion: true, signal: "derived" }];
  const hard = repo({ completionSignalPolicy: "hard", liveRealityChecks: checks });
  try {
    const r = run(hard);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /deploy/);
    assert.match(r.out, /파생 신호만으로/);
  } finally { rmSync(hard, { recursive: true, force: true }); }
  // advisory는 막지 않는다 — 채택 중 프로젝트를 벽으로 세우지 않는다.
  const adv = repo({ completionSignalPolicy: "advisory", liveRealityChecks: checks });
  try {
    const r = run(adv);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠/);
  } finally { rmSync(adv, { recursive: true, force: true }); }
});

// @covers SPEC-055/FR-004
test("게이트: 완료 주장 검사가 없으면 INERT — 판정 입력 없음을 clean으로 말하지 않는다", () => {
  const root = repo({ completionSignalPolicy: "hard", liveRealityChecks: [{ id: "x", command: "true" }] });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /안 봄|판정 입력/);
    assert.doesNotMatch(r.out, /^완료 신호 게이트: OK/m, "판정 입력이 없는데 OK라고 말하면 안 된다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: off는 판정하지 않는다고 선언한다 / 대상 신호만 있으면 침묵 통과", () => {
  const off = repo({ completionSignalPolicy: "off", liveRealityChecks: [{ id: "d", command: "true", assertsCompletion: true, signal: "derived" }] });
  try {
    const r = run(off);
    assert.equal(r.code, 0);
    assert.match(r.out, /off/);
  } finally { rmSync(off, { recursive: true, force: true }); }
  const ok = repo({ completionSignalPolicy: "hard", liveRealityChecks: [{ id: "d", command: "true", assertsCompletion: true, signal: "target-state" }] });
  try {
    const r = run(ok);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK/);
  } finally { rmSync(ok, { recursive: true, force: true }); }
});

test("게이트: 정책 enum 밖 값 → exit 1(문법화)", () => {
  const root = repo({ completionSignalPolicy: "strict" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /completionSignalPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
