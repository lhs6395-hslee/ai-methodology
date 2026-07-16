# Feature Specification: Kit CI Backstop (self-hosting gates on push/PR)

**Module**: `sdd-tooling`  **Spec**: `CICD-001`  **Created**: 2026-07-16  **Status**: Active  **Lifecycle**: permanent
**Input**: 감사(2026-07-16) M1: 킷은 `runTestsPolicy: "hard"`를 선언하고 STORAGE·SPEC-008이 "CI가 range 모드로 웹 UI 병합을 막는다"고 처방하면서, 정작 자기 레포엔 CI가 0개였다(`.github/` 부재) — 로컬 훅(수동 설치)뿐인 강제는 `--no-verify`·서버측 병합으로 전부 우회 가능. 이 스펙은 킷 자신의 CI 백스톱을 1급 산출물로 소유한다: push/PR마다 스위트+게이트, PR엔 range 모드 spec-sync(merge-base 대비, `draftBlockPolicy: "hard"` 소비).

---

## User Scenarios & Testing

### User Story 1 — 모든 push/PR이 스위트·게이트를 통과해야 한다 (P1)
main으로의 push와 모든 PR에서 GitHub Actions가 단위 스위트(`node --test tooling/__tests__/*.mjs`)와 품질 게이트 5종 + smoke 드리프트 검사를 실행한다. 어느 하나라도 non-zero면 체크 실패 — 로컬 훅을 우회한 커밋도 여기서 잡힌다.
- **Independent Test**: 파이프라인 정의는 선언적이라 유닛 비대상 — 검증은 build-evidence(실행 로그, `@verifies` 태그 → smoke 회계, SPEC-010).
- **Acceptance (GWT)**: 1. **Given** a commit that breaks a gate or a test, **When** it is pushed or opened as a PR, **Then** the workflow run fails.

### User Story 2 — 서버측 병합 경로 백스톱 (P1)
PR 이벤트에선 spec-sync 게이트를 range 모드(merge-base 대비)로 실행한다. 로컬 `commit-msg` 훅은 웹 UI 병합에 절대 실행되지 않으므로(SPEC-008 FR-007의 전제), 이 스텝이 유일한 서버측 강제 지점이다 — 킷 config의 `draftBlockPolicy: "hard"`가 여기서 소비된다.
- **Acceptance (GWT)**: 1. **Given** a PR whose diff contains code owned by a below-Reviewed spec, **When** the workflow evaluates the range against the merge base, **Then** the spec-sync step exits non-zero and the check fails.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `fetch-depth: 0` 없이는 merge-base 해석이 실패해 range 판정이 저하된다 — 워크플로가 명시적으로 전체 이력을 받는다.
- push(main) 이벤트엔 range 스텝을 걸지 않는다 — base가 자기 자신이라 판정 대상이 없다(PR 전용).
- 워크플로 자체의 변경도 이 스펙의 소유라 spec-first 대상이다(`.github/**` Files 소유 — ci 클래스 전유라 CICD- 접두어, SPEC-012).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a commit is pushed to the default branch or a pull request is opened or updated, THE SYSTEM SHALL run the unit suite, the quality gates, and the smoke-evidence drift check, failing the workflow on any non-zero exit.
- **FR-002** (event): WHEN a pull request is evaluated, THE SYSTEM SHALL additionally run the spec-sync gate in range mode against the merge base, so that server-side merges cannot bypass the locally-hooked enforcement.

### Key Entities
- **kit CI workflow** — the GitHub Actions definition that is the kit's only enforcement point surviving `--no-verify` and web-UI merges.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: kit-ci
- **Symbols**: —
- **Artifacts**: .github/workflows/sdd-gates.yml
- **Files**: .github/**

## Dependencies (참조 — dedup 제외)
> 실행되는 게이트·스위트는 각 소유 스펙의 것(이 스펙은 파이프라인 동작·정책만 소유). range spec-sync는 SPEC-003, draftBlockPolicy는 SPEC-008, 스위트 실행 규범은 SPEC-021.
- **Modules**: spec-sync (references), spec-lifecycle (references), test-execution (references)

---

## Success Criteria (측정형)
- **SC-001**: main push·PR run에서 스위트+게이트 스텝이 green(실행 로그 = smoke 증거, `@verifies` 태그로 회계).
- **SC-002**: 로컬 훅 미설치 클론에서 만든 위반 PR이 CI 체크 실패로 표면화된다(서버측 백스톱 실증).

## Non-Functional Requirements
- **NFR-001**: 워크플로는 게이트를 그대로 호출만 한다(판정 로직 신규 0) — 게이트 CLI가 CI 도구 무관이라는 범용성 보장(principles §10)을 킷 자신이 소비.

## Assumptions / Clarifications Retained
- GitHub Actions는 이 레포(정본이 GitHub)의 소비 선택이지 방법론 요구가 아니다 — 소비 프로젝트는 어느 CI/CD 도구든 같은 명령을 건다(`ci-examples.md`). 이 스펙이 소유하는 것은 킷 자신의 파이프라인 인스턴스다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-16 | 감사 구현 세션 셀프리뷰(워크플로 스텝 ↔ FR 대조, smoke 태그 회계 확인) + owner 지시("모두 구현") → Active | FR-001·002 smoke 회계(build-evidence) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-16 이웃 SPEC-004(harness-install): 비중복 — SPEC-004는 로컬 훅·스킬 "설치기", 이 spec은 서버측 CI 파이프라인 인스턴스(강제 지점이 다름: 로컬 vs 원격).
- 2026-07-16 이웃 SPEC-021(test-execution): 비중복 — SPEC-021은 `commands.test` 실행 게이트(check-test-run), 이 spec은 그 스위트를 CI에서 도는 파이프라인 정의.
- 2026-07-16 이웃 SPEC-003(spec-sync): 비중복 — 게이트 본체는 SPEC-003 소유, 이 spec은 range 모드 호출 지점(파이프라인 정책)만 소유.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-16 | 초안 — push/PR 스위트+게이트+smoke 드리프트, PR range spec-sync(merge-base·fetch-depth 0), `@verifies` 태그로 smoke 회계 | 감사 M1: `runTestsPolicy: "hard"` 선언·"CI가 웹 UI 병합을 막는다" 처방과 달리 킷 자신은 `.github/` 부재로 발동 지점 0곳 — 선언과 배선의 드리프트를 킷 자신의 CI 인스턴스로 봉합 |
