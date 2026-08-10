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
- **소유 파일을 제거하는 경로가 있어야 한다 — 없으면 사람이 훅을 건너뛴다.** 두 검사가 changeset을 "추가·수정만"으로 가정해 삭제 상태(`D`)를 구분하지 않았고, 그래서 **정답 경로가 아예 없었다**(실측 제보): ⓐ 선언 제거 + 삭제를 한 커밋에 넣으면 스펙을 `index ∪ HEAD` 합집합으로 읽으므로 HEAD가 아직 선언한 경로가 "Files 리터럴 부재"로 걸리고, ⓑ 두 커밋으로 쪼개면 삭제된 파일이 unowned closed-world에 걸린다. 결과는 `--no-verify`였고, 그 순간 이 게이트가 존재하는 이유가 물러진다. `specSyncExemptGlobs`로 빼는 것도 답이 아니다 — **지우는 파일 때문에 영구 예외**가 config에 남아 부채가 반대 방향으로 쌓인다. 삭제 경로를 두 검사에서 제외하면 **ⓐ가 자연스러운 정답 경로**가 된다. 삭제는 "잘못 적힌 경로"도 "소유 없는 파일"도 아닌 세 번째 상태다.
- **`Spec-Impact: none`의 면제 범위를 넓히지 않는다** — 그 트레일러는 "스펙 영향 없음"을 뜻하는데 소유 파일 제거는 명백히 스펙 영향이 있다. 면제로 덮으면 글롭 오타·리네임 누락까지 함께 통과해 검사가 무의미해진다(제보자 판단과 동일). 정책 knob(`specSyncDeletedFilePolicy`)도 두지 않는다 — `strict`를 원할 상황이 없고, 없는 선택지를 만들면 그 자체가 완화 경로가 된다.
- **`specSyncExemptGlobs`는 소유 판정보다 먼저 적용된다 — 의도된 기능이자 소유권 무효화 경로.** 소유 글롭이 과포함한 생성물·락파일을 좁히는 용도이므로(`src/lib/pdf/**` 소유 + `src/lib/pdf/generated/**` 면제) 소유를 덮는 것이 정당하다. 그러나 그 결과 어느 스펙의 **선언된 소유권이 조용히 무효화**될 수 있다 — 게이트 출력만 보면 알 수 없었다. 실측(소비 프로젝트 PM): `**/__tests__/**`가 면제돼 TEST-001이 26 FR로 소유를 선언한 테스트 37건을 포함해 총 76건의 spec-first 강제가 발화하지 않았다. 강도를 바꾸지 않고 **사실을 적는다** — 면제가 어느 스펙의 소유를 덮는지 게이트가 이름과 함께 출력하고, 그 덮음이 정당한지(과포함 좁히기인지 남용인지)는 config 리뷰가 판단한다. ⚠ 규범 진술이 둘로 갈려 있다: FR-010은 exempt를 "매치하는 스펙이 없을 때"의 escape로 정의하고, `sdd.config.presets.md`는 "`Files` glob이 과포함한" 것을 좁히는 용도로 적는다. 구현·테스트는 후자다(전자로 좁히면 정당한 생성물 면제가 깨진다 — 실측 확인).
- `Ownership.Files` 라인에 미지원 glob 문법이 있으면 spec별 1회 경고한다(지원 부분집합 `**`·`*`) — `{`·`?` 또는 위치가 잘못된 `**`는 어디서든, `[`는 **토큰이 `[`로 시작**할 때만(parseSection이 placeholder로 버리는 경우). 파일 라우팅 동적 세그먼트(`.../[id]/**`)는 토큰 중간이라 `compileGlob`이 리터럴로 정확히 매치하므로 경고하지 않는다.
- spec 파일이 index에서 삭제되면(수명주기) 의미 변경으로 인정한다.
- base(`origin/main`)를 해석할 수 없으면 range 모드는 판정을 건너뛰고(exit 0), staged 모드는 staged만으로 경고 판정한다.
- range(advisory) 모드는 위반이 있어도 exit 0으로 안내만 하고, hard 차단은 staged(commit-msg) 모드에서만 일어난다.
- FR 라인 판정은 레터 서픽스 FR 라인의 추가/삭제도 의미 있는 변경으로 인정한다 — SPEC-001/002와 동일한 요구 ID 문법(접두어는 `requirementIdPrefixes` 파생, 3자리 + 선택적 소문자 서픽스 1자). 순수 코어(`spec-sync-lib`)는 config를 직접 읽지 않으므로 호출부(`check-spec-sync`)가 파생 alternation을 주입하고, 미주입 시 기본 접두어로 하위호환 동작한다. (이 항목에 ID 예시를 안 쓰는 이유: 게이트가 예시 토큰을 이 spec의 FR 집계에 포함시키기 때문.)
- CLI base 인자는 `--message-file` 부재 시에도 첫 positional로 인식된다 — 옵션 인덱스 계산(mi=-1 → mi+1=0)이 첫 인자를 오배제해 base가 조용히 기본값(`origin/main`)으로 대체되던 회귀 금지.
- **차단 출구는 전부 계측된다(SPEC-049)** — 이 게이트가 막을 때 그 발화를 원장에 남긴다. 계측 자리를 한 곳에만 두면 다른 경로로 막힐 때 기록이 없어 "한 번도 안 돌았다"로 **오회계**된다(실측: spec-first 출구만 계측했더니 unowned 차단이 기록 없이 지나갔다). 계약 테스트가 모든 차단 `exit(1)` 직전의 계측을 정적으로 검사하되, **config 문법 위반 출구는 제외**한다 — 그건 판정을 시작조차 못 한 상태이고 발화로 기록하면 원장이 거짓을 담는다.

- **편집 시점 강도의 종착지가 도달 가능해야 한다** — 이전 판은 `off|advisory`에서 끝나 이 층이 표현할 수 있는 최대치가 경고였고, 쉘 래퍼는 종료코드를 버렸다(`2>/dev/null` + 무조건 `exit 0`). **경고는 급할 때 가장 먼저 무시된다.**
- **차단해도 체크리스트는 먼저 보여준다** — 막으면서 무엇을 하라는지 주지 않으면 사람은 아무도 모르는 우회로를 찾는다(SPEC-053과 같은 규율).
- **판정 못 하는 자리는 절대 막지 않는다** — git 없음·미소유 경로·변경 집합 미해석은 침묵 통과다. 거짓 차단은 오탐이고, 오탐이 잦은 게이트는 꺼진다.
- **강제 선언과 실제가 어긋난 상태를 자백한다** — `hard`인데 판정할 런타임(node)이 없으면 그 프로젝트는 강제가 켜졌다고 믿으면서 보호가 0이다. 막지는 않되(런타임 부재로 편집을 멈추면 작업이 통째로 죽는다) 매 발동 그 사실을 말한다 — **hard 선언 + 무판정 = 거짓 안전.**
---

## Functional Requirements (EARS)
> 정본은 영어.

- **FR-001** (event): WHEN a changed code file matches a spec's `Ownership.Files` glob, THE **spec-sync** (E) enforcement SHALL require a meaningful change to that spec in the same changeset (staged ∪ base...HEAD), where meaningful = an added/removed FR line or an added bullet/table row under Edge Cases or Change Log. — capability: **spec-sync.enforce** (C). WHERE `preEditSpecFirstPolicy` is advisory, **check-pre-edit.mjs** (S) SHALL additionally warn at edit time (PreToolUse) that an owned file's spec is untouched in this branch, and WHERE that policy is strict it SHALL instead refuse the edit, in both cases naming the sections where the spec's decisions live and stating that the way out is editing the specification; it SHALL stay silent when the path is unowned, the spec is already touched, or the changeset cannot be resolved, so that a verdict is never produced where it cannot be judged — and the hook wrapper SHALL propagate the refusal rather than discarding it, because a strength ladder whose top rung cannot be reached is not a ladder.
- **FR-002** (state): WHILE running with `--staged --message-file`, THE **check-spec-sync.mjs** (S) gate SHALL judge under the HEAD-committed `sdd.config.json` whenever the staged config differs from it — so a commit that weakens the config is judged by the pre-change rules — and SHALL treat violations as hard errors exiting non-zero; WHILE running in range mode (a base ref only), THE SYSTEM SHALL treat violations as non-blocking advisories and exit zero.
- **FR-003** (unwanted): IF the commit message contains `Spec-Impact: none` without a trailing reason, THEN THE SYSTEM SHALL exit non-zero; WHERE a non-empty reason is present, THE SYSTEM SHALL waive only the accompaniment requirement and the status block, recording the persisted trailer — the Files glob-syntax check and the unowned-file policy SHALL remain enforced.
- **FR-004** (event): WHEN the git `commit-msg` hook detects `MERGE_HEAD`, THE SYSTEM SHALL skip the spec-sync check for the merge commit and rely on the range advisory as backstop.
- **FR-005** (event): WHEN a raw `- **Files**:` line contains unsupported glob syntax — `{` or `?` anywhere, a misplaced `**`, or a token beginning with `[` (a placeholder `parseSection` would drop) — THE SYSTEM SHALL warn once per spec that only `**` and `*` are supported; a mid-token file-routing dynamic segment such as `.../[id]/**` is matched literally by `compileGlob` and SHALL NOT be flagged.
- **FR-006** (unwanted): IF the base ref — resolved as CLI positional, then `SDD_DIFF_BASE`, then config `specSyncBase`, then `origin/main` — cannot be verified, THEN in range mode THE SYSTEM SHALL skip judgment and exit zero, and in staged mode THE SYSTEM SHALL judge from the staged set only, noticing the degradation and the base-configuration remedy.
- **FR-007** (ubiquitous): THE **spec-sync-lib.mjs** (S) pure core SHALL compile `Ownership.Files` globs as anchored, case-sensitive POSIX patterns where `**` spans zero-or-more path segments and `*` matches within one segment, stripping trailing inline comments before compiling.
- **FR-008** (event): WHEN **check-converge-drift.mjs** (S) runs against a base ref, THE SYSTEM SHALL report code changes (files under `scanDirs`) not accompanied by any spec change as a drift advisory, exiting zero in advisory mode and non-zero under `--strict`; WHERE git diff is unavailable, THE SYSTEM SHALL skip judgment and exit zero.
- **FR-009** (event): WHEN **check-orphan-surfaces.mjs** (S) runs and `surfaceGlobs` is non-empty, THE SYSTEM SHALL report any surface file matched by `surfaceGlobs` that is not declared in any spec's `Ownership` block as an orphan advisory, exiting zero in advisory mode and non-zero under `--strict`; WHERE `surfaceGlobs` is empty, THE SYSTEM SHALL exit zero as a no-op.
- **FR-010** (event): WHEN a changed code file matches no spec's `Files` glob, THE SYSTEM SHALL apply the declared `specSyncUnownedPolicy` — silent (default, current behavior), warn (advisory line in any mode), or error (hard violation in staged mode, advisory in range mode) — with `specSyncExemptGlobs` as the declared escape; an out-of-enum policy value SHALL exit non-zero. WHERE a path is deleted in the judged changeset, THE SYSTEM SHALL exclude it from both the unowned set and the Files literal-existence check, because a deleted path is neither a mistyped declaration nor an unowned file but a third state — without that exclusion no ordering of declaration removal and file deletion can pass, and the only remaining exit is to bypass the hook.

### Key Entities
- **changeset** — the union of staged files and `base...HEAD` diff on the branch, against which ownership matching runs.
- **meaningful spec change** — an FR line delta, or a new Edge Cases / Change Log bullet or table row, detected from the post-image and its diff slice.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: spec-sync
- **Symbols**: check-spec-sync.mjs, spec-sync-lib.mjs, check-converge-drift.mjs, check-orphan-surfaces.mjs, check-pre-edit.mjs
- **Artifacts**: .git/hooks/commit-msg
- **Capabilities**: spec-sync.enforce
- **Files**: tooling/check-spec-sync.mjs, tooling/spec-sync-lib.mjs, tooling/harness/commit-msg, tooling/check-converge-drift.mjs, tooling/check-orphan-surfaces.mjs, tooling/__tests__/check-spec-sync.test.mjs, tooling/__tests__/spec-sync-lib.test.mjs, tooling/__tests__/commit-msg-hook.test.mjs, tooling/__tests__/check-converge-drift.test.mjs, tooling/__tests__/check-orphan-surfaces.test.mjs, tooling/check-pre-edit.mjs, tooling/__tests__/pre-edit.test.mjs

## Dependencies (참조 — dedup 제외)
> glob 매칭 대상 키의 파싱은 SPEC-001 파이프라인에 위임.
- **Modules**: key-pipeline (references)

---

## Success Criteria (측정형)
- **SC-001**: `check-spec-sync.test.mjs`·`spec-sync-lib.test.mjs`·`commit-msg-hook.test.mjs`의 모든 케이스가 통과한다(현재 green). [검증: tooling/__tests__/check-spec-sync.test.mjs, tooling/__tests__/spec-sync-lib.test.mjs, tooling/__tests__/commit-msg-hook.test.mjs]
- **SC-002**: 소유 코드만 바뀌고 스펙 동반이 없는 스테이징에서 commit-msg 훅이 exit 1로 100% 차단한다(거짓음성 0). [검증: tooling/__tests__/check-spec-sync.test.mjs, tooling/__tests__/spec-sync-lib.test.mjs, tooling/__tests__/commit-msg-hook.test.mjs]

## Non-Functional Requirements
- **NFR-001**: `spec-sync-lib.mjs`는 git·파일시스템에 비의존한 순수 함수라 결정적으로 단위 테스트된다. [검증: tooling/__tests__/check-spec-sync.test.mjs, tooling/__tests__/spec-sync-lib.test.mjs, tooling/__tests__/commit-msg-hook.test.mjs]

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
| 2026-08-10 | `check-pre-edit`에 `--is-code-path` 질의 모드 추가(exit 0=코드, 1=아님; `scanDirs`가 정본, 판정이 아니라 SKIPPED) | 편집 가드 쉘이 코드 경로를 `case src/|lib/|app/`로 **하드코딩**하고 있었고 주석은 "설치기가 조정한다"고 적혀 있었지만 설치기는 그 파일을 복사만 했다. 실측: 킷의 `scanDirs`는 `tooling`이라 체크리스트가 **한 번도 발화할 수 없었다** — 하드코딩된 어휘 밖에서 판정이 사라지고 그 0건이 진짜 0건과 구분되지 않는다. 판정 입력(경로 집합)은 이미 이 스펙의 게이트가 알고 있으므로 쉘이 물어보게 했다(새 knob 0 — `scanDirs`가 이미 "이 프로젝트의 코드가 어디 있는가"의 정본이다) [검증: tooling/__tests__/edit-check.test.mjs] |
| 2026-08-10 | 차단 출구 4곳(spec-first·unowned·semantic drift·Draft·glob)에 분기 발화 계측 추가(SPEC-049) + 계측 계약 테스트 | 이 게이트가 킷의 가장 자주 발화하는 차단 경로이므로 실행 관측 회계의 첫 배선 대상이다. 한 곳만 계측했을 때 unowned 차단이 기록 없이 지나가는 것을 실측으로 즉시 확인했고 — 그게 제보가 지적한 결함 계열과 같은 모양이라 — 계약으로 고정했다. 원장 미선언이면 아무 일도 하지 않는다(결합 0) [검증: tooling/__tests__/verification-run.test.mjs] |
| 2026-08-10 | `specSyncExemptGlobs` **좁힘** — 포괄 `*.html`·`docs/**`를 `docs/design/**`·`docs/examples/**`·`docs/*.md`로 대체 | SPEC-045가 소개 HTML 3종을 소유하기 시작한 순간 게이트가 **자기 모순을 지목했다**: "면제 글롭이 SPEC-045의 Files 소유를 덮는다 — 그 스펙의 spec-first 강제가 이 파일에 발화하지 않는다." 소유를 선언하고 동시에 면제로 빼는 것은 선언을 거짓으로 만드는 것이라, 면제를 좁혀 소개 문서 편집이 소유 스펙(SPEC-045) 갱신을 동반하도록 되돌렸다. 좁힘은 강화라 래칫과 충돌하지 않는다. 이 경고는 오래 출력되고 있었고 이번에 실효를 갖게 된 것이 아니라 — 이번에 **덮는 대상이 생겨서** 의미를 갖게 됐다 [검증: tooling/__tests__/spec-sync.test.mjs] |
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | check-converge-drift.mjs + check-orphan-surfaces.mjs(+ 테스트) + FR-008·009 편입 — maxFRsPerSpec 9로 상향(sdd.config.json) | spec↔code 드리프트 탐지·고아 표면 탐지는 spec-first 강제(spec-sync)의 R2 보완 — sdd-sync R2 배선 집합의 응집 home; FR 9개는 한 capability 묶음(staged·range·escape·merge·glob·drift·orphan) |
| 2026-07-02 | FR 라인 패턴 레터 서픽스 지원 | SPEC-001/002와 FR ID 문법 통일(사이트 간 불일치 금지) — /speckit.fix |
| 2026-07-02 | `[` 경고를 토큰-시작 위치로 한정(FR-005 개정) — 파일 라우팅 `.../[id]/**`는 리터럴 매치라 미경고 + 테스트 | 도그푸딩(소비 프로젝트 A): Next.js 동적 세그먼트를 Files glob에 쓰면 정확 매치되는데도 false-positive 경고 — parseSection 드롭 조건(토큰 시작 `[`)에 정렬 |
| 2026-07-05 | FR 라인 판정 접두어를 `requirementIdPrefixes` 파생 주입으로 전환 + base positional 오배제 버그 수정(+ 회귀 테스트 2건) | 진단 B-2(전 사이트 문법 통일) + 패리티 작업 중 발견: `--message-file` 부재 시 첫 positional(base)이 조용히 무시됨 — 조용한 대체 금지(문법화, SPEC-006 연동) |
| 2026-07-05 | Draft 스펙 소유 코드 차단 통합(스펙 동반 여부 무관 위반, staged 하드·range advisory) — 상태 판정 코어는 SPEC-008 소유 | 진단 Q1·Q3 승인(P1): 리뷰 없는 Draft 스펙이 코드를 이끄는 구멍 봉합, 탈출구는 기존 트레일러 하나 |
| 2026-07-05 | FR-010 신설 — `specSyncUnownedPolicy`(silent\|warn\|error)로 미소유 파일 침묵 통과를 선언된 정책으로 승격(FR 10개 — maxFRsPerSpec 10 상향, sdd.config.json) | 진단 Q1 구멍 승인(P2): "Files 미매치 = 침묵"은 테스트로 고정된 의도였으나 미선언 정책 — 문법화(exempt 조합 탈출, error=closed-world) |
| 2026-07-05 | git 호출에 `core.quotepath=off` — 비ASCII 경로가 8진수 인용 문자열로 나와 glob 매칭·디렉토리 귀속이 조용히 깨지던 것 수정(spec-sync·converge, + 한글 파일명 회귀 테스트) | 도그푸딩(이 레포 방법론.html): P2 warn이 인용된 경로를 unowned로 오판해 발견 — 조용한 미매치 금지 |
| 2026-07-06 | Files 글롭 미지원 문법(`{`·`?`·선두 `[`)을 staged(hard)에서 exit 1로 승격 — range는 advisory 유지, 판정 정책은 SPEC-013 소유 | 고도화 4차: 템플릿의 "금지" 문법이 warn뿐이라 매치 실패 = 소유가 조용히 풀리는 미강제 규범이었음 — staged 차단으로 문법화 |
| 2026-07-09 | check-spec-sync.mjs에 `draftBlockPolicy` 분기(range 모드에서도 Draft 위반 hard 승격) 배선 — 판정 요구(FR-007)는 SPEC-008 소유, 이 spec은 그 분기가 사는 파일(check-spec-sync.mjs)만 소유 | SPEC-008 FR-007 신설 동반 — 도그푸딩(소비 프로젝트 B): 웹 UI 병합이 로컬 commit-msg 훅을 우회하는 사각지대 봉합 |
| 2026-07-09 | `spec-sync-lib.mjs` 설계 근거 주석 경로 정정(`docs/superpowers/specs/` → `docs/design/`) | STORAGE §2.7 신설 동반 — 킷 자신의 설계 문서가 새 규약 위치로 이동, 참조 경로 동기(동작 변경 없음) |
| 2026-07-16 | spec-sync 위반·advisory 메시지를 중립-우선으로: remediation을 `node scripts/sdd-sync.mjs`/스펙 Change Log로 안내하고 Claude 슬래시(/sdd-sync·/speckit.fix)는 괄호 편의로 강등, Node·Python 바이트 동일 | 에이전트 중립 방향(사용자 결정): 강제 계층은 에이전트를 가정하지 않는다 — Codex/무-에이전트 사용자가 없는 슬래시 커맨드에 막히지 않게 |
| 2026-07-16 | spec-sync가 리네임 감지(`--find-renames`)·FR라인 diff·Spec-Impact 트레일러를 수집해 `drift-lib.escalations`로 승격 판정을 배선 + 리포트/exit 통합, Node·Python 바이트 동일 | SPEC-019 FR-001 동반: 소유 파일 리네임 시 요구를 "FR 라인 변경 ∨ Spec-Impact"로 승격(판정 코어는 SPEC-019, 이 게이트는 소비·배선) |
| 2026-07-16 | spec-sync가 `Change-Driver` 트레일러를 파싱(`cross-spec-lib`)해 의미변경 동인이면 소유 스펙 요구를 참조 완화 — 위반 대신 cross-spec 노트, Node·Python 바이트 동일 | SPEC-020 FR-002 동반: 공유 표면을 타 스펙 기능 때문에 고칠 때 억지 Change Log 제거(판정 코어는 SPEC-020, 이 게이트는 소비·배선) |
| 2026-07-16 | 감사 봉합 3종 — ① FR-002 개정: staged 판정을 HEAD 시점 config로(자기약화 커밋은 약화 전 규칙이 심판, `configFromString` 소비) ② FR-003 개정: `Spec-Impact: none` 면제를 동반 요구·상태 차단으로 한정(글롭 문법 hard·unowned closed-world는 우회 불가 — 파일 수집 전 전면 exit 0 단락 제거) ③ FR-006 개정: base 해석 체인에 config `specSyncBase` 추가 + 미해석 시 remediation 안내(멀티커밋 브랜치 오차단 경고). Node·Python 패리티 | 감사 T1·T3·M2: 트레일러가 커밋 전체의 모든 하위 검사를 단락하고(closed-world의 기계 하한이 "비어있지 않은 문자열 1개"로 붕괴), base 미해석 시 선언된 changeset=브랜치 의미론이 조용히 staged-only로 저하되던 결함 실증 |
| 2026-07-27 | FR-001·002·007~009의 익명 주어를 실제 판정 주체로 교체해 소유 키 5종을 앵커(FR-001 spec-sync(E)·FR-002 check-spec-sync.mjs·FR-007 spec-sync-lib.mjs·FR-008 check-converge-drift.mjs·FR-009 check-orphan-surfaces.mjs) — 백틱 인용 2건은 앵커로 승격, 판정 내용 무변 | SPEC-001 FR-010으로 역할 선언이 들어오며 SPEC-023 키 앵커(FR-005·006·007)가 킷 자신에게 처음 발화 — 자기적용 마이그레이션(감사 이슈 #21) |
| 2026-07-28 | exempt가 스펙의 Files 소유를 덮을 때 **그 사실을 출력**하도록 — 덮는 스펙 ID를 함께 적는다. 강도·exit·우선순위 불변 | 소비 프로젝트 PM 실측: 면제 글롭이 선언된 소유권 76건(TEST-001 37건 포함)을 조용히 무효화하고 있었고 게이트 출력에 신호가 없었다. ⚠ 처음엔 우선순위를 뒤집어(소유 우선) 고치려 했으나 **테스트가 반증**했다 — `src/lib/pdf/**` 소유 안의 `generated/**` 면제가 이미 고정된 의도된 시나리오다(presets 규범의 "과포함 좁히기"). 우선순위는 정당하므로 침묵만 없앤다. 이번 세션 내내 나온 "선언했는데 발화 안 하는 가드" 계열의 처방과 동일 |
| 2026-07-28 | `check-spec-sync.mjs`에 Files 리터럴 경로 실재 검증 배선 + `spec-sync-lib.mjs`에 `filesLineMissingPaths` 순수 코어 | SPEC-013 신설 항목의 소비. 게이트 본체·라이브러리는 이 spec 소유이므로 배선 이력을 남긴다. 판정 강도는 미지원 글롭 문법과 동일(staged hard) |
| 2026-07-30 | pre-edit spec-first 배선(FR-001 확장) — `check-pre-edit.mjs` 신설 + `preEditSpecFirstPolicy`(off\|advisory). 소유 파일 편집 직전 소유 스펙이 이 브랜치에서 미수정이면 경고(비차단·미소유/무git은 침묵) | owner 개정 요청 R3(실측 gsn-ai-pm): spec-first가 commit-msg 훅뿐이라 **사후 검사**였다 — 편집 중 마찰이 0이라 순서 위반이 자각되지 않은 채 커밋 시점까지 진행됐다. 차단이 아니라 마찰을 만드는 것이 목적 |
| 2026-08-03 | `spec-sync-lib`에 `parseFilesLine` 신설 — Files 라인 glob 파싱의 단일 사이트. `check-pre-edit`·`check-deploy-guard`·`check-ownership` 세 곳의 동형 정규식을 이것으로 교체 | SPEC-038(구현 중복 게이트)이 도입 즉시 킷 자기적용에서 실수확한 첫 건이다. Files 라인 문법은 스펙 문법이라 사이트마다 정규식을 두면 문법이 바뀔 때 한 곳만 고쳐지고 나머지는 조용히 뒤처진다 — SPEC-001의 "사이트별 자체 정규식 금지"와 같은 이유 [검증: tooling/__tests__/duplicate-logic.test.mjs] |
| 2026-08-04 | FR-010 개정 — 판정 changeset에서 **삭제된 경로**를 unowned 집합과 Files 리터럴 실재 검사 **양쪽에서 제외**. Node·Python 동시 | 실측 제보(operations-dashboard): 소유 파일을 저장소에서 없애는 변경이 **어떤 순서로도 통과하지 못했다** — 한 커밋(선언 제거+삭제)은 리터럴 부재로, 두 커밋으로 쪼개면 unowned closed-world로 막혔다. 정답 경로가 없으니 사람이 `--no-verify`로 우회했고, 그 순간 이 게이트가 존재하는 이유가 물러진다. 삭제는 "잘못 적힌 경로"도 "소유 없는 파일"도 아닌 **세 번째 상태**다. 트레일러 면제 확대·정책 knob은 둘 다 기각(제보자 판단과 동일) [검증: tooling/__tests__/check-spec-sync.test.mjs] |
| 2026-08-09 | `check-orphan-surfaces`가 표면 카테고리를 **이름이 아니라 역할**로 찾도록 교정(SPEC-001 FR-010) + 소유 스펙 없음의 선언 자리를 `specSyncExemptGlobs`로 **재사용** | 게이트가 `**Surfaces**:`를 하드코딩하고 있어, 카테고리를 `Symbols`로 부르는 저장소에서는 선언 집합이 **항상 비어** 모든 표면이 고아로 뜨거나 판정이 무의미했다 — 킷 자신이 그 상태였고 `surfaceGlobs`를 안 켠 덕에 inert로 가려져 있었을 뿐이다. 교정 후 킷 자기적용에서 표면 63건·선언 78건을 실제로 대조하기 시작했다. 예외 목록을 새로 만들지 않은 이유: 같은 사실("이 파일엔 소유 스펙이 없다")에 선언 자리가 둘이면 한쪽만 갱신돼 두 게이트가 다른 답을 낸다(R13이 잡는 중복의 config 판) [검증: tooling/__tests__/verification-run.test.mjs] |
| 2026-08-10 | `filesLineMissingPaths`가 3분류 계약(SPEC-054)을 따라 `{missing, unchecked}`를 돌려주고 `check-spec-sync`가 확인 못 한 경로를 **차단하지 않고 표면화**한다. 그리고 픽스처 복사 목록을 손목록에서 **import 폐포 계산**으로 교체했다 | 실측: 존재 판정기가 `boolean`만 받아 읽기 실패가 `false`로 붕괴하면 "경로 부재"라는 **거짓 위반**이 된다(권한·I/O). 픽스처 쪽 실측: 새 모듈 하나를 추가하자 손목록을 든 픽스처들이 동시에 `ERR_MODULE_NOT_FOUND`로 죽었다 — 소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함이 킷 자신의 테스트에서 재연됐다. **목록은 적는 것이 아니라 계산하는 것이다** |
| 2026-08-10 | FR-001 개정 — `preEditSpecFirstPolicy`에 **차단 강도(hard)** 편입: 편집을 거부하고(exit 2) 결정 이력이 사는 절을 지목하며 "걷어내는 길은 명세 편집"임을 말한다. 쉘 래퍼가 종료코드를 **전파**하도록 수정 + 강도 enum 문법화(off\|advisory\|hard) | 오너 지시: "명세를 읽지 않고 멋대로 하는건 금지". 그런데 이 층의 강도 사다리는 `off|advisory`에서 끝나 **편집 시점에 금지할 수단이 아예 없었고**, 쉘은 `2>/dev/null` + 무조건 `exit 0`으로 종료코드를 삼켰다 — **종착지가 도달 불가한 사다리는 사다리가 아니다.** 새 FR을 만들지 않은 이유: FR 캡이 10/10이고 캡 상향은 완화라 선택지가 아니며, 이 축의 선례가 "FR-001 확장"이다(2026-07-30 행). 차단에 절 위치와 탈출 경로를 함께 실은 이유: 막기만 하면 아무도 모르는 우회로를 찾는다(SPEC-053의 `deny`가 대안을 요구하는 것과 같은 규율) [검증: tooling/__tests__/edit-check.test.mjs] |
