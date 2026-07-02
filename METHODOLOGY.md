# 방법론 — Spec Kit + EARS + Superpowers (범용)

## 이 방법론은 "채택하면 벗어날 수 없는 궤도"다

이 방법론을 채택한 프로젝트는 채택(`sdd-init`) 순간부터 **`spec→code→test→sync` 궤도를 상시 강제**받는다. 이탈(문서 없는 코드, 임의 PREFIX, 미대조 스펙)은 **hook·게이트가 감지해 궤도로 되돌린다.** 방법론은 *읽는 문서*가 아니라 *벗어날 수 없는 궤도*다 — 그 강제 장치가 게이트(검증 시점 차단)와 hook 세트(세션·편집 시점 상기, `HARNESS.md`)다.

## 3축 역할
| 축 | 도구 | 담당 |
|---|---|---|
| 골격 | **GitHub Spec Kit** | `specify→plan→tasks` + 리뷰 게이트(`/analyze·/checklist·/clarify·/constitution`). "스펙의 옳음" |
| 요구사항 | **EARS** | FR을 5패턴 정형 요구로(아래). "한 요구=한 동작=검증가능" |
| 구현·검증 | **Superpowers** | TDD(RED→GREEN)·완료전검증·코드리뷰. "코드의 옳음". `/implement` 미사용 |

**왜 한 골격으로 묶나 — 셋은 서로의 구멍을 메운다.** 따로 쓰면 각자 한 부분만 잘하고 구멍이 남는다: **Spec Kit**은 spec을 *관리*하지만 FR이 모호해도 못 막고 코드가 맞는지 검증 안 한다. **EARS**는 요구를 *검증 가능*하게 만들지만 문장 형식일 뿐 — 관리도 검증도 못 한다. **Superpowers**는 코드를 *검증*하지만 "무엇이 명세인가·중복인가"를 모른다. 셋을 묶어야 **무엇을(EARS로 정밀히) → 관리(Spec Kit) → 검증(Superpowers)** 사슬이 닫힌다 — 하나라도 빠지면 끊긴다(EARS 없으면 FR 모호→테스트로 못 묶음, Spec Kit 없으면 명세 흩어짐, Superpowers 없으면 코드 미검증→명세가 희망사항). 4번째 기둥(범용성)이 이 골격을 어디서나 같게 돌린다.

**검증 분담:** **FR**은 이 키트의 게이트(`@covers`·dedup·cohesion·completeness)가 추적·강제하고, **인수조건·SC**는 Spec Kit 네이티브(`/analyze`·`/checklist`·`/tasks`)가 담당한다. `check-spec-completeness`는 "FR 있는 spec에 SC·인수조건이 *존재*하는가"만 advisory로 지킨다 — SC **충족**은 런타임 지표라 빌드 게이트가 강제할 수 없다(과장 금지).

왜 OpenSpec 아닌 Spec Kit: **에이전트 비종속(30+) + 리뷰 게이트 내장 + Superpowers 결합**(코드검증 레이어). "sync가 더 좋아서"가 아님(그 축이면 OpenSpec이 유리). → `SSOT.md`.

## 4번째 기둥 — 범용성(Portability): 6축 무관
> 3축이 *무엇을 하는가*라면, 범용성은 *어디서나 같게 동작한다*는 보장이다. **방법론의 어떤 부분도 특정 언어·런타임·모델·미들웨어·클라우드·CI에 박히지 않는다.** 강제 게이트는 모두 실행으로 검증됨(`REALITY_CHECK.md`). 단일 기준점: `principles.md` §10.

| 축 | 무관 보장 | 어떻게 (메커니즘) |
|---|---|---|
| **언어** | Python·Go·Rust·Java·… 무엇이든 | `sdd.config.json` 어댑터 1장(`testFileRegex`·`scanDirs`·`commands`·`ownershipCategories`·`specIdPrefixes`). 프리셋: `tooling/sdd.config.presets.md`. `@covers` 주석 스타일 무관(`//`·`#`·`--`) |
| **런타임(게이트 실행)** | 인터프리터 강요 없음 | 게이트 4판 동작 동일 — **Go 단일 정적 바이너리**(만능, 인터프리터 0)·셸(`sh+grep+awk+jq`)·Python·Node. 가진 쪽 사용 |
| **모델/에이전트** | 어떤 LLM이든 | 방법론에 벤더 가정 0. Spec Kit 30+ 에이전트 비종속, 게이트는 모델 독립적으로 강제. 슬래시명령은 편의, 핵심 규율은 어떤 에이전트로도 수행 가능 |
| **DB/미들웨어** | RDB·NoSQL·Redis·Kafka·검색·스토리지… | spec은 *역량/요구*만 적고 *제품* 금지("이벤트 로그 필요" O / "Kafka" X). 구조 SSOT 위치만 다름(`STRUCTURE.md`) |
| **CSP** | AWS·GCP·Azure·온프렘 | drift 검증 *원리* 동일, *명령*만 환경 것(`SSOT.md` §5b) |
| **CI/CD 도구** | 특정 CI/CD 도구 불필요 | 게이트는 CLI — 로컬·git훅·`make`·어떤 CI/CD 도구든. 샘플·도구별 동일 명령: `tooling/ci-examples.md`. **Spec Kit(spec 작성) ≠ CI/CD 도구(게이트 실행)** |

**한 규칙으로 압축:** *무엇을/왜*(spec·FR)만 방법론이 규정하고, *무엇으로*(언어·DB·클라우드·CI 제품)는 전부 프로젝트 결정으로 남긴다. 새 언어·새 스택이 와도 게이트를 새로 짜지 않고 `sdd.config.json`만 맞춘다.

## EARS 5패턴
| 패턴 | 틀 |
|---|---|
| Ubiquitous | `THE SYSTEM SHALL <응답>.` |
| Event | `WHEN <트리거>, THE SYSTEM SHALL <응답>.` |
| State | `WHILE <상태>, THE SYSTEM SHALL <응답>.` |
| Unwanted | `IF <비정상>, THEN THE SYSTEM SHALL <응답>.` |
| Optional | `WHERE <옵션 포함 시>, THE SYSTEM SHALL <응답>.` |
| Complex | `WHILE <상태>, WHEN <트리거>, THE SYSTEM SHALL …` |
금지: should/가능하면/적절히, 한 문장 2동작(and), 측정불가. 모르는 값 → `[NEEDS CLARIFICATION: …]`(창작 금지). **EARS는 FR 절에만 적용** — spec의 다른 절은 각자 형식: Story=서술 · 수용기준=GWT · SC=측정형 숫자 · NFR=측정 기준 · Ownership=소유 키. (코드와 `@covers`로 묶이는 추적 단위는 **FR뿐**.)

### EARS FR → Ownership 키 생성 결정 절차

EARS 문장으로 쓴 FR은 구체적인 Ownership 키로 이어진다. 아래 절차를 밟으면 사람이든 LLM이든 같은 문자열이 나온다.

**Capability 키 — 예: "직원을 추천한다" (FR: WHEN 요청, THE SYSTEM SHALL recommend a staff member)**
1. 핵심 Entity 식별 → `staff` (능력의 대상. 스키마/타입명 그대로, 소문자)
2. 핵심 동작 1개 추출 → "추천"
3. 허용 verb 집합에 매핑 → `recommend`
4. 조립 → `staff.recommend` (entity.verb, 점 1개)
5. verb가 집합에 없으면 → **STOP**. config `capabilityVerbs`에 등록(리뷰) 후 진행. 임의 동의어 우회 금지.

(단, entity는 능력의 *대상* — Ownership.Entities가 아니라 Dependencies의 entity여도 무방. 능력은 내가 소유하되 대상 데이터는 참조일 수 있다.)

**Surface 키 — 예: route `POST /api/Recommend/:id`**
1. 메서드 대문자 → `POST`
2. path 소문자 → `/api/recommend/:id`
3. path param 표준형 → `/api/recommend/{id}`
4. trailing slash 제거 → `POST /api/recommend/{id}`

**Entity 키 — 예: 테이블 `pjt_projects`**
1. 스키마 식별자 그대로 → `pjt_projects`
2. trim + 소문자 → `pjt_projects`  (단복수·표기 임의변경 금지)

**verb 집합:**
- **CRUD 기본 (코드 고정)**: `create · read · update · delete · list`
- **도메인 verb (config)**: `sdd.config.json`의 `capabilityVerbs`에 등록(예: `recommend`, `assign`). 신규 verb 추가 = config 변경 = 리뷰 관문. 미등록 verb = 형식 위반.

**Spec Kit 기본 골조 vs 우리가 덧댄 것:** User Story·Acceptance(GWT)·FR·Key Entities·SC는 **Spec Kit 기본**(`/speckit.specify`가 생성). 이 방법론은 그 위에 **① `## Ownership` + `## Dependencies` 절을 추가**(dedup·cohesion 게이트의 입력 — Spec Kit 네이티브 아님) **② FR을 EARS로 정형화**(preset, 비공식 #1356) **③ 위 키 생성 절차로 Ownership 키를 결정론적으로 도출**한다. NFR(비기능=품질 제약: 성능·보안·가용성)·Infrastructure Prerequisites는 우리 템플릿이 명시. ← FR이 "기능", NFR이 "그 기능이 어떤 품질로 도는가", SC가 "성공했다고 볼 측정 결과".

## 0~8 루프
> **단위 = 1 레포 = 1 모듈.** 이 루프는 한 모듈(레포) 안에서 돈다. 큰 프로그램은 여러 모듈-레포의 **MSA 합성**이며, 모듈 간 계약은 다중 모듈일 때 켜는 **MSA 계약 프로파일**이 강제한다(`STRUCTURE.md`).

| 단계 | 담당 | 행위 | 게이트 |
|---|---|---|---|
| 0 프리셋 | 👤1회 | EARS 형식을 Spec Kit preset에 고정 | preset이 EARS 템플릿 반환 |
| 1 specify | 👤→🤖 | `/speckit.specify` 자연어→spec | FR이 EARS 준수+빈칸 명시 |
| 2 clarify | 🔀 | `/speckit.clarify` 빈칸 해소 | 핵심 빈칸 해소/보류 |
| 3 plan | 👤→🤖 | `/speckit.plan` | FR↔컴포넌트 매핑 |
| 4 tasks | 👤→🤖 | `/speckit.tasks` 2~5분 TDD 분해 | 수용기준이 ≥1 task |
| 5 일관성 | 🤖 | `/speckit.analyze`+`/checklist` | 누락·모순·중복 0 |
| 6 구현·검증 | 🤖+👤 | Superpowers TDD→완료전검증→리뷰 | 전 테스트 GREEN+리뷰 |
| 7 머지 | 👤 | PR 리뷰·머지 | 사람 승인 |
| 8 converge | 🔀 | `/speckit.converge` 드리프트→task | 동기화 |

> **버그픽스는 `/speckit.fix`(§7):** 이 0~8 루프는 신기능 중심이라 버그픽스 경로가 명시적이지 않다. 버그픽스는 `/speckit.fix`를 거쳐 소유 스펙의 Edge Case·Change Log에 착지시킨다 — check-spec-sync 통과의 정공법이며 spec이 버그를 누적하는 살아있는 문서가 된다.

## spec ⇄ code 동기화 — 정확판
converge는 **갭을 task로 표면화만** 한다(spec 자동 재작성 ✗). 양방향 다 **작성=LLM, 승인=사람**:
- **top-down(spec→code):** 사람이 spec 작성 → `/converge`가 미구현 갭을 task로 → implement.
- **bottom-up(code→spec, hotfix 후):** `/converge`가 갭을 task로 → **사람이 'intent 한 줄'(이 hotfix가 무슨 기능·왜)을 입력** → **`/specify`(update)로 LLM이 `코드 diff + intent`로 spec 작성**(코드만 보고 추측 X → top-down과 동일 입력 품질) → `/analyze` 중복·정합 검사 → **사람은 "정본화(bless) vs 되돌리기(revert)" 승인만.**
- 하지 말 것: 사람 승인 없이 코드→spec 자동 덮어쓰기(=spec이 코드의 거울로 전락, drift 탐지 무의미).

**check-spec-sync(commit-msg hard):** 소유 spec의 `Files:` glob에 매치되는 코드 변경은 commit-msg 훅이 동일 changeset(브랜치) 안에서 해당 스펙의 FR·Edge Case·Change Log 실제 변경을 강제한다(staged 모드 = hard exit 1). range 모드(인자 없음 기본값)는 advisory — `sdd-sync`(CI/pre-push)에 배선한다. Files 미선언 스펙은 check-spec-sync 대상이 아니며 check-converge-drift(전역 advisory)가 백업 그물.

## 출처·확증
이 문서의 핵심 주장(converge=갭을 task로 추가만/자동 재작성 X, specify=생성+갱신, EARS 비공식·#1356, EARS 5패턴 Rolls-Royce IEEE RE'09, OpenSpec specs/changes, Superpowers TDD·완료전검증)은 공식 출처로 확증됨 → `SOURCES.md`. 보강: EARS 저자=Mavin·Wilkinson·Harwood·Novak(공저), Superpowers 창작자=Jesse Vincent(obra)·Anthropic 공식 마켓(2026-01).
