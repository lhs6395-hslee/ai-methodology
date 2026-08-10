# Feature Specification: Completion Signal (완료 판정이 무엇을 관측했는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-055`  **Created**: 2026-08-10  **Status**: Active
**Input**: 실측 제보(2026-08-10) — **배포 완료를 파생 신호로 판정했다.** 파이프라인 로그에 성공 줄이 있고 CI 상태가 초록이어서 완료로 보고했는데, 실제로는 `drizzle/meta` 스냅샷 누락으로 migrate Job이 실패해 **배포 스테이지가 스킵된 상태**였다. 로그와 CI 상태는 대상이 아니라 **대상에 대한 이야기**다. 제보의 요청: "완료 판정은 파생물이 아니라 대상 상태를 관측해야 하고, 그 신호의 종류가 표기되어야 한다." 같은 라운드의 다른 제보(SPEC-054)와 짝이다 — 그쪽은 "못 본 것을 통과로 말하지 않는다", 이쪽은 "약하게 본 것을 완료로 말하지 않는다".

---

## User Scenarios & Testing

### User Story 1 — 로그와 상태는 대상이 아니다 (P1)
파생 신호는 대상이 정상일 때도 정상이고 **대상이 실패했을 때도 정상일 수 있다**(실측: 스테이지가 스킵되면 실패 줄조차 남지 않는다). 완료를 주장하는 판정이 파생물만 보면 그 판정은 구조적으로 틀릴 수 있다.
- **Independent Test**: `completion-signal.test.mjs`가 순수 코어(등급·정규화·판정)와 게이트 배선을 단독 검증. [검증: tooling/__tests__/completion-signal.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a check that asserts completion and declares a derived signal, **When** the gate runs at strict strength, **Then** it exits non-zero naming that check.

### User Story 2 — 선언이 없으면 추정하지 않는다 (P1)
기본값을 주면 그 기본값이 조용히 정답이 되고, 그 순간 이 축은 "선언을 요구하는 축"에서 "아무것도 요구하지 않는 축"이 된다.
- **Independent Test**: 같은 테스트가 미선언·공백·열거 밖 각 갈래를 서로 다른 위반으로 확인. [검증: tooling/__tests__/completion-signal.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a check that asserts completion with no declared signal, **When** the gate runs, **Then** it reports the missing declaration rather than assuming a kind.

### User Story 3 — 완료를 주장하지 않는 검사는 대상이 아니다 (P1)
모든 검사에 신호 선언을 요구하면 소음이 되고, 소음이 되는 순간 사람이 정책을 끈다. 이 축은 **"됐는가"를 말하는 검사**만 본다.
- **Independent Test**: 같은 테스트가 완료 주장 0건일 때 게이트가 INERT를 선언함을 확인. [검증: tooling/__tests__/completion-signal.test.mjs]
- **Acceptance (GWT)**: 1. **Given** declared checks none of which assert completion, **When** the gate runs, **Then** it declares that it judged nothing rather than reporting a clean result.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **증거 등급과 직교한다** — SPEC-031은 증거 **자산**의 등급(단위테스트·브라우저·배포본)을 보고, 이 축은 판정이 **무엇을 관측했는가**를 본다. 브라우저 등급 자산이라도 그 실행 로그를 읽어 완료를 말하면 파생 신호이고, 셸 한 줄이라도 대상을 직접 조회하면 대상 신호다. **등급 높은 증거가 약한 신호로 소비되는 것**이 제보가 겪은 형태다.
- **종류는 셋뿐이고 순서가 곧 등급이다** — 별도 랭크 표를 두면 둘이 갈라진다. 넷째를 만들면 경계 판단이 필요해지고, 경계 판단이 필요한 분류는 급할 때 편한 쪽으로 기운다(SPEC-054와 같은 이유).
- **이 축은 선언을 판정한다** — 그 명령이 정말 대상을 조회하는지는 정적으로 결정되지 않는다. 추측으로 판정하면 오탐이 쌓이고, 오탐이 잦은 게이트는 꺼진다.
- **해소는 선언을 고쳐 적는 것이 아니다** — 명령을 그대로 두고 선언만 `target-state`로 바꾸면 그 선언이 거짓이 된다. 해소는 **대상을 조회하는 검사를 더하는 것**이다.
- **id가 없어도 판정은 사라지지 않는다** — 무명 항목이 조용히 빠지면 그 자리가 사각이다.
- **`advisory`는 막지 않는다** — 강도 사다리를 지킨다. 채택 중 프로젝트를 벽으로 세우지 않는다.
- **완료 주장 0건은 clean이 아니다** — 판정 입력이 없는 상태를 통과로 출력하지 않는다(SPEC-040 INERT).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **completion-signal** (E) core in **completion-signal-lib.mjs** (S) SHALL expose exactly three signal kinds ordered strongest first — direct observation of the target's present state, a derivative account of the target, and a human or agent statement — and the declaration order SHALL itself be the grade so that no separate rank table can diverge from it. — capability: **completion-signal.grade** (C).
- **FR-002** (unwanted): IF a check asserts completion while declaring no signal kind, an unknown kind, or a kind weaker than direct observation of the target state, THEN the core SHALL report each case as a distinct finding, and it SHALL NOT assume a default kind for an absent declaration because an assumed default silently becomes the answer.
- **FR-003** (event): WHEN **check-completion-signal.mjs** (S) judges at strict strength and any finding exists, it SHALL exit non-zero and SHALL state that the resolution is to add a check observing the target rather than to relabel the declaration.
- **FR-004** (unwanted): IF no declared check asserts completion, THEN the gate SHALL declare that it judged nothing rather than reporting a clean result, because a gate with no judgement input reporting green is the false-safety this methodology treats as a defect.
- **FR-005** (ubiquitous): THE gate's report and exit code SHALL be identical between the canonical runtime and the Python runtime, as required for judging gates.

### Key Entities
- **completion signal** — what a verdict actually observed when it concluded that something is done: the target's present state, a derivative account of it, or a statement about it — as distinct from the grade of the evidence asset used (SPEC-031), so that a high-grade asset consumed as a log line cannot pass as a completion verdict.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: completion-signal
- **Symbols**: completion-signal-lib.mjs, check-completion-signal.mjs
- **Artifacts**: —
- **Capabilities**: completion-signal.grade
- **Files**: tooling/completion-signal-lib.mjs, tooling/check-completion-signal.mjs, tooling/__tests__/completion-signal.test.mjs

## Dependencies (참조 — dedup 제외)
> 완료 주장의 선언 원천은 SPEC-032 소유, 증거 자산 등급은 SPEC-031, 판정 타입은 SPEC-040, Python 복제는 SPEC-006 소유.
- **Modules**: live-reality (references), execution-evidence (references), gate-verdict (references)
- **Symbols**: live-reality-lib.mjs, sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `completion-signal.test.mjs` 전 케이스 green — 등급 1·정규화 1·비대상 1·약한 신호 1·미선언·오타 1·문장 전수 1·게이트 4. [검증: tooling/__tests__/completion-signal.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다(9 시나리오). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 게이트가 파생 신호 완료 주장을 hard에서 **실제로 차단**한다 — 통과 경로만 관측된 게이트는 미검증이다(SPEC-048 카나리아 계약). [검증: tooling/__tests__/completion-signal.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·배열 대조만의 순수 함수이고 config 읽기는 소비 게이트가 하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/completion-signal.test.mjs]

## Assumptions / Clarifications Retained
- 킷 자신에는 클라우드 자원이 없어 완료를 주장하는 검사가 0건이고, 이 축은 킷에서 **INERT**다. 그 사실을 게이트가 매 실행 밝힌다 — 도그푸딩 0인 축은 그 사실이 보여야 한다(SPEC-051에서 배운 것).
- **기각한 대안:** 명령을 정적 분석해 "이 명령이 대상을 조회하는가"를 판정하는 방식. `kubectl`·`psql`·`curl` 어휘 목록으로 판정하면 프로젝트마다 목록 밖에서 오탐·미탐이 살아나고, 그 목록은 킷이 그 프로젝트의 인프라를 아는 것을 전제한다(하드코딩 지양). 재검토 조건: 없음.
- **기각한 대안:** 신호 종류에 기본값(`derived`)을 두는 방식. 추정한 기본값은 조용히 정답이 되고, 그 순간 선언을 요구하는 축이 아무것도 요구하지 않는 축이 된다. 재검토 조건: 없음.
- **기각한 대안:** 모든 검사에 신호 선언을 요구하는 방식. 완료를 주장하지 않는 검사까지 요구하면 소음이 되고, 소음이 되는 순간 사람이 정책을 끈다 — **선언된 완료 주장에만** 발화한다. 재검토 조건: 없음.
- **기각한 대안:** SPEC-031(실행 증거)에 신호 종류를 얹는 방식. 그쪽은 증거 **자산**의 등급이고 이쪽은 **판정이 관측한 것**이라 직교한다. 한 축에 묶으면 "브라우저 등급 자산의 로그를 읽어 완료를 말한 경우"가 표현되지 않는다 — 그것이 정확히 제보가 겪은 형태다. 재검토 조건: 없음.
- **기각한 대안:** `derived`를 완료의 하한으로 허용하는 방식(강도 완화). 제보의 결함이 바로 그 상태였다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(코어 TDD 6종 + 게이트 카나리아 4종 + 양판 패리티 9 시나리오) + 제보 요청(완료 판정의 신호 강도 표기) → Active | FR-001~005 unit 커버. 킷 자기적용: 완료 주장 0건이라 INERT이고 게이트가 그 사실을 매 실행 밝힌다 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-031(execution-evidence): 비중복 — 031은 증거 **자산의 등급**(단위테스트·브라우저·배포본), 055는 **판정이 관측한 것**이다. 직교한다: 브라우저 등급 자산의 실행 로그를 읽어 완료를 말하면 031은 통과하고 055는 위반이며, 그 조합이 제보가 겪은 형태다.
- 2026-08-10 이웃 SPEC-032(live-reality): 비중복 — 032는 저장소 밖 진실과 선언의 **일치**를 판정하고, 055는 그 검사가 **완료를 주장할 자격**이 있는지 본다. 032가 선언 원천을 소유하고 055가 그 선언의 한 필드를 판정한다(층 합성).
- 2026-08-10 이웃 SPEC-054(check-outcome): 비중복 — 054는 "못 본 것을 통과로 말하지 않는다"(관측 실패), 055는 "약하게 본 것을 완료로 말하지 않는다"(관측 대상). 같은 라운드의 짝이지만 054는 반환 형태이고 055는 관측 대상의 등급이다.
- 2026-08-10 이웃 SPEC-041(verification-run): 비중복 — 041은 선언된 검증 자산이 **실제로 돌았는가**(실행의 실재), 055는 그 실행이 **무엇을 봤는가**(관측 대상)다. 041의 원장 자체가 파생물이므로 041만으로 완료를 말하면 055의 위반이다.
- 2026-08-10 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 **행위**의 전제 조건과 부채, 055는 배포가 **끝났다는 판정**의 신호 강도다. 035가 통과한 배포도 055 기준으로 완료가 아닐 수 있다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `completion-signal-lib`(3종 등급·순서=등급·미선언 비추정·판정 3갈래) + `check-completion-signal`(선언 판정 + 완료 주장 0건 INERT) + `completionSignalPolicy` knob + 스윕 R22 등재 + 배포 목록·양판 대응 편입, 양판 | 실측 제보: **배포 완료를 파생 신호로 판정했다** — 파이프라인 로그에 성공 줄이 있고 CI가 초록이어서 완료로 보고했는데 migrate Job 실패로 배포 스테이지가 **스킵**된 상태였다. 파생 신호는 대상이 실패했을 때도 정상일 수 있고, 스테이지가 스킵되면 실패 줄조차 남지 않는다. SPEC-031로 부족한 이유: 그쪽은 증거 **자산의 등급**이고 이 축은 **판정이 관측한 것**이라 직교한다 — 브라우저 등급 자산의 로그를 읽어 완료를 말한 경우가 031에서는 표현되지 않는데 그것이 정확히 이 사고의 형태다. 명령 정적 분석을 기각한 이유: 어휘 목록으로 판정하면 목록 밖에서 오탐·미탐이 살아나고 킷이 그 프로젝트의 인프라를 안다고 전제하게 된다 — **선언을 요구하고 선언을 판정한다.** 기본값을 두지 않은 이유: 추정한 기본값은 조용히 정답이 되고 그 순간 이 축은 아무것도 요구하지 않는 축이 된다. 해소 안내를 "선언을 고쳐 적어라"가 아니라 "대상을 조회하는 검사를 더해라"로 쓴 이유: 명령을 그대로 두고 선언만 바꾸면 그 선언이 거짓이 된다 [검증: tooling/__tests__/completion-signal.test.mjs] |
