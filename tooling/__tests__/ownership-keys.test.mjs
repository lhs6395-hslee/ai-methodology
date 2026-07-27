// tooling/__tests__/ownership-keys.test.mjs
// @covers SPEC-001/FR-001
// @covers SPEC-001/FR-002
// @covers SPEC-001/FR-003
// @covers SPEC-001/FR-004
// @covers SPEC-001/FR-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSection, normalizeKey, validateKey, resolveCategoryRoles, splitKeys, isPlaceholder, escapeRegExp } from "../ownership-keys.mjs";
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

// ── 카테고리 역할 해석(FR-010) — 선언 우선·이름 폴백 ──

test("resolveCategoryRoles: 선언이 이름을 이긴다(카테고리 이름 무관)", () => {
  // 킷 자신 — 이름 폴백은 전부 실패하지만 선언으로 역할이 확정된다(도그푸딩 공백의 해소 지점)
  assert.deepEqual(
    resolveCategoryRoles(["Modules", "Symbols", "Artifacts"], { Modules: "entity", Symbols: "surface" }),
    { entity: "Modules", surface: "Symbols", capability: null });
  // 개명해도 선언이 있으면 판정 유지(감사 A-1: 개명 한 줄로 hard가 무음 사망하던 자리)
  assert.deepEqual(
    resolveCategoryRoles(["Aggregates", "Routes", "Abilities"],
      { Aggregates: "entity", Routes: "surface", Abilities: "capability" }),
    { entity: "Aggregates", surface: "Routes", capability: "Abilities" });
});

test("resolveCategoryRoles: 선언 없으면 이름 정규식 폴백(하위호환) / 매치 없으면 null", () => {
  assert.deepEqual(resolveCategoryRoles(["Entities", "Surfaces", "Capabilities"], {}),
    { entity: "Entities", surface: "Surfaces", capability: "Capabilities" });
  assert.deepEqual(resolveCategoryRoles(["Modules", "Symbols", "Artifacts"], {}),
    { entity: null, surface: null, capability: null });
  assert.deepEqual(resolveCategoryRoles(["Datasets", "Jobs", "Sinks"], null),
    { entity: null, surface: null, capability: null });
});

test("resolveCategoryRoles: 부분 선언은 나머지만 폴백 / 오타·중복·미실재는 무해", () => {
  // surface만 선언 → entity는 이름 폴백으로 채워진다
  assert.deepEqual(resolveCategoryRoles(["Entities", "Panels"], { Panels: "surface" }),
    { entity: "Entities", surface: "Panels", capability: null });
  // 미지의 역할 문자열은 무시(오타가 판정을 뒤집지 않게)
  assert.equal(resolveCategoryRoles(["Modules"], { Modules: "entty" }).entity, null);
  // 한 역할에 둘 선언 → 선언 순 첫 매치
  assert.equal(resolveCategoryRoles(["A", "B"], { A: "entity", B: "entity" }).entity, "A");
  // ownershipCategories에 없는 카테고리 선언은 무시
  assert.equal(resolveCategoryRoles(["Modules"], { Nope: "entity" }).entity, null);
  // 대소문자 무관 매칭
  assert.equal(resolveCategoryRoles(["Modules"], { modules: "entity" }).entity, "Modules");
});

// ── dedup 입력 신뢰성(감사 #21 C-2·C-3·M-13·유니코드) — 조용한 절단/누락 회귀 방지 ──
// 이 5건은 킷의 **유일한 hard 게이트**인 dedup의 입력이 무음으로 잘리던 결함이다.
// 두 스펙이 같은 키를 소유해도 "✓ 구조적 중복 없음"이 나왔다.

test("parseSection: 카테고리 불릿이 여러 개면 전부 수집(첫 줄만 읽던 절단)", () => {
  const t = "## Ownership\n- **Entities**: alpha\n- **Entities**: shared_dup\n\n## Next\n";
  assert.deepEqual(parseSection(t, "Ownership", ["Entities"]).Entities, ["alpha", "shared_dup"]);
});

test("parseSection: 줄바꿈으로 이어진 키 목록을 이어붙인다", () => {
  const t = "## Ownership\n- **Entities**: alpha, beta,\n  shared_dup, delta\n\n## Next\n";
  assert.deepEqual(parseSection(t, "Ownership", ["Entities"]).Entities,
    ["alpha", "beta", "shared_dup", "delta"]);
  // 마지막 섹션(뒤에 ## 없음)도 온전히 읽는다 — m 플래그의 $ 조기종료 회귀 방지
  assert.deepEqual(parseSection("## Ownership\n- **Entities**: last, one\n", "Ownership", ["Entities"]).Entities,
    ["last", "one"]);
});

test("splitKeys: 괄호 안 쉼표는 구분자가 아니다(쓰레기 키 방지)", () => {
  assert.deepEqual(splitKeys("POST /api/x (SPEC-013), ui:y (SPEC-013, 셸)"),
    ["POST /api/x (SPEC-013)", "ui:y (SPEC-013, 셸)"]);
  assert.deepEqual(splitKeys("orders (belongs-to, weak), users"), ["orders (belongs-to, weak)", "users"]);
});

test("isPlaceholder: 자리표시만 제외하고 정당한 대괄호 키는 보존", () => {
  for (const p of ["—", "-", "[…]", "[TBD]", "[미정]", "  "]) assert.equal(isPlaceholder(p), true, p);
  for (const k of ["[level]/page.tsx", "src/app/[id]/route.ts", "[id]/edit"]) assert.equal(isPlaceholder(k), false, k);
  // 회귀: 과거엔 `[`로 시작하면 전부 폐기해 루트 동적 세그먼트 키가 dedup 대상에서 사라졌다
  const t = "## Ownership\n- **Surfaces**: [level]/page.tsx, src/app/[id]/route.ts, [TBD], —\n\n## X\n";
  assert.deepEqual(parseSection(t, "Ownership", ["Surfaces"]).Surfaces,
    ["[level]/page.tsx", "src/app/[id]/route.ts"]);
});

test("normalizeKey: NFC 정규화로 NFC/NFD 같은 글자를 같은 키로", () => {
  const nfc = "상품", nfd = "상품".normalize("NFD");
  assert.notEqual(nfc.length, nfd.length);                       // 입력은 서로 다른 표현
  assert.equal(normalizeKey("Entities", nfc, cfg), normalizeKey("Entities", nfd, cfg));
});

test("escapeRegExp: 카테고리명의 정규식 메타문자가 크래시를 내지 않는다(Python re.escape 패리티)", () => {
  const t = "## Ownership\n- **C++ Symbols**: a.cpp, b.cpp\n\n## Next\n";
  assert.deepEqual(parseSection(t, "Ownership", ["C++ Symbols"])["C++ Symbols"], ["a.cpp", "b.cpp"]);
  assert.equal(escapeRegExp("Jobs (async)"), "Jobs \\(async\\)");
});
