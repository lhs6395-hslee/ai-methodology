# 파이프라인 렌더러 인터페이스 계약 (SPEC-059)

`sdd.pipeline.config.json`(스키마는 `tooling/pipeline-setup-lib.mjs`의 `buildPipelineConfig` 참고)을
받아 실제 CI/CD 설정 파일 텍스트를 산출하는 얇은 계층. 제공자별 렌더러는 이 계약만 지키면 된다 —
인터뷰 코어(`pipeline-setup-lib.mjs`)는 제공자 **이름**(`CI_PROVIDERS`)만 알고 렌더러 구현은 모른다
(선언 어휘와 렌더러 구현이 분리 — 이름을 등록하는 것과 실제로 만드는 것은 다른 커밋일 수 있다).

## 계약

- **입력**: `sdd.pipeline.config.json`을 파싱한 JS 객체(config) 그대로. 렌더러가 스스로 파일을
  읽지 않는다 — 순수 함수 `render<Provider>file(config)`가 IO 없이 문자열을 반환한다.
- **반환**: 완성된 설정 파일 텍스트(문자열) 하나. 부분 조각이나 여러 파일을 반환하지 않는다
  (제공자가 여러 파일을 요구하면 CLI 래퍼에서 나눠 쓴다 — 코어 반환값 계약은 바뀌지 않는다).
- **CLI 래퍼**: 각 렌더러 파일 하단에 얇은 `main()`을 둔다 — `--config`(기본
  `sdd.pipeline.config.json`)를 읽고, `--out`(제공자별 관례 파일명)에 쓴다. **기존 산출물이 이미
  있으면 자동 덮어쓰지 않는다** — 미리보기만 stdout에 내고 비-0으로 종료한다(`--force`로만 강제).
  실측 근거: 자동 덮어쓰기는 사람이 손으로 얹은 예외·보정을 조용히 지운다. 병합은 사람이 한다.
- **판정 타입**: 게이트가 아니라 생성기다 — `verdict(VERDICT_KINDS.SKIPPED, ...)`로 자신을 밝힌다
  (`gen-changelog.mjs`와 같은 패턴). PASS/FAIL로 세지 않는다.

## 참조 구현

`jenkins-renderer.mjs` — `renderJenkinsfile(config)`. 스테이지 순서:

1. (ephemeralAgent가 `false`가 아니면) Node 자가조달 — Spot 등 매 실행 새로 뜨는 에이전트는 기본에
   node가 없다. `ephemeralAgent: "unknown"`도 안전측(포함)으로 처리한다.
2. 경로 가드 — `sourcePathGuards` 중 하나라도 없으면 즉시 실패.
3. 승격 지점(`promotions`)마다: 배포 시간창 게이트(`deployWindow.enabled`일 때만) → 품질 게이트
   (`qualityGates`에서 `"ci"`로 표시된 것만 — `"pre-push"` 항목은 이미 훅에서 돌았으므로 CI에서
   중복하지 않는다) → 마이그레이션 → 빌드·배포 → 배포 확인 → 인프라 적용 승인대기(`input` 스텝,
   항상 수동 승인 — 자동 적용은 스키마에 존재하지 않는다).

GitHub Actions에는 Jenkins의 `input` 같은 1급 대기 스텝이 없다 — job의 `environment:`(Environment
protection rule)로 표현하고, 실제로 막히려면 사람이 리포지토리 Settings에서 리뷰어를 설정해야
한다(렌더러가 자동으로 켜지 않는다 — 자동 인프라 적용이 스키마에 없는 것과 같은 이유로, 승인이
실제로 걸려 있는지까지 렌더러가 보장할 수는 없다). GitLab CI는 `when: manual`이 `input`과 가장
가까운 1급 문법이라 선언만으로 실제로 멈춘다.

## 지원 현황

| 제공자 | 스키마 반영 | 렌더러 |
|---|---|---|
| Jenkins | ✓ | ✓ (`jenkins-renderer.mjs`) |
| GitHub Actions | ✓ | ✓ (`github-actions-renderer.mjs`) |
| GitLab CI | ✓ | ✓ (`gitlab-ci-renderer.mjs`) |

인터뷰의 `ciProvider` 질문(기본값 `jenkins`, `pipeline-setup-lib.mjs`의 `CI_PROVIDERS`가 유일한
목록)이 어느 렌더러를 부를지 고른다 — `prompts/pipeline-setup.md`가 답변에 맞는
`tooling/pipeline-renderers/<ciProvider>-renderer.mjs`를 실행한다.

## 새 렌더러 추가 절차

1. `tooling/pipeline-setup-lib.mjs`의 `CI_PROVIDERS`에 새 제공자 id를 등록한다(인터뷰 선택지에
   나오려면 필수).
2. `tooling/pipeline-renderers/<provider>-renderer.mjs`를 만들고 순수 `render<Provider>(config)`를
   `export`한다 — `jenkins-renderer.mjs`를 참조 구현으로 베낀다(스테이지 순서는 위와 동일하게 유지:
   자가조달 → 경로 가드 → 승격 지점마다 5~6단계). 그 제공자에 `input` 동급 1급 수동 대기 문법이
   없으면(GitHub Actions처럼) 가장 가까운 것을 쓰고 한계를 주석으로 명시한다 — 조용히 자동 승인으로
   흐르게 두지 않는다.
3. 하단에 얇은 CLI `main()`을 추가한다(기존 파일 있으면 미리보기만, `--force`로만 덮어쓰기).
4. `tooling/__tests__/<provider>-renderer.test.mjs`를 추가한다 — 승격 지점 여러 개일 때 스테이지가
   반복 생성되는지, 배포창 게이트가 경로 가드 뒤에 오는지, 자가조달 블록 존재 여부·인프라 적용이
   항상 수동인지를 정규식으로 단정한다(`jenkins-renderer.test.mjs`가 표준 스타일).
5. 이 표와 `prompts/pipeline-setup.md`의 렌더러 디스패치 목록을 갱신한다.
