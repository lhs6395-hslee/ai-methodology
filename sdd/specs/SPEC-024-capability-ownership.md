# Feature Specification: Capability Ownership (스펙 경계 = entity 기준의 기계화)

**Module**: `sdd-tooling`  **Spec**: `SPEC-024`  **Created**: 2026-07-20  **Status**: Active
**Input**: 소비 프로젝트 실측(budget-engine): Entities 0개인 스펙이 `pjt_projects.compute`·`budget.aggregate` 등 capability 4개를 소유한 채 태어남 — 도메인(aggregate)이 아니라 기술 계층(엔진/헬퍼) 기준 분할. owner 확정 모델: **"entity 키가 같으면 같은 스펙, verb가 달라도 같은 entity면 같은 스펙에 FR 신설, 참조·종속 entity는 relation(Dependencies)으로"** — 즉 capability `x.verb`는 entity `x`를 **소유한** 스펙만 선언할 수 있다. 기존엔 이 경계 규칙에 기계 신호가 없었고(cohesion은 "entity 과다"만 검사 — 0개+capability 소유는 무검사), METHODOLOGY의 "Dependencies의 entity여도 무방" 문장이 탈출구로 읽혔다(개정 동반).

---

## User Scenarios & Testing

### User Story 1 — entity 없는 capability 스펙은 태어나지 못한다 (P1)
ownership 게이트가 각 스펙의 소유 capability에 대해 entity 조각(첫 점 앞, 정규화)이 그 스펙의 소유 entity 집합에 있는지 대조한다. entity 0개+capability 소유(기술 계층 스펙)와 남의 entity 위 capability가 모두 위반 — advisory는 경고, hard는 exit 1. 라우팅 결정트리("키 산출 → 소유 스펙 개정, 새 spec 금지")의 사후 강제판.
- **Independent Test**: `capability-ownership.test.mjs`가 순수 코어(활성 판정·귀속 대조)와 게이트 배선(off/advisory/hard)을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `capabilityOwnershipPolicy: hard` and a spec owning `budget.aggregate` with no owned `budget` entity, **When** the ownership gate runs, **Then** it names the spec, capability, and entity segment, and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- entity류·capability류 카테고리가 **둘 다** 있을 때만 활성 — 비-웹 카테고리(킷 자신의 Modules/Symbols/Artifacts, 파이프라인의 Datasets/Jobs/Sinks)는 capability 개념이 없어 무영향.
- 점 없는 capability는 형식 위반이라 `validateKey`가 담당 — 이 판정은 스킵(이중 보고 금지).
- 대조는 정규화(트림·소문자) — Ownership 선언의 표기 편차에 비의존.
- 참조 entity(Dependencies) 위의 capability도 위반이다 — 참조는 읽기/호출 선언이지 능력 소유 근거가 아니며, 그 능력은 entity 소유 스펙의 FR이다(owner 확정: verb가 달라도 같은 스펙).
- 위반 해소는 두 방향: (a) capability를 entity 소유 스펙으로 이관(+FR 이동), (b) 이 스펙이 실제 그 aggregate면 Entities에 소유 선언(그러면 dedup이 타 스펙과의 충돌을 검증).
- 기본 `advisory` — 핵심 경계 규칙이라 off가 아닌 advisory로 태어나되 빌드는 안 깬다(기존 위반 스펙의 마이그레이션은 update 백로그 경로).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `capabilityOwnershipPolicy` is off, or the ownership categories lack an entity-like or a capability-like category, THE SYSTEM SHALL perform no capability-ownership evaluation and keep the ownership gate's output unchanged.
- **FR-002** (event): WHEN the policy is advisory or hard, THE SYSTEM SHALL require, for each owned capability key, that its entity segment — the token before the first dot, compared after trimming and lowercasing — be among the spec's own owned entity keys, reporting each violation with the spec id, capability, and entity segment.
- **FR-003** (unwanted): IF violations exist, THEN THE SYSTEM SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-004** (unwanted): IF the policy value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it and exit non-zero.

### Key Entities
- **capability ownership** — the rule that a capability key belongs to the spec owning its entity segment: spec boundaries are entity-based, so verbs never spawn specs and engines never own foreign capabilities.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: capability-ownership
- **Symbols**: capability-ownership-lib.mjs
- **Artifacts**: —
- **Files**: tooling/capability-ownership-lib.mjs, tooling/__tests__/capability-ownership.test.mjs

## Dependencies (참조 — dedup 제외)
> ownership 게이트 본체·키 정규화·verb 형식은 SPEC-002/001 소유(이 spec은 귀속 판정 코어만), 참조 entity의 관계 문법은 SPEC-017, Python 복제는 SPEC-006.
- **Modules**: spec-quality-gates (references), key-pipeline (references), entity-relations (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `capability-ownership.test.mjs` 전 케이스 green + 귀속 판정 출력·exit의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: budget-engine 픽스처(Entities 0 + capability 4)에서 위반 4건 전부 지목·hard exit 1(실측 재현 — 도입 검증에서 양판 바이트 동일 확인).

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 정규화·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO는 소비 게이트(check-ownership)가 수행.

## Assumptions / Clarifications Retained
- "이 스펙이 정말 그 aggregate인가"(소유 선언으로 해소할지 이관할지)는 리뷰 몫 — 게이트는 귀속 신호만 강제한다.
- 교차-aggregate 기능(여러 테이블을 읽는 검색·리포트)은 주 변경/산출 대상 aggregate의 스펙에 귀속한다 — 라우팅 트리의 "어느 aggregate를 변경하는가" 기준과 동일(별도 예외 없음).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-20 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·budget-engine 픽스처 실측 재현) + owner 모델 확정("entity 키 동일=같은 스펙, verb는 FR 신설, 참조는 relation") → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-20 이웃 SPEC-002(spec-quality-gates): 비중복 — ownership 게이트 본체·dedup·verb 형식은 SPEC-002/001 소유, 이 spec은 capability↔entity 귀속 판정 코어만 소유(소비는 SPEC-002 게이트).
- 2026-07-20 이웃 SPEC-017(entity-relations): 비중복 — SPEC-017은 Dependencies "참조"의 실재·순환, 이 spec은 Ownership "소유"의 귀속 — 방향이 반대(참조 검증 vs 소유 검증).
- 2026-07-20 이웃 SPEC-023(fr-key-anchors): 비중복 — SPEC-023은 FR 본문 표기(bold↔키), 이 spec은 Ownership 블록 내 카테고리 간 정합(capability↔entity).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-20 | 초안 — `capabilityOwnershipPolicy`(off\|advisory\|hard, 기본 advisory) + `capability-ownership-lib`(귀속 판정) + ownership 게이트 배선, Node·Python 패리티. METHODOLOGY "Dependencies의 entity여도 무방" 탈출구 문장 개정 동반 | 소비 프로젝트 실측(budget-engine — Entities 0개+capability 4개, owner 판정: "이 스펙은 생성되면 안 되는 것"): 스펙 경계=entity 기준에 기계 신호가 없어 기술 계층 스펙이 태어남. 픽스처 재현에서 위반 4건 전부 지목·양판 바이트 동일 확인 |
