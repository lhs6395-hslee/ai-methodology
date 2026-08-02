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

### Key Entities
- **deploy-guard** — the check that fires at deploy time rather than commit time, so that a change already living in production has its rationale written down before the commit gate ever sees it.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: deploy-guard
- **Symbols**: deploy-guard-lib.mjs, check-deploy-guard.mjs, sdd-deploy-check.sh
- **Artifacts**: —
- **Capabilities**: deploy-guard.gate
- **Files**: tooling/deploy-guard-lib.mjs, tooling/check-deploy-guard.mjs, tooling/harness/sdd-deploy-check.sh, tooling/__tests__/deploy-guard.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob·설치 배선은 각 소유 스펙(001/004). 커밋 시점 spec-first는 SPEC-003이 소유하고 이 spec은 그보다 **앞선 발화 지점**만 담당한다. 라이브 실물 대조는 SPEC-032.
- **Modules**: key-pipeline (references), spec-sync (references), live-reality (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `deploy-guard.test.mjs` 전 케이스 green — 명령 파싱 5분기·기록 판정·findings 4종·게이트 e2e(경고 후 exit 0, 커밋 후 침묵). [검증: tooling/__tests__/deploy-guard.test.mjs]
- **SC-002**: 재현 픽스처에서 스펙 미수정·Change Log 행 없음·형식 미달·충족(침묵)의 4단계가 각각 구분돼 출력된다. [검증: tooling/__tests__/deploy-guard.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 정규식·집합 대조만의 순수 함수이고 git 조회는 소비 게이트가 수행하므로, 훅이 없는 환경에서도 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/deploy-guard.test.mjs]

## Assumptions / Clarifications Retained
- 감지 패턴은 프로젝트가 `outOfBandDeployCommands`로 대체한다 — 킷 기본값은 kubectl·helm·terraform·클라우드 CLI의 상태 변경 서브커맨드다(도구를 못 박지 않는다).
- "같은 세션 내"를 시간으로 판정하지 않고 **워킹트리 상태**로 판정한다 — 세션 경계는 기계가 알 수 없고, 미커밋 여부는 결정적이다.

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
