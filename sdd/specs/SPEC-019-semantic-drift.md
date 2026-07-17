# Feature Specification: Semantic Drift Escalation

**Module**: `sdd-tooling`  **Spec**: `SPEC-019`  **Created**: 2026-07-16  **Status**: Active
**Input**: 소유 코드의 **리네임·소유 이동**은 "의미가 바뀌었을 수 있다"는 강한 신호다 — 그런데 현행 spec-sync는 아무 Change Log 한 줄이면 통과한다. 리네임/소유 이동이 감지되면 spec-sync 요구를 **"Change Log 한 줄" → "FR 라인 변경 ∨ `Spec-Impact: <사유>`"** 로 승격해, 옛 의미가 방치되는 semantic drift를 리뷰로 라우팅한다. 게이트는 "다시 봐라"까지만 — "제대로 고쳤나"(FR 본문↔코드 의미 정합)는 NLP라 리뷰 경계.

---

## User Scenarios & Testing

### User Story 1 — 리네임은 본문 재검토를 강제한다 (P1)
소유 파일이 리네임되면(git `R` 상태) 이름/목적이 바뀌었을 개연성이 높다. 이때 소유 스펙에 아무 Change Log 한 줄만 있으면 통과하던 것을, **그 스펙의 FR 선언 라인이 실제로 바뀌었거나** 커밋에 **`Spec-Impact: <사유>` 트레일러**가 있어야 통과하도록 승격한다. 둘 다 없으면 drift 위반으로 보고한다. 게이트는 본문이 새 코드 의미와 맞는지는 판정하지 않는다(리뷰 경계) — "리네임됐으니 FR 본문을 다시 보라"는 트리거만.
- **Independent Test**: `drift.test.mjs`가 순수 코어(`escalations`)를 임시 데이터로 단독 검증(리네임 트리거·FR라인/트레일러 충족·무트리거 불변).
- **Acceptance (GWT)**: 1. **Given** a staged rename of a file owned by SPEC-001 whose Change Log gained a line but no FR line changed and no `Spec-Impact` trailer is present, **When** the spec-sync gate runs with `semanticDriftPolicy` hard, **Then** it reports a drift escalation violation for SPEC-001 and exits non-zero.

### User Story 2 — 평범한 편집엔 새 마찰을 얹지 않는다 (P1)
리네임·소유 이동이 없는 통상 변경은 승격 대상이 아니다 — 기존 spec-sync 요구(Change Log 동반) 그대로다. 승격은 "의미 변경 신호"가 있을 때만 발동해, 매 편집마다 FR 라인 변경을 강요하지 않는다(과잉 강제 방지).
- **Independent Test**: `drift.test.mjs`가 무-리네임 changeset에서 escalation 0을, 리네임 changeset에서만 발동을 검증.
- **Acceptance (GWT)**: 1. **Given** a staged edit (no rename) of a file owned by SPEC-002 with a Change Log line, **When** the gate runs, **Then** no drift escalation is raised for SPEC-002.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `semanticDriftPolicy`가 `off`(기본 `advisory`)면 승격 판정을 하지 않는다(하위호환 — 기존 동작 불변).
- `advisory`면 위반을 경고로 표면화하고 exit는 유지(비차단), `hard`면 exit 1.
- 한 커밋의 `Spec-Impact:` 트레일러는 그 changeset 전체의 리네임 승격을 충족시킨다(정직한 사유 선언은 기존 탈출구와 동형).
- FR "선언 라인 변경"만 승격을 충족한다 — Change Log·리뷰 로그 등 비-FR 라인 변경은 불충족(옛 의미 방치를 못 가리게).
- 소유 이동(파일이 다른 스펙 Files로 이동/Ownership 키 변경) 트리거는 두-리비전 ownership diff가 필요해 다음 증분(FR-002 deferred) — MVP는 리네임 트리거만.
- 리네임 대상이 어느 스펙에도 안 속하면(unowned) 승격 대상 아님(unowned 정책 SPEC-003 소관).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the changeset renames a file owned by a spec (git rename status), THE SYSTEM SHALL require that spec to have either a changed FR declaration line or a `Spec-Impact` trailer in the changeset, and SHALL report a drift-escalation violation for that spec otherwise.
- **FR-002** (event): WHEN a changed file's owning spec set differs from its pre-change ownership (ownership move), THE SYSTEM SHALL apply the same escalation as a rename — deferred to a later increment pending two-revision ownership diffing.
- **FR-003** (ubiquitous): THE SYSTEM SHALL consider the escalation satisfied only by a changed FR declaration line in the owning spec or a `Spec-Impact` trailer, and SHALL NOT judge whether the FR body semantically matches the new code — that match is a review checkpoint, not a gate.
- **FR-004** (state): WHILE no owned file in the changeset is renamed or ownership-moved, THE SYSTEM SHALL leave the existing spec-sync requirement unchanged, adding no escalation on ordinary edits.
- **FR-005** (state): WHILE `semanticDriftPolicy` is `off`, THE SYSTEM SHALL perform no escalation; WHILE `advisory` (default), it SHALL surface violations as warnings without changing exit; WHILE `hard`, it SHALL exit non-zero on a violation; an out-of-enum value SHALL be reported.

### Key Entities
- **drift escalation** — the raised requirement (FR-line change ∨ `Spec-Impact`) triggered on a spec when a rename/ownership-move touches its owned files.
- **escalation trigger** — the machine signal (git rename status; later, ownership move) that promotes spec-sync's requirement beyond a bare Change Log line.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: semantic-drift
- **Symbols**: drift-lib.mjs
- **Artifacts**: —
- **Files**: tooling/drift-lib.mjs, tooling/__tests__/drift.test.mjs

## Dependencies (참조 — dedup 제외)
> 승격 판정 코어만 이 spec 소유. spec-sync 게이트 본체(changeset·트레일러·FR라인 diff 수집)는 SPEC-003, config knob 문법은 SPEC-001, Python 복제는 SPEC-006.
- **Modules**: spec-sync (references), key-pipeline (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `drift.test.mjs` 전 케이스 green + `escalations` 판정의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신을 `semanticDriftPolicy: advisory`로 돌 때 무-리네임 커밋에 escalation 0(거짓양성 없음).

## Non-Functional Requirements
- **NFR-001**: `drift-lib.mjs`는 git·파일시스템 부작용 없는 순수 함수(트리거 집합·충족 집합 → 위반 집합)라 결정적으로 단위 테스트된다; git diff 수집은 소비 게이트(check-spec-sync)가 수행.

## Assumptions / Clarifications Retained
- MVP는 파일 리네임(`git diff --find-renames`)만 트리거로 쓴다 — 심볼 치환 휴리스틱은 오탐 위험이 커 채택하지 않는다(보수적, 설계 열린 결정 반영).
- "FR 본문이 새 코드 의미를 서술하나"는 게이트가 못 본다 — 트리거는 기계가, 의미 정합은 강제된 리뷰 체크포인트(METHODOLOGY 리뷰 경계표 행)로.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-16 | 셀프리뷰(drift-lib 순수 코어 TDD·회귀 테스트·게이트 전종) + owner 착수 승인 → Active | FR-001/003/004/005 unit 커버, FR-002(소유 이동)는 다음 증분 deferred 회계 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-16 이웃 SPEC-003(spec-sync): 비중복 — SPEC-003은 changeset↔spec 동반 판정·트레일러·unowned 정책 소유. 이 spec은 그 요구를 리네임 신호로 *승격*하는 판정 코어만 소유(소비는 SPEC-003).
- 2026-07-16 이웃 SPEC-008(spec-lifecycle): 비중복 — SPEC-008은 Status/Draft 차단, 이 spec은 의미변경 신호 기반 요구 승격(직교).
- 2026-07-16 이웃 SPEC-018(spec-retirement): 비중복 — SPEC-018은 폐기 워크플로, 이 spec은 살아있는 스펙의 본문↔코드 drift 재검토 강제.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-16 | 초안 — 리네임 트리거 → spec-sync 요구 승격(FR 라인 변경 ∨ Spec-Impact) + `semanticDriftPolicy` knob + 리뷰 경계 선언. `drift-lib.mjs`(순수 코어)·`drift.test.mjs`, Node·Python 패리티. FR-002(소유 이동)는 deferred | 도그푸딩(소비 프로젝트 B) 통증 2: 코드 리네임·목적변경인데 FR 본문이 옛 의미 유지해도 무통과 — "의미 방치"를 기계 트리거로 리뷰에 라우팅 |
