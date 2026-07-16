# 구조 — module > spec (범용)

## 큰 틀 = 1 레포 = 1 모듈, 그 안에 spec
- **1 레포 = 1 모듈** (무조건). 레포 하나 = 안정적 bounded context 하나 = 그 능력 영역의 SSOT 홈. 모듈이 늘면 **레포가 는다**(한 레포에 여러 모듈을 넣지 않는다). 기계 신호: 전 스펙의 `Module` 헤더 값이 하나여야 하며, 갈라지면 `check-spec-completeness`가 advisory로 표면화한다(`--strict` 하드 — SPEC-013). "무엇이 한 모듈인가"의 판정 자체는 리뷰 경계(`METHODOLOGY.md`).
- **spec** = 그 모듈 안의 응집된 기능 단위. 각 spec = 그 기능의 **살아있는 기능명세서**. 한 모듈(레포)은 spec 다수를 가진다.
- **큰 프로그램 = 여러 모듈-레포의 MSA 합성** — 모듈 간은 공개 계약(API/이벤트)으로만 결합한다. 그 계약을 1급 SSOT로 강제하는 **MSA 계약 프로파일은 다중 모듈일 때 켜는 선택 계층**(Phase 2).
- **입도 — 양방향:** (a) 한 모듈(레포) 안 spec을 너무 잘게 쪼개면 중복 리뷰 폭발(과편화), (b) 반대로 **한 spec에 여러 기능을 욱여넣으면 추적·소유권이 무력화**(under-fragmentation). 기준은 **1 spec = 1 aggregate(핵심 Entity) — dedup이 경계 강제(`DEDUP.md` §3)**: 한 spec = 한 **aggregate root**(독립적으로 생성·삭제되는 핵심 Entity)를 소유 + 그 aggregate를 변경하는 Capability/Surface를 함께 소유. 다른 aggregate는 `## Dependencies`로 참조(읽기/호출만) — `EntityName (relation-type)`로 적으면 대상 실재·소유 spec을 게이트가 자동 해석하고 순환 참조를 advisory로 경고한다(구조화는 opt-in, SPEC-017). "응집 묶음"보다 훨씬 결정적인 경계 닻으로, dedup 게이트가 "1 Entity=1 spec" 판정을 사후 강제하고, cohesion 게이트가 Ownership.Entities가 `maxAggregateRootsPerSpec`(config, 기본 1)를 초과하면 "여러 aggregate 삼킴 의심"을 advisory로 신호한다(aggregate root + 그 자식 표를 한 spec이 함께 소유하는 모델이면 이 값을 상향). — 서로 다른 aggregate root를 여럿 소유하거나 독립 user story 여러 개에 걸치면 **aggregate별로 분할**한다. 그 모듈의 spec은 `MODULE_MAP.md`(단일 모듈 매니페스트)로 인덱싱.

## 핵심 구분: 모듈 명세서(누적) vs feature 델타(병합)
| | 정체 | 성격 |
|---|---|---|
| 모듈 명세서 | 그 모듈의 현재 전체 진실(SSOT) | 누적·중복제거·영속 |
| feature/변경 요청 | "기능 X 추가" 하나 (`/specify`가 만드는 것) | 델타·일시적 → 명세서에 병합 |

→ Spec Kit은 (b)feature 델타에 강하고, **모듈 레이어가 (a)누적 SSOT를 담당**한다. (OpenSpec의 specs/=진실 vs changes/=델타와 같은 모델.)

## 기능이 늘 때 중복 안 쌓이는 메커니즘 — 소유권 유일성 규칙 (강제)
> 방법론 최대 빈칸이 "중복인가?"를 **사람 판단**에 맡긴 것이었다. 이를 **조회+게이트**로 바꾼다. LLM 리뷰는 누락을 내므로 **결정적 게이트가 1차**, 리뷰는 보조. **정식 결정기록·근거·검증·2계층 모델: [`DEDUP.md`](DEDUP.md).**

**규칙(판정):** 각 spec은 `## Ownership` 블록에 소유 키를 선언한다. 키 종류는 `sdd.config.json`의 `ownershipCategories`가 정한다 — 웹/CRUD 기본은 **Entity**(도메인 객체/테이블)·**Surface**(route·화면·job)·**Capability**(Entity×Action). **비-웹 프로젝트는 바꿔 쓴다** — 라이브러리/CLI=`Modules·Symbols·Artifacts`, 데이터파이프라인=`Datasets·Jobs·Sinks`, IaC=`Resources·Surfaces·Capabilities`. 종류가 무엇이든 규칙은 동일: **하나의 키는 정확히 한 spec만 소유.** 2개 이상이 같은 키를 선언 = **구조적 중복**. (애매한 판단이 아니라 집합 조회로 결정.)

**라우팅 결정트리(새 요구 → 새 spec? 개정?):**
1. 새 요구의 키 산출: 어떤 Entity를 건드리나 / 어떤 Surface인가 / 어떤 Capability인가.
2. 그 키를 이미 소유한 spec이 있나? (`MODULE_MAP` 소유 레지스트리 / `check-ownership` 조회)
   - **있음 → 그 spec을 개정(새 spec 금지).**
   - 없지만 같은 Entity·Surface 범위 안 → 그 owner spec 개정.
   - 완전히 새 범위 → **새 spec 생성 + Owns 등록.**

**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 **키별 소유 spec이 1개인지** CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. (게이트는 Go 바이너리·셸·Python·Node 4판 동작 동일 — `principles.md` §10; CI는 provider 무관 — `ci-examples.md`.) **유일성 범위 = 이 레포(=한 모듈)의 전 spec.** 모듈 간(레포 간) 키는 MSA 계약 경계로 분리되므로 dedup 대상이 아니다(1 레포=1 모듈). **거울상:** 한 spec이 키/FR을 과다 소유하면(under-fragmentation) `check-spec-cohesion` advisory 게이트가 분할을 권고한다.

**2계층(정직):**
- **구조적 중복**(같은 키) = `check-ownership` 게이트로 **기계적 차단**.
- **의미적 중복**(키는 다른데 의도 같음) = 게이트가 못 잡음 → **같은 Entity 이웃 spec과만** LLM diff 리뷰(범위 전체→이웃으로 축소) + (선택) FR 임베딩 유사도. `/speckit.analyze`는 여전히 *한 기능 내부*만.

> 받아쓰는 드롭인 중복-탐지 툴킷은 업계에 없다(상용 Cosmos가 근접). 그래서 **결정적 게이트는 우리가 만든다**(이 스크립트). 의미적 중복까지 100% 자동화는 불가 — 그래서 게이트(구조)+좁힌 리뷰(의미) 2계층.

## 기능이 줄 때 — 폐기·삭제 수명주기 (REMOVED)
명세는 "현재 진실"이라야 하므로 **안 쓰는 spec은 삭제가 권장**(남기면 거짓 SSOT). 단 `rm`이 아니라 통제된 제거 — 추가의 반대, 동일 파이프라인.

상태: `Planned → Draft → Reviewed → Approved → Active → Deprecated(예고) → Removed` — 전체 enum과 게이트 강제(Draft 코드 차단·Reviewed 이상 리뷰 기록)는 SPEC-008·`METHODOLOGY.md` 수명주기 절. 이와 **직교하는 선택 필드 `Lifecycle: removable | permanent`(SPEC-008 FR-006)** 는 "삭제 예정 비제품 도구(`removable` — TEST 도메인 등)"와 "영속 제품(`permanent`)"을 기계가 구분한다 — 애초에 삭제 가능으로 표시된 스펙을 이 폐기 수명주기가 인지한다.

**세 가지를 혼동하지 말 것 — `deferred` ≠ `Planned` ≠ `Removed`(폐기):**
| 구분 | 뜻 | 회계 취급 | 신호 |
|---|---|---|---|
| **`deferred`** (FR 단위) | "할 건데 아직" — 개별 FR 백로그 | 회계에 **남아** reason으로 "잊지 마"라고 외침 | 미완성 명시(정상) |
| **`Planned`** (spec 전체 Status) | "아직 안 지음" — 스펙 전체가 미구현 | 0-coverage를 `planned`로 회계(R3 미검증 **아님**) | 의도된 미구현(노이즈 아님) |
| **`Removed`**(폐기, `sdd-retire`) | "필요 없어짐" — 지움 | 회계에서 **사라짐**(이력만 git) | 없음 — 정리 완료 |

원칙(owner): 불필요한 FR은 **delete**(미룸 아님) — `deferred`는 "할 건데 아직"에만 쓴다. 유령 명세(0/N Active)가 리포트 노이즈로 쌓이면 그건 `Planned`(안 지음)거나 `Removed`(폐기) 둘 중 하나여야지, Active인 채 방치가 아니다.

1. 사람이 제거 결정(spec-first) → `sdd-retire <SPEC-ID | SPEC-ID/FR-NNN>`(dry-run)로 **폐기 계획**(삭제 대상 + dangling `@covers` + 제거될 smoke 매니페스트 키 + 결과 번호 gap) 산출·검토(SPEC-018). 모듈 명세서에 **REMOVED 델타** 또는 spec `Status=Removed`.
2. `sdd-retire … --write`가 매니페스트·deferred 엔트리를 원자적 재sync + tasks 생성: "FR-NNN 코드·테스트 삭제". 폐기가 남긴 번호 gap은 `retiredIds`(config)에 기록하면 numbering 게이트가 "정상 retirement gap"으로 취급(사고성 결번과 구분, FR-006).
3. 구현이 **코드 + 테스트를 같은 PR로 원자적 삭제** → 검증(빌드 green, dangling 없음).
4. spec 파일 삭제 + `MODULE_MAP`/Change Log에 제거 기록. **git이 히스토리 보존**(graveyard 폴더 불필요).
5. 사람 승인.

**"spec 삭제 ⟹ 코드 삭제" — 방향은 맞지만 자동 아님(정직):**
- 코드는 spec의 파생물이라 spec에서 기능을 없애면 코드도 없어져야 한다. 그러나 `rm spec`이 코드를 자동 삭제하진 않는다 — 위 2~3(task→구현)으로 흐르고 **한 PR로 묶어 원자적**으로 한다.
- **강제되는 것:** spec/FR 삭제 시 그 FR을 `@covers`하던 테스트는 **dangling → FR 게이트 R1이 막아** 테스트 삭제를 강제.
- **강제 안 되는 틈:** "spec은 지웠는데 코드가 남은" 고아 코드는 FR↔test 게이트가 못 잡는다(spec↔test 매핑이라). → 제거 task 실행 + 리뷰 + (선택) dead-code/coverage 점검으로 닫는다.

## Files 소유 glob — 완전성·과광역 경고·INFRA 관행

**Files 완전성:** 각 spec의 `Files:` glob은 소유 코드를 **빠짐없이** 덮어야 한다 — API route(`src/app/api/<f>/**`)뿐 아니라 그 기능의 라이브러리(`src/lib/<f>/**`)까지. 라이브러리가 누락되면 그 파일은 check-spec-sync 레이더 밖에 놓여 코드 변경이 스펙 동반 없이 통과한다(pdf-parse 사례의 근본 원인). "이 glob이 이 기능의 코드 전부인가"는 자연어 판단이라 **규칙·리뷰**로 관리하되, 여집합은 기계로 닫을 수 있다 — `specSyncUnownedPolicy: "error"`(closed-world, SPEC-003)를 켜면 *어느 스펙도 소유하지 않는* 변경 파일이 staged에서 차단된다(의도적 예외는 `specSyncExemptGlobs` 선언). glob **문법**의 미지원 토큰(`{`·`?`·선두 `[`)은 매치 실패 = 소유가 조용히 풀리므로 staged에서 hard 차단된다(SPEC-013).

**과광역 glob 경고:** 여러 spec의 Files glob이 같은 파일을 덮으면(겹침) `check-spec-sync`가 **AND**로 동작 — 해당 파일 변경 시 *모든* 소유 스펙에 의미 있는 변경을 요구한다. 공유 유틸이 N개 스펙 편집을 강요하는 부담이 되므로 겹침은 최소화를 권장한다. 공유 코드는 별도 스펙(또는 미소유→converge-drift 소관)으로 두는 것이 좋다.

**INFRA 스펙 config 파일 소유 관행(권장):** 프로젝트 루트 config 파일(`next.config.ts`·`tsconfig.json`·`vite.config.ts` 등)은 특정 기능 스펙의 소유가 아니어서 check-spec-sync가 침묵한다(converge-drift advisory만). 이 사각지대를 닫으려면 **INFRA 스펙**(`INFRA-001` 등)에 `Files: next.config.ts, tsconfig.json, …`으로 등록하는 관행을 권장한다. 채택하지 않으면 config 파일 변경은 advisory 그물만 적용된다(과장 금지).

**만성 unowned 경고 — exempt인가 소유인가(사용 규범):** `specSyncUnownedPolicy=warn`이 같은 파일을 매번 unowned로 표면화하면, 그건 둘 중 하나다 — **(a) 정당한 미소유**(서버 부트스트랩·테스트 하네스·생성물처럼 어느 기능 스펙에도 안 속하는 인프라): `specSyncExemptGlobs`에 선언해 "의도적 미소유"를 **한 번** 명문화한다(만성 노이즈 제거). **(b) 진짜 drift**(소유돼야 할 기능 코드가 어느 Files에도 안 잡힘): 그 스펙 `Files:`에 등록해 소유시킨다. 판정 기준은 "이 파일이 어떤 FR의 파생물인가" — 그렇다면 (b) 소유, 아니면 (a) exempt. **하지 말 것:** 진짜 기능 코드를 노이즈를 지우려고 exempt에 넣는 것(소유 사각지대를 영구화). exempt는 "이건 원래 아무 spec 것도 아님"의 선언이지 "지금 매핑하기 귀찮음"의 도피처가 아니다.

## SSOT 3계층 (한 덩어리 아님)
| 레이어 | SSOT 주체 |
|---|---|
| 요구사항(무엇을/왜) | **module spec(EARS FR)** ← 진실원 |
| **구조 SSOT**(데이터/계약 구조, *있으면*) | 그 프로젝트의 구조 진실원 — **RDB**=migrations, **NoSQL**=컬렉션/인덱스 정의·앱 모델·validator(스키마-온-리드면 migration이 없을 수 있음 → 그 정의 파일이 SSOT), **API**=스키마/IDL/proto, **인프라**=IaC(CSP 무관). **순수 라이브러리·CLI엔 이 계층이 없을 수 있음**(그러면 생략). 어느 DB·어느 경우든 spec이 *되면 안 됨* |
| 코드(어떻게) | 소스 트리 — spec에서 파생·검증(테스트) |
spec은 ②③을 *지배(require)* 하되 *대체*하지 않는다. 구조 SSOT가 있는 프로젝트는 spec의 `Infrastructure Prerequisites` 절이 그 연결고리(없으면 그 절 생략).
