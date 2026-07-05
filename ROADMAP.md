# ROADMAP — SDD 방법론 키트

> 현재 상태와 **의도적으로 보류한** 항목. 보류 항목은 모두 *"필요가 증명되면 그때"* — YAGNI + `REALITY_CHECK.md`(추측 아닌 실행 검증) 원칙대로, 소비자 없는 추측 인프라를 미리 짓지 않는다.

## ✅ 완료 (main 반영, github.com/lhs6395-hslee/ai-methodology)
- **Gap 1 — 1 레포 = 1 모듈**: 방법론 재기준화. 큰 프로그램 = 모듈-레포들의 MSA 합성. (`49dce2b`)
- **Gap 2 — spec 입도(cohesion)**: `check-spec-cohesion` advisory 게이트 = `check-ownership`(dedup)의 거울상. (`649e12a`)
- **Gap 3 — 하네스 MVP**: 포터블 계약 `HARNESS.md` + detect 집계기 `tooling/sdd-sync.mjs` + `/sdd-sync` 스킬 + pre-push 훅. (`0de8820`, `14f6303`)
- 강화 게이트 3종(test-adequacy / converge-drift / orphan-surfaces) + `sdd-init` 배선(node 게이트 전체 설치).
- **Ownership 키 결정성** — 소유/참조(`## Dependencies`) 분리 · 정규화 절대규칙 · verb 고정집합 · PREFIX 표준(SPEC/INFRA/TEST)+사유 관문 · 1 spec=1 aggregate · `check-spec-consistency` 신규. (`cc3dc22..acf5b6f`, 설계 `specs/2026-06-30-…`, 계획 `plans/2026-07-01-ownership-…`)
- **방법론 강제 hook 세트** — SessionStart(방법론 주입)·PreToolUse(편집 체크리스트)·git pre-commit(hard)·`sdd-init` 자동배선 · "채택=상시 강제 궤도" 원칙 · 사용법(`APPLYING`·`방법론.html`). (`cc3dc22..acf5b6f`, 설계 `specs/2026-07-01-…`, 계획 `plans/2026-07-01-methodology-…`)
- **spec-first 강제** — `Files:` 소유매핑 · `check-spec-sync`(changeset=브랜치, commit-msg hard + range advisory) · `/speckit.fix` · Edge Cases/Change Log 필수화 · 사용법·데모 실측(`APPLYING`·`방법론.html`·`README`). (`74a747b..acf5b6f`, 설계 `specs/2026-07-02-spec-first-enforcement-design.md`, 계획 `plans/2026-07-02-spec-first-enforcement.md`)
- **키트 자기 정렬(self-hosting)** — 키트 `tooling/`(게이트 스위트, 73 tests) 자신을 자기 궤도에 편입: 루트 `sdd.config.json`(비-웹 카테고리 Modules/Symbols/Artifacts) · `sdd/specs/` 4-spec(1 aggregate씩, 14개 tooling 파일 전부 소유) · `@covers` 28/33 태깅(미커버 5는 실제 테스트 갭 — incremental 점진) · `self-hooks-install.sh`로 자기 훅 배선(tooling 직접 호출). **실증**: 스펙 미동반 tooling 커밋 → commit-msg FAIL(exit 1), `Spec-Impact: none <사유>` → 통과. (설계·계획 `2026-07-02-kit-self-alignment.md`)

- **런타임 패리티(2026-07-05)** — Python판 전 게이트 패리티(같은 픽스처→같은 exit code·바이트 동일 출력, 테스트 강제) · `requirementIdPrefixes` 전 사이트 파생 · preset 템플릿 바이트 동일화 · 셸/Go 문법 정렬. (SPEC-006)
- **강제 강도 고도화 2차(2026-07-05)** — 진단(spec-first=동반변경 확인, 의미중복 반례, 스펙 리뷰 계층 부재)의 승인 보강 전부 반영:
  - **B-3 검증 회계(SPEC-007)**: `strictSpecs`(전역 --strict 점진 브리지) · `requireAccounting`(R3: 전 FR이 unit∨smoke∨deferred) · `smokeManifest`(사유 존재만 강제) — 키트 자신 requireAccounting 상시 on(미커버 5 FR은 deferred로 정직 회계).
  - **P1 스펙 수명주기(SPEC-008)**: Status enum 문법화 · Draft 소유 코드 commit-msg 차단 · Reviewed 이상 `Review Log` 기록 존재 검사 — 상태 순서 강제(시간 순서 아님), 레거시(Status 없음)는 warn(advisory→strict 승격 경로).
  - **P2 미소유 파일 정책**: `specSyncUnownedPolicy`(silent|warn|error) — 침묵 통과를 선언된 정책으로 승격(exempt 조합 탈출).
  - **P3 의미중복 절차 문법화**: `entityRegistry`(entity 등록제 — PREFIX 거버넌스 동형) + `## Dedup-Review` 기록 의무화(존재·형식만 — DEDUP.md 경계 유지).
  - 부수 발견 수정: git `core.quotepath` 비ASCII 경로 인용이 glob 매칭을 조용히 깨던 버그(도그푸딩 발견, 회귀 테스트).

설계·계획 근거: `docs/superpowers/specs/` · `docs/superpowers/plans/`.

> **키트는 이제 자기 자신의 첫 소비자다.** 게이트가 키트 자신의 tooling 변경을 상시 강제하고(자기 훅), 자기 커버리지 갭(미커버 5 FR)까지 정직하게 드러낸다 — 지속적 도그푸딩.

## 🔜 보류 (트리거가 오면 착수)
| 항목 | 착수 트리거 |
|---|---|
| **Phase 2 — MSA 계약 프로파일** (계약 산출물 · `SYSTEM_MAP` · 계약 테스트 · consumer 버전 핀) | 실재하는 **다중-모듈 시스템**이 등장할 때 |
| 하네스: 연속/스케줄 트리거 | on-demand `/sdd-sync` + pre-push 훅으로 **부족하다고 드러날 때** |
| 하네스: 타 에이전트 실행기 | Claude Code 외 에이전트를 **실제로 쓸 때** (계약 `HARNESS.md`는 이미 런타임 중립) |
| 하네스: R3 임베딩 의미리뷰 | reworded(의미적) 중복이 **실제 고통이 될 때** (현재는 같은 Entity 이웃 LLM 리뷰로 충분) |
| 강화·cohesion·하네스 게이트의 **Go·셸** 포팅 + 셸/Go ownership 키 정규화·형식검증 | Python도 Node도 없는 프로젝트가 그 게이트를 강제해야 할 때 (**Python 포팅은 2026-07-05 완료** — 전 게이트 패리티, SPEC-006 · `ci-examples.md` 매트릭스) |
| Go판 실행 패리티 재검증(2026-07-05 문법 정렬분) | Go 툴체인이 있는 CI에서 — 현재는 소스 계약 테스트만(`runtime-contract.test.mjs`, REALITY_CHECK 미확인 라벨) |

## 🔬 권장 다음 단계 (아직 미착수)
- **소비 프로젝트 정본 갱신 반영**: PM(gsn-ai-pm-management-tool)·FinOps(gsn-aiops-finops-module)에 이번 고도화(수명주기·회계·정책)를 재채택 절차로 반영 — 이번 작업 범위 밖(다음 단계).
- **도그푸딩**: 방법론을 실제 모듈(예: finops)에 끝까지 돌려 전 사슬(spec→test→code→게이트→하네스)을 검증 → 위 보류 항목 중 *실제로* 필요한 것을 추측이 아니라 사례로 식별.

## 🚫 의도적 비목표
- **P4 시간 순서(temporal) 강제** — "spec 커밋이 코드 커밋보다 먼저"는 만들지 않는다. 파이프라인은 **같은 changeset 동반**과 **상태 순서**(Draft면 코드 금지)를 강제하며, 이는 브랜치 단위 작업 설계와 충돌하지 않는 의도된 선택이다.
