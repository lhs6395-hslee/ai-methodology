// tooling/__tests__/smoke-scan.test.mjs
// smoke 증거 자동 수집(SPEC-010): @verifies 태그 스캔 → smokeManifest 자동 채움.
// 원칙: 수동 연결 제거 — 태그가 사는 파일(테스트·CI 정의·runbook)이 증거의 SSOT,
// 매니페스트는 재생성물(--write)이며 check 모드가 드리프트를 차단한다.
// @covers SPEC-010/FR-001
// @covers SPEC-010/FR-002
// @covers SPEC-010/FR-003
// @covers SPEC-010/FR-004
// @covers SPEC-010/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = new URL("../sdd-smoke-scan.mjs", import.meta.url).pathname;
const VTAG = "# @veri" + "fies "; // 자기 게이트(스캔) 중화 — 픽스처 파일에만 실태그 기록

function fixture(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-smoke-"));
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

const SPEC = "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n";
const CFG = { smokeManifest: "sdd/smoke.json" };

// ── 수집·생성 (FR-001·FR-003) ──

test("smoke-scan --write: CI 정의·스크립트의 태그를 수집해 매니페스트 생성(경로 provenance·정렬 결정성)", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC,
    "src/ci/deploy.yml": "# 배포 후 왕복 확인\n" + VTAG + "SPEC-001/FR-001 smoke: webhook→ALB→Jenkins build 왕복 확인\n",
    "src/scripts/smoke.sh": VTAG + "SPEC-001/FR-001 smoke: curl /health 200 확인\n",
    "src/run.md": VTAG + "SPEC-001/FR-002 deferred: 스테이징 환경 대기\n",
  }, CFG);
  try {
    const w = run(root, ["--write"]);
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, /added:2/);
    const m = JSON.parse(readFileSync(join(root, "sdd/smoke.json"), "utf8"));
    assert.deepEqual(m["SPEC-001/FR-001"], {
      method: "smoke",
      evidence: "src/ci/deploy.yml — webhook→ALB→Jenkins build 왕복 확인 · src/scripts/smoke.sh — curl /health 200 확인",
    });
    assert.deepEqual(m["SPEC-001/FR-002"], { method: "deferred", reason: "src/run.md — 스테이징 환경 대기" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("smoke-scan --write: 태그 없는 키(수동 엔트리)는 보존, 태그 있는 키는 태그가 정본", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC,
    "src/smoke.sh": VTAG + "SPEC-001/FR-001 smoke: 자동 수집 증거\n",
    "sdd/smoke.json": {
      "SPEC-001/FR-001": { method: "smoke", evidence: "낡은 수동 증거" },
      "SPEC-001/FR-002": { method: "deferred", reason: "수동 회계 — 보존돼야 함" },
    },
  }, CFG);
  try {
    const w = run(root, ["--write"]);
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, /updated:1 kept:1/);
    const m = JSON.parse(readFileSync(join(root, "sdd/smoke.json"), "utf8"));
    assert.equal(m["SPEC-001/FR-001"].evidence, "src/smoke.sh — 자동 수집 증거");
    assert.equal(m["SPEC-001/FR-002"].reason, "수동 회계 — 보존돼야 함");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 검증 에러 (FR-002) ──

test("smoke-scan: dangling 키(V1)·유효 키 뒤 형식 위반(V0)·method 충돌(V3) → exit 1", () => {
  const cases = [
    [{ "src/a.sh": VTAG + "SPEC-001/FR-999 smoke: x\n" }, /V1 dangling .*SPEC-001\/FR-999/],
    [{ "src/a.sh": VTAG + "SPEC-001/FR-001\n" }, /V0 태그 형식 위반/],
    [{ "src/a.sh": VTAG + "SPEC-001/FR-001 smoke evidence-콜론-없음\n" }, /V0 태그 형식 위반/],
    [{
      "src/a.sh": VTAG + "SPEC-001/FR-001 smoke: x\n",
      "src/b.sh": VTAG + "SPEC-001/FR-001 e2e: y\n",
    }, /V3 "SPEC-001\/FR-001": method 충돌\(e2e vs smoke\)/],
  ];
  for (const [files, re] of cases) {
    const root = fixture({ "sdd/specs/SPEC-001.md": SPEC, ...files }, CFG);
    try {
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, re);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("smoke-scan: 태그 있는데 smokeManifest 미설정 → exit 1 / 산문 언급(키 없음)은 무시", () => {
  const noManifest = fixture({
    "sdd/specs/SPEC-001.md": SPEC,
    "src/a.sh": VTAG + "SPEC-001/FR-001 smoke: x\n",
  });
  const prose = fixture({
    "sdd/specs/SPEC-001.md": SPEC,
    "src/doc.md": "태그 문법은 @veri" + "fies <SPEC-ID>/FR-NNN <method>: <evidence> 형식.\n",
  });
  try {
    const r = run(noManifest);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /smokeManifest 미설정/);
    const p = run(prose);
    assert.equal(p.code, 0, p.out);
    assert.match(p.out, /no-op/);
  } finally { rmSync(noManifest, { recursive: true, force: true }); rmSync(prose, { recursive: true, force: true }); }
});

// ── check 드리프트 (FR-004) + 하위호환 (FR-005) ──

test("smoke-scan check: 태그 파생 엔트리 누락/불일치 → exit 1, --write 후 → exit 0", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": SPEC,
    "src/smoke.sh": VTAG + "SPEC-001/FR-001 smoke: 왕복 확인\n",
    "sdd/smoke.json": { "SPEC-001/FR-002": { method: "deferred", reason: "수동" } },
  }, CFG);
  try {
    const drift = run(root);
    assert.equal(drift.code, 1, drift.out);
    assert.match(drift.out, /S1 "SPEC-001\/FR-001": manifest에 없음/);
    assert.equal(run(root, ["--write"]).code, 0);
    const ok = run(root);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /수동 엔트리 1건 보존/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("smoke-scan: 태그도 매니페스트도 없음 → no-op exit 0 (하위호환)", () => {
  const root = fixture({ "sdd/specs/SPEC-001.md": SPEC });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no-op/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
