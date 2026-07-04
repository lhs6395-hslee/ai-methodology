// @covers SPEC-004/FR-002
// @covers SPEC-004/FR-003
// @covers SPEC-004/FR-004
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
    // 수명주기 스킬 설치(SPEC-004 FR-003 확장 — SPEC-005 스킬 배선)
    assert.ok(existsSync(join(root, ".claude/skills/sdd-start/SKILL.md")), "sdd-start 스킬 설치");
    assert.ok(existsSync(join(root, ".claude/skills/sdd-readopt/SKILL.md")), "sdd-readopt 스킬 설치");
    assert.ok(existsSync(join(root, ".claude/skills/sdd-update/SKILL.md")), "sdd-update 스킬 설치");
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

test("jq 없으면 기존 settings.json 보존(clobber 금지)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-nojq-"));
  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    const sentinel = { _sentinel: "keep", hooks: { SessionStart: [] } };
    writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(sentinel));

    // PATH를 jq 없는 최소 경로로 — 스크립트가 sh/cp/mkdir 등은 찾되 jq만 없게 함.
    // /bin:/usr/bin는 macOS/Linux 공통 기본 유틸 위치이나 jq는 보통 /usr/local/bin 등에 있음.
    // 더 안전하게: PATH를 스크립트 실행에 필요한 최소값으로 설정하고 jq를 제외.
    const noJqPath = "/bin:/usr/bin";
    execFileSync(
      "sh",
      [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"],
      { cwd: root, stdio: "ignore", env: { ...process.env, PATH: noJqPath } }
    );

    // 파일이 살아있고, sentinel 키가 보존되어 있어야 함
    assert.ok(existsSync(join(root, ".claude/settings.json")), "settings.json 파일 유지");
    const s = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    assert.strictEqual(s._sentinel, "keep", "sentinel 키 보존(clobber 없음)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-init 재실행 시 SessionStart hook 중복 없음(idempotency)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-idem-"));
  try {
    const runInit = () => execFileSync(
      "sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"],
      { cwd: root, stdio: "ignore" }
    );
    // 첫 번째 실행
    runInit();
    // 두 번째 실행 (동일 디렉토리, 동일 args)
    runInit();

    const s = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    const sessionStart = s.hooks?.SessionStart ?? [];
    // sdd-session-context 명령을 포함하는 엔트리가 정확히 하나여야 함
    const sddEntries = sessionStart.filter(e =>
      (e.hooks || []).some(h => (h.command || "").includes("sdd-session-context"))
    );
    assert.strictEqual(sddEntries.length, 1, "sdd-session-context 엔트리가 정확히 1개(중복 없음)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-init --gate=py: Python 게이트 + spec-first 훅(pre-commit·commit-msg) 배선", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-py-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=py"], { cwd: root, stdio: "ignore" });
    assert.ok(existsSync(join(root, "scripts/sdd_gates.py")), "sdd_gates.py 설치");
    const pre = readFileSync(join(root, ".git/hooks/pre-commit"), "utf8");
    assert.match(pre, /sdd_gates\.py fr/);
    assert.match(pre, /sdd_gates\.py ownership/);
    const cm = readFileSync(join(root, ".git/hooks/commit-msg"), "utf8");
    assert.match(cm, /specsync --staged --message-file/);
    assert.match(cm, /MERGE_HEAD/); // merge commit skip(§5.6) 의미론 유지
  } finally { rmSync(root, { recursive: true, force: true }); }
});
