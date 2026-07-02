// tooling/__tests__/init-spec-sync.test.mjs
// @covers SPEC-004/FR-002
// @covers SPEC-004/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sdd-init: spec-sync 게이트·lib·commit-msg 훅·스킬 배선 + 실제 실행 무crash", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-iss-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    for (const f of ["scripts/check-spec-sync.mjs", "scripts/spec-sync-lib.mjs", "scripts/sdd-commit-msg.sh", ".git/hooks/commit-msg", ".claude/skills/speckit-fix/SKILL.md"])
      assert.ok(existsSync(join(root, f)), `${f} 설치`);
    // init-then-execute: 설치물만으로 range 모드 실행 — MODULE_NOT_FOUND 금지
    const r = (() => { try { return { code: 0, out: execFileSync("node", [join(root, "scripts/check-spec-sync.mjs")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; } })();
    assert.ok(!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(r.out), r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-init: package.json 있으면 check:spec-sync 스크립트 추가(병합, 기존 보존)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-pkg-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc" } }, null, 2));
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts.build, "tsc"); // 기존 보존
    assert.match(pkg.scripts["check:spec-sync"] || "", /check-spec-sync/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
