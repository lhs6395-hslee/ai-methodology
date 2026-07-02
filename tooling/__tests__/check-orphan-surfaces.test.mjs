// @covers SPEC-003/FR-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-orphan-surfaces.mjs", import.meta.url).pathname;

function fixture(cfg, files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-orph-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify(cfg));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const CFG = { specDir: "sdd/specs", surfaceGlobs: ["src/app/.*/route\\.ts$"] };

test("표면이 스펙 Ownership에 선언돼 있으면 통과", () => {
  const dir = fixture(CFG, {
    "src/app/api/chat/route.ts": "export function POST() {}",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src/app/api/chat/route.ts\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK/);
});

test("스펙에 없는 표면 → advisory 경고(exit 0), strict 실패", () => {
  const dir = fixture(CFG, {
    "src/app/api/orphan/route.ts": "export function GET() {}",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src/app/api/chat/route.ts\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /orphan\/route\.ts/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});
