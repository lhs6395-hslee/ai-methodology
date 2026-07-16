// tooling/__tests__/sdd-gates-py.test.mjs
// Python 런타임판(sdd_gates.py)의 게이트 동작 + Node판과의 패리티 검증.
// 원칙: 런타임 간 동작 차이는 "조용히 빠지는" 클래스를 만든다(문법화) —
// 같은 픽스처를 Node·Python 양쪽에 넣어 exit code와 핵심 출력을 비교한다.
// @covers SPEC-006/FR-001
// @covers SPEC-006/FR-002
// @covers SPEC-006/FR-003
// @covers SPEC-008/FR-007
// @covers SPEC-017/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PY = new URL("../sdd_gates.py", import.meta.url).pathname;
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

function runPy(root, args) {
  try {
    const out = execFileSync("python3", [PY, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

function runNode(root, gate, args = []) {
  const GATE = new URL(`../${gate}`, import.meta.url).pathname;
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
