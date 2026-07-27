// @covers SPEC-014/FR-001
// @covers SPEC-014/FR-002
// @covers SPEC-014/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberingIssues, frNumberingIssues, groupNumbers } from "../numbering-lib.mjs";

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

// ── FR 번호 무결성(SPEC-014 FR-005/006): 스펙별 001 연번 규범의 판정 코어 ──
// spec-ID 판정과 같은 "접두어+3자리" 집합 판정이라 순수 원형(groupNumbers)을 공유하고
// severity만 분리한다 — spec-ID의 001미시작은 hard지만 FR은 advisory(폐기 흔적 가능).

// @covers SPEC-014/FR-006
test("FR 정상: 스펙별 FR-001부터 연번 → hard·advisory 둘 다 빔", () => {
  const r = frNumberingIssues("SPEC-001", ["FR-001", "FR-002", "FR-003"]);
  assert.deepEqual(r.hard, []);
  assert.deepEqual(r.advisory, []);
});

// @covers SPEC-014/FR-005
test("한 스펙 안 FR 번호 중복 → hard (PM tool 실측 재현: 두 브랜치가 같은 번호를 각자 추가)", () => {
  const r = frNumberingIssues("SPEC-004", ["FR-023", "FR-024", "FR-025", "FR-026", "FR-023", "FR-024"]);
  assert.equal(r.hard.length, 2);
  assert.match(r.hard[0], /SPEC-004\/FR-023 FR 번호 중복/);
  assert.match(r.hard[1], /SPEC-004\/FR-024 FR 번호 중복/);
  assert.match(r.hard[0], /sdd-retag/); // 해소 수단 지목(SPEC-011)
  // 이 픽스처는 023부터라 001 미시작 advisory도 함께 뜨지만 결번은 없다(중복과 직교한 신호)
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /001부터 시작하지 않음/);
});

// @covers SPEC-014/FR-006
test("FR-001부터 시작하지 않음 → advisory만(hard 아님) — 전역 번호 잔재는 가독성 문제이지 무결성 위반 아님", () => {
  const r = frNumberingIssues("SPEC-001", ["FR-001", "FR-047", "FR-048"]);
  assert.deepEqual(r.hard, []);
  const start = r.advisory.filter((m) => /001부터 시작하지 않음/.test(m));
  assert.equal(start.length, 0); // 최소가 001이므로 시작 신호 없음
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /중간 결번/);
});

// @covers SPEC-014/FR-006
test("최소 번호가 001이 아니면 advisory(FR-005부터 시작)", () => {
  const r = frNumberingIssues("SPEC-002", ["FR-005", "FR-006"]);
  assert.deepEqual(r.hard, []);
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /SPEC-002: FR 번호가 001부터 시작하지 않음 — 최소 FR-005/);
});

// @covers SPEC-014/FR-006
test("중간 결번 → advisory (폐기 흔적일 수 있음 — SPEC-018 retire)", () => {
  const r = frNumberingIssues("SPEC-003", ["FR-001", "FR-002", "FR-004"]);
  assert.deepEqual(r.hard, []);
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /FR-003/);
  assert.match(r.advisory[0], /폐기/);
});

// @covers SPEC-014/FR-005
test("레터 서픽스: FR-003a는 FR-003의 중복이 아니고, 기저 번호로 결번을 채운다", () => {
  const r = frNumberingIssues("SPEC-005", ["FR-001", "FR-002", "FR-002a", "FR-003"]);
  assert.deepEqual(r.hard, []);
  assert.deepEqual(r.advisory, []);
  // 같은 서픽스 ID가 두 번이면 중복
  const dup = frNumberingIssues("SPEC-005", ["FR-001", "FR-001a", "FR-001a"]);
  assert.equal(dup.hard.length, 1);
  assert.match(dup.hard[0], /SPEC-005\/FR-001a FR 번호 중복/);
});

// @covers SPEC-014/FR-006
test("도메인 요구 접두어(requirementIdPrefixes: INFRA)도 접두어별 독립 판정", () => {
  const r = frNumberingIssues("SPEC-006", ["FR-001", "INFRA-001", "INFRA-002"]);
  assert.deepEqual(r.hard, []);
  assert.deepEqual(r.advisory, []);
  const bad = frNumberingIssues("SPEC-006", ["FR-001", "INFRA-011"]);
  assert.equal(bad.advisory.length, 1);
  assert.match(bad.advisory[0], /INFRA 번호가 001부터/);
});

// @covers SPEC-014/FR-003
test("FR 판정 결정성 — 입력 순서 무관·정렬 출력, 파일시스템 비의존", () => {
  const a = frNumberingIssues("SPEC-007", ["FR-004", "FR-002", "FR-002"]);
  const b = frNumberingIssues("SPEC-007", ["FR-002", "FR-002", "FR-004"]);
  assert.deepEqual(a, b);
  assert.deepEqual(frNumberingIssues("SPEC-007", []), { hard: [], advisory: [] });
});

// @covers SPEC-014/FR-003
test("groupNumbers 원형 공유 — spec-ID·FR 판정이 같은 순수 집합 판정을 쓴다", () => {
  const g = groupNumbers(["FR-002", "FR-004", "FR-002"]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0], { prefix: "FR", nums: [2, 4], dupIds: ["FR-002"], min: 2, missing: [3] });
});
