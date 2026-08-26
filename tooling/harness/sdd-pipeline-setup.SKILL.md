---
name: sdd-pipeline-setup
description: CI/CD 배포 파이프라인 셋업 마법사 — 대화형 인터뷰로 sdd.pipeline.config.json을 만들고 Jenkinsfile을 생성한다. 손으로 짠 파이프라인이 반복적으로 겪는 결함(hard 게이트인데 실행 조건이 안 맞아 조용히 무발화)을 질문-응답으로 미리 막는다.
---
# /sdd-pipeline-setup — CI/CD 배포 파이프라인 셋업 (SPEC-059, Phase 1)

**정본 절차(SSOT):** `prompts/pipeline-setup.md`를 **그대로 실행**한다(절차 원본은 그 파일 한 곳 —
중복 저장 안 함). 로컬 키트가 있으면 `<KIT>/prompts/pipeline-setup.md`(캐시 위치 관례
`~/Documents/claude/sdd`)도 동일. 아래는 요약 + 고정 규칙(가드레일) — **원본과 충돌 시 원본 우선**.

## 선행 판별
- `sdd/`가 없는 프로젝트면 **중단** → 먼저 `/sdd-start`로 채택한다. 이 스킬은 이미 채택된 프로젝트
  전용이다(스펙·게이트 배선을 전제로 배포 시간창 게이트(`check-deploy-window.mjs`)를 얹는다).
- 이미 `sdd.pipeline.config.json`이 있으면 재실행 여부를 사람에게 먼저 확인한다(덮어쓰면 이전
  답변이 사라진다) — 이 스킬 자체가 승인 없는 덮어쓰기를 하지 않는다는 계약을 스스로도 지킨다.

## 절차 (prompts/pipeline-setup.md 요약)
1. **인터뷰.** `tooling/pipeline-setup-lib.mjs`의 `INTERVIEW_QUESTIONS`를 순서대로
   `AskUserQuestion`으로 하나씩 묻는다(멀티초이스 우선, `dependsOn`이 있으면 조건 만족할 때만).
   경로 가드(D섹션)는 매니페스트 스캔(`package.json`·`Dockerfile`·`go.mod`·`requirements.txt`·
   `pom.xml`·`*.csproj` 존재 확인)으로 추천값을 먼저 만들어 확인/수정만 받는다.
2. **직렬화·검증.** 답변을 `buildPipelineConfig(answers)`로 `sdd.pipeline.config.json` 스키마에
   맞추고, `validatePipelineConfig(config)`로 4종 경고를 확인해 있는 그대로 사람에게 보여준다
   (조용히 넘기지 않는다 — 특히 `ephemeral-agent-unknown-defaulted`는 안전측 기본값을 썼다는
   사실 자체가 알림이다).
3. **미리보기 → 승인 게이트.** `renderJenkinsfile(config)`로 생성될 Jenkinsfile 전체를 미리보기로
   제시한다. 대상 프로젝트에 이미 `Jenkinsfile`이 있으면 **자동 덮어쓰지 않는다** — 미리보기만
   내고, 병합은 사람이 한다(`jenkins-renderer.mjs` CLI 자체의 계약과 동일).
4. **저장.** 승인 후 `sdd.pipeline.config.json`을 쓰고, `node tooling/pipeline-renderers/jenkins-renderer.mjs`로
   `Jenkinsfile`을 생성한다(`--force`는 사람이 명시적으로 원할 때만).
5. **config 배선 확인.** `sdd.config.json`의 `pipelineConfigFile`·`deployWindowPolicy`를 확인하고,
   배포 시간창을 실제로 강제하려면 `deployWindowPolicy`를 `advisory` 이상으로 올리도록 안내한다
   (기본은 `off` — 마법사를 돌려도 강제는 명시적 승격 전까지 침묵한다).
6. **Phase 2 진입 질문.** 마지막 질문(`qaClosingChainRequested`)에 "예"로 답하면 "QA 마감 사슬은
   아직 준비 중"이라고 답하고 종료한다(이번 범위 밖 — 스키마에 값만 남긴다).

## 고정 규칙 (발명 금지)
- **인터뷰 순서·질문 정의는 `pipeline-setup-lib.mjs`가 유일한 소스다** — 이 스킬이나 절차 문서가
  질문을 마음대로 추가·생략하지 않는다(새 질문이 필요하면 라이브러리를 고치고 스펙을 갱신한다).
- **자동 승인·자동 덮어쓰기 금지.** Jenkinsfile이 이미 있으면 병합은 항상 사람이 한다.
- **안전측 기본값은 조용히 넘기지 않는다.** `validatePipelineConfig`의 경고 4종은 반드시 사람에게
  보여준 뒤 진행한다.
- **자동 인프라 적용은 이 스키마에 존재하지 않는다** — 인프라 적용 스텝은 항상 승인 대기.
