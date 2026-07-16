# Feature Specification: Spec/FR Retirement & Re-sync

**Module**: `sdd-tooling`  **Spec**: `SPEC-018`  **Created**: 2026-07-15  **Status**: Active
**Input**: 필요 없어진 SPEC/FR을 지우고 참조(@covers·smoke 매니페스트·번호 gap)를 재sync하는 1급 폐기 워크플로 — 명세가 코드 현실을 미러하도록 "누적이 아니라 정리·삭제". `deferred`(할 건데 아직)와 분리하되 폐지하지 않는다.

---

## User Scenarios & Testing

### User Story 1 — 폐기 계획을 기계로 산출·적용 (P1)
`sdd-retire <SPEC-ID | SPEC-ID/FR-NNN>`는 대상의 폐기 **계획**(삭제 대상 + dangling될 `@covers` + 제거될 smoke 매니페스트 키 + 결과 번호 gap)을 산출한다. dry-run이 기본이고 `--write`가 적용하며, 매니페스트/스펙 편집은 **all-or-nothing**(계획 검증 실패 시 무변경). 테스트 코드는 건드리지 않고 dangling `@covers`를 **보고만** 한다 — 삭제는 사람이 원자적 PR로.
- **Independent Test**: `retire.test.mjs`가 순수 코어(`planRetirement`)를 임시 데이터로 단독 검증(FR/spec 삭제·dangling 산출·매니페스트 키 매칭).
- **Acceptance (GWT)**: 1. **Given** a spec corpus, a test with `@covers SPEC-001/FR-003`, and a manifest entry for it, **When** `sdd-retire SPEC-001/FR-003` runs, **Then** it reports FR-003 removal, the dangling `@covers`, and the manifest key to drop, exiting zero (dry-run).

### User Story 2 — 미구현(Planned) 명세는 노이즈가 아니다 (P1)
`Status: Planned` 스펙의 0-coverage FR은 "미검증"이 아니라 **의도된 미구현**으로 회계된다(매니페스트 엔트리 없이). 유령 명세(0/N)가 커버리지 리포트에 노이즈로 쌓이지 않는다 — `deferred`(개별 FR 백로그)와 달리 `Planned`는 스펙 전체가 "아직 안 지음"임을 선언한다.
- **Independent Test**: `fr-accounting.test.mjs`/`retire.test.mjs`가 Planned 스펙의 0-coverage가 R3 unaccounted가 아님을, Active 스펙의 0-coverage는 여전히 신호임을 검증.
- **Acceptance (GWT)**: 1. **Given** a spec with `Status: Planned` and zero covering tests, **When** the fr gate runs with `requireAccounting`, **Then** its FRs are counted as planned (not R3 unaccounted) and the gate does not fail on them.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 존재하지 않는 대상(오타 SPEC-ID/FR-NNN)은 무변경 + exit 1(조용한 no-op 금지).
- FR-ID 폐기는 그 FR 선언 라인만 제거하고 스펙 파일은 남긴다; SPEC-ID 폐기는 스펙 파일 전체를 대상으로 한다(파일 삭제는 `--write` + 사람 확인 경로).
- 폐기가 남긴 번호 gap은 `retiredIds`(config) 또는 MODULE_MAP Removed 기록에 있으면 numbering 게이트가 "정상(retirement gap)"으로 취급 — 사고성 gap과 구분.
- 매니페스트가 없거나 대상 키가 없으면 매니페스트 부분은 no-op(에러 아님).
- `deferred`로 회계된 FR을 폐기하면 그 deferred 엔트리도 함께 제거(잔재 방지).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN `sdd-retire` is invoked with a spec ID or a spec/requirement ID, THE SYSTEM SHALL compute a retirement plan — the declarations to remove, the dangling `@covers` tags, the smoke-manifest keys to drop, and the resulting numbering gap — and print it, exiting zero in dry-run (default) mode.
- **FR-002** (event): WHEN invoked with `--write`, THE SYSTEM SHALL apply the plan atomically (remove the requirement line or mark the spec removed, drop matching manifest and deferred entries), making no change if the plan fails validation.
- **FR-003** (ubiquitous): THE SYSTEM SHALL report `@covers` tags that reference the retired requirement as dangling for human-driven atomic deletion, and SHALL NOT modify test source files.
- **FR-004** (unwanted): IF the retirement target does not exist in the spec corpus, THEN THE SYSTEM SHALL make no change and exit non-zero.
- **FR-005** (state): WHILE a spec declares `Status: Planned`, THE SYSTEM SHALL account its zero-coverage requirements as intentionally-planned rather than R3-unaccounted, without requiring manifest entries.
- **FR-006** (event): WHEN the numbering integrity check encounters a gap whose ID is recorded as retired (config `retiredIds` or MODULE_MAP Removed), THE SYSTEM SHALL treat it as an expected retirement gap rather than an advisory anomaly.

### Key Entities
- **retirement plan** — the computed `{removals, danglingCovers, manifestKeys, deferredKeys, numberingGap}` for a target, derived from the spec/test/manifest corpus.
- **planned status** — a spec-level `Status: Planned` marking intentional not-yet-built, distinct from per-FR `deferred`.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: spec-retirement
- **Symbols**: sdd-retire.mjs, retire-lib.mjs
- **Artifacts**: —
- **Files**: tooling/sdd-retire.mjs, tooling/retire-lib.mjs, tooling/__tests__/retire.test.mjs

## Dependencies (참조 — dedup 제외)
> 폐기 계획은 아래 소유 개념을 소비한다: FR 문법·config는 SPEC-001, 커버리지·매니페스트·회계는 SPEC-002/007, Status enum(Planned)은 SPEC-008, 번호는 SPEC-014, Python 복제는 SPEC-006.
- **Modules**: key-pipeline, spec-quality-gates, verification-accounting, spec-lifecycle, spec-id-numbering, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `retire.test.mjs` 전 케이스 green + `planRetirement` 코어의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신에 `sdd-retire`를 dry-run으로 돌릴 때 의도한 대상만 계획에 잡히고 무관 스펙은 불변(거짓양성 0).

## Non-Functional Requirements
- **NFR-001**: `retire-lib.mjs`는 git·파일시스템 부작용 없는 순수 함수(계획 산출)라 결정적으로 단위 테스트된다; 파일 편집은 커맨드 래퍼가 `--write`에서만 수행.

## Assumptions / Clarifications Retained
- 테스트 코드 삭제는 자동화하지 않는다(한 테스트가 여러 FR을 커버할 수 있어 사람 판단) — 폐기는 dangling을 드러내고 R1 그물이 잔존을 차단한다.
- `Planned`는 Status enum에 추가하고 `Removed`(폐기 완료)는 기존 값을 재사용한다(중복 상태 신설 안 함).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-15 | 초안(설계 문서 2026-07-15-spec-retirement-and-drift 기반) | Draft — 구현 전 |
| 2026-07-15 | 셀프리뷰(retire-lib·커맨드 dry-run 실증·회귀 테스트) + owner 착수 승인 → Active | FR-001~004(retire 코어+커맨드) unit 커버, FR-005/006(Planned·numbering)은 다음 증분 deferred 회계 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-15 이웃 SPEC-011(traceability-retag): 비중복 — retag는 FR 키 *재번호* 기계 이행, 이 spec은 FR/spec *폐기* + 참조 정리. 재번호(보존) vs 삭제(제거)로 대상 축이 다름.
- 2026-07-15 이웃 SPEC-008(spec-lifecycle): 비중복 — SPEC-008은 Status enum·순서·Draft 차단 소유, 이 spec은 폐기 *워크플로*(커맨드·재sync)와 Planned 회계 소비. Status enum에 Planned 추가는 SPEC-008 소유 파일 변경(Dependencies).
- 2026-07-15 이웃 SPEC-007(verification-accounting): 비중복 — SPEC-007은 unit/smoke/deferred 회계 소유, 이 spec은 Planned를 그 회계에 얹는 소비층.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-15 | 초안 — `sdd-retire` 폐기 워크플로 + Planned 상태 + 번호 gap 재sync | 도그푸딩(FinOps): 폐기 경로 부재로 유령 명세·번호 gap이 리포트 노이즈로 누적, "누적 아닌 정리·삭제" 요청(설계 문서 A/D) |
| 2026-07-15 | 증분 1 — `retire-lib.mjs`(순수 계획 코어)·`sdd-retire.mjs`(dry-run/--write) 구현 + 테스트(FR-001~004). Python 포트·FR-005(Planned)·FR-006(numbering)은 증분 2 | 자기 시연: 이 스펙 자체가 requireAccounting R3에 걸려 "새/유령 스펙 노이즈" 문제를 입증 — FR-005/006 deferred로 정직 회계 |
| 2026-07-15 | 증분 2a — FR-005 구현: `Status: Planned` → 미커버 FR을 planned로 회계(R3 미검증 아님·"not yet implemented" 노이즈 아님). lifecycle STATUS_ENUM·verification-accounting classify·fr-coverage, Node·Python 패리티. FR-005 deferred→unit | FinOps 유령 명세(0/N) 노이즈 직접 해소 — 유령이 아니라 "의도된 미구현"으로 명시 |
| 2026-07-16 | 증분 2b — FR-006 구현: `retiredIds` config knob + `numberingIssues(specIds, retiredIds)` — 폐기 gap을 정상 retirement gap으로 취급(사고성 결번과 구분), Node·Python 패리티 + 테스트 2건. FR-006 deferred→unit → SPEC-018 6/6 완결 | 폐기 워크플로가 남기는 번호 gap이 advisory 노이즈로 재부상하지 않게 봉합 — "정리·삭제"가 잔재를 남기지 않음 |
