// tooling/__tests__/retire.test.mjs — SPEC-018 폐기 워크플로 순수 코어
// @covers SPEC-018/FR-001
// @covers SPEC-018/FR-002
// @covers SPEC-018/FR-003
// @covers SPEC-018/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTarget, planRetirement, removeFrFromSpecText, pruneManifest } from "../retire-lib.mjs";

const ctx = () => ({
  frsBySpec: new Map([
    ["SPEC-001", new Set(["FR-001", "FR-002", "FR-003"])],
    ["SPEC-002", new Set(["FR-001"])],
  ]),
  coversIndex: [
    { file: "tests/a.test.mjs", spec: "SPEC-001", fr: "FR-003" },
    { file: "tests/b.test.mjs", spec: "SPEC-002", fr: "FR-001" },
  ],
  manifestKeys: ["SPEC-001/FR-002", "SPEC-002/FR-001"],
  deferredKeys: ["SPEC-001/FR-002"],
});

test("parseTarget: SPEC·SPEC/FR·오형식", () => {
  assert.deepEqual(parseTarget("SPEC-001"), { specId: "SPEC-001", frId: null });
  assert.deepEqual(parseTarget("SPEC-001/FR-003"), { specId: "SPEC-001", frId: "FR-003" });
  assert.equal(parseTarget("nope"), null);
});

test("FR-001·003: FR 폐기 계획 — dangling @covers·매니페스트·deferred 키 산출", () => {
  const p = planRetirement("SPEC-001/FR-003", ctx());
  assert.equal(p.ok, true);
  assert.deepEqual(p.removals, [{ specId: "SPEC-001", frId: "FR-003" }]);
  assert.equal(p.danglingCovers.length, 1);
  assert.equal(p.danglingCovers[0].file, "tests/a.test.mjs");   // FR-003 커버 테스트만
  assert.deepEqual(p.manifestKeys, []);                          // FR-003은 매니페스트에 없음
  assert.equal(p.numberingGap, null);                            // FR 폐기는 번호 gap 없음
});

test("FR-001: SPEC 통째 폐기 — 전 FR·번호 gap", () => {
  const p = planRetirement("SPEC-001", ctx());
  assert.equal(p.ok, true);
  assert.deepEqual(p.removals, [{ specId: "SPEC-001", whole: true }]);
  assert.equal(p.danglingCovers.length, 1);                     // SPEC-001 커버는 FR-003 하나
  assert.deepEqual(p.manifestKeys, ["SPEC-001/FR-002"]);        // SPEC-001 매니페스트 키
  assert.deepEqual(p.deferredKeys, ["SPEC-001/FR-002"]);
  assert.equal(p.numberingGap, "SPEC-001");                     // 번호가 gap이 됨(FR-006 처리 대상)
});

test("FR-004: 존재하지 않는 대상 → ok:false(무변경 신호)", () => {
  assert.equal(planRetirement("SPEC-099", ctx()).ok, false);
  assert.equal(planRetirement("SPEC-001/FR-099", ctx()).ok, false);
  assert.equal(planRetirement("garbage", ctx()).ok, false);
});

test("FR-002: 적용 변환 — 스펙 본문 FR 라인 제거·매니페스트 키 prune(순수)", () => {
  const spec = "# S\n- **FR-001** a.\n- **FR-002** b.\n- **FR-003** c.\n## Change Log\n";
  const out = removeFrFromSpecText(spec, "FR-002");
  assert.doesNotMatch(out, /\*\*FR-002\*\*/);
  assert.match(out, /\*\*FR-001\*\*/);                          // 인접 FR 보존
  assert.match(out, /\*\*FR-003\*\*/);
  const m = pruneManifest({ "SPEC-001/FR-002": { method: "deferred" }, "SPEC-002/FR-001": {} }, ["SPEC-001/FR-002"]);
  assert.deepEqual(Object.keys(m), ["SPEC-002/FR-001"]);       // 폐기 키만 제거
});
