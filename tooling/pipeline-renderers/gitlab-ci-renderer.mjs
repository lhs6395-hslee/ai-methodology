#!/usr/bin/env node
// tooling/pipeline-renderers/gitlab-ci-renderer.mjs — sdd.pipeline.config.json → .gitlab-ci.yml
// (SPEC-059). `renderGitlabCiConfig(config)`는 순수하다(IO 없음, 문자열만 반환) — 인터페이스
// 계약·스테이지 순서는 tooling/pipeline-renderers/README.md와 jenkins-renderer.mjs(참조 구현)
// 참고. 이 파일은 그 계약을 GitLab CI 어휘로 옮긴 것뿐이다.
//
// 스테이지 순서는 jenkins-renderer.mjs와 동일: (필요 시) Node 자가조달 → 경로 가드 → 승격
// 지점마다: 배포 시간창 게이트 → 품질 게이트(ci만) → 마이그레이션 → 빌드·배포 → 배포 확인 →
// 인프라 적용 승인대기. GitLab CI는 `when: manual`이 Jenkins의 `input` 스텝과 가장 가까운 1급
// 대기 문법이라 인프라 적용 잡에 그대로 쓴다(선언만으로 파이프라인이 실제로 멈춘다 — GitHub
// Actions의 environment protection rule과 달리 리포지토리 설정 쪽 추가 조치가 필요 없다).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { armVerdict, verdict, VERDICT_KINDS, isMainEntry } from "../verdict-lib.mjs";
import { slugId } from "../pipeline-setup-lib.mjs";

function yamlScript(lines) {
  return lines.map((l) => `      - ${l}`).join("\n");
}

function renderPathGuardJob(guards, needsSelfProvision) {
  const list = guards && guards.length ? guards : ["package.json"];
  const check = list.map((g) => `[ -e '${g}' ]`).join(" || ");
  const script = [
    ...(needsSelfProvision ? [`command -v node >/dev/null 2>&1 || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)`] : []),
    `${check} || (echo "소스 경로 가드 실패 — 다음 매니페스트 중 하나도 없다: ${list.join(", ")}" && exit 1)`,
  ];
  return `path-guard:
  stage: path-guard
  script:
${yamlScript(script)}`;
}

function renderPromotionJob(p) {
  const label = `${p.from}→${p.to}`;
  const jobId = `promote-${slugId(p.from)}-to-${slugId(p.to)}`;
  const script = [];

  if (p.deployWindow && p.deployWindow.enabled) {
    script.push(`echo "# 배포 시간창 — ${label}"`);
    script.push(`node scripts/check-deploy-window.mjs --refs "refs/heads/${p.from} $CI_COMMIT_SHA refs/heads/${p.from} 0000000000000000000000000000000000000000"`);
  }

  const ciGates = Object.entries(p.qualityGates || {}).filter(([, where]) => where === "ci");
  for (const [name] of ciGates) {
    script.push(`echo "# 품질 게이트 ${name} — ${label}"`);
    script.push(`npm run ${name}`);
  }

  if (p.migrations && p.migrations.included) {
    const approval = p.migrations.approval === "manual" ? "승인 필요" : "자동";
    script.push(`echo "# DB 마이그레이션 — ${label}"`);
    script.push(`echo "DB 마이그레이션(${approval}): ${label}"`);
  }

  script.push(`echo "# 빌드·배포 — ${label}"`);
  script.push(`echo "빌드/배포: ${label}"`);

  if (Array.isArray(p.deployEvidence) && p.deployEvidence.length) {
    script.push(`echo "# 배포 확인 — ${label}"`);
    script.push(`echo "배포 확인 근거: ${p.deployEvidence.join(", ")}"`);
  }

  return { jobId, stageName: jobId,
    yaml: `${jobId}:
  stage: ${jobId}
  script:
${yamlScript(script)}` };
}

function renderApprovalJob(p) {
  const label = `${p.from}→${p.to}`;
  const stageName = `promote-${slugId(p.from)}-to-${slugId(p.to)}-infra-apply`;
  return { stageName,
    yaml: `${stageName}:
  stage: ${stageName}
  script:
    - echo "인프라 적용 승인(${label})"
  when: manual` };
}

// config: buildPipelineConfig(answers)가 반환한 sdd.pipeline.config.json 형태 그대로.
// 반환: .gitlab-ci.yml 전체 텍스트(문자열). IO 없음.
export function renderGitlabCiConfig(config) {
  const c = config || {};
  const promotions = Array.isArray(c.promotions) ? c.promotions : [];
  const needsSelfProvision = c.ephemeralAgent !== false;

  const stages = ["path-guard"];
  const jobs = [renderPathGuardJob(c.sourcePathGuards, needsSelfProvision)];

  for (const p of promotions) {
    const promo = renderPromotionJob(p);
    stages.push(promo.stageName);
    jobs.push(promo.yaml);
    const approval = renderApprovalJob(p);
    stages.push(approval.stageName);
    jobs.push(approval.yaml);
  }

  return `# 이 파일은 sdd.pipeline.config.json에서 생성됐다(node tooling/pipeline-renderers/gitlab-ci-renderer.mjs).
# 수기로 고치면 다음 재생성 때 덮어써진다 — 설정을 고치고 다시 생성하라.
stages:
${stages.map((s) => `  - ${s}`).join("\n")}

${jobs.join("\n\n")}
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
  const outPath = join(root, flag("--out", ".gitlab-ci.yml"));
  const force = argv.includes("--force");

  if (!existsSync(configPath)) {
    verdict(VERDICT_KINDS.SKIPPED, `설정 파일 없음: ${configPath}`);
    console.error(`✗ ${configPath}가 없다 — 먼저 /sdd-pipeline-setup 인터뷰로 생성하라.`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const text = renderGitlabCiConfig(config);

  if (existsSync(outPath) && !force) {
    verdict(VERDICT_KINDS.SKIPPED, "기존 .gitlab-ci.yml 있음 — 미리보기만 출력, 덮어쓰기 거부");
    console.log(text);
    console.error(`\n✗ ${outPath}가 이미 있다 — 자동 덮어쓰기는 하지 않는다. 위 미리보기를 참고해 손으로 병합하거나, --force로 강제 덮어써라.`);
    process.exit(1);
  }

  writeFileSync(outPath, text);
  verdict(VERDICT_KINDS.SKIPPED, "생성기(판정 게이트 아님) — .gitlab-ci.yml을 산출한다");
  console.log(`✓ ${outPath} 생성 — 승격 지점 ${(config.promotions || []).length}개`);
}

if (isMainEntry(import.meta.url)) {
  armVerdict();
  main();
}
