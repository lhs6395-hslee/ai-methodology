// tooling/__tests__/capability-ownership.test.mjs — Capability 귀속 (SPEC-024)
// 스펙 경계는 entity 기준: capability x.verb는 entity x를 소유한 스펙만.
// @covers SPEC-024/FR-001
// @covers SPEC-024/FR-002
// @covers SPEC-024/FR-003
// @covers SPEC-024/FR-004
// @covers SPEC-024/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCategoryRoles } from "../ownership-keys.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityCheckActive, capabilityInertReasons, capabilityOwnershipFindings } from "../capability-ownership-lib.mjs";
import { importClosure } from "../import-wiring-lib.mjs";

// 픽스처가 복사할 모듈을 읽는 주입기. 손목록은 반드시 드리프트한다 — 실측: 새 모듈
// 하나(check-outcome-lib.mjs)를 추가하자 손목록을 든 픽스처 5곳이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다(소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");


const GATE = fileURLToPath(new URL("../check-ownership.mjs", import.meta.url));

// ── 순수 코어 ──

// 역할 해석 헬퍼 — 게이트와 같은 파생을 테스트도 쓴다(선언 우선 → 이름 폴백, SPEC-001 FR-010).
const R = (cats, roles) => resolveCategoryRoles(cats, roles);


test("capabilityCheckActive: entity·capability 카테고리 둘 다 있어야 활성(비-웹 무영향)", () => {
  assert.equal(capabilityCheckActive(R(["Entities", "Surfaces", "Capabilities"])), true);
  assert.equal(capabilityCheckActive(R(["Modules", "Symbols", "Artifacts"])), false); // 킷 자신(선언 없음)
  // 역할 선언(SPEC-001 FR-010)으로 이름과 무관하게 활성 — 이름 추측을 없앤 자리
  assert.equal(capabilityCheckActive(R(["Modules", "Symbols", "Deeds"], { Modules: "entity", Deeds: "capability" })), true);
  assert.equal(capabilityCheckActive(R(["Datasets", "Jobs", "Sinks"])), false);        // 파이프라인
  assert.equal(capabilityCheckActive(R(["Entities", "Surfaces"])), false);              // capability 없음
});

test("capabilityInertReasons: off는 침묵(의도된 비활성) / 정책 on + 카테고리 불일치는 사유 반환", () => {
  // 명시적 off = 문서화된 탈출구 → 조용히 통과(사유 없음)
  assert.deepEqual(capabilityInertReasons("off", R(["Modules", "Symbols", "Artifacts"])), []);
  // 판정 성립 → 사유 없음
  assert.deepEqual(capabilityInertReasons("hard", R(["Entities", "Surfaces", "Capabilities"])), []);
  // A-1 재현: Entities→Aggregates 개명만으로 hard 정책이 완전 no-op이 되던 자리 — 이제 사유가 남는다
  const renamed = capabilityInertReasons("hard", R(["Aggregates", "Surfaces", "Capabilities"]));
  assert.equal(renamed.length, 1);
  assert.match(renamed[0], /entity 역할 카테고리 미해석/);
  // 카테고리 둘 다 없으면 사유 2건(선언 순: entity → capability)
  const both = capabilityInertReasons("advisory", R(["Modules", "Symbols", "Artifacts"]));
  assert.equal(both.length, 2);
  assert.match(both[0], /entity 역할/);
  assert.match(both[1], /capability 역할/);
});

test("findings: 소유 entity 위 capability만 통과 — entity 0개(기술 계층 스펙)·남의 entity 모두 위반", () => {
  // budget-engine 실측 재현: entity 0개 + capability 4개 → 전부 위반
  const engine = capabilityOwnershipFindings([], ["pjt_projects.compute", "budget.aggregate", "budget.analyze", "feeitem.aggregate"]);
  assert.equal(engine.length, 4);
  assert.deepEqual(engine[0], { capability: "pjt_projects.compute", entity: "pjt_projects" });
  // 올바른 형태: entity 소유 + 그 위의 capability(verb 달라도 같은 스펙) → 위반 0
  assert.deepEqual(capabilityOwnershipFindings(["pjt_projects"], ["pjt_projects.compute", "pjt_projects.create"]), []);
  // 혼합: 소유분 통과·비소유분만 위반, 정규화(대소문자·트림) 대조
  const mixed = capabilityOwnershipFindings([" PJT_Projects "], ["pjt_projects.read", "budget.aggregate"]);
  assert.deepEqual(mixed, [{ capability: "budget.aggregate", entity: "budget" }]);
  // 점 없는 형식 위반은 validateKey 담당 — 여기선 스킵(이중 보고 금지)
  assert.deepEqual(capabilityOwnershipFindings([], ["notacapability"]), []);
});

// ── 게이트 e2e (capabilityOwnershipPolicy off|advisory|hard) ──

function fixture(policy, ownership) {
  const root = mkdtempSync(join(tmpdir(), "sdd-capown-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", capabilityVerbs: ["compute", "aggregate"],
    ...(policy === undefined ? {} : { capabilityOwnershipPolicy: policy }),
  }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), `# S\n**Spec**: \`SPEC-001\`\n\n## Ownership\n${ownership}\n`);
  // 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
  for (const f of importClosure(["check-ownership.mjs"], KIT_SRC))
    cpSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), join(root, "scripts", f));
  return root;
}
function run(root) {
  try {
    const out = execFileSync("node", [join(root, "scripts/check-ownership.mjs")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: advisory(기본) ⚠ exit 0 / hard ✗ exit 1 / off·소유 정합은 침묵", () => {
  const bad = "- **Capabilities**: budget.aggregate\n- **Files**: src/**";
  for (const [policy, wantCode] of [[undefined, 0], ["advisory", 0], ["hard", 1]]) {
    const root = fixture(policy, bad);
    try {
      const r = run(root);
      assert.equal(r.code, wantCode, `${policy}: ${r.out}`);
      assert.match(r.out, /Capability 귀속/);
      assert.match(r.out, /"budget\.aggregate" — entity "budget"/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // off → 판정·출력 무변
  const off = fixture("off", bad);
  try { assert.doesNotMatch(run(off).out, /Capability 귀속/); } finally { rmSync(off, { recursive: true, force: true }); }
  // entity 소유 + 그 capability → 침묵 통과(hard여도)
  const ok = fixture("hard", "- **Entities**: budget\n- **Capabilities**: budget.aggregate");
  try {
    const r = run(ok);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /Capability 귀속/);
  } finally { rmSync(ok, { recursive: true, force: true }); }
});

test("게이트: enum 밖 정책 값 → exit 1(문법화)", () => {
  const root = fixture("strict", "- **Entities**: budget");
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /capabilityOwnershipPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
