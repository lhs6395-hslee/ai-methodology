// tooling/__tests__/check-spec-consistency.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(specBody, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-cons-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  writeFileSync(join(root, "sdd", "specs", "SPEC-001.md"), specBody);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-spec-consistency.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("본문에 근거 있는 키는 clean", () => {
  const body = "# SPEC-001\nWHEN 조회, THE SYSTEM SHALL recommendation을 반환.\n## Ownership\n- **Entities**: recommendation\n";
  const r = run(body);
  assert.equal(r.code, 0);
  assert.match(r.out, /clean|OK|근거/);
});

test("본문 어디에도 없는 키는 advisory 경고(exit 0)", () => {
  const body = "# SPEC-001\nWHEN 조회, THE SYSTEM SHALL 결과 반환.\n## Ownership\n- **Entities**: ghostentity\n";
  const r = run(body);
  assert.equal(r.code, 0);              // advisory
  assert.match(r.out, /ghostentity/);
});

test("--strict에서 근거 없는 키는 exit 1", () => {
  const body = "# SPEC-001\nSHALL 결과 반환.\n## Ownership\n- **Entities**: ghostentity\n";
  assert.equal(run(body, ["--strict"]).code, 1);
});
