# Feature Specification: Gate Coverage Integrity (배선된 게이트/가드가 실제로 전체를 커버하는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-059`  **Created**: 2026-08-17  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-17) — CLOSEOUT_FLOW 절차 게이트화 작업 자체를 검증하는 과정에서 그 작업이 놓친 구멍 2건이 드러났다. ① `scripts/hooks/commit-msg`(실제로 설치되는 파일)와 `scripts/sdd-commit-msg.sh`(자기 헤더에 "내가 설치되는 훅이다"라고 잘못 주장하는 사본)가 이미 갈라져 있었다 — 후자에만 `check-gate-escalation.mjs` 호출이 있었다. `check-hooks-installed`(SPEC-036)는 "설치 대상이 실재하는가"만 보고 "병행 사본이 내용까지 같은가"는 보지 않는다. ② `canTransition()`/`crossCheckVerdicts()`가 dev-done 전이의 필수 관문인데, 실제 쓰기 경로(`page-notes/route.ts`)는 이 함수들을 전혀 호출하지 않았다(참조 0건) — 화면에서 직접 상태를 바꾸면 사슬 전체가 조용히 우회된다. `check-ownership`은 "누가 이 엔티티를 소유하는가"만 보고 "그 상태를 쓰는 모든 표면이 지정된 가드 함수를 실제로 호출하는가"는 보지 않는다. 공통점: 둘 다 "게이트가 배선돼 있는가"가 아니라 "배선된 게이트/가드가 실제로 전체를 커버하는가"를 보는 감시 계층 자체가 없었다.

---

## User Scenarios & Testing

### User Story 1 — 같은 논리적 훅을 표현하는 두 파일은 같은 게이트를 부른다 (P1)
프로젝트가 진화하며 설치 경로가 바뀌면 옛 설치 스크립트가 사본으로 남는 일이 흔하다. 두 파일이 "같은 훅"이라고 등록되면, 그 둘이 부르는 게이트 목록이 실제로 같은지 대조한다.
- **Independent Test**: 순수 코어(게이트 호출 추출·config 문법·드리프트 대조)와 게이트(미등록 inert·드리프트 차단·통과·advisory 비차단·off·파일 부재 확인 못 함)를 단독 검증. [검증: tooling/__tests__/duplicate-source-drift.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a pair of files registered as expressing the same logical hook, **When** one calls a `check-*.mjs` gate the other does not, **Then** the gate reports the drift naming both files and the mismatched call.

### User Story 2 — 등록된 가드는 지목된 모든 쓰기 표면에서 실제로 호출된다 (P1)
"이 상태 전이는 반드시 이 함수를 거쳐야 한다"는 불변식은 그 상태를 쓰는 모든 표면이 실제로 그 함수를 참조(import + 호출)할 때만 성립한다. 참조가 없으면(0건이든 import뿐인 1건이든) 우회다.
- **Independent Test**: 같은 축의 테스트가 참조 0건·1건(호출 없음)·2건 이상(통과)·guardedFieldPattern 스코핑·가드 자체 정의 부재·표면 부재(확인 못 함)를 각각 검증. [검증: tooling/__tests__/invariant-guard.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a guard function registered against a set of guarded write surfaces, **When** a surface's source contains fewer references to the guard name than the reuse-precedent bar (2 — import plus call), **Then** the gate reports that surface as bypassing the guard.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **두 등록(`duplicateSourcePairs`·`invariantGuards`) 모두 미등록이면 `INERT`다** — 검사할 대상이 없는데 위반 0건을 "통과"로 읽으면 이번 사고와 같은 유형(무등록 = 무검사인데 겉보기엔 초록)이 재발한다.
- **드리프트 판정은 어느 쪽이 최신인지 판정하지 않는다** — 존재는 기계, 어느 쪽이 옳은지는 리뷰. 사본 자체를 없애는 리팩터(한쪽이 다른 쪽을 생성)를 권장하되 강제하지 않는다.
- **가드 참조 임계는 2다**(SPEC-046 `REFERENCE_BAR.fn` 재사용, 새로 만들지 않음) — import만 있고 호출이 없는 1건도 우회다. 정의(import) 없이 그냥 이름이 언급된 1건도 마찬가지로 우회다.
- **`guardedFieldPattern`은 스코핑 필터다, 임계가 아니다** — 주어지면 그 패턴이 텍스트에 없는 표면은 애초에 검사 대상 밖(등록자가 표면을 넓게 적었을 때 오탐 방지). 생략하면 등록된 표면 전부가 대상이다.
- **가드 자신의 부재는 그 자체로 위반이다** — `guardFile`에 `guard` 이름이 정의로도 없으면(참조 0건) 아무도 그 함수를 부를 수 없다는 뜻이므로 표면 대조 이전에 지목한다.
- **대조 대상 파일이 없으면 확인 못 함이다, 위반이 아니다** — 파일 부재를 드리프트/우회로 단정하지 않는다(다른 축 결함일 수 있다 — 예: 경로 오타).
- **이 축은 가드가 하는 일의 의미(옳게 판단하는지)는 보지 않는다** — 존재·참조만 본다. 의미는 리뷰의 몫.
- 기본 `advisory`. `hard`는 두 등록이 프로젝트에 정착한 뒤가 종착지다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a pair is declared in `duplicateSourcePairs` with both files present, the **gate-coverage-integrity** (E) core in **duplicate-source-lib.mjs** (S) SHALL extract the set of `check-*.mjs` gate-call mentions from each file's text and report any mention present in one file's set but absent from the other's. — capability: **gate-coverage-integrity.drift** (C).
- **FR-002** (unwanted): IF either file in a declared pair does not exist, THEN **check-duplicate-source-drift.mjs** (S) SHALL report that pair as unchecked rather than asserting drift or its absence.
- **FR-003** (state): WHILE `duplicateSourcePairs` is empty or undeclared, THE SYSTEM SHALL declare itself inert rather than reporting zero violations.
- **FR-004** (event): WHEN a guard is declared in `invariantGuards` with a `guardFile`, the **gate-coverage-integrity** (E) core in **invariant-guard-lib.mjs** (S) SHALL report the guard as missing WHEN its name has zero references in that file's text.
- **FR-005** (unwanted): IF a guarded write surface's source text contains fewer references to the guard's name than the function-reference bar (2, reused from **impl-reference-lib.mjs**'s `REFERENCE_BAR.fn`, SPEC-046 — not redefined), THEN **check-invariant-guard.mjs** (S) SHALL report that surface as bypassing the guard; WHERE a `guardedFieldPattern` is declared, this check SHALL apply only to surfaces whose text matches that pattern. — capability: **gate-coverage-integrity.bypass** (C).
- **FR-006** (state): WHILE `invariantGuards` is empty or undeclared, THE SYSTEM SHALL declare itself inert rather than reporting zero violations; IF a guarded write surface file does not exist, THEN it SHALL be reported as unchecked rather than as a bypass.

### Key Entities
- **gate-coverage-integrity** — the aggregate covering both axes (duplicate-source pairs, invariant guards) of "does already-wired coverage actually reach everything it claims to," distinct per-axis registration living under the same module.
- **duplicate-source pair** — two files registered as expressing the same logical hook/gate, distinct from the installed-hook registry (SPEC-036) which only tracks whether one canonical file is present.
- **invariant guard** — a function whose call is claimed to be mandatory before a declared set of write surfaces may mutate a given state, distinct from entity ownership (SPEC-003/SPEC-026 family) which tracks who owns a key, not who is required to call what before writing it.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: gate-coverage-integrity
- **Symbols**: duplicate-source-lib.mjs, check-duplicate-source-drift.mjs, invariant-guard-lib.mjs, check-invariant-guard.mjs
- **Artifacts**: —
- **Capabilities**: gate-coverage-integrity.drift, gate-coverage-integrity.bypass
- **Files**: tooling/duplicate-source-lib.mjs, tooling/check-duplicate-source-drift.mjs, tooling/invariant-guard-lib.mjs, tooling/check-invariant-guard.mjs, tooling/__tests__/duplicate-source-drift.test.mjs, tooling/__tests__/invariant-guard.test.mjs

## Dependencies (참조 — dedup 제외)
> 소유 글롭 해석은 SPEC-003, 판정 종류는 SPEC-040, Python 복제는 SPEC-006(이 spec은 아직 미러 미구현 — 기존 37개 게이트 중 7개도 마찬가지로 SC-002 대상 밖이다) 소유. 참조 임계치는 SPEC-046 소유.
- **Modules**: impl-reference (references — `referenceCount`/`REFERENCE_BAR.fn` 재사용, 재정의 아님)
- **Symbols**: verdict-lib.mjs, sdd-config.mjs

---

## Success Criteria (측정형)
- **SC-001**: `duplicate-source-drift.test.mjs` 전 케이스 green — 게이트 호출 추출·config 문법·드리프트 대조(자기 제외 없음, 대칭)·게이트 7갈래(미등록 inert·차단·통과·advisory·확인 못 함·config 위반·off). [검증: tooling/__tests__/duplicate-source-drift.test.mjs]
- **SC-002**: `invariant-guard.test.mjs` 전 케이스 green — 가드 정의 부재·참조 0/1/2건 이상·guardedFieldPattern 스코핑·표면 부재(확인 못 함)·게이트 7갈래. [검증: tooling/__tests__/invariant-guard.test.mjs]
- **SC-003**: 제보의 두 실측 사례(훅 사본 드리프트·canTransition 우회)가 합성 재현으로 표면화된다. [검증: tooling/__tests__/duplicate-source-drift.test.mjs, tooling/__tests__/invariant-guard.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 두 판정 코어 모두 순수 함수(문자열 대조·정규식 참조 카운트)이고 파일 읽기는 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/duplicate-source-drift.test.mjs, tooling/__tests__/invariant-guard.test.mjs]

## Assumptions / Clarifications Retained
- 두 축 모두 **존재·참조**만 본다 — 그 코드가 의미상 옳은지(가드가 정말 그 불변식을 지키는지, 사본 중 어느 쪽이 최신 의도인지)는 판정하지 않는다(존재는 기계, 의미는 리뷰).
- **기각한 대안(가드 우회):** import 그래프를 실제로 파싱해 "A가 B에서 S를 import하고 호출하는가"를 구조적으로 확인하는 방식(SPEC-050 `import-wiring-lib.mjs`의 `localImports` 확장). 조사 결과 SPEC-050·SPEC-051 어디에도 호출부(call-site) 탐지가 없고, specifier 해석(상대경로 정규화)까지 필요해 언어·모듈 경계(예: TS 별칭 import, 다른 런타임)를 넘는 등록에서 구조적으로 실패한다. SPEC-046의 참조 카운트(정규식 식별자 경계 매칭)는 이미 검증된 임계치(`REFERENCE_BAR.fn`=2)를 갖고 있고 언어·모듈 무관이다 — 재사용이 새 기계보다 낫다. 재검토 조건: 참조 카운트 오탐이 반복 실측되면.
- **기각한 대안(훅 드리프트):** 사본을 감시하는 대신 **사본 자체를 없애는 리팩터를 이 게이트가 강제**하는 방식(예: 한쪽이 다른 쪽을 자동 생성하지 않으면 차단). 리팩터의 안전성은 프로젝트마다 다른 설치 경로 관례에 달려 있어 킷이 일반적으로 강제할 수 없다 — 감시로 표면화하고 리팩터 여부는 프로젝트 판단에 맡긴다(Edge Cases에 권장으로만 명시). 재검토 조건: 없음.
- **기각한 대안:** 두 축을 각각 별도 spec으로 분리. 둘 다 "이미 배선된 감시가 실제로 전체를 덮는가"라는 같은 상위 질문의 두 인스턴스이고, 같은 실측 사건(같은 검증 세션)에서 함께 드러났다 — 하나의 진입점(spec)에서 관리하는 것이 다음 세션이 이 사건을 재구성하는 비용을 줄인다. 재검토 조건: 둘 중 하나가 독자적으로 크게 확장되면(예: 가드 우회 축이 언어별 파서를 갖게 되면) 분리를 재고한다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-17 | 셀프리뷰(순수 코어 유닛 14종·게이트 e2e 15종·제보 2건 합성 재현) + 소비 프로젝트 개선 요청 → Active | FR-001~006 unit 커버. 킷 자기적용: 두 레지스트리 모두 미선언이라 두 게이트 다 `INERT`를 명시 출력(결합 0) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-17 이웃 SPEC-036(hook-wiring): 비중복 — 036은 선언된 훅이 **설치됐는가**(존재), 059는 "같은 훅이라 주장하는 두 파일이 **내용까지 같은가**"다. 036이 초록이어도 059는 별도로 판정될 수 있다(설치는 됐는데 사본이 갈라짐).
- 2026-08-17 이웃 SPEC-003/SPEC-026(ownership 계열): 비중복 — 소유권 계열은 "이 키를 누가 소유하는가"(귀속), 059는 "이 상태를 쓰는 코드가 지정된 가드를 실제로 호출하는가"(강제)다. 소유자가 명확해도 강제가 우회될 수 있다.
- 2026-08-17 이웃 SPEC-046(impl-reference): 부분 공유 — 046은 FR이 지목한 구현체가 **어디서든** 참조되는가(고아 구현 탐지), 059는 **등록된 특정 표면 목록에서** 특정 가드가 참조되는가(우회 탐지)다. 059는 046의 참조 카운트 함수를 재사용하지만 소유·판정 축은 다르다(재정의 아님, Dependencies 참조).
- 2026-08-17 이웃 SPEC-047(process-ssot): 비중복 — 047은 사슬의 단계·불변식이 SSOT 문서에 **선언되고 강제 스크립트가 실재하는가**(문서 대 config 대조), 059는 이미 실재가 확인된 가드/사본이 코드 표면에서 **실제로 참조되는가**(코드 대 코드 대조)다. 대조 쌍이 다르다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-17 | 초안 — `duplicateSourcePairs`·`duplicateSourceDriftPolicy`(off\|advisory\|hard, 기본 advisory) + `duplicate-source-lib`(게이트 호출 추출·config 문법·드리프트 대조) + `check-duplicate-source-drift`, `invariantGuards`·`invariantGuardPolicy`(off\|advisory\|hard, 기본 advisory) + `invariant-guard-lib`(가드 정의 부재·참조 카운트 기반 우회 탐지, SPEC-046 재사용) + `check-invariant-guard`. 양쪽 harness 커밋 훅 템플릿(consumer·self)에 배선 + HARNESS.md R26 + sdd-sync.mjs RULES 등재. Python 미러는 이번 스코프에 포함하지 않음(기존 37개 게이트 중 7개도 미러 없음 — 필수 아님, 후속 과제) | 소비 프로젝트 실측(2026-08-17): CLOSEOUT_FLOW 게이트화 작업 자체를 검증하는 과정에서 그 작업의 구멍 2건이 드러났다 — 훅 사본 드리프트(SPEC-036이 못 잡음)와 가드 우회(check-ownership이 못 잡음). 둘 다 "배선됐는가"가 아니라 "배선이 실제로 전체를 덮는가"를 보는 감시 계층이 킷에 없어서 생긴 유형이라, 개별 프로젝트가 아니라 킷 차원에서 일반화했다 |
