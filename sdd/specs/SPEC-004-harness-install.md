# Feature Specification: Harness & Install

**Module**: `sdd-tooling`  **Spec**: `SPEC-004`  **Created**: 2026-07-02  **Status**: Active
**Input**: spec↔code sync 하네스(detect 집계 + 스킬)와 채택 순간 상시 강제 궤도를 까는 설치기(sdd-init) — 훅·settings·스킬을 결정적으로 배선한다.

---

## User Scenarios & Testing

### User Story 1 — detect 집계 하네스 (P1)
`sdd-sync.mjs`는 HARNESS.md 규칙표(R1 spec→code, R2 code→spec, R3 dedup·입도·완전성·일관성)의 detector 게이트를 일괄 실행하고 규칙별 "확인 필요/clean"을 리포트한다. 판정은 게이트에 있고 이 파일은 오케스트레이션만 한다. `/sdd-sync` 스킬과 `pre-push` 훅이 이를 소비한다.
- **Independent Test**: `sdd-sync.test.mjs`가 R2에 `check-spec-sync`가 배선됐는지 등 규칙→게이트 매핑을 검증.
- **Acceptance (GWT)**: 1. **Given** a repo with the gate suite, **When** `sdd-sync.mjs` runs, **Then** it reports R1/R2/R3 each as flagged or clean and exits non-zero under `--strict` only when flagged.

### User Story 2 — 채택 = 상시 강제 궤도 설치 (P1)
`sdd-init.sh`는 어느 프로젝트에서 돌리든 동일한 `sdd/` 레이아웃과 저장 위치를 만들고, `--gate=node`일 때 하네스와 훅 세트를 배선한다: `.git/hooks/pre-commit`·`.git/hooks/commit-msg` 자동 연결, `scripts/sdd-pre-push.sh` 스캐폴딩(pre-push 훅은 선택 수동 연결 안내), `.claude/settings.json`에 SessionStart/PreToolUse 훅 병합(`sdd-session-context.sh`·`sdd-edit-check.sh`), `.claude/skills/`에 스킬 설치. 게이트 임포트 클로저(예: `ownership-keys.mjs`)를 함께 복사해 설치만으로 게이트가 실행된다.
- **Independent Test**: `init-hooks.test.mjs`·`init-gates.test.mjs`·`init-spec-sync.test.mjs`가 배선·임포트 클로저·idempotency를 임시 프로젝트로 검증.
- **Acceptance (GWT)**: 1. **Given** a fresh project with `.git`, **When** `sdd-init.sh --gate=node` runs, **Then** `.git/hooks/pre-commit` calls the installed script and the gate suite executes without a missing-module error.

### Edge Cases
- `.claude/settings.json`이 이미 있고 `jq`가 없으면 기존 파일을 보존하고 hook 병합을 스킵한다(데이터 손실 방지) — `jq` 있으면 기존 SDD 항목을 걷어낸 뒤 재추가해 idempotency를 보장한다.
- `sdd-init.sh`를 키트 디렉토리 안에서 실행하면 거부한다(대상 프로젝트 루트에서만).
- `pre-commit` 훅은 스테이징에 spec 또는 코드 경로가 있을 때만 게이트를 돌린다(문서-only 커밋은 통과).
- `pre-push`는 기본 비차단(안내만)이며 `SDD_SYNC_BLOCK=1`일 때만 push를 막는다.
- PreToolUse `sdd-edit-check.sh`는 코드 경로(`src`/`lib`/`app`) 편집에만 체크리스트를 상기하고 그 외에는 침묵한다.
- `--gate=py`는 Python 게이트가 spec-first(specsync)까지 패리티이므로(SPEC-006) `.git` 존재 시 pre-commit(fr·ownership)과 commit-msg(specsync, merge commit은 MERGE_HEAD로 skip) 훅을 함께 배선한다 — "spec-sync는 Node 필요" 안내는 셸/Go 게이트에만 남는다.

---

## Functional Requirements (EARS)
> 정본은 영어.

- **FR-001** (ubiquitous): THE SYSTEM SHALL run, via `sdd-sync.mjs`, the detector gates grouped as R1/R2/R3 and report each rule as flagged or clean, exiting non-zero under `--strict` only when a rule is flagged.
- **FR-002** (event): WHEN `sdd-init.sh --gate=node` runs in a target project, THE SYSTEM SHALL scaffold the fixed `sdd/` layout, copy the gate import closure so the installed gates run standalone, auto-install `.git/hooks/pre-commit` and `.git/hooks/commit-msg` (writing the hook files directly), and scaffold `scripts/sdd-pre-push.sh` with an advisory `ln -sf` instruction printed to stdout — `.git/hooks/pre-push` is never written automatically.
- **FR-003** (event): WHEN `sdd-init.sh` wires session hooks, THE SYSTEM SHALL merge SessionStart and PreToolUse entries into `.claude/settings.json` and install the `sdd-session-context.sh` and `sdd-edit-check.sh` scripts plus the `/sdd-sync`, `/speckit.fix`, `/sdd-start`, `/sdd-readopt`, and `/sdd-update` skills into `.claude/skills/`.
- **FR-004** (unwanted): IF `.claude/settings.json` already exists and `jq` is unavailable, THEN THE SYSTEM SHALL preserve the existing file and skip hook merging rather than clobber it; WHERE `jq` is available, THE SYSTEM SHALL strip prior SDD entries before re-adding them so re-runs are idempotent.
- **FR-005** (event): WHEN the `pre-commit` hook runs and the staged set touches a spec or code path, THE SYSTEM SHALL execute `check-fr-coverage` and `check-ownership` and block the commit on their failure.
- **FR-006** (state): WHILE the `pre-push` hook runs, THE SYSTEM SHALL report drift advisorily and pass the push unless `SDD_SYNC_BLOCK=1` is set.
- **FR-007** (unwanted): IF `sdd-init.sh` is executed from inside the kit directory itself, THEN THE SYSTEM SHALL refuse and exit non-zero.
- **FR-008** (event): WHEN `sdd-run.mjs` is invoked with a stage name, THE SYSTEM SHALL execute the command declared in `commands.<stage>` from `sdd.config.json` and exit with that command's exit code; WHERE the stage is not declared in `commands`, THE SYSTEM SHALL skip and exit zero without error.

### Key Entities
- **install layout** — the deterministic `sdd/` tree, `sdd.config.json`, and wired hooks/settings/skills produced by init.
- **detector rule group** — R1/R2/R3 mapping of a rule to the gates the harness runs for it.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts). Symbols = 소스 진입점, Artifacts = 설치 산출물.
- **Modules**: harness-install
- **Symbols**: sdd-sync.mjs, sdd-init.sh, pre-commit, pre-push, sdd-session-context.sh, sdd-edit-check.sh, sdd-run.mjs
- **Artifacts**: .git/hooks/pre-commit, .git/hooks/pre-push, .claude/settings.json, .claude/skills/sdd-sync/SKILL.md, .claude/skills/speckit-fix/SKILL.md
- **Files**: tooling/sdd-sync.mjs, tooling/sdd-init.sh, tooling/harness/pre-commit, tooling/harness/pre-push, tooling/harness/sdd-session-context.sh, tooling/harness/sdd-edit-check.sh, tooling/harness/speckit-fix.SKILL.md, tooling/harness/sdd-sync.SKILL.md, tooling/harness/self-hooks-install.sh, tooling/sdd-run.mjs, tooling/__tests__/sdd-sync.test.mjs, tooling/__tests__/init-gates.test.mjs, tooling/__tests__/init-hooks.test.mjs, tooling/__tests__/init-spec-sync.test.mjs, tooling/__tests__/pre-commit.test.mjs, tooling/__tests__/session-context.test.mjs, tooling/__tests__/edit-check.test.mjs

## Dependencies (참조 — dedup 제외)
> 설치되는 게이트·spec-sync는 아래 모듈들이 소유. 하네스는 이를 배선·호출만 한다.
- **Modules**: key-pipeline, spec-quality-gates, spec-sync

---

## Success Criteria (측정형)
- **SC-001**: `sdd-sync.test.mjs`·`init-gates.test.mjs`·`init-hooks.test.mjs`·`init-spec-sync.test.mjs`·`pre-commit.test.mjs`·`session-context.test.mjs`·`edit-check.test.mjs`가 모두 통과한다(현재 green).
- **SC-002**: 신선한 프로젝트에서 `sdd-init.sh --gate=node` 후 설치된 파일만으로 게이트가 `ERR_MODULE_NOT_FOUND` 없이 실행된다.

## Non-Functional Requirements
- **NFR-001**: 재실행(idempotency) 시 `.claude/settings.json`에 SDD 훅 항목이 중복되지 않는다.

## Assumptions / Clarifications Retained
- 키트는 원본이므로 훅·명령은 `tooling/`을 직접 호출하고, 소비 프로젝트에는 `scripts/`로 복사된다(설치기 대상 분리).

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | FR-002 정직 정정 — pre-push 자동배선 아님; commit-msg 자동배선 명시; sdd-pre-push.sh 스캐폴딩+안내 정확히 기술 | HONESTY 위반(자기 정렬 발견) |
| 2026-07-02 | `self-hooks-install.sh`(키트 자기 훅 배선 — tooling 직접 호출) Files 편입 | plan ④ T3: 키트 자신을 자기 궤도에 |
| 2026-07-02 | sdd-run.mjs(CI 스테이지 러너) + FR-008 편입 — Symbols 7개(maxKeysPerCategoryPerSpec 7로 상향, sdd.config.json) | 하네스+설치기 aggregate는 6+1 엔트리포인트가 한 응집 묶음; SPEC-002의 5→6 선례와 동일 논리 |
| 2026-07-03 | FR-003 확장 — sdd-init가 수명주기 스킬(`/sdd-start`·`/sdd-readopt`·`/sdd-update`)도 `.claude/skills/`에 설치. 스킬 정의·계약은 SPEC-005(adoption-lifecycle) 소유(설치 메커니즘과 분리) | feat/lifecycle-commands |
| 2026-07-05 | `--gate=py`에 pre-commit·commit-msg(specsync) 훅 배선 — 낡은 "spec-sync는 Node 필요" 안내 제거(+ 테스트) | SPEC-006: Python판이 spec-first까지 전 게이트 패리티가 되어 Python-only 프로젝트도 hard 강제 가능 |
