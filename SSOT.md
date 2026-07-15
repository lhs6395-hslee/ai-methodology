# SSOT 정책 — Spec Kit만으로 약한 이유와 메우는 법 (결정 기록)

> 상위 맥락(왜 바이브 코딩에서 명세 기반으로 왔나 · 언제 무엇을 쓰나): [`METHODOLOGY.md`](METHODOLOGY.md) §"왜 이 방식으로 왔나". 이 문서는 그중 **"왜 Spec Kit만으론 약한가"**를 파고든다.

## 1. 결론
- 모듈별 spec(=기능명세서) 구조는 **정석**. 약점은 구조의 흠이 아니라 **모든 문서형 명세의 공통 성질**(강제 없으면 drift).
- 해법은 **Superpowers + 테스트 + CI + FR-ID 태깅**. spec=요구의 SSOT, 테스트=그게 거짓이 안 되게 잠그는 자물쇠. 경쟁 아니라 짝.

## 2. Spec Kit의 한계 (정직)
- 본래 **한 방향 스캐폴더**(`specify→plan→tasks`). spec↔code 지속 일치 도구가 아님.
- `/converge`도 갭을 **task로 표면화만**(spec 자동 재작성 ✗).
- 코드가 spec에서 벗어나도 **빌드를 깨는 장치가 없다** → "Spec Kit=SSOT"는 기능이 아니라 우리가 얹는 규율.
- 증폭 요인: 역산된 brownfield 스펙, 스키마 SSOT(migration) 부재, EARS 비공식(Issue #1356).

## 3. Superpowers가 닫는 것 / 남는 이음매
| 이음매 | 강제 주체 | 강도 |
|---|---|---|
| spec↔plan↔tasks | `/analyze`+`/checklist` | 중(사람 게이트) |
| **FR↔test** | **FR-ID 태깅 + CI 체크(§4)** | ★ 유일하게 추가할 얇은 가드 |
| test↔code | Superpowers TDD+완료전검증 | 강(자동) |
→ Superpowers는 code↔test를 잠그지만 **FR↔test(스펙 prose↔테스트)** 는 수동으로 남는다. 그걸 §4가 기계화.

## 4. FR↔test 추적 게이트 (실재·검증됨)
- 각 테스트에 `@covers <SPEC-ID>/FR-NNN` 태그(주석 스타일 자유: `//`·`#`·`--`).
- **FR 게이트**가 spec의 FR 선언과 태그를 대조 →
  - R1: 존재하지 않는 FR 참조 시 fail.
  - R2: 커버 테스트가 있는 spec은 **모든 FR 커버 필수**(strict). 0개인 spec은 incremental에선 warn(점진 도입).
  - R3(선택, `requireAccounting`): 모든 FR이 **unit-covered ∨ smoke-verified ∨ deferred**로 회계(accounting)되어야 함 — "조용히 미검증"이 경고 속에 쌓이는 것을 제거. smoke/deferred는 `smokeManifest`(JSON: FR→`{method,evidence}` 또는 `{method:"deferred",reason}`)로 선언하고, 게이트는 dangling 키·빈 evidence/reason을 에러 처리한다. **evidence의 질은 기계가 못 본다 — 존재만 강제**(질은 리뷰 몫, 과장 금지). 리포트는 `accounted(unit/smoke/deferred/unaccounted)`. **비-unit 엔트리는 자동 채움(SPEC-010)**: 증거가 사는 파일의 검증 태그(`@verifies`)를 `smoke-scan`이 수집해 매니페스트를 재생성(`--write`)하고 check 모드가 드리프트를 차단 — 수동 연결 제거(수동 선언 경로는 보존).
  - `strictSpecs`(spec ID 배열): 전역 `--strict`의 **점진 도입 브리지** — 등재 spec만 R2를 하드로(모든 FR unit 커버 필수, smoke/deferred 대체 불가). 완전 커버에 도달한 spec부터 하나씩 잠근다. (SPEC-007)
- 로컬 훅(pre-commit·pre-push)·TDD는 run test(로컬 안전 유닛)만 실행하고, 인프라(관리형 DB·스토리지·큐·클라우드 API — 어느 CSP든) 테스트는 자격증명·도달성이 있는 개발서버·CI에서 run smoke로 — 로컬은 인프라 의존 테스트를 강제하지 않는다(METHODOLOGY '검증은 환경으로 계층화된다'·sdd.config.presets 테스트 tier 참조).
- 게이트는 **언어·런타임 무관 4판 동봉**: Go 바이너리 `sdd-gate fr`·셸 `sdd_gates.sh fr`·Python `sdd_gates.py fr`·Node `check-fr-coverage.mjs` — 핵심 3커맨드(fr·ownership·run)와 ID 문법(`specIdPrefixes`·`requirementIdPrefixes` 파생)은 4판 동일, **보강게이트·spec-first(§5)까지의 전 게이트는 Node·Python 두 판**(패리티 테스트로 강제 — 커버 매트릭스: `tooling/ci-examples.md`). 아래 본문은 Node 파일명으로 표기.
- CI/CD는 매 변경에 `lint→typecheck→test→FR게이트→소유권게이트`를 **언어별 `commands`로** 실행(특정 CI/CD 도구 한정 아님 — 로컬·git훅·어떤 도구든, `tooling/ci-examples.md`).
- **검증(2026-06-26):** incremental exit 0(통과), strict exit 1(미구현 spec 막음), test 8/8 통과, tsc 0. → 이 체인이 "SSOT=주장"을 "SSOT=기계적 사실"로 만든다.
- **단, CI가 실제로 green이어야 효력.** 참조 프로젝트는 현재 lint 4 errors로 red → 적용 시 먼저 해소해야 함. (`REALITY_CHECK.md` §3)

> **보강 게이트(advisory):** test-adequacy(빈 껍데기 @covers)·converge-drift(코드↔스펙)·orphan-surface(스펙 없는 코드)는 §방법론 한계를 *부분* 기계화한다. 기본 warn(빌드 안 깸), 익으면 `--strict`. 의미적 중복·스펙 정확성은 여전히 사람 몫.
>
> **재도출 소스 회계(SPEC-009):** brownfield 재도출의 SSOT 체인은 코드만이 아니다 — 소스 9클래스(code·iac·ci·ops-docs·build-evidence·vcs-history·prior-traceability·prior-intent·human-intent)가 `derivationManifest`에 전부 회계되어야 하고, 레포에 실재하는 클래스를 none으로 선언하면 `derivation` 게이트가 exit 1(조용한 미인제스트 금지). 레포 밖 실체(운영 인프라·빌드 로그)는 mapped evidence가 좌표를 가리키는 방식으로만 선언 가능(게이트는 레포 밖을 아는 척하지 않는다 — §5b의 live 검증과 상보). 재도출 불가능한 순수 인간 의도는 저술 시점 선제 캡처(Change Log 근거 존재 검사 포함)로만 남는다.
>
> **스펙 수명주기(SPEC-008):** 스펙 헤더 `Status:`는 enum(`Draft→Reviewed→Approved→Active→Deprecated→Removed`)이다. **Draft 스펙이 소유한 코드 변경은 spec-sync가 차단**(스펙 동반 여부 무관 — 리뷰 없는 스펙이 코드를 이끌 수 없다), Reviewed 이상은 `## Review Log`(일시·수행자·판정)·`## Dedup-Review`(이웃 검토 기록)의 **존재**를 completeness가 검사한다. 강제하는 것은 시간 순서가 아니라 **상태 순서**이며, Status 없는 레거시 스펙은 warn만(advisory → strict 승격 경로).

## 5. 양방향 동기화의 진실
converge는 양방향 자동 sync가 아님. **작성=LLM, 승인=사람**(`METHODOLOGY.md` 동기화 절). 사람 승인 없는 코드→spec 자동 덮어쓰기는 금지(spec이 코드 거울로 전락).

## 5b. 인프라 스펙 — SSOT는 "배포된 실제"까지다 (drift 검증, CSP 무관)
앱 스펙은 spec↔code↔test로 닫지만, **인프라 스펙(IaC)은 한 계층 더 있다 — "실제 굴러가는 환경"**. 여기서 SSOT 체인은 **spec ↔ IaC(git) ↔ deployed reality(running)** 3단이며, 마지막 단이 가장 잘 어긋난다. **이 원리는 클라우드 종류와 무관하다** — AWS·GCP·Azure·온프렘, k8s든 서버리스든 VM이든 똑같이 "git의 IaC ≠ 실제 배포"가 발생한다. 바뀌는 건 *검증 명령*이지 *규율*이 아니다.

- **검증은 git만 보면 안 되고 live를 봐야 한다.** "코드(IaC)가 스펙과 맞다"와 "배포된 게 IaC와 맞다"는 별개. (실사례: 스펙은 "GitOps가 전부 sync"인데 매니페스트가 앱 워크로드를 누락 → 앱이 **수동 배포**로 git과 drift, running 버전이 git과 다름. git·스펙만 봤으면 못 잡음.)
- **drift 원인 패턴(CSP 공통):** ① 배포 자동화(GitOps/파이프라인)가 실제론 미배선인데 스펙엔 "자동 sync"로 적힘 ② CI 부재로 아티팩트/매니페스트가 수동 갱신 ③ 콘솔/CLI 수동 변경이 IaC 밖에 쌓임(예: 시크릿·스케일·정책 수동 조정).
- **규율:** 인프라 스펙의 verification 절에 **그 CSP의 live 점검 명령**을 명시. drift 0인지 IaC 도구로 확인 + 실제 리소스 describe. 예(택1, 환경에 맞게):
  - **IaC 공통:** `terraform plan`(detailed-exitcode로 drift 0) · `pulumi preview` · `cdk diff`.
  - **AWS:** `aws <svc> describe-*` / CloudFormation drift-detection.
  - **GCP:** `gcloud <svc> describe` / `gcloud asset` · Config Connector 상태.
  - **Azure:** `az <svc> show` / `az deployment what-if`.
  - **Kubernetes(어느 CSP/온프렘이든):** `kubectl get/diff`, ArgoCD/Flux sync 상태.
  - **온프렘/VM:** Ansible `--check`(드리프트), 구성관리 도구의 dry-run.
- **자동 sync ↔ 외부 컨트롤러 충돌 주의(있으면):** 자동 동기화(prune+selfHeal 류)를 켤 땐 다른 컨트롤러가 소유한 필드(예: 오토스케일러의 `replicas`)를 무시목록(`ignoreDifferences` 등)으로 제외 — 안 그러면 서로 되돌리며 싸운다.
- **수동 시크릿/설정 = IaC 갭:** 사람이 콘솔/CLI로 주입한 시크릿·설정은 코드화 안 된 것. 스펙에 "시크릿 매니저(어느 CSP든)로 코드화" 후속과제로 박제.
- **관리형 컴포넌트는 전부 동일 (DB든 캐시든 브로커든):** RDS/Cloud SQL/Aurora·DynamoDB/Firestore/Cosmos/Mongo Atlas(DB)뿐 아니라 **Redis/ElastiCache/Memorystore(캐시)·Kafka/MSK/Pub-Sub/Event Hubs/Kinesis(브로커·스트림)·Elasticsearch/OpenSearch(검색)·S3/GCS/Blob(스토리지)·SQS/큐·함수** 모두, **콘솔에서 만든 테이블·인덱스·토픽·파티션·용량·정책이 IaC 밖에 있으면 drift**다. 그 정의가 코드(migration·IaC·앱 부트스트랩·스키마 레지스트리) 어디에 SSOT로 있는지 스펙이 가리키고, 실제 리소스 describe로 대조한다. **방법론은 어떤 미들웨어 제품도 가정하지 않는다.**

> 핵심: **"스펙↔코드 동기"를 통과해도 인프라는 안심 못 한다. 어느 클라우드든 배포된 실제와의 drift를 별도로, 그 환경의 명령 실행으로 검증하라.**

## 6. 언어 규약 — 정본 언어 + 생성 현지어
> 결정: **영문 operative + 현지어(예: 한국어) 자동생성.** 언어 결정과 추적성을 분리해 번역 드리프트를 원천 차단한다.

| 항목 | 규칙 |
|---|---|
| **정본(operative)** | `spec.md`는 **영어**가 정본. EARS 키워드+서술부 모두 영어 → 도구(`analyze`/`checklist`)·EARS(IEEE 출처)·AI 처리 일관성 |
| **현지어본** | 영문에서 **생성(generated)** — 문서 변환·팀 뷰·인터뷰 공유용 |
| **금지** | 현지어본을 손으로 **병행 편집(parallel-edit) 금지** — 영문↔현지어 번역 드리프트라는 새 이음매가 생김. 생성은 단방향만 |
| **추적 닻** | **언어중립 FR-ID**(`FR-006`) — 본문 언어와 무관하게 테스트·문서가 ID로 연결. **언어 결정과 추적성은 독립** |
| **UI 텍스트** | 별개 규칙 — 제품 UI 언어(예: 한국어)는 spec 언어와 무관 |

**드리프트 이음매(언어 추가 후):** `FR(영문)↔test`=FR-ID+CI(§4) · `test↔code`=Superpowers(§3) · **`FR(영문)↔현지어 렌더`=생성 단방향으로 닫음**(병행편집 시 열림).

**이행(역산 스펙):** 기존 비영문 스펙을 **일괄 선영문화하지 말 것.** 모듈을 실제로 손댈 때(첫 feature 착수 시) 해당 스펙부터 영문 정본화하는 **점진 이행**(역산 스펙 전체 선변환 비용 회피).
