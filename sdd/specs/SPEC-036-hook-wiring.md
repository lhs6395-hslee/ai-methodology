# Feature Specification: Hook Wiring (훅 배선 실재 — 설치되지 않은 강제를 green으로 읽지 않는다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-036`  **Created**: 2026-08-02  **Status**: Active
**Input**: 소비 프로젝트 실측 제보 — `scripts/hooks/`에 pre-commit·pre-push가 버전관리돼 있었지만 `.git/hooks`에는 commit-msg만 복사돼(프로젝트 설치기가 그 하나만 처리) **게이트가 한 번도 발동하지 않았다**. 기존 "판정 확인" 단계는 게이트 스크립트의 inert(정책 off·소스 미설정)만 보고 **훅 배선의 inert**는 보지 않아, 이 상태가 green으로 읽혔다.

---

## User Scenarios & Testing

### User Story 1 — 강제가 실제로 걸려 있는지 본다 (P1)
게이트 파일이 전부 있어도 훅이 없으면 아무것도 발동하지 않는다. 이 게이트는 선언된 훅 집합을 훅 디렉토리와 대조해 미설치·실행권한 없음·남의 훅 점유를 각각 지목한다. 훅 이름 집합은 `hooks.list` 한 곳에 선언되고 설치기와 검사 게이트가 같은 파일을 읽는다.
- **Independent Test**: `hooks-install.test.mjs`가 순수 코어(목록 파싱·3분기 findings)와 게이트 배선(advisory ⚠ · hard ✗ · 설치 후 침묵)을 단독 검증. [검증: tooling/__tests__/hooks-install.test.mjs]
- **Acceptance (GWT)**: 1. **Given** `hooksInstalledPolicy: hard` and a declared hook missing from the hook directory, **When** the gate runs, **Then** it names the hook and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **개별 파일 하드코딩 금지가 요점이다** — 훅 이름 집합을 `hooks.list`에 한 번만 선언하고 설치기·게이트가 함께 읽는다. 하드코딩만 있으면 훅을 추가해도 설치기나 검사 중 한쪽이 뒤처져 "설치 안 됐는데 아무도 모르는" 상태가 다시 생긴다. 설치기는 끝에 스스로 목록 전체를 검증한다.
- **남의 훅이 같은 이름을 점유한 경우도 미설치와 결과가 같다** — husky 등이 `pre-commit`을 쓰고 있으면 파일은 있지만 킷 게이트는 돌지 않는다. 그래서 킷이 설치하는 훅에 마커를 심고 그 존재로 판정한다.
- **실행 권한 없는 훅은 git이 조용히 건너뛴다** — 파일 존재만 보면 통과로 읽히므로 실행 비트까지 본다.
- `core.hooksPath`를 존중한다(worktree·커스텀 훅 디렉토리). git 저장소가 아니거나 목록이 없으면 침묵한다(이식성).
- 목록 탐색은 **프로젝트 선언이 킷 기본값을 이긴다** — 킷 경로를 먼저 보면 소비 프로젝트를 검사할 때 그 프로젝트가 선언하지도 않은 훅을 미설치로 지목한다(테스트가 실측으로 잡은 버그).
- 기본 `advisory`. 훅 배선은 채택 절차의 산물이라 즉시 hard로 두면 초기 채택이 막힌다 — 배선 완료 후 `hard`로 올린다(래칫이 하향을 막는다).
- **훅 디렉토리는 git에게 묻는다 — `.git/hooks`를 문자열로 가정하지 않는다.** 실측 제보(2026-08-10): 워크트리에서 `.git`은 **파일**이라 `[ -d .git ]` 가드가 실패하고 배선이 통째로 스킵됐으며, `--git-dir`도 답이 아니다(워크트리 전용 디렉토리에는 hooks가 없다). 그 스킵이 best-effort 침묵이라 도입 프로젝트는 commit-msg·pre-commit·pre-push가 **한 번도 발동한 적이 없는 상태로 몇 달을 갔고 그날의 모든 커밋이 게이트를 우회했다.** `git rev-parse --git-path hooks` 한 번이 worktree·`core.hooksPath`·bare를 동시에 해결한다 — 손 조합이 바로 그 결함의 원인이었다. 그리고 **설치 0건을 조용히 넘기지 않는다**: 설치기가 실측으로 세어 0건이면 실패로 말한다(조용한 0건이 이 결함의 본체다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `hooksInstalledPolicy` is off, **check-hooks-installed.mjs** (S) SHALL perform no evaluation and exit zero. — capability: **hook-wiring.gate** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **hook-wiring** (E) core in **hooks-install-lib.mjs** (S) SHALL read the declared hook names from **hooks.list** (S) and classify each declared hook as missing, not executable, or foreign to the kit.
- **FR-003** (unwanted): IF any declared hook is unwired while the policy is hard, THEN THE SYSTEM SHALL report that gate scripts exist without ever firing and exit non-zero.
- **FR-004** (state): WHILE resolving the hook directory, THE SYSTEM SHALL honour the repository's configured hooks path, SHALL prefer a project-local hook list over the kit's own, and SHALL stay silent outside a git repository.

### Key Entities
- **hook-wiring** — the installed-ness of the enforcement itself: whether the hooks that invoke the gates actually exist, are runnable, and belong to the kit, so that a project cannot read "all gates present" as "all gates firing".

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: hook-wiring
- **Symbols**: hooks-install-lib.mjs, check-hooks-installed.mjs, hooks.list
- **Artifacts**: —
- **Capabilities**: hook-wiring.gate
- **Files**: tooling/hooks-install-lib.mjs, tooling/check-hooks-installed.mjs, tooling/harness/hooks.list, tooling/__tests__/hooks-install.test.mjs

## Dependencies (참조 — dedup 제외)
> 훅을 **설치하는** 쪽(sdd-init·self-hooks-install)과 스윕 배선은 SPEC-004 소유. 이 spec은 설치 결과가 실재하는지만 판정한다. config knob·Python 복제는 각 소유 스펙(001/006).
- **Modules**: harness-install (references), key-pipeline (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `hooks-install.test.mjs` 전 케이스 green — 목록 파싱·3분기 findings·게이트 e2e(advisory 통과·hard exit 1·설치 후 OK). [검증: tooling/__tests__/hooks-install.test.mjs]
- **SC-002**: 킷 자신에서 훅 미설치 상태가 게이트로 지목되고, `self-hooks-install.sh` 실행 후 OK로 바뀐다(설치기 자기검증 포함). [검증: tooling/__tests__/hooks-install.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 파일시스템·git 조회는 소비 게이트가 수행하므로, 훅이 없는 환경에서도 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/hooks-install.test.mjs]

## Assumptions / Clarifications Retained
- 마커 문자열은 킷이 생성한 훅에만 들어간다 — 사람이 손으로 쓴 훅을 킷 훅으로 위장시키는 것은 막지 않는다(그건 의도적 선언이라 리뷰 몫).
- **기각한 대안:** 훅 *내용*을 해시로 대조하는 방식은 기각(2026-08). 프로젝트가 훅에 자기 단계를 덧붙이는 정당한 커스터마이즈까지 위반으로 잡는다. 재검토 조건: 훅 내용이 조용히 무력화된 사례(예: 게이트 호출 줄만 주석 처리)가 실측되면.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-02 | 셀프리뷰(순수 코어 TDD·게이트 e2e·킷 자기적용 실측) + 소유자 개선 요청(훅 미설치 inert 감지) → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-02 이웃 SPEC-004(harness-install): 비중복 — 004는 훅을 **설치**하고(sdd-init·self-hooks-install) 스윕을 배선하며, 이 spec은 설치 결과가 **실재하는지** 판정한다. 행위 vs 검증이다. SPEC-004가 캡(FR 10)을 넘긴 것을 상향이 아니라 이 분할로 해소했다.
- 2026-08-02 이웃 SPEC-029(ownership-reality): 비중복 — 029는 소유 키가 소스에 실재하는가, 이 spec은 훅이 훅 디렉토리에 실재하는가. 대상이 선언된 키 vs 설치된 강제다.
- 2026-08-02 이웃 SPEC-028(ownership-map): 비중복 — 028은 키마다 어느 가드가 판정했는지 회계하고, 이 spec은 그 가드를 부르는 훅이 걸려 있는지 본다. 판정 회계 vs 발동 여부다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 훅 경로 해석을 `git rev-parse --git-path hooks` 단일 호출로 전환(게이트·`sdd-init.sh`·`self-hooks-install.sh` 3사이트) + 설치기가 **배선 건수를 실측해 0건이면 실패**로 알림 + 워크트리 회귀 테스트 4종(경로 해석 전제·채택 e2e·`core.hooksPath`·손 조합 금지 계약) | 실측 제보: 도입 프로젝트가 워크트리 기반이라 게이트 훅이 **한 번도 발동한 적이 없었다** — 워크트리에서 `.git`은 파일이고 `--git-dir`은 hooks 없는 디렉토리를 준다. 손 조합(`--git-dir` + `core.hooksPath`)이 원인이었고, git에게 한 번 묻는 것이 정답이다. best-effort 침묵이 이 결함을 몇 달간 가렸으므로 설치 건수를 실측해 말한다. 손 조합 금지는 계약 테스트로 고정했고, 그 테스트는 **주석을 코드로 읽지 않도록** SPEC-044의 정본 헬퍼로 전줄 주석을 걷어낸다. 범위: 이 해석은 git 2.5+ (worktree 도입) 이후 모든 git에서 성립한다 [검증: tooling/__tests__/hooks-install.test.mjs] |
| 2026-08-02 | 초안 — `hooksInstalledPolicy` + `hooks.list`(단일 선언) + `hooks-install-lib`(파싱·3분기) + `check-hooks-installed` 게이트 + sdd-sync R12, 설치기 마커·자기검증 | 실측 제보: 게이트 스크립트는 있는데 `.git/hooks`가 비어 있어 강제가 한 번도 발동하지 않았고, 그 상태가 green으로 읽혔다. 게이트의 inert만 보고 훅의 inert를 안 보면 "설치 안 된 강제"가 통과한다. 킷 자신에게 돌리자마자 이 컨테이너의 실제 미설치 4종을 잡았다. 범위: 미설치 4종은 이 개발 컨테이너 1대의 관측이고, 여기서 끌어낸 규칙은 "선언된 훅이 `.git/hooks`에 없으면 표면화한다"는 것뿐이다 — 훅 경로는 `core.hooksPath`로 바뀔 수 있어 게이트는 설정된 경로를 읽는다(1대 관측을 경로 가정으로 굳히지 않는다) [검증: tooling/__tests__/hooks-install.test.mjs] |
