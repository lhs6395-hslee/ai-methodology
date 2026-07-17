// @covers SPEC-004/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const SYNC = new URL("../sdd-sync.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-sync-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [SYNC, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("clean 프로젝트(FR↔test 커버·중복/과대 없음) → 전부 sync, exit 0", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Module**: `m`  **Spec**: `SPEC-001`  **Status**: Active\n**FR-001** The system SHALL create an item.\n**Given** x **When** y **Then** z\n## Ownership\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 2026-07-05 이웃 없음: 단독 spec\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /R3 dedup.*✓|✓ clean/s);
  assert.match(r.out, /전부 sync|sync ✓/);
});

test("과대 spec(cohesion 위반) → R3 확인 필요, --strict exit 1", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture({ "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const warn = run(dir);
  assert.match(warn.out, /R3 dedup.*확인 필요/s);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("R2에 check-spec-sync(range)가 배선됨", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n**FR-001** The system SHALL create an item.\n**Given** x **When** y **Then** z\n## Ownership\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir);
  assert.match(r.out, /check-spec-sync\.mjs/);
});

// @covers SPEC-004/FR-009
test("--json → 기계 판독 리포트(스키마 v1·rule id·게이트·내부 정합), 사람 텍스트 누출 0", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Module**: `m`  **Spec**: `SPEC-001`  **Status**: Active\n**FR-001** The system SHALL create an item.\n**Given** x **When** y **Then** z\n## Ownership\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 2026-07-05 이웃 없음: 단독 spec\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir, ["--json"]);
  assert.equal(r.code, 0);
  const rep = JSON.parse(r.out); // 사람 텍스트가 섞이면 여기서 throw
  assert.equal(rep.schemaVersion, 1);
  assert.equal(typeof rep.clean, "boolean");
  assert.ok(Array.isArray(rep.flaggedRules));
  assert.deepEqual(rep.rules.map((x) => x.id), ["R1", "R2", "R3", "R5"]);
  for (const rule of rep.rules) {
    assert.equal(typeof rule.title, "string");
    assert.equal(typeof rule.flagged, "boolean");
    assert.ok(Array.isArray(rule.gates) && rule.gates.length > 0);
    for (const g of rule.gates) {
      assert.equal(typeof g.gate, "string");
      assert.equal(typeof g.flagged, "boolean");
      assert.equal(typeof g.summary, "string");
    }
  }
  // 내부 정합: clean ⟺ flaggedRules 빔, rule.flagged ⟺ id ∈ flaggedRules
  assert.equal(rep.clean, rep.flaggedRules.length === 0);
  for (const rule of rep.rules) assert.equal(rule.flagged, rep.flaggedRules.includes(rule.id));
});

// @covers SPEC-004/FR-009
test("--json 위반 프로젝트 → clean:false·flaggedRules 반영, --strict는 exit 1", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture({ "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const rep = JSON.parse(run(dir, ["--json"]).out);
  assert.equal(rep.clean, false);
  assert.ok(rep.flaggedRules.includes("R3"));
  const rule3 = rep.rules.find((x) => x.id === "R3");
  assert.equal(rule3.flagged, true);
  assert.equal(run(dir, ["--json", "--strict"]).code, 1);
});
