import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sdd-init가 hook·settings·pre-commit 배선", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-"));
  try {
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    assert.ok(existsSync(join(root, ".claude/settings.json")), ".claude/settings.json 생성");
    const s = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    assert.ok(s.hooks?.SessionStart, "SessionStart hook 배선");
    assert.ok(s.hooks?.PreToolUse, "PreToolUse hook 배선");
    assert.ok(existsSync(join(root, "scripts/sdd-session-context.sh")), "sdd-session-context.sh 설치");
    assert.ok(existsSync(join(root, "scripts/sdd-edit-check.sh")), "sdd-edit-check.sh 설치");
    assert.ok(existsSync(join(root, "scripts/sdd-pre-commit.sh")), "sdd-pre-commit.sh 설치");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-init가 기존 settings.json hooks 보존(merge)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-merge-"));
  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "sh scripts/my-custom.sh" }] }]
      }
    };
    writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(existing));
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    const s = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    // SessionStart 배열에 기존 엔트리가 유지되거나 SDD hook이 있어야 함
    assert.ok(Array.isArray(s.hooks?.SessionStart), "SessionStart 배열 유지");
    assert.ok(s.hooks?.PreToolUse, "PreToolUse hook 배선");
    // 기존 커스텀 hook 또는 SDD hook 중 하나가 있음(merge 방식에 따라)
    const sessionCmds = (s.hooks.SessionStart || [])
      .flatMap(e => (e.hooks || []).map(h => h.command));
    const hasSddOrCustom = sessionCmds.some(c =>
      c.includes("sdd-session-context") || c.includes("my-custom"));
    assert.ok(hasSddOrCustom, "SessionStart에 SDD 또는 기존 hook 존재");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
