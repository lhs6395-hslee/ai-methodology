# Feature Specification: Test Suite Execution Gate

**Module**: `sdd-tooling`  **Spec**: `SPEC-021`  **Created**: 2026-07-16  **Status**: Active
**Input**: SDD 게이트는 FR↔test **커버리지 태그 회계**(check-fr-coverage)·**단언 존재**(check-test-adequacy)·**태그↔매니페스트 드리프트**(sdd-smoke-scan)만 검사할 뿐, **테스트 스위트를 실제로 실행해 green을 요구하는 단계가 없다** — 그래서 "커버리지 회계 green"이 "테스트 실행 green"으로 오인된다(도그푸딩: sync 전부 green인데 단위 스위트 3-error). 선언된 테스트 명령(`commands.test`)을 실제 실행해 결과를 확인하는 게이트를 `runTestsPolicy`(off|advisory|hard)로 문법화한다. 러너/언어 중립 — 프로젝트가 선언한 명령을 그대로 실행하고 exit code만 본다.

---

## User Scenarios & Testing

### User Story 1 — 커버리지 회계 ≠ 실행 결과 (P1)
커버리지 태그가 다 붙고 sync가 green이어도 스위트가 실제로 통과하는지는 별개다. `runTestsPolicy`를 `advisory`/`hard`로 켜면 게이트가 `commands.test`를 **실제로 실행**해 exit 0(green)을 확인한다 — `hard`는 실패 시 빌드를 깨고, `advisory`는 경고만(exit 0). 기본 `off`는 하위호환(실행 안 함). 실행 자체는 환경 의존·느릴 수 있어 opt-in이다.
- **Independent Test**: `test-run.test.mjs`가 순수 판정(`testRunVerdict`)과 게이트를 임시 명령(`true`/`false`)으로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `runTestsPolicy: hard` and `commands.test` that exits non-zero, **When** the test-run gate runs, **Then** it reports the failure and exits non-zero.

### User Story 2 — 실행 강제인데 명령 미선언은 검증 불가 (P1)
`runTestsPolicy`가 `advisory`/`hard`인데 `commands.test`가 없으면 "실행으로 검증할 수 없음"을 표면화한다(커버리지 회계 ≠ 실행 결과라는 오인을 막는 게 목적). `hard`에서는 미선언을 설정 오류로 exit 1, `advisory`는 경고만.
- **Independent Test**: `test-run.test.mjs`가 명령 미선언 × 정책 조합을 검증.
- **Acceptance (GWT)**: 1. **Given** `runTestsPolicy: hard` and no `commands.test`, **When** the gate runs, **Then** it reports that execution cannot be verified and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `runTestsPolicy`가 `off`(기본)면 게이트는 no-op(실행 안 함, exit 0) + "완료 주장 전 수동 실행 권장" 안내(하위호환).
- enum 밖 `runTestsPolicy` 값은 exit 1(문법화, 정의되지 않은 값 금지).
- `commands.test`가 green이면 exit 0, 실패면 `hard`=exit 1·`advisory`=exit 0(경고).
- 이 게이트는 **로컬 안전 tier(`commands.test`)만** 실행한다 — 인프라(`commands.smoke`)는 대상 아님(SPEC-015 tier 경계). env-gated 테스트는 의존성 부재 시 error가 아니라 사유 포함 skip이라 스위트 결과가 error 0으로 명확해진다(관례: METHODOLOGY 검증 tier).
- 이 게이트는 실행이 느려 pre-commit에 배선하지 않는다 — 완료 시점·CI·pre-push(opt-in)에서 돈다.
- skip률 임계 advisory(태그된 테스트가 조용히 전부 skip → 커버리지 허구)는 러너별 출력 파싱이 필요해 이 증분 밖(향후).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `runTestsPolicy` is `off` (default), THE SYSTEM SHALL not execute any command and SHALL exit zero, noting that the suite should be run manually before claiming completion (coverage accounting is not execution result).
- **FR-002** (event): WHEN `runTestsPolicy` is `advisory` or `hard` and `commands.test` is declared, THE SYSTEM SHALL execute that command and report its result, exiting non-zero on failure WHILE `hard` and warning without failing WHILE `advisory`.
- **FR-003** (unwanted): IF `runTestsPolicy` is `advisory` or `hard` but `commands.test` is not declared, THEN THE SYSTEM SHALL report that execution cannot be verified — exiting non-zero WHILE `hard`, warning WHILE `advisory`.
- **FR-004** (unwanted): IF `runTestsPolicy` holds a value outside `off|advisory|hard`, THEN THE SYSTEM SHALL report it and exit non-zero (no undefined value).

### Key Entities
- **run-tests policy** — the `off|advisory|hard` config controlling whether the declared test command is executed and how its failure is treated.
- **execution verdict** — the decision `{run, ok, hard, note}` derived from policy × command-presence × exit code, distinct from coverage accounting.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: test-execution
- **Symbols**: check-test-run.mjs
- **Artifacts**: —
- **Files**: tooling/check-test-run.mjs, tooling/__tests__/test-run.test.mjs

## Dependencies (참조 — dedup 제외)
> `commands.test` tier·config 문법은 SPEC-001/015 소유, 러너(sdd-run)는 SPEC-004, Python 복제는 SPEC-006. 이 spec은 실행-결과 게이트 계층만 소유.
- **Modules**: key-pipeline, test-domain, harness-install, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `test-run.test.mjs` 전 케이스 green + 게이트 판정·출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 `runTestsPolicy: hard` + `commands.test`로 돌 때 실제 테스트 스위트 green을 요구(커버리지 회계와 독립).

## Non-Functional Requirements
- **NFR-001**: 판정 코어(`testRunVerdict`)는 정책·명령유무·exit code만 보는 순수 함수라 결정적으로 단위 테스트되고, 실제 명령 실행(부작용)은 게이트 래퍼가 수행.

## Assumptions / Clarifications Retained
- 게이트는 러너/언어를 모른다 — 프로젝트가 `commands.test`로 선언한 명령을 그대로 실행하고 exit code만 판정한다(pytest·vitest·go test 등 무관).
- skip률 기반 "커버리지 허구" 감지는 러너별 출력 파싱이 필요해 이 증분 밖 — env-gated skip 관례(METHODOLOGY 검증 tier)가 스위트를 error 0으로 명확히 유지하는 것으로 1차 대응한다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-16 | 셀프리뷰(testRunVerdict 순수 코어 TDD·게이트 e2e·회귀) + owner 착수 승인 → Active | FR-001~004 unit 커버, skip률 advisory는 향후(러너별 파싱 필요) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-16 이웃 SPEC-007(verification-accounting): 비중복 — SPEC-007은 FR별 검증 상태 *회계*(unit/smoke/deferred 태그 존재), 이 spec은 스위트를 *실행해 결과*를 확인. "태깅됨" vs "실행 green"으로 축이 다름.
- 2026-07-16 이웃 SPEC-004(harness-install): 비중복 — SPEC-004의 `sdd-run`은 스테이지 명령을 실행만(exit code 전파), 이 spec은 그 실행에 `runTestsPolicy` 판정 계층을 얹음.
- 2026-07-16 이웃 SPEC-015(test-domain): 비중복 — SPEC-015는 `commands.test`/`commands.smoke` tier 경계, 이 spec은 로컬 안전 tier 실행-결과 게이트.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-16 | 초안 — `runTestsPolicy`(off|advisory|hard) + `check-test-run` 게이트(`commands.test` 실제 실행·exit 판정) + 판정 코어 `testRunVerdict`, Node·Python 패리티 | 도그푸딩(소비 프로젝트 B): sync 전부 green인데 단위 스위트 3-error — 커버리지 회계 ≠ 실행 결과라는 구조적 오인, "완료 주장 전 실행+결과 확인"을 문법화 |
