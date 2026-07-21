# Feature Specification: Entity Schema-Backing (유령 entity 차단 — 소유 entity의 구조 SSOT 실재 대조)

**Module**: `sdd-tooling`  **Spec**: `SPEC-026`  **Created**: 2026-07-21  **Status**: Active
**Input**: 소비 프로젝트 실측(gsn-ai-pm): capability 귀속(SPEC-024)을 만족시키려 **지어낸 개념 entity**(`wizard`·`project_list`)를 `entityRegistry`에 등록하고 `pjt_projects.create`를 `wizard.create`로 개명해, 두 가드(레지스트리 등록 + 귀속 대조)를 **동시에 우회**했다(SPEC-002 프로젝트의 Change Log에 "개념 entity 선언/등록"으로 기록됨). 근본 원인: 소유 entity가 **실재하는 aggregate root(스키마 백킹된 테이블 등)인지** 검증하는 게이트가 없어, 문자열만 등록하면 통과됐다. 이 spec은 `## Ownership`의 소유 entity를 **구조 SSOT**(DB 스키마·마이그레이션·proto 등)의 실재 식별자 집합과 대조한다. 인프라 무관 — 스키마 위치·추출 패턴은 config 어댑터로 주입한다.

---

## User Scenarios & Testing

### User Story 1 — 지어낸 entity로는 capability를 얹지 못한다 (P1)
ownership 게이트가 각 스펙의 소유 entity를, config `entitySchemaSources`가 가리키는 구조 SSOT 파일들에서 추출한 실재 식별자 집합과 대조한다. 스키마에 없는 소유 entity(유령)는 위반 — advisory는 경고, hard는 exit 1. capability 귀속(SPEC-024)이 "entity를 소유했는가"를, 이 게이트가 "그 entity가 실재하는가"를 강제해 우회로를 닫는다.
- **Independent Test**: `schema-backing.test.mjs`가 순수 코어(활성 판정·식별자 추출·백킹 대조)와 게이트 배선(off/advisory/hard·면제·빈 사유)을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `entitySchemaBackingPolicy: hard`, a schema source declaring table `pjt_projects`, and a spec owning entity `wizard` (absent from the schema), **When** the ownership gate runs, **Then** it names the spec and entity and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 정책 on + 스키마 소스 선언 + Entities류 카테고리 존재, **셋 다** 있을 때만 활성 — 스키마 없는 프로젝트(순수 라이브러리·CLI)·킷 자신(Modules 카테고리)·파이프라인(Datasets)은 무영향(inert, 하위호환).
- 인프라 무관: 소스는 `[{globs, patterns}]` 어댑터 — 각 패턴의 캡처그룹 1이 식별자다. Drizzle(`pgTable("x", …)`)·Prisma(`model X`)·SQL DDL(`CREATE TABLE x`)·proto(`message X`) 등 무엇이든 config로 표현(게이트에 스키마 종류 하드코딩 없음).
- 대조는 정규화(트림·소문자) — 스키마 표기와 Ownership 표기의 대소문자 편차에 비의존.
- 정당한 비-스키마 aggregate(외부 API 자원·이벤트 스트림 등 구조 SSOT 파일에 없는 실체)는 `entitySchemaExemptEntities`에 사유와 함께 면제 — 빈 사유는 에러(entityRegistry 동형, 남용 방지·리뷰 관문).
- 위반 해소는 두 방향: (a) 실제 테이블이면 스키마에 존재하게 하거나 면제 등록, (b) UI/흐름 개념이면 Surface로 강등하고 그 capability를 실 entity(`pjt_projects.<verb>`)로 재키(SPEC-024·SPEC-025 migrate).
- 기본 `off` — 스키마 어댑터 config가 필요한 판정이라 켜기 전엔 무영향, update가 `advisory` 승격을 권장(graduation).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `entitySchemaBackingPolicy` is off, or `entitySchemaSources` is empty, or the ownership categories lack an entity-like category, THE SYSTEM SHALL perform no schema-backing evaluation and keep the ownership gate's output unchanged.
- **FR-002** (event): WHEN the policy is advisory or hard, THE SYSTEM SHALL extract the set of real entity identifiers from the files matched by each source's globs using that source's capture patterns, and require every owned entity key — trimmed and lowercased — to be present in that set or in `entitySchemaExemptEntities`, reporting each violation with the spec id and entity.
- **FR-003** (unwanted): IF violations exist, THEN THE SYSTEM SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-004** (unwanted): IF the policy value is outside off|advisory|hard, or an `entitySchemaExemptEntities` entry has an empty rationale, THEN THE SYSTEM SHALL report it and exit non-zero.

### Key Entities
- **schema backing** — the property that an owned entity corresponds to a real identifier in the project's structure SSOT (schema/migration/proto), so a spec's aggregate root is a genuine data entity rather than an invented concept.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: entity-schema-backing
- **Symbols**: schema-backing-lib.mjs
- **Artifacts**: —
- **Files**: tooling/schema-backing-lib.mjs, tooling/__tests__/schema-backing.test.mjs

## Dependencies (참조 — dedup 제외)
> ownership 게이트 본체·config/글롭·Python 복제는 아래 소유(이 spec은 백킹 판정 코어만). capability 귀속(SPEC-024)의 짝 — 귀속은 "소유했는가", 이 spec은 "실재하는가".
- **Modules**: spec-quality-gates (references), key-pipeline (references), capability-ownership (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `schema-backing.test.mjs` 전 케이스 green + 백킹 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인).
- **SC-002**: gsn-ai-pm 픽스처(스키마에 `pjt_projects` 존재, 스펙이 `wizard` 소유)에서 위반 지목·hard exit 1(실측 우회 재현 — 양판 바이트 동일).

## Non-Functional Requirements
- **NFR-001**: 백킹 판정 코어는 문자열 집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO·글롭 매치는 소비 게이트(check-ownership)가 수행.

## Assumptions / Clarifications Retained
- "이 명사가 실제 테이블인가"는 스키마 파일이 답한다 — 게이트는 스키마 추출 집합과의 대조만 하고 도메인 사실을 창작하지 않는다(스키마에 없으면 면제 등록 또는 재구성은 사람 결정).
- 구조 SSOT가 없는 프로젝트(순수 라이브러리)는 이 게이트가 inert — entity 개념 자체가 없거나 코드 심볼이 곧 aggregate라 스키마 대조가 무의미.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-21 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·gsn-ai-pm 유령 entity 픽스처 실측 재현) + owner 확정("스키마 파일 대조로 유령 entity 차단") → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-21 이웃 SPEC-024(capability-ownership): 비중복 — SPEC-024는 "capability의 entity를 이 스펙이 소유했는가"(귀속), 이 spec은 "그 소유 entity가 구조 SSOT에 실재하는가"(백킹). 귀속 우회로(가짜 entity 등록)를 이 spec이 닫는 짝.
- 2026-07-21 이웃 SPEC-002(spec-quality-gates): 비중복 — ownership 게이트 본체·dedup·entityRegistry는 SPEC-002/001 소유, 이 spec은 스키마 백킹 판정 코어만(소비는 SPEC-002 게이트).
- 2026-07-21 이웃 SPEC-022(runtime-schema-drift): 비중복 — SPEC-022는 코드 기대 스키마↔배포 DB 실측 drift(런타임 경계), 이 spec은 스펙 소유 entity↔코드 스키마 실재(저술 경계) — 대조 축이 다르다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-21 | 초안 — `entitySchemaBackingPolicy`(off\|advisory\|hard, 기본 off) + `entitySchemaSources`(인프라 무관 어댑터) + `entitySchemaExemptEntities`(면제) + `schema-backing-lib`(백킹 판정) + ownership 게이트 배선, Node·Python 패리티 | 소비 프로젝트 실측(gsn-ai-pm): capability 귀속을 지어낸 entity(`wizard`·`project_list`) 등록으로 우회 — 소유 entity의 실재를 검증하는 게이트 부재. owner가 "스키마 파일 대조(엄격)" 선택. 픽스처 재현에서 유령 지목·양판 바이트 동일 |
