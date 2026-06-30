# 설계 — Ownership 키 도출의 결정성 (소유/참조 분리 · 정규화 절대규칙 · PREFIX 거버넌스)

> Status: **Draft (검토 대기)** · Date: 2026-06-30
> 관련: [DEDUP.md](../../../DEDUP.md) · [STORAGE.md](../../../STORAGE.md) · [METHODOLOGY.md](../../../METHODOLOGY.md) · 게이트 `check-ownership`/`check-spec-cohesion`/`check-fr-coverage`/`check-orphan-surfaces` · [sdd-config.mjs](../../../tooling/sdd-config.mjs)
> 전제: Gap 1(1레포1모듈)·Gap 2(cohesion)·Gap 3(하네스) 완료. 이 설계는 dedup의 **입력(키)** 자체의 결정성을 메운다.

## 0. 요약

dedup 게이트는 "한 키 = 한 spec"을 결정적으로 **비교**하지만, 그 키가 **어떻게 만들어지는지**(추출·정규화)는 사람/LLM 판단에 맡겨져 있었다 — 즉 결정성을 *반만* 달성했다. 이 설계는 키의 생애 3관문 중 비어 있던 둘을 메운다:

```
spec/코드  ──①추출──▶  키 후보  ──②정규화──▶  표준 키  ──③비교──▶  충돌?
          (규칙 없음)            (공백·소문자만)         (결정적 ✅ 기존)
             ↑ 이 설계가 메움        ↑ 이 설계가 강화
```

핵심 결정: **키의 SSOT를 자연어 FR 산문이 아니라 코드의 구조적 식별자로 보고, 결정적 정규화·문법·verb집합·PREFIX화이트리스트를 "절대 규칙"으로 박아 게이트가 검증한다.** 사람이 규칙을 따라 만든 키 = LLM이 만든 키 = 동일. 추출 행위는 사람/LLM, 규칙과 검증은 절대적·언어중립.

## 1. 목표 / 비목표

**목표**
- 같은 개념 → 같은 키로 **수렴**(누가·언제 만들든 동일).
- 사람이 손으로도 규칙을 따라 **재현 가능**하게 키 생성(LLM 비의존).
- dedup의 거짓양성(참조를 소유로 오인)·거짓음성(표면 다른 같은 개념) 축소.
- spec PREFIX **난립·조용한 누락** 제거.

**비목표 (정직)**
- 코드에서 키를 **자동 추출**(언어별 파서) — 언어중립을 깨므로 안 함. 추출은 사람/LLM.
- 의미적(reworded) 중복 100% 탐지 — 자연어라 불가, advisory로만.
- SC 충족·과편화 하한의 게이트 강제 — 거짓경고 많아 규칙·리뷰로.

## 2. 결정 요약 (브레인스토밍 합의)

| # | 결정 | 선택 |
|---|---|---|
| 스코프 | 통합 — 소유/참조 + 도출규칙 + 일관성 | 강제력은 본성대로 |
| 결정성 근거 | 정규화 규칙 절대화 (언어중립) | vs 코드 자동추출(기각: 언어결합) |
| Capability verb | 고정 verb 집합 (config 등록) | CRUD 기본 + 도메인 verb |
| 소유/참조 표현 | 별도 섹션 `## Ownership` + `## Dependencies` | dedup 게이트 변경 최소 |
| PREFIX | 표준 `SPEC`/`INFRA`/`TEST` 화이트리스트 + 사유 관문 | 임의 생성 금지 |
| 과편화 | 키 입도 하한 규칙(FR 1:1) | 게이트 강제 안 함 |

## 3. 데이터 모델 — 소유(Ownership) vs 참조(Dependencies)

`## Ownership`의 의미를 "이 spec이 **권위(authority)를 가진** 키"로 좁히고, 단순 참조(읽기/호출)는 새 `## Dependencies`로 분리한다.

```
## Ownership          ← 소유(권위). dedup 대상. 정규화·형식 검증 적용.
- **Entities**: recommendation
- **Surfaces**: POST /api/recommend
- **Capabilities**: recommendation.create, staff.recommend

## Dependencies       ← 참조(읽기/호출만). dedup 제외. 같은 정규화·형식 검증.
- **Entities**: staff, project
- **Surfaces**: GET /api/staff/{id}
```

- dedup(`check-ownership`)은 `## Ownership`만 읽는다 → 참조를 소유로 오인하던 **거짓양성이 코드 변경 거의 없이 해소**.
- 하위호환: 기존 `## Ownership`은 그대로 "소유"로 해석. `## Dependencies` 없으면 참조 없음.
- DDD 정합: bounded context의 "소유 vs 의존"과 1:1.

## 4. 정규화 절대 규칙 (결정성의 심장)

일반 규칙은 **게이트 코드에 고정**(모든 프로젝트 동일), 도메인 가변부(verb집합·카테고리·path param 표기)만 **config**.

| 카테고리 | 출처 (SSOT) | 정규화 규칙 (결정적) | 예시 |
|---|---|---|---|
| **Entity** | 스키마·모델·마이그레이션의 테이블/타입명 | 식별자 **그대로** + `trim().toLowerCase()`. 단복수 임의변환 ✗(스키마가 진실) | `pjt_projects`, `recommendation` |
| **Surface** | route·이벤트·job 정의 | `<METHOD> <path>` — METHOD 대문자, path 소문자, path param `{name}` 표준형(`:id`·`<id>`→`{id}`), trailing slash 제거. 이벤트=`event:<name>`, job=`job:<name>` | `POST /api/recommend/{id}` |
| **Capability** | 공개 함수·핸들러 + Entity | `<entity>.<verb>` — 점 정확히 1개, 소문자, **verb ∈ 허용집합**. 미등록 verb·점표기 위반 = 형식 위반 | `recommendation.create`, `staff.recommend` |

### 4.1 Capability verb 집합

- **CRUD 기본 (코드 고정)**: `create` · `read` · `update` · `delete` · `list`.
- **도메인 verb (config)**: `capabilityVerbs`에 등록(예: `recommend`, `assign`). 신규 verb 추가 = config 변경 = **리뷰 관문**(`specIdPrefixes`·`ownershipCategories`와 같은 패턴).
- 미등록 verb = 형식 위반. **임의 동의어 금지**(recommend/suggest 같은 변종이 키를 분산시키지 않게).

### 4.2 키 생성 결정 절차 (사람=LLM 동일 결과)

규칙이 표 수준이면 해석 여지가 남으므로, **단계별 알고리즘**으로 박는다. 사람이든 LLM이든 이 절차를 밟으면 같은 문자열이 나온다.

```
Capability 키 — 예: "직원을 추천한다"
1. 핵심 Entity 식별 → staff  (능력의 대상. 스키마/타입명 그대로, 소문자)
2. 핵심 동작 1개 추출 → "추천"
3. 허용 verb 집합에 매핑 → recommend
4. 조립 → staff.recommend  (entity.verb, 점 1개)
5. verb가 집합에 없으면 → STOP. config capabilityVerbs에 등록(리뷰) 후 진행.
   임의 동의어로 우회 금지.
   (entity는 소유/참조 어느 쪽 Entity든 될 수 있다 — 능력은 내가 소유하되
    대상 데이터는 참조일 수 있음. 예: recommendation 소유 + staff 참조.)

Surface 키 — 예: route POST /api/Recommend/:id
1. 메서드 대문자 → POST
2. path 소문자 → /api/recommend/:id
3. path param 표준형 → /api/recommend/{id}
4. trailing slash 제거 → POST /api/recommend/{id}

Entity 키 — 예: 테이블 pjt_projects
1. 스키마 식별자 그대로 → pjt_projects
2. trim + 소문자 → pjt_projects   (단복수·표기 임의변경 금지)
```

### 4.3 과편화 하한 (키 입도)

- 원칙: **FR 1개 ↔ Capability 1개.** 보조 동작(조회·정렬·반환 등 한 동작의 구성요소)은 **키로 만들지 않는다.**
- EARS "한 문장 2동작 금지"가 이미 받쳐준다. `check-spec-cohesion`이 *상한*(키 과다), 이 규칙이 *하한*(과편화)을 맡아 짝.
- **게이트 강제 안 함** — 키가 적은 건 정상일 수 있어 하한 게이트는 거짓경고가 많다. 규칙·리뷰로만(정직).

## 5. spec PREFIX 거버넌스

### 5.1 표준 3종 (고정)

| 접두어 | 의미 |
|---|---|
| `SPEC` | 기능 명세 (기본) |
| `INFRA` | 인프라 prerequisite spec |
| `TEST` | 테스트 전용 spec |

`specIdPrefixes` 기본값을 `["SPEC"]` → `["SPEC","INFRA","TEST"]`로.

### 5.2 조용한 누락 제거

현재 `check-fr-coverage`는 등록 안 된 접두어 파일을 **조용히 `continue`(건너뜀)** 한다 — `FEAT-001.md`가 있어도 config에 `FEAT`가 없으면 그 spec의 FR이 통째로 누락된 채 거짓 green(PM솔루션 실측 사례). 이를 뒤집는다:

- 게이트는 `specDir`의 **모든** `^[A-Z]+-\d{3}.*\.md` 파일을 스캔.
- 접두어가 허용 집합 밖이면 **조용히 건너뛰지 않고 exit 1**.

### 5.3 사유 관문 (난립 억제)

표준 밖 접두어(FEAT 등)는 **사유 없이 추가 불가**:

```jsonc
"specIdPrefixes": ["SPEC","INFRA","TEST","FEAT"],
"prefixRationale": {
  "FEAT": "왜 SPEC으로 부족하고 FEAT이 따로 필요한지 — 빈 값이면 exit 1"
}
```

- 표준 밖 접두어인데 `prefixRationale`에 사유 없음/빈 값 → **exit 1**.
- 사유가 있으면 통과하되 config에 남아 **리뷰에 노출**.
- 한계(정직): 기계는 사유의 *존재*만 강제하지 *질*은 못 본다 — 질은 리뷰가 본다. 하지만 "설명 없는 추가"라는 가장 흔한 난립은 막힌다.
- PM솔루션 FEAT → `SPEC`으로 정리하거나 사유 기재해 정식 편입(그쪽 팀 결정).

## 6. 게이트 변경

### 6.1 `check-ownership` (강화)
- `## Ownership`만 dedup 대상, `## Dependencies` 제외.
- 정규화 강화: 카테고리별 결정적 정규화(§4) — Surface 경로 표준형, Capability `entity.verb`.
- 형식 검증: Capability 점표기·verb 집합 멤버십, Surface 메서드+경로 형식 위반.
- PREFIX 화이트리스트 + 조용한 누락 제거(§5.2).

### 6.2 `check-spec-consistency` (신규, advisory)
- 목적: FR↔Ownership 어긋남 탐지(둘이 따로 작성돼 어긋나는 것).
- **결정적 근사**(자연어 NLP 없이): 선언한 키의 핵심 토큰(entity·verb)이 spec 본문 어디에도 **0회 등장**하면 "근거 없는 키" 경고. grep 기반 → 결정적·싸고 advisory.
- 역방향("FR에 동작 있는데 capability 없음")은 자연어 의존 → **보류**(ROADMAP).

### 6.3 PREFIX 사유 검증
- `check-fr-coverage`(또는 공통 config 로더)에서 §5.2·§5.3 강제.

## 7. 강제력 (본성대로)

| 검증 | 강제 | 비고 |
|---|---|---|
| dedup(정규화 후 유일성) | **exit 1** | 기존 유지 |
| PREFIX 화이트리스트 밖 / 사유 없음 | **exit 1** | "임의 금지" |
| 형식 위반(verb/점표기/경로) | warn → `--strict` exit 1 | 기존 spec 정리 위한 점진 |
| 근거 없는 키(일관성) | warn (advisory) | 자연어 근사라 거짓경고 가능 |
| 과편화(키 입도 하한) | 규칙·리뷰만 | 게이트 강제 안 함 |

## 8. config 스키마 추가

```jsonc
{
  "specIdPrefixes": ["SPEC","INFRA","TEST"],   // 표준 고정(기본값 변경)
  "prefixRationale": {},                        // 표준 밖 접두어의 도입 사유(없으면 표준만 허용)
  "capabilityVerbs": [],                        // CRUD 기본에 더할 도메인 verb
  "surfacePathParam": "{name}"                  // path param 표준 표기(기본 {name})
}
```
- 전부 기본값 존재 → config 없으면 기존 동작 유지(하위호환).

## 9. 문서·HTML 반영

| 파일 | 반영 |
|---|---|
| `templates/module-spec.md` | `## Dependencies` 섹션 추가 · `## Ownership` 의미 명확화 · 키 생성 절차 주석 |
| `DEDUP.md` | 소유/참조 분리 · 정규화 절대규칙 · 거짓양성 해소 |
| `METHODOLOGY.md` | 키 생성 결정 절차(EARS→키) · verb 집합 |
| `STORAGE.md` | PREFIX 표준 3종 · 사유 관문 · 조용한 누락 제거 |
| `index.html` | **(a) 키 생성 결정 절차** 섹션 신설(정규화 규칙 + 단계별 알고리즘 + 예시) · **(b) spec PREFIX** 설명(표준 SPEC/INFRA/TEST + 사유 관문 + 조용한 누락) |
| `tooling/sdd.config.presets.md` | 언어별 `capabilityVerbs` 예시 |

## 10. 하위호환 · 점진 도입

- 기존 `## Ownership` = 소유로 그대로 해석. `## Dependencies` 옵션.
- 새 형식검증(verb/점표기/경로)은 기본 **warn**, `--strict`로 승격 — 기존 spec 정리 시간 확보.
- dedup·PREFIX 화이트리스트·사유 관문은 핵심이라 기존처럼 **강하게(exit 1)**.
- config 기본값으로 무설정 프로젝트는 기존과 동일.

## 11. 검증 계획 (TDD)

- `check-ownership`: Dependencies 제외 / 정규화 수렴(`Staff.Recommend`=`staff.recommend`) / 형식 위반(미등록 verb·점표기·경로) / dedup 충돌.
- PREFIX: 표준 밖 접두어 파일 = exit 1(조용한 누락 회귀 테스트) / 사유 있으면 통과 / 사유 빈 값 = exit 1.
- `check-spec-consistency`: 근거 없는 키 경고 / 근거 있으면 clean / advisory(exit 0) · `--strict` exit 1.
- 회귀: 기존 게이트 테스트 전체 GREEN 유지.

## 12. 보류 (ROADMAP 연결)

- 코드 자동 추출(언어별 어댑터) — 언어중립 깨므로 보류, 필요 증명 시.
- 일관성 역방향("키 없는 동작") — 자연어 의존, reworded 중복이 실제 고통이 될 때.
- 키 임베딩 유사도 — 기존 ROADMAP 보류 유지.
