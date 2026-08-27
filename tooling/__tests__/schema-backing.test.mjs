// tooling/__tests__/schema-backing.test.mjs — Entity 스키마 백킹 (SPEC-026)
// 소유 entity는 구조 SSOT(스키마)에 실재해야 한다 — 유령 entity(wizard·project_list)로
// capability 귀속(SPEC-024)을 우회하는 것을 차단(실측: pjt_projects.create→wizard.create 개명).
// @covers SPEC-026/FR-001
// @covers SPEC-026/FR-002
// @covers SPEC-026/FR-003
// @covers SPEC-026/FR-004
// @covers SPEC-026/FR-005
// @covers SPEC-026/FR-006
// @covers SPEC-026/FR-007
// @covers SPEC-026/FR-008
// @covers SPEC-026/FR-009
// @covers SPEC-026/FR-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCategoryRoles } from "../ownership-keys.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaBackingActive, schemaBackingInertReasons, validateSchemaPatterns, schemaSourceGlobFindings, extractSchemaEntities, schemaSourceSamples, schemaBackingFindings } from "../schema-backing-lib.mjs";

const GATE = new URL("../check-ownership.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

// 역할 해석 헬퍼 — 게이트와 같은 파생을 테스트도 쓴다(선언 우선 → 이름 폴백, SPEC-001 FR-010).
const R = (cats, roles) => resolveCategoryRoles(cats, roles);


test("schemaBackingActive: 정책 on + 소스 선언 + Entities류 카테고리, 셋 다 있어야 활성", () => {
  const src = [{ globs: ["s.ts"], patterns: ["x"] }];
  assert.equal(schemaBackingActive("advisory", src, R(["Entities", "Surfaces"])), true);
  assert.equal(schemaBackingActive("hard", src, R(["Entities"])), true);
  assert.equal(schemaBackingActive("off", src, R(["Entities"])), false);        // 정책 off
  assert.equal(schemaBackingActive("advisory", [], R(["Entities"])), false);     // 소스 없음
  assert.equal(schemaBackingActive("advisory", src, R(["Modules", "Symbols"])), false); // 킷: entity 카테고리 없음
});

test("schemaBackingInertReasons: off는 침묵 / 정책 on + 소스 비어있음·카테고리 불일치는 사유 반환", () => {
  const src = [{ globs: ["s.ts"], patterns: ["x"] }];
  assert.deepEqual(schemaBackingInertReasons("off", [], R(["Modules"])), []);       // 명시적 off = 탈출구
  assert.deepEqual(schemaBackingInertReasons("hard", src, R(["Entities"])), []);    // 판정 성립
  // A-3 재현: sources를 비우면 백킹 hard가 무음 사망하던 자리
  const noSrc = schemaBackingInertReasons("hard", [], R(["Entities"]));
  assert.equal(noSrc.length, 1);
  assert.match(noSrc[0], /entitySchemaSources/);
  // A-1 재현: 카테고리 개명
  const renamed = schemaBackingInertReasons("hard", src, R(["Aggregates", "Surfaces"]));
  assert.equal(renamed.length, 1);
  assert.match(renamed[0], /entity 역할 카테고리 미해석/);
  assert.equal(schemaBackingInertReasons("advisory", [], R(["Modules"])).length, 2); // 둘 다
});

test("extractSchemaEntities: 패턴 캡처1 = 식별자, 정규화(소문자), 다중 소스·패턴 합집합", () => {
  const set = extractSchemaEntities([
    { text: `export const pjt_projects = pgTable("pjt_projects", {});\nexport const Pjt_Staff = pgTable("Pjt_Staff", {});`,
      patterns: ["pgTable\\(\"([a-zA-Z0-9_]+)\""] },
    { text: `CREATE TABLE invoices (...);`, patterns: ["CREATE TABLE ([a-z_]+)"] },
  ]);
  assert.deepEqual([...set].sort(), ["invoices", "pjt_projects", "pjt_staff"]);
});

// 이슈 #21 M-4: "g"만 주고 멀티라인을 안 켜서 `^model` 같은 라인 앵커가 텍스트 전체의
// 시작에만 걸려 사실상 매치 불가 — 소스가 뭐든 추출 0건이 되고 소유 entity 전부가 유령으로
// hard 차단됐다(진단은 원인을 전혀 가리키지 못해 "일괄 면제"를 유도).
test("extractSchemaEntities: ^ 라인 앵커가 텍스트 중간 줄에서도 매치된다(이슈 #21 M-4)", () => {
  const set = extractSchemaEntities([
    { text: "// header comment\nmodel User {}\nmodel Post {}\n", patterns: ["^model (\\w+)"] },
  ]);
  assert.deepEqual([...set].sort(), ["post", "user"]);
});

// 이슈 #21 M-5: Python 전용 인라인 플래그 `(?m)`을 Node가 파싱하지 못해 같은 패턴 문자열이
// 엔진별로 성공/에러로 갈렸다(SPEC-026 SC-001 바이트 동일 위반).
test("compileSchemaPattern: (?i)·(?s) 인라인 플래그를 직접 파싱해 흡수한다(이슈 #21 M-5)", () => {
  const setCI = extractSchemaEntities([{ text: "MODEL User {}\n", patterns: ["(?i)^model (\\w+)"] }]);
  assert.deepEqual([...setCI], ["user"]);
  const setDotall = extractSchemaEntities([{ text: "model\nUser {}\n", patterns: ["(?s)model\\n(\\w+)"] }]);
  assert.deepEqual([...setDotall], ["user"]);
});

test("compileSchemaPattern: 인식 못 하는 인라인 플래그는 유효성 검사에서 에러로 잡힌다", () => {
  const errs = validateSchemaPatterns([{ patterns: ["(?x)model (\\w+)"] }]);
  assert.deepEqual(errs, [{ index: 0, pattern: "(?x)model (\\w+)" }]);
});

// 이슈 #21 M-5: Python str 정규식은 기본 \w가 유니코드 인식이라 한글 식별자를 매치하는데,
// Node \w는 ASCII 전용이라 같은 패턴이 반대 판정을 냈다(SPEC-026 SC-001 위반). Python을
// ASCII 전용으로 좁혀 Node와 일치시킨다 — 한글 스키마 식별자는 두 엔진 다 매치하지 않는다.
test("extractSchemaEntities: \\w는 ASCII 전용 — 한글 식별자는 매치하지 않는다(Node 원래 동작)", () => {
  const set = extractSchemaEntities([{ text: "model 사용자 {}\nmodel Order {}\n", patterns: ["^model (\\w+)"] }]);
  assert.deepEqual([...set], ["order"]);
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

test("validateSchemaPatterns: 잘못된 정규식 수집(엔진 메시지 미포함) / extractSchemaEntities 크래시 안 함", () => {
  const errs = validateSchemaPatterns([{ globs: ["s.ts"], patterns: ["ok([a-z]+)", "bad((("] }]);
  assert.deepEqual(errs, [{ index: 0, pattern: "bad(((" }]);
  assert.deepEqual(validateSchemaPatterns([{ patterns: ["fine"] }]), []);
  // 잘못된 정규식이 섞여도 추출은 크래시하지 않고 유효 패턴만 반영
  const set = extractSchemaEntities([{ text: "table users;", patterns: ["bad(((", "table ([a-z]+)"] }]);
  assert.deepEqual([...set], ["users"]);
});

// 이슈 #21 C-1 우회로 4개 중 "스펙 자기참조 글롭" — 스펙 자신이 자기 소유 entity의 실재 근거가
// 되는 완전 순환.
test("schemaSourceGlobFindings: 스펙 디렉토리를 가리키는 글롭은 구조 오류 — 무관 글롭은 통과", () => {
  const f1 = schemaSourceGlobFindings([{ globs: ["sdd/specs/**"], patterns: ["x"] }], "sdd/specs");
  assert.equal(f1.length, 1);
  assert.match(f1[0], /entitySchemaSources\[0\]\.globs "sdd\/specs\/\*\*" — 스펙 디렉토리/);
  const f2 = schemaSourceGlobFindings([{ globs: ["sdd/specs/*.md"], patterns: ["x"] }], "sdd/specs");
  assert.equal(f2.length, 1);
  const f3 = schemaSourceGlobFindings([{ globs: ["src/db/*.ts"], patterns: ["x"] }], "sdd/specs");
  assert.deepEqual(f3, []);
  assert.deepEqual(schemaSourceGlobFindings([], "sdd/specs"), []);
  assert.deepEqual(schemaSourceGlobFindings(undefined, "sdd/specs"), []);
});

// 이슈 #21 C-1 우회로 2·3 — import 문·주석 DDL이 구조 SSOT 선언으로 오인증되던 것을 줄 단위로 배제.
test("extractSchemaEntities: import 문·주석 라인의 매치는 제외 — 정당한 선언은 그대로 잡는다", () => {
  const set = extractSchemaEntities([{
    text: [
      `import { type Wizard } from "./types";`,
      `// interface Ghost {}`,
      `/* interface AlsoGhost {} */`,
      ` * interface JsdocGhost {}`,
      `# interface HashGhost {}`,
      `-- TODO: CREATE TABLE wizard`,
      `interface RealTable {}`,
      `  interface IndentedReal {}`,
    ].join("\n"),
    patterns: ["interface\\s+([A-Za-z0-9_]+)"],
  }]);
  assert.deepEqual([...set].sort(), ["indentedreal", "realtable"]);
});

test("schemaSourceSamples: 파일별 추출 표본(중복 제거·file 오름차순) — file 없는 unit은 제외", () => {
  const samples = schemaSourceSamples([
    { text: `model User {}\nmodel Post {}\nmodel User {}\n`, patterns: ["^model (\\w+)"], file: "b.prisma" },
    { text: `CREATE TABLE invoices (...);`, patterns: ["CREATE TABLE ([a-z_]+)"], file: "a.sql" },
    { text: `model Ignored {}`, patterns: ["^model (\\w+)"] }, // file 없음 — 제외
  ]);
  assert.deepEqual(samples, [
    { file: "a.sql", entities: ["invoices"] },
    { file: "b.prisma", entities: ["user", "post"] },
  ]);
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

test("게이트: 면제 entity는 hard에서도 부채로 항상 표면화(조용한 '완료' 방지)", () => {
  // 유령 wizard를 면제 등록 → 위반은 0(통과)이지만, 면제가 리뷰 부채로 매 실행 표면화돼야 함
  const root = fixture("hard", { extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", wizard: "x" },
    entitySchemaExemptEntities: { wizard: "레거시 UI 개념" } } });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);                        // 면제라 통과
    assert.match(r.out, /스키마 대조 면제 1건/);            // 그러나 부채로 표면화
    assert.match(r.out, /wizard/);
    assert.match(r.out, /Surface 강등/);                    // 재구성 방향 안내
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: enum 밖 정책 값 → exit 1", () => {
  const root = fixture("strict");
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /entitySchemaBackingPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 잘못된 정규식은 크래시 대신 명확한 config 에러 + exit 1", () => {
  const root = fixture("advisory", { extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", wizard: "x" },
    entitySchemaSources: [{ globs: ["src/db/*.ts"], patterns: ["pgTable((("] }] } });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /entitySchemaSources\[0\]\.patterns "pgTable\(\(\(" — 잘못된 정규식/);
    assert.doesNotMatch(r.out, /SyntaxError|Invalid regular expression|Unterminated/); // 엔진 스택 노출 안 함
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 스펙 디렉토리 자기참조 글롭 — 구조 오류로 exit 1(이슈 #21 C-1)", () => {
  const root = fixture("advisory", { extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", wizard: "x" },
    entitySchemaSources: [
      { globs: ["src/db/*.ts"], patterns: ['pgTable\\("([a-zA-Z0-9_]+)"'] },
      { globs: ["sdd/specs/**"], patterns: ["\\*\\*Entities\\*\\*: (\\w+)"] },
    ] } });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /entitySchemaSources\[1\]\.globs "sdd\/specs\/\*\*" — 스펙 디렉토리\(sdd\/specs\)를 가리킴/);
    assert.match(r.out, /Entity 스키마 백킹 설정 오류/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 어댑터 매치 표본이 파일별로 매 실행 표면화된다(이슈 #21 C-1 FR-010)", () => {
  const root = fixture("hard", { entities: "pjt_project_staff", extraConfig: {
    entityRegistry: { pjt_projects: "실 aggregate", pjt_project_staff: "실 인력 테이블" } } });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Entity 스키마 백킹 어댑터 표본/);
    assert.match(r.out, /src\/db\/schema\.ts → pjt_projects, pjt_project_staff/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
