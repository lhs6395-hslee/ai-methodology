// tooling/__tests__/sc-coverage.test.mjs — SC·NFR 검증 회계 (SPEC-034)
// 회계의 비대칭이 이 게이트의 존재 이유다: FR은 unit∨e2e∨smoke∨deferred로 강제 회계되는데
// SC·NFR은 산문으로만 있어 성능·보안 목표가 검증 없이 green이었다(실측 제보 — 부하·침투
// 테스트 산출물이 어느 스펙에도 귀속되지 못하고 scratchpad에 남았다).
// @covers SPEC-034/FR-001
// @covers SPEC-034/FR-002
// @covers SPEC-034/FR-003
// @covers SPEC-034/FR-004
// @covers SPEC-034/FR-005
// @covers SPEC-034/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileGlob } from "../spec-sync-lib.mjs";
import {
  parseScLine, kindOfPointer, validateEvidenceManifest, classifyScCoverage,
  scDeclDrift,
} from "../sc-coverage-lib.mjs";

const GATE = fileURLToPath(new URL("../check-sc-coverage.mjs", import.meta.url));
const matcher = (re, p) => re.test(String(p).replace(/^\.\//, ""));
const compile = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.map(compileGlob)]));

// ── 순수 코어 ──

test("parseScLine: SC·NFR 선언만 인식, 태그·[미확인] 추출, 코드 스팬은 인용", () => {
  assert.deepEqual(parseScLine("- **SC-001**: 스위트 green. [검증: src/a.test.ts]"),
    { id: "SC-001", kindOfId: "SC", pointer: "src/a.test.ts", unknown: false });
  assert.deepEqual(parseScLine("- **NFR-002**: 판정 코어는 순수 함수. [미확인]"),
    { id: "NFR-002", kindOfId: "NFR", pointer: "", unknown: true });
  assert.equal(parseScLine("- **FR-001** The system SHALL x."), null);   // FR은 대상 아님
  assert.equal(parseScLine("| SC-001 | 표 행 |"), null);                  // 표 행도 아님
  // 실측 제보: 분류 접미가 붙은 NFR이 **집계에서 조용히 빠졌다**(미회계로도 안 잡힘).
  // FR 선언 정규식은 EARS 분류 `(event)`를 받는데 SC/NFR만 비일관이었다 — 회계 게이트가 자기 사각을 못 봄.
  assert.deepEqual(parseScLine("- **NFR-001** (security): 침투 High 0건."),
    { id: "NFR-001", kindOfId: "NFR", pointer: "", unknown: false });
  assert.equal(parseScLine("- **SC-002** (performance): p95<300ms. [검증: tests/load/k6.js]").pointer,
    "tests/load/k6.js");
  // 산문이 태그를 흉내내지 못한다 — 코드 스팬 안의 문자열은 인용문이다(SPEC-031·033 동형)
  assert.equal(parseScLine("- **SC-003**: 태그는 `[검증: 경로]` 형식이다.").pointer, "");
});

test("kindOfPointer: 경로가 사는 위치로 종류를 유도, 미매치는 other(미회계 아님)", () => {
  const kinds = compile({ load: ["tests/load/**"], pentest: ["tests/security/**"], unit: ["**/*.test.*"] });
  assert.equal(kindOfPointer("tests/load/k6.js", kinds, matcher), "load");
  assert.equal(kindOfPointer("tests/security/zap.md", kinds, matcher), "pentest");
  assert.equal(kindOfPointer("src/a.test.ts", kinds, matcher), "unit");
  assert.equal(kindOfPointer("docs/somewhere.md", kinds, matcher), "other");
  assert.equal(kindOfPointer("", kinds, matcher), "");
});

test("validateEvidenceManifest: 키 형식·kind·deferred 사유·evidence 존재를 결정적으로 검사", () => {
  const ok = validateEvidenceManifest({
    "SPEC-001/SC-001": { kind: "load", evidence: "docs/evidence/k6.md" },
    "SPEC-001/NFR-001": { kind: "deferred", reason: "WAF 뒤라 CI 실행 불가" },
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.entries.size, 2);
  const bad = validateEvidenceManifest({
    "SPEC-001/FR-001": { kind: "load", evidence: "x" },        // SC/NFR이 아님
    "SPEC-002/SC-001": { kind: "" },                            // kind 없음
    "SPEC-003/SC-001": { kind: "deferred" },                    // 사유 없는 유예
    "SPEC-004/SC-001": { kind: "load" },                        // 증거 없음
  });
  assert.ok(bad.errors.some((e) => /키 형식/.test(e)));
  assert.ok(bad.errors.some((e) => /kind 없음/.test(e)));
  assert.ok(bad.errors.some((e) => /reason 필수/.test(e)));
  assert.ok(bad.errors.some((e) => /evidence 필수/.test(e)));
  assert.equal(bad.entries.size, 0);
});

test("classifyScCoverage: 태그=verified · 매니페스트=evidence|deferred · 둘 다 없음=미회계", () => {
  const kinds = compile({ load: ["tests/load/**"] });
  const { entries } = validateEvidenceManifest({
    "S-001/SC-002": { kind: "pentest", evidence: "docs/e/zap.md" },
    "S-001/SC-003": { kind: "deferred", reason: "가오픈 후" },
  });
  const items = [
    { specId: "S-001", id: "SC-001", pointer: "tests/load/k6.js", unknown: false },
    { specId: "S-001", id: "SC-002", pointer: "", unknown: false },
    { specId: "S-001", id: "SC-003", pointer: "", unknown: false },
    { specId: "S-001", id: "SC-004", pointer: "", unknown: true },   // [미확인]만 = 회계 아님
    { specId: "S-001", id: "NFR-001", pointer: "", unknown: false },
  ];
  const { classes, counts } = classifyScCoverage(items, entries, kinds, matcher);
  assert.deepEqual(counts, { verified: 1, evidence: 1, deferred: 1, unaccounted: 2 });
  assert.equal(classes.get("S-001/SC-001").kind, "load");
  assert.equal(classes.get("S-001/SC-004").kind, "미확인");
});

// ── 게이트 e2e ──

function fixture(cfg, specBody) {
  const root = mkdtempSync(join(tmpdir(), "sdd-sc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"), `**Spec**: \`SPEC-001\`\n${specBody}`);
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: off → 판정 안 함 / 미회계는 advisory ⚠ · hard ✗ + 어느 SC인지 지목", () => {
  const body = "## Success Criteria\n- **SC-001**: 목표만 있고 검증이 없다.\n";
  const off = run(fixture({}, body));
  assert.equal(off.code, 0); assert.match(off.out, /off \(판정 안 함\)/);

  const adv = run(fixture({ scCoveragePolicy: "advisory" }, body));
  assert.equal(adv.code, 0);
  assert.match(adv.out, /SPEC-001\/SC-001 — 검증 바인딩 없음/);
  assert.match(adv.out, /미회계 1/);

  const hard = run(fixture({ scCoveragePolicy: "hard" }, body));
  assert.equal(hard.code, 1);
  assert.match(hard.out, /성능·보안 목표가 검증 없이 통과하는 것이 이 게이트가 막는 것이다/);
});

test("게이트: 부하·침투가 종류로 유도되고 매니페스트 증거·유예가 회계로 인정된다", () => {
  const root = fixture({
    scCoveragePolicy: "hard",
    verificationKinds: { load: ["tests/load/**"], pentest: ["tests/security/**"] },
    evidenceManifest: {
      "SPEC-001/SC-003": { kind: "load", evidence: "docs/evidence/2026-08-02-k6.md" },
      "SPEC-001/NFR-001": { kind: "deferred", reason: "WAF 뒤라 CI에서 실행 불가 — 가오픈 후 실측" },
    },
  }, [
    "## Success Criteria",
    "- **SC-001**: p95<300ms에서 200 RPS 지속. [검증: tests/load/dashboard-k6.js]",
    "- **SC-002**: 미인증 요청은 401. [검증: tests/security/auth-probe.md]",
    "- **SC-003**: 복구 30분 내.",
    "## Non-Functional Requirements",
    "- **NFR-001**: 침투 High 0건.",
    "",
  ].join("\n"));
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /verified 2·evidence 1·deferred 1·미회계 0/);
    assert.match(r.out, /load:2/);      // 태그 1건 + 매니페스트 1건
    assert.match(r.out, /pentest:1/);
    assert.match(r.out, /OK — 모든 SC·NFR이 검증·증거·유예 중 하나로 회계됨/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 매니페스트 무결성 위반은 판정 전 exit 1 / hard인데 대상 0건은 거짓 안전", () => {
  const badM = run(fixture({ scCoveragePolicy: "advisory", evidenceManifest: { "SPEC-001/SC-001": { kind: "deferred" } } },
    "## Success Criteria\n- **SC-001**: x.\n"));
  assert.equal(badM.code, 1);
  assert.match(badM.out, /reason 필수/);

  const inert = run(fixture({ scCoveragePolicy: "hard" }, "본문에 SC 선언이 없다.\n"));
  assert.equal(inert.code, 1);
  assert.match(inert.out, /판정 대상이 없다\(거짓 안전\)/);

  const badPolicy = run(fixture({ scCoveragePolicy: "strict" }, "- **SC-001**: x.\n"));
  assert.equal(badPolicy.code, 1);
  assert.match(badPolicy.out, /scCoveragePolicy 값 위반/);
});

test("선언 형식 드리프트를 표면화한다 — 놓친 것이 경고 없이 사라지는 것이 결함이었다", () => {
  // 실측 제보의 요지는 "정규식이 한 형태를 놓쳤다"가 아니라 "놓친 것이 조용히 빠졌다"였다.
  const text = [
    "- **SC-001**: ok",
    "- **NFR-001** (security): 분류 접미는 정상 선언이다",
    "**SC-002** 90%",                                  // 불릿·콜론 없음 → 회계에서 빠진다
    "| 2026-08-10 | **SC-003** 신규 | 근거 |",           // 표 행은 이력이지 선언이 아니다
    "산문 중간의 **SC-009**가 그것을 본다",                // 인용은 선언이 아니다(팬텀 방지)
  ].join("\n");
  assert.deepEqual(scDeclDrift(text), [{ id: "SC-002", line: "**SC-002** 90%" }]);
});

test("정상 선언은 드리프트가 아니다 — 분류 접미도 통과한다", () => {
  assert.deepEqual(scDeclDrift("- **SC-001**: a\n* **NFR-002** (performance): b\n"), []);
});
