// 감시자 실재(SPEC-048) — **각 프로젝트가 방법론을 무시한다**(오너 실측).
// 무시는 순환 때문에 안 잡힌다: 무시하는 프로젝트는 게이트를 안 돌리고, 그러면 게이트가
// 무시를 고발할 기회가 없다. 순환을 끊는 것은 **우회 불가한 채널**뿐이고 그건 서버측 CI다 —
// 로컬 훅은 `--no-verify`로 우회되고 웹 UI 머지는 훅을 아예 타지 않는다.
// @covers SPEC-048/FR-001
// @covers SPEC-048/FR-002
// @covers SPEC-048/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReceipt, missingGates, ciWiring, DEFAULT_WATCHDOG_RECEIPT } from "../watchdog-lib.mjs";

const OK_RECEIPT = { kitCommit: "abc1234def", installedAt: "2026-08-10T00:00:00Z", gate: "node", gates: ["scripts/check-fr-coverage.mjs"], hooks: [".git/hooks/pre-commit"] };

test("영수증 형식은 문법화한다 — 정의되지 않은 형태를 조용히 통과시키지 않는다", () => {
  assert.deepEqual(parseReceipt(JSON.stringify(OK_RECEIPT)).errors, []);
  assert.match(parseReceipt("not json").errors[0], /JSON으로 파싱되지 않는다/);
  // 파서 예외 문구는 판정 문장에 넣지 않는다 — 런타임마다 달라 양판 바이트 동일이 깨진다.
  assert.doesNotMatch(parseReceipt("not json").errors[0], /line|column|Unexpected|Expecting/);
  assert.match(parseReceipt("[]").errors[0], /객체여야 한다/);
  assert.equal(parseReceipt(JSON.stringify({ gates: ["a"] })).errors.length, 1, "installedAt 없음");
  assert.equal(parseReceipt(JSON.stringify({ installedAt: "x" })).errors.length, 1, "gates 없음");
});

test("영수증이 선언한 게이트가 사라졌으면 지목한다 — 지워진 감시자는 스스로 알리지 않는다", () => {
  const { receipt } = parseReceipt(JSON.stringify({ ...OK_RECEIPT, gates: ["a.mjs", "b.mjs"] }));
  assert.deepEqual(missingGates(receipt, (g) => g === "a.mjs"), ["b.mjs"]);
  assert.deepEqual(missingGates(receipt, () => true), []);
});

test("CI 배선은 스윕 진입점의 등장으로 본다 — 마커는 프로젝트가 갈아끼운다", () => {
  const files = [
    { path: ".github/workflows/ci.yml", text: "run: npm test\n" },
    { path: ".github/workflows/sdd.yml", text: "run: node scripts/sdd-sync.mjs --strict\n" },
  ];
  assert.deepEqual(ciWiring(files), { wired: [".github/workflows/sdd.yml"], files: 2 });
  assert.deepEqual(ciWiring(files, ["npm test"]).wired, [".github/workflows/ci.yml"]);
  assert.deepEqual(ciWiring([]), { wired: [], files: 0 });
});

test("영수증 기본 경로는 `.sdd/`가 아니다 — 그쪽은 gitignore라 채택 선언이 사라진다", () => {
  assert.equal(DEFAULT_WATCHDOG_RECEIPT, "sdd/adoption.json");
  assert.doesNotMatch(DEFAULT_WATCHDOG_RECEIPT, /^\.sdd\//);
});

// ── 게이트 e2e ────────────────────────────────────────────────────────────
const LIBS = ["sdd-config.mjs", "ownership-keys.mjs", "verdict-lib.mjs", "spec-sync-lib.mjs",
  "watchdog-lib.mjs", "check-watchdog.mjs"];
function repo(files, config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-wd-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(new URL(`../${f}`, import.meta.url).pathname, join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function run(root) {
  const gate = join(root, "scripts", "check-watchdog.mjs");
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const CI = "name: sdd\non: [push]\njobs:\n  g:\n    steps:\n      - run: node scripts/sdd-sync.mjs --strict\n";

test("CI에 스윕이 없으면 hard에서 막는다 — 우회 불가한 채널이 없는 상태다", () => {
  const root = repo({ "sdd/adoption.json": JSON.stringify(OK_RECEIPT), "scripts/check-fr-coverage.mjs": "//\n" },
    { watchdogPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /우회 불가한 감시 채널이 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("영수증이 없으면 표면화한다 — \"채택했다\"가 자기신고로만 존재하는 상태다", () => {
  const root = repo({ ".github/workflows/sdd.yml": CI }, { watchdogPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /채택 영수증이 없다/);
    assert.match(r.out, /커밋한다/, "영수증은 커밋 대상이라는 사실을 알려야 한다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("영수증이 선언한 게이트가 지워졌으면 막는다 — 지워진 강제는 강제가 아니다", () => {
  const root = repo({ ".github/workflows/sdd.yml": CI, "sdd/adoption.json": JSON.stringify(OK_RECEIPT) },
    { watchdogPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /지금 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CI 배선 + 영수증 + 게이트 실재면 통과한다", () => {
  const root = repo({ ".github/workflows/sdd.yml": CI, "sdd/adoption.json": JSON.stringify(OK_RECEIPT), "scripts/check-fr-coverage.mjs": "//\n" },
    { watchdogPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ 우회 불가한 채널\(CI\)에 스윕이 배선돼 있고/);
    assert.match(r.out, /채택 2026-08-10/, "채택 시점을 매 실행 보여준다(상류 낡음은 판정하지 않는다)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("advisory는 막지 않고 표면화한다 — 채택 중 프로젝트를 벽으로 세우지 않는다", () => {
  const root = repo({}, {});
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /⚠ CI에 스윕이 배선되지 않았다/);
    assert.match(r.out, /판정: JUDGED — 위반 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("off는 판정하지 않는다고 선언한다 — clean이 아니다(SPEC-040)", () => {
  const root = repo({}, { watchdogPolicy: "off" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: OFF/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
