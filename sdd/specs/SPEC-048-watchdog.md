# Feature Specification: Watchdog (감시자가 실재하는가 — 그리고 자기 차단 능력을 증명하는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-048`  **Created**: 2026-08-10  **Status**: Active
**Input**: 오너 지시(2026-08-10) — "방법론을 할 때마다 이 감시게이트 혹은 감시 에이전트가 반드시 생성되도록 하는 로직이 추가되어야 할 것 같아. **각 프로젝트가 방법론을 무시해.**" 그리고 소비 프로젝트 제보의 두 조건: ① 트리거 소유권 — "감시 대상이 에이전트의 판단인데 감시를 에이전트가 불러야 한다면, 절차를 건너뛸 때 감시도 같이 건너뛴다. 훅에 물린 결정적 게이트만 그 루프를 끊는다." ② 게이트 카나리아 — "**결정적인 것과 옳은 것은 다르다.** 틀린 게이트는 틀린 답을 결정적으로 재현하고, 그 고장은 실패가 아니라 통과로 나타나므로 일반 테스트로 드러나지 않는다(실측: 게이트가 19건을 흘리면서 green이었다)." 그리고 그 무시가 실제로 무엇을 낳았는지가 이 라운드로 증명됐다 — 제보 6건 중 5건이 **현재 킷에 이미 고쳐져 있던 결함**이었다. 그 프로젝트는 낡은 킷으로 몇 달을 갔고, 낡았다는 사실을 아무도 알려주지 않았다.

---

## User Scenarios & Testing

### User Story 1 — 우회 불가한 채널이 없으면 그 프로젝트는 언제든 조용히 벗어난다 (P1)
이 축의 출발점은 순환이다: 방법론을 무시하는 프로젝트는 게이트를 돌리지 않고, 그러면 게이트가 무시를 고발할 기회 자체가 없다. 고발 장치가 고발 대상의 협조를 필요로 하는 구조다. 그 순환을 끊는 것은 **서버측 CI**뿐이다 — 로컬 훅은 `--no-verify`로 우회되고, 웹 UI 머지는 훅을 아예 타지 않으며, 게이트 파일은 지워도 아무 일도 일어나지 않는다.
- **Independent Test**: `watchdog.test.mjs`가 순수 코어(영수증 문법·사라진 게이트·CI 배선·마커 교체·영수증 경로 계약)와 게이트(CI 미배선 차단·영수증 부재·게이트 삭제·통과·advisory 비차단·off)를 단독 검증. [검증: tooling/__tests__/watchdog.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a repository with no CI file invoking the sweep, **When** the gate runs under hard, **Then** it reports the absence of an unbypassable channel and exits non-zero.

### User Story 2 — 채택은 영수증을 남긴다 (P1)
"채택했다"가 자기신고로만 존재하면 무엇이 깔렸는지·언제 깔렸는지 아무도 모르고, 지워진 감시자도 지워진 사실을 알리지 않는다. 설치기가 기계가 읽을 수 있는 영수증을 남기고, 게이트가 그 선언과 현실을 대조한다.
- **Independent Test**: 같은 테스트가 영수증 부재·형식 위반·선언 게이트 삭제를 각각 표면화함을 검증. [검증: tooling/__tests__/watchdog.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a receipt naming gates that no longer exist, **When** the gate runs, **Then** it names the removed gates.

### User Story 3 — 설치기가 감시자를 반드시 만든다 (P1)
"감시자를 만들어라"는 권고로는 만들어지지 않는다(그게 오너가 관찰한 무시의 모양이다). 설치기가 CI 워크플로와 영수증을 **선택 단계가 아니라 필수 산출물**로 남기고, 그 다음부터는 게이트가 그것들의 실재를 본다.
- **Independent Test**: 빈 저장소에 설치기를 돌려 CI 워크플로·영수증이 생기고 감시자 게이트가 통과하는 것을 확인(채택 e2e). [검증: tooling/__tests__/init-gates.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a fresh repository, **When** the installer runs, **Then** a CI workflow invoking the sweep and an adoption receipt both exist.

### User Story 4 — 게이트도 고장 나고, 그 고장은 통과로 나타난다 (P1)
검증 도구의 결함은 실패가 아니라 **통과**로 나타나므로 일반 테스트로 드러나지 않는다. 그래서 스윕에 등재된 게이트는 **자기 차단 능력을 증명하는 테스트**를 가져야 한다 — 통과 경로만 관측된 게이트는 clean이 아니라 미검증이다.
- **Independent Test**: 배포 폐포 계약과 같은 자리에 카나리아 계약을 두고, 규칙표의 모든 게이트가 차단 단언(비-0 종료·예외)을 가진 테스트를 갖는지 정적으로 검사. [검증: tooling/__tests__/ship-closure.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a gate registered in the sweep whose tests only assert success, **When** the canary contract runs, **Then** it fails naming that gate.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **CI 배선은 영수증과 무관하게 항상 본다** — 영수증이 없다는 이유로 CI를 안 보면 "채택 안 함"이 곧 "판정 안 함"이 되고, 그건 순환으로 되돌아가는 것이다.
- **영수증은 커밋한다** — `.sdd/`에 두지 않는다. 그쪽은 gitignore라 채택 선언이 체크아웃마다 사라진다. SPEC-041의 실행 원장은 반대로 커밋하지 않는다(세션 상태). **두 사실은 다르다.**
- **상류 대비 낡음은 판정하지 않는다** — 네트워크 없이 알 수 없고, 모르는 것을 위반으로 말하지 않는다. 대신 영수증의 채택 시점·킷 커밋을 **매 실행 그대로 보여줘** 사람이 갱신 시점을 판단하게 한다.
- **시간 임계를 두지 않는다** — "N일 지나면 위반"은 프로젝트마다 다르고, 임계를 넘긴 순간 대량 위반이 떠서 사람이 정책을 끈다(SPEC-041이 기록 신선도를 거부한 것과 같은 이유).
- **CI가 실제로 돌았는지는 보지 않는다** — 그건 SPEC-041의 실행 축이다. 존재는 실행이 아니다.
- **카나리아 계약은 정적이다** — 게이트를 실제로 실행해 심어둔 위반을 놓치는지 보는 것이 더 강하지만, 게이트 22종 × 픽스처 실행은 훅에서 못 돌 무게다. 차단 단언의 **존재**를 정적으로 요구하는 것이 값싸고 결정적이며, 제보의 조건 1("정적으로 결정 가능한 것은 실행·에이전트에 맡기지 않는다")과도 맞는다.
- 마커·글롭·영수증 경로는 프로젝트가 갈아끼운다(하드코딩 지양) — 어휘 교체이지 면제가 아니다.
- 기본 `advisory`. 채택 중 프로젝트를 벽으로 세우지 않는다 — 그러면 사람이 킷을 걷어낸다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **watchdog** (E) core in **watchdog-lib.mjs** (S) SHALL report the absence of an unbypassable channel whenever no continuous-integration file contains a sweep invocation marker, independently of whether an adoption receipt exists. — capability: **watchdog.attest** (C).
- **FR-002** (event): WHEN an adoption receipt is present, **check-watchdog.mjs** (S) SHALL validate its shape, SHALL report every gate it declares that no longer exists, and SHALL echo the recorded adoption time and kit commit on every run rather than judging staleness against an upstream it cannot see.
- **FR-003** (unwanted): IF no adoption receipt exists at the declared path, THEN the gate SHALL report that adoption is not mechanically attested, warning under advisory and exiting non-zero under hard.
- **FR-004** (ubiquitous): THE installer SHALL create both a continuous-integration workflow invoking the sweep and an adoption receipt as required artefacts, and every gate registered in the sweep SHALL have a test asserting that it blocks, so that a gate whose only observed path is success is accounted as unverified rather than clean.

### Key Entities
- **watchdog** — the enforcement that survives a project choosing to ignore the methodology, as distinct from the gates it runs, so that "we adopted it" is a fact a machine reads rather than a claim a person makes.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: watchdog
- **Symbols**: watchdog-lib.mjs, check-watchdog.mjs
- **Artifacts**: adoption-receipt
- **Capabilities**: watchdog.attest
- **Files**: tooling/watchdog-lib.mjs, tooling/check-watchdog.mjs, tooling/__tests__/watchdog.test.mjs, sdd/adoption.json

## Dependencies (참조 — dedup 제외)
> 설치기·CI 템플릿·카나리아 계약은 SPEC-004 소유, 훅 배선 실재는 SPEC-036, 실행 여부는 SPEC-041, 판정 종류는 SPEC-040, Python 복제는 SPEC-006 소유.
- **Modules**: harness-install (references), hook-wiring (references), verification-run (references), gate-verdict (references)
- **Symbols**: sdd-init.sh

---

## Success Criteria (측정형)
- **SC-001**: `watchdog.test.mjs` 전 케이스 green — 영수증 문법 5종·사라진 게이트·CI 배선(마커 교체 포함)·영수증 경로 계약 + 게이트 6갈래(CI 미배선 차단·영수증 부재·게이트 삭제·통과·advisory 비차단·off). [검증: tooling/__tests__/watchdog.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 카나리아 계약이 스윕 등재 게이트 전부의 차단 증명을 요구하며, 도입 즉시 자기 사각을 잡았다 — 새로 만든 감시자 게이트 자신이 차단 증명 없이 등재된 것을 첫 실행에서 지목했다. [검증: tooling/__tests__/ship-closure.test.mjs]
- **SC-004**: 빈 저장소에 설치기를 돌리면 CI 워크플로와 채택 영수증이 생기고 감시자 게이트가 통과한다. [검증: tooling/__tests__/init-gates.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 파일 읽기·글롭 순회는 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/watchdog.test.mjs]

## Assumptions / Clarifications Retained
- **게이트가 하중을 진다 — 에이전트는 게이트가 호출한다.** 제보의 트리거 소유권 논거를 그대로 받는다: 감시 대상이 에이전트의 판단인데 감시를 에이전트가 불러야 하면, 절차를 건너뛸 때 감시도 같이 건너뛴다. 킷의 확률적 층(SPEC-033 ③·SPEC-038 ②)은 이미 이 구조다 — 어댑터를 **게이트가** 호출하고, 그 판정에는 차단력을 주지 않는다.
- **정적으로 결정 가능한 것은 에이전트에 맡기지 않는다.** 제보가 든 네 가지는 전부 이미 순수 grep이다: 지목 심볼 참조(R1e/SPEC-046)·FR 고유명사 소스 존재(R1c/SPEC-042)·FR 번호 중복(SPEC-014, hard)·소유 파일 안 env 폴백(R1d/SPEC-044).
- **"검사 못 함"을 "통과"로 출력하지 않는다.** 제보의 3분류(clean/could-not-check/violation)는 SPEC-040의 다섯 종류가 더 촘촘하게 구현한다 — `OFF`·`INERT`·`SKIPPED`가 could-not-check를 세 갈래로 가르고, **초록의 자격은 `JUDGED`에만 있다.**
- **기각한 대안:** 킷 버전 파일을 손으로 유지하며 상류와 대조하는 방식. 손으로 유지하는 버전은 드리프트하고(킷이 반복 실측한 결함 계열), 상류 대조는 네트워크를 요구해 오프라인에서 조용히 skipped가 된다. 채택 시점·킷 커밋을 영수증에 남기고 **사람에게 보여주는** 것이 실효 있는 최대치다. 재검토 조건: 소비 프로젝트가 갱신을 잊어 결함을 재발한 실측이 또 나오면 `update.md` 절차에 영수증 갱신을 hard로 묶는다.
- **기각한 대안:** 카나리아를 런타임 실행으로 두는 방식(게이트마다 심어둔 위반 픽스처를 돌려 놓치는지 확인). 22종 × 픽스처는 훅에서 못 돌 무게이고, 무거운 강제는 우회를 낳는다. 차단 단언의 존재를 정적으로 요구하는 것이 값싸고 결정적이다. 재검토 조건: 차단 단언이 있는데도 게이트가 흘린 실측이 나오면 그 게이트에 한해 런타임 카나리아를 붙인다.
- **아직 답하지 않은 것:** 제보의 **실행 관측 회계**(각 FR의 차단 분기가 필드에서 발화한 적 있는가 — 발화 0회면 미검증). SPEC-041의 원장이 자산 단위 실행을 회계하지만 **분기 단위 발화**는 아직 회계하지 않는다. 이 spec의 축이 아니고, 원장 어휘 확장으로 SPEC-041에서 다룰 사안이다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 4종·게이트 e2e 6종·채택 e2e 실측·카나리아 계약 자기적용) + 오너 지시(감시자 필수 생성) + 소비 프로젝트 제보(트리거 소유권·게이트 카나리아) → Active | FR-001~004 unit 커버. 킷 자기적용: CI 배선 1/1·영수증 실재. 카나리아 계약이 도입 즉시 감시자 게이트 자신의 차단 증명 부재를 잡았다(21/22는 이미 있었다) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-036(hook-wiring): 비중복 — 036은 **선언된 훅이 설치됐는가**(로컬 채널), 048은 **우회 불가한 채널이 있는가**(서버 채널) + 채택이 기계적으로 증명되는가다. 036의 채널은 우회 가능하다는 것이 048의 출발점이다.
- 2026-08-10 이웃 SPEC-041(verification-run): 비중복 — 041은 검증 자산이 **돌았는가**, 048은 감시자가 **실재하는가**다. CI가 실제로 돌았는지는 041의 축이다(존재는 실행이 아니다).
- 2026-08-10 이웃 SPEC-004(harness-install): 비중복 — 004는 설치기와 스윕을 **소유**하고, 048은 설치가 남긴 산출물의 실재를 **판정**한다. 카나리아 계약은 004의 계약 테스트 자리에 두되 규범은 048이 정한다.
- 2026-08-10 이웃 SPEC-027(policy-ratchet): 비중복 — 027은 강도의 단조성(정책을 낮추지 못한다), 048은 강제 장치 자체의 실재(장치를 지워도 조용하지 않다)다. 둘 다 "약화 방지"지만 대상이 정책 값 vs 물리적 배선이다.
- 2026-08-10 이웃 SPEC-045(intro-doc): 비중복 — 045는 설명이 도구를 따라잡는가, 048은 도구가 실재하는가다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 엔트리 가드를 공용 `isMainEntry`(realpath 비교)로 교체 | SPEC-047과 같은 결함·같은 근거 — 이 게이트도 문자열 비교로 태어났다. **규범이 세 번 복사되면 네 번째 사본은 규범을 모른다**는 것이 이 라운드의 교훈이고, 그래서 고치는 것으로 끝내지 않고 깨진 형태의 재유입을 계약 테스트로 금지했다(SPEC-040 FR-005) [검증: tooling/__tests__/import-wiring.test.mjs] |
| 2026-08-10 | 초안 — `watchdogPolicy`(off\|advisory\|hard, 기본 advisory)·`watchdogReceipt`·`watchdogCiGlobs`·`sweepInvocationMarkers` + `watchdog-lib`(영수증 문법·사라진 게이트·CI 배선) + `check-watchdog` + 스윕 R17 등재 + `sdd-init.sh`가 CI 워크플로·채택 영수증을 **필수 산출물로** 생성 + 카나리아 계약 테스트 | 오너 실측: **각 프로젝트가 방법론을 무시한다.** 그 무시는 순환 때문에 안 잡힌다 — 무시하면 게이트를 안 돌리고, 그러면 고발 기회가 없다. 순환을 끊는 것은 우회 불가한 채널뿐이고 그건 서버측 CI다(훅은 `--no-verify`로 우회되고 웹 UI 머지는 훅을 안 탄다). 그리고 이 라운드가 그 무시의 대가를 증명했다: 제보 6건 중 5건이 이미 고쳐진 결함이었고, 그 프로젝트는 낡은 킷으로 몇 달을 갔다. 카나리아는 제보의 논거를 그대로 받는다 — **결정적인 것과 옳은 것은 다르다.** 도입 즉시 자기 사각을 잡았다(새 감시자 게이트 자신이 차단 증명 없이 등재돼 있었다). 범위: CI 판정은 저장소 안 CI 파일의 스윕 마커 등장까지이며, 그 워크플로가 실제로 돌았는지는 SPEC-041의 축이다 [검증: tooling/__tests__/watchdog.test.mjs] |
