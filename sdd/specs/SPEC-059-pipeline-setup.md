# Feature Specification: Pipeline Setup (손으로 짠 CI/CD가 조용히 무발화하는 결함 클래스를 인터뷰로 막는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-059`  **Created**: 2026-08-26  **Status**: Reviewed
**Input**: 오너가 확정한 설계(2026-08-26) — 손으로 짠 CI/CD 파이프라인이 반복적으로 겪은 결함 클래스(hard 게이트인데 실행 조건이 안 맞아 조용히 무발화 — node 미설치, 위험한 기본값을 조용히 채택)를 대화형 인터뷰로 일반화한다. `/sdd-pipeline-setup` 실행 → `sdd.pipeline.config.json`(선언) + 선택한 CI 제공자(Jenkins·GitHub Actions·GitLab CI)의 설정 파일(생성물). 배포 시간창 판정·강제(pre-push 실시간 차단)는 별도 관심사로 SPEC-060에 분리했다(아래 Dedup-Review). 2026-08-27: 원래 Jenkins만 렌더러가 있던 것을 오너 요청으로 GitHub Actions·GitLab CI까지 확장했다(스키마는 처음부터 제공자 중립으로 설계돼 있었다).

---

## User Scenarios & Testing

### User Story 1 — 인터뷰 질문의 유일한 소스는 데이터로 선언된다 (P1)
질문을 절차 문서(프롬프트)에 하드코딩하면 새 질문이 필요할 때 코드와 문서가 따로 논다. 그래서 질문 정의(순서·섹션·의존 관계·환경별 반복 여부)는 `INTERVIEW_QUESTIONS` 배열 하나가 유일한 소스이고, 대화형 절차는 이 배열을 순서대로 소비만 한다.
- **Independent Test**: `pipeline-setup-lib.test.mjs`가 배열의 각 항목이 `id`·`section`·`prompt`를 갖는지, `dependsOn`이 있는 항목이 조건부로만 물어야 함을 확인. [검증: tooling/__tests__/pipeline-setup-lib.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an entry with `dependsOn: (a) => (a.environments||[]).includes("local")`, **When** the collected answers do not include `"local"` in `environments`, **Then** the interview procedure does not ask that question.

### User Story 2 — 승격 지점 개수는 환경 답변에서 파생되고, 지점마다 설정이 독립이다 (P1)
환경이 1개(예: local만)면 승격이 없고, 여러 개(dev+prod)면 승격 지점마다 배포 시간창·품질 게이트·마이그레이션·배포 확인·동시성 락을 독립적으로 답한다. 손으로 짠 파이프라인은 흔히 이 축을 한 벌의 전역 설정으로 뭉개 dev에 걸어야 할 값을 prod에도 걸거나 그 반대로 만들었다.
- **Independent Test**: 단일 환경·다중 환경 각각에 대해 `buildPipelineConfig`가 낸 `promotions` 배열의 원소 개수와 각 원소의 독립성(2번째 원소를 바꿔도 1번째가 그대로)을 확인. [검증: tooling/__tests__/pipeline-setup-lib.test.mjs]
- **Acceptance (GWT)**: 1. **Given** answers with `environments: ["dev","prod"]` and independently-answered per-promotion fields, **When** `buildPipelineConfig` runs, **Then** `promotions` has one element per promotion point, each element's `from` chaining from the previous element's `to` (the first element's `from` being `deployBranch`), and no element's fields leak into another's.

### User Story 3 — 위험한 기본값은 조용히 넘어가지 않는다 (P1)
배포 시간창을 켰는데 품질 게이트가 전부 pre-push뿐이면 로컬 훅 우회(`--no-verify`·훅 미설치 클론·웹 UI 머지)로 시간창이 무의미해지고, "모르겠음"으로 답한 ephemeral 에이전트 여부를 조용히 `false`로 기본하면 Spot 에이전트에서 node 없이 죽는 exit 127이 "배포창 밖"처럼 오독된다. 그래서 검증은 위험한 조합을 finding으로 표면화하고, 안전측 기본값을 썼다는 사실 자체도 finding으로 남긴다.
- **Independent Test**: 세 가지 finding 종류(`window-without-ci-gate`·`infra-apply-no-renderer-template`·`ephemeral-agent-unknown-defaulted`) 각각을 유발하는 최소 픽스처와, 유발하지 않는 대조 픽스처를 확인. [검증: tooling/__tests__/pipeline-setup-lib.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a promotion with `deployWindow.enabled: true` and `qualityGates` where no value is `"ci"`, **When** `validatePipelineConfig` runs, **Then** it reports a `window-without-ci-gate` finding for that promotion. 2. **Given** answers omitting `ephemeralAgent`, **When** `buildPipelineConfig` then `validatePipelineConfig` run, **Then** the config's `ephemeralAgent` is `"unknown"` (safe-side inclusion, not silently `false`) and a `ephemeral-agent-unknown-defaulted` finding names that default was applied.

### User Story 4 — 어느 제공자로 렌더링하든 같은 스테이지 골격을 반복하고, 인프라 적용은 항상 승인 대기다 (P1)
렌더러가 산출하는 것은 결정론적 문자열이어야 재현·리뷰가 가능하다. 자동 인프라 적용은 이 스키마에 아예 존재하지 않는다(오너의 명시적 결정) — 인프라 적용 스텝은 항상 사람이 승인해야 진행되는 형태(Jenkins `input`·GitHub Actions environment protection·GitLab CI `when: manual`)다.
- **Independent Test**: 승격 지점이 여러 개인 픽스처로 세 렌더러(`renderJenkinsfile`·`renderGithubActionsWorkflow`·`renderGitlabCiConfig`) 각각을 호출해 스테이지/잡이 반복 생성되는지, 배포 시간창 게이트가 경로 가드 스테이지보다 뒤에 오는지, 인프라 적용 승인 개수가 승격 지점 개수와 같은지 정규식으로 단정. [검증: tooling/__tests__/jenkins-renderer.test.mjs, tooling/__tests__/github-actions-renderer.test.mjs, tooling/__tests__/gitlab-ci-renderer.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a config with 2 promotions, **When** any of the three renderers runs, **Then** the output contains exactly 2 manual infra-apply gates (one per promotion) and no automatic infra-apply path exists in the schema or any renderer. 2. **Given** an existing output file (Jenkinsfile, `.github/workflows/pipeline.yml`, or `.gitlab-ci.yml`) in the target location and no `--force` flag, **When** the corresponding CLI wrapper runs, **Then** it prints the would-be content as a preview, does not write the file, and exits non-zero.

### User Story 5 — `ciProvider` 답변이 어느 렌더러를 부를지 결정한다 (P1)
질문 정의의 유일한 소스 원칙(User Story 1)이 렌더러 선택에도 적용된다 — 절차 문서나 스킬이 임의로 "Jenkins라고 가정"하지 않고, 답변이 지목한 렌더러 파일명을 기계적으로 조립한다. 미답변·미등록 값은 안전하게 `jenkins`로 기본한다(기존 채택 프로젝트와의 하위 호환 — 이 질문이 생기기 전에 저장된 설정은 없었으므로 실제로는 신규 배포 시 기본값 문제일 뿐이다).
- **Independent Test**: `CI_PROVIDERS` 목록에 등록된 값은 그대로 저장되고, 미등록 값이나 답변 누락은 `jenkins`로 폴백함을 확인. [검증: tooling/__tests__/pipeline-setup-lib.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an answer `ciProvider: "gitlab-ci"`, **When** `buildPipelineConfig` runs, **Then** the resulting config's `ciProvider` is `"gitlab-ci"`. 2. **Given** an answer `ciProvider: "circleci"` (not in `CI_PROVIDERS`), **When** `buildPipelineConfig` runs, **Then** the resulting config's `ciProvider` is `"jenkins"` (safe fallback, not a thrown error that would abort the whole interview over one unrecognized value).

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **Phase 2(QA 마감 사슬)는 이번 범위 밖이다** — 인터뷰 마지막 질문(`qaClosingChainRequested`)은 진입 여부만 묻고 "예"면 "아직 준비 중"으로 답한다. 그 질문의 답은 `sdd.pipeline.config.json` 스키마에 저장하지 않는다(값을 저장해두고 아무도 안 쓰면 그 자체가 조용한 미완성이다).
- **검증 findings는 4종이 아니라 3종 구현 + 1종 인터페이스 노트다.** 원 설계가 언급한 "(b) `environments`의 `local.verifiable=false`와 로컬 실측 요구의 모순"은 이번 구현이 판정하지 않는다 — Phase 2가 이 값을 참조해 로컬 실측 질문을 건너뛰도록 설계될 예정이라, 스키마엔 값만 싣고(`buildPipelineConfig`) 모순 검사는 만들지 않는다(값이 쓰일 소비자가 아직 없는데 검사부터 만들면 그 검사 자체가 검증 안 된 추측이다).
- **`sdd.config.json`에 리치 스키마를 중복 저장하지 않는다.** `pipelineConfigFile`은 `evidenceManifest`/`smokeManifest`와 같은 포인터 knob이다 — `environments`·`promotions` 등은 `sdd.pipeline.config.json` 한 곳에만 산다. 같은 데이터를 두 파일에 적으면 한쪽이 뒤처진다는 이 킷 자신의 반복된 교훈(SPEC-035 FR-009 논의 참고)과 충돌하기 때문이다.
- **GitHub Actions에는 `input` 동급 1급 대기 문법이 없다.** `environment:`(Environment protection rule)로 대신 표현하고, 실제로 파이프라인을 멈추려면 사람이 리포지토리 Settings에서 리뷰어를 설정해야 한다 — 렌더러가 그 설정을 자동으로 켜지 않는다(자동 인프라 적용이 스키마에 없는 것과 같은 이유로, "승인이 실제로 걸려 있는지"까지 렌더러가 보장할 수는 없다는 한계를 산출물 자체에 주석으로 남긴다). GitLab CI는 `when: manual`이 정확한 대응물이라 이 한계가 없다.
- **기존 렌더링 산출물을 자동 덮어쓰지 않는다.** 어느 렌더러든 CLI는 대상 파일이 이미 있으면 미리보기만 stdout에 내고 비-0으로 종료한다 — 병합은 사람이 한다. `--force`로만 강제.
- **`ciProvider`가 등록되지 않은 값이면 조용히 `jenkins`로 기본한다(에러로 인터뷰 전체를 중단하지 않는다).** 알 수 없는 제공자 이름 하나 때문에 나머지 답변까지 버려지는 것보다, 안전측(가장 성숙한 참조 구현) 기본값으로 계속 진행하는 편이 낫다는 판단이다.
- **배포 시간창의 판정 로직·pre-push 강제는 이 스펙의 범위가 아니다(SPEC-060).** 인터뷰가 시간창 답변을 받고 스키마에 싣는 것(위 `deployWindow` 필드)까지는 이 스펙이 하지만, 그 값을 판정·강제하는 코어와 게이트는 SPEC-060이 소유한다 — FR 개수 상한(cohesion, `maxFRsPerSpec`) 초과를 완화(cap 상향)가 아니라 실제 분할로 해소했다(두 관심사가 원래도 독립 파일이었다: 인터뷰/렌더링 vs 시간 판정/실시간 차단).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **pipeline-setup** (E) interview core in **pipeline-setup-lib.mjs** (S) SHALL define `INTERVIEW_QUESTIONS` (C) as an ordered array where each entry has `id`, `section`, and `prompt`, and where an entry's `dependsOn` function (if present) determines whether that entry is asked, so that the interview procedure has no question logic of its own to fall out of sync with.
- **FR-002** (ubiquitous): THE core SHALL provide `buildPipelineConfig(answers)` (C) that serializes collected answers into the `sdd.pipeline.config.json` schema, deriving one `promotions` element per promotion point from the `environments` answer (zero elements for a single environment, one independent element per promotion point for multiple environments) with each element's `from` chained from the previous element's `to` (the first element's `from` being `deployBranch`).
- **FR-003** (unwanted): IF a promotion's `deployWindow.enabled` is `true` and none of its `qualityGates` values is `"ci"`, THEN `validatePipelineConfig` (C) SHALL report a `window-without-ci-gate` finding naming that promotion, because a pre-push-only quality gate is bypassable (`--no-verify`, a hookless clone, or a web-UI merge) and cannot itself enforce the window.
- **FR-004** (unwanted): IF `infraApply.mode` is set and the config's `deployTarget` is not `"kubernetes"`, THEN `validatePipelineConfig` SHALL report an `infra-apply-no-renderer-template` finding for each promotion naming the config's `ciProvider`, because every renderer (v1) only has a template for that target and the approval step would otherwise be saved with no corresponding rendered logic regardless of which provider was chosen.
- **FR-005** (event): WHEN an interview answer for ephemeral-agent status is neither `true` nor `false`, THE core SHALL set `ephemeralAgent` to `"unknown"` (the safe-side, inclusive default) rather than defaulting to `false`, and `validatePipelineConfig` SHALL report an `ephemeral-agent-unknown-defaulted` finding stating that the safe-side default was applied, so the choice is never a silent one.
- **FR-006** (ubiquitous): THE renderer for each declared `CI_PROVIDERS` entry (`renderJenkinsfile` in **jenkins-renderer.mjs** (S), `renderGithubActionsWorkflow` in **github-actions-renderer.mjs** (S), `renderGitlabCiConfig` in **gitlab-ci-renderer.mjs** (S)) SHALL be a pure function (no file I/O) that returns the complete pipeline-file text, ordering stages/jobs as: a Node self-provisioning step when `ephemeralAgent` is not `false`, then a source-path-guard step, then one group per promotion (deploy-window gate when enabled, CI-only quality gates, migrations when included, build-and-deploy, deploy-evidence when declared, and a manual infra-apply-approval gate) — capability: **pipeline-setup.render** (C).
- **FR-007** (unwanted): IF a promotion's `qualityGates` entry is marked `"pre-push"` rather than `"ci"`, THEN the rendered CI stage for that promotion SHALL NOT include a step for that gate, because it already ran in the pre-push hook and duplicating it in CI adds no coverage.
- **FR-008** (ubiquitous): THE rendered infra-apply-approval gate for every promotion, in every renderer, SHALL always require manual action to proceed (Jenkins `input`, GitHub Actions `environment:`, GitLab CI `when: manual`), because automatic infrastructure application does not exist anywhere in this schema (an explicit owner decision, not an omission).
- **FR-009** (unwanted): IF the target output path for a rendered pipeline file already exists and the `--force` flag is not given, THEN the renderer's CLI wrapper SHALL print the would-be content as a preview to stdout, SHALL leave the existing file untouched, and SHALL exit non-zero, because merging a hand-edited existing file is a human decision this tool does not make for them.
- **FR-010** (event): WHEN the interview answer for CI provider matches an entry in `CI_PROVIDERS`, THE core SHALL store it as the config's `ciProvider`; WHEN it is missing or does not match any registered entry, THE core SHALL store `"jenkins"` instead of raising an error, so an unrecognized provider name never aborts the rest of the interview and every renderer dispatch site (procedure and gate CLI alike) resolves to `tooling/pipeline-renderers/<ciProvider>-renderer.mjs` from that same stored value.

### Key Entities
- **pipeline config** (`sdd.pipeline.config.json`) — the serialized answer set: `deployBranch`, `environments`, `promotionMode`, `build`, `deployTarget`, `sourcePathGuards`, `promotions[]` (each with `from`/`to`/`deployWindow`/`qualityGates`/`migrations`/`deployEvidence`/`concurrencyLock`), `ticketRefRequired`, `ephemeralAgent`, `infraApply`, `rollbackStrategy` — distinct from `sdd.config.json`, which holds only the pointer knob (`pipelineConfigFile`), never a duplicated copy of the rich schema. The `deployWindow` sub-object's semantics (what counts as in/out of window) belong to SPEC-060.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: pipeline-setup
- **Symbols**: pipeline-setup-lib.mjs, jenkins-renderer.mjs, github-actions-renderer.mjs, gitlab-ci-renderer.mjs
- **Artifacts**: —
- **Capabilities**: pipeline-setup.render
- **Files**: tooling/pipeline-setup-lib.mjs, tooling/pipeline-renderers/jenkins-renderer.mjs, tooling/pipeline-renderers/github-actions-renderer.mjs, tooling/pipeline-renderers/gitlab-ci-renderer.mjs, tooling/pipeline-renderers/README.md, tooling/harness/sdd-pipeline-setup.SKILL.md, tooling/__tests__/pipeline-setup-lib.test.mjs, tooling/__tests__/jenkins-renderer.test.mjs, tooling/__tests__/github-actions-renderer.test.mjs, tooling/__tests__/gitlab-ci-renderer.test.mjs

## Dependencies (참조 — dedup 제외)
> `pipelineConfigFile` knob은 SPEC-001 소유(`sdd-config.mjs`)에 추가된 필드를 읽는다. 판정 타입 방출(`armVerdict`/`verdict`)은 SPEC-040 소유(`verdict-lib.mjs`). 배포 시간창의 판정 코어·게이트(`deploy-window-lib.mjs`·`check-deploy-window.mjs`)는 SPEC-060 소유 — 이 spec의 `check-deploy-window.mjs`(FR-006 렌더링 스테이지 텍스트)는 그 게이트를 **호출하는 셸 명령 문자열을 생성**할 뿐, 판정 로직을 갖지 않는다.
- **Modules**: key-pipeline (references), gate-verdict (references)
- **Symbols**: sdd-config.mjs, verdict-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `pipeline-setup-lib.test.mjs` 전 케이스 green — 질문 정의 형태·단일/다중 환경 직렬화·독립성·검증 3종 각 최소 1건. [검증: tooling/__tests__/pipeline-setup-lib.test.mjs]
- **SC-002**: 세 렌더러 테스트(`jenkins-renderer.test.mjs`·`github-actions-renderer.test.mjs`·`gitlab-ci-renderer.test.mjs`) 전 케이스 green — 승격 지점 반복 생성·스테이지 순서(경로 가드→배포창)·자가조달 조건부 포함·CI 전용 게이트 필터링·인프라 승인 항상 수동(제공자별 문법)·CLI 덮어쓰기 거부/`--force`/설정 없음, 세 렌더러가 같은 계약을 각자 어휘로 구현함을 확인. [검증: tooling/__tests__/jenkins-renderer.test.mjs, tooling/__tests__/github-actions-renderer.test.mjs, tooling/__tests__/gitlab-ci-renderer.test.mjs]

## Non-Functional Requirements
- **NFR-001**: `pipeline-setup-lib.mjs`의 판정 코어(`buildPipelineConfig`·`validatePipelineConfig`)는 답변 객체 입력만의 순수 함수다(IO 없음) — 인터뷰 진행(`AskUserQuestion`)·파일 쓰기는 소비 절차(`prompts/pipeline-setup.md`)와 게이트 CLI가 각각 주입하므로, 코어를 저장소·프로세스 없이 단독 테스트할 수 있다. [검증: tooling/__tests__/pipeline-setup-lib.test.mjs]

## Assumptions / Clarifications Retained
- 킷 자신에는 배포 대상 인프라가 없어(순수 도구 킷) `sdd.pipeline.config.json`이 미선언이고, 이 축은 킷 자기적용에서 **INERT**다.
- 오너의 명시적 결정(스키마 위치): 리치 스키마(`environments`·`promotions` 등)를 `sdd.config.json`에도 중복 저장하는 대신 `sdd.pipeline.config.json` 단일 파일 + `sdd.config.json`의 포인터 knob(`pipelineConfigFile`)으로 분리했다 — `evidenceManifest`/`smokeManifest` 선례와 같은 형태.
- 원 설계가 언급한 "(b) `local.verifiable=false`와 로컬 실측 요구의 모순 검사"는 Phase 2(QA 마감 사슬)의 소비자가 생기기 전까지 구현하지 않는다 — 스키마엔 값만 싣는다.
- **구조 결정(스펙 분할):** 원래 이 하나의 스펙 초안은 인터뷰·렌더러·배포 시간창 판정·pre-push 강제를 모두 담아 FR이 14개였다 — cohesion 게이트(`maxFRsPerSpec: 10`)가 분할을 권고했다. 상한을 올리는 완화 대신, 이미 독립 파일이던 두 관심사(설정 생성 vs 실시간 강제)를 실제로 분할해 SPEC-060(deploy-window)을 새로 만들었다 — 이 방법론이 금지하는 "자를 바꿔 재는" 완화가 아니라 진짜 재구성이다.
- **뒤집힌 결정 (2026-08-27):** "GitHub Actions·GitLab CI 렌더러를 Jenkins 안정화 전까지 미룬다"는 원래 결정을 오너 요청으로 뒤집었다 — 스키마가 처음부터 제공자 중립으로 설계돼 있어(값 저장에 지장 없음) 두 렌더러를 추가하는 것이 스키마 변경 없이 순수 추가로 끝났고, `jenkins-renderer.mjs`를 참조 구현으로 그대로 베껴 같은 스테이지 계약을 지키는 구조라 검증 부담이 예상보다 낮았다(README.md "새 렌더러 추가 절차"가 정확히 이 상황을 위한 것이었다). 원래 우려(다중 제공자 동시 진행 시 어느 쪽도 충분히 검증되지 않음)는 각 렌더러가 독립 테스트 파일(승격 반복·스테이지 순서·자가조달·CI 전용 게이트·인프라 승인 항상 수동·CLI 덮어쓰기 거부, `jenkins-renderer.test.mjs`와 동형)을 갖춰 개별적으로 green임을 확인해 해소했다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-26 | 셀프리뷰(코어 TDD + 게이트 카나리아 + 오너 확정 설계 대조) + 오너 설계 논의(3가지 구조적 정정 반영, retrofit이므로 Reviewed로 직접 작성) → Reviewed | FR-001~009 unit 커버. 킷 자기적용: 킷 자신에 배포 대상이 없어 INERT |
| 2026-08-26 | cohesion 게이트(FR 14개 > 10) 대응 — 배포 시간창 판정·강제를 SPEC-060으로 분할, 이 스펙은 인터뷰·직렬화·검증·Jenkins 렌더링(FR-001~009)만 유지 → Reviewed 유지 | 완화(cap 상향) 대신 실제 재구성. Ownership·Dependencies·SC를 분할에 맞춰 갱신 |
| 2026-08-27 | GitHub Actions·GitLab CI 렌더러 추가(FR-010 신설, FR-004·006·008 제공자 중립으로 일반화) → Reviewed 유지 | 오너 요청으로 "Phase 1은 Jenkins만" 결정을 뒤집음. FR-010 unit 커버(`ciProvider` 저장·미등록 값 폴백), 각 렌더러 독립 테스트로 계약 동형성 확인 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-26 이웃 SPEC-060(deploy-window): 비중복이자 자매 관계 — 059는 인터뷰 답변을 스키마로 직렬화하고 Jenkinsfile을 렌더링하는 **생성** 축, 060은 그 스키마의 `deployWindow` 값을 push 시점에 실시간으로 **판정·강제**하는 축이다. 059는 060을 값으로만 참조하고(렌더러가 060의 게이트를 호출하는 셸 명령 문자열만 생성), 판정 로직은 전혀 갖지 않는다 — 원래 한 스펙이었다가 cohesion 상한(FR 14개 > 10) 대응으로 분할했다.
- 2026-08-26 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 **행위**의 전제조건(미커밋 트리·upstream 뒤처짐·계획 범위 드리프트)을 판정하고, 059는 파이프라인 **정의 자체의 생성**(인터뷰→설정→Jenkinsfile)을 다룬다 — 판정 대상도 산출물도 겹치지 않는다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다.
  근거 칸은 실기록 행(실제 날짜)에서 빈 값 불가 — 변경의 "왜"는 저술 시점에만 캡처 가능하고
  사후 재도출이 불가능하다(선제 캡처, SPEC-009). completeness 게이트가 존재를 검사. -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-27 | GitHub Actions·GitLab CI 렌더러 추가(`github-actions-renderer.mjs`·`gitlab-ci-renderer.mjs`) + 인터뷰에 `ciProvider` 질문·`CI_PROVIDERS` 목록 신설(FR-010) | 원래 "Phase 1은 Jenkins만" 결정을 오너 요청으로 뒤집음 — 스키마가 처음부터 제공자 중립이라 순수 추가로 확장 가능했다 |
| 2026-08-26 | 배포 시간창 판정·강제(舊 FR-010~014)를 SPEC-060으로 분리 | cohesion 게이트가 FR 14개 > `maxFRsPerSpec`(10)를 지목 — 상한 완화 대신 이미 독립 파일이던 관심사를 실제로 분할 |
| 2026-08-26 | 초안(retrofit — Reviewed로 직접 작성) — `/sdd-pipeline-setup` 마법사(인터뷰 코어·Jenkins 렌더러) 신설 | 오너 확정 설계(2026-08-26) + 코드 리뷰 결과 3가지 구조적 정정(SPEC 신설·pre-push 배선 위치를 킷 정본 템플릿으로·스키마 중복을 포인터 knob으로 회피)을 반영해 구현 완료 후 착지 |

> **폐기 시:** `Status=Removed` + **코드·테스트를 같은 PR로 동시 삭제**(dangling `@covers`는 FR 게이트가 막음) + 이 표에 제거 기록 → spec 파일 삭제(git이 히스토리 보존). 상세: `STRUCTURE.md` 폐기 수명주기.
