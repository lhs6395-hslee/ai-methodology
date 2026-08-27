// tooling/__tests__/sdd-gates-py.test.mjs
// Python 런타임판(sdd_gates.py)의 게이트 동작 + Node판과의 패리티 검증.
// 원칙: 런타임 간 동작 차이는 "조용히 빠지는" 클래스를 만든다(문법화) —
// 같은 픽스처를 Node·Python 양쪽에 넣어 exit code와 핵심 출력을 비교한다.
// @covers SPEC-006/FR-001
// @covers SPEC-006/FR-002
// @covers SPEC-006/FR-003
// @covers SPEC-008/FR-007
// @covers SPEC-017/FR-001
// @covers SPEC-027/FR-004
// @covers SPEC-030/FR-002
// @covers SPEC-002/FR-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PY = new URL("../sdd_gates.py", import.meta.url).pathname;
const TOOLING = new URL("..", import.meta.url).pathname;
// 배선 무결성 패리티가 픽스처 복사 목록을 폐포에서 계산하는 데 쓴다(손 목록은 다음 드리프트다).
import { localImports } from "../import-wiring-lib.mjs";
import { hashAction } from "../action-approval-lib.mjs";
const TAG = "// @cov" + "ers "; // 자기 게이트 스캔 중화

let hasPython = true;
try { execFileSync("python3", ["--version"], { stdio: "ignore" }); } catch { hasPython = false; }

function fixture(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-py-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function runPy(root, args, env = {}) {
  try {
    const out = execFileSync("python3", [PY, ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "", GITHUB_ACTIONS: "", ...env } });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

function runNode(root, gate, args = [], env = {}) {
  const GATE = new URL(`../${gate}`, import.meta.url).pathname;
  try {
    const out = execFileSync("node", [GATE, ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "", GITHUB_ACTIONS: "", ...env } });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

const skip = hasPython ? false : { skip: "python3 없음" };

// ── fr: A-2 회귀(서픽스) + PREFIX 거버넌스 + requirementIdPrefixes ──

test("py fr: 레터 서픽스 FR(FR-001a) 선언·태그 인정 — dangling 아님 (A-2 회귀)", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001a\ntest('y', () => { assert.ok(1); });\n",
  });
  try {
    const r = runPy(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /dangling/);
    assert.match(r.out, /FRs:1 covered:1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py fr: 2자 서픽스(FR-001ab) 태그는 통째 불인정 — 절단 캡처 금지", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001ab\ntest('y', () => { assert.ok(1); });\n",
  });
  try {
    const r = runPy(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /dangling/);
    assert.match(r.out, /covered:0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py fr: 미등록 접두어(FEAT)는 조용히 건너뛰지 않고 exit 1 (PREFIX 거버넌스 패리티)", skip, () => {
  const root = fixture({ "sdd/specs/FEAT-001.md": "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n" });
  try {
    const r = runPy(root, ["fr"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FEAT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py fr: 사유(prefixRationale) 있으면 비표준 접두어 통과 + requirementIdPrefixes(NFR) 인정", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **NFR-001** (ubiquitous): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/NFR-001\ntest('y', () => { assert.ok(1); });\n",
  }, { requirementIdPrefixes: ["FR", "NFR"] });
  try {
    const r = runPy(root, ["fr"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /FRs:1 covered:1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py fr: dangling @covers → exit 1 (R1)", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): THE SYSTEM SHALL x.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-999\ntest('x', () => { assert.ok(1); });\n",
  });
  try {
    const r = runPy(root, ["fr"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R1 dangling/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── ownership: dedup + 정규화·형식검증 패리티 ──

// @covers SPEC-014/FR-001
test("py fr: 접두어별 번호 001 미시작(INFRA-011/013) → Node·Python 둘 다 exit 1 + 출력 바이트 동일 (SPEC-014 패리티)", skip, () => {
  const root = fixture({
    "sdd/specs/INFRA-011.md": "**Spec**: `INFRA-011`\n**FR-001** THE SYSTEM SHALL x.\n",
    "sdd/specs/INFRA-013.md": "**Spec**: `INFRA-013`\n**FR-001** THE SYSTEM SHALL x.\n",
  });
  try {
    const py = runPy(root, ["fr"]);
    const nd = runNode(root, "check-fr-coverage.mjs");
    assert.equal(py.code, 1, py.out);
    assert.equal(nd.code, 1, nd.out);
    assert.equal(py.out, nd.out); // 바이트 동일(패리티)
    assert.match(nd.out, /INFRA 번호가 001부터 시작하지 않음/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-006/FR-002
test("py fr: FR을 번호 순이 아니게 선언한 스펙의 missing 목록 정렬 — Node·Python 바이트 동일", skip, () => {
  // 실측 패리티 결함: Python은 sorted, Node는 선언 순서였다 — 킷 스펙은 번호 순 선언이라
  // 자기적용에선 발현하지 않고 소비 프로젝트 PM(SPEC-004·SPEC-010)에서만 두 줄이 갈렸다.
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n\n## Functional Requirements (EARS)\n"
      + "- **FR-003** THE SYSTEM SHALL c.\n- **FR-001** THE SYSTEM SHALL a.\n- **FR-002** THE SYSTEM SHALL b.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-003\ntest('x', () => {});\n",
  };
  const a = fixture(files), b = fixture(files);
  try {
    const py = runPy(a, ["fr"]);
    const nd = runNode(b, "check-fr-coverage.mjs");
    assert.equal(py.out, nd.out); // 바이트 동일(패리티)
    assert.match(nd.out, /missing FR-001, FR-002/); // 선언 순서(003,001,002) 아니라 정렬
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-013/FR-008
test("py fr: 선언 범위 좁힘(Change Log bold FR = 비선언 / FR 섹션 라인시작 = 선언) → Node·Python 바이트 동일", skip, () => {
  // 한 픽스처에 세 케이스: (a) Change Log 표 행의 **FR-001**·**FR-002** = 비선언(거짓 중복 없음)
  // (b) SPEC-002는 불릿 없는 라인시작 **FR-057** 중복 = 진짜 중복 hard.
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n\n## Functional Requirements (EARS)\n"
      + "- **FR-001** THE SYSTEM SHALL a.\n**FR-002** THE SYSTEM SHALL b.\n"
      + "\n## Change Log\n| 2026-07-27 | SPEC-008 흡수 — FR-011→**FR-001**, FR-012→**FR-002** | 근거 |\n",
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n\n## Functional Requirements (EARS)\n"
      + "- **FR-057** THE SYSTEM SHALL a.\n**FR-057** THE SYSTEM SHALL b.\n",
  };
  const a = fixture(files), b = fixture(files);
  try {
    const py = runPy(a, ["fr"]);
    const nd = runNode(b, "check-fr-coverage.mjs");
    assert.equal(py.code, 1, py.out);
    assert.equal(nd.code, 1, nd.out);
    assert.equal(py.out, nd.out); // 바이트 동일(패리티)
    assert.match(nd.out, /SPEC-002\/FR-057 FR 번호 중복/);
    assert.doesNotMatch(nd.out, /SPEC-001\/FR-00[12] FR 번호 중복/); // Change Log 인용은 선언 아님
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-014/FR-005
test("py fr: 한 스펙 FR 번호 중복(FR-023 2회) → Node·Python 둘 다 exit 1 + 출력 바이트 동일 (SPEC-014 FR 패리티)", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n"
      + "- **FR-023** THE SYSTEM SHALL a.\n- **FR-024** THE SYSTEM SHALL b.\n- **FR-023** THE SYSTEM SHALL c.\n",
  };
  const a = fixture(files), b = fixture(files);
  try {
    const py = runPy(a, ["fr"]);
    const nd = runNode(b, "check-fr-coverage.mjs");
    assert.equal(py.code, 1, py.out);
    assert.equal(nd.code, 1, nd.out);
    assert.equal(py.out, nd.out); // 바이트 동일(패리티)
    assert.match(nd.out, /SPEC-001\/FR-023 FR 번호 중복/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-014/FR-006
test("py fr: FR 001미시작·결번 advisory → Node·Python 바이트 동일(exit 0), --strict 승격도 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-005** THE SYSTEM SHALL a.\n- **FR-007** THE SYSTEM SHALL b.\n",
  };
  const a = fixture(files), b = fixture(files);
  try {
    const py = runPy(a, ["fr"]);
    const nd = runNode(b, "check-fr-coverage.mjs");
    assert.equal(py.code, 0, py.out);
    assert.equal(nd.code, 0, nd.out);
    assert.equal(py.out, nd.out);
    assert.match(nd.out, /중간 결번: FR-006/);
    const pys = runPy(a, ["fr", "--strict"]);
    const nds = runNode(b, "check-fr-coverage.mjs", ["--strict"]);
    assert.equal(pys.code, 1, pys.out);
    assert.equal(nds.code, 1, nds.out);
    assert.equal(pys.out, nds.out);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-012/FR-001
test("py fr: ci 전용 소유 INFRA 스펙 → CICD 요구, Node·Python 바이트 동일 (CICD 접두어 패리티)", skip, () => {
  const files = {
    "sdd/specs/INFRA-001.md": "# INFRA-001\n**Spec**: `INFRA-001`\n- **FR-001** THE SYSTEM SHALL deliver.\n## Ownership\n- **Files**: .github/workflows/**\n",
    ".github/workflows/ci.yml": "on: push\n",
  };
  const a = fixture(files);
  const b = fixture(files);
  try {
    const p = runPy(a, ["fr"]);
    const n = runNode(b, "check-fr-coverage.mjs");
    assert.equal(p.code, 1, p.out);
    assert.equal(n.code, 1, n.out);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(n.out, /CICD- 접두어여야/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-015/FR-001
test("py fr: 테스트 인프라 격리(INFRA가 **/qa/** 소유) → Node·Python 바이트 동일 exit 1 (SPEC-015 패리티)", skip, () => {
  const files = {
    "sdd/specs/INFRA-001.md": "# INFRA-001\n**Spec**: `INFRA-001`\n- **FR-001** THE SYSTEM SHALL x.\n## Ownership\n- **Files**: infra/qa/**\n",
    "infra/qa/bucket.tf": "resource{}\n",
  };
  const a = fixture(files, { testInfraGlobs: ["**/qa/**"] });
  const b = fixture(files, { testInfraGlobs: ["**/qa/**"] });
  try {
    const p = runPy(a, ["fr"]);
    const n = runNode(b, "check-fr-coverage.mjs");
    assert.equal(p.code, 1, p.out);
    assert.equal(n.code, 1, n.out);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(n.out, /테스트 인프라 격리 위반/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-026/FR-002
// @covers SPEC-026/FR-007
test("py ownership entitySchemaBacking(이슈 #21 M-4/M-5): ^ 라인 앵커·(?i) 인라인 플래그·한글 \\w ASCII 일치 — Node와 바이트 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** THE SYSTEM SHALL x.\n## Ownership\n- **Entities**: user, order\n- **Capabilities**: user.create, order.create\n",
    "src/schema.prisma": "// header comment\nMODEL user {}\nmodel order {}\nmodel 사용자 {}\n",
  };
  const cfg = {
    entitySchemaBackingPolicy: "hard",
    entitySchemaSources: [{ globs: ["src/*.prisma"], patterns: ["(?i)^model (\\w+)"] }],
  };
  const root = fixture(files, cfg);
  try {
    const py = runPy(root, ["ownership"]);
    const nd = runNode(root, "check-ownership.mjs", []);
    // M-4 fix: ^ 앵커가 중간 줄(header 다음)에서도 매치 → user 실재로 인정.
    // M-5 fix: (?i) 인라인 플래그로 대문자 MODEL도 매치 → user 실재. 한글 사용자는 \w ASCII라 미매치,
    // order는 소유 안 됐으니 무관 — 실제 위반은 없어야 한다(둘 다 실재로 판정).
    assert.equal(py.code, 0, py.out);
    assert.equal(nd.code, 0, nd.out);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const OWN = (id, keys) => `**Spec**: \`${id}\`\nbody mentions thing and stuff.\n## Ownership\n${keys}\n`;

test("py ownership: 정규화 후 같은 키 → 중복 소유 exit 1 (Surfaces 표기 차이 흡수)", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Surfaces**: post /api/thing/"),
    "sdd/specs/SPEC-002.md": OWN("SPEC-002", "- **Surfaces**: POST /api/thing"),
  });
  try {
    const r = runPy(root, ["ownership"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /중복 소유/);
    assert.match(r.out, /POST \/api\/thing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-001/FR-005
test("py ownership: surfaceSchemePrefixes 등록 시 http·path 둘 다 scheme: 키를 받는다(이슈 #21 M-11) — Node와 바이트 동일", skip, () => {
  const httpMix = fixture(
    { "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Surfaces**: POST /api/x, ui:project-wizard") },
    { surfaceSchemePrefixes: ["event", "job", "ui"] });
  const pathMix = fixture(
    { "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Surfaces**: src/app/route.ts, ui:project-wizard") },
    { surfaceFormat: "path", surfaceSchemePrefixes: ["event", "job", "ui"] });
  const unregistered = fixture(
    { "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Surfaces**: ui:project-wizard") }, {});
  try {
    for (const root of [httpMix, pathMix]) {
      const py = runPy(root, ["ownership"]);
      const nd = runNode(root, "check-ownership.mjs", []);
      assert.equal(py.code, 0, py.out);
      assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
    }
    const pyBad = runPy(unregistered, ["ownership"]);
    const ndBad = runNode(unregistered, "check-ownership.mjs", []);
    assert.match(pyBad.out, /등록된 scheme/);
    assert.equal(pyBad.out, ndBad.out, "Node↔Python 출력 바이트 동일(미등록)");
  } finally {
    for (const r of [httpMix, pathMix, unregistered]) rmSync(r, { recursive: true, force: true });
  }
});

test("py ownership: 미등록 verb Capability는 형식위반 warn, --strict에서 exit 1", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Capabilities**: thing.frobnicate"),
  });
  try {
    const warn = runPy(root, ["ownership"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /미등록 verb/);
    assert.equal(runPy(root, ["ownership", "--strict"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-024/FR-006
test("py ownership: Dependencies에 적은 capability도 형식위반은 잡힌다(이슈 #21 E-1) — Node와 출력 바이트 동일", skip, () => {
  const spec = "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: wizard\n## Dependencies\n- **Capabilities**: wizard.frobnicate\n";
  const root = fixture({ "sdd/specs/SPEC-001.md": spec });
  try {
    const py = runPy(root, ["ownership"]);
    const nd = runNode(root, "check-ownership.mjs", []);
    assert.equal(py.code, 0, py.out);
    assert.match(py.out, /미등록 verb "frobnicate".*\(Dependencies\)/);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
    assert.equal(runPy(root, ["ownership", "--strict"]).code, 1);
    assert.equal(runNode(root, "check-ownership.mjs", ["--strict"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py ownership: 관계(SPEC-017) — 대상 실재 확인(hard)·순환(advisory)·레거시 무관 (Node 패리티)", skip, () => {
  const A = "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: investigation_run\n## Dependencies\n- **Entities**: investigation_finding (has-many)\n";
  const B = "**Spec**: `SPEC-002`\n## Ownership\n- **Entities**: investigation_finding\n";
  let root = fixture({ "sdd/specs/SPEC-001.md": A, "sdd/specs/SPEC-002.md": B });
  try {
    const ok = runPy(root, ["ownership"]);
    assert.equal(ok.code, 0, ok.out);
  } finally { rmSync(root, { recursive: true, force: true }); }

  root = fixture({ "sdd/specs/SPEC-001.md": A });
  try {
    const noTarget = runPy(root, ["ownership"]);
    assert.equal(noTarget.code, 1, noTarget.out);
    assert.match(noTarget.out, /관계 대상 Entity "investigation_finding"/);
  } finally { rmSync(root, { recursive: true, force: true }); }

  const cycA = "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: a_thing\n## Dependencies\n- **Entities**: b_thing (depends-on)\n";
  const cycB = "**Spec**: `SPEC-002`\n## Ownership\n- **Entities**: b_thing\n## Dependencies\n- **Entities**: a_thing (depends-on)\n";
  root = fixture({ "sdd/specs/SPEC-001.md": cycA, "sdd/specs/SPEC-002.md": cycB });
  try {
    const r = runPy(root, ["ownership"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠ 관계 순환 참조: SPEC-001 → SPEC-002 → SPEC-001/);
  } finally { rmSync(root, { recursive: true, force: true }); }

  const legacy = "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: a_thing\n## Dependencies\n- **Entities**: nonexistent_legacy_ref\n";
  root = fixture({ "sdd/specs/SPEC-001.md": legacy });
  try {
    assert.equal(runPy(root, ["ownership"]).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py ownership: relationTypes 등록 시 미등록 type exit 1, 빈 목록은 무제한", skip, () => {
  const A = "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: a_thing\n## Dependencies\n- **Entities**: b_thing (has-many)\n";
  const B = "**Spec**: `SPEC-002`\n## Ownership\n- **Entities**: b_thing\n";
  let root = fixture({ "sdd/specs/SPEC-001.md": A, "sdd/specs/SPEC-002.md": B }, { relationTypes: ["belongs-to", "references"] });
  try {
    const restricted = runPy(root, ["ownership"]);
    assert.equal(restricted.code, 1, restricted.out);
    assert.match(restricted.out, /미등록 관계 종류 "has-many"/);
  } finally { rmSync(root, { recursive: true, force: true }); }

  root = fixture({ "sdd/specs/SPEC-001.md": A, "sdd/specs/SPEC-002.md": B }, { relationTypes: [] });
  try {
    assert.equal(runPy(root, ["ownership"]).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── cohesion / completeness / consistency / adequacy / orphan ──

test("py cohesion: FR 과다(9>8) advisory + --strict exit 1, 서픽스 FR 집계 포함", skip, () => {
  const frs = Array.from({ length: 8 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const root = fixture({ "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n**FR-008a** y\n` });
  try {
    const warn = runPy(root, ["cohesion"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /SPEC-001/);
    assert.equal(runPy(root, ["cohesion", "--strict"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py cohesion: aggregate root(Entities) 2개 > maxAggregateRootsPerSpec(1) 신호", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Entities**: thing, stuff"),
  });
  try {
    const r = runPy(root, ["cohesion"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /aggregate/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py completeness: FR 있는데 SC 없음 → warn, --strict exit 1 / FR 0개는 면제", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): THE SYSTEM SHALL x.\n",
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n순수 인프라 spec.\n",
  });
  try {
    const warn = runPy(root, ["completeness"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /SPEC-001.*SC/);
    assert.doesNotMatch(warn.out, /SPEC-002.*SC/); // FR 0 → SC·인수조건 면제(수명주기 warn과 별개)
    assert.equal(runPy(root, ["completeness", "--strict"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py consistency: 본문 근거 없는 키 → advisory warn, --strict exit 1", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n본문은 전혀 다른 얘기.\n## Ownership\n- **Entities**: zorbltron\n",
  });
  try {
    const warn = runPy(root, ["consistency"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /zorbltron/);
    assert.equal(runPy(root, ["consistency", "--strict"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-024/FR-002
// @covers SPEC-024/FR-003
test("py ownership Capability 귀속(SPEC-024): advisory ⚠·hard exit 1 — Node와 출력 바이트 동일", skip, () => {
  const spec = "# S\n**Spec**: `SPEC-001`\n\n## Ownership\n- **Capabilities**: budget.aggregate\n- **Files**: src/**\n";
  const root = fixture({ "sdd/specs/SPEC-001.md": spec },
    { capabilityVerbs: ["aggregate"], capabilityOwnershipPolicy: "advisory" });
  try {
    const py = runPy(root, ["ownership"]);
    const nd = runNode(root, "check-ownership.mjs", []);
    assert.equal(py.code, 0, py.out);
    assert.match(py.out, /Capability 귀속.*위반 1건/);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], capabilityVerbs: ["aggregate"], capabilityOwnershipPolicy: "hard" }));
    assert.equal(runPy(root, ["ownership"]).code, 1);
    assert.equal(runNode(root, "check-ownership.mjs", []).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-024/FR-002
// @covers SPEC-024/FR-003
test("py ownership Dependencies Capability 유령 entity(이슈 #21 E-1): advisory ⚠·hard exit 1 — Node와 출력 바이트 동일", skip, () => {
  const spec = "# S\n**Spec**: `SPEC-001`\n\n## Ownership\n- **Entities**: recommendation\n## Dependencies\n- **Capabilities**: ghost.create\n";
  const root = fixture({ "sdd/specs/SPEC-001.md": spec }, { capabilityOwnershipPolicy: "advisory" });
  try {
    const py = runPy(root, ["ownership"]);
    const nd = runNode(root, "check-ownership.mjs", []);
    assert.equal(py.code, 0, py.out);
    assert.match(py.out, /Dependencies Capability 유령 entity.*위반 1건/);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], capabilityOwnershipPolicy: "hard" }));
    const pyHard = runPy(root, ["ownership"]);
    const ndHard = runNode(root, "check-ownership.mjs", []);
    assert.equal(pyHard.code, 1, pyHard.out);
    assert.equal(ndHard.code, 1, ndHard.out);
    assert.equal(pyHard.out, ndHard.out, "Node↔Python 출력 바이트 동일(hard)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-001/FR-004
test("py ownership capabilityVerbPolicy(이슈 #21 E-5): hard는 --strict 없이도 exit 1, 객체형 빈 사유는 항상 에러 — Node와 바이트 동일", skip, () => {
  const spec = "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: staff\n- **Capabilities**: staff.frobnicate\n";
  const root = fixture({ "sdd/specs/SPEC-001.md": spec }, { capabilityVerbPolicy: "hard" });
  try {
    const py = runPy(root, ["ownership"]);
    const nd = runNode(root, "check-ownership.mjs", []);
    assert.equal(py.code, 1, py.out);
    assert.equal(nd.code, 1, nd.out);
    assert.match(py.out, /capabilityVerbPolicy=hard: 미등록 verb 1건/);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");

    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], capabilityVerbs: { frobnicate: "  " } }));
    const pyEmpty = runPy(root, ["ownership"]);
    const ndEmpty = runNode(root, "check-ownership.mjs", []);
    assert.equal(pyEmpty.code, 1, pyEmpty.out);
    assert.match(pyEmpty.out, /CAPABILITY VERB 레지스트리 위반 1건/);
    assert.equal(pyEmpty.out, ndEmpty.out, "Node↔Python 출력 바이트 동일(빈 사유)");

    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], capabilityVerbs: { frobnicate: "사유" } }));
    const pyOk = runPy(root, ["ownership"]);
    const ndOk = runNode(root, "check-ownership.mjs", []);
    assert.equal(pyOk.code, 0, pyOk.out);
    assert.equal(pyOk.out, ndOk.out, "Node↔Python 출력 바이트 동일(등록됨)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-023/FR-002
// @covers SPEC-023/FR-003
test("py consistency 키 앵커(SPEC-023): advisory ⚠·hard exit 1 — Node와 출력 바이트 동일", skip, () => {
  const spec = "**Spec**: `SPEC-001`\n- **FR-001** THE SYSTEM SHALL run on **Fargate** using **pjt_projects**.\n## Ownership\n- **Entities**: pjt_projects\n";
  const root = fixture({ "sdd/specs/SPEC-001.md": spec },
    { frKeyAnchorPolicy: "advisory" });
  try {
    const py = runPy(root, ["consistency"]);
    const nd = runNode(root, "check-spec-consistency.mjs", []);
    assert.equal(py.code, 0, py.out);
    assert.match(py.out, /매치 1 · 미매치 1/);
    assert.match(py.out, /bold "fargate"/);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], frKeyAnchorPolicy: "hard" }));
    assert.equal(runPy(root, ["consistency"]).code, 1);
    assert.equal(runNode(root, "check-spec-consistency.mjs", []).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py adequacy: @covers 있는데 단언 없음 → warn, --strict exit 1", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n",
    "src/empty.test.mjs": TAG + "SPEC-001/FR-001\n// 단언 없음\n",
  });
  try {
    const warn = runPy(root, ["adequacy"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /no-assertion:1/);
    assert.equal(runPy(root, ["adequacy", "--strict"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py orphan: 선언 안 된 표면 파일 → warn, --strict exit 1 / surfaceGlobs 미설정 no-op", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src/app/owned/route.ts\n",
    "src/app/owned/route.ts": "export {};\n",
    "src/app/orphan/route.ts": "export {};\n",
  };
  const root = fixture(files, { surfaceGlobs: ["src/app/.*/route\\.ts$"] });
  const noop = fixture(files);
  try {
    const r = runPy(root, ["orphan"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /orphans:1/);
    assert.match(r.out, /orphan\/route\.ts/);
    assert.equal(runPy(root, ["orphan", "--strict"]).code, 1);
    assert.match(runPy(noop, ["orphan"]).out, /no-op/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(noop, { recursive: true, force: true }); }
});

// @covers SPEC-003/FR-009
test("py orphan: 짧은 리터럴 선언 토큰이 무관한 표면을 오판정하지 않는다(이슈 #21 M-1) — Node와 바이트 동일", skip, () => {
  const files = {
    // "src"라는 3글자 선언이 있어도, 다른 파일이 "src"를 부분문자열로 포함한다고 그걸로
    // "선언됨" 처리되면 안 된다(실측: 부분문자열 매칭이 있던 판은 이걸 오판정으로 놓쳤다).
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src\n",
    "src/app/unrelated/route.ts": "export {};\n",
    // 경계에서 끊기는 접미사 매칭은 여전히 정당 — "owned/route.ts"만 선언해도 그 접미사와
    // 일치하는 실제 경로는 인정된다.
    "src/app/owned/route.ts": "export {};\n",
  };
  const root = fixture(files, { surfaceGlobs: ["src/app/.*/route\\.ts$"] });
  try {
    const py = runPy(root, ["orphan"]);
    const nd = runNode(root, "check-orphan-surfaces.mjs", []);
    assert.equal(py.code, 0, py.out);
    assert.match(py.out, /orphans:2/); // "src" 짧은 토큰으론 둘 다 못 지운다
    assert.match(py.out, /unrelated\/route\.ts/);
    assert.match(py.out, /owned\/route\.ts/); // 접미 매칭 없이 "src" 전체선언만으론 owned도 못 지운다
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py orphan: 경로 경계 접미사 선언은 정당하게 인정된다 — Node와 바이트 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: app/owned/route.ts\n",
    "src/app/owned/route.ts": "export {};\n",
  };
  const root = fixture(files, { surfaceGlobs: ["src/app/.*/route\\.ts$"] });
  try {
    const py = runPy(root, ["orphan"]);
    const nd = runNode(root, "check-orphan-surfaces.mjs", []);
    assert.equal(py.code, 0, py.out);
    assert.match(py.out, /orphans:0/);
    assert.equal(py.out, nd.out, "Node↔Python 출력 바이트 동일");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── specsync: git 픽스처로 hard/advisory 분기 ──

function gitFixture() {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "# SPEC-001\n**Spec**: `SPEC-001`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Entities**: thing\n- **Files**: src/lib/**\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n",
    "src/lib/a.ts": "export const v = 1;\n",
  });
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  g("add", "-A"); g("commit", "-qm", "base");
  return { root, g };
}

test("py specsync staged: 소유 코드 변경 + 스펙 무변경 → exit 1, Spec-Impact: none 사유 → 통과", skip, () => {
  const { root, g } = gitFixture();
  try {
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
    g("add", "src/lib/a.ts");
    writeFileSync(join(root, "msg"), "fix: hotfix\n");
    const fail = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    assert.equal(fail.code, 1, fail.out);
    assert.match(fail.out, /SPEC-001/);
    writeFileSync(join(root, "msg2"), "fix: hotfix\n\nSpec-Impact: none 빌드 스크립트만 변경\n");
    const pass = runPy(root, ["specsync", "--staged", "--message-file", "msg2"]);
    assert.equal(pass.code, 0, pass.out);
    assert.match(pass.out, /Spec-Impact: none/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py specsync staged: 스펙 Change Log 행 동반 → 통과", skip, () => {
  const { root, g } = gitFixture();
  try {
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
    const spec = execFileSync("cat", [join(root, "sdd/specs/SPEC-001.md")], { encoding: "utf8" });
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), spec + "| 2026-07-02 | v 상향 | 근거 |\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "fix: with spec\n");
    const r = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py specsync range: 코드-only 브랜치 → advisory(exit 0) + base positional 인식", skip, () => {
  const { root, g } = gitFixture();
  try {
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 3;\n");
    g("add", "-A"); g("commit", "-qm", "code only");
    const r = runPy(root, ["specsync", "main"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /base:main/);
    assert.match(r.out, /⚠/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-019/FR-002
test("py specsync semantic drift(이슈 #21 M-6/M-7): 값 없는 Spec-Impact는 위반, 사유 있으면 부채 줄로 감사 흔적 — Node와 바이트 동일", skip, () => {
  const SPEC = (files, extra = "") => `# SPEC-001\n**Spec**: \`SPEC-001\`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Entities**: thing\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n${extra}`;
  const root = fixture(
    { "sdd/specs/SPEC-001.md": SPEC("src/lib/pdf/**"), "src/lib/pdf/parse.ts": "export const v = 1;\n" },
    { semanticDriftPolicy: "hard" });
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  try {
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    g("add", "-A"); g("commit", "-qm", "base");
    g("mv", "src/lib/pdf/parse.ts", "src/lib/pdf/parser.ts");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-16 | 리네임 | |\n"));
    g("add", "-A");

    writeFileSync(join(root, "msg"), "refactor: rename parse\n\nSpec-Impact:\n");
    const pyEmpty = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    const ndEmpty = runNode(root, "check-spec-sync.mjs", ["--staged", "--message-file", "msg"]);
    assert.equal(pyEmpty.code, 1, pyEmpty.out);
    assert.equal(ndEmpty.code, 1, ndEmpty.out);
    assert.equal(pyEmpty.out, ndEmpty.out, "Node↔Python 출력 바이트 동일(빈 트레일러)");

    writeFileSync(join(root, "msg2"), "refactor: rename parse\n\nSpec-Impact: 파일명만 정리, 동작 불변\n");
    const pyOk = runPy(root, ["specsync", "--staged", "--message-file", "msg2"]);
    const ndOk = runNode(root, "check-spec-sync.mjs", ["--staged", "--message-file", "msg2"]);
    assert.equal(pyOk.code, 0, pyOk.out);
    assert.match(pyOk.out, /· \[부채\] semantic drift 승격 1건이 Spec-Impact 트레일러로 면제됨\(SPEC-001\)/);
    assert.equal(pyOk.out, ndOk.out, "Node↔Python 출력 바이트 동일(사유 있음)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── fr 검증 회계(SPEC-007 패리티): strictSpecs·requireAccounting·smokeManifest ──

test("py fr 회계: strictSpecs 부분커버 exit 1 · R3 unaccounted exit 1 · manifest 검증 에러", skip, () => {
  const spec = "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n";
  const cover = TAG + "SPEC-001/FR-001\ntest('x', () => { assert.ok(1); });\n";
  const strict = fixture({ "sdd/specs/SPEC-001.md": spec, "src/a.test.mjs": cover },
    { strictSpecs: ["SPEC-001"] });
  const r3 = fixture({ "sdd/specs/SPEC-001.md": spec, "src/a.test.mjs": cover },
    { requireAccounting: true });
  const dangling = fixture({
    "sdd/specs/SPEC-001.md": spec,
    "sdd/smoke.json": JSON.stringify({ "SPEC-001/FR-999": { method: "smoke", evidence: "x" } }),
  }, { smokeManifest: "sdd/smoke.json" });
  try {
    const a = runPy(strict, ["fr"]);
    assert.equal(a.code, 1, a.out);
    assert.match(a.out, /R2\(strictSpecs\) SPEC-001: 1\/2/);
    const b = runPy(r3, ["fr"]);
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /R3 unaccounted SPEC-001\/FR-002/);
    const c = runPy(dangling, ["fr"]);
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /M1 dangling manifest 키/);
  } finally {
    for (const d of [strict, r3, dangling]) rmSync(d, { recursive: true, force: true });
  }
});

test("패리티: fr 회계 활성(smokeManifest+requireAccounting+strictSpecs) — Node와 Python 출력 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n- **FR-003** (event): z.\n",
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n- **FR-001** (event): w.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => { assert.ok(1); });\n",
    "sdd/smoke.json": JSON.stringify({
      "SPEC-001/FR-002": { method: "smoke", evidence: "scripts/smoke.sh 왕복" },
      "SPEC-001/FR-999": { method: "smoke", evidence: "dangling" },
      "SPEC-002/FR-001": { method: "deferred", reason: "" },
    }),
  };
  const cfg = { smokeManifest: "sdd/smoke.json", requireAccounting: true, strictSpecs: ["SPEC-001", "SPEC-404"] };
  const a = fixture(files, cfg);
  const b = fixture(files, cfg);
  try {
    const p = runPy(a, ["fr"]);
    const n = runNode(b, "check-fr-coverage.mjs");
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// ── entityRegistry(SPEC-002 FR-009 패리티) ──

test("패리티: ownership entityRegistry(미등록 entity·빈 사유·유령 등록) — Node와 Python 출력 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\nthing 얘기.\n## Ownership\n- **Entities**: thing\n",
  };
  const cfg = { entityRegistry: { stuff: "다른 aggregate", ghost: "", thing2: "선등록" } };
  const a = fixture(files, cfg);
  const b = fixture(files, cfg);
  try {
    const p = runPy(a, ["ownership"]);
    const n = runNode(b, "check-ownership.mjs");
    assert.equal(p.code, 1, p.out);
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /미등록 entity "thing"/);
    assert.match(p.out, /도입 사유 필요/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// ── unowned 정책(SPEC-003 FR-010 패리티): silent/warn/error ──

test("py specsync: unowned 정책 warn=⚠ 통과 · error(staged)=✗ exit 1 · 미정의 값 exit 1", skip, () => {
  const { root, g } = gitFixture();
  const setPolicy = (policy) => writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", specSyncUnownedPolicy: policy }));
  try {
    writeFileSync(join(root, "src/stray.ts"), "unowned\n");
    g("add", "src/stray.ts");
    writeFileSync(join(root, "msg"), "chore\n");
    setPolicy("warn");
    const warn = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /⚠ unowned: src\/stray\.ts/);
    setPolicy("error");
    const err = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    assert.equal(err.code, 1, err.out);
    assert.match(err.out, /✗ unowned: src\/stray\.ts/);
    setPolicy("everything-goes");
    assert.equal(runPy(root, ["specsync", "--staged", "--message-file", "msg"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── Files 리터럴 경로 부재(SPEC-013 패리티) + 삭제 경로 제외(SPEC-003 FR-010) ──
// 실측 결함: 이 축이 Node판에만 있었다 — Python 런타임 프로젝트는 같은 위반을 **조용히 통과**시켰다
// (동반 요구가 충족되면 exit 0). 판정 게이트의 한쪽만 있는 축은 축이 아니다.
test("py specsync: Files 리터럴 경로 부재 → Node와 바이트 동일하게 차단(staged=hard)", skip, () => {
  const { root, g } = gitFixture();
  try {
    const specPath = join(root, "sdd/specs/SPEC-001.md");
    const spec = execFileSync("cat", [specPath], { encoding: "utf8" });
    // 실재하지 않는 리터럴 경로를 Files에 추가 + 스펙 의미 변경 동반(동반 요구는 충족 → 이 축만 남는다)
    writeFileSync(specPath, spec.replace("- **Files**: src/lib/**", "- **Files**: src/lib/**, src/lib/gone.ts")
      + "| 2026-08-04 | gone 추가 | 근거 |\n");
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "chore\n");
    const p = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    const n = runNode(root, "check-spec-sync.mjs", ["--staged", "--message-file", "msg"]);
    assert.equal(p.code, 1, p.out);
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /Files 리터럴 경로 부재 src\/lib\/gone\.ts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py specsync: 소유 파일 삭제 + 같은 커밋의 Files 항목 제거 → 양판 통과(삭제 경로 제외)", skip, () => {
  const { root, g } = gitFixture();
  try {
    const specPath = join(root, "sdd/specs/SPEC-001.md");
    writeFileSync(join(root, "src/lib/old.ts"), "export const old = 1;\n");
    const spec = execFileSync("cat", [specPath], { encoding: "utf8" });
    writeFileSync(specPath, spec.replace("- **Files**: src/lib/**", "- **Files**: src/lib/a.ts, src/lib/old.ts"));
    g("add", "-A"); g("commit", "-qm", "own old");
    // 선언 제거 + 실물 삭제를 한 커밋에 — 삭제는 "잘못 적힌 경로"도 "미소유"도 아니다.
    const spec2 = execFileSync("cat", [specPath], { encoding: "utf8" });
    writeFileSync(specPath, spec2.replace(", src/lib/old.ts", "") + "| 2026-08-04 | old 제거 | 사용처 없음 |\n");
    g("rm", "-q", "src/lib/old.ts"); g("add", "-A");
    writeFileSync(join(root, "msg"), "chore: remove old\n");
    const p = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    const n = runNode(root, "check-spec-sync.mjs", ["--staged", "--message-file", "msg"]);
    assert.equal(p.code, 0, p.out);
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.doesNotMatch(p.out, /리터럴 경로 부재/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 소유 파일 리네임 경로(이슈 #27 패리티) — 삭제 해소의 미해결 분기 ──
// collectRenames/collect_renames는 새 경로만 담고 사라진 원본은 아무도 기록하지 않아, 소유
// 파일을 git mv로 옮기면 스펙이 가리키는 옛 경로가 어떤 커밋 순서로도 "잘못 적힌 경로"로
// 오판됐다(삭제 D에는 이미 있던 해소가 리네임 R에는 없었다). 두 런타임 동시 수정.
// @covers SPEC-003/FR-010
test("py specsync: git mv + Files 정정을 한 커밋에 → 양판 통과(리네임 원본도 삭제 경로 취급)", skip, () => {
  const { root, g } = gitFixture();
  try {
    const specPath = join(root, "sdd/specs/SPEC-001.md");
    writeFileSync(join(root, "src/lib/old.ts"), "export const old = 1;\n");
    const spec = execFileSync("cat", [specPath], { encoding: "utf8" });
    writeFileSync(specPath, spec.replace("- **Files**: src/lib/**", "- **Files**: src/lib/a.ts, src/lib/old.ts"));
    g("add", "-A"); g("commit", "-qm", "own old");
    // 한 커밋에: git mv + Files 항목을 새 경로로 정정(+ Change Log)
    g("mv", "src/lib/old.ts", "src/lib/old2.ts");
    const spec2 = execFileSync("cat", [specPath], { encoding: "utf8" });
    writeFileSync(specPath, spec2.replace("src/lib/old.ts", "src/lib/old2.ts") + "| 2026-08-27 | old → old2 리네임 | 파일명 정리 |\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "refactor: rename old\n");
    const p = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    const n = runNode(root, "check-spec-sync.mjs", ["--staged", "--message-file", "msg"]);
    assert.equal(p.code, 0, p.out);
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.doesNotMatch(p.out, /리터럴 경로 부재/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 검증 실행 회계(SPEC-041 패리티) ──────────────────────────────────────────
test("py verifyrun: 원장 미선언 INERT · 침묵 차단 · 사유 있는 포기 통과 — Node와 바이트 동일", skip, () => {
  const mk = (config) => {
    const root = fixture({
      "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Success Criteria\n- **SC-001**: x. [검증: src/a.test.mjs]\n- **SC-002**: y. [검증: src/b.test.mjs]\n",
      "src/a.test.mjs": "//\n", "src/b.test.mjs": "//\n",
    }, config);
    return root;
  };
  // ① 원장 미선언 → INERT(양판 동일)
  const a = mk({ verificationRunPolicy: "advisory" });
  const b = mk({ verificationRunPolicy: "advisory" });
  try {
    const p = runPy(a, ["verifyrun"]);
    const n = runNode(b, "check-verification-executed.mjs");
    assert.equal(p.code, n.code, `exit 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /판정: INERT — verificationRunLedger 미선언/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }

  // ② 침묵(기록 없음) → hard 차단, 양판 동일
  const c = mk({ verificationRunPolicy: "hard", verificationRunLedger: ".sdd/runs.jsonl" });
  const d = mk({ verificationRunPolicy: "hard", verificationRunLedger: ".sdd/runs.jsonl" });
  try {
    const p = runPy(c, ["verifyrun"]);
    const n = runNode(d, "check-verification-executed.mjs");
    assert.equal(p.code, 1, p.out);
    assert.equal(p.code, n.code);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /존재는 실행이 아니다/);
  } finally { rmSync(c, { recursive: true, force: true }); rmSync(d, { recursive: true, force: true }); }

  // ③ 기록 후 → 통과. 사유 있는 포기는 hard에서도 부채일 뿐 차단이 아니다(양판 동일).
  const e = mk({ verificationRunPolicy: "hard", verificationRunLedger: ".sdd/runs.jsonl" });
  const f2 = mk({ verificationRunPolicy: "hard", verificationRunLedger: ".sdd/runs.jsonl" });
  try {
    runPy(e, ["verifyrun", "--record", "src/a.test.mjs", "JUDGED", "ok"]);
    runPy(e, ["verifyrun", "--record", "src/b.test.mjs", "INERT", "전제 자원 없음"]);
    runNode(f2, "check-verification-executed.mjs", ["--record", "src/a.test.mjs", "JUDGED", "ok"]);
    runNode(f2, "check-verification-executed.mjs", ["--record", "src/b.test.mjs", "INERT", "전제 자원 없음"]);
    const p = runPy(e, ["verifyrun"]);
    const n = runNode(f2, "check-verification-executed.mjs");
    assert.equal(p.code, 0, p.out);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /침묵 0건/);
  } finally { rmSync(e, { recursive: true, force: true }); rmSync(f2, { recursive: true, force: true }); }
});

// ── 수명주기(SPEC-008 패리티): completeness Status·리뷰 기록 + specsync Draft 차단 ──

test("py specsync staged: Draft 스펙 소유 코드 → 스펙 동반해도 exit 1 (Draft 차단 패리티)", skip, () => {
  const { root, g } = gitFixture();
  try {
    // 스펙을 Draft로 승격 전 상태로 바꾸고 코드+스펙 동반 스테이징 — 그래도 차단돼야 한다.
    const specPath = join(root, "sdd/specs/SPEC-001.md");
    const spec = execFileSync("cat", [specPath], { encoding: "utf8" });
    writeFileSync(specPath, spec.replace("**Spec**: `SPEC-001`", "**Spec**: `SPEC-001`  **Status**: Draft") + "| 2026-07-05 | 개정 | 근거 |\n");
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "feat: draft 중 코드\n");
    const r = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Draft 상태/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("py specsync range: draftBlockPolicy=hard → Draft 소유 코드 변경도 ✗ exit 1 (SPEC-008 FR-007 패리티)", skip, () => {
  const { root, g } = gitFixture();
  try {
    const specPath = join(root, "sdd/specs/SPEC-001.md");
    const spec = execFileSync("cat", [specPath], { encoding: "utf8" });
    writeFileSync(specPath, spec.replace("**Spec**: `SPEC-001`", "**Spec**: `SPEC-001`  **Status**: Draft"));
    g("add", "-A"); g("commit", "-qm", "draft status");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
    g("add", "-A"); g("commit", "-qm", "code only");

    const advisory = runPy(root, ["specsync", "main"]);
    assert.equal(advisory.code, 0, advisory.out);
    assert.match(advisory.out, /⚠ src\/lib\/a\.ts → 소유 스펙 SPEC-001이 Draft 상태/);

    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", draftBlockPolicy: "hard" }));
    const hard = runPy(root, ["specsync", "main"]);
    assert.equal(hard.code, 1, hard.out);
    assert.match(hard.out, /✗ src\/lib\/a\.ts → 소유 스펙 SPEC-001이 Draft 상태/);

    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", draftBlockPolicy: "nope" }));
    assert.equal(runPy(root, ["specsync", "main"]).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("패리티: completeness 수명주기(Status 없음·미정의·Reviewed 기록 미비) — Node와 Python 출력 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n**Given** x\n- **SC-001**: 90%\n",
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`  **Status**: Shipped\n순수 인프라.\n",
    "sdd/specs/SPEC-003.md": "**Spec**: `SPEC-003`  **Status**: Active\n- **FR-001** (event): y.\n**Given** x\n- **SC-001**: 1%\n## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n",
  };
  const a = fixture(files);
  const b = fixture(files);
  try {
    const p = runPy(a, ["completeness"]);
    const n = runNode(b, "check-spec-completeness.mjs");
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /Status 헤더/);          // SPEC-001 레거시
    assert.match(p.out, /미정의 Status/);        // SPEC-002
    assert.match(p.out, /Dedup-Review 기록/);    // SPEC-003 (Review Log는 있음)
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-013/FR-003
// 거짓 음성 회귀 + 런타임 패리티: SHALL 판정의 라인 규율이 불릿 **필수**였을 때 비불릿 선언은
// 양쪽 런타임에서 똑같이 무검사였다. 다중 접두어(INFRA)까지 한 픽스처에 넣어 reqAlt 주입도 고정한다.
test("패리티: completeness 비불릿·다중 접두어 FR 선언의 SHALL 누락 — Node와 Python 출력 동일", skip, () => {
  const files = {
    // SPEC-001: 비불릿 선언 2개(하나는 SHALL 없음) + 산문 볼드 인용(선언 아님)
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Active\n"
      + "## Functional Requirements\n"
      + "**FR-001** (event): WHEN x, THE SYSTEM SHALL y.\n"
      + "**FR-002** (event): does y without the keyword.\n"
      + "산문 속 **FR-003** 인용은 선언이 아니다.\n"
      + "**Given** x\n- **SC-001**: 90%\n"
      + "## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 이웃 없음\n",
    // INFRA-001: 다중 접두어 선언(불릿·SHALL 없음) — reqAlt 미주입이면 통째로 빠진다
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`  **Status**: Active\n"
      + "## Functional Requirements\n"
      + "- **INFRA-001** (event): provisions the bucket without the keyword.\n"
      + "**Given** x\n- **SC-001**: 90%\n"
      + "## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 이웃 없음\n",
  };
  const cfg = { requirementIdPrefixes: ["FR", "INFRA"] };
  const a = fixture(files, cfg);
  const b = fixture(files, cfg);
  try {
    const p = runPy(a, ["completeness"]);
    const n = runNode(b, "check-spec-completeness.mjs");
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치(바이트 동일해야 함)\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /FR-002 선언 라인에 SHALL 없음/);      // 비불릿 선언도 잡힌다
    assert.match(p.out, /INFRA-001 선언 라인에 SHALL 없음/);   // 다중 접두어도 잡힌다
    assert.doesNotMatch(p.out, /FR-001 선언 라인에 SHALL 없음/); // SHALL 있는 선언은 조용
    assert.doesNotMatch(p.out, /FR-003 선언 라인에 SHALL 없음/); // 산문 인용은 선언 아님
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-016/FR-001
test("패리티: completeness 오브젝트 스토리지 결정(S3 마커+섹션 없음 warn) — Node와 Python 출력 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Active\n이 기능은 S3 버킷에 저장한다.\n- **FR-001** (event): THE SYSTEM SHALL store.\n**Given** x\n- **SC-001**: 90%\n## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 이웃 없음\n",
  };
  const a = fixture(files);
  const b = fixture(files);
  try {
    const p = runPy(a, ["completeness"]);
    const n = runNode(b, "check-spec-completeness.mjs");
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치(바이트 패리티)\npy:${p.out}\nnode:${n.out}`);
    assert.match(n.out, /Object Storage Decision/);
    assert.equal(runPy(a, ["completeness", "--strict"]).code, 1);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// @covers SPEC-008/FR-006
test("패리티: completeness Lifecycle enum 밖 값(temporary) — Node와 Python 출력 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Active  **Lifecycle**: temporary\n- **FR-001** (event): x.\n**Given** x\n- **SC-001**: 90%\n## Review Log\n| 2026-07-05 | r | PASS |\n## Dedup-Review\n- 이웃 없음\n",
  };
  const a = fixture(files);
  const b = fixture(files);
  try {
    const p = runPy(a, ["completeness"]);
    const n = runNode(b, "check-spec-completeness.mjs");
    assert.equal(p.code, n.code, `exit\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(n.out, /미정의 Lifecycle "temporary"/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// ── 재도출 소스 회계(SPEC-009 패리티): derivation + completeness 근거 캡처 ──

const VTAG = "# @veri" + "fies "; // 자기 게이트(스캔) 중화 — 픽스처 파일에만 실태그 기록
const DERIV_BASE = {
  "code": { status: "none", reason: "스캔함 — scanDirs에 코드 없음" },
  "iac": { status: "none", reason: "스캔함 — IaC 없음" },
  "ci": { status: "none", reason: "스캔함 — CI 정의 없음" },
  "ops-docs": { status: "none", reason: "스캔함 — 운영 문서 없음" },
  "build-evidence": { status: "deferred", reason: "CI 부재" },
  "vcs-history": { status: "mapped", evidence: "커밋 메시지·트레일러 관례" },
  "prior-traceability": { status: "none", reason: "스캔함 — 기존 태그 없음" },
  "prior-intent": { status: "none", reason: "기존 스펙 없음" },
  "human-intent": { status: "mapped", evidence: "Clarifications 선제 캡처" },
};

test("패리티: derivation(위반 조합·OK·no-op) — Node와 Python 출력 동일", skip, () => {
  const cases = [
    [{}, {}], // 미설정 no-op
    [{ "sdd/derivation.json": JSON.stringify(DERIV_BASE, null, 2) }, { derivationManifest: "sdd/derivation.json" }],
    [{ // D1 미회계(iac 누락)·D2 빈 evidence·D3(iac 실재+none)·mapped 검출 0 warn
      "infra/main.tf": "resource {}\n",
      "sdd/derivation.json": JSON.stringify({
        ...DERIV_BASE,
        "iac": { status: "none", reason: "안 읽음" },
        "vcs-history": { status: "mapped", evidence: " " },
        "ci": { status: "mapped", evidence: "레포 밖 Jenkins build #9" },
      }, null, 2),
    }, { derivationManifest: "sdd/derivation.json" }],
  ];
  for (const [files, cfg] of cases) {
    const a = fixture(files, cfg);
    const b = fixture(files, cfg);
    try {
      const p = runPy(a, ["derivation"]);
      const n = runNode(b, "check-derivation.mjs");
      assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
      assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
  }
});

test("패리티: completeness Change Log 근거 캡처(빈 근거 warn) — Node와 Python 출력 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Draft\n- **FR-001** (event): x.\n**Given** x\n- **SC-001**: 90%\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| [YYYY-MM-DD] | 초안 | |\n| 2026-07-05 | 개정 | |\n",
  };
  const a = fixture(files);
  const b = fixture(files);
  try {
    const p = runPy(a, ["completeness"]);
    const n = runNode(b, "check-spec-completeness.mjs");
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.match(p.out, /Change Log 2026-07-05 행의 근거 칸이 빈 값/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// ── smoke 증거 자동 수집(SPEC-010 패리티): smokescan check·write ──

test("패리티: smokescan(check 드리프트·에러 조합·write 산출물) — Node와 Python 동일", skip, () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n",
    "src/ci.yml": VTAG + "SPEC-001/FR-001 smoke: 왕복 확인\n" + VTAG + "SPEC-001/FR-999 smoke: dangling\n",
    "src/b.sh": VTAG + "SPEC-001/FR-001 e2e: 충돌\n" + VTAG + "SPEC-001/FR-002 smoke 콜론없음\n",
  };
  const cfg = { smokeManifest: "sdd/smoke.json" };
  const a = fixture(files, cfg);
  const b = fixture(files, cfg);
  try {
    const p = runPy(a, ["smokescan"]);
    const n = runNode(b, "sdd-smoke-scan.mjs");
    assert.equal(p.code, 1, p.out);
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
  // write 산출물(매니페스트 바이트) + check OK 패리티
  const okFiles = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n",
    "src/smoke.sh": VTAG + "SPEC-001/FR-001 smoke: 한글 증거 확인\n",
    "sdd/smoke.json": JSON.stringify({ "SPEC-001/FR-002": { method: "deferred", reason: "수동 회계" } }, null, 2) + "\n",
  };
  const c = fixture(okFiles, cfg);
  const d = fixture(okFiles, cfg);
  try {
    const pw = runPy(c, ["smokescan", "--write"]);
    const nw = runNode(d, "sdd-smoke-scan.mjs", ["--write"]);
    assert.equal(pw.code, 0, pw.out);
    assert.equal(pw.out, nw.out, `write 출력 불일치\npy:${pw.out}\nnode:${nw.out}`);
    const pm = execFileSync("cat", [join(c, "sdd/smoke.json")], { encoding: "utf8" });
    const nm = execFileSync("cat", [join(d, "sdd/smoke.json")], { encoding: "utf8" });
    assert.equal(pm, nm, "매니페스트 산출물 바이트 불일치");
    const pc = runPy(c, ["smokescan"]);
    const nc = runNode(d, "sdd-smoke-scan.mjs");
    assert.equal(pc.code, 0, pc.out);
    assert.equal(pc.out, nc.out, `check 출력 불일치\npy:${pc.out}\nnode:${nc.out}`);
  } finally { rmSync(c, { recursive: true, force: true }); rmSync(d, { recursive: true, force: true }); }
});

// ── 추적 태그 마이그레이션(SPEC-011 패리티): retag dry-run·write ──

test("패리티: retag(dry-run 계획·write 적용·산출물) — Node와 Python 동일", skip, () => {
  const CT = "// @cov" + "ers ";
  const files = {
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n- **FR-001** (event): x.\n- **FR-002** (event): y.\n",
    "src/a.test.mjs": CT + "SPEC-001/FR-001\ntest('x', () => {});\n",
    "src/smoke.sh": VTAG + "SPEC-001/FR-002 smoke: 왕복\n",
    "sdd/smoke.json": JSON.stringify({ "SPEC-001/FR-002": { method: "smoke", evidence: "src/smoke.sh — 왕복" } }, null, 2) + "\n",
    "map.json": JSON.stringify({
      "SPEC-001/FR-001": "SPEC-002/FR-001",
      "SPEC-001/FR-002": "SPEC-002/FR-002",
      "SPEC-001/FR-003": null,
    }),
  };
  const cfg = { smokeManifest: "sdd/smoke.json" };
  const a = fixture(files, cfg);
  const b = fixture(files, cfg);
  try {
    const p = runPy(a, ["retag", "map.json"]);
    const n = runNode(b, "sdd-retag.mjs", ["map.json"]);
    assert.equal(p.code, 0, p.out);
    assert.equal(p.out, n.out, `dry-run 출력 불일치\npy:${p.out}\nnode:${n.out}`);
    const pw = runPy(a, ["retag", "map.json", "--write"]);
    const nw = runNode(b, "sdd-retag.mjs", ["map.json", "--write"]);
    assert.equal(pw.code, 0, pw.out);
    assert.equal(pw.out, nw.out, `write 출력 불일치\npy:${pw.out}\nnode:${nw.out}`);
    for (const rel of ["src/a.test.mjs", "src/smoke.sh", "sdd/smoke.json"]) {
      const pa = execFileSync("cat", [join(a, rel)], { encoding: "utf8" });
      const nb = execFileSync("cat", [join(b, rel)], { encoding: "utf8" });
      assert.equal(pa, nb, `${rel} 산출물 바이트 불일치`);
    }
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// ── Node ↔ Python 패리티: 같은 픽스처, 같은 판정·같은 출력 ──

test("패리티: fr/ownership/cohesion/completeness — Node와 Python 출력 동일", skip, () => {
  const frs = Array.from({ length: 9 }, (_, i) => `- **FR-${String(i + 1).padStart(3, "0")}** (event): x.`).join("\n");
  const root = fixture({
    "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\nthing 얘기.\n${frs}\n## Ownership\n- **Entities**: thing\n- **Capabilities**: thing.create\n`,
    "sdd/specs/SPEC-002.md": OWN("SPEC-002", "- **Entities**: thing"),
    "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => { assert.ok(1); });\n",
  });
  const pairs = [
    ["fr", "check-fr-coverage.mjs"],
    ["ownership", "check-ownership.mjs"],   // SPEC-001·002가 thing 중복 소유 → 양쪽 다 exit 1
    ["cohesion", "check-spec-cohesion.mjs"], // FR 9 > 8 advisory
    ["completeness", "check-spec-completeness.mjs"], // SC 없음 warn
  ];
  try {
    for (const [pySub, nodeGate] of pairs) {
      const p = runPy(root, [pySub]);
      const n = runNode(root, nodeGate);
      assert.equal(p.code, n.code, `${pySub}: exit code 불일치\npy:${p.out}\nnode:${n.out}`);
      assert.equal(p.out, n.out, `${pySub}: 출력 불일치`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 접두어↔클래스 정합(SPEC-012 패리티) + 문법 규범(SPEC-013 패리티) ──

test("패리티: fr 접두어↔클래스(부정합 exit 1·면제·INFRA 검출 0 warn) — Node와 Python 출력 동일", skip, () => {
  const IAC = (id) => `# ${id}\n**Spec**: \`${id}\`\n- **FR-001** THE SYSTEM SHALL provision x.\n\n## Ownership\n- **Files**: infra/**\n`;
  const cases = [
    [{ "sdd/specs/SPEC-001.md": IAC("SPEC-001"), "infra/main.tf": "resource {}\n" }, {}],
    [{ "sdd/specs/INFRA-001.md": IAC("INFRA-001"), "infra/main.tf": "resource {}\n" }, {}],
    [{ "sdd/specs/SPEC-001.md": IAC("SPEC-001"), "infra/main.tf": "x\n" },
      { prefixClassExemptions: { "SPEC-001": "이관 중" } }],
    [{ "sdd/specs/INFRA-002.md": IAC("INFRA-002").replace("infra/**", "src/app.mjs"), "src/app.mjs": "1\n" }, {}],
    [{ "sdd/specs/SPEC-001.md": IAC("SPEC-001"), "infra/main.tf": "x\n" },
      { prefixClassExemptions: { "SPEC-999": "유령" } }],
  ];
  for (const [files, cfg] of cases) {
    const root = fixture(files, cfg);
    try {
      const p = runPy(root, ["fr"]);
      const n = runNode(root, "check-fr-coverage.mjs");
      assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
      assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("패리티: completeness 문법 규범(Module 부재·불일치, SHALL 없음, Dedup dangling) — Node와 Python 출력 동일", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`  **Status**: Draft\n- **FR-001** just does x.\n- **SC-001**: y.\n\nAcceptance: Given.\n\n## Dedup-Review\n- 이웃 SPEC-777: 비중복\n",
    "sdd/specs/SPEC-002.md": "**Module**: `mod-a`  **Spec**: `SPEC-002`  **Status**: Draft\n- **FR-001** THE SYSTEM SHALL x.\n- **SC-001**: y.\n\nAcceptance: Given.\n",
    "sdd/specs/SPEC-003.md": "**Module**: `mod-b`  **Spec**: `SPEC-003`  **Status**: Draft\n- **FR-001** THE SYSTEM SHALL x.\n- **SC-001**: y.\n\nAcceptance: Given.\n",
  });
  try {
    for (const args of [[], ["--strict"]]) {
      const p = runPy(root, ["completeness", ...args]);
      const n = runNode(root, "check-spec-completeness.mjs", args);
      assert.equal(p.code, n.code, `exit code 불일치(${args})\npy:${p.out}\nnode:${n.out}`);
      assert.equal(p.out, n.out, `출력 불일치(${args})\npy:${p.out}\nnode:${n.out}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("패리티: ownership Files 카테고리 금지 — Node와 Python 출력 동일(exit 1)", skip, () => {
  const root = fixture(
    { "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: thing\n" },
    { ownershipCategories: ["Entities", "Files"] });
  try {
    const p = runPy(root, ["ownership"]);
    const n = runNode(root, "check-ownership.mjs");
    assert.equal(p.code, 1, p.out);
    assert.equal(p.code, n.code);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("패리티: ownership 정책 inert 고지(hard 차단·advisory 고지·off 침묵) — Node와 Python 출력 동일", skip, () => {
  const spec = { "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\nwizard 얘기.\n## Ownership\n- **Aggregates**: wizard\n- **Capabilities**: wizard.create\n" };
  const scen = [
    // 카테고리 개명(A-1): capability 귀속 hard → inert 사유 + exit 1
    { ownershipCategories: ["Aggregates", "Surfaces", "Capabilities"], capabilityOwnershipPolicy: "hard" },
    { ownershipCategories: ["Aggregates", "Surfaces", "Capabilities"], capabilityOwnershipPolicy: "advisory" },
    { ownershipCategories: ["Aggregates", "Surfaces", "Capabilities"], capabilityOwnershipPolicy: "off" },
    // sources 비우기(A-3): 백킹 hard → inert 사유 + exit 1
    { capabilityOwnershipPolicy: "off", entitySchemaBackingPolicy: "hard", entitySchemaSources: [] },
    { capabilityOwnershipPolicy: "off", entitySchemaBackingPolicy: "advisory", entitySchemaSources: [] },
    // 비-웹 카테고리 + 기본 정책(킷 자신) — 양판 동일하게 플레인 고지
    { ownershipCategories: ["Modules", "Symbols", "Artifacts"] },
  ];
  for (const cfg of scen) {
    const root = fixture(spec, cfg);
    try {
      const p = runPy(root, ["ownership"]);
      const n = runNode(root, "check-ownership.mjs");
      assert.equal(p.out, n.out, `출력 불일치 (${JSON.stringify(cfg)})\npy:${p.out}\nnode:${n.out}`);
      assert.equal(p.code, n.code, `exit 불일치 (${JSON.stringify(cfg)})`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("py specsync staged: 미지원 glob 문법 → exit 1 (Node 패리티)", skip, () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": "# SPEC-001\n**Spec**: `SPEC-001`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Files**: src/lib/?.ts\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | r |\n",
    "src/other.txt": "x\n",
  });
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  g("add", "-A"); g("commit", "-qm", "base");
  try {
    writeFileSync(join(root, "src/other.txt"), "y\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "chore: touch\n");
    const p = runPy(root, ["specsync", "--staged", "--message-file", "msg"]);
    const n = runNode(root, "check-spec-sync.mjs", ["--staged", "--message-file", "msg"]);
    assert.equal(p.code, 1, p.out);
    assert.equal(p.code, n.code, `exit code 불일치\npy:${p.out}\nnode:${n.out}`);
    assert.equal(p.out, n.out, `출력 불일치\npy:${p.out}\nnode:${n.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── testrun 게이트 패리티(SPEC-021) ──
test("py testrun: off·advisory·hard × green/실패/미선언 — Node·Python 바이트 동일", skip, () => {
  const scen = [
    { runTestsPolicy: "off", commands: { test: "false" } },
    { runTestsPolicy: "advisory", commands: { test: "false" } },
    { runTestsPolicy: "hard", commands: { test: "false" } },
    { runTestsPolicy: "hard", commands: { test: "true" } },
    { runTestsPolicy: "hard" },
    { runTestsPolicy: "bogus" },
  ];
  for (const cfg of scen) {
    const root = fixture({}, cfg);
    try {
      const n = runNode(root, "check-test-run.mjs");
      const p = runPy(root, ["testrun"]);
      assert.equal(p.out, n.out, `출력 동일 (${JSON.stringify(cfg)})`);
      assert.equal(p.code, n.code, `exit 동일 (${JSON.stringify(cfg)})`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── schemadrift 게이트 패리티(SPEC-022) ──
test("py schemadrift: 미설정·드리프트·일치·조회실패·미정의정책 — Node·Python 바이트 동일", skip, () => {
  const scen = [
    {},
    { migrationStatePolicy: "hard", schemaDriftManifest: { expected: "printf 't.a\\nt.b\\n'", deployed: "printf 't.a\\n'" } },
    { migrationStatePolicy: "advisory", schemaDriftManifest: { expected: "printf 't.a\\n'", deployed: "printf 't.a\\nt.b\\n'" } },
    { migrationStatePolicy: "hard", schemaDriftManifest: { expected: "exit 3", deployed: "printf x" } },
    { migrationStatePolicy: "x", schemaDriftManifest: { expected: "printf a", deployed: "printf a" } },
  ];
  for (const cfg of scen) {
    const root = fixture({}, cfg);
    try {
      const n = runNode(root, "check-schema-drift.mjs");
      const p = runPy(root, ["schemadrift"]);
      assert.equal(p.out, n.out, `출력 동일 (${JSON.stringify(cfg)})`);
      assert.equal(p.code, n.code, `exit 동일 (${JSON.stringify(cfg)})`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── ratchet 게이트 패리티(SPEC-027) ──
test("py ratchet: off·하향(advisory/hard)·상향·예외부채·미조회·미정의정책 — Node·Python 바이트 동일", skip, () => {
  const scen = [
    [{ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "off" }, "main"],
    [{ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "advisory" }, "main"],
    [{ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "hard" }, "main"],
    [{ frKeyAnchorPolicy: "advisory" }, { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "hard" }, "main"],
    [{ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "off", policyRatchetPolicy: "hard", policyRatchetExceptions: ["frKeyAnchorPolicy"] }, "main"],
    [{ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "off", policyRatchetPolicy: "hard" }, "no-such-ref"],
    [{ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "strict" }, "main"],
    // 자기포함(A-2): base hard인데 워킹트리 off 한 줄 → base 시점 강도로 판정(양판 동일해야 한다)
    [{ frKeyAnchorPolicy: "hard", policyRatchetPolicy: "hard" }, { frKeyAnchorPolicy: "off", policyRatchetPolicy: "off" }, "main"],
    [{ policyRatchetPolicy: "hard" }, { policyRatchetPolicy: "off", policyRatchetExceptions: ["policyRatchetPolicy"] }, "main"],
    [{ frKeyAnchorPolicy: "hard", policyRatchetPolicy: "off" }, { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "off" }, "main"],
    [{ frKeyAnchorPolicy: "hard", policyRatchetPolicy: "off" }, { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "hard" }, "main"],
    // 구조 knob 래칫(이슈 #21 A-3): entityRegistry가 {}로 붕괴 → 등록 요구 전체 비활성.
    [{ policyRatchetPolicy: "hard", entityRegistry: { wizard: "aggregate" } }, { policyRatchetPolicy: "hard", entityRegistry: {} }, "main"],
    // ignoreDirs 확장 + commands.test 무력화가 한 커밋에 같이 옴.
    [{ policyRatchetPolicy: "hard", ignoreDirs: ["node_modules"], commands: { test: "npm test" } },
      { policyRatchetPolicy: "hard", ignoreDirs: ["node_modules", "src"], commands: { test: "true" } }, "main"],
    // specDir 재지정도 예외 선언하면 부채로만 표면화(exit 0).
    [{ policyRatchetPolicy: "hard", specDir: "sdd/specs" },
      { policyRatchetPolicy: "hard", specDir: "specs", policyRatchetExceptions: ["specDir"] }, "main"],
    // relationTypes·strictSpecs 축소는 위반, retiredIds 확장도 위반 — 셋이 같은 커밋.
    [{ policyRatchetPolicy: "hard", relationTypes: ["has-many"], strictSpecs: ["SPEC-001"], retiredIds: [] },
      { policyRatchetPolicy: "hard", relationTypes: [], strictSpecs: [], retiredIds: ["CICD-005"] }, "main"],
  ];
  for (const [baseCfg, curCfg, base] of scen) {
    const root = mkdtempSync(join(tmpdir(), "sdd-py-ratchet-"));
    const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
      writeFileSync(join(root, "sdd.config.json"), JSON.stringify(baseCfg));
      git(["add", "-A"]); git(["commit", "-qm", "base"]); git(["branch", "-M", "main"]);
      writeFileSync(join(root, "sdd.config.json"), JSON.stringify(curCfg));
      const n = runNode(root, "check-policy-ratchet.mjs", [base]);
      const p = runPy(root, ["ratchet", base]);
      assert.equal(p.out, n.out, `출력 동일 (${JSON.stringify(curCfg)})`);
      assert.equal(p.code, n.code, `exit 동일 (${JSON.stringify(curCfg)})`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── engineevent 게이트 패리티(SPEC-030) ──
test("py engineevent: off·실재·유령·귀속·inert·미정의정책 — Node·Python 바이트 동일", skip, () => {
  const eeCfg = {
    ownershipCategories: ["Entities", "Engines", "Events"],
    ownershipCategoryRoles: { Entities: "entity", Engines: "engine", Events: "event" },
    enginesSources: [{ globs: ["src/*.js"], patterns: ["export function ([a-zA-Z0-9_]+)"] }],
    eventCatalogSources: [{ globs: ["src/*.js"], patterns: ['emit\\("([a-zA-Z0-9_.]+)"'] }],
  };
  const okSpecs = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: order\n- **Engines**: priceRules\n- **Events**: order.created\n",
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n## Ownership\n- **Engines**: nonexist\n- **Events**: ghost.thing\n",
    "src/logic.js": 'export function priceRules(){}\nemit("order.created");\n',
  };
  const scen = [
    { ...eeCfg }, // 둘 다 off
    { ...eeCfg, engineRealityPolicy: "hard", eventAttributionPolicy: "advisory" },
    { ...eeCfg, engineRealityPolicy: "advisory", eventAttributionPolicy: "hard" },
    { ...eeCfg, enginesSources: [], engineRealityPolicy: "hard" }, // inert 거짓안전
    { ...eeCfg, engineRealityPolicy: "bogus" },                    // enum 밖
  ];
  for (const cfg of scen) {
    const root = fixture(okSpecs, cfg);
    try {
      const n = runNode(root, "check-engine-event.mjs");
      const p = runPy(root, ["engineevent"]);
      assert.equal(p.out, n.out, `출력 동일 (${JSON.stringify(cfg.engineRealityPolicy)}/${JSON.stringify(cfg.eventAttributionPolicy)})`);
      assert.equal(p.code, n.code, `exit 동일`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── ownership 구조 문법 3종 패리티(SPEC-002 FR-011: G1·G2·G3) ──
test("py ownership G1·G2·G3: 미선언·카테고리간·Files겹침 — Node·Python 바이트 동일", skip, () => {
  const scen = [
    { cfg: { ownershipRequiredPolicy: "hard" }, files: {
      "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Entities**: alpha"),
      "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\nno ownership block\n" } },
    { cfg: { surfaceFormat: "any", crossCategoryDedupPolicy: "hard" }, files: {
      "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Entities**: order"),
      "sdd/specs/SPEC-002.md": OWN("SPEC-002", "- **Surfaces**: order") } },
    { cfg: { filesOverlapPolicy: "hard" }, files: {
      "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Entities**: alpha\n- **Files**: sdd/specs/SPEC-001.md"),
      "sdd/specs/SPEC-002.md": OWN("SPEC-002", "- **Entities**: beta\n- **Files**: sdd/specs/SPEC-001.md") } },
    { cfg: { crossCategoryDedupPolicy: "advisory", filesOverlapPolicy: "advisory" }, files: {
      "sdd/specs/SPEC-001.md": OWN("SPEC-001", "- **Entities**: alpha") } },
  ];
  for (const { cfg, files } of scen) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-ownership.mjs");
      const p = runPy(root, ["ownership"]);
      assert.equal(p.out, n.out, `출력 동일 (${JSON.stringify(cfg)})`);
      assert.equal(p.code, n.code, `exit 동일 (${JSON.stringify(cfg)})`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 의미 커버리지·결정 입도·근거 적용범위 패리티(SPEC-042·043·044) ──
test("py fr: 의미 커버리지·결정 입도 — 용어집 미선언/미실증/미공개 세 갈래 바이트 동일", skip, () => {
  const SPEC = (own, extra = "") =>
    `# S\n**Spec**: \`SPEC-001\`\n**Module**: \`m\`\n**Status**: Active\n`
    + `## Functional Requirements\n- **FR-001** (event): THE SYSTEM SHALL speak MCP to ${extra || "the browser"}.\n`
    + `\n## Ownership\n- **Entities**: thing\n- **Files**: ${own}\n`;
  const scen = [
    // ① 용어집 미선언 — "판정하지 않는다"를 양판이 같은 문장으로 말한다.
    { cfg: {}, files: {
      "sdd/specs/SPEC-001.md": SPEC("src/**"),
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => {});\n" } },
    // ② 미실증 — FR이 MCP를 주장하는데 커버 파일에 그 이름이 없다.
    { cfg: { termGlossary: ["MCP"] }, files: {
      "sdd/specs/SPEC-001.md": SPEC("src/**"),
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => {});\n" } },
    // ③ 동의어 등록으로 해소 — 면제가 아니라 어휘 등록이 정답이다.
    { cfg: { termGlossary: [{ term: "MCP", synonyms: ["chrome-bridge"] }] }, files: {
      "sdd/specs/SPEC-001.md": SPEC("src/**"),
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\nimport x from 'chrome-bridge';\n" } },
    // ④ 결정 입도 — env 폴백 기본값이 외부 대상인데 소유 스펙이 모른다.
    { cfg: { termGlossary: [] }, files: {
      "sdd/specs/SPEC-001.md": SPEC("src/**"),
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\nconst U = process.env.BASE_URL || \"https://api.vendor.io\";\n" } },
    // ⑤ hard 승격 — 양판이 같은 지점에서 막는다.
    { cfg: { externalTargetPolicy: "hard" }, files: {
      "sdd/specs/SPEC-001.md": SPEC("src/**"),
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\nconst U = process.env.BASE_URL || \"https://api.vendor.io\";\n" } },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-fr-coverage.mjs");
      const p = runPy(root, ["fr"]);
      assert.equal(p.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(p.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("py completeness: 근거 적용범위 — 환경 지목 관측/범위 표기/hard 승격 바이트 동일", skip, () => {
  const CL = (rationale) => `# S\n**Spec**: \`SPEC-001\`\n**Module**: \`m\`\n**Status**: Active\n`
    + `## Ownership\n- **Entities**: thing\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-08-10 | x | ${rationale} |\n`;
  const scen = [
    { cfg: {}, files: { "sdd/specs/SPEC-001.md": CL("리눅스에서 실측: DISPLAY 없음") } },
    { cfg: {}, files: { "sdd/specs/SPEC-001.md": CL("리눅스에서 실측. 범위: X 없는 CI 러너 한정") } },
    { cfg: {}, files: { "sdd/specs/SPEC-001.md": CL("소비 프로젝트 실측 — 환경 무관") } },
    { cfg: { evidenceScopePolicy: "hard" }, files: { "sdd/specs/SPEC-001.md": CL("리눅스에서 실측: DISPLAY 없음") } },
    { cfg: { evidenceScopePolicy: "off" }, files: { "sdd/specs/SPEC-001.md": CL("리눅스에서 실측: DISPLAY 없음") } },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-spec-completeness.mjs");
      const p = runPy(root, ["completeness"]);
      assert.equal(p.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(p.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 소개 문서 동기 패리티(SPEC-045) ──
test("py introdoc: 미선언 inert·규칙 누락·인용 불일치·문서 부재 — Node·Python 바이트 동일", skip, () => {
  const TABLE = ["| 규칙 | 언제 | 게이트 |", "|---|---|---|",
    "| **R1 spec→code** | x | `check-fr-coverage` |",
    "| **R9 라이브 대조** | x | `check-live-reality` |"].join("\n");
  const scen = [
    { cfg: {}, files: { "HARNESS.md": TABLE } },                                        // introDocs 미선언 → INERT
    { cfg: { introDocs: ["docs/intro.html"], introDocPolicy: "hard" },
      files: { "HARNESS.md": TABLE, "docs/intro.html": "<p>R1만 설명</p>" } },           // R9 누락 → hard 차단
    { cfg: { introDocs: ["docs/intro.html"] },
      files: { "HARNESS.md": TABLE, "docs/intro.html": "<p>R1만 설명</p>" } },           // advisory → 표면화만
    { cfg: { introDocs: ["docs/intro.html"], introDocPolicy: "hard" },
      files: { "HARNESS.md": TABLE, "docs/intro.html": `<p>R1 R9 — 규칙 <span data-sdd-count="rules">7</span>종 · <span data-sdd-count="rulez">1</span></p>` } },
    { cfg: { introDocs: ["docs/gone.html"] }, files: { "HARNESS.md": TABLE } },          // 선언했는데 없음 → 차단
    { cfg: { introDocs: ["docs/intro.html"] }, files: { "docs/intro.html": "<p>x</p>" } }, // 규칙표 없음 → INERT
    { cfg: { introDocs: ["docs/intro.html"], introDocPolicy: "off" }, files: { "HARNESS.md": TABLE } },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-intro-doc.mjs");
      const p = runPy(root, ["introdoc"]);
      assert.equal(p.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(p.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 지목 구현체 참조 패리티(SPEC-046) ──
test("py fr: 지목 구현체 참조 — 고아·전무·통과·커버 미언급·hard 차단 바이트 동일", skip, () => {
  const SPEC = (frBody, own) => `# S\n**Spec**: \`SPEC-001\`\n**Module**: \`m\`\n**Status**: Active\n`
    + `## Functional Requirements\n- **FR-001** (event): THE SYSTEM SHALL ${frBody}\n`
    + `\n## Ownership\n- **Entities**: thing\n- **Files**: ${own}\n`;
  const CALL = "extract tickets via `extractDeployTickets()`.";
  const scen = [
    // ① 고아 — 정의뿐, 표면은 쉘로 다시 구현
    { cfg: {}, files: {
      "sdd/specs/SPEC-001.md": SPEC(CALL, "src/**"),
      "src/tickets.mjs": "export function extractDeployTickets(r) { return r; }\n",
      "src/Jenkinsfile": "DEPLOY_TICKETS=$(git log | grep -oE 'PJT-[0-9]+')\n",
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => {});\n" } },
    // ② 전무 — 이름이 아예 없다
    { cfg: {}, files: {
      "sdd/specs/SPEC-001.md": SPEC(CALL, "src/**"),
      "src/tickets.mjs": "export function somethingElse(r) { return r; }\n",
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => {});\n" } },
    // ③ 통과 — 정의 + 호출, 커버 테스트도 그 이름을 안다
    { cfg: {}, files: {
      "sdd/specs/SPEC-001.md": SPEC(CALL, "src/**"),
      "src/tickets.mjs": "export function extractDeployTickets(r) { return r; }\n",
      "src/run.mjs": `import { extractDeployTickets } from "./tickets.mjs";\nextractDeployTickets(1);\n`,
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\nimport {extractDeployTickets} from '../src/tickets.mjs';\ntest('x', () => {});\n" } },
    // ④ 커버 미언급 — 실행 경로는 멀쩡한데 테스트가 그 이름을 모른다(구현 형태 단언 의심)
    { cfg: {}, files: {
      "sdd/specs/SPEC-001.md": SPEC(CALL, "src/**"),
      "src/tickets.mjs": "export function extractDeployTickets(r) { return r; }\n",
      "src/run.mjs": "extractDeployTickets(1);\n",
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => { expect(s).toMatch(/DEPLOY_TICKETS=/); });\n" } },
    // ⑤ hard 승격 — 양판이 같은 지점에서 막는다
    { cfg: { implReferencePolicy: "hard" }, files: {
      "sdd/specs/SPEC-001.md": SPEC(CALL, "src/**"),
      "src/tickets.mjs": "export function extractDeployTickets(r) { return r; }\n",
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => {});\n" } },
    // ⑥ off — 판정하지 않는다고 선언
    { cfg: { implReferencePolicy: "off" }, files: {
      "sdd/specs/SPEC-001.md": SPEC(CALL, "src/**"),
      "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => {});\n" } },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-fr-coverage.mjs");
      const p = runPy(root, ["fr"]);
      assert.equal(p.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(p.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 순차 프로세스 SSOT 패리티(SPEC-047) ──
test("py processssot: 미선언 inert·SSOT 부재·빠진 단계·조각 보유·저장소 미선언/미소유 바이트 동일", skip, () => {
  const CHAIN = ["로컬 실측", "커밋·푸시", "배포", "개발 실측", "교차검증 일치", "dev-done"];
  const OWN = (files) => `# S\n**Spec**: \`SPEC-001\`\n로컬 실측을 다룬다.\n## Ownership\n- **Entities**: run\n- **Files**: ${files}\n`;
  const scen = [
    { cfg: {}, files: {} },                                                            // 미선언 → INERT
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: CHAIN } }, processSsotPolicy: "hard" }, files: {} },  // SSOT 부재
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: CHAIN } } },
      files: { "docs/C.md": "# c\n로컬 실측만 있다\n" } },                              // 빠진 단계 + 조각 보유
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: CHAIN } } },
      files: { "docs/C.md": "# c\n" + CHAIN.join(" → ") + "\n" } },                     // 저장소 미선언(교차검증)
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: [...CHAIN.slice(0, 4), { name: "교차검증 일치", state: ".sdd/runs.jsonl" }, "dev-done"] } } },
      files: { "docs/C.md": "# c\n" + CHAIN.join(" → ") + "\n", "sdd/specs/SPEC-001.md": OWN("src/**") } },  // 미소유 저장소
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: [...CHAIN.slice(0, 4), { name: "교차검증 일치", state: ".sdd/runs.jsonl" }, "dev-done"] } } },
      files: { "docs/C.md": "# c\n" + CHAIN.join(" → ") + "\n", "sdd/specs/SPEC-001.md": OWN(".sdd/**, docs/C.md") } },  // 통과
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: ["a"] } } }, files: {} },      // config 문법(1단계)
    { cfg: { processes: { c: { ssot: "docs/C.md", stages: CHAIN } }, processSsotPolicy: "off" }, files: {} },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-process-ssot.mjs");
      const p = runPy(root, ["processssot"]);
      assert.equal(p.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(p.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 감시자 실재 패리티(SPEC-048) ──
test("py watchdog: CI 미배선·영수증 부재/형식·게이트 삭제·통과·off 바이트 동일", skip, () => {
  const R = { kitCommit: "abc1234def", installedAt: "2026-08-10T00:00:00Z", gate: "node", gates: ["scripts/g.mjs"], hooks: [] };
  const CI = "name: sdd\non: [push]\njobs:\n  g:\n    steps:\n      - run: node scripts/sdd-sync.mjs --strict\n";
  const scen = [
    { cfg: { watchdogPolicy: "hard" }, files: {} },                                          // CI·영수증 둘 다 없음
    { cfg: { watchdogPolicy: "hard" }, files: { ".github/workflows/s.yml": CI } },            // 영수증만 없음
    { cfg: { watchdogPolicy: "hard" }, files: { ".github/workflows/s.yml": CI, "sdd/adoption.json": "not json" } },
    { cfg: { watchdogPolicy: "hard" }, files: { ".github/workflows/s.yml": CI, "sdd/adoption.json": JSON.stringify({ gates: ["x"] }) } },
    { cfg: { watchdogPolicy: "hard" }, files: { ".github/workflows/s.yml": CI, "sdd/adoption.json": JSON.stringify(R) } },  // 게이트 삭제
    { cfg: { watchdogPolicy: "hard" }, files: { ".github/workflows/s.yml": CI, "sdd/adoption.json": JSON.stringify(R), "scripts/g.mjs": "//\n" } },  // 통과
    { cfg: {}, files: {} },                                                                   // advisory 비차단
    { cfg: { watchdogPolicy: "off" }, files: {} },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-watchdog.mjs");
      const p = runPy(root, ["watchdog"]);
      assert.equal(p.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(p.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 배선 무결성 패리티(SPEC-050) ──
// ⚠ 이 게이트는 **자기 디렉터리**를 판정 대상으로 삼는다(설치된 게이트 집합이 곧 판정 범위다).
// 그래서 패리티 픽스처는 두 런타임을 같은 `scripts/`에 나란히 깔고 그 안에 구판 lib을 심는다 —
// 정본 디렉터리를 보게 하면 두 판이 똑같이 "킷은 깨끗하다"를 내어 대조가 아무것도 증명하지 않는다.
test("py importwiring: export 없음·파일 없음·확인 못 함·통과·off·inert 바이트 동일", skip, () => {
  const closure = (entry) => {
    const seen = new Set(); const stack = [entry];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      let t; try { t = readFileSync(join(TOOLING, f), "utf8"); } catch { continue; }
      for (const imp of localImports(t)) stack.push(imp.specifier.replace(/^\.\//, ""));
    }
    return [...seen];
  };
  const scen = [
    // ① 제보의 형태: 파일은 있는데 export가 없다(부분 동기화)
    { cfg: { importWiringPolicy: "hard" }, plant: { "stale-lib.mjs": "export function present() {}\n", "consumer.mjs": 'import { present, absent } from "./stale-lib.mjs";\n' } },
    // ② 파일 자체가 없다(복사 목록 누락)
    { cfg: { importWiringPolicy: "hard" }, plant: { "consumer.mjs": 'import { x } from "./gone.mjs";\n' } },
    // ③ 확인 못 함 — 비-로컬 재수출은 위반이 아니다
    { cfg: { importWiringPolicy: "hard" }, plant: { "facade.mjs": 'export * from "some-package";\n', "consumer.mjs": 'import { maybe } from "./facade.mjs";\n' } },
    // ④ 통과
    { cfg: { importWiringPolicy: "hard" }, plant: {} },
    // ⑤ advisory는 막지 않는다
    { cfg: { importWiringPolicy: "advisory" }, plant: { "stale-lib.mjs": "export function present() {}\n", "consumer.mjs": 'import { present, absent } from "./stale-lib.mjs";\n' } },
    { cfg: { importWiringPolicy: "off" }, plant: {} },
    // ⑥ 모듈 0건 → INERT(0건은 '깨끗함'이 아니다)
    { cfg: { importWiringPolicy: "hard", importWiringExtensions: ["nosuchext"] }, plant: {} },
    // ⑦ 값 위반은 양판이 같은 문장으로 거부한다
    { cfg: { importWiringPolicy: "loose" }, plant: {} },
  ];
  for (const [i, { cfg, plant }] of scen.entries()) {
    const root = fixture({}, cfg);
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      for (const f of closure("check-import-wiring.mjs")) cpSync(join(TOOLING, f), join(root, "scripts", f));
      cpSync(PY, join(root, "scripts", "sdd_gates.py"));
      for (const [name, body] of Object.entries(plant)) writeFileSync(join(root, "scripts", name), body);
      const runIn = (cmd, args) => {
        try { return { code: 0, out: execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
        catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
      };
      const n = runIn("node", [join(root, "scripts", "check-import-wiring.mjs")]);
      const py = runIn("python3", [join(root, "scripts", "sdd_gates.py"), "importwiring"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  console.log("IMPORTWIRING PARITY OK");
});

// ── 에이전트 배선 패리티(SPEC-051) ──
// ⚠ 이 게이트도 판정 입력이 **저장소 상태**(선언 파일·설정 파일)이므로 픽스처에 두 런타임을
// 나란히 깔고 같은 상태를 보게 한다.
test("py agentwiring: 설정 부재·미배선·매처 좁음·스크립트 부재·통과·advisory·off·inert·값 위반 바이트 동일", skip, () => {
  const closure = (entry) => {
    const seen = new Set(); const stack = [entry];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      let t; try { t = readFileSync(join(TOOLING, f), "utf8"); } catch { continue; }
      for (const imp of localImports(t)) stack.push(imp.specifier.replace(/^\.\//, ""));
    }
    return [...seen];
  };
  const DECL = "SessionStart  -           sdd-session-context.sh\nPreToolUse    Write|Edit  sdd-edit-check.sh\n";
  const wire = (matcher, cmd) => ({ hooks: { PreToolUse: [{ matcher, hooks: [{ type: "command", command: cmd }] }] } });
  const scen = [
    { cfg: { agentWiringPolicy: "hard" }, decl: DECL, settings: null, scripts: true },      // 설정 부재
    { cfg: { agentWiringPolicy: "hard" }, decl: DECL, settings: { hooks: {} }, scripts: true }, // 미배선
    { cfg: { agentWiringPolicy: "hard" }, decl: DECL, settings: wire("Write", "sh scripts/sdd-edit-check.sh"), scripts: true }, // 매처 좁음
    { cfg: { agentWiringPolicy: "hard" }, decl: DECL, settings: wire("Write|Edit", "sh scripts/sdd-edit-check.sh"), scripts: false }, // 스크립트 부재
    { cfg: { agentWiringPolicy: "advisory" }, decl: DECL, settings: { hooks: {} }, scripts: true }, // 비차단
    { cfg: { agentWiringPolicy: "off" }, decl: DECL, settings: null, scripts: true },
    { cfg: { agentWiringPolicy: "hard" }, decl: null, settings: null, scripts: true },      // 선언 파일 없음 → INERT
    { cfg: { agentWiringPolicy: "hard" }, decl: "# 주석만\n", settings: null, scripts: true }, // 선언 0건 → INERT
    { cfg: { agentWiringPolicy: "nope" }, decl: DECL, settings: null, scripts: true },      // 값 위반
  ];
  for (const [i, sc] of scen.entries()) {
    const root = fixture({}, sc.cfg);
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      for (const f of closure("check-agent-wiring.mjs")) cpSync(join(TOOLING, f), join(root, "scripts", f));
      cpSync(PY, join(root, "scripts", "sdd_gates.py"));
      if (sc.decl !== null) writeFileSync(join(root, "scripts", "agent-hooks.list"), sc.decl);
      if (sc.scripts) for (const n of ["sdd-session-context.sh", "sdd-edit-check.sh"]) writeFileSync(join(root, "scripts", n), "#!/bin/sh\n");
      if (sc.settings) {
        mkdirSync(join(root, ".claude"), { recursive: true });
        writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(sc.settings, null, 2));
      }
      const runIn = (cmd, args) => {
        try { return { code: 0, out: execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
        catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
      };
      const n = runIn("node", [join(root, "scripts", "check-agent-wiring.mjs")]);
      const py = runIn("python3", [join(root, "scripts", "sdd_gates.py"), "agentwiring"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
      // 생성 모드도 양판 동일해야 한다 — 설치기가 어느 런타임에서 돌든 같은 배선이 나와야 한다.
      const ne = runIn("node", [join(root, "scripts", "check-agent-wiring.mjs"), "--emit-settings"]);
      const pe = runIn("python3", [join(root, "scripts", "sdd_gates.py"), "agentwiring", "--emit-settings"]);
      assert.equal(pe.out, ne.out, `시나리오 ${i + 1} --emit-settings 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  console.log("AGENTWIRING PARITY OK");
});

// ── 명세 모순 감사 패리티(SPEC-052) ──
test("py specconflict: 교차 모순·한 스펙 내 모순·흔한 술어·통과·advisory·off·inert 바이트 동일", skip, () => {
  const FR = (body) => `**Spec**: \`SPEC-9XX\`\n## Functional Requirements\n${body}`;
  const common = {};
  for (let i = 0; i < 6; i++) common[`SPEC-${910 + i}`] = FR(`- **FR-001** THE SYSTEM SHALL report a violation.\n`);
  common["SPEC-950"] = FR("- **FR-001** THE SYSTEM SHALL NOT report a violation.\n");
  const scen = [
    // ① 제보의 형태 — 교차 스펙 상반
    { cfg: { specConflictPolicy: "hard" }, specs: {
      "SPEC-900": FR("- **FR-001** THE SYSTEM SHALL use ArgoCD for deployment synchronisation.\n"),
      "SPEC-901": FR("- **FR-001** THE SYSTEM SHALL NOT use ArgoCD for deployment synchronisation.\n") } },
    // ② 짧은 술어(포함 관계)
    { cfg: { specConflictPolicy: "hard" }, specs: {
      "SPEC-900": FR("- **FR-001** THE SYSTEM SHALL use ArgoCD for deployment synchronisation.\n"),
      "SPEC-903": FR("- **FR-001** THE SYSTEM SHALL NOT use ArgoCD.\n") } },
    // ③ 한 스펙 내 모순
    { cfg: { specConflictPolicy: "hard" }, specs: {
      "SPEC-900": FR("- **FR-001** THE SYSTEM SHALL use ArgoCD for sync.\n- **FR-002** THE SYSTEM SHALL NOT use ArgoCD for sync.\n") } },
    // ④ 다른 목적어 — 모순 아님
    { cfg: { specConflictPolicy: "hard" }, specs: {
      "SPEC-900": FR("- **FR-001** THE SYSTEM SHALL block the commit and SHALL NOT block the push.\n") } },
    // ⑤ 흔한 술어 — 희귀 토큰 없음 → 후보 아님
    { cfg: { specConflictPolicy: "hard" }, specs: common },
    // ⑥ advisory 비차단
    { cfg: { specConflictPolicy: "advisory" }, specs: {
      "SPEC-900": FR("- **FR-001** THE SYSTEM SHALL use ArgoCD for sync.\n"),
      "SPEC-901": FR("- **FR-001** THE SYSTEM SHALL NOT use ArgoCD for sync.\n") } },
    { cfg: { specConflictPolicy: "off" }, specs: {} },
    // ⑦ SHALL 0건 → INERT
    { cfg: { specConflictPolicy: "hard" }, specs: { "SPEC-900": FR("- **FR-001** 이 시스템은 항목을 만든다.\n") } },
    // ⑧ 스펙 0건 → INERT
    { cfg: { specConflictPolicy: "hard" }, specs: {} },
    // ⑨ 값 위반
    { cfg: { specConflictPolicy: "loose" }, specs: {} },
  ];
  for (const [i, sc] of scen.entries()) {
    const root = fixture({}, sc.cfg);
    try {
      for (const [name, body] of Object.entries(sc.specs)) writeFileSync(join(root, "sdd", "specs", `${name}.md`), body);
      const n = runNode(root, "check-spec-conflict.mjs");
      const py = runPy(root, ["specconflict"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  console.log("SPECCONFLICT PARITY OK");
});

// ── 진단 가드 패리티(SPEC-053) ── 훅·스윕 **두 모드** 모두 대조한다.
test("py diagnosisguard: 금지·노출·명세읽기·무관·선언위반·inert·off 바이트 동일(훅+스윕)", skip, () => {
  const RULE = { match: "kubectl get application", spec: "INFRA-004.md", mode: "deny",
    why: "소유자 결정으로 GitOps를 쓰지 않는다", instead: ["젠킨스 빌드 결과"] };
  const scen = [
    { cfg: { diagnosisGuardPolicy: "hard", diagnosisSpecMap: [RULE] } },
    { cfg: { diagnosisGuardPolicy: "hard", diagnosisSpecMap: [{ ...RULE, mode: "surface" }] } },
    { cfg: { diagnosisGuardPolicy: "advisory", diagnosisSpecMap: [RULE] } },
    { cfg: { diagnosisGuardPolicy: "hard", diagnosisSpecMap: [{ ...RULE, spec: "NOPE.md" }] } }, // 선언 위반
    { cfg: { diagnosisGuardPolicy: "hard", diagnosisSpecMap: [{ ...RULE, instead: [] }] } },     // deny-without-instead
    { cfg: { diagnosisGuardPolicy: "hard", diagnosisSpecMap: [] } },                             // INERT
    { cfg: { diagnosisGuardPolicy: "off", diagnosisSpecMap: [RULE] } },
    { cfg: { diagnosisGuardPolicy: "bogus", diagnosisSpecMap: [] } },                            // 값 위반
  ];
  const CMDS = ["kubectl get application -A", "grep -n kubectl sdd/specs/INFRA-004.md", "npm test", ""];
  for (const [i, sc] of scen.entries()) {
    const root = fixture({ "sdd/specs/INFRA-004.md": "**Spec**: `INFRA-004`\n## Edge Cases\n- x\n" }, sc.cfg);
    try {
      // 스윕 모드
      const n = runNode(root, "check-diagnosis-guard.mjs");
      const py = runPy(root, ["diagnosisguard"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 스윕 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} 스윕 exit 불일치`);
      // 훅 모드 — 명령별로
      for (const cmd of CMDS) {
        const input = JSON.stringify({ tool_input: { command: cmd } });
        const one = (bin, args) => {
          try { return { code: 0, out: execFileSync(bin, args, { cwd: root, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }) }; }
          catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
        };
        // 기존 runNode·runPy와 같이 **킷 경로**의 게이트를 cwd=root로 돌린다(픽스처는 config·스펙만 준다).
        const hn = one("node", [join(TOOLING, "check-diagnosis-guard.mjs"), "--hook"]);
        const hp = one("python3", [PY, "diagnosisguard", "--hook"]);
        assert.equal(hp.out, hn.out, `시나리오 ${i + 1} 훅 출력 불일치 (cmd=${cmd})`);
        assert.equal(hp.code, hn.code, `시나리오 ${i + 1} 훅 exit 불일치 (cmd=${cmd})`);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  console.log("DIAGGUARD PARITY OK");
});

// ── 훅 배선 실재 패리티(SPEC-036, R12) ──
// 이 축은 여러 라운드 동안 **Node에만 있었다** — 그동안 Python 런타임 프로젝트는 훅 배선을
// 아무도 보지 않는 상태였고 그 0건은 진짜 0건과 구분되지 않았다(SPEC-006의 양판 불변 위반).
// @covers SPEC-006/FR-001
// @covers SPEC-036/FR-005
test("py hooksinstalled: 미설치·권한·남의 훅·낡음·원본 못 읽음·통과·CI 생략·off·inert 바이트 동일", skip, () => {
  const KIT = "#!/bin/sh\n# sdd-managed-hook\nnode scripts/check-spec-sync.mjs --staged\n";
  const OLD = "#!/bin/sh\n# sdd-managed-hook\n";          // 게이트 호출 블록이 빠진 낡은 사본
  const FOREIGN = "#!/bin/sh\necho other\n";
  const scen = [
    { cfg: { hooksInstalledPolicy: "hard" }, files: { "scripts/hooks.list": "pre-commit\n" }, hooks: {} },
    { cfg: { hooksInstalledPolicy: "advisory" }, files: { "scripts/hooks.list": "pre-commit\n" }, hooks: {} },
    { cfg: { hooksInstalledPolicy: "hard" }, files: { "scripts/hooks.list": "pre-commit\n" }, hooks: { "pre-commit": [KIT, 0o644] } },
    { cfg: { hooksInstalledPolicy: "hard" }, files: { "scripts/hooks.list": "pre-commit\n" }, hooks: { "pre-commit": [FOREIGN, 0o755] } },
    // 신선도 — 원본을 선언하고 사본을 낡게 만든다(제보 실측 형태: 빠진 5행이 게이트 호출 블록이었다)
    { cfg: { hooksInstalledPolicy: "hard" }, files: { "scripts/hooks.list": "pre-commit scripts/src-pre-commit\n", "scripts/src-pre-commit": KIT },
      hooks: { "pre-commit": [OLD, 0o755] } },
    { cfg: { hooksInstalledPolicy: "hard" }, files: { "scripts/hooks.list": "pre-commit scripts/src-pre-commit\n", "scripts/src-pre-commit": KIT },
      hooks: { "pre-commit": [KIT, 0o755] } },                                        // 신선함 → 통과
    // 원본이 **선언됐는데 없다** → source-unreadable(통과가 아니다)
    { cfg: { hooksInstalledPolicy: "hard" }, files: { "scripts/hooks.list": "pre-commit scripts/gone\n" }, hooks: { "pre-commit": [KIT, 0o755] } },
    { cfg: { hooksInstalledPolicy: "off" }, files: { "scripts/hooks.list": "pre-commit\n" }, hooks: {} },
    { cfg: { hooksInstalledPolicy: "hard" }, files: {}, hooks: {} },                   // hooks.list 없음 → INERT
  ];
  for (const [i, { cfg, files, hooks }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
      const hd = join(root, ".git", "hooks");
      mkdirSync(hd, { recursive: true });
      for (const [name, [body, mode]] of Object.entries(hooks)) {
        writeFileSync(join(hd, name), body);
        chmodSync(join(hd, name), mode);
      }
      const n = runNode(root, "check-hooks-installed.mjs");
      const py = runPy(root, ["hooksinstalled"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // CI 생략 — **git은 훅을 복제하지 않는다.** 두 판이 같은 문장으로 "판정하지 않았다"를 말해야 한다.
  const root = fixture({ "scripts/hooks.list": "pre-commit\n" }, { hooksInstalledPolicy: "hard" });
  try {
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
    const n = runNode(root, "check-hooks-installed.mjs", [], { CI: "true" });
    const py = runPy(root, ["hooksinstalled"], { CI: "true" });
    assert.equal(py.out, n.out, "CI 생략 출력 불일치");
    assert.equal(py.code, n.code, "CI 생략 exit 불일치");
    assert.equal(n.code, 0, "CI에서 거짓 위반을 내면 사람이 게이트를 끈다");
    assert.match(n.out, /판정하지 않았다\(통과가 아니다\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 구현 중복 패리티(SPEC-038, R13) ──
// 이 축도 여러 라운드 동안 **Node 전용**이었다. 양판 대응 선언을 기계화한 첫 실행이 지목했다
// (`runtime-contract.test.mjs` ⑤) — 규범으로만 적힌 의무는 반드시 새어나간다.
// @covers SPEC-006/FR-001
// @covers SPEC-038/FR-001
test("py duplicatelogic: 중복·면제(사유 없음 포함)·낡은 면제·통과·off·inert 바이트 동일", skip, () => {
  const DUP = 'const a = /같은-규칙-리터럴-A/;\nconst b = /같은-규칙-리터럴-A/;\n';
  const ONE = 'const a = /단-한-곳-리터럴/;\n';
  const scen = [
    { cfg: { duplicateLogicPolicy: "hard", duplicateLiteralFileRegex: ["\\.mjs$"] }, files: { "src/x.mjs": DUP } },
    { cfg: { duplicateLogicPolicy: "advisory", duplicateLiteralFileRegex: ["\\.mjs$"] }, files: { "src/x.mjs": DUP } },
    // 면제 — 사유가 있으면 통과하고 **clean일 때도 보인다**
    { cfg: { duplicateLogicPolicy: "hard", duplicateLiteralFileRegex: ["\\.mjs$"], duplicateLogicAllow: { "같은-규칙-리터럴-A": "정당한 사유" } },
      files: { "src/x.mjs": DUP } },
    // 면제 사유 없음 → exit 1(무언의 면제 금지)
    { cfg: { duplicateLogicPolicy: "advisory", duplicateLiteralFileRegex: ["\\.mjs$"], duplicateLogicAllow: { "같은-규칙-리터럴-A": "" } },
      files: { "src/x.mjs": DUP } },
    // 낡은 면제 — 더 이상 중복이 아니다
    { cfg: { duplicateLogicPolicy: "advisory", duplicateLiteralFileRegex: ["\\.mjs$"], duplicateLogicAllow: { "단-한-곳-리터럴": "사유" } },
      files: { "src/x.mjs": ONE } },
    { cfg: { duplicateLogicPolicy: "hard", duplicateLiteralFileRegex: ["\\.mjs$"] }, files: { "src/x.mjs": ONE } },  // 통과
    // 언어 미선언 + 안 본 확장자 → INERT(킷 기본 JS/TS에 기댄 부분 판정은 전수가 아니다)
    { cfg: { duplicateLogicPolicy: "advisory" }, files: { "src/x.mjs": ONE, "src/y.py": "x = 1\n" } },
    { cfg: { duplicateLogicPolicy: "advisory", duplicateLiteralFileRegex: ["\\.nope$"] }, files: { "src/x.mjs": ONE } },  // 대상 0개 → INERT
    { cfg: { duplicateLogicPolicy: "off" }, files: { "src/x.mjs": DUP } },
  ];
  for (const [i, { cfg, files }] of scen.entries()) {
    const root = fixture(files, cfg);
    try {
      const n = runNode(root, "check-duplicate-logic.mjs");
      const py = runPy(root, ["duplicatelogic"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 완료 판정 신호 강도 패리티(SPEC-055, R22) ──
// @covers SPEC-006/FR-001
// @covers SPEC-055/FR-005
test("py completionsignal: 파생·자기신고·미선언·오타·통과·inert·off 바이트 동일", skip, () => {
  const C = (extra) => ({ id: "deploy", command: "true", ...extra });
  const scen = [
    { cfg: { completionSignalPolicy: "hard", liveRealityChecks: [C({ assertsCompletion: true, signal: "derived" })] } },
    { cfg: { completionSignalPolicy: "advisory", liveRealityChecks: [C({ assertsCompletion: true, signal: "self-report" })] } },
    { cfg: { completionSignalPolicy: "hard", liveRealityChecks: [C({ assertsCompletion: true })] } },
    { cfg: { completionSignalPolicy: "hard", liveRealityChecks: [C({ assertsCompletion: true, signal: "targetstate" })] } },
    { cfg: { completionSignalPolicy: "hard", liveRealityChecks: [C({ assertsCompletion: true, signal: "target-state" })] } },
    { cfg: { completionSignalPolicy: "hard", liveRealityChecks: [C({})] } },        // 완료 주장 0건 → INERT
    { cfg: { completionSignalPolicy: "hard" } },                                     // 선언 자체가 없음 → INERT
    { cfg: { completionSignalPolicy: "off", liveRealityChecks: [C({ assertsCompletion: true, signal: "derived" })] } },
    { cfg: { completionSignalPolicy: "strict" } },                                   // enum 밖 → exit 1
  ];
  for (const [i, { cfg }] of scen.entries()) {
    const root = fixture({}, cfg);
    try {
      const n = runNode(root, "check-completion-signal.mjs");
      const py = runPy(root, ["completionsignal"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ── 편집 시점 spec-first 패리티(SPEC-003 FR-001 확장) ──
// 이 축은 "훅 편의 계층이라 Node 전용" 결정을 받았고 재검토 조건은 "스윕 규칙으로 승격되면"이었다.
// 그런데 **차단 강도**를 갖게 됐다 — 조건이 예상하지 못한 방아쇠다. 차단할 수 있는 층이 한
// 런타임에만 있으면 다른 런타임 프로젝트는 `hard`를 켜고도 보호가 0이다(**hard 선언 + 무판정**).
// @covers SPEC-006/FR-001
// @covers SPEC-003/FR-001
test("py preedit: 미수정 경고·차단(exit 2)·미소유 침묵·git 없음 침묵·off·enum 밖 바이트 동일", skip, () => {
  const SPEC = "# S\n**Spec**: `SPEC-001`\n\n## Ownership\n- **Files**: src/**\n";
  const mk = (policy, { git = true, owned = true } = {}) => {
    const root = fixture({ "sdd/specs/SPEC-001.md": SPEC, "src/a.ts": "export const a = 1;\n" },
      { scanDirs: ["src"], preEditSpecFirstPolicy: policy });
    if (git) {
      execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: root, stdio: "ignore" });
      writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");   // 코드만 변경
    }
    return { root, rel: owned ? "src/a.ts" : "other.txt" };
  };
  const scen = [
    ["advisory", {}], ["hard", {}],
    ["hard", { owned: false }],          // 미소유 → 침묵
    ["hard", { git: false }],            // 변경 집합 미해석 → 침묵(판정 못 하는 자리는 막지 않는다)
    ["off", {}], ["deny", {}],           // off / enum 밖
  ];
  for (const [i, [policy, opts]] of scen.entries()) {
    const { root, rel } = mk(policy, opts);
    try {
      const n = runNode(root, "check-pre-edit.mjs", [rel]);
      const py = runPy(root, ["preedit", rel]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1}(${policy}) 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1}(${policy}) exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // 코드 경로 질의 모드도 같은 답을 내야 한다 — 쉘이 체크리스트 표시를 이 답에 걸어둔다.
  const { root } = mk("advisory");
  try {
    for (const rel of ["src/a.ts", "docs/x.md"]) {
      const n = runNode(root, "check-pre-edit.mjs", ["--is-code-path", rel]);
      const py = runPy(root, ["preedit", "--is-code-path", rel]);
      assert.equal(py.code, n.code, `질의 모드 ${rel} exit 불일치`);
      assert.equal(py.out, n.out, `질의 모드 ${rel} 출력 불일치`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── FR 배치 패리티(SPEC-056, R23) ──
// @covers SPEC-006/FR-001
// @covers SPEC-056/FR-008
test("py frplacement: 섹션 밖 FR·exempt(FR 섹션 없음)·통과·off·enum 밖·--fix 바이트 동일", skip, () => {
  const MISPLACED = "## Functional Requirements\n- **FR-001** a.\n## Ownership\n- **Files**: x/**\n- **FR-058** b.\n";
  const CLEAN = "## Functional Requirements\n- **FR-001** a.\n";
  const EXEMPT = "## Ownership\n- **FR-099** x.\n";
  const scen = [
    { cfg: { frPlacementPolicy: "hard" }, spec: MISPLACED },
    { cfg: { frPlacementPolicy: "advisory" }, spec: MISPLACED },
    { cfg: { frPlacementPolicy: "hard" }, spec: CLEAN },
    { cfg: { frPlacementPolicy: "hard" }, spec: EXEMPT },
    { cfg: { frPlacementPolicy: "off" }, spec: MISPLACED },
    { cfg: { frPlacementPolicy: "deny" }, spec: MISPLACED },
  ];
  for (const [i, { cfg, spec }] of scen.entries()) {
    const root = fixture({ "sdd/specs/SPEC-001.md": spec }, cfg);
    try {
      const n = runNode(root, "check-fr-placement.mjs");
      const py = runPy(root, ["frplacement"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // --fix도 같은 결과 텍스트를 낸다.
  const rootN = fixture({ "sdd/specs/SPEC-001.md": MISPLACED }, { frPlacementPolicy: "hard" });
  const rootP = fixture({ "sdd/specs/SPEC-001.md": MISPLACED }, { frPlacementPolicy: "hard" });
  try {
    const n = runNode(rootN, "check-fr-placement.mjs", ["--fix"]);
    const py = runPy(rootP, ["frplacement", "--fix"]);
    assert.equal(py.out, n.out, "--fix 출력 불일치");
    assert.equal(
      readFileSync(join(rootN, "sdd/specs/SPEC-001.md"), "utf8"),
      readFileSync(join(rootP, "sdd/specs/SPEC-001.md"), "utf8"),
      "--fix 결과 파일 내용 불일치",
    );
  } finally { rmSync(rootN, { recursive: true, force: true }); rmSync(rootP, { recursive: true, force: true }); }
});

// ── 게이트 실패 에스컬레이션 패리티(SPEC-057, R24) ──
// gate 식별자는 런타임마다 다르므로(Node: 파일명, Python: 파일명:서브커맨드) 원장을 **직접
// 주입**해 그 차이를 우회하고 판정 로직 자체(임계치·가드 유효성)만 대조한다.
// @covers SPEC-006/FR-001
// @covers SPEC-057/FR-007
test("py gateescalation: 임계치 초과·가드 있음·가드 오류(3종)·원장 없음·off·enum 밖 바이트 동일", skip, () => {
  const rec = (over = {}) => ({ gate: "check-fr-placement.mjs", class: "fr-outside-section", target: "sdd/specs/SPEC-001.md", ...over });
  const ledgerOf = (n) => Array.from({ length: n }, () => rec()).map((r) => JSON.stringify(r)).join("\n") + "\n";
  const withLedger = (root, lines) => { mkdirSync(join(root, ".sdd"), { recursive: true }); writeFileSync(join(root, ".sdd/gate-failures.jsonl"), lines); };
  const scen = [
    { cfg: { gateFailureEscalationPolicy: "hard" }, ledger: ledgerOf(3) },
    { cfg: { gateFailureEscalationPolicy: "advisory" }, ledger: ledgerOf(3) },
    { cfg: { gateFailureEscalationPolicy: "hard" }, ledger: ledgerOf(2) },      // 임계치 미만
    { cfg: { gateFailureEscalationPolicy: "hard", gateFailureGuards: [{ gate: "check-fr-placement.mjs", class: "fr-outside-section", guard: "sdd.config.json", note: "사유" }] }, ledger: ledgerOf(5) },
    { cfg: { gateFailureEscalationPolicy: "hard", gateFailureGuards: [{ gate: "g", class: "c" }] }, ledger: ledgerOf(3) },                    // incomplete
    { cfg: { gateFailureEscalationPolicy: "hard", gateFailureGuards: [{ gate: "g", class: "c", guard: "x.mjs" }] }, ledger: ledgerOf(3) },     // no-reason
    { cfg: { gateFailureEscalationPolicy: "hard", gateFailureGuards: [{ gate: "g", class: "c", guard: "no-such.mjs", note: "사유" }] }, ledger: ledgerOf(3) },  // stale
    { cfg: { gateFailureEscalationPolicy: "off" }, ledger: ledgerOf(3) },
    { cfg: { gateFailureEscalationPolicy: "deny" }, ledger: null },
    { cfg: { gateFailureEscalationPolicy: "hard" }, ledger: null },            // 원장 없음
  ];
  // **별도 루트를 쓴다** — 이 게이트 자신도 armVerdict를 거치므로 hard에서 차단하면 자기
  // 실행이 방금 읽은 원장에 새 줄을 append한다(자기참조 오염). 한 루트를 공유하면 Node가 먼저
  // 실행되며 원장을 4줄로 늘려놓고 Python이 그 늘어난 원장을 읽어 "3건"과 "4건"이 갈린다 —
  // 런타임 차이가 아니라 공유 루트가 만든 시험 방법의 결함이다.
  for (const [i, { cfg, ledger }] of scen.entries()) {
    const rootN = fixture({}, cfg);
    const rootP = fixture({}, cfg);
    if (ledger) { withLedger(rootN, ledger); withLedger(rootP, ledger); }
    try {
      const n = runNode(rootN, "check-gate-escalation.mjs");
      const py = runPy(rootP, ["gateescalation"]);
      assert.equal(py.out, n.out, `시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(rootN, { recursive: true, force: true }); rmSync(rootP, { recursive: true, force: true }); }
  }
});

// ── 위험 행동 승인 패리티(SPEC-058, R25) ──
// @covers SPEC-006/FR-001
// @covers SPEC-058/FR-008
test("py riskyaction: 위험 행동 차단·승인 통과·만료·스윕(가드 오류)·off·enum 밖 바이트 동일", skip, () => {
  const PATTERNS = [{ match: "tracker.*dev-done", class: "tracker-transition", verifyAgainst: "CLOSEOUT_FLOW 순서 대조", why: "배포 전 종결 전이 방지" }];
  const RISKY_CMD = "tracker transition ticket=123 to=dev-done";
  const withLedger = (root, lines) => { mkdirSync(join(root, ".sdd"), { recursive: true }); writeFileSync(join(root, ".sdd/action-approvals.jsonl"), lines); };

  // ① hook 모드: hard 차단 / advisory 경고 / 미매치 침묵 / off 침묵
  const hookScen = [
    { cfg: { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS }, cmd: RISKY_CMD },
    { cfg: { riskyActionPolicy: "advisory", riskyActionPatterns: PATTERNS }, cmd: RISKY_CMD },
    { cfg: { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS }, cmd: "ls -la" },
    { cfg: { riskyActionPolicy: "off", riskyActionPatterns: PATTERNS }, cmd: RISKY_CMD },
  ];
  for (const [i, { cfg, cmd }] of hookScen.entries()) {
    const root = fixture({}, cfg);
    try {
      const n = runNode(root, "check-risky-action.mjs", ["--hook", "--command", cmd]);
      const py = runPy(root, ["riskyaction", "--hook", "--command", cmd]);
      assert.equal(py.out, n.out, `훅 시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `훅 시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }

  // ② 유효한 승인이 있으면 침묵 통과, 만료됐으면 다시 막는다(직접 원장 주입 — 별도 루트로 대조).
  const RISKY_HASH = hashAction(RISKY_CMD);
  const rec = (ageMs) => ({ hash: RISKY_HASH, class: "tracker-transition", note: "확인함", ts: new Date(Date.now() - ageMs).toISOString(), sessionId: "s1" });
  // 해시는 Node·Python 각각 자기 런타임의 hash_action으로 낸 값과 대조해야 하므로, --record로
  // 먼저 각 런타임 자신의 원장에 승인을 남기고(해시는 각 런타임이 스스로 계산) 그 다음 훅을 켠다.
  const approvedRootN = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  const approvedRootP = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    runNode(approvedRootN, "check-risky-action.mjs", ["--record", "--command", RISKY_CMD, "--class", "tracker-transition", "--note", "확인함"]);
    runPy(approvedRootP, ["riskyaction", "--record", "--command", RISKY_CMD, "--class", "tracker-transition", "--note", "확인함"]);
    const n = runNode(approvedRootN, "check-risky-action.mjs", ["--hook", "--command", RISKY_CMD]);
    const py = runPy(approvedRootP, ["riskyaction", "--hook", "--command", RISKY_CMD]);
    assert.equal(n.code, 0, n.out); assert.equal(py.code, 0, py.out); // 둘 다 승인 통과
    assert.equal(py.out, n.out, "승인 통과 후 출력 불일치(둘 다 침묵이어야 한다)");
  } finally { rmSync(approvedRootN, { recursive: true, force: true }); rmSync(approvedRootP, { recursive: true, force: true }); }

  const expiredRootN = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS, riskyActionApprovalTtlSeconds: 1 });
  const expiredRootP = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS, riskyActionApprovalTtlSeconds: 1 });
  try {
    withLedger(expiredRootN, JSON.stringify(rec(5000)) + "\n");
    withLedger(expiredRootP, JSON.stringify(rec(5000)) + "\n");
    const n = runNode(expiredRootN, "check-risky-action.mjs", ["--hook", "--command", RISKY_CMD]);
    const py = runPy(expiredRootP, ["riskyaction", "--hook", "--command", RISKY_CMD]);
    assert.equal(n.code, 2, n.out); assert.equal(py.code, 2, py.out); // 둘 다 만료 — 다시 막는다
    assert.equal(py.out, n.out, "만료 시나리오 출력 불일치");
  } finally { rmSync(expiredRootN, { recursive: true, force: true }); rmSync(expiredRootP, { recursive: true, force: true }); }

  // ③ --record 필수 인자 결여 exit 1(값은 동일해야 한다)
  {
    const root = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
    try {
      const n = runNode(root, "check-risky-action.mjs", ["--record", "--command", RISKY_CMD]);
      const py = runPy(root, ["riskyaction", "--record", "--command", RISKY_CMD]);
      assert.equal(n.code, 1); assert.equal(py.code, 1);
      assert.equal(py.out, n.out, "--record 인자 결여 출력 불일치");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }

  // ④ 스윕 모드: 선언 정상 / 가드 오류(class 없음) / 미선언(INERT) / off / enum 밖
  const sweepScen = [
    { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS },
    { riskyActionPolicy: "hard", riskyActionPatterns: [{ match: "x" }] },
    { riskyActionPolicy: "hard", riskyActionPatterns: [] },
    { riskyActionPolicy: "off", riskyActionPatterns: PATTERNS },
    { riskyActionPolicy: "deny", riskyActionPatterns: PATTERNS },
  ];
  for (const [i, cfg] of sweepScen.entries()) {
    const root = fixture({}, cfg);
    try {
      const n = runNode(root, "check-risky-action.mjs");
      const py = runPy(root, ["riskyaction"]);
      assert.equal(py.out, n.out, `스윕 시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `스윕 시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// @covers SPEC-006/FR-001
// @covers SPEC-058/FR-002
// @covers SPEC-058/FR-009
test("py riskyaction: MCP 도구(tool 필드) 매칭·해시·차단·no-matcher/ambiguous/bad-tool 스윕이 바이트 동일", skip, () => {
  const runNodeStdin = (root, gate, args, stdinJson) => {
    const GATE = new URL(`../${gate}`, import.meta.url).pathname;
    try {
      const out = execFileSync("node", [GATE, ...args],
        { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: JSON.stringify(stdinJson), env: { ...process.env, CI: "", GITHUB_ACTIONS: "" } });
      return { code: 0, out };
    } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  };
  const runPyStdin = (root, args, stdinJson) => {
    try {
      const out = execFileSync("python3", [PY, ...args],
        { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: JSON.stringify(stdinJson), env: { ...process.env, CI: "", GITHUB_ACTIONS: "" } });
      return { code: 0, out };
    } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  };

  const TOOL_PATTERNS = [{ tool: "mcp__github__merge_pull_request", class: "pr-merge", verifyAgainst: "CI 상태·리뷰 승인 확인", why: "머지는 되돌리기 어렵다" }];
  const TOOL_CALL = { tool_name: "mcp__github__merge_pull_request", tool_input: { owner: "o", repo: "r", pullNumber: 26 } };

  // ① 도구 호출 hard 차단 — 안내에 정준 페이로드가 그대로 찍히고, Node·Python이 같은 해시를 낸다.
  {
    const rootN = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: TOOL_PATTERNS });
    const rootP = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: TOOL_PATTERNS });
    try {
      const n = runNodeStdin(rootN, "check-risky-action.mjs", ["--hook"], TOOL_CALL);
      const py = runPyStdin(rootP, ["riskyaction", "--hook"], TOOL_CALL);
      assert.equal(n.code, 2, n.out); assert.equal(py.code, 2, py.out);
      assert.equal(py.out, n.out, "도구 호출 차단 출력 불일치(정준 페이로드·해시 포함)");
    } finally { rmSync(rootN, { recursive: true, force: true }); rmSync(rootP, { recursive: true, force: true }); }
  }

  // ② 무관 도구는 침묵, Bash 전용 항목은 도구 호출에 안 걸린다.
  {
    const rootN = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: TOOL_PATTERNS });
    const rootP = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: TOOL_PATTERNS });
    try {
      const n = runNodeStdin(rootN, "check-risky-action.mjs", ["--hook"], { tool_name: "mcp__github__get_me", tool_input: {} });
      const py = runPyStdin(rootP, ["riskyaction", "--hook"], { tool_name: "mcp__github__get_me", tool_input: {} });
      assert.equal(n.code, 0); assert.equal(py.code, 0);
      assert.equal(py.out, n.out);
    } finally { rmSync(rootN, { recursive: true, force: true }); rmSync(rootP, { recursive: true, force: true }); }
  }

  // ③ 스윕 — no-matcher·ambiguous-matcher·bad-tool 3종 결함이 바이트 동일.
  const sweepScen = [
    [{ class: "c", verifyAgainst: "v", why: "w" }],
    [{ match: "m", tool: "t", class: "c", verifyAgainst: "v", why: "w" }],
    [{ tool: "[", class: "c", verifyAgainst: "v", why: "w" }],
  ];
  for (const [i, patterns] of sweepScen.entries()) {
    const root = fixture({}, { riskyActionPolicy: "hard", riskyActionPatterns: patterns });
    try {
      const n = runNode(root, "check-risky-action.mjs");
      const py = runPy(root, ["riskyaction"]);
      assert.equal(py.out, n.out, `tool 스윕 시나리오 ${i + 1} 출력 불일치`);
      assert.equal(py.code, n.code, `tool 스윕 시나리오 ${i + 1} exit 불일치`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
