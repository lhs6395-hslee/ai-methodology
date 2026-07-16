# Feature Specification: Cross-Spec Change Driver

**Module**: `sdd-tooling`  **Spec**: `SPEC-020`  **Created**: 2026-07-16  **Status**: Active
**Input**: 한 스펙이 소유한 공유 파일을 **다른 스펙의 기능 때문에** 고치면, 현행 spec-sync는 실제 동인과 무관한 소유 스펙에 억지 Change Log를 강요한다(추적 왜곡·의미 없는 행). 커밋 트레일러 `Change-Driver: <SPEC-ID> <사유>`로 **진짜 변경 동인 스펙**을 선언하면, 소유 스펙의 요구를 **참조 완화**(억지 의미 서술 불요)한다. 단 동인 스펙이 실제로 그 changeset에서 의미 있게 바뀐 경우에만 — 가짜 동인으로 우회 못 하게.

---

## User Scenarios & Testing

### User Story 1 — 공유 표면의 변경 동인을 정직하게 기록 (P1)
스펙 Y가 소유한 공유 유틸을 스펙 X의 기능 구현 때문에 수정했다면, Y에 "무슨 변경인지" 억지로 적는 대신 커밋에 `Change-Driver: X <사유>`를 선언한다. 동인 X가 같은 changeset에서 실제로 의미 있게 바뀌었으면(진짜 동인), spec-sync는 Y의 요구를 참조로 완화하고 Y를 위반으로 보지 않는다. 게이트는 동인을 기계로 확인만 한다 — "X가 정말 이 변경의 이유인가"의 타당성은 리뷰 몫.
- **Independent Test**: `cross-spec.test.mjs`가 순수 코어(`parseDrivers`·`crossSpecRelaxed`)를 임시 데이터로 단독 검증(트레일러 파싱·완화 판정).
- **Acceptance (GWT)**: 1. **Given** a staged change to a file owned by SPEC-002 with no meaningful SPEC-002 edit, and a commit trailer `Change-Driver: SPEC-001 <reason>` where SPEC-001 is meaningfully changed, **When** the spec-sync gate runs, **Then** it relaxes SPEC-002 as driven-by SPEC-001 (reference note) and does not report it as a violation.

### User Story 2 — 가짜 동인은 완화하지 않는다 (P1)
`Change-Driver`가 존재하지 않는 스펙이나, changeset에서 의미 있게 바뀌지 않은 스펙을 지목하면 완화하지 않는다 — 소유 스펙 위반이 그대로 남는다. 트레일러가 spec-first 강제를 무력화하는 우회로가 되지 않게(정직한 동인 선언만 유효).
- **Independent Test**: `cross-spec.test.mjs`가 미실재/비-의미 동인은 완화 집합에서 빠짐을 검증.
- **Acceptance (GWT)**: 1. **Given** a `Change-Driver: SPEC-999 <reason>` naming a nonexistent spec, **When** the gate runs, **Then** the owning spec's requirement is not relaxed.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `Change-Driver:`에 사유가 비면 무효 트레일러(파싱 제외) — `Spec-Impact: none`의 사유 필수와 동형.
- 동인이 소유 스펙 자기 자신이면 완화 근거가 아니다(자기 참조 무의미 — 다른 스펙 동인만 유효).
- 여러 `Change-Driver:` 라인 허용 — 하나라도 실재·의미 동인이면 완화.
- 트레일러는 staged(commit-msg) 모드에서만 읽는다(range 모드는 메시지 부재 — Spec-Impact와 동형 경계).
- 완화는 소유 스펙을 위반에서 빼되 **참조 노트로 표면화**한다(조용한 통과 아님 — 추적은 유지).
- 만성 공유 churn(한 파일이 여러 스펙 동인으로 반복 변경) → "이 표면을 별도 spec으로 분리 검토" advisory는 두-커밋 이상 이력이 필요해 다음 증분(FR-004 deferred).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a commit message carries one or more `Change-Driver: <spec-id> <reason>` trailers, THE SYSTEM SHALL parse each into a driver spec id and reason, discarding any entry whose reason is empty.
- **FR-002** (event): WHEN a changed file's owning spec has no meaningful change of its own but a parsed Change-Driver names a different spec that is meaningfully changed in the same changeset, THE SYSTEM SHALL treat the owning spec's requirement as satisfied by reference and SHALL NOT report it as a spec-first violation.
- **FR-003** (unwanted): IF a Change-Driver names a spec that does not exist or is not meaningfully changed in the changeset, THEN THE SYSTEM SHALL NOT relax the owning spec's requirement on its behalf, keeping the violation.
- **FR-004** (ubiquitous): THE SYSTEM SHALL surface a relaxed owner as a reference note naming its driver rather than a forced Change Log entry, and SHALL NOT fabricate semantic ownership for the driven change — the boundary-reconsideration advisory for chronically shared surfaces is deferred pending cross-commit history.

### Key Entities
- **change driver** — the spec declared (via `Change-Driver` trailer) as the real reason a differently-owned shared file changed, distinct from the file's owning spec.
- **reference relaxation** — the excusal of an owning spec's spec-first requirement because a meaningfully-changed driver spec accounts for the change.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: cross-spec-change
- **Symbols**: cross-spec-lib.mjs
- **Artifacts**: —
- **Files**: tooling/cross-spec-lib.mjs, tooling/__tests__/cross-spec.test.mjs

## Dependencies (참조 — dedup 제외)
> 트레일러 파싱·완화 판정 코어만 이 spec 소유. spec-sync 게이트 본체(changeset·의미변경 판정)는 SPEC-003, ID 문법은 SPEC-001, Python 복제는 SPEC-006.
- **Modules**: spec-sync, key-pipeline, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `cross-spec.test.mjs` 전 케이스 green + `parseDrivers`·`crossSpecRelaxed`의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신을 돌 때 Change-Driver 없는 커밋은 동작 불변(거짓 완화 0).

## Non-Functional Requirements
- **NFR-001**: `cross-spec-lib.mjs`는 git·파일시스템 부작용 없는 순수 함수(트레일러 문자열·집합 → 완화 판정)라 결정적으로 단위 테스트된다; changeset 의미변경 수집은 소비 게이트(check-spec-sync)가 수행.

## Assumptions / Clarifications Retained
- Change-Driver는 `Spec-Impact`와 동형의 정직한 선언이다 — 게이트는 동인의 실재·의미변경만 확인하고, 동인이 정말 그 변경의 이유인지(인과 타당성)는 리뷰 경계.
- 만성 churn 기반 경계 재고 advisory는 두-커밋 이력이 필요해 MVP 밖(FR-004 deferred) — 단일 changeset 완화(FR-002)를 우선 착지.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-16 | 셀프리뷰(cross-spec-lib 순수 코어 TDD·회귀 테스트·게이트 전종) + owner 착수 승인 → Active | FR-001/002/003/004 unit 커버, 경계 advisory(FR-004 후반부)는 deferred 회계 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-16 이웃 SPEC-003(spec-sync): 비중복 — SPEC-003은 changeset↔spec 동반 판정·`Spec-Impact` 트레일러 소유. 이 spec은 `Change-Driver` 파싱·참조 완화 판정 코어만 소유(소비는 SPEC-003).
- 2026-07-16 이웃 SPEC-019(semantic-drift): 비중복 — SPEC-019는 리네임 신호로 요구를 *승격*, 이 spec은 동인 선언으로 요구를 *완화* — 방향이 반대인 직교 판정.
- 2026-07-16 이웃 SPEC-008(spec-lifecycle): 비중복 — SPEC-008은 Status/Draft, 이 spec은 공유 표면 변경 동인 추적(직교).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-16 | 초안 — `Change-Driver: <SPEC-ID> <사유>` 트레일러 파싱 + 참조 완화(동인이 실재·의미변경일 때만) + 가짜 동인 비완화. `cross-spec-lib.mjs`(순수 코어)·`cross-spec.test.mjs`, Node·Python 패리티. 경계 재고 advisory(FR-004)는 deferred | 도그푸딩(소비 프로젝트 B) 통증 3: 공유 파일을 타 스펙 기능 때문에 고칠 때 소유 스펙에 억지 Change Log 강제 → 추적 왜곡. 진짜 동인을 기록해 완화 |
