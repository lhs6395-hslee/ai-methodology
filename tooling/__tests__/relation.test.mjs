// @covers SPEC-017/FR-001
// @covers SPEC-017/FR-002
// @covers SPEC-017/FR-003
// @covers SPEC-017/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelationEntry, relationTypeFinding, resolveRelations, findCycles } from "../relation-lib.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// ── 게이트 e2e: 관계 대상 이름의 정규화 ───────────────────────────────────
// 이 결함은 **호출부**에 있었으므로 위의 순수 코어 테스트로는 잡히지 않는다 —
// `owners`는 normalizeKey로 채워지는데 관계 이름은 원문으로 조회해, 스펙이 소유 키를
// 글자 그대로 베껴 써도(`IacActionRun`) hard missing-target 오차단이 났다.
// 킷 자기적용으로는 영구히 안 보인다(킷 entity 키가 이미 소문자다) → e2e로 고정한다.
const REL_LIBS = ["check-ownership.mjs", "ownership-keys.mjs", "sdd-config.mjs", "grammar-lib.mjs",
  "key-anchor-lib.mjs", "lifecycle-lib.mjs", "relation-lib.mjs", "capability-ownership-lib.mjs",
  "spec-sync-lib.mjs", "schema-backing-lib.mjs", "ownership-reality-lib.mjs"];

function relRepo(ownedEntity, depEntry) {
  const root = mkdtempSync(join(tmpdir(), "sdd-rel-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/x.ts"), "//\n");
  for (const f of REL_LIBS) cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", scanDirs: ["src"],
    ownershipCategories: ["Entities", "Surfaces", "Capabilities"],
    ownershipCategoryRoles: { Entities: "entity", Surfaces: "surface", Capabilities: "capability" },
  }));
  const spec = (id, ent, deps) =>
    `# ${id}\n**Module**: \`m\`  **Spec**: \`${id}\`  **Status**: Active\n\n` +
    `## Functional Requirements (EARS)\n- **FR-001** (ubiquitous): THE SYSTEM SHALL keep **${ent}** (E) rows.\n\n` +
    `## Ownership\n- **Entities**: ${ent}\n- **Surfaces**: —\n- **Capabilities**: —\n- **Files**: src/x.ts\n\n` +
    `## Dependencies\n- **Entities**: ${deps}\n\n` +
    `## Success Criteria\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n`;
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), spec("SPEC-001", ownedEntity, "—"));
  writeFileSync(join(root, "sdd/specs/SPEC-002.md"), spec("SPEC-002", "OtherThing", depEntry));
  return root;
}
function relGate(root) {
  try {
    return { code: 0, out: execFileSync("node", [join(root, "scripts/check-ownership.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트 FR-002: 소유 키를 글자 그대로 베낀 참조는 통과 — 정규화 불일치 오차단 회귀", () => {
  const root = relRepo("IacActionRun", "IacActionRun (references)");
  try {
    const r = relGate(root);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /관계 대상 Entity/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 FR-002: 정규화가 같아지는 표기 차이도 통과(대소문자)", () => {
  const root = relRepo("IacActionRun", "iacactionrun (references)");
  try { assert.equal(relGate(root).code, 0); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 FR-002: 진짜 유령 참조는 여전히 hard로 차단(느슨해지지 않았다)", () => {
  const root = relRepo("IacActionRun", "GhostThing (references)");
  try {
    const r = relGate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /관계 대상 Entity "ghostthing"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
