import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const SYNC = new URL("../sdd-sync.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-sync-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [SYNC, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("clean 프로젝트(FR↔test 커버·중복/과대 없음) → 전부 sync, exit 0", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n**FR-001** a\n**Given** x **When** y **Then** z\n## Ownership\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /R3 dedup.*✓|✓ clean/s);
  assert.match(r.out, /전부 sync|sync ✓/);
});

test("과대 spec(cohesion 위반) → R3 확인 필요, --strict exit 1", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture({ "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const warn = run(dir);
  assert.match(warn.out, /R3 dedup.*확인 필요/s);
  assert.equal(run(dir, ["--strict"]).code, 1);
});
