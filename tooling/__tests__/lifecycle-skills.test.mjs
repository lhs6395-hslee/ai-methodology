// @covers SPEC-005/FR-001
// @covers SPEC-005/FR-002
// @covers SPEC-005/FR-003
// @covers SPEC-005/FR-004
// @covers SPEC-005/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HARNESS = join(process.cwd(), "tooling/harness");
const read = (name) => readFileSync(join(HARNESS, name), "utf8");

test("세 라이프사이클 스킬 파일이 존재하고 frontmatter name이 맞다", () => {
  for (const [file, name] of [
    ["sdd-start.SKILL.md", "sdd-start"],
    ["sdd-readopt.SKILL.md", "sdd-readopt"],
    ["sdd-update.SKILL.md", "sdd-update"],
  ]) {
    assert.ok(existsSync(join(HARNESS, file)), `${file} 존재`);
    assert.match(read(file), new RegExp(`^name:\\s*${name}\\b`, "m"), `${file} name: ${name}`);
  }
});

test("FR-001: /sdd-start는 reverse-engineer 초안 + 승인 게이트에서 멈춘다", () => {
  const s = read("sdd-start.SKILL.md");
  assert.match(s, /reverse-engineer/i, "reverse-engineer 지시");
  assert.match(s, /승인 게이트/, "승인 게이트 halt 지시");
  assert.match(s, /adopt\.md/, "정본 절차 prompts/adopt.md 참조");
});

test("FR-002: /sdd-readopt는 안전망 태그 → --force 재배선 → 코드 무변경", () => {
  const s = read("sdd-readopt.SKILL.md");
  assert.match(s, /sdd-pre-readopt-/, "안전망 태그 지시");
  assert.match(s, /--force/, "sdd-init --force 재배선");
  assert.match(s, /코드 무변경|코드는 그대로|프로덕션 코드는 그대로|건드리지 않는다/, "프로덕션 코드 무변경 불변식");
});

test("FR-003: /sdd-update는 /sdd-sync 하네스를 감싼다", () => {
  const s = read("sdd-update.SKILL.md");
  assert.match(s, /\/sdd-sync/, "/sdd-sync 래핑");
  assert.match(s, /speckit\.fix/, "버그성 드리프트는 /speckit.fix로 escalate");
});

test("FR-004: 세 스킬 모두 승인 없는 확정·덮어쓰기를 금지한다", () => {
  for (const file of ["sdd-start.SKILL.md", "sdd-readopt.SKILL.md", "sdd-update.SKILL.md"]) {
    const s = read(file);
    assert.match(s, /덮어쓰/, `${file}: 덮어쓰기 금지 불변식`);
    assert.match(s, /승인/, `${file}: 사람 승인 게이트`);
  }
});

test("FR-005: 세 스킬 모두 인자 기본값(현재 디렉토리·정본 URL)을 문서화한다", () => {
  for (const file of ["sdd-start.SKILL.md", "sdd-readopt.SKILL.md", "sdd-update.SKILL.md"]) {
    const s = read(file);
    assert.match(s, /<project-path>/, `${file}: <project-path> 인자`);
    assert.match(s, /없으면 현재 디렉토리/, `${file}: 인자 없으면 현재 디렉토리 기본값`);
    assert.match(s, /methodology-url/, `${file}: <methodology-url> 인자`);
  }
});
