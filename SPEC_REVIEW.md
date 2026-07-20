# 스펙 리뷰 체크리스트 (코드리뷰하듯 spec 리뷰)

| 점검 항목 | 무엇을 잡나 | 게이트 | 자동/수동 |
|---|---|---|---|
| **빈 공란** | `[NEEDS CLARIFICATION]` 미해소 | `/speckit.clarify`(찾아 질문→반영) + `/analyze`(마커 플래그) | 반자동 |
| **중복(한 기능 내)** | 같은 요구가 spec/plan/tasks에 중복 | `/speckit.analyze` | 자동 |
| **중복(spec 간) — 구조적** | 두 spec이 같은 Entity/Surface/Capability 소유 | **`check-ownership.mjs` 게이트(소유권 유일성)** | ★자동(CI) |
| **중복(spec 간) — 의미적** | 키는 다른데 의도 같음(reworded) | 같은 Entity 이웃 spec과 좁힌 LLM diff + (선택)임베딩 유사도. **절차·어휘는 게이트화**: `## Dedup-Review` 기록 존재(`check-spec-completeness`) + `entityRegistry` 등록제(`check-ownership`) | 반자동(기록·어휘는 ★자동) |
| **리뷰 안 된 스펙** | Draft 스펙이 코드를 이끎 / 리뷰 기록 없이 Reviewed 이상 | **수명주기 게이트(SPEC-008)**: Draft 소유 코드 차단(`check-spec-sync` staged) + Status enum·`## Review Log` 존재(`check-spec-completeness`) | ★자동(CI) |
| **과대 spec(입도)** | 한 spec에 여러 기능 욱여넣음(under-fragmentation) — 키/FR 과다 | **`check-spec-cohesion.mjs` 게이트(dedup의 거울상, advisory)** | ★자동(CI) |
| **불완전 spec** | FR 있는데 SC·인수조건 없음 | **`check-spec-completeness.mjs`(존재만, advisory)** · 충족·측정가능성=`/checklist` | ★자동(CI) |
| **모순/충돌** | FR끼리 상충 | `/analyze` | 자동 |
| **커버리지 누락** | 수용기준인데 task/test 없음, FR인데 컴포넌트 없음 | `/analyze` | 자동 |
| **모호어·검증불가** | should/적절히, 측정불가 SC, 2동작 | EARS 작성규칙 + `/checklist` | 반자동 |
| **추적성 끊김** | FR↔plan↔task↔test 끊김 | `/analyze` + **FR-ID 태깅 + check-fr-coverage.mjs** | 자동(CI) |
| **원칙 위반** | constitution 위배 | `/speckit.constitution` | 반자동 |
| **재도출 스코프 누락** | 재생성이 src 밖 소스(IaC/CI/운영문서/이력/의도)를 조용히 안 읽음 | **`check-derivation.mjs`(SPEC-009)**: 소스 9클래스 회계 + 실재↔선언 교차검사 | ★자동(CI) |
| **의도 기록 누락** | 변경의 "왜"가 어디에도 안 남음(사후 재도출 불가) | **completeness의 Change Log 근거 검사(SPEC-009)** + Review Log·Dedup-Review(SPEC-008) — 존재만 | ★자동(CI) |
| **미검증 FR(회계 누락)** | 모든 FR이 unit/smoke/deferred/planned 중 하나로 회계됐나 — "조용히 미검증" | **검증 회계(SPEC-007)**: `requireAccounting` R3 exit 1 · `smokeManifest` dangling/빈 값 exit 1 · `strictSpecs` | ★자동(CI) |
| **증거 드리프트** | `@verifies` 태그와 `smokeManifest`가 어긋남 | **`sdd-smoke-scan.mjs`(SPEC-010)**: 태그 수집→매니페스트 재생성·check 드리프트 exit 1 | ★자동(CI) |
| **접두어↔클래스 오분류** | 소유 실파일이 전적 iac→INFRA·ci→CICD인데 접두어 불일치 | **prefix-class(SPEC-012)**: `check-fr-coverage` exit 1 · `prefixClassExemptions` 사유 관문 | ★자동(CI) |
| **스펙 문법 위반** | Module 헤더 부재/다값 · FR 라인 SHALL 없음 · Dedup 참조 미실재 · Files 카테고리 | **grammar(SPEC-013)**: completeness·ownership·spec-sync 배선(warn·`--strict`/staged hard) | ★자동(CI) |
| **번호 체계 분기** | 접두어별 001 시작·중복·중간 gap | **numbering(SPEC-014)**: `check-fr-coverage`(중복·비-001 hard · gap advisory) | ★자동(CI) |
| **테스트 인프라 누수** | `testInfraGlobs` 매치 파일을 제품(비-TEST) 스펙이 소유 | **test-domain(SPEC-015)**: `check-fr-coverage` exit 1 · `Lifecycle: removable` 관례 | ★자동(CI) |
| **스토리지 결정 미기록** | `objectStorageMarkers` 매치인데 버킷 선택·이전(consolidation) 기준 없음 | **object-storage(SPEC-016)**: completeness advisory(`--strict` hard) | ★자동(CI) |
| **관계 대상 미실재·순환** | `Entity (relation-type)` 대상을 어느 스펙도 안 소유 / aggregate 간 순환 | **relation(SPEC-017)**: `check-ownership` 실재 hard · 순환 advisory | ★자동(CI) |
| **유령 명세·번호 gap 누적** | 필요 없어진 SPEC/FR을 안 지우고 누적 / 폐기가 남긴 gap을 사고성 결번과 혼동 | **retirement(SPEC-018)**: `sdd-retire`(폐기 계획·재sync) · `Status: Planned` 회계 · `retiredIds` numbering gap | 반자동(커맨드+게이트) |
| **의미 방치(semantic drift)** | 소유 파일 리네임·목적변경인데 FR 본문이 옛 의미 유지 | **semantic-drift(SPEC-019)**: 리네임 감지→"FR 라인 변경 ∨ Spec-Impact" 승격(`semanticDriftPolicy`) | ★자동(트리거) + 리뷰(의미) |
| **공유 표면 억지 Change Log** | 타 스펙 기능 때문에 고친 공유 파일에 비-동인 스펙이 잡음 Change Log | **cross-spec(SPEC-020)**: `Change-Driver` 트레일러로 진짜 동인 기록·참조 완화 | ★자동(배선) |
| **커버리지 green ≠ 실행 green** | 태그 회계는 green인데 스위트가 실제로 안 돌거나 실패 | **test-execution(SPEC-021)**: `runTestsPolicy`로 `commands.test` 실행·exit 0 요구(opt-in) | ★자동(opt-in) + 완료 규범 |
| **배포 스키마 드리프트(R2′)** | spec↔code green인데 배포 DB에 컬럼 미적용(42703) | **schema-drift(SPEC-022)**: 배포 preflight에서 코드 기대↔배포 실측 diff(`schemaDriftManifest`) | ★자동(opt-in, 배포 preflight) |
| **capability 귀속 위반(기술 계층 스펙)** | entity 0개인데 capability 소유 / 남의 entity 위 capability — 스펙 경계=entity 기준 붕괴 | **capability-ownership(SPEC-024)**: `check-ownership`이 entity 조각 ∈ 소유 Entities 대조(`capabilityOwnershipPolicy`) | ★자동(advisory 기본) |
| **수사적 bold(키 앵커 오염)** | FR 라인의 bold가 장식(키 아님) — FR→키 원천이 본문에 무흔적 | **key-anchor(SPEC-023)**: `frKeyAnchorPolicy`로 bold↔소유·참조 키 대조(advisory·hard) | ★자동(opt-in) |

**요약:** 빈공란=`/clarify`, 한 기능 내 중복·모순·누락=`/analyze`, 체크리스트=`/checklist`, FR↔test=CI 게이트. **spec 간 중복**은 — **구조적**(같은 소유 키)=소유권 게이트로 **강제**, **의미적**(reworded)=좁힌 LLM 리뷰로 보조하되 *검토 기록의 존재*(`Dedup-Review`)와 *entity 어휘*(`entityRegistry`)는 게이트가 강제. (LLM은 누락을 내므로 결정적 게이트가 1차. 상세: `DEDUP.md` / `STRUCTURE.md` 소유권 유일성 규칙.)

**이 체크리스트의 실행이 곧 Reviewed 전이다(SPEC-008):** `/analyze`+`/checklist`를 수행한 결과를 스펙의 `## Review Log`(일시·수행자·판정)에, 이웃 중복 검토를 `## Dedup-Review`에 기록하고 `Status: Reviewed`(이상)로 승격한다 — Draft인 채로는 소유 코드 변경이 commit-msg에서 막힌다. 기록의 존재는 completeness 게이트가 검사한다(내용의 질은 사람 몫 — 과장 금지).

> 표기 규약: 위 `check-*.mjs`는 Node 파일명일 뿐 — 핵심 3커맨드(fr·ownership·run)·ID 문법은 Go 바이너리·셸·Python·Node 4판 동작 동일(`principles.md` §10). 단 **보강·회계 계층(SPEC-007·012~017 등)은 Node·Python 두 판만**(셸/Go는 핵심 판정까지 — 정직한 델타, SPEC-006·`ci-examples.md` 매트릭스). 소유 키 종류는 `sdd.config.json`의 `ownershipCategories`(웹 기본=Entity/Surface/Capability, 비-웹은 교체).
