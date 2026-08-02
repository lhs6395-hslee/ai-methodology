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
