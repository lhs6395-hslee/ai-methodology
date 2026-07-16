// tooling/__tests__/fr-accounting.test.mjs
// 검증 회계(SPEC-007): strictSpecs(전역 --strict의 점진 브리지) ·
// requireAccounting(R3: unit ∨ smoke ∨ deferred) · smokeManifest(회계 매니페스트).
// 원칙: 기본값(모두 미설정)이면 현행 동작과 바이트 동일 — "조용히 미검증"은 R3가 제거.
// @covers SPEC-007/FR-001
// @covers SPEC-007/FR-002
// @covers SPEC-007/FR-003
// @covers SPEC-007/FR-004
// @covers SPEC-007/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = new URL("../check-fr-coverage.mjs", import.meta.url).pathname;
const TAG = "// @cov" + "ers "; // 자기 게이트 스캔 중화

function fixture(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-acct-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

function run(root, args = []) {
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

const SPEC2FR = "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n";
const COVER1 = TAG + "SPEC-001/FR-001\ntest('x', () => { assert.ok(1); });\n";

// ── strictSpecs (FR-001·FR-002) ──

test("strictSpecs 등재 spec: 부분 커버 → --strict 없이도 exit 1 (R2(strictSpecs))", () => {
  const root = fixture({ "sdd/specs/SPEC-001.md": SPEC2FR, "src/a.test.mjs": COVER1 },
    { strictSpecs: ["SPEC-001"] });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R2\(strictSpecs\) SPEC-001: 1\/2/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("strictSpecs 등재 spec: 커버 0개도 exit 1 / 미등재 spec은 incremental warn 유지", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC2FR,
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n- **FR-001** (event): z.\n",
  }, { strictSpecs: ["SPEC-001"] });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R2\(strictSpecs\) SPEC-001: 0\/2/);
    assert.doesNotMatch(r.out, /R2\(strictSpecs\) SPEC-002/); // 미등재는 warn만
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("strictSpecs 등재 spec: smoke/deferred는 대체 불가 — manifest 있어도 exit 1", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC2FR,
    "src/a.test.mjs": COVER1,
    "sdd/smoke.json": { "SPEC-001/FR-002": { method: "smoke", evidence: "scripts/smoke.sh 왕복 확인" } },
  }, { strictSpecs: ["SPEC-001"], smokeManifest: "sdd/smoke.json" });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R2\(strictSpecs\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("strictSpecs에 존재하지 않는 spec ID → exit 1 (조용한 스킵 금지)", () => {
  const root = fixture({ "sdd/specs/SPEC-001.md": SPEC2FR, "src/a.test.mjs": COVER1 },
    { strictSpecs: ["SPEC-999"] });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /strictSpecs에 존재하지 않는 spec "SPEC-999"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── requireAccounting (FR-003) ──

test("requireAccounting: 미회계 FR → R3 exit 1, manifest로 smoke/deferred 회계되면 통과", () => {
  const files = { "sdd/specs/SPEC-001.md": SPEC2FR, "src/a.test.mjs": COVER1 };
  const bare = fixture(files, { requireAccounting: true });
  const accounted = fixture({
    ...files,
    "sdd/smoke.json": { "SPEC-001/FR-002": { method: "deferred", reason: "UI 확정 대기" } },
  }, { requireAccounting: true, smokeManifest: "sdd/smoke.json" });
  try {
    const fail = run(bare);
    assert.equal(fail.code, 1, fail.out);
    assert.match(fail.out, /R3 unaccounted SPEC-001\/FR-002/);
    const pass = run(accounted);
    assert.equal(pass.code, 0, pass.out);
    assert.match(pass.out, /deferred:1/);
  } finally { rmSync(bare, { recursive: true, force: true }); rmSync(accounted, { recursive: true, force: true }); }
});

// ── smokeManifest 검증 (FR-004) ──

test("smokeManifest: dangling 키(없는 FR) → exit 1", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC2FR,
    "sdd/smoke.json": { "SPEC-001/FR-999": { method: "smoke", evidence: "x" } },
  }, { smokeManifest: "sdd/smoke.json" });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /M1 dangling manifest 키 "SPEC-001\/FR-999"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("smokeManifest: 키 문법 위반·빈 evidence·빈 reason·파일 없음 → 각각 exit 1", () => {
  const spec = { "sdd/specs/SPEC-001.md": SPEC2FR };
  const cases = [
    [{ "sdd/smoke.json": { "SPEC-001": { method: "smoke", evidence: "x" } } }, /M1 manifest 키 형식 위반/],
    [{ "sdd/smoke.json": { "SPEC-001/FR-001": { method: "smoke", evidence: " " } } }, /M2 .*evidence 필수/],
    [{ "sdd/smoke.json": { "SPEC-001/FR-001": { method: "deferred" } } }, /M2 .*reason 필수/],
    [{ "sdd/smoke.json": { "SPEC-001/FR-001": {} } }, /M2 .*method 없음/],
    [{}, /M0 smokeManifest 파일 없음/],
  ];
  for (const [extra, re] of cases) {
    const root = fixture({ ...spec, ...extra }, { smokeManifest: "sdd/smoke.json" });
    try {
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, re);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 리포트·분류 우선순위 (FR-005) + 하위호환 ──

test("회계 리포트: accounted(unit/smoke/deferred/unaccounted) 집계 + unit이 manifest보다 우선", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC2FR + "- **FR-003** (event): z.\n",
    "src/a.test.mjs": COVER1,
    "sdd/smoke.json": {
      "SPEC-001/FR-001": { method: "smoke", evidence: "unit과 중복 — unit으로 집계돼야 함" },
      "SPEC-001/FR-002": { method: "smoke", evidence: "scripts/smoke.sh 왕복" },
    },
  }, { smokeManifest: "sdd/smoke.json" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out); // requireAccounting 아님 — unaccounted는 warn 영역
    assert.match(r.out, /accounted\(unit:1 smoke:1 deferred:0 planned:0 unaccounted:1\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("하위호환: 회계 config 전부 미설정이면 리포트에 accounted 세그먼트 없음(현행 동작)", () => {
  const root = fixture({ "sdd/specs/SPEC-001.md": SPEC2FR, "src/a.test.mjs": COVER1 });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /accounted\(/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-018/FR-005
test("Planned 스펙: 0-coverage FR이 requireAccounting에서 planned 회계(R3 미검증 아님)", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Planned\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n",
  }, { requireAccounting: true });
  const r = run(dir);
  assert.equal(r.code, 0, r.out);                 // Planned → R3 통과(미검증 아님)
  assert.match(r.out, /planned:2/, r.out);        // 리포트에 planned 2
  assert.doesNotMatch(r.out, /R3 unaccounted/);
  // 대조: Active면 같은 0-cov가 R3로 exit 1
  const dir2 = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Active\n- **FR-001** (event): x.\n",
  }, { requireAccounting: true });
  assert.equal(run(dir2).code, 1, "Active 0-cov는 여전히 R3 미검증");
});

// @covers SPEC-018/FR-007
test("Planned 모순: Status Planned인데 unit 커버 FR 실재 → hard exit 1(회계 침묵기 차단, 감사 T2)", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Planned\n- **FR-001** (event): x.\n",
    "src/a.test.mjs": "// @covers SPEC-001/FR-001\n",
  });
  const r = run(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Planned 모순 SPEC-001/);
  // 대조: 커버 0이면 Planned는 정상(FR-005 회계)
  const dir2 = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Planned\n- **FR-001** (event): x.\n",
  });
  assert.equal(run(dir2).code, 0);
});
