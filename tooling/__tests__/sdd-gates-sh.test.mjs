// tooling/__tests__/sdd-gates-sh.test.mjs
// 셸 런타임판(sdd_gates.sh)의 요구 ID 문법(서픽스·requirementIdPrefixes)과
// PREFIX 거버넌스가 Node 정본과 같은 판정을 내는지 검증. jq 없으면 skip.
// @covers SPEC-006/FR-002
// @covers SPEC-006/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SH = new URL("../sdd_gates.sh", import.meta.url).pathname;
const TAG = "// @cov" + "ers "; // 자기 게이트 스캔 중화

let hasJq = true;
try { execFileSync("jq", ["--version"], { stdio: "ignore" }); } catch { hasJq = false; }
const skip = hasJq ? false : { skip: "jq 없음" };

function fixture(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-sh-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], ...config }));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
  return root;
}

function runSh(root, args) {
  try {
    const out = execFileSync("sh", [SH, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("sh fr: 레터 서픽스 FR 선언·태그 인정 — dangling 아님 (A-2 회귀)", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001a\ntest('y', () => { assert.ok(1); });\n",
  });
  try {
    const r = runSh(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /dangling/);
    assert.match(r.out, /FRs:1 covered:1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sh fr: 2자 서픽스·서픽스+숫자 태그는 통째 불인정(절단 캡처 금지)", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001ab\n" + TAG + "SPEC-001/FR-001a1\n",
  });
  try {
    const r = runSh(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /dangling/);
    assert.match(r.out, /covered:0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sh fr: requirementIdPrefixes(NFR) 선언·태그 인정", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **NFR-001** (ubiquitous): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/NFR-001\ntest('y', () => { assert.ok(1); });\n",
  }, { requirementIdPrefixes: ["FR", "NFR"] });
  try {
    const r = runSh(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /FRs:1 covered:1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sh fr: 미등록 접두어(FEAT)는 조용히 건너뛰지 않고 exit 1, 사유 있으면 통과", skip, () => {
  const files = { "sdd/specs/FEAT-001.md": "# FEAT-001\n- **FR-001** (event): x.\n" };
  const bad = fixture(files);
  const ok = fixture(files, { specIdPrefixes: ["SPEC", "INFRA", "TEST", "FEAT"], prefixRationale: { FEAT: "레거시 기능군" } });
  try {
    const r = runSh(bad, ["fr"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FEAT/);
    assert.equal(runSh(ok, ["fr"]).code, 0);
  } finally { rmSync(bad, { recursive: true, force: true }); rmSync(ok, { recursive: true, force: true }); }
});

test("sh fr: config 없는 기본값도 Node와 동일(SPEC/INFRA/TEST) — INFRA spec 인정", skip, () => {
  const root = fixture({ "sdd/specs/INFRA-001.md": "# INFRA-001\n인프라 spec.\n" });
  try {
    const r = runSh(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
