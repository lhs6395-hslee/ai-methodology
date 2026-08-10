# Feature Specification: Deploy Guard (out-of-band 배포 — spec-first 발화 지점을 배포 행위까지)

**Module**: `sdd-tooling`  **Spec**: `SPEC-035`  **Created**: 2026-08-02  **Status**: Active
**Input**: 소비 프로젝트 실측 제보 — infra 산출물(Grafana 대시보드 ConfigMap 등)을 워킹트리에서 수정한 뒤 `kubectl apply`로 라이브에 즉시 반영하는 작업 패턴에서 스펙 갱신이 자동으로 강제되지 않는다. `check-spec-sync`는 commit-msg 훅이라 **커밋 시점**에만 발화하는데, 이 궤도는 "배포가 커밋보다 먼저"라 커밋을 미루는 동안 spec↔live 드리프트가 누적된다(실사례: INFRA-005 라이브→저장소 역방향 드리프트 흡수, 2026-08-02).

---

## User Scenarios & Testing

### User Story 1 — 라이브에 넣은 순간 기록을 요구한다 (P1)
운영자가 미커밋 매니페스트를 `kubectl apply`로 반영하면, 훅이 그 파일의 소유 스펙을 찾아 이번 반영이 Change Log에 착지했는지 확인하고 없으면 즉시 상기시킨다. 배포는 이미 끝났으므로 차단하지 않는다 — 커밋 전에 적게 만드는 것이 목적이다.
- **Independent Test**: `deploy-guard.test.mjs`가 순수 코어(명령 파싱·dry-run 제외·Change Log 행 판정·형식 검사·findings 분기)와 게이트 배선(경고 후 exit 0, 커밋된 소스는 침묵)을 단독 검증. [검증: tooling/__tests__/deploy-guard.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an uncommitted manifest owned by a spec whose Change Log has no new row, **When** `kubectl apply -f` runs, **Then** the hook names the spec and the missing record and exits zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **항상 비차단이다** — PostToolUse는 명령이 **이미 실행된 뒤**에 돈다. 막을 것이 없고 배포를 되돌리는 것은 게이트의 일이 아니다. 진짜 차단은 커밋(commit-msg)·CI가 계속 담당하며, 이 훅은 그 차단이 오기 전에 적게 만든다.
- **조회·계획·dry-run은 감지하지 않는다** — 상태를 바꾸지 않으므로 드리프트를 만들지 않는다(`kubectl get`·`terraform plan`·`--dry-run`). 오탐이 잦으면 사람이 훅을 통째로 꺼버리므로, 감지 범위를 상태 변경으로 좁히는 것이 강제력을 지키는 길이다.
- **커밋된 소스 배포는 정상 궤도라 침묵한다** — 이미 spec-sync를 통과한 것이다. 경고 대상은 **미커밋 소스가 라이브에 반영된 경우**뿐이다.
- 미소유 배포 소스는 별도로 지목한다 — 소유 스펙이 없으면 드리프트 레이더 자체가 없다(`specSyncUnownedPolicy`의 배포 시점 거울상).
- 선언적 산출물(대시보드 JSON-in-ConfigMap 등)은 FR 문구가 아니라 Change Log로만 추적된다. 그래서 **최소 기록 형식**을 검사한다: 한 행에 날짜·무엇을·왜가 채워지고 실측 여부가 `[검증: <경로>]` 또는 `[미확인]`으로 표기돼야 한다. 형식과 존재만 본다 — 타당성은 리뷰 몫이다.
- git 없음·정책 off·경로 미매치·`node` 부재면 침묵한다(이식성 — 강제는 commit-msg·CI가 계속 돈다).
- Node 전용이다(`check-pre-edit`과 같은 훅 편의 계층 선례). 런타임 패리티 대상은 **판정 게이트**이고, 훅 헬퍼가 없는 런타임에서도 커밋·CI 강제는 그대로 작동한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a Bash command matches a declared out-of-band deploy pattern and names local source files, the **deploy-guard** (E) core in **deploy-guard-lib.mjs** (S) SHALL report it as a deploy and extract those paths, and SHALL NOT match read-only, plan, or dry-run invocations. — capability: **deploy-guard.gate** (C).
- **FR-002** (event): WHERE a deployed source path is uncommitted, **check-deploy-guard.mjs** (S) SHALL resolve its owning spec through the Files globs and report the spec as untouched, as touched without a new Change Log row, or as carrying a row that misses the minimum record shape.
- **FR-003** (unwanted): IF a deployed source path is owned by no spec, THEN THE SYSTEM SHALL report it as unowned so the deploy does not stay outside the drift radar.
- **FR-004** (state): WHILE the guard runs from the **sdd-deploy-check.sh** (S) hook wrapper, THE SYSTEM SHALL exit zero in every branch, and SHALL stay silent when the source is committed, when the policy is off, or when the repository has no git directory.
- **FR-006** (unwanted): IF a deploy command is about to run while the working tree has uncommitted changes or the branch is behind its upstream, THEN **check-deploy-precheck.mjs** (S), invoked from the **sdd-deploy-precheck.sh** (S) wrapper that must not swallow its exit code, SHALL report that the deploy is not reproducible from any revision — warning under advisory and exiting with the PreToolUse block code under hard — and SHALL classify a missing upstream as unjudged rather than as a violation, never blocking on it.
- **FR-007** (event): WHEN a deploy is detected, THE SYSTEM SHALL judge service survival separately from command success: WHERE `deploySmokeCommand` is declared, it SHALL be executed with a non-zero exit read as failure rather than as skip; WHERE it is undeclared, that absence SHALL itself be reported, and under hard both outcomes SHALL be recorded as debt settled only by a passing smoke or by declaring the command — never by editing a spec.
- **FR-008** (unwanted): IF a deploy command bypasses review — an auto-approve flag without a saved plan argument — or performs a destructive operation without per-invocation consent in the environment, THEN the **deploy-guard** (E) core SHALL report it before the command runs, treating an applied saved plan as legitimately approved and a declared consent as a recorded trace rather than a violation.
- **FR-005** (state): WHILE `outOfBandDeployPolicy` is hard, **check-deploy-guard.mjs** (S) SHALL append each unrecorded deploy to `outOfBandDeployDebtFile` as one JSON line while still exiting zero, and **check-deploy-debt.mjs** (S) SHALL — at pre-commit — settle every debt whose owning spec has a Change Log row added in the staged change, rewrite the file with only the unsettled lines (preserving unparseable lines), and exit non-zero while any debt remains; WHERE the policy is not hard or the file is absent, THE gate SHALL exit zero in silence.

### Key Entities
- **deploy-guard** — the check that fires at deploy time rather than commit time, so that a change already living in production has its rationale written down before the commit gate ever sees it.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: deploy-guard
- **Symbols**: deploy-guard-lib.mjs, check-deploy-guard.mjs, check-deploy-debt.mjs, check-deploy-precheck.mjs, sdd-deploy-check.sh, sdd-deploy-precheck.sh
- **Artifacts**: —
- **Capabilities**: deploy-guard.gate
- **Files**: tooling/deploy-guard-lib.mjs, tooling/check-deploy-guard.mjs, tooling/check-deploy-debt.mjs, tooling/check-deploy-precheck.mjs, tooling/harness/sdd-deploy-check.sh, tooling/harness/sdd-deploy-precheck.sh, tooling/__tests__/deploy-guard.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob·설치 배선은 각 소유 스펙(001/004). 커밋 시점 spec-first는 SPEC-003이 소유하고 이 spec은 그보다 **앞선 발화 지점**만 담당한다. 라이브 실물 대조는 SPEC-032.
- **Modules**: key-pipeline (references), spec-sync (references), live-reality (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `deploy-guard.test.mjs` 전 케이스 green — 명령 파싱 5분기·기록 판정·findings 4종·게이트 e2e(경고 후 exit 0, 커밋 후 침묵). [검증: tooling/__tests__/deploy-guard.test.mjs]
- **SC-002**: 재현 픽스처에서 스펙 미수정·Change Log 행 없음·형식 미달·충족(침묵)의 4단계가 각각 구분돼 출력된다. [검증: tooling/__tests__/deploy-guard.test.mjs]
- **SC-006**: `terraform destroy`가 감지 목록에 있고, 저장된 plan 없는 `-auto-approve`와 동의 없는 파괴적 명령이 각각 지목되며, 저장된 plan 적용·명시 동의는 통과한다(git 없는 디렉토리에서도 이 축은 판정된다). [검증: tooling/__tests__/deploy-guard.test.mjs]
- **SC-004**: 미커밋 트리에서 `deployPreconditionPolicy: hard`가 배포를 exit 2로 막고, 커밋 후에는 위반이 사라지며, upstream 없음은 hard에서도 차단하지 않고 미판정으로 표기된다. [검증: tooling/__tests__/deploy-guard.test.mjs]
- **SC-005**: `deploySmokeCommand` 미선언이 경로 인자 없는 배포에서도 표면화되고, 스모크 실패가 부채로 적재돼 커밋을 막으며, 스모크가 다시 통과하면 그 부채가 해소된다. [검증: tooling/__tests__/deploy-guard.test.mjs]
- **SC-003**: 같은 픽스처에서 advisory는 부채 파일을 만들지 않고, hard는 부채를 적재해 후속 커밋을 exit 1로 막으며, 소유 스펙 Change Log 행을 스테이징하면 해소돼 exit 0이 된다. [검증: tooling/__tests__/deploy-guard.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 정규식·집합 대조만의 순수 함수이고 git 조회는 소비 게이트가 수행하므로, 훅이 없는 환경에서도 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/deploy-guard.test.mjs]

## Assumptions / Clarifications Retained
- 감지 패턴은 프로젝트가 `outOfBandDeployCommands`로 대체한다 — 킷 기본값은 kubectl·helm·terraform·클라우드 CLI의 상태 변경 서브커맨드다(도구를 못 박지 않는다).
- "같은 세션 내"를 시간으로 판정하지 않고 **워킹트리 상태**로 판정한다 — 세션 경계는 기계가 알 수 없고, 미커밋 여부는 결정적이다.
- **승인한 것과 적용되는 것이 같아야 한다(FR-008).** 실측 사고에서 삭제는 **plan에 있었다** — 아무도 보지 않았을 뿐이다. 대화형 승인이 diff를 보는 유일한 지점인데 `-auto-approve`가 그것을 건너뛰면 "승인한 것"이라는 개념 자체가 사라진다. 반대로 **저장된 plan을 적용하는 `-auto-approve`는 정당하다**(CI가 이 형태다) — 그래서 위반 조건은 auto-approve 자체가 아니라 `저장된 plan 없는 auto-approve`다.
- **삭제는 갱신과 같은 강도로 다뤄지면 안 된다.** `terraform destroy`는 감지 목록에 **아예 없었다**(가장 파괴적인 명령이 보이지 않았다). 파괴적 명령은 `SDD_DESTROY_OK=1`로 **매 실행 동의**를 요구한다 — standing policy가 아니라 per-invocation 선언이라야 흔적이 남고 습관이 되지 않는다. 동의는 우회가 아니라 선언이므로 위반이 아니되 출력에 기록된다.
- **plan 내용은 파싱하지 않는다.** 무엇이 지워지는지는 terraform이 이미 말해 준다 — 킷이 그것을 흉내내면 도구별 포맷을 떠안고, 포맷이 바뀌는 순간 조용히 inert가 된다. 기계는 "승인 절차를 거쳤는가·동의가 선언됐는가"만 본다.
- **승인·파괴 축은 git이 없어도 성립한다** — 명령 문자열만 보므로, git 조회 실패로 조기 종료하면 그 축이 삼켜진다(재현 가능성 축과 발화 조건이 다르다).
- **두 축은 묻는 질문이 다르다.** `outOfBandDeployPolicy`는 "이 배포가 스펙에 반영됐나"(사후 상기), `deployPreconditionPolicy`는 **"이 배포가 재현 가능한 리비전에서 나오는가"**(사전 차단). 실측 제보: 가드가 `terraform apply`를 정확히 감지하고도 막지 못한 이유가 첫 질문만 물었기 때문이다.
- **전제 조건만 PreToolUse로 앞당긴다.** 스펙 드리프트를 사후에 두는 것은 "되돌릴 수 없는 것을 막는 척하지 않는다"는 원칙이지만, 미커밋 트리·upstream 뒤처짐은 순수 git 조회라 배포 **전에** 알 수 있다 — 막을 수 있는 것을 사후로 미루면 원칙이 아니라 그냥 늦는 것이다(실측: 사후 상기는 같은 세션의 **두 번째 apply**도 막지 못했다).
- **미판정은 hard에서도 차단하지 않는다.** upstream이 없으면 뒤처짐을 알 수 없는데, 모르는 것을 위반으로 세면 오탐이고 오탐이 잦은 사전 차단은 사람이 훅을 꺼버린다. 대신 침묵하지도 않는다 — "판정하지 못했다"를 명시한다.
- **명령의 성공은 서비스의 생존이 아니다.** 정본 §7이 다루는 "판정 없이 exit 0"의 배포판 사촌이다 — 실측: apply 성공 · CI 초록 · **전 요청 403**. 그래서 `deploySmokeCommand` **미선언 자체를 부채로 계상**한다(아무도 확인하지 않은 것과 확인해서 살아 있는 것이 같은 침묵으로 보이면 안 된다). 스모크의 비-0은 skip이 아니라 실패다(테스트·`e2ePrecheck`와 같은 반전 규약).
- **스모크 축은 경로 인자와 무관하다** — `kubectl rollout restart`처럼 소스 경로가 없는 배포도 서비스를 죽인다. 드리프트 축이 경로 없음으로 조기 종료하던 자리에서 스모크 축까지 함께 삼켜지던 것이 결함이었다.
- **부채는 종류마다 갚는 길이 달라야 한다** — 도달 불가능한 해소 조건은 강제가 아니라 벽돌이다. 스모크 부채는 스펙 편집으로 갚아지지 않고, `smoke-undeclared`는 선언으로 `smoke-dead`는 스모크 통과로 해소된다.
- 스모크가 통과했고 드리프트도 없으면 **조용할 자격이 있다** — 매 배포에 확인 메시지를 찍으면 그 소음이 훅을 꺼지게 한다.
- advisory와 hard의 차이는 **부채 적재**다(실측 제보: 둘이 출력도 동작도 같아 승격이 장식이었다). 배포 시점은 여전히 비차단이다 — 되돌릴 수 없는 것을 막는 척하지 않는다. 대신 막을 수 있는 유일한 지점, 아직 오지 않은 커밋에서 막는다.
- 부채는 **자동으로만** 해소된다 — 소유 스펙 Change Log에 행이 스테이징되는 순간이다. 사람이 파일을 지워 갚게 두면 "지우기"가 갚는 방법이 되고, 그러면 부채 파일은 기록 장치가 아니라 성가신 알림이 된다. 파싱 불가한 줄도 지우지 않는다(파싱 실패로 부채를 지우는 것이 곧 세탁이다).
- 부채 파일은 **로컬 세션 상태**라 커밋 대상이 아니다(sdd-init가 `.gitignore`에 `.sdd/`를 넣는다) — 추적하면 "커밋해서 없앤다"가 또 하나의 갚는 방법이 된다.
- 기각한 대안: hard에서 배포 명령 자체를 차단하기. PostToolUse는 명령이 **이미 실행된 뒤**에 돌아 차단할 대상이 없고, PreToolUse로 옮기면 배포 전 워킹트리만 보고 판정하게 돼 "배포 후 기록"이라는 이 spec의 궤도와 어긋난다. 재검토 조건: 훅 계약이 배포 명령의 사전 차단을 지원하게 되면.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-02 | 셀프리뷰(순수 코어 TDD·게이트 e2e·5분기 실측) + 소유자 개선 요청(out-of-band 배포 사각지대) → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-02 이웃 SPEC-003(spec-sync): 비중복 — 003은 **커밋** 시점에 소유 코드 변경의 스펙 동반을 차단하고, 이 spec은 그보다 앞선 **배포** 시점에 비차단으로 상기시킨다. 시점과 강도가 다르며 003이 차단을 계속 담당한다.
- 2026-08-02 이웃 SPEC-032(live-reality): 비중복 — 032는 이미 벌어진 선언↔실물 **차이를 측정**하고, 이 spec은 차이가 **생기는 순간**을 잡는다. 사후 측정 vs 발생 시점이다.
- 2026-08-02 이웃 SPEC-009(derivation-accounting): 비중복 — 009는 Change Log 근거의 선제 캡처 규범, 이 spec은 배포 시점에 그 캡처가 일어났는지 확인하는 트리거다. 규범 vs 트리거다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-02 | 초안 — `outOfBandDeployPolicy`·`outOfBandDeployCommands` + `deploy-guard-lib`(명령 파싱·기록 판정) + `check-deploy-guard` + PostToolUse(Bash) 훅 `sdd-deploy-check.sh` + sdd-init 배선 | 실측 제보: 배포가 커밋보다 먼저인 궤도에서 commit-msg 훅만으로는 커밋을 미루는 동안 신호가 0이라 spec↔live 드리프트가 누적됐다(INFRA-005 역방향 흡수). 발화 지점을 배포 행위까지 앞당기되, PostToolUse는 이미 실행된 뒤라 **비차단**이 유일하게 정직한 강도다 — 되돌릴 수 없는 것을 막는 척하지 않는다 [검증: tooling/__tests__/deploy-guard.test.mjs] |
| 2026-08-02 | 경로 인자 인식이 **단일 대시 옵션**(`-var-file=`·`-backend-config=`)을 수용하도록 확장 | 실측 제보(gsn-aiops-finops-module): Terraform 공식 문법은 단일 대시라 `terraform apply -var-file=stages/dev/x.tfvars`에서 경로가 하나도 안 잡혔고, 경로가 없으면 소비 게이트가 조기 종료해 **판정 자체가 성립하지 않았다** — terraform이 주 배포 수단인 프로젝트에서 이 게이트는 사실상 kubectl·helm 전용이었다 [검증: tooling/__tests__/deploy-guard.test.mjs] |
| 2026-08-02 | `outOfBandDeployPolicy=hard`에 실체 부여 — 미기록 배포를 `outOfBandDeployDebtFile`(JSONL)에 적재 + pre-commit의 `check-deploy-debt`가 잔여 부채로 커밋 차단, 소유 스펙 Change Log 행 스테이징 시 자동 해소. FR-005·SC-003 신설, sdd-init가 `.sdd/`를 .gitignore에 배선 | 실측 제보(gsn-aiops-finops-module): advisory와 hard가 **출력도 동작도 구분되지 않아** 승격이 무의미했다. 배포 시점은 여전히 못 막지만(이미 실행된 뒤) 아직 오지 않은 커밋은 막을 수 있다 — 터미널 스크롤은 죽고 파일은 남는다 [검증: tooling/__tests__/deploy-guard.test.mjs] |
| 2026-08-02 | 두 축 신설 — FR-006 배포 전제 조건(`deployPreconditionPolicy` + `check-deploy-precheck` PreToolUse, hard면 exit 2로 **실제 차단**)과 FR-007 배포판 거짓 안전(`deploySmokeCommand` 미선언=부채, 비-0=실패, 스모크 축은 경로 무관). 부채 해소를 종류별로 분기(`settleDebt(open, isSettled)`) | 실측 제보: 킷 가드가 `terraform apply`를 **정확히 감지하고도 막지 못했다** — 감지 후 묻는 것이 "스펙에 반영됐나" 하나뿐이었기 때문이다. 물었어야 하는 것은 "재현 가능한 리비전에서 나오는가"이고, 그건 순수 git 조회라 사전 판정이 가능하다(사후 상기는 같은 세션의 두 번째 apply도 못 막았다). 그리고 apply 성공·CI 초록·전 요청 403이 동시에 참일 수 있다 — 명령의 성공은 서비스의 생존이 아니다 [검증: tooling/__tests__/deploy-guard.test.mjs] |
| 2026-08-03 | FR-008 신설 — 승인 우회(`저장된 plan 없는 -auto-approve`)와 파괴적 명령(`SDD_DESTROY_OK=1` 미선언) 사전 판정 + `terraform destroy`를 감지 패턴에 편입 + 승인·파괴 축은 git 없이도 판정 | 실측 사고(2026-08-03, 프로덕션 전면 403 **두 번**): terraform이 코드에 없는 CloudFront 커스텀 헤더를 잔여물로 삭제했고 앱 proxy는 그 헤더가 없으면 전 요청을 403으로 막는다. `apply` exit 0·로그 무실패·사이트만 죽음. **그 삭제는 plan에 있었다 — 아무도 보지 않았을 뿐이다.** 그리고 `terraform destroy`는 감지 목록에 아예 없어 가장 파괴적인 명령이 레이더 밖이었다. 소비 프로젝트가 `tf-apply.sh` 래퍼로 임시 조치한 5단계 중 킷에 없던 2단계(저장 plan 적용·destroy 동의)를 흡수 [검증: tooling/__tests__/deploy-guard.test.mjs] |
| 2026-08-03 | Files 라인 파싱을 `spec-sync-lib.parseFilesLine`으로 교체(자체 정규식 제거) | SPEC-038 실수확 동반 — 판정 내용 무변, 문법 사이트만 단일화 |
| 2026-08-09 | 훅 입력 파서 정본화 — `commandFromHookInput`(deploy-guard-lib) | `readCommand`가 check-deploy-guard와 check-deploy-precheck에 **본문 동일**로 있었다(R13 구조 중복). PreToolUse/PostToolUse의 stdin JSON 계약이 두 곳에 복제되면 훅 입력 형식이 바뀔 때 한쪽만 따라간다. `readStdin`을 주입받아 코어 순수성 유지 |
| 2026-08-10 | 배포 게이트 3종(`deploy-guard`·`deploy-debt`·`deploy-precheck`)의 `git` 래퍼에 `core.quotepath=off` 적용 | 세 게이트 모두 스펙 파일 경로로 diff를 떠 Change Log 동반을 판정한다. 비ASCII 경로가 인용되면 그 대조가 조용히 어긋난다 — **거짓 통과와 거짓 위반이 같은 원인에서 나온다** |
