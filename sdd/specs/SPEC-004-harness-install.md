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
- **FR-009** (event): WHEN `sdd-sync.mjs` is invoked with `--json`, THE SYSTEM SHALL emit to stdout only a machine-readable report — an object with `schemaVersion`, `clean`, `flaggedRules` (stable rule ids), and `rules` (each with a stable `id`, a `title`, a `flagged` flag, and `gates` each carrying `gate`, `flagged`, and `summary`) — suppressing the human-readable report, and SHALL keep the `--strict` contract of exiting non-zero when any rule is flagged.
- **FR-010** (event): WHEN `sdd-init.sh` runs (any gate), THE SYSTEM SHALL install the agent-context methodology doc to `.kiro/steering/sdd.md` and ensure a marker-delimited SDD block exists in `AGENTS.md` — creating the file if absent, appending the block while preserving existing content if present without the marker, and leaving it unchanged if the marker is already present (idempotent) — so non-Claude executors (Kiro, Codex, etc.) load the same orbit and entry rules the Claude SessionStart hook injects.

### Key Entities
- **install layout** — the deterministic `sdd/` tree, `sdd.config.json`, and wired hooks/settings/skills produced by init.
- **detector rule group** — R1/R2/R3 mapping of a rule to the gates the harness runs for it.
- **sync report** — the machine-readable `--json` contract the ask layer (`/sdd-sync`) consumes: a versioned object whose stable rule ids and gate flags let any executor route decisions deterministically instead of scraping human text.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts). Symbols = 소스 진입점, Artifacts = 설치 산출물.
- **Modules**: harness-install
- **Symbols**: sdd-sync.mjs, sdd-init.sh, pre-commit, pre-push, sdd-session-context.sh, sdd-edit-check.sh, sdd-run.mjs
- **Artifacts**: .git/hooks/pre-commit, .git/hooks/pre-push, .claude/settings.json, .claude/skills/sdd-sync/SKILL.md, .claude/skills/speckit-fix/SKILL.md, .kiro/steering/sdd.md, AGENTS.md
- **Files**: tooling/sdd-sync.mjs, tooling/sdd-init.sh, tooling/harness/pre-commit, tooling/harness/pre-push, tooling/harness/sdd-session-context.sh, tooling/harness/sdd-edit-check.sh, tooling/harness/speckit-fix.SKILL.md, tooling/harness/sdd-sync.SKILL.md, tooling/harness/agent-context.md, tooling/harness/self-hooks-install.sh, tooling/sdd-run.mjs, tooling/__tests__/sdd-sync.test.mjs, tooling/__tests__/init-gates.test.mjs, tooling/__tests__/init-hooks.test.mjs, tooling/__tests__/init-spec-sync.test.mjs, tooling/__tests__/pre-commit.test.mjs, tooling/__tests__/session-context.test.mjs, tooling/__tests__/edit-check.test.mjs

## Dependencies (참조 — dedup 제외)
> 설치되는 게이트·spec-sync는 아래 모듈들이 소유. 하네스는 이를 배선·호출만 한다.
- **Modules**: key-pipeline (references), spec-quality-gates (references), spec-sync (references)

---

## Success Criteria (측정형)
- **SC-001**: `sdd-sync.test.mjs`·`init-gates.test.mjs`·`init-hooks.test.mjs`·`init-spec-sync.test.mjs`·`pre-commit.test.mjs`·`session-context.test.mjs`·`edit-check.test.mjs`가 모두 통과한다(현재 green).
- **SC-002**: 신선한 프로젝트에서 `sdd-init.sh --gate=node` 후 설치된 파일만으로 게이트가 `ERR_MODULE_NOT_FOUND` 없이 실행된다.
- **SC-003**: `sdd-sync.mjs --json` 출력이 유효 JSON(사람 텍스트 누출 0)이며 스키마 회귀 테스트(`sdd-sync.test.mjs`)가 최상위 키·타입·rule id 집합·내부 정합(clean⟺flaggedRules 빔)을 green으로 잠근다.

## Non-Functional Requirements
- **NFR-001**: 재실행(idempotency) 시 `.claude/settings.json`에 SDD 훅 항목이 중복되지 않는다.

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
