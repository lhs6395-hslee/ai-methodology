# Feature Specification: Engines & Events Categories (전수성 구멍 봉합 — 순수 로직·신호를 담는 백킹 강제형 역할)

**Module**: `sdd-tooling`  **Spec**: `SPEC-030`  **Created**: 2026-07-29  **Status**: Active
**Input**: 감사(이슈 #21) 전수성(collectively-exhaustive) 구멍 — Entities/Surfaces/Capabilities 3분류로는 (a) 순수 엔진/정책/값객체(상태 aggregate도 외부 표면도 능력도 아님)와 (b) 배치 job·도메인 이벤트를 담을 칸이 없어, 저자가 유령 entity 날조·대량 면제(실측 40건)·`job:` Surface 개명(무검증 칸으로 이송)으로 우회했다. 킷 자신은 Modules/Symbols/Artifacts로 이 구멍을 피하면서 소비 프로젝트엔 그 칸을 주지 않는 비대칭이 있었다. 이 spec은 두 **옵트인 역할**을 신설한다 — `engine`(코드-모듈 SSOT 실재 대조, capability 소유 금지)과 `event`(발신 entity 귀속 `entity.event-name` + 이벤트 카탈로그 SSOT 실재). 둘 다 `ownershipCategoryRoles`로 **선언 전용**(이름 정규식 폴백 없음)이라 미선언 프로젝트는 무영향(하위호환). SSOT 위치·추출은 config 어댑터로 주입(인프라 무관).

---

## User Scenarios & Testing

### User Story 1 — 순수 엔진은 코드에 실재해야 하고, 이벤트는 entity에 귀속돼야 한다 (P1)
`engine` 역할 카테고리의 소유 키는 `enginesSources`(코드-모듈 SSOT)에서 추출한 실재 식별자 집합에 있어야 하고, `event` 역할 카테고리의 소유 키는 `entity.event-name` 형식으로 그 스펙이 소유한 entity에 귀속되며 `eventCatalogSources`(이벤트 카탈로그)에 실재해야 한다 — advisory는 경고, hard는 exit 1. 유령 엔진·귀속 없는 이벤트를 차단해 "무검증 칸으로 이송"을 닫는다.
- **Independent Test**: `engine-event.test.mjs`가 순수 코어(역할 활성·실재 대조·이벤트 귀속·inert 사유)와 게이트 배선(off/advisory/hard·면제 사유 필수·양판 바이트 패리티)을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `engineRealityPolicy: hard`, an `enginesSources` adapter, and a spec owning engine `nonexist` (absent from the code SSOT), **When** the gate runs, **Then** it names the spec and engine and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 두 역할은 **선언 전용** — `resolveCategoryRoles`가 engine/event에 이름 정규식 폴백을 두지 않는다(entity/surface/capability만 폴백). `ownershipCategoryRoles`에 명시 선언이 없으면 항상 inert(옵트인, 기존 프로젝트 무영향).
- 활성 조건 셋(정책 on + SSOT 소스 선언 + 역할 카테고리 해석) 중 하나라도 없으면 inert이며, 정책이 off가 **아닌데** inert면 매 실행 사유를 표면화한다(hard면 거짓 안전이라 exit 1 — SPEC-026 inert 표면화 동형).
- `event` 키는 첫 점 기준으로 `entity.event-name`으로 분해된다 — 점이 없으면 발신 entity가 없는 것이라 귀속 위반. entity 부분은 그 스펙이 소유한 entity 집합(entity 역할 카테고리)에 있어야 한다(capability 귀속 SPEC-024 동형).
- `engine`은 capability 소유자가 아니다 — 순수 로직에 `engine.verb` 능력을 얹지 않는다(능력은 entity에 귀속). 이 규율은 문서 규범이며, 능력 자체는 Capabilities 카테고리가 SPEC-024로 판정한다.
- 카탈로그/코드 SSOT에 없지만 정당한 외부 이벤트·외부 엔진은 `engineExemptKeys`·`eventExemptKeys`에 사유와 함께 면제 — 빈 사유는 에러(entityRegistry 동형, 리뷰 관문). 귀속(entity 소유)은 면제 대상이 아니다(카탈로그 실재만 면제).
- 기본 `off` — 두 정책 모두 옵트인. `job:`/`event:` Surface 표기의 Surfaces→Events 이관(Surface 엄격화)은 이 역할을 채택한 프로젝트의 마이그레이션이며 별도 단계다(이 spec은 새 칸을 제공, 강제 이관은 강제하지 않음).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `engineRealityPolicy` and `eventAttributionPolicy` are both off, **check-engine-event.mjs** (S) SHALL perform no evaluation and exit zero. — capability: **engine-event.judge** (C).
- **FR-002** (event): WHEN `engineRealityPolicy` is advisory or hard and the engine role is active, THE **engine-event** (E) judgment in **engine-event-lib.mjs** (S) SHALL require every owned engine key — trimmed and lowercased — to appear in the identifier set extracted from `enginesSources`, or in `engineExemptKeys`, reporting each violation with the spec id and key.
- **FR-003** (event): WHEN `eventAttributionPolicy` is advisory or hard and the event role is active, THE SYSTEM SHALL require every owned event key to name a sending entity (`entity.event-name`) that the same spec owns AND to appear in the identifier set extracted from `eventCatalogSources` (or `eventExemptKeys`), reporting attribution and catalog violations separately.
- **FR-004** (unwanted): IF violations exist, THEN THE SYSTEM SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-005** (unwanted): IF a policy value is outside off|advisory|hard, or an exempt entry (`engineExemptKeys`/`eventExemptKeys`) has an empty rationale, or a source pattern is not a valid regular expression, THEN THE SYSTEM SHALL report it clearly and exit non-zero (without leaking a runtime stack trace).
- **FR-006** (state): WHILE a policy is not off but its evaluation is inert (no source adapter or no role category), THE SYSTEM SHALL surface every reason on each run, exiting non-zero when that policy is hard (a hard declaration that judges nothing is false safety).

### Key Entities
- **engine-event** — the judgment that an owned engine key is backed by a real code module and an owned event key is attributed to a real sending entity and a cataloged signal, so that pure logic and async signals get first-class, backed ownership instead of being smuggled through ghost entities or unvalidated Surfaces.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: engine-event
- **Symbols**: engine-event-lib.mjs, check-engine-event.mjs
- **Artifacts**: —
- **Capabilities**: engine-event.judge
- **Files**: tooling/engine-event-lib.mjs, tooling/check-engine-event.mjs, tooling/__tests__/engine-event.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob(sdd-config.mjs·DEFAULTS)·역할 해석(ownership-keys.mjs)·Python 복제·sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). 이 spec은 engine/event 판정 코어와 게이트만. SSOT 추출은 SPEC-026 코어 재사용.
- **Modules**: key-pipeline (references), spec-quality-gates (references), runtime-parity (references), harness-install (references), entity-schema-backing (references), capability-ownership (references)

---

## Success Criteria (측정형)
- **SC-001**: `engine-event.test.mjs` 전 케이스 green + 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/engine-event.test.mjs]
- **SC-002**: 재현 픽스처(실재 엔진+귀속 이벤트 스펙은 통과, 유령 엔진·귀속 없는 이벤트 스펙은 지목·hard exit 1)에서 양판 바이트 동일. [검증: tooling/__tests__/engine-event.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 집합 대조·키 분해만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO·글롭 매치는 소비 게이트가 수행(SSOT 추출은 SPEC-026 `extractSchemaEntities` 재사용). [검증: tooling/__tests__/engine-event.test.mjs]

## Assumptions / Clarifications Retained
- "이 이름이 실제 코드 모듈/이벤트인가"는 SSOT 파일이 답한다 — 게이트는 추출 집합과의 대조만 하고 도메인 사실을 창작하지 않는다(없으면 면제 또는 재분류는 사람 결정).
- 두 역할은 옵트인이라, 채택 전에는 `job:`/`event:`가 종전대로 Surfaces에 남을 수 있다 — Surface 엄격화(이관)는 채택 프로젝트의 그래듀에이션 단계이지 이 spec의 강제가 아니다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-29 | 셀프리뷰(순수 코어 + 게이트 e2e + Node↔Python 바이트 패리티 재현 픽스처) + owner 확정(감사 후 "A. Engines+Events 신설" 선택) → Active | FR-001~006 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-29 이웃 SPEC-026(entity-schema-backing): 비중복 — SPEC-026은 entity의 스키마 실재, 이 spec은 engine의 코드-모듈 실재·event의 카탈로그 실재+귀속. SSOT 추출 코어(`extractSchemaEntities`)만 재사용, 판정 대상 역할이 다르다.
- 2026-07-29 이웃 SPEC-024(capability-ownership): 비중복 — SPEC-024는 capability의 entity 귀속, 이 spec의 event 귀속은 그 동형을 event 축에 적용(대상 카테고리가 다르다). engine은 귀속이 아니라 실재 판정.
- 2026-07-29 이웃 SPEC-029(ownership-reality): 비중복 — SPEC-029는 surface(파일형 심볼)의 소스 실재, 이 spec은 engine(코드-모듈)·event(카탈로그)의 실재+귀속. 실재 판정 계열이나 대상 역할·SSOT 종류가 다르다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-29 | 초안 — `engine`·`event` 역할(선언 전용) + `enginesSources`·`engineRealityPolicy`·`engineExemptKeys`·`eventCatalogSources`·`eventAttributionPolicy`·`eventExemptKeys` knob + `engine-event-lib`(실재·귀속 판정) + `check-engine-event` 게이트 + sdd-sync R7, Node·Python 바이트 패리티 | 감사(#21) 전수성 구멍: 순수 엔진·배치 job·이벤트가 E/S/C 어디에도 안 맞아 유령 entity 날조·40건 일괄 면제·`job:` Surface 개명으로 우회. owner가 감사 후 "A. Engines+Events 신설" 선택. 옵트인이라 미선언 프로젝트·킷 자신은 inert |
| 2026-08-09 | `roleInertReasons`를 `inertReasons`(verdict-lib) 위임으로 — 사유 문구만 보유 | 같은 규칙의 세 번째 사이트였다(R13 구조 중복). 이 함수가 이미 파라미터화된 형태였으므로 규칙 정본의 후보였으나, INERT 판정 형태의 소유는 그 개념을 세운 SPEC-040이 갖는 것이 귀속상 옳다(SPEC-030 lib을 다른 두 축이 import하는 구조를 피한다) |
