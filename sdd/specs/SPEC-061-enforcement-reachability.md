# Feature Specification: Enforcement Reachability (선언↔강제지점 결합 — 강도 선언이 실제로 발화할 지점이 있는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-061`  **Created**: 2026-08-27  **Status**: Active
**Input**: 감사 이슈 #21 D-1(실측) — 소비 프로젝트 finops의 git 리모트는 GitLab인데 CI 정의는 `.github/workflows/*.yml` 하나뿐이었다. GitHub Actions는 GitHub이 아닌 호스트에서 애초에 실행되지 않으므로, 그 CI가 정의한 어떤 게이트도 발동한 적이 없다. `draftBlockPolicy: hard`(SPEC-008 FR-007, range 모드 전용 승격)와 `policyRatchetPolicy`도 같은 이유로 발화 횟수 0이었다 — 로컬 git 훅(pre-push)은 staged 판정만 돌고 range 모드는 CI diff 전용이라, CI가 없으면 range 전용 승격은 이 리포의 **어떤 강제 지점에서도 닿지 않는다.** 강도 knob이 hard로 선언돼도 그 판정이 실제로 실행되는 지점이 없으면 선언은 프로즈다 — 이 게이트는 "hard 선언 + 발화 지점 없음"을 침묵시키지 않는다.

---

## User Scenarios & Testing

### User Story 1 — CI 정의가 실제 호스트에서 도는지 확인한다 (P1)
git 리모트의 호스트(github/gitlab/bitbucket/azure)를 식별하고, 리포에 있는 CI 정의 파일을 provider별로 분류한다. 호스트가 알려졌는데 그 호스트의 네이티브 CI 정의가 없고 **다른** provider의 CI 정의만 있으면, 그 CI는 이 리포에서 실행되지 않는다는 사실을 표면화한다.
- **Independent Test**: `enforcement-reachability.test.mjs`가 순수 코어(호스트 식별·불일치 판정)와 게이트 배선(off·advisory·hard)을 단독 검증. [검증: tooling/__tests__/enforcement-reachability.test.mjs]
- **Acceptance (GWT)**: 1. **Given** `enforcementReachabilityPolicy: hard`, a GitLab remote, and only `.github/workflows/**` present, **When** the gate runs, **Then** it names the host/CI mismatch and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **모르는 호스트는 판정하지 않는다 — false positive보다 침묵이 낫다.** 자체 호스팅 GitLab/GitHub Enterprise·기타 git 서버는 URL 패턴만으로 provider를 짐작할 근거가 없다. 알려진 4개 host(`github.com`·`gitlab.com`·`bitbucket.org`·`dev.azure.com`) 밖은 host↔CI 결합 판정에서 완전히 빠진다(리모트가 없어도 동일). 다른 이름 추측 축(카테고리 역할 등)이 "추측의 성공은 침묵할 수 없다"는 원칙과 대칭 — 여기는 추측 자체를 안 한다.
- **Jenkins·CircleCI 등은 host↔CI 결합 판정 대상이 아니다.** 두 CI는 웹훅으로 어느 host에도 붙을 수 있는 자체 호스팅형이라, 그 존재/부재가 특정 host와의 불일치 근거가 되지 않는다. `NATIVE_CI_GLOBS`는 네이티브(호스트 종속) provider 4종만 선언한다.
- **CI 정의가 아예 없으면 이 축의 판정 대상이 아니다** — "CI가 없다"는 다른 관심사(예: 재도출 소스 회계, SPEC-009)이고, 이 게이트는 "있는 CI가 맞는 host에서 도는가"만 본다. 두 CI provider가 공존해도(예: GitHub Actions + Jenkinsfile) 호스트에 맞는 쪽이 하나라도 있으면 통과.
- **range 전용 승격(`draftBlockPolicy: hard`)의 CI 호출 판정은 host 판정과 독립이다.** host가 불일치여도 다른 CI가 우연히 spec-sync를 호출하고 있을 수 있고, host가 일치해도 그 CI가 spec-sync를 안 부를 수 있다 — 두 finding은 각자 발화한다. 판정은 "발견된 모든 CI 파일 내용에 `check-spec-sync`/`sdd-sync` 언급이 있는가"라는 정적 텍스트 검사이지, 그 CI가 실제로 range 모드 인자를 넘기는지까지는 보지 않는다(그 이상은 CI YAML 파서가 필요한 별도 규모 — 리뷰 경계).
- `policyRatchetPolicy`의 발화 지점 결합(D-1이 함께 지목)은 이 게이트의 범위 밖이다 — 그 knob은 강도별 range 전용 승격이 없고 항상 `check-policy-ratchet.mjs`가 판정하므로, "CI가 이 게이트 스크립트를 부르는가"는 R6(sdd-sync 스윕) 배선의 문제이지 host↔CI 결합의 문제가 아니다(범위를 좁혀 판정 오염을 막는다).
- 기본 `off` — 이 축은 CI 존재를 전제하는 판정이라, CI가 아직 없는 채택 초기 프로젝트를 즉시 벌하지 않는다. 채워지면 켠다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `enforcementReachabilityPolicy` is off, **check-enforcement-reachability.mjs** (S) SHALL perform no evaluation and exit zero. — capability: **enforcement-reachability.judge** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **enforcement-reachability** (E) core in **enforcement-reachability-lib.mjs** (S) SHALL resolve the git remote's host from `git remote get-url origin`, classify every CI definition file found in the repository into one of the native providers (`github`, `gitlab`, `bitbucket`, `azure`), and report a host/CI mismatch WHEN the resolved host is one of those four, no CI file native to that host exists, and at least one CI file native to a different provider does exist.
- **FR-003** (event): WHEN the policy is advisory or hard and `draftBlockPolicy` is `hard`, THE SYSTEM SHALL report a range-unreachable finding UNLESS the concatenated text of every discovered CI definition file contains a reference to `check-spec-sync` or `sdd-sync`.
- **FR-004** (unwanted): IF one or more findings exist, THEN THE SYSTEM SHALL name each and SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard; IF the policy value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it and exit non-zero.
- **FR-005** (state): WHILE the git remote's host cannot be resolved to one of the four known providers — no remote, or an unrecognized host — THE SYSTEM SHALL skip the host/CI mismatch judgment (FR-002) entirely rather than guessing, while the range-unreachable judgment (FR-003) continues to apply independently.

### Key Entities
- **enforcement reachability** — the property that a declared enforcement strength corresponds to at least one real trigger point (a CI definition that actually runs on this repository's host, or that actually invokes the range-mode gate a knob depends on) — so that a `hard` declaration is not merely prose no environment ever executes.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: enforcement-reachability
- **Symbols**: enforcement-reachability-lib.mjs, check-enforcement-reachability.mjs
- **Artifacts**: —
- **Capabilities**: enforcement-reachability.judge
- **Files**: tooling/enforcement-reachability-lib.mjs, tooling/check-enforcement-reachability.mjs, tooling/__tests__/enforcement-reachability.test.mjs

## Dependencies (참조 — dedup 제외)
> `draftBlockPolicy` knob 자체·range 모드 승격 판정은 SPEC-008/003 소유(이 spec은 그 승격의 CI 발화 지점만 대조). config knob 선언·Python 복제는 각 소유 스펙(001/006). sdd-sync 스윕 배선은 SPEC-004.
- **Modules**: spec-lifecycle (references), spec-sync (references), key-pipeline (references), runtime-parity (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `enforcement-reachability.test.mjs` 전 케이스 green + 판정 출력·exit의 Node↔Python 바이트 동일(패리티 테스트 green). [검증: tooling/__tests__/enforcement-reachability.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-002**: 실측 재현 픽스처(GitLab 리모트 + GitHub Actions 전용 CI, `enforcementReachabilityPolicy: hard`)에서 host/CI 불일치가 지목되고 hard exit 1, `draftBlockPolicy: hard` + spec-sync 미호출 CI가 독립적으로 range-unreachable을 지목한다(양판 바이트 동일). [검증: tooling/__tests__/enforcement-reachability.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어(호스트 식별·두 finding 함수)는 문자열·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, git 조회·파일 순회는 소비 게이트가 수행한다. [검증: tooling/__tests__/enforcement-reachability.test.mjs]

## Assumptions / Clarifications Retained
- host 식별은 `github.com`·`gitlab.com`·`bitbucket.org`·`dev.azure.com`(및 `visualstudio.com`) 정확 매치뿐이다 — 자체 호스팅 인스턴스를 이름 패턴으로 짐작하지 않는다(위 Edge Case). 필요해지면 config로 host별 CI 판정을 확장하는 것이 재검토 대상.
- CI 파일 내용의 `check-spec-sync`/`sdd-sync` 검사는 문자열 존재 여부만 본다 — 그 호출이 실제로 range 모드 인자(base ref)를 넘기는지, 조건부로 스킵되는지는 CI YAML의 의미 분석이 필요해 리뷰 경계로 남긴다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-27 | 셀프리뷰(순수 코어 TDD·게이트 e2e 8종·Node↔Python 바이트 패리티·D-1 실측 재현) → Active | FR-001~005 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-27 이웃 SPEC-036(hook-wiring): 비중복 — SPEC-036은 **로컬 git 훅**이 실제로 설치·최신인지(파일시스템 대조), 이 spec은 **CI 정의**가 실제 호스트에서 도는지(git 리모트 대조) — 강제 지점의 종류가 다르다.
- 2026-08-27 이웃 SPEC-027(policy-ratchet): 비중복 — SPEC-027은 강도 knob이 base 대비 하향되지 않았는지(config diff), 이 spec은 그 강도가 발화할 지점이 실재하는지(git remote·CI 파일 대조) — 둘 다 "hard 선언 + 무판정=거짓 안전" 계열이지만 대상 축이 다르다(값의 변화 vs 지점의 존재).
- 2026-08-27 이웃 SPEC-008(spec-lifecycle): 비중복 — SPEC-008은 `draftBlockPolicy` knob 자체와 range 모드 승격 판정의 의미를 정의, 이 spec은 그 승격이 **어디서도 발화하지 않을 수 있다**는 사실만 별도로 대조한다(소비, 미정의).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-27 | 초안 — `enforcementReachabilityPolicy`(off\|advisory\|hard, 기본 off) + `enforcement-reachability-lib`(호스트 식별·host/CI 불일치·range 미도달 판정) + 게이트 배선, `RATCHETED_POLICIES` 등재, Node·Python 패리티 | 감사 이슈 #21 D-1 실측: git 리모트가 GitLab인데 CI 정의는 GitHub Actions 전용이라 어떤 게이트도 발동한 적이 없었고, `draftBlockPolicy: hard`도 range 모드 CI 호출 지점이 없어 발화 횟수 0이었다. 강도 선언과 발화 지점의 결합을 보는 코드가 없어 이 상태가 게이트 출력만 보면 "정상"으로 읽혔다 [검증: tooling/__tests__/enforcement-reachability.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
