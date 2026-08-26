# 파이프라인 렌더러 인터페이스 계약 (SPEC-059)

`sdd.pipeline.config.json`(스키마는 `tooling/pipeline-setup-lib.mjs`의 `buildPipelineConfig` 참고)을
받아 실제 CI/CD 설정 파일 텍스트를 산출하는 얇은 계층. 제공자별 렌더러는 이 계약만 지키면 된다 —
인터뷰 코어(`pipeline-setup-lib.mjs`)는 어떤 렌더러가 있는지 모른다(선언 어휘와 렌더러가 분리).

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

## 지원 현황

| 제공자 | 스키마 반영 | 렌더러 |
|---|---|---|
| Jenkins | ✓ | ✓ (`jenkins-renderer.mjs`) |
| GitHub Actions | ✓ | 아직 없음 |
| GitLab CI | ✓ | 아직 없음 |

`sdd.pipeline.config.json` 스키마 자체는 제공자 중립이다 — 위 표에서 "렌더러 아직 없음"인 제공자도
설정은 똑같이 저장·검증(`validatePipelineConfig`)되고, 렌더러만 나중에 추가하면 된다.

## 새 렌더러 추가 절차

1. `tooling/pipeline-renderers/<provider>-renderer.mjs`를 만들고 순수 `render<Provider>file(config)`를
   `export`한다 — `jenkins-renderer.mjs`를 참조 구현으로 베낀다(스테이지 순서는 위와 동일하게 유지:
   자가조달 → 경로 가드 → 승격 지점마다 5~6단계).
2. 하단에 얇은 CLI `main()`을 추가한다(기존 파일 있으면 미리보기만, `--force`로만 덮어쓰기).
3. `tooling/__tests__/<provider>-renderer.test.mjs`를 추가한다 — 승격 지점 여러 개일 때 스테이지가
   반복 생성되는지, 배포창 게이트가 경로 가드 뒤에 오는지, 자가조달 블록 존재 여부를 정규식으로
   단정한다(`jenkins-renderer.test.mjs`가 표준 스타일).
4. 이 표를 갱신한다.
5. `prompts/pipeline-setup.md`가 제공자를 묻는 질문을 추가하기로 결정했다면(Phase 1은 Jenkins
   고정이므로 이 단계는 Phase 1 범위 밖) 인터뷰 절차에도 분기를 추가한다.
