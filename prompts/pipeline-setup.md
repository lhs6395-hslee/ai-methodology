# CI/CD 배포 파이프라인 셋업 마법사 (SPEC-059) — 이 파일 하나로 실행

> **한 줄 사용법:** 대화창에 `이 프로젝트 CI/CD 파이프라인 설정해줘` 또는 설치돼 있으면 `/sdd-pipeline-setup`.
> **대상:** 이미 SDD가 채택된 프로젝트(`sdd/`가 있음). 아직이면 먼저 `/sdd-start`(`prompts/adopt.md`).
> **무엇을 만드나:** 대화형 인터뷰 → `sdd.pipeline.config.json`(선언) + 선택한 CI 제공자의 설정
> 파일(생성물 — Jenkinsfile·`.github/workflows/pipeline.yml`·`.gitlab-ci.yml` 중 하나). 손으로 짠
> 파이프라인이 반복적으로 겪은 결함(hard 게이트인데 실행 조건이 안 맞아 조용히 무발화 — node
> 미설치, 로컬 브랜치명 vs 실제 push 대상 혼동, 배포창 계산의 고정 오프셋 DST 어긋남)을 질문-응답이
> 유도하는 안전한 기본값으로 미리 막는다.

**정본:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw로 받았다면 그 `<ref>`를, 로컬 키트면 `main`을 REF로 쓴다.

## 실행 순서

1. **선행 판별.** `sdd/`가 없으면 중단하고 `/sdd-start`로 안내한다. 이미 `sdd.pipeline.config.json`이
   있으면 재실행 여부(이전 답변을 버리고 새로 받을지)를 먼저 확인한다.

2. **경로 가드 추천값 미리 계산.** 인터뷰를 시작하기 전에 프로젝트 루트를 스캔해
   `package.json`·`Dockerfile`·`go.mod`·`requirements.txt`·`pom.xml`·`*.csproj` 중 실재하는 것을
   찾아둔다 — D섹션 질문에서 이 추천값을 먼저 보여주고 확인/수정만 받는다(빈 화면에서 시작하지
   않는다).

3. **인터뷰.** `tooling/pipeline-setup-lib.mjs`의 `INTERVIEW_QUESTIONS` 배열을 **그 순서 그대로**
   `AskUserQuestion`으로 하나씩 묻는다. 이 배열이 질문의 유일한 소스다 — 절차 문서가 질문을
   창작하거나 순서를 바꾸지 않는다.
   - `type: "select"`/`"multiselect"`는 옵션을 chip으로(멀티초이스 우선 — 자유 텍스트로 유도하지
     않는다).
   - `dependsOn(answers)`가 있는 질문은 그 함수가 이미 모은 답변에 대해 참일 때만 묻는다(예:
     `localVerifiable`은 `environments`에 `"local"`이 포함된 경우만, `promotionMode`는 `dev`와
     `prod`가 둘 다 있는 경우만).
   - `perPromotion: true`인 질문(E섹션: `deployWindow`·`qualityGates`·`migrations`·
     `deployEvidence`·`concurrencyLock`)은 승격 지점마다 반복한다. 승격 지점 개수는 `environments`
     답변에서 파생된다 — 환경이 1개면 배포 브랜치 → 그 환경 1건, 여러 개면
     `promotionMode`(sequential/independent)에 따라 지점을 정한다. 각 지점의 답변을 독립적으로
     모아 `{ to, deployWindow, qualityGates, migrations, deployEvidence, concurrencyLock }` 형태로
     `promotions` 배열에 쌓는다(첫 지점의 `from`은 `deployBranch`, 이후는 이전 지점의 `to`를
     이어받는다 — `buildPipelineConfig`가 이 이어받기를 자동으로 한다. 호출자는 `to`와
     승격별 답변만 넘기면 된다).
   - `reuseFrom: "sdd.config.json"`이 있는 질문(`stack`)은 먼저 그 파일에서 값을 찾아 있으면
     확인만 받고, 없으면 새로 묻는다.
   - `ciProvider`(A섹션, `pipeline-setup-lib.mjs`의 `CI_PROVIDERS` 목록에서 선택, 기본 `jenkins`)가
     6~7단계에서 어느 렌더러를 부를지 정한다 — 이 답변을 절차 문서가 임의로 해석하지 않는다.
   - G섹션(`qaClosingChainRequested`)은 마지막에 묻되, **이번 범위에서는 답변을 스키마에 저장하지
     않는다**(Phase 2 스텁 — 아래 8단계 참고).

4. **직렬화.** 모은 답변을 `buildPipelineConfig(answers)`(`tooling/pipeline-setup-lib.mjs`)에 넘겨
   `sdd.pipeline.config.json` 스키마 객체를 얻는다.

5. **검증·경고 — 조용히 넘기지 않는다.** `validatePipelineConfig(config)`를 돌려 나온 findings를
   **하나도 빠짐없이** 사람에게 보여준다(3종 — 아래 (b)는 판정하지 않는 인터페이스 노트일 뿐이다,
   `sdd/specs/SPEC-059-pipeline-setup.md`의 Edge Cases 참고):
   - `window-without-ci-gate` — 배포 시간창은 켰는데 품질 게이트가 전부 pre-push뿐이면, CI 전용
     게이트를 최소 하나 추가하도록 권한다(로컬 훅은 `--no-verify`·훅 미설치 클론·웹 UI 머지로
     우회된다).
   - `infra-apply-no-renderer-template` — 배포 대상이 kubernetes가 아니면, 인프라 적용 승인 스텝은
     설정만 저장되고 선택한 렌더러(`ciProvider`)가 실제 적용 로직을 못 낸다는 사실을 알린다.
   - `ephemeral-agent-unknown-defaulted` — "모르겠음"으로 답했으면 안전측(자가조달 포함)으로
     기본 적용했다는 사실을 알린다(조용한 기본값 금지 — 사람이 나중에 왜 이 블록이 있는지 몰라선
     안 된다).
   경고를 확인했다는 사람의 응답을 받은 뒤에만 다음 단계로 진행한다.

6. **미리보기 → 승인 게이트.** 답변한 `ciProvider`에 따라 아래 중 하나를 부른다 — 파일명은
   `tooling/pipeline-renderers/<ciProvider>-renderer.mjs`로 기계적으로 정해진다(새 제공자를 추가한
   경우도 같은 규칙):
   | `ciProvider` | 렌더러 | 생성물 |
   |---|---|---|
   | `jenkins`(기본) | `jenkins-renderer.mjs` | `Jenkinsfile` |
   | `github-actions` | `github-actions-renderer.mjs` | `.github/workflows/pipeline.yml` |
   | `gitlab-ci` | `gitlab-ci-renderer.mjs` | `.gitlab-ci.yml` |

   CLI를 실제로 실행하기 전에, 그 렌더러의 `render*(config)`가 낼 전체 텍스트를 사람에게 미리
   보여준다. 대상 프로젝트에 이미 같은 이름의 파일이 있으면 **자동으로 덮어쓰지 않는다** — CLI
   자체도 같은 계약을 지킨다(기존 파일 있으면 미리보기만 내고 비-0 종료, `--force`만 강제 덮어씀).
   기존 파일이 있으면 사람에게 병합 방법(수기 병합 또는 명시적 `--force`)을 물어서 진행한다.

7. **저장.**
   - `sdd.pipeline.config.json`을 프로젝트 루트에 쓴다.
   - `node tooling/pipeline-renderers/<ciProvider>-renderer.mjs`를 실행해 위 표의 생성물을 만든다.
   - `sdd.config.json`의 `pipelineConfigFile`(기본값이면 생략 가능)·`deployWindowPolicy`를 확인한다.
     배포 시간창을 실제로 강제하려면 `deployWindowPolicy`를 `"advisory"` 또는 `"hard"`로 올리도록
     안내한다(기본 `"off"` — 마법사를 돌려도 명시적으로 승격하기 전까지는 pre-push에서 침묵한다,
     `deployScopeCommand` 계열과 같은 선언-의존 원칙). 이 배포 시간창 pre-push 게이트는 제공자와
     무관하게 하나뿐이다(`check-deploy-window.mjs`, SPEC-060) — CI 쪽 렌더링 산출물이 무엇이든
     로컬 push 시점 판정은 공통이다.

8. **Phase 2 진입 질문 처리.** `qaClosingChainRequested`에 "예"로 답했으면 "QA 마감 사슬 설정은
   아직 준비 중"이라고 답하고 종료한다. 질문 목록·스키마는 이번 범위 밖 — 지금 임의로 만들지
   않는다.

9. **확인.** 생성된 `sdd.pipeline.config.json`과 렌더링 산출물을 커밋하기 전에
   `node --test tooling/__tests__/deploy-window.test.mjs`(킷 자체 개발 중이면) 또는 단순히
   생성된 파일의 문법을 사람이 눈으로 확인하도록 권한다. 커밋은 사람이 명시적으로 요청할 때만
   (이 스킬 자체가 자동 커밋하지 않는다).

## 고정 규칙 (발명 금지)
- **질문 정의의 유일한 소스는 `pipeline-setup-lib.mjs`다.** 새 질문이 필요하면 라이브러리를 고치고
  SPEC-059를 갱신한다 — 절차 문서에서 즉흥으로 묻지 않는다.
- **자동 덮어쓰기 금지.** 기존 렌더링 산출물이 있으면 병합은 항상 사람이 한다.
- **경고는 절대 생략하지 않는다.** `validatePipelineConfig`의 3종 findings는 매번 전부 보여준다.
- **인프라 적용은 항상 승인 대기다.** 자동 적용 옵션은 이 스키마에 존재하지 않는다 — 제공자가
  1급 대기 문법을 안 주면(GitHub Actions) 가장 가까운 것을 쓰고 한계를 명시한다.
- **렌더러 선택은 `ciProvider` 답변이 결정한다.** 절차 문서가 임의로 제공자를 가정하지 않는다.
- **Phase 2(QA 마감 사슬)는 이 절차의 범위 밖이다.** 진입 질문만 받고 "아직 준비 중"으로 답한다.
