# Feature Specification: Check Outcome (판정 3분류의 반환 계약)

**Module**: `sdd-tooling`  **Spec**: `SPEC-054`  **Created**: 2026-08-10  **Status**: Active
**Input**: 실측 제보(2026-08-10, gsn-aiops-finops-module) — "clean / could-not-check / violation을 판정 코어의 **반환 계약**으로 못박아달라. 새로 쓴 `judgeMigrationSet()`은 저널을 읽지 못하면 could-not-check를 낸다. 반면 기존 `hookFindings()`는 원본을 못 읽는 경우가 아예 없어서 **'검사 못 함'이 통과로 흘렀다** — 낡은 훅 사본이 green으로 보고됐고 강제 정책이 한 번도 발화하지 않았다. 킷 차원에서 이 3분류를 반환 타입으로 강제하면 개별 게이트가 실수할 여지가 줄어든다." 킷 자기조사 결과 반대 방향의 붕괴도 실재했다: 존재 판정기를 주입받는 판정 코어 6종 중 4종(`agent-wiring`·`diagnosis-guard`·`spec-sync`·`watchdog`)이 `boolean`만 받아, 파일을 **읽지 못한** 경우가 `false`로 붕괴해 "없음"= **위반**으로 보고될 수 있었다. 두 방향 모두 같은 결함이다 — 모르는 것을 아는 것처럼 말하는 순간 그 판정은 거짓이다.

---

## User Scenarios & Testing

### User Story 1 — 판정이 사라지는 자리는 코어와 게이트의 경계다 (P1)
SPEC-040은 **게이트**가 자기 판정 종류를 선언하게 만든다. 그러나 그 선언은 게이트가 코어의 반환값을 **해석한 결과**다. 코어가 "못 봤다"를 표현할 통로가 없으면 게이트는 그 사실을 알 방법이 없고, 빈 findings를 clean으로 읽는다. 그래서 계약은 코어의 반환 타입에 있어야 한다.
- **Independent Test**: `check-outcome.test.mjs`가 종류 집합·우선순위·병합·요약을 저장소 없이 단독 검증. [검증: tooling/__tests__/check-outcome.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a core result with no violations but one unobserved subject, **When** the outcome is normalized, **Then** it is could-not-check and not clean.

### User Story 2 — 모르는 것을 없다고 말하지 않는다 (P1)
존재 판정기가 예외를 던지거나 `undefined`를 돌려주는 자리를 `false`로 삼키면, 읽기 실패가 "부재"라는 **거짓 위반**이 된다. 오탐은 이 계열 게이트의 사망 원인이다.
- **Independent Test**: 같은 테스트가 `boolean`·3상태·`undefined`·던지는 판정기 각 갈래의 정규화를 확인. [검증: tooling/__tests__/check-outcome.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an existence predicate that throws, **When** it is wrapped for tri-state use, **Then** the result is unknown rather than absent.

### User Story 3 — 위반이 '못 봄'을 가리지 않는다 (P1)
하나를 보고 다른 하나를 잊는 것이 이 계열 결함의 본체다. 위반이 있으면 사람은 그것만 고치고 확인하지 못한 대상은 조용히 초록으로 남는다.
- **Independent Test**: 같은 테스트가 위반·미확인이 함께 실린 반환값과 요약 한 줄을 확인. [검증: tooling/__tests__/check-outcome.test.mjs]
- **Acceptance (GWT)**: 1. **Given** both a violation and an unobserved subject, **When** the summary line is produced, **Then** it states both counts and marks the unobserved one as not a pass.

### User Story 4 — 계약은 전수로 적용되어야 계약이다 (P1)
한 코어라도 통로가 없으면 그 코어가 다음 결함의 자리가 된다. 그래서 "존재 판정기를 주입받는 모든 코어가 통로를 갖는가"를 **소스를 훑어** 판정한다(열거는 기계, 판정은 규칙 — SPEC-033의 패턴).
- **Independent Test**: 같은 테스트가 `tooling/*-lib.mjs`에서 존재 판정기 주입 시그니처를 열거하고 각자의 미확인 통로를 확인. [검증: tooling/__tests__/check-outcome.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a judging core that injects an existence predicate without an unobserved channel, **When** the contract test runs, **Then** it fails naming that core.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **종류는 셋뿐이고 더 늘리지 않는다** — 넷째를 만들면 "이건 어디에 넣지"가 생기고 그 순간 예외가 태어난다.
- **의존 0이 계약의 채택 조건이다** — 이 모듈은 어떤 모듈도 import하지 않는다. 무거운 계약은 채택되지 않고, 채택되지 않은 계약은 계약이 아니다.
- **`boolean`을 그대로 받는다** — 새 계약이 기존 호출부를 전부 깨면 그 계약은 채택되지 않는다. 3상태는 확장이고 교체가 아니다.
- **`undefined`·`null`은 UNKNOWN이다** — 판정기가 아무것도 돌려주지 않은 것은 "없다"가 아니다.
- **could-not-check는 차단하지 않는다** — 표면화하되 막지 않는다. 못 본 것으로 빌드를 깨면 사람이 그 층을 떼어낸다("검사 못 함"은 위반이 아니다).
- **could-not-check는 초록도 아니다** — 통과 집계에 합산하지 않는다. 조용한 0건이 이 결함의 본체다.
- **위반과 미확인은 같은 반환값에 함께 실린다** — 우선순위는 표시 종류에만 적용되고, 두 목록 중 하나를 버리지 않는다.
- **기존 필터를 계약 도입이 삭제하지 않는다** — 실측: 반환 형태를 바꾸며 `spec-sync`의 플레이스홀더·글롭·대괄호 필터 3건이 지워졌고, 커밋 전 diff에서 되살렸다. 형태 변경은 의미 변경이 아니다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): The **check-outcome** (E) contract in **check-outcome-lib.mjs** (S) SHALL expose exactly three outcome kinds — observed-and-clean, could-not-check, and violation — and SHALL NOT add a fourth. — capability: **check-outcome.classify** (C).
- **FR-002** (event): WHEN an existence or availability predicate's result is normalized, the contract SHALL map a boolean to the corresponding definite state, SHALL map an absent result to unknown, and SHALL map a throwing predicate to unknown, so that a read failure is never reported as absence.
- **FR-003** (event): WHEN core results are normalized or merged, the contract SHALL carry violations and unobserved subjects in the same return value, SHALL classify the result as violation when any violation exists, as could-not-check when only unobserved subjects exist, and as clean otherwise, and the human-readable summary SHALL state that unobserved subjects are not a pass.
- **FR-004** (unwanted): IF a judging core injects an existence predicate without offering a channel for subjects it could not observe, THEN the contract's completeness test SHALL fail naming that core, because a contract applied to some cores leaves the remaining cores as the site of the next defect.

### Key Entities
- **check-outcome** — the return-shape contract by which a judging core states which of three things happened (observed-and-clean, could-not-check, violation), as distinct from the gate-level verdict type of SPEC-040 which is the gate's interpretation of that return, so that "could not observe" cannot disappear at the boundary between core and gate.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: check-outcome
- **Symbols**: check-outcome-lib.mjs
- **Artifacts**: —
- **Capabilities**: check-outcome.classify
- **Files**: tooling/check-outcome-lib.mjs, tooling/__tests__/check-outcome.test.mjs

## Dependencies (참조 — dedup 제외)
> 게이트 층의 판정 타입은 SPEC-040 소유, Python 복제는 SPEC-006, 층 분리 규범은 SPEC-033 소유.
- **Modules**: gate-verdict (references)
- **Symbols**: verdict-lib.mjs, watchdog-lib.mjs, spec-sync-lib.mjs, agent-wiring-lib.mjs, diagnosis-guard-lib.mjs, evidence-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `check-outcome.test.mjs` 전 케이스 green — 종류 집합 1·정규화 3·우선순위 3·병합 1·코어 전환 4·계약 전수 1. [검증: tooling/__tests__/check-outcome.test.mjs]
- **SC-002**: 존재 판정기를 주입받는 판정 코어가 **전수로** 미확인 통로를 갖는다 — 소스 열거 기준 6/6. [검증: tooling/__tests__/check-outcome.test.mjs]
- **SC-003**: 판정 종류·정규화 결과가 Node↔Python 바이트 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 계약 모듈은 어떤 모듈도 import하지 않으므로 어떤 판정 코어도 의존 부담 없이 채택할 수 있고, 저장소 없이 단독 테스트된다. [검증: tooling/__tests__/check-outcome.test.mjs]

## Assumptions / Clarifications Retained
- 이 계약은 SPEC-040을 **대체하지 않는다.** 040은 게이트가 스윕에 내는 판정 종류이고, 이 축은 코어가 게이트에 내는 반환 형태다. 040만 있으면 게이트는 코어가 못 본 사실을 알 방법이 없다.
- **기각한 대안:** could-not-check를 위반으로 취급해 차단하는 방식. 권한·I/O 사정으로 못 본 것을 위반이라 부르면 오탐이 쌓이고, 오탐이 잦은 게이트는 꺼진다. 표면화까지가 이 종류의 계약이다. 재검토 조건: 없음.
- **기각한 대안:** could-not-check를 통과로 합산하는 방식(제보가 겪은 그 결함). 낡은 훅 사본이 green으로 보고된 것이 정확히 이 형태였다. 재검토 조건: 없음.
- **기각한 대안:** 네 번째 종류(예: "부분 확인")를 두는 방식. 종류가 늘면 경계 판단이 필요해지고, 경계 판단이 필요한 분류는 급할 때 편한 쪽으로 기운다. 재검토 조건: 없음.
- **기각한 대안:** 기존 코어를 3상태 전용으로 바꿔 `boolean` 주입을 금지하는 방식. 호출부를 전부 깨는 계약은 채택되지 않고, 채택되지 않은 계약은 계약이 아니다. 재검토 조건: 없음.
- **기각한 대안:** 계약 준수를 규범 문서로만 적고 검사하지 않는 방식. 규범만 있는 계약은 다음 코어에서 반드시 새어나간다 — 소스를 훑는 전수 테스트가 이 축의 강제다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(코어 TDD 13종 + 계약 전수 테스트 1종) + 제보 요청(3분류를 반환 타입으로 강제) → Active | FR-001~004 unit 커버. 킷 자기조사: 존재 판정기 주입 코어 6종 중 4종이 `boolean`만 받아 읽기 실패가 "부재"로 붕괴할 수 있었고 전부 전환. 형태 변경 중 `spec-sync` 필터 3건이 지워진 것을 커밋 전 diff에서 발견·복원 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-040(gate-verdict): 비중복 — 040은 **게이트**가 스윕에 선언하는 판정 종류, 054는 **코어**가 게이트에 돌려주는 반환 형태다. 040의 선언은 054의 반환을 해석한 결과이므로 층이 다르고, 054 없이 040만 있으면 게이트가 해석할 사실 자체가 소실된다.
- 2026-08-10 이웃 SPEC-036(harness-install): 비중복 — 036은 훅 사본의 신선도를 판정하고, 054는 그 판정이 "원본을 못 읽었다"를 표현할 통로를 갖게 한다. 036의 실측 결함이 054의 입력이지만 판정 대상이 다르다.
- 2026-08-10 이웃 SPEC-050(import-wiring): 비중복 — 050은 모듈 배선의 실재(파일·export)를 판정하고, 054는 임의 코어의 반환 형태를 규정한다. 050이 054의 `unchecked` 통로를 먼저 갖고 있었고, 054가 그 형태를 전수로 일반화했다.
- 2026-08-10 이웃 SPEC-033(layered-judgement): 비중복 — 033은 결정적 층과 확률적 층의 분리 규범이고, 054는 결정적 층 안에서 "판정 못 함"을 표현하는 형태다. 033의 "전수성은 열거기가 보장한다"를 054의 계약 전수 테스트가 적용한다.
- 2026-08-10 이웃 SPEC-006(dual-runtime): 비중복 — 006은 두 런타임의 판정 출력 동일성을 요구하고, 054는 그 판정의 반환 분류를 정한다. 006은 054에 대해 미러 의무를 부과하는 관계다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `check-outcome-lib`(3분류 상수·3상태 정규화·던지는 판정기 감싸기·정규화·병합·요약) + 존재 판정기 주입 코어 5종을 미확인 통로로 전환(`watchdog`·`spec-sync`·`agent-wiring`·`diagnosis-guard`·`evidence`) + 소스 열거 기반 계약 전수 테스트, 양판 | 실측 제보: `hookFindings()`가 원본을 못 읽는 경우를 아예 갖지 않아 **'검사 못 함'이 통과로 흘렀고** 낡은 훅 사본이 green으로 보고돼 강제 정책이 한 번도 발화하지 않았다. 킷 자기조사에서 **반대 방향**의 같은 결함도 실재했다: 존재 판정기 주입 코어 6종 중 4종이 `boolean`만 받아 읽기 실패가 `false`로 붕괴해 "부재"=위반이라는 거짓 판정이 가능했다. 두 방향 모두 모르는 것을 아는 것처럼 말한 것이다. SPEC-040으로 부족한 이유: 040의 선언은 코어 반환값의 **해석**이므로, 코어에 "못 봤다"의 통로가 없으면 게이트는 그 사실을 알 방법이 없다 — **판정이 사라지는 자리는 코어와 게이트의 경계다.** 의존 0으로 만든 이유: 무거운 계약은 채택되지 않고, 채택되지 않은 계약은 계약이 아니다. 규범 문서가 아니라 소스 열거 테스트로 강제한 이유: 한 코어라도 통로가 없으면 그 코어가 다음 결함의 자리가 된다 [검증: tooling/__tests__/check-outcome.test.mjs] |
