// tooling/__tests__/template-parity.test.mjs
// A-1 회귀 방지: preset 경로(.specify ears-preset)의 spec 템플릿이 정식 템플릿
// (templates/module-spec.md)과 갈라지면, preset으로 쓴 스펙이 게이트 파싱 앵커
// (Ownership Files·Dependencies·Edge Cases·Change Log)를 결여한 채 spec-first
// 강제에서 조용히 빠진다. 두 파일은 바이트 동일해야 하며, 의도적 분기는
// 이 테스트를 고치는 리뷰를 통해서만 가능하다(조용한 드리프트 금지).
// @covers SPEC-006/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canonical = new URL("../../templates/module-spec.md", import.meta.url);
const preset = new URL("../ears-preset/templates/spec-template.md", import.meta.url);

test("preset spec-template = 정식 module-spec (바이트 동일 — 조용한 드리프트 금지)", () => {
  assert.equal(readFileSync(preset, "utf8"), readFileSync(canonical, "utf8"));
});

test("정식 템플릿은 게이트 파싱 앵커를 모두 가진다(앵커 자체의 회귀 방지)", () => {
  const t = readFileSync(canonical, "utf8");
  for (const anchor of [
    "- **Entities**:", "- **Surfaces**:", "- **Capabilities**:", "- **Files**:",
    "## Dependencies", "### Edge Cases", "## Change Log", "## Ownership",
    "## Review Log", "## Dedup-Review", "**Status**: Draft | Reviewed | Approved | Active | Deprecated | Removed",
  ]) assert.ok(t.includes(anchor), `앵커 누락: ${anchor}`);
});
