import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-spec-completeness.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-cmpl-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
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

test("FR + SC + 인수조건 완비 → 통과", () => {
  const dir = fixture({ "sdd/specs/SPEC-001.md":
    "**Spec**: `SPEC-001`\n**FR-001** a\n**Given** x **When** y **Then** z\n## Success Criteria\n- **SC-001**: 정확도 ≥ 90%\n" });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /구비/);
});

test("FR 있는데 SC 없음 → advisory(exit 0), strict 실패", () => {
  const dir = fixture({ "sdd/specs/SPEC-001.md":
    "**Spec**: `SPEC-001`\n**FR-001** a\n**Given** x **When** y **Then** z\n" });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /SC/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("FR 있는데 인수조건 없음 → advisory(exit 0), strict 실패", () => {
  const dir = fixture({ "sdd/specs/SPEC-001.md":
    "**Spec**: `SPEC-001`\n**FR-001** a\n## Success Criteria\n- **SC-001**: 90%\n" });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /인수조건/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("FR 없는 spec(예: 순수 인프라) → 면제, 통과", () => {
  const dir = fixture({ "sdd/specs/INFRA-001.md":
    "**Spec**: `INFRA-001`\n## Infrastructure Prerequisites\n- **IP-001**: 이벤트 로그 필요\n" });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /구비|검사/);
});
