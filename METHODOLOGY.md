# 방법론 — Spec Kit + EARS + Superpowers (범용)

## 왜 이 방식으로 왔나 — 바이브 코딩에서 명세 기반으로

AI 개발의 가장 흔한 출발점은 **바이브 코딩**이다(Andrej Karpathy, 2025) — 말로 기능을 던지면 코드가 나오고, "돌아가 보이면" 다음으로. 빠르고·무계획·직관적이라 지배적 방식이 됐다. 문제는 작업 단위인 **"feature"가 너무 굵다**는 것 — "직원 추천 됨 ✓" 하나가 실은 적합도 정렬·빈 결과·권한·페이징 같은 수십 개의 세부 요구를 품는데, feature 단위로 보면 뭘 빼먹었는지가 "돼 보임" 뒤에 뭉개진다. 시간이 지나면 미완성·표류(drift)·흩어짐·중복이 쌓여 무너진다(업계에선 "3개월 벽").

그래서 우리는 **작업 단위를 feature에서 FR(요구 하나하나)로 내리고, 검증을 회계·추적으로 강제한다.**

| | 바이브 코딩 | 이 방법론 |
|---|---|---|
| 작업 단위 | Feature (굵음) | **FR — 요구 하나하나** |
| 완료 기준 | "돌아가 보임" | **unit · smoke · deferred 회계** |
| 미구현 | 안 보임 (기억에만) | **deferred로 명시** |
| 추적 | 채팅 히스토리 | **spec ↔ code ↔ test** |

- **unit** — 그 FR을 확인하는 단위 테스트가 있고 코드와 `@covers`로 묶임 (기계가 매번 확인).
- **smoke** — 단위 테스트 대신 실행 증거(CI·스크립트·runbook)로 확인, 증거에 `@verifies` 태그(자동 수집, SPEC-010).
- **deferred** — 일부러 미룬 개별 FR, 이유를 적어 미완성임을 명시("할 건데 아직").
- **planned** — 스펙 전체가 미구현(`Status: Planned`). 0-coverage가 정상이라 R3 미검증이 아니라 `planned`로 회계된다(SPEC-018 FR-005) — 유령 명세(0/N)를 노이즈가 아닌 "의도된 미구현"으로 분리. `deferred`(FR 단위 백로그)와 층위가 다르다.
- **회계(accounting)** — 모든 FR이 unit·smoke·deferred·planned 중 하나여야 한다(`requireAccounting`, SPEC-007). 어느 것도 아니면 게이트가 차단 — "조용한 미검증" 제거. 그래서 미완성이 숨지 못한다. 반대로 **필요 없어진 FR/spec은 미루지 말고 `sdd-retire`로 폐기**(회계에서 제거, 이력만 git — SPEC-018·STRUCTURE 폐기 절): 누적이 아니라 정리·삭제가 명세를 코드 현실의 미러로 유지한다.
- **실행 결과 ≠ 커버리지 회계 — 완료 주장 전 스위트를 실제로 돌린다.** 커버리지 태그 회계(`check-fr-coverage`)·단언 존재(`check-test-adequacy`)·태그↔매니페스트 드리프트(`sdd-smoke-scan`)는 **"태깅됨·단언함·기록됨"만** 볼 뿐 **스위트를 실행해 green을 확인하지 않는다** — "sync green"을 "테스트 green"으로 오인하는 구조적 틈이다(도그푸딩: sync 전부 green인데 단위 스위트 3-error). **완료를 주장하기 전, 프로젝트가 선언한 `commands.test`를 실제로 실행해 green(또는 문서화된 skip)임을 확인한다**(외부 시스템 실행 결과라 SC 충족과 동일한 리뷰 경계 — 규범). 선택적 강제는 `runTestsPolicy`(off|advisory|hard) knob으로 `check-test-run` 게이트가 `commands.test`를 실행(exit 0 요구, `hard`=차단·`advisory`=경고, 기본 off) — 러너/언어 중립(선언된 명령의 exit code만 본다), SPEC-021.

**검증은 환경으로 계층화된다 — 로컬은 인프라 테스트를 강제하지 않는다(CSP 무관).** unit은 외부 의존이 없어 **어디서나**(로컬·CI) 돈다. smoke는 실인프라(관리형 DB·오브젝트 스토리지·큐·클라우드 API·사설 네트워크 자원 — **특정 클라우드 무관**)가 필요하니 **자격증명·도달성이 있는 곳(개발서버·CI)에서만** 실행하고 증거만 남긴다. 그래서 **로컬 강제(git 훅·TDD·`sdd-run test`)는 인프라 의존 테스트를 절대 실행하지 않는다** — 로컬엔 그 권한·접근이 없을 수 있기 때문. 관례:
- `commands.test` = **로컬 안전**(유닛 + 목)만. 로컬 규율·TDD·pre-commit은 이것만 본다.
- `commands.smoke` = **인프라 테스트**. 자격증명·도달성이 있는 곳(개발서버·CI)에서만 `sdd-run smoke` → `@verifies` 증거 → `smokeManifest`. 인프라 FR은 로컬에서 smoke(원격 증거) 또는 deferred로 회계된다 — **로컬 unit으로 강제되지 않는다.**
- **로컬 실행 가능성은 가정하지 말고 판정한다(능동적 — 방법론이 특정 CSP를 가정하지 않으므로 자원별로):**
  1. **분류** — 이 테스트가 순수 애플리케이션인가, 인프라(외부 자원)를 포함하는가. 순수 앱 → 로컬(어디서나).
  2. 인프라 포함이면 → **사용자에게 확인**(로컬에 이 자원의 권한·네트워크 접근이 있나?) + **실제 접근 probe 실행**(최소 인증·연결 시도). **공개 엔드포인트 + 자격증명**(오브젝트 스토리지·서버리스 함수·모니터링 API 등 — 어느 CSP든)이면 로컬에 권한 있을 때 실행 가능, **사설·네트워크 격리**(VPC·사설 서브넷 내 관리형 DB·캐시·내부 로드밸런서, 온프렘 내부망 등)면 로컬 도달 불가.
  3. **probe 실패 시 상황을 명시한다** — 어느 자원이 왜 불가한지(권한 없음 / 사설 네트워크 격리 / 로컬 미제공)를 테스트 skip 사유와 회계(`deferred` reason 또는 `smoke` 증거 위치)에 **명시적으로 기록**하고 개발서버·CI로 라우팅한다. **조용히 통과 금지** — 미검증이 숨지 못하게.
  각 인프라 테스트는 이 판정을 **probe 기반 skip 가드**(권한·연결 시도 + 환경 플래그)로 인코딩해, 로컬 실행 시 실패가 아니라 **사유 포함 skip** 되게 한다.

**env-gated 테스트 관례(1급 규범).** 외부 의존(관리형 DB·클라우드 API·terraform 등)이 필요한 테스트는 **의존성 부재 시 error가 아니라 skip**되도록 가드하는 것을 관례로 삼는다(위 probe 기반 skip 가드 — 러너 중립: Python `skipUnless`, JS/TS `describe.skipIf`, Go `t.Skip`; 레시피는 `tooling/sdd.config.presets.md` §테스트 환경 tier). 목적 두 가지: ① "완료 주장 시 실행"(`runTestsPolicy`) 규범이 환경에 따라 **거짓 error를 내지 않게** — 스위트 결과가 passed/skipped·**error 0**으로 명확해진다. ② 조용한 통과 금지 — skip은 사유를 남겨 미검증이 회계에 드러난다. (태그된 테스트가 의존성 부재로 **조용히 전부 skip**돼 커버리지가 허구가 되는 것을 감지하는 skip률 advisory는 러너별 출력 파싱이 필요해 향후 — 지금은 이 관례가 결과를 명확히 유지하는 것으로 1차 대응.)

**spec↔code green ≠ 배포 안전 — 배포 경계 드리프트(R2′).** 드리프트는 spec↔code(R1·R2)만이 아니다. **코드가 기대하는 런타임 스키마 ↔ 실제 배포된 DB** 축이 벌어지면(마이그레이션이 수동 out-of-band라 조용히 미적용) spec↔code가 전부 green인데 배포 후 `column does not exist`(42703) 같은 장애가 난다(도그푸딩: 동일 클래스 3회 반복). **DB 스키마 SSOT(예: ORM 스키마)+마이그레이션을 쓰는 프로젝트는 배포 파이프라인에 migrate-on-deploy(배포 시 마이그레이션 자동 적용) 또는 배포전 스키마 드리프트 preflight를 반드시 건다** — `check-schema-drift`(opt-in `schemaDriftManifest`, SPEC-022)가 "코드 기대 vs 배포 실측" 스키마를 diff한다(DB/ORM 중립 — 조회 방법을 명령으로 주입, `hard`면 배포 차단). 로컬 훅이 아니라 **배포 preflight**에 건다(배포 시점에만 배포 DB 조회 가능 — 웹 UI 병합이 로컬 훅을 안 타는 것과 동형의 강제-지점 이동). **brownfield baseline:** 수동 DDL로 운영돼 온 기존 DB에 마이그레이션 도구를 처음 도입할 땐, 마이그레이션 저널에 현 스키마를 "적용됨"으로 baseline 마킹(실 DDL 미실행)한 뒤 신규분만 적용한다 — 드리프트를 재적용 충돌 없이 봉합하는 표준 절차.

### 단점은 있다 — 그리고 이렇게 보완한다

명세 기반이 완벽하다는 말이 아니다. SDD가 흔히 지적받는 약점을 다음 장치로 메운다.

| SDD가 지적받는 단점 | 우리의 보완 |
|---|---|
| 작은 수정에도 절차가 붙는 오버헤드 | `Spec-Impact: none` 탈출구·hotfix 경로로 사소한 변경은 가볍게 통과 |
| 코드·스펙 이중 관리 부담 | `retag`(SPEC-011)·`smoke-scan`(SPEC-010)이 연결을 자동 갱신 |
| 스펙이 낡으면 오히려 오해를 부름 | drift/converge 게이트가 어긋남을 상시 감지 |
| 회계를 형식적으로 채울 위험 | 근거·entity 등록 필수화(`entityRegistry`)로 빈 양식 차단 |
| "옳은 방향"까지 게이트가 보장 못 함 | 마지막 판단은 사람 승인 — 기계는 정합성, 사람은 옳음 |
| 탐색 단계엔 과함 | 탐색은 바이브로, 굳으면 채택하는 수명주기로 설계 |

### 언제 무엇을 쓰나 — 둘은 경쟁이 아니라 단계다

| 바이브 코딩이 맞을 때 (탐색·단기) | 이 방법론이 맞을 때 (운영·장기) |
|---|---|
| 프로토타입·MVP·해커톤·데모 | 오래 유지·계속 커질 코드 |
| 한 번 쓰고 버릴 코드·아이디어 검증 | 프로덕션·핵심 시스템 |
| 요구가 아직 불확실(탐색 중) | 요구가 굳음·정확성/규정이 중요 |
| 혼자·단기 작업 | 여러 사람·여러 모듈 협업 |
| "빨리 돌아가는 것"이 최우선 | "무너지지 않는 것"이 최우선 |

한 프로젝트 안에서도 섞인다 — 탐색은 바이브로 빠르게 훑고, 방향이 굳으면 그 부분부터 이 방법론으로 채택한다(채택 수명주기). → 시각 설명: [`방법론.html`](방법론.html) §"출발점 · 전환 · 요약".

## 이 방법론은 "채택하면 벗어날 수 없는 궤도"다

이 방법론을 채택한 프로젝트는 채택(`sdd-init`) 순간부터 **`spec→code→test→sync` 궤도를 상시 강제**받는다. 이탈(문서 없는 코드, 임의 PREFIX, 미대조 스펙)은 **hook·게이트가 감지해 궤도로 되돌린다.** 방법론은 *읽는 문서*가 아니라 *벗어날 수 없는 궤도*다 — 그 강제 장치가 게이트(검증 시점 차단)와 hook 세트(세션·편집 시점 상기, `HARNESS.md`)다.

## 3축 역할
| 축 | 도구 | 담당 |
|---|---|---|
| 골격 | **GitHub Spec Kit** | `specify→plan→tasks` + 리뷰 게이트(`/analyze·/checklist·/clarify·/constitution`). "스펙의 옳음" |
| 요구사항 | **EARS** | FR을 5패턴 정형 요구로(아래). "한 요구=한 동작=검증가능" |
| 구현·검증 | **Superpowers** | TDD(RED→GREEN)·완료전검증·코드리뷰. "코드의 옳음". `/implement` 미사용 |

**왜 한 골격으로 묶나 — 셋은 서로의 구멍을 메운다.** 따로 쓰면 각자 한 부분만 잘하고 구멍이 남는다: **Spec Kit**은 spec을 *관리*하지만 FR이 모호해도 못 막고 코드가 맞는지 검증 안 한다. **EARS**는 요구를 *검증 가능*하게 만들지만 문장 형식일 뿐 — 관리도 검증도 못 한다. **Superpowers**는 코드를 *검증*하지만 "무엇이 명세인가·중복인가"를 모른다. 셋을 묶어야 **무엇을(EARS로 정밀히) → 관리(Spec Kit) → 검증(Superpowers)** 사슬이 닫힌다 — 하나라도 빠지면 끊긴다(EARS 없으면 FR 모호→테스트로 못 묶음, Spec Kit 없으면 명세 흩어짐, Superpowers 없으면 코드 미검증→명세가 희망사항). 4번째 기둥(범용성)이 이 골격을 어디서나 같게 돌린다.

**검증 분담:** **FR**은 이 키트의 게이트(`@covers`·dedup·cohesion·completeness)가 추적·강제하고, **인수조건·SC**는 Spec Kit 네이티브(`/analyze`·`/checklist`·`/tasks`)가 담당한다. `check-spec-completeness`는 "FR 있는 spec에 SC·인수조건이 *존재*하는가"와 "수명주기 기록(Status·Review Log·Dedup-Review)이 *존재*하는가", "Change Log 실기록 행에 근거가 *존재*하는가"(선제 캡처, SPEC-009), 그리고 스펙 문법 규범(SPEC-013) — `Module` 헤더 존재·값 단일성(1 레포=1 모듈), FR 선언 라인의 SHALL(EARS 공통 필수 토큰), Dedup-Review가 참조한 이웃 ID의 실재 — 만 advisory로 지킨다 — SC **충족**은 런타임 지표라 빌드 게이트가 강제할 수 없다(과장 금지). **FR의 검증 상태 자체는 회계된다(SPEC-007):** `requireAccounting`을 켜면 모든 FR이 unit(@covers) ∨ smoke(매니페스트 evidence) ∨ deferred(매니페스트 reason) 중 하나로 선언되어야 하고, 어느 것도 아니면 R3 에러다 — "조용히 미검증" 제거. `strictSpecs`는 완전 커버 spec부터 하나씩 전역 `--strict`로 잠그는 점진 브리지. evidence/reason은 **존재만** 강제(질은 리뷰 몫). **매니페스트의 비-unit 엔트리는 손으로 잇지 않는다(SPEC-010):** 증거가 사는 파일(테스트·CI 정의·스크립트·runbook)에 검증 태그(`@verifies <SPEC-ID>/FR-NNN <method>: <evidence>`)를 남기면 `smoke-scan --write`가 매니페스트를 결정적으로 재생성하고, check 모드가 태그↔매니페스트 드리프트를 차단한다(수동 선언 경로는 보존).

왜 OpenSpec 아닌 Spec Kit: **에이전트 비종속(30+) + 리뷰 게이트 내장 + Superpowers 결합**(코드검증 레이어). "sync가 더 좋아서"가 아님(그 축이면 OpenSpec이 유리). → `SSOT.md`.

## 4번째 기둥 — 범용성(Portability): 6축 무관
> 3축이 *무엇을 하는가*라면, 범용성은 *어디서나 같게 동작한다*는 보장이다. **방법론의 어떤 부분도 특정 언어·런타임·모델·미들웨어·클라우드·CI에 박히지 않는다.** 강제 게이트는 모두 실행으로 검증됨(`REALITY_CHECK.md`). 단일 기준점: `principles.md` §10.

| 축 | 무관 보장 | 어떻게 (메커니즘) |
|---|---|---|
| **언어** | Python·Go·Rust·Java·… 무엇이든 | `sdd.config.json` 어댑터 1장(`testFileRegex`·`scanDirs`·`commands`·`ownershipCategories`·`specIdPrefixes`). 프리셋: `tooling/sdd.config.presets.md`. `@covers` 주석 스타일 무관(`//`·`#`·`--`) |
| **런타임(게이트 실행)** | 인터프리터 강요 없음 | 게이트 4판 동봉 — **Go 단일 정적 바이너리**(만능, 인터프리터 0)·셸(`sh+grep+awk+jq`)·Python·Node. 핵심 3커맨드·ID 문법 4판 동일, 전 게이트(보강·spec-first)는 Node·Python 패리티(테스트 강제). 가진 쪽 사용 |
| **모델/에이전트** | 어떤 LLM이든 | 방법론에 벤더 가정 0. Spec Kit 30+ 에이전트 비종속, 게이트는 모델 독립적으로 강제. 슬래시명령은 편의, 핵심 규율은 어떤 에이전트로도 수행 가능 |
| **DB/미들웨어** | RDB·NoSQL·Redis·Kafka·검색·스토리지… | spec은 *역량/요구*만 적고 *제품* 금지("이벤트 로그 필요" O / "Kafka" X). 구조 SSOT 위치만 다름(`STRUCTURE.md`) |
| **CSP** | AWS·GCP·Azure·온프렘 | drift 검증 *원리* 동일, *명령*만 환경 것(`SSOT.md` §5b) |
| **CI/CD 도구** | 특정 CI/CD 도구 불필요 | 게이트는 CLI — 로컬·git훅·`make`·어떤 CI/CD 도구든. 샘플·도구별 동일 명령: `tooling/ci-examples.md`. **Spec Kit(spec 작성) ≠ CI/CD 도구(게이트 실행)** |

**한 규칙으로 압축:** *무엇을/왜*(spec·FR)만 방법론이 규정하고, *무엇으로*(언어·DB·클라우드·CI 제품)는 전부 프로젝트 결정으로 남긴다. 새 언어·새 스택이 와도 게이트를 새로 짜지 않고 `sdd.config.json`만 맞춘다.

## EARS 5패턴 (+ Complex 조합)
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

**완료 루프의 꼬리 — 원점 트래커 close-out:** 핵심 루프는 `spec→code→test→sync`지만, 실무 작업의 상당수는 QA/이슈 트래커에서 유래한다(예: 페이지별 QA 메모, open→done→confirmed 3-상태). 작업이 tracked issue에서 유래했다면 **루프 완료(verify/merge)는 close-out을 포함**한다: ① 원점 트래커 항목을 **dev-done**으로 표시(리포터의 최종 confirm은 미접촉 — **2인 책임분리**: dev-done → reporter-confirmed) → ② 이해관계자에게 **완료 보고**(무엇을·왜·어떻게 고쳤는지 + 검증 경로 — 이 보고가 리포터의 수용 테스트를 트리거) → ③ 리포터/QA가 최종 검증 후 **confirmed**로 마감. 코드·게이트만 끝내고 트래커 close와 보고를 누락하는 실패를 막는다. **정본은 generic** — 트래커가 무엇인지·보고 채널(수신자·형식)은 킷에 하드코딩하지 않고 `trackerCloseout` config(또는 CLAUDE.md 관례)로 인스턴스화한다(`{}`=비활성, 트래커 유래 아닌 작업은 무관). 외부 시스템·사람 sign-off라 **빌드 게이트가 아니라 규범**이다(SC 충족과 동일 — 리뷰 경계); 실행기는 `speckit-fix` 스킬 마지막 단계와 완료형 스킬이 담당한다.

**check-spec-sync(commit-msg hard):** 소유 spec의 `Files:` glob에 매치되는 코드 변경은 commit-msg 훅이 동일 changeset(브랜치) 안에서 해당 스펙의 FR·Edge Case·Change Log 실제 변경을 강제한다(staged 모드 = hard exit 1). range 모드(인자 없음 기본값)는 advisory — `sdd-sync`(CI/pre-push)에 배선한다. Files 미선언 스펙은 check-spec-sync 대상이 아니며 check-converge-drift(전역 advisory)가 백업 그물. **미소유 파일**(어느 스펙 Files에도 미매치)은 `specSyncUnownedPolicy`가 선언한 대로 — `silent`(기본=현행)·`warn`·`error`(staged 차단=closed-world), 의도적 예외는 `specSyncExemptGlobs`로 선언(P2, SPEC-003 FR-010).

**재도출 소스 회계(SPEC-009) — 재생성은 src만 읽으면 미완성이다:** 재도출(reverse-engineer)이 읽어야 하는 소스는 9클래스 고정 enum(code·iac·ci·ops-docs·build-evidence·vcs-history·prior-traceability·prior-intent·human-intent)으로 문법화되어 있고, `derivationManifest`(`sdd/derivation.json`)에 전 클래스가 mapped ∨ none ∨ deferred로 **회계**되어야 한다. 검출 가능한 클래스(iac/ci/ops-docs 글롭·code·기존 태그)는 레포 실재와 교차검사 — **IaC가 실재하는데 none 선언이면 exit 1**(실측: 초기 재도출이 src 밖을 안 읽어 INFRA FR 손실). 재도출 불가능한 순수 인간 의도(human-intent)는 예외가 아니라 선언된 클래스다 — 저술 시점 **선제 캡처**(Review Log·Dedup-Review·Clarifications·**Change Log 근거 칸** — completeness가 실기록 행의 근거 존재를 검사)가 유일한 경로. FR 키 재번호는 마이그레이션 맵 + `retag` 기계 이행(SPEC-011)로 — 손 재태깅 금지. 절차 정본: `prompts/readopt.md` 6~7단계.

**접두어↔클래스 정합(SPEC-012) — 접두어 의미도 강제된다:** PREFIX 거버넌스는 등록·사유만이 아니다. 스펙이 소유한(Files) 비-테스트 실파일이 **전적으로** iac/ci 클래스(SPEC-009의 `derivationClassGlobs` 파생)인데 접두어가 `INFRA-`가 아니면 fr 게이트가 exit 1 — 재도출이 인프라 실체를 SPEC-으로 착지시키는 실패 모드를 기계 차단한다(readopt 착지 규칙 iac→INFRA·ci→CICD의 강제판). 임계는 비율이 아니라 전체성이라 기능 SPEC-의 부수 IaC/CI 소유는 과잉발동 없이 통과하고, 나머지 경계는 `prefixClassExemptions`(사유 필수)로 선언한다.

**스펙 수명주기(SPEC-008):** `Status:`는 enum `Draft → Reviewed → Approved → Active → Deprecated → Removed`. **Draft 스펙의 소유 코드 변경은 commit-msg가 차단**한다 — 스펙을 함께 고쳐도 통과 못 하며, 리뷰(`/speckit.analyze`+`/checklist`) 결과를 스펙의 `## Review Log`(일시·수행자·판정)와 `## Dedup-Review`(검토한 이웃 스펙 ID+판정)에 기록하고 Status를 Reviewed 이상으로 승격하는 것이 정공법(탈출구는 `Spec-Impact: none <사유>` 트레일러뿐). completeness 게이트가 Reviewed 이상의 기록 존재를 검사한다(advisory, `--strict` 하드). 강제는 시간 순서가 아니라 **상태 순서**라 브랜치 단위 작업 설계와 충돌하지 않고, Status 없는 레거시 스펙은 warn만(점진 도입).

## 리뷰 경계 선언 — 게이트가 판정하지 않는 것(정의된 경계, 예외 아님)
> 원칙: **결정적 기계 신호가 있는 규범은 전부 게이트가 강제한다**(위 게이트군 + SPEC-012 이상 게이트 계열 — 아래 표 참조). 남는 것은 순수 의미 판정뿐이며, 이는 "정의되지 않은 예외"가 아니라 **여기 선언된 리뷰 경계**다 — 각 항목은 게이트가 지키는 기계 신호(하한)와 리뷰가 지키는 의미(상한)로 나뉜다. 억지 게이트로 의미 판정을 흉내 내지 않는다(오판 = 신뢰 붕괴).

| # | 리뷰 경계 항목 | 게이트가 지키는 하한(기계 신호) | 리뷰가 지키는 상한(의미) — 수행 지점 |
|---|---|---|---|
| 1 | EARS 어휘의 질(모호어·2동작·측정가능성) | FR 선언 라인의 SHALL 존재(SPEC-013) | 금지어·단일동작·측정형 판정 — `/speckit.analyze`·`/checklist`(SPEC_REVIEW) |
| 2 | spec의 역량/제품 구분(제품명 금지) | — (신호 없음) | "Kafka" 같은 제품 고정 여부 — 스펙 리뷰(SPEC_REVIEW §범용성) |
| 3 | Entity 표기의 스키마 원본 일치(단복수 등) | 소문자·형식 정규화 + `entityRegistry` 등록제(SPEC-002) | 스키마 식별자와의 대조 — 스펙 리뷰 |
| 4 | Capability verb의 동의어성 | 미등록 verb 형식 위반(SPEC-001/002) | "modify≈update인가" — `capabilityVerbs` 등록 리뷰(config 변경 관문) |
| 5 | 의미적 중복(말만 바꾼 같은 요구) | 키 유일성 dedup + Dedup-Review 존재·참조 실재(SPEC-002/008/013) | 이웃 스펙과의 의미 비교 — DEDUP §4 좁힌 리뷰 |
| 6 | INFRA/CICD 스펙 본문이 실제 인프라 명세인가 | 접두어↔소유 파일 클래스 정합(SPEC-012) | 본문 도메인 판정 — 스펙 리뷰 |
| 7 | 개발 시간 순서(spec을 먼저 썼는가) | 같은 changeset 동반 변경 + Draft 차단(SPEC-003/008) | 시간 순서 자체는 **의도적 비목표**(ROADMAP P4) |
| 8 | 현지어본 병행 편집 금지(정본=영어) | — (신호 없음: 정당한 오타 수정과 구분 불가) | 현지어본은 생성물로만 취급 — PR 리뷰(SSOT §정본 언어) |
| 9 | evidence/reason·리뷰 기록·Change Log 근거의 질 | 존재·빈 값 불가(SPEC-007/008/009) | 내용이 실체를 가리키는가 — PR 리뷰(과장 금지 원칙) |
| 10 | Files glob 의미적 완전성("이 기능의 코드 전부인가") | 여집합 closed-world(`specSyncUnownedPolicy: error`)·글롭 문법 차단(SPEC-003/013) | 기능↔파일 귀속 판단 — STRUCTURE §Files 완전성 리뷰 |
| 11 | "무엇이 한 모듈인가"(레포 분할 판단) | Module 헤더 값 단일성(SPEC-013) | bounded context 판정 — STRUCTURE 리뷰 |
| 12 | 작성=LLM·승인=사람(정본화 승인 절차) | 자동 덮어쓰기 도구 부재(converge는 task만 생성) | 승인 행위 자체 — 사람(HARNESS 불변) |
| 13 | Entity 관계의 의미 정합("relation-type이 실제 맞나") | 구조화 관계 대상 Entity 실재(hard)·aggregate 간 순환(advisory)·`relationTypes` 등록(SPEC-017) | "정말 has-many인가" 등 관계 의미 — 스펙 리뷰·`relationTypes` 등록 관문 |
| 14 | TEST 도메인 귀속·삭제예정성("무엇이 정말 removable 비제품 도구인가") | `testInfraGlobs` 격리·TEST 접두어 prefix-class 면제·`Lifecycle` enum(SPEC-015/012/008) | 도메인 귀속·삭제예정성 판정 — 스펙 리뷰 |
| 15 | 오브젝트 스토리지 결정의 타당성(신규 버킷 vs 재사용·이전 기준) | `## Object Storage Decision` 섹션·Bucket/Consolidation 라벨 존재(SPEC-016) | 스토리지 선택·consolidation이 타당한가 — 스펙 리뷰 |
| 16 | 리네임/소유 이동 후 FR 본문이 새 코드 *의미*를 서술하는가(semantic drift) | 소유 파일 리네임 감지 시 FR 선언 라인 변경 ∨ `Spec-Impact` 강제(`semanticDriftPolicy`, SPEC-019) | "본문이 새 이름·목적과 맞나" — 스펙 리뷰(트리거가 리뷰를 강제) |
| 17 | 테스트 스위트 실행 결과(green)인가 — 커버리지 회계 ≠ 실행 | `runTestsPolicy`로 `commands.test` 실제 실행·exit 0 요구(opt-in, `check-test-run`, SPEC-021) | 완료 주장 전 스위트 실행+결과 확인·"문서화된 skip이 정당한가" — 실행기 규범(`speckit-fix` 단계)·리뷰 |
| 18 | 배포된 DB 스키마가 코드 기대와 일치하나(R2′) — spec↔code green ≠ 배포 안전 | 배포 preflight에서 코드 기대 vs 배포 실측 스키마 diff(opt-in `schemaDriftManifest`/`migrationStatePolicy`, `check-schema-drift`, SPEC-022) | migrate-on-deploy 파이프라인 설계·brownfield baseline 절차의 타당성 — 배포 엔지니어링 리뷰 |

이 표 밖에서 "게이트가 안 잡는" 규범을 발견하면 그것은 **버그다** — (a) 결정적 신호가 있으면 게이트를 추가하고, (b) 없으면 이 표에 행을 추가해 경계를 선언한다(둘 다 아닌 상태로 두지 않는다).

## 출처·확증
이 문서의 핵심 주장(converge=갭을 task로 추가만/자동 재작성 X, specify=생성+갱신, EARS 비공식·#1356, EARS 5패턴 Rolls-Royce IEEE RE'09, OpenSpec specs/changes, Superpowers TDD·완료전검증)은 공식 출처로 확증됨 → `SOURCES.md`. 보강: EARS 저자=Mavin·Wilkinson·Harwood·Novak(공저), Superpowers 창작자=Jesse Vincent(obra)·Anthropic 공식 마켓(2026-01).
