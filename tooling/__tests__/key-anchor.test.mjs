// tooling/__tests__/key-anchor.test.mjs — FR 키 앵커 순수 코어 + 게이트 배선 (SPEC-023)
// @covers SPEC-023/FR-001
// @covers SPEC-023/FR-002
// @covers SPEC-023/FR-003
// @covers SPEC-023/FR-004
// @covers SPEC-023/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripCodeSpans, isFrDeclLine, extractAnchors, extractAnchorsWithMarkers, buildKeySet, anchorFindings, buildKeyKindMap, categoryMarkerFindings } from "../key-anchor-lib.mjs";

const M = { entity: "E", surface: "R", capability: "C" };

const GATE = new URL("../check-spec-consistency.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("extractAnchors: 평문 bold만 앵커 — FR-ID 제외·코드 스팬 안 bold 제외·정규화(소문자)", () => {
  // FR-ID(**FR-001**) 제외, 평문 bold 수집
  assert.deepEqual(
    extractAnchors("- **FR-001** (event): WHEN a request hits **POST /api/recommend/{id}**, THE SYSTEM SHALL use **pjt_projects**."),
    ["post /api/recommend/{id}", "pjt_projects"]);
  // 코드 스팬 안의 **는 강조가 아니다 — `- **Files**:` 인용이 앵커로 오검출되지 않음
  assert.deepEqual(extractAnchors("- **FR-005** WHEN a raw `- **Files**:` line contains `x`."), []);
  // bold로 감싼 코드(**`x`**)는 앵커 아님(코드 스팬 선제거 — 앵커는 평문 bold 전용 문법)
  assert.deepEqual(extractAnchors("- **FR-002** THE SYSTEM SHALL read **`sdd.config.json`**."), []);
});

test("isFrDeclLine: FR 선언 라인만 — 본문·Change Log의 FR 언급과 구분", () => {
  assert.equal(isFrDeclLine("- **FR-001** (event): x."), true);
  assert.equal(isFrDeclLine("| 2026-07-16 | FR-001 관련 수정 **중요** | |"), false);
  assert.equal(isFrDeclLine("그 FR-001은 **중요**하다"), false);
});

test("buildKeySet: Ownership∪Dependencies 전 카테고리, Files 제외, 관계 서픽스 제거, — 플레이스홀더 제외", () => {
  const keys = buildKeySet(
    { Entities: ["pjt_projects"], Surfaces: ["POST /api/recommend/{id}"], Capabilities: ["staff.recommend"], Files: ["src/**"], Artifacts: ["—"] },
    { Entities: ["staff (references)", "invoice"] });
  assert.deepEqual([...keys].sort(), ["invoice", "pjt_projects", "post /api/recommend/{id}", "staff", "staff.recommend"]);
  assert.ok(!keys.has("src/**")); // Files 글롭은 키가 아님
});

test("anchorFindings: 매치/미매치 분류 — 라인 내 중복 토큰 1회 보고, 결정적 순서", () => {
  const keySet = new Set(["pjt_projects", "staff.recommend"]);
  const lines = [
    "- **FR-001** WHEN x, THE SYSTEM SHALL **staff.recommend** using **pjt_projects** and **pjt_projects**.",
    "- **FR-002** THE SYSTEM SHALL emphasize **Fargate** rhetorically.",
    "본문의 **bold**는 FR 선언 라인이 아니라 무관.",
  ];
  const r = anchorFindings(lines, keySet);
  assert.deepEqual(r.matched, [{ fr: "FR-001", token: "staff.recommend" }, { fr: "FR-001", token: "pjt_projects" }]);
  assert.deepEqual(r.unmatched, [{ fr: "FR-002", token: "fargate" }]);
});

test("stripCodeSpans: 짝 백틱만 제거, 홀 백틱은 보존(안전)", () => {
  assert.equal(stripCodeSpans("a `b` c `d` e"), "a  c  e");
  assert.equal(stripCodeSpans("a `unclosed b"), "a `unclosed b");
});

// ── 게이트 배선 e2e (frKeyAnchorPolicy off|advisory|hard) ──

function fixture(policy, frLine) {
  const root = mkdtempSync(join(tmpdir(), "sdd-anchor-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", ...(policy === undefined ? {} : { frKeyAnchorPolicy: policy }) }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
    `# S\n**Spec**: \`SPEC-001\`\n\n${frLine}\n\n## Ownership\n- **Entities**: pjt_projects\n- **Surfaces**: POST /api/x\n- **Capabilities**: pjt_projects.create\n\n## Dependencies\n- **Entities**: staff (references)\n`);
  return root;
}
function run(root) {
  try {
    const out = execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: off(기본) → 판정·출력 무변(하위호환) / advisory → ⚠ + exit 0 / hard → ✗ + exit 1", () => {
  const rhetorical = "- **FR-001** THE SYSTEM SHALL run on **Fargate** using **pjt_projects**.";
  for (const [policy, wantCode, wantAnchorLine] of [[undefined, 0, false], ["advisory", 0, true], ["hard", 1, true]]) {
    const root = fixture(policy, rhetorical);
    try {
      const r = run(root);
      assert.equal(r.code, wantCode, `${policy}: ${r.out}`);
      if (wantAnchorLine) {
        assert.match(r.out, /키 앵커/);
        assert.match(r.out, /bold "fargate"/);          // 미매치(수사적)
        assert.match(r.out, /매치 1 · 미매치 1/);        // pjt_projects는 매치
      } else {
        assert.doesNotMatch(r.out, /키 앵커/);           // off = 출력 무변
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("extractAnchorsWithMarkers: bold 토큰 + 카테고리 마커(E/R/C) 캡처 — 대문자 정규화", () => {
  assert.deepEqual(
    extractAnchorsWithMarkers("- **FR-001** WHEN **staff** (E) changes via **POST /api/x** (r), THE SYSTEM SHALL update **monthly_salary**."),
    [{ token: "staff", marker: "E" }, { token: "post /api/x", marker: "R" }, { token: "monthly_salary", marker: null }]);
});

test("buildKeyKindMap: 카테고리별 종류(entity/surface/capability) 매핑, 관계 서픽스 제거, 첫 등장 우선", () => {
  const km = buildKeyKindMap(
    { Entities: ["pjt_projects"], Surfaces: ["POST /api/x"], Capabilities: ["pjt_projects.create"], Files: ["src/**"] },
    { Entities: ["staff (references)"] });
  assert.equal(km.get("pjt_projects"), "entity");
  assert.equal(km.get("staff"), "entity");
  assert.equal(km.get("post /api/x"), "surface");
  assert.equal(km.get("pjt_projects.create"), "capability");
  assert.equal(km.has("src/**"), false); // Files는 마커 대상 아님
  // entity/surface/capability 카테고리 없는 프로젝트(킷 Modules 등) → 빈 맵(마커 판정 inert)
  assert.equal(buildKeyKindMap({ Modules: ["key-pipeline"], Symbols: ["x.mjs"] }, {}).size, 0);
});

test("categoryMarkerFindings: 굵은 키마다 카테고리 마커(E/R/C) 대조 — 누락·불일치, 키 아니면 스킵", () => {
  const km = new Map([["pjt_projects", "entity"], ["staff", "entity"], ["post /api/x", "surface"], ["pjt_projects.create", "capability"]]);
  const lines = [
    "- **FR-001** WHEN **staff** is added via **POST /api/x** (R), THE SYSTEM SHALL **pjt_projects.create** (C).", // staff: 마커 누락 / route·cap OK
    "- **FR-002** THE SYSTEM SHALL insert **pjt_projects** (R) rows.",                                              // entity인데 (R) 오마커
    "- **FR-003** THE SYSTEM SHALL emphasize **whatever** (E).",                                                    // 키 아님 → 스킵
  ];
  const r = categoryMarkerFindings(lines, km, M);
  assert.deepEqual(r.missing, [{ fr: "FR-001", token: "staff", expected: "E" }]);
  assert.deepEqual(r.wrong, [{ fr: "FR-002", token: "pjt_projects", expected: "E", got: "R" }]);
  // keyKindMap 비면 판정 안 함(inert) — 킷/파이프라인 하위호환
  assert.deepEqual(categoryMarkerFindings(lines, new Map(), M), { missing: [], wrong: [] });
});

test("게이트: 전 앵커 매치 + 올바른 카테고리 마커 → hard도 PASS / enum 밖 정책 값 → exit 1", () => {
  // 각 키에 종류 마커 동반: entity (E)·surface (R)·capability (C) — 새 문법(owner 요구)
  const clean = "- **FR-001** WHEN **staff** (E) hits **POST /api/x** (R), THE SYSTEM SHALL **pjt_projects.create** (C) a **pjt_projects** (E).";
  const ok = fixture("hard", clean);
  try { assert.equal(run(ok).code, 0, run(ok).out); } finally { rmSync(ok, { recursive: true, force: true }); }
  const bad = fixture("strict", clean);
  try {
    const r = run(bad);
    assert.equal(r.code, 1);
    assert.match(r.out, /frKeyAnchorPolicy 값 위반/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});

test("게이트: 굵은 키에 카테고리 마커 없음 → advisory ⚠(exit 0) / hard ✗(exit 1)", () => {
  // staff(참조 entity)·pjt_projects.create(capability) 앵커인데 마커 누락
  const noMarker = "- **FR-001** WHEN **staff** is added, THE SYSTEM SHALL **pjt_projects.create**.";
  for (const [policy, wantCode] of [["advisory", 0], ["hard", 1]]) {
    const root = fixture(policy, noMarker);
    try {
      const r = run(root);
      assert.equal(r.code, wantCode, `${policy}: ${r.out}`);
      assert.match(r.out, /카테고리 마커 위반 2/);          // staff(E)·pjt_projects.create(C) 둘 다 누락
      assert.match(r.out, /카테고리 마커 없음/);
      assert.match(r.out, /\(C\)로 표기/);                   // capability 마커 안내
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
