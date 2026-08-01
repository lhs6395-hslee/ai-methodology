// tooling/__tests__/evidence.test.mjs — 실행 증거 등급 (SPEC-031)
// `[검증]`을 실행 가능한 증거 경로로 강제 — 산문 자기신고로 충족되지 않게(실측: 게이트 전종
// green인데 대시보드 패널 30여 개 사망, 렌더 확인 코드 0줄).
// @covers SPEC-031/FR-001
// @covers SPEC-031/FR-002
// @covers SPEC-031/FR-003
// @covers SPEC-031/FR-004
// @covers SPEC-031/FR-005
// @covers SPEC-031/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvidenceTag, hasExecutionVerb, isBrowserGradeEvidence, evidenceFindings } from "../evidence-lib.mjs";

const GATE = new URL("../check-evidence.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("parseEvidenceTag: 경로 있음=exec / 빈 [검증]=bare / 서술=self / [미확인]=unknown", () => {
  assert.deepEqual(parseEvidenceTag("- **FR-001** x [검증: tests/a.e2e.ts]"), { kind: "exec", paths: ["tests/a.e2e.ts"] });
  assert.deepEqual(parseEvidenceTag("[검증: a.ts, b.ts]"), { kind: "exec", paths: ["a.ts", "b.ts"] });
  assert.deepEqual(parseEvidenceTag("- **FR-002** y [검증]"), { kind: "bare", paths: [] });
  assert.equal(parseEvidenceTag("[검증 — 코드 실측]").kind, "self");
  assert.equal(parseEvidenceTag("[미확인]").kind, "unknown");
  assert.equal(parseEvidenceTag("태그 없음"), null);
});

test("hasExecutionVerb: 실행 동사 부분일치 — '재생성'은 오탐하지 않는다(기본 어휘 제외)", () => {
  assert.equal(hasExecutionVerb("각 대시보드가 값을 렌더한다", []), true);
  assert.equal(hasExecutionVerb("API가 200으로 응답한다", []), true);
  assert.equal(hasExecutionVerb("재생성 매니페스트가 동일하다", []), false); // 실측 거짓양성 회귀
  assert.equal(hasExecutionVerb("모든 케이스가 통과한다", []), false);
});

test("isBrowserGradeEvidence: e2e·playwright 류만 브라우저 등급", () => {
  assert.equal(isBrowserGradeEvidence("tests/e2e/dash.spec.ts", []), true);
  assert.equal(isBrowserGradeEvidence("scripts/playwright-check.mjs", []), true);
  assert.equal(isBrowserGradeEvidence("tests/api/dash.test.ts", []), false);
});

test("evidenceFindings: bare·missing-asset·exec-verb·browser 4종 판정", () => {
  const exists = (p) => p === "tests/e2e/ok.spec.ts";
  const units = [{ specId: "INFRA-005", claims: [
    { id: "FR-017", kind: "FR", text: "- **FR-017** dashboards [검증]" },
    { id: "FR-018", kind: "FR", text: "- **FR-018** x [검증: tests/none.ts]" },
    { id: "SC-002", kind: "SC", text: "- **SC-002**: 각 대시보드가 값을 렌더한다." },
    { id: "SC-003", kind: "SC", text: "- **SC-003**: 대시보드가 렌더한다 [검증: tests/e2e/ok.spec.ts]" },
  ] }];
  const f = evidenceFindings(units, exists, {});
  assert.deepEqual(f.map((x) => [x.claimId, x.finding]), [
    ["FR-017", "bare-tag"],
    ["FR-018", "missing-asset"],
    ["SC-002", "exec-verb-no-evidence"],
  ]); // SC-003은 브라우저 등급 증거라 무위반
});

test("evidenceFindings: UI 주장 + API 단독 증거 → browser-needs-ui-evidence (실측 교훈)", () => {
  const units = [{ specId: "INFRA-005", claims: [
    { id: "SC-002", kind: "SC", text: "- **SC-002**: 대시보드가 렌더한다 [검증: tests/api/query.test.ts]" },
  ] }];
  const f = evidenceFindings(units, () => true, {});
  assert.equal(f.length, 1);
  assert.equal(f[0].finding, "browser-needs-ui-evidence");
});

// ── 게이트 e2e ──

function fixture(cfg, specs, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-ev-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  for (const [rel, body] of Object.entries(extra)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  for (const [n, b] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", n), b);
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: off → 판정 안 함 / advisory → ⚠ exit 0 / hard → ✗ exit 1 (수용 기준 1)", () => {
  const spec = { "INFRA-005.md": "**Spec**: `INFRA-005`\n- **FR-001** dashboards [검증]\n" };
  const off = run(fixture({}, spec));
  assert.equal(off.code, 0); assert.match(off.out, /off \(판정 안 함\)/);
  const adv = run(fixture({ executionEvidencePolicy: "advisory" }, spec));
  assert.equal(adv.code, 0); assert.match(adv.out, /bare-tag/);
  const hard = run(fixture({ executionEvidencePolicy: "hard" }, spec));
  assert.equal(hard.code, 1); assert.match(hard.out, /INFRA-005\] FR-001 \(bare-tag\)/);
});

test("게이트: SC 실행 동사 + 증거 없음 → 표면화 (수용 기준 2) / 증거 있으면 통과", () => {
  const bad = run(fixture({ executionEvidencePolicy: "advisory" },
    { "INFRA-005.md": "**Spec**: `INFRA-005`\n- **SC-002**: 데이터소스에서 값을 렌더한다.\n" }));
  assert.match(bad.out, /SC-002 \(exec-verb-no-evidence\)/);
  const ok = run(fixture({ executionEvidencePolicy: "hard" },
    { "INFRA-005.md": "**Spec**: `INFRA-005`\n- **SC-002**: 렌더한다 [검증: tests/e2e/d.spec.ts]\n" },
    { "tests/e2e/d.spec.ts": "// e2e" }));
  assert.equal(ok.code, 0, ok.out);
});

test("게이트: 표 행(Change Log)의 [검증] 언급은 주장이 아니므로 제외(킷 자기적용 회귀)", () => {
  const r = run(fixture({ executionEvidencePolicy: "hard" },
    { "SPEC-001.md": "**Spec**: `SPEC-001`\n## Change Log\n| 2026-07-05 | 재도출 비교[검증]에서 발견 | 근거 |\n" }));
  assert.equal(r.code, 0, r.out);
});

test("게이트: 글롭 증거 경로 인정 / enum 밖 정책 → exit 1", () => {
  const glob = run(fixture({ executionEvidencePolicy: "hard" },
    { "S.md": "**Spec**: `SPEC-001`\n- **FR-001** x [검증: tests/e2e/*.spec.ts]\n" },
    { "tests/e2e/a.spec.ts": "// e2e" }));
  assert.equal(glob.code, 0, glob.out);
  const bad = run(fixture({ executionEvidencePolicy: "strict" }, { "S.md": "**Spec**: `SPEC-001`\n" }));
  assert.equal(bad.code, 1);
  assert.match(bad.out, /executionEvidencePolicy 값 위반/);
});
