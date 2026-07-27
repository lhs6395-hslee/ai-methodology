// tooling/__tests__/ownership-map.test.mjs
// Ownership 보증 맵(SPEC-028) — 키별 칸 값·가드 포스처·미판정 경고·게이트 집계 일치·--check 드리프트.
// @covers SPEC-028/FR-001
// @covers SPEC-028/FR-002
// @covers SPEC-028/FR-003
// @covers SPEC-028/FR-004
// @covers SPEC-028/FR-005
// @covers SPEC-028/FR-006
// @covers SPEC-028/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UNJUDGED = "미판정";
// 킷 생성기를 cwd=픽스처로 실행 — 픽스처에 tooling을 복사하면 macOS /var↔/private/var 심볼릭
// 링크로 argv[1]≠import.meta.url이 되어 main 블록이 돌지 않는다(다른 킷 테스트와 동일 관례).
const GEN = join(process.cwd(), "tooling/gen-ownership-map.mjs");

// 픽스처 레포 — 킷 tooling을 복사해 대상 레포처럼 실행(생성기는 config만 보고 동작해야 한다).
function repo({ config = {}, specs = {}, srcFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-omap-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd/specs", name), body);
  for (const [rel, body] of Object.entries(srcFiles)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function gen(root, args = []) {
  const out = execFileSync("node", [GEN, ...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { stdout: out, map: readFileSync(join(root, "sdd/OWNERSHIP_MAP.md"), "utf8") };
}
function genCode(root, args = []) {
  try {
    const out = execFileSync("node", [GEN, ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

const SPEC = (id, { entities = "thing", surfaces = "—", caps = "thing.create", fr } = {}) =>
  `# ${id}\n**Module**: \`m\`  **Spec**: \`${id}\`  **Status**: Active\n\n` +
  `## Functional Requirements (EARS)\n${fr ?? `- **FR-001** (ubiquitous): THE SYSTEM SHALL keep **${entities}** (E) rows.`}\n\n` +
  `## Ownership\n- **Entities**: ${entities}\n- **Surfaces**: ${surfaces}\n- **Capabilities**: ${caps}\n- **Files**: src/x.ts\n\n` +
  `## Success Criteria\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n`;

test("FR-001/FR-007: 소유 키마다 행을 내고 카테고리·역할은 config에서 온다", () => {
  const root = repo({ specs: { "SPEC-001.md": SPEC("SPEC-001") } });
  try {
    const { map, stdout } = gen(root);
    assert.match(map, /## Entity 키 \(aggregate root\) — 1건/);
    assert.match(map, /\|\s*`thing`\s*\|\s*SPEC-001\s*\|/);
    assert.match(map, /## Capability 키 — 1건/);
    assert.match(stdout, /소유 키 2건/);          // entity 1 + capability 1(Surfaces는 — 플레이스홀더)
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-007: 비-웹 카테고리도 역할 선언으로 동작(킷 형태)", () => {
  const spec = `# SPEC-001\n**Module**: \`m\`  **Spec**: \`SPEC-001\`  **Status**: Active\n\n` +
    `## Functional Requirements (EARS)\n- **FR-001** (ubiquitous): THE **mod-a** (E) module SHALL expose **lib.mjs** (S).\n\n` +
    `## Ownership\n- **Modules**: mod-a\n- **Symbols**: lib.mjs\n- **Artifacts**: —\n- **Files**: src/x.ts\n\n` +
    `## Success Criteria\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n`;
  const root = repo({
    config: { ownershipCategories: ["Modules", "Symbols", "Artifacts"], ownershipCategoryRoles: { Modules: "entity", Symbols: "surface" }, frKeyAnchorPolicy: "advisory" },
    specs: { "SPEC-001.md": spec },
  });
  try {
    const { map } = gen(root);
    assert.match(map, /\| Modules \| entity \|/);
    assert.match(map, /\| Symbols \| surface \|/);
    assert.match(map, /\| Artifacts \| —\(역할 없음\) \|/);
    assert.match(map, /\|\s*`mod-a`\s*\|\s*SPEC-001\s*\|\s*✓\s*\|\s*✓\s*\|/); // 앵커 발화 → ✓
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-002/FR-003: 가드가 발화 안 하면 칸은 미판정 + 포스처 표에 사유 + 경고 줄", () => {
  // 기본값: entitySchemaBackingPolicy off · surfaceGlobs 없음 · frKeyAnchorPolicy off
  const root = repo({ specs: { "SPEC-001.md": SPEC("SPEC-001", { surfaces: "POST /api/x" }) } });
  try {
    const { map } = gen(root);
    assert.match(map, new RegExp(`\\| entity 실재\\(SPEC-026\\) \\| \\*\\*${UNJUDGED}\\*\\* \\| off \\|`));
    assert.match(map, /surfaceGlobs 미설정/);
    assert.match(map, new RegExp(`⚠ \\*\\*\\d개 가드가 ${UNJUDGED}입니다\\*\\*`));
    // entity 실재 칸이 통과 표시가 아니라 미판정
    const entityRow = map.split("\n").find((l) => l.includes("`thing`"));
    assert.match(entityRow, new RegExp(UNJUDGED), entityRow);
    assert.doesNotMatch(entityRow.split("|").pop(), /✓/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-004: 면제는 통과가 아니라 '면제 — 사유'로 구분", () => {
  const root = repo({
    config: {
      entitySchemaBackingPolicy: "advisory",
      entitySchemaSources: [{ globs: ["src/**/*.ts"], patterns: ["\\binterface\\s+([A-Za-z0-9_]+)"] }],
      entitySchemaExemptEntities: { thing: "외부 API 자원 — 앱 스키마 밖" },
    },
    specs: { "SPEC-001.md": SPEC("SPEC-001") },
    srcFiles: { "src/x.ts": "export interface other {}\n" },
  });
  try {
    const { map } = gen(root);
    const row = map.split("\n").find((l) => l.includes("`thing`"));
    assert.match(row, /면제 — 외부 API 자원/);
    assert.doesNotMatch(row.split("|").pop(), /^\s*✓/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-005: 맵의 위반 집계가 같은 픽스처의 게이트 위반 수와 일치", () => {
  const root = repo({
    config: {
      entitySchemaBackingPolicy: "advisory",
      entitySchemaSources: [{ globs: ["src/**/*.ts"], patterns: ["\\binterface\\s+([A-Za-z0-9_]+)"] }],
    },
    specs: { "SPEC-001.md": SPEC("SPEC-001", { entities: "ghost_thing", caps: "ghost_thing.create" }) },
    srcFiles: { "src/x.ts": "export interface real_thing {}\n" },
  });
  try {
    const { map } = gen(root);
    assert.match(map, /- 실재 위반 \*\*1건\*\*/);
    const gate = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(gate, /위반 1건/);   // 게이트도 1건 — 맵과 일치
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-006: --check 는 최신이면 exit 0, 드리프트·부재면 exit 1(파일 미변경)", () => {
  const root = repo({ specs: { "SPEC-001.md": SPEC("SPEC-001") } });
  try {
    assert.equal(genCode(root, ["--check"]).code, 1);              // 파일 없음 = 드리프트
    gen(root);                                                      // 생성
    assert.equal(genCode(root, ["--check"]).code, 0);               // 최신
    writeFileSync(join(root, "sdd/specs/SPEC-002.md"), SPEC("SPEC-002", { entities: "other", caps: "other.create" }));
    const drift = genCode(root, ["--check"]);
    assert.equal(drift.code, 1);
    assert.match(drift.out, /드리프트/);
    assert.match(drift.out, /gen-ownership-map\.mjs/);              // 재생성 명령 안내
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("유일성 위반은 소유 스펙을 함께 적어 어느 스펙끼리 겹치는지 보인다", () => {
  const root = repo({
    specs: {
      "SPEC-001.md": SPEC("SPEC-001", { entities: "shared", caps: "shared.create" }),
      "SPEC-002.md": SPEC("SPEC-002", { entities: "shared", caps: "shared.read" }),
    },
  });
  try {
    const { map } = gen(root);
    assert.match(map, /✗ 중복\(SPEC-001\+SPEC-002\)/);
    assert.match(map, /- 유일성 위반 \*\*2건\*\*/);   // 두 스펙 각 행
  } finally { rmSync(root, { recursive: true, force: true }); }
});
