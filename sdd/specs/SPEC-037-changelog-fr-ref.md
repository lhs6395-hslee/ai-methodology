# Feature Specification: Change Log FR Reference (선언한 FR이 실재하는가 — 거짓 선언만 잡는다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-037`  **Created**: 2026-08-02  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(operations-dashboard SPEC-017) — Change Log에 `**FR-018 신규: Jira 댓글 삭제**` 등 3개 행이 있고 코드(`src/app/api/jira/comments/route.ts`)도 정상 동작하는데, **FR-016/017/018의 본문이 Functional Requirements 절에 없었다**(FR-015 다음이 FR-019). 3개 surface의 동작 계약이 몇 달간 SSOT 밖에 있었고 어떤 게이트도 막지 못했다.

---

## User Scenarios & Testing

### User Story 1 — 선언과 실물의 불일치만 잡는다 (P1)
Change Log 표 행이 "FR-018 신규"라고 선언하면 그 FR은 본문에 있어야 한다. 없으면 계약이 SSOT 밖에 있다는 뜻이므로 지목한다. 단순 언급(`FR-006 관련`)·타 스펙 참조(`SPEC-013/FR-003`)·폐기 표기(`FR-018 폐기`)는 대상이 아니다 — 잡아야 하는 것은 **거짓 선언 하나**다.
- **Independent Test**: `changelog-fr.test.mjs`가 순수 코어(선언 추출·폐기 구분·타 스펙 배제·어휘 교체)와 게이트 배선(off·advisory·hard·실측 역검증)을 단독 검증. [검증: tooling/__tests__/changelog-fr.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a Change Log row declaring a new requirement whose body is absent, **When** the coverage gate runs under advisory, **Then** it names the spec, the requirement id, and the remedy while exiting zero.

### User Story 2 — 결번의 두 의미를 갈라 말한다 (P1)
같은 결번이 **폐기 흔적**(정당)일 수도 **선언만 하고 안 쓴 것**(결함)일 수도 있는데, 그동안 한 문장이 둘을 덮었다. 판정 소스를 이 spec의 코어 하나로 두고 문구를 가른다.
- **Independent Test**: `changelog-fr.test.mjs`가 선언 집합 유무로 문구가 갈리는 것과 둘이 섞였을 때 각각 제 문장으로 나오는 것을 검증. [검증: tooling/__tests__/changelog-fr.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a numbering gap that the Change Log declared as new, **When** the advisory is emitted, **Then** it says the body is missing rather than that a retirement may have left the gap.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **기존 탈출구를 없애지 않는다.** `check-spec-sync`가 `FR / Edge Cases / Change Log` **택1**로 만족되는 것은 설계다 — 순수 구현 버그는 FR을 건드리지 않는 것이 옳다(`speckit-fix` 2단계). 이 spec은 그 택1을 유지한 채 **선언과 실물의 불일치만** 잡는다. `Spec-Impact: none` 트레일러도 그대로다.
- **선언 어휘는 프로젝트마다 다르다** — 킷은 `신설`, 제보 프로젝트는 `신규`를 쓴다. 어휘를 코드에 못 박으면 표현이 한 글자 다른 저장소에서 게이트가 통째로 inert가 되고, 그 0건은 진짜 0건과 구분되지 않는다(침묵은 근거가 아니다). `changeLogNewVerbs`·`changeLogReviseVerbs`·`changeLogRetireVerbs`로 교체한다.
- **타 스펙 FR 참조는 내 FR이 아니다** — `SPEC-013/FR-003`·`Change-Driver: SPEC-017 FR-004b`·`SPEC-017의 FR-018`. 판정 전에 지운다(치환이 아니라 공백으로 — 남기면 뒤 토큰과 붙어 새 오탐을 만든다).
- **표 행만 기록이다** — 절 안의 HTML 주석·산문은 이력이 아니다. 코드 스팬(`` `FR-018 신규` ``)은 인용이라 대상 밖이다(SPEC-031·033 동형 — 문법을 설명하는 스펙이 자기 예시로 위반이 되면 안 된다).
- **폐기가 신규를 이긴다** — 한 스펙에서 같은 번호가 신규로 선언됐다가 나중에 폐기되면 남는 것은 폐기다. 본문이 없어도 정당하며, 결번 advisory도 원래 문구로 돌아간다.
- 서픽스는 기저 번호로 접힌다(`FR-004b`가 있으면 004는 실재) — SPEC-014 결번 규칙과 같은 접기.
- 기본 `advisory`. `hard`로 두면 레거시 스펙이 많은 저장소가 첫 동기화에서 전부 멈춘다 — 표면화 → 부채 정리 → 승격 순서다(래칫이 하향을 막는다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the policy is advisory or hard, the **changelog-fr-ref** (E) core in **changelog-fr-lib.mjs** (S) SHALL extract declarative requirement references from Change Log table rows only — new and revision verbs as declarations, retirement verbs as retirements — excluding code spans, prose, and references qualified by another spec id. — capability: **changelog-fr-ref.judge** (C).
- **FR-002** (unwanted): IF a declared requirement number has no declaration in the Functional Requirements section of that same spec, THEN **check-fr-coverage.mjs** (S) SHALL name the spec, the id, the declaring verb, and both remedies — land the contract as a requirement, or mark it retired — warning under advisory and exiting non-zero under hard.
- **FR-003** (event): WHEN a numbering gap coincides with a declared-but-absent number, THE **numbering-lib.mjs** (S) advisory SHALL say the body is missing instead of attributing the gap to a retirement, drawing that distinction from this spec's core so that two gates never describe one fact in opposite terms.
- **FR-004** (state): WHILE `changeLogFrRefPolicy` is off, THE SYSTEM SHALL perform no cross-check and SHALL restore the original gap wording; an out-of-enum policy value SHALL exit non-zero before judging.

### Key Entities
- **changelog-fr-ref** — the claim a Change Log row makes about a requirement's existence, as distinct from the requirement itself, so that "we added FR-018" can be checked against whether FR-018 was ever written.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: changelog-fr-ref
- **Symbols**: changelog-fr-lib.mjs
- **Artifacts**: —
- **Capabilities**: changelog-fr-ref.judge
- **Files**: tooling/changelog-fr-lib.mjs, tooling/__tests__/changelog-fr.test.mjs

## Dependencies (참조 — dedup 제외)
> 소비 게이트(`check-fr-coverage`)와 번호 무결성 코어(`numbering-lib`)는 각각 SPEC-002·SPEC-014 소유 — 이 spec은 판정 코어와 그 배선만 담당한다. config knob·Python 복제는 각 소유 스펙(001/006).
- **Modules**: spec-quality-gates (references), spec-id-numbering (references), spec-sync (references), key-pipeline (references), runtime-parity (references)
- **Symbols**: check-fr-coverage.mjs, numbering-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `changelog-fr.test.mjs` 전 케이스 green — 선언 추출·폐기 구분·타 스펙 배제·어휘 교체·결번 분기·게이트 3정책. [검증: tooling/__tests__/changelog-fr.test.mjs]
- **SC-002**: 실측 사례(SPEC-017의 FR-016/017/018)를 재현한 픽스처에서 3건이 각각 지목되고, 같은 행의 `SPEC-013/FR-003`은 오탐 0이다 — 탐지 못 하면 패턴이 좁은 것이다. [검증: tooling/__tests__/changelog-fr.test.mjs]
- **SC-003**: 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/sdd-gates-py.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 파싱·집합 대조만의 순수 함수이고 파일 읽기는 소비 게이트가 수행하므로, 스펙 디렉토리 없이도 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/changelog-fr.test.mjs]

## Assumptions / Clarifications Retained
- 선언의 **내용**은 판정하지 않는다 — "FR-018 신규"가 정말 신규인지, 그 FR 문장이 선언한 계약과 일치하는지는 리뷰 몫이다. 기계는 "선언한 번호가 본문에 있는가"만 센다(SPEC-007·031과 같은 경계: 존재는 기계, 질은 리뷰).
- 반대 방향(**본문에 FR이 있는데 Change Log에 기록이 없다**)은 이 spec의 대상이 아니다 — 그건 `check-spec-sync`의 동반 요구와 SPEC-009 근거 회계가 이미 다루는 축이고, 여기서 겹쳐 판정하면 같은 사실을 두 게이트가 각자 말하게 된다.
- **기각한 대안:** `check-spec-sync`의 택1을 "FR 절 변경 필수"로 좁히는 방식은 기각(2026-08). 순수 구현 버그·리팩터가 FR을 건드리지 않는 것이 옳고, 좁히면 사람이 빈 FR 문장을 만들어 통과시키는 우회를 배운다(우회를 유발하는 강제는 강제가 아니다). 재검토 조건: 거짓 선언이 아니라 **아예 기록도 FR도 없는** 계약 추가가 실측되면 그건 다른 축이므로 별도 판정을 만든다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-02 | 셀프리뷰(순수 코어 TDD·게이트 e2e·실측 사례 역검증·Node↔Python 바이트 패리티) + 소유자 개선 요청(Change Log 거짓 선언 판정 공백) → Active | FR-001~004 unit 커버. 킷 자기적용 0건(킷 Change Log의 FR 참조는 전부 실재) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-02 이웃 SPEC-003(spec-sync): 비중복 — 003은 **코드가 바뀌면 스펙이 동반됐는가**(동반 여부), 이 spec은 그 동반 기록이 **참인가**(선언↔실물). 003의 택1 탈출구를 없애지 않고 그 위에 거짓 선언만 얹어 잡는다.
- 2026-08-02 이웃 SPEC-014(spec-id-numbering): 비중복 — 014는 번호 집합의 형태(중복·연번·결번)를 보고, 이 spec은 결번의 **의미**(폐기냐 미작성이냐)를 Change Log에서 읽는다. 014의 결번 advisory가 이 spec의 판정을 소비하되 소유는 갈린다.
- 2026-08-02 이웃 SPEC-009(derivation-accounting): 비중복 — 009는 Change Log 행에 **근거가 적혔는가**(기록의 완전성), 이 spec은 그 행이 선언한 FR이 **실재하는가**(기록의 진위)다.
- 2026-08-02 이웃 SPEC-018(spec-retirement): 비중복 — 018은 폐기를 **수행**하고 번호 재사용을 막고, 이 spec은 폐기 표기를 **읽어** 정당한 결번과 결함을 가른다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-02 | 초안 — `changeLogFrRefPolicy`(off\|advisory\|hard, 기본 advisory) + 어휘 knob 3종 + `changelog-fr-lib`(선언 추출·실재 대조) + `check-fr-coverage` 배선 + 결번 advisory 분기, Node·Python 바이트 패리티 | 실측 제보(operations-dashboard SPEC-017): Change Log가 FR-016/017/018을 신규로 선언하고 코드도 도는데 FR 본문이 없어 3개 surface의 계약이 몇 달간 SSOT 밖에 있었다. 두 규칙이 각자 정당한 이유로 흘렸다 — spec-sync는 택1로 만족되고(그 탈출구는 설계다), 결번 advisory는 "폐기 잔분일 수 있음"이라 결함을 정당한 흔적과 같은 문장으로 말했다. 없앨 것은 탈출구가 아니라 **거짓 선언** 하나다 [검증: tooling/__tests__/changelog-fr.test.mjs] |
