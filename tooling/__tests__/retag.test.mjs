// tooling/__tests__/retag.test.mjs
// 추적 태그 마이그레이션(SPEC-011): 재도출 재번호 시 @covers/@verifies·매니페스트 키를
// 마이그레이션 맵(old→new|null)으로 결정적 치환 — 재태깅 비용 제거.
// 원칙: 검증 실패 시 무변경(all-or-nothing), null(폐기)은 보고만(잔존은 R1 그물).
// @covers SPEC-011/FR-001
// @covers SPEC-011/FR-002
// @covers SPEC-011/FR-003
// @covers SPEC-011/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = new URL("../sdd-retag.mjs", import.meta.url).pathname;
const CTAG = "// @cov" + "ers ";   // 자기 게이트 스캔 중화
const VTAG = "# @veri" + "fies ";

function fixture(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-retag-"));
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

function run(root, args) {
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

const NEW_SPEC = "**Spec**: `SPEC-002`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n";

// ── 검증: T0/T1/T2 — 실패 시 무변경 (FR-001) ──

test("retag: 맵 문법 위반(T1)·dangling 대상(T2) → exit 1 + 파일 무변경(all-or-nothing)", () => {
  const code = CTAG + "SPEC-001/FR-001\ntest('x', () => {});\n";
  const cases = [
    [{ "not-a-key": "SPEC-002/FR-001" }, /T1 맵 키 형식 위반 "not-a-key"/],
    [{ "SPEC-001/FR-001": "whatever" }, /T1 맵 값 형식 위반/],
    [{ "SPEC-001/FR-001": "SPEC-002/FR-999" }, /T2 dangling 대상 .*SPEC-002\/FR-999/],
  ];
  for (const [map, re] of cases) {
    const root = fixture({ "sdd/specs/SPEC-002.md": NEW_SPEC, "src/a.test.mjs": code, "map.json": map });
    try {
      const r = run(root, ["map.json", "--write"]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, re);
      assert.equal(readFileSync(join(root, "src/a.test.mjs"), "utf8"), code); // 무변경
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── dry-run 보고 (FR-002) ──

test("retag dry-run: 치환 계획(file:line)·manifest rename·폐기(null)·참조 0건 보고 + 파일 무변경", () => {
  const code = CTAG + "SPEC-001/FR-001\n" + CTAG + "SPEC-001/FR-003\ntest('x', () => {});\n";
  const root = fixture({
    "sdd/specs/SPEC-002.md": NEW_SPEC,
    "src/a.test.mjs": code,
    "sdd/smoke.json": { "SPEC-001/FR-001": { method: "smoke", evidence: "x" } },
    "map.json": { "SPEC-001/FR-001": "SPEC-002/FR-001", "SPEC-001/FR-003": null, "SPEC-001/FR-777": "SPEC-002/FR-002" },
  }, { smokeManifest: "sdd/smoke.json" });
  try {
    const r = run(root, ["map.json"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /rewrites:2 manual-removal:1 mode:dry-run/);
    assert.match(r.out, /src\/a\.test\.mjs:1 .* SPEC-001\/FR-001 → SPEC-002\/FR-001/);
    assert.match(r.out, /sdd\/smoke\.json 키 SPEC-001\/FR-001 → SPEC-002\/FR-001/);
    assert.match(r.out, /SPEC-001\/FR-003 → \(폐기 — 수동 제거 대상/);
    assert.match(r.out, /⚠ "SPEC-001\/FR-777": 참조 0건/);
    assert.equal(readFileSync(join(root, "src/a.test.mjs"), "utf8"), code); // dry-run 무변경
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── --write 적용·멱등 (FR-003) ──

test("retag --write: @covers/@verifies 치환 + manifest 키 rename, 재실행은 참조 0건(멱등)", () => {
  const root = fixture({
    "sdd/specs/SPEC-002.md": NEW_SPEC,
    "src/a.test.mjs": CTAG + "SPEC-001/FR-001\ntest('x', () => {});\n",
    "src/smoke.sh": VTAG + "SPEC-001/FR-002 smoke: 왕복\n",
    "sdd/smoke.json": { "SPEC-001/FR-002": { method: "smoke", evidence: "src/smoke.sh — 왕복" } },
    "map.json": { "SPEC-001/FR-001": "SPEC-002/FR-001", "SPEC-001/FR-002": "SPEC-002/FR-002" },
  }, { smokeManifest: "sdd/smoke.json" });
  try {
    const w = run(root, ["map.json", "--write"]);
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, /적용 완료/);
    assert.match(readFileSync(join(root, "src/a.test.mjs"), "utf8"), /SPEC-002\/FR-001/);
    assert.match(readFileSync(join(root, "src/smoke.sh"), "utf8"), /SPEC-002\/FR-002/);
    const m = JSON.parse(readFileSync(join(root, "sdd/smoke.json"), "utf8"));
    assert.ok(m["SPEC-002/FR-002"]);
    assert.equal(m["SPEC-001/FR-002"], undefined);
    const again = run(root, ["map.json"]);
    assert.match(again.out, /rewrites:0/);
    assert.match(again.out, /참조 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 경계 강제 (FR-004) ──

test("retag: 서픽스 키 절단 치환 금지 — FR-001 맵이 FR-001a 태그를 건드리지 않음", () => {
  const spec = "**Spec**: `SPEC-002`\n- **FR-001** (event): x.\n- **FR-001a** (event): y.\n";
  const code = CTAG + "SPEC-002/FR-001a\ntest('y', () => {});\n";
  const root = fixture({
    "sdd/specs/SPEC-002.md": spec,
    "src/a.test.mjs": code,
    "map.json": { "SPEC-002/FR-001": "SPEC-002/FR-001a" },
  });
  try {
    const r = run(root, ["map.json", "--write"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /참조 0건/); // FR-001 단독 참조는 없음 — FR-001a는 다른 키
    assert.equal(readFileSync(join(root, "src/a.test.mjs"), "utf8"), code);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
