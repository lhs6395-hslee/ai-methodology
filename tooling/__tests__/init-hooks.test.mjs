// @covers SPEC-004/FR-002
// @covers SPEC-004/FR-003
// @covers SPEC-004/FR-004
// @covers SPEC-004/FR-010
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

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

// jq 계약이 **반전**됐다(SPEC-051). 이전 판은 "jq 없으면 배선을 스킵하고 기존 파일을 보존"이었고
// 그 스킵이 곧 **설치가 성공으로 끝나는 조용한 0건**이었다 — 에이전트측 훅이 하나도 안 깔린 채
// 채택이 완료로 보고됐다. 이제 배선은 게이트(node)가 계산하므로 jq가 아예 필요 없고, 남의 키는
// 병합으로 보존된다. 즉 보존 **그리고** 배선을 함께 단언한다.
test("jq 없이도 배선되고 남의 키는 보존된다 — 조용한 스킵이 사라졌다", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-nojq-"));
  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    const sentinel = { _sentinel: "keep", hooks: { SessionStart: [] } };
    writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(sentinel));

    // jq만 없는 PATH를 만든다 — 이전 판은 PATH를 `/bin:/usr/bin`으로 줄였는데 그러면 **node도**
    // 사라진다. 이 블록은 배선을 node 게이트로 계산하므로(SPEC-051) node 없는 PATH는 "jq 없음"이
    // 아니라 "런타임 없음"을 시험하는 것이 되고, `--gate node` 설치 자체가 성립하지 않는다.
    // jq를 가리는 shim 디렉터리를 PATH 앞에 두어 `command -v jq`가 실패하게 한다.
    const shim = mkdtempSync(join(tmpdir(), "sdd-nojq-shim-"));
    writeFileSync(join(shim, "jq"), "#!/bin/sh\nexit 127\n");
    // 실행 비트를 주지 않는다 → `command -v jq`가 찾지 못한다(가림의 가장 단순한 형태).
    const nodeDir = dirname(process.execPath);
    const noJqPath = `${shim}:/bin:/usr/bin:${nodeDir}`;
    execFileSync(
      "sh",
      [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"],
      { cwd: root, stdio: "ignore", env: { ...process.env, PATH: noJqPath } }
    );

    // 파일이 살아있고, sentinel 키가 보존되어 있어야 함
    assert.ok(existsSync(join(root, ".claude/settings.json")), "settings.json 파일 유지");
    const s = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    assert.strictEqual(s._sentinel, "keep", "sentinel 키 보존(clobber 없음)");
    // 그리고 **배선이 실제로 됐어야 한다** — 이것이 없으면 조용한 스킵이 남아 있다는 뜻이다.
    const cmds = (s.hooks?.SessionStart || []).flatMap((g) => (g.hooks || []).map((h) => h.command || ""));
    assert.ok(cmds.some((c) => c.includes("sdd-session-context")),
      `jq 없는 환경에서 에이전트 훅이 배선되지 않았다: ${JSON.stringify(s.hooks?.SessionStart)}`);
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

test("sdd-init가 에이전트 컨텍스트 배선(.kiro/steering + AGENTS.md) + idempotent (SPEC-004 FR-010)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-agent-"));
  try {
    // 기존 AGENTS.md에 사용자 내용이 있는 경우 — 보존되어야
    writeFileSync(join(root, "AGENTS.md"), "# 우리 프로젝트 규칙\n- 커밋은 한국어\n");
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });

    const steer = join(root, ".kiro/steering/sdd.md");
    assert.ok(existsSync(steer), ".kiro/steering/sdd.md 설치");
    assert.match(readFileSync(steer, "utf8"), /SDD:BEGIN/, "steering에 SDD 마커 블록");
    assert.match(readFileSync(steer, "utf8"), /슬래시를 못 쓰는/, "에이전트 무관 실행 규범 포함");

    const ag = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.match(ag, /우리 프로젝트 규칙/, "기존 AGENTS.md 내용 보존");
    assert.match(ag, /SDD:BEGIN/, "AGENTS.md에 SDD 블록 추가");

    // idempotency — 재실행해도 블록 1개만
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    const ag2 = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.equal((ag2.match(/SDD:BEGIN/g) || []).length, 1, "재실행에도 SDD 블록 중복 없음");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-init: .git 없는 대상 → 조용한 스킵 대신 경고 명시(SPEC-004 FR-005 회귀)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-nogit-"));
  try {
    // git init 안 함 → .git 없음. stderr까지 잡으려 sh -c로 2>&1 결합.
    const combined = execFileSync(
      "sh", ["-c", `sh "${join(process.cwd(), "tooling/sdd-init.sh")}" --gate=node 2>&1`],
      { cwd: root, encoding: "utf8" });
    assert.match(combined, /\.git 없음/, "조용한 스킵 아니라 경고 출력");
    assert.match(combined, /강제 궤도.*꺼진/, "완료 안내에 재요약");
    assert.match(combined, /git init/, "해결 방법 안내");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
