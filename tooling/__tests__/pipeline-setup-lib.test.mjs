// tooling/__tests__/pipeline-setup-lib.test.mjs — CI/CD 파이프라인 셋업 인터뷰 코어 (SPEC-059)
// @covers SPEC-059/FR-001
// @covers SPEC-059/FR-002
// @covers SPEC-059/FR-003
// @covers SPEC-059/FR-004
// @covers SPEC-059/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERVIEW_QUESTIONS, buildPipelineConfig, validatePipelineConfig, PIPELINE_CONFIG_FILE,
} from "../pipeline-setup-lib.mjs";

test("INTERVIEW_QUESTIONS: 모든 질문이 id·section·prompt를 갖는다", () => {
  assert.ok(INTERVIEW_QUESTIONS.length > 0);
  for (const q of INTERVIEW_QUESTIONS) {
    assert.ok(q.id, JSON.stringify(q));
    assert.ok(q.section, JSON.stringify(q));
    assert.ok(q.prompt, JSON.stringify(q));
  }
  assert.equal(PIPELINE_CONFIG_FILE, "sdd.pipeline.config.json");
});

test("buildPipelineConfig: 환경 1개(local만)면 promotions는 빈 배열, environments는 원소 1개", () => {
  const config = buildPipelineConfig({
    deployBranch: "main",
    environments: ["local"],
    localVerifiable: true,
    artifactType: "container",
    registryType: "ecr",
    deployTarget: "kubernetes",
    promotions: [],
  });
  assert.equal(config.deployBranch, "main");
  assert.deepEqual(config.environments, [{ name: "local", verifiable: true }]);
  assert.deepEqual(config.promotions, []);
  assert.equal(config.build.artifactType, "container");
  assert.equal(config.build.registry, "ecr");
  assert.equal(config.deployTarget, "kubernetes");
  assert.ok(config.sourcePathGuards.length > 0); // 기본 매니페스트 목록으로 폴백
});

test("buildPipelineConfig: 환경 여러 개(dev+prod)면 승격 지점마다 독립 원소, from은 이전 to를 이어받는다", () => {
  const config = buildPipelineConfig({
    deployBranch: "main",
    environments: ["dev", "prod"],
    promotionMode: "sequential",
    artifactType: "container",
    deployTarget: "kubernetes",
    promotions: [
      {
        to: "dev",
        deployWindow: { enabled: false },
        qualityGates: { lint: "pre-push", unit: "ci" },
        migrations: { included: false },
        deployEvidence: ["build-log"],
        concurrencyLock: false,
      },
      {
        to: "prod",
        deployWindow: { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC" },
        qualityGates: { e2e: "ci" },
        migrations: { included: true, approval: "manual" },
        deployEvidence: ["healthcheck", "image-tag"],
        concurrencyLock: true,
      },
    ],
  });
  assert.equal(config.promotions.length, 2);
  // 1번째 승격은 배포 브랜치(main)에서 시작, 2번째는 1번째의 to("dev")를 이어받는다 — 독립 설정.
  assert.equal(config.promotions[0].from, "main");
  assert.equal(config.promotions[0].to, "dev");
  assert.equal(config.promotions[0].deployWindow.enabled, false);
  assert.equal(config.promotions[0].concurrencyLock, false);
  assert.equal(config.promotions[1].from, "dev");
  assert.equal(config.promotions[1].to, "prod");
  assert.equal(config.promotions[1].deployWindow.enabled, true);
  assert.equal(config.promotions[1].deployWindow.timezone, "UTC");
  assert.equal(config.promotions[1].concurrencyLock, true);
  assert.deepEqual(config.promotions[1].deployEvidence, ["healthcheck", "image-tag"]);
});

test("buildPipelineConfig: ephemeralAgent는 모르겠음도 안전측(unknown)으로 보존, infraApply는 항상 approval", () => {
  assert.equal(buildPipelineConfig({ ephemeralAgent: true }).ephemeralAgent, true);
  assert.equal(buildPipelineConfig({ ephemeralAgent: false }).ephemeralAgent, false);
  assert.equal(buildPipelineConfig({}).ephemeralAgent, "unknown");
  const config = buildPipelineConfig({ deployTarget: "vm" });
  assert.equal(config.infraApply.mode, "approval");
  assert.equal(config.infraApply.target, "vm");
});

test("validatePipelineConfig: window-without-ci-gate — 배포창 켰는데 품질 게이트가 전부 pre-push뿐", () => {
  const config = buildPipelineConfig({
    deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes",
    promotions: [{
      to: "prod",
      deployWindow: { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC" },
      qualityGates: { lint: "pre-push", unit: "pre-push" },
    }],
  });
  const findings = validatePipelineConfig(config);
  assert.ok(findings.some((f) => f.kind === "window-without-ci-gate"), JSON.stringify(findings));
});

test("validatePipelineConfig: window-without-ci-gate는 CI 게이트가 하나라도 있으면 안 뜬다", () => {
  const config = buildPipelineConfig({
    deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes",
    promotions: [{
      to: "prod",
      deployWindow: { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC" },
      qualityGates: { lint: "pre-push", unit: "ci" },
    }],
  });
  const findings = validatePipelineConfig(config);
  assert.ok(!findings.some((f) => f.kind === "window-without-ci-gate"), JSON.stringify(findings));
});

test("validatePipelineConfig: infra-apply-no-renderer-template — 배포 대상이 kubernetes가 아니면 명시", () => {
  const config = buildPipelineConfig({
    deployBranch: "main", environments: ["prod"], deployTarget: "vm",
    promotions: [{ to: "prod", deployWindow: { enabled: false } }],
  });
  const findings = validatePipelineConfig(config);
  const f = findings.find((f) => f.kind === "infra-apply-no-renderer-template");
  assert.ok(f, JSON.stringify(findings));
  assert.match(f.detail, /vm/);

  const k8s = buildPipelineConfig({
    deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes",
    promotions: [{ to: "prod", deployWindow: { enabled: false } }],
  });
  assert.ok(!validatePipelineConfig(k8s).some((f) => f.kind === "infra-apply-no-renderer-template"));
});

test("validatePipelineConfig: ephemeral-agent-unknown-defaulted — 모르겠음으로 답하면 안전측 기본 적용 사실을 남긴다", () => {
  const unknown = buildPipelineConfig({
    deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes",
    promotions: [{ to: "prod", deployWindow: { enabled: false } }],
  });
  assert.ok(validatePipelineConfig(unknown).some((f) => f.kind === "ephemeral-agent-unknown-defaulted"));

  const known = buildPipelineConfig({
    deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes", ephemeralAgent: false,
    promotions: [{ to: "prod", deployWindow: { enabled: false } }],
  });
  assert.ok(!validatePipelineConfig(known).some((f) => f.kind === "ephemeral-agent-unknown-defaulted"));
});
