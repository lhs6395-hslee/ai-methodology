// @covers SPEC-017/FR-001
// @covers SPEC-017/FR-002
// @covers SPEC-017/FR-003
// @covers SPEC-017/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelationEntry, relationTypeFinding, resolveRelations, findCycles } from "../relation-lib.mjs";

// ── parseRelationEntry ──

test("EntityName (type) → {name, type} 구조화 파싱", () => {
  assert.deepEqual(parseRelationEntry("investigation_finding (has-many)"), { name: "investigation_finding", type: "has-many" });
});

test("EntityName만(괄호 없음) → {name, type:null} 레거시 자유참조", () => {
  assert.deepEqual(parseRelationEntry("investigation_finding"), { name: "investigation_finding", type: null });
});

test("괄호 안에 공백·쉼표·대문자 있으면 관계 아님 — 우연한 서술 괄호와 구분", () => {
  assert.deepEqual(parseRelationEntry("legacy_thing (deprecated, 검토 필요)"), { name: "legacy_thing (deprecated, 검토 필요)", type: null });
  assert.deepEqual(parseRelationEntry("legacy_thing (TBD)"), { name: "legacy_thing (TBD)", type: null });
});

test("relation-type은 소문자 kebab 1토큰만 인정", () => {
  assert.deepEqual(parseRelationEntry("x (belongs-to)"), { name: "x", type: "belongs-to" });
  assert.deepEqual(parseRelationEntry("x (a1-b2)"), { name: "x", type: "a1-b2" });
});

// ── relationTypeFinding ──

test("allowedTypes 비어있으면 무제한 — 어떤 type도 통과", () => {
  assert.equal(relationTypeFinding("anything", []), null);
});

test("allowedTypes 있는데 type이 그 안에 없으면 에러", () => {
  const r = relationTypeFinding("has-many", ["references", "belongs-to"]);
  assert.match(r, /has-many/);
  assert.match(r, /relationTypes/);
});

test("allowedTypes에 있으면 통과", () => {
  assert.equal(relationTypeFinding("references", ["references", "belongs-to"]), null);
});

test("type이 null(레거시)이면 항상 통과 — 검사 대상 아님", () => {
  assert.equal(relationTypeFinding(null, ["references"]), null);
});

// ── resolveRelations ──

test("구조화 관계의 대상 Entity가 실재 + 소유 spec 해석 → edges에 등록", () => {
  const specDeps = [{ specId: "SPEC-005", entities: [{ name: "investigation_finding", type: "has-many" }] }];
  const ownerIndex = new Map([["investigation_finding", "SPEC-006"]]);
  const { edges, missing } = resolveRelations(specDeps, ownerIndex);
  assert.deepEqual(edges, [{ from: "SPEC-005", to: "SPEC-006", type: "has-many", entity: "investigation_finding" }]);
  assert.deepEqual(missing, []);
});

test("대상 Entity가 어느 spec에도 없으면 missing(hard 대상)", () => {
  const specDeps = [{ specId: "SPEC-005", entities: [{ name: "nonexistent_thing", type: "references" }] }];
  const { edges, missing } = resolveRelations(specDeps, new Map());
  assert.deepEqual(edges, []);
  assert.deepEqual(missing, [{ specId: "SPEC-005", entity: "nonexistent_thing", type: "references" }]);
});

test("레거시(type:null) 항목은 관계 해석 대상이 아니다 — edges·missing 둘 다 무관", () => {
  const specDeps = [{ specId: "SPEC-005", entities: [{ name: "whatever", type: null }] }];
  const { edges, missing } = resolveRelations(specDeps, new Map());
  assert.deepEqual(edges, []);
  assert.deepEqual(missing, []);
});

// ── findCycles ──

test("순환 없음 → []", () => {
  const edges = [{ from: "SPEC-001", to: "SPEC-002" }, { from: "SPEC-002", to: "SPEC-003" }];
  assert.deepEqual(findCycles(edges), []);
});

test("A→B→A 순환 탐지", () => {
  const edges = [{ from: "SPEC-001", to: "SPEC-002" }, { from: "SPEC-002", to: "SPEC-001" }];
  const cycles = findCycles(edges);
  assert.equal(cycles.length, 1);
  assert.ok(cycles[0].includes("SPEC-001") && cycles[0].includes("SPEC-002"));
});

test("자기참조(self-loop) A→A도 순환으로 탐지", () => {
  const edges = [{ from: "SPEC-001", to: "SPEC-001" }];
  const cycles = findCycles(edges);
  assert.equal(cycles.length, 1);
});

test("3-노드 순환(A→B→C→A) 탐지", () => {
  const edges = [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }];
  const cycles = findCycles(edges);
  assert.equal(cycles.length, 1);
  for (const n of ["A", "B", "C"]) assert.ok(cycles[0].includes(n));
});
