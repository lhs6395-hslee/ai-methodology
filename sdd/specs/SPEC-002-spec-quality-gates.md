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
- **판정 집합은 워킹트리, 강도는 귀속으로 가른다.** 게이트는 레포 전역을 스캔하고 commit-msg는 staged를 본다 — 그 어긋남 때문에 커밋과 무관한 untracked 파일이 커밋을 막았고, 사람은 "파일을 잠시 옮겨 커밋"이라는 우회를 배웠다(실측 제보). 스캔 범위를 `staged`로 좁히는 knob은 **기각했다**: 그러면 커밋 밖 파일의 dangling 태그가 영구히 안 보이고, 그 손실을 선택지로 내미는 것은 완화를 권장으로 올리는 것과 같다. 올바른 해소는 범위 축소가 아니라 **귀속 교정**이다 — 전역 판정을 유지하되 커밋 밖 위반은 advisory로 낮춰 오귀속 차단을 없앤다. staged를 알 수 없는 실행(커밋 밖·git 없음·CI)에서는 종전대로 전부 hard다: **CI는 전부 막는다.**
- aggregate를 **가질 수 없는** 계층(공유 설정·빌드 배선 등)은 `supportLayerSpecs`에 사유와 함께 등록한다. 그 전에는 교착이었다: entity 0개면 `entity(min)`가 막고 → 새 스펙도 같은 이유로 막혀 **분할이 불가능**해지고 → 남은 출구가 `maxFRsPerSpec` 상향(=완화, SPEC-027 래칫이 차단)뿐이었다. 등록이 푸는 것은 `entity(min)` 하나뿐이다 — 캡을 함께 풀면 교착이 아니라 규범이 사라진다. 잡동사니 서랍이 되지 않도록 사유 필수·낡은 등록 에러·entity 소유 스펙 등록 에러를 걸고, 목록은 clean일 때도 부채로 표면화한다(schema-backing 면제와 같은 경계).
- 선언된 정책이 아무것도 판정하지 않는(inert) 상태는 침묵하지 않는다 — ownership 게이트가 정책 이름과 판정 불가 사유를 매 실행 출력하고, 그 정책이 `hard`면 그것만으로 exit 1(hard 선언 + 무판정 = 거짓 안전), `advisory`면 플레인 고지 후 exit 0(정책 기본값 프로젝트를 소급 오염시키지 않는다). 판정 성립 여부는 각 판정 코어(SPEC-024 FR-005·SPEC-026 FR-006)가 사유로 반환하고, 이 게이트는 출력·exit만 담당한다. 정당한 inert의 탈출구는 그 정책을 명시적 `off`로 두는 것.
- consistency는 `## Ownership` **이전** 본문만 근거로 삼는다 — 키가 자기 선언 줄로 근거되는 것을 방지하며, 근거 없는 키는 advisory warn(비차단)이다.
- 요구 ID는 접두어(`requirementIdPrefixes` 파생, 기본 `FR`) + 3자리 + 선택적 소문자 서픽스 1자(`FR-002b`) — coverage의 FR 선언 추출, cohesion의 FR 수 집계, completeness의 FR-존재 면제 판단이 모두 config 파생값(`__frDeclRe`/`__frTokenRe`) 하나를 쓴다(사이트별 자체 정규식 = 절단 태그·조용한 FR 누락의 뿌리 — 하드코딩 사이트 금지).

---

## Functional Requirements (EARS)
> 정본은 영어. 게이트당 1 FR + PREFIX 1 FR 원칙.

- **FR-001** (event): WHEN a test file carries an `@covers <SPEC-ID>/FR-NNN` tag referencing a FR that does not exist in that spec, THE SYSTEM SHALL report an R1 dangling-reference error and exit non-zero; a spec with zero covering tests SHALL only warn (incremental adoption). — capability: **spec-quality-gates.judge** (C).
- **FR-002** (unwanted): IF two or more specs own the same normalized key within one ownership category, THEN **check-ownership.mjs** (S) SHALL report a structural-duplicate conflict and exit non-zero, while Dependencies-section keys are excluded from the duplicate check; AND WHERE `ownershipRequiredPolicy`, `crossCategoryDedupPolicy`, or `filesOverlapPolicy` is hard, it SHALL likewise fail on a spec declaring no `## Ownership` (dedup blind spot), a normalized key owned across two or more categories (per-category dedup misses), or one real file matched by two or more specs' `Files` globs (`Files` excluded from key dedup) — advisory warns and exits zero.
- **FR-003** (event): WHEN a spec owns more keys per category than `maxKeysPerCategoryPerSpec`, or declares more aggregate-root-category keys than `maxAggregateRootsPerSpec` (default 1), or — where an entity role is declared — owns keys in some category but zero aggregate-root-category keys (an entity-less bundle), or exceeds `maxFRsPerSpec` FRs, THE **check-spec-cohesion.mjs** (S) gate SHALL emit an under-fragmentation (cohesion) split advisory. WHERE a spec is listed in `supportLayerSpecs` with a non-empty reason, THE gate SHALL waive the entity-less signal alone — every cap still applies — and SHALL print the registered specs with their reasons on every run; IF a registered entry has an empty reason, names a spec that does not exist, or names a spec that owns aggregate-root keys, THEN THE gate SHALL exit non-zero before judging.
- **FR-004** (unwanted): IF a spec declares at least one FR but has no `SC-NNN` success criterion or no acceptance clause (Given/Acceptance/수용 기준), THEN **check-spec-completeness.mjs** (S) SHALL warn that the spec is incomplete.
- **FR-005** (unwanted): IF an owned key's core tokens never appear in the spec body preceding the `## Ownership` section, THEN **check-spec-consistency.mjs** (S) SHALL emit a consistency advisory that the key lacks grounding.
- **FR-006** (event): WHEN **check-fr-coverage.mjs** (S) starts, THE SYSTEM SHALL validate every spec filename prefix against `specIdPrefixes` before collecting FRs, and SHALL exit non-zero for an unregistered prefix or a non-standard prefix lacking a `prefixRationale` entry. WHERE a staged set is resolvable, THE SYSTEM SHALL keep the working-tree scan as its judgment set but SHALL downgrade violations on files outside that set to advisories, naming them as out-of-commit so that an unrelated in-progress file cannot block this commit.
- **FR-007** (state): WHILE running without `--strict`, THE **spec-quality-gates** (E) suite SHALL treat quality signals (missing ownership, cohesion, completeness, consistency, partial coverage) as non-blocking warnings and exit zero, deferring hard enforcement to `--strict`.
- **FR-008** (event): WHEN **check-test-adequacy.mjs** (S) runs over `@covers`-tagged test files, THE SYSTEM SHALL report any tagged file containing no assertion tokens (per `assertionPatterns` in config) as an adequacy violation, exiting zero in advisory mode and non-zero under `--strict`.
- **FR-009** (event): WHEN `entityRegistry` is non-empty, THE SYSTEM SHALL exit non-zero from the ownership gate for an owned aggregate-root-category key absent from the registry or a registry entry with an empty rationale (the PREFIX-governance pattern), warn for registered keys no spec owns, and stay inactive when the registry is empty (current behavior).
- **FR-010** (unwanted): IF an ownership policy is declared at a strength other than off while its evaluation is inert — no category or adapter for it to judge — THEN THE SYSTEM SHALL name the policy and every reason it cannot judge on every run, exiting non-zero when that policy is hard (a hard declaration that judges nothing is false safety) and exiting zero with a plain disclosure line when it is advisory.
- **FR-011** (event): WHEN a Capabilities key's verb is absent from the configured verb set, THE SYSTEM SHALL judge it at the strength of `capabilityVerbPolicy` (off\|advisory\|hard) independently of the `--strict` flag — hard exits non-zero on its own, unlike the other format violations FR-007 defers to `--strict` — and on every run WHERE `capabilityVerbs` registers at least one domain verb THE SYSTEM SHALL report the registered count so vocabulary growth cannot pass unremarked; AND IF `capabilityVerbs` is declared as a `{verb: reason}` object with any empty reason, THEN THE SYSTEM SHALL exit non-zero regardless of policy (the `entityRegistry` rationale pattern).

### Key Entities
- **quality finding** — a per-spec signal (conflict / split advisory / completeness gap / ungrounded key / dangling cover) produced by a gate.
- **PREFIX whitelist** — the `specIdPrefixes` set plus `prefixRationale`, governing which spec ID anchors are admissible.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: spec-quality-gates
- **Symbols**: check-fr-coverage.mjs, check-ownership.mjs, check-spec-cohesion.mjs, check-spec-completeness.mjs, check-spec-consistency.mjs, check-test-adequacy.mjs
- **Artifacts**: —
- **Capabilities**: spec-quality-gates.judge
- **Files**: tooling/check-fr-coverage.mjs, tooling/check-ownership.mjs, tooling/check-spec-cohesion.mjs, tooling/check-spec-completeness.mjs, tooling/check-spec-consistency.mjs, tooling/check-test-adequacy.mjs, tooling/__tests__/check-fr-coverage.test.mjs, tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/check-prefix.test.mjs, tooling/__tests__/check-req-prefix.test.mjs, tooling/__tests__/check-spec-cohesion.test.mjs, tooling/__tests__/check-spec-completeness.test.mjs, tooling/__tests__/check-spec-consistency.test.mjs, tooling/__tests__/check-test-adequacy.test.mjs

## Dependencies (참조 — dedup 제외)
> 이 게이트군은 키의 파싱·정규화·검증을 SPEC-001에 위임한다.
- **Modules**: key-pipeline (references)

---

## Success Criteria (측정형)
- **SC-001**: 다섯 게이트의 테스트(`check-ownership`·`check-prefix`·`check-spec-cohesion`·`check-spec-completeness`·`check-spec-consistency`)가 모두 통과한다(현재 green). [검증: tooling/__tests__/check-fr-coverage.test.mjs, tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/check-prefix.test.mjs]
- **SC-002**: 구조적 중복이 있는 spec 세트에서 `check-ownership.mjs`가 exit 1로 100% 검출한다(거짓음성 0). [검증: tooling/__tests__/check-fr-coverage.test.mjs, tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/check-prefix.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 모든 게이트는 결정적(동일 spec 세트 → 동일 판정)이며 자연어 NLP 없이 grep 근사만 사용한다. [검증: tooling/__tests__/check-fr-coverage.test.mjs, tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/check-prefix.test.mjs]

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
| 2026-08-10 | `check-fr-coverage`가 R1d·R1e의 어휘·확장자를 config에서 주입받도록 배선(`localHostPatterns`·`implModuleExtensions`·`implReferenceProseRegex` 기본값을 코어 선언에서 가져온다) | 오너 규범(하드코딩 지양) — 게이트에 인라인 문자열로 박혀 있던 기본값을 소유 코어의 export로 옮겼다. 같은 사실에 값이 둘이면 한쪽만 갱신돼 두 판정이 갈린다 [검증: tooling/__tests__/impl-reference.test.mjs] |
| 2026-08-10 | `check-ownership`에 지원 계층 출구 배선(SPEC-024 판정 소비) + `check-sc-coverage`에 선언 형식 드리프트 표면화(SPEC-034 판정 소비) | 두 판정 모두 소유 스펙이 규범을 정하고 이 spec은 **배선만** 갖는다(품질 게이트군의 소비 지점). 형식 드리프트는 강도 무관 표면화다 — 사실의 노출은 정책이 정하는 것이 아니다 [검증: tooling/__tests__/check-ownership.test.mjs] |
| 2026-08-27 | FR-011 신설 — 미등록 verb 판정을 `capabilityVerbPolicy`(off\|advisory\|hard, 기본 advisory)로 전역 `--strict`에서 독립시켜 hard가 `--strict` 없이도 exit 1하게 하고, `capabilityVerbs` 등록 개수를 매 실행 표면화하며, 객체형(`{동사:사유}`)의 빈 사유는 정책 무관 항상 에러(entityRegistry 패턴) | 감사 이슈 #21 E-5 — 미등록 verb는 warn 뒤 `--strict`가 있어야 exit 1인데 훅·CI 기본 호출 어디도 `--strict`를 안 넘겨 hard가 실전에서 한 번도 발화하지 않았다("등록 안 해도 통과"). 동시에 어휘 확장이 사유·흔적 없이 배열에 그냥 추가됐다(entityRegistry·entitySchemaExemptEntities·policyRatchetExceptions는 이미 사유를 요구하는데 capabilityVerbs만 예외). 형식·config 파생값은 SPEC-001 소관, 이 spec은 게이트 강도·리포트 배선만 [검증: tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-27 | `check-ownership`·`check-spec-consistency`에 세 판정 배선: ① Dependencies 선언 capability도 형식·유령 entity 검사(SPEC-024 FR-006 판정 소비, 이슈 #21 E-1), ② 글롭 키(`*` 포함)를 FR 키 앵커 요구에서 제외 + 정규화 canonical 형태도 앵커로 인정(SPEC-023 B-1/B-3 판정 소비), ③ `[id]` 대괄호 param 문법 정규화(SPEC-001 M-12 판정 소비) | 규범은 각 소유 스펙이 정하고 이 spec은 소비 지점 배선만 갖는다(같은 패턴 반복). 감사 이슈 #21 발견 3건이 이 spec의 게이트 두 개(ownership·consistency)에 동시에 착지해 한 항목으로 묶었다 [검증: tooling/__tests__/check-ownership.test.mjs, tooling/__tests__/key-anchor.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | `check-fr-coverage`에 R1e(지목 구현체 참조, SPEC-046) 배선 + 규범 선언 라인(FR·NFR·SC) 별도 수집 + 파일 본문 읽기 캐시 | 제보 사례 4: FR이 지목한 함수가 표면에서 불리지 않고 쉘 재구현이 대신 돌아 19건이 배포 범위에서 조용히 누락됐다. 규범 선언 집합을 SPEC-042의 FR-only 집합과 **분리**한 이유는 넓히면 다른 축의 판정 범위가 조용히 바뀌기 때문이다(킷 실측: 지목 구현체는 SC·NFR 라인에 많다). R1d·R1e가 같은 파일을 두 번 읽지 않게 캐시를 둔다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | `check-fr-coverage`가 spec 파일명 판정을 SPEC-001의 정본(`isSpecMdName`)으로 위임 | 자체 정규식을 들고 있던 것을 R13 구현 중복이 잡았다. 판정 동작은 불변(출력 바이트 동일) [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | `check-fr-coverage`에 R1c(의미 커버리지, SPEC-042)·R1d(결정 입도, SPEC-044) 배선, `check-spec-completeness`에 근거 적용범위(SPEC-043) 배선 + 개별 축의 hard 승급이 `--strict` 없이도 그 항목만 차단하도록 렌더·종료 경로 확장 | 소비 프로젝트 제보: 스펙과 코드가 어긋난 채 모든 게이트가 green을 유지한 사례 3건 — 공통 원인은 게이트가 "연결의 존재"만 보고 "연결의 진위"를 안 본다는 것이다. 판정 코어는 각 spec이 소유하고 이 spec은 **배선만** 갖는다(품질 게이트군의 소비 지점). hard 승급이 `--strict`에서만 실효를 가지면 "hard로 올렸다"는 선언이 거짓이 되므로 승급 축은 즉시 차단한다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | `maxKeysPerCategoryPerSpec`를 4→6으로 상향(sdd.config.json) | 이 spec의 Symbols=5개 게이트 파일명은 한 응집 aggregate라 분할이 부적절 — 브리프 허용 config 조정으로 cohesion warn 해소 |
| 2026-07-02 | check-test-adequacy.mjs(+ 테스트) + FR-008 편입 — Symbols=6 유지(threshold 내) | spec-quality-gates aggregate의 6번째 게이트; @covers 빈 껍데기 검출은 FR coverage 게이트의 직접 보완 |
| 2026-07-02 | FR ID 레터 서픽스 지원(coverage·cohesion·completeness 공통 문법) + `check-fr-coverage.test.mjs` Files 편입 | 도그푸딩(소비 프로젝트 A): 서픽스 FR이 태그 절단 dangling·조용한 FR 미집계 유발 — /speckit.fix |
| 2026-07-02 | cohesion aggregate 임계 config화(`maxAggregateRootsPerSpec`, 기본 1) — FR-003 개정 + 테스트 | 도그푸딩(소비 프로젝트 A): aggregate 루트+자식표를 한 spec이 소유하는 모델(SPEC-004=project+9 자식표)은 별도 root 아님 — 하드코딩 `>1`을 config로 흡수 |
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
| 2026-07-09 | ownership 게이트에 Entity 관계 검사(`Dependencies.Entities`의 `Name (relation-type)` 구조화 표기 — 실재·소유 spec 해석 hard, 순환 advisory) 배선 — 판정 코어는 SPEC-017(relation-lib) 소유, 본체는 호출만 | SPEC-017 신설 동반 — 도그푸딩(소비 프로젝트 B): 과대 spec을 aggregate별로 쪼갤 때 쪼개진 Entity 간 관계를 적을 문법 부재 |
| 2026-07-15 | `check-fr-coverage` PREFIX 위반 에러 문자열을 `표준 SPEC/INFRA/TEST/CICD`로 | CICD 절반 롤아웃 봉합 — STANDARD 집합·DEFAULTS는 이미 4종인데 에러 메시지만 3종 잔재(4판 바이트 패리티 위해 Node·Python·셸·Go 동시) |
| 2026-07-15 | cohesion FR 카운터를 `__frTokenRe`(평문 토큰) → `__frDeclRe`(`**FR-NNN**` 정의)로 + 회귀 테스트 | 도그푸딩(소비 프로젝트 B): Change Log·근거 문단의 FR 인용이 정의로 오집계돼 "FR 15>11" 오탐(실 본문 13) — coverage와 동일 사이트(정의만) 통일 |
| 2026-07-15 | `check-fr-coverage`가 Status: Planned 스펙을 파싱해 `plannedSpecs`를 회계 코어에 전달 + 리포트에 `planned:` 세그먼트·R2 "planned" 메시지 | SPEC-018 FR-005 동반: fr 게이트 본체가 Planned 회계를 배선(판정 코어는 SPEC-007, enum은 SPEC-008) |
| 2026-07-16 | fr 게이트가 `cfg.retiredIds`를 `numberingIssues`에 전달 — 폐기 gap이 잡음으로 뜨지 않게 배선(판정 코어는 SPEC-014) | SPEC-018 FR-006 동반: 번호 무결성 호출부가 retiredIds를 전달하는 배선점 |
| 2026-07-16 | fr 게이트에 Planned↔커버리지 모순 검사 편입 — Status Planned인데 unit 커버 FR 실재면 exit 1(판정 FR은 SPEC-018 FR-007 소유, 이 spec은 fr 게이트 본체 배선) | 감사 T2 동반: Active→Planned 뒤집기로 strictSpecs·R3를 침묵시키는 회계 침묵기 경로 차단 |
| 2026-07-17 | consistency 게이트에 FR 키 앵커 대조 배선(SPEC-023 소비) — 정책 off면 판정·출력 무변, 스캔 순서 정렬(결정성) | SPEC-023 동반: 키→본문 근거(기존)와 본문 bold→키(신규)의 양방향 앵커 — 게이트 본체는 이 spec 소유 |
| 2026-07-20 | ownership 게이트에 Capability 귀속 대조 배선(SPEC-024 소비) — entity·capability 카테고리 공존 시에만, 정책 off면 출력 무변 | SPEC-024 동반: 스펙 경계=entity 기준의 기계 신호(게이트 본체는 이 spec 소유) |
| 2026-07-21 | ownership 게이트에 Entity 스키마 백킹 대조 배선(SPEC-026 소비) — 구조 SSOT 파일 글롭 수집·추출 후 소유 entity 대조, 정책 off/소스 없음/entity 카테고리 없음이면 출력 무변. consistency 게이트에 (E) 엔티티 마커 대조 배선(SPEC-023 확장) | SPEC-026·023 동반: 유령 entity 차단 + FR entity 앵커 (E) 표기(게이트 본체는 이 spec 소유) |
| 2026-07-21 | ownership 게이트에 `validateSchemaPatterns` 배선 — 잘못된 `entitySchemaSources` 정규식을 명확한 config 에러(exit 1)로 보고(크래시 방지, SPEC-026 소비) | SPEC-026 하드닝 동반: 게이트 배선점이 불투명 크래시 대신 명확 안내 |
| 2026-07-21 | ownership 게이트에 면제 부채 표면화 배선(SPEC-026 FR-005 소비) — 사용 중 `entitySchemaExemptEntities`를 매 실행 advisory로 출력(hard에서도) | SPEC-026 FR-005 동반: 대량 면제가 조용한 '완료'로 읽히지 않게(게이트 본체는 이 spec 소유) |
| 2026-07-21 | consistency 게이트의 (E) 마커 배선을 **카테고리 마커(E/R/C)** 로 일반화(SPEC-023 FR-005 확장 소비) — `buildKeyKindMap`+`categoryMarkerFindings`+`frAnchorMarkers` 소비, 굵은 키마다 종류 대조(누락·불일치) | SPEC-023 FR-005 일반화 동반: 굵은 키의 카테고리 구분(게이트 본체는 이 spec 소유) |
| 2026-07-21 | consistency 게이트에 FR-006 배선(백틱에 든 선언 키 → 앵커 승격 위반) — `backtickKeyFindings` 소비, "굵게 ⟺ 사유 있는 키" 규율 완성 | SPEC-023 FR-006 동반: 키를 백틱에 두는 것 금지(게이트 본체는 이 spec 소유) |
| 2026-07-21 | consistency 게이트에 FR-007 배선(소유 키 앵커 강제) — `unanchoredOwnedKeyFindings` 소비, 소유 키가 FR에 굵게 앵커 안 되면 위반 | SPEC-023 FR-007 동반: (B) 모든 키 참조 앵커 강제(게이트 본체는 이 spec 소유) |
| 2026-07-27 | consistency 게이트의 마커 fallback 기본값 surface `(R)`→`(S)` | SPEC-023 Change Log 동반: 마커 글자를 카테고리 머리글자(E/S/C)로 통일 — 배선 로직 불변, fallback 리터럴만 |
| 2026-07-27 | ownership 게이트에 정책 inert 고지 배선(FR-010 신설 — capability 귀속·entity 스키마 백킹의 inert 사유 출력, hard면 차단·advisory면 플레인 고지) + Edge Case 1건 | 감사 이슈 #21 A-1·A-3: `hard` 선언된 정책 2종이 카테고리 개명·`entitySchemaSources: []` 한 줄로 완전 no-op이 되면서 스킵 신호가 전무했다(유령 entity가 `✓ 구조적 중복 없음` exit 0으로 통과). 선언과 실제 판정의 괴리를 매 실행 표면화 |
| 2026-07-27 | ownership 게이트에 `exemptGlobFindings` 배선(카테고리 Files 금지와 동형 — 파싱 전 config 검증) | SPEC-013 FR-007 동반: 면제 목록 무결성(판정 코어는 SPEC-013 소유) |
| 2026-07-27 | ownership·cohesion 게이트가 `cfg.__roles`를 소비하도록 배선(자체 이름 추측·`CATEGORIES[0]` 폴백 제거) | SPEC-001 FR-010 동반: 역할 판정의 단일 소스화 |
| 2026-07-27 | FR-002~008 문장의 익명 주어 `THE SYSTEM`을 실제 판정 주체로 교체해 소유 키 7종을 앵커(FR-002 check-ownership.mjs·FR-003 check-spec-cohesion.mjs·FR-004 check-spec-completeness.mjs·FR-005 check-spec-consistency.mjs·FR-006 check-fr-coverage.mjs·FR-007 spec-quality-gates(E)·FR-008 check-test-adequacy.mjs) — 백틱 인용 2건은 앵커로 승격, 판정 내용 무변 | SPEC-001 FR-010으로 역할 선언이 들어오며 SPEC-023 키 앵커(FR-005·006·007)가 킷 자신에게 처음 발화 — 자기적용 마이그레이션(감사 이슈 #21) |
| 2026-07-27 | fr 게이트에 FR 번호 무결성 배선(1b) — 스펙별 FR 선언 목록을 순서 그대로 수집(`Set`은 중복을 삼킨다)해 중복 hard·001미시작/결번 advisory를 판정 코어에 위임 | SPEC-014 FR-005/006 동반: 판정 코어는 SPEC-014 소유, FR 선언을 이미 파싱하는 이 게이트가 소비 지점 |
| 2026-07-28 | fr·cohesion 게이트의 FR 선언 수집을 SPEC-013 FR-008 단일 범위 판정(`frDeclarations`)으로 교체 — `specs`(R1/R2 대조 집합)·`frDecls`(중복 판정 입력)·cohesion `countFRs` 세 지점 동시. 별건 패리티 봉합: R2 missing 목록을 정렬(Python은 sorted, Node는 선언 순서였다) | SPEC-014 FR-005 오탐 실측(PM Change Log 표 행 12건 거짓 중복) + cohesion `countFRs` 주석이 "Change Log 인용 제외"라고 적혀 있었으나 실제로는 전문을 긁어 FR 수를 부풀리던 문서-동작 불일치. 정렬 결함은 FR을 번호 순이 아니게 선언한 소비 프로젝트에서만 발현(킷 자기적용 green이 은폐) |
| 2026-07-28 | completeness 게이트의 SHALL 판정 호출에 `cfg.__reqAlt` 주입 — 라인 규율이 SPEC-013 FR-003의 `isFrDeclLine`으로 바뀌며 접두어 alternation이 호출부 책임이 됐다. 자기 테스트의 "완비" 픽스처도 실제 EARS 준수로 교정(`**FR-001** a` → SHALL 포함) | SPEC-013 FR-003 동반. 픽스처는 SHALL이 없는데 "구비" 통과를 주장하고 있었다 — 불릿 필수 라인 규율의 거짓 음성에 의존하던 테스트라, 구멍을 막자 자기 스위트에서 먼저 터졌다. `__reqAlt` 미주입은 다중 접두어 사이트의 INFRA 선언을 무검사로 만드는 함정(실측 finops 11줄) |
| 2026-07-28 | `check-ownership.mjs`에 심볼 실재 판정 배선 — 소유 surface 중 파일형 키를 소스 루트 실재 집합과 대조, inert는 매 실행 표면화하고 `hard`+inert는 exit 1. entity 백킹 호출에 스펙별 슬러그 맵 전달 | SPEC-029 FR-003·FR-005·FR-007. 게이트 본체는 이 spec 소유이므로 배선이 여기 이력으로 남는다(판정 코어는 SPEC-029 소유) |
| 2026-07-28 | consistency 게이트의 백틱 키 판정이 entity를 제외하도록 코어 변경을 소비 — 출력 문구·강도 불변 | SPEC-023 FR-006 축소 반영. 게이트 본체는 이 spec 소유이므로 배선 이력을 남긴다 |
| 2026-07-28 | cohesion의 aggregate root 초과 처방을 교정 — "capability별 분할 검토" → "root 1개만 남기고 나머지는 Dependencies의 `이름 (relation-type)`으로 이관(SPEC-017), 그래도 남으면 분할". ownership 게이트에 관계 침묵 표면화 배선 | 처방이 틀렸다. aggregate root가 여러 개인 스펙의 정답은 대개 분할이 아니라 **relation 이관**인데 게이트가 그 경로를 지목하지 않아, 읽는 사람이 유일한 해법을 분할로 오해했다(실측: PM SPEC-005 root 7개). ENT_CAT 주석의 낡은 서술(이름 정규식 우선)도 역할 선언 우선으로 교정 — 코드는 이미 맞았고 주석만 틀렸다 |
| 2026-07-28 | `check-ownership.mjs`의 관계 이름 정규화 배선 — 소유자 색인과 같은 `normalizeKey`를 거치게 | SPEC-017 결함 수정의 소비. 게이트 본체는 이 spec 소유이므로 배선 이력을 남긴다. 판정 강도·출력 문구 불변 |
| 2026-07-28 | `check-ownership.mjs`의 심볼 실재 집합을 3형태(basename·상대경로·확장자 없는 상대경로)로 확장 | SPEC-029 FR-008 소비. 게이트 본체는 이 spec 소유. 판정 강도·출력 문구 불변 |
| 2026-07-29 | cohesion에 **aggregate root 최소 하한** 배선(FR-003 확장, MAX의 거울) — entity 역할이 선언됐는데 키를 하나라도 소유하면서 aggregate root 칸이 0개면 'entity 없는 번들'로 분할 권고(advisory·--strict hard). Node·Python 바이트 패리티 | owner #1 지적("entity가 없어도 같은 스펙에 묶임") 기계화 + 감사(#21) entityless-bundling·mece-3: Surface/Capability만 소유한 entity 0 스펙이 all-hard에서도 진공 통과하던 구멍. 역할 미선언(순수 lib)이면 inert(하위호환), 킷 자신은 전 스펙 Modules(=entity) 소유라 green |
| 2026-07-29 | cohesion의 capability 캡을 **entity별 카운트**로 — 총 capability 수가 아니라 소유 entity 1개당 verb 수로 판정(다-entity 스펙·full-CRUD의 거짓 분할 신호 제거). Node·Python 패리티 | 감사(#21) oc-3·gran-4: SPEC-024가 한 entity의 verb를 같은 스펙에 강제하는데 cohesion이 총합으로 캡을 걸어 두 규칙이 정면 충돌. entity별 최대 ≤ 총합이라 **순수 완화**(위반 추가 없이 거짓양성만 제거 — 소비 프로젝트 무파손) |
| 2026-07-29 | check-ownership에 **구조 문법 잔여 3종(FR-002 확장)** — `ownershipRequiredPolicy`(미선언 강제)·`crossCategoryDedupPolicy`(카테고리 간 동일 키)·`filesOverlapPolicy`(Files glob 겹침). 기본 advisory(소급 범람 방지), 킷은 hard로 닫음. Node·Python 바이트 패리티 | owner "스펙 정의·리스트·중복차단 문법의 남은 구멍을 지금 닫아라". 감사: dedup가 ①미선언 스펙 사각 ②카테고리 내부 한정(cross-category 미검출) ③Files 유일성 밖이던 3구멍. G2·G3는 순수 신규 검출(위반 추가만) |
| 2026-08-02 | cohesion에 `supportLayerSpecs` 등록부 — entity 없는 지원 계층의 `entity(min)`만 면제(캡 불변) + 무결성 3종(사유 필수·낡은 등록·entity 소유 등록) + 등록 목록 상시 표면화. FR-003 개정 | 실측 제보(gsn-aiops-finops-module): aggregate를 가질 수 없는 계층이 FR 캡을 넘겼을 때 **분할이 구조적으로 불가능**해 남은 출구가 캡 상향(완화)뿐인 교착이 생겼다. 교착의 정답은 캡을 푸는 것이 아니라 분할을 가능하게 하는 것이다 [검증: tooling/__tests__/check-spec-cohesion.test.mjs] |
| 2026-08-02 | `check-fr-coverage`에 Change Log↔FR 실재 대조 배선(SPEC-037 코어 소비) — `changeLogFrRefPolicy` enum 검사 + 위반 출력, 정책이 off면 판정 자체를 건너뛴다 | 판정 코어는 SPEC-037이 소유하고 이 게이트는 배선·출력만 담당한다(같은 사실을 두 게이트가 각자 판정하지 않게). FR 선언 파싱은 기존 `frDeclarations`를 그대로 재사용 — 사이트별 자체 정규식 금지 규칙 유지 [검증: tooling/__tests__/changelog-fr.test.mjs] |
| 2026-08-03 | dedup 경계 명시 — 구현 중복(SPEC-038)은 이 스펙 소유가 아니다. `spec-sync-lib`에 `parseFilesLine` 신설로 세 게이트(deploy-guard·ownership·pre-edit)의 Files 라인 정규식 3중복을 단일 사이트로 통합 | 새 게이트가 도입 즉시 킷 자기적용에서 실수확한 첫 건이다. Files 라인 문법은 **스펙 문법**이라 사이트마다 정규식을 두면 문법이 바뀔 때 한 곳만 고쳐지고 나머지는 조용히 뒤처진다(자체 정규식 금지 규칙과 같은 이유) [검증: tooling/__tests__/duplicate-logic.test.mjs] |
| 2026-08-04 | R1b 배선 — `check-fr-coverage`가 SPEC-039 결속 코어를 소비(태그↔FR 검증 목록 대조) + FR 선언 라인의 `[검증]` 경로 수집. 그리고 FR-006 개정: dangling 위반의 **강도를 귀속으로 가른다**(커밋 밖 파일은 advisory). Node·Python 바이트 패리티 | 실측 제보 2건: ① R1이 단방향이라 다른 세션이 같은 번호로 무관한 기능을 착지시키면 위반이 사라지고 회계가 "커버됨"을 보고했다 — 실재는 동일성이 아니다. ② 게이트는 워킹트리를, commit-msg는 staged를 봐서 커밋과 무관한 untracked 파일이 커밋을 막고 "파일을 옮겨 커밋"이라는 우회를 유발했다. 범위를 좁히면 커밋 밖 dangling이 영구히 안 보이므로 범위가 아니라 귀속을 고쳤다 [검증: tooling/__tests__/covers-backlink.test.mjs] |
| 2026-08-09 | `check-spec-consistency`가 Ownership 경계를 `bodyBeforeOwnership`(SPEC-001)로 위임 | 자체 정규식이 `gen-ownership-map`의 것과 복제 상태였다(R13 실측). 판정 내용은 불변 — 경계 정의의 정본을 key-pipeline으로 옮겼다 |
| 2026-08-10 | `check-fr-coverage`의 스테이징 집합 조회에 `core.quotepath=off` 적용 | 실측: git이 비ASCII 경로를 8진수 문자열로 **인용해서** 내면 그 문자열은 어떤 소유 글롭과도 매치하지 않아 **커밋 귀속이 조용히 사라진다** — 위반이 통과로 흐른다. 규범이 아니라 소스 전수 열거로 못박았다(SPEC-006 SC-003) |
| 2026-08-10 | `check-ownership`이 이름 추론된 역할을 매 실행 자백하고, `check-spec-cohesion`이 **첫 카테고리 위치 추측**을 자백한다(양판) | cohesion의 `CATEGORIES[0]` 폴백은 순수한 **위치 추측**이다 — 순서가 의미를 갖는다는 근거는 어디에도 없다. 이전 판은 그것을 조용히 했고, aggregate root 판정 대상이 엉뚱한 카테고리가 되어도 아무 출력이 없었다. 막지 않는다(하위호환) — 추측했다는 사실을 말한다 |
