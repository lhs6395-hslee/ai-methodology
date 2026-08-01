// tooling/__tests__/pre-edit.test.mjs — pre-edit spec-first 경고 (SPEC-003 FR-001 확장)
// spec-first가 commit-msg 훅뿐이면 사후 검사다 — 편집 시점에 마찰을 만든다(비차단).
// @covers SPEC-003/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../check-pre-edit.mjs", import.meta.url).pathname;

// 소유 스펙(Files glob) + git 저장소를 갖춘 픽스처. base=main 대비 판정하므로 커밋을 하나 만든다.
function repo({ specFiles = "src/**", touchSpec = false, cfg = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-pe-"));
  const git = (a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", specSyncBase: "main", ...cfg }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), `**Spec**: \`SPEC-001\`\n## Ownership\n- **Files**: ${specFiles}\n`);
  writeFileSync(join(root, "src/a.js"), "// code\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]); git(["branch", "-M", "main"]);
  if (touchSpec) writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
    `**Spec**: \`SPEC-001\`\n## Ownership\n- **Files**: ${specFiles}\n## Change Log\n| 2026-07-30 | 변경 | 근거 |\n`);
  return root;
}
function run(root, target) {
  try { return { code: 0, out: execFileSync("node", [SCRIPT, target], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("소유 파일 편집 + 소유 스펙 미수정 → 경고(비차단 exit 0) — 수용 기준 4", () => {
  const root = repo();
  try {
    // 워킹트리에서 소유 코드만 수정한 상태(스펙은 그대로)
    writeFileSync(join(root, "src/a.js"), "// edited\n");
    const r = run(root, "src/a.js");
    assert.equal(r.code, 0, "비차단이어야 한다");
    assert.match(r.out, /spec-first — 편집 전 순서 확인/);
    assert.match(r.out, /SPEC-001.*아직 미수정/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("소유 스펙을 이미 손댔으면 침묵(정상 순서)", () => {
  const root = repo({ touchSpec: true });
  try {
    writeFileSync(join(root, "src/a.js"), "// edited\n");
    const r = run(root, "src/a.js");
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", `침묵해야 한다: ${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("미소유 경로·인자 없음 → 침묵(오탐 금지)", () => {
  const root = repo();
  try {
    writeFileSync(join(root, "README.md"), "x\n");
    assert.equal(run(root, "README.md").out.trim(), "");
    assert.equal(run(root, "").out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("preEditSpecFirstPolicy:off → 침묵", () => {
  const root = repo({ cfg: { preEditSpecFirstPolicy: "off" } });
  try {
    writeFileSync(join(root, "src/a.js"), "// edited\n");
    assert.equal(run(root, "src/a.js").out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
