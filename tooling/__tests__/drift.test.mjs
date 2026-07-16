// @covers SPEC-019/FR-001
// @covers SPEC-019/FR-003
// @covers SPEC-019/FR-004
// @covers SPEC-019/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { escalations, DRIFT_POLICY_ENUM } from "../drift-lib.mjs";

test("FR-001: 리네임 트리거 스펙이 FR라인 미변경·트레일러 없음 → 위반", () => {
  const r = escalations(["SPEC-001"], [], false, "hard");
  assert.deepEqual(r.violations, ["SPEC-001"]);
  assert.equal(r.hard, true);
  assert.equal(r.policyError, null);
});

test("FR-003: FR 선언 라인이 바뀐 트리거 스펙은 충족 → 위반 아님", () => {
  const r = escalations(["SPEC-001"], ["SPEC-001"], false, "hard");
  assert.deepEqual(r.violations, []);
});

test("FR-003: Spec-Impact 트레일러가 있으면 changeset 전체 충족 → 위반 없음", () => {
  const r = escalations(["SPEC-001", "SPEC-002"], [], true, "hard");
  assert.deepEqual(r.violations, []);
});

test("FR-004: 트리거 없음(무-리네임) → 위반 0(평범한 편집에 마찰 없음)", () => {
  const r = escalations([], ["SPEC-003"], false, "hard");
  assert.deepEqual(r.violations, []);
});

test("FR-005: policy off면 승격 안 함(하위호환)", () => {
  const r = escalations(["SPEC-001"], [], false, "off");
  assert.deepEqual(r.violations, []);
  assert.equal(r.hard, false);
});

test("FR-005: advisory는 위반 산출하되 hard=false(비차단)", () => {
  const r = escalations(["SPEC-001"], [], false, "advisory");
  assert.deepEqual(r.violations, ["SPEC-001"]);
  assert.equal(r.hard, false);
});

test("FR-005: enum 밖 값 → policyError 보고, 위반은 비움", () => {
  const r = escalations(["SPEC-001"], [], false, "bogus");
  assert.equal(r.violations.length, 0);
  assert.match(r.policyError, /semanticDriftPolicy/);
});

test("결정성: 위반은 정렬·중복 제거, 입력 순서 무관", () => {
  const a = escalations(["SPEC-002", "SPEC-001", "SPEC-002"], [], false, "hard");
  assert.deepEqual(a.violations, ["SPEC-001", "SPEC-002"]);
  assert.deepEqual(DRIFT_POLICY_ENUM, ["off", "advisory", "hard"]);
});
