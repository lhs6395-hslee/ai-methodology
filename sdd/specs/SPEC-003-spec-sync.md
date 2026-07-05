# Feature Specification: Spec-First Enforcement (spec-sync)

**Module**: `sdd-tooling`  **Spec**: `SPEC-003`  **Created**: 2026-07-02  **Status**: Active
**Input**: 소유(Files) 코드가 바뀌면 소유 스펙의 의미 있는 변경이 같은 changeset에 있어야 한다 — commit-msg 훅에서 hard, range에서 advisory.

---

## User Scenarios & Testing

### User Story 1 — 코드 변경에 스펙 동반 강제 (P1)
`check-spec-sync.mjs`는 변경된 코드 파일이 어떤 spec의 `Ownership.Files` glob에 매칭되면, 그 spec에 **의미 있는 변경**(FR 라인 +/-, 또는 Edge Cases/Change Log의 불릿·표 행 추가)이 같은 changeset에 있는지 확인한다. changeset = staged ∪ base...HEAD(브랜치). `spec-sync-lib.mjs`가 glob 컴파일과 diff 섹션 귀속을 순수 함수로 담당해 git 없이도 테스트된다.
- **Independent Test**: `spec-sync-lib.test.mjs`가 `compileGlob`·`scanFilesLineIssues`·`hasMeaningfulSpecChange`를 git 없이 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a staged code file matched by a spec's Files glob and no meaningful change in that spec, **When** the commit-msg hook runs `check-spec-sync.mjs --staged`, **Then** it reports a violation and exits non-zero.

### User Story 2 — 정직한 탈출구와 merge 예외 (P1)
스펙과 정말 무관한 변경은 커밋 메시지 트레일러 `Spec-Impact: none <사유>`로 통과하되 사유가 비면 실패한다(커밋에 영속 = 정직). git `commit-msg` 훅은 `MERGE_HEAD`가 있으면 merge 커밋으로 보고 skip한다(브랜치 커밋에서 이미 강제했고 range advisory가 백스톱).
- **Independent Test**: `commit-msg-hook.test.mjs`가 트레일러 사유 유무·merge skip·위반 차단을 임시 저장소로 검증.
- **Acceptance (GWT)**: 1. **Given** a commit message with `Spec-Impact: none` and no reason, **When** the gate runs staged, **Then** it exits non-zero demanding a reason.

### Edge Cases
- `Ownership.Files` 라인에 미지원 glob 문법이 있으면 spec별 1회 경고한다(지원 부분집합 `**`·`*`) — `{`·`?` 또는 위치가 잘못된 `**`는 어디서든, `[`는 **토큰이 `[`로 시작**할 때만(parseSection이 placeholder로 버리는 경우). 파일 라우팅 동적 세그먼트(`.../[id]/**`)는 토큰 중간이라 `compileGlob`이 리터럴로 정확히 매치하므로 경고하지 않는다.
- spec 파일이 index에서 삭제되면(수명주기) 의미 변경으로 인정한다.
- base(`origin/main`)를 해석할 수 없으면 range 모드는 판정을 건너뛰고(exit 0), staged 모드는 staged만으로 경고 판정한다.
- range(advisory) 모드는 위반이 있어도 exit 0으로 안내만 하고, hard 차단은 staged(commit-msg) 모드에서만 일어난다.
- FR 라인 판정은 레터 서픽스 FR 라인의 추가/삭제도 의미 있는 변경으로 인정한다 — SPEC-001/002와 동일한 요구 ID 문법(접두어는 `requirementIdPrefixes` 파생, 3자리 + 선택적 소문자 서픽스 1자). 순수 코어(`spec-sync-lib`)는 config를 직접 읽지 않으므로 호출부(`check-spec-sync`)가 파생 alternation을 주입하고, 미주입 시 기본 접두어로 하위호환 동작한다. (이 항목에 ID 예시를 안 쓰는 이유: 게이트가 예시 토큰을 이 spec의 FR 집계에 포함시키기 때문.)
- CLI base 인자는 `--message-file` 부재 시에도 첫 positional로 인식된다 — 옵션 인덱스 계산(mi=-1 → mi+1=0)이 첫 인자를 오배제해 base가 조용히 기본값(`origin/main`)으로 대체되던 회귀 금지.

---

## Functional Requirements (EARS)
> 정본은 영어.

- **FR-001** (event): WHEN a changed code file matches a spec's `Ownership.Files` glob, THE SYSTEM SHALL require a meaningful change to that spec in the same changeset (staged ∪ base...HEAD), where meaningful = an added/removed FR line or an added bullet/table row under Edge Cases or Change Log.
- **FR-002** (state): WHILE running with `--staged --message-file`, THE SYSTEM SHALL treat violations as hard errors and exit non-zero; WHILE running in range mode (a base ref only), THE SYSTEM SHALL treat violations as non-blocking advisories and exit zero.
- **FR-003** (unwanted): IF the commit message contains `Spec-Impact: none` without a trailing reason, THEN THE SYSTEM SHALL exit non-zero; WHERE a non-empty reason is present, THE SYSTEM SHALL pass and record it as a persisted trailer.
- **FR-004** (event): WHEN the git `commit-msg` hook detects `MERGE_HEAD`, THE SYSTEM SHALL skip the spec-sync check for the merge commit and rely on the range advisory as backstop.
- **FR-005** (event): WHEN a raw `- **Files**:` line contains unsupported glob syntax — `{` or `?` anywhere, a misplaced `**`, or a token **beginning** with `[` (a placeholder `parseSection` would drop) — THE SYSTEM SHALL warn once per spec that only `**` and `*` are supported; a mid-token file-routing dynamic segment such as `.../[id]/**` is matched literally by `compileGlob` and SHALL NOT be flagged.
- **FR-006** (unwanted): IF the base ref cannot be resolved, THEN in range mode THE SYSTEM SHALL skip judgment and exit zero, and in staged mode THE SYSTEM SHALL judge from the staged set only with a notice.
- **FR-007** (ubiquitous): THE SYSTEM SHALL compile `Ownership.Files` globs as anchored, case-sensitive POSIX patterns where `**` spans zero-or-more path segments and `*` matches within one segment, stripping trailing inline comments before compiling.
- **FR-008** (event): WHEN `check-converge-drift.mjs` runs against a base ref, THE SYSTEM SHALL report code changes (files under `scanDirs`) not accompanied by any spec change as a drift advisory, exiting zero in advisory mode and non-zero under `--strict`; WHERE git diff is unavailable, THE SYSTEM SHALL skip judgment and exit zero.
- **FR-009** (event): WHEN `check-orphan-surfaces.mjs` runs and `surfaceGlobs` is non-empty, THE SYSTEM SHALL report any surface file matched by `surfaceGlobs` that is not declared in any spec's `Ownership` block as an orphan advisory, exiting zero in advisory mode and non-zero under `--strict`; WHERE `surfaceGlobs` is empty, THE SYSTEM SHALL exit zero as a no-op.
- **FR-010** (event): WHEN a changed code file matches no spec's `Files` glob, THE SYSTEM SHALL apply the declared `specSyncUnownedPolicy` — silent (default, current behavior), warn (advisory line in any mode), or error (hard violation in staged mode, advisory in range mode) — with `specSyncExemptGlobs` as the declared escape; an out-of-enum policy value SHALL exit non-zero.

### Key Entities
- **changeset** — the union of staged files and `base...HEAD` diff on the branch, against which ownership matching runs.
- **meaningful spec change** — an FR line delta, or a new Edge Cases / Change Log bullet or table row, detected from the post-image and its diff slice.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: spec-sync
- **Symbols**: check-spec-sync.mjs, spec-sync-lib.mjs, check-converge-drift.mjs, check-orphan-surfaces.mjs
- **Artifacts**: .git/hooks/commit-msg
- **Files**: tooling/check-spec-sync.mjs, tooling/spec-sync-lib.mjs, tooling/harness/commit-msg, tooling/check-converge-drift.mjs, tooling/check-orphan-surfaces.mjs, tooling/__tests__/check-spec-sync.test.mjs, tooling/__tests__/spec-sync-lib.test.mjs, tooling/__tests__/commit-msg-hook.test.mjs, tooling/__tests__/check-converge-drift.test.mjs, tooling/__tests__/check-orphan-surfaces.test.mjs

## Dependencies (참조 — dedup 제외)
> glob 매칭 대상 키의 파싱은 SPEC-001 파이프라인에 위임.
- **Modules**: key-pipeline

---

## Success Criteria (측정형)
- **SC-001**: `check-spec-sync.test.mjs`·`spec-sync-lib.test.mjs`·`commit-msg-hook.test.mjs`의 모든 케이스가 통과한다(현재 green).
- **SC-002**: 소유 코드만 바뀌고 스펙 동반이 없는 스테이징에서 commit-msg 훅이 exit 1로 100% 차단한다(거짓음성 0).

## Non-Functional Requirements
- **NFR-001**: `spec-sync-lib.mjs`는 git·파일시스템에 비의존한 순수 함수라 결정적으로 단위 테스트된다.

## Assumptions / Clarifications Retained
- range 모드 base 기본값은 `origin/main`(또는 `SDD_DIFF_BASE`) — 브랜치에 스펙만 추가되는 경우 위반은 0이다.

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 게이트 전종·전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-001(key-pipeline): 비중복 — glob·섹션 파싱은 참조.
- 2026-07-05 이웃 SPEC-008(spec-lifecycle): 비중복 — Draft 차단의 상태 판정은 SPEC-008 소유, 이 spec은 changeset 판정에 그 결과를 소비.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | check-converge-drift.mjs + check-orphan-surfaces.mjs(+ 테스트) + FR-008·009 편입 — maxFRsPerSpec 9로 상향(sdd.config.json) | spec↔code 드리프트 탐지·고아 표면 탐지는 spec-first 강제(spec-sync)의 R2 보완 — sdd-sync R2 배선 집합의 응집 home; FR 9개는 한 capability 묶음(staged·range·escape·merge·glob·drift·orphan) |
| 2026-07-02 | FR 라인 패턴 레터 서픽스 지원 | SPEC-001/002와 FR ID 문법 통일(사이트 간 불일치 금지) — /speckit.fix |
| 2026-07-02 | `[` 경고를 토큰-시작 위치로 한정(FR-005 개정) — 파일 라우팅 `.../[id]/**`는 리터럴 매치라 미경고 + 테스트 | 도그푸딩(PM솔루션): Next.js 동적 세그먼트를 Files glob에 쓰면 정확 매치되는데도 false-positive 경고 — parseSection 드롭 조건(토큰 시작 `[`)에 정렬 |
| 2026-07-05 | FR 라인 판정 접두어를 `requirementIdPrefixes` 파생 주입으로 전환 + base positional 오배제 버그 수정(+ 회귀 테스트 2건) | 진단 B-2(전 사이트 문법 통일) + 패리티 작업 중 발견: `--message-file` 부재 시 첫 positional(base)이 조용히 무시됨 — 조용한 대체 금지(문법화, SPEC-006 연동) |
| 2026-07-05 | Draft 스펙 소유 코드 차단 통합(스펙 동반 여부 무관 위반, staged 하드·range advisory) — 상태 판정 코어는 SPEC-008 소유 | 진단 Q1·Q3 승인(P1): 리뷰 없는 Draft 스펙이 코드를 이끄는 구멍 봉합, 탈출구는 기존 트레일러 하나 |
| 2026-07-05 | FR-010 신설 — `specSyncUnownedPolicy`(silent\|warn\|error)로 미소유 파일 침묵 통과를 선언된 정책으로 승격(FR 10개 — maxFRsPerSpec 10 상향, sdd.config.json) | 진단 Q1 구멍 승인(P2): "Files 미매치 = 침묵"은 테스트로 고정된 의도였으나 미선언 정책 — 문법화(exempt 조합 탈출, error=closed-world) |
