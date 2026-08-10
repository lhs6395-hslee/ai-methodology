// tooling/__tests__/check-ownership.test.mjs
// @covers SPEC-002/FR-002
// @covers SPEC-002/FR-007
// @covers SPEC-002/FR-009
// @covers SPEC-002/FR-010
// @covers SPEC-017/FR-001
// @covers SPEC-017/FR-002
// @covers SPEC-017/FR-003
// @covers SPEC-017/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(specs, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-own-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", capabilityVerbs: ["recommend"],
  }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Dependencies의 키는 dedup 대상이 아니다(거짓양성 해소)", () => {
  // A naive impl that fed ## Dependencies into the dedup map would see SPEC-001
  // "owning" staff (via its Dependencies) AND SPEC-002 owning it → false conflict (exit 1).
  // Correct impl excludes Dependencies → only SPEC-002 owns staff → exit 0.
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n## Dependencies\n- **Entities**: staff\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: staff\n"; // staff를 소유 → A는 참조라 충돌 아님
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 0, r.out);
});

test("같은 Ownership 키를 2 spec이 소유하면 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: Recommendation\n"; // 정규화 후 같은 키
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /recommendation/);
});

test("미등록 verb는 --strict에서 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Capabilities**: staff.suggest\n";
  assert.equal(run({ "SPEC-001.md": A }).code, 0);            // 기본 warn
  assert.equal(run({ "SPEC-001.md": A }, ["--strict"]).code, 1); // strict 차단
});

test("Surface 정규화 후 충돌: 다른 param 문법·메서드 케이스가 같은 키로 수렴", () => {
  const A = "# SPEC-001\n## Ownership\n- **Surfaces**: POST /api/items/:id\n";
  const B = "# SPEC-002\n## Ownership\n- **Surfaces**: post /api/items/{id}/\n"; // normalizes to same key
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
});

// ── P3(a): entityRegistry — @covers 태그는 파일 헤더 ──

function runWithConfig(specs, config, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-own-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...config }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("entityRegistry: 미등록 entity 소유 → exit 1 / 등록·사유 구비 → 통과(정규화 비교)", () => {
  const A = "# SPEC-001\nrecommendation 얘기.\n## Ownership\n- **Entities**: Recommendation\n"; // 대문자 → 정규화 후 비교
  const unregistered = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: { staff: "직원 aggregate" } });
  assert.equal(unregistered.code, 1, unregistered.out);
  assert.match(unregistered.out, /미등록 entity "recommendation" \(SPEC-001\)/);
  const ok = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: { recommendation: "추천 aggregate — 후보 산출의 SSOT" } });
  assert.equal(ok.code, 0, ok.out);
});

test("entityRegistry: 빈 사유 → exit 1 / 소유 spec 없는 등록 키 → ⚠ warn만 / 빈 레지스트리 → 비활성", () => {
  const A = "# SPEC-001\nrecommendation 얘기.\n## Ownership\n- **Entities**: recommendation\n";
  const emptyRationale = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: { recommendation: " " } });
  assert.equal(emptyRationale.code, 1, emptyRationale.out);
  assert.match(emptyRationale.out, /도입 사유 필요\(빈 값 불가\)/);
  const stale = runWithConfig({ "SPEC-001.md": A },
    { entityRegistry: { recommendation: "추천", ghost: "선등록" } });
  assert.equal(stale.code, 0, stale.out);
  assert.match(stale.out, /⚠ entityRegistry의 "ghost"를 소유한 spec 없음/);
  const off = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: {} });
  assert.equal(off.code, 0, off.out);
  assert.doesNotMatch(off.out, /레지스트리/);
});

// ── SPEC-017: Entity 관계(Dependencies.Entities의 "Name (type)" 구조화 표기) ──

test("관계: 대상 Entity 실재 + 소유 spec 해석 → 통과, 존재하지 않으면 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: investigation_run\n## Dependencies\n- **Entities**: investigation_finding (has-many)\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: investigation_finding\n";
  const ok = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(ok.code, 0, ok.out);

  const noTarget = run({ "SPEC-001.md": A }); // SPEC-002 없음 → investigation_finding 실재 X
  assert.equal(noTarget.code, 1, noTarget.out);
  assert.match(noTarget.out, /관계 대상 Entity "investigation_finding"/);
});

test("관계: 순환 참조(A→B→A)는 exit 0 유지 + ⚠ advisory로만 표시", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: a_thing\n## Dependencies\n- **Entities**: b_thing (depends-on)\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: b_thing\n## Dependencies\n- **Entities**: a_thing (depends-on)\n";
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /⚠ 관계 순환 참조: SPEC-001 → SPEC-002 → SPEC-001/);
});

test("관계: 괄호 없는 레거시 참조는 그대로 무관(하위호환) — 대상 없어도 exit 0", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: a_thing\n## Dependencies\n- **Entities**: nonexistent_legacy_ref\n";
  const r = run({ "SPEC-001.md": A });
  assert.equal(r.code, 0, r.out);
});

test("관계: relationTypes 등록 시 미등록 type은 exit 1, 등록·빈 목록(무제한)은 통과", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: a_thing\n## Dependencies\n- **Entities**: b_thing (has-many)\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: b_thing\n";
  const restricted = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { relationTypes: ["belongs-to", "references"] });
  assert.equal(restricted.code, 1, restricted.out);
  assert.match(restricted.out, /미등록 관계 종류 "has-many"/);
  const registered = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { relationTypes: ["has-many"] });
  assert.equal(registered.code, 0, registered.out);
  const unrestricted = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { relationTypes: [] });
  assert.equal(unrestricted.code, 0, unrestricted.out);
});

// ── 정책이 선언됐는데 판정이 성립하지 않으면(inert) 반드시 사유를 낸다 (SPEC-002 FR-010, 감사 A-1/A-3) ──
// 재현: 카테고리를 Entities→Aggregates로 개명하면 capabilityOwnershipPolicy·entitySchemaBackingPolicy가
// hard여도 완전 no-op이 되면서 유령 entity가 "✓ 구조적 중복 없음"으로 통과(exit 0)했다.

const RENAMED = ["Aggregates", "Surfaces", "Capabilities"];
const GHOST = "# SPEC-001\nwizard 얘기.\n## Ownership\n- **Aggregates**: wizard\n- **Capabilities**: wizard.create\n";

test("inert 고지: 카테고리 개명 + capability 귀속 hard → ✗ 사유 출력 + exit 1(거짓 안전 차단)", () => {
  const r = runWithConfig({ "SPEC-001.md": GHOST },
    { ownershipCategories: RENAMED, capabilityOwnershipPolicy: "hard" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ Capability 귀속\(capabilityOwnershipPolicy=hard\): 판정 불가\(inert\)/);
  assert.match(r.out, /entity 역할 카테고리 미해석/);
  assert.match(r.out, /hard 선언 \+ 무판정/);
});

test("inert 고지: advisory는 사유만 고지(플레인 · 라인, ⚠ 없음) + exit 0 — 소급 범람 금지", () => {
  const r = runWithConfig({ "SPEC-001.md": GHOST },
    { ownershipCategories: RENAMED, capabilityOwnershipPolicy: "advisory" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /· Capability 귀속\(capabilityOwnershipPolicy=advisory\): 판정 불가\(inert\)/);
  assert.doesNotMatch(r.out, /⚠ Capability 귀속/); // 하네스 flagged 판정을 오염시키지 않는다(기본값 프로젝트 무영향)
});

test("inert 고지: 정책을 off로 명시하면 조용히 통과(문서화된 탈출구)", () => {
  const r = runWithConfig({ "SPEC-001.md": GHOST },
    { ownershipCategories: RENAMED, capabilityOwnershipPolicy: "off" });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /Capability 귀속/);
});

test("inert 고지: 스키마 백킹 hard + entitySchemaSources 비어있음 → ✗ 사유 출력 + exit 1 (A-3)", () => {
  const A = "# SPEC-001\nwizard 얘기.\n## Ownership\n- **Entities**: wizard\n";
  const r = runWithConfig({ "SPEC-001.md": A },
    { capabilityOwnershipPolicy: "off", entitySchemaBackingPolicy: "hard", entitySchemaSources: [] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ Entity 스키마 백킹\(entitySchemaBackingPolicy=hard\): 판정 불가\(inert\)/);
  assert.match(r.out, /entitySchemaSources/);
});

test("inert 고지: 백킹 기본값(off)·정상 활성 프로젝트는 새 라인이 없다(하위호환)", () => {
  const A = "# SPEC-001\nrecommendation 얘기.\n## Ownership\n- **Entities**: recommendation\n- **Capabilities**: recommendation.create\n";
  const dflt = runWithConfig({ "SPEC-001.md": A }, {});
  assert.equal(dflt.code, 0, dflt.out);
  assert.doesNotMatch(dflt.out, /판정 불가\(inert\)/);
});

// ── 구조 문법 잔여 3종 (SPEC-002 FR-011: G1·G2·G3) ──

test("G1 ownershipRequiredPolicy: 미선언 스펙 → hard exit 1 / advisory ⚠ exit 0", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: alpha\n";
  const B = "# SPEC-002\n(Ownership 블록 없음)\n"; // 미선언 = dedup 사각
  const hard = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { ownershipRequiredPolicy: "hard" });
  assert.equal(hard.code, 1, hard.out);
  assert.match(hard.out, /Ownership 블록 없음/);
  const adv = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { ownershipRequiredPolicy: "advisory" });
  assert.equal(adv.code, 0, adv.out); // 소급 범람 금지
});

test("G2 crossCategoryDedupPolicy: 같은 키가 2 카테고리에 소유 → hard exit 1", () => {
  // surfaceFormat:any 로 'order'를 surface 키로도 허용 → entity 'order'와 카테고리 간 충돌.
  const A = "# SPEC-001\n## Ownership\n- **Entities**: order\n";
  const B = "# SPEC-002\n## Ownership\n- **Surfaces**: order\n";
  const cfg = { surfaceFormat: "any", crossCategoryDedupPolicy: "hard" };
  const hard = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, cfg);
  assert.equal(hard.code, 1, hard.out);
  assert.match(hard.out, /카테고리 간 동일 키/);
  assert.match(hard.out, /order/);
  const adv = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { ...cfg, crossCategoryDedupPolicy: "advisory" });
  assert.equal(adv.code, 0, adv.out);
  assert.match(adv.out, /⚠ 카테고리 간 동일 키/);
});

test("G3 filesOverlapPolicy: 2 스펙이 같은 실파일 소유 → hard exit 1", () => {
  // 두 스펙의 Files glob이 실재 파일 SPEC-001.md를 함께 매치 → 겹침.
  const A = "# SPEC-001\n## Ownership\n- **Entities**: alpha\n- **Files**: sdd/specs/SPEC-001.md\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: beta\n- **Files**: sdd/specs/SPEC-001.md\n";
  const hard = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { filesOverlapPolicy: "hard" });
  assert.equal(hard.code, 1, hard.out);
  assert.match(hard.out, /Files 겹침/);
  assert.match(hard.out, /SPEC-001\.md/);
  const adv = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B }, { filesOverlapPolicy: "advisory" });
  assert.equal(adv.code, 0, adv.out);
});

test("G1·G2·G3 off → 검출 안 함(하위호환)", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: order\n- **Files**: sdd/specs/SPEC-001.md\n";
  const B = "# SPEC-002\n(Ownership 없음)\n";
  const r = runWithConfig({ "SPEC-001.md": A, "SPEC-002.md": B },
    { ownershipRequiredPolicy: "off", crossCategoryDedupPolicy: "off", filesOverlapPolicy: "off" });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /카테고리 간 동일 키|Files 겹침/);
});

// ── 지원 계층 출구(SPEC-024 확장, 제보 ④) ──────────────────────────────────
// aggregate 없는 부가 계층은 세 hard 규칙이 맞물려 **출구가 없었다**: 캡 초과라 분할해야 하는데
// 분리 스펙은 entity가 없어 capability를 소유할 수 없고, 그러면 Ownership 키 0이라 이 게이트가 막았다.
// @covers SPEC-024/FR-004
function runCfg(files, config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-sup-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const SUP_MAIN = "# S\n**Spec**: `SPEC-001`\n## Ownership\n- **Entities**: ticket\n";
const SUP_FILES = "# K\n**Spec**: `SPEC-002`\n## Ownership\n- **Entities**: —\n- **Files**: src/knowledge.py\n";

test("등록 없이 Ownership 키 0이면 여전히 막힌다 — 출구는 선언한 자에게만 열린다", () => {
  const r = runCfg({ "sdd/specs/SPEC-001.md": SUP_MAIN, "sdd/specs/SPEC-002.md": SUP_FILES, "src/knowledge.py": "x\n" },
    { ownershipRequiredPolicy: "hard" });
  assert.equal(r.code, 1);
  assert.match(r.out, /미선언 1건: SPEC-002/);
});

test("지원 계층 등록 + Files 선언이면 충족한다 — Files는 dedup 사각이 아니다(G3가 판정)", () => {
  const r = runCfg({ "sdd/specs/SPEC-001.md": SUP_MAIN, "sdd/specs/SPEC-002.md": SUP_FILES, "src/knowledge.py": "x\n" },
    { ownershipRequiredPolicy: "hard", supportLayerSpecs: { "SPEC-002": "무상태 문자열만 반환하는 근거 주입 계층 — aggregate가 없다" } });
  assert.equal(r.code, 0, r.out);
  // 면제는 조용히 "완료"가 되지 않는다 — 매 실행 표면화한다.
  assert.match(r.out, /지원 계층 SPEC-002: Ownership 키 0이지만 Files 선언으로 충족/);
});

test("등록만 하고 Files도 없으면 막힌다 — 등록은 백지수표가 아니다", () => {
  const r = runCfg({ "sdd/specs/SPEC-001.md": SUP_MAIN, "sdd/specs/SPEC-002.md": "# K\n**Spec**: `SPEC-002`\n## Ownership\n- **Entities**: —\n" },
    { ownershipRequiredPolicy: "hard", supportLayerSpecs: { "SPEC-002": "사유 있음" } });
  assert.equal(r.code, 1);
  assert.match(r.out, /미선언 1건: SPEC-002/);
});
