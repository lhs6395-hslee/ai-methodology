// @covers SPEC-014/FR-001
// @covers SPEC-014/FR-002
// @covers SPEC-014/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberingIssues } from "../numbering-lib.mjs";

test("정상: 접두어별 001 연속 → hard·advisory 둘 다 빔", () => {
  const r = numberingIssues(["SPEC-001", "SPEC-002", "SPEC-003"]);
  assert.deepEqual(r.hard, []);
  assert.deepEqual(r.advisory, []);
});

test("001 미시작 → hard (INFRA-011부터), 그리고 내부 gap은 advisory(INFRA-012)", () => {
  const r = numberingIssues(["INFRA-011", "INFRA-013"]);
  assert.equal(r.hard.length, 1);
  assert.match(r.hard[0], /INFRA.*001/);
  assert.match(r.hard[0], /INFRA-011/);
  // 001~010은 gap으로 재보고하지 않음 — 내부 gap(12)만
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /INFRA-012/);
  assert.doesNotMatch(r.advisory[0], /INFRA-001\b/);
});

test("중복 (prefix,num) → hard", () => {
  const r = numberingIssues(["SPEC-001", "SPEC-001", "SPEC-002"]);
  assert.ok(r.hard.some((m) => /SPEC-001/.test(m) && /중복/.test(m)));
});

test("중간 gap → advisory, hard 없음", () => {
  const r = numberingIssues(["SPEC-001", "SPEC-002", "SPEC-004"]);
  assert.deepEqual(r.hard, []);
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /SPEC-003/);
});

test("접두어별 독립 판정 — 각자 001부터면 clean", () => {
  const r = numberingIssues(["SPEC-001", "SPEC-002", "INFRA-001", "TEST-001"]);
  assert.deepEqual(r.hard, []);
  assert.deepEqual(r.advisory, []);
});

test("결정성 — 출력이 접두어·번호 순 정렬", () => {
  const a = numberingIssues(["TEST-005", "SPEC-003", "INFRA-002"]);
  const b = numberingIssues(["INFRA-002", "TEST-005", "SPEC-003"]);
  assert.deepEqual(a, b); // 입력 순서 무관, 동일 출력
});
