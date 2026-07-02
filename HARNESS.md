# HARNESS — SDD 인터랙티브 sync 계약 (포터블)

> spec↔code 생애주기를 **사람-개입**으로 오케스트레이션하는 플로우 계약. 이 규칙표가 SSOT — 실행기(에이전트별)는 이 표를 해석한다. 탐지는 기존 게이트 재사용(판정 로직 신규 0). 결정은 항상 사람(작성=LLM, 승인=사람). 설계 근거: `docs/superpowers/specs/2026-06-30-harness-design.md`.

## 규칙표 {trigger, detect, ask, act}

| 규칙 | Trigger | Detect (게이트) | Ask (사람) | Act |
|---|---|---|---|---|
| **R1 spec→code** | spec 생성/변경 | `check-fr-coverage`(테스트 없는 FR ≈ 미구현) | "이 FR들 코드 생성/업데이트?" | TDD(RED→GREEN) → 재검증 |
| **R2 code→spec** | 코드 변경·spec 무변경 | `check-converge-drift`·`check-orphan-surfaces`·`check-spec-sync`(range) | "기존 spec 개정 / 새 spec / 의도적 무시?" | `/converge`→intent→`/specify`(update·new)→`/analyze`→bless |
| **R3 dedup+입도+완전성** | spec 생성/변경 직후 | `check-ownership`·`check-spec-cohesion`·`check-spec-completeness` | "중복 통합 / 과대 spec 분할 / SC·인수조건 보강?" | 통합·분할·보강 → 재검증 |
| **R4 상시 sync** | push·주기·요청 | 위 일괄(`sdd-sync.mjs`) | drift → 해당 규칙 라우팅 | (R1/R2/R3의 act) |

## 실행기 (Claude Code 1차 — 다른 에이전트는 같은 표로 자체 구현)
- **detect 집계:** `node scripts/sdd-sync.mjs [--strict]` → 규칙별 sync 리포트.
- **인터랙티브:** 스킬 `/sdd-sync` — 리포트 → 규칙별 사람 의사 확인 → act.
- **상시(R4):** git pre-push 훅이 `sdd-sync.mjs`를 advisory 실행 → drift면 `/sdd-sync` 안내(기본 비차단, `SDD_SYNC_BLOCK=1`로 차단).

## 불변
- 어느 방향도 **자동 덮어쓰기 금지** — 사람 의사 확인 게이트 필수.
- 탐지는 advisory 1차; `--strict` 승격은 팀 선택.
- 게이트는 런타임 중립(4판), 실행기만 에이전트별.
