# Feature Specification: Spec Quality Gate Suite

**Module**: `sdd-tooling`  **Spec**: `SPEC-002`  **Created**: 2026-07-02  **Status**: Active
**Input**: spec 품질을 기계로 강제하는 게이트군 — FR 커버리지·소유권 dedup·입도(cohesion)·완전성·일관성, 그리고 PREFIX 거버넌스.

---

## User Scenarios & Testing

### User Story 1 — spec 품질의 기계적 심판 (P1)
방법론의 최대 빈칸("이 spec은 중복인가? 과대한가? 근거가 있나?")을 사람 판단이 아니라 결정적 게이트로 메운다. 다섯 게이트가 한 계층을 이룬다: `check-fr-coverage.mjs`(FR↔test 추적 + PREFIX 화이트리스트), `check-ownership.mjs`(구조적 중복 dedup), `check-spec-cohesion.mjs`(under-fragmentation 입도), `check-spec-completeness.mjs`(FR 있는 spec의 SC·인수조건 존재), `check-spec-consistency.mjs`(선언 키의 본문 근거).
- **Independent Test**: `check-ownership.test.mjs`·`check-spec-cohesion.test.mjs`·`check-spec-completeness.test.mjs`·`check-spec-consistency.test.mjs`·`check-prefix.test.mjs`가 각 게이트의 통과/위반 분기를 임시 spec 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** two specs declaring the same Ownership key in the same category, **When** `check-ownership.mjs` runs, **Then** it reports a structural-duplicate conflict and exits non-zero.

### User Story 2 — 접두어 거버넌스로 조용한 누락 차단 (P1)
추적 닻(spec ID 접두어)이 표준 밖이면 게이트가 조용히 건너뛰지 않고 실패한다. `check-fr-coverage.mjs`는 spec 수집 전에 모든 `^[A-Z]+-NNN.md`의 접두어를 검사해 미등록 접두어(또는 사유 없는 비표준 접두어)를 exit 1로 막는다.
- **Independent Test**: `check-prefix.test.mjs`가 미등록 접두어·사유 없는 비표준 접두어에서 exit 1, 등록·사유 구비 시 통과를 검증.
- **Acceptance (GWT)**: 1. **Given** a spec file with a prefix not in `specIdPrefixes`, **When** `check-fr-coverage.mjs` runs, **Then** it fails before collecting FRs.

### Edge Cases
- Ownership 블록이 없는 spec은 비-strict에서 **warn**(점진 도입) — dedup은 건너뛴다.
- cohesion에서 aggregate-root 카테고리(config의 첫 카테고리, 여기서는 Modules) 키가 `maxAggregateRootsPerSpec`(기본 1) 초과면 "여러 aggregate 삼킴" 신호로 warn — aggregate 루트 + 그 자식 표들을 한 spec이 함께 소유하는 프로젝트는 이 값을 상향(자식은 별도 root 아님).
- completeness는 FR이 0개인 spec(순수 인프라)은 SC·인수조건 검사에서 면제한다.
- consistency는 `## Ownership` **이전** 본문만 근거로 삼는다 — 키가 자기 선언 줄로 근거되는 것을 방지하며, 근거 없는 키는 advisory warn(비차단)이다.
- 요구 ID는 접두어(`requirementIdPrefixes` 파생, 기본 `FR`) + 3자리 + 선택적 소문자 서픽스 1자(`FR-002b`) — coverage의 FR 선언 추출, cohesion의 FR 수 집계, completeness의 FR-존재 면제 판단이 모두 config 파생값(`__frDeclRe`/`__frTokenRe`) 하나를 쓴다(사이트별 자체 정규식 = 절단 태그·조용한 FR 누락의 뿌리 — 하드코딩 사이트 금지).

---

## Functional Requirements (EARS)
> 정본은 영어. 게이트당 1 FR + PREFIX 1 FR 원칙.

- **FR-001** (event): WHEN a test file carries an `@covers <SPEC-ID>/FR-NNN` tag referencing a FR that does not exist in that spec, THE SYSTEM SHALL report an R1 dangling-reference error and exit non-zero; a spec with zero covering tests SHALL only warn (incremental adoption).
- **FR-002** (unwanted): IF two or more specs own the same normalized key within one ownership category, THEN THE SYSTEM SHALL report a structural-duplicate conflict and exit non-zero, while Dependencies-section keys are excluded from the duplicate check.
- **FR-003** (event): WHEN a spec owns more keys per category than `maxKeysPerCategoryPerSpec`, or declares more aggregate-root-category keys than `maxAggregateRootsPerSpec` (default 1), or exceeds `maxFRsPerSpec` FRs, THE SYSTEM SHALL emit an under-fragmentation (cohesion) split advisory.
- **FR-004** (unwanted): IF a spec declares at least one FR but has no `SC-NNN` success criterion or no acceptance clause (Given/Acceptance/수용 기준), THEN THE SYSTEM SHALL warn that the spec is incomplete.
- **FR-005** (unwanted): IF an owned key's core tokens never appear in the spec body preceding the `## Ownership` section, THEN THE SYSTEM SHALL emit a consistency advisory that the key lacks grounding.
- **FR-006** (event): WHEN `check-fr-coverage.mjs` starts, THE SYSTEM SHALL validate every spec filename prefix against `specIdPrefixes` before collecting FRs, and SHALL exit non-zero for an unregistered prefix or a non-standard prefix lacking a `prefixRationale` entry.
- **FR-007** (state): WHILE running without `--strict`, THE SYSTEM SHALL treat quality signals (missing ownership, cohesion, completeness, consistency, partial coverage) as non-blocking warnings and exit zero, deferring hard enforcement to `--strict`.
- **FR-008** (event): WHEN `check-test-adequacy.mjs` runs over `@covers`-tagged test files, THE SYSTEM SHALL report any tagged file containing no assertion tokens (per `assertionPatterns` in config) as an adequacy violation, exiting zero in advisory mode and non-zero under `--strict`.
- **FR-009** (event): WHEN `entityRegistry` is non-empty, THE SYSTEM SHALL exit non-zero from the ownership gate for an owned aggregate-root-category key absent from the registry or a registry entry with an empty rationale (the PREFIX-governance pattern), warn for registered keys no spec owns, and stay inactive when the registry is empty (current behavior).

### Key Entities
- **quality finding** — a per-spec signal (conflict / split advisory / completeness gap / ungrounded key / dangling cover) produced by a gate.
- **PREFIX whitelist** — the `specIdPrefixes` set plus `prefixRationale`, governing which spec ID anchors are admissible.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: spec-quality-gates
- **Symbols**: check-fr-coverage.mjs, check-ownership.mjs, check-spec-cohesion.mjs, check-spec-completeness.mjs, check-spec-consistency.mjs, check-test-adequacy.mjs
- **Artifacts**: —
- **Files**: tooling/check-fr-coverage.mjs, tooling/check-ownership.mjs, tooling/check-spec-cohesion.mjs, tooling/check-spec-completeness.mjs, tooling/check-spec-consistency.mjs, tooling/check-test-adequacy.mjs, tooling/__tests__/check-fr-coverage.test.mjs, tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/check-prefix.test.mjs, tooling/__tests__/check-req-prefix.test.mjs, tooling/__tests__/check-spec-cohesion.test.mjs, tooling/__tests__/check-spec-completeness.test.mjs, tooling/__tests__/check-spec-consistency.test.mjs, tooling/__tests__/check-test-adequacy.test.mjs

## Dependencies (참조 — dedup 제외)
> 이 게이트군은 키의 파싱·정규화·검증을 SPEC-001에 위임한다.
- **Modules**: key-pipeline

---

## Success Criteria (측정형)
- **SC-001**: 다섯 게이트의 테스트(`check-ownership`·`check-prefix`·`check-spec-cohesion`·`check-spec-completeness`·`check-spec-consistency`)가 모두 통과한다(현재 green).
- **SC-002**: 구조적 중복이 있는 spec 세트에서 `check-ownership.mjs`가 exit 1로 100% 검출한다(거짓음성 0).

## Non-Functional Requirements
- **NFR-001**: 모든 게이트는 결정적(동일 spec 세트 → 동일 판정)이며 자연어 NLP 없이 grep 근사만 사용한다.

## Assumptions / Clarifications Retained
- 의미적 중복(키는 다른데 의도 동일)은 이 계층이 못 잡는다 — 좁힌 사람 리뷰(SPEC_REVIEW.md)로 보완.

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 게이트 전종·전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-001(key-pipeline): 비중복 — 키 파이프라인은 참조(Dependencies), 게이트 판정만 소유.
- 2026-07-05 이웃 SPEC-007(verification-accounting)·SPEC-008(spec-lifecycle): 비중복 — 회계·수명주기 판정 코어는 각 spec 소유, 이 spec의 게이트는 소비만.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | `maxKeysPerCategoryPerSpec`를 4→6으로 상향(sdd.config.json) | 이 spec의 Symbols=5개 게이트 파일명은 한 응집 aggregate라 분할이 부적절 — 브리프 허용 config 조정으로 cohesion warn 해소 |
| 2026-07-02 | check-test-adequacy.mjs(+ 테스트) + FR-008 편입 — Symbols=6 유지(threshold 내) | spec-quality-gates aggregate의 6번째 게이트; @covers 빈 껍데기 검출은 FR coverage 게이트의 직접 보완 |
| 2026-07-02 | FR ID 레터 서픽스 지원(coverage·cohesion·completeness 공통 문법) + `check-fr-coverage.test.mjs` Files 편입 | 도그푸딩(PM솔루션): 서픽스 FR이 태그 절단 dangling·조용한 FR 미집계 유발 — /speckit.fix |
| 2026-07-02 | cohesion aggregate 임계 config화(`maxAggregateRootsPerSpec`, 기본 1) — FR-003 개정 + 테스트 | 도그푸딩(PM솔루션): aggregate 루트+자식표를 한 spec이 소유하는 모델(SPEC-004=project+9 자식표)은 별도 root 아님 — 하드코딩 `>1`을 config로 흡수 |
| 2026-07-05 | coverage·cohesion·completeness의 요구 ID 정규식을 `requirementIdPrefixes` 파생값으로 전환 + `check-req-prefix.test.mjs` Files 편입 | 진단 B-2: 사이트별 하드코딩이 접두어 확장 시 조용한 누락을 만듦 — SPEC-001 config 파생값 하나로 통일 |
| 2026-07-05 | fr 게이트에 검증 회계 계층 통합(strictSpecs 하드 R2·R3 unaccounted·accounted 리포트) — 회계 판정 자체는 SPEC-007 소유 | 진단 B-3 승인: "조용히 미검증" 제거 — 게이트 본체는 회계 코어(verification-accounting)를 소비만 |
| 2026-07-05 | completeness 게이트에 수명주기 검사 통합(Status enum·Reviewed 이상 Review Log/Dedup-Review 존재) — 판정 코어는 SPEC-008 소유 | 진단 Q3 승인(P1): 스펙 리뷰 계층 부재 — 존재만 검사(advisory, --strict 하드) |
| 2026-07-05 | FR-009 신설 — `entityRegistry`(entity→사유)로 Ownership entity를 등록제 화이트리스트로(capabilityVerbs·PREFIX 거버넌스 동형) | 진단 Q2 승인(P3a): 의미적 중복의 절차·어휘 문법화 — 신규 entity 신설이 config 리뷰 관문을 거치게 |
| 2026-07-05 | completeness 게이트에 Change Log 근거(선제 캡처) 검사 통합 — 판정 코어는 SPEC-009 소유 | SPEC-009 신설 동반: 변경 의도는 저술 시점에만 캡처 가능 — 존재만 검사(advisory, --strict 하드, SPEC-008 편입과 동형 패턴) |
| 2026-07-06 | fr 게이트에 접두어↔클래스 정합(0b) 통합, ownership 게이트에 Files 카테고리 금지, completeness 게이트에 문법 규범(Module 존재·단일성·SHALL·Dedup 참조 실재) 통합 — 판정 코어는 SPEC-012·SPEC-013 소유 | 고도화 4차: 미강제 규범(STORAGE §2.2 접두어 의미·§2.3 Module 필수·EARS SHALL·DEDUP Files 금지) 감사 결과를 게이트로 — 존재·정합 등 기계 신호만(의미 판정은 리뷰 경계, SPEC-009 편입과 동형 패턴) |
| 2026-07-06 | fr 게이트에 접두어별 spec-ID 번호 무결성(0c) 배선 — 판정 코어는 SPEC-014(numbering-lib) 소유, 본체는 hard→prefixErrors·gap advisory(--strict 승격) 호출만 | SPEC-014 신설 동반 — PREFIX 거버넌스(0)·접두어↔클래스(0b) 옆 번호 무결성(0c), 접두어별 001 순차 강제 |
| 2026-07-06 | completeness 게이트에 오브젝트 스토리지 결정 검사 배선 — 판정 코어는 SPEC-016(object-storage-lib) 소유, 본체는 마커 매치 스펙의 Object Storage Decision(Bucket·Consolidation) 존재를 findings로 호출만 | SPEC-016 신설 동반 — 스토리지 도입 시 버킷 선택·이전 기준 기록을 completeness advisory로 강제 |
| 2026-07-06 | fr 게이트 PREFIX 화이트리스트(STANDARD)에 `CICD` 편입 + 접두어↔클래스 에러/warn 메시지가 기대 접두어(INFRA/CICD)를 지목하도록 갱신 | CICD 표준 접두어 신설 동반 — 사유 없이 1급 수용, 판정 코어는 SPEC-012 |
| 2026-07-06 | completeness 게이트에 Lifecycle enum 검증 배선(있으면 removable\|permanent) — 판정 코어는 SPEC-008(lifecycle-lib) 소유, 본체는 호출만 | SPEC-008 FR-006 동반 — 선택 필드라 없으면 무관(하위호환) |
| 2026-07-06 | fr 게이트에 테스트 인프라 격리(testInfraGlobs) 배선 — 판정 코어는 SPEC-015(test-domain-lib) 소유, 본체는 호출·prefixErrors만 | SPEC-015 신설 동반 — testInfra 파일의 비-TEST 소유 차단 |
| 2026-07-09 | ownership 게이트에 Entity 관계 검사(`Dependencies.Entities`의 `Name (relation-type)` 구조화 표기 — 실재·소유 spec 해석 hard, 순환 advisory) 배선 — 판정 코어는 SPEC-017(relation-lib) 소유, 본체는 호출만 | SPEC-017 신설 동반 — 도그푸딩(FinOps): 과대 spec을 aggregate별로 쪼갤 때 쪼개진 Entity 간 관계를 적을 문법 부재 |
| 2026-07-15 | `check-fr-coverage` PREFIX 위반 에러 문자열을 `표준 SPEC/INFRA/TEST/CICD`로 | CICD 절반 롤아웃 봉합 — STANDARD 집합·DEFAULTS는 이미 4종인데 에러 메시지만 3종 잔재(4판 바이트 패리티 위해 Node·Python·셸·Go 동시) |
