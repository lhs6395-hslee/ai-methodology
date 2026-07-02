// tooling/__tests__/ownership-keys.test.mjs
// @covers SPEC-001/FR-001
// @covers SPEC-001/FR-002
// @covers SPEC-001/FR-003
// @covers SPEC-001/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSection, normalizeKey, validateKey } from "../ownership-keys.mjs";
import { loadConfig } from "../sdd-config.mjs";

const cfg = { ...loadConfig("/nonexistent"), capabilityVerbs: ["recommend"] };
cfg.__allVerbs = new Set(["create","read","update","delete","list","recommend"]);
const CATS = ["Entities", "Surfaces", "Capabilities"];

test("parseSection: Ownership과 Dependencies를 구분해 읽는다", () => {
  const text = [
    "## Ownership",
    "- **Entities**: recommendation",
    "- **Capabilities**: staff.recommend",
    "## Dependencies",
    "- **Entities**: staff, project",
  ].join("\n");
  const own = parseSection(text, "Ownership", CATS);
  const dep = parseSection(text, "Dependencies", CATS);
  assert.deepEqual(own.Entities, ["recommendation"]);
  assert.deepEqual(dep.Entities, ["staff", "project"]);
  assert.deepEqual(own.Capabilities, ["staff.recommend"]);
});

test("normalizeKey: Surface = 메서드 대문자 + 경로 소문자 + param 표준형 + trailing slash 제거", () => {
  assert.equal(normalizeKey("Surfaces", "post /api/Recommend/:id/", cfg), "POST /api/recommend/{id}");
  // {id} 중괄호 형식
  assert.equal(normalizeKey("Surfaces", "post /api/items/{id}", cfg), "POST /api/items/{id}");
  // <id> 꺽쇠 형식
  assert.equal(normalizeKey("Surfaces", "post /api/items/<id>", cfg), "POST /api/items/{id}");
  // 하이픈 포함 param
  assert.equal(normalizeKey("Surfaces", "get /api/items/:item-id", cfg), "GET /api/items/{item-id}");
});

test("normalizeKey: Capability = 소문자, 점표기 유지", () => {
  assert.equal(normalizeKey("Capabilities", "Staff.Recommend", cfg), "staff.recommend");
});

test("normalizeKey: Entity = 소문자 그대로", () => {
  assert.equal(normalizeKey("Entities", "  Pjt_Projects ", cfg), "pjt_projects");
});

test("validateKey: 미등록 verb는 위반", () => {
  assert.equal(validateKey("Capabilities", "staff.suggest", cfg) !== null, true);
  assert.equal(validateKey("Capabilities", "staff.recommend", cfg), null);
});

test("validateKey: 점 2개 이상이면 위반", () => {
  assert.equal(validateKey("Capabilities", "a.b.c", cfg) !== null, true);
});

test("validateKey: surfaceFormat 'http'(기본) → 파일경로 Surface는 위반", () => {
  assert.equal(validateKey("Surfaces", "src/app/api/chat/route.ts", cfg) !== null, true);
  assert.equal(validateKey("Surfaces", "POST /api/chat", cfg), null);
});

test("validateKey: surfaceFormat 'path' → 파일경로 Surface 허용, 공백 포함은 위반", () => {
  const pathCfg = { ...cfg, surfaceFormat: "path" };
  assert.equal(validateKey("Surfaces", "src/app/api/chat/route.ts", pathCfg), null);
  assert.equal(validateKey("Surfaces", "infra/terraform", pathCfg), null);
  assert.equal(validateKey("Surfaces", "src/app/tools/pjt-management/[id]", pathCfg), null);
  assert.equal(validateKey("Surfaces", "dockerfile", pathCfg), null);
  assert.equal(validateKey("Surfaces", "POST /api/x with space", pathCfg) !== null, true);
});

test("validateKey: surfaceFormat 'any' → Surface 형식 검증 안함", () => {
  const anyCfg = { ...cfg, surfaceFormat: "any" };
  assert.equal(validateKey("Surfaces", "anything at all", anyCfg), null);
});

test("normalizeKey: surfaceFormat 'path' → 소문자 + trailing slash 제거(METHOD 파싱 안함)", () => {
  const pathCfg = { ...cfg, surfaceFormat: "path" };
  assert.equal(normalizeKey("Surfaces", "Src/App/API/route.ts/", pathCfg), "src/app/api/route.ts");
});
