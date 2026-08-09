# Feature Specification: Gate Verdict Type (안 본 것은 통과가 아니다 — 판정을 산문에서 타입으로)

**Module**: `sdd-tooling`  **Spec**: `SPEC-040`  **Created**: 2026-08-09  **Status**: Active
**Input**: 킷 자기적용 실측(2026-08-09) — 스윕이 `● R7 Engines·Events: ✓ clean` 아래에 `engineRealityPolicy·eventAttributionPolicy 모두 off (판정 안 함)`을 찍고 있었다. 게이트는 "안 봤다"고 말했는데 집계기는 초록으로 분류했다. 원인은 어휘가 아니라 **반환 형태**다: 게이트가 산문을 내고 집계기가 `/[⚠✗]/` 문자열 스캔으로 추측했다. 그래서 `update.md` §7이 보고를 "판정 M종 · 명시적 off/no-op/inert K종 · 미판정 0종"으로 적으라고 **강제하는데 하네스 자신은 off를 clean에 합산**하고 있었다 — 규범과 도구가 같은 사실을 다르게 말하는 상태. 동반 실측(소비 프로젝트 제보 2026-08-10): 검증 러너가 대상 0건으로 exit 0 종료해 "성공"과 "아무것도 안 함"이 구분되지 않았고, 배포 훅 Job이 전제 자원 부재로 한 번도 뜨지 않았는데 파이프라인은 초록이었다. 같은 결함의 세 얼굴이다.

---

## User Scenarios & Testing

### User Story 1 — 게이트가 무엇을 했는지 타입으로 말한다 (P1)
"위반 0건"과 "볼 것이 없었음"과 "정책이 꺼져 있음"은 **다른 사실**인데 셋 다 exit 0에 초록 문장이었다. 게이트는 자기 판정의 종류를 선언하고, 집계기는 그것을 읽기만 한다. 선언하지 않으면 미판정으로 자백된다 — 침묵도 초록도 아니다.
- **Independent Test**: `verdict.test.mjs`가 순수 코어(종류 집합·왕복·모르는 토큰 처리·마지막 우선·요약 분리)와 방출기(미선언 자백·비정상 종료 경로·파이프 유실 없음·중복 금지)를 단독 검증. [검증: tooling/__tests__/verdict.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a gate whose policy is off, **When** the sweep aggregates it, **Then** the rule is rendered as not-looked-at rather than clean.

### User Story 2 — 초록의 분모를 같은 줄에서 밝힌다 (P1)
"전부 sync ✓"만 읽고 12종이 off인 것을 모르는 상태가 이 계열의 원래 결함이다. 요약은 **항상** 게이트 단위 집계를 낸다 — clean일 때도. 이로써 `update.md` §7의 보고 형식이 사람 눈대중이 아니라 계산이 된다.
- **Independent Test**: 같은 테스트가 집계 함수의 다섯 갈래 분류와 요약 한 줄의 형태를 검증. [검증: tooling/__tests__/verdict-contract.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a sweep where some gates are off and none violate, **When** the summary prints, **Then** it states how many judged and how many were not looked at.

### User Story 3 — "0건"이 무엇의 0건인지 밝힌다 (P1)
킷 기본값은 **킷의 언어**다. Python·Terraform 프로젝트가 구현 중복 게이트를 켜면 기본 정규식이 아무 파일도 잡지 못해 "중복 0건"을 보고하는데, 그 0은 진짜 0과 구분되지 않는다. 언어를 선언하지 않은 채 일부만 본 상태는 판정이 아니다.
- **Independent Test**: 같은 테스트가 대상 0개·언어 미선언 부분 판정·선언 후 정상 판정 세 갈래를 검증. [검증: tooling/__tests__/verdict-contract.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a repository whose sources are not covered by the declared file pattern, **When** the duplicate-logic gate runs, **Then** it reports which extensions it did not look at instead of reporting zero findings.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **종류는 다섯 개뿐이고 늘리지 않는다** — 늘리면 "이건 어디에 넣지"가 생기고 그 자리가 곧 예외다. 새 상황은 반드시 다섯 중 하나로 분류된다.
- **정책 off와 판정 입력 없음을 가른다** — 둘 다 "안 봄"이지만 해소가 다르다(켜면 됨 vs 입력을 만들어야 함). 한 상태로 묶으면 "켰으니 됐다"가 성립해버린다(실측 위반: hard 선언 + 무판정 = 거짓 안전).
- **위반은 판정 안에서만 성립한다** — 안 본 게이트는 위반을 낼 수 없고, 그것이 안 본 것이 위험한 이유다.
- **strict가 막는 것은 위반과 미판정뿐이다** — off·inert·생략은 막지 않되 초록에 합산하지도 않는다. 채택 중인 프로젝트를 벽으로 막지 않으면서 "안 봤다"는 사실은 매 실행 계상된다.
- **훅 편의 계층은 계약을 좁힌다, 면제받지 않는다** — PreToolUse처럼 매 명령에 붙는 층은 발동 조건이 아니면 침묵이 계약이다(매번 한 줄이면 소음이 되고, 소음이 되면 사람이 훅을 끈다). 규칙은 **"말을 했으면 무엇을 했는지도 말한다"**로 좁아지고, 스윕에 집계되는 게이트는 이 좁힘을 쓸 수 없다.
- **방출은 동기 쓰기여야 한다** — stdout이 파이프일 때 Node·Python의 버퍼 쓰기는 종료 훅에서 유실될 수 있고, 유실은 곧 미판정 오분류다.
- **생성기·리팩터 도구는 판정 게이트가 아니다** — 산출이 일이므로 생략으로 계상한다. 초록에 섞이면 판정한 게이트 수가 부풀려진다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE any gate runs, the **gate-verdict** (E) core in **verdict-lib.mjs** (S) SHALL emit exactly one verdict line naming one of five kinds — judged, off, inert, skipped, untyped — on every termination path including forced exit, using a synchronous write so that a piped consumer cannot lose it. — capability: **gate-verdict.emit** (C).
- **FR-002** (unwanted): IF a gate terminates without declaring a kind, THEN the emitter SHALL declare it untyped and the aggregator SHALL treat it as unjudged rather than passing, EXCEPT WHERE the gate is a hook-convenience layer that produced no output at all, in which case silence is the declared contract.
- **FR-003** (event): WHEN **sdd-sync.mjs** (S) aggregates gates, it SHALL classify each by the declared kind rather than by scanning prose, SHALL render three rule states — judged, not-looked-at, violating — and SHALL always print a gate-level tally naming how many judged, how many were not looked at with the reason class, and how many were unjudged. — capability: **gate-verdict.account** (C).
- **FR-004** (unwanted): IF a gate's judging inputs are absent — no target files, no declared sources, no manifest, no command, or a language pattern that leaves repository sources unexamined — THEN the gate SHALL declare itself inert naming the missing input, and SHALL NOT report a zero count as a clean judgment.

### Key Entities
- **gate-verdict** — the kind of a gate's outcome as a value the aggregator reads, as distinct from the sentence the gate prints for a human, so that "nothing was examined" cannot be rendered as "nothing was wrong".

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: gate-verdict
- **Symbols**: verdict-lib.mjs
- **Artifacts**: —
- **Capabilities**: gate-verdict.emit, gate-verdict.account
- **Files**: tooling/verdict-lib.mjs, tooling/__tests__/verdict.test.mjs, tooling/__tests__/verdict-contract.test.mjs

## Dependencies (참조 — dedup 제외)
> 집계기(`sdd-sync`)는 SPEC-004 소유, 개별 게이트의 판정 내용은 각 소유 스펙, Python 복제는 SPEC-006 소유 — 이 spec은 판정의 **형태**만 담당한다.
- **Modules**: harness-install (references), runtime-parity (references), duplicate-logic (references), spec-quality-gates (references)
- **Symbols**: sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `verdict.test.mjs` 전 케이스 green — 종류 집합 고정·초록 자격·왕복·모르는 토큰 강등·마지막 우선·요약 분리·미선언 자백·강제 종료 경로·파이프 무유실·중복 금지. [검증: tooling/__tests__/verdict.test.mjs]
- **SC-002**: 킷 자기적용 스윕에서 정책이 off인 규칙이 `✓ clean`으로 렌더되지 않는다 — 실측 재현(R7 Engines·Events, R9 라이브 대조). [검증: tooling/__tests__/verdict-contract.test.mjs]
- **SC-003**: 스윕에 등재된 게이트 전부가 판정 종류를 선언한다(미판정 0종) — 규칙표와 배선을 기계 대조. [검증: tooling/__tests__/verdict-contract.test.mjs]
- **SC-004**: 게이트 판정 줄이 Node↔Python 바이트 동일하다 — 양판이 같은 종류·같은 사유를 말한다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 포맷·파싱만의 순수 함수이고 방출만 부수효과를 가지므로, 저장소·게이트 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/verdict.test.mjs]
- **NFR-002**: 종류 토큰은 영문 대문자로 고정하고 사유만 프로젝트 언어로 적으므로, 출력 문구를 번역해도 집계 파싱이 깨지지 않는다. [검증: tooling/__tests__/verdict.test.mjs]

## Assumptions / Clarifications Retained
- 판정의 **내용**은 이 spec의 관심이 아니다 — 무엇을 위반으로 볼지는 각 게이트의 소유 스펙이 정하고, 이 spec은 그 결과를 담는 형태만 정한다.
- inert를 **차단하지 않는** 이유: 채택 중인 프로젝트는 소스·매니페스트·역할을 아직 안 갖췄고, 그 상태를 벽으로 막으면 사람이 정책을 끈다(킷 규범: 우회를 유발하는 강제는 강제가 아니다). 대신 매 실행 집계에 남아 조용히 사라지지 않는다.
- **기각한 대안:** 집계기가 게이트 출력 어휘를 더 정교하게 스캔하는 방식(`판정 안 함`·`no-op`·`inert` 문구 목록화). 어휘 목록은 새 게이트가 새 표현을 쓰는 순간 조용히 틀리고, 그 실패는 초록으로 나타난다 — 지금 고치는 결함과 같은 종류다. 재검토 조건: 없음(추측을 계약으로 대체하는 것이 이 spec의 목적이다).
- **기각한 대안:** 판정 줄을 stderr나 별도 파일로 보내 사람 출력에서 감추는 방식. 사람이 읽는 것과 기계가 읽는 것이 갈라지면 둘이 어긋나도 아무도 모른다 — 이 spec이 고치는 결함이 정확히 그 어긋남이다. 재검토 조건: 판정 줄이 소음이라는 실측이 나오면 렌더 층에서 접되 stdout 계약은 유지한다.
- **기각한 대안:** 킷 기본 언어 패턴(JS/TS)을 제거하고 선언을 필수로 만드는 방식. 기존 JS 프로젝트가 전부 inert로 떨어져 채택이 후퇴한다. 대신 기본값에 기대는 동안 **무엇을 안 봤는지 매 실행 말하게** 했다. 재검토 조건: 언어 선언율이 충분히 높아지면 기본값을 제거하고 선언 필수로 승격한다.
- **미해결(다음 라운드):** 소비 프로젝트 제보 2026-08-10의 ①(에이전트가 검증을 중도 포기했는데 산출물이 없다)과 ③(비차단 CI 스테이지가 전제 자원 부재로 안 떴는데 초록)은 이 spec이 만든 타입 위에서 판정해야 한다 — 포기는 생략(사유 필수), 미실행 스테이지는 판정 입력 없음이다. 게이트 신설은 별도 스펙으로 이어간다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-09 | 셀프리뷰(순수 코어 TDD·게이트 26종 배선·Python 21종 미러·양판 바이트 패리티·킷 자기적용 실측 재현) + 소비 프로젝트 개선 요청(조용한 종료/포기를 게이트가 못 잡음) → Active | FR-001~004 unit 커버. 킷 자기적용: 미판정 18종 → 0종, off 2·inert 1이 초록에서 분리됨 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-09 이웃 SPEC-004(harness-install): 비중복 — 004는 스윕이 **무엇을 언제 돌리는가**(규칙표·시간 예산·위임), 이 spec은 돌린 결과를 **어떤 형태로 받는가**다. 실행 오케스트레이션 vs 반환 계약이다.
- 2026-08-09 이웃 SPEC-028(ownership-map): 비중복 — 028은 **소유 키별**로 어느 가드가 발화하지 않는지를 표로 보이고, 이 spec은 **게이트 실행 단위**로 무엇을 했는지를 타입으로 말한다. 축이 키 vs 실행이라 둘은 서로의 입력이 아니다.
- 2026-08-09 이웃 SPEC-032(live-reality): 비중복 — 032는 `skipped(사유)`를 **한 게이트 안에서** 도입한 선례이고, 이 spec은 그 개념을 전 게이트의 반환 타입으로 일반화한다. 특수 사례 vs 공통 계약이다.
- 2026-08-09 이웃 SPEC-038(duplicate-logic): 비중복 — 038은 같은 규칙이 두 곳에 구현된 것을 찾고, 이 spec은 그 게이트가 **아무것도 안 보고 0건을 냈는지**를 밝힌다. 판정 내용 vs 판정 성립 여부다.
- 2026-08-09 이웃 SPEC-031(execution-evidence): 비중복 — 031은 스펙의 주장이 실행 가능한 증거를 지목하는지(문서 축), 이 spec은 게이트가 실제로 판정했는지(실행 축)다. 둘 다 "주장 vs 실재"지만 대상이 스펙 문장 vs 게이트 실행이다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-09 | 초안 — 판정 타입 5종(`verdict-lib`) + `armVerdict` 종료 훅 방출(동기 쓰기) + `gateOutcome` 타입 우선 전환 + 스윕 3상태 렌더·집계 한 줄 + 게이트 26종·Python 21종 배선 + 언어 미선언 부분 판정의 inert 승격 | 킷 자기적용 실측: 스윕이 `판정 안 함`이라 적힌 줄을 `✓ clean`으로 분류했다 — 게이트가 산문을 내고 집계기가 문자열로 추측한 결과다. `update.md` §7은 off를 clean에서 떼라고 강제하는데 하네스 자신이 합치고 있었으므로 **규범과 도구가 어긋난 상태**였고, 모르는 사람은 초록 줄 수만큼 검증됐다고 읽는다. 고칠 것은 어휘가 아니라 반환 타입이다. 배선 직후 킷 자기적용에서 미판정 18종이 드러났고(전부 배선 누락) 0종으로 수렴, off 2·inert 1이 초록에서 분리됐다 [검증: tooling/__tests__/verdict-contract.test.mjs] |
