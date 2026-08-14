# Feature Specification: Action Approval (독립 검증 없이 위험 행동이 지나가지 않는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-058`  **Created**: 2026-08-14  **Status**: Active
**Input**: 실측 제보(2026-08-14, gsn-ai-pm-management-tool) — 같은 세션에서 두 사고가 났다. ① QA 실측·트래커 댓글까지 마친 티켓 3건을, 아직 배포도 안 된 상태에서 `dev-done`(종결 상태 전이)으로 넘기려 했다 — 그 프로젝트의 `CLOSEOUT_FLOW`/FR-027이 순서를 명문화해뒀는데도 "실측했고 댓글도 달았으니 다음은 마감"이라는 대화적 관성으로 판단했다. ② 이 반복 실수를 고치라고 하자 개인 memory 파일에 규칙을 적으려 했다 — 정작 그 프로젝트 `INFRA-004 FR-046/047`이 "규칙을 사적 메모리에만 박으려 함"을 2026-08-10에 이미 실패 사례로 지목해뒀는데도 확인하지 않았다. 둘 다 **커밋 이전**, 대화 안에서 끝나 기존 커밋 게이트(`check-spec-sync` 등)가 원리상 관여할 지점이 없었다. `INFRA-004 FR-046/047`(그 프로젝트의 프로세스 준수 감시)은 훌륭하지만 commit-msg/pre-push 시점에만 발동한다.

---

## User Scenarios & Testing

### User Story 1 — 되돌리기 어려운 행동은 매칭 즉시 판정 대상이 된다 (P1)
트래커 상태 전이·배포·파괴적 DB 조작처럼 되돌리기 어려운 행동은 프로젝트마다 다르다(트래커 API, 배포 명령, DB 종류가 다르다). 그래서 이 축은 어휘를 하드코딩하지 않고 `riskyActionPatterns` 선언으로 프로젝트별 인스턴스화한다.
- **Independent Test**: `action-approval.test.mjs`가 순수 코어(`matchRiskyAction`)와 게이트 배선을 단독 검증. [검증: tooling/__tests__/action-approval.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a declared risky-action pattern and a pending Bash command matching it, **When** the PreToolUse hook runs, **Then** the command is classified as requiring approval before any approval-ledger lookup happens.

### User Story 2 — 승인 마커는 행동 페이로드 해시에 결속된다 (P1)
세션 단위·패턴 단위로 승인을 재사용하면 한 번의 승인이 **다른 대상**의 같은 종류 행동까지 통과시킨다(예: 티켓 A의 종결 승인이 티켓 B의 종결까지 덮는다). 그래서 승인은 실행될 명령 문자열의 sha256 해시에 결속된다.
- **Independent Test**: 같은 해시의 신선한 승인만 통과하고, 다른 명령(다른 해시)이나 만료된 승인은 다시 막힘을 확인. [검증: tooling/__tests__/action-approval.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a valid, unexpired approval recorded for command A, **When** a different command B matching the same risky pattern runs, **Then** B is blocked because its hash does not match any approval record.

### User Story 3 — 게이트는 서브에이전트를 스스로 부르지 않는다 (P1)
게이트는 결정론적이고 LLM을 호출하지 않는다 — Node·Python 양판이 가능해야 하기 때문이다(SPEC-006). "독립 서브에이전트를 불러 확인시켜라"는 차단 메시지의 지시일 뿐이고, 실제 호출은 차단당한 실행기 자신이 자기 도구로 수행한다.
- **Independent Test**: 카나리아 테스트가 차단 메시지에 확인 방법·`--record` 안내가 포함됨을 확인하고, 게이트 코드 자체에 LLM 호출·네트워크 호출이 없음을 순수성으로 보장(코어가 IO 없는 순수 함수라는 계약). [검증: tooling/__tests__/action-approval.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a blocked risky action, **When** the guidance is printed, **Then** it names what to verify and the exact `--record` command to run afterward, without the gate process itself performing any verification.

### User Story 4 — 가드 선언 자체의 결함은 조용히 넘기지 않는다 (P1)
`riskyActionPatterns` 선언이 불완전하면(match·class·verifyAgainst·why 중 하나라도 없음) 그 규칙은 아무것도 막지 못하는데, 침묵하면 사람은 "선언이 있어서 안전하다"로 오해한다.
- **Independent Test**: 4종 결함을 각각 독립 finding으로 보고하고 hard에서 차단함을 확인. [검증: tooling/__tests__/action-approval.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a `riskyActionPatterns` entry missing `class`, **When** the sweep mode runs, **Then** it reports the defect and exits non-zero under hard, regardless of whether any risky command has run yet.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **범위 밖(의도적): 미확인 단정(제보의 사례 ①)** — "로컬에 Excel·Postgres가 없다"는 확인 없는 자연어 주장은 이 축이 잡지 않는다. 도구 호출을 막는 것과 자연어 주장을 판정하는 것은 다른 문제이고, 후자를 패턴 매칭으로 시도하면 이 방법론이 금지하는 **추측 기반 판정**이 된다(오탐 게이트를 만들지 말라는 규범과 정면 충돌). 재검토 조건: 없음 — 이 부류의 사고는 이 축이 아니라 다른 메커니즘(예: 도구 호출 전 컨텍스트 프라이밍)의 대상이다.
- **완전 자율 감사 에이전트는 범위 밖이다**(SPEC-057과 같은 경계) — 언제·어떻게 서브에이전트를 부를지는 매번 실행기가 판단하고, 이 축은 마커의 존재·해시 일치·신선도 회계만 결정적으로 만든다. 검증이 실제로 옳았는지는 이 축의 판정 대상이 아니다(질은 그 서브에이전트 호출의 몫).
- **마커는 행동 페이로드 해시로 결속한다(세션·패턴 단위 재사용 금지)** — 완화(세션 전체 승인, 패턴당 1회 승인)는 마찰은 줄이지만 승인의 대상 특정성을 잃는다. 이 킷은 최대 엄격도(정확한 페이로드 해시 일치)를 기본으로 선택했다 — 프로젝트가 원하면 `riskyActionApprovalTtlSeconds`로 신선도만 조정할 수 있다(대상 특정성은 완화 대상이 아니다).
- **새 SPEC으로 분리한다(SPEC-053 확장이 아니다)** — SPEC-053(진단가드)과 같은 층(도구 호출 직전)이지만 구제 방식이 다르다: 053은 "이미 답이 있는 명세를 읽어라"(정적 지목), 058은 "독립 검증을 실제로 수행하고 그 증거를 남겨라"(동적 승인 마커). 한 축에 묶으면 두 방식이 뒤섞여 어느 쪽 계약도 명확하지 않게 된다.
- **비-Claude 플랫폼의 실시간 차단 동등물은 이번 범위가 아니다** — `PreToolUse`는 현재 Claude Code 전용이고, SPEC-053·035도 같은 제약 아래 있다(선례). 이 축도 같은 경계를 따르고, 다른 실행기용 실시간 차단 지점은 향후 과제로 남긴다(문서화된 한계이지 조용한 누락이 아니다).
- **`advisory`는 막지 않는다** — 강도 사다리를 지킨다. 채택 중 프로젝트를 벽으로 세우지 않는다.
- **차단 시 실패 클래스를 선언한다(패턴이 선언한 `class`)** — SPEC-057의 에스컬레이션 집계가 "선언된 클래스만 센다"는 계약의 두 번째 소비자다(첫 소비자는 SPEC-056). 같은 위험 행동이 임계치 이상 반복되면 R24가 "이건 N번째다, 가드를 만들어라"를 말한다.
- **`--record`는 게이트가 판정한 것이 아니라 사람/서브에이전트가 선언한 것이다** — 이 모드는 `SKIPPED` 판정 타입을 방출한다(교정 유틸리티 경로임을 명시, `--fix`와 같은 계약).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **action-approval** (E) core in **action-approval-lib.mjs** (S) SHALL match a pending command against declared `riskyActionPatterns` entries in declaration order and return the first matching entry, so that ordering itself is the precedence rule for overlapping patterns. — capability: **action-approval.enforce** (C).
- **FR-002** (event): WHEN **check-risky-action.mjs** (S) running as a PreToolUse hook finds a command matching a declared risky-action pattern with no valid approval, it SHALL report the pattern's class, why, and verification target, instruct that an independent subagent perform the verification, and it SHALL exit non-zero only when `riskyActionPolicy` is `hard`.
- **FR-003** (unwanted): IF an approval record's hash does not exactly equal the sha256 hash of the pending command's exact text, or its timestamp is older than `riskyActionApprovalTtlSeconds`, THEN the gate SHALL treat it as absent and SHALL NOT let the action through, because reusing an approval across a different action or after it has gone stale defeats the guarantee this axis exists to provide.
- **FR-004** (event): WHEN a person or subagent runs **check-risky-action.mjs --record** (S) with `--command`, `--class`, and `--note`, THE SYSTEM SHALL compute the hash from the exact command text and append one record to the approval ledger, and it SHALL refuse the invocation when any of the three arguments is missing rather than inventing a placeholder.
- **FR-005** (unwanted): IF a `riskyActionPatterns` entry is missing `match`, `class`, `verifyAgainst`, or `why`, THEN the sweep mode SHALL report each defect independently and SHALL exit non-zero under `hard`, because a malformed declaration matches nothing and blocks nothing while looking like a guard.
- **FR-006** (event): WHEN the gate blocks under `hard`, it SHALL declare the matched pattern's `class` and the action's hash as the verdict's escalation metadata, so a gate-failure ledger consumer (SPEC-057) can count repeats of the same risky action without inferring the class from free text.
- **FR-007** (ubiquitous): THE gate SHALL NOT itself invoke any subagent, model call, or network request — its own judgment is limited to the approval marker's existence, hash match, and freshness, and the instruction to perform independent verification is text directed at the blocked executor, not an action the gate takes.
- **FR-008** (ubiquitous): THE gate's report and exit code SHALL be identical between the canonical runtime and the Python runtime, as required for judging gates.

### Key Entities
- **risky action** — a pending tool-call command matching a project-declared pattern for behavior that is hard to reverse (tracker state transition, deploy, destructive DB operation), as distinct from an investigation-shaped command (SPEC-053) or a deploy precondition (SPEC-035) — the remedy differs: this axis requires dynamic proof of independent verification, not a static spec pointer or precondition check.
- **approval marker** — a ledger record asserting that a specific action (identified by the sha256 hash of its exact command text) was independently verified; valid only while within its configured freshness window and only for that exact action, never inferred to cover a different action of the same class.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: action-approval
- **Symbols**: action-approval-lib.mjs, check-risky-action.mjs
- **Artifacts**: —
- **Capabilities**: action-approval.enforce
- **Files**: tooling/action-approval-lib.mjs, tooling/check-risky-action.mjs, tooling/harness/sdd-risky-action-check.sh, tooling/__tests__/action-approval.test.mjs

## Dependencies (참조 — dedup 제외)
> 원장 줄 파싱(`parseLedger`)은 SPEC-057 소유(재사용, 구현 중복 방지). 원장 append의 실행 지점(`armVerdict`)은 SPEC-040 소유. `commandFromHookInput`은 SPEC-035 소유(재사용). Python 복제는 SPEC-006 소유.
- **Modules**: gate-failure (references), gate-verdict (references), deploy-guard (references)
- **Symbols**: gate-failure-lib.mjs, verdict-lib.mjs, deploy-guard-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `action-approval.test.mjs` 전 케이스 green — 코어(해시 결정성·선언 파싱·검증 4종 결함·매칭·승인 신선도 4종) + 게이트 카나리아(hard 차단·advisory 비차단·무관 침묵·record 통과·해시 불일치 재차단·만료 재차단·record 인자 결여·스윕 4종). [검증: tooling/__tests__/action-approval.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다(훅 4·승인 통과/만료·record 인자 결여·스윕 5, 총 11+ 시나리오). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 게이트가 hard에서 승인 없는 위험 행동을 **실제로 차단**한다 — 통과 경로만 관측된 게이트는 미검증이다(SPEC-048 카나리아 계약). [검증: tooling/__tests__/action-approval.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어(`action-approval-lib.mjs`)는 문자열·배열·시각 입력만의 순수 함수이고(해시 계산 포함 — 결정적, IO 없음), 원장 파일의 읽기·쓰기·현재 시각 조회는 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/action-approval.test.mjs]

## Assumptions / Clarifications Retained
- 킷 자신에는 되돌리기 어려운 행동(트래커·배포·DB)이 없어 `riskyActionPatterns`가 미선언이고, 이 축은 킷에서 **INERT**다. 그 사실을 게이트가 매 실행 밝힌다.
- 오너의 명시적 결정(설계 논의): "감시용/감사용 게이트·에이전트 각 2개=4개" 안을 기각하고 게이트 1개+에이전트 1개로 수렴했다 — 시점(실시간 vs 사후)은 "무엇을 만드는가"가 아니라 "언제 호출하는가"의 문제였다. 두 트리거 지점(commit-msg 게이트·PreToolUse 훅)은 같은 두 산출물(`action-approval-lib.mjs`/`check-risky-action.mjs`)을 재사용한다.
- 오너의 명시적 결정(마커 결속 강도): 세션 단위·패턴 단위·행동 해시 결속 세 옵션 중 **행동 해시 결속**을 골랐다 — 안전성이 반복 마찰보다 우선한다는 명시적 선택이다.
- 오너의 명시적 결정(사례 ① 범위): 미확인 단정(자연어 주장 판정)은 이번 범위에서 명시적으로 제외했다 — 도구 호출 차단과 자연어 주장 판정은 다른 문제이고, 후자의 시도는 추측 기반 판정이 된다.
- 킷 관리자 결정(이 세션): `INFRA-004`가 인용한 "SPEC-048 R17 워치독"은 조사 결과 **현재 킷 HEAD와 실제로 일치**했다(SPEC-048은 창설 이래 계속 watchdog/R17이었다) — 실제 재번호 사고가 아니라 소비 프로젝트가 참조한 시점의 킷 사본이 병합 전 상태였을 가능성이 높다. 그럼에도 제기된 구조적 위험(번호 재구성 시 인용 붕괴)은 유효해, 이 킷이 이미 갖고 있던 보장(번호 재사용 하드 차단 — `sdd-retire`의 `retiredIds`, `numbering-lib`의 순차 강제)을 `STRUCTURE.md`에 명시적으로 문서화하기로 했다(새 리다이렉트 시스템·slug 규칙은 불필요 — 기존 보장이 이미 그 문제를 해소한다).
- **기각한 대안:** 승인을 세션 단위 또는 패턴 단위로 재사용 가능하게 하는 방식. 한 번의 승인이 **다른 대상**의 같은 종류 행동까지 통과시킨다(예: 티켓 A의 종결 승인이 티켓 B의 종결까지 덮는다) — 오너가 명시적으로 기각했다. 재검토 조건: 없음.
- **기각한 대안:** 게이트가 직접 서브에이전트(LLM)를 호출해 검증을 수행하는 방식. 판정 게이트는 결정론적이어야 Node·Python 양판이 가능하다(SPEC-006의 불변) — LLM 호출은 그 자체로 비결정적이고, 이 게이트가 아니라 차단당한 실행기가 자기 도구로 수행해야 그 경계가 유지된다. 재검토 조건: 판정 게이트의 양판 요구가 결정론 외의 형태를 허용하게 되면.
- **기각한 대안:** 미확인 단정(사례 ①)까지 이 축의 위험 패턴으로 포함하는 방식. 도구 호출을 막는 것이 아니라 자연어 주장을 판정해야 하는데, 텍스트 분류는 이 방법론이 금지하는 추측이다. 재검토 조건: 도구 호출 로그에서 "검증 없이 진행"을 결정적으로 판별할 수 있는 별도 신호가 발견되면(그때는 별도 축).
- **기각한 대안:** 진단가드(SPEC-053)를 확장해 이 기능을 흡수하는 방식. 구제 방식이 근본적으로 다르다(정적 지목 vs 동적 승인 마커) — 한 축에 묶으면 두 계약이 뒤섞인다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-14 | 셀프리뷰(코어 TDD 다수 + 게이트 카나리아 다수 + 양판 패리티 11+ 시나리오) + 오너 설계 논의(게이트 1+에이전트 1로 수렴, 해시 결속 채택, 사례① 명시적 제외) → Active | FR-001~008 unit 커버. 킷 자기적용: 킷 자신에 위험 행동 패턴이 없어 INERT이고 게이트가 그 사실을 매 실행 밝힌다 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-14 이웃 SPEC-053(diagnosis-guard): 비중복 — 둘 다 PreToolUse Bash에 살고 "도구 호출 직전"이라는 같은 층이지만, 053은 **정적 지목**("이미 답이 있는 명세를 읽어라")이고 058은 **동적 승인**("독립 검증을 실제로 수행하고 증거를 남겨라")이다. 053의 구제는 문서를 읽는 것으로 끝나지만 058의 구제는 별도 프로세스(서브에이전트 호출)를 요구한다 — 판정 로직도 구제 형태도 다르다.
- 2026-08-14 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 **행위**의 정적 전제 조건(미커밋 트리·upstream 뒤처짐, 순수 git 조회로 사전 판정 가능)을 보고, 058은 **동적 독립 검증의 증거**(승인 마커)를 요구한다. 035는 스윕 미등재(비차단 훅 헬퍼, 양판 대상 아님)이고 058은 스윕 등재(R25, 양판 대상)라는 점도 구조적으로 다르다 — 자체 self-validation(패턴 선언 완전성)을 갖는 축만 스윕에 오른다.
- 2026-08-14 이웃 SPEC-057(gate-failure): 비중복이자 소비 관계 — 057은 임의 게이트의 반복 차단을 원장에 적고 집계하는 일반 메커니즘이고, 058은 그 메커니즘의 **두 번째 실측 소비자**다(SPEC-056이 첫 번째). 원장 파싱(`parseLedger`)도 재사용한다.
- 2026-08-14 이웃 SPEC-051(agent-wiring): 비중복 — 051은 에이전트측 훅이 **배선됐는가**(설정 파일에 실재하는가)를 판정하고, 058은 그 훅이 **무엇을 판정하는가**(위험 행동 승인)다. 051이 없으면 058의 훅이 배선 안 됐다는 사실 자체를 아무도 모른다 — 층 합성.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-14 | 초안 — `action-approval-lib`(sha256 행동 해시·패턴 선언 파싱/검증·매칭·`parseLedger` 재사용·승인 신선도 판정) + `check-risky-action`(hook/record/sweep 3모드, hard/advisory/off, 차단 시 class·hash를 SPEC-057 메타로 선언) + `sdd-risky-action-check.sh`(PreToolUse 래퍼) + `riskyActionPolicy`·`riskyActionPatterns`·`riskyActionApprovalTtlSeconds`·`riskyActionLedger` knob + 스윕 R25 등재 + `agent-hooks.list`·배포 목록·양판 대응·래칫 편입, 양판 | 실측 제보: 커밋 이전, 대화 안에서 위험 행동(트래커 종결 전이 등)이 독립 검증 없이 진행됐다. 오너와 설계를 논의해 "감시·감사 게이트·에이전트 각 2개=4개" 안을 기각하고 게이트 1+에이전트 1로 수렴했다(시점은 무엇을 만드는가가 아니라 언제 호출하는가의 문제). 마커를 세션·패턴이 아니라 **행동 해시**에 결속한 이유: 한 번의 승인이 다른 대상의 같은 종류 행동까지 덮는 것을 막는다(오너 명시적 선택 — 안전성이 마찰보다 우선). 게이트가 서브에이전트를 스스로 부르지 않는 이유: 판정 게이트는 결정론적이어야 Node·Python 양판이 가능하다(SPEC-006) — LLM 호출은 차단당한 실행기 자신의 몫이다. 사례①(미확인 단정)을 명시적으로 제외한 이유: 도구 호출 차단과 자연어 주장 판정은 다른 문제이고 후자는 추측이 된다. SPEC-053을 확장하지 않고 새 SPEC으로 만든 이유: 구제 방식이 근본적으로 다르다(정적 지목 vs 동적 승인) [검증: tooling/__tests__/action-approval.test.mjs] |
