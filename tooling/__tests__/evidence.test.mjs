// tooling/__tests__/evidence.test.mjs — 실행 증거 등급 (SPEC-031)
// `[검증]`을 실행 가능한 증거 경로로 강제 — 산문 자기신고로 충족되지 않게(실측: 게이트 전종
// green인데 대시보드 패널 30여 개 사망, 렌더 확인 코드 0줄).
// @covers SPEC-031/FR-001
// @covers SPEC-031/FR-002
// @covers SPEC-031/FR-003
// @covers SPEC-031/FR-004
// @covers SPEC-031/FR-005
// @covers SPEC-031/FR-006
// @covers SPEC-031/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEvidenceTag, hasExecutionVerb, isBrowserGradeEvidence, evidenceFindings , markerHits, isDeployGradeEvidence, DEFAULT_DEPLOY_EVIDENCE_PATTERNS } from "../evidence-lib.mjs";

const GATE = fileURLToPath(new URL("../check-evidence.mjs", import.meta.url));

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

// 실측 제보(소비 프로젝트 finops): 부분일치가 흔한 단어를 대량 오탐했다 — `page`→`TicketPackage`,
// `UI`→`REQUIRED`(q-ui-red)·`pricing-guide`(g-ui-de). 순수 백엔드 스펙의 FR 7건 중 4건이
// "UI 대상인데 증거가 브라우저 등급 아님"으로 표면화됐다. 마커를 지우면 진짜 UI 주장을 놓치므로
// 지우는 대신 **경계로 좁힌다**(킷이 `재생`을 뺀 것과 같은 판단, 다른 처방).
// @covers SPEC-031/FR-004
test("markerHits: ASCII 마커는 단어 경계 — 부분일치 오탐 차단, 한글은 부분일치 유지", () => {
  assert.equal(markerHits("ticketpackage 분류 규칙", "page"), false);   // 실측 오탐 ①
  assert.equal(markerHits("required 필드 검증", "ui"), false);          // 실측 오탐 ②
  assert.equal(markerHits("pricing-guide 문서", "ui"), false);          // 실측 오탐 ③
  assert.equal(markerHits("the page renders", "page"), true);           // 진짜 주장은 살린다
  assert.equal(markerHits("결과 page", "page"), true);
  assert.equal(markerHits("ui 표시", "ui"), true);
  assert.equal(markerHits("admin-ui 화면", "ui"), true);                // 구분자 경계도 인정
  // 한글 마커 — 교착어라 경계가 성립하지 않으므로 부분일치 유지(실측 충돌 없음)
  assert.equal(markerHits("대시보드에 표시된다", "대시보드"), true);
  assert.equal(markerHits("화면을 렌더", "화면"), true);
});

// ── 본문 ↔ 회계 매니페스트 대조 (FR-007) ──
// 본문과 매니페스트는 같은 주장에 대한 **두 개의 선언**인데 그동안 아무도 둘을 대조하지 않았다
// (실측 제보: `[미확인]`으로 선언된 FR이 smokeManifest엔 실측 증거를 갖고 있었고, 어느 게이트도
// 그 모순을 판정하지 않아 "정직한 미확인"과 "회계된 검증"이 동시에 참인 채로 통과했다).
// 게이트는 어느 쪽이 맞는지 모른다 — 모순을 지목하고 하나를 고치게 한다.

test("게이트: `[미확인]` ↔ 매니페스트 실측 주장은 모순으로 표면화, deferred는 모순 아님", () => {
  const specs = {
    "INFRA-005.md": [
      "**Spec**: `INFRA-005`",
      "- **FR-001** The system SHALL render panels. [미확인]",
      "- **FR-002** The system SHALL rotate keys. [미확인]",
      "- **SC-001**: 침투 High 0건. [미확인]",
      "",
    ].join("\n"),
  };
  const root = fixture({
    executionEvidencePolicy: "hard",
    smokeManifest: "sdd/smoke.json",
    evidenceManifest: { "INFRA-005/SC-001": { kind: "pentest", evidence: "docs/e/zap.md" } },
  }, specs, {
    "sdd/smoke.json": JSON.stringify({
      "INFRA-005/FR-001": { method: "manual-smoke", evidence: "docs/e/2026-08-02.md" },
      "INFRA-005/FR-002": { method: "deferred", reason: "관리형 KMS라 CI에서 회전 불가" },
    }),
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /FR-001 \(unknown-vs-manifest\)/);
    assert.match(r.out, /smokeManifest는 실측 증거를 주장한다\(manual-smoke\)/);
    assert.match(r.out, /SC-001 \(unknown-vs-manifest\)/);
    assert.match(r.out, /evidenceManifest는 실측 증거를 주장한다\(pentest\)/);
    // deferred는 `[미확인]`과 같은 말이다 — 모순이 아니다
    assert.doesNotMatch(r.out, /FR-002/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 본문에 실행 증거가 있는데 매니페스트에도 엔트리면 이중 회계로 표면화", () => {
  const root = fixture({
    executionEvidencePolicy: "advisory",
    smokeManifest: "sdd/smoke.json",
  }, {
    "INFRA-006.md": "**Spec**: `INFRA-006`\n- **FR-001** The system SHALL sync. [검증: tests/sync.test.ts]\n",
  }, {
    "tests/sync.test.ts": "// asset\n",
    "sdd/smoke.json": JSON.stringify({ "INFRA-006/FR-001": { method: "manual-smoke", evidence: "docs/e/x.md" } }),
  });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /FR-001 \(manifest-vs-tag\)/);
    assert.match(r.out, /매니페스트는 \*\*실행할 수 없는 검증\*\*의 회계 수단이다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 배포 등급 증거(제보 ④) — "단위테스트 통과"와 "배포본에서 실제 실행됨"은 다른 사실이다 ──
test("배포 등급 판정 — smoke·e2e·live·runbook은 등급이고 단위테스트 경로는 아니다", () => {
  const P = DEFAULT_DEPLOY_EVIDENCE_PATTERNS;
  assert.equal(isDeployGradeEvidence("tests/smoke/deploy.sh", P), true);
  assert.equal(isDeployGradeEvidence("sdd/verification/RUNBOOK-deploy.md", P), true);
  assert.equal(isDeployGradeEvidence("tests/unit/image.test.ts", P), false);
});

test("트리거는 **소유 + 주장** 둘 다다 — 배포를 다루기만 하는 스펙은 단위테스트가 정답 증거다", () => {
  const claims = [{ id: "SC-001", kind: "SC", text: "- **SC-001**: 러너 이미지가 노드에서 뜬다. [검증: tests/unit/x.test.ts]" }];
  // ① 소유 없음 + 마커 있음 → 발화하지 않는다(킷 시운전 실측: 마커만 걸면 31건 과발화).
  const noOwn = evidenceFindings([{ specId: "S1", claims, ownsDeployArtifact: false }], () => true);
  assert.equal(noOwn.filter((f) => f.finding === "deploy-needs-live-evidence").length, 0);
  // ② 소유 있음 + 마커 있음 + 단위테스트 증거 → 등급 미달로 표면화.
  const own = evidenceFindings([{ specId: "S1", claims, ownsDeployArtifact: true }], () => true);
  const hit = own.filter((f) => f.finding === "deploy-needs-live-evidence");
  assert.equal(hit.length, 1);
  assert.match(hit[0].detail, /저장소 안 단위테스트는 배포본의 아치·이미지 내용·전제 자원에 닿지 않는다/);
});

test("배포 등급 증거를 대면 통과한다 — 막는 것은 등급 미달이지 배포 주장 자체가 아니다", () => {
  const claims = [{ id: "SC-001", kind: "SC", text: "- **SC-001**: 러너 이미지가 노드에서 뜬다. [검증: tests/smoke/qa-image.sh]" }];
  const r = evidenceFindings([{ specId: "S1", claims, ownsDeployArtifact: true }], () => true);
  assert.equal(r.filter((f) => f.finding === "deploy-needs-live-evidence").length, 0);
});

test("등급은 경로 또는 매니페스트 method로 성립한다 — 등급 때문에 증거 파일을 쪼개지 않는다", () => {
  // 실측 제보: pipeline·runtime·browser 증거가 한 파일에 섞이면 UI 주장이 등급을 못 받아
  // 파일을 물리적으로 분리해야 했다. `@verifies` 태그가 이미 method를 명시하고, 태그↔매니페스트
  // 드리프트는 sdd-smoke-scan이 대조하므로 method는 **다른 축이 검산하는 선언**이다.
  const units = [{ specId: "SPEC-001", claims: [{ id: "FR-001", kind: "FR", text: "대시보드 화면을 렌더한다 [검증: docs/OPERATIONS.md]" }] }];
  const exists = () => true;
  // ① method 없음 → 경로가 브라우저 등급이 아니라 표면화
  const bare = evidenceFindings(units, exists);
  assert.equal(bare.filter((f) => f.finding === "browser-needs-ui-evidence").length, 1);
  // ② 매니페스트가 browser_smoke를 증언하면 등급이 성립한다
  const withMethod = evidenceFindings(units, exists, {
    manifestOf: () => ({ source: "smokeManifest", method: "browser_smoke" }),
  });
  assert.equal(withMethod.filter((f) => f.finding === "browser-needs-ui-evidence").length, 0);
  // ③ 무관한 method는 등급을 주지 않는다 — 아무 라벨이나 통과시키면 라벨이 면제가 된다
  const wrongMethod = evidenceFindings(units, exists, {
    manifestOf: () => ({ source: "smokeManifest", method: "pipeline" }),
  });
  assert.equal(wrongMethod.filter((f) => f.finding === "browser-needs-ui-evidence").length, 1);
});
