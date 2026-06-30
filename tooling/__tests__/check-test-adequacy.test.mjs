import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-test-adequacy.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-adq-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

test("@covers 있고 단언 있으면 통과", () => {
  const dir = fixture({
    "sdd.config.json": JSON.stringify({ scanDirs: ["tests"] }),
    "tests/a.test.ts": `// @covers SPEC-001/FR-001\ntest("x", () => { expect(1).toBe(1); });`,
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK/);
});

test("@covers 있는데 단언 없으면 strict에서 실패", () => {
  const dir = fixture({
    "sdd.config.json": JSON.stringify({ scanDirs: ["tests"] }),
    "tests/empty.test.ts": `// @covers SPEC-001/FR-001\ntest("x", () => {});`,
  });
  const warn = run(dir);          // 기본 advisory → exit 0
  assert.equal(warn.code, 0);
  assert.match(warn.out, /empty\.test\.ts/);
  const strict = run(dir, ["--strict"]);
  assert.equal(strict.code, 1);
});
