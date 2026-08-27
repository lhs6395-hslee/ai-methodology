// tooling/__tests__/gitlab-ci-renderer.test.mjs — sdd.pipeline.config.json → .gitlab-ci.yml (SPEC-059)
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
import { renderGitlabCiConfig } from "../pipeline-renderers/gitlab-ci-renderer.mjs";
import { buildPipelineConfig } from "../pipeline-setup-lib.mjs";

const RENDERER = new URL("../pipeline-renderers/gitlab-ci-renderer.mjs", import.meta.url).pathname;

const MULTI_CONFIG = buildPipelineConfig({
  deployBranch: "main", ciProvider: "gitlab-ci",
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

test("renderGitlabCiConfig: 승격 지점마다 잡이 독립 반복 생성되고 stages 순서에 등재된다", () => {
  const text = renderGitlabCiConfig(MULTI_CONFIG);
  assert.match(text, /promote-main-to-dev:/);
  assert.match(text, /promote-dev-to-prod:/);
  const stagesBlock = text.slice(text.indexOf("stages:"), text.indexOf("path-guard:\n  stage"));
  assert.match(stagesBlock, /- path-guard/);
  assert.match(stagesBlock, /- promote-main-to-dev\n/);
  assert.match(stagesBlock, /- promote-main-to-dev-infra-apply/);
  assert.match(stagesBlock, /- promote-dev-to-prod\n/);
  assert.match(stagesBlock, /- promote-dev-to-prod-infra-apply/);

  const devBlock = text.slice(text.indexOf("promote-main-to-dev:"), text.indexOf("promote-main-to-dev-infra-apply:"));
  const prodBlock = text.slice(text.indexOf("promote-dev-to-prod:"), text.indexOf("promote-dev-to-prod-infra-apply:"));
  assert.ok(!/배포 시간창/.test(devBlock));
  assert.match(prodBlock, /배포 시간창/);
  assert.ok(!/DB 마이그레이션/.test(devBlock));
  assert.match(prodBlock, /DB 마이그레이션/);
});

test("renderGitlabCiConfig: 배포창 게이트는 경로 가드 stage보다 stages 목록에서 뒤에 온다", () => {
  const text = renderGitlabCiConfig(MULTI_CONFIG);
  const stagesBlock = text.slice(text.indexOf("stages:"), text.indexOf("path-guard:\n  stage"));
  const guardIdx = stagesBlock.indexOf("- path-guard");
  const prodIdx = stagesBlock.indexOf("- promote-dev-to-prod\n");
  assert.ok(guardIdx >= 0 && prodIdx >= 0 && guardIdx < prodIdx);
});

test("renderGitlabCiConfig: ephemeralAgent가 false면 자가조달 스텝이 없고, true/unknown이면 있다(안전측 포함)", () => {
  const base = { deployBranch: "main", environments: ["prod"], deployTarget: "kubernetes", promotions: [] };
  assert.match(renderGitlabCiConfig(buildPipelineConfig(base)), /Node 자가조달|nodesource/);
  const withoutSelf = renderGitlabCiConfig(buildPipelineConfig({ ...base, ephemeralAgent: false }));
  assert.ok(!/nodesource/.test(withoutSelf));
  assert.match(renderGitlabCiConfig(buildPipelineConfig({ ...base, ephemeralAgent: true })), /nodesource/);
});

test("renderGitlabCiConfig: 품질 게이트는 ci로 표시된 것만 나온다", () => {
  const text = renderGitlabCiConfig(MULTI_CONFIG);
  const devBlock = text.slice(text.indexOf("promote-main-to-dev:"), text.indexOf("promote-main-to-dev-infra-apply:"));
  assert.match(devBlock, /npm run unit/);
  assert.ok(!/npm run lint/.test(devBlock));
});

test("renderGitlabCiConfig: 인프라 적용 잡은 항상 when: manual이고, 승격 지점 수만큼 있다", () => {
  const text = renderGitlabCiConfig(MULTI_CONFIG);
  const count = (text.match(/when: manual/g) || []).length;
  assert.equal(count, 2);
  assert.match(text, /promote-main-to-dev-infra-apply:\n\s+stage: promote-main-to-dev-infra-apply\n\s+script:\n\s+- echo "인프라 적용 승인\(main→dev\)"\n\s+when: manual/);
});

// ── CLI 래퍼 e2e ─────────────────────────────────────────────────────────────
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sdd-glrender-"));
  writeFileSync(join(root, "sdd.pipeline.config.json"), JSON.stringify(MULTI_CONFIG));
  return root;
}
function run(root, args) {
  try { return { code: 0, out: execFileSync("node", [RENDERER, ...args], { cwd: root, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("CLI: 설정이 있으면 .gitlab-ci.yml을 새로 쓴다", () => {
  const root = fixture();
  try {
    const r = run(root, []);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(root, ".gitlab-ci.yml")));
    assert.match(readFileSync(join(root, ".gitlab-ci.yml"), "utf8"), /^stages:/m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI: 기존 .gitlab-ci.yml이 있으면 자동 덮어쓰기를 거부하고, --force면 덮어쓴다", () => {
  const root = fixture();
  writeFileSync(join(root, ".gitlab-ci.yml"), "# 기존\n");
  try {
    const blocked = run(root, []);
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /덮어쓰기는 하지 않는다/);
    assert.equal(readFileSync(join(root, ".gitlab-ci.yml"), "utf8"), "# 기존\n");

    const forced = run(root, ["--force"]);
    assert.equal(forced.code, 0, forced.out);
    assert.match(readFileSync(join(root, ".gitlab-ci.yml"), "utf8"), /^stages:/m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI: 설정 파일이 없으면 비-0으로 종료하고 안내한다", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-glrender-noconfig-"));
  try {
    const r = run(root, []);
    assert.equal(r.code, 1);
    assert.match(r.out, /sdd-pipeline-setup/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
