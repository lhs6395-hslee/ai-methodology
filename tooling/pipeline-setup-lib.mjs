// tooling/pipeline-setup-lib.mjs
// CI/CD 파이프라인 셋업 인터뷰 순수 코어 (SPEC-059) — IO 없음.
//
// 인터뷰 자체(질문을 순서대로 하나씩 묻는 것)는 이 파일이 하지 않는다 — 그건 대화형 에이전트가
// `prompts/pipeline-setup.md` 절차를 읽으며 `AskUserQuestion`으로 수행한다. 이 파일은 그 절차가
// 참조하는 **질문 정의**(무엇을 언제 묻는가 — 데이터로 표현)와, 답변이 다 모인 뒤 **스키마로
// 직렬화**·**검증**하는 순수 함수만 제공한다. 실행 파일 쓰기는 `ciProvider`가 지목한 렌더러
// (`tooling/pipeline-renderers/<provider>-renderer.mjs`)의 몫 — 이 코어는 어떤 렌더러가 있는지
// `CI_PROVIDERS` 목록으로만 안다.
//
// 실측 근거: 손으로 짠 파이프라인이 반복적으로 겪은 결함 — hard 게이트인데 실행 조건이 안 맞아
// 조용히 무발화(node 미설치, 로컬 브랜치명 vs 실제 push 대상 혼동, CWD 상대경로가 워크트리마다
// 어긋남). 안전한 기본값을 질문-응답으로 유도해 매 소비 프로젝트가 이 함정을 처음부터 재발견하지
// 않게 한다.

// 지원 CI 제공자 — 렌더러 파일명과 1:1(pipeline-renderers/<id>-renderer.mjs). 새 렌더러를 추가하면
// 여기 등록해야 인터뷰가 그 제공자를 선택지로 낸다(README.md "새 렌더러 추가 절차" §4와 짝).
export const CI_PROVIDERS = ["jenkins", "github-actions", "gitlab-ci"];

// ── A. 인터뷰 질문 정의(순서·섹션·의존 관계) ────────────────────────────────
// dependsOn(answers)는 이 질문을 물어야 하는지 판정하는 순수 함수 — 없으면 항상 묻는다.
// perPromotion: true는 승격 지점마다 반복(E섹션) — buildPipelineConfig가 promotions 개수만큼 순회.
export const INTERVIEW_QUESTIONS = [
  // A. 기본
  { id: "deployBranch", section: "A", prompt: "배포 브랜치 이름", type: "text", default: "main" },
  { id: "stack", section: "A", prompt: "언어/스택 — sdd.config.json에 이미 있으면 재사용",
    type: "text", reuseFrom: "sdd.config.json" },
  { id: "ciProvider", section: "A", prompt: "CI 제공자", type: "select",
    options: [...CI_PROVIDERS], default: "jenkins" },
  // B. 환경 구성
  { id: "environments", section: "B", prompt: "환경 구성(다중 선택)", type: "multiselect",
    options: ["local", "dev", "prod"] },
  { id: "localVerifiable", section: "B", prompt: "로컬 서버·DB 구동이 실제로 가능한가(도커 등)",
    type: "boolean", dependsOn: (a) => (a.environments || []).includes("local") },
  { id: "promotionMode", section: "B", prompt: "승격이 순차(배포브랜치→개발→승인후운영)인가 독립(각자 배포)인가",
    type: "select", options: ["sequential", "independent"],
    dependsOn: (a) => (a.environments || []).includes("dev") && (a.environments || []).includes("prod") },
  // C. 빌드·배포 방식
  { id: "artifactType", section: "C", prompt: "빌드 산출물 종류", type: "select",
    options: ["container", "static", "serverless", "other"] },
  { id: "registryType", section: "C", prompt: "레지스트리 종류", type: "select",
    options: ["ecr", "gcr", "dockerhub", "gitlab", "other"],
    dependsOn: (a) => a.artifactType === "container" },
  { id: "deployTarget", section: "C", prompt: "배포 대상 인프라", type: "select",
    options: ["kubernetes", "vm", "serverless", "static-hosting", "other"] },
  // D. 경로 가드
  { id: "sourcePathGuards", section: "D", prompt: "앱 소스 경로 가드(매니페스트 스캔 추천값 확인/수정)",
    type: "path-list", autoDetect: true },
  // E. 승격 지점마다 반복
  { id: "deployWindow", section: "E", perPromotion: true, prompt: "배포 시간창 사용 여부·시작/종료·타임존·예외 트레일러 문구" },
  { id: "qualityGates", section: "E", perPromotion: true, prompt: "품질 게이트(lint/typecheck/unit/e2e) 및 각각 실행 위치(pre-push|ci)" },
  { id: "migrations", section: "E", perPromotion: true, prompt: "DB 마이그레이션 포함 여부·자동/승인" },
  { id: "deployEvidence", section: "E", perPromotion: true, prompt: "배포 확인 근거(다중 선택)",
    type: "multiselect", options: ["build-log", "image-tag", "healthcheck", "other"] },
  { id: "concurrencyLock", section: "E", perPromotion: true, prompt: "동시 배포 방지(락) 필요 여부", type: "boolean" },
  // F. 운영 공통
  { id: "ticketRefRequired", section: "F", prompt: "티켓 참조 강제 여부", type: "boolean" },
  { id: "ephemeralAgent", section: "F", prompt: "CI 에이전트가 매 실행마다 새로 뜨는 환경인가(Spot/ephemeral)",
    type: "boolean-or-unknown" },
  { id: "infraApplyMode", section: "F", prompt: "인프라 적용 자동/승인 — 자동 적용은 기본 금지",
    type: "select", options: ["approval"] },
  { id: "rollbackStrategy", section: "F", prompt: "롤백 전략", type: "select",
    options: ["auto", "manual-guide", "none"] },
  // Phase 2 진입 지점만 — 질문 목록·스키마는 이번 범위 밖.
  { id: "qaClosingChainRequested", section: "G", prompt: "QA 마감 사슬도 지금 같이 설정할까요?", type: "boolean" },
];

const DEFAULT_PATH_MANIFESTS = ["package.json", "Dockerfile", "go.mod", "requirements.txt", "pom.xml", "*.csproj"];

// ── B. 답변 → sdd.pipeline.config.json 스키마 직렬화 ────────────────────────
// answers: { <question.id>: 값, promotions: [{...perPromotion 답변들}] } — perPromotion 답변은
// 호출자(prompts/pipeline-setup.md 절차)가 승격 지점 개수만큼 이미 배열로 모아 넘긴다(이 함수는
// "몇 번 물을지"를 계산하지 않는다 — environments 답변에서 파생되는 그 계산은 이 함수의 반환값
// `promotions`가 대신 표현한다: environments가 1개면 원소 1개, 여러 개면 승격 지점마다 독립).
export function buildPipelineConfig(answers) {
  const a = answers || {};
  const envs = Array.isArray(a.environments) ? a.environments : [];
  const environments = envs.map((name) => ({ name, verifiable: name === "local" ? !!a.localVerifiable : undefined }))
    .map(({ name, verifiable }) => (verifiable === undefined ? { name } : { name, verifiable }));

  // promotions 원소 개수 — 환경이 1개뿐이면 원소 1개(배포브랜치→그 환경), 여러 개면 승격 지점마다.
  const rawPromotions = Array.isArray(a.promotions) ? a.promotions : [];
  const deployBranch = String(a.deployBranch || "main");
  const promotions = rawPromotions.map((p, i) => ({
    from: p.from || (i === 0 ? deployBranch : rawPromotions[i - 1]?.to || deployBranch),
    to: p.to,
    deployWindow: normalizeDeployWindow(p.deployWindow),
    qualityGates: p.qualityGates || {},
    migrations: p.migrations || { included: false },
    deployEvidence: Array.isArray(p.deployEvidence) ? p.deployEvidence : [],
    concurrencyLock: !!p.concurrencyLock,
  }));

  return {
    deployBranch,
    ciProvider: CI_PROVIDERS.includes(a.ciProvider) ? a.ciProvider : "jenkins",
    environments,
    promotionMode: a.promotionMode || null,
    build: { artifactType: a.artifactType || "other", registry: a.registryType || null },
    deployTarget: a.deployTarget || "other",
    sourcePathGuards: Array.isArray(a.sourcePathGuards) && a.sourcePathGuards.length ? a.sourcePathGuards : DEFAULT_PATH_MANIFESTS,
    promotions,
    ticketRefRequired: !!a.ticketRefRequired,
    // "모르겠음"도 안전측(포함)으로 — 실측 함정: Spot 에이전트에 런타임 없어 exit 127이 "창 밖"으로 오독됐다.
    ephemeralAgent: a.ephemeralAgent === true ? true : a.ephemeralAgent === false ? false : "unknown",
    infraApply: { mode: "approval", target: a.deployTarget || "other" }, // 자동 적용은 이 스키마에 존재하지 않는다(기본 금지)
    rollbackStrategy: a.rollbackStrategy || "none",
  };
}

function normalizeDeployWindow(w) {
  if (!w || !w.enabled) return { enabled: false };
  return {
    enabled: true, days: Array.isArray(w.days) ? w.days : [], start: w.start, end: w.end,
    timezone: w.timezone || "UTC", overrideTrailer: w.overrideTrailer || "Deploy-Window-Override",
  };
}

// ── C. 검증·경고(렌더링 전) ───────────────────────────────────────────────
// 반환 findings[] — kind별로 아래 4종. 렌더러를 부르기 전에 이 함수를 먼저 부른다.
export function validatePipelineConfig(config) {
  const out = [];
  const c = config || {};
  for (const p of c.promotions || []) {
    // (a) 배포 시간창은 켰는데 이 승격 지점의 품질 게이트가 전부 pre-push뿐이면(CI 축 0) —
    // 로컬 훅만으론 우회 가능하다(--no-verify·훅 미설치 클론·웹 UI 머지).
    if (p.deployWindow && p.deployWindow.enabled) {
      const gates = Object.values(p.qualityGates || {});
      const hasCi = gates.includes("ci");
      if (gates.length && !hasCi) {
        out.push({ kind: "window-without-ci-gate", at: `${p.from}→${p.to}`,
          detail: `배포 시간창을 켰지만 품질 게이트가 전부 pre-push뿐이다(${p.from}→${p.to}) — 로컬 훅은 --no-verify·훅 미설치 클론·웹 UI 머지로 우회된다. 최소 하나는 CI 전용으로 두어라` });
      }
    }
    // (d) 인프라 승인 스텝을 켰는데 배포 대상에 v1 렌더러 템플릿이 없으면(제공자 공통 — kubernetes만 지원) 명시한다.
    if (c.infraApply && c.infraApply.mode && c.deployTarget !== "kubernetes") {
      out.push({ kind: "infra-apply-no-renderer-template", at: `${p.from}→${p.to}`,
        detail: `대상 인프라 "${c.deployTarget}"의 인프라 적용 승인 스텝은 설정만 저장된다 — 렌더러(${c.ciProvider || "jenkins"}) v1은 kubernetes 템플릿만 갖고 있다` });
    }
  }
  // (c) ephemeralAgent가 unknown이면 안전측(포함)으로 기본 적용했다는 사실을 남긴다(조용한 기본값 금지).
  if (c.ephemeralAgent === "unknown") {
    out.push({ kind: "ephemeral-agent-unknown-defaulted", at: "-",
      detail: `CI 에이전트가 매 실행 새로 뜨는지 모른다고 답해 안전측(자가조달 포함)으로 기본 적용했다 — 렌더러(${c.ciProvider || "jenkins"})라면 자가조달 스텝이 항상 포함된다` });
  }
  // (b) 인터페이스 노트: environments의 local.verifiable=false는 여기서 판정하지 않는다.
  // Phase 2(QA 마감 사슬)가 이 값을 참조해 로컬 실측 질문을 건너뛰도록 설계될 예정이다 — 이번
  // 구현 범위 밖이라 스키마에 값만 실어두고(위 buildPipelineConfig), 모순 검사는 만들지 않는다.
  return out;
}

export const PIPELINE_CONFIG_FILE = "sdd.pipeline.config.json";

// YAML 기반 렌더러(github-actions·gitlab-ci)의 job/stage 키는 YAML 식별자 문법을 지켜야 한다 —
// 승격 라벨("main→dev")을 그대로 못 쓴다. 두 렌더러가 각자 정의하면 구현 중복이라 여기 하나로 모은다
// (Jenkins는 문자열 라벨이라 필요 없다 — 그래서 jenkins-renderer.mjs는 이 함수를 쓰지 않는다).
export function slugId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
