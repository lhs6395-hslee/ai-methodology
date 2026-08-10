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
- **clean machine(키트 로컬에 없음)**: `prompts/` 정본 절차 파일을 `<methodology-url>` **raw URL**로 직접 읽어 실행한다 — 전체 clone 불필요. 진입 raw URL은 `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/prompts/<파일>` 형식이며(정본 `<ref>`=`main`), 각 절차는 자신을 받은 `<ref>`를 이어 써서 main/브랜치 어느 raw든 동일 동작한다(자기참조).
- **강제 tooling 확보**: 게이트·훅용 tooling은 로컬 절대경로를 가정하지 않고 repo URL 기반 **partial + sparse checkout**(`--filter=blob:none --sparse`, `sparse-checkout set tooling templates prompts`)으로 확보한다 — 전체 526KB clone 아님. 로컬 키트가 있으면 그것을 재사용한다.
- 세 스킬 모두 인자 없이 불리면 현재 디렉토리를 대상 루트로, 정본 저장소를 방법론 URL로 삼는다.

---

## Functional Requirements (EARS)
> 정본은 영어.

- **FR-001** (event): WHEN `/sdd-start` runs in a project that has no `sdd/` layout, THE **sdd-start.SKILL.md** (S) skill SHALL wire the kit via `sdd-init`, reverse-engineer DRAFT EARS FR specs from the current code, and HALT at a human-approval gate before finalizing any spec. — capability: **adoption-lifecycle.adopt** (C).
- **FR-002** (event): WHEN `/sdd-readopt` runs, THE **sdd-readopt.SKILL.md** (S) skill SHALL first create a `git tag sdd-pre-readopt-<date>` safety snapshot, re-wire via `sdd-init --force`, and clear prior `sdd/specs` without modifying production code, then reverse-engineer DRAFT specs and HALT at the approval gate.
- **FR-003** (event): WHEN `/sdd-update` runs, THE **sdd-update.SKILL.md** (S) skill SHALL surface code↔spec drift through the `/sdd-sync` harness, escalating bug-driven drift to `/speckit.fix`, and keep gates green.
- **FR-004** (unwanted): IF any **adoption-lifecycle** (E) command would finalize or overwrite a spec or production code without recorded human approval, THEN THE SYSTEM SHALL refuse the action and wait for approval.
- **FR-005** (optional): WHERE a `<project-path>` or `<methodology-url>` argument is omitted, THE SYSTEM SHALL default to the current working directory and the canonical methodology repository respectively.

### Key Entities
- **lifecycle command** — one of the three installed skills (`/sdd-start`, `/sdd-readopt`, `/sdd-update`) defined by a `SKILL.md` file, each executing a `prompts/` procedure.
- **approval gate** — the halt point where an LLM-authored draft awaits human blessing before finalization.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities). Symbols = 스킬 소스(SKILL.md 진입점), Artifacts = 설치 산출물(`.claude/skills/*`).
- **Modules**: adoption-lifecycle
- **Symbols**: sdd-start.SKILL.md, sdd-readopt.SKILL.md, sdd-update.SKILL.md
- **Artifacts**: .claude/skills/sdd-start/SKILL.md, .claude/skills/sdd-readopt/SKILL.md, .claude/skills/sdd-update/SKILL.md
- **Capabilities**: adoption-lifecycle.adopt
- **Files**: tooling/harness/sdd-start.SKILL.md, tooling/harness/sdd-readopt.SKILL.md, tooling/harness/sdd-update.SKILL.md, tooling/__tests__/lifecycle-skills.test.mjs

## Dependencies (참조 — dedup 제외)
> 설치·배선과 하네스 detector는 아래 모듈들이 소유. 라이프사이클 스킬은 이를 호출·안내만 한다.
- **Modules**: harness-install (references)
- **Symbols**: sdd-init.sh, sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `lifecycle-skills.test.mjs`가 세 스킬 파일의 존재와 각 스킬의 계약(초안+승인 게이트·안전망 태그·`/sdd-sync` 래핑·자동 덮어쓰기 금지·인자 기본값)을 검증하며 통과한다(현재 green). [검증: tooling/__tests__/lifecycle-skills.test.mjs]
- **SC-002**: `sdd-init.sh --gate=node` 실행 후 세 스킬이 `.claude/skills/{sdd-start,sdd-readopt,sdd-update}/SKILL.md`로 설치된다(SPEC-004 FR-003이 소유·강제). [검증: tooling/__tests__/lifecycle-skills.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 세 스킬의 상세 절차 원본은 `prompts/`에 한 곳으로 두고(SSOT), 스킬은 이를 참조·실행한다 — 절차 본문을 중복 저장하지 않는다(드리프트 방지). [검증: tooling/__tests__/lifecycle-skills.test.mjs]

## Assumptions / Clarifications Retained
- 최초 채택(`/sdd-start`)은 배선 전 상태에서도 실행될 수 있으므로, 진정한 clean-machine 진입은 `prompts/adopt.md`(raw URL)로도 가능하다. 설치형 스킬은 채택 이후의 재채택·업데이트에서 특히 유용하다.
- 진입점 문서(README·PROMPTS·`prompts/*`·SKILL)는 프롬프트를 **로컬 절대경로로 하드코딩하지 않는다** — 정본 진입은 GitHub raw URL이고, 로컬 키트 경로(`~/Documents/claude/sdd`)는 선택적 캐시 관례일 뿐 전제가 아니다.

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 게이트 전종·전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-004(harness-install): 비중복 — 설치 하네스는 참조(Dependencies), 채택 수명주기 스킬만 소유.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-03 | 초안 — 채택 수명주기 3 명령(start/readopt/update)을 별도 aggregate로 신설(SPEC-004 install 메커니즘과 분리; cohesion 캡 준수) | feat/lifecycle-commands |
| 2026-07-04 | 진입점 교정 — 로컬 절대경로(`~/Documents/claude/sdd/prompts/*`) 하드코딩 제거, 정본 진입을 GitHub **raw URL**로; tooling 확보를 repo URL 기반 **partial+sparse**로 명시(전체 clone 불필요, clean-machine 진입 보장). Edge Cases·Assumptions 갱신 | feat/lifecycle-commands |
| 2026-07-04 | main 머지 후 ref 승격 — 진입 raw URL·`REF` 기본값·문서 주석의 `<ref>`를 `feat/lifecycle-commands`→`main`으로 교체(정본 ref=main, 자기참조 유지). Change Log 근거 열은 이력이라 보존 | main |
| 2026-07-05 | /sdd-readopt 요약 절차에 소스 9클래스 재도출·인간 절 이월·키 보존/retag·smoke-scan 결선 반영(SSOT는 prompts/readopt.md — 요약 정렬) | SPEC-009~011 신설 동반 — 요약이 원본과 갈라지면 스킬 실행 경로가 구 절차로 재도출함 |
| 2026-07-21 | 전면개정(born-conformant + 다회 수렴 + 전면 재수정 escalation) — adopt.md/readopt.md에 저술 시점 방법론 정합 3종(스펙 정체성=entity·capability 귀속 SPEC-024·FR 키 앵커 SPEC-023) + "다회 게이트-구동 수렴(정확성>토큰, 위반 0까지 반복)"으로 단일패스 종결 대체. update.md 5단계 실행 경로를 백로그 규모로 분기 — 증분=`/sdd-migrate`, 전면 재수정(구조적·전반적 위반)=`/sdd-readopt` 백지 재도출 권장. principles.md #10 신설(다회 정확성 우선) | owner: "토큰 많이 들어도 다회 정확성 위주 전면개정 — 최초 구현도 잘 되도록 + 업데이트 시 스펙 전면 재수정이 필요하면 돌아갈 수 있도록" |
| 2026-07-21 | update.md 루프 닫기 — 면제 부채를 백로그로 취급(사용자는 정상/비정상을 못 가리므로 update가 판정). 대량 면제·UI 이름 면제는 "papered-over(정상 아님)"로 명확히 판정하고 전면 재수정(readopt)으로 라우팅, "면제라 통과했으니 done" 보고 금지. 전면 재수정 트리거에 "대량 면제 부채" 추가 | owner: "사용자 입장에선 망가진 건지 구분 못 한다 — update 한 줄로 이 경우도 되게(판정을 사용자에게 떠넘기지 말 것)". 실측: update 11회차가 40건 일괄 면제 후 거짓 '완료' |
| 2026-07-21 | update.md 선택지 제시 규칙 명문화 — 중립 나열 금지: papered-over 감지 시 `/sdd-readopt`를 첫 번째·"(권장)"으로 제시하고, "현행 유지(면제로 충분)"를 UI/흐름 면제의 유효 선택지로 내세우지 않는다("현행 유지"는 실 외부 aggregate 면제에만 정당) | owner: "전면 재수정으로 유도하게 해줘야지". 실측: update 12회차가 '현행 유지'를 1번 선택지로 내세워 papered-over를 co-equal로 제시 |
| 2026-07-21 | update.md graduation에 '새 체크의 기존 hard 소급 범람' 전이 명문화 — 새 도구가 이미 hard인 knob에 새 규칙을 얹어 대량 위반으로 깨질 때, '미적용/revert 권장'을 금지하고 '적용+임시 advisory 전이+마이그레이션+재hard' 단일 경로로 몰아준다 | 실측(소비 프로젝트): FR-007이 128건을 내며 frKeyAnchorPolicy=hard에 바로 물리자 에이전트가 '지금은 미적용(권장)'을 제시 — 회피를 권장으로 내세운 것(owner: '미처리가 권장으로 뜨는 이유?'). advisory는 경유지·hard가 종착지 원칙 재확인 |
| 2026-07-21 | update.md 실행 경로/불변 규칙 개정 — 백로그가 있으면 표면화에서 멈추지 말고 **같은 세션에서 migrate/readopt 절차로 이어 스펙을 실제 편집**한다. 사람 승인 관문은 '각 스펙 편집'에 걸리지 'migrate 시작' 여부가 아니다. 불변식을 '스펙 편집 금지'에서 '각 스펙 편집은 사람 승인 경유(작성=LLM·확정=사람)'로 정정 — 승인 없는 자동 덮어쓰기·빅뱅 재작성만 금지 | owner 반복 확정: "update해도 스펙 바꾸기로 했잖아". 실측: 소비 프로젝트가 update 후에도 스펙 무변경(에이전트가 '표면화까지가 범위'로 종결). 한계: 이 변경은 update.md 프롬프트 정정이며 하위 세션 준수를 기계적으로 강제하진 못함(하네스 영역) |
| 2026-07-27 | FR-001~004 주어를 `THE SYSTEM`에서 실제 행위자로 교체 — 스킬 소스 3종(**sdd-start.SKILL.md**·**sdd-readopt.SKILL.md**·**sdd-update.SKILL.md**)과 aggregate **adoption-lifecycle** FR 앵커 | SPEC-023 FR-007(소유 키 앵커) 자기적용: SPEC-001 FR-010의 `ownershipCategoryRoles` 선언으로 규칙이 킷 자신에게 발화(감사 #21) — 소유 키 4건이 FR 선언 라인에 흔적이 없던 것을 명시(동작 불변) |
| 2026-08-02 | 해소안 제시 규범 확장 — **범위 축소·이월도 권장으로 올리지 않는다**(배치=순서 ≠ 범위=무엇을). `speckit-fix`에 §해소 범위 절 신설, `sdd-migrate`·세션 컨텍스트·HARNESS 불변·METHODOLOGY 리뷰 경계 27행 동반 | 실측(소비 프로젝트 gsn-mis-mcp): 데이터로 확인된 CRITICAL/HIGH 취약점 앞에서 "read측 치명상 4건만 **(권장)** / CRITICAL·HIGH 전부 / 스펙에만 기록"이 제시됐다 — 권장이 **부분 수정**이라 나머지 확인된 취약점을 안 고치는 것이 기본값이 됐다. 직전 라운드의 "완화 금지" 규범은 강도 하향·임계 상향·면제만 덮어 **범위 축소·이월**을 놓쳤다. "한 라운드에 검증 가능한 크기"는 옳은 공학이지만 순서의 근거이지 범위의 근거가 아니다 |
| 2026-08-10 | update.md 2단계에 **전이 폐포 diff** 명시(게이트가 import하는 로컬 모듈까지 재귀적으로 비교 대상 + 폐포 열거 명령 + R18을 기계 백스톱으로 지목), 5단계에 **자기적용 주의** 신설(규칙을 해소하는 커밋의 문서도 같은 검사 대상), 7단계에 R18 확인 항목 추가 | 소비 프로젝트 제보 2건. ①2~3단계 diff를 "내용 다른 파일"만 보는 방식으로 수행하니 **공유 lib 27개가 누락**돼 부분 동기화가 됐고 소비처가 판정 대신 `SyntaxError`를 받았다 — 제보가 준 두 선택지(절차 문구 vs 기계 점검)를 **둘 다** 채택했다: 문구만 두면 킷이 프로즈로만 금지하는 상태가 되고(그 패턴은 이미 여러 번 실패했다), 게이트만 두면 절차를 따르는 사람이 왜 그래야 하는지 모른 채 따른다. ②R3(근거 적용범위)를 해소하려고 Change Log에 `범위:`를 붙이는 그 커밋의 근거 칸이 "컨테이너"를 언급해 **스스로 다시 걸렸다** — 순환이 아니라 규칙이 자기 일을 한 것이고 출구는 항상 열려 있으므로, 절차에 "한 라운드에 두 번 걸리는 것을 정상으로 예상하라"와 "강도를 내리거나 어휘를 지워 빠져나가지 마라"를 함께 적었다. R13·R15·R1e도 같은 계열이라 묶어 서술했다. ⚠ `prompts/**`는 `specSyncExemptGlobs`라 어떤 게이트도 이 항목을 요구하지 않았다 — 면제가 조용히 '완료'가 되지 않게 자발적으로 남긴다 |
