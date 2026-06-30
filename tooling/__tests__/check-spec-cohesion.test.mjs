import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-spec-cohesion.mjs", import.meta.url).pathname;

function fixture(cfg, files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-coh-"));
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
const CFG = { specDir: "sdd/specs", maxKeysPerCategoryPerSpec: 4, maxFRsPerSpec: 8 };

test("응집된 spec(키·FR 기준 내) → 통과", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n**FR-002** b\n## Ownership\n- **Capabilities**: a.create, a.update\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /분할 권고 없음/);
});

test("FR 과다(>8) → advisory(exit 0), strict 실패", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture(CFG, { "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /SPEC-001/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("카테고리 키 과다(Capabilities 5>4) → advisory(exit 0), strict 실패", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Capabilities**: a.c, a.d, a.e, a.f, a.g\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /Capabilities/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});
