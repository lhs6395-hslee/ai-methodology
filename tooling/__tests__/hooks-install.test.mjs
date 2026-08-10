// tooling/__tests__/hooks-install.test.mjs — 훅 배선 실재 (SPEC-036)
// 실측 제보: scripts/hooks에 pre-commit·pre-push가 버전관리돼 있었지만 .git/hooks엔 commit-msg만
// 복사돼 게이트가 **한 번도 발동하지 않은 채** green으로 읽혔다. 게이트 스크립트의 inert만 보고
// 훅 배선의 inert를 안 보면 이 상태를 통과로 센다.
// @covers SPEC-036/FR-001
// @covers SPEC-036/FR-002
// @covers SPEC-036/FR-003
// @covers SPEC-036/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SDD_HOOK_MARKER, parseHookList, hookFindings } from "../hooks-install-lib.mjs";

const GATE = new URL("../check-hooks-installed.mjs", import.meta.url).pathname;

test("parseHookList: 주석·빈 줄 제외, 순서 보존, 중복 제거", () => {
  assert.deepEqual(parseHookList("# 설명\npre-commit\n\ncommit-msg # 끝주석\npre-commit\n"),
    ["pre-commit", "commit-msg"]);
  assert.deepEqual(parseHookList(""), []);
});

test("hookFindings: 미설치·실행권한 없음·남의 훅 점유를 구분한다", () => {
  const inst = new Map([
    ["pre-commit", { exists: true, executable: true, content: `#!/bin/sh\n# ${SDD_HOOK_MARKER}\n` }],
    ["commit-msg", { exists: true, executable: false, content: `# ${SDD_HOOK_MARKER}` }],
    ["pre-push", { exists: true, executable: true, content: "#!/bin/sh\nhusky\n" }],
  ]);
  const f = hookFindings(["pre-commit", "commit-msg", "pre-push", "pre-merge-commit"], inst);
  assert.deepEqual(f, [
    { kind: "not-executable", name: "commit-msg" },   // 파일은 있는데 git이 조용히 건너뛴다
    { kind: "foreign", name: "pre-push" },            // 이름은 점유됐지만 킷 게이트는 안 돈다
    { kind: "missing", name: "pre-merge-commit" },
  ]);
  assert.deepEqual(hookFindings(["pre-commit"], inst), []);
});

test("게이트 e2e: 미설치는 advisory ⚠ · hard ✗ / 설치되면 침묵", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-hooks-"));
  const sh = (c) => execFileSync("sh", ["-c", c], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const run = (p) => {
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", hooksInstalledPolicy: p }));
    try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  };
  try {
    mkdirSync(join(root, "sdd/specs"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/hooks.list"), "# 목록\npre-commit\ncommit-msg\n");
    sh("git init -q .");

    const adv = run("advisory");
    assert.equal(adv.code, 0);
    assert.match(adv.out, /pre-commit 미설치/);
    assert.match(adv.out, /한 번도 발동하지 않는다/);

    const hard = run("hard");
    assert.equal(hard.code, 1, "미설치를 green으로 읽으면 안 된다");
    assert.match(hard.out, /이 상태의 green은 거짓이다/);

    // 마커 포함 훅을 실제로 설치하면 침묵
    for (const n of ["pre-commit", "commit-msg"]) {
      const p = join(root, ".git/hooks", n);
      writeFileSync(p, `#!/bin/sh\n# ${SDD_HOOK_MARKER}\nexit 0\n`);
      chmodSync(p, 0o755);
    }
    const ok = run("hard");
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /OK — 선언된 훅이 모두 설치·실행 가능/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── git worktree 배선(SPEC-036, 실측 제보 2026-08-10) ──────────────────────
// 워크트리에서 `.git`은 **파일**이고 `--git-dir`은 훅이 없는 워크트리 전용 디렉토리를 준다.
// 이전 판은 `[ -d .git ]` 가드 + `.git/hooks` 문자열 조합이라 배선이 통째로 스킵됐고, 그 스킵이
// best-effort 침묵이라 도입 프로젝트는 commit-msg·pre-commit·pre-push가 **한 번도 발동하지 않은
// 상태로 몇 달을 갔다** — 그 사이 모든 커밋이 게이트를 우회했다.
// @covers SPEC-036/FR-004
import { execFileSync as _exec } from "node:child_process";
import { mkdtempSync as _mkdtemp, existsSync as _exists, readdirSync as _readdir, writeFileSync as _write, mkdirSync as _mkdir, rmSync as _rm, cpSync as _cp } from "node:fs";
import { tmpdir as _tmpdir } from "node:os";
import { join as _join } from "node:path";
import { readFileSync } from "node:fs";
import { stripFullLineComments } from "../external-target-lib.mjs";

const KIT = new URL("../..", import.meta.url).pathname;
const sh = (cmd, cwd) => _exec("sh", ["-c", cmd], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function worktree() {
  const base = _mkdtemp(_join(_tmpdir(), "sdd-wt-"));
  const main = _join(base, "main"), wt = _join(base, "wtA");
  sh(`git init -q "${main}"`, base);
  sh(`git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init`, main);
  sh(`git worktree add -q "${wt}"`, main);
  return { base, main, wt };
}

test("워크트리에서 `.git`은 파일이고 `--git-dir`에는 hooks가 없다 — 이 결함의 전제", () => {
  const { base, main, wt } = worktree();
  try {
    const gitDir = sh("git rev-parse --git-dir", wt).trim();
    const gitPath = sh("git rev-parse --git-path hooks", wt).trim();
    assert.equal(_exists(_join(wt, ".git")), true);
    assert.equal(_readdir(wt).includes(".git"), true);
    assert.match(gitDir, /worktrees/, "--git-dir은 워크트리 전용 디렉토리를 준다");
    assert.equal(_exists(_join(gitDir, "hooks")), false, "그 디렉토리에는 hooks가 없다");
    assert.equal(_exists(gitPath), true, "--git-path hooks가 실재하는 자리를 준다");
    assert.equal(gitPath.startsWith(_join(main, ".git")), true, "공통 디렉토리의 hooks다");
  } finally { _rm(base, { recursive: true, force: true }); }
});

test("워크트리 채택에서 훅 4종이 실제로 배선된다 — 조용한 스킵의 회귀", () => {
  const { base, wt } = worktree();
  try {
    const out = sh(`sh "${_join(KIT, "tooling/sdd-init.sh")}" --gate=node 2>&1`, wt);
    const hooks = sh("git rev-parse --git-path hooks", wt).trim();
    const installed = _readdir(hooks).filter((f) => !f.endsWith(".sample"));
    for (const h of ["pre-commit", "pre-merge-commit", "commit-msg", "pre-push"]) {
      assert.ok(installed.includes(h), `${h}가 배선되지 않았다 (설치된 것: ${installed.join(", ")})`);
    }
    // 설치 0건을 조용히 넘기지 않는다 — 실측 건수를 말한다.
    assert.match(out, /훅 배선 실측: 킷 훅 4종/);
    assert.match(out, /훅 디렉토리:/);
  } finally { _rm(base, { recursive: true, force: true }); }
});

test("훅 경로 해석은 core.hooksPath도 존중한다 — 손 조합이 아니라 git이 답한다", () => {
  const { base, main } = worktree();
  try {
    sh("git config core.hooksPath .myhooks", main);
    assert.equal(sh("git rev-parse --git-path hooks", main).trim(), ".myhooks");
  } finally { _rm(base, { recursive: true, force: true }); }
});

test("배선 사이트가 훅 경로를 손으로 조합하지 않는다 — `--git-path hooks` 단일 호출", () => {
  // 조합(`--git-dir` + `core.hooksPath`)이 바로 워크트리를 틀리게 한 원인이다.
  // ⚠ **주석은 코드가 아니다** — 이 결함을 설명하는 주석에 옛 형태가 인용돼 있으므로, 킷의 정본
  //   헬퍼로 전줄 주석을 걷어낸 뒤 판정한다(SPEC-044가 세운 "주석 속 예시는 인용이지 결정이 아니다").
  const code = (rel) => stripFullLineComments(readFileSync(_join(KIT, rel), "utf8"));
  const gate = code("tooling/check-hooks-installed.mjs");
  assert.match(gate, /rev-parse --git-path hooks/);
  assert.doesNotMatch(gate, /config --get core\.hooksPath/, "게이트에 손 조합이 남아 있다");
  const init = code("tooling/sdd-init.sh");
  assert.match(init, /rev-parse --git-path hooks/);
  assert.doesNotMatch(init, /\[ -d "\$T\/\.git" \]/, "`.git`을 디렉토리로 가정하는 가드가 남아 있다");
  const self = code("tooling/harness/self-hooks-install.sh");
  assert.match(self, /rev-parse --git-path hooks/);
  assert.doesNotMatch(self, /mkdir -p \.git\/hooks/, "`.git/hooks` 문자열 가정이 남아 있다");
});
