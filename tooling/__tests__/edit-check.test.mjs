// @covers SPEC-004/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function run(input) {
  return execFileSync("sh", [join(process.cwd(), "tooling/harness/sdd-edit-check.sh")],
    { input: JSON.stringify(input), encoding: "utf8" });
}

test("src 편집이면 체크리스트 출력", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "src/recommend.ts" } });
  assert.match(out, /MODULE_MAP/);
  assert.match(out, /FR/);
  assert.match(out, /PREFIX/);
  assert.match(out, /@covers/);
});

test("중첩 lib 경로도 체크리스트 출력", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "packages/lib/util.ts" } });
  assert.match(out, /MODULE_MAP/);
});

test("문서 파일이면 침묵", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "README.md" } });
  assert.equal(out.trim(), "");
});
