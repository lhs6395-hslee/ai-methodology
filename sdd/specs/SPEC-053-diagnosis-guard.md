# Feature Specification: Diagnosis Guard (조사 전에 명세를 보게 한다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-053`  **Created**: 2026-08-10  **Status**: Active
**Input**: 실측 제보(2026-08-10, gsn-ai-pm-management-tool) — 에이전트가 배포가 클러스터에 반영되지 않은 원인을 조사하며 `kubectl get application`을 뒤져 ArgoCD sync 실패(`failed to list refs`)를 원인으로 단정해 보고했다. **그 문자열은 이미 `INFRA-004` Edge Case(61행)에 있었고**, 273행에는 소유자 결정("배포는 GitOps가 힘드니 젠킨스에서 바로 배포한다")과 그에 따른 요구 신설이, 48행에는 "ArgoCD sync가 멈춰 있어도 Jenkins가 직접 적용한다"까지 기록돼 있었다. 소유자는 여러 세션에 걸쳐 "ArgoCD 쓰지 마라"를 지시했는데 **재발했고, 결론까지 틀렸다** — 진짜 원인은 `drizzle/meta/0032~0034_snapshot.json` 누락 → `schema-expected.cjs` ENOENT → migrate Job 실패 → 배포 스테이지 스킵이었다. 제보의 요청: "조사 전에 명세를 읽었는가"는 정적으로 판정되지 않지만 특정 진단 행동 앞에 관련 명세 위치를 강제 출력하는 것은 결정적으로 된다. **커밋 게이트로는 불가능하다 — 조회는 커밋도 파일 변경도 남기지 않는다.** 제보 프로젝트가 만든 첫 사례(`scripts/deny-argocd.mjs`)를 킷이 선언적 매핑으로 일반화해달라는 요청.

---

## User Scenarios & Testing

### User Story 1 — 조회는 커밋을 남기지 않으므로 커밋 게이트로는 원리상 볼 수 없다 (P1)
"읽었는가"는 정적으로 판정되지 않는다. 그러나 **명령 패턴 → 관련 명세**의 매핑은 결정적이고, 도구 호출 직전은 결정적인 발화 지점이다. 그 층이 없으면 급할 때 에이전트는 명세를 건너뛰고 실측으로 다시 찾는다.
- **Independent Test**: `diagnosis-guard.test.mjs`가 순수 코어와 훅 모드 카나리아를 단독 검증. [검증: tooling/__tests__/diagnosis-guard.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a declared denied diagnostic command, **When** the hook runs on it, **Then** it exits non-zero naming the spec and the alternatives.

### User Story 2 — 명세를 읽는 명령은 무엇보다 먼저 통과한다 (P1)
"읽어라"고 하면서 읽기를 막으면 자기모순이고, 오탐이 쌓이면 사람이 훅을 끈다. 제보자의 첫 사례도 그것을 카나리아로 고정했다(명세 grep은 통과).
- **Independent Test**: 같은 테스트가 금지 패턴에 걸리는 명세 읽기(`rg --git-dir sdd/specs`)까지 통과함을 검증. [검증: tooling/__tests__/diagnosis-guard.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a command that reads a spec while matching a deny rule, **When** the hook runs, **Then** it allows the command silently.

### User Story 3 — 잘못된 선언은 아무것도 막지 않고 아무것도 알리지 않는다 (P1)
이 축의 자기결함은 **조용한 무발화**다. 깨진 정규식·실재하지 않는 스펙·사유 없는 규칙은 게이트를 통과시키면서 보호가 없는 상태를 만든다. 그래서 선언 자체를 판정한다.
- **Independent Test**: 같은 테스트가 깨진 정규식·부재 스펙·사유 없음·대안 없는 금지 각 갈래를 위반으로 확인. [검증: tooling/__tests__/diagnosis-guard.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a rule whose pattern does not compile, **When** the sweep-mode gate runs, **Then** it reports the rule as silently inert.

### User Story 4 — 금지는 대신 볼 곳을 반드시 준다 (P1)
막기만 하면 사람은 우회로를 찾고 그 우회로는 아무도 모르는 경로가 된다 — 우회를 유발하는 강제는 강제가 아니다.
- **Independent Test**: 같은 테스트가 `deny` + 대안 없음을 위반으로, `surface` + 대안 없음을 정상으로 확인. [검증: tooling/__tests__/diagnosis-guard.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a deny rule with no alternatives, **When** the gate validates the map, **Then** it reports the rule as blocking without an exit.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **명세 읽기가 모든 규칙을 이긴다** — 읽기 도구와 스펙 경로의 **곱**으로 좁힌다. `cat`만으로 통과시키면 무엇이든 `cat`으로 감싸 우회할 수 있다.
- **`deny`가 `surface`를 이긴다** — 약한 쪽이 이기면 선언을 늘려 강제를 약화시킬 수 있다.
- **무관한 명령에는 아무 출력도 없다** — 훅 계층은 침묵이 계약이다(SPEC-040). 매 Bash 명령에 한 줄이 붙으면 소음이 되고, 소음이 되는 순간 사람이 훅을 끈다.
- **안내는 스펙 이름이 아니라 절 위치까지 준다** — 이름만 주면 처음부터 읽어야 하고, 급할 때 처음부터 읽는 사람은 없다.
- **stdin은 훅 모드에서만 읽는다** — 실측: 무조건 읽자 스윕이 데이터 없는 열린 파이프에서 타임아웃까지 매달렸다. 스윕이 멈추면 그날의 판정이 통째로 사라진다.
- **`quietWhenSilent`는 훅 모드에서만 켠다** — 이 게이트는 스윕에도 등재돼 있고(R21), 스윕에서 침묵하면 "판정 안 함"이 집계에서 사라진다(SPEC-040 계약).
- **`advisory`는 금지도 막지 않는다** — 강도 사다리를 지킨다. 채택 중 프로젝트를 벽으로 세우지 않는다.
- **금지를 걷어내는 길은 명세 편집이다** — 그 조회가 정말 필요하면 규칙이 가리키는 스펙을 고쳐 금지를 없앤다. 우회가 아니라 결정의 갱신이다.
- **선언 미비는 판정하지 않는다** — 무엇에 발화할지 모르는 상태를 위반이라 말하지 않는다(INERT).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a diagnostic command is judged, the **diagnosis-guard** (E) core in **diagnosis-guard-lib.mjs** (S) SHALL allow it whenever it reads a specification, and otherwise SHALL return the strongest matching rule's mode, treating a blocking rule as winning over a surfacing one. — capability: **diagnosis-guard.expose** (C).
- **FR-002** (event): WHEN guidance is formatted, the core SHALL name the specification together with the sections where decisions live and, for a blocking rule, the alternatives to consult instead.
- **FR-003** (unwanted): IF a declared rule has no command pattern, an uncompilable pattern, no specification, a specification that does not exist, an unknown mode, no reason, or is blocking without alternatives, THEN **check-diagnosis-guard.mjs** (S) SHALL report it as a violation in sweep mode and SHALL block at strict strength, because a broken rule neither blocks anything nor announces itself.
- **FR-004** (event): WHEN the gate runs as a tool-call hook, it SHALL exit non-zero only for a blocking rule at strict strength, SHALL stay silent for allowed commands, and SHALL read the command from standard input only in that hook mode so that a sweep execution cannot block on an empty pipe.

### Key Entities
- **diagnosis-guard** — the enforced exposure of the specification that already answers a diagnostic question, at the moment the diagnosis is attempted, as distinct from the specification merely containing that answer, so that a decision recorded in the corpus cannot be re-derived wrongly by an agent in a hurry.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: diagnosis-guard
- **Symbols**: diagnosis-guard-lib.mjs, check-diagnosis-guard.mjs, sdd-diagnosis-check.sh
- **Artifacts**: —
- **Capabilities**: diagnosis-guard.expose
- **Files**: tooling/diagnosis-guard-lib.mjs, tooling/check-diagnosis-guard.mjs, tooling/harness/sdd-diagnosis-check.sh, tooling/__tests__/diagnosis-guard.test.mjs

## Dependencies (참조 — dedup 제외)
> 에이전트 훅 선언·배선 실재는 SPEC-051 소유, 훅 계층 침묵 계약은 SPEC-040, 스윕 등재는 SPEC-004, Python 복제는 SPEC-006 소유.
- **Modules**: agent-wiring (references), gate-verdict (references), harness-install (references)
- **Symbols**: agent-hooks.list, sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `diagnosis-guard.test.mjs` 전 케이스 green — 선언 검증 6·명세 읽기 3·판정 3·훅 카나리아 5·스윕 4·자기적용 3. [검증: tooling/__tests__/diagnosis-guard.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다 — **훅·스윕 두 모드** 모두(8 시나리오 × 명령 4종). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 진단 규칙이 선언되고 선언 위반 0건이며, 카나리아가 차단 2/2·노출 1/1·명세 읽기 통과 3/3·무관 명령 침묵을 실측한다. [검증: tooling/__tests__/diagnosis-guard.test.mjs]
- **SC-004**: 이 가드가 `agent-hooks.list`에 등재돼 배선 실재가 R19의 판정 대상이 된다 — 층이 합성된다. [검증: tooling/__tests__/diagnosis-guard.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 정규식·문자열 대조만의 순수 함수이고 훅 입력 파싱·스펙 실재 확인은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/diagnosis-guard.test.mjs]

## Assumptions / Clarifications Retained
- 이 층은 **감시 에이전트**의 일부다(R19가 배선 실재를 판정한다). 감사(R20)가 "읽으면 답이 하나인가"를 보장하고 이 축이 "읽게 만드는가"를 담당한다 — **둘이 짝이다.**
- 이 축은 에이전트가 안내를 **따랐는지**는 판정하지 않는다. 강제 노출까지가 결정적으로 가능한 범위이고, 그 뒤는 차단(`deny`)이거나 사람의 판단이다.
- **기각한 대안:** 커밋 시점 게이트로 "명세를 읽었는가"를 판정하는 방식. 조회는 커밋도 파일 변경도 남기지 않으므로 원리상 관측 대상이 아니다. 재검토 조건: 없음.
- **기각한 대안:** 모든 진단 명령에 명세 안내를 붙이는 방식. 매 Bash 명령에 한 줄이 붙으면 소음이 되고 사람이 훅을 끈다 — **선언된 패턴에만** 발화한다. 재검토 조건: 없음.
- **기각한 대안:** 명세 읽기까지 막아 "먼저 읽어라"를 강제하는 방식. 읽기를 막으면 자기모순이고 오탐이 즉시 쌓인다. 읽기는 모든 규칙을 이긴다. 재검토 조건: 없음.
- **기각한 대안:** 금지 목록을 게이트 코드에 하드코딩하는 방식(제보 프로젝트의 첫 사례가 그 형태였다). 프로젝트마다 금지 대상이 다르고, 하드코딩하면 킷이 그 프로젝트의 결정을 담게 된다. 선언으로 뺐고 **선언 자체를 판정**한다. 재검토 조건: 없음.
- **기각한 대안:** `deny`를 기본 강도로 두는 방식. 도입 즉시 조사를 막으면 사람이 정책을 끄고, 강제 노출만으로 충분한 경우가 실제로 있다(제보도 그 점을 지적했다). 기본은 `advisory`이고 킷은 `hard`다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(코어 TDD 12종 + 훅·스윕 게이트 9종 + 양판 패리티 훅·스윕 2모드) + 제보 요청(선언적 매핑으로 일반화) → Active | FR-001~004 unit 커버. 킷 자기적용: 규칙 2종 선언(SPEC-036 관련), 카나리아 차단 2/2·노출 1/1·명세 읽기 3/3 통과. 도그푸딩으로 stdin 블록 결함 1건 발견·수정 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-051(agent-wiring): 비중복 — 051은 감시 에이전트 훅이 **배선됐는가**, 053은 그 훅 중 하나가 **무엇을 판정하는가**다. 053은 051의 선언 목록에 등재돼 배선 실재를 051에게 위임한다(층 합성).
- 2026-08-10 이웃 SPEC-052(spec-conflict): 비중복 — 052는 **읽으면 답이 하나인가**(코퍼스 정합), 053은 **읽게 만드는가**(행동 시점 노출)다. 둘이 짝이고, 052 없이 053만 있으면 모순된 명세를 성실히 읽게 만드는 셈이 된다.
- 2026-08-10 이웃 SPEC-003(spec-sync): 비중복 — 003은 **편집·커밋**의 spec-first(코드가 스펙을 동반하는가), 053은 **조회**의 명세 우선(조사가 명세를 앞세우는가)이다. 003의 발화 지점은 파일 변경이고 053은 조회라 관측 대상이 겹치지 않는다.
- 2026-08-10 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 **행위**의 전제 조건, 053은 진단 **조회**의 명세 노출이다. 둘 다 PreToolUse Bash에 살지만 판정 대상과 강도 규칙이 다르다.
- 2026-08-10 이웃 SPEC-042(term-coverage): 비중복 — 042는 커버 파일이 요구가 이름 댄 대상을 언급하는가(검증 층), 053은 조사자가 그 명세를 보게 되는가(행동 층)다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `diagnosis-guard-lib`(명령 판정·명세 읽기 우선·안내 형식·선언 검증) + `check-diagnosis-guard`(훅 모드 + 스윕 모드 이중) + `sdd-diagnosis-check.sh`(PreToolUse) + `diagnosisGuardPolicy` 외 3 knob + `agent-hooks.list` 등재 + 스윕 R21 + 배포 목록·래칫 편입, 양판 | 실측 제보: 에이전트가 명세에 답이 있는데 읽지 않고 실측으로 다시 찾았고 **결론까지 틀렸다**. 오너가 여러 세션에 걸쳐 금지한 조회 경로가 재발했다. 커밋 게이트로는 원리상 불가능하다 — **조회는 커밋도 파일 변경도 남기지 않는다.** 제보 프로젝트가 만든 첫 사례는 금지 목록을 게이트에 하드코딩한 형태였고, 킷은 그것을 선언으로 빼고 **선언 자체를 판정**한다(이 축의 자기결함은 조용한 무발화다). 명세 읽기가 모든 규칙을 이기게 한 이유: 읽기를 막으면 "읽어라"면서 읽기를 막는 자기모순이고 오탐이 즉시 쌓인다 — 제보자의 카나리아(차단 4/4·통과 3/3)가 같은 경계를 고정하고 있었다. 도그푸딩이 결함 1건을 잡았다: stdin을 무조건 읽어 스윕이 데이터 없는 파이프에서 타임아웃까지 매달렸다(스윕이 멈추면 그날의 판정이 통째로 사라진다) — 훅 모드에서만 읽도록 좁혔다. 그리고 `quietWhenSilent`를 무조건 켠 것이 SPEC-040 계약(스윕 등재 게이트는 침묵 금지) 위반이었고, 계약 테스트를 우회하지 않고 **훅 조건부만 허용하도록 계약을 정밀화**했다 [검증: tooling/__tests__/diagnosis-guard.test.mjs] |
| 2026-08-10 | `validateDiagnosisMap`이 스펙 실재를 3상태로 판정해 `spec-unchecked`를 내고, 게이트가 그것을 **차단 목록에서 분리**해 표면화한다(SPEC-054) | 실측: 확인 못 함을 위반으로 세면 `hard`에서 빌드를 깨고, 오탐이 잦은 게이트는 꺼진다. 이 축은 특히 오탐이 사망 원인이다 — 그래서 "검사 못 함"은 차단하지 않되 초록에도 합산하지 않는다 |
