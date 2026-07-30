# 스펙 간 중복 — 2계층 차단 (결정 기록)

> 방법론 최대 빈칸은 "각 spec이 서로 중복인지 판정하는 규칙"이 없다는 것이었다. 키트는 이를 **사람/LLM 판단**에 맡겨 두고 있었다(누락 위험). 이를 **2계층**(구조적 게이트 + 의미적 리뷰)으로 메운다. 시각 설계 동반물(역할 기반 5분류·애니메이션): [`docs/ownership-key.html`](docs/ownership-key.html).

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

**규칙(판정):** 각 spec은 `## Ownership` 블록에 자신이 **유일하게 소유(권위를 가진)** 키를 선언한다 — **Entity**(도메인 객체/테이블)·**Surface**(route·화면·job)·**Capability**(Entity×Action). **하나의 키는 정확히 한 spec만 소유.** 2개 이상이 같은 키 선언 = **구조적 중복**. (애매한 판단이 아니라 집합 멤버십 조회.)

**소유 vs 참조 분리:** 이 spec이 읽기/호출만 하는 다른 aggregate의 키는 `## Dependencies` 섹션으로 분리한다. `check-ownership`은 `## Ownership`만 dedup 대상으로 읽고 `## Dependencies`는 제외한다 → 참조를 소유로 오인하던 **거짓양성이 코드 변경 거의 없이 해소**. 하위호환: 기존 `## Ownership`은 그대로 "소유"로 해석. `## Dependencies` 없으면 참조 없음.

```
## Ownership   ← 소유(권위). dedup 대상. 정규화·형식 검증 적용.
- **Entities**: pjt_projects, pjt_project_staff       # 도메인 객체/테이블(스키마 식별자 그대로)
- **Surfaces**: POST /api/pjt/recommend, /tools/pjt/new # route·화면·job(METHOD 대문자·path 소문자·{param})
- **Capabilities**: pjt_projects.create, pjt_project_staff.assign  # entity.verb — entity 조각은 위 소유 Entities와 일치(SPEC-024)

## Dependencies   ← 참조(읽기/호출만). dedup 제외. 같은 정규화 표기 권장(게이트 형식검증 대상 아님).
- **Entities**: staff, invoice (has-many)   # 자유참조 + 구조화 관계 `Entity (relation-type)`(SPEC-017)
- **Surfaces**: GET /api/staff/{id}
```

**소유 키는 하나(aggregate root), 종속 키는 관계로.** 한 spec은 이상적으로 **하나의 aggregate root**(독립적으로 생성·삭제되는 핵심 Entity)를 소유하고, 그 root가 참조·종속하는 다른 aggregate의 키는 **소유로 세지 말고 `## Dependencies`에 `EntityName (relation-type)` 구조화 표기**로 넣는다(SPEC-017). 그러면 (a) 소유 키 카운트가 부풀지 않아 cohesion의 "여러 aggregate 삼킴"(`Ownership.Entities`가 `maxAggregateRootsPerSpec`(config, 기본 1) 초과) 오탐이 사라지고, (b) 게이트가 그 관계를 검증한다 — 대상 Entity를 소유한 spec을 전체 spec에서 **자동 해석**해 없으면 **exit 1**(오타·삭제·미작성 차단, hard), aggregate 간 **순환 참조는 advisory**(SPEC-017 배선: `check-ownership`이 소비, Node·Python 패리티). 즉 **"원래 한 aggregate인데 종속 엔티티가 많아 키가 과다하던"** 경우는 *root 1개만 소유 + 나머지는 종속관계로* 표현해 해소한다. relation-type은 소문자 kebab 1토큰(`has-many`·`belongs-to`·`references` 등), 괄호 없는 항목은 레거시 자유참조로 그대로 통과(구조화는 opt-in), `relationTypes` config로 어휘를 제한할 수 있다(`capabilityVerbs` 거버넌스 동형).

**정규화 절대규칙 (결정성의 심장):**
- **Entity**: 스키마·모델·마이그레이션의 테이블/타입명 식별자 그대로 + `trim().toLowerCase()`. 단복수 임의변환 금지(스키마가 진실). **entity 레지스트리(`entityRegistry`, 선택):** config에 `{ "<entity>": "<도입 사유>" }`로 채우면 Ownership의 aggregate-root 카테고리 키는 **등록된 것만** 허용된다(미등록 exit 1, 빈 사유 exit 1) — capabilityVerbs·PREFIX 거버넌스와 동형 패턴: **신규 entity 신설 = config 변경 = 리뷰 관문.** 말만 바꾼 유사 entity의 무단 증식을 어휘 수준에서 차단한다(비어 있으면 비활성 = 현행).
- **Surface**: `<METHOD> <path>` — METHOD 대문자, path 소문자, path param `{name}` 표준형(`:id`·`<id>` → `{id}`), trailing slash 제거. 이벤트=`event:<name>`, job=`job:<name>`.
- **Capability**: `<entity>.<verb>` — 점 정확히 1개, 소문자, verb ∈ CRUD 기본(`create·read·update·delete·list`) + config `capabilityVerbs` 등록 verb만. 미등록 verb = 형식 위반. 임의 동의어 금지. **강도(정직):** 형식 위반(점 개수·미등록 verb·Surface 형식)은 `validateKey`가 잡지만 **기본은 ⚠ warn·exit 0**이고 `check-ownership --strict`에서만 exit 1이다 — 설치 훅·CI 기본 호출엔 `--strict`가 없다(`tooling/harness/pre-commit`). 즉 오늘의 실효 관문은 게이트 차단이 아니라 **config 리뷰**다. **권장 종착지는 hard**(`--strict` 없이도 미등록 verb 차단) — 그때까지는 어휘를 닫아두려면 `--strict`를 CI에 배선하라.

**라우팅 결정트리(새 요구 → 새 spec? 개정?):**
1. 새 요구의 키 산출: 어떤 Entity / Surface / Capability인가.
2. 그 키를 이미 소유한 spec이 있나? (`MODULE_MAP` 레지스트리 / `check-ownership` 조회)
   - **있음 → 그 spec 개정(새 spec 금지).** 없지만 같은 범위 → owner 개정. 완전 새 범위 → 새 spec + Owns 등록.

**`Files:` 필드는 dedup 대상이 아니다:** `## Ownership`의 `Files:` 필드는 `check-spec-sync` 전용 파일→스펙 매핑 입력이며, 소유권 유일성 게이트(`check-ownership`)의 dedup 대상이 아니다. `sdd.config.json`의 `ownershipCategories`에 `Files`를 추가하면 dedup·cohesion 키 카운트에 glob 문자열이 유입되고 `validateKey`가 형식 위반으로 오판한다 — **`ownershipCategories`에 `Files` 추가 금지**(ownership 게이트가 config 검증으로 exit 1, 대소문자 무관 — SPEC-013).

**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 키별 소유 spec이 1개인지 CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. **왜 모든 spec이 선언해야 하나(=필수):** 미선언 spec은 dedup 레이더 밖이라 그 spec의 중복이 안 걸린다 — 미선언 1개 = 보장에 뚫린 구멍. 보장은 *선언된 집합만큼만* 완전하다(SC·NFR 누락은 로컬 약점이지만 Ownership 누락은 cross-spec 보장을 깬다). **유일성 범위 = 이 레포(=한 모듈)의 전 spec** — 모듈 간(레포 간)은 MSA 계약 경계로 분리되어 dedup 대상이 아니다(`STRUCTURE.md` 1 레포=1 모듈). **거울상(`check-spec-cohesion`):** dedup이 "2 spec이 같은 키"(과편화)를 막는다면, cohesion 게이트는 "1 spec이 키/FR 과다"(under-fragmentation = 한 spec에 여러 기능 욱여넣기)를 advisory로 잡아 분할을 권고한다.
> **게이트 표기 규약:** 이 문서는 Node 파일명(`check-ownership.mjs`)으로 적지만, 게이트는 **언어·런타임 무관 4판 동봉**(Go 바이너리 `sdd-gate ownership`·셸 `sdd_gates.sh`·Python `sdd_gates.py`·Node — `principles.md` §10). dedup(키 유일성) 판정은 4판 동일하고, **키 정규화·형식검증(normalizeKey/validateKey)은 Node·Python판**이 수행한다(커버 매트릭스: `tooling/ci-examples.md`). 키 종류(Entity/Surface/Capability)도 웹 기본일 뿐 `sdd.config.json`의 `ownershipCategories`로 교체한다(비-웹: `Modules·Symbols·Artifacts` 등).

**설계 출처:** 논문이 아니라 **소프트웨어공학 1차 원칙** — DDD *bounded context*(한 능력은 한 곳이 소유) · Single Source of Truth(진실은 한 곳) · 집합 유일성.

## 3.5 소유권 키 모델 — 역할(role) 기반 5분류와 불변식 (2026-07 감사 #21 반영)

> Ownership-key 감사(`docs/ownership-taxonomy-audit.md`)가 3분류(Entity/Surface/Capability)의 구멍을 실측으로 드러냈다 — 게이트 활성이 카테고리 **이름**에 걸려 개명 한 줄로 무음화되고, entity 없이 Surface/Capability만 번들되며, 순수 엔진·이벤트가 어느 칸에도 안 맞아 유령 entity·`job:` 개명으로 우회됐다. 아래가 그 봉합의 현행 모델이다.

**① 이름이 아니라 역할(role)로 판정한다.** 카테고리 이름은 프로젝트가 자유롭게 쓰되(웹: `Entities/Surfaces/Capabilities`, 킷: `Modules/Symbols/Artifacts`, 파이프라인: `Datasets/…`), config `ownershipCategoryRoles`로 **역할을 선언**한다 — 예 `{ "Modules": "entity", "Symbols": "surface" }`. 방법론 판정은 전부 이 **역할**에 걸린다(SPEC-001 FR-010). 그래서 (a) 이름을 `Entities→Aggregates`로 바꿔도 판정이 살아 있고(감사 A-1: 개명으로 hard가 무음 사망하던 자리), (b) 킷 자신(Modules)도 규칙을 자기에게 적용한다(도그푸딩 공백 해소). 미선언 역할은 entity/surface/capability만 이름 정규식 폴백(하위호환).

**② 다섯 역할과 각 역할의 실재·귀속 불변식** — 모든 소유 키는 "무슨 역할인지" + "그 역할의 SSOT로 뒷받침되는지"가 강제된다:

| 역할 | 키 형식 | 실재/귀속 불변식 | 근거 |
|---|---|---|---|
| **entity** (aggregate root) | 스키마 식별자 그대로 | 구조 SSOT(스키마·마이그레이션)에 **실재** + `entityRegistry` 등록 + **스펙당 최소 1개**(entity 없는 번들 금지) + `maxAggregateRootsPerSpec` 이하 | SPEC-026·SPEC-002 |
| **surface** (route·화면) | `<METHOD> <path>` 등 | 파일형 심볼은 소스 루트에 **정방향 실재**(orphan 역방향의 짝) | SPEC-029 |
| **capability** | `entity.verb` | verb의 entity 조각을 **그 스펙이 소유**해야 함(귀속). cohesion 캡은 **entity별**로 카운트(full-CRUD 거짓 분할 제거) | SPEC-024·SPEC-002 |
| **engine** (순수 로직) | 모듈 식별자 | 코드-모듈 SSOT(`enginesSources`)에 **실재**. capability 소유 금지(능력은 entity에 귀속) | SPEC-030 |
| **event** (신호·job) | `entity.event-name` | 발신 **entity에 귀속** + 이벤트 카탈로그(`eventCatalogSources`)에 **실재** | SPEC-030 |

engine·event는 **옵트인**(역할 선언 전용·이름 폴백 없음)이라 미선언 프로젝트는 무영향. `job:`/`event:`를 종전 Surface로 두던 프로젝트는 채택 시 Events 역할로 이관해 Surface를 동기 표면으로 좁힌다(그래듀에이션).

**③ "중복 없이·과분류 없이·예외 없이"의 실제 의미.** 세 목표는 각각 다른 장치가 담당한다:
- **중복 없이(구조적)** — dedup 유일성(§3, 역할·카테고리 내). *의미적*(동의어 `order`/`orders`) 중복은 결정적으로 못 잡으므로 계층 ③ 좁힌 리뷰 몫(정직한 한계 — §4·§6).
- **과분류 없이** — 유령 entity·억지 Surface·엔진 욱여넣기를 실재 불변식(entity 스키마 백킹·surface 실재·engine 코드-모듈·event 카탈로그)이 차단. E/S/C로 안 담기던 대상은 engine/event가 담아 **강요된 오분류**를 없앤다(전수성).
- **예외 없이** — 강도 knob은 **하향 불가**(단조 증가, SPEC-027 래칫 — 자기 자신 포함). 위반을 knob 내려 회피할 수 없다. 다만 `off`·`advisory`는 **마이그레이션 중 경유지**이고 종착지는 `hard`다 — 신규 채택은 hard로 태어나되, 기존 프로젝트의 소급 범람을 막으려 그래듀에이션(advisory→마이그레이션→hard)을 경유한다(범람 회피가 목적이지 예외가 아님). 면제(`entityRegistry`·`*ExemptKeys`·`policyRatchetExceptions`)는 **사유 필수 + 매 실행 부채로 표면화**되어 조용한 우회가 불가능하다.

**정직한 잔여 한계:** (a) 의미적(reworded) 중복은 여전히 확률적 리뷰 몫 — 결정적 게이트로 만들 수 없다. (b) 다부모(한 개념이 두 aggregate에 속함)는 relation 참조로 표현하며 단일 트리로 접지 않는다. (c) hard 전면 강제는 프로젝트별 그래듀에이션 속도에 달려 있다.

## 4. ③ 의미적 중복 — 게이트가 못 잡는 틈 (보조)

게이트는 "키가 같은" 중복만 막는다. **말만 바꾼 같은 요구(reworded)**는 못 잡는다. 100% 자동화는 불가하므로 두 가지로 보조한다:
- **같은 Entity 이웃 spec과만** LLM diff 리뷰(범위를 전체→이웃으로 축소).
- (선택) FR 임베딩 유사도.

**절차의 문법화(P3, SPEC-008 연동):** 판정은 여전히 사람/LLM 몫이지만, *검토했다는 사실*은 기계가 강제한다 — Reviewed 이상 스펙은 `## Dedup-Review` 섹션에 **검토한 이웃 스펙 ID + 판정**(이웃이 없으면 명시적 "이웃 없음")을 기록해야 하고, completeness 게이트가 그 **존재·형식만** 검사한다(내용의 질은 검사하지 않음 — 이 경계는 유지). 형식 검사에는 **참조 실재**가 포함된다 — 기록이 언급한 스펙 ID가 실재하지 않으면(오타·삭제 잔재) advisory로 표면화된다(SPEC-013; 삭제된 이웃의 이력은 "이웃 없음(삭제됨)" 등 ID 없는 서술로 갱신). Review Log(P1)와 한 리뷰 절차로 통합해 별도 마찰 없이 수행한다. 어휘 측면은 위 `entityRegistry`가 담당(등록 없는 entity로는 reworded 스펙을 만들 수 없다).

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
| `tooling/check-ownership.mjs` | 게이트 본체(+ `entityRegistry` 등록제 · Entity 관계 실재·순환 검사 — SPEC-017) |
| `tooling/relation-lib.mjs` · `sdd.config.json` `relationTypes` | Entity 관계 판정 코어(`Entity (relation-type)` 대상 실재 hard·aggregate 순환 advisory) · 관계 어휘 화이트리스트(SPEC-017) |
| `tooling/check-spec-cohesion.mjs` | 입도 거울상 — aggregate root 다수(삼킴)·**최소 하한(entity 없는 번들)**·capability **entity별** 캡 |
| `tooling/ownership-keys.mjs` `resolveCategoryRoles` · `sdd.config.json` `ownershipCategoryRoles` | 카테고리→역할(entity/surface/capability/engine/event) 선언·해석 — 판정이 이름이 아닌 역할에 걸림(SPEC-001 FR-010) |
| `tooling/capability-ownership-lib.mjs` | capability의 entity 귀속(entity.verb는 소유 entity 스펙만, SPEC-024) |
| `tooling/schema-backing-lib.mjs` | 소유 entity의 구조 SSOT 실재 대조(유령 entity 차단, SPEC-026) |
| `tooling/ownership-reality-lib.mjs` | surface 심볼의 소스 실재 정방향 판정(SPEC-029) |
| `tooling/engine-event-lib.mjs` · `tooling/check-engine-event.mjs` | engine 코드-모듈 실재 · event entity 귀속+카탈로그 실재(전수성 구멍 봉합, SPEC-030) |
| `tooling/policy-ratchet-lib.mjs` · `tooling/check-policy-ratchet.mjs` | 강제 강도 단조성(하향=회피 차단, 자기포함, SPEC-027) |
| `tooling/check-spec-completeness.mjs` | `## Dedup-Review` 기록 존재 검사(Reviewed 이상, SPEC-008) |
| `sdd.config.json` `entityRegistry` | entity 어휘 화이트리스트(entity→도입 사유) — 신설은 config 리뷰 관문 |
| `STRUCTURE.md` | 소유권 유일성 규칙 + 라우팅 결정트리 |
| `SPEC_REVIEW.md` | cross-spec 중복: 구조적=CI게이트 / 의미적=좁힌 리뷰 |
| `templates/module-spec.md` | `## Ownership` 블록 |
| `tooling/sdd-gates.yml` · `APPLYING.md` | `check:ownership` CI·스크립트 배선 |
| `docs/ownership-key.html` | 시각 설계 동반물(역할 기반 5분류·불변식·애니메이션) — `ownership-key-derivation.html`+`dedup-gate-design.html` 통합 |

> 관련: FR↔test 추적 게이트는 `SSOT.md` §4. 인프라 spec↔배포실제 drift는 `SSOT.md` §5b(중복론과 별개).
