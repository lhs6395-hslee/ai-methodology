# Feature Specification: FR Verification Accounting

**Module**: `sdd-tooling`  **Spec**: `SPEC-007`  **Created**: 2026-07-05  **Status**: Active
**Input**: FR 게이트의 "조용히 미검증" 클래스를 제거한다 — 모든 FR이 unit-covered ∨ smoke-verified ∨ deferred 중 하나로 **회계(accounting)** 되도록 `strictSpecs`(전역 `--strict`의 점진 브리지)·`requireAccounting`(R3)·`smokeManifest`(회계 매니페스트)를 문법화한다.

---

## User Scenarios & Testing

### User Story 1 — 미검증 FR의 상태를 선언으로 강제 (P1)
incremental 모드의 "0커버 spec은 warn"은 점진 도입엔 옳지만, 성숙한 프로젝트에선 미검증 FR이 경고 속에 조용히 쌓인다. `requireAccounting`을 켜면 모든 FR이 unit(@covers 태그)·smoke(매니페스트의 method+evidence)·deferred(매니페스트의 reason) 중 하나로 선언되어야 하고, 어느 것도 아닌 FR은 R3 에러로 빌드를 깬다. evidence/reason의 **질**은 기계가 판정할 수 없으므로 **존재만** 강제한다(질은 리뷰 몫 — 과장 금지).
- **Independent Test**: `fr-accounting.test.mjs`가 미회계 FR의 R3 실패, 매니페스트 회계 후 통과, 검증 에러(dangling·빈 값)를 임시 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec with an FR that has no unit tag and no manifest entry, **When** the fr gate runs with `requireAccounting` true, **Then** it reports that FR as R3 unaccounted and exits non-zero.

### User Story 2 — spec 단위 strict 브리지 (P1)
전역 `--strict`는 전 spec 완전 커버를 요구해 도입 장벽이 높다. `strictSpecs`에 등재한 spec만 strict 의미(모든 FR unit 커버 필수)를 받으므로, 완전 커버에 도달한 spec부터 하나씩 잠그며 전역 strict로 수렴한다. 등재 spec에는 smoke/deferred가 unit을 **대체할 수 없다**.
- **Independent Test**: `fr-accounting.test.mjs`가 등재 spec의 부분/0 커버 실패, 미등재 spec의 incremental 유지, 매니페스트 비대체를 검증.
- **Acceptance (GWT)**: 1. **Given** a spec listed in `strictSpecs` with one uncovered FR, **When** the fr gate runs without `--strict`, **Then** it exits non-zero for that spec while unlisted specs still warn.

### Edge Cases
- 회계 config가 전부 미설정(기본값)이면 게이트 출력·판정은 현행과 동일하다(리포트에 accounted 세그먼트 없음 — 하위호환).
- 한 FR이 unit 태그와 매니페스트 엔트리를 동시에 가지면 unit으로 분류한다(unit > smoke > deferred 우선순위, 이중 집계 금지).
- 매니페스트 키 문법은 config 파생값(`specIdPrefixes`·`requirementIdPrefixes`, 레터 서픽스 1자 포함)을 그대로 쓴다 — 별도 하드코딩 사이트 금지(SPEC-006).
- `strictSpecs`의 존재하지 않는 spec ID는 조용히 건너뛰지 않고 에러다(오타가 강제 해제로 이어지는 것 방지).
- 매니페스트 파일 자체의 부재·JSON 파싱 실패·비객체 최상위는 M0 에러로 즉시 실패한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a spec ID is listed in `strictSpecs`, THE SYSTEM SHALL apply strict R2 coverage to that spec even without `--strict` — every declared FR must be unit-covered, zero-coverage fails, and smoke/deferred manifest entries SHALL NOT substitute for unit coverage.
- **FR-002** (unwanted): IF `strictSpecs` contains a spec ID that does not exist in the spec directory, THEN THE SYSTEM SHALL report it and exit non-zero (no silent skip).
- **FR-003** (state): WHILE `requireAccounting` is true, THE SYSTEM SHALL require every declared FR to be unit-covered, smoke-verified, or deferred, and SHALL report each remaining FR as an R3 unaccounted error with non-zero exit.
- **FR-004** (event): WHEN `smokeManifest` is configured, THE SYSTEM SHALL load the JSON file and exit non-zero for a missing or unparsable file, a key that does not match the derived spec/requirement ID grammar or references a nonexistent FR, an entry without a non-empty method, a deferred entry without a non-empty reason, or a non-deferred entry without non-empty evidence.
- **FR-005** (event): WHEN accounting is active (manifest configured or `requireAccounting` true), THE SYSTEM SHALL append the accounted counts (unit/smoke/deferred/unaccounted) to the gate summary line, classifying an FR that is both unit-covered and manifest-listed as unit.

### Key Entities
- **accounting class** — the verification state of one FR: unit / smoke / deferred / unaccounted.
- **smoke manifest** — the JSON map from spec/FR key to `{method, evidence}` or `{method:"deferred", reason}`, the declared record of non-unit verification.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: verification-accounting
- **Symbols**: verification-accounting.mjs
- **Artifacts**: sdd/smoke-manifest.json
- **Files**: tooling/verification-accounting.mjs, tooling/__tests__/fr-accounting.test.mjs

## Dependencies (참조 — dedup 제외)
> fr 게이트 본체(check-fr-coverage)와 ID 문법 파생은 SPEC-002·SPEC-001 소유 — 이 spec은 회계 계층만 소유. Python판 동작 복제는 SPEC-006이 소유.
- **Modules**: key-pipeline, spec-quality-gates, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `fr-accounting.test.mjs` 전 케이스 green + Node↔Python 회계 출력 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 `requireAccounting`으로 돌 때 미회계 FR 0건(전 FR이 unit 또는 매니페스트 회계).

## Non-Functional Requirements
- **NFR-001**: 회계 코어는 순수 텍스트/JSON 파서로 결정적이며, evidence/reason의 의미 판정(NLP)을 하지 않는다.

## Assumptions / Clarifications Retained
- 매니페스트의 method 어휘는 자유형(deferred만 예약) — 프로젝트가 smoke/e2e/manual 등을 선언하되 게이트는 deferred 여부만 분기한다.
- 셸/Go판 fr 게이트에는 회계 계층이 없다(핵심 3커맨드 계약 밖) — 델타는 SPEC-006·ci-examples 커버 매트릭스에 명시.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(게이트 전종 + fr-accounting/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-05 이웃 SPEC-002(spec-quality-gates): 비중복 — 게이트 본체(R1·R2 판정)는 SPEC-002 소유, 이 spec은 회계 계층(R3·매니페스트)만 소유.
- 2026-07-05 이웃 SPEC-006(runtime-parity): 비중복 — 회계 동작의 Python 복제 충실도는 SPEC-006 소유.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-05 | 초안 — strictSpecs·requireAccounting·smokeManifest 문법화(Node·Python 동시) | 진단 B-3 승인: "조용히 미검증" 제거, 전역 --strict 점진 브리지, 사유 존재만 강제 원칙 |
| 2026-07-05 | 매니페스트의 비-unit 엔트리에 자동 채움 경로 연결 — 검증 태그 수집·재생성·드리프트 검사는 SPEC-010(smoke-scan) 소유, 이 spec의 문법·검증 규칙은 불변 | SPEC-010 신설 동반: 수동 연결 제거 — 수동 선언 경로(deferred 백로그 등)는 그대로 유효 |
| 2026-07-15 | `classify`에 `plannedSpecs` 인자·`planned` 클래스 추가(회계 = unit/smoke/deferred/planned/unaccounted), Node·Python | SPEC-018 FR-005 동반: Planned 스펙 미커버 FR을 회계 코어가 planned로 분류(R3 미검증 아님) — 회계 계층은 이 spec 소유 |
