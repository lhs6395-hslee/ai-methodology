// tooling/__tests__/pre-commit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-pc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
  // 게이트·훅 복사
  for (const f of ["check-fr-coverage.mjs","check-ownership.mjs","ownership-keys.mjs","sdd-config.mjs"])
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  cpSync(join(process.cwd(), "tooling/harness/pre-commit"), join(root, "scripts/sdd-pre-commit.sh"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("표준 밖 접두어 스펙이 스테이징되면 pre-commit이 차단", () => {
  const root = setupRepo();
  try {
    writeFileSync(join(root, "sdd/specs/FEAT-001.md"), "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    let code = 0;
    try { execFileSync("sh", [join(root, "scripts/sdd-pre-commit.sh")], { cwd: root, stdio: ["ignore","pipe","pipe"] }); }
    catch (e) { code = e.status; }
    assert.equal(code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("docs-only 스테이징은 pre-commit 통과(게이트 미실행)", () => {
  const root = setupRepo();
  try {
    writeFileSync(join(root, "README.md"), "# Project README\n\nDocumentation only.\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    let code = 0;
    try { execFileSync("sh", [join(root, "scripts/sdd-pre-commit.sh")], { cwd: root, stdio: ["ignore","pipe","pipe"] }); }
    catch (e) { code = e.status; }
    assert.equal(code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
