// @covers SPEC-003/FR-008
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-converge-drift.mjs", import.meta.url).pathname;

function git(dir, args) { execFileSync("git", args, { cwd: dir, stdio: "ignore" }); }
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "sdd-cv-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "sdd/specs"), { recursive: true });
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ scanDirs: ["src"], specDir: "sdd/specs" }));
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "sdd/specs/SPEC-001.md"), "**Spec**: `SPEC-001`\n");
  git(dir, ["add", "-A"]); git(dir, ["commit", "-qm", "base"]);
  git(dir, ["branch", "-M", "main"]);
  git(dir, ["checkout", "-q", "-b", "work"]);   // feature branch off main so base...HEAD has a real diff
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("코드만 바뀌고 스펙 무변경 → advisory 경고(exit 0), strict 실패", () => {
  const dir = repo();
  writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "hotfix"], { cwd: dir });
  const warn = run(dir, ["main"]);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /스펙 무변경|drift/);
  const strict = run(dir, ["main", "--strict"]);
  assert.equal(strict.code, 1);
});

test("코드와 스펙 함께 변경 → 통과", () => {
  const dir = repo();
  writeFileSync(join(dir, "src/a.ts"), "export const a = 3;\n");
  writeFileSync(join(dir, "sdd/specs/SPEC-001.md"), "**Spec**: `SPEC-001`\nupdated\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "feat+spec"], { cwd: dir });
  const r = run(dir, ["main"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK/);
});
