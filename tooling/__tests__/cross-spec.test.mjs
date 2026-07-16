// @covers SPEC-020/FR-001
// @covers SPEC-020/FR-002
// @covers SPEC-020/FR-003
// @covers SPEC-020/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDrivers, crossSpecRelaxed } from "../cross-spec-lib.mjs";

const ALT = "SPEC|INFRA|TEST|CICD";

test("FR-001: Change-Driver 트레일러 파싱 — id + 사유", () => {
  const d = parseDrivers("refactor: x\n\nChange-Driver: SPEC-001 공유 유틸 시그니처 변경", ALT);
  assert.deepEqual(d, [{ id: "SPEC-001", reason: "공유 유틸 시그니처 변경" }]);
});

test("FR-001: 사유 빈 트레일러는 버림 / 여러 라인 허용", () => {
  const d = parseDrivers("m\n\nChange-Driver: SPEC-001\nChange-Driver: SPEC-002 실동인", ALT);
  assert.deepEqual(d, [{ id: "SPEC-002", reason: "실동인" }]);
});

test("FR-001: 트레일러 없으면 빈 배열", () => {
  assert.deepEqual(parseDrivers("plain commit", ALT), []);
});

test("FR-002: 다른 스펙의 의미변경 동인이 있으면 완화", () => {
  assert.equal(crossSpecRelaxed("SPEC-002", ["SPEC-001"]), true);
});

test("FR-003: 자기 자신만 동인이면 완화 아님(자기참조 무의미)", () => {
  assert.equal(crossSpecRelaxed("SPEC-002", ["SPEC-002"]), false);
});

test("FR-003: 의미 동인 집합이 비면 완화 아님(가짜·비실재 동인은 소비 게이트가 걸러 빈 집합)", () => {
  assert.equal(crossSpecRelaxed("SPEC-002", []), false);
});

test("FR-004: 여러 동인 중 하나라도 타-스펙 의미 동인이면 완화", () => {
  assert.equal(crossSpecRelaxed("SPEC-002", ["SPEC-002", "SPEC-005"]), true);
});

test("결정성: 중복 동인 무관, 동일 입력 동일 출력", () => {
  assert.equal(crossSpecRelaxed("SPEC-002", ["SPEC-001", "SPEC-001"]), true);
});
