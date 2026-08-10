// tooling/__tests__/pre-commit.test.mjs
// @covers SPEC-004/FR-005
// @covers SPEC-002/FR-006
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


function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-pc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
  // 게이트·훅 복사
  // 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
  for (const f of importClosure(["check-fr-coverage.mjs", "check-ownership.mjs", "verification-accounting.mjs"], KIT_SRC))
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

test("docs-only 스테이징도 게이트는 실행되나 clean 레포면 통과(경로 필터 제거 — 감사 P3)", () => {
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
