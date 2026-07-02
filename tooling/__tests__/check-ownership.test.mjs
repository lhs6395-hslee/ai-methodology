// tooling/__tests__/check-ownership.test.mjs
// @covers SPEC-002/FR-002
// @covers SPEC-002/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(specs, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-own-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", capabilityVerbs: ["recommend"],
  }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Dependencies의 키는 dedup 대상이 아니다(거짓양성 해소)", () => {
  // A naive impl that fed ## Dependencies into the dedup map would see SPEC-001
  // "owning" staff (via its Dependencies) AND SPEC-002 owning it → false conflict (exit 1).
  // Correct impl excludes Dependencies → only SPEC-002 owns staff → exit 0.
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n## Dependencies\n- **Entities**: staff\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: staff\n"; // staff를 소유 → A는 참조라 충돌 아님
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 0, r.out);
});

test("같은 Ownership 키를 2 spec이 소유하면 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: Recommendation\n"; // 정규화 후 같은 키
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /recommendation/);
});

test("미등록 verb는 --strict에서 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Capabilities**: staff.suggest\n";
  assert.equal(run({ "SPEC-001.md": A }).code, 0);            // 기본 warn
  assert.equal(run({ "SPEC-001.md": A }, ["--strict"]).code, 1); // strict 차단
});

test("Surface 정규화 후 충돌: 다른 param 문법·메서드 케이스가 같은 키로 수렴", () => {
  const A = "# SPEC-001\n## Ownership\n- **Surfaces**: POST /api/items/:id\n";
  const B = "# SPEC-002\n## Ownership\n- **Surfaces**: post /api/items/{id}/\n"; // normalizes to same key
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
});
