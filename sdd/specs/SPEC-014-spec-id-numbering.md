# Feature Specification: Spec-ID Numbering Integrity

**Module**: `sdd-tooling`  **Spec**: `SPEC-014`  **Created**: 2026-07-06  **Status**: Active
**Input**: 접두어(SPEC/INFRA/TEST)는 화이트리스트로 강제되지만 **번호 매김 규칙은 미규정·미강제**였다 — 소비 프로젝트 실측에서 소비 프로젝트 A는 접두어별 순차(INFRA-001..004·TEST-001), 소비 프로젝트 B는 재도출을 SPEC-로 만든 뒤 retag해 전역 잔번(INFRA-011·INFRA-013, SPEC 쪽엔 011·013 gap)을 남겨 **두 프로젝트가 서로 다른 번호 체계**로 갈라졌다. 번호는 순전히 spec 파일 id 집합(접두어+영패딩 번호)만으로 판정 가능한 결정 신호다 — 접두어별로 **001부터 시작·중복 금지**를 hard로 강제하고, 001..max 사이 **중간 gap은 advisory**(제거·retag가 정당히 남기는 구멍)로 표면화한다.

---

## User Scenarios & Testing

### User Story 1 — 접두어별 번호가 001부터 유일하게 (P1)
각 접두어의 spec 번호는 001부터 시작하고 중복이 없어야 한다. 전역 잔번(예: INFRA가 011부터)이나 같은 번호 두 개는 fr 게이트가 exit 1로 차단하고 문제 id를 지목한다. 해소는 `sdd-retag`(재번호 맵 기계 이행, SPEC-011)로 한다.
- **Independent Test**: `numbering.test.mjs`가 순수 코어(접두어별 그룹핑·중복·001미시작·gap 판정)를 임시 id 집합으로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a prefix whose lowest spec number is 011, **When** the coverage gate runs, **Then** it reports the non-001 start with the offending id and exits non-zero.

### User Story 2 — 제거·retag가 남긴 중간 gap은 막지 않는다 (P1)
스펙을 제거(Status: Removed)하거나 다른 접두어로 retag하면 번호 시퀀스 중간에 구멍이 생긴다. 이는 정당하므로 001..max 사이 결번은 advisory 경고로만 표면화하고(빌드 비차단), `--strict`에서만 hard로 승격한다.
- **Independent Test**: `numbering.test.mjs`가 `[001,002,004]` 픽스처의 gap을 advisory로, `--strict` 승격을 hard로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a prefix with numbers 001, 002, 004, **When** the coverage gate runs without `--strict`, **Then** it warns about the missing middle number and exits zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 접두어별로 독립 판정한다 — SPEC와 INFRA는 각자 001부터 순차이며 서로의 번호에 간섭하지 않는다(전역 공유 번호는 비-001 시작으로 드러난다).
- 미등록 접두어 파일은 이 판정 이전에 PREFIX 화이트리스트가 이미 에러 처리한다(이중 보고 없음).
- gap 계산은 그 접두어의 실제 최소 번호부터 max까지의 내부 결번만 센다 — 001 미시작은 gap이 아니라 별도 hard 신호다(소비 프로젝트 B INFRA `[011,013]` → hard "001 미시작" + advisory "INFRA-012 gap", 001~010은 gap으로 재보고하지 않음).
- 맨 앞 spec을 제거해 001 자체가 사라진 정당 케이스는 지금 exemption을 두지 않는다 — 실제 사례가 나오면 prefixClassExemptions 동형으로 추가(YAGNI).
- 판정 severity는 fr 게이트 한 곳에서 결정한다(hard=중복·001미시작, advisory=gap·`--strict` 승격) — 번호는 단일 관심사라 게이트를 쪼개지 않는다.
- 셸/Go판 fr에는 이 계층이 없다(핵심 3커맨드 계약 밖, 정직한 델타 — SPEC-006).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the coverage gate evaluates the spec-file id set, THE SYSTEM SHALL group ids by prefix and SHALL exit non-zero when any prefix contains a duplicate number or its lowest number is not one, naming the offending id.
- **FR-002** (state): WHILE a prefix's numbers span from its lowest to its highest with interior holes, THE SYSTEM SHALL report each missing number as an advisory warning and SHALL promote it to a hard failure only under `--strict`, so removals and retags may legitimately leave gaps.
- **FR-003** (ubiquitous): THE SYSTEM SHALL derive the numbering judgment purely from the id set (prefix plus zero-padded number), performing no filesystem walk or spec-body inspection.

### Key Entities
- **prefix number sequence** — the per-prefix ordered set of spec numbers the gate checks for start-at-001, uniqueness, and interior contiguity.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: spec-id-numbering
- **Symbols**: numbering-lib.mjs
- **Artifacts**: —
- **Files**: tooling/numbering-lib.mjs, tooling/__tests__/numbering.test.mjs

## Dependencies (참조 — dedup 제외)
> fr 게이트 본체·PREFIX 화이트리스트는 SPEC-002 소유(이 spec은 번호 판정 코어만), 재번호 해소 수단은 SPEC-011(retag), Python 복제는 SPEC-006 소유.
- **Modules**: spec-quality-gates (references), retag (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `numbering.test.mjs` 전 케이스 green + fr 번호 판정 출력·exit의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 fr 게이트를 돌 때 번호 위반 0건(SPEC-001~014 연속·001 시작 — 도그푸딩).

## Non-Functional Requirements
- **NFR-001**: 판정은 id 문자열 파싱·정수 비교만으로 결정적이며, 접두어별 출력은 정렬되어 실행 간 안정적이다.

## Assumptions / Clarifications Retained
- 번호 모델의 정본은 "접두어별 001 순차"다 — 전역 공유 번호는 채택하지 않는다(가독성·접두어별 독립성). 이 결정은 STORAGE 접두어 의미(§2.2)와 정합.
- 소비 프로젝트의 기존 위반(예: 소비 프로젝트 B INFRA-011/013) 정규화는 각 프로젝트가 `sdd-retag`로 수행하는 다운스트림 작업이며 이 spec 범위 밖이다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(numbering·패리티 테스트 + 게이트 전종 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-002(spec-quality-gates): 비중복 — PREFIX 등록 거버넌스·fr 본체는 SPEC-002 소유, 이 spec은 번호 무결성 판정 코어만 소유.
- 2026-07-06 이웃 SPEC-012(prefix-class-consistency): 비중복 — SPEC-012는 접두어↔소스클래스 정합, 이 spec은 접두어 내부 번호 순차성(직교 관심사).
- 2026-07-06 이웃 SPEC-011(traceability-retag): 비중복 — 위반 해소 수단(재번호)은 SPEC-011 소유, 이 spec은 판정만.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — 접두어별 001시작·중복 hard·중간 gap advisory(`--strict` 승격), Node·Python 동시 | 소비 프로젝트 A(접두어별)·소비 프로젝트 B(전역 INFRA-011/013) 번호 체계 불일치[검증] — 번호 모델이 미규정·미강제라 프로젝트마다 제각각 |
| 2026-07-16 | `numberingIssues`에 `retiredIds` 인자 추가 — 폐기 기록된 번호의 gap은 advisory에서 제외(사고성 결번과 구분), Node·Python 패리티 + 테스트 2건 | SPEC-018 FR-006 동반(소비): 폐기 워크플로가 남기는 번호 gap을 정상 retirement gap으로 인지 — 판정 코어는 이 spec 소유 |
