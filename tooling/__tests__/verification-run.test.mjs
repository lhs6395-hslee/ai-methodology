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
  assert.deepEqual(malformed.map((m) => m.why), ["JSON 아님", "asset·branch 둘 다 없음 — 무엇에 대한 기록인지 알 수 없다", 'outcome "GREEN" — JUDGED|OFF|INERT|SKIPPED|UNTYPED 중 하나']);
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

// ── 실행 관측 회계(SPEC-049) — 차단 분기가 필드에서 발화한 적이 있는가 ──────────
// 실측 제보(사례 6): 명세·구현·단위테스트가 모두 정상인데 두 기록이 만날 저장소가 없어
// **비교가 단 한 번도 수행되지 않았다.** 정적 검사로는 원리상 잡히지 않고, 증거는 매 실행 로그의
// 같은 한 줄("대조 생략")이었다 — 그 값이 몇 달간 달라지지 않은 사실을 읽는 장치만 없었다.
// @covers SPEC-049/FR-001
// @covers SPEC-049/FR-002
// @covers SPEC-049/FR-003
// @covers SPEC-049/FR-004
import {
  parseBranchLine, parseBranchLedger, classifyBranches, undeclaredBranches,
  validateBranchDeclarations, formatBranchLine, BRANCH_OUTCOMES,
} from "../branch-observation-lib.mjs";

const L = (o) => JSON.stringify(o);

test("분기 기록과 자산 기록은 다른 종류다 — 서로를 깨진 기록으로 오인하지 않는다", () => {
  // 실측: 이 구분 없이 분기 기록을 넣자 자산 축이 "asset 없음"으로 세어 hard에서 거짓 차단이 났다.
  assert.equal(parseBranchLine(L({ asset: "a", outcome: "JUDGED" })), null, "자산 기록은 분기 파서의 대상이 아니다");
  assert.deepEqual(parseBranchLine(L({ branch: "k", outcome: "FIRED", detail: "d" })), { branch: "k", outcome: "FIRED", detail: "d" });
  assert.equal(parseRunLine(L({ branch: "k", outcome: "FIRED" })), null, "분기 기록은 자산 축의 깨진 기록이 아니다");
});

test("알 수 없는 분기 결과는 깨진 기록이다 — 정의되지 않은 값을 조용히 통과시키지 않는다", () => {
  assert.deepEqual(BRANCH_OUTCOMES, ["FIRED", "PASSED", "SKIPPED"]);
  assert.equal(parseBranchLine(L({ branch: "k", outcome: "MAYBE" })).broken, true);
  assert.equal(parseBranchLine("not json").broken, true);
});

test("세 사실을 각각 회계한다 — 미관측·발화 0회·단조는 해소 방법이 다르다", () => {
  const declared = { A: "a를 막는다", B: "b를 막는다", C: "c를 막는다", D: "d를 막는다" };
  const { entries } = parseBranchLedger([
    L({ branch: "B", outcome: "PASSED", detail: "통과" }),                    // 발화 0회
    L({ branch: "C", outcome: "FIRED", detail: "대조 생략" }),                 // 단조 후보
    L({ branch: "C", outcome: "FIRED", detail: "대조 생략" }),
    L({ branch: "D", outcome: "FIRED", detail: "불일치 차단" }),
    L({ branch: "D", outcome: "PASSED", detail: "일치" }),
  ].join("\n"));
  const rows = classifyBranches(declared, entries);
  assert.deepEqual(rows.map((r) => [r.key, r.cls]), [["A", "unobserved"], ["B", "never-fired"], ["C", "monotone"], ["D", "observed"]]);
  // 실측 재현: C가 제보의 모양이다 — 발화는 하는데 사유가 몇 달간 한 번도 달라지지 않았다.
  assert.equal(rows.find((r) => r.key === "C").details, 1);
});

test("1회 기록은 단조가 아니다 — 변할 기회가 없었던 것을 고발하지 않는다", () => {
  const { entries } = parseBranchLedger(L({ branch: "A", outcome: "FIRED", detail: "x" }));
  assert.equal(classifyBranches({ A: "사유" }, entries)[0].cls, "observed");
});

test("선언되지 않은 키로 기록된 것은 표면화한다 — 조용히 버리면 그 기록은 없는 것과 같다", () => {
  const { entries } = parseBranchLedger([L({ branch: "known", outcome: "FIRED" }), L({ branch: "typo", outcome: "FIRED" })].join("\n"));
  assert.deepEqual(undeclaredBranches({ known: "사유" }, entries), ["typo"]);
});

test("사유 없는 분기 선언은 무언의 선언이다 — 무엇을 막는지 모르는 선언은 판정 근거가 못 된다", () => {
  assert.equal(validateBranchDeclarations({ A: "" }).length, 1);
  assert.deepEqual(validateBranchDeclarations({ A: "막는 것" }), []);
});

test("직렬화 왕복 — 기록한 줄을 그대로 다시 읽는다", () => {
  const line = formatBranchLine({ branch: "k", outcome: "FIRED", detail: "d", at: "2026-08-10T00:00:00Z" });
  assert.deepEqual(parseBranchLine(line), { branch: "k", outcome: "FIRED", detail: "d" });
});

test("차단 출구마다 계측이 붙어 있다 — 계측 자리를 흩으면 하나를 빠뜨린다", () => {
  // 실측: 처음엔 spec-first 출구 하나만 계측했더니 unowned 차단 경로가 기록 없이 지나갔다.
  // 그게 바로 제보가 지적한 결함 계열이므로, 계약으로 고정한다.
  const src = readFileSync(new URL("../check-spec-sync.mjs", import.meta.url).pathname, "utf8");
  const lines = src.split("\n");
  const missing = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*process\.exit\(1\);\s*$/.test(lines[i])) continue;
    // 직전 6줄 안에 계측이 있어야 한다(메시지 여러 줄 뒤에 오는 형태를 허용).
    const near = lines.slice(Math.max(0, i - 6), i).join("\n");
    // **config 문법 위반 출구는 차단 분기가 아니다** — 그건 게이트가 판정을 시작조차 못 한
    // 상태이고(SPEC-040의 계열: 정의되지 않은 값은 판정 불가), 방법론 규칙이 발화한 것이 아니다.
    // 그걸 발화로 기록하면 원장이 "규칙이 돌았다"는 거짓을 담는다.
    if (/값 위반/.test(near)) continue;
    if (!near.includes("noteBranchFiring(")) missing.push(i + 1);
  }
  assert.deepEqual(missing, [], `계측 없는 차단 출구(라인): ${missing.join(", ")}`
    + " — 그 경로로 막히면 발화가 원장에 남지 않아 '한 번도 안 돌았다'로 오회계된다.");
});
