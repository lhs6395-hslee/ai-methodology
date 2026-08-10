# Feature Specification: Branch Observation (차단 분기가 필드에서 발화한 적이 있는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-049`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10, 사례 6) — QA 러너(SDD로 만든 검증 도구)에 "로컬·개발 판정이 일치할 때만 전이한다"는 규칙이 있었고 **명세·구현·단위테스트가 모두 정상**이었다(`상대 기록 불일치 → 마감 금지 ✓`, `상대 기록 일치 → 마감 허용 ✓`). 그런데 판정 기록의 저장 위치가 로컬은 작업 디렉터리, 클러스터 Job은 볼륨 없는 파드의 `/tmp`였다 — 두 기록이 만날 저장소가 아예 없었으므로 **그 교차검증은 단 한 번도 비교를 수행한 적이 없다.** 소유자 결정으로 도입된 규칙이 몇 달간 명세에만 존재했다. 결함은 **배선**에 있었고 코드를 읽는 어떤 검증기도 "정상"이라 답했을 것이다 — 정적 검사로는 원리상 잡히지 않는다. 그런데 증거는 이미 매 실행 로그에 있었다: `교차검증: 상대 환경 판정 기록 없음 — 대조 생략`. "생략"이 통과처럼 읽혔고, **그 값이 몇 달간 한 번도 달라지지 않았다는 사실**을 신호로 읽는 장치만 없었다. 제보의 요청: 각 FR의 차단 분기가 필드에서 발화한 적이 있는가 — 발화 0회면 "검증되지 않음"으로 회계하라.

---

## User Scenarios & Testing

### User Story 1 — 발화 0회인 차단 분기는 검증되지 않았다 (P1)
차단 분기가 돌았다는 사실은 그 분기만 안다. 원장에 발화 기록이 없으면 그 분기는 "한 번도 막은 적이 없다"는 뜻이고, 그 상태는 통과가 아니라 미검증이다.
- **Independent Test**: `verification-run.test.mjs`의 SPEC-049 절이 순수 코어(종류 분리·어휘 문법·세 갈래 분류·1회 예외·미선언 키·사유 필수·왕복)와 계측 계약을 단독 검증. [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a declared blocking branch with records but no FIRED outcome, **When** the gate runs, **Then** it accounts the branch as never-fired.

### User Story 2 — 세 사실은 해소 방법이 다르므로 따로 회계한다 (P1)
**미관측**(기록 0건)은 배선이 없는 것이고, **발화 0회**는 배선은 있는데 경로가 안 돈 것이며, **단조**(사유가 한 종류뿐)는 값이 한 번도 달라지지 않은 것이다. 셋을 한 갈래로 묶으면 사람이 무엇을 고쳐야 할지 모른다 — 제보의 결함은 그중 **단조**의 모양이었다("대조 생략"이 몇 달간 그대로였다).
- **Independent Test**: 같은 테스트가 네 종류(observed·unobserved·never-fired·monotone)를 각각 분류함을 검증. [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** two or more records whose detail never varies, **When** the gate runs, **Then** it reports the branch as monotone.

### User Story 3 — 한 원장에 두 종류가 살고 서로를 깨진 기록으로 오인하지 않는다 (P1)
자산 기록(SPEC-041)과 분기 발화 기록은 다른 사실이지만 같은 원장에 산다 — 원장이 둘이면 한쪽만 갱신돼 두 회계가 갈라진다. 그래서 각 파서는 상대 종류를 **조용히 건너뛴다**.
- **Independent Test**: 같은 테스트가 자산 기록이 분기 파서의 대상이 아니고 분기 기록이 자산 축의 깨진 기록이 아님을 양방향으로 검증. [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a branch record in the ledger, **When** the asset axis parses it, **Then** it is skipped rather than counted as malformed.

### User Story 4 — 계측 자리를 흩으면 하나를 빠뜨린다 (P1)
게이트의 차단 출구는 여럿이다. 하나만 계측하면 다른 경로로 막힐 때 발화가 기록되지 않고, 그러면 "한 번도 안 돌았다"로 **오회계**된다. 실측: 처음엔 spec-first 출구 하나만 계측했더니 unowned 차단 경로가 기록 없이 지나갔다 — 제보가 지적한 결함 계열과 같은 모양이다.
- **Independent Test**: 계약 테스트가 그 게이트의 모든 차단 `exit(1)` 직전에 계측이 있는지 정적으로 검사한다(config 문법 위반 출구는 제외 — 그건 판정을 시작조차 못 한 상태다). [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a blocking exit without an instrumentation call, **When** the contract test runs, **Then** it fails naming the line.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **`blockingBranches` 미선언은 판정하지 않는다** — 차단 분기가 없는 프로젝트에 분기를 요구하면 거짓 요구다.
- **사유 없는 선언은 무언의 선언이다** — 무엇을 막는 분기인지 모르면 판정 근거가 못 된다.
- **어떤 강도에서도 차단하지 않는다** — 원장은 세션·CI 로컬 상태라 신선한 체크아웃에서 비어 있는 것이 정상이고(SPEC-041), 그 상태를 벽으로 막으면 사람이 정책을 통째로 끈다. 매 실행 **부채로 표면화**한다 — 이 결함이 몇 달을 살아남은 이유가 정확히 "표면화되지 않음"이었다.
- **1회 기록은 단조가 아니다** — 변할 기회가 없었던 것을 고발하지 않는다(2회 이상에서만 신호로 읽는다).
- **선언되지 않은 키로 기록된 것은 표면화한다** — 낡은 러너이거나 오타다. 조용히 버리면 그 기록은 없는 것과 같다.
- **config 문법 위반 출구는 차단 분기가 아니다** — 그건 게이트가 판정을 시작조차 못 한 상태이고(SPEC-040의 계열), 발화로 기록하면 원장이 "규칙이 돌았다"는 거짓을 담는다.
- **기록이 참인지는 판정하지 않는다** — 분기가 "FIRED"라고 적었는데 실제로 안 돌았다면 그건 그 분기의 거짓말이다(존재는 기계, 진실성은 리뷰 — SPEC-041과 같은 경계).
- **원장은 커밋하지 않는다** — 세션·CI 로컬 상태다. 채택 영수증(SPEC-048)은 반대로 커밋한다. **두 사실은 다르다.**

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a ledger line names a branch, the **branch-observation** (E) core in **branch-observation-lib.mjs** (S) SHALL parse it as a branch record accepting only the declared outcome vocabulary, and SHALL skip lines naming an asset instead so that the two record kinds never read each other as malformed. — capability: **branch-observation.account** (C).
- **FR-002** (event): WHEN blocking branches are declared, **check-verification-executed.mjs** (S) SHALL classify each as observed, unobserved, never-fired, or monotone — treating two or more records sharing a single detail as monotone — and SHALL surface every non-observed class on every run without blocking at any strength.
- **FR-003** (unwanted): IF a branch record names a key that was not declared, THEN the gate SHALL surface it rather than discarding it; IF a declaration carries no reason, THEN the gate SHALL report the declaration as silent.
- **FR-004** (event): WHEN a gate blocks, it SHALL record that firing through the recorder, and a contract test SHALL fail if any blocking exit of an instrumented gate lacks that call so that a branch cannot be mis-accounted as never having run.

### Key Entities
- **branch-observation** — the fact that a refusal path actually fired in the field, as distinct from that path existing and being unit-tested, so that a rule wired to nothing cannot pass for a rule that works.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: branch-observation
- **Symbols**: branch-observation-lib.mjs
- **Artifacts**: —
- **Capabilities**: branch-observation.account
- **Files**: tooling/branch-observation-lib.mjs

## Dependencies (참조 — dedup 제외)
> 원장·기록기·게이트는 SPEC-041 소유(같은 원장에 두 종류가 산다), 판정 종류 어휘는 SPEC-040, 계측된 차단 분기는 SPEC-003의 게이트, Python 복제는 SPEC-006 소유.
- **Modules**: verification-run (references), gate-verdict (references), spec-sync (references)
- **Symbols**: check-verification-executed.mjs

---

## Success Criteria (측정형)
- **SC-001**: `verification-run.test.mjs`의 SPEC-049 절 전 케이스 green — 종류 분리(양방향)·어휘 문법·세 갈래 분류·1회 예외·미선언 키·사유 필수·왕복·계측 계약. [검증: tooling/__tests__/verification-run.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 차단 분기 1종(`spec-sync#spec-first`)이 선언되고, 그 분기의 네 차단 출구 전부가 계측돼 실제 차단 시 발화가 원장에 남는다 — 실측으로 확인. [검증: tooling/__tests__/verification-run.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 원장 읽기·기록·시각 획득은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/verification-run.test.mjs]

## Assumptions / Clarifications Retained
- 이 축이 답하는 것은 제보가 "정적 검사로는 원리상 잡히지 않는다"고 지적한 층이다 — 배선 결함은 코드를 읽어서는 보이지 않고, **실행이 남긴 흔적의 불변성**으로만 보인다.
- **기각한 대안:** 발화 0회를 차단하는 방식. 원장은 세션 상태라 신선한 체크아웃·새 CI 러너에서 항상 0건이고, 그 상태를 막으면 사람이 정책을 통째로 끈다(SPEC-041이 기록 신선도를 거부한 것과 같은 이유). 재검토 조건: 원장을 영속 저장소에 두는 프로젝트가 나오면 그 사이트에서만 hard를 검토한다.
- **기각한 대안:** 분기를 코드에서 자동 발견하는 방식(`if … return false` 같은 거부 경로를 정적으로 추출). 무엇이 "차단 분기"인지는 의미 판정이고, 자동 추출은 모든 early-return을 잡아 오탐이 폭주한다. 선언은 책임지는 행위다. 재검토 조건: 없음.
- **기각한 대안:** 원장을 자산용·분기용 둘로 나누는 방식. 원장이 둘이면 한쪽만 갱신돼 두 회계가 갈라진다 — 같은 파일에 두 종류를 담고 파서가 서로를 건너뛰는 것이 설계다. 재검토 조건: 없음.
- **기각한 대안:** 계측을 게이트마다 한 곳(요약 지점)에만 두는 방식. 차단 출구가 흩어져 있어 한 곳 계측은 다른 경로를 빠뜨린다(실측으로 즉시 재현됐다). 모든 출구를 계측하고 그 사실을 **계약 테스트로** 고정한다 — 규범으로 두 번 이상 실패한 것은 기계가 잡는다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 7종 + 계측 계약·킷 자기적용 배선 실측·양판 패리티) + 소비 프로젝트 개선 요청(사례 6 — 검증 도구의 결함은 통과로 나타난다) → Active | FR-001~004 unit 커버. 킷 자기적용: `spec-sync#spec-first` 선언 + 네 차단 출구 계측, unowned 차단 시 발화 기록 실측 확인 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-041(verification-run): 비중복 — 041은 **자산**이 돌았는가(파일 단위 실행), 049는 **분기**가 발화했는가(조건 단위 발화)다. 같은 원장에 두 종류가 살고 049의 게이트 배선은 041이 소유한다 — 원장을 나누지 않는 것이 설계다.
- 2026-08-10 이웃 SPEC-048(watchdog): 비중복 — 048은 감시자가 **실재하는가**(장치의 존재), 049는 그 장치의 차단 경로가 **돌았는가**(장치의 작동)다. 048의 카나리아는 차단 능력을 테스트로 증명하고, 049는 그것이 **필드에서** 발화했는지를 회계한다 — 테스트 통과는 필드 발화가 아니다.
- 2026-08-10 이웃 SPEC-047(process-ssot): 비중복 — 047은 비교 단계가 기록이 만날 **저장소를 선언**했는가, 049는 그 비교가 **실제로 발화했는가**다. 제보 사례 6은 둘이 함께 필요했던 자리다(저장소가 없었고, 없다는 사실이 표면화되지 않았다).
- 2026-08-10 이웃 SPEC-040(gate-verdict): 비중복 — 040은 게이트가 자기 판정 종류를 선언하는 어휘, 049는 차단 분기의 발화 어휘(FIRED·PASSED·SKIPPED)다. 대상이 게이트 vs 분기이고 어휘도 다르다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `blockingBranches`(사유 필수 선언) + `branch-observation-lib`(종류 분리 파싱·네 갈래 분류·미선언 키·사유 검증·기록기) + `check-verification-executed`에 `--record-branch` 기록 모드와 회계 축 배선 + `check-spec-sync`의 차단 출구 4곳 계측 + 계측 계약 테스트, 양판 | 제보 사례 6: 검증 도구의 결함은 실패가 아니라 **통과**로 나타난다. 명세·구현·단위테스트가 모두 정상인데 두 기록이 만날 저장소가 없어 비교가 단 한 번도 수행되지 않았고, 증거는 매 실행 로그의 같은 한 줄이었다 — 그 값이 달라지지 않은 사실을 읽는 장치만 없었다. 발화 0회를 차단하지 않는 이유: 원장은 세션 상태라 신선한 체크아웃에서 항상 0건이고 그걸 막으면 정책이 꺼진다. 계측을 한 곳에만 두는 길은 실측으로 즉시 반증됐다(spec-first 출구만 계측했더니 unowned 차단이 기록 없이 지나갔다) — 모든 출구를 계측하고 계약 테스트로 고정했다. 범위: 이 회계는 원장이 선언된 사이트에서만 성립하며, 원장 미선언·`blockingBranches` 미선언은 판정하지 않는다고 명시 출력한다 [검증: tooling/__tests__/verification-run.test.mjs] |
