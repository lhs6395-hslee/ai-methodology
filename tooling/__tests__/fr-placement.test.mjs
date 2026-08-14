// tooling/__tests__/fr-placement.test.mjs
// FR 배치(SPEC-056) — 실측 제보: 에이전트가 하루에 같은 실수를 세 번 했다(FR을 섹션 밖에 썼다).
// 게이트는 매번 잡았지만 "정의를 못 찾았다"였지 "엉뚱한 곳에 있다"가 아니었다 — 증상이 아니라
// 원인 자리를 잡는다.
// @covers SPEC-056/FR-001
// @covers SPEC-056/FR-002
// @covers SPEC-056/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sectionSpans, frPlacementFindings, fixFrPlacement, FR_SECTION_HEADING } from "../fr-placement-lib.mjs";
import { importClosure } from "../import-wiring-lib.mjs";
import { FAILURE_CLASS } from "../check-fr-placement.mjs";

const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");
const FR_RE = /\*\*((?:FR)-\d{3}[a-z]?)\*\*/g;

// ── 순수 코어: sectionSpans ──
test("sectionSpans: H2 헤딩으로만 나눈다 — H3는 안 나눈다, 첫 헤딩 이전은 name:null", () => {
  const spans = sectionSpans("서문\n## A\n본문A\n### 하위\n계속\n## B\n본문B\n");
  assert.deepEqual(spans.map((s) => s.name), [null, "A", "B"]);
  assert.equal(spans[1].endLine, 5);   // "## B" 직전까지(하위 H3 포함, 나뉘지 않음)
});

test("sectionSpans: 헤딩이 하나도 없으면 전체가 name:null 한 구간", () => {
  // split("\n")은 후행 개행이 있으면 빈 문자열 원소를 하나 더 낸다(다른 사이트들과 같은 관례) —
  // 그 원소는 isFrDeclLine에서 자연히 false라 판정에 영향이 없다.
  const spans = sectionSpans("그냥 산문\n두 번째 줄\n");
  assert.deepEqual(spans, [{ name: null, startLine: 0, endLine: 3 }]);
});

test("sectionSpans: 부제 붙은 헤딩도 이름 그대로 보존한다(매칭은 소비 함수가 접두어로)", () => {
  const spans = sectionSpans("## Functional Requirements (EARS)\n- **FR-001** x\n");
  assert.equal(spans[0].name, "Functional Requirements (EARS)");
});

// ── 순수 코어: frPlacementFindings ──
test("FR 섹션 안 정의는 위반이 아니다", () => {
  const text = "## Functional Requirements\n- **FR-001** THE SYSTEM SHALL x.\n";
  assert.deepEqual(frPlacementFindings(text, FR_RE), []);
});

test("FR 섹션이 아예 없으면 exempt다 — 판정 대상 자체가 없다", () => {
  const text = "## Ownership\n- **FR-099** 이건 위반처럼 보이지만 FR 섹션이 없는 문서다.\n";
  assert.deepEqual(frPlacementFindings(text, FR_RE), []);
});

test("실측 그대로: Dedup-Review·Ownership에 있는 FR을 잡고 섹션명·줄번호를 함께 낸다", () => {
  const text = [
    "## Functional Requirements",
    "- **FR-001** THE SYSTEM SHALL x.",
    "## Dedup-Review",
    "- 이웃 없음",
    "- **FR-027** THE SYSTEM SHALL y.",
    "## Ownership",
    "- **Files**: a/**",
    "- **FR-058** THE SYSTEM SHALL z.",
  ].join("\n");
  const f = frPlacementFindings(text, FR_RE);
  assert.deepEqual(f, [
    { frId: "FR-027", section: "Dedup-Review", line: 5 },
    { frId: "FR-058", section: "Ownership", line: 8 },
  ]);
});

test("Change Log 표 행은 잡지 않는다 — 이력·참조는 정의가 아니다", () => {
  const text = [
    "## Functional Requirements",
    "- **FR-001** THE SYSTEM SHALL x.",
    "## Change Log",
    "| 날짜 | 변경 | 근거 |",
    "|---|---|---|",
    "| 2026-08-11 | **FR-058** 신설 — 새 요구 | 실측 |",
  ].join("\n");
  assert.deepEqual(frPlacementFindings(text, FR_RE), []);
});

test("본문 산문의 FR 참조는 잡지 않는다 — 줄 시작이 아니면 정의가 아니다", () => {
  const text = [
    "## Functional Requirements",
    "- **FR-001** THE SYSTEM SHALL x.",
    "## Assumptions",
    "이 결정은 **FR-001**과 관련이 있다(참조일 뿐 재정의가 아니다).",
  ].join("\n");
  assert.deepEqual(frPlacementFindings(text, FR_RE), []);
});

test("첫 헤딩 이전(서문)에 FR이 있어도 잡는다 — name은 '(첫 헤딩 이전)'", () => {
  const text = [
    "- **FR-005** 서문에 잘못 둔 정의.",
    "## Functional Requirements",
    "- **FR-001** THE SYSTEM SHALL x.",
  ].join("\n");
  assert.deepEqual(frPlacementFindings(text, FR_RE), [{ frId: "FR-005", section: "(첫 헤딩 이전)", line: 1 }]);
});

test("불릿 유무 무관 — isFrDeclLine과 같은 문법(frDeclarations와 동치 유지)", () => {
  const text = [
    "## Functional Requirements",
    "**FR-001** THE SYSTEM SHALL x.",
    "## Ownership",
    "**FR-050** 불릿 없이 섹션 밖에 있다.",
  ].join("\n");
  assert.deepEqual(frPlacementFindings(text, FR_RE), [{ frId: "FR-050", section: "Ownership", line: 4 }]);
});

// ── --fix: 이동 ──
test("--fix: 섹션 밖 FR을 FR 섹션 끝으로 옮긴다", () => {
  const text = [
    "## Functional Requirements",
    "- **FR-001** a.",
    "## Ownership",
    "- **Files**: x/**",
    "- **FR-050** b.",
    "## Change Log",
    "| d | c | r |",
  ].join("\n");
  const { text: fixed, moved } = fixFrPlacement(text, FR_RE);
  assert.deepEqual(moved, [{ frId: "FR-050", from: "Ownership", toSection: FR_SECTION_HEADING }]);
  assert.deepEqual(fixed.split("\n"), [
    "## Functional Requirements",
    "- **FR-001** a.",
    "- **FR-050** b.",
    "## Ownership",
    "- **Files**: x/**",
    "## Change Log",
    "| d | c | r |",
  ]);
  assert.deepEqual(frPlacementFindings(fixed, FR_RE), []);   // 고친 뒤엔 위반이 남지 않는다
});

// @covers SPEC-056/FR-006
test("--fix: 인접한 `>` 근거 줄까지만 흡수한다 — 빈 줄 뒤 남의 `>` 줄은 옮기지 않는다(실측 회귀)", () => {
  const text = [
    "## Functional Requirements",
    "- **FR-001** a.",
    "## Dedup-Review",
    "- **FR-050** b.",
    "> 이 FR의 근거 한 줄.",
    "",
    "> Bedrock 패턴은 다른 문단의 인용이다 — 옮기면 안 된다.",
    "## Change Log",
  ].join("\n");
  const { text: fixed, moved } = fixFrPlacement(text, FR_RE);
  assert.deepEqual(moved, [{ frId: "FR-050", from: "Dedup-Review", toSection: FR_SECTION_HEADING }]);
  assert.deepEqual(fixed.split("\n"), [
    "## Functional Requirements",
    "- **FR-001** a.",
    "- **FR-050** b.",
    "> 이 FR의 근거 한 줄.",
    "## Dedup-Review",
    "",
    "> Bedrock 패턴은 다른 문단의 인용이다 — 옮기면 안 된다.",
    "## Change Log",
  ]);
});

test("--fix: 연속된 두 개의 잘못 배치된 FR을 각각 옮긴다(문서 순서 유지)", () => {
  const text = [
    "## Functional Requirements",
    "- **FR-001** a.",
    "## Ownership",
    "- **FR-010** b.",
    "- **FR-011** c.",
    "## Change Log",
  ].join("\n");
  const { text: fixed, moved } = fixFrPlacement(text, FR_RE);
  assert.deepEqual(moved.map((m) => m.frId), ["FR-010", "FR-011"]);
  assert.deepEqual(fixed.split("\n"), [
    "## Functional Requirements",
    "- **FR-001** a.",
    "- **FR-010** b.",
    "- **FR-011** c.",
    "## Ownership",
    "## Change Log",
  ]);
});

test("--fix: 위반이 없으면 원본과 바이트 동일 텍스트를 돌려준다(moved 빈 배열)", () => {
  const text = "## Functional Requirements\n- **FR-001** a.\n";
  const { text: fixed, moved } = fixFrPlacement(text, FR_RE);
  assert.equal(fixed, text);
  assert.deepEqual(moved, []);
});

test("--fix: FR 섹션이 없으면 손대지 않는다(exempt와 동형)", () => {
  const text = "## Ownership\n- **FR-099** x.\n";
  const { text: fixed, moved } = fixFrPlacement(text, FR_RE);
  assert.equal(fixed, text);
  assert.deepEqual(moved, []);
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
const LIBS = importClosure(["check-fr-placement.mjs"], KIT_SRC);
function fixture(specBody, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-frp-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...config }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), specBody);
  return root;
}
function run(root, extraArgs = []) {
  const gate = join(root, "scripts", "check-fr-placement.mjs");
  try { return { code: 0, out: execFileSync("node", [gate, ...extraArgs], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const MISPLACED = "## Functional Requirements\n- **FR-001** THE SYSTEM SHALL x.\n## Ownership\n- **Files**: a/**\n- **FR-058** THE SYSTEM SHALL z.\n";

// @covers SPEC-056/FR-004
test("게이트: 섹션 밖 FR을 hard에서 실제로 막는다 — 대상·섹션·줄번호를 낸다", () => {
  const root = fixture(MISPLACED, { frPlacementPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FR-058/);
    assert.match(r.out, /Ownership/);
    assert.match(r.out, /:5\)/);       // "## Ownership" 다음 줄 = 4, Files=4, FR-058=5(1-based)
    assert.match(r.out, /--fix/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  // advisory는 막지 않는다.
  const adv = fixture(MISPLACED, { frPlacementPolicy: "advisory" });
  try {
    const r = run(adv);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠/);
  } finally { rmSync(adv, { recursive: true, force: true }); }
});

// @covers SPEC-056/FR-005
test("게이트: --fix는 파일을 고치고 훅은 자동 교정하지 않는다(별도 명령으로만)", () => {
  const root = fixture(MISPLACED, { frPlacementPolicy: "hard" });
  try {
    const before = readFileSync(join(root, "sdd/specs/SPEC-001.md"), "utf8");
    const r0 = run(root);
    assert.equal(r0.code, 1);
    // 판정만으로는 파일이 바뀌지 않는다.
    assert.equal(readFileSync(join(root, "sdd/specs/SPEC-001.md"), "utf8"), before);
    const r1 = run(root, ["--fix"]);
    assert.equal(r1.code, 0, r1.out);
    assert.match(r1.out, /이동/);
    const after = readFileSync(join(root, "sdd/specs/SPEC-001.md"), "utf8");
    assert.notEqual(after, before);
    const r2 = run(root);
    assert.equal(r2.code, 0, r2.out);   // 고친 뒤엔 통과
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: FR 섹션이 없는 스펙은 exempt로 침묵 통과(hard여도)", () => {
  const root = fixture("## Ownership\n- **FR-001** 순수 인프라 문서의 우연한 형태.\n", { frPlacementPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-056/FR-007
test("게이트: hard 차단 시 원장에 fr-outside-section 클래스·대상을 선언한다(SPEC-057 소비 계약)", () => {
  const root = fixture(MISPLACED, { frPlacementPolicy: "hard" });
  try {
    run(root);
    const ledger = readFileSync(join(root, ".sdd/gate-failures.jsonl"), "utf8");
    const rec = JSON.parse(ledger.trim().split("\n").pop());
    assert.equal(rec.class, FAILURE_CLASS);
    assert.equal(rec.target, "sdd/specs/SPEC-001.md");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: off는 판정하지 않는다고 선언한다 / enum 밖 값은 exit 1(문법화)", () => {
  const off = fixture(MISPLACED, { frPlacementPolicy: "off" });
  try { assert.doesNotMatch(run(off).out, /FR 배치 게이트\(/); } finally { rmSync(off, { recursive: true, force: true }); }
  const bad = fixture(MISPLACED, { frPlacementPolicy: "deny" });
  try {
    const r = run(bad);
    assert.equal(r.code, 1);
    assert.match(r.out, /frPlacementPolicy 값 위반/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});
