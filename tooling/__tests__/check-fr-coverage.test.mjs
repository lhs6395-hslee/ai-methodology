// tooling/__tests__/check-fr-coverage.test.mjs
// @covers SPEC-002/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE = new URL("../check-fr-coverage.mjs", import.meta.url).pathname;
// 키트 자기 게이트가 이 파일도 스캔하므로 픽스처 태그는 이어붙여 중화한다.
const TAG = "// @cov" + "ers ";

function run(files, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-frc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"] }));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("레터 서픽스 FR(FR-001a): 선언·태그 양쪽에서 인정 — dangling 아님", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001a\ntest('y', () => { assert.ok(1); });\n",
  });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /dangling/);
  assert.match(r.out, /FRs:1 covered:1/); // 스펙 측 FR_DECL도 FR-001a를 FR로 집계해야 함
});

test("2자 서픽스(FR-001ab) 태그는 통째 불인정 — 절단 캡처(FR-001a/FR-001) 금지", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001a** (event): THE SYSTEM SHALL y.\n",
    "src/a.test.mjs": TAG + "SPEC-001/FR-001ab\ntest('y', () => { assert.ok(1); });\n",
  });
  assert.equal(r.code, 0, r.out); // 무효 태그 → dangling 오탐 없이 커버 0 warn만
  assert.doesNotMatch(r.out, /dangling/);
  assert.match(r.out, /covered:0/);
});

// ── FR 번호 무결성 배선(SPEC-014 FR-005/006) ──
// FR 선언을 이미 파싱하는 게이트에 얹는다(자체 정규식 없음 — cfg.__frDeclRe 단일 문법).

// @covers SPEC-014/FR-005
test("FR 번호 중복(한 스펙에 FR-023 2회) → exit 1 (PM tool 실측 재현: 두 브랜치 동시 추가가 어떤 게이트에도 안 걸렸다)", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n"
      + "- **FR-023** (event): THE SYSTEM SHALL a.\n- **FR-024** (event): THE SYSTEM SHALL b.\n"
      + "- **FR-023** (event): THE SYSTEM SHALL c.\n",
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SPEC-001\/FR-023 FR 번호 중복/);
});

// @covers SPEC-014/FR-006
test("FR-001 미시작·중간 결번 → advisory(exit 0), --strict에서 hard 승격", () => {
  const files = {
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n"
      + "- **FR-005** (event): THE SYSTEM SHALL a.\n- **FR-007** (event): THE SYSTEM SHALL b.\n",
  };
  const soft = run(files);
  assert.equal(soft.code, 0, soft.out);
  assert.match(soft.out, /FR 번호가 001부터 시작하지 않음 — 최소 FR-005/);
  assert.match(soft.out, /중간 결번: FR-006/);
  const strict = run(files, ["--strict"]);
  assert.equal(strict.code, 1, strict.out);
  assert.match(strict.out, /중간 결번: FR-006/);
});

// @covers SPEC-014/FR-005
test("스펙별 독립 판정 — 스펙 A의 FR-001과 스펙 B의 FR-001은 중복 아님(SPEC-ID가 네임스페이스)", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): THE SYSTEM SHALL a.\n",
    "sdd/specs/SPEC-002.md": "**Spec**: `SPEC-002`\n- **FR-001** (event): THE SYSTEM SHALL b.\n",
  });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /번호 중복/);
});
