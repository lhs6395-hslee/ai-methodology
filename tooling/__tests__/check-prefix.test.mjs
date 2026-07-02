// tooling/__tests__/check-prefix.test.mjs
// @covers SPEC-002/FR-006
// @covers SPEC-002/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-pfx-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(root, "sdd", "specs", n), b);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-fr-coverage.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("표준 밖 접두어(FEAT)는 조용히 건너뛰지 않고 exit 1", () => {
  const r = run({ "FEAT-001.md": "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FEAT/);
});

test("사유(prefixRationale) 있으면 FEAT 통과", () => {
  const r = run(
    { "FEAT-001.md": "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n" },
    { specIdPrefixes: ["SPEC","INFRA","TEST","FEAT"], prefixRationale: { FEAT: "레거시 마법사 기능군" } }
  );
  assert.equal(r.code, 0); // PREFIX 사유는 통과(FR 커버리지 warn은 별개)
});

test("표준 접두어(SPEC/INFRA/TEST)는 정상", () => {
  const r = run({ "INFRA-001.md": "# INFRA-001\n인프라 spec.\n" });
  assert.equal(r.code, 0);
});

test("bare config(specIdPrefixes 없음)에서 INFRA-001은 하위호환(정상)", () => {
  const r = run({ "INFRA-001.md": "# INFRA-001\n인프라 spec.\n" }, {});
  // No specIdPrefixes key → loadConfig fills DEFAULTS.specIdPrefixes = ["SPEC","INFRA","TEST"]
  // → INFRA-001 등록됨 → exit 0
  assert.equal(r.code, 0, r.out);
});
