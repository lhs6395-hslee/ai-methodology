# Feature Specification: Duplicate Logic (같은 규칙이 두 곳에 구현됐는가 — dedup의 거울 밖)

**Module**: `sdd-tooling`  **Spec**: `SPEC-038`  **Created**: 2026-08-03  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(operations-dashboard, 2026-08-03) — QA 티켓 20여 건을 **병렬 서브에이전트**로 처리하다 같은 규칙(`이름 뒤 괄호 영문 별칭 제거`)이 세 갈래로 갈렸다: upstream의 `stripNameAlias()`, 병렬 에이전트가 **같은 파일에** 추가한 `stripAlias()`, 그 이전의 인라인 `replace(/\s*\(.*\)$/,"")` 3곳. 같은 파일 안에 이름만 다르고 하는 일이 같은 export 두 개가 공존했는데 `ownership`·`cohesion`·`fr`·`consistency` 전부 green이었다. 통합하던 사람이 또 하나를 만든 것이 두 번째 사고다.

---

## User Scenarios & Testing

### User Story 1 — 선언이 아니라 구현의 중복을 본다 (P1)
`check-ownership`의 dedup은 **선언 단위**다(같은 파일을 두 스펙이 주장하는가, entity 키가 유일한가). 이 게이트는 **구현 단위**를 본다 — 동일 규칙 리터럴이 두 곳 이상에 있으면 같은 규칙이 두 번 구현됐다는 신호다. 같은 파일 안의 반복도 센다(실측 사고의 형태다).
- **Independent Test**: `duplicate-logic.test.mjs`가 순수 코어(리터럴 추출·오탐 억제·면제 무결성·어댑터 파싱)와 게이트 배선(3정책·테스트 제외·실측 역검증)을 단독 검증. [검증: tooling/__tests__/duplicate-logic.test.mjs]
- **Acceptance (GWT)**: 1. **Given** one rule literal present in two functions of one file and once more in another file, **When** the gate runs under advisory, **Then** it names every site and exits zero.

### User Story 2 — 구조 중복은 위임하고 차단하지 않는다 (P1)
"같은 본문·다른 이름"은 파서가 필요하다. 킷은 그것을 **어댑터로 주입**받고(`duplicateLogicCommand`) 그 후보에는 **차단력을 주지 않는다**. 도구 실패는 `skipped(사유)`이고 미선언은 `미판정`이다 — 둘 다 "중복 없음"과 구분해 말한다.
- **Independent Test**: 같은 테스트가 미선언·skipped·후보 있음 세 상태의 출력과, hard에서도 확률적 후보가 차단하지 않는 것을 검증. [검증: tooling/__tests__/duplicate-logic.test.mjs]
- **Acceptance (GWT)**: 1. **Given** the injected command exits non-zero, **When** the gate runs, **Then** it reports a skip with the reason instead of reporting no duplicates.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **유발 조건은 예외가 아니라 정상 경로다** — (a) 병렬 작업자에게 파일 충돌 방지용 격리 지시, (b) 동시에 upstream이 같은 관심사를 건드림, (c) 각자 스펙을 성실히 따르며 각자의 헬퍼 생성. 병렬 실행을 권장하는 방법론이라면 이 조합은 상시 발생한다. 그래서 사람의 주의로 막는 것이 아니라 게이트가 필요하다.
- **AST 해시는 킷이 하지 않는다.** 제보의 제안이지만 그러려면 TS/JS 파서를 번들해야 하고 그 순간 (a) 의존성 0을 잃고 (b) 언어 무관을 잃는다(Python·Go 프로젝트에서 통째로 inert). 도구를 아는 것은 프로젝트이므로 어댑터로 위임한다 — 킷은 계약만 정한다.
- **오탐 억제가 곧 강도다** — 오탐이 잦은 게이트는 꺼지고, 꺼진 게이트는 없는 게이트다. 세 겹으로 좁혔다: (1) 판정 대상 파일 확장자 제한(문서·셸의 슬래시는 정규식이 아니다), (2) **문자열 리터럴을 먼저 지운다**(따옴표 사이 슬래시 오추출 제거), (3) `/*`·`//`로 시작하는 본문 배제. 킷 자기적용에서 20건 → 5건으로 줄었고 남은 5건은 전부 진짜였다.
- **테스트 파일은 기본 제외한다** — 단언이 같은 문자열을 대량 반복하는 것은 중복이 아니다(오탐의 최대 원인). `duplicateLogicIncludeTests`로 켤 수 있다.
- **사소한 정규식은 어휘다** — `\s+`·`,`는 정당하게 반복된다. 길이 하한(`duplicateLiteralMinLength`, 기본 8)으로 가른다: 실측 사고의 `\s*\(.*\)$`는 11자로 잡히고 `\s+`는 3자로 빠진다.
- **관용구와 규칙을 가른다** — 정규식 이스케이프(`[.*+?^${}()|[\]\\]`)처럼 한 줄 관용구는 규칙이 아니다. 그것을 공유 모듈로 묶으면 독립이어야 할 순수 코어들이 결합된다. `duplicateLogicAllow`에 **사유와 함께** 등록하고, 낡은 면제(더 이상 중복 아님)는 매 실행 표면화한다.
- 기본 `advisory`. 제보자 실측에서 두 사고 모두 warn만으로 잡혔고, 비차단이라 도입 첫날 멈추지 않는다. 깨끗해지면 `hard` 승격(래칫이 하향을 막는다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the policy is advisory or hard, the **duplicate-logic** (E) core in **duplicate-logic-lib.mjs** (S) SHALL extract rule literals from files matching the declared file regex — stripping string literals and comment bodies first, and discarding literals below the length floor — and SHALL report every literal appearing at two or more sites, counting repeats inside one file. — capability: **duplicate-logic.judge** (C).
- **FR-002** (unwanted): IF an allow entry carries an empty reason, THEN **check-duplicate-logic.mjs** (S) SHALL exit non-zero before judging; WHERE an allowed literal is no longer duplicated, THE gate SHALL surface that entry as stale on every run.
- **FR-003** (state): WHILE the injected duplicate-detection command is declared, THE SYSTEM SHALL parse one candidate per output line and SHALL NOT block on those candidates at any policy strength; WHERE the command exits non-zero it SHALL report a skip with the reason, and WHERE it is undeclared it SHALL state that structural duplication went unjudged.
- **FR-004** (state): WHILE `duplicateLogicPolicy` is off, THE SYSTEM SHALL perform no evaluation and exit zero; an out-of-enum value SHALL exit non-zero, and test files SHALL be excluded unless explicitly included.

### Key Entities
- **duplicate-logic** — the same rule implemented in more than one place, as distinct from the same declaration claimed by more than one spec, so that "two functions do this" is checkable rather than left to whoever happens to read both files.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: duplicate-logic
- **Symbols**: duplicate-logic-lib.mjs, check-duplicate-logic.mjs
- **Artifacts**: sdd/duplicate-candidates.tsv
- **Capabilities**: duplicate-logic.judge
- **Files**: tooling/duplicate-logic-lib.mjs, tooling/check-duplicate-logic.mjs, tooling/__tests__/duplicate-logic.test.mjs, sdd/duplicate-candidates.tsv

## Dependencies (참조 — dedup 제외)
> 선언 단위 dedup은 SPEC-002 소유 — 이 spec은 그 거울 밖(구현 단위)만 담당한다. config knob·설치 배선·sync 규칙표는 각 소유 스펙(001/004).
- **Modules**: spec-quality-gates (references), entity-synonym (references), key-pipeline (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `duplicate-logic.test.mjs` 전 케이스 green — 추출·오탐 억제 3종·같은 파일 반복 집계·면제 무결성·낡은 면제·어댑터 3상태·정책 3분기. [검증: tooling/__tests__/duplicate-logic.test.mjs]
- **SC-002**: 실측 사례(같은 파일의 `stripNameAlias`/`stripAlias` + 다른 파일 인라인)를 재현한 픽스처에서 3곳이 모두 지목되고, 같은 리터럴을 쓰는 테스트 파일은 잡히지 않는다. [검증: tooling/__tests__/duplicate-logic.test.mjs]
- **SC-003**: 킷 자기적용에서 오탐 억제 전후가 측정된다 — 20건(억제 전) → 5건(억제 후, 전부 진짜) → 3건(Files 라인 통합 + 관용구 면제 후). [검증: tooling/__tests__/duplicate-logic.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 파싱·집합 대조만의 순수 함수이고 파일 읽기·명령 실행은 소비 게이트가 수행하므로, 저장소 없이도 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/duplicate-logic.test.mjs]
- **NFR-002** (portability): 결정적 층은 언어 무관이다 — 리터럴 문법과 대상 확장자를 config로 교체하면 Python·Go에서도 같은 판정이 성립하고, 파서 의존은 어댑터 밖으로 나가지 않는다. [검증: tooling/__tests__/duplicate-logic.test.mjs]

## Assumptions / Clarifications Retained
- **정규식 리터럴을 1차 신호로 고른 이유**: 제보 실측에서 사고 1이 이 층만으로 잡혔고, 정규식은 (a) 파서 없이 식별 가능하고 (b) 우연히 같아지는 일이 드물다. 매직 문자열까지 넓히려면 `duplicateLiteralPatterns`를 확장한다 — 넓힐수록 오탐이 늘므로 프로젝트 판단이다.
- 중복의 **해소 방향**은 판정하지 않는다 — 어느 쪽을 정본으로 삼을지, 통합이 옳은지 분리가 옳은지는 리뷰 몫이다. 기계는 "같은 규칙이 두 곳에 있다"만 센다(존재는 기계, 판단은 리뷰).
- **기각한 대안:** 킷이 TS AST를 직접 해싱하는 방식(제보 A-②). 의존성 0과 언어 무관을 동시에 잃고, 파서 버전이 바뀌면 조용히 inert가 된다. 재검토 조건: 표준 라이브러리만으로 다언어 AST를 얻을 수 있게 되면(현재는 불가) 결정적 층으로 승격한다.
- **기각한 대안:** 함수 이름 유의어 + 시그니처 일치로 판정(제보 A-③). 그건 SPEC-033의 동의어 기계를 symbol에 적용하는 것이고, 확률적이라 별칭 원장·후보 목록 배선이 함께 필요하다. 지금은 어댑터 층이 그 역할을 대신한다. 재검토 조건: `duplicateLogicCommand`를 쓰는 프로젝트가 "이름 축 후보가 필요하다"를 실측으로 제기하면 SPEC-033 기계를 재사용해 신설한다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-03 | 셀프리뷰(순수 코어 TDD·게이트 e2e·실측 사례 역검증·킷 자기적용 오탐 측정) + 소비 프로젝트 개선 요청(구현 중복 판정 공백) → Active | FR-001~004 unit 커버. 킷 자기적용이 도입 즉시 진짜 중복 5건을 실수확했고 그중 3곳 중복(Files 라인 파싱)은 이 라운드에 통합 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-03 이웃 SPEC-002(spec-quality-gates): 비중복 — 002의 dedup은 **선언**(같은 파일·같은 키를 두 스펙이 주장)을 보고 이 spec은 **구현**(같은 규칙을 두 코드가 실현)을 본다. 거울의 안과 밖이다.
- 2026-08-03 이웃 SPEC-033(entity-synonym): 비중복 — 033은 **entity 이름**의 의미적 중복(같은 개념·다른 이름), 이 spec은 **코드 규칙**의 중복(같은 동작·다른 함수)이다. 층 구조(결정적+확률적 비차단)를 빌려 쓰되 대상이 다르다.
- 2026-08-03 이웃 SPEC-019(semantic-drift): 비중복 — 019는 리네임·소유 이동으로 옛 의미가 남는 것, 이 spec은 애초에 둘이 동시에 생긴 것이다. 시간축이 반대다.
- 2026-08-03 이웃 SPEC-013(spec-grammar-hardening): 비중복 — 013은 스펙 **문장**의 문법, 이 spec은 **코드**의 중복이다. 판정 대상이 문서 vs 소스다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 리터럴 추출에서 **줄 끝 주석도 제거** — 설명은 구현이 아니다 | 실측: `continue;  // 미커버는 R1/R2의 몫`이 두 축에 나란히 적혀 있었고 `/ 미커버는 R1/`이 정규식 리터럴로 오추출돼 "같은 규칙이 2곳에" 거짓 위반이 됐다. 전줄 주석은 이미 건너뛰었지만 줄 끝 주석은 남아 있었다. 문자열을 먼저 비운 뒤 **앞이 공백·구분자인 `//`만** 자르므로 `"https://…"`도 `/[//]/` 문자클래스도 건드리지 않는다(SPEC-044의 "주석 속 예시는 인용이지 결정이 아니다"와 같은 계열) [검증: tooling/__tests__/duplicate-logic.test.mjs] |
| 2026-08-03 | 초안 — `duplicateLogicPolicy`(off\|advisory\|hard, 기본 advisory) + knob 7종 + `duplicate-logic-lib`(리터럴 추출·중복 판정·면제 무결성·어댑터 파싱) + `check-duplicate-logic` 게이트 + sdd-sync R13 | 실측 제보: 병렬 서브에이전트가 같은 규칙을 세 갈래로 구현했고(같은 파일에 이름만 다른 export 두 개 포함) 게이트 4종이 전부 green이었다. dedup은 선언 단위만 보므로 구현 중복은 사각이었고, 유발 조건(격리 지시 + 동시 upstream + 각자 성실한 헬퍼)은 병렬 실행을 권장하는 방법론에서 정상 경로다. 오탐 억제 3겹으로 킷 자기적용 20 → 5건(전부 진짜) [검증: tooling/__tests__/duplicate-logic.test.mjs] |
| 2026-08-09 | 확률적 층(`duplicateLogicCommand`) 인스턴스화 — 설치 0 패턴(`cat sdd/duplicate-candidates.tsv`, SPEC-033 ③층 선례) + 킷 자기적용 1차 전수 판정 | 리터럴 층은 정규식만 보므로 **같은 본문·다른 이름**을 원리적으로 못 본다. 켜자마자 함수 146개 중 완전 동형 5계열이 드러났다 — `walkAll`×4·`walk`×4·`specFiles`×3·`readCommand`×2·`*InertReasons`×3. 전부 **정본 통합으로 소멸**시켰고(면제 아님) 근사 2건은 사유와 함께 후보 파일에 남겼다. ⚠ 그리고 이 층을 켜면서 하네스의 마지막 추측이 드러났다: 집계기가 본문의 `⚠`를 세어 **비차단으로 설계된 층의 경고를 위반으로 집계**했다 — 위반 건수도 게이트 선언(`위반 N건`)을 읽도록 교정(SPEC-040) [검증: tooling/__tests__/verdict-contract.test.mjs] |
