# Feature Specification: Deploy Window (push 시점 배포 시간창을 실제 push 대상·타임존 로컬 시각으로 판정하는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-060`  **Created**: 2026-08-26  **Status**: Reviewed
**Input**: SPEC-059(pipeline-setup)에서 분할됨 — cohesion 게이트가 원 스펙의 FR 14개(> `maxFRsPerSpec: 10`)를 지목해, 완화(상한 상향) 대신 이미 독립 파일이던 관심사(설정 생성 vs 실시간 강제)를 실제로 분할했다. 손으로 짠 파이프라인이 겪은 결함 클래스(로컬 브랜치명 vs 실제 push 대상 혼동, 고정 UTC 오프셋으로 DST 있는 타임존에서 조용히 어긋남)를 판정 코어로 막고, 마법사를 안 쓴 프로젝트에서는 완전히 무해한 pre-push 게이트로 강제한다.

---

## User Scenarios & Testing

### User Story 1 — 배포 시간창 판정은 실제 push 대상으로만 하고, 고정 오프셋을 쓰지 않는다 (P1)
로컬 브랜치 이름이 우연히 배포 브랜치와 같은데 실제로는 다른 원격 브랜치로 push되는 경우, 판정 근거를 로컬 이름으로 잡으면 오탐/미탐이 난다. 또한 창 계산에 고정 UTC 오프셋을 손으로 더/빼면 서머타임(DST) 있는 타임존에서 한 시간씩 어긋난다.
- **Independent Test**: git pre-push 프로토콜 stdin(로컬 ref·oid, 원격 ref·oid)을 파싱해 **원격 ref**로만 대상을 판정하는 것과, `Intl.DateTimeFormat`으로 타임존 로컬 시각을 얻어 자정을 넘는 창·요일 제한·트레일러 예외를 판정하는 것을 각각 확인. [검증: tooling/__tests__/deploy-window.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a push where the local branch name equals the deploy branch but the remote ref does not, **When** `targetsDeployBranch` evaluates the parsed refs, **Then** it returns `false`. 2. **Given** a window `{start:"09:00", end:"18:00", timezone:"Asia/Seoul"}` and a moment that is 19:00 in Seoul but within 09:00–18:00 UTC, **When** `deployWindowVerdict` evaluates it, **Then** the status is `out-of-window` (the timezone's local time governs, not UTC).

### User Story 2 — 배포 시간창 게이트는 마법사를 안 쓴 프로젝트에서 완전히 무해하다 (P1)
이 게이트는 킷 정본 `pre-push` 템플릿(SPEC-004 소유)에 배선된다 — 소비 프로젝트가 `/sdd-pipeline-setup` 마법사를 돌리지 않았으면 `sdd.pipeline.config.json`도 `check-deploy-window.mjs`도 없으므로, 템플릿의 존재-확인 한 줄이 조용히 아무것도 하지 않는다. 마법사를 돌린 프로젝트에서도 `deployWindowPolicy`가 명시적으로 `advisory`/`hard`로 승격되기 전까지는 강제하지 않는다.
- **Independent Test**: 설정 파일 미존재·정책 `off`·배포 브랜치 아닌 push 세 경우 모두 exit 0·무출력임을, `hard`에서 창 밖이면 차단·`advisory`에서는 경고만·트레일러가 있으면 예외 통과임을 게이트 e2e로 확인. [검증: tooling/__tests__/deploy-window.test.mjs]
- **Acceptance (GWT)**: 1. **Given** no `sdd.pipeline.config.json` in the project root, **When** the pre-push hook body checks for `scripts/check-deploy-window.mjs`'s existence and (if present) runs it, **Then** the gate itself exits 0 silently because no promotions are declared. 2. **Given** `deployWindowPolicy: "hard"` and a promotion whose window is `out-of-window` at push time with no override trailer in the commit message, **When** the pre-push hook runs, **Then** it exits non-zero and the push is blocked.

### User Story 3 — 킷 정본 pre-push 템플릿이 배선을 소유해, 소비 프로젝트가 킷을 업데이트해도 살아남는다 (P1)
소비 프로젝트의 훅 몸통(`scripts/sdd-pre-push.sh`)은 `sync_copy`로 매 업데이트마다 무조건 덮어써진다(킷 소유 산출물 규칙) — 게이트 호출을 소비 프로젝트 쪽에 직접 배선하면 다음 업데이트에서 조용히 사라져, 이 스펙이 막으려는 결함 클래스(hard 게이트인데 실행 조건이 안 맞아 조용히 무발화) 그 자체를 재현한다.
- **Independent Test**: 킷 정본 `tooling/harness/pre-push`의 본문이 `scripts/check-deploy-window.mjs` 존재-확인 조건부 호출을 포함하고, sdd-sync 훅과 같은 stdin 캐시를 재사용함을 정적으로 확인. [검증: tooling/__tests__/deploy-window.test.mjs]
- **Acceptance (GWT)**: 1. **Given** the kit's own canonical `tooling/harness/pre-push` template, **When** `scripts/check-deploy-window.mjs` does not exist in the consuming project, **Then** the template's conditional branch is skipped entirely with no error or output.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **Node 전용이다 — Python 미러를 만들지 않는다.** `check-deploy-window.mjs`는 `check-deploy-precheck.mjs`(SPEC-035)와 같은 이유로 훅 편의 계층이다 — 소비 프로젝트에만 배포되는 pre-push 헬퍼이지 킷 자신의 sweep 판정 게이트가 아니다(HARNESS.md R-번호 미등재, `sdd-sync.mjs`의 `RULES` 배열에 없음). 런타임 패리티 대상(SPEC-006)은 판정 게이트이고, 훅 헬퍼가 없는 런타임에서도 커밋·CI 강제는 그대로 작동한다.
- **git pre-push 프로토콜의 두 zero-oid 의미는 반대다.** `localOid`가 전부 0이면 로컬 ref가 없다는 뜻(원격 브랜치 **삭제** push)이라 대상에서 뺀다. `remoteOid`가 전부 0인 것은 반대로 "원격에 아직 없다"(신규 브랜치 **최초** push)는 뜻이라 정상 대상이다 — 이 둘을 헷갈리면 최초 배포 push가 조용히 판정에서 빠진다(구현 중 실제로 뒤바꿔 썼다가 e2e 테스트 실패로 발견·수정).
- **인터뷰·스키마 생성은 이 스펙의 범위가 아니다(SPEC-059).** `deployWindow` 값이 어떻게 답변되고 `sdd.pipeline.config.json`에 저장되는지는 SPEC-059가 소유한다 — 이 스펙은 저장된 값을 판정·강제만 한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **deploy-window** (E) core's **deployWindowVerdict(window, nowMs, commitMessage)** (S) in **deploy-window-lib.mjs** (S) SHALL derive the current weekday and minute-of-day in the window's declared timezone using `Intl.DateTimeFormat`, not a fixed numeric UTC offset, and SHALL treat `start > end` as a window that wraps past midnight, so that daylight-saving transitions never silently shift the window by a fixed amount.
- **FR-002** (event): WHEN the current moment is outside the declared window (or on a day not in `days`) and the commit message contains a line matching `^<overrideTrailer>:`, THE core SHALL return status `overridden` instead of `out-of-window`, so a declared, per-push exception leaves a traceable mark in the commit that produced it.
- **FR-003** (ubiquitous): THE core's **parsePrePushRefs(stdin)** and **targetsDeployBranch(refs, deployBranch)** (S) SHALL determine whether a push targets the deploy branch using each ref line's `remoteRef` field only (never the local ref name), SHALL exclude a line whose `localOid` is all zero (a remote-branch deletion), and SHALL include a line whose `remoteOid` is all zero (a first push of a new branch), because these two zero-oid cases carry opposite meaning in the git pre-push protocol.
- **FR-004** (event): WHEN **check-deploy-window.mjs** (S) runs as a pre-push hook and finds no `sdd.pipeline.config.json`, or `deployWindowPolicy` is `"off"`, or the push's `remoteRef` does not target the declared deploy branch, THE gate SHALL exit 0 with no output; WHEN it finds an applicable promotion whose window status is `out-of-window` or `misconfigured`, THE gate SHALL print the finding under any policy and SHALL exit non-zero only when `deployWindowPolicy` is `"hard"` — capability: **deploy-window.enforce** (C).
- **FR-005** (event): WHEN the kit's own canonical `tooling/harness/pre-push` template runs and `scripts/check-deploy-window.mjs` does not exist in the consuming project, THE template SHALL skip that check entirely (no error, no output); WHEN it does exist, THE template SHALL invoke it with the same pre-push stdin already cached for the sync check, so that projects that never ran the pipeline-setup wizard are wholly unaffected and the wiring survives every kit update (it lives in the kit-owned template, not a per-project copy).

### Key Entities
- **deploy window** — a per-promotion declaration (`enabled`, `days`, `start`, `end`, `timezone`, `overrideTrailer`) of when a push to the deploy branch is allowed to proceed toward that promotion, judged against the actual push moment in the declared timezone, not a fixed offset. The declaration itself is defined and stored by SPEC-059; this spec owns only its runtime judgment and enforcement.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: deploy-window
- **Symbols**: deploy-window-lib.mjs, check-deploy-window.mjs
- **Artifacts**: —
- **Capabilities**: deploy-window.enforce
- **Files**: tooling/deploy-window-lib.mjs, tooling/check-deploy-window.mjs, tooling/__tests__/deploy-window.test.mjs

## Dependencies (참조 — dedup 제외)
> `deployWindowPolicy` knob은 SPEC-001 소유(`sdd-config.mjs`)에 추가된 필드를 읽는다. `PIPELINE_CONFIG_FILE` 기본 파일명 상수와 `sdd.pipeline.config.json`의 스키마 자체는 SPEC-059 소유(`pipeline-setup-lib.mjs`) — 이 spec은 그 상수와 파일을 **읽기만** 한다. 판정 타입 방출(`armVerdict`/`verdict`/`judged`)은 SPEC-040 소유(`verdict-lib.mjs`). pre-push 정본 템플릿 자체(`tooling/harness/pre-push`)는 SPEC-004(harness-install) 소유 — 이 spec은 그 파일에 존재-확인 조건부 호출 한 줄을 추가할 뿐, 파일 자체를 소유하지 않는다.
- **Modules**: key-pipeline (references), gate-verdict (references), harness-install (references), pipeline-setup (references)
- **Symbols**: sdd-config.mjs, verdict-lib.mjs, pipeline-setup-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `deploy-window.test.mjs` 전 케이스 green — 타임존 로컬 시각 판정(고정 오프셋 아님)·요일 제한·자정 넘는 창·트레일러 예외·원격 ref 기반 판정·zero-oid 두 의미 구분·게이트 e2e(미선언/정책 off/배포 브랜치 아님 침묵, hard 차단, advisory 경고, 트레일러 예외 통과)·pre-push 정본 템플릿의 존재-확인 배선. [검증: tooling/__tests__/deploy-window.test.mjs]
- **SC-002**: 마법사를 안 쓴 프로젝트에서 킷 업데이트(`sdd-init.sh` 재실행) 전후로 pre-push 훅 동작이 바이트 단위로 동일하다(무해성 회귀 확인) — `scripts/check-deploy-window.mjs`가 없을 때 `tooling/harness/pre-push`의 조건문이 그 분기를 완전히 건너뜀을 스크립트 정적 확인으로 대체(킷 자신은 소비 프로젝트가 아니라 실배포 워크플로가 없어 실측 e2e 불가 — 픽스처 기반 게이트 e2e가 대체 증거). [검증: tooling/__tests__/deploy-window.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어(`deploy-window-lib.mjs`)는 문자열·배열·시각(`nowMs`) 입력만의 순수 함수다(IO 없음) — 현재 시각·stdin 읽기는 소비 게이트(`check-deploy-window.mjs`)가 주입하므로, 저장소·실제 git 프로세스 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/deploy-window.test.mjs]

## Assumptions / Clarifications Retained
- 킷 자신에는 배포 대상 인프라가 없어(순수 도구 킷) `sdd.pipeline.config.json`이 미선언이고, 이 축은 킷 자기적용에서 **INERT**다 — `check-deploy-window.mjs`가 매 실행 침묵으로 그 사실을 밝힌다(설정 파일 부재 → exit 0 무출력).
- 오너의 명시적 결정(pre-push 배선 위치): 소비 프로젝트의 훅 몸통이 아니라 킷 정본 `tooling/harness/pre-push` 템플릿 자체에 존재-확인 조건부 호출을 추가했다 — 소비 프로젝트에 직접 배선하면 다음 킷 업데이트(`sync_copy`가 킷 소유 산출물을 항상 덮어씀)에서 조용히 사라지기 때문이다.
- 오너의 명시적 결정(Python 미러 생략): `check-deploy-window.mjs`는 훅 편의 계층(SPEC-035 `check-deploy-precheck.mjs`와 같은 층)이라 SPEC-006의 런타임 패리티 대상(sweep 판정 게이트)이 아니다 — Node 전용으로 남긴다.
- **기각한 대안:** 배포 시간창 판정에 고정 UTC 오프셋(예: `KST = UTC+9`)을 상수로 하드코딩하는 방식. 서머타임이 있는 타임존에서 계절에 따라 조용히 한 시간씩 어긋난다 — `Intl.DateTimeFormat`이 시스템 타임존 데이터베이스를 통해 이 문제를 구조적으로 없앤다. 재검토 조건: 없음.
- **기각한 대안:** pre-push 판정에 로컬 브랜치 이름을 근거로 쓰는 방식. 로컬 브랜치명이 우연히 배포 브랜치와 같은데 실제로는 다른 원격 브랜치로 push되는 경우를 오탐/미탐한다 — git 프로토콜이 이미 실제 원격 대상(`remoteRef`)을 stdin으로 준다. 재검토 조건: 없음.
- **기각한 대안:** SPEC-059와 한 스펙으로 유지하는 방식. cohesion 게이트가 FR 14개(> `maxFRsPerSpec: 10`)를 지목했을 때 상한을 올리는 완화도 가능했으나, 이 킷 자신이 반복적으로 금지해온 패턴("자를 바꿔 재는 완화")이라 기각하고 실제 분할을 택했다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-26 | 셀프리뷰(코어 TDD + 게이트 카나리아 다수 + 오너 확정 설계 대조) + SPEC-059에서 분할(retrofit이므로 Reviewed로 직접 작성) → Reviewed | FR-001~005 unit 커버. 킷 자기적용: 킷 자신에 배포 대상이 없어 INERT이고 게이트가 그 사실을 매 실행 밝힌다 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-26 이웃 SPEC-059(pipeline-setup): 비중복이자 자매 관계 — 059는 인터뷰 답변을 스키마로 직렬화하고 Jenkinsfile을 렌더링하는 **생성** 축, 060은 그 스키마의 `deployWindow` 값을 push 시점에 실시간으로 **판정·강제**하는 축이다 — 원래 한 스펙이었다가 cohesion 상한 대응으로 분할했다.
- 2026-08-26 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 **행위**의 전제조건(미커밋 트리·upstream 뒤처짐·계획 범위 드리프트)을 판정하고, 060은 배포 **시각**(창 안/밖)을 판정한다 — 둘 다 Node 전용 훅 편의 계층이라는 구조는 같지만(선례 재사용), 035는 이미 존재하는 배포 명령을 가로채고 060은 push 시점에 시간 제약만 본다.
- 2026-08-26 이웃 SPEC-032(live-reality): 비중복 — 032는 스펙 SC가 "라이브에서 실제로 확인됐는가"를 주기적/commit-msg 시점에 점검하는 sweep 게이트이고, 060의 `check-deploy-window.mjs`는 push 시점 실시간 차단이며 sweep 미등재다.
- 2026-08-26 이웃 SPEC-004(harness-install): 비중복이자 배선 관계 — 004가 소유한 `tooling/harness/pre-push` 정본 템플릿에 060이 존재-확인 조건부 호출 한 줄을 추가한다. 파일 자체의 소유권은 004에 남고, 060은 그 안의 조건부 분기 내용만 책임진다(Dependencies로 참조, Ownership에 파일을 넣지 않음).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다.
  근거 칸은 실기록 행(실제 날짜)에서 빈 값 불가 — 변경의 "왜"는 저술 시점에만 캡처 가능하고
  사후 재도출이 불가능하다(선제 캡처, SPEC-009). completeness 게이트가 존재를 검사. -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-26 | 초안(SPEC-059에서 분할, retrofit — Reviewed로 직접 작성) — 배포 시간창 판정 코어·pre-push 강제 게이트·킷 정본 템플릿 배선 신설 | cohesion 게이트(FR 14개 > `maxFRsPerSpec: 10`) 대응 — 완화(상한 상향) 대신 이미 독립 파일이던 관심사를 실제로 분할 |

> **폐기 시:** `Status=Removed` + **코드·테스트를 같은 PR로 동시 삭제**(dangling `@covers`는 FR 게이트가 막음) + 이 표에 제거 기록 → spec 파일 삭제(git이 히스토리 보존). 상세: `STRUCTURE.md` 폐기 수명주기.
