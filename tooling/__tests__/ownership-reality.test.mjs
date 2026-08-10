// tooling/__tests__/ownership-reality.test.mjs
// 소유 키 실재 판정의 두 문법(SPEC-029) — 모듈 문법(스펙별 슬러그)·심볼 문법(소스 루트 실재).
// @covers SPEC-029/FR-001
// @covers SPEC-029/FR-002
// @covers SPEC-029/FR-003
// @covers SPEC-029/FR-004
// @covers SPEC-029/FR-005
// @covers SPEC-029/FR-006
// @covers SPEC-029/FR-007
// @covers SPEC-029/FR-008
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  specSlug, specSlugSourceDeclared, symbolRealityActive,
  symbolRealityInertReasons, symbolRealityFindings, isFileLikeSurface, symbolCandidates,
} from "../ownership-reality-lib.mjs";
import { schemaBackingFindings } from "../schema-backing-lib.mjs";
import { importClosure } from "../import-wiring-lib.mjs";

// 픽스처가 복사할 모듈을 읽는 주입기. 손목록은 반드시 드리프트한다 — 실측: 새 모듈
// 하나(check-outcome-lib.mjs)를 추가하자 손목록을 든 픽스처들이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다(소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");


// 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
const LIBS = importClosure(["check-ownership.mjs"], KIT_SRC);

function repo({ config = {}, specs = {}, srcFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-real-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", scanDirs: ["src"],
    ownershipCategories: ["Modules", "Symbols"],
    ownershipCategoryRoles: { Modules: "entity", Symbols: "surface" },
    ...config,
  }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd/specs", name), body);
  for (const [rel, body] of Object.entries(srcFiles)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const SPEC = (id, { mod = "thing", sym = "thing.mjs" } = {}) =>
  `# ${id}\n**Module**: \`m\`  **Spec**: \`${id}\`  **Status**: Active\n\n` +
  `## Functional Requirements (EARS)\n- **FR-001** (ubiquitous): THE **${mod}** (E) module SHALL expose **${sym}** (S).\n\n` +
  `## Ownership\n- **Modules**: ${mod}\n- **Symbols**: ${sym}\n- **Files**: src/x.ts\n\n` +
  `## Success Criteria\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n`;

function gate(root) {
  try {
    return { code: 0, out: execFileSync("node", [join(root, "scripts/check-ownership.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("FR-002: 슬러그는 번호 접두어 뒤 — 레터 서픽스·접두어 없음도 처리", () => {
  assert.equal(specSlug("SPEC-010-smoke-scan.md"), "smoke-scan");
  assert.equal(specSlug("INFRA-001a-aws-platform.md"), "aws-platform");
  assert.equal(specSlug("/a/b/SPEC-029-ownership-reality.md"), "ownership-reality");
  assert.equal(specSlug("README.md"), "readme");             // 접두어 없음 → basename
  assert.equal(specSlug("SPEC-001-Mixed-Case.md"), "mixed-case");
});

test("FR-001: 모듈 문법은 스펙별 대조 — 슬러그 뒤바뀜은 유일성이 성립해도 위반", () => {
  assert.ok(specSlugSourceDeclared([{ kind: "spec-slug" }]));
  assert.ok(!specSlugSourceDeclared([{ globs: ["a"], patterns: ["b"] }]));
  const owned = [{ specId: "SPEC-010", entities: ["retag"] }, { specId: "SPEC-011", entities: ["smoke-scan"] }];
  const slugs = { "SPEC-010": "smoke-scan", "SPEC-011": "retag" };   // 서로 뒤바뀜
  const f = schemaBackingFindings(owned, new Set(), new Set(), slugs);
  assert.equal(f.length, 2, "전역 집합 대조라면 0건이 됐을 것");
  // 제자리면 통과
  const ok = schemaBackingFindings(
    [{ specId: "SPEC-010", entities: ["smoke-scan"] }], new Set(), new Set(), slugs);
  assert.equal(ok.length, 0);
});

test("slugBySpec 미전달이면 종전 동작과 동일(하위호환)", () => {
  const owned = [{ specId: "SPEC-001", entities: ["ghost"] }];
  assert.equal(schemaBackingFindings(owned, new Set(), new Set()).length, 1);
  assert.equal(schemaBackingFindings(owned, new Set(["ghost"]), new Set()).length, 0);
});

test("FR-004: 파일형 표면만 문법 대상 — HTTP·이벤트·잡·경로는 제외", () => {
  assert.ok(isFileLikeSurface("lib.mjs"));
  assert.ok(isFileLikeSurface("go-gate"));
  assert.ok(!isFileLikeSurface("POST /api/x"));
  assert.ok(!isFileLikeSurface("event:order.created"));
  assert.ok(!isFileLikeSurface("job:nightly"));
  assert.ok(!isFileLikeSurface("/users/{name}"));
  assert.ok(!isFileLikeSurface("—"));
});

test("FR-005: 활성 조건 3개 — 하나라도 없으면 inert이고 사유를 낸다", () => {
  const roles = { entity: "Modules", surface: "Symbols", capability: null };
  assert.ok(symbolRealityActive("hard", ["tooling"], roles));
  assert.ok(!symbolRealityActive("off", ["tooling"], roles));
  assert.ok(!symbolRealityActive("hard", [], roles));
  assert.ok(!symbolRealityActive("hard", ["tooling"], { surface: null }));
  assert.deepEqual(symbolRealityInertReasons("off", [], {}), []);      // off는 침묵
  const why = symbolRealityInertReasons("hard", [], { surface: null });
  assert.equal(why.length, 2);
  assert.match(why.join(" "), /ownershipSourceRoots/);
  assert.match(why.join(" "), /surface 역할 카테고리/);
});

test("symbolRealityFindings: 실재 집합에 없는 키만 위반 — 플레이스홀더는 건너뜀", () => {
  const real = new Set(["lib.mjs", "go-gate"]);
  const f = symbolRealityFindings([{ specId: "S1", surfaces: ["lib.mjs", "ghost.mjs", "—", "go-gate"] }], real);
  assert.deepEqual(f, [{ specId: "S1", symbol: "ghost.mjs" }]);
});

test("게이트 FR-003: advisory는 ⚠ exit 0 / hard는 ✗ exit 1 / 실재하면 통과", () => {
  const mk = (policy) => repo({
    config: { symbolRealityPolicy: policy, ownershipSourceRoots: ["lib"] },
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001", { sym: "ghost.mjs" }) },
    srcFiles: { "lib/real.mjs": "//\n" },
  });
  const a = mk("advisory"); const b = mk("hard");
  try {
    const ra = gate(a);
    assert.equal(ra.code, 0);
    assert.match(ra.out, /심볼 실재.*위반 1건/s);
    assert.match(ra.out, /ghost\.mjs/);
    const rb = gate(b);
    assert.equal(rb.code, 1);
    assert.match(rb.out, /symbolRealityPolicy=hard/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test("게이트 FR-003: 하위 디렉토리의 파일·디렉토리도 실재로 인정(재귀)", () => {
  const root = repo({
    config: { symbolRealityPolicy: "hard", ownershipSourceRoots: ["lib"] },
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001", { sym: "deep.mjs" }) },
    srcFiles: { "lib/nested/deep.mjs": "//\n" },
  });
  try { assert.equal(gate(root).code, 0); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 FR-004: HTTP 표면 레포는 심볼 문법이 오발동하지 않는다", () => {
  const spec = `# SPEC-001\n**Module**: \`m\`  **Spec**: \`SPEC-001\`  **Status**: Active\n\n` +
    `## Functional Requirements (EARS)\n- **FR-001** (event): WHEN a request hits **POST /api/x** (S), THE **thing** (E) SHALL respond.\n\n` +
    `## Ownership\n- **Modules**: thing\n- **Symbols**: POST /api/x\n- **Files**: src/x.ts\n\n` +
    `## Success Criteria\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n`;
  const root = repo({
    config: { symbolRealityPolicy: "hard", ownershipSourceRoots: ["lib"], surfaceFormat: "any" },
    specs: { "SPEC-001-thing.md": spec },
    srcFiles: { "lib/x.mjs": "//\n" },
  });
  try {
    const r = gate(root);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /POST \/api\/x.*실재하지 않음/s);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 FR-005: hard인데 소스 루트 미선언 → inert 사유 + exit 1(거짓 안전 차단)", () => {
  const root = repo({
    config: { symbolRealityPolicy: "hard" },                 // ownershipSourceRoots 없음
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001") },
  });
  try {
    const r = gate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /판정 불가\(inert\)/);
    assert.match(r.out, /ownershipSourceRoots/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 FR-007: enum 밖 값 → exit 1", () => {
  const root = repo({
    config: { symbolRealityPolicy: "strict" },
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001") },
  });
  try {
    const r = gate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /symbolRealityPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("SC-004: 정책 미선언(off) 레포는 심볼 문법 관련 출력이 전혀 없다", () => {
  const root = repo({
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001", { sym: "ghost.mjs" }) },
  });
  try {
    const r = gate(root);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /심볼 실재/);
    assert.doesNotMatch(r.out, /symbolRealityPolicy/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-006: 맵의 surface 실재 칸이 게이트와 같은 판정을 낸다", () => {
  const root = repo({
    config: { symbolRealityPolicy: "advisory", ownershipSourceRoots: ["lib"], frKeyAnchorPolicy: "advisory" },
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001", { sym: "ghost.mjs" }) },
    srcFiles: { "lib/real.mjs": "//\n" },
  });
  try {
    cpSync(join(process.cwd(), "tooling/gen-ownership-map.mjs"), join(root, "scripts/gen-ownership-map.mjs"));
    execFileSync("node", [join(process.cwd(), "tooling/gen-ownership-map.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const map = readFileSync(join(root, "sdd/OWNERSHIP_MAP.md"), "utf8");
    const row = map.split("\n").find((l) => l.includes("`ghost.mjs`"));
    assert.ok(row, "ghost.mjs 행이 있어야 한다");
    assert.match(row, /✗ 소스 루트에 없음/);
    assert.doesNotMatch(map, /미판정 \*\*[1-9]/);   // surface 가드가 살아 있으므로
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FR-003: 점 표기 모듈 경로도 실재로 해석 — 결정적 변환(경로·basename)", () => {
  assert.deepEqual(symbolCandidates("lib.mjs"), ["lib.mjs", "lib/mjs"]);
  assert.deepEqual(symbolCandidates("src.cli.chat"), ["src.cli.chat", "src/cli/chat"]);
  // 마지막 조각(`chat`)은 후보가 아니다 — 아무 위치의 chat이나 매치해 틀린 키를 통과시킨다
  assert.ok(!symbolCandidates("src.cli.chat").includes("chat"));
  assert.deepEqual(symbolCandidates("go-gate"), ["go-gate"]);        // 점 없음 → 변환 없음
  assert.deepEqual(symbolCandidates("a/b.py"), ["a/b.py"]);          // 이미 경로 → 변환 없음
  // 확장자 없는 상대경로가 realSet에 있으면 점 표기가 매치한다
  const real = new Set(["src/cli/chat", "chat.py", "lib.mjs"]);
  assert.deepEqual(symbolRealityFindings([{ specId: "S1", surfaces: ["src.cli.chat"] }], real), []);
  assert.deepEqual(symbolRealityFindings([{ specId: "S1", surfaces: ["src.cli.ghost"] }], real),
    [{ specId: "S1", symbol: "src.cli.ghost" }]);
});

test("게이트 FR-003: 점 표기 키(소비 프로젝트 실측 형태)가 통과하고 유령은 차단", () => {
  const mk = (sym) => repo({
    config: { symbolRealityPolicy: "hard", ownershipSourceRoots: ["src"], surfaceFormat: "any" },
    specs: { "SPEC-001-thing.md": SPEC("SPEC-001", { sym }) },
    srcFiles: { "src/cli/finops_ticket_chat.py": "#\n" },
  });
  const ok = mk("src.cli.finops_ticket_chat");
  const bad = mk("src.cli.ghost_module");
  try {
    assert.equal(gate(ok).code, 0, "점 표기 실재 키는 통과해야 한다");
    const r = gate(bad);
    assert.equal(r.code, 1);
    assert.match(r.out, /src\.cli\.ghost_module/);
  } finally { rmSync(ok, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});
