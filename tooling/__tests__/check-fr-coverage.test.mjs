// tooling/__tests__/check-fr-coverage.test.mjs
// @covers SPEC-002/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = new URL("../check-fr-coverage.mjs", import.meta.url).pathname;
// 키트 자기 게이트가 이 파일도 스캔하므로 픽스처 태그는 이어붙여 중화한다.
const TAG = "// @cov" + "ers ";

function run(files) {
  const root = mkdtempSync(join(tmpdir(), "sdd-frc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"] }));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
  try {
    const out = execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("레터 서픽스 FR(FR-001a): 선언·태그 양쪽에서 인정 — dangling 아님", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001a\ntest('y', () => { assert.ok(1); });\n",
  });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /dangling/);
  assert.match(r.out, /FRs:1 covered:1/); // 스펙 측 FR_DECL도 FR-001a를 FR로 집계해야 함
});

test("2자 서픽스(FR-001ab) 태그는 통째 불인정 — 절단 캡처(FR-001a/FR-001) 금지", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001ab\ntest('y', () => { assert.ok(1); });\n",
  });
  assert.equal(r.code, 0, r.out); // 무효 태그 → dangling 오탐 없이 커버 0 warn만
  assert.doesNotMatch(r.out, /dangling/);
  assert.match(r.out, /covered:0/);
});
