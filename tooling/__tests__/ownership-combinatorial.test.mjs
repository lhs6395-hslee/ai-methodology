// tooling/__tests__/ownership-combinatorial.test.mjs — 도그푸딩 픽스처 스위트(이슈 #21 Row 14)
// 근본 원인 진단: 이 감사가 잡은 결함 대부분(M-11 surfaceFormat 비호환·M-12 [id] 미정규화 등)은
// 개별 단위 테스트로는 안 보이고 **여러 축이 동시에 실전 조합**될 때만 드러났다 — 소비 프로젝트가
// Entities·Surfaces·Capabilities를 섞어 쓰고 surfaceFormat을 http/path/any 중 하나로 고정한
// 실제 스펙을 킷의 게이트가 실제로 실행해야 잡히는 결함이었다. 이 파일은 그 조합 공간을
// **체계적으로 실행**한다 — 특정 버그 하나를 재현하는 회귀 테스트가 아니라, 카테고리 소유 조합
// (7가지: Entities만·Surfaces만·Capabilities만·EC·ES·SC·전부) × surfaceFormat(3가지: http·path·
// any) = 21셀 전부에서 실제 check-ownership.mjs 게이트를 돌려 "정상적으로 구성된 스펙이 조용히
// 거짓 위반을 내지 않는가"를 매번 확인한다. 미래에 한 축을 고치다 다른 축과의 조합을 깨는
// 회귀(정확히 M-11의 발생 경로)를 이 스위트가 잡는다.
// @covers SPEC-001/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNERSHIP_GATE = new URL("../check-ownership.mjs", import.meta.url).pathname;
const CONSISTENCY_GATE = new URL("../check-spec-consistency.mjs", import.meta.url).pathname;

// 카테고리 소유 조합 — {Entities,Surfaces,Capabilities}의 공집합 제외 부분집합 7가지.
const CATEGORY_COMBOS = [
  ["Entities"], ["Surfaces"], ["Capabilities"],
  ["Entities", "Capabilities"], ["Entities", "Surfaces"], ["Surfaces", "Capabilities"],
  ["Entities", "Surfaces", "Capabilities"],
];
const SURFACE_FORMATS = ["http", "path", "any"];

// 형식별 실재 예시 키 — http·path는 각각 그 형식의 정상형 + scheme 접두어(이슈 #21 M-11 carve-out)
// 하나씩 섞고, any는 http형·path형을 **동시에** 섞는다("any"가 실제로 혼재를 허용하는지 확인).
function surfaceKeysFor(format) {
  if (format === "http") return ["POST /api/widget", "event:widget.created"];
  if (format === "path") return ["src/app/widget/route.ts", "event:widget.created"];
  return ["POST /api/widget", "src/app/widget/route.ts"]; // any: http형+path형 혼재
}

function buildSpec(categories, format) {
  const lines = ["**Spec**: `SPEC-001`", "**Status**: Active", "- **FR-001** (event): THE SYSTEM SHALL x.", "**Given** x", "- **SC-001**: 90%", "## Ownership"];
  if (categories.includes("Entities")) lines.push("- **Entities**: widget");
  if (categories.includes("Surfaces")) lines.push(`- **Surfaces**: ${surfaceKeysFor(format).join(", ")}`);
  if (categories.includes("Capabilities")) lines.push("- **Capabilities**: widget.create");
  lines.push("## Review Log", "| 2026-08-27 | 픽스처 | PASS |", "## Dedup-Review", "- 이웃 없음");
  return lines.join("\n") + "\n";
}

function fixture(categories, format) {
  const root = mkdtempSync(join(tmpdir(), "sdd-combo-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs",
    surfaceFormat: format,
    surfaceSchemePrefixes: ["event", "job"],
  }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), buildSpec(categories, format));
  return root;
}

function run(gate, root) {
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

for (const categories of CATEGORY_COMBOS) {
  for (const format of SURFACE_FORMATS) {
    const label = `${categories.join("+")} × surfaceFormat=${format}`;
    test(`도그푸딩 조합: ${label} — 정상 구성 스펙은 형식 위반·크래시 없이 통과한다`, () => {
      const root = fixture(categories, format);
      try {
        const own = run(OWNERSHIP_GATE, root);
        const consistency = run(CONSISTENCY_GATE, root);
        // 불변 ①: 정상 구성이면 두 게이트 다 크래시하지 않는다(스택 트레이스 노출 없음).
        assert.doesNotMatch(own.out, /TypeError|ReferenceError|at Object\.<anonymous>/, `ownership 크래시(${label}):\n${own.out}`);
        assert.doesNotMatch(consistency.out, /TypeError|ReferenceError|at Object\.<anonymous>/, `consistency 크래시(${label}):\n${consistency.out}`);
        // 불변 ②: 기본 config(전 강도 advisory 이하)에서는 정상 구성이 exit 1로 하드 차단되지 않는다.
        assert.equal(own.code, 0, `ownership exit(${label}):\n${own.out}`);
        assert.equal(consistency.code, 0, `consistency exit(${label}):\n${consistency.out}`);
        // 불변 ③: 이 스위트가 만든 키는 전부 그 format의 정상형이므로 "형식" 위반 문구가 없어야
        // 한다(이슈 #21 M-11: http·path가 서로의 정상형을 형식 위반으로 오판하던 결함의 조합 회귀).
        if (categories.includes("Surfaces")) {
          assert.doesNotMatch(own.out, /Surface\(path\)는|Surface는 "<METHOD>/, `Surfaces 형식 오탐(${label}):\n${own.out}`);
        }
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}

// 대표 셀 하나를 골라 실제 위반 신호(미등록 verb)가 여전히 잡히는지 확인 — 이 스위트가
// "항상 통과"로 무력화되지 않았음을 보증한다(위양성 없음 ≠ 위음성 있음).
test("도그푸딩 조합 스위트가 무력화되지 않았다 — 실제 위반(미등록 verb)은 여전히 지목된다", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-combo-neg-"));
  try {
    mkdirSync(join(root, "sdd", "specs"), { recursive: true });
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", surfaceFormat: "http" }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
      "**Spec**: `SPEC-001`\n**Status**: Active\n- **FR-001** (event): THE SYSTEM SHALL x.\n**Given** x\n- **SC-001**: 90%\n## Ownership\n- **Entities**: widget\n- **Capabilities**: widget.frobnicate\n## Review Log\n| 2026-08-27 | 픽스처 | PASS |\n## Dedup-Review\n- 이웃 없음\n");
    const r = run(OWNERSHIP_GATE, root);
    assert.match(r.out, /미등록 verb "frobnicate"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
