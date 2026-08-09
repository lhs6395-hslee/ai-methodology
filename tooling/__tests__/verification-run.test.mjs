// 검증 **실행** 회계(SPEC-041) — 존재는 실행이 아니다.
// 실측 제보(2026-08-10)의 세 얼굴을 각각 회귀로 고정한다:
//   ① 중도 포기가 산출물 없이 사라짐 → 기록 없음 = 침묵 = 위반
//   ② 대상 0건 exit 0이 "성공"과 동형 → 러너가 outcome으로 구분해 기록
//   ③ 전제 자원 부재로 안 뜬 비차단 스테이지 → INERT 기록이 부채로 표면화
// @covers SPEC-041/FR-001
// @covers SPEC-041/FR-002
// @covers SPEC-041/FR-003
// @covers SPEC-041/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunLine, parseRunLedger, classifyRuns, verificationRunVerdict, formatRunLine } from "../verification-run-lib.mjs";
import { compileGlob } from "../spec-sync-lib.mjs";

const GATE = new URL("../check-verification-executed.mjs", import.meta.url).pathname;

// ── 순수 코어 ────────────────────────────────────────────────────────────────
test("사유 없는 포기는 기록이 아니다 — 포기는 허용하되 침묵은 금지(제보 ①의 핵심)", () => {
  assert.equal(parseRunLine('{"asset":"a","outcome":"SKIPPED"}').malformed, true);
  assert.match(parseRunLine('{"asset":"a","outcome":"SKIPPED"}').why, /사유 없는 포기는 기록이 아니다/);
  // JUDGED는 사유 없이도 기록이다 — "돌았다"는 그 자체로 완결된 사실이다.
  assert.equal(parseRunLine('{"asset":"a","outcome":"JUDGED"}').outcome, "JUDGED");
  assert.equal(parseRunLine('{"asset":"a","outcome":"INERT","detail":"ECR 리포 없음"}').detail, "ECR 리포 없음");
});

test("깨진 줄을 버리지 않는다 — 버리면 '형식 틀림'이 '기록 안 함'과 같아진다", () => {
  const { entries, malformed } = parseRunLedger([
    '{"asset":"a","outcome":"JUDGED"}',
    "이건 JSON이 아니다",
    '{"asset":"","outcome":"JUDGED"}',
    '{"asset":"c","outcome":"GREEN","detail":"x"}',
    "# 주석은 기록이 아니다",
    "",
  ].join("\n"));
  assert.equal(entries.length, 1);
  assert.deepEqual(malformed.map((m) => m.why), ["JSON 아님", "asset 없음", 'outcome "GREEN" — JUDGED|OFF|INERT|SKIPPED|UNTYPED 중 하나']);
});

test("매칭 폭은 증거 경로 인정 폭과 같다 — 정확·디렉토리·글롭(좁히면 정당한 스위트 지목이 거짓 미실행)", () => {
  const entries = [
    { asset: "tests/unit", outcome: "JUDGED", detail: "" },
    { asset: "tests/e2e/**", outcome: "SKIPPED", detail: "스테이징 미발급" },
    { asset: "docs/runbook.md", outcome: "JUDGED", detail: "" },
  ];
  const r = classifyRuns(
    ["tests/unit/a.test.ts", "tests/e2e/login.spec.ts", "docs/runbook.md", "tests/perf/load.js"],
    entries, compileGlob);
  assert.deepEqual(r.executed.map((x) => x.path), ["tests/unit/a.test.ts", "docs/runbook.md"]);
  assert.deepEqual(r.debt.map((x) => x.path), ["tests/e2e/login.spec.ts"]);
  assert.deepEqual(r.silent, ["tests/perf/load.js"]);   // ← 제보 ①: 아무 기록도 없다
});

test("같은 자산에 여러 기록이면 마지막이 유효하다 — 원장은 append-only 로그다", () => {
  const entries = [
    { asset: "t/a.ts", outcome: "SKIPPED", detail: "데이터 없음" },
    { asset: "t/a.ts", outcome: "JUDGED", detail: "" },
  ];
  assert.equal(classifyRuns(["t/a.ts"], entries, compileGlob).executed.length, 1);
});

test("차단하는 것은 침묵과 깨진 기록뿐 — 사유 있는 포기는 어떤 강도에서도 막지 않는다", () => {
  // 막으면 사람이 사유를 지어내고, 그 순간 원장이 거짓말을 담기 시작한다.
  assert.equal(verificationRunVerdict("hard", { silent: [], malformed: [] }).blocking, false);
  assert.equal(verificationRunVerdict("hard", { silent: ["x"], malformed: [] }).blocking, true);
  assert.equal(verificationRunVerdict("hard", { silent: [], malformed: [{}] }).blocking, true);
  assert.equal(verificationRunVerdict("advisory", { silent: ["x"], malformed: [{}] }).blocking, false);
  assert.equal(verificationRunVerdict("advisory", { silent: ["x"], malformed: [] }).violations, 1);
});

test("직렬화↔파싱 왕복 — 기록기와 판정기가 같은 문법을 쓴다", () => {
  const line = formatRunLine({ asset: "a/b", outcome: "inert", detail: "사유", at: "2026-08-10T00:00:00Z" });
  const p = parseRunLine(line);
  assert.deepEqual({ asset: p.asset, outcome: p.outcome, detail: p.detail }, { asset: "a/b", outcome: "INERT", detail: "사유" });
});

// ── 게이트 e2e ───────────────────────────────────────────────────────────────
function repo(config = {}, specBody = null) {
  const root = mkdtempSync(join(tmpdir(), "sdd-vrun-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), specBody ?? [
    "**Spec**: `SPEC-001`",
    "## Success Criteria",
    "- **SC-001**: 로그인이 동작한다. [검증: tests/login.test.ts]",
    "- **SC-002**: 대시보드가 뜬다. [검증: tests/dash.test.ts]",
  ].join("\n"));
  writeFileSync(join(root, "tests/login.test.ts"), "//\n");
  writeFileSync(join(root, "tests/dash.test.ts"), "//\n");
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["tests"], ...config }));
  return root;
}
function run(root, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("원장 미선언 → INERT(판정 입력 없음) — 0건을 '다 돌았다'로 말하지 않는다", () => {
  const root = repo({ verificationRunPolicy: "advisory" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: INERT — verificationRunLedger 미선언/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hard + 원장 미선언 → exit 1 — 'hard 선언 + 무판정'은 거짓 안전이다", () => {
  const root = repo({ verificationRunPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /거짓 안전/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("기록 없음은 침묵 — advisory는 표면화, hard는 차단(제보 ①)", () => {
  const cfg = { verificationRunLedger: ".sdd/runs.jsonl" };
  const a = repo({ ...cfg, verificationRunPolicy: "advisory" });
  try {
    const r = run(a);
    assert.equal(r.code, 0);
    assert.match(r.out, /기록 없음 2/);
    assert.match(r.out, /⚠ 기록 없음: tests\/dash\.test\.ts/);
  } finally { rmSync(a, { recursive: true, force: true }); }
  const b = repo({ ...cfg, verificationRunPolicy: "hard" });
  try {
    const r = run(b);
    assert.equal(r.code, 1);
    assert.match(r.out, /존재는 실행이 아니다/);
  } finally { rmSync(b, { recursive: true, force: true }); }
});

test("--record로 남기면 침묵이 사라진다 — 그리고 사유 있는 포기는 hard에서도 통과(제보 ③)", () => {
  const root = repo({ verificationRunLedger: ".sdd/runs.jsonl", verificationRunPolicy: "hard" });
  try {
    assert.equal(run(root, ["--record", "tests/login.test.ts", "JUDGED", "12 passed"]).code, 0);
    // 전제 자원이 없어 한 번도 못 뜬 스테이지 — 사유와 함께 남기면 부채로 표면화되고 차단되지 않는다.
    assert.equal(run(root, ["--record", "tests/dash.test.ts", "INERT", "ECR 리포지토리 없음 — Job이 뜨지 못함"]).code, 0);
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /실행됨 1·사유 있는 미실행 1·기록 없음 0/);
    assert.match(r.out, /\[INERT\] tests\/dash\.test\.ts — ECR 리포지토리 없음/);
    assert.match(r.out, /침묵 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("사유 없는 포기는 기록기가 거부한다 — 원장에 침묵이 들어가지 못하게 입구에서 막는다", () => {
  const root = repo({ verificationRunLedger: ".sdd/runs.jsonl" });
  try {
    const r = run(root, ["--record", "tests/login.test.ts", "SKIPPED"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /사유 없는 포기는 기록이 아니다/);
    assert.equal(existsSync(join(root, ".sdd/runs.jsonl")), false, "거부된 기록이 파일에 남으면 안 된다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("깨진 기록은 hard에서 차단 — '기록했는데 형식이 틀림'이 조용히 통과하지 않는다", () => {
  const root = repo({ verificationRunLedger: ".sdd/runs.jsonl", verificationRunPolicy: "hard" });
  try {
    run(root, ["--record", "tests/login.test.ts", "JUDGED", "ok"]);
    run(root, ["--record", "tests/dash.test.ts", "JUDGED", "ok"]);
    writeFileSync(join(root, ".sdd/runs.jsonl"),
      readFileSync(join(root, ".sdd/runs.jsonl"), "utf8") + '{"asset":"x","outcome":"GREEN","detail":"y"}\n');
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /깨진 기록/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("환경 결속 선언은 면제가 아니다 — 침묵을 사유 있는 부채로 바꿀 뿐이고 실제 기록이 이긴다", () => {
  // 실측 교착: 킷의 CI 워크플로는 GitHub Actions에서만 돌아 로컬 스윕이 영구히 붉었다.
  // 원장은 gitignore라 "여기선 못 돈다"는 항구적 사실을 담지 못한다 → config에 durable하게 선언.
  const root = repo({
    verificationRunLedger: ".sdd/runs.jsonl", verificationRunPolicy: "hard",
    verificationRunEnvBound: { "tests/dash.test.ts": "CI 전용 — 로컬에 판정 입력 없음" },
  });
  try {
    run(root, ["--record", "tests/login.test.ts", "JUDGED", "ok"]);
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /실행됨 1·사유 있는 미실행 1·기록 없음 0/);
    assert.match(r.out, /\[INERT\] tests\/dash\.test\.ts — CI 전용 — 로컬에 판정 입력 없음 \(환경 결속 선언\)/);
    // **실행됨으로 세지 않는다** — 선언은 부채를 만들지 면제를 만들지 않는다.
    assert.doesNotMatch(r.out, /실행됨 2/);
    // 실제 기록이 있으면 그쪽이 이긴다.
    run(root, ["--record", "tests/dash.test.ts", "JUDGED", "CI에서 돌았다"]);
    assert.match(run(root).out, /실행됨 2·사유 있는 미실행 0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("사유 없는 환경 결속은 무시된다 — 사유 없는 결속은 조용한 면제이고 그건 이 게이트가 막는 것이다", () => {
  const root = repo({
    verificationRunLedger: ".sdd/runs.jsonl", verificationRunPolicy: "hard",
    verificationRunEnvBound: { "tests/**": "   " },
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /기록 없음 2/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("증거 표기가 0건이면 INERT — 대조할 축이 없는 것을 '다 돌았다'로 세지 않는다", () => {
  const root = repo({ verificationRunLedger: ".sdd/runs.jsonl" }, "**Spec**: `SPEC-001`\n## Success Criteria\n- **SC-001**: 뭔가 된다.\n");
  try {
    const r = run(root);
    assert.match(r.out, /판정: INERT — 선언된 실행 증거 경로 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("off → 판정 안 함을 명시(침묵 금지)", () => {
  const root = repo({ verificationRunPolicy: "off", verificationRunLedger: ".sdd/runs.jsonl" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: OFF — verificationRunPolicy/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("enum 밖 정책 값 → exit 1(문법화)", () => {
  const root = repo({ verificationRunPolicy: "kinda" });
  try { assert.equal(run(root).code, 1); } finally { rmSync(root, { recursive: true, force: true }); }
});
