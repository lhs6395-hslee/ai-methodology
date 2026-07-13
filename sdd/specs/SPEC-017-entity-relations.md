# Feature Specification: Entity Relation Consistency

**Module**: `sdd-tooling`  **Spec**: `SPEC-017`  **Created**: 2026-07-09  **Status**: Active
**Input**: `STRUCTURE.md` §3.1의 "1 spec = 1 aggregate" 원칙은 실사용에서 자주 무너진다(도그푸딩: FinOps의 SPEC-005가 aggregate root 7개로 cohesion 상한을 넘김). 과대 spec을 aggregate별로 쪼갤 때, 쪼개진 Entity들 사이의 관계를 표현할 문법이 없었다 — `## Dependencies`의 `Entities:` 라인은 완전한 자유 텍스트라 대상의 실재·소유 spec·순환 참조를 게이트가 전혀 검사하지 못했다(`check-ownership.mjs`가 파싱은 하되 `_deps`라는 이름으로 명시적으로 버림). `EntityName (relation-type)` 괄호 표기만 구조화된 관계로 인정해, 대상 Entity의 실재·소유 spec 해석은 hard로, aggregate 간 순환 참조는 advisory로 검사한다.

---

## User Scenarios & Testing

### User Story 1 — 관계 대상 Entity의 실재를 기계로 확인 (P1)
`Dependencies.Entities`에 `investigation_finding (has-many)`처럼 적으면, ownership 게이트가 그 Entity를 소유한 spec을 전체 spec 집합에서 찾는다. 못 찾으면(오타·삭제·아직 미작성) exit 1로 차단한다 — 소유 spec을 수동으로 적지 않아도 되고(리네임·재번호에 강함), 대상이 실재해야만 통과한다.
- **Independent Test**: `relation.test.mjs`가 순수 코어(파싱·타입 검증·해석·순환 탐지)를 임시 데이터로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a Dependencies entry `foo (references)` where no spec owns `foo`, **When** the ownership gate runs, **Then** it reports the missing target and exits non-zero.

### User Story 2 — 순환 참조는 advisory로 경고 (P1)
spec A가 B를 참조하고 B가 다시 A를 참조하면(구조화 관계 기준), aggregate 간 참조가 한 방향이어야 한다는 설계 원칙 위반 신호를 advisory로 낸다 — 실사용에서 항상 잘못된 것은 아니라 차단하지 않는다.
- **Independent Test**: `relation.test.mjs`가 2-노드·3-노드·자기참조 순환을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a structured-relation cycle A→B→A, **When** the ownership gate runs, **Then** it prints an advisory naming the cycle and still exits zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 괄호가 없는 `Entities:` 항목은 레거시 자유참조로 그대로 통과한다 — 검사 대상이 아니다(하위호환, 채택은 문법 자체가 opt-in).
- relation-type 토큰은 소문자 kebab 1토큰(`[a-z][a-z0-9-]*`)만 인정한다 — 공백·쉼표·대문자가 든 기존의 우연한 서술 괄호(`"foo (deprecated, 검토 필요)"`, `"foo (TBD)"`)는 매치하지 않아 레거시로 남는다(오검출 방지).
- `relationTypes`가 비어 있으면(기본) relation-type 어휘에 제한이 없다 — 문자열 형식(kebab 토큰)만 relation-lib가 강제한다. 채우면 미등록 type은 hard(`capabilityVerbs`와 동형 패턴).
- 대상 Entity의 소유 spec은 저자가 적지 않는다 — 전체 spec의 `Ownership.Entities`에서 게이트가 자동 해석한다(수동 기입이면 재번호·리네임 시 조용히 stale해진다).
- 같은 Entity를 2개 이상 spec이 소유하는 구조적 중복은 이 게이트가 아니라 기존 dedup 판정(SPEC-002 FR-002)이 이미 이전 단계에서 차단한다 — 관계 해석은 dedup을 통과한 뒤의 소유 인덱스만 쓴다.
- 자기참조(spec이 자신의 관계 그래프에서 자기 자신으로 돌아오는 1-노드 순환)도 순환으로 탐지된다(엄격).
- 순환 탐지는 구조화 관계(type 있음)만으로 그래프를 만든다 — 레거시 자유참조는 그래프에 관여하지 않는다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a `Dependencies.Entities` line item matches `EntityName (relation-type)` where relation-type is a single lowercase-kebab token, THE SYSTEM SHALL treat it as a structured relation; an item without that bracket form SHALL remain an unchecked legacy free-text reference.
- **FR-002** (unwanted): IF a structured relation's target entity name matches no spec's owned `Entities` key, THEN THE SYSTEM SHALL report a missing-target violation naming the referencing spec, the entity, and the relation-type, and exit non-zero.
- **FR-003** (event): WHEN `relationTypes` is non-empty and a structured relation's type is absent from it, THE SYSTEM SHALL exit non-zero for an unregistered relation-type; WHERE `relationTypes` is empty (default), THE SYSTEM SHALL accept any well-formed token.
- **FR-004** (event): WHEN the resolved structured-relation graph (spec → owning spec of each referenced entity) contains a cycle, THE SYSTEM SHALL print an advisory naming the cycle's spec sequence without failing the gate.

### Key Entities
- **structured relation** — a `(spec, entity, relation-type)` triple parsed from a `Dependencies.Entities` bracketed item, resolved to the entity's owning spec.
- **relation graph** — the directed graph of spec → owning-spec edges built from all structured relations, used only for cycle detection.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: entity-relations
- **Symbols**: relation-lib.mjs
- **Artifacts**: —
- **Files**: tooling/relation-lib.mjs, tooling/__tests__/relation.test.mjs

## Dependencies (참조 — dedup 제외)
> ownership 게이트 본체·Dependencies 파싱은 SPEC-002(spec-quality-gates) 소유(이 spec은 관계 판정 코어만), 키 정규화·config 파생은 SPEC-001, Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline, spec-quality-gates, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `relation.test.mjs` 전 케이스 green + ownership 게이트 관계 검사의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 ownership 게이트를 돌 때 관계 위반 0건(도그푸딩 — 이 킷 자체는 구조화 관계를 아직 쓰지 않음, 신규 기능 도입만).

## Non-Functional Requirements
- **NFR-001**: 판정은 문자열 파싱·맵 조회·그래프 순회만으로 결정적이며, 관계의 의미(예: "정말 has-many가 맞나")는 판정하지 않는다(리뷰 경계).

## Assumptions / Clarifications Retained
- relation-type의 의미(has-many/belongs-to 등 방향성)는 문서적 라벨일 뿐 — 게이트는 존재·순환만 기계적으로 본다. 의미가 실제 코드/스키마와 맞는지는 리뷰 몫.
- 카디널리티·양방향 선언 같은 더 풍부한 표현력은 지금 필요 범위 밖(YAGNI) — 필요해지면 `## Relations` 전용 절 신설을 재검토(`docs/design/2026-07-09-entity-relations-design.md` 대안 검토 참고).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-09 | 세션 리뷰(relation-lib·ownership 배선·Node↔Python 패리티 테스트 + 게이트 전종 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-09 이웃 SPEC-002(spec-quality-gates): 비중복 — ownership 게이트 본체·dedup·Dependencies 파싱은 SPEC-002 소유, 이 spec은 구조화 관계(실재·순환) 판정 코어만 소유.
- 2026-07-09 이웃 SPEC-009(derivation-accounting): 비중복 — SPEC-009는 재도출 소스 회계, 이 spec은 spec 간 Entity 참조 그래프(직교 관심사).
- 2026-07-09 이웃 SPEC-012(prefix-class-consistency): 비중복 — SPEC-012는 접두어↔파일클래스 정합, 이 spec은 Entity↔Entity 참조 정합(둘 다 "소유 실파일/키의 정합"이지만 대상 축이 다름).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-09 | 초안 — `EntityName (relation-type)` 구조화 표기, 실재·소유 spec 해석(hard)·순환 탐지(advisory), `relationTypes` config(capabilityVerbs 동형), Node·Python 동시 | 도그푸딩(FinOps SPEC-005 aggregate 7개 초과 백로그 논의 중 사용자 제기): "1 spec = 1 aggregate" 원칙이 실사용에서 무너지면 쪼개진 Entity 간 관계를 적을 문법이 필요 — 기존 `Dependencies.Entities` 자유 텍스트를 구조화 |
