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

// 이슈 #21 M-1: 양방향 부분문자열 매칭이던 판은 짧은 리터럴 선언 토큰("src" 등)이
// 그 문자열을 담은 모든 표면을 조용히 "선언됨"으로 오판정했다(실측: PM 프로젝트 18/23 거짓양성).
test("짧은 리터럴 선언 토큰은 무관한 표면을 오판정하지 않는다(이슈 #21 M-1)", () => {
  const dir = fixture(CFG, {
    "src/app/unrelated/route.ts": "export {};",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /orphans:1/);
  assert.match(r.out, /unrelated\/route\.ts/);
});

test("경로 경계에서 끊기는 접두/접미 선언은 정당하게 인정된다(부분문자열이 아니라 경계)", () => {
  const dir = fixture(CFG, {
    "src/app/api/chat/route.ts": "export function POST() {}",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: api/chat/route.ts\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /orphans:0/);
});

test("글롭 메타문자가 있는 선언은 compileGlob으로 실제 컴파일해 대조한다", () => {
  const dir = fixture(CFG, {
    "src/app/api/chat/route.ts": "export function POST() {}",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src/app/api/*/route.ts\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /orphans:0/);
});
