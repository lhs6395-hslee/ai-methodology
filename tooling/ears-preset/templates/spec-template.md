<!--
  EARS Module Spec Template (도메인 범용) — Spec Kit preset/override용
  설치: .specify/presets/<id>/templates/spec-template.md (조직표준) 또는 .specify/templates/overrides/
  EARS 출처: Rolls-Royce / IEEE RE'09. 예시는 placeholder — 프로젝트 도메인으로 치환.
-->
# Feature Specification: [FEATURE NAME]

**Module**: `[MODULE-ID]`  **Spec**: `SPEC-NNN`  **Created**: [YYYY-MM-DD]  **Status**: Draft
**Input**: [한 줄 의도]

---

## ⚙ 작성 규칙 (에이전트는 반드시 준수)
모든 FR은 **EARS 5패턴 중 하나**. 한 요구=한 동작=검증가능. 모르는 값 → `[NEEDS CLARIFICATION: …]`(창작 금지).

| 패턴 | 틀 |
|---|---|
| Ubiquitous | `THE SYSTEM SHALL <응답>.` |
| Event | `WHEN <트리거>, THE SYSTEM SHALL <응답>.` |
| State | `WHILE <상태>, THE SYSTEM SHALL <응답>.` |
| Unwanted | `IF <비정상>, THEN THE SYSTEM SHALL <응답>.` |
| Optional | `WHERE <옵션 포함 시>, THE SYSTEM SHALL <응답>.` |
| Complex | `WHILE <상태>, WHEN <트리거>, THE SYSTEM SHALL …` |
> 금지: should/가능하면/적절히, 한 문장 2동작(and), 측정불가.

---

## User Scenarios & Testing
### User Story 1 — [제목] (P1)
[사용자가 무엇을 원하는지 한 문단]
- **Independent Test**: [이 스토리만으로 단독 검증법]
- **Acceptance (GWT)**: 1. **Given** […], **When** […], **Then** […].
### Edge Cases
- [엣지] · 불명확 시 `[NEEDS CLARIFICATION: …]`

---

## Functional Requirements (EARS)
> 본문(FR·SC·Story) **정본은 영어**(SSOT.md §6). 현지어본은 생성만. 각 FR은 `**FR-NNN** (패턴): 문장` — `**FR-NNN**` 굵게(추적 게이트가 이 패턴으로 파싱). 예시(범용):
- **FR-001** (ubiquitous): THE SYSTEM SHALL store all timestamps in UTC.
- **FR-002** (event): WHEN a user submits the form, THE SYSTEM SHALL validate required fields before saving.
- **FR-003** (state): WHILE a record is locked, THE SYSTEM SHALL reject concurrent edits.
- **FR-004** (unwanted): IF authentication fails, THEN THE SYSTEM SHALL deny access and log the attempt.
- **FR-005** (optional): WHERE the export feature is enabled, THE SYSTEM SHALL offer a download button.

### Key Entities
- [도메인 객체·핵심 필드] — 구조 SSOT가 있으면 1:1 대응: RDB=테이블/컬럼, NoSQL=컬렉션/문서·인덱스, API=스키마/proto. 순수 라이브러리·CLI면 핵심 타입으로 대체.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 **유일하게 소유**하는 키. 한 키는 **정확히 한 spec**만 소유(`check-ownership.mjs`가 CI 강제). 키 종류는 `sdd.config.json`의 `ownershipCategories`와 같아야 함(웹 기본=아래, 비-웹=`Modules·Symbols·Artifacts` 등).
- **Entities**: [도메인 객체/테이블/컬렉션 — 쉼표구분]
- **Surfaces**: [route·화면·job/event/함수]
- **Capabilities**: [Entity×Action — 예: `project.create`]

---

## Success Criteria (측정형)
- **SC-001**: [정량 목표]. 미확정 시 `≥ [NEEDS CLARIFICATION: 베이스라인 후 목표]%`.

## Non-Functional Requirements
- **NFR-001**: [성능/보안/가용성 등 측정 기준].

## Infrastructure Prerequisites (해당 시에만 — 없으면 절 삭제)
- **IP-001**: [인프라/DB/툴 선행조건]. DB·CSP 중립으로 *요구*만(예: "키-값 저장소 필요") — 특정 제품·클라우드는 강요 안 함. 인프라 의존 없으면 절 삭제.

## Assumptions / Clarifications Retained
- [전제] / [인터뷰로 확정할 빈칸] → `CLARIFICATIONS.md`

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| [YYYY-MM-DD] | 초안 | |
