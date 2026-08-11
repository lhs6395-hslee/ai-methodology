# Feature Specification: Gate Failure Ledger & Escalation (반복이 기억되는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-057`  **Created**: 2026-08-11  **Status**: Active
**Input**: 실측 제보(2026-08-11, gsn-ai-pm-management-tool) — 에이전트가 하루에 같은 실수를 세 번 했다(FR을 섹션 밖에 썼다 — SPEC-056). 게이트는 세 번 다 잡았고 매번 사유를 정확히 말했다 — **그런데 "이게 오늘 세 번째"라는 정보가 어디에도 없었다.** 지금 없는 것은 감시자가 아니라 **기억**이다. 제보 요청(원문 요지): 게이트가 차단할 때마다 한 줄을 원장에 남기고(게이트·클래스·대상·시각·세션id), commit-msg 훅이 그 원장을 읽어 같은 (게이트,클래스)가 임계치(기본 3)를 넘겼는데 전용 가드가 없으면 "가드를 만들어라"를 명시적으로 말한다. "append는 게이트 공통 종료 경로에 둬야 새 게이트가 자동으로 참여한다 — 게이트마다 따로 적게 하면 빠뜨리는 게이트가 생기고 그게 정확히 지금 상태다." "목적은 벌이 아니라 가시성이다: 세 번째에 '이건 세 번째다, 가드를 만들어라'가 뜨면 오늘의 실패는 애초에 없었다."

---

## User Scenarios & Testing

### User Story 1 — 원장은 게이트마다 손으로 적지 않는다 (P1)
게이트마다 원장 append 코드를 심으면 반드시 빠뜨리는 게이트가 생긴다(손목록·손 파싱이 이 킷에서 반복적으로 죽어온 형태). append는 모든 판정 게이트가 이미 거치는 **단일 종료 훅**(`verdict-lib.mjs`의 `armVerdict`)에서 하므로, 새 게이트를 추가해도 코드 변경 없이 자동으로 참여한다.
- **Independent Test**: `gate-failure.test.mjs`가 순수 코어(`parseLedger`·`makeFailureRecord`·`classCounts`)를 단독 검증하고, 기존 게이트 어디에도 원장 관련 코드를 추가하지 않았음을 `armVerdict` 자체의 단일 변경으로 확인. [검증: tooling/__tests__/gate-failure.test.mjs]
- **Acceptance (GWT)**: 1. **Given** any existing judging gate that has never been touched for this feature, **When** it blocks (non-zero exit) via `armVerdict`, **Then** a ledger record for that gate appears automatically.

### User Story 2 — 클래스는 선언이지 추측이 아니다 (P1)
실패 문장을 정규식·키워드로 분류하면 그 분류는 추측이다. 클래스는 게이트가 `verdict(kind, detail, { class, target })`로 **스스로 선언**할 때만 생기고, 선언하지 않은 게이트의 실패는 원장에 남되(가시성) 에스컬레이션 집계에는 들어가지 않는다(강제는 선언한 축에서만).
- **Independent Test**: 같은 테스트가 `class`를 선언한 레코드만 `classCounts`에 잡히고, 선언 없는 레코드는 원장에는 있되 집계에서 빠짐을 확인. [검증: tooling/__tests__/gate-failure.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a ledger with both class-declaring and non-declaring failure records for the same gate, **When** `classCounts` runs, **Then** only the class-declaring records are grouped and counted.

### User Story 3 — 임계치를 넘긴 미가드 클래스는 명시적으로 말한다 (P1)
같은 (게이트,클래스)가 임계치 이상 반복됐는데 전용 가드가 없으면, commit-msg 훅이 "이건 N번째다, 가드를 만들어라"를 명시적으로 말한다. 목적은 벌이 아니라 가시성이므로, 이미 가드가 있는 클래스는 다시 말하지 않는다.
- **Independent Test**: 같은 테스트가 임계치 미만은 조용하고, 임계치 이상인데 가드 없음은 findings에 잡히고, 유효한 가드가 있으면 같은 카운트에서도 findings에서 빠짐을 확인. [검증: tooling/__tests__/gate-failure.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a (gate, class) pair with a count at or above the configured threshold and no matching guard declaration, **When** `check-gate-escalation.mjs` runs at hard strength, **Then** it exits non-zero naming the gate, class, repeat count, and affected targets.

### User Story 4 — 가드 선언 자체의 결함은 조용히 넘기지 않는다 (P1)
가드 선언(`{gate, class, guard, note}`)이 불완전하거나, 사유가 없거나, 가리키는 파일이 실재하지 않으면 그 가드는 아무것도 가리지 못한다. 침묵하면 사람은 "가드가 있어서 침묵한다"로 오해한다.
- **Independent Test**: 같은 테스트가 3종 결함(incomplete·no-reason·stale)을 각각 독립 finding으로 보고하고, 이 축의 자기결함은 `gateFailureEscalationPolicy` 값과 무관하게 항상 에러로 처리됨을 확인. [검증: tooling/__tests__/gate-failure.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a `gateFailureGuards` entry missing any of the four required fields, or with an empty `note`, or whose `guard` path does not exist, **When** the gate runs, **Then** it exits non-zero identifying which declaration is defective and why.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **원장은 로컬 세션 상태다** — `.sdd/gate-failures.jsonl`(gitignored, `.sdd/deploy-debt.jsonl`과 같은 층)이지 `sdd/`(커밋 대상 선언) 층이 아니다. "채택했다"의 선언이 아니라 "지금까지 무슨 일이 있었는가"의 누적 로그이기 때문이다.
- **깨진 줄을 조용히 버리지 않는다** — `parseLedger`는 파싱 실패한 줄 수(`unreadable`)를 함께 돌려준다. 원장이 있는데 다 못 읽은 상태를 통과로 두지 않는다(SPEC-054의 3분류와 같은 규율).
- **원장이 없으면 INERT다** — 게이트가 아직 한 번도 차단한 적이 없거나 작업본이 새로 만들어진 정상 상태이므로, "차단 없음"과 "판정 안 함"을 구분해 표시한다(SPEC-040).
- **가드 선언 오류는 정책 강도와 무관하게 항상 에러다** — `off`가 아닌 한, 가드 선언 자체가 결함이면 `hard`/`advisory` 구분 없이 차단한다. 이 축의 자기결함은 조용한 무발화이기 때문이다(4필드 중 하나라도 없으면 그 가드는 아무것도 가리지 못하는데, advisory로 통과시키면 사람은 "가드가 있어서 안전하다"로 오해한다).
- **에스컬레이션 게이트 자신도 `armVerdict`를 거친다** — 이 게이트가 차단하면 자기 실패도 같은 원장에 append된다(순환이 아니라 일관성 — 모든 판정 게이트가 예외 없이 같은 종료 훅을 거친다는 계약의 자연스러운 결과). 자기 실패는 `class`를 선언하지 않으므로 집계에는 들어가지 않는다.
- **`advisory`는 막지 않는다** — 강도 사다리를 지킨다. 채택 중 프로젝트를 벽으로 세우지 않는다.
- **완전 자율 감사 에이전트는 이 축의 범위가 아니다** — 어떤 실수가 전용 가드로 굳어져야 하는지는 판단이고, 틀리면 오탐 게이트가 생긴다. 이 축이 결정적으로 만드는 것은 회계(①원장 적재, ②임계치 대조)뿐이다 — 가드를 실제로 설계·구현하는 판단은 사람(또는 사람이 지시한 세션)의 몫으로 남긴다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN any judging gate exits non-zero through **armVerdict** (S, verdict-lib.mjs), the shared exit hook SHALL append one record to the gate-failure ledger containing the gate name, verdict kind, detail, exit code, timestamp, and session id, without requiring any change to the individual gate's own source. — capability: **gate-failure.record** (C).
- **FR-002** (ubiquitous): THE ledger record's `class` and `target` fields SHALL be populated only when the failing gate explicitly declares them via its verdict call, and SHALL be null otherwise, because inferring a class from free-text detail would be guessing and this methodology forbids guessing.
- **FR-003** (unwanted): IF a ledger line fails to parse as a JSON object, THEN the reader SHALL count it as unreadable and report that count rather than silently dropping it, because a ledger that exists but cannot be fully read must not be reported as clean.
- **FR-004** (event): WHEN **check-gate-escalation.mjs** (S) finds a (gate, class) pair whose ledger count meets or exceeds the configured threshold and for which no valid guard is declared, it SHALL report the gate, class, repeat count, and affected targets, and it SHALL exit non-zero only when `gateFailureEscalationPolicy` is `hard`.
- **FR-005** (unwanted): IF a `gateFailureGuards` entry is missing any of its four required fields, has an empty reason, or names a guard file that does not exist, THEN the gate SHALL exit non-zero identifying the defective declaration and its defect kind, regardless of `gateFailureEscalationPolicy`'s strength, because a guard that cannot suppress anything must not fail silently.
- **FR-006** (unwanted): IF the ledger file does not exist, THEN the gate SHALL declare that it judged nothing rather than reporting a clean escalation result, because a gate with no judgement input reporting green is the false-safety this methodology treats as a defect.
- **FR-007** (ubiquitous): THE gate's report and exit code SHALL be identical between the canonical runtime and the Python runtime, as required for judging gates.

### Key Entities
- **gate failure ledger** — an append-only local log of every non-zero gate exit, populated by the single shared verdict exit hook rather than by individual gates, so that adding a new gate automatically makes its failures visible without a corresponding ledger-wiring change.
- **failure class** — an optional, gate-declared identifier on a ledger record that groups repeats of the same known mistake for escalation counting; unlike the record's free-text detail, a class exists only when a gate author explicitly names it, never by text classification of the detail string.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: gate-failure
- **Symbols**: gate-failure-lib.mjs, check-gate-escalation.mjs
- **Artifacts**: —
- **Capabilities**: gate-failure.record
- **Files**: tooling/gate-failure-lib.mjs, tooling/check-gate-escalation.mjs, tooling/__tests__/gate-failure.test.mjs

## Dependencies (참조 — dedup 제외)
> 원장 append의 실행 지점(`armVerdict`)은 SPEC-040 소유(이 spec은 그 종료 훅에 append 호출을 추가하는 변경자), Python 복제는 SPEC-006 소유. SPEC-056은 이 축의 첫 실측 소비자(참조 방향은 SPEC-056 → SPEC-057 쪽에서만 선언 — 순환 방지).
- **Modules**: gate-verdict (references)
- **Symbols**: verdict-lib.mjs, sdd-config.mjs

---

## Success Criteria (측정형)
- **SC-001**: `gate-failure.test.mjs` 전 케이스 green — 코어(파싱·레코드 생성·집계·가드 3종 결함·에스컬레이션 임계치) 다수 + 게이트 카나리아(hard 차단·advisory 비차단·가드로 억제·가드 오류 3종·원장 없음 INERT·off) 다수. [검증: tooling/__tests__/gate-failure.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다(임계치 초과·가드 있음·가드 오류 3종·원장 없음·off·enum 밖). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 기존 판정 게이트 어디에도 원장 관련 코드를 추가하지 않고 `armVerdict` 단일 변경만으로 전 게이트가 원장에 참여한다 — 이 사실 자체가 SC(손 배선 0건)다. [검증: tooling/__tests__/gate-failure.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어(`gate-failure-lib.mjs`)는 문자열·배열 입력만의 순수 함수이고 원장 파일의 읽기·쓰기는 소비자(`verdict-lib.mjs`의 append, `check-gate-escalation.mjs`의 read)가 하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/gate-failure.test.mjs]

## Assumptions / Clarifications Retained
- 원장 경로를 제보자가 제안한 `sdd/evidence/gate-failures.jsonl` 대신 `.sdd/gate-failures.jsonl`로 뒀다 — 이 킷은 이미 `.sdd/`(gitignored, 세션 누적 로그)와 `sdd/`(커밋 대상 선언 상태)를 구분하고 있고(`.sdd/deploy-debt.jsonl` 선례), 원장은 "채택 선언"이 아니라 "무슨 일이 있었는가"의 로그이므로 기존 구분을 따랐다. `gateFailureLedger` config로 경로는 재정의 가능하다.
- **기각한 대안:** 게이트마다 원장 append 코드를 개별 삽입하는 방식. 제보가 직접 지적한 형태 그 자체다 — 반드시 빠뜨리는 게이트가 생기고, 그 게이트가 다음 결함의 자리가 된다. 재검토 조건: 없음.
- **기각한 대안:** 실패 `detail` 문자열을 정규식·키워드로 분류해 클래스를 추론하는 방식. 이 방법론은 추측을 금지한다 — 분류가 틀리면 오탐 에스컬레이션이 쌓이고, 오탐이 잦은 축은 꺼진다. 재검토 조건: 없음.
- **기각한 대안:** 임계치를 넘기면 게이트를 자동으로 생성하거나 자동으로 가드를 등록하는 완전 자율 감사 에이전트. 어떤 실수가 전용 가드로 굳어져야 하는지는 판단이고, 틀리면 오탐 게이트가 생긴다. 이 축은 회계(①②)만 결정적으로 만들고, 가드 설계는 사람의 몫으로 남긴다. 재검토 조건: 없음.
- **기각한 대안:** 벌점·차단 누적 등 징벌적 장치. 제보의 명시적 요청은 "벌이 아니라 가시성"이다 — 이 축은 세 번째 반복에서 "이건 세 번째다"를 말하는 것으로 끝나고, 그 이상의 조치(차단 해제 조건 등)를 만들지 않는다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-11 | 셀프리뷰(코어 TDD 다수 + 게이트 카나리아 다수 + 양판 패리티) + 제보 요청("핵심" 명시 — 원장+에스컬레이션) → Active | FR-001~007 unit 커버. 킷 자기적용: 킷 자신의 개발 세션에서 원장 append가 armVerdict 단일 변경만으로 전 게이트에 적용됨을 확인 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-11 이웃 SPEC-040(gate-verdict): 비중복이자 확장 관계 — 040은 게이트가 **무엇을 했는지**의 판정 타입 계약(JUDGED/SKIPPED/OFF/INERT 등)을 정의하고, 057은 그 계약의 공통 종료 지점(`armVerdict`)에 **실패의 기억**을 얹는다. 040이 없었다면 057이 붙을 단일 지점 자체가 없었다 — 057은 040의 소비자다.
- 2026-08-11 이웃 SPEC-027(policy-ratchet): 비중복 — 027은 강도 knob이 시간이 지나며 **완화되지 않는가**(단조성), 057은 **같은 실수가 반복되는가**(빈도)다. 강도가 한 번도 완화되지 않은 축에서도 같은 클래스의 실패가 반복될 수 있다.
- 2026-08-11 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 행위 전제 조건의 **실행 시점** 부채(`.sdd/deploy-debt.jsonl`), 057은 **모든 판정 게이트**의 차단 이력이다. 035의 원장은 057이 다루는 여러 원장 중 하나가 아니라 별도 도메인(배포)의 로그이고, 형식(gitignored 세션 로그)만 057과 같은 관례를 따른다.
- 2026-08-11 이웃 SPEC-056(fr-placement): 비중복이자 첫 소비 관계 — 위 SPEC-056 Dedup-Review 참조(같은 문장을 반대 방향에서 기록).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-11 | 초안 — `gate-failure-lib`(원장 파싱·레코드 생성·클래스 집계·가드 3종 결함 판정·에스컬레이션 판정) + `check-gate-escalation`(hard/advisory/off·가드 대조·원장 없음 INERT) + `verdict-lib.mjs`의 `armVerdict` 종료 훅에 원장 append 배선(기존 게이트 0건 변경) + `gateFailureEscalationPolicy`·`gateFailureEscalationThreshold`·`gateFailureLedger`·`gateFailureGuards` knob + 스윕 R24 등재 + commit-msg 체인 편입 + 배포 목록·양판 대응 편입, 양판 | 실측 제보: 에이전트가 하루에 같은 실수를 세 번 했다 — 게이트는 세 번 다 잡았고 사유도 정확했지만 "이게 세 번째"라는 정보가 어디에도 없었다. 제보의 핵심 요청은 벌이 아니라 가시성이었다. append를 게이트마다 심지 않고 `armVerdict` 단일 종료 훅에 둔 이유: 손으로 흩뿌리면 반드시 빠뜨리는 게이트가 생기고, 그 게이트가 다음 결함의 자리가 된다 — 제보가 겪은 것이 정확히 그 형태다(FR-placement 자체가 이미 있던 다른 게이트들처럼 이 훅에 자동으로 얹혔다). 클래스를 정규식 추론이 아니라 게이트의 명시적 `verdict(kind, detail, {class})` 선언으로만 인정한 이유: 이 방법론은 추측을 금지하고, 텍스트 분류는 추측이다. 완전 자율 감사 에이전트를 범위에 넣지 않은 이유: 어떤 실수가 가드로 굳어져야 하는지는 판단이고 틀리면 오탐 게이트가 생기지만, 원장 적재와 임계치 대조는 회계라서 결정적으로 만들 수 있다 — 거기까지가 이번 범위다 [검증: tooling/__tests__/gate-failure.test.mjs] |
