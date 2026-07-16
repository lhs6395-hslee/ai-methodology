# Feature Specification: Spec Grammar Norm Hardening

**Module**: `sdd-tooling`  **Spec**: `SPEC-013`  **Created**: 2026-07-06  **Status**: Active
**Input**: 전 문서 감사에서 "규범은 문서에 있는데 게이트가 없는" 항목 중 결정적 기계 신호가 있는 것을 문법화한다: ① Module 헤더 존재(STORAGE §2.3 "본문 필수") ② Module 값 단일성(STRUCTURE.md 1 레포 = 1 모듈) ③ FR 선언 라인의 SHALL(EARS 5패턴 공통 필수 토큰) ④ Dedup-Review 기록이 참조한 이웃 스펙 ID의 실재(DEDUP.md 형식 검사의 연장) ⑤ `ownershipCategories`의 Files 금지(DEDUP.md §3 명시 금지) ⑥ Files 글롭 미지원 문법의 staged 차단(module-spec 템플릿 "금지" — 매치 실패 = 소유가 조용히 풀림). 순수 의미 판정 항목은 게이트가 아니라 리뷰 경계로 선언한다(METHODOLOGY).

---

## User Scenarios & Testing

### User Story 1 — 스펙 문법 규범을 completeness가 표면화 (P1)
Module 헤더가 없거나, 스펙 간 Module 값이 갈라지거나, FR 선언 라인에 SHALL이 없거나, Dedup-Review가 존재하지 않는 스펙을 참조하면 completeness 게이트가 advisory로 표면화하고 `--strict`에서 차단한다. 질(EARS 어휘·측정가능성·기록 내용)은 여전히 리뷰 몫 — 기계 신호(존재·실재·단일성)만 판정한다.
- **Independent Test**: `grammar-hardening.test.mjs`가 순수 코어와 completeness 통합(각 신호 warn·strict 실패·정합 스펙 무경고)을 임시 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec without a Module header, **When** the completeness gate runs with `--strict`, **Then** it exits non-zero naming that spec.

### User Story 2 — config·글롭 수준의 금지는 hard 차단 (P1)
`ownershipCategories`에 Files를 넣으면 글롭 문자열이 dedup 키로 유입돼 유일성·형식검증이 오판한다 — ownership 게이트가 config 검증으로 즉시 exit 1. Files 글롭의 미지원 문법(`{`·`?`·선두 `[`)은 매치 실패로 소유가 조용히 풀리므로 staged(commit-msg hard)에서 차단하고 range는 advisory를 유지한다(점진 도입 경로).
- **Independent Test**: `grammar-hardening.test.mjs`가 ownership exit 1과 spec-sync staged/range 분기를 git 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec whose Files line contains an unsupported glob token, **When** spec-sync runs in staged mode, **Then** it exits non-zero; in range mode it only warns.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- SHALL 판정은 FR 선언 라인 단위다 — 다중행 서술이면 선언 라인에 SHALL이 오도록 쓴다(advisory라 형식 자유는 남는다). 볼드 선언(`- **FR-…**`) 아닌 본문 언급은 대상이 아니다.
- 삭제된 이웃 스펙을 참조하는 Dedup-Review 이력은 dangling으로 표면화된다 — 이력 자체는 보존하되 "이웃 없음(삭제됨)" 등 ID 없는 서술로 갱신한다.
- Module 값 단일성은 값이 선언된 스펙만 집계한다 — 헤더 부재는 별도 신호(이중 계산 없음).
- Files 카테고리 금지는 대소문자 무관("files"도 금지) — 우회 표기를 막는다.
- 글롭 staged 차단은 스펙 동반 위반과 독립이다 — 동반 위반이 있으면 그 에러 경로로, 없어도 글롭 위반만으로 exit 1.
- 셸/Go판에는 이 계층이 없다(핵심 3커맨드 계약 밖, 정직한 델타 — SPEC-006 Change Log·ci-examples 매트릭스 명시).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the completeness gate reads a spec, THE SYSTEM SHALL flag a missing Module header (advisory; non-zero under `--strict`) — the header STORAGE §2.3 declares mandatory.
- **FR-002** (event): WHEN specs declare more than one distinct Module value, THE SYSTEM SHALL flag the divergence listing the values (advisory) — one repo is one module, more modules mean more repos.
- **FR-003** (event): WHEN a spec's FR declaration line lacks the SHALL token, THE SYSTEM SHALL flag that FR id (advisory) — every EARS pattern carries SHALL; wording quality stays review's job.
- **FR-004** (event): WHEN a spec's Dedup-Review section references a spec ID that does not exist in the spec directory, THE SYSTEM SHALL flag the dangling reference (advisory) — extending the existence-and-form check to referential integrity.
- **FR-005** (unwanted): IF `ownershipCategories` contains Files in any letter case, THEN THE SYSTEM SHALL exit non-zero before parsing ownership — glob strings must never enter the dedup key space.
- **FR-006** (event): WHEN spec-sync runs in staged mode and any spec's Files line carries unsupported glob syntax, THE SYSTEM SHALL exit non-zero, WHILE range mode SHALL keep the warning advisory.

### Key Entities
- **spec grammar norm** — a documented, deterministic spec-form rule (required header, token, referential existence, forbidden config value) that gates can check without judging meaning.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: spec-grammar-hardening
- **Symbols**: grammar-lib.mjs
- **Artifacts**: —
- **Files**: tooling/grammar-lib.mjs, tooling/__tests__/grammar-hardening.test.mjs

## Dependencies (참조 — dedup 제외)
> completeness·ownership 게이트 본체는 SPEC-002 소유, spec-sync 본체·글롭 스캐너는 SPEC-003 소유, 섹션 파서는 SPEC-008 소유(lifecycle-lib), Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline, spec-quality-gates, spec-sync, spec-lifecycle, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `grammar-hardening.test.mjs` 전 케이스 green + completeness/ownership/spec-sync 신규 신호 출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 completeness를 돌 때 신규 신호 0건(전 스펙 Module 단일·SHALL 구비·Dedup 참조 실재).

## Non-Functional Requirements
- **NFR-001**: 전 판정은 텍스트 파싱·집합 비교로 결정적이며, EARS 어휘의 질·기록 내용의 질 등 의미 판정을 하지 않는다(리뷰 경계 침범 금지).

## Assumptions / Clarifications Retained
- 감사에서 (b)로 분류된 순수 의미 항목(EARS 어휘 질, 역량/제품 구분, Entity 표기의 스키마 일치, verb 동의어성, 스펙 본문의 도메인 판정, 현지어본 병행 편집, 승인 절차)은 게이트가 아니라 METHODOLOGY의 리뷰 경계 선언이 정본 — 억지 게이트로 오판을 만들지 않는다.
- Files glob 완전성("빠짐없이 덮는가")은 이 spec 범위가 아니다 — `specSyncUnownedPolicy: "error"`(SPEC-003)가 closed-world로 닫는 기존 경로를 문서에서 재광고한다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(게이트 전종 + grammar-hardening/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-002(spec-quality-gates): 비중복 — completeness·ownership 게이트 본체는 SPEC-002 소유, 이 spec은 문법 규범 판정 코어(grammar-lib)만 소유(SPEC-009 동형 패턴).
- 2026-07-06 이웃 SPEC-003(spec-sync): 비중복 — 글롭 스캐너(scanFilesLineIssues)·spec-sync 본체는 SPEC-003 소유, 이 spec은 staged 차단 정책만 소유.
- 2026-07-06 이웃 SPEC-008(spec-lifecycle): 비중복 — Dedup-Review 존재 판정은 SPEC-008 소유, 이 spec은 참조 ID 실재 판정만 추가.
- 2026-07-06 이웃 SPEC-012(prefix-class-consistency): 비중복 — SPEC-012는 접두어↔소유 파일 클래스 정합, 이 spec은 스펙 본문·config 문법 규범(대상이 다름).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — Module 존재·단일성, FR 라인 SHALL, Dedup-Review 참조 실재(advisory·strict) + Files 카테고리 금지·글롭 문법 staged 차단(hard) (Node·Python 동시) | 고도화 4차 전 문서 감사[검증]: 문서 규범 6건이 게이트 없이 존재 — 결정적 신호가 있는 것은 게이트로, 의미 판정은 리뷰 경계 선언으로(미강제 규범 제거) |
| 2026-07-16 | `grammar-hardening.test.mjs`의 check-spec-sync 임포트 클로저 복사 목록에 `drift-lib.mjs` 추가 | SPEC-019 동반: check-spec-sync의 새 import(drift-lib)를 테스트 하네스도 복사해야 ERR_MODULE_NOT_FOUND 없이 게이트 실행(픽스처 배선만, 판정 불변) |
| 2026-07-16 | 같은 복사 목록에 `cross-spec-lib.mjs` 추가 | SPEC-020 동반: check-spec-sync의 새 import(cross-spec-lib) 픽스처 배선(판정 불변) |
