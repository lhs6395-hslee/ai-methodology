// tooling/__tests__/jenkins-renderer.test.mjs — sdd.pipeline.config.json → Jenkinsfile (SPEC-059)
// @covers SPEC-059/FR-006
// @covers SPEC-059/FR-007
// @covers SPEC-059/FR-008
// @covers SPEC-059/FR-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderJenkinsfile } from "../pipeline-renderers/jenkins-renderer.mjs";
import { buildPipelineConfig } from "../pipeline-setup-lib.mjs";

const RENDERER = new URL("../pipeline-renderers/jenkins-renderer.mjs", import.meta.url).pathname;

const MULTI_CONFIG = buildPipelineConfig({
  deployBranch: "main",
  environments: ["dev", "prod"],
  artifactType: "container",
  deployTarget: "kubernetes",
  sourcePathGuards: ["package.json", "Dockerfile"],
  promotions: [
    {
      to: "dev",
      deployWindow: { enabled: false },
      qualityGates: { lint: "pre-push", unit: "ci" },
      migrations: { included: false },
      deployEvidence: ["build-log"],
    },
    {
      to: "prod",
      deployWindow: { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC" },
      qualityGates: { e2e: "ci" },
      migrations: { included: true, approval: "manual" },
      deployEvidence: ["healthcheck", "image-tag"],
    },
  ],
});

test("renderJenkinsfile: 승격 지점마다 stage가 독립 반복 생성된다", () => {
  const text = renderJenkinsfile(MULTI_CONFIG);
  assert.match(text, /stage\('승격: main→dev'\)/);
  assert.match(text, /stage\('승격: dev→prod'\)/);
  // 2번째 승격에만 배포 시간창 게이트가 있어야 한다.
  const devBlock = text.slice(text.indexOf("승격: main→dev"), text.indexOf("승격: dev→prod"));
  const prodBlock = text.slice(text.indexOf("승격: dev→prod"));
  assert.ok(!/배포 시간창/.test(devBlock));
  assert.match(prodBlock, /배포 시간창 — dev→prod/);
  // 마이그레이션은 prod 승격에만.
  assert.ok(!/DB 마이그레이션/.test(devBlock));
  assert.match(prodBlock, /DB 마이그레이션 — dev→prod/);
});

test("renderJenkinsfile: 배포창 게이트는 경로 가드 스테이지보다 뒤에 온다", () => {
  const text = renderJenkinsfile(MULTI_CONFIG);
  const guardIdx = text.indexOf("stage('경로 가드')");
  const windowIdx = text.indexOf("배포 시간창 — dev→prod");
  assert.ok(guardIdx >= 0 && windowIdx >= 0);
  assert.ok(guardIdx < windowIdx);
});

test("renderJenkinsfile: ephemeralAgent가 false면 자가조달 블록이 없고, true/unknown이면 있다(안전측 포함)", () => {
  const withUnknown = renderJenkinsfile(buildPipelineConfig({ deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes", promotions: [] }));
  assert.match(withUnknown, /Node 자가조달/);

  const knownFalse = renderJenkinsfile(buildPipelineConfig({ deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes", ephemeralAgent: false, promotions: [] }));
  assert.ok(!/Node 자가조달/.test(knownFalse));

  const knownTrue = renderJenkinsfile(buildPipelineConfig({ deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes", ephemeralAgent: true, promotions: [] }));
  assert.match(knownTrue, /Node 자가조달/);
});

test("renderJenkinsfile: 품질 게이트는 ci로 표시된 것만 나오고 pre-push 항목은 CI에 중복되지 않는다", () => {
  const text = renderJenkinsfile(MULTI_CONFIG);
  const devBlock = text.slice(text.indexOf("승격: main→dev"), text.indexOf("승격: dev→prod"));
  assert.match(devBlock, /npm run unit/);
  assert.ok(!/npm run lint/.test(devBlock)); // lint는 pre-push뿐이라 CI 스테이지엔 없다
});

test("renderJenkinsfile: 인프라 적용 승인 스테이지는 항상 수동 input이다(자동 적용 없음)", () => {
  const text = renderJenkinsfile(MULTI_CONFIG);
  const count = (text.match(/input message: '인프라 적용을 승인하시겠습니까/g) || []).length;
  assert.equal(count, 2); // 승격 지점마다 하나씩
});

// ── CLI 래퍼 e2e ─────────────────────────────────────────────────────────────
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sdd-jenkinsrender-"));
  writeFileSync(join(root, "sdd.pipeline.config.json"), JSON.stringify(MULTI_CONFIG));
  return root;
}
function run(root, args) {
  try { return { code: 0, out: execFileSync("node", [RENDERER, ...args], { cwd: root, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("CLI: 설정이 있으면 Jenkinsfile을 새로 쓴다", () => {
  const root = fixture();
  try {
    const r = run(root, []);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(root, "Jenkinsfile")));
    assert.match(readFileSync(join(root, "Jenkinsfile"), "utf8"), /pipeline \{/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI: 기존 Jenkinsfile이 있으면 자동 덮어쓰기를 거부하고 미리보기만 낸다", () => {
  const root = fixture();
  writeFileSync(join(root, "Jenkinsfile"), "// 사람이 손댄 기존 파일\n");
  try {
    const r = run(root, []);
    assert.equal(r.code, 1);
    assert.match(r.out, /덮어쓰기는 하지 않는다/);
    assert.equal(readFileSync(join(root, "Jenkinsfile"), "utf8"), "// 사람이 손댄 기존 파일\n"); // 원본 보존
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI: --force면 기존 파일을 덮어쓴다", () => {
  const root = fixture();
  writeFileSync(join(root, "Jenkinsfile"), "// 기존\n");
  try {
    const r = run(root, ["--force"]);
    assert.equal(r.code, 0, r.out);
    assert.match(readFileSync(join(root, "Jenkinsfile"), "utf8"), /pipeline \{/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI: 설정 파일이 없으면 비-0으로 종료하고 안내한다", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-jenkinsrender-noconfig-"));
  try {
    const r = run(root, []);
    assert.equal(r.code, 1);
    assert.match(r.out, /sdd-pipeline-setup/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
