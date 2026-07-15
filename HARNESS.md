# HARNESS — SDD 인터랙티브 sync 계약 (포터블)

> spec↔code 생애주기를 **사람-개입**으로 오케스트레이션하는 플로우 계약. 이 규칙표가 SSOT — 실행기(에이전트별)는 이 표를 해석한다. 탐지는 기존 게이트 재사용(판정 로직 신규 0). 결정은 항상 사람(작성=LLM, 승인=사람). 설계 근거: `docs/design/2026-06-30-harness-design.md`.

## 규칙표 {trigger, detect, ask, act}

| 규칙 | Trigger | Detect (게이트) | Ask (사람) | Act |
|---|---|---|---|---|
| **R1 spec→code** | spec 생성/변경 | `check-fr-coverage`(테스트 없는 FR ≈ 미구현) | "이 FR들 코드 생성/업데이트?" | TDD(RED→GREEN) → 재검증 |
| **R2 code→spec** | 코드 변경·spec 무변경 | `check-converge-drift`·`check-orphan-surfaces`·`check-spec-sync`(range — Draft 소유 차단·unowned 정책 포함) | "기존 spec 개정 / 새 spec / 의도적 무시?" | `/converge`→intent→`/specify`(update·new)→`/analyze`→bless |
| **R3 dedup+입도+완전성+일관성** | spec 생성/변경 직후 | `check-ownership`(+`entityRegistry`·Files 카테고리 금지)·`check-spec-cohesion`·`check-spec-completeness`(SC·인수조건 + 수명주기 기록 + Change Log 근거 + 문법 규범: Module 존재·단일성·SHALL·Dedup 참조 실재)·`check-spec-consistency` | "중복 통합 / 과대 spec 분할 / SC·인수조건·리뷰 기록·근거·문법 보강 / 근거 없는 키 정렬?" | 통합·분할·보강 → 재검증 |
| **R4 상시 sync** | push·주기·요청 | 위 일괄(`sdd-sync.mjs`) | drift → 해당 규칙 라우팅 | (R1/R2/R3의 act) |

> **범위 밖(의도적):** `check-derivation`(재도출 소스 회계)·`sdd-smoke-scan`(증거 드리프트)은 이 하네스의 규칙표에 넣지 않는다 — 트리거가 "spec/코드 변경"이 아니라 **재채택(readopt)·증거 갱신** 이벤트라서다. 실행 지점은 readopt 절차(`prompts/readopt.md` 6~7단계)와 CI 스텝(`ci-examples.md`·`sdd-gates.yml` 주석)이 담당한다. `retag`는 게이트가 아니라 마이그레이션 도구(dry-run 기본)라 detect 대상이 아니다.

## 실행기 (Claude Code 1차 — 다른 에이전트는 같은 표로 자체 구현)
- **detect 집계:** `node scripts/sdd-sync.mjs [--strict]` → 규칙별 sync 리포트.
- **인터랙티브:** 스킬 `/sdd-sync` — 리포트 → 규칙별 사람 의사 확인 → act.
- **상시(R4):** git pre-push 훅이 `sdd-sync.mjs`를 advisory 실행 → drift면 `/sdd-sync` 안내(기본 비차단, `SDD_SYNC_BLOCK=1`로 차단).

## 불변
- 어느 방향도 **자동 덮어쓰기 금지** — 사람 의사 확인 게이트 필수.
- 탐지는 advisory 1차; `--strict` 승격은 팀 선택.
- 게이트는 런타임 중립(4판), 실행기만 에이전트별.
- 로컬 훅(pre-commit·pre-push)·TDD는 run test(로컬 안전 유닛)만 실행하고, 인프라(관리형 DB·스토리지·큐·클라우드 API — 어느 CSP든) 테스트는 자격증명·도달성이 있는 개발서버·CI에서 run smoke로 — 로컬은 인프라 의존 테스트를 강제하지 않는다(METHODOLOGY '검증은 환경으로 계층화된다'·sdd.config.presets 테스트 tier 참조).

## 완료 루프의 꼬리 — 원점 트래커 close-out
작업이 tracked issue(QA/이슈 트래커)에서 유래했다면 verify/merge가 끝이 아니다 — **①트래커 dev-done(개발자) → ②이해관계자 완료 보고(무엇·왜·어떻게+검증 경로) → ③리포터 confirm(리포터/QA)**까지가 완료다. **2인 책임분리**: 개발자는 리포터의 confirm을 건드리지 않는다. 외부 시스템·사람 sign-off라 게이트가 아니라 규범이며(SC 충족과 동일 — 리뷰 경계), 실행기는 `speckit-fix` 스킬 마지막 단계(§완료형 스킬)다. 트래커 정체·보고 채널(수신자·형식)은 킷에 하드코딩하지 않고 `trackerCloseout` config(또는 CLAUDE.md 관례)로 인스턴스화한다(`{}`=비활성).
