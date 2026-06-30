# 설계 — SDD 하네스 (Gap 3): 인터랙티브 spec↔code sync

> Status: **Draft (검토 대기)** · Date: 2026-06-30
> 관련: 요구 캡처 [2026-06-30-harness-vision-and-requirements.md](2026-06-30-harness-vision-and-requirements.md) · [METHODOLOGY.md](../../../METHODOLOGY.md) converge · 게이트(`check-fr-coverage`/`check-converge-drift`/`check-orphan-surfaces`/`check-ownership`/`check-spec-cohesion`)
> 전제: 규칙 토대(Gap 1 1레포1모듈 / Gap 2 spec입도)는 완료(`49dce2b`). 하네스는 그 규칙을 *운영*하는 층.

## 0. 요약

방법론의 spec↔code 생애주기를 **사람-개입 인터랙티브 하네스**로 오케스트레이션한다. 하네스는 **선언적 규칙표 `{trigger, detect, ask, act}`**(= 포터블 플로우 계약, `HARNESS.md`)로 정의되고, **탐지는 전부 기존 게이트를 재사용**(새 판정 로직 0)한다. Claude Code는 그 계약을 실행하는 **1차 executor**(스킬 `/sdd-sync` + git pre-push 훅). 결정은 항상 사람 게이트(작성=LLM, 승인=사람 — converge 원칙).

## 1. 핵심 추상 — 플로우 계약 = 규칙표

사용자가 말한 4개 시나리오는 모두 **"이벤트 → 탐지 → 사람 질문 → 방법론 단계"** 의 변주다. 그래서 하네스를 **선언적 규칙표**로 정의한다(런타임 중립 데이터):

| 규칙 | Trigger (이벤트) | Detect (기존 게이트) | Ask (사람 결정) | Act (방법론 단계) |
|---|---|---|---|---|
| **R1 spec→code** | spec 생성/변경 | `check-fr-coverage`(테스트 없는 FR ≈ 미구현) | "이 FR들 코드 생성/업데이트?" | TDD 구현(RED→GREEN) → 재검증 |
| **R2 code→spec** | 코드 변경·spec 무변경 | `check-converge-drift`·`check-orphan-surfaces` | "기존 spec 개정 / 새 spec / 의도적 무시?" | `/converge`→intent→`/specify`(update·new)→`/analyze`→사람 bless |
| **R3 dedup+입도** | spec 생성/변경 직후 | `check-ownership`(구조 중복)·`check-spec-cohesion`(과대 spec)·이웃 의미 리뷰 | "중복 통합 / 과대 spec 분할?" | spec 통합 또는 분할 → 재검증 |
| **R4 상시 sync** | push·주기·요청 | 위 detect **일괄** | drift 있으면 해당 규칙으로 라우팅 | (R1/R2/R3의 act) |

→ 이 표가 **계약(SSOT)**. 새 동작을 더하려면 행을 추가한다. Claude Code 실행기는 이 표를 *해석*할 뿐 — 다른 에이전트도 같은 표로 구현 가능(게이트 4-런타임 패턴과 동일 정신, [principles.md §10](../../../principles.md)).

## 2. 규칙 상세

- **R1 spec→code.** spec이 새로/바뀌면 `check-fr-coverage`로 *테스트(=`@covers`) 없는 FR*을 뽑는다(미구현 프록시). 사람에게 "이 FR들 구현?"을 묻고, 예면 TDD(RED→GREEN)로 구현 후 게이트 재검증. *코드를 사람 승인 없이 자동 생성하지 않는다 — 의사 확인이 게이트.*
- **R2 code→spec.** 코드는 바뀌었는데 spec이 안 바뀌면 `check-converge-drift`(git diff 기반)·`check-orphan-surfaces`(spec 없는 표면)가 잡는다. 사람에게 "기존 spec 개정 / 새 spec / 의도적 무시(hotfix)?"를 묻고 → `/converge`로 갭 표면화 → **사람이 intent 한 줄 입력** → `/specify`(update 또는 new)로 LLM이 `코드 diff + intent`로 spec 작성 → `/analyze` 정합 → **사람 bless**. (코드만 보고 추측해 spec 자동 덮어쓰기 금지.)
- **R3 dedup+입도.** spec 생성/변경 직후 `check-ownership`(같은 키 2 spec = 구조적 중복)·`check-spec-cohesion`(키/FR 과다 = 과대 spec) + 같은 Entity 이웃과 좁힌 의미 리뷰. 사람에게 "중복 통합 / 과대 spec 분할?"을 묻고 → 통합 또는 capability별 분할 → 재검증. (Gap 1·2 규칙을 운영하는 지점.)
- **R4 상시 sync.** 파이프라인이 돈 뒤에도 위 detect를 **일괄**로 수시 실행. drift가 있으면 종류에 따라 R1/R2/R3로 라우팅. "한 번 맞췄으니 끝"이 아니라 **상시 일치 보장**이 목표.

## 3. 포터블 계약 vs 실행기 (형태 C)

| 층 | 무엇 | 런타임 |
|---|---|---|
| **계약** | `HARNESS.md` = §1 규칙표 + 각 규칙의 trigger/detect/ask/act 명세 | 중립(데이터) |
| **탐지기** | 기존 게이트(`check-*`) | 이미 4-런타임(Go/셸/Python/Node) |
| **실행기** | Claude Code: 스킬 `/sdd-sync` + git pre-push 훅 | Claude Code 1차(다른 에이전트는 자체 실행기) |

계약·탐지기는 중립, 실행기만 에이전트별. **Claude Code 전용으로 박지 않는다.**

## 4. Claude Code MVP

**`/sdd-sync` 스킬 흐름(R4 루프 = 진입점, R1·R2·R3를 포괄):**
1. **Detect** — detector 게이트들을 advisory로 실행, 규칙별 발견 수집.
2. **요약** — 발견을 사람에게 한눈에 제시(R1 미구현 FR n, R2 drift/고아표면 n, R3 중복/과대 n).
3. **Ask(규칙별 게이트)** — 발견 있는 규칙마다 `AskUserQuestion`으로 의사 확인.
4. **Act** — 선택대로 방법론 단계 구동(TDD 구현 / `/converge`+`/specify` / 통합·분할).
5. **재검증 루프** — detect 재실행, 깨끗해지거나 사람이 멈출 때까지.

**git pre-push 훅(R4 "수시"의 값싼 1차):** detector를 advisory로 돌려 drift 있으면 "`/sdd-sync` 돌려라" 안내(기본 비차단; opt-in `--strict`로 차단). 매 push마다 sync 점검 → 인프라 0.

## 5. 사람 승인 원칙 (불변)

작성=LLM, **승인=사람.** 어느 방향도 자동 덮어쓰기 금지 — spec→code 자동 생성도, code→spec 자동 반영도 사람 의사 확인 게이트를 통과해야 한다. (METHODOLOGY converge 정확판 계승: drift는 *task/질문으로 표면화*만, 정본화는 사람.)

## 6. 이미 있는 것 ↔ 하네스가 더하는 것

| 요구 | 이미 있음(탐지/판정) | 하네스가 더함 |
|---|---|---|
| R1 | `check-fr-coverage` | spec-저장 트리거 + 생성/업데이트 확인 게이트 + TDD 구동 |
| R2 | `check-converge-drift`·`check-orphan-surfaces`·`/converge` | 코드-변경 트리거 + 신규/개정 분기 질문 |
| R3 | `check-ownership`·`check-spec-cohesion`·이웃 리뷰 | spec 직후 자동 실행 + 확인 게이트 + 통합/분할 |
| R4 | 위 전부 | **상시/push 트리거** + drift 사람 확인 + 규칙 라우팅 |

→ 하네스 = **트리거 + 사람 확인 게이트 + 단계 연결.** 판정 로직은 신규 0.

## 7. 범위·phasing

- **MVP(이번):** `HARNESS.md` 계약 + `/sdd-sync` 스킬(4규칙 detect→ask→act on-demand) + pre-push 훅(advisory). adopting 프로젝트에 `sdd-init`로 설치(게이트처럼).
- **후속:** 연속 file-watch·스케줄 트리거 / 규칙별 분리 명령 / 다른 에이전트 실행기 / R3 의미 리뷰 자동 보조(임베딩).

## 8. 어디에 사는가 (배포)

`HARNESS.md`(계약) + executor(스킬·훅 템플릿)는 **키트 `tooling/`** 에 싣고, adopting 프로젝트가 `sdd-init.sh`로 설치한다(게이트·config와 동일 경로). 키트 자신(ai-methodology)엔 `sdd/specs`가 없으므로 하네스는 *adopting 프로젝트에서* 동작한다.

## 9. 미해결 / 리스크

1. `/sdd-sync`의 R4 base 기준 — `check-converge-drift`가 쓸 git base(origin/main? 마지막 sync 커밋?) 결정.
2. `AskUserQuestion` 게이트 UX — 규칙별 단건 vs 발견 묶음 배치 확인.
3. 스킬 vs 슬래시명령 패키징 — Claude Code에서 adopting 프로젝트에 어떻게 설치/등록할지(플러그인? 프로젝트 스킬?).
4. `/specify`·`/converge` 등 Spec Kit 명령 의존 — adopting 프로젝트에 Spec Kit init 전제(APPLYING §1). 미설치 시 graceful 안내.
5. R3 이웃 의미 리뷰는 확률적(LLM) — advisory로만, 빌드 차단 근거 아님([DEDUP.md](../../../DEDUP.md) 2계층 경계).
