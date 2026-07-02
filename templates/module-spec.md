<!--
  EARS Module Spec Template (도메인 범용) — Spec Kit preset/override용
  설치: .specify/presets/<id>/templates/spec-template.md (조직표준) 또는 .specify/templates/overrides/
  EARS 출처: Rolls-Royce / IEEE RE'09. 예시는 placeholder — 프로젝트 도메인으로 치환.
-->
# Feature Specification: [FEATURE NAME]

**Module**: `[MODULE-ID]`  **Spec**: `SPEC-NNN`  **Created**: [YYYY-MM-DD]  **Status**: Draft | Active | Deprecated | Removed (택1)
**Input**: [한 줄 의도]

---

## ⚙ 작성 규칙 (에이전트는 반드시 준수)
모든 FR은 **EARS 5패턴 중 하나**. 한 요구=한 동작=검증가능. 모르는 값 → `[NEEDS CLARIFICATION: …]`(창작 금지).
⚠ **EARS는 FR 절에만 적용된다.** spec의 다른 절은 각자 형식을 쓴다 — User Story=서술, Acceptance=Given-When-Then, SC=측정형 숫자, NFR=측정 기준, Ownership=소유 키. **코드와 `@covers`로 묶이는 추적 단위는 FR뿐**(SC·NFR은 검증·측정의 기준이지 코드에 1:1로 매달리지 않는다).

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
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
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
- [도메인 객체·핵심 필드] — 구조 SSOT가 있으면 1:1 대응되게 명명: RDB=테이블/컬럼(migration), NoSQL=컬렉션/문서·핵심 인덱스, API=스키마/proto. 순수 라이브러리·CLI면 핵심 타입/자료구조로 대체.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 **유일하게 소유(권위)**하는 키. 한 키는 전 spec에서 **정확히 한 spec**만 소유한다(`check-ownership.mjs`가 CI에서 강제 — DEDUP.md, STRUCTURE.md 중복 규칙). 새 요구가 오면 그 키의 owner를 조회해 **이미 있으면 그 spec 개정, 없으면 여기 등록**. 이 spec이 변경하는 **aggregate root**(독립적으로 생성·삭제되는 핵심 Entity)가 소유의 경계 닻이다. 다른 aggregate의 키는 아래 Dependencies로.
> ⚠ **키 종류는 `sdd.config.json`의 `ownershipCategories`와 일치해야 한다.** 아래는 웹/CRUD 기본. 비-웹은 바꿔 쓴다(라이브러리/CLI=`Modules·Symbols·Artifacts`, 데이터=`Datasets·Jobs·Sinks`, IaC=`Resources·…`). 헤더(`- **<Category>**:`)는 config의 카테고리명과 정확히 같아야 게이트가 파싱한다.
- **Entities**: [이 spec이 권위 보유하는 도메인 객체/테이블 — 쉼표구분. 스키마 식별자 그대로(trim+소문자, 단복수 임의변환 금지)]
- **Surfaces**: [이 spec이 관할하는 route·화면·job/event — 예: `POST /api/{id}`, `event:<name>`. METHOD 대문자·path 소문자·param `{name}` 표준형·trailing slash 없음]
- **Capabilities**: [entity.verb 형태 — 예: `project.create`, `staff.assign`. verb ∈ CRUD 기본(create/read/update/delete/list) + config `capabilityVerbs` 등록 verb만 허용]
- **Files**: [이 spec이 소유하는 코드 파일 glob — 예: `src/lib/<feature>/**, src/app/api/<feature>/**`. **`**`·`*`만 지원**(중괄호·`?`·`[` 금지), 콤마 구분, 인라인 주석 금지. route뿐 아니라 그 기능의 라이브러리까지 빠짐없이(§Files 완전성). check-spec-sync가 이 glob으로 코드→스펙 동반을 강제]

## Dependencies (참조 — dedup 제외)
> 이 spec이 **읽기/호출만** 하는 다른 aggregate의 키(소유 아님). Ownership과 같은 정규화 표기를 권장하되, 게이트의 형식검증·dedup 대상은 아니다.
- **Entities**: [다른 spec 소유 Entity 중 참조하는 것]
- **Surfaces**: [호출하는 외부 route·이벤트]

<!-- 키 생성 결정 절차(사람=LLM 동일 결과):
  Capability: ①핵심 Entity 식별(스키마 식별자 그대로, 소문자) ②핵심 동작 1개 추출 ③허용 verb 집합에 매핑 ④entity.verb 조립(점 1개) ⑤미등록 verb면 STOP → config capabilityVerbs 등록(리뷰) 후 진행. 임의 동의어 우회 금지.
  Surface:    ①메서드 대문자 ②path 소문자 ③param 표준형(:id·<id>→{id}) ④trailing slash 제거
  Entity:     스키마 테이블/타입명 그대로 trim+소문자(단복수·표기 임의변경 금지)
  경계: 1 spec = 1 aggregate root(독립 생성·삭제되는 핵심 Entity). 다른 aggregate는 위 Dependencies로. -->

---

## Success Criteria (측정형)
- **SC-001**: [정량 목표]. 미확정 시 `≥ [NEEDS CLARIFICATION: 베이스라인 후 목표]%`.

## Non-Functional Requirements
- **NFR-001**: [성능/보안/가용성 등 측정 기준].

## Infrastructure Prerequisites (해당 시에만 — 없으면 절 삭제)
- **IP-001**: [이 spec 실현에 필요한 인프라 선행조건 — *역량*으로]. **제품이 아니라 요구를 적는다**: "내구성 있는 이벤트 로그 필요"(O) vs "Kafka 필요"(X), "저지연 키-값 캐시 필요"(O) vs "Redis 필요"(X), "객체 스토리지 필요"(O) vs "S3 필요"(X). 특정 DB·캐시·브로커·클라우드 제품은 그 프로젝트 결정이라 spec이 강요하지 않는다. 배포 실제 drift 검증은 `SSOT.md` §5b. 인프라 의존이 없는 순수 코드 spec이면 이 절을 통째로 생략.

## Assumptions / Clarifications Retained
- [전제] / [인터뷰로 확정할 빈칸] → `CLARIFICATIONS.md`

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| [YYYY-MM-DD] | 초안 | |

> **폐기 시:** `Status=Removed` + **코드·테스트를 같은 PR로 동시 삭제**(dangling `@covers`는 FR 게이트가 막음) + 이 표에 제거 기록 → spec 파일 삭제(git이 히스토리 보존). 상세: `STRUCTURE.md` 폐기 수명주기.
