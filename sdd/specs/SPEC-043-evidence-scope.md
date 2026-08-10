# Feature Specification: Evidence Scope (관측은 그 관측이 이루어진 범위까지만 참이다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-043`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10) — 리눅스 1대(X 서버 없음)에서 한 번 관측한 사실이 보편 규칙(`DISPLAY`도 `WAYLAND_DISPLAY`도 없으면 헤드리스)으로 그대로 승격됐다. macOS·WSLg·원격 X 전달 환경에서는 틀린 규칙인데, 근거 줄은 "실측"이라고만 적혀 있어 그 규칙이 **어디서** 참인지 아무도 되짚을 수 없었다. 모든 게이트는 초록이었다 — 근거 칸이 비지 않았으니까(선제 캡처는 근거의 **존재**만 본다). 제보의 물음: 단일 환경 실측이 보편 규칙으로 승격되는 것을 막는 장치가 방법론에 있는가.

---

## User Scenarios & Testing

### User Story 1 — 환경을 지목한 관측은 그 결론이 참인 범위를 밝힌다 (P1)
근거가 "리눅스에서 실측했다"고 말하면, 그 관측에서 끌어낸 결론이 어디까지 참인지를 같은 자리에서 밝혀야 한다. 밝히지 않으면 1대에서 본 것이 보편 규칙으로 올라갔는지 되짚을 축이 없다.
- **Independent Test**: `evidence-scope.test.mjs`가 순수 코어(환경 지목 관측 표면화·범위 표기 통과·라벨만 있는 공백 거부·행 선별·어휘 교체)를 단독 검증. [검증: tooling/__tests__/evidence-scope.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a Change Log rationale that claims an observation and names a specific environment, **When** it declares no scope label, **Then** the gate surfaces it.

### User Story 2 — 방아쇠는 관측과 환경 지목의 곱이다 (P1)
"관측을 주장했다"만으로 방아쇠를 당기면 설계 판단·제보 인용·정합성 정리까지 전부 걸린다(킷 실측: 77건/26스펙). 매 실행 77줄이 쏟아지면 본 신호가 묻히고 사람이 정책을 끈다. 환경을 지목한 관측만 보면 킷에서 2건이고, 그 2건이 정확히 위험한 모양이다.
- **Independent Test**: 같은 테스트가 환경을 지목하지 않은 관측 근거가 대상이 아님을 검증. [검증: tooling/__tests__/evidence-scope.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a rationale that claims an observation without naming an environment, **When** the gate runs, **Then** it is not reported.

### User Story 3 — 해소는 표기이지 정책 하향이 아니다 (P2)
걸린 근거의 정당한 해소는 딱 하나, 범위를 적는 것이다. 범위를 적으면 그 다음(범위가 충분한가·규칙이 과잉 일반화인가)은 리뷰가 판단할 축을 갖는다.
- **Independent Test**: 같은 테스트가 범위 표기 전후로 판정이 갈리는 것과, 라벨만 적고 내용을 비우면 표기로 인정되지 않는 것을 검증. [검증: tooling/__tests__/evidence-scope.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a rationale carrying a scope label with content, **When** the gate runs, **Then** it passes.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **근거 칸이 비면 이 축은 판정하지 않는다** — 공백은 선제 캡처(SPEC-009)의 사실이다. 한 결함을 두 게이트가 각자 고발하면 사람은 두 번 고친다.
- **행 선별은 선제 캡처의 정본을 소비한다**(실제 날짜 행만, 플레이스홀더·헤더·구분선 제외) — 처음엔 복제했다가 R13 구현 중복이 즉시 잡았다. 두 축이 서로 다른 "행"을 보면 어느 쪽을 고쳐야 할지 모른다.
- **라벨만 있고 내용이 비면 표기가 아니다** — 라벨은 약속이지 이행이 아니다.
- **범위의 내용이 옳은지는 판정하지 않는다** — 존재는 기계, 질은 리뷰.
- **EARS 문장에 범위 한정자를 강제하지 않는다** — 문법을 건드리면 이미 쓰인 수백 개 요구가 한꺼번에 위반이 되고, 그 규모의 강제는 우회를 낳는다. 범위는 **주장한 자리**에서 요구한다.
- 마커·라벨·환경 목록은 프로젝트가 갈아끼운다 — 어휘 교체이지 면제가 아니다(교체해도 축은 계속 판정한다).
- 기본 `advisory`. `hard` 승급 시 `--strict` 없이도 그 항목만 차단한다(정책 승급이 실효를 못 가지면 승급 선언이 거짓이 된다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a dated Change Log row carries a non-empty rationale, the **evidence-scope** (E) core in **evidence-scope-lib.mjs** (S) SHALL report it only if the rationale both claims an observation and names a specific environment while declaring no scope label. — capability: **evidence-scope.qualify** (C).
- **FR-002** (unwanted): IF such a rationale declares no scope label, THEN **check-spec-completeness.mjs** (S) SHALL surface it with the named environments, warning under advisory and exiting non-zero under hard even without strict mode.
- **FR-003** (state): WHILE a scope label carries content, THE SYSTEM SHALL treat the scope as declared and SHALL NOT judge whether that scope is correct; WHERE the rationale cell is empty or no Change Log section exists, THE SYSTEM SHALL make no judgement on this axis.

### Key Entities
- **evidence-scope** — the range within which an observed conclusion is claimed to hold, as distinct from the observation itself, so that one machine's behaviour cannot silently become a universal rule.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: evidence-scope
- **Symbols**: evidence-scope-lib.mjs
- **Artifacts**: —
- **Capabilities**: evidence-scope.qualify
- **Files**: tooling/evidence-scope-lib.mjs, tooling/__tests__/evidence-scope.test.mjs

## Dependencies (참조 — dedup 제외)
> Change Log 실기록 행 선별과 근거 칸 강제는 SPEC-009(derivation-accounting)의 정본을 **소비**한다(복제하면 두 축이 다른 행을 본다), 마커 매칭은 SPEC-031, Python 복제는 SPEC-006 소유.
- **Modules**: derivation-accounting (references), execution-evidence (references)
- **Symbols**: check-spec-completeness.mjs

---

## Success Criteria (측정형)
- **SC-001**: `evidence-scope.test.mjs` 전 케이스 green — 실측 재현·범위 표기 통과·환경 미지목 제외·근거 공백 무판정·플레이스홀더 제외·Change Log 부재 무판정·라벨 공백 거부·어휘 교체. [검증: tooling/__tests__/evidence-scope.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 방아쇠 좁힘의 효과가 실측으로 확인된다 — 관측 주장만으로는 77건, 환경 지목의 곱으로는 2건. [검증: tooling/__tests__/evidence-scope.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 대조만의 순수 함수이고 파일 읽기는 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/evidence-scope.test.mjs]

## Assumptions / Clarifications Retained
- 범위가 **충분한지**는 판정하지 않는다 — "리눅스 CI 러너 한정"이라고 적은 근거가 실제로 그 범위에서만 규칙을 적용했는지는 리뷰의 몫이다. 이 축은 되짚을 축을 만들 뿐이다.
- **기각한 대안:** EARS 문장에 범위 한정자(`WHERE the platform is …`)를 강제하는 방식. 이미 쓰인 요구 전부가 한꺼번에 문법 위반이 되고, 그 규모의 강제는 우회를 낳는다("우회를 유발하는 강제는 강제가 아니다"). 재검토 조건: 없음.
- **기각한 대안:** 관측 주장만으로 방아쇠를 당기는 방식. 킷 실측 77건/26스펙 — 대부분이 환경 무관 근거라 매 실행 77줄이 쏟아지고, 오탐이 잦은 게이트는 꺼진다. 재검토 조건: 환경을 지목하지 않은 채 보편 규칙으로 승격된 실측이 나오면 마커를 넓힌다.
- **기각한 대안:** 관측을 실제로 여러 환경에서 재현했는지 검사하는 방식. 킷은 실행 주체가 아니다(SPEC-021이 세운 경계) — 재현 여부는 SPEC-041의 실행 원장이 회계할 축이고, 이 spec은 **주장의 범위 표기**만 본다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 8종·킷 자기적용 방아쇠 폭 실측 비교) + 소비 프로젝트 개선 요청(단일 환경 실측의 보편 규칙 승격) → Active | FR-001~003 unit 커버. 킷 자기적용: 환경 지목 관측 2건 표면화 → 범위 표기로 해소 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-009(derivation-capture): 비중복 — 009는 근거가 **있는가**(선제 캡처), 043은 그 근거가 관측을 주장할 때 **어디까지 참인가**다. 043은 009가 만든 칸을 대상으로 삼되 같은 결함을 두 번 고발하지 않는다(공백은 009의 사실).
- 2026-08-10 이웃 SPEC-041(verification-run): 비중복 — 041은 검증이 **돌았는가**(실행 회계), 043은 관측 결론의 **적용범위 표기**다. 여러 환경에서 재현했는지는 041의 원장이 볼 축이다.
- 2026-08-10 이웃 SPEC-016(object-storage): 비중복 — 두 축 모두 "마커가 걸리면 특정 표기를 요구한다"는 형태를 쓰지만 016은 스토리지 결정 기록, 043은 관측 범위다. 형태의 재사용은 설계 의도다.
- 2026-08-10 이웃 SPEC-031(execution-evidence): 비중복 — 031은 증거 경로의 등급, 043은 근거 산문의 범위 표기다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `evidenceScopePolicy`(off\|advisory\|hard, 기본 advisory) + `observationMarkers`·`evidenceScopeLabels`·`environmentMarkers` + `evidence-scope-lib` + `check-spec-completeness` 배선(hard 승급 시 `--strict` 없이 차단) | 소비 프로젝트 제보: 단일 환경 관측이 보편 규칙으로 승격됐는데 근거 칸이 비지 않아 모든 게이트가 초록이었다. EARS 문법 강제는 기존 요구 전부를 한꺼번에 위반으로 만들어 우회를 낳으므로, 주장한 자리에서 범위를 요구한다. 방아쇠 폭은 킷 자기적용으로 골랐다 — 관측 주장만이면 77건/26스펙(신호가 묻힌다), 환경 지목과의 곱이면 2건이고 그 2건이 정확히 위험한 모양이었다. 범위: 이 건수 비교는 이 킷 저장소의 스펙 42종 대상이며, 다른 어휘를 쓰는 프로젝트에서는 마커 교체로 조정한다 [검증: tooling/__tests__/evidence-scope.test.mjs] |
