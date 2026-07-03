# Feature Specification: Adoption Lifecycle Commands

**Module**: `sdd-tooling`  **Spec**: `SPEC-005`  **Created**: 2026-07-03  **Status**: Active
**Input**: 채택 수명주기(adoption lifecycle)의 세 진입 명령 — `/sdd-start`(최초 채택)·`/sdd-readopt`(완전 재채택)·`/sdd-update`(평상시 동기화) — 을 설치형 스킬로 정의한다. 각 스킬은 `prompts/`의 정본 절차를 일관되게 실행하고, 작성=LLM·확정=사람 게이트와 재채택 안전망을 불변식으로 강제한다.

---

## User Scenarios & Testing

### User Story 1 — 최초 채택 (/sdd-start) (P1)
SDD가 없던 프로젝트에서 `/sdd-start`를 부르면, 에이전트가 `prompts/adopt.md`를 실행해 `sdd-init`로 강제 배선한 뒤 현 코드를 reverse-engineer해 EARS FR 스펙 **초안**을 만들고, 확정 전에 사람 승인 게이트에서 멈춘다.
- **Independent Test**: `lifecycle-skills.test.mjs`가 `sdd-start.SKILL.md`에 reverse-engineer 초안 도출과 승인 게이트(halt) 지시가 있는지 검증.
- **Acceptance (GWT)**: 1. **Given** a project with no `sdd/` layout, **When** `/sdd-start` runs, **Then** it wires the kit via `sdd-init` and stops at a human-approval gate before finalizing any spec.

### User Story 2 — 완전 재채택 (/sdd-readopt) (P1)
이미 `sdd/` 산출물이 있으나 낡거나 어긋난 프로젝트에서 `/sdd-readopt`는 먼저 안전망 태그(`sdd-pre-readopt-<date>`)로 스냅샷하고, `sdd-init --force`로 재배선한 뒤 구 `sdd/specs`를 정리하고(프로덕션 코드 무변경) 스펙을 초안으로 재도출한다.
- **Independent Test**: `lifecycle-skills.test.mjs`가 `sdd-readopt.SKILL.md`에 안전망 태그·`--force`·코드 무변경 지시가 있는지 검증.
- **Acceptance (GWT)**: 1. **Given** a project with stale `sdd/` artifacts, **When** `/sdd-readopt` runs, **Then** it first creates a `git tag sdd-pre-readopt-<date>` snapshot before any rewire, and production code is left unmodified.

### User Story 3 — 평상시 동기화 (/sdd-update) (P1)
`/sdd-update`는 `/sdd-sync` 하네스를 감싸 코드↔스펙 드리프트를 표면화하고, 버그성 드리프트는 `/speckit.fix`로 보낸다. 게이트 green을 유지하되 스펙 확정은 사람 승인 후에만.
- **Independent Test**: `lifecycle-skills.test.mjs`가 `sdd-update.SKILL.md`가 `/sdd-sync`를 감싸는지 검증.
- **Acceptance (GWT)**: 1. **Given** an adopted project, **When** `/sdd-update` runs, **Then** it surfaces drift via `/sdd-sync` and finalizes specs only after human approval.

### Edge Cases
- `/sdd-start`가 이미 `sdd/`가 있는 프로젝트에서 불리면 중단하고 `/sdd-readopt`로 안내한다(오채택 방지).
- `prompts/` 정본 절차 파일이 로컬 키트에 없으면 `<methodology-url>` raw로 읽어 동일하게 실행한다.
- 세 스킬 모두 인자 없이 불리면 현재 디렉토리를 대상 루트로, 정본 저장소를 방법론 URL로 삼는다.

---

## Functional Requirements (EARS)
> 정본은 영어.

- **FR-001** (event): WHEN `/sdd-start` runs in a project that has no `sdd/` layout, THE SYSTEM SHALL wire the kit via `sdd-init`, reverse-engineer DRAFT EARS FR specs from the current code, and HALT at a human-approval gate before finalizing any spec.
- **FR-002** (event): WHEN `/sdd-readopt` runs, THE SYSTEM SHALL first create a `git tag sdd-pre-readopt-<date>` safety snapshot, re-wire via `sdd-init --force`, and clear prior `sdd/specs` without modifying production code, then reverse-engineer DRAFT specs and HALT at the approval gate.
- **FR-003** (event): WHEN `/sdd-update` runs, THE SYSTEM SHALL surface code↔spec drift through the `/sdd-sync` harness, escalating bug-driven drift to `/speckit.fix`, and keep gates green.
- **FR-004** (unwanted): IF any adoption lifecycle command would finalize or overwrite a spec or production code without recorded human approval, THEN THE SYSTEM SHALL refuse the action and wait for approval.
- **FR-005** (optional): WHERE a `<project-path>` or `<methodology-url>` argument is omitted, THE SYSTEM SHALL default to the current working directory and the canonical methodology repository respectively.

### Key Entities
- **lifecycle command** — one of the three installed skills (`/sdd-start`, `/sdd-readopt`, `/sdd-update`) defined by a `SKILL.md` file, each executing a `prompts/` procedure.
- **approval gate** — the halt point where an LLM-authored draft awaits human blessing before finalization.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts). Symbols = 스킬 소스(SKILL.md 진입점), Artifacts = 설치 산출물(`.claude/skills/*`).
- **Modules**: adoption-lifecycle
- **Symbols**: sdd-start.SKILL.md, sdd-readopt.SKILL.md, sdd-update.SKILL.md
- **Artifacts**: .claude/skills/sdd-start/SKILL.md, .claude/skills/sdd-readopt/SKILL.md, .claude/skills/sdd-update/SKILL.md
- **Files**: tooling/harness/sdd-start.SKILL.md, tooling/harness/sdd-readopt.SKILL.md, tooling/harness/sdd-update.SKILL.md, tooling/__tests__/lifecycle-skills.test.mjs

## Dependencies (참조 — dedup 제외)
> 설치·배선과 하네스 detector는 아래 모듈들이 소유. 라이프사이클 스킬은 이를 호출·안내만 한다.
- **Modules**: harness-install
- **Symbols**: sdd-init.sh, sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `lifecycle-skills.test.mjs`가 세 스킬 파일의 존재와 각 스킬의 계약(초안+승인 게이트·안전망 태그·`/sdd-sync` 래핑·자동 덮어쓰기 금지·인자 기본값)을 검증하며 통과한다(현재 green).
- **SC-002**: `sdd-init.sh --gate=node` 실행 후 세 스킬이 `.claude/skills/{sdd-start,sdd-readopt,sdd-update}/SKILL.md`로 설치된다(SPEC-004 FR-003이 소유·강제).

## Non-Functional Requirements
- **NFR-001**: 세 스킬의 상세 절차 원본은 `prompts/`에 한 곳으로 두고(SSOT), 스킬은 이를 참조·실행한다 — 절차 본문을 중복 저장하지 않는다(드리프트 방지).

## Assumptions / Clarifications Retained
- 최초 채택(`/sdd-start`)은 배선 전 상태에서도 실행될 수 있으므로, 진정한 clean-machine 진입은 `prompts/adopt.md`(raw URL)로도 가능하다. 설치형 스킬은 채택 이후의 재채택·업데이트에서 특히 유용하다.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-03 | 초안 — 채택 수명주기 3 명령(start/readopt/update)을 별도 aggregate로 신설(SPEC-004 install 메커니즘과 분리; cohesion 캡 준수) | feat/lifecycle-commands |
