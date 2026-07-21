// tooling/__tests__/schema-backing.test.mjs — Entity 스키마 백킹 (SPEC-026)
// 소유 entity는 구조 SSOT(스키마)에 실재해야 한다 — 유령 entity(wizard·project_list)로
// capability 귀속(SPEC-024)을 우회하는 것을 차단(실측: pjt_projects.create→wizard.create 개명).
// @covers SPEC-026/FR-001
// @covers SPEC-026/FR-002
// @covers SPEC-026/FR-003
// @covers SPEC-026/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaBackingActive, extractSchemaEntities, schemaBackingFindings } from "../schema-backing-lib.mjs";

const GATE = new URL("../check-ownership.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("schemaBackingActive: 정책 on + 소스 선언 + Entities류 카테고리, 셋 다 있어야 활성", () => {
  const src = [{ globs: ["s.ts"], patterns: ["x"] }];
  assert.equal(schemaBackingActive("advisory", src, ["Entities", "Surfaces"]), true);
  assert.equal(schemaBackingActive("hard", src, ["Entities"]), true);
  assert.equal(schemaBackingActive("off", src, ["Entities"]), false);        // 정책 off
  assert.equal(schemaBackingActive("advisory", [], ["Entities"]), false);     // 소스 없음
  assert.equal(schemaBackingActive("advisory", src, ["Modules", "Symbols"]), false); // 킷: entity 카테고리 없음
});

test("extractSchemaEntities: 패턴 캡처1 = 식별자, 정규화(소문자), 다중 소스·패턴 합집합", () => {
  const set = extractSchemaEntities([
    { text: `export const pjt_projects = pgTable("pjt_projects", {});\nexport const Pjt_Staff = pgTable("Pjt_Staff", {});`,
      patterns: ["pgTable\\(\"([a-zA-Z0-9_]+)\""] },
    { text: `CREATE TABLE invoices (...);`, patterns: ["CREATE TABLE ([a-z_]+)"] },
  ]);
  assert.deepEqual([...set].sort(), ["invoices", "pjt_projects", "pjt_staff"]);
});

test("schemaBackingFindings: 스키마에 없는 소유 entity만 위반 — 실재·면제는 통과", () => {
  const schema = new Set(["pjt_projects", "pjt_project_staff"]);
  const exempt = new Set(["external_billing"]);
  const owned = [
    { specId: "SPEC-004", entities: ["pjt_projects", "pjt_project_staff"] }, // 전부 실재 → 0
    { specId: "SPEC-002", entities: ["wizard"] },                            // 유령 → 위반
    { specId: "SPEC-013", entities: ["external_billing"] },                  // 면제 → 통과
    { specId: "SPEC-012", entities: [" Project_List "] },                    // 유령(정규화) → 위반
  ];
  const f = schemaBackingFindings(owned, schema, exempt);
  assert.deepEqual(f, [{ specId: "SPEC-002", entity: "wizard" }, { specId: "SPEC-012", entity: "project_list" }]);
});

// ── 게이트 e2e (entitySchemaBackingPolicy off|advisory|hard) ──

function fixture(policy, { extraConfig = {}, entities = "wizard" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-sb-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src", "db"), { recursive: true });
  writeFileSync(join(root, "src/db/schema.ts"),
    `export const pjt_projects = pgTable("pjt_projects", {});\nexport const pjt_project_staff = pgTable("pjt_project_staff", {});\n`);
  const cfg = {
    specDir: "sdd/specs",
    entityRegistry: { pjt_projects: "실 aggregate", wizard: "마법사 개념(테스트)" },
    ...(policy === undefined ? {} : { entitySchemaBackingPolicy: policy }),
    entitySchemaSources: [{ globs: ["src/db/*.ts"], patterns: ['pgTable\\("([a-zA-Z0-9_]+)"'] }],
    ...extraConfig,
  };
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify(cfg));
  writeFileSync(join(root, "sdd/specs/SPEC-004.md"),
    `# S4\n**Spec**: \`SPEC-004\`\n\n- **FR-001** THE SYSTEM SHALL read.\n\n## Ownership\n- **Entities**: pjt_projects\n- **Capabilities**: pjt_projects.read\n`);
  writeFileSync(join(root, "sdd/specs/SPEC-002.md"),
    `# S2\n**Spec**: \`SPEC-002\`\n\n- **FR-001** THE SYSTEM SHALL create.\n\n## Ownership\n- **Entities**: ${entities}\n- **Capabilities**: ${entities}.create\n`);
  return root;
}
function run(root) {
  try {
    const out = execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: off/미설정 → 판정 안 함(하위호환) / advisory → ⚠ exit 0 / hard → ✗ exit 1", () => {
  for (const [policy, wantCode, wantLine] of [[undefined, 0, false], ["advisory", 0, true], ["hard", 1, true]]) {
    const root = fixture(policy);
    try {
      const r = run(root);
      assert.equal(r.code, wantCode, `${policy}: ${r.out}`);
      if (wantLine) {
        assert.match(r.out, /Entity 스키마 백킹/);
        assert.match(r.out, /Entities "wizard" — 구조 SSOT/);
      } else {
        assert.doesNotMatch(r.out, /Entity 스키마 백킹/);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("게이트: 실재 entity만 소유하면 hard도 PASS / 면제 entity는 통과 / 빈 면제 사유는 에러", () => {
  // 실재 entity(pjt_project_staff, 스키마에 존재·SPEC-004와 비중복)만 → hard PASS
  const okRoot = fixture("hard", { entities: "pjt_project_staff", extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", pjt_project_staff: "실 인력 테이블" } } });
  try { assert.equal(run(okRoot).code, 0, run(okRoot).out); } finally { rmSync(okRoot, { recursive: true, force: true }); }

  // 유령이지만 면제 등록 → 통과(외부 자원 등 정당 케이스)
  const exemptRoot = fixture("hard", { extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", wizard: "면제 테스트" },
    entitySchemaExemptEntities: { wizard: "레거시 UI 개념 — 다음 라운드 재구성 예정" } } });
  try { assert.equal(run(exemptRoot).code, 0, run(exemptRoot).out); } finally { rmSync(exemptRoot, { recursive: true, force: true }); }

  // 빈 면제 사유 → 에러 exit 1
  const badRoot = fixture("advisory", { extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", wizard: "x" },
    entitySchemaExemptEntities: { wizard: "" } } });
  try {
    const r = run(badRoot);
    assert.equal(r.code, 1);
    assert.match(r.out, /entitySchemaExemptEntities\["wizard"\] — 면제 사유 필요/);
  } finally { rmSync(badRoot, { recursive: true, force: true }); }
});

test("게이트: enum 밖 정책 값 → exit 1", () => {
  const root = fixture("strict");
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /entitySchemaBackingPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
