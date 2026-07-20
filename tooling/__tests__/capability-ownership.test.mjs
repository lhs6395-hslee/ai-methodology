// tooling/__tests__/capability-ownership.test.mjs — Capability 귀속 (SPEC-024)
// 스펙 경계는 entity 기준: capability x.verb는 entity x를 소유한 스펙만.
// @covers SPEC-024/FR-001
// @covers SPEC-024/FR-002
// @covers SPEC-024/FR-003
// @covers SPEC-024/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilityCheckActive, capabilityOwnershipFindings } from "../capability-ownership-lib.mjs";

const GATE = new URL("../check-ownership.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("capabilityCheckActive: entity·capability 카테고리 둘 다 있어야 활성(비-웹 무영향)", () => {
  assert.equal(capabilityCheckActive(["Entities", "Surfaces", "Capabilities"]), true);
  assert.equal(capabilityCheckActive(["Modules", "Symbols", "Artifacts"]), false); // 킷 자신
  assert.equal(capabilityCheckActive(["Datasets", "Jobs", "Sinks"]), false);        // 파이프라인
  assert.equal(capabilityCheckActive(["Entities", "Surfaces"]), false);              // capability 없음
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
  for (const f of ["check-ownership.mjs", "ownership-keys.mjs", "sdd-config.mjs", "grammar-lib.mjs", "lifecycle-lib.mjs", "relation-lib.mjs", "capability-ownership-lib.mjs"])
    cpSync(new URL(`../${f}`, import.meta.url).pathname, join(root, "scripts", f));
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
