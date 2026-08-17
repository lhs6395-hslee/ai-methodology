// 훅/게이트 사본 드리프트 (SPEC-059) — 같은 논리적 훅을 표현한다고 주장하는 두 파일이
// 실제로 같은 게이트를 부르는가.
// 실측 제보(소비 프로젝트, 2026-08-17): scripts/hooks/commit-msg(실제 설치됨)와
// scripts/sdd-commit-msg.sh(거의 동일 내용, 자기 헤더에 "내가 설치되는 훅"이라고 잘못 주장)가
// 이미 갈라져 있었다 — 후자에만 check-gate-escalation.mjs 호출이 있었다.
// @covers SPEC-059/FR-001
// @covers SPEC-059/FR-002
// @covers SPEC-059/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateCallsIn, validateDuplicateSourcePairs, driftFindings } from "../duplicate-source-lib.mjs";

const GATE = fileURLToPath(new URL("../check-duplicate-source-drift.mjs", import.meta.url));

// ── 순수 코어 ────────────────────────────────────────────────────────────────
test("gateCallsIn — 텍스트에서 check-*.mjs 호출 언급을 중복 없이 뽑는다", () => {
  const text = "node scripts/check-a.mjs\nnode scripts/check-b.mjs || exit 1\nnode scripts/check-a.mjs\n";
  assert.deepEqual(gateCallsIn(text), ["check-a.mjs", "check-b.mjs"]);
});

test("validateDuplicateSourcePairs — a·b·reason 필수, a===b는 거부", () => {
  assert.deepEqual(validateDuplicateSourcePairs([{ a: "", b: "y", reason: "r" }]).length, 1);
  assert.deepEqual(validateDuplicateSourcePairs([{ a: "x", b: "x", reason: "r" }]).length, 1);
  assert.deepEqual(validateDuplicateSourcePairs([{ a: "x", b: "y", reason: "" }]).length, 1);
  assert.deepEqual(validateDuplicateSourcePairs([{ a: "x", b: "y", reason: "r" }]), []);
});

test("실측 재현 — 한쪽에만 있는 게이트 호출을 드리프트로 지목한다", () => {
  const a = "node scripts/check-spec-sync.mjs\nnode scripts/check-fr-placement.mjs\n";
  const b = "node scripts/check-spec-sync.mjs\nnode scripts/check-fr-placement.mjs\nnode scripts/check-gate-escalation.mjs\n";
  const { onlyInA, onlyInB } = driftFindings(a, b);
  assert.deepEqual(onlyInA, []);
  assert.deepEqual(onlyInB, ["check-gate-escalation.mjs"]);
});

test("같은 호출 목록이면 드리프트 없음", () => {
  const text = "node scripts/check-a.mjs\n";
  assert.deepEqual(driftFindings(text, text), { onlyInA: [], onlyInB: [] });
});

// ── 게이트 e2e ────────────────────────────────────────────────────────────
function fixture(files, config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-dupsrc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("duplicateSourcePairs 미등록은 INERT — 검사할 사본 쌍이 없다는 뜻이지 통과가 아니다", () => {
  const root = fixture({}, { duplicateSourceDriftPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: INERT/);
    assert.match(r.out, /미등록/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("등록된 쌍이 갈렸으면 hard에서 차단한다", () => {
  const root = fixture({
    "hooks/a": "node scripts/check-spec-sync.mjs\n",
    "hooks/b": "node scripts/check-spec-sync.mjs\nnode scripts/check-gate-escalation.mjs\n",
  }, { duplicateSourcePairs: [{ a: "hooks/a", b: "hooks/b", reason: "테스트" }], duplicateSourceDriftPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /갈렸다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("등록된 쌍이 같은 목록을 부르면 통과한다", () => {
  const same = "node scripts/check-spec-sync.mjs\nnode scripts/check-gate-escalation.mjs\n";
  const root = fixture({ "hooks/a": same, "hooks/b": same },
    { duplicateSourcePairs: [{ a: "hooks/a", b: "hooks/b", reason: "테스트" }], duplicateSourceDriftPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ 등록된 모든 사본 쌍이/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("advisory는 막지 않고 표면화한다", () => {
  const root = fixture({
    "hooks/a": "node scripts/check-spec-sync.mjs\n",
    "hooks/b": "node scripts/check-spec-sync.mjs\nnode scripts/check-gate-escalation.mjs\n",
  }, { duplicateSourcePairs: [{ a: "hooks/a", b: "hooks/b", reason: "테스트" }] });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /⚠ .*갈렸다/);
    assert.match(r.out, /판정: JUDGED — 위반 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("한쪽 파일이 없으면 확인 못 함으로 분리한다 — 부재를 드리프트로 단정하지 않는다", () => {
  const root = fixture({ "hooks/a": "node scripts/check-x.mjs\n" },
    { duplicateSourcePairs: [{ a: "hooks/a", b: "hooks/missing", reason: "테스트" }], duplicateSourceDriftPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /확인 못 함 1건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("config 문법 위반(빈 reason)은 즉시 차단", () => {
  const root = fixture({}, { duplicateSourcePairs: [{ a: "x", b: "y", reason: "" }], duplicateSourceDriftPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /reason 필수/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("off는 판정하지 않는다고 선언한다", () => {
  const root = fixture({}, { duplicateSourcePairs: [{ a: "x", b: "y", reason: "r" }], duplicateSourceDriftPolicy: "off" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: OFF/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
