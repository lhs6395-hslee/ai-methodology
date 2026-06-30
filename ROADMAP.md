# ROADMAP — SDD 방법론 키트

> 현재 상태와 **의도적으로 보류한** 항목. 보류 항목은 모두 *"필요가 증명되면 그때"* — YAGNI + `REALITY_CHECK.md`(추측 아닌 실행 검증) 원칙대로, 소비자 없는 추측 인프라를 미리 짓지 않는다.

## ✅ 완료 (main 반영, github.com/lhs6395-hslee/ai-methodology)
- **Gap 1 — 1 레포 = 1 모듈**: 방법론 재기준화. 큰 프로그램 = 모듈-레포들의 MSA 합성. (`49dce2b`)
- **Gap 2 — spec 입도(cohesion)**: `check-spec-cohesion` advisory 게이트 = `check-ownership`(dedup)의 거울상. (`649e12a`)
- **Gap 3 — 하네스 MVP**: 포터블 계약 `HARNESS.md` + detect 집계기 `tooling/sdd-sync.mjs` + `/sdd-sync` 스킬 + pre-push 훅. (`0de8820`, `14f6303`)
- 강화 게이트 3종(test-adequacy / converge-drift / orphan-surfaces) + `sdd-init` 배선(node 게이트 전체 설치).

설계·계획 근거: `docs/superpowers/specs/` · `docs/superpowers/plans/`.

## 🔜 보류 (트리거가 오면 착수)
| 항목 | 착수 트리거 |
|---|---|
| **Phase 2 — MSA 계약 프로파일** (계약 산출물 · `SYSTEM_MAP` · 계약 테스트 · consumer 버전 핀) | 실재하는 **다중-모듈 시스템**이 등장할 때 |
| 하네스: 연속/스케줄 트리거 | on-demand `/sdd-sync` + pre-push 훅으로 **부족하다고 드러날 때** |
| 하네스: 타 에이전트 실행기 | Claude Code 외 에이전트를 **실제로 쓸 때** (계약 `HARNESS.md`는 이미 런타임 중립) |
| 하네스: R3 임베딩 의미리뷰 | reworded(의미적) 중복이 **실제 고통이 될 때** (현재는 같은 Entity 이웃 LLM 리뷰로 충분) |
| 강화·cohesion·하네스 게이트의 Go·셸·Python 포팅 | **비-Node 프로젝트**가 그 게이트를 강제해야 할 때 (현재 Node판만, `ci-examples.md` "포팅 예정") |

## 🔬 권장 다음 단계 (아직 미착수)
- **도그푸딩**: 방법론을 실제 모듈(예: finops)에 끝까지 돌려 전 사슬(spec→test→code→게이트→하네스)을 검증 → 위 보류 항목 중 *실제로* 필요한 것을 추측이 아니라 사례로 식별.
