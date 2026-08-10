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
- **게이트 stdout이 판정의 정본이다(하네스 계약):** 하네스는 게이트 stdout을 `⚠`/`✗`로 스캔해 flagged를 정한다 — 그래서 게이트는 자기 판정 줄만 stdout에 쓰고 하위 프로세스 출력을 stdout으로 흘리지 않는다(흘리면 green이 ⚠로 오독된다 — SPEC-021이 fd 2 리다이렉트로 지키는 규약).
- **출력 0줄은 clean이 아니라 미판정이다:** 게이트가 한 줄도 출력하지 않고 exit 0으로 끝나면(엔트리 판정 실패·조건 분기 누락 등 무음 미실행) 하네스는 그것을 flagged-미판정으로 표면화한다 — `exit 0`과 "판정했음"은 다른 사실이라서다(실측: 비-ASCII 경로에서 `check-test-run`이 무음 exit 0이라 `runTestsPolicy: hard`가 여러 라운드 거짓 green). 판정 대상이 없는 게이트는 "off/no-op/skip" 한 줄을 내므로 이 규칙에 걸리지 않는다.
- **detector 파일 부재도 미판정이다:** 규칙표가 선언한 게이트가 설치돼 있지 않으면 그 규칙은 clean이 아니라 flagged로 보고하고 배선 갱신(`sdd-init`/update)을 요구한다.
- `.claude/settings.json`이 이미 있고 `jq`가 없으면 기존 파일을 보존하고 hook 병합을 스킵한다(데이터 손실 방지) — `jq` 있으면 기존 SDD 항목을 걷어낸 뒤 재추가해 idempotency를 보장한다.
- `sdd-init.sh`를 키트 디렉토리 안에서 실행하면 거부한다(대상 프로젝트 루트에서만).
- `pre-commit` 훅은 스테이징에 spec 또는 코드 경로가 있을 때만 게이트를 돌린다(문서-only 커밋은 통과).
- `pre-push`는 기본 비차단(안내만)이며 `SDD_SYNC_BLOCK=1`일 때만 push를 막는다.
- PreToolUse `sdd-edit-check.sh`는 코드 경로(`src`/`lib`/`app`) 편집에만 체크리스트를 상기하고 그 외에는 침묵한다.
- `--gate=py`는 Python 게이트가 spec-first(specsync)까지 패리티이므로(SPEC-006) `.git` 존재 시 pre-commit(fr·ownership)과 commit-msg(specsync, merge commit은 MERGE_HEAD로 skip) 훅을 함께 배선한다 — "spec-sync는 Node 필요" 안내는 셸/Go 게이트에만 남는다.

---

## Functional Requirements (EARS)
> 정본은 영어.

- **FR-001** (ubiquitous): THE **sdd-sync.mjs** (S) harness SHALL run the detector gates grouped as R1/R2/R3 and report each rule as flagged or clean — treating a gate that produced no standard-output verdict, or a gate file that is absent, as flagged-unjudged rather than clean — and exiting non-zero under `--strict` only when a rule is flagged. — capability: **harness-install.install** (C).
- **FR-002** (event): WHEN **sdd-init.sh** (S) runs with `--gate=node` in a target project, THE **harness-install** (E) installer SHALL scaffold the fixed `sdd/` layout, copy the gate import closure so the installed gates run standalone, auto-install `.git/hooks/pre-commit` and `.git/hooks/commit-msg` (writing the hook files directly), and scaffold `scripts/sdd-pre-push.sh` with an advisory `ln -sf` instruction printed to stdout — `.git/hooks/pre-push` is never written automatically.
- **FR-003** (event): WHEN **sdd-init.sh** (S) wires session hooks, THE SYSTEM SHALL merge SessionStart and PreToolUse entries into `.claude/settings.json` and install the **sdd-session-context.sh** (S) and **sdd-edit-check.sh** (S) scripts plus the `/sdd-sync`, `/speckit.fix`, `/sdd-start`, `/sdd-readopt`, and `/sdd-update` skills into `.claude/skills/`.
- **FR-004** (unwanted): IF `.claude/settings.json` already exists and `jq` is unavailable, THEN THE SYSTEM SHALL preserve the existing file and skip hook merging rather than clobber it; WHERE `jq` is available, THE SYSTEM SHALL strip prior SDD entries before re-adding them so re-runs are idempotent.
- **FR-005** (event): WHEN the **pre-commit** (S) hook runs and the staged set touches a spec or code path, THE SYSTEM SHALL execute `check-fr-coverage` and `check-ownership` and block the commit on their failure.
- **FR-006** (state): WHILE the **pre-push** (S) hook runs, **sdd-sync.mjs** (S) SHALL report drift advisorily and pass the push unless blocking is requested, SHALL stop once the given time budget is exhausted and mark every unrun or timed-out detector as unjudged rather than passing, and SHALL mark rules outside a declared hook subset as delegated only when the declared delegate is named.
- **FR-007** (unwanted): IF **sdd-init.sh** (S) is executed from inside the kit directory itself, THEN THE SYSTEM SHALL refuse and exit non-zero.
- **FR-008** (event): WHEN **sdd-run.mjs** (S) is invoked with a stage name, THE SYSTEM SHALL execute the command declared in `commands.<stage>` from `sdd.config.json` and exit with that command's exit code; WHERE the stage is not declared in `commands`, THE SYSTEM SHALL skip and exit zero without error.
- **FR-009** (event): WHEN **sdd-sync.mjs** (S) is invoked with `--json`, THE SYSTEM SHALL emit to stdout only a machine-readable report — an object with `schemaVersion`, `clean`, `flaggedRules` (stable rule ids), and `rules` (each with a stable `id`, a `title`, a `flagged` flag, and `gates` each carrying `gate`, `flagged`, and `summary`) — suppressing the human-readable report, and SHALL keep the `--strict` contract of exiting non-zero when any rule is flagged.
- **FR-010** (event): WHEN **sdd-init.sh** (S) runs (any gate), THE SYSTEM SHALL install the agent-context methodology doc to `.kiro/steering/sdd.md` and ensure a marker-delimited SDD block exists in `AGENTS.md` — creating the file if absent, appending the block while preserving existing content if present without the marker, and leaving it unchanged if the marker is already present (idempotent) — so non-Claude executors (Kiro, Codex, etc.) load the same orbit and entry rules the Claude SessionStart hook injects.

### Key Entities
- **install layout** — the deterministic `sdd/` tree, `sdd.config.json`, and wired hooks/settings/skills produced by init.
- **detector rule group** — R1/R2/R3 mapping of a rule to the gates the harness runs for it.
- **sync report** — the machine-readable `--json` contract the ask layer (`/sdd-sync`) consumes: a versioned object whose stable rule ids and gate flags let any executor route decisions deterministically instead of scraping human text.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities). Symbols = 소스 진입점, Artifacts = 설치 산출물.
- **Modules**: harness-install
- **Symbols**: sdd-sync.mjs, sdd-init.sh, pre-commit, pre-push, sdd-session-context.sh, sdd-edit-check.sh, sdd-run.mjs
- **Artifacts**: .git/hooks/pre-commit, .git/hooks/pre-push, .claude/skills/sdd-sync/SKILL.md, .claude/skills/speckit-fix/SKILL.md, .kiro/steering/sdd.md, AGENTS.md
- **Capabilities**: harness-install.install
- **Files**: tooling/sdd-sync.mjs, tooling/sdd-init.sh, tooling/harness/pre-commit, tooling/harness/pre-push, tooling/harness/sdd-session-context.sh, tooling/harness/sdd-edit-check.sh, tooling/harness/speckit-fix.SKILL.md, tooling/harness/sdd-sync.SKILL.md, tooling/harness/agent-context.md, tooling/harness/self-hooks-install.sh, tooling/sdd-run.mjs, tooling/__tests__/sdd-sync.test.mjs, tooling/__tests__/init-gates.test.mjs, tooling/__tests__/init-hooks.test.mjs, tooling/__tests__/init-spec-sync.test.mjs, tooling/__tests__/pre-commit.test.mjs, tooling/__tests__/session-context.test.mjs, tooling/__tests__/edit-check.test.mjs, tooling/__tests__/ship-closure.test.mjs, docs/change_log.html

## Dependencies (참조 — dedup 제외)
> 설치되는 게이트·spec-sync는 아래 모듈들이 소유. 하네스는 이를 배선·호출만 한다.
- **Modules**: key-pipeline (references), spec-quality-gates (references), spec-sync (references)

---

## Success Criteria (측정형)
- **SC-001**: `sdd-sync.test.mjs`·`init-gates.test.mjs`·`init-hooks.test.mjs`·`init-spec-sync.test.mjs`·`pre-commit.test.mjs`·`session-context.test.mjs`·`edit-check.test.mjs`가 모두 통과한다(현재 green). [검증: tooling/__tests__/sdd-sync.test.mjs, tooling/__tests__/init-gates.test.mjs, tooling/__tests__/init-hooks.test.mjs]
- **SC-002**: 신선한 프로젝트에서 `sdd-init.sh --gate=node` 후 설치된 파일만으로 게이트가 `ERR_MODULE_NOT_FOUND` 없이 실행된다. [검증: tooling/__tests__/sdd-sync.test.mjs, tooling/__tests__/init-gates.test.mjs, tooling/__tests__/init-hooks.test.mjs]
- **SC-003**: `sdd-sync.mjs --json` 출력이 유효 JSON(사람 텍스트 누출 0)이며 스키마 회귀 테스트(`sdd-sync.test.mjs`)가 최상위 키·타입·rule id 집합·내부 정합(clean⟺flaggedRules 빔)을 green으로 잠근다. [검증: tooling/__tests__/sdd-sync.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 재실행(idempotency) 시 `.claude/settings.json`에 SDD 훅 항목이 중복되지 않는다. [검증: tooling/__tests__/sdd-sync.test.mjs, tooling/__tests__/init-gates.test.mjs, tooling/__tests__/init-hooks.test.mjs]

## Assumptions / Clarifications Retained
- 키트는 원본이므로 훅·명령은 `tooling/`을 직접 호출하고, 소비 프로젝트에는 `scripts/`로 복사된다(설치기 대상 분리).

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 게이트 전종·전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-005(adoption-lifecycle): 비중복 — 설치 하네스(이 spec)와 채택 수명주기 스킬(SPEC-005)은 산출물·책임 상이.
- 2026-07-05 이웃 SPEC-002·SPEC-003(게이트 소유 spec들): 비중복 — 이 spec은 배선(설치)만 소유.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 스윕 규칙표에 R21(진단 가드 선언) 등재 + 복사 목록에 `diagnosis-guard-lib`·`check-diagnosis-guard`·`sdd-diagnosis-check.sh` 추가 + `--json` 규칙 ID 목록에 R21 반영 | SPEC-053 동반. 스윕에 실은 것은 **선언 판정**이다(훅 판정은 도구 호출 직전에 따로 발동한다) — 잘못된 선언은 아무것도 막지 않고 아무것도 알리지 않으므로 그 조용한 무발화를 스윕이 본다 |
| 2026-08-10 | 스윕 규칙표에 R20(명세 모순 감사) 등재 + 복사 목록에 `spec-conflict-lib`·`check-spec-conflict` 추가 + `--json` 리포트 규칙 ID 목록에 R20 반영 | SPEC-052 동반. 이 축은 **감사** 층이라 앞의 19종과 성격이 다르다 — 나머지는 "에이전트가 명세대로 하는가"를 보고 R20은 명세 자체를 본다. 스윕에 실은 이유: 감사는 우회 불가한 채널(CI)에서 돌아야 하고, 감사자가 감시 대상의 협조를 요구하면 강제가 아니다 |
| 2026-08-10 | `docs/change_log.html` 재생성(면제 래칫 라운드의 Change Log 반영) | 생성기(`gen-changelog.mjs`)가 git 이력에서 재생성하는 산출물이고, pre-commit 훅이 자동 갱신·스테이징한다. 이번 라운드에 그 생성기가 **소유 없이 면제돼 있던 부채**로 등록됐다(SPEC-027 FR-009 — 해소: 이 스펙 Files에 등재하고 면제는 산출물에만 남긴다, 기한 2026-09-30) |
| 2026-08-10 | 설치기 복사 의미를 둘로 분리 — `copy`(프로젝트가 편집하는 씨앗: config·템플릿·MODULE_MAP·에이전트 컨텍스트 → 보존, 기존 동작) / `sync_copy`(킷 소유 산출물: 게이트·하네스 스크립트·스킬·선언 파일 → **내용이 다르면 항상 갱신**), 킷 소유 14곳 전환 | 실측 제보(SPEC-036 재발): `copy`가 "있으면 skip"이라 `sdd-init` 재실행이 사본을 **갱신하지 않았다.** 그래서 훅에 새 게이트를 배선한 커밋이 머지돼도 실제 커밋 경로는 낡은 사본을 계속 실행했고, hard로 켜둔 감시 게이트가 한 번도 발동하지 못했다. `copy`를 통째로 바꾸지 않은 이유: 같은 함수가 `sdd.config.json`·템플릿도 옮기므로 거기서 덮어쓰면 **사용자 편집이 사라진다** — 의미가 다른 두 복사를 한 함수에 담고 있던 것이 결함의 구조였다. 부수 효과로 부분 동기화(SPEC-050) 위험도 줄어든다: 재실행이 이제 게이트를 실제로 최신화하므로 수동 diff 경로에만 의존하지 않는다 [검증: tooling/__tests__/init-gates.test.mjs] |
| 2026-08-10 | 에이전트측 훅 배선을 **선언 기반**으로 재작성 — `agent-hooks.list` 복사 + 게이트 생성 모드로 병합 계산 + `jq` 의존 제거 + **배선 실패 시 큰 소리 중단** + 배선 직후 자기검증. 영수증에 `agentHooks`·`agentSettings` 기록 + 훅 목록을 `$HOOKS_DIR`로 열거(워크트리 교정). 스윕 규칙표에 R19 등재, 복사 목록에 `agent-wiring-lib`·`check-agent-wiring` 추가. `.claude/settings.json` 소유를 SPEC-051로 이관(내용 계약의 소유자가 그 축이다 — SPEC-005가 `.claude/skills/*`를 소유하는 것과 같은 패턴) | 오너 실측: 감시 에이전트가 동작하지 않는다. 이 파일에 원인 셋이 있었다: ①훅 JSON을 **하드코딩**해 두었고 그 JSON이 사실상 정본인데 **어떤 검사도 그것과 대조되지 않았다** ②`jq` 미설치 시 배선을 건너뛰고 **설치를 성공으로 끝냈다**(워크트리 결함을 몇 달간 가린 best-effort 침묵과 같은 모양) ③영수증이 git 훅만 기록해 "감시 에이전트가 깔렸는가"를 영수증에서 알 수 없었다. jq는 애초에 불요였다 — 이 블록은 `--gate node` 안이라 node가 보장된다. 겸사겸사 영수증의 `ls .git/hooks`도 고쳤다(워크트리에서 조용히 비는 자리가 남아 있었다) [검증: tooling/__tests__/init-hooks.test.mjs] |
| 2026-08-10 | `gateOutcome`의 크래시 요약을 **원인 줄 선택**으로 교정(`crashSummary` — 스택 프레임·캐럿·런타임 배너를 형태로 걸러낸 뒤 던져진 오류 줄) + 스윕 규칙표에 R18 등재 + `sdd-init` 복사 목록에 `import-wiring-lib`·`check-import-wiring` 추가 + 로컬 `isMainEntry` 사본 제거(정의는 `verdict-lib`) | 실측 제보: 부분 동기화로 게이트가 `SyntaxError`로 죽었는데 스윕이 사유로 보고한 것은 **`Node.js v22.22.2`**(런타임 배너)였다 — `lastLine(stderr)`가 마지막 줄을 뽑았기 때문이다. 원인 줄은 스택 위에 묻혀 제보자가 직접 읽어야 했다. **마지막 줄이 요약인 것은 게이트가 협조적으로 끝났을 때만 참이다 — 크래시는 협조가 아니다.** 침묵이 아니라 **오진**이었던 사례다(크래시는 원래도 미판정으로 계상돼 초록이 아니었지만, 사유가 쓸모없으면 사람이 원인까지 가는 길이 없다). 런타임별 오류 어휘 목록을 유지하는 길은 기각 — 목록 밖 런타임에서 조용히 빗나간다 [검증: tooling/__tests__/sdd-sync.test.mjs] |
| 2026-08-10 | `sdd-init.sh`가 훅 경로를 git에게 묻고(worktree·core.hooksPath) **배선 건수를 실측해 0건이면 실패**로 알리도록 전환 + 배포 목록에 `branch-observation-lib.mjs` 추가 | 실측 제보: 워크트리 기반 프로젝트에서 게이트 훅이 한 번도 발동하지 않았고 그 스킵이 조용했다. 설치기가 "깔았다"고 말한 뒤 실제로 그 자리에 실행 가능한 훅이 있는지 세지 않으면 best-effort 침묵이 결함을 가린다 [검증: tooling/__tests__/hooks-install.test.mjs] |
| 2026-08-10 | 스윕에 **R17 감시자 실재** 등재 + `sdd-init.sh`가 **CI 워크플로·채택 영수증을 필수 산출물로 생성**(선택 단계가 아니다) + `ship-closure.test.mjs`에 **게이트 카나리아 계약** 추가 + 배포 목록에 watchdog 2종 | 오너 지시: 각 프로젝트가 방법론을 무시하니 감시자가 **반드시 생성되도록** 하라. 권고로는 만들어지지 않는다 — 설치기가 만들고 게이트가 실재를 판정한다. 카나리아 계약은 제보의 논거를 받는다: **결정적인 것과 옳은 것은 다르다**(틀린 게이트는 틀린 답을 결정적으로 재현하고 그 고장은 통과로 나타난다). 도입 즉시 자기 사각을 잡았다 — 새 감시자 게이트 자신이 차단 증명 없이 등재돼 있었고 나머지 21종은 이미 있었다 [검증: tooling/__tests__/ship-closure.test.mjs] |
| 2026-08-10 | 스윕 규칙표에 **R16 순차 프로세스 SSOT** 등재 + `sdd-init.sh` 배포 목록에 `process-ssot-lib`·`check-process-ssot` 추가 + `--json` 규칙 목록 계약에 R16 반영 | 제보 사례 5 → SPEC-047 신설. 배포 목록 누락은 폐포 계약 테스트가 다시 잡았다(이 결함 계열의 다섯 번째 — 두 번 연속 기계가 먼저 잡았다) [검증: tooling/__tests__/ship-closure.test.mjs] |
| 2026-08-10 | `change_log.html` 재생성(SPEC-024·031·034 개정 반영) | 생성물은 소스가 바뀌면 재생성한다 — 드리프트를 남기지 않는다 [검증: tooling/__tests__/sdd-sync.test.mjs] |
| 2026-08-10 | `docs/change_log.html`(생성물)을 Files 소유에 편입 | SPEC-003의 면제 글롭 좁힘으로 포괄 `docs/**`가 사라지자 이 생성물이 **미소유**로 떴다. 생성기(`gen-changelog.mjs`)를 소유한 스펙이 그 산출물도 소유하는 것이 정합이다 — 생성물의 드리프트는 재생성으로 해소한다(SPEC-028과 같은 결) [검증: tooling/__tests__/sdd-sync.test.mjs] |
| 2026-08-10 | `sdd-init.sh` 배포 목록에 `impl-reference-lib.mjs` 추가 | 배포 폐포 계약 테스트가 누락을 즉시 잡았다 — 이 결함 계열의 **네 번째** 발생이고 처음으로 사람이 아니라 기계가 잡았다 [검증: tooling/__tests__/ship-closure.test.mjs] |
| 2026-08-10 | 스윕 규칙표에 **R15 소개 문서 동기** 등재 + `sdd-init.sh` 배포 목록에 `intro-doc-lib`·`check-intro-doc` 추가 + `--json` 리포트 규칙 목록 계약에 R15 반영 | 오너 지시(키트 변경 시 소개 HTML 강제 갱신) → SPEC-045 신설. 배포 목록 누락은 **어제 세운 폐포 계약 테스트가 즉시 잡았다** — 규범으로 세 번 실패한 것을 기계로 옮긴 것이 하루 만에 효과를 냈다 [검증: tooling/__tests__/ship-closure.test.mjs] |
| 2026-08-10 | `sdd-init.sh` 배포 목록에 신설 코어 3종 추가 + **배포 폐포 계약 테스트** 신설(`ship-closure.test.mjs`) | 배포 목록 누락이 세 번 재발했다(verdict-lib·verification-run-lib·term-coverage-lib) — 매번 소비 프로젝트는 게이트가 아니라 `ERR_MODULE_NOT_FOUND`를 받는다. 세 번 다 "다음엔 목록도 같이 고치자"는 규범으로 끝났고 세 번 다 안 지켜졌다. 규범으로 두 번 이상 실패한 것은 기계가 잡는다: import 전이 폐포와 규칙표 등재 게이트가 배포 목록에 모두 있는지 계약으로 강제한다 [검증: tooling/__tests__/ship-closure.test.mjs] |
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | FR-002 정직 정정 — pre-push 자동배선 아님; commit-msg 자동배선 명시; sdd-pre-push.sh 스캐폴딩+안내 정확히 기술 | HONESTY 위반(자기 정렬 발견) |
| 2026-07-02 | `self-hooks-install.sh`(키트 자기 훅 배선 — tooling 직접 호출) Files 편입 | plan ④ T3: 키트 자신을 자기 궤도에 |
| 2026-07-02 | sdd-run.mjs(CI 스테이지 러너) + FR-008 편입 — Symbols 7개(maxKeysPerCategoryPerSpec 7로 상향, sdd.config.json) | 하네스+설치기 aggregate는 6+1 엔트리포인트가 한 응집 묶음; SPEC-002의 5→6 선례와 동일 논리 |
| 2026-07-03 | FR-003 확장 — sdd-init가 수명주기 스킬(`/sdd-start`·`/sdd-readopt`·`/sdd-update`)도 `.claude/skills/`에 설치. 스킬 정의·계약은 SPEC-005(adoption-lifecycle) 소유(설치 메커니즘과 분리) | feat/lifecycle-commands |
| 2026-07-05 | `--gate=py`에 pre-commit·commit-msg(specsync) 훅 배선 — 낡은 "spec-sync는 Node 필요" 안내 제거(+ 테스트) | SPEC-006: Python판이 spec-first까지 전 게이트 패리티가 되어 Python-only 프로젝트도 hard 강제 가능 |
| 2026-07-05 | sdd-init node 복사 목록에 `verification-accounting.mjs`·`lifecycle-lib.mjs` 추가(+ 픽스처 복사 목록 동기) | SPEC-007·SPEC-008 신설 동반 — fr·completeness·spec-sync 게이트의 새 import가 소비 프로젝트 scripts/에서 결손되면 ERR_MODULE_NOT_FOUND |
| 2026-07-05 | sdd-init node 복사 목록에 `derivation-lib.mjs`·`check-derivation.mjs`·`sdd-smoke-scan.mjs`·`sdd-retag.mjs` 추가 | SPEC-009~011 신설 동반 — 재채택 프로젝트가 재도출 회계·증거 스캔·retag 게이트를 결손 없이 배선 |
| 2026-07-06 | SessionStart 주입 텍스트의 게이트 광고를 실제 스위트 전종(품질 5·보강/spec-first 4·재도출/증거 2)으로 갱신 + 테스트가 전종 포함을 회귀로 고정 | 문서 동기 감사[검증]: 광고 목록이 4종에 멈춰 세션 컨텍스트가 낡은 궤도를 가르침(2차부터 누적 드리프트) — 열거를 테스트로 고정해 재발 차단 |
| 2026-07-06 | sdd-init node 복사 목록에 `prefix-class-lib.mjs`·`grammar-lib.mjs` 추가 (+ 하네스 detect 리포트가 새 신호를 그대로 표면화) | SPEC-012·SPEC-013 신설 동반 — 채택 프로젝트가 접두어↔클래스·문법 규범 게이트를 결손 없이 배선 |
| 2026-07-06 | FR-009 신설 — `sdd-sync.mjs --json` 결정적 기계 판독 리포트(스키마 v1) + `/sdd-sync` 스킬이 텍스트 스크래핑 대신 이를 소비 | 하네스 ask 층 입력 결정성 강화: 리포트가 스킬 계약이라 에이전트 해석에 의존했음 → 안정 스키마로 잠가 어느 실행기든 동일 소비 |
| 2026-07-06 | sdd-init node 복사 목록에 `numbering-lib.mjs` 추가 | SPEC-014 신설 동반 — 채택 프로젝트가 접두어별 spec-ID 번호 게이트를 결손 없이 배선 |
| 2026-07-06 | sdd-init node 복사 목록에 `object-storage-lib.mjs` 추가 | SPEC-016 신설 동반 — 채택 프로젝트가 오브젝트 스토리지 결정 게이트를 결손 없이 배선 |
| 2026-07-06 | sdd-init node 복사 목록에 `test-domain-lib.mjs` 추가 | SPEC-015 신설 동반 — 채택 프로젝트가 테스트 인프라 격리 게이트를 결손 없이 배선 |
| 2026-07-06 | `speckit-fix.SKILL.md`에 6단계 "원점 트래커 close-out"(dev-done→보고→confirm) 추가 | 완료 루프 close-out 규범 — 트래커 유래 작업의 완료형 스킬 실행기(trackerCloseout knob 소비) |
| 2026-07-09 | sdd-init node 복사 목록에 `relation-lib.mjs` 추가 | SPEC-017 신설 동반 — 채택 프로젝트가 Entity 관계 게이트를 결손 없이 배선(누락 시 check-ownership.mjs가 ERR_MODULE_NOT_FOUND) |
| 2026-07-09 | `sdd-session-context.sh` 진입 규칙에 "2b) 설계 문서(pre-spec) 위치 = docs/design/" 추가(APPLYING.md·방법론.html 예시 블록 동기, 게이트 목록 드리프트도 같이 정정) | STORAGE §2.7 신설 동반 — 브레인스토밍 산출물이 스펙과 같은 "specs" 이름의 폴더로 새는 걸 세션 진입 시점에 차단 |
| 2026-07-15 | 세션·편집 훅 표시 문자열(`sdd-session-context.sh`·`sdd-edit-check.sh`)의 PREFIX 표준을 `SPEC/INFRA/TEST/CICD` 4종으로 | CICD 절반 롤아웃 봉합 — 훅이 방출하던 3종 표시가 config 정본(4종)·SPEC-012와 어긋나 있던 것 정정(APPLYING "실측 출력" 블록도 4종으로 동기) |
| 2026-07-15 | `sdd-sync.mjs`의 `new URL(import.meta.url).pathname` → `fileURLToPath(import.meta.url)` | 도그푸딩(소비 프로젝트 B): 한글 등 비-ASCII 경로에서 `URL.pathname`이 %-인코딩돼 게이트가 조용히 스킵되던 버그 — 소비자가 매번 패치할 게 아니라 킷 자체를 고침(델타 보존 부담 소멸) |
| 2026-07-16 | `sdd-sync.mjs` 요약·`pre-push` 훅 안내를 중립-우선으로: `node scripts/sdd-sync.mjs`를 1차 remediation으로, Claude `/sdd-sync`는 괄호 편의 | 에이전트 중립 방향(사용자 결정): drift 안내가 특정 에이전트 커맨드를 가정하지 않게 — 강제/탐지 계층은 실행기 무관 |
| 2026-07-16 | `sdd-init` Node 게이트 임포트 클로저에 `drift-lib.mjs` 추가 | SPEC-019 동반: check-spec-sync의 새 import(drift-lib)를 소비 프로젝트에도 복사해 설치만으로 실행되게(누락 시 ERR_MODULE_NOT_FOUND) |
| 2026-07-16 | `sdd-init` Node 클로저에 `cross-spec-lib.mjs` 추가 | SPEC-020 동반: check-spec-sync의 새 import(cross-spec-lib)를 소비 프로젝트에도 복사(설치만으로 실행) |
| 2026-07-16 | FR-010 신설 — `sdd-init`이 `agent-context.md`를 `.kiro/steering/sdd.md`로 설치 + `AGENTS.md`에 마커 블록 idempotent 병합(게이트 무관). `tooling/harness/agent-context.md` 신규 아티팩트 | 비-Claude 에이전트(Kiro·Codex) 방법론 상시 주입 — Claude SessionStart 훅의 실행기-무관 대체. 슬래시 없이도 궤도·진입 규칙이 항상 로드됨(에이전트 중립 방향) |
| 2026-07-16 | `sdd-init` Node 클로저에 `check-test-run.mjs` 추가 + `speckit-fix` 스킬에 "테스트 스위트 실행 확인" 단계(4b) 추가 | SPEC-021 동반: 완료 주장 전 실제 실행 규범을 실행기 마지막 단계에 배선(커버리지 회계 ≠ 실행 결과) |
| 2026-07-16 | `self-hooks-install.sh` 킷 pre-commit에 `gen-changelog.mjs` 재생성 + `git add change_log.html` 추가(킷 전용, 소비 훅 불변) | 방법론이 커밋(=push)될 때마다 change_log.html이 사람 개입 없이 자동 갱신 — 자동 changelog의 1-커밋 지연 수용 |
| 2026-07-16 | `sdd-init` Node 클로저에 `check-schema-drift.mjs`·`schema-drift-lib.mjs` 추가 + `speckit-fix` 스킬에 Change-Driver 사용 규칙(공유 파일은 타 스펙 동인이면 억지 Change Log 대신 `Change-Driver`) 명문화 | SPEC-022 동반(게이트 배선) + SPEC-020 후속(가이드 부재로 억지 Change Log로 흐르던 것 봉합) |
| 2026-07-16 | `sdd-init.sh`의 `.git` 부재 시 훅 배선 조용한 스킵 → 블록별 `⚠` 경고(stderr) + 완료 안내 재요약(`warn()`·`GITWARN`), `init-hooks.test.mjs` 회귀 1건 | 도그푸딩(gsneotek-mis-mcp): `.git` 없으면 훅이 말없이 안 깔려 "강제 궤도 켜진 줄" 오인 — 조용한 스킵 제거(정직) |
| 2026-07-16 | `sdd-init` Node 클로저에 `sdd-retire.mjs`·`retire-lib.mjs` 추가 | 정리 감사(죽은 코드): SPEC-018 폐기 워크플로 완결(6/6)됐는데 배포 클로저에 빠져 소비 프로젝트가 `sdd-retire`를 못 받던 배포 누락 봉합 |
| 2026-07-16 | 감사 봉합(P3·M5) — ① pre-commit 경로 필터 제거(src/lib/app/tests 하드코딩이 Go cmd/·pkg/ 등 비-JS 레이아웃에서 게이트를 영원히 미발동시키던 이식성 결함; 게이트는 전역 스캔이라 매 커밋 실행) ② --gate=sh에 fr·ownership 훅 배선 + --gate=go 미배선 명시 경고(기본 경로가 훅 0개로 "채택=상시 강제"와 어긋나던 것) ③ pre-merge-commit 훅 신설(node/py/sh·self-hooks — 무충돌 병합이 pre-commit을 타지 않아 두 브랜치의 같은 번호·같은 키가 main에 착지하던 경쟁 차단) | 감사 P3·M5: "언어 무관" 기둥이 강제 지점(훅 트리거)에서 깨져 있었고, merge commit은 로컬 게이트 사각지대였음 — 소비 프로젝트 도그푸딩 전 선제 봉합 |
| 2026-07-17 | sdd-init Node 클로저에 `key-anchor-lib.mjs` 추가 | SPEC-023 동반: 소비 프로젝트 배선 폐포 유지 |
| 2026-07-20 | sdd-init Node 클로저에 `capability-ownership-lib.mjs` 추가 | SPEC-024 동반: 소비 프로젝트 배선 폐포 유지 |
| 2026-07-21 | sdd-init 수명주기 스킬 목록에 `sdd-migrate` 추가(4종 설치) | SPEC-025 동반: 스펙 마이그레이션 실행기 스킬을 소비 프로젝트에 배선 |
| 2026-07-21 | sdd-init Node 클로저에 `schema-backing-lib.mjs` 추가 | SPEC-026 동반: check-ownership 의존 lib을 소비 프로젝트에 배선(폐포 유지 — 미포함 시 ERR_MODULE_NOT_FOUND) |
| 2026-07-21 | sdd-sync RULES에 R6(정책 래칫) 추가 + sdd-init 매니페스트에 `policy-ratchet-lib.mjs`·`check-policy-ratchet.mjs` 배선 | SPEC-027 동반: 강도 단조 게이트를 detector 스윕·소비 프로젝트 설치에 편입(미포함 시 게이트 누락) |
| 2026-07-27 | `pre-commit`·`self-hooks-install.sh`의 `check-ownership` 주석을 실제 강도로 정정(주석만, 동작 무변) — exit 1 = 중복소유·관계 실재·entityRegistry·정책 enum(+귀속/백킹 hard일 때), 키 형식·블록 부재는 ⚠ warn | 문서–코드 드리프트 감사: 주석이 "형식…(exit 1)"이라 서술했으나 형식 위반은 `check-ownership.mjs:181-184`에서 `--strict` 없이 ⚠ 출력·`:287-291`에서만 exit 1이고 두 훅 다 `--strict`를 붙이지 않는다 — 훅이 형식을 차단한다는 오해 제거 |
| 2026-07-27 | FR-001~003·005~010의 익명 주어·백틱 인용을 실제 주체 앵커로 교체해 소유 키 8종을 앵커(FR-001 sdd-sync.mjs·FR-002 sdd-init.sh+harness-install(E)·FR-003 sdd-session-context.sh·sdd-edit-check.sh·FR-005 pre-commit·FR-006 pre-push·FR-008 sdd-run.mjs) — 백틱 인용 10건 앵커 승격, 판정 내용 무변 | SPEC-001 FR-010으로 역할 선언이 들어오며 SPEC-023 키 앵커(FR-005·006·007)가 킷 자신에게 처음 발화 — 자기적용 마이그레이션(감사 이슈 #21) |
| 2026-07-28 | FR-001 확장 + `gateOutcome` 순수 코어 추출(오케스트레이션은 `isMainEntry` 가드 아래로) — 게이트 stdout 0줄·detector 부재를 clean이 아니라 **flagged-미판정**으로, 크래시 요약은 stdout 판정 줄 우선. 회귀 5건 | 감사 #21 M-8 계열의 양면 봉합: (a) green이 ⚠로 읽히던 오독은 게이트 stdout 계약(SPEC-021)으로 고치고, (b) 그 거울상인 **"출력 0줄 = clean"** 을 하네스에서 기계화. 실측 결함(한글 경로 → 무음 미실행 → `runTestsPolicy: hard`가 여러 라운드 거짓 green)이 여러 라운드 살아남은 직접 원인이 "exit 0을 판정했음으로 읽는 확인"이었다 — `prompts/update.md` 7단계의 사람 절차만으로는 재발하므로 하네스가 매 실행 표면화한다 |
| 2026-07-28 | `sdd-init` Node 클로저에 `gen-ownership-map.mjs` 추가(+ 설치·실행 회귀 1건) | SPEC-028 배포 누락: 생성기가 킷 `tooling/`에만 있고 복사 목록·훅·규칙표 어디에도 배선이 없어 소비 프로젝트가 키 보증 맵을 받지 못했다. 소유 스펙의 Artifacts가 `sdd/OWNERSHIP_MAP.md`(소비 프로젝트 경로)이고 동인이 owner의 "GitLab에서 키 보증 확인이 힘들다"라 **소비 프로젝트 산출물**이 맞다(판정 규칙은 `prompts/update.md` 4단계에 규범화) |
| 2026-07-28 | `pre-commit.test.mjs` 픽스처 복사 목록에 `key-anchor-lib.mjs` 추가 | SPEC-013 FR-008 동반: `grammar-lib.mjs`가 선언 라인 판정(`isFrDeclLine`)을 재사용하며 새 import가 생겨 픽스처도 복사해야 ERR_MODULE_NOT_FOUND 없이 게이트 실행(배선만, 판정 불변). 설치 스크립트는 이미 이 파일을 배포 중 |
| 2026-07-28 | `sdd-init.sh` 노드 복사 목록에 `ownership-reality-lib.mjs` 추가 + `pre-commit.test.mjs` 픽스처 lib 목록 동반 갱신 | 새 lib을 목록에 빠뜨렸을 때 init-then-execute 테스트가 `ERR_MODULE_NOT_FOUND`로 잡았다 — 소비 프로젝트에 도착하지 않는 배포 공백의 실증. 복사 목록은 이 spec 소유 |
| 2026-07-29 | sdd-sync RULES에 R7(Engines·Events) 추가 + `sdd-init.sh` 복사 목록에 `engine-event-lib.mjs`·`check-engine-event.mjs` 추가 | SPEC-030 동반: 전수성 게이트를 detector 스윕·소비 프로젝트 설치에 편입(미포함 시 게이트 누락). 두 정책 off 기본이라 스윕 비용 0 |
| 2026-07-30 | sdd-sync RULES에 R8(실행 증거)·R9(라이브 대조) 추가 + `sdd-edit-check.sh`가 `check-pre-edit.mjs`에 위임(node·스크립트 없으면 조용히 건너뜀 — 이식성) + sdd-init 매니페스트에 `evidence-lib`·`check-evidence`·`live-reality-lib`·`check-live-reality`·`check-pre-edit` 배선 | SPEC-031·032·003 FR-001 동반: 새 축을 detector 스윕·PreToolUse·소비 프로젝트 설치에 편입(미포함 시 게이트·경고 누락). 두 정책 기본 off라 스윕 비용 0 |
| 2026-07-30 | `sdd-sync` 게이트 항목이 `{file, args}` 형태를 받도록 확장 + R3에 `gen-ownership-map --check` 배선 | SPEC-028 드리프트 강제점: 일부 detector는 읽기 전용 모드 인자가 필요하다(무인자 `gen-ownership-map`은 파일을 **재생성**하므로 스윕에서 쓰면 안 된다). JSON 리포트의 `gate` 필드는 파일명 유지(계약 불변) |
| 2026-07-30 | sdd-sync RULES에 R10(동의어·형태 변이) 추가 + sdd-init 매니페스트에 `synonym-lib`·`check-synonym` 배선 | SPEC-033 동반: 의미적 중복 포획층을 detector 스윕·소비 설치에 편입. 기본 off라 스윕 비용 0 |
| 2026-08-02 | **훅 배선 실재 게이트 분리**(→ SPEC-036) + `hooks.list` 단일 선언 + 설치기 자기검증 + sdd-init가 pre-push까지 설치(선택 해제) | 실측 제보: `scripts/hooks/`에 pre-commit·pre-push가 버전관리돼 있었지만 `.git/hooks`엔 commit-msg만 복사돼 **게이트가 한 번도 발동하지 않았다**. 기존 판정 확인은 게이트 스크립트의 inert만 보고 훅 배선의 inert는 안 봤다 — 미설치가 green으로 읽혔다. 훅 이름 집합을 `hooks.list` 한 곳에 선언해 설치기·검사 게이트가 같은 파일을 읽고, 설치기는 끝에 자기검증한다(하드코딩만 있으면 훅 추가 시 한쪽이 뒤처진다). 남의 훅이 같은 이름을 점유한 경우도 마커로 구분한다 — 파일은 있는데 킷 게이트가 안 돌면 결과는 미설치와 같다 [검증: tooling/__tests__/hooks-install.test.mjs] |
| 2026-08-02 | **pre-push 성능**(FR-006 확장) — `--budget`(초과=미판정, 조용한 통과 금지) + `--hook`의 선언적 위임(`syncHookRules`·`syncHookDelegatedTo`) | 실측 제보: `sdd-sync --strict`가 30초+라 매 push가 멈춰 `--no-verify` 우회가 습관이 됐고, 그러면 훅이 통째로 무의미해진다. 킷에서 측정하니 스윕 30.3초 중 **R5(스위트 실행)가 29.8초, 나머지 10규칙 합계 0.5초** — 원인이 하나로 특정된다. 조용히 빼면 완화지만, ①실행 규칙을 config에 선언하고 ②담당자를 명시하며(없으면 에러) ③매 실행 "위임 — 누가 판정하나"를 출력하면 사유 있는 skipped(SPEC-032)와 같은 계약이라 미판정이 아니다. 킷 자기적용: R5를 CI에 위임 → **30.3초 → 1.5초** [검증: tooling/__tests__/hooks-install.test.mjs] |
| 2026-08-02 | 입도 회복 — 새 3 FR을 캡(10) 초과로 만들지 않기 위해 **분할**했다: 훅 배선 실재는 SPEC-036으로 떼고, 예산·위임은 pre-push 동작이므로 FR-006에 흡수 | 캡 초과의 정당한 해소는 분할·병합이지 `maxFRsPerSpec` 상향이 아니다(SPEC-027 FR-008이 상향을 차단한다). Symbols도 10→7로 캡 내 복귀 |
| 2026-08-02 | 설치 배선 — `check-deploy-debt.mjs`를 게이트 복사 목록·pre-commit 훅(프로젝트판·킷 self-hooks)에 편입 + `.gitignore`에 `.sdd/` 추가 | SPEC-035 FR-005 동반. 부채 파일은 로컬 세션 상태라 추적되면 "커밋해서 없앤다"가 갚는 방법이 된다. 게이트 부재 시에도 커밋이 죽지 않도록 훅은 존재 확인 후 호출한다(구버전 배선 하위호환) |
| 2026-08-02 | 설치 배선 — `changelog-fr-lib.mjs`를 `sdd-init` 게이트 복사 목록에 편입 | SPEC-037 동반. 새 lib을 목록에 넣지 않아 픽스처가 `ERR_MODULE_NOT_FOUND`로 죽었다 — SC-002("설치된 파일만으로 게이트가 실행된다")가 지키는 실패를 회귀 테스트가 실제로 잡았다 |
| 2026-08-02 | 설치 배선 — `check-deploy-precheck.mjs`·`sdd-deploy-precheck.sh`를 게이트 복사 목록과 `.claude/settings.json` PreToolUse(matcher `Bash`)에 편입. jq 병합 필터도 새 훅 이름을 걷어내도록 확장(재실행 idempotency) | SPEC-035 FR-006 동반. PostToolUse 래퍼와 달리 이 래퍼는 **종료 코드를 삼키지 않는다** — hard일 때 exit 2가 도구 실행을 막는 유일한 신호라, `|| true`를 붙이면 차단이 통째로 사라진다 |
| 2026-08-03 | 설치 배선 — `duplicate-logic-lib.mjs`·`check-duplicate-logic.mjs`를 게이트 복사 목록에 편입 + sdd-sync 규칙표에 R13 등재 + `agent-context.md`에 병렬 작업 규범 3줄(비-Claude 에이전트 상시 로드) | SPEC-038 동반. 규범(principles §5b)이 게이트 `off`인 프로젝트에서도 유효해야 하므로 상시 로드 문서에 함께 싣는다 |
| 2026-08-04 | 설치 배선 — `covers-backlink-lib.mjs`를 게이트 복사 목록·pre-commit 픽스처 목록에 편입 | SPEC-039 동반. 픽스처 목록을 함께 갱신하지 않으면 SC-002("설치된 파일만으로 게이트가 ERR_MODULE_NOT_FOUND 없이 실행된다")가 즉시 red가 된다 — 이번에도 그 회귀가 먼저 잡혔다(SPEC-037 라운드와 동일 패턴이라, 새 lib은 두 목록을 짝으로 갱신하는 것이 규칙이다) |
| 2026-08-09 | 설치 목록에 `verdict-lib.mjs` 추가 + 하네스 집계기를 판정 타입 소비로 전환(`gateOutcome` 3상태·`tallyGates`/`tallyLine`, `--json` 스키마 v1→v2에 `kind`·`tally` 추가) | SPEC-040 동반. 집계기가 게이트 stdout을 `/[⚠✗]/`로 훑어 추측하던 것이 "판정 안 함"을 `✓ clean`으로 세던 직접 원인이다 — 이제 게이트가 선언한 종류를 읽기만 한다. 요약은 **언제나** `게이트 N종 = 판정 M · 안 봄 K · 미판정 J`를 내어 초록의 분모를 밝힌다(`update.md` §7의 보고 형식이 사람 눈대중에서 계산으로 바뀐다). 새 lib이 설치 목록·테스트 픽스처 복사 목록 **양쪽**에 들어가야 하는 규칙은 이번에도 발현했다 — 픽스처 8곳이 `ERR_MODULE_NOT_FOUND`로 50건 실패했고 SPEC-004 SC-002가 그것을 잡았다 [검증: tooling/__tests__/pre-commit.test.mjs] |
| 2026-08-09 | R14(검증 실행 회계) 규칙 등재 + 설치 목록에 `verification-run-lib.mjs`·`check-verification-executed.mjs` 추가 + `--json` 규칙 목록 확장 | SPEC-041 동반. 스윕이 "선언된 증거가 돌았는가"를 규칙으로 갖게 됐다 — R8(증거 실재)의 다음 축이다. 새 lib은 설치 목록과 테스트 픽스처 복사 목록을 **짝으로** 갱신해야 한다는 규칙이 이번에도 유효했다 |
| 2026-08-09 | 집계기가 위반 **건수**도 게이트 선언(`위반 N건`)에서 읽는다 — 본문 `⚠`·`✗` 스캔 제거 | SPEC-040 동반. 판정 종류는 타입으로 옮겼으면서 건수는 여전히 산문을 세고 있었고, 그래서 **비차단으로 설계된 층**(R13 확률적 후보)이 경고를 출력한 순간 스윕이 규칙을 붉게 칠했다 — 게이트는 `위반 0건`이라 선언했는데 집계기가 반대로 읽었다. 하네스에 남아 있던 마지막 추측이다 |
| 2026-08-10 | 설치기 복사 목록에 `check-outcome-lib.mjs` 편입(배포 폐포 계약) + `pre-commit`·편집 가드 픽스처의 복사 목록을 폐포 계산으로 교체 | 실측: 계약이 있어도 목록이 **손목록**이면 새 모듈이 추가될 때마다 드리프트한다. 소비처는 판정 대신 `ERR_MODULE_NOT_FOUND`를 받는다 |
| 2026-08-10 | 생성 변경 이력(`docs/change_log.html`) 재생성 — 커밋 이력 반영 | 생성물이지만 커밋되므로 changeset에 실린다. 재생성 없이 커밋하면 다음 라운드에 "생성물이 낡았다"가 다른 축의 위반으로 뜨고, 그 신호는 고장 지점이 아닌 곳에서 뜬다 |
