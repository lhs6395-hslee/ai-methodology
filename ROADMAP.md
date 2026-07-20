# ROADMAP — SDD 방법론 키트

> 현재 상태와 **의도적으로 보류한** 항목. 보류 항목은 모두 *"필요가 증명되면 그때"* — YAGNI + `REALITY_CHECK.md`(추측 아닌 실행 검증) 원칙대로, 소비자 없는 추측 인프라를 미리 짓지 않는다.

## ✅ 완료 (main 반영, github.com/lhs6395-hslee/ai-methodology)
- **Gap 1 — 1 레포 = 1 모듈**: 방법론 재기준화. 큰 프로그램 = 모듈-레포들의 MSA 합성. (`49dce2b`)
- **Gap 2 — spec 입도(cohesion)**: `check-spec-cohesion` advisory 게이트 = `check-ownership`(dedup)의 거울상. (`649e12a`)
- **Gap 3 — 하네스 MVP**: 포터블 계약 `HARNESS.md` + detect 집계기 `tooling/sdd-sync.mjs` + `/sdd-sync` 스킬 + pre-push 훅. (`0de8820`, `14f6303`)
- 강화 게이트 3종(test-adequacy / converge-drift / orphan-surfaces) + `sdd-init` 배선(node 게이트 전체 설치).
- **Ownership 키 결정성** — 소유/참조(`## Dependencies`) 분리 · 정규화 절대규칙 · verb 고정집합 · PREFIX 표준(SPEC/INFRA/TEST/CICD)+사유 관문 · 1 spec=1 aggregate · `check-spec-consistency` 신규. (`cc3dc22..acf5b6f`, 설계 `specs/2026-06-30-…`, 계획 `plans/2026-07-01-ownership-…`)
- **방법론 강제 hook 세트** — SessionStart(방법론 주입)·PreToolUse(편집 체크리스트)·git pre-commit(hard)·`sdd-init` 자동배선 · "채택=상시 강제 궤도" 원칙 · 사용법(`APPLYING`·`방법론.html`). (`cc3dc22..acf5b6f`, 설계 `specs/2026-07-01-…`, 계획 `plans/2026-07-01-methodology-…`)
- **spec-first 강제** — `Files:` 소유매핑 · `check-spec-sync`(changeset=브랜치, commit-msg hard + range advisory) · `/speckit.fix` · Edge Cases/Change Log 필수화 · 사용법·데모 실측(`APPLYING`·`방법론.html`·`README`). (`74a747b..acf5b6f`, 설계 `specs/2026-07-02-spec-first-enforcement-design.md`, 계획 `plans/2026-07-02-spec-first-enforcement.md`)
- **키트 자기 정렬(self-hosting)** — 키트 `tooling/`(게이트 스위트) 자신을 자기 궤도에 편입: 루트 `sdd.config.json`(비-웹 카테고리 Modules/Symbols/Artifacts) · `sdd/specs/`의 각 spec(1 aggregate씩, 게이트·lib 전부 소유) · 테스트 `@covers`로 FR 결선 — requireAccounting 상시 on(unaccounted 0, 미커버는 deferred로 정직 회계) · `self-hooks-install.sh`로 자기 훅 배선(tooling 직접 호출). **실증**: 스펙 미동반 tooling 커밋 → commit-msg FAIL(exit 1), `Spec-Impact: none <사유>` → 통과.

- **런타임 패리티(2026-07-05)** — Python판 전 게이트 패리티(같은 픽스처→같은 exit code·바이트 동일 출력, 테스트 강제) · `requirementIdPrefixes` 전 사이트 파생 · preset 템플릿 바이트 동일화 · 셸/Go 문법 정렬. (SPEC-006)
- **강제 강도 고도화 2차(2026-07-05)** — 진단(spec-first=동반변경 확인, 의미중복 반례, 스펙 리뷰 계층 부재)의 승인 보강 전부 반영:
  - **B-3 검증 회계(SPEC-007)**: `strictSpecs`(전역 --strict 점진 브리지) · `requireAccounting`(R3: 전 FR이 unit∨smoke∨deferred) · `smokeManifest`(사유 존재만 강제) — 키트 자신 requireAccounting 상시 on(미커버 FR은 deferred로 정직 회계).
  - **P1 스펙 수명주기(SPEC-008)**: Status enum 문법화 · Draft 소유 코드 commit-msg 차단 · Reviewed 이상 `Review Log` 기록 존재 검사 — 상태 순서 강제(시간 순서 아님), 레거시(Status 없음)는 warn(advisory→strict 승격 경로).
  - **P2 미소유 파일 정책**: `specSyncUnownedPolicy`(silent|warn|error) — 침묵 통과를 선언된 정책으로 승격(exempt 조합 탈출).
  - **P3 의미중복 절차 문법화**: `entityRegistry`(entity 등록제 — PREFIX 거버넌스 동형) + `## Dedup-Review` 기록 의무화(존재·형식만 — DEDUP.md 경계 유지).
  - 부수 발견 수정: git `core.quotepath` 비ASCII 경로 인용이 glob 매칭을 조용히 깨던 버그(도그푸딩 발견, 회귀 테스트).

- **완전 자동화 3차(2026-07-05)** — 두 프로젝트 재생성 비교[검증]에서 재생성이 지던 "레포 밖 맥락" 잔여 전부를 문법화:
  - **재도출 소스 회계(SPEC-009)**: 소스 9클래스 고정 enum + `derivationManifest` 전 클래스 회계 + 검출 교차검사(IaC 실재+none 선언=exit 1 — 소비 프로젝트 A의 "src 밖 안 읽음" 실패 모드 기계 차단) + **선제 캡처**(Change Log 실기록 행 근거 존재 검사 — 순수 인간 의도는 저술 시점에만 캡처 가능하다는 경계를 선언된 클래스(human-intent)로 명시).
  - **smoke 증거 자동 수집(SPEC-010)**: `@verifies` 태그(CI 정의·스크립트·runbook 어디든) → `smoke-scan --write` 매니페스트 결정적 재생성 + check 드리프트 차단 — 소비 프로젝트 B가 수동으로 잇던 실증거 연결 제거.
  - **추적 태그 마이그레이션(SPEC-011)**: 재도출은 FR 키 보존이 기본, 재번호는 맵+`retag` 기계 이행 — @covers 재연결 비용 제거.
  - 절차 정본화: `prompts/readopt.md` 6~7단계에 소스 클래스→산출물 매핑표·자동 결선 규칙. 키트 자신 `derivationManifest` 상시 on(9클래스 정직 회계).

- **규범 문법화·도메인 확장 4차(2026-07-06~09)** — 전 문서 감사·도그푸딩 실측에서 "규범은 문서에 있는데 게이트가 없던" 항목을 결정 신호만으로 문법화:
  - **접두어↔도출클래스 정합(SPEC-012)**: 소유 실파일을 derivation 소스 클래스(iac·ci)로 분류 — 비-테스트 소유가 전적 인프라인데 접두어가 INFRA-가 아니면 exit 1(`prefixClassExemptions` 사유 관문, 의미판정 아닌 선언 신호).
  - **스펙 문법 경화(SPEC-013)**: Module 헤더 존재·값 단일성 · FR 선언 라인 SHALL · Dedup-Review 이웃 스펙 실재 · `ownershipCategories` Files 금지(hard) · Files 미지원 글롭 staged 차단.
  - **Spec-ID 번호 무결성(SPEC-014)**: 접두어별 001부터·중복 금지(hard), 001..max 중간 gap은 advisory — 프로젝트 간 번호 체계 분기 차단(해소는 `sdd-retag`).
  - **TEST 삭제가능 도메인(SPEC-015)**: TEST를 런타임·인프라 자기완결 비제품 도메인으로 확장(prefix-class 면제) · `testInfraGlobs`로 제품 스펙 누수 격리 · `Lifecycle: removable`.
  - **오브젝트 스토리지 결정(SPEC-016)**: `objectStorageMarkers` 매치 스펙에 `## Object Storage Decision`(버킷 선택·이전 기준) 기록 강제 — completeness advisory(`--strict` hard).
  - **Entity 관계 정합(SPEC-017)**: 쪼갠 aggregate 사이 참조를 `Entity (relation-type)`로 구조화 — 대상 Entity 실재·소유 spec 해석 hard, aggregate 간 순환 참조 advisory.

- **정리·삭제·배포경계 확장 5차(2026-07-15~16)** — 도그푸딩(소비 프로젝트 B) 실측에서 "누적만 하고 정리·삭제·배포검증이 없던" 축을 문법화. 설계 `docs/design/2026-07-15-spec-retirement-and-drift.md`:
  - **명세 폐기 워크플로(SPEC-018)**: `sdd-retire`(dry-run/--write, all-or-nothing 재sync) + `Status: Planned` 회계(유령 명세 노이즈 제거) + `retiredIds` numbering retirement-gap — "누적 아니라 정리·삭제".
  - **semantic drift 승격(SPEC-019)**: 소유 파일 리네임 감지 → spec-sync 요구를 "FR 라인 변경 ∨ Spec-Impact"로 승격(`semanticDriftPolicy`) — 옛 의미 방치를 리뷰로 라우팅.
  - **cross-spec 변경 동인(SPEC-020)**: `Change-Driver` 트레일러로 공유 표면 변경 동인 추적·참조 완화 — 억지 Change Log 제거.
  - **테스트 실행 게이트(SPEC-021)**: `runTestsPolicy`로 `commands.test` 실제 실행·green 확인 — 커버리지 회계 ≠ 실행 결과. env-gated skip 관례 1급화.
  - **런타임 스키마 드리프트(SPEC-022, R2′)**: 코드 기대 스키마 ↔ 배포 DB 실측 diff(`check-schema-drift`, 배포 preflight) — spec↔code green ≠ 배포 안전.
  - 에이전트 중립화(강제 메시지·비-Claude 에이전트 컨텍스트 자동 배선) + change_log.html 자동 생성 + 소비 프로젝트 마찰 3종(조용한 훅 스킵·retrofit Reviewed·병렬 저술 프로토콜).

- **반사성·가장자리 감사 봉합 6차(2026-07-16)** — 적대적 전수 감사(이론=주장↔메커니즘 대조, 프로세스=전 절차 워크스루·픽스처 재현)에서 "강제 계층이 자기 자신을 보호하지 않던" 결함군을 문법화:
  - **config 자기보호(T1)**: `sdd.config.json` exempt 해제·스펙 소유 편입 + spec-sync staged 판정을 **HEAD 시점 config**로(자기약화 커밋 방지, SPEC-003 FR-002).
  - **상태 화이트리스트(T2)**: Draft 문자열 검사 → `canLeadCode`(Reviewed+) 반전 — Planned·enum 밖도 코드 차단(SPEC-008 FR-004) + Planned↔커버리지 모순 hard(SPEC-018 FR-007, 회계 침묵기 차단).
  - **탈출구 스코프 축소(T3·T4)**: `Spec-Impact: none` 면제를 동반·상태 차단으로 한정(글롭 문법·unowned closed-world 우회 불가) + `Change-Driver @glob` 경로 귀속(SPEC-020 FR-005, 전역 팬아웃 봉합).
  - **폐기 사슬 완결(P1·M3·M4)**: retire 계획에 inbound 참조 지목(SPEC-018 FR-008) + 폐기 ID 재사용 hard·최소번호 폐기 001-면제(SPEC-014 FR-001/004).
  - **강제 지점 이식성(P3·M5·M1·M2)**: pre-commit 경로 필터 제거(비-JS 레이아웃 미발동 봉합)·sh 훅 배선·`pre-merge-commit`(병합 시점 번호·키 경쟁 차단)·sdd-sync R5(test-run 배선)·`specSyncBase` knob·**킷 자신 CI**(`.github/workflows`, CICD-001 — closed-world `error`·`draftBlockPolicy: hard` 승격).

- **Capability 귀속(2026-07-20, SPEC-024)** — 소비 프로젝트 실측(budget-engine: Entities 0개+capability 4개) → owner 확정 "스펙 경계는 entity 기준 — entity 키 동일=같은 스펙, verb 상이=같은 스펙에 FR 신설, 참조는 relation": capability `x.verb`는 entity `x` 소유 스펙만(`capabilityOwnershipPolicy`, 기본 advisory — ownership 게이트 배선, Node·Python 바이트 패리티). METHODOLOGY "Dependencies의 entity여도 무방" 탈출구 문장 개정 + DEDUP·템플릿 예시 정합.
- **FR 키 앵커(2026-07-17, SPEC-023)** — 소비 프로젝트 실측(FR bold가 수사적 장식뿐)에서 owner 제안: **bold를 키 앵커 전용으로 예약** — FR 선언 라인의 평문 bold를 소유∪참조 키와 대조(`frKeyAnchorPolicy` off|advisory|hard, consistency 게이트 배선, 코드 스팬은 리터럴). consistency(키→본문)와 합쳐 양방향 앵커. 도입 즉시 킷 자신에서 수사적 bold 1건 실수확·정리(advisory 상시 on).

설계·계획 근거: `docs/design/` · `docs/superpowers/plans/`.

> **키트는 이제 자기 자신의 첫 소비자다.** 게이트가 키트 자신의 tooling 변경을 상시 강제하고(자기 훅), 자기 커버리지 갭(미커버 FR)까지 정직하게 드러낸다 — 지속적 도그푸딩.

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
- **소비 프로젝트 정본 갱신 반영**: 소비 프로젝트 A·소비 프로젝트 B에 이번 고도화(수명주기·회계·정책)를 재채택 절차로 반영 — 이번 작업 범위 밖(다음 단계).
- **도그푸딩**: 방법론을 실제 모듈(예: 소비 프로젝트 B)에 끝까지 돌려 전 사슬(spec→test→code→게이트→하네스)을 검증 → 위 보류 항목 중 *실제로* 필요한 것을 추측이 아니라 사례로 식별.

## 🚫 의도적 비목표
- **P4 시간 순서(temporal) 강제** — "spec 커밋이 코드 커밋보다 먼저"는 만들지 않는다. 파이프라인은 **같은 changeset 동반**과 **상태 순서**(Draft면 코드 금지)를 강제하며, 이는 브랜치 단위 작업 설계와 충돌하지 않는 의도된 선택이다.
