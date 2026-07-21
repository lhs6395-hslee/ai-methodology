// tooling/__tests__/migrate-skill.test.mjs — /sdd-migrate 실행기 스킬 계약 (SPEC-025)
// @covers SPEC-025/FR-001
// @covers SPEC-025/FR-002
// @covers SPEC-025/FR-003
// @covers SPEC-025/FR-004
// @covers SPEC-025/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const skill = () => readFileSync(join(ROOT, "tooling/harness/sdd-migrate.SKILL.md"), "utf8");
const proc = () => readFileSync(join(ROOT, "prompts/migrate.md"), "utf8");

test("스킬·정본 절차 파일이 존재하고 frontmatter name이 맞다", () => {
  assert.ok(existsSync(join(ROOT, "tooling/harness/sdd-migrate.SKILL.md")), "SKILL.md 존재");
  assert.ok(existsSync(join(ROOT, "prompts/migrate.md")), "prompts/migrate.md 존재");
  assert.match(skill(), /^name:\s*sdd-migrate\b/m, "frontmatter name: sdd-migrate");
});

test("FR-001: 백로그 수집·triage(capability/키앵커/입도) 지시", () => {
  const s = skill() + proc();
  assert.match(s, /백로그/, "백로그 수집");
  assert.match(s, /triage|분류/, "triage");
  assert.match(s, /SPEC-024|capability 귀속/, "capability 귀속");
  assert.match(s, /SPEC-023|키 앵커/, "키 앵커");
  assert.match(s, /SPEC-017|입도|관계/, "입도/관계");
});

test("FR-001: entity·bold 두 문제를 명시적으로 다룬다", () => {
  const s = skill() + proc();
  assert.match(s, /유령 entity|aggregate root/, "entity 재구성");
  assert.match(s, /키 앵커|bold/, "키 앵커(bold)");
});

test("FR-002: 승인 관문 HALT + 도메인 사실 창작 금지(물어본다)", () => {
  const s = skill() + proc();
  assert.match(s, /승인/, "사람 승인 관문");
  assert.match(s, /HALT|자동 확정 금지|추정.*금지|물어/, "추정 금지·물어본다");
  assert.match(s, /창작.*금지|사실.*창작|도메인 사실/, "도메인 사실 창작 금지");
});

test("FR-003: 스펙별 원자 커밋(빅뱅 금지) + spec-first Change Log", () => {
  const s = skill() + proc();
  assert.match(s, /한 스펙 = 한 커밋|스펙별 원자 커밋|한 스펙 한 커밋/, "한 스펙 한 커밋");
  assert.match(s, /빅뱅.*금지/, "빅뱅 금지");
  assert.match(s, /Change Log/, "Change Log 동반(spec-first)");
});

test("FR-004: 승인 없는 편집·덮어쓰기 거부", () => {
  const s = skill();
  assert.match(s, /덮어쓰|자동.*금지/, "자동 덮어쓰기 금지");
  assert.match(s, /승인/, "승인 필수");
});

test("FR-005: 미승인은 advisory 보존·재표면화 + 백로그 0에서 hard 승격 제안", () => {
  const s = skill() + proc();
  assert.match(s, /미승인.*advisory|advisory로 보존|재표면화/, "미승인 advisory 보존");
  assert.match(s, /hard.*승격|승격.*제안/, "백로그 0에서 hard 승격 제안");
});

test("update와의 차이(목록 vs 실행)를 명시한다", () => {
  const s = skill() + proc();
  assert.match(s, /update.*표면화만|목록.*migrate.*실행|update = 목록/, "update=목록/migrate=실행 구분");
});
