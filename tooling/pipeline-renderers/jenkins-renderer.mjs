#!/usr/bin/env node
// tooling/pipeline-renderers/jenkins-renderer.mjs — sdd.pipeline.config.json → Jenkinsfile (SPEC-059)
// `renderJenkinsfile(config)`는 순수하다(IO 없음, 문자열만 반환) — 인터페이스 계약은
// tooling/pipeline-renderers/README.md 참고. 새 제공자(GitHub Actions·GitLab CI)를 추가할 때
// 이 파일을 참조 구현으로 삼는다.
//
// 스테이지 순서: 경로 가드(Node 자가조달 뒤·모든 승격보다 먼저) → 승격 지점마다: 배포 시간창
// 게이트 → 품질 게이트(ci 항목만 — pre-push 항목은 이미 훅에서 돌았다) → 마이그레이션 → 빌드·배포
// → 배포 확인 → 인프라 적용 승인대기. 실측 근거: ephemeral 에이전트(Spot 등)는 매 실행 node가
// 없는 상태로 뜬다 — 자가조달을 건너뛰면 이후 스테이지가 exit 127로 죽는데, 이게 "배포창 밖"처럼
// 오독된 사례가 있었다(pipeline-setup-lib.mjs의 ephemeral-agent-unknown-defaulted 경고와 짝).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { armVerdict, verdict, VERDICT_KINDS, isMainEntry } from "../verdict-lib.mjs";

function groovyList(items) {
  return `[${(items || []).map((s) => `'${String(s).replace(/'/g, "\\'")}'`).join(", ")}]`;
}

function renderPathGuardStage(guards) {
  const list = guards && guards.length ? guards : ["package.json"];
  return `        stage('경로 가드') {
            steps {
                script {
                    def guards = ${groovyList(list)}
                    if (!guards.any { fileExists(it) }) {
                        error("소스 경로 가드 실패 — 다음 매니페스트 중 하나도 없다: ${list.join(", ")}")
                    }
                }
            }
        }`;
}

function renderSelfProvisionStage() {
  return `        stage('Node 자가조달') {
            steps {
                sh 'command -v node >/dev/null 2>&1 || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)'
            }
        }`;
}

function renderPromotionStage(p) {
  const label = `${p.from}→${p.to}`;
  const inner = [];

  if (p.deployWindow && p.deployWindow.enabled) {
    inner.push(`            stage('배포 시간창 — ${label}') {
                steps {
                    sh 'node scripts/check-deploy-window.mjs --refs "refs/heads/${p.from} $GIT_COMMIT refs/heads/${p.from} 0000000000000000000000000000000000000000"'
                }
            }`);
  }

  const ciGates = Object.entries(p.qualityGates || {}).filter(([, where]) => where === "ci");
  if (ciGates.length) {
    inner.push(`            stage('품질 게이트 — ${label}') {
                steps {
${ciGates.map(([name]) => `                    sh 'npm run ${name}'`).join("\n")}
                }
            }`);
  }

  if (p.migrations && p.migrations.included) {
    const approval = p.migrations.approval === "manual" ? "승인 필요" : "자동";
    inner.push(`            stage('DB 마이그레이션 — ${label}') {
                steps {
                    sh 'echo "DB 마이그레이션(${approval}): ${label}"'
                }
            }`);
  }

  inner.push(`            stage('빌드·배포 — ${label}') {
                steps {
                    sh 'echo "빌드/배포: ${label}"'
                }
            }`);

  if (Array.isArray(p.deployEvidence) && p.deployEvidence.length) {
    inner.push(`            stage('배포 확인 — ${label}') {
                steps {
                    sh 'echo "배포 확인 근거: ${p.deployEvidence.join(", ")}"'
                }
            }`);
  }

  inner.push(`            stage('인프라 적용 승인 — ${label}') {
                steps {
                    input message: '인프라 적용을 승인하시겠습니까? (${label})'
                }
            }`);

  return `        stage('승격: ${label}') {
            stages {
${inner.join("\n")}
            }
        }`;
}

// config: buildPipelineConfig(answers)가 반환한 sdd.pipeline.config.json 형태 그대로.
// 반환: Jenkinsfile 전체 텍스트(문자열). IO 없음 — 파일 쓰기는 아래 CLI 래퍼의 몫.
export function renderJenkinsfile(config) {
  const c = config || {};
  const promotions = Array.isArray(c.promotions) ? c.promotions : [];
  // "모르겠음"도 안전측(포함) — ephemeralAgent가 false로 명시된 경우에만 자가조달을 뺀다.
  const needsSelfProvision = c.ephemeralAgent !== false;

  const stages = [
    ...(needsSelfProvision ? [renderSelfProvisionStage()] : []),
    renderPathGuardStage(c.sourcePathGuards),
    ...promotions.map((p) => renderPromotionStage(p)),
  ];

  return `// 이 파일은 sdd.pipeline.config.json에서 생성됐다(node tooling/pipeline-renderers/jenkins-renderer.mjs).
// 수기로 고치면 다음 재생성 때 덮어써진다 — 설정을 고치고 다시 생성하라.
pipeline {
    agent any
    stages {
${stages.join("\n")}
    }
}
`;
}

// ── CLI 래퍼 — 얇다. IO는 여기서만 한다. ────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const flag = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const root = process.cwd();
  const configPath = join(root, flag("--config", "sdd.pipeline.config.json"));
  const outPath = join(root, flag("--out", "Jenkinsfile"));
  const force = argv.includes("--force");

  if (!existsSync(configPath)) {
    verdict(VERDICT_KINDS.SKIPPED, `설정 파일 없음: ${configPath}`);
    console.error(`✗ ${configPath}가 없다 — 먼저 /sdd-pipeline-setup 인터뷰로 생성하라.`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const text = renderJenkinsfile(config);

  if (existsSync(outPath) && !force) {
    // 실측 근거: 기존 Jenkinsfile을 자동 덮어쓰면 사람이 손으로 얹은 예외/보정이 조용히 사라진다.
    // 병합은 사람이 한다 — 여기는 미리보기만 낸다.
    verdict(VERDICT_KINDS.SKIPPED, "기존 Jenkinsfile 있음 — 미리보기만 출력, 덮어쓰기 거부");
    console.log(text);
    console.error(`\n✗ ${outPath}가 이미 있다 — 자동 덮어쓰기는 하지 않는다. 위 미리보기를 참고해 손으로 병합하거나, --force로 강제 덮어써라.`);
    process.exit(1);
  }

  writeFileSync(outPath, text);
  verdict(VERDICT_KINDS.SKIPPED, "생성기(판정 게이트 아님) — Jenkinsfile을 산출한다");
  console.log(`✓ ${outPath} 생성 — 승격 지점 ${(config.promotions || []).length}개`);
}

if (isMainEntry(import.meta.url)) {
  armVerdict();
  main();
}
