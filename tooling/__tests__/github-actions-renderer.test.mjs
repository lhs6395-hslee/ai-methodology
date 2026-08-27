// tooling/__tests__/github-actions-renderer.test.mjs — sdd.pipeline.config.json → GitHub Actions
// workflow YAML (SPEC-059)
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
import { renderGithubActionsWorkflow } from "../pipeline-renderers/github-actions-renderer.mjs";
import { buildPipelineConfig } from "../pipeline-setup-lib.mjs";

const RENDERER = new URL("../pipeline-renderers/github-actions-renderer.mjs", import.meta.url).pathname;

const MULTI_CONFIG = buildPipelineConfig({
  deployBranch: "main", ciProvider: "github-actions",
  environments: ["dev", "prod"], artifactType: "container", deployTarget: "kubernetes",
  sourcePathGuards: ["package.json", "Dockerfile"],
  promotions: [
    { to: "dev", deployWindow: { enabled: false }, qualityGates: { lint: "pre-push", unit: "ci" },
      migrations: { included: false }, deployEvidence: ["build-log"] },
    { to: "prod", deployWindow: { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC" },
      qualityGates: { e2e: "ci" }, migrations: { included: true, approval: "manual" },
      deployEvidence: ["healthcheck", "image-tag"] },
  ],
});

test("renderGithubActionsWorkflow: 승격 지점마다 job이 독립 반복 생성되고 needs로 순서가 이어진다", () => {
  const text = renderGithubActionsWorkflow(MULTI_CONFIG);
  assert.match(text, /promote-main-to-dev:/);
  assert.match(text, /promote-dev-to-prod:/);
  const devBlock = text.slice(text.indexOf("promote-main-to-dev:"), text.indexOf("promote-dev-to-prod:"));
  const prodBlock = text.slice(text.indexOf("promote-dev-to-prod:"));
  assert.ok(!/배포 시간창/.test(devBlock));
  assert.match(prodBlock, /배포 시간창 — dev→prod/);
  assert.ok(!/DB 마이그레이션/.test(devBlock));
  assert.match(prodBlock, /DB 마이그레이션 — dev→prod/);
  // prod 승격 job은 dev 승격의 인프라 적용 job을 needs로 이어받는다(순서 보존).
  assert.match(text, /needs: promote-main-to-dev-infra-apply/);
});

test("renderGithubActionsWorkflow: 배포창 게이트는 경로 가드 job보다 뒤에 온다", () => {
  const text = renderGithubActionsWorkflow(MULTI_CONFIG);
  const guardIdx = text.indexOf("path-guard:");
  const windowIdx = text.indexOf("배포 시간창 — dev→prod");
  assert.ok(guardIdx >= 0 && windowIdx >= 0);
  assert.ok(guardIdx < windowIdx);
});

test("renderGithubActionsWorkflow: ephemeralAgent가 false면 자가조달 스텝이 없고, true/unknown이면 있다(안전측 포함)", () => {
  const base = { deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes", promotions: [] };
  assert.match(renderGithubActionsWorkflow(buildPipelineConfig(base)), /Node 자가조달/);
  assert.ok(!/Node 자가조달/.test(renderGithubActionsWorkflow(buildPipelineConfig({ ...base, ephemeralAgent: false }))));
  assert.match(renderGithubActionsWorkflow(buildPipelineConfig({ ...base, ephemeralAgent: true })), /Node 자가조달/);
});

test("renderGithubActionsWorkflow: 품질 게이트는 ci로 표시된 것만 나온다", () => {
  const text = renderGithubActionsWorkflow(MULTI_CONFIG);
  const devBlock = text.slice(text.indexOf("promote-main-to-dev:"), text.indexOf("promote-dev-to-prod:"));
  assert.match(devBlock, /npm run unit/);
  assert.ok(!/npm run lint/.test(devBlock));
});

test("renderGithubActionsWorkflow: 인프라 적용은 항상 수동 environment로 게이트되고, 승격 지점 수만큼 있다", () => {
  const text = renderGithubActionsWorkflow(MULTI_CONFIG);
  const count = (text.match(/인프라 적용 승인 대기/g) || []).length;
  assert.equal(count, 2);
  assert.match(text, /environment:\n\s+name: manual-approval-main-to-dev/);
  assert.match(text, /environment:\n\s+name: manual-approval-dev-to-prod/);
});

// ── CLI 래퍼 e2e ─────────────────────────────────────────────────────────────
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sdd-ghrender-"));
  writeFileSync(join(root, "sdd.pipeline.config.json"), JSON.stringify(MULTI_CONFIG));
  return root;
}
function run(root, args) {
  try { return { code: 0, out: execFileSync("node", [RENDERER, ...args], { cwd: root, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("CLI: 설정이 있으면 .github/workflows/pipeline.yml을 새로 쓴다(디렉토리 자동 생성)", () => {
  const root = fixture();
  try {
    const r = run(root, []);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(root, ".github/workflows/pipeline.yml")));
    assert.match(readFileSync(join(root, ".github/workflows/pipeline.yml"), "utf8"), /^name: pipeline/m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI: 기존 워크플로가 있으면 자동 덮어쓰기를 거부한다", () => {
  const root = fixture();
  execFileSync("mkdir", ["-p", join(root, ".github/workflows")]);
  writeFileSync(join(root, ".github/workflows/pipeline.yml"), "# 사람이 손댄 기존 파일\n");
  try {
    const r = run(root, []);
    assert.equal(r.code, 1);
    assert.match(r.out, /덮어쓰기는 하지 않는다/);
    assert.equal(readFileSync(join(root, ".github/workflows/pipeline.yml"), "utf8"), "# 사람이 손댄 기존 파일\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
