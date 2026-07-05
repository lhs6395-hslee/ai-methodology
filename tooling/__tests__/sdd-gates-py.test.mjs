// tooling/__tests__/sdd-gates-py.test.mjs
// Python 런타임판(sdd_gates.py)의 게이트 동작 + Node판과의 패리티 검증.
// 원칙: 런타임 간 동작 차이는 "조용히 빠지는" 클래스를 만든다(문법화) —
// 같은 픽스처를 Node·Python 양쪽에 넣어 exit code와 핵심 출력을 비교한다.
// @covers SPEC-006/FR-001
// @covers SPEC-006/FR-002
// @covers SPEC-006/FR-003
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
