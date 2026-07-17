// @covers SPEC-020/FR-001
// @covers SPEC-020/FR-002
// @covers SPEC-020/FR-003
// @covers SPEC-020/FR-004
// @covers SPEC-020/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDrivers, crossSpecRelaxed, relaxingDrivers } from "../cross-spec-lib.mjs";

const ALT = "SPEC|INFRA|TEST|CICD";
// 테스트용 글롭 매처 — 게이트는 compileGlob을 주입한다(코어는 글롭 문법 비의존).
const matchPrefix = (g, f) => f.startsWith(g.replace(/\*+$/, ""));

test("FR-001: Change-Driver 트레일러 파싱 — id + 사유", () => {
  const d = parseDrivers("refactor: x\n\nChange-Driver: SPEC-001 공유 유틸 시그니처 변경", ALT);
  assert.deepEqual(d, [{ id: "SPEC-001", globs: null, reason: "공유 유틸 시그니처 변경" }]);
});

test("FR-001: 사유 빈 트레일러는 버림 / 여러 라인 허용", () => {
  const d = parseDrivers("m\n\nChange-Driver: SPEC-001\nChange-Driver: SPEC-002 실동인", ALT);
  assert.deepEqual(d, [{ id: "SPEC-002", globs: null, reason: "실동인" }]);
});

test("FR-005: 경로 스코프 파싱 — @glob[,glob] 토큰은 globs로, 사유와 분리", () => {
  const d = parseDrivers("m\n\nChange-Driver: SPEC-001 @src/shared/**,lib/util/** 공유 유틸 확장", ALT);
  assert.deepEqual(d, [{ id: "SPEC-001", globs: ["src/shared/**", "lib/util/**"], reason: "공유 유틸 확장" }]);
});

test("FR-005: 스코프 동인은 매치 파일만 완화 — 무스코프 동인은 전 파일(레거시)", () => {
  const entries = [
    { id: "SPEC-001", globs: ["src/shared/**"], reason: "r" },
    { id: "SPEC-003", globs: null, reason: "r" },
  ];
  // 스코프 매치 파일: 두 동인 모두 완화(정렬 출력)
  assert.deepEqual(relaxingDrivers("SPEC-002", "src/shared/util.ts", entries, matchPrefix), ["SPEC-001", "SPEC-003"]);
  // 스코프 밖 파일: 무스코프 동인만 완화
  assert.deepEqual(relaxingDrivers("SPEC-002", "src/other/x.ts", entries, matchPrefix), ["SPEC-003"]);
  // 자기 자신은 동인 아님
  assert.deepEqual(relaxingDrivers("SPEC-003", "src/other/x.ts", entries, matchPrefix), []);
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
