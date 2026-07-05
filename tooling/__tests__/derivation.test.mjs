// tooling/__tests__/derivation.test.mjs
// 재도출 소스 회계(SPEC-009): 소스 클래스 enum 전 회계 · evidence/reason 존재 ·
// 검출 교차검사(실재하는데 none = 조용한 미인제스트 = exit 1) · Change Log 근거(선제 캡처).
// 원칙: 미설정(null)이면 no-op(하위호환) — 회계는 켜는 순간부터 전 클래스 강제.
// @covers SPEC-009/FR-001
// @covers SPEC-009/FR-002
// @covers SPEC-009/FR-003
// @covers SPEC-009/FR-004
// @covers SPEC-009/FR-005
// @covers SPEC-009/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = new URL("../check-derivation.mjs", import.meta.url).pathname;
const COMPLETENESS = new URL("../check-spec-completeness.mjs", import.meta.url).pathname;
const TAG = "// @cov" + "ers "; // 자기 게이트 스캔 중화

function fixture(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-deriv-"));
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

function run(root, gate = GATE, args = []) {
  try {
    const out = execFileSync("node", [gate, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// 전 클래스가 정직 회계된 기준 매니페스트(빈 픽스처 기준 — 검출 0에 맞춘 none/deferred).
const BASE = {
  "code": { status: "none", reason: "스캔함 — scanDirs에 코드 없음" },
  "iac": { status: "none", reason: "스캔함 — IaC 없음" },
  "ci": { status: "none", reason: "스캔함 — CI 정의 없음" },
  "ops-docs": { status: "none", reason: "스캔함 — 운영 문서 없음" },
  "build-evidence": { status: "deferred", reason: "CI 부재 — 빌드 아티팩트 없음" },
  "vcs-history": { status: "mapped", evidence: "커밋 메시지·Spec-Impact 트레일러 관례" },
  "prior-traceability": { status: "none", reason: "스캔함 — 기존 태그 없음" },
  "prior-intent": { status: "none", reason: "기존 스펙 없음(최초 채택)" },
  "human-intent": { status: "mapped", evidence: "Clarifications·Review Log 선제 캡처" },
};
const CFG = { derivationManifest: "sdd/derivation.json" };

// ── 하위호환·D0 (FR-001·FR-005) ──

test("derivation: derivationManifest 미설정 → no-op exit 0 (하위호환)", () => {
  const root = fixture({});
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no-op/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("derivation: 파일 없음·JSON 파싱 실패·비객체 최상위 → D0 exit 1", () => {
  const cases = [
    [{}, /D0 derivationManifest 파일 없음/],
    [{ "sdd/derivation.json": "{broken" }, /D0 derivationManifest JSON 파싱 실패/],
    [{ "sdd/derivation.json": "[]" }, /D0 derivationManifest 최상위는 객체여야 함/],
  ];
  for (const [files, re] of cases) {
    const root = fixture(files, CFG);
    try {
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, re);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── D1·D2: 클래스 enum·status·evidence/reason (FR-002·FR-003) ──

test("derivation: 미정의 클래스 키 → D1 exit 1 (정의되지 않은 예외 금지)", () => {
  const root = fixture({ "sdd/derivation.json": { ...BASE, "vibes": { status: "mapped", evidence: "x" } } }, CFG);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /D1 미정의 소스 클래스 "vibes"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("derivation: 미회계 클래스(누락) → D1 exit 1 (조용한 미인제스트 금지)", () => {
  const { iac: _omit, ...partial } = BASE;
  const root = fixture({ "sdd/derivation.json": partial }, CFG);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /D1 미회계 소스 클래스 "iac"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("derivation: status enum 밖·mapped 빈 evidence·none 빈 reason → D1/D2 exit 1", () => {
  const cases = [
    [{ ...BASE, iac: { status: "scanned" } }, /D1 "iac": status는 mapped\|none\|deferred/],
    [{ ...BASE, iac: { status: "mapped", evidence: " " } }, /D2 "iac": mapped는 evidence 필수/],
    [{ ...BASE, iac: { status: "none" } }, /D2 "iac": none는 reason 필수/],
  ];
  for (const [manifest, re] of cases) {
    const root = fixture({ "sdd/derivation.json": manifest }, CFG);
    try {
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, re);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── D3: 검출 교차검사 (FR-004) ──

test("derivation: IaC 파일 실재 + iac:none → D3 exit 1 / mapped면 통과", () => {
  const files = { "infra/main.tf": "resource {}\n", "sdd/derivation.json": BASE };
  const none = fixture(files, CFG);
  const mapped = fixture({
    ...files,
    "sdd/derivation.json": { ...BASE, iac: { status: "mapped", evidence: "INFRA-001로 매핑" } },
  }, CFG);
  try {
    const r = run(none);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /D3 iac: none 선언인데 검출 1건\(예: infra\/main\.tf\)/);
    const ok = run(mapped);
    assert.equal(ok.code, 0, ok.out);
  } finally { rmSync(none, { recursive: true, force: true }); rmSync(mapped, { recursive: true, force: true }); }
});

test("derivation: code(scanDirs 파일)·prior-traceability(기존 태그) 검출 + none → D3 exit 1", () => {
  const spec = "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n";
  const root = fixture({
    "sdd/specs/SPEC-001.md": spec,
    "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => { assert.ok(1); });\n",
    "sdd/derivation.json": BASE,
  }, CFG);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /D3 code: none 선언인데 검출/);
    assert.match(r.out, /D3 prior-traceability: none 선언인데 검출/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("derivation: mapped 선언인데 검출 0건 → warn(레포 밖 실체 허용) + exit 0", () => {
  const root = fixture({
    "sdd/derivation.json": { ...BASE, ci: { status: "mapped", evidence: "사내 Jenkins(레포 밖) build #9" } },
  }, CFG);
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠ ci: mapped 선언이나 레포 내 검출 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("derivation: 전 클래스 정직 회계 → OK + 집계 리포트 / derivationClassGlobs 미정의 클래스 → D1", () => {
  const ok = fixture({ "sdd/derivation.json": BASE }, CFG);
  const badGlob = fixture({ "sdd/derivation.json": BASE },
    { ...CFG, derivationClassGlobs: { "vibes": ["**/*.vibe"] } });
  try {
    const r = run(ok);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /classes:9 accounted:9 \(mapped:2 none:6 deferred:1\)/);
    assert.match(r.out, /Derivation 게이트: OK/);
    const b = run(badGlob);
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /D1 derivationClassGlobs 미정의 클래스 "vibes"/);
  } finally { rmSync(ok, { recursive: true, force: true }); rmSync(badGlob, { recursive: true, force: true }); }
});

// ── 선제 캡처: Change Log 근거 존재 (FR-006, completeness 게이트 소비) ──

test("completeness: 실기록 Change Log 행의 근거 빈 값 → warn·--strict exit 1 / placeholder 행은 무시", () => {
  const spec = (rationale) => "**Spec**: `SPEC-001`  **Status**: Draft\n- **FR-001** (event): x.\n**Given** x\n- **SC-001**: 90%\n\n" +
    "## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| [YYYY-MM-DD] | 초안 | |\n| 2026-07-05 | 개정 | " + rationale + " |\n";
  const missing = fixture({ "sdd/specs/SPEC-001.md": spec("") });
  const filled = fixture({ "sdd/specs/SPEC-001.md": spec("재생성 비교 결론 반영") });
  try {
    const warn = run(missing, COMPLETENESS);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /Change Log 2026-07-05 행의 근거 칸이 빈 값/);
    assert.equal(run(missing, COMPLETENESS, ["--strict"]).code, 1);
    const ok = run(filled, COMPLETENESS);
    assert.equal(ok.code, 0, ok.out);
    assert.doesNotMatch(ok.out, /근거 칸이 빈 값/);
  } finally { rmSync(missing, { recursive: true, force: true }); rmSync(filled, { recursive: true, force: true }); }
});

// ── 분류 기본값 보정: 인프라/CI 동반·보조 파일이 "other"로 새지 않는다 ──

test("derivation D3: .dockerignore만 있어도 iac 실재 — none 선언 = exit 1 (동반 파일 분류 회귀)", () => {
  const root = fixture({ ".dockerignore": "node_modules\n", "sdd/derivation.json": BASE }, CFG);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /D3 iac: none 선언인데 검출 1건/);
    assert.match(r.out, /\.dockerignore/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("derivation D3: composite action(.github/actions)만 있어도 ci 실재 — none 선언 = exit 1", () => {
  const root = fixture({ ".github/actions/setup/action.yml": "runs: {}\n", "sdd/derivation.json": BASE }, CFG);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /D3 ci: none 선언인데 검출 1건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
