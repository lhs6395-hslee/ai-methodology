// @covers SPEC-004/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { gateOutcome } from "../sdd-sync.mjs";

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
    "sdd/specs/SPEC-001.md": "**Module**: `m`  **Spec**: `SPEC-001`  **Status**: Active\n**FR-001** The system SHALL create an item.\n**Given** x **When** y **Then** z\n## Ownership\n- **Entities**: a\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 2026-07-05 이웃 없음: 단독 spec\n",
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
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n**FR-001** The system SHALL create an item.\n**Given** x **When** y **Then** z\n## Ownership\n- **Entities**: a\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir);
  assert.match(r.out, /check-spec-sync\.mjs/);
});

// ── 게이트 결과 판정 코어(감사 M-8 + 무음 미실행) ──
// @covers SPEC-004/FR-001
test("gateOutcome: 판정 줄만 있는 green stdout → flagged 아님(러너 텍스트 오독 금지)", () => {
  const o = gateOutcome({ file: "check-test-run.mjs", stdout: "테스트 실행 게이트 — commands.test green (runTestsPolicy:hard)\n" });
  assert.equal(o.flagged, false);
  assert.match(o.summary, /green/);
});

// @covers SPEC-004/FR-001
test("gateOutcome: 출력 0줄 → clean 아니라 flagged(무음 미실행 — exit 0 ≠ 판정함)", () => {
  for (const stdout of ["", "   \n\n"]) {
    const o = gateOutcome({ file: "check-test-run.mjs", stdout });
    assert.equal(o.flagged, true, `빈 출력은 미판정으로 표면화돼야 함: ${JSON.stringify(stdout)}`);
    assert.match(o.summary, /출력 없음|미판정|무음/);
  }
});

// @covers SPEC-004/FR-001
test("gateOutcome: detector 부재 → flagged(판정 없음 — 배선 갱신 요구)", () => {
  const o = gateOutcome({ file: "check-policy-ratchet.mjs", missing: true });
  assert.equal(o.flagged, true);
  assert.match(o.summary, /없음: check-policy-ratchet\.mjs/);
});

// @covers SPEC-004/FR-001
test("gateOutcome: ⚠/✗ 있는 stdout → flagged / 크래시는 stdout 판정 줄 우선", () => {
  assert.equal(gateOutcome({ file: "g.mjs", stdout: "⚠ 위반 1건\n요약 줄\n" }).flagged, true);
  const crashed = gateOutcome({ file: "g.mjs", crashed: true, stdout: "✗ 위반 요약\n", stderr: "Error: boom\n" });
  assert.equal(crashed.flagged, true);
  assert.match(crashed.summary, /✗ 위반 요약/);
  assert.match(gateOutcome({ file: "g.mjs", crashed: true, stdout: "", stderr: "Error: boom\n" }).summary, /boom/);
});

// 회귀(감사 M-8): green인 R5가 ⚠로 읽히던 것 — 게이트 stdout에 러너 텍스트가 섞이면 재발한다.
// @covers SPEC-004/FR-001
test("R5 e2e: 러너가 ⚠/✗를 출력해도 green이면 R5는 clean(초록이 경고로 읽히지 않음)", () => {
  const dir = fixture({});
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", scanDirs: ["src"], runTestsPolicy: "hard",
    commands: { test: "printf '⚠ 러너 경고 텍스트\\n✗ 러너 실패 텍스트\\n'" },
  }));
  const rep = JSON.parse(run(dir, ["--json"]).out);
  const r5 = rep.rules.find((x) => x.id === "R5");
  assert.equal(r5.flagged, false, `R5가 러너 텍스트에 걸려 flagged됨: ${JSON.stringify(r5)}`);
  assert.match(r5.gates[0].summary, /green/);
});

// @covers SPEC-004/FR-009
test("--json → 기계 판독 리포트(스키마 v1·rule id·게이트·내부 정합), 사람 텍스트 누출 0", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Module**: `m`  **Spec**: `SPEC-001`  **Status**: Active\n**FR-001** The system SHALL create an item.\n**Given** x **When** y **Then** z\n## Ownership\n- **Entities**: a\n- **Capabilities**: a.create\n## Success Criteria\n- **SC-001**: 90%\n## Review Log\n| 2026-07-05 | 리뷰 | PASS |\n## Dedup-Review\n- 2026-07-05 이웃 없음: 단독 spec\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir, ["--json"]);
  assert.equal(r.code, 0);
  const rep = JSON.parse(r.out); // 사람 텍스트가 섞이면 여기서 throw
  assert.equal(rep.schemaVersion, 1);
  assert.equal(typeof rep.clean, "boolean");
  assert.ok(Array.isArray(rep.flaggedRules));
  assert.deepEqual(rep.rules.map((x) => x.id), ["R1", "R2", "R3", "R5", "R6", "R7"]);
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
