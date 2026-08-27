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
- **inert도 침묵하지 않는다(FR-006):** 정책이 off가 아닌데 소스가 비었거나 카테고리가 없어 판정이 성립하지 않으면 그 사유를 출력한다 — `hard`면 그 자체로 차단(hard 선언 + 무판정 = 거짓 안전이고, 특히 `entitySchemaSources: []` 한 줄이 백킹 hard를 무음 사망시키는 우회로였다 — 감사 A-3), `advisory`면 플레인 고지(경고 글리프 없이 — 소급 범람 금지). 스키마가 없는 프로젝트는 기본값 `off`라 애초에 조용하고, 켰다가 정당히 끄는 경우엔 명시적 `off`가 탈출구다(그 하향은 래칫이 기록). 이는 FR-005(개별 면제의 상시 부채화)를 *정책 전체*로 확장한 것이다.
- 인프라 무관: 소스는 `[{globs, patterns}]` 어댑터 — 각 패턴의 캡처그룹 1이 식별자다. Drizzle(`pgTable("x", …)`)·Prisma(`model X`)·SQL DDL(`CREATE TABLE x`)·proto(`message X`) 등 무엇이든 config로 표현(게이트에 스키마 종류 하드코딩 없음).
- 대조는 정규화(트림·소문자) — 스키마 표기와 Ownership 표기의 대소문자 편차에 비의존.
- 정당한 비-스키마 aggregate(외부 API 자원·이벤트 스트림 등 구조 SSOT 파일에 없는 실체)는 `entitySchemaExemptEntities`에 사유와 함께 면제 — 빈 사유는 에러(entityRegistry 동형, 남용 방지·리뷰 관문). **면제는 대량 우회 수단이 아니다:** UI/흐름 개념(`wizard`·`project_list`·`dashboard`·`detail` — FR이 실 테이블을 조작)은 면제가 아니라 **Surface 강등 + capability 재키**(migrate/readopt)로 해소하고, 인프라(`vpc`·`eks`)·proto entity는 면제가 아니라 **그 구조 SSOT(terraform·`.proto`)를 `entitySchemaSources`에 추가**해 스키마 백킹으로 해소한다. 면제는 이 둘 다 아닌 "스키마 밖 실 외부 aggregate"에만. **실측 실패: 소비 프로젝트가 유령 40건을 일괄 면제하고 hard 승격 → 거짓 완료**(FR-005로 표면화).
- 면제는 조용히 사라지지 않는다 — 게이트가 사용 중 면제를 매 실행 advisory로 표면화한다(FR-005). 대량 면제는 "entity를 aggregate가 아니라 개념 단위로 쪼갠" 신호이므로 readopt를 고려한다.
- 위반 해소는 두 방향: (a) 실제 테이블이면 스키마에 존재하게 하거나 면제 등록, (b) UI/흐름 개념이면 Surface로 강등하고 그 capability를 실 entity(`pjt_projects.<verb>`)로 재키(SPEC-024·SPEC-025 migrate).
- 기본 `off` — 스키마 어댑터 config가 필요한 판정이라 켜기 전엔 무영향, update가 `advisory` 승격을 권장(graduation).
- **어댑터는 신뢰 경계이지 검증 대상이 아니었다(FR-008~010, 이슈 #21 C-1).** `entitySchemaSources`는 정규식 문법만 검사받고 "구조 SSOT를 가리키는가"는 검사도 표면화도 없어, 유령 entity가 세 가드(레지스트리·귀속·백킹)를 모두 통과하는 경로가 있었다: ① 스펙 디렉토리 자기참조 글롭(`globs:["sdd/specs/**"]`) — 스펙 자신이 자기 소유 entity의 실재 근거가 되는 완전 순환, FR-008이 구조 오류로 차단. ② import 문(`import { type Wizard } from …`)이 구조 SSOT 선언으로 오인증, FR-009가 줄 단위 필터로 배제. ③ 주석 DDL(`-- TODO: CREATE TABLE wizard`)도 같은 필터로 배제(FR-009). **닫히지 않는 잔여:** 느슨한 어댑터(`type Wizard = {};`처럼 실제로 구조 SSOT 안에 있는 선언)는 문법·위치 어느 쪽으로도 기계가 걸러낼 수 없다 — FR-010의 파일별 매치 표본 표면화가 그 잔여의 유일한 방어선이고, 최종 판단은 `/sdd-update` 등에서 사람이 한다(완전 자동화 불가 영역, 리뷰 경계로 남긴다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `entitySchemaBackingPolicy` is off, THE SYSTEM SHALL perform no schema-backing evaluation and keep the ownership gate's output unchanged. — capability: **entity-schema-backing.judge** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **entity-schema-backing** (E) core in **schema-backing-lib.mjs** (S) SHALL extract the set of real entity identifiers from the files matched by each source's globs using that source's capture patterns, and require every owned entity key — trimmed and lowercased — to be present in that set or in `entitySchemaExemptEntities`, reporting each violation with the spec id and entity.
- **FR-003** (unwanted): IF violations exist, THEN THE SYSTEM SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-004** (unwanted): IF the policy value is outside off|advisory|hard, or an `entitySchemaExemptEntities` entry has an empty rationale, or an `entitySchemaSources` pattern is not a valid regular expression, THEN THE SYSTEM SHALL report it clearly and exit non-zero (without leaking a runtime stack trace).
- **FR-005** (state): WHILE schema-backing evaluation is active and one or more owned entities are exempted via `entitySchemaExemptEntities`, THE SYSTEM SHALL surface those exempted entities as an advisory review-debt line on every run regardless of policy strength — so that a large exemption set cannot silently read as clean under hard — naming each and pointing to restructuring (Surface demotion) or adding the relevant structure SSOT rather than exemption.
- **FR-006** (unwanted): IF the policy is not off but the evaluation cannot be established — `entitySchemaSources` empty, or no entity-like ownership category — THEN THE SYSTEM SHALL yield each such reason so the consuming gate can surface the inert policy instead of passing silently.
- **FR-007** (event): WHEN a capture pattern is compiled in either runtime, THE SYSTEM SHALL always enable multiline matching so a `^`/`$` anchor binds to each line rather than only the start/end of the whole source text, SHALL parse a leading inline-flag group (`(?im)`-style, letters restricted to i/s) from the pattern string itself and fold it into the compiled flags rather than relying on the regex engine to parse it, treating an unrecognized inline flag as an invalid pattern, and SHALL restrict `\w`-class character matching to ASCII in both runtimes so a non-ASCII identifier is judged identically byte-for-byte in Node and Python.
- **FR-008** (unwanted): IF an `entitySchemaSources[i].globs` entry matches a path under `specDir`, THEN the **entity-schema-backing** (E) core in **schema-backing-lib.mjs** (S) SHALL report it as a configuration error naming the source index and glob, and THE SYSTEM SHALL exit non-zero — because a spec that is its own structure SSOT makes the owned entity it declares circularly self-backing.
- **FR-009** (event): WHEN extracting identifiers from a structure-SSOT unit, THE SYSTEM SHALL discard a capture whose containing line begins with an import statement or a comment marker (`import`, `//`, `/*`, a JSDoc continuation `*`, `#`, or `--`), so an imported type name or a commented-out DDL fragment is not counted as a structural declaration.
- **FR-010** (event): WHILE schema-backing evaluation is active, THE SYSTEM SHALL report, for every structure-SSOT file matched by `entitySchemaSources`, the set of entity identifiers extracted from that file — so a reviewer can judge adapter quality (loose patterns admitting non-aggregate concepts) that structural checks alone cannot catch.

### Key Entities
- **schema backing** — the property that an owned entity corresponds to a real identifier in the project's structure SSOT (schema/migration/proto), so a spec's aggregate root is a genuine data entity rather than an invented concept.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: entity-schema-backing
- **Symbols**: schema-backing-lib.mjs
- **Artifacts**: —
- **Capabilities**: entity-schema-backing.judge
- **Files**: tooling/schema-backing-lib.mjs, tooling/__tests__/schema-backing.test.mjs

## Dependencies (참조 — dedup 제외)
> ownership 게이트 본체·config/글롭·Python 복제는 아래 소유(이 spec은 백킹 판정 코어만). capability 귀속(SPEC-024)의 짝 — 귀속은 "소유했는가", 이 spec은 "실재하는가".
- **Modules**: spec-quality-gates (references), key-pipeline (references), capability-ownership (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `schema-backing.test.mjs` 전 케이스 green + 백킹 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/schema-backing.test.mjs]
- **SC-002**: gsn-ai-pm 픽스처(스키마에 `pjt_projects` 존재, 스펙이 `wizard` 소유)에서 위반 지목·hard exit 1(실측 우회 재현 — 양판 바이트 동일). [검증: tooling/__tests__/schema-backing.test.mjs]
- **SC-003**: `^` 라인 앵커·`(?i)`/`(?s)` 인라인 플래그·비-ASCII `\w` 식별자가 Node↔Python에서 바이트 동일하게 판정된다(FR-007). [검증: tooling/__tests__/schema-backing.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-004**: 스펙 디렉토리 자기참조 글롭·import 문·주석 DDL이 각각 구조 오류/추출 배제로 정확히 처리되고, 파일별 매치 표본이 출력된다(FR-008~010, Node↔Python 바이트 동일). [검증: tooling/__tests__/schema-backing.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 백킹 판정 코어는 문자열 집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO·글롭 매치는 소비 게이트(check-ownership)가 수행. [검증: tooling/__tests__/schema-backing.test.mjs]

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
| 2026-08-27 | FR-008~010 신설 — `schemaSourceGlobFindings`(스펙 디렉토리 자기참조 글롭을 구조 오류로 hard 차단) + `extractSchemaEntities`가 import 문·주석 라인(`import`·`//`·`/*`·`*`·`#`·`--`)의 매치를 줄 단위로 배제 + `schemaSourceSamples`(소스 파일별 추출 표본을 매 실행 표면화). check-ownership.mjs 오류 헤더를 `entitySchemaExemptEntities 위반`에서 `Entity 스키마 백킹 설정 오류`로 일반화(이미 정규식 오류도 같은 헤더 아래 있었다). Node·Python 패리티 | 감사 이슈 #21 C-1 실측: `entitySchemaSources`는 신뢰 경계인데 정규식 문법 유효성만 검사하고 "구조 SSOT를 가리키는가"는 검사·표면화 둘 다 없었다 — 유령 entity가 3중 가드(레지스트리·귀속·백킹)를 통과하는 경로 4개 중 스펙 자기참조 글롭(`globs:["sdd/specs/**"]`, 완전 순환)과 import 문(`import { type Wizard } from …`가 finops에서 실측)·주석 DDL 2개를 기계로 닫는다. 느슨한 어댑터(`type Wizard = {}`)는 문법으로 못 닫아 표본 표면화 + 사람 승인(`/sdd-update`)으로 리뷰 경계에 남긴다(FR-010) [검증: tooling/__tests__/schema-backing.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-27 | FR-007 신설 — 캡처 패턴 컴파일을 항상 멀티라인으로(`^`/`$`가 줄마다 앵커) + 선두 인라인 플래그(`(?im)` 류, i/s만 허용)를 직접 파싱해 컴파일 플래그로 승격 + 두 런타임 모두 `\w`류를 ASCII로 제한(Python은 `re.ASCII` 추가로 Node의 원래 좁은 판정에 맞춤). `compileSchemaPattern`/`_compile_schema_pattern` 공용 헬퍼, Node·Python 패리티 | 감사 이슈 #21 M-4/M-5 실측: ① 이전 판은 `"g"` 플래그만 줘서 `^model` 같은 라인 앵커가 텍스트 **전체**의 시작에만 걸려 사실상 매치 불가 — 소스가 뭐든 추출 0건이 되고 소유 entity 전부가 유령으로 hard 차단됐는데, 진단은 원인을 전혀 가리키지 못해 "일괄 면제"로 유도했다. ② Python 전용 인라인 구문 `(?m)`을 Node RegExp가 파싱하지 못해 같은 패턴 문자열이 엔진별로 성공/에러로 갈렸다(SC-001 바이트 동일 위반) — RegExp 엔진에 맡기지 않고 두 언어가 **같은 문자열 처리**를 직접 수행하도록 승격시켜 없앴다. ③ Python str 정규식은 `\w`가 기본 유니코드 인식이라 한글 식별자를 매치하는데 Node `\w`는 ASCII 전용이라 같은 패턴이 반대 판정을 냈다 — 좁은 쪽(Node)에 Python을 맞춰 판정을 통일했다 [검증: tooling/__tests__/schema-backing.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-07-21 | 초안 — `entitySchemaBackingPolicy`(off\|advisory\|hard, 기본 off) + `entitySchemaSources`(인프라 무관 어댑터) + `entitySchemaExemptEntities`(면제) + `schema-backing-lib`(백킹 판정) + ownership 게이트 배선, Node·Python 패리티 | 소비 프로젝트 실측(gsn-ai-pm): capability 귀속을 지어낸 entity(`wizard`·`project_list`) 등록으로 우회 — 소유 entity의 실재를 검증하는 게이트 부재. owner가 "스키마 파일 대조(엄격)" 선택. 픽스처 재현에서 유령 지목·양판 바이트 동일 |
| 2026-07-21 | 하드닝 — `validateSchemaPatterns` 신설 + `extractSchemaEntities` 크래시 방지(잘못된 정규식 skip). 소비자가 `entitySchemaSources.patterns`에 문법 오류 정규식을 쓰면 게이트가 스택 트레이스로 크래시하던 것을 "명확한 config 에러 + exit 1"로. 엔진별 메시지 미포함(Node↔Python 바이트 패리티) | 도그푸딩 사후 점검(owner "문제 확인"): opt-in knob이지만 config 오류가 불투명 크래시를 내던 저위험 결함 — 다른 knob의 "명확한 한 줄 안내" 원칙에 정렬 |
| 2026-07-21 | 면제 남용 방지(FR-005 신설) — 사용 중 면제를 매 실행 advisory 부채로 표면화(hard에서도), UI/흐름은 Surface·인프라/proto는 구조 SSOT 추가·면제는 실 외부 aggregate만이라는 방향 명시. Node·Python 패리티 | 소비 프로젝트 실측(update 11회차): 유령 40건(wizard·project_list·theme·vpc 등)을 일괄 면제하고 hard 승격해 "거짓 완료" — 면제 탈출구가 대량 우회로 악용됨. 면제를 조용한 완료가 아닌 상시 부채로 |
| 2026-07-27 | FR-006 신설(`schemaBackingInertReasons` — 정책 on + 소스 비어있음·카테고리 불일치 사유) + FR-001 개정(off만 무판정) + Edge Case "inert도 침묵하지 않는다", Node·Python 패리티 | 감사 이슈 #21 A-1·A-3 실측: `entitySchemaSources: []` 한 줄 또는 카테고리 개명으로 `entitySchemaBackingPolicy: hard`가 완전 no-op이 되면서 신호가 한 줄도 없었다(래칫이 감시하지 않는 우회로 21개 중 2개). FR-005가 개별 면제를 상시 부채로 표면화하는 것과 동형으로 정책 전체의 inert를 표면화하고, hard 선언 + 무판정은 차단 |
| 2026-07-27 | `schemaBackingActive`·`schemaBackingInertReasons`가 역할(`{entity,…}`)을 받는다 | SPEC-001 FR-010 동반: 이름 추측 제거(개명 시 무음 inert 봉쇄의 구조적 짝) |
| 2026-07-27 | FR 키 앵커 완성 — 소유 키 2건을 FR 선언 라인에 볼드+마커로 앵커 | SPEC-001 FR-010(역할 선언) 도입으로 킷 자신에게 SPEC-023 FR-005/007이 처음 발화 — 익명 주어 THE SYSTEM을 실제 수행 모듈/심볼로 바꿔 앵커 삽입(FR 의미·소유 불변) |
| 2026-07-28 | `schemaBackingFindings`에 선택 파라미터 `slugBySpec` 추가 — 모듈 문법(SPEC-029 ①)의 스펙별 슬러그를 실재 근거로 인정. 미전달 시 종전 동작과 완전 동일 | entity 실재의 정본이 스키마인 레포와 코드 모듈인 레포가 공존한다. 정책·면제·어댑터는 이 spec 소유로 유지하고 소스 종류만 늘렸다 — 판정 knob을 둘로 쪼개지 않기 위해 |
| 2026-08-09 | `schemaBackingInertReasons`를 `inertReasons`(verdict-lib) 위임으로 — 사유 문구만 보유 | 위와 같은 R13 구조 중복. 판정 형태를 공유하고 사유 문구는 이 축이 유지한다 — 출력 바이트 동일 확인 |
