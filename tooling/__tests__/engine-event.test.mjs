// tooling/__tests__/engine-event.test.mjs — Engines & Events (SPEC-030)
// 순수 엔진은 코드-모듈 SSOT에 실재해야 하고, 이벤트는 발신 entity에 귀속(entity.event-name)되고
// 이벤트 카탈로그에 실재해야 한다 — 전수성 구멍(유령 entity·job: Surface 개명)을 봉합.
// @covers SPEC-030/FR-001
// @covers SPEC-030/FR-002
// @covers SPEC-030/FR-003
// @covers SPEC-030/FR-004
// @covers SPEC-030/FR-005
// @covers SPEC-030/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { roleActive, roleInertReasons, realityFindings, splitEventKey, eventAttributionFindings } from "../engine-event-lib.mjs";

const GATE = fileURLToPath(new URL("../check-engine-event.mjs", import.meta.url));

// ── 순수 코어 ──

test("roleActive: 정책 on + 소스 선언 + 역할 카테고리, 셋 다 있어야 활성", () => {
  const src = [{ globs: ["s.js"], patterns: ["x"] }];
  assert.equal(roleActive("hard", src, "Engines"), true);
  assert.equal(roleActive("off", src, "Engines"), false);
  assert.equal(roleActive("advisory", [], "Engines"), false);
  assert.equal(roleActive("advisory", src, null), false);
});

test("roleInertReasons: off면 빈 배열, 아니면 누락 요소를 사유로", () => {
  assert.deepEqual(roleInertReasons("off", [], null, "enginesSources", "engine"), []);
  const r = roleInertReasons("hard", [], null, "enginesSources", "engine");
  assert.equal(r.length, 2);
  assert.match(r[0], /enginesSources 비어 있음/);
  assert.match(r[1], /engine 역할 카테고리 미해석/);
});

test("realityFindings: SSOT 집합·면제에 없는 소유 키만 위반(정규화)", () => {
  const set = new Set(["pricerules", "taxengine"]);
  const exempt = new Set(["external_scorer"]);
  const owned = [
    { specId: "SPEC-001", keys: ["priceRules", "taxEngine"] }, // 실재 → 0
    { specId: "SPEC-002", keys: ["nonexist"] },                // 유령 → 위반
    { specId: "SPEC-003", keys: ["external_scorer"] },         // 면제 → 통과
  ];
  assert.deepEqual(realityFindings(owned, set, exempt), [{ specId: "SPEC-002", key: "nonexist" }]);
});

test("splitEventKey: 첫 점 기준 entity.name, 점 없으면 entity=null", () => {
  assert.deepEqual(splitEventKey("order.created"), { entity: "order", name: "created" });
  assert.deepEqual(splitEventKey("order.line.added"), { entity: "order", name: "line.added" });
  assert.deepEqual(splitEventKey("orphan"), { entity: null, name: "orphan" });
});

test("eventAttributionFindings: 발신 entity를 스펙이 소유해야 통과 — 미소유·점없음은 위반", () => {
  const events = [
    { specId: "SPEC-001", keys: ["order.created"] },   // order 소유 → 통과
    { specId: "SPEC-002", keys: ["ghost.thing"] },     // ghost 미소유 → 위반
    { specId: "SPEC-003", keys: ["orphan"] },          // 점 없음 → 위반(entity=null)
  ];
  const ents = { "SPEC-001": ["order"], "SPEC-002": ["invoice"], "SPEC-003": ["thing"] };
  assert.deepEqual(eventAttributionFindings(events, ents), [
    { specId: "SPEC-002", key: "ghost.thing", entity: "ghost" },
    { specId: "SPEC-003", key: "orphan", entity: null },
  ]);
});

// ── 게이트 e2e ──

function fixture(cfg, specs, src = 'export function priceRules(){}\nemit("order.created");\n') {
  const root = mkdtempSync(join(tmpdir(), "sdd-ee-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "logic.js"), src);
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify(cfg));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

const BASE_CFG = {
  specDir: "sdd/specs",
  ownershipCategories: ["Entities", "Engines", "Events"],
  ownershipCategoryRoles: { Entities: "entity", Engines: "engine", Events: "event" },
  enginesSources: [{ globs: ["src/*.js"], patterns: ["export function ([a-zA-Z0-9_]+)"] }],
  eventCatalogSources: [{ globs: ["src/*.js"], patterns: ['emit\\("([a-zA-Z0-9_.]+)"'] }],
};

test("게이트: 두 정책 off → 판정 안 함 exit 0", () => {
  const root = fixture(BASE_CFG, { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Engines**: nonexist\n" });
  try { const r = run(root); assert.equal(r.code, 0, r.out); assert.match(r.out, /모두 off/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 실재 엔진+귀속 이벤트 → hard PASS / 유령 엔진·귀속없는 이벤트 → hard exit 1", () => {
  const ok = fixture({ ...BASE_CFG, engineRealityPolicy: "hard", eventAttributionPolicy: "hard" },
    { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: order\n- **Engines**: priceRules\n- **Events**: order.created\n" });
  try { assert.equal(run(ok).code, 0, run(ok).out); } finally { rmSync(ok, { recursive: true, force: true }); }

  const bad = fixture({ ...BASE_CFG, engineRealityPolicy: "hard", eventAttributionPolicy: "hard" },
    { "SPEC-002.md": "**Spec**: `SPEC-002`\n## Ownership\n- **Engines**: nonexist\n- **Events**: ghost.thing\n" });
  try {
    const r = run(bad);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /engine "nonexist"/);
    assert.match(r.out, /event "ghost.thing"/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});

test("게이트: advisory는 위반 있어도 exit 0(경고)", () => {
  const root = fixture({ ...BASE_CFG, engineRealityPolicy: "advisory" },
    { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Engines**: nonexist\n" });
  try { const r = run(root); assert.equal(r.code, 0, r.out); assert.match(r.out, /⚠/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: hard인데 소스 비어 inert → 거짓 안전 차단 exit 1", () => {
  const root = fixture({ ...BASE_CFG, enginesSources: [], engineRealityPolicy: "hard" },
    { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Engines**: x\n" });
  try { const r = run(root); assert.equal(r.code, 1, r.out); assert.match(r.out, /판정 불가|무판정/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 빈 면제 사유 → exit 1", () => {
  const root = fixture({ ...BASE_CFG, engineRealityPolicy: "advisory", engineExemptKeys: { nonexist: "" } },
    { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Engines**: nonexist\n" });
  try { const r = run(root); assert.equal(r.code, 1, r.out); assert.match(r.out, /빈 사유/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: enum 밖 정책 값 → exit 1", () => {
  const root = fixture({ ...BASE_CFG, engineRealityPolicy: "strict" },
    { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Engines**: x\n" });
  try { const r = run(root); assert.equal(r.code, 1, r.out); assert.match(r.out, /engineRealityPolicy 값 위반/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
