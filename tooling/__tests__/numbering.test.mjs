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

// @covers SPEC-018/FR-006
test("retiredIds에 기록된 gap은 정상 retirement gap — advisory에서 제외", () => {
  // SPEC-003이 폐기돼 gap이 생겼으나 retiredIds에 기록됨 → 잡음 아님
  const r = numberingIssues(["SPEC-001", "SPEC-002", "SPEC-004"], ["SPEC-003"]);
  assert.deepEqual(r.hard, []);
  assert.deepEqual(r.advisory, []);
});

test("retiredIds에 없는 gap은 여전히 advisory — 사고성 결번과 구분", () => {
  // SPEC-003만 폐기 기록, SPEC-005는 미기록 → 005 gap만 보고
  const r = numberingIssues(["SPEC-001", "SPEC-002", "SPEC-004", "SPEC-006"], ["SPEC-003"]);
  assert.deepEqual(r.hard, []);
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /SPEC-005/);
  assert.doesNotMatch(r.advisory[0], /SPEC-003\b/);
});

test("결정성 — 출력이 접두어·번호 순 정렬", () => {
  const a = numberingIssues(["TEST-005", "SPEC-003", "INFRA-002"]);
  const b = numberingIssues(["INFRA-002", "TEST-005", "SPEC-003"]);
  assert.deepEqual(a, b); // 입력 순서 무관, 동일 출력
});

// ── 감사 봉합(2026-07-16): M3 폐기 ID 재사용 hard · M4 001-시작 retiredIds 면제 ──

// @covers SPEC-014/FR-004
test("폐기 ID 재사용: retiredIds에 기록된 번호가 실재 → hard(과거 참조 앨리어싱 차단)", () => {
  const r = numberingIssues(["SPEC-001", "SPEC-002", "SPEC-003"], ["SPEC-002"]);
  assert.equal(r.hard.length, 1);
  assert.match(r.hard[0], /SPEC-002 폐기 ID 재사용/);
});

// @covers SPEC-014/FR-001
test("001 미시작: 선행 번호가 전부 retiredIds면 hard 아님(최소번호 스펙 폐기 = 정상 gap)", () => {
  // SPEC-001·002 폐기 후 003부터 실재 — hard 없음(감사 M4: 접두어 전체 재번호 강요 해소)
  const ok = numberingIssues(["SPEC-003", "SPEC-004"], ["SPEC-001", "SPEC-002"]);
  assert.deepEqual(ok.hard, []);
  assert.deepEqual(ok.advisory, []);
  // 선행 번호 일부만 폐기 기록이면 여전히 hard(사고성 결번과 구분)
  const bad = numberingIssues(["SPEC-003", "SPEC-004"], ["SPEC-001"]);
  assert.equal(bad.hard.length, 1);
  assert.match(bad.hard[0], /001부터 시작하지 않음/);
});
