# Feature Specification: Spec Lifecycle Status & Review Gate

**Module**: `sdd-tooling`  **Spec**: `SPEC-008`  **Created**: 2026-07-05  **Status**: Active
**Input**: 스펙 헤더 `Status:`를 수명주기 enum(Draft→Reviewed→Approved→Active→Deprecated→Removed)으로 문법화하고, 리뷰 없는 스펙이 코드를 이끄는 구멍을 닫는다 — Draft 스펙의 소유 코드 변경은 spec-sync가 차단하고, Reviewed 이상은 리뷰 기록(Review Log·Dedup-Review)의 존재를 completeness가 검사한다.

---

## User Scenarios & Testing

### User Story 1 — 리뷰를 통과한 스펙만 코드를 이끈다 (P1)
기존 파이프라인은 "스펙 동반"은 강제해도 "그 스펙이 리뷰됐는가"는 묻지 않았다(진단 Q3: 스펙 리뷰 계층 부재). 이제 스펙은 상태를 선언하고, Draft 상태의 스펙이 소유한 코드가 변경되면 commit-msg(staged) 훅이 스펙 동반 여부와 무관하게 차단한다. 탈출구는 기존과 동일한 `Spec-Impact: none <사유>` 트레일러 하나뿐이다(정직·영속). 강제하는 것은 **상태 순서**(Draft면 코드 금지)지 시간 순서가 아니므로, 브랜치 단위 작업 설계와 충돌하지 않는다.
- **Independent Test**: `spec-lifecycle.test.mjs`가 임시 git 저장소에서 Draft 차단·트레일러 탈출·Active 통과를 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a staged code file owned by a spec whose Status is Draft, **When** the commit-msg hook runs spec-sync, **Then** it exits non-zero even if the spec itself was meaningfully edited in the same changeset.

### User Story 2 — Reviewed 전이는 기록을 남겨야 한다 (P1)
`/speckit.analyze`·`/checklist`는 실행 여부를 검사하는 게이트가 없어 건너뛰어도 표가 안 났다. Reviewed 이상 상태는 `## Review Log`(일시·수행자·판정)와 `## Dedup-Review`(검토한 이웃 스펙 ID+판정, 또는 명시적 "이웃 없음")의 **존재**를 completeness 게이트가 검사한다 — 두 기록을 한 리뷰 절차로 통합해 중복 검토 마찰을 줄인다(P3 연동). 판정·근거의 질은 기계가 못 보므로 존재·형식만 강제한다(DEDUP.md 경계 유지).
- **Independent Test**: `spec-lifecycle.test.mjs`가 기록 없는 Reviewed+/기록 있는 spec/플레이스홀더-만 기록의 분기를 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec with Status Active and no Review Log entry, **When** the completeness gate runs, **Then** it reports the missing review record (advisory; non-zero under `--strict`).

### Edge Cases
- Status 헤더가 없는 레거시 스펙은 수명주기 강제 밖이다 — completeness가 warn으로 표면화만 하고(점진 도입), Draft 차단은 적용되지 않는다(advisory → strict 승격 경로).
- index에서 삭제 중인 스펙은 Draft여도 차단하지 않는다(수명 종료 경로는 기존 삭제-가시화 규칙이 담당).
- Review Log의 플레이스홀더 행(`[YYYY-MM-DD]`)은 기록이 아니다 — 실제 일시(YYYY-MM-DD)가 있어야 기록으로 인정.
- Dedup-Review는 이웃이 정말 없으면 "이웃 없음" 명시로 충족된다(빈 섹션은 불충족).
- enum 밖 Status 값은 미정의 상태로 warn된다 — 프로젝트 임의 상태 신설 금지(문법화).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a spec declares a `Status` header, THE SYSTEM SHALL accept only the lifecycle enum Draft, Reviewed, Approved, Active, Deprecated, Removed, and the completeness gate SHALL flag an out-of-enum value or a missing header (advisory; hard under `--strict`).
- **FR-002** (state): WHILE a spec's Status is Reviewed, Approved, or Active, THE SYSTEM SHALL require at least one `## Review Log` entry with a real date, actor, and verdict, flagged by the completeness gate when absent.
- **FR-003** (state): WHILE a spec's Status is Reviewed, Approved, or Active, THE SYSTEM SHALL require a `## Dedup-Review` record naming at least one reviewed neighbor spec ID (or an explicit no-neighbor statement), flagged by the completeness gate when absent.
- **FR-004** (unwanted): IF a changed code file is owned by a spec whose Status is Draft, THEN the spec-sync gate SHALL report a violation regardless of accompanying spec edits — hard in staged mode, advisory in range mode — escapable only via the `Spec-Impact: none` trailer with a reason.
- **FR-005** (ubiquitous): THE SYSTEM SHALL treat specs without a Status header as legacy outside lifecycle enforcement — surfaced as a completeness warning, exempt from the Draft block — so adoption proceeds spec-by-spec.
- **FR-006** (state): WHILE a spec carries a `Lifecycle` header, THE SYSTEM SHALL require its value to be one of `removable|permanent` and SHALL warn (hard under `--strict`) otherwise; absence is permitted (optional field, orthogonal to Status), so removable non-product tooling is machine-distinguishable from permanent product specs.
- **FR-007** (state): WHILE `draftBlockPolicy` is `hard`, THE SYSTEM SHALL treat an FR-004 Draft-block violation as a hard error (non-zero exit) in range mode too, not only staged mode; WHILE `draftBlockPolicy` is `advisory` (default), range mode SHALL keep its existing non-blocking behavior; an out-of-enum value SHALL exit non-zero. This lets a CI job that runs the spec-sync gate in range mode against a merge base (the only enforcement point a git-hosting UI's server-side merge cannot skip, since local `commit-msg` hooks never run there) actually block the merge on a Draft-owned code change.

### Key Entities
- **lifecycle status** — the declared review state of one spec, drawn from the six-value enum; state order (not temporal order) is what gates enforce.
- **review record** — the Review Log entry (date·actor·verdict) and Dedup-Review entry (neighbor IDs + verdict) whose existence marks the Reviewed transition.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: spec-lifecycle
- **Symbols**: lifecycle-lib.mjs
- **Artifacts**: —
- **Files**: tooling/lifecycle-lib.mjs, tooling/__tests__/spec-lifecycle.test.mjs

## Dependencies (참조 — dedup 제외)
> 소비 게이트 본체는 SPEC-002(completeness)·SPEC-003(spec-sync) 소유 — 이 spec은 수명주기 문법·판정 코어만 소유. Python 복제는 SPEC-006.
- **Modules**: spec-quality-gates, spec-sync, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `spec-lifecycle.test.mjs` 전 케이스 green + completeness 수명주기 출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포의 전 스펙이 Status 선언 + Reviewed 이상은 Review Log·Dedup-Review 기록 구비(completeness 수명주기 warn 0건).

## Non-Functional Requirements
- **NFR-001**: 수명주기 판정은 순수 텍스트 파서로 결정적이며, 리뷰 내용의 질(판정 타당성)은 판정하지 않는다.

## Assumptions / Clarifications Retained
- Deprecated/Removed 상태는 리뷰 기록 요구 대상이 아니다 — 수명 종료 스펙에 소급 기록을 강요하지 않는다(폐기 절차는 STRUCTURE.md).
- Reviewed→Approved 승인 주체(사람 서명 등)의 진위는 기계가 못 본다 — 기록의 존재만 강제, 승인 문화는 팀 규율.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(게이트 전종 + spec-lifecycle/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-05 이웃 SPEC-002(spec-quality-gates): 비중복 — completeness 게이트 본체는 SPEC-002 소유, 이 spec은 수명주기 판정 코어만 소유.
- 2026-07-05 이웃 SPEC-003(spec-sync): 비중복 — Draft 차단은 spec-sync가 소비하는 상태 판정이며 changeset 판정(SPEC-003)과 직교.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-05 | 초안 — Status enum 문법화 + Draft 차단 + Reviewed 이상 리뷰 기록 존재 검사(Node·Python 동시) | 진단 Q1·Q3 승인(P1): 스펙 리뷰 계층 부재 — 상태 순서 강제, advisory→strict 승격 경로 |
| 2026-07-06 | Dedup-Review 기록의 형식 검사에 참조 실재(dangling 이웃 ID) 판정이 연장됨 — 판정 코어(grammar-lib)는 SPEC-013 소유, 이 spec의 존재 판정은 불변(테스트 픽스처만 Module·SHALL 규범에 정렬) | SPEC-013 신설 동반 — 기록이 언급한 스펙 ID의 실재까지가 "형식", 내용의 질은 여전히 리뷰 몫 |
| 2026-07-06 | FR-006 신설 — `Lifecycle: removable\|permanent` 선택 필드(lifecycle-lib `parseLifecycle`·`LIFECYCLE_ENUM`), completeness가 있으면 enum 검증(--strict 하드), Node·Python 패리티 | SPEC-015(TEST 삭제가능 도메인) 동반 — 제품 vs 임시 도구를 기계가 구분(Status와 직교한 수명 성격) |
| 2026-07-09 | FR-007 신설 — `draftBlockPolicy`(advisory\|hard) config knob, Node·Python 패리티(check-spec-sync.mjs·sdd_gates.py) | 도그푸딩(FinOps): CICD-001이 Draft인데 Jenkinsfile이 `Merge branch '...' into 'main'`(GitLab 웹 UI 병합)로 여러 커밋 통과 — 로컬 commit-msg 훅은 웹 UI 병합엔 절대 실행되지 않고, FinOps Jenkinsfile엔 `sdd_gates.py` 호출 자체가 없어 range advisory조차 안 돔[검증]. "채택=상시 강제"가 로컬 훅 전용이라 서버측 병합엔 무력했던 구조적 사각지대 — CI가 range 모드로 이 knob을 `hard`로 켜면 MR 파이프라인에서 막을 수 있게 승격 |
