# Feature Specification: Covers Backlink (실재는 동일성이 아니다 — 번호 충돌로 통과하는 태그)

**Module**: `sdd-tooling`  **Spec**: `SPEC-039`  **Created**: 2026-08-04  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(operations-dashboard 2026-08-03/04) — 테스트 `return-to.test.ts`가 `@covers SPEC-003/FR-085`를 달았고 작성 시점엔 FR-085가 없어 R1(dangling)이 정확히 잡았다. 그런데 **다른 세션이 전혀 무관한 기능**(승인 화면 메일주소 필드)을 FR-085로 착지시킨 순간 R1 위반이 사라지고 게이트가 초록이 됐다. 태그는 여전히 returnTo 안전성 테스트를 가리키고 FR-085는 메일주소 필드를 말하는데, 회계는 "FR-085는 unit으로 커버됨"이라고 보고한다. 병렬 세션이 각자 FR을 착지시키는 궤도에서 이 충돌은 우연이 아니라 **구조적으로 반복될 조건**이고, diff가 두 세션에 걸쳐 있어 사람 눈에도 안 띈다.

---

## User Scenarios & Testing

### User Story 1 — 태그와 FR이 서로를 아는지 본다 (P1)
기존 R1은 **단방향**이다: 태그가 가리키는 FR이 실재하는지만 본다. **실재는 동일성이 아니다** — 번호가 겹치기만 하면 통과한다. FR 쪽에 이미 `[검증: <경로>]` 관습이 있으므로 그것을 대조 축으로 써서(새 문법 없음) 양방향을 닫는다.
- **Independent Test**: `covers-backlink.test.mjs`가 순수 코어(경로 추출·정확/글롭/디렉토리 일치·이중 판정 금지·강도 처분)와 게이트 배선(3정책·실측 재현·헤더 정합)을 단독 검증. [검증: tooling/__tests__/covers-backlink.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a requirement whose evidence list names a different test file, **When** a test tags that requirement number, **Then** the gate reports a suspected number collision naming both sides.

### User Story 2 — 표기 부채가 본 신호를 덮지 않는다 (P1)
도입 시점에 대부분의 FR은 `[검증]`을 갖고 있지 않다(킷 자기적용 283건). 그것을 위반으로 세면 advisory 소음이 진짜 충돌을 묻고, 그러면 사람이 정책을 끈다. 별도 갈래로 세고 **어떤 강도에서도 차단하지 않는다**.
- **Independent Test**: 같은 테스트가 `hard`에서도 미표기가 통과하는 것과 갈래가 분리 집계되는 것을 검증. [검증: tooling/__tests__/covers-backlink.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a requirement with no evidence tag at all, **When** the policy is hard, **Then** the gate counts it as unlabeled debt and exits zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **새 문법을 만들지 않는다** — 대조 축은 SPEC-031이 이미 강제하는 `[검증: <경로>]`다. 저자는 표기 하나만 달면 이 검사의 보호를 받는다.
- **실재하지 않는 FR은 여기서 세지 않는다** — 그건 R1(dangling)의 몫이다. 같은 사실을 두 규칙이 각자 말하면 어느 쪽이 정본인지 흐려진다.
- **경로 매칭 폭은 SPEC-031과 같다** — 정확 일치·글롭(`tests/e2e/**`)·디렉토리 지목(`tests/unit` → 그 아래 전부)을 모두 인정한다. 좁히면 정당한 스위트 지목이 거짓 불일치가 된다.
- **헤더는 갈래 합과 맞아야 한다** — 태그 총량만 적으면 (파일,FR) 재태깅분이 사라진 것처럼 읽히고 **그 외형이 곧 조용한 누락**이다. 유일 건수·총량·차이 사유를 함께 적는다(킷 자기적용: 태그 323 → 판정 283, 재태깅 40).
- **`[미확인]`은 미표기로 센다** — 경로가 없어 대조할 축이 없기 때문이다. "테스트가 커버한다고 주장하는데 FR은 미확인이라 말한다"는 모순은 SPEC-031 FR-007이 매니페스트 축에서 이미 다루므로 여기서 겹쳐 판정하지 않는다.
- 기본 `advisory`. `hard`로 두면 표기가 없는 저장소가 첫 동기화에서 멈춘다 — 표면화 → `[검증]` 표기 정리 → 승격 순서다(래칫이 하향을 막는다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the policy is advisory or hard, the **covers-backlink** (E) core in **covers-backlink-lib.mjs** (S) SHALL compare each coverage tag's file against the evidence paths declared on that requirement's line — accepting exact, glob, and directory matches — and SHALL classify the pair as matched, mismatched, or unlabeled, counting one verdict per file-and-requirement pair. — capability: **covers-backlink.judge** (C).
- **FR-002** (unwanted): IF a requirement declares evidence paths that do not include the tagging file, THEN **check-fr-coverage.mjs** (S) SHALL report a suspected number collision naming both the tagging file and the declared evidence, warning under advisory and exiting non-zero under hard.
- **FR-003** (state): WHILE a requirement declares no evidence path at all, THE SYSTEM SHALL count it as unlabeled debt and SHALL NOT block at any strength; WHERE a tag points at a requirement that does not exist, THE SYSTEM SHALL leave that judgment to the dangling rule; an out-of-enum policy value SHALL exit non-zero.

### Key Entities
- **covers-backlink** — the mutual acknowledgement between a test's coverage tag and the requirement's own evidence list, as distinct from the requirement merely existing, so that "this number resolves" cannot pass for "this test verifies this requirement".

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: covers-backlink
- **Symbols**: covers-backlink-lib.mjs
- **Artifacts**: —
- **Capabilities**: covers-backlink.judge
- **Files**: tooling/covers-backlink-lib.mjs, tooling/__tests__/covers-backlink.test.mjs

## Dependencies (참조 — dedup 제외)
> 소비 게이트(`check-fr-coverage`)는 SPEC-002, `[검증]` 문법은 SPEC-031, 회계 분류는 SPEC-007 소유 — 이 spec은 결속 판정 코어만 담당한다. config knob·Python 복제는 각 소유 스펙(001/006).
- **Modules**: spec-quality-gates (references), execution-evidence (references), verification-accounting (references), key-pipeline (references)
- **Symbols**: check-fr-coverage.mjs

---

## Success Criteria (측정형)
- **SC-001**: `covers-backlink.test.mjs` 전 케이스 green — 경로 추출 5분기·일치 3형태·이중 판정 금지·강도 처분·게이트 3정책·헤더 정합. [검증: tooling/__tests__/covers-backlink.test.mjs]
- **SC-002**: 실측 사례를 재현한 픽스처(FR이 다른 테스트를 검증으로 선언한 상태에서 무관한 테스트가 같은 번호를 태깅)에서 충돌이 지목되고 양쪽 경로가 함께 출력된다. [검증: tooling/__tests__/covers-backlink.test.mjs]
- **SC-003**: 킷 자기적용에서 헤더가 갈래 합과 일치한다 — 태그 323 → 판정 283(재태깅 40 명시)·미표기 283·불일치 0. [검증: tooling/__tests__/covers-backlink.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 글롭 컴파일·파일 읽기는 소비 게이트가 주입하므로, 저장소 없이도 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/covers-backlink.test.mjs]

## Assumptions / Clarifications Retained
- 결속이 맞아도 **테스트가 그 FR을 실제로 검증하는지**는 판정하지 않는다 — 양쪽이 서로를 지목했다는 사실만 센다(존재는 기계, 질은 리뷰 — SPEC-031과 같은 경계).
- **기각한 대안:** FR 문장과 테스트 이름의 의미 유사도로 충돌을 판정하는 방식. 확률적이라 차단력을 줄 수 없고(SPEC-033 규범), 오탐이 잦으면 사람이 정책을 끈다. 재검토 조건: `[검증]` 표기율이 높은 저장소에서 "표기는 맞는데 내용이 다른" 충돌이 실측되면 확률적 비차단 층으로 신설한다.
- **기각한 대안:** 스캔 범위 knob(`coverageScanScope: worktree|staged|tracked`) — 제보의 곁가지 요청이다. `staged`를 고르면 커밋 밖 파일의 dangling 태그가 **영구히 안 보이고**, 그 손실을 선택지로 내미는 것은 완화를 권장으로 올리는 것과 같다(HARNESS 불변). 올바른 해소는 범위를 좁히는 것이 아니라 **귀속을 바로잡는 것**이다 — 판정 집합은 워킹트리 전역으로 유지하되 커밋 범위 밖 위반은 강도를 낮춰 오귀속 차단을 없앤다. 재검토 조건: 귀속 분리 후에도 우회가 실측되면 그때 범위를 논의한다(SPEC-002 FR-006 개정으로 착지).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-04 | 셀프리뷰(순수 코어 TDD·게이트 e2e·실측 사례 재현·킷 자기적용 헤더 정합 측정) + 소비 프로젝트 개선 요청(번호 충돌로 태그가 거짓 통과) → Active | FR-001~003 unit 커버. 킷 자기적용 불일치 0·미표기 283(표기 부채 백로그) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-04 이웃 SPEC-002(spec-quality-gates): 비중복 — 002의 R1은 태그가 가리키는 FR의 **실재**를, 이 spec은 그 FR과 태그의 **동일성**(서로를 인정하는가)을 본다. 실재는 동일성이 아니라는 것이 이 spec의 존재 이유다.
- 2026-08-04 이웃 SPEC-031(execution-evidence): 비중복 — 031은 FR 쪽 주장이 **실행 가능한 자산**을 지목하는지(증거 등급), 이 spec은 그 자산 목록과 **테스트 쪽 태그**가 일치하는지(결속 방향)다. 031이 만든 표기를 이 spec이 대조 축으로 소비한다.
- 2026-08-04 이웃 SPEC-007(verification-accounting): 비중복 — 007은 FR이 어느 클래스로 **회계**되는가(unit/smoke/deferred), 이 spec은 그 회계의 **입력이 참인가**다. 분류 vs 입력 진위다.
- 2026-08-04 이웃 SPEC-037(changelog-fr-ref): 비중복 — 037은 Change Log 선언이 FR 본문과 맞는지, 이 spec은 테스트 태그가 FR 증거와 맞는지다. 대조하는 두 선언의 짝이 다르다.
- 2026-08-04 이웃 SPEC-038(duplicate-logic): 비중복 — 038은 같은 규칙이 두 곳에 **구현**된 것, 이 spec은 한 번호를 두 관심사가 **주장**하는 것이다. 뿌리(병렬 세션)는 같고 대상은 코드 vs 태그다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-04 | 초안 — `coversBacklinkPolicy`(off\|advisory\|hard, 기본 advisory) + `coversBacklinkListCap` + `covers-backlink-lib`(경로 추출·결속 판정·강도 처분) + `check-fr-coverage` R1b 배선 | 실측 제보: R1(dangling)이 단방향이라 **번호가 겹치기만 하면 태그가 통과한다** — 다른 세션이 무관한 기능을 같은 번호로 착지시킨 순간 위반이 사라지고 회계가 "커버됨"을 보고했다. 실재는 동일성이 아니다. 대조 축은 SPEC-031의 `[검증]` 관습을 재사용하고, 표기 없는 FR은 위반이 아니라 별도 갈래로 세어 advisory 소음이 본 신호를 덮지 않게 한다 [검증: tooling/__tests__/covers-backlink.test.mjs] |
