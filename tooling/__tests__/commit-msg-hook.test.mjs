// tooling/__tests__/commit-msg-hook.test.mjs
// @covers SPEC-003/FR-003
// @covers SPEC-003/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClosure } from "../import-wiring-lib.mjs";

// 픽스처가 복사할 모듈을 읽는 주입기. 손목록은 반드시 드리프트한다 — 실측: 새 모듈
// 하나(check-outcome-lib.mjs)를 추가하자 손목록을 든 픽스처 5곳이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다(소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");


function repo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-cm-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  // 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
  for (const f of importClosure(["check-spec-sync.mjs"], KIT_SRC))
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  cpSync(join(process.cwd(), "tooling/harness/commit-msg"), join(root, "scripts/sdd-commit-msg.sh"));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  return { root, g };
}
const runHook = (root, msgPath) => {
  try { execFileSync("sh", [join(root, "scripts/sdd-commit-msg.sh"), msgPath], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); return 0; }
  catch (e) { return e.status; }
};

test("훅: 소유 코드만 staged → exit 1 / merge 상태(MERGE_HEAD) → skip exit 0", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), "# SPEC-001\n**FR-001** x\n## Ownership\n- **Files**: src/**\n## Change Log\n|d|c|r|\n|---|---|---|\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/a.ts"), "2\n"); g("add", "src/a.ts");
    writeFileSync(join(root, "m"), "fix\n");
    assert.equal(runHook(root, join(root, "m")), 1);
    // merge 상태 시뮬레이션: MERGE_HEAD 존재 → skip
    writeFileSync(join(root, ".git/MERGE_HEAD"), "0000000000000000000000000000000000000000\n");
    assert.equal(runHook(root, join(root, "m")), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
