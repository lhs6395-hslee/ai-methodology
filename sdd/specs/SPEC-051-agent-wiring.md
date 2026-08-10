# Feature Specification: Agent Wiring Reality (감시자가 에이전트를 보는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-051`  **Created**: 2026-08-10  **Status**: Active
**Input**: 오너 실측 제보(2026-08-10) — "우리 방법론을 쓸 때 감시게이트 및 감시에이전트가 필요한데, 즉 SDD에 의해 수행하는지 혼자 날뛰지 않는지 말이야. **그게 동작을 하지 않아.**" 조사 결과 원인이 다섯이었고 전부 **조용한 0건** 계열이었다: ①킷 자신에 `.claude/`가 없었다 — 킷은 모든 축을 자기적용하는데 이 층만 도그푸딩 0이라, 이 배선이 동작하는 것을 킷이 한 번도 관측한 적이 없다. ②어떤 게이트도 에이전트 설정 파일을 보지 않았다 — R12는 `.git/hooks`, R17은 CI·영수증·게이트 파일을 보고 에이전트 훅은 **아무 축의 대상이 아니었다.** ③채택 영수증에 에이전트 훅이 기록되지 않았다(`hooks`에 git 훅 4종만). ④`jq` 없으면 설치기가 배선을 조용히 건너뛰고 설치는 "성공"으로 끝났다 — 워크트리 결함을 몇 달간 가린 best-effort 침묵과 같은 모양(SPEC-036). ⑤편집 가드의 코드 경로가 하드코딩(`src/|lib/|app/`)이었고 주석은 "sdd-init가 조정한다"고 적혀 있었지만 설치기는 그 파일을 그대로 복사만 했다 — 킷의 `scanDirs`는 `tooling`이라 배선했더라도 체크리스트가 **발화할 수 없었다.**

---

## User Scenarios & Testing

### User Story 1 — 감시자가 있다와 감시자가 에이전트를 본다는 다른 사실이다 (P1)
R17은 커밋한 사람이 끌 수 없는 채널(CI)의 실재를 본다. 그런데 CI는 **커밋 이후**에 돈다 — 에이전트가 스펙 없이 코드를 쓰고 있는 그 순간을 보는 층이 아니다. 그 순간을 보는 것은 에이전트측 훅뿐인데, 그 배선이 어떤 축의 판정 대상도 아니었으므로 R17이 초록인 동안 감시 에이전트가 전무할 수 있었다.
- **Independent Test**: `agent-wiring.test.mjs`가 순수 코어(선언 파싱·매처 부분집합·커맨드 결속·판정 4갈래·병합)와 게이트 차단을 단독 검증. [검증: tooling/__tests__/agent-wiring.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a declared agent hook that is not wired in the agent settings, **When** the gate runs, **Then** it blocks naming the event and the script.

### User Story 2 — 배선돼 있음과 그 도구에서 발동함은 다르다 (P1)
매처가 좁아지면 배선은 존재하는데 특정 도구에서 훅이 발동하지 않는다. 넓히는 것은 정상이므로 정확 일치를 요구하면 정당한 확장이 전부 위반이 되어 게이트가 꺼진다 — 부분집합으로 판정하고 빠진 도구를 이름으로 말한다.
- **Independent Test**: 같은 테스트가 확장(위반 0)·축소(빠진 도구 지목)·복수 배선(가장 넓은 것으로 판정)을 각각 검증. [검증: tooling/__tests__/agent-wiring.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a wired hook whose matcher omits a declared tool, **When** the gate runs, **Then** it names the omitted tool.

### User Story 3 — 설치기가 배선을 조용히 건너뛰지 않는다 (P1)
`jq` 미설치가 "배선 스킵 + 설치 성공"이던 것이 이 결함의 직접 원인 중 하나다. 배선은 이제 게이트가 **선언 하나에서** 계산하므로 jq가 필요 없고, 실패하면 설치가 큰 소리로 멈추며 배선 직후 자기검증을 돈다.
- **Independent Test**: `init-hooks.test.mjs`가 jq를 가린 PATH에서 배선이 실제로 되고 남의 키가 보존됨을 검증. [검증: tooling/__tests__/init-hooks.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an install environment without jq, **When** the installer runs, **Then** the agent hooks are wired and pre-existing settings keys survive.

### User Story 4 — 판정 대상 경로는 config가 정본이다 (P1)
편집 가드가 코드 경로를 하드코딩하면 그 어휘 밖 프로젝트에서 체크리스트가 통째로 사라지고, 그 0건이 진짜 0건과 구분되지 않는다. 킷 자신이 정확히 그 상태였다.
- **Independent Test**: `agent-wiring.test.mjs`가 쉘에 경로 `case` 하드코딩이 남아 있지 않음과 "검사 못 함" 문장의 실재를 정적으로 단언하고, `edit-check.test.mjs`(SPEC-004 소유)가 `scanDirs`를 바꿔가며 발화/침묵을 검증. [검증: tooling/__tests__/agent-wiring.test.mjs]
- **Acceptance (GWT)**: 1. **Given** scanDirs naming a directory outside the old hardcoded list, **When** a file there is edited, **Then** the checklist fires.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **선언 파일이 없으면 판정하지 않는다** — 무엇이 배선돼야 하는지 모르는 것을 위반으로 말하지 않는다(INERT).
- **선언 0건도 INERT다** — 0건은 '깨끗함'이 아니라 '볼 것이 없음'이다.
- **설정 파일 부재는 훅별 미배선과 다른 사실이다** — 전자는 한 번도 설치되지 않았음, 후자는 부분 배선이다. 해소 방법이 같더라도 사람이 읽는 진단이 다르다.
- **설정이 깨진 JSON이면 훅이 하나도 발동하지 않는다** — 파싱 실패를 미배선과 합치지 않고 그 사실을 그대로 말한다.
- **커맨드는 파일명 기준으로 대조한다** — `sh scripts/x.sh`·`./scripts/x.sh`·절대경로가 모두 같은 훅이다. 경로 표기 차이를 위반으로 만들면 게이트가 꺼진다.
- **병합은 남의 훅을 보존한다** — 그룹 안의 커맨드가 전부 킷 것일 때만 걷어낸다. 그리고 옛 표기의 킷 훅도 걷어낸다(안 그러면 재실행 시 훅이 두 번 발동한다).
- **선언은 하나다** — 설치기와 게이트가 같은 파일을 읽는다. 목록이 둘이면 훅을 추가해도 한쪽이 뒤처져 "설치 안 됐는데 아무도 모르는" 상태가 된다(SPEC-036에서 배운 것).
- **"검사 못 함"을 "통과"로 출력하지 않는다** — 편집 가드가 node·게이트를 못 찾으면 그 사실을 말한다. 이전 판의 `|| true` 침묵이 이 층의 결함을 오래 가렸다.
- **이 축은 에이전트의 순종을 판정하지 않는다** — 배선의 실재만 본다. 훅이 발동한 뒤 에이전트가 경고를 무시하는지는 이 축의 대상이 아니다(그건 R14·R19′의 실행 관측 층이고, SPEC-049가 그 회계를 맡는다).
- **영수증은 커밋한다** — 에이전트 훅 기록도 채택 선언의 일부다(SPEC-048과 같은 경계: 실행 원장은 커밋하지 않고 영수증은 커밋한다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the hook declaration is parsed, the **agent-wiring** (E) core in **agent-wiring-lib.mjs** (S) SHALL read whitespace-separated event, matcher and script fields treating a lone dash as no matcher, and SHALL ignore comments and malformed lines so that one declaration file serves both installer and gate. — capability: **agent-wiring.attest** (C).
- **FR-002** (event): WHEN wired hooks are compared against the declaration, the core SHALL match a hook by the script filename its command names, SHALL treat the declared matcher as satisfied when its tools are a subset of the wired matcher, and SHALL judge a script by the widest wiring that names it.
- **FR-003** (unwanted): IF the agent settings file is absent, unparseable, missing a declared hook, narrowed so a declared tool is uncovered, or naming a script that does not exist, THEN **check-agent-wiring.mjs** (S) SHALL report each of those as a distinct fact and SHALL block at strict strength; IF the declaration is absent or empty, THEN it SHALL declare itself inert rather than reporting zero violations.
- **FR-004** (event): WHEN the installer wires agent hooks, it SHALL obtain the settings from the gate's generate mode so that installation and judgement derive from the same declaration, SHALL preserve foreign hooks and replace its own across re-runs, and SHALL fail loudly and self-verify rather than skipping wiring when a dependency is unavailable.
- **FR-005** (event): WHEN the edit guard decides whether a path is code, it SHALL obtain that answer from the configured scan directories rather than a hardcoded path list, and SHALL state that it could not check rather than staying silent when the runtime or gate is unavailable.

### Key Entities
- **agent-wiring** — the fact that the guards which observe an agent's tool use are actually wired into that agent, as distinct from those guard scripts existing on disk or a bypass-proof CI channel existing, so that a project cannot be judged supervised while nothing watches the agent.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: agent-wiring
- **Symbols**: agent-wiring-lib.mjs, check-agent-wiring.mjs, agent-hooks.list
- **Artifacts**: .claude/settings.json
- **Capabilities**: agent-wiring.attest
- **Files**: tooling/agent-wiring-lib.mjs, tooling/check-agent-wiring.mjs, tooling/harness/agent-hooks.list, tooling/__tests__/agent-wiring.test.mjs, .claude/settings.json

## Dependencies (참조 — dedup 제외)
> 설치기·영수증 기록·편집 가드 쉘(`sdd-edit-check.sh`)과 그 테스트는 SPEC-004 소유, 감시자 채널 축은 SPEC-048, 편집 시점 spec-first 판정은 SPEC-003, 훅 선언 단일화 교훈은 SPEC-036, Python 복제는 SPEC-006 소유.
- **Modules**: harness-install (references), watchdog (references), hook-wiring (references), spec-sync (references)
- **Symbols**: sdd-init.sh, check-pre-edit.mjs, sdd-edit-check.sh

---

## Success Criteria (측정형)
- **SC-001**: `agent-wiring.test.mjs` 전 케이스 green — 선언 파싱 2·매처 3·커맨드 결속 1·판정 5·병합 3·게이트 8·킷 자기적용 1·하드코딩 금지 2. [검증: tooling/__tests__/agent-wiring.test.mjs]
- **SC-002**: 판정 출력과 생성 출력이 Node↔Python 바이트 동일하다(9 시나리오 × 판정·생성 2모드). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 선언 4종이 모두 배선돼 게이트가 위반 0건이고, 도입 전 실측은 위반 5건(설정 파일 부재 1 + 미배선 4)이었다 — 이 축이 없던 동안 R17은 초록이었다. [검증: tooling/__tests__/agent-wiring.test.mjs]
- **SC-004**: jq를 가린 PATH에서 설치기가 에이전트 훅을 실제로 배선하고 기존 설정 키를 보존한다. [검증: tooling/__tests__/init-hooks.test.mjs]
- **SC-005**: 편집 가드가 `scanDirs`를 따라 발화·침묵하고 하드코딩된 경로 목록이 남아 있지 않다. [검증: tooling/__tests__/edit-check.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 파일 읽기·실행 가능 판단은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/agent-wiring.test.mjs]

## Assumptions / Clarifications Retained
- 이 축은 **배선의 실재**를 판정하고 에이전트의 순종은 판정하지 않는다. 훅이 발동한 뒤 에이전트가 경고를 무시하는지는 다른 층이며, 그 회계는 SPEC-049(차단 분기 발화)가 맡는다 — 두 사실을 합치면 "훅이 깔렸다"가 "에이전트가 따랐다"로 읽힌다.
- **기각한 대안:** 에이전트 설정을 게이트가 직접 고쳐 배선하는 방식(자동 치유). 판정 게이트가 판정 대상을 고치면 그 게이트는 언제나 초록이고, 초록의 의미가 사라진다. 생성 모드는 **산출만** 하고 쓰기는 설치기가 한다. 재검토 조건: 없음.
- **기각한 대안:** 매처 정확 일치 요구. 프로젝트가 도구를 넓히는 것은 정당한 강화인데 그것을 위반으로 만들면 오탐이 잦아지고 사람이 정책을 끈다. 부분집합 판정이 "그 도구가 감시 밖으로 나갔는가"라는 실제 질문에 정확히 답한다. 재검토 조건: 없음.
- **기각한 대안:** 훅 목록을 설치기에 JSON으로 유지하는 현행 유지. 그 하드코딩 JSON이 사실상 정본이었고 **어떤 검사도 그것과 대조되지 않았다** — 선언을 파일 하나로 옮기니 설치·판정이 같은 출처에서 나온다. 재검토 조건: 없음.
- **기각한 대안:** 편집 가드에서 코드 경로 목록을 config knob으로 새로 받는 방식. `scanDirs`가 이미 "이 프로젝트의 코드가 어디 있는가"의 정본이므로 knob을 더하면 두 선언이 갈라진다. 재검토 조건: 코드 경로와 스캔 경로가 갈라져야 하는 사이트가 나오면 그때 검토한다.
- **기각한 대안:** `jq` 폴백 체인 유지(jq → node → python). 이 블록은 `--gate node` 안이라 node가 보장되므로 체인이 필요 없고, 분기가 늘면 "어느 경로로 배선됐는지" 진단이 흐려진다. 재검토 조건: 비-node 게이트에도 에이전트 훅을 깔게 되면 Python 미러의 생성 모드를 쓴다(이미 양판에 있다).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(킷 실물 조사로 원인 5건 확정 → 게이트가 킷의 위반 5건 실측 → 배선 후 0건 → 코어 TDD 14종·게이트 8종·양판 패리티 9시나리오) + 오너 제보("그게 동작을 하지 않아") → Active | FR-001~005 unit 커버. 킷 자기적용: 선언 4종 전부 배선, 편집 가드가 이 킷에서 처음 실제 발화함을 실측 확인 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-048(watchdog): 비중복 — 048은 **우회 불가한 채널**(서버측 CI)과 채택 영수증의 실재를, 051은 **에이전트가 도구를 쓰는 순간** 발동하는 훅의 배선을 본다. CI는 커밋 이후에 돌므로 048로는 "지금 스펙 없이 코드를 쓰고 있다"를 말할 수 없다. 실측이 이 분리를 강제했다: 048이 초록인 동안 051의 대상이 전무했다.
- 2026-08-10 이웃 SPEC-036(hook-wiring): 비중복 — 036은 **git 훅**(커밋·푸시 시점, `.git/hooks`), 051은 **에이전트 훅**(도구 사용 시점, 에이전트 설정)이다. 같은 "배선"이지만 관측 시점과 저장 위치가 다르고, 발동 조건도 다르다(036은 git 명령, 051은 에이전트 도구 호출). 단일 선언 파일이라는 설계는 036에서 배워 그대로 적용했다.
- 2026-08-10 이웃 SPEC-003(spec-sync): 비중복 — 003은 편집·커밋의 spec-first **판정 내용**을 소유하고, 051은 그 판정기가 에이전트에 **배선됐는지**를 본다. `check-pre-edit`의 판정은 003의 것이고 051은 그것이 불리는지만 본다.
- 2026-08-10 이웃 SPEC-049(branch-observation): 비중복 — 049는 차단 분기가 **필드에서 발화했는가**(실행 흔적), 051은 발화할 수 있게 **배선됐는가**(저장소 상태)다. 051은 정적으로 결정 가능해 차단하고, 049는 세션 상태라 차단하지 않는다 — 강도가 갈리는 이유가 그 차이다.
- 2026-08-10 이웃 SPEC-050(import-wiring): 비중복 — 050은 게이트 모듈이 서로를 **로드할 수 있는가**, 051은 그 게이트가 에이전트에 **불리도록 배선됐는가**다. 050이 초록이어도 아무도 그 게이트를 부르지 않을 수 있다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `agent-hooks.list`(단일 선언) + `agent-wiring-lib`(선언 파싱·매처 부분집합·커맨드 결속·4갈래 판정·병합·생성) + `check-agent-wiring`(+`--emit-settings`) + `agentWiringPolicy`·`agentSettingsFile`·`agentHookDecl`·`agentScriptDir` + 스윕 R19 등재 + 설치기 재작성(선언 기반 배선·jq 제거·큰 소리 실패·배선 직후 자기검증·영수증에 `agentHooks` 기록·워크트리 훅 목록 교정) + 편집 가드 하드코딩 제거(`--is-code-path`) + 킷 자기적용 `.claude/settings.json` 신설, 양판 | 오너 제보: "감시게이트/감시에이전트가 SDD로 수행하는지 혼자 날뛰지 않는지 봐야 하는데 **그게 동작을 하지 않아.**" 조사에서 원인 5건이 전부 조용한 0건 계열로 드러났다 — 가장 결정적인 것은 **킷 자신에 `.claude/`가 없었다**는 사실이다: 킷은 모든 축을 자기적용하는데 이 층만 도그푸딩이 0이라 이 배선이 동작하는 것을 한 번도 관측한 적이 없었고, 그런데도 R17은 초록이었다(R17은 CI·영수증을 보고 이 층을 보지 않는다). 게이트를 만들자 킷에서 즉시 위반 5건이 나왔고 배선 후 0건이 됐으며, 편집 가드가 **이 킷에서 처음 실제 발화**했다. 자동 치유(게이트가 설정을 직접 고침)는 기각했다 — 판정 게이트가 판정 대상을 고치면 언제나 초록이고 초록의 의미가 사라진다. 매처 정확 일치도 기각했다(도구를 넓히는 정당한 강화가 위반이 되면 사람이 정책을 끈다). 범위: 이 축은 **배선의 실재**만 판정하며 에이전트가 경고를 따르는지는 판정하지 않는다(그 회계는 SPEC-049) [검증: tooling/__tests__/agent-wiring.test.mjs] |
