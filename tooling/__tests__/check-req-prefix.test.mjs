// tooling/__tests__/check-req-prefix.test.mjs
// requirementIdPrefixes 일반화 — 전 파싱 사이트(coverage 선언·@covers, cohesion 집계,
// completeness 면제)가 config 파생 문법 하나를 공유하는지 엔드투엔드로 검증.
// 사이트 하나라도 하드코딩(FR-)으로 남으면 여기서 회귀로 잡힌다.
// @covers SPEC-002/FR-001
// @covers SPEC-002/FR-003
// @covers SPEC-002/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 키트 자기 게이트가 이 파일도 스캔하므로 픽스처 태그는 이어붙여 중화한다.
const TAG = "// @cov" + "ers ";

function run(gate, files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-req-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"], ...config }));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
  const GATE = new URL(`../${gate}`, import.meta.url).pathname;
  try {
    const out = execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const REQ_CFG = { requirementIdPrefixes: ["FR", "NFR"] };

test("coverage: 커스텀 접두어(NFR) 선언·@covers 양쪽 인정 — dangling 아님", () => {
  const r = run("check-fr-coverage.mjs", {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **NFR-001** (ubiquitous): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/NFR-001\ntest('y', () => { assert.ok(1); });\n",
  }, REQ_CFG);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /dangling/);
  assert.match(r.out, /FRs:1 covered:1/); // 선언 사이트도 NFR-001을 집계해야 함(조용한 누락 금지)
});

test("coverage: 미등록 요구 접두어(QR) 태그는 통째 불인정 — 절단·오귀속 없음", () => {
  const r = run("check-fr-coverage.mjs", {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/QR-001\ntest('y', () => { assert.ok(1); });\n",
  }, REQ_CFG);
  assert.equal(r.code, 0, r.out); // 무효 태그 → 커버 0 warn만(dangling 오탐 금지)
  assert.doesNotMatch(r.out, /dangling/);
  assert.match(r.out, /covered:0/);
});

test("cohesion: 커스텀 접두어 요구도 FR 수 집계에 포함 — 과다 신호 누락 금지", () => {
  const frs = Array.from({ length: 8 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const r = run("check-spec-cohesion.mjs", {
    "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n**NFR-001** y\n`,
  }, REQ_CFG);
  assert.equal(r.code, 0);
  assert.match(r.out, /SPEC-001/); // 9개 > 8 과다 신호에 spec이 지목돼야 함
});

test("completeness: 커스텀 접두어 요구만 있는 spec도 SC·인수조건 검사 대상(면제 오판 금지)", () => {
  const r = run("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **NFR-001** (ubiquitous): THE SYSTEM SHALL y.\n",
  }, REQ_CFG);
  assert.equal(r.code, 0);
  assert.match(r.out, /SC/); // FR(요구) 있음 → SC 부재 warn이 나와야 함
});

test("기본 config(requirementIdPrefixes 미설정)에선 FR만 인정 — 하위호환", () => {
  const r = run("check-fr-coverage.mjs", {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **NFR-001** (ubiquitous): THE SYSTEM SHALL y.\n- **FR-001** (event): THE SYSTEM SHALL x.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001\ntest('x', () => { assert.ok(1); });\n",
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /FRs:1 covered:1/); // NFR-001은 미집계(기본 문법 유지)
});
