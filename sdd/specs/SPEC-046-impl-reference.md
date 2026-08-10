# Feature Specification: Impl Reference (스펙이 지목한 메커니즘은 실행 경로에 있어야 한다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-046`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10, 사례 4) — FR이 배포 범위 티켓 추출의 메커니즘으로 라이브러리 함수를 **이름으로 지목**했는데(`extractDeployTickets()`), 실제 표면(`Jenkinsfile`)은 그 함수를 부르지 않고 쉘로 같은 일을 다시 구현했다. 두 구현의 규칙이 갈라졌고 쉘 쪽에만 결함이 둘 있었다: 다건 커밋의 관행 표기에서 첫 건만 잡아 두 커밋에서 19건이 배포 범위에서 **조용히 누락**됐고(그 티켓들은 자동 실측을 한 번도 못 받았다), 근거로 인용만 한 번호가 작업 대상으로 오인됐다. 게이트는 전부 초록이었다 — FR을 커버하는 테스트가 있었고(R1) 표면 파일은 소유돼 있었다(R2). 그런데 그 테스트가 단언한 것은 **버그 있는 쉘 구현이 거기 있는지**였고, FR이 지목한 함수는 테스트만 통과하는 **고아 구현**이었다.

---

## User Scenarios & Testing

### User Story 1 — 지목된 구현체가 호출되지 않으면 그것은 고아다 (P1)
FR이 백틱으로 함수·모듈을 지목했다면 그것이 이 시스템의 메커니즘이라는 선언이다. 저장소의 비-테스트 소스에서 그 이름이 정의뿐이고 참조되지 않으면, 스펙이 말하는 메커니즘과 실제 실행 경로가 다르다.
- **Independent Test**: `impl-reference.test.mjs`가 순수 코어(추출 정밀도·공백 오탐·테스트 파일 제외·중복 제거·실측 재현·호출 있으면 통과·refs 0·모듈 자기 언급·기준·경계 매칭)를 단독 검증. [검증: tooling/__tests__/impl-reference.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a requirement naming a function in backticks, **When** that name appears only at its definition site across non-test sources, **Then** the gate reports it as an orphan implementation.

### User Story 2 — 이름은 저자가 명시한 것이라 선언이 필요 없다 (P1)
백틱은 추측이 아니라 "이건 리터럴 이름이다"라는 저술 행위다. 그래서 이 축은 용어집 선언 없이도 오탐이 없다 — 함수 호출형(`name(...)`)과 확장자를 가진 모듈명만 인정하면 config 키·enum·플래그는 모두 걸러진다.
- **Independent Test**: 같은 테스트가 `--strict`·`hard`·`sdd.config.json`·`maxFRsPerSpec`이 추출되지 않음을 검증. [검증: tooling/__tests__/impl-reference.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a requirement line containing config keys and flags in backticks, **When** names are extracted, **Then** only function-call forms and module filenames are returned.

### User Story 3 — 커버 파일이 지목 이름을 모르면 그 테스트는 구현의 형태를 단언한다 (P1)
제보의 테스트는 쉘 문자열의 존재를 단언했다. 그런 테스트는 회귀를 막는 게 아니라 **수정을 막는다** — 쉘 구현을 고치자 그 테스트가 깨졌고, 그 테스트의 존재 자체가 "구현이 곧 명세"가 되어버린 상태였다. 지목 이름이 커버 파일에 없다는 사실이 그 상태의 값싼 신호다.
- **Independent Test**: 게이트 배선이 SPEC-042의 코어를 재사용해 커버 파일 미언급을 표면화하는 것을 Node↔Python 패리티로 확인. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a covering test that never mentions the named implementation, **When** the gate runs, **Then** it surfaces the covering file as possibly asserting implementation shape.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **이름 뒤 공백은 호출이 아니다** — 킷 실측에서 `EntityName (relation-type)`이 공백 허용 시 함수로 오인됐다.
- **테스트 파일명은 구현체가 아니다** — 검증 자산의 실재는 SPEC-031·041이 이미 본다(같은 사실을 두 축이 고발하지 않는다).
- **확장자 없는 bare 식별자는 뽑지 않는다** — `surfaceFormat`·`runTestsPolicy` 같은 config 키와 구별할 방법이 없다. 저자가 `()`를 붙이면 잡힌다는 것이 계약이다.
- **소유 경계를 넘어 찾는다** — 라이브러리는 다른 스펙의 파일이 정당하게 소비한다. 킷 실측: 소유 파일 안에서만 찾았을 때 정상 모듈 3건이 거짓 고아로 떴다.
- **모듈은 자기 파일의 언급을 참조로 세지 않는다** — 헤더 주석에 자기 이름을 적는 것은 흔하고, 그걸 참조로 세면 모든 모듈이 자동 통과한다.
- **산문은 실행 경로가 아니다** — `.md`·`.html` 등의 언급은 참조로 세지 않는다(`implReferenceProseRegex`).
- **식별자는 대소문자를 구분하고 경계로 맞춘다** — `extractDeployTickets`가 `extractDeployTicketsV2`에 부분일치하면 "참조된다"가 거짓으로 참이 된다.
- **참조의 *모양*은 판정하지 않는다** — 배포 목록에 이름만 적힌 것도 1회로 센다. import 문법을 판정하려면 언어에 결합되고, 킷은 언어 무관을 지킨다. 그래서 이 축은 참조 **0회·정의뿐**이라는 가장 강한 신호만 잡는다(제보 사례가 정확히 그 모양이었다).
- **규범 선언 라인은 FR·NFR·SC 전부다** — 킷 실측: 지목 구현체는 SC·NFR 라인에 더 많다. 단 이 집합은 SPEC-042의 FR-only 집합과 **분리**해 수집한다(넓히면 다른 축의 판정 범위가 조용히 바뀐다).
- 기본 `advisory`. `hard`는 기존 미참조가 0으로 수렴한 뒤가 종착지다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a normative declaration line contains a backticked span, the **impl-reference** (E) core in **impl-reference-lib.mjs** (S) SHALL extract it as a named implementation only if it is a function-call form whose parenthesis follows the identifier without a space, or a module filename bearing a recognised source extension that is not a test asset. — capability: **impl-reference.trace** (C).
- **FR-002** (unwanted): IF a named implementation appears in the repository's non-test, non-prose sources fewer times than its kind's reference bar — excluding a module's own file — THEN **check-fr-coverage.mjs** (S) SHALL report it as unreferenced, distinguishing total absence from definition-only, and SHALL exit non-zero under hard.
- **FR-003** (event): WHEN a requirement carrying named implementations has covering files, the gate SHALL reuse the term-coverage core to report any named implementation absent from all of them, so that a test asserting implementation shape rather than the requirement's claim is surfaced.

### Key Entities
- **impl-reference** — the fact that a mechanism a specification named by identifier is actually reached by the execution path, as distinct from that mechanism merely existing, so that a surface reimplementing the same rule cannot stay green.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: impl-reference
- **Symbols**: impl-reference-lib.mjs
- **Artifacts**: —
- **Capabilities**: impl-reference.trace
- **Files**: tooling/impl-reference-lib.mjs, tooling/__tests__/impl-reference.test.mjs

## Dependencies (참조 — dedup 제외)
> 커버 파일 미언급 판정은 SPEC-042의 코어를 **소비**한다(복제하면 두 축이 다른 답을 낸다), 소유 해석은 SPEC-003, 검증 자산 실재는 SPEC-031, Python 복제는 SPEC-006 소유.
- **Modules**: term-coverage (references), spec-sync (references), execution-evidence (references)
- **Symbols**: check-fr-coverage.mjs

---

## Success Criteria (측정형)
- **SC-001**: `impl-reference.test.mjs` 전 케이스 green — 추출 정밀도·공백 오탐 회귀·테스트 파일 제외·중복 제거·실측 재현(고아)·호출 있으면 통과·refs 0·모듈 자기 언급·기준 상수·대소문자·경계. [검증: tooling/__tests__/impl-reference.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다 — 고아·전무·통과·커버 미언급·hard 차단 갈래에서 확인. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 지목 구현체 6종 전부가 실행 경로에서 참조되며, 방아쇠 폭 선택이 실측으로 뒷받침된다 — FR 라인의 전체 백틱 스팬 중 함수 호출형·모듈명만 6건 추출되고 오탐 0건. [검증: tooling/__tests__/impl-reference.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 대조만의 순수 함수이고 파일 읽기·소스 집합 선별은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/impl-reference.test.mjs]

## Assumptions / Clarifications Retained
- 두 구현이 **같은 규칙인지**는 판정하지 않는다 — 그건 R13(구현 중복)의 축이고, 그쪽은 언어 선언에 의존한다. 제보 프로젝트에서 R13이 쉘 재구현을 못 잡은 이유가 그것이다: 기본 파일 패턴이 JS/TS라 `Jenkinsfile`이 대상 밖이었고, 그 사실은 `INERT`로 표면화되고 있었다(SPEC-038·040의 "0건은 무엇의 0건인가").
- **기각한 대안:** import·require 문법을 파싱해 "실제 호출인가"를 판정하는 방식. 언어마다 문법이 다르고, 킷은 의존성 0과 언어 무관을 함께 지킨다. 참조 0회·정의뿐이라는 신호만으로 제보 사례가 잡히므로 그 이상을 하지 않는다. 재검토 조건: 참조가 배포 목록 언급뿐인데 통과한 실측이 나오면 **비차단 표면화**로만 좁힌다.
- **기각한 대안:** bare 식별자(`camelCase`)까지 뽑는 방식. config 키·enum과 구별 불가라 오탐이 폭주한다. 재검토 조건: 없음 — 저자가 `()`를 붙이는 것이 계약이다.
- **기각한 대안:** 소유 스펙의 파일 안에서만 찾는 방식. 킷 실측에서 정상 모듈 3건이 거짓 고아로 떴다(라이브러리는 다른 스펙의 파일이 소비한다). 재검토 조건: 없음.
- **기각한 대안:** 면제 등록부. 걸린 항목의 정당한 해소는 (a) 지목된 쪽으로 호출을 통일하거나 (b) FR이 잘못된 메커니즘을 지목했으니 FR을 고치는 것이다. 둘 다 실제 수정이고, 면제는 둘 중 어느 것도 아니다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 10종·제보 사례 합성 재현·킷 자기적용 방아쇠 폭 실측) + 소비 프로젝트 개선 요청(사례 4) → Active | FR-001~003 unit 커버. 킷 자기적용: 지목 구현체 6종 전부 참조됨, 오탐 0 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-042(term-coverage): 비중복 — 042는 **프로젝트가 선언한 용어집**을 커버 파일과 대조하고, 046은 **저자가 백틱으로 명시한 구현체 이름**을 실행 경로와 대조한다. 이름의 출처와 대상 집합이 모두 다르다. 046의 커버 파일 축은 042의 코어를 **재사용**한다(복제하면 두 축이 다른 답을 낸다).
- 2026-08-10 이웃 SPEC-038(duplicate-logic): 비중복 — 038은 두 구현이 같은 규칙인가(구현끼리), 046은 스펙이 지목한 구현이 실행되는가(문서↔실행)다. 제보 사례에서 038은 언어 미선언으로 inert였고 046이 잡는다.
- 2026-08-10 이웃 SPEC-003(spec-sync): 비중복 — 003은 파일이 어느 스펙에 속하는가, 046은 스펙이 이름 댄 것이 실행 경로에 있는가다.
- 2026-08-10 이웃 SPEC-023(key-anchor): 비중복 — 023은 FR의 **bold 토큰**이 소유·참조 키와 맞는가(선언 정합), 046은 **백틱 이름**이 코드에서 참조되는가(실행 정합)다. 서식이 다르고 대조 대상이 다르다.
- 2026-08-10 이웃 SPEC-031(execution-evidence): 비중복 — 031은 증거 경로가 실재하는가, 046은 지목 구현체가 참조되는가다. 046이 테스트 파일명을 추출에서 빼는 이유가 031과의 경계다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 모듈 확장자·산문 정규식을 선언으로 승격(`DEFAULT_IMPL_MODULE_EXTENSIONS`·`DEFAULT_IMPL_PROSE_REGEX` + `implModuleExtensions`) | 오너 규범(하드코딩 지양). 확장자를 코어 정규식에 박으면 목록 밖 언어(`.cs`·`.swift` 등)의 모듈 지목이 통째로 안 잡히고 그 0건이 진짜 0건과 구분되지 않는다 [검증: tooling/__tests__/impl-reference.test.mjs] |
| 2026-08-10 | 초안 — `implReferencePolicy`(off\|advisory\|hard, 기본 advisory) + `implReferenceListCap`·`implReferenceProseRegex` + `impl-reference-lib`(백틱 구현체 추출·참조 계수·기준 판정) + `check-fr-coverage` R1e 배선(실행 경로 축 + SPEC-042 코어 재사용한 커버 파일 축) | 제보 사례 4: FR이 `extractDeployTickets()`를 지목했는데 표면이 쉘로 다시 구현해 규칙이 갈라졌고, 그 쪽에만 있던 결함으로 19건이 배포 범위에서 조용히 누락됐다. 커버 테스트는 버그 있는 쉘 구현의 존재를 단언했고 지목 함수는 고아였다 — 게이트 전부 초록. 이름이 백틱이라 **선언 없이도 오탐이 없다**(SPEC-042가 거부한 자동 추출과 다르다). 방아쇠 폭은 킷 자기적용으로 골랐다: 함수 호출형은 이름 뒤 공백 불허(실측 오탐 1건 제거), 테스트 파일명 제외(SPEC-031의 축), bare 식별자 제외(config 키와 구별 불가), 소유 경계를 넘어 탐색(소유 안에서만 찾으니 정상 모듈 3건이 거짓 고아). 범위: 이 폭 실측은 이 킷 저장소의 규범 선언 라인 대상이며, 백틱 관습이 다른 프로젝트에서는 추출 0건으로 판정 대상이 없다고 밝힌다 [검증: tooling/__tests__/impl-reference.test.mjs] |
