# 스펙 간 중복 — 2계층 차단 (결정 기록)

> 방법론 최대 빈칸은 "각 spec이 서로 중복인지 판정하는 규칙"이 없다는 것이었다. 키트는 이를 **사람/LLM 판단**에 맡겨 두고 있었다(누락 위험). 이를 **2계층**(구조적 게이트 + 의미적 리뷰)으로 메운다. 시각 설계 동반물: [`dedup-gate-design.html`](dedup-gate-design.html).

## 1. 결론 (한 줄)
> **구조적 중복은 결정적 게이트(`check-ownership.mjs`)로 CI에서 강제, 의미적 중복은 좁힌 LLM 리뷰로 보조.** "LLM은 누락을 낸다 → 강제되는 결정적 게이트가 1차, 확률적 리뷰는 2차."

## 2. 중복은 한 덩어리가 아니다 (3구간)

| 구간 | 무엇을 잡나 | 도구 | 강제력 | 성격 |
|---|---|---|---|---|
| 한 기능 내부 | 같은 요구가 spec/plan/tasks에 중복 | `/speckit.analyze` | 자동(Spec Kit 내장) | 결정적 |
| **spec 간 — 구조적** | 두 spec이 같은 Entity/Surface/Capability 소유 | **`check-ownership.mjs`** | **CI 게이트(exit 1)** | 결정적·무누락 |
| **spec 간 — 의미적** | 키는 다른데 의도 같음(reworded) | 좁힌 LLM diff + (선택)임베딩 유사도 | 좁힌 리뷰 보조 | 확률적 |

`/speckit.analyze`는 **한 기능 내부만** 본다. spec이 늘 때 spec끼리 겹치는 문제는 아래 ②③이 메운다.

## 3. ② 구조적 중복 — 소유권 유일성 게이트 (만든 것)

**규칙(판정):** 각 spec은 `## Ownership` 블록에 자신이 **유일하게 소유하는 키**를 선언한다 — **Entity**(도메인 객체/테이블)·**Surface**(route·화면·job)·**Capability**(Entity×Action). **하나의 키는 정확히 한 spec만 소유.** 2개 이상이 같은 키 선언 = **구조적 중복**. (애매한 판단이 아니라 집합 멤버십 조회.)

```
## Ownership   ← spec마다 선언
- **Entities**: pjt_projects, pjt_project_staff       # 도메인 객체/테이블
- **Surfaces**: POST /api/pjt/recommend, /tools/pjt/new # route·화면·job
- **Capabilities**: project.create, staff.assign        # Entity×Action
```

**라우팅 결정트리(새 요구 → 새 spec? 개정?):**
1. 새 요구의 키 산출: 어떤 Entity / Surface / Capability인가.
2. 그 키를 이미 소유한 spec이 있나? (`MODULE_MAP` 레지스트리 / `check-ownership` 조회)
   - **있음 → 그 spec 개정(새 spec 금지).** 없지만 같은 범위 → owner 개정. 완전 새 범위 → 새 spec + Owns 등록.

**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 키별 소유 spec이 1개인지 CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. **왜 모든 spec이 선언해야 하나(=필수):** 미선언 spec은 dedup 레이더 밖이라 그 spec의 중복이 안 걸린다 — 미선언 1개 = 보장에 뚫린 구멍. 보장은 *선언된 집합만큼만* 완전하다(SC·NFR 누락은 로컬 약점이지만 Ownership 누락은 cross-spec 보장을 깬다). **유일성 범위 = 이 레포(=한 모듈)의 전 spec** — 모듈 간(레포 간)은 MSA 계약 경계로 분리되어 dedup 대상이 아니다(`STRUCTURE.md` 1 레포=1 모듈). **거울상(`check-spec-cohesion`):** dedup이 "2 spec이 같은 키"(과편화)를 막는다면, cohesion 게이트는 "1 spec이 키/FR 과다"(under-fragmentation = 한 spec에 여러 기능 욱여넣기)를 advisory로 잡아 분할을 권고한다.
> **게이트 표기 규약:** 이 문서는 Node 파일명(`check-ownership.mjs`)으로 적지만, 게이트는 **언어·런타임 무관 4판 동봉**(Go 바이너리 `sdd-gate ownership`·셸 `sdd_gates.sh`·Python `sdd_gates.py`·Node, 동작 동일 — `principles.md` §10). 키 종류(Entity/Surface/Capability)도 웹 기본일 뿐 `sdd.config.json`의 `ownershipCategories`로 교체한다(비-웹: `Modules·Symbols·Artifacts` 등).

**설계 출처:** 논문이 아니라 **소프트웨어공학 1차 원칙** — DDD *bounded context*(한 능력은 한 곳이 소유) · Single Source of Truth(진실은 한 곳) · 집합 유일성.

## 4. ③ 의미적 중복 — 게이트가 못 잡는 틈 (보조)

게이트는 "키가 같은" 중복만 막는다. **말만 바꾼 같은 요구(reworded)**는 못 잡는다. 100% 자동화는 불가하므로 두 가지로 보조한다:
- **같은 Entity 이웃 spec과만** LLM diff 리뷰(범위를 전체→이웃으로 축소).
- (선택) FR 임베딩 유사도.

**학술 근거:** Malik, Yildirim, Cevik, Bener, Parikh — *Transfer learning for conflict and duplicate detection in software requirement pairs*, [arXiv:2301.03709](https://arxiv.org/abs/2301.03709) (2023). 요구사항 "쌍 분류" 문제로 형식화, **SR-BERT**(Sentence-BERT + Bi-encoder)를 다단계 파인튜닝해 중복/충돌 탐지. 이 논문이 키트에 주는 것: (a) "말이 다른 같은 요구"는 실재하며 별도 기법이 필요하다는 근거, (b) 계층 ③의 참고 구현(문장쌍 임베딩 유사도/분류).

> **팀 가이드 — 논문과 게이트의 관계를 이렇게 이해하세요.**
> 소유권 게이트는 위 논문(arXiv 2301.03709)의 알고리즘을 옮긴 것이 **아닙니다.** 소프트웨어공학 1차 원칙(DDD *bounded context* · SSOT · 집합 유일성)에서 직접 설계했습니다. **이건 약점이 아니라 의도된 선택입니다** — 1차 원칙 기반이라 판정이 결정적이고, 그래서 CI에서 `exit 1`로 **강제**할 수 있습니다. (논문의 NLP·임베딩 방식은 확률적이라 임계값·오탐이 있어 빌드를 깨는 근거로 삼기 어렵습니다.)
> 논문은 **다른 문제 — 의미적(reworded) 중복**을 다룹니다. 우리는 두 가지로만 인용합니다: **①** 게이트가 못 잡는 의미적 중복이 실재한다는 **근거**, **②** 계층 ③(의미적 리뷰)을 만들 때의 **참고 구현**.
> **실무 지침:** 구조적 중복은 게이트가 자동으로 막으니 믿고 진행하세요. 의미적 중복만 같은 Entity를 소유한 이웃 spec과 좁혀서 리뷰하면 됩니다.

## 5. 검증 결과 (실행함 — 2026-06-29)
픽스처(spec 3개)로 `check-ownership.mjs`를 실제 실행해 확인. `[검증]`=실행함.

| 케이스 | 기대 | 결과 |
|---|---|---|
| 두 spec이 `pjt_projects` 공유 | exit 1 + 충돌 출력 | `[검증]` exit 1 — `[Entities] "pjt_projects" ← SPEC-001 + SPEC-002` |
| 중복 제거 후 | exit 0 | `[검증]` exit 0 — "모든 키 유일" |
| 미선언 spec(점진) | warn, exit 0 | `[검증]` `⚠ Ownership 블록 없음(1): SPEC-003`, exit 0 |
| `--strict` + 미선언 | exit 1 | `[검증]` exit 1 |
| `node --check` 문법 | 정상 | `[검증]` OK |

## 6. 2계층의 정직한 경계
- **구조적 중복**(같은 키) = `check-ownership` 게이트로 **기계적 차단**.
- **의미적 중복**(reworded) = 게이트가 못 잡음 → 같은 Entity 이웃 리뷰로 보조.
- 받아쓰는 드롭인 cross-spec 중복-탐지 툴은 업계에 없다(상용 Cosmos가 근접). 그래서 **결정적 게이트는 우리가 만들고**(이 스크립트), 의미적 100% 자동화는 포기 — 게이트(구조)+좁힌 리뷰(의미) 2계층으로 닫는다.

## 7. 키트 반영 위치
| 파일 | 내용 |
|---|---|
| `tooling/check-ownership.mjs` | 게이트 본체 |
| `STRUCTURE.md` | 소유권 유일성 규칙 + 라우팅 결정트리 |
| `SPEC_REVIEW.md` | cross-spec 중복: 구조적=CI게이트 / 의미적=좁힌 리뷰 |
| `templates/module-spec.md` | `## Ownership` 블록 |
| `tooling/sdd-gates.yml` · `APPLYING.md` | `check:ownership` CI·스크립트 배선 |
| `dedup-gate-design.html` | 시각 설계 동반물(근거·검증·다이어그램) |

> 관련: FR↔test 추적 게이트는 `SSOT.md` §4. 인프라 spec↔배포실제 drift는 `SSOT.md` §5b(중복론과 별개).
