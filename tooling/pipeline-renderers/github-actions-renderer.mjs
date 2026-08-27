#!/usr/bin/env node
// tooling/pipeline-renderers/github-actions-renderer.mjs — sdd.pipeline.config.json → GitHub Actions
// workflow YAML (SPEC-059). `renderGithubActionsWorkflow(config)`는 순수하다(IO 없음, 문자열만
// 반환) — 인터페이스 계약·스테이지 순서는 tooling/pipeline-renderers/README.md와
// jenkins-renderer.mjs(참조 구현) 참고. 이 파일은 그 계약을 GitHub Actions 어휘로 옮긴 것뿐이다.
//
// 스테이지 순서는 jenkins-renderer.mjs와 동일: (필요 시) Node 자가조달 → 경로 가드 → 승격
// 지점마다: 배포 시간창 게이트 → 품질 게이트(ci만) → 마이그레이션 → 빌드·배포 → 배포 확인 →
// 인프라 적용 승인대기. GitHub Actions에는 Jenkins의 `input` 스텝에 해당하는 1급 문법이 없어
// **Environment protection rule**로 수동 승인을 표현한다(job의 `environment:` — 리뷰어 설정은
// 리포지토리 설정에서 사람이 한다, 이 렌더러가 자동으로 켜지 않는다).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { armVerdict, verdict, VERDICT_KINDS, isMainEntry } from "../verdict-lib.mjs";
import { slugId } from "../pipeline-setup-lib.mjs";

function renderPathGuardJob(guards, needsSelfProvision) {
  const list = guards && guards.length ? guards : ["package.json"];
  const check = list.map((g) => `[ -e '${g}' ]`).join(" || ");
  const selfProvision = needsSelfProvision ? `
      - name: Node 자가조달
        run: command -v node >/dev/null 2>&1 || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)` : "";
  return `  path-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4${selfProvision}
      - name: 경로 가드
        run: |
          ${check} || (echo "소스 경로 가드 실패 — 다음 매니페스트 중 하나도 없다: ${list.join(", ")}" && exit 1)`;
}

function renderPromotionJob(p, needsId) {
  const label = `${p.from}→${p.to}`;
  const jobId = `promote-${slugId(p.from)}-to-${slugId(p.to)}`;
  const steps = [`      - uses: actions/checkout@v4`];

  if (p.deployWindow && p.deployWindow.enabled) {
    steps.push(`      - name: 배포 시간창 — ${label}
        run: node scripts/check-deploy-window.mjs --refs "refs/heads/${p.from} $GITHUB_SHA refs/heads/${p.from} 0000000000000000000000000000000000000000"`);
  }

  const ciGates = Object.entries(p.qualityGates || {}).filter(([, where]) => where === "ci");
  if (ciGates.length) {
    for (const [name] of ciGates) steps.push(`      - name: 품질 게이트 ${name} — ${label}
        run: npm run ${name}`);
  }

  if (p.migrations && p.migrations.included) {
    const approval = p.migrations.approval === "manual" ? "승인 필요" : "자동";
    steps.push(`      - name: DB 마이그레이션 — ${label}
        run: echo "DB 마이그레이션(${approval}): ${label}"`);
  }

  steps.push(`      - name: 빌드·배포 — ${label}
        run: echo "빌드/배포: ${label}"`);

  if (Array.isArray(p.deployEvidence) && p.deployEvidence.length) {
    steps.push(`      - name: 배포 확인 — ${label}
        run: echo "배포 확인 근거: ${p.deployEvidence.join(", ")}"`);
  }

  return { jobId, needsId,
    yaml: `  ${jobId}:
    needs: ${needsId}
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}` };
}

function renderApprovalJob(p, needsId) {
  const label = `${p.from}→${p.to}`;
  const jobId = `promote-${slugId(p.from)}-to-${slugId(p.to)}-infra-apply`;
  // GitHub Actions는 Jenkins의 input 스텝 같은 1급 대기 문법이 없다 — environment protection
  // rule이 그 자리를 대신한다. 리뷰어는 리포지토리 Settings > Environments에서 사람이 설정한다
  // (이 렌더러는 그 설정을 켜지 않는다 — 자동 인프라 적용이 이 스키마에 없는 것과 같은 이유로,
  // "승인이 실제로 걸려 있는지"까지 렌더러가 보장할 수는 없다는 점을 이름으로 명시한다).
  return `  ${jobId}:
    needs: ${needsId}
    runs-on: ubuntu-latest
    environment:
      name: manual-approval-${slugId(p.from)}-to-${slugId(p.to)}
    steps:
      - name: 인프라 적용 승인 — ${label}
        run: echo "인프라 적용 승인 대기(${label}) — 이 environment에 리뷰어가 설정돼 있어야 실제로 멈춘다: repo Settings > Environments"`;
}

// config: buildPipelineConfig(answers)가 반환한 sdd.pipeline.config.json 형태 그대로.
// 반환: GitHub Actions 워크플로 YAML 전체 텍스트(문자열). IO 없음.
export function renderGithubActionsWorkflow(config) {
  const c = config || {};
  const promotions = Array.isArray(c.promotions) ? c.promotions : [];
  const needsSelfProvision = c.ephemeralAgent !== false;
  const deployBranch = String(c.deployBranch || "main");

  const jobs = [renderPathGuardJob(c.sourcePathGuards, needsSelfProvision)];

  let prevNeeds = "path-guard";
  for (const p of promotions) {
    const { jobId, yaml } = renderPromotionJob(p, prevNeeds);
    jobs.push(yaml);
    jobs.push(renderApprovalJob(p, jobId));
    prevNeeds = `${jobId}-infra-apply`;
  }

  return `# 이 파일은 sdd.pipeline.config.json에서 생성됐다(node tooling/pipeline-renderers/github-actions-renderer.mjs).
# 수기로 고치면 다음 재생성 때 덮어써진다 — 설정을 고치고 다시 생성하라.
name: pipeline
on:
  push:
    branches: [${deployBranch}]
jobs:
${jobs.join("\n")}
`;
}

// ── CLI 래퍼 — 얇다. IO는 여기서만 한다(jenkins-renderer.mjs와 같은 계약). ──────────────
function main() {
  const argv = process.argv.slice(2);
  const flag = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const root = process.cwd();
  const configPath = join(root, flag("--config", "sdd.pipeline.config.json"));
  const outPath = join(root, flag("--out", ".github/workflows/pipeline.yml"));
  const force = argv.includes("--force");

  if (!existsSync(configPath)) {
    verdict(VERDICT_KINDS.SKIPPED, `설정 파일 없음: ${configPath}`);
    console.error(`✗ ${configPath}가 없다 — 먼저 /sdd-pipeline-setup 인터뷰로 생성하라.`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const text = renderGithubActionsWorkflow(config);

  if (existsSync(outPath) && !force) {
    verdict(VERDICT_KINDS.SKIPPED, "기존 워크플로 있음 — 미리보기만 출력, 덮어쓰기 거부");
    console.log(text);
    console.error(`\n✗ ${outPath}가 이미 있다 — 자동 덮어쓰기는 하지 않는다. 위 미리보기를 참고해 손으로 병합하거나, --force로 강제 덮어써라.`);
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  verdict(VERDICT_KINDS.SKIPPED, "생성기(판정 게이트 아님) — GitHub Actions 워크플로를 산출한다");
  console.log(`✓ ${outPath} 생성 — 승격 지점 ${(config.promotions || []).length}개`);
}

if (isMainEntry(import.meta.url)) {
  armVerdict();
  main();
}
