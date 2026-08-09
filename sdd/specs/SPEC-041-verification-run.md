# Feature Specification: Verification Run (존재는 실행이 아니다 — 조용히 사라진 검증)

**Module**: `sdd-tooling`  **Spec**: `SPEC-041`  **Created**: 2026-08-09  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10) — 검증 절차가 **세 번 조용히 사라졌다.** ① 에이전트가 "재현 데이터가 없다"며 실측을 중도 포기했는데 어떤 게이트도 걸리지 않았다. ② 검증 러너가 처리 대상 0건으로 `exit 0` 종료해 "성공"과 "아무것도 안 함"이 구분되지 않았다. ③ 배포 훅 Job이 참조 이미지가 없어 **한 번도 뜨지 않았고**(ECR 리포지토리조차 없음), 비차단 스테이지라 파이프라인은 SUCCESS로 초록이었다. 공통 원인: 게이트는 spec↔code 정합만 검사하고 **런타임에 검증이 실제로 수행됐는지**는 아무도 검사하지 않는다 — 그래서 "무행동"이 "성공"과 동형이 된다. SPEC-031은 `[검증: <경로>]`가 실재하는 자산을 지목하는지까지 봤다. 그다음 질문이 없었다: **그 자산이 돌았는가.**

---

## User Scenarios & Testing

### User Story 1 — 돌았다는 기록이 없으면 안 돈 것이다 (P1)
검증 자산이 저장소에 존재한다는 것과 그것이 실행됐다는 것은 다른 사실이다. 실행 원장(JSONL)을 판정 입력으로 삼아 선언된 증거와 대조하고, 기록이 아예 없는 자산을 **침묵**으로 지목한다.
- **Independent Test**: `verification-run.test.mjs`가 순수 코어(줄 파싱·깨진 줄 보존·매칭 폭·마지막 기록 우선·강도 처분·왕복)와 게이트(원장 미선언 inert·침묵 표면화/차단·기록 후 통과·증거 0건 inert·정책 enum)를 단독 검증. [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a requirement whose evidence names a test file, **When** no ledger entry covers that file, **Then** the gate reports it as unrecorded and blocks under hard.

### User Story 2 — 포기는 허용하되 침묵은 금지한다 (P1)
재현 데이터 없음·404·권한 부족으로 검증을 못 하는 일은 정당하게 일어난다. 막을 것은 포기가 아니라 **말 없이 사라지는 것**이다. 사유가 붙은 미실행은 어떤 강도에서도 차단하지 않고 부채로만 표면화한다 — 차단하면 사람이 사유를 지어내고, 그 순간 원장이 거짓말을 담기 시작한다.
- **Independent Test**: 같은 테스트가 사유 없는 포기를 기록기 입구에서 거부하는 것과, 사유 있는 포기가 `hard`에서 통과하며 매 실행 표면화되는 것을 검증. [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a stage that could not run because a prerequisite resource is absent, **When** it records that outcome with a reason, **Then** the gate surfaces it as debt and does not block.

### User Story 3 — 러너가 자기 실행을 기록한다 (P1)
"대상 0건으로 끝났다"를 성공과 가르는 것은 러너 자신뿐이다. 스위트 실행 게이트가 결과 종류를 원장에 남기고, CI 스테이지는 자기 전제 자원을 검사해 못 떴으면 그 사실을 남긴다.
- **Independent Test**: 킷 자기적용 — 스위트가 green이면 `JUDGED`, 실패하면 통과 기록으로 남지 않는 것을 실측으로 확인. [검증: tooling/__tests__/verification-run.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a suite that fails, **When** the runner records its outcome, **Then** the ledger does not contain a judged entry for that asset.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **`outcome`은 SPEC-040의 다섯 종류를 그대로 쓴다** — 게이트와 검증 절차가 같은 어휘로 말하지 않으면 "안 봤다"가 두 가지 뜻을 갖고, 두 뜻은 언젠가 갈라진다.
- **깨진 줄을 버리지 않는다** — 버리면 "기록했는데 형식이 틀림"이 "기록 안 함"과 같아지고, 그건 이 층이 막으려는 침묵과 정확히 같은 모양이다.
- **매칭 폭은 SPEC-031의 증거 경로 인정 폭과 같다**(정확·디렉토리·글롭) — 좁히면 정당한 스위트 지목이 거짓 미실행이 된다.
- **같은 자산에 여러 기록이면 마지막이 유효하다** — 원장은 append-only 로그다.
- **원장 미선언은 `INERT`다** — 판정 입력이 없는 상태를 "위반 0건"으로 말하지 않는다(SPEC-040). `hard`인데 원장이 없으면 그건 거짓 안전이라 차단한다.
- **선언된 증거가 0건이어도 `INERT`다** — 대조할 축이 없는 것을 "다 돌았다"로 세지 않는다(그 0건은 SPEC-031의 표기 부채다).
- **원장은 세션·CI 로컬 상태라 커밋 대상이 아니다** — `.sdd/`처럼 무시 경로에 둔다. 신선한 체크아웃에서 비어 있는 것이 정상이고, 그 비어 있음이 곧 "이 실행에서는 아직 아무것도 안 돌았다"는 참인 진술이다.
- 기본 `advisory`. `hard`는 러너·CI 스테이지 배선이 끝난 뒤가 종착지다(래칫이 하향을 막는다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the policy is advisory or hard and a run ledger is declared, the **verification-run** (E) core in **verification-run-lib.mjs** (S) SHALL match each declared evidence path against the ledger — accepting exact, directory, and glob assets and taking the last entry per asset — and SHALL classify it as executed, reasoned-debt, or unrecorded. — capability: **verification-run.account** (C).
- **FR-002** (unwanted): IF a declared evidence path has no covering ledger entry, THEN **check-verification-executed.mjs** (S) SHALL report it as unrecorded, warning under advisory and exiting non-zero under hard; a ledger line that is unparseable, names no asset, carries an unknown outcome, or records a non-judged outcome without a reason SHALL be reported as a broken record under the same strength.
- **FR-003** (state): WHILE an outcome other than judged carries a reason, THE SYSTEM SHALL surface it as debt on every run and SHALL NOT block at any strength; WHERE no ledger is declared or no evidence path exists, THE SYSTEM SHALL declare itself inert rather than reporting zero violations.
- **FR-004** (event): WHEN a runner or stage completes, it SHALL record its own outcome through the recorder, which SHALL refuse to append a non-judged entry that carries no reason so that silence cannot enter the ledger. — capability: **verification-run.record** (C).

### Key Entities
- **verification-run** — the fact that a declared verification asset actually ran, as distinct from that asset existing in the repository, so that "the test file is there" cannot pass for "the test ran".

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: verification-run
- **Symbols**: verification-run-lib.mjs, check-verification-executed.mjs
- **Artifacts**: —
- **Capabilities**: verification-run.account, verification-run.record
- **Files**: tooling/verification-run-lib.mjs, tooling/check-verification-executed.mjs, tooling/__tests__/verification-run.test.mjs

## Dependencies (참조 — dedup 제외)
> 증거 표기 문법은 SPEC-031, 경로 추출은 SPEC-039의 코어, 판정 종류는 SPEC-040, 러너는 SPEC-021, Python 복제는 SPEC-006 소유.
- **Modules**: execution-evidence (references), gate-verdict (references), covers-backlink (references), test-execution (references)
- **Symbols**: check-test-run.mjs

---

## Success Criteria (측정형)
- **SC-001**: `verification-run.test.mjs` 전 케이스 green — 코어 6종(사유 없는 포기 거부·깨진 줄 보존·매칭 3형태·마지막 우선·강도 처분·왕복) + 게이트 9종(원장 미선언 inert·hard 거짓안전 차단·침묵 표면화/차단·기록 후 통과·기록기 입구 거부·깨진 기록 차단·증거 0건 inert·off 명시·enum). [검증: tooling/__tests__/verification-run.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다 — 원장 미선언·침묵 차단·기록 후 통과 세 갈래에서 확인. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 스위트 실패가 통과 기록으로 남지 않는다 — 실패 시 원장 항목의 outcome이 judged가 아니다. [검증: tooling/__tests__/verification-run.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 글롭 컴파일·파일 읽기·시각 획득은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/verification-run.test.mjs]

## Assumptions / Clarifications Retained
- 기록이 **참인지**는 판정하지 않는다 — 러너가 "green"이라 기록했는데 실제로 아무것도 안 돌았다면 그건 러너의 거짓말이고, 이 층은 기록의 존재와 형식만 센다(존재는 기계, 진실성은 리뷰 — SPEC-031과 같은 경계).
- **기각한 대안:** 게이트가 검증 자산을 **직접 실행**해 확인하는 방식. 언어·러너·자격증명·비용이 전부 프로젝트마다 달라 킷이 실행 주체가 되면 언어 무관과 의존성 0을 동시에 잃는다(SPEC-021이 이미 `commands.test` 위임으로 그 경계를 세웠다). 재검토 조건: 없음 — 실행은 프로젝트가 하고 킷은 그 기록을 회계한다.
- **기각한 대안:** 기록 신선도(마지막 실행이 N일 이전이면 위반)를 도입하는 방식. 시간 임계는 프로젝트마다 다르고, 임계를 넘긴 순간 대량 위반이 떠서 사람이 정책을 끈다 — SPEC-033의 후보 신선도가 어떤 강도에서도 차단하지 않는 것과 같은 이유다. 재검토 조건: 원장이 정착한 뒤 "오래된 기록이 최신인 척하는" 실측이 나오면 **비차단 표면화**로만 도입한다.
- **기각한 대안:** 원장을 커밋해 이력으로 남기는 방식. 실행 기록은 세션·CI 로컬 상태라 커밋하면 머지 충돌이 상시화되고, 남의 실행 기록이 내 체크아웃에서 "돌았다"로 읽힌다 — 그게 정확히 이 층이 막으려는 거짓이다. 재검토 조건: 없음.
- 제보의 `no-silent-zero`·비차단 스테이지 규범은 이 spec의 원장과 SPEC-040의 판정 타입이 함께 구현한다 — 러너는 0건을 `INERT`로 기록하고(성공과 구분), 안 뜬 스테이지는 전제 자원 부재를 사유로 남긴다(초록에 묻히지 않는다).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-09 | 셀프리뷰(순수 코어 TDD·게이트 e2e 9종·Python 미러 바이트 패리티·킷 자기적용 배선) + 소비 프로젝트 개선 요청(조용한 종료/포기를 게이트가 못 잡음) → Active | FR-001~004 unit 커버. 킷 자기적용: 선언 증거 53건 중 침묵 0건(러너 자기기록 + CI 스테이지 자기기록으로 배선) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-09 이웃 SPEC-031(execution-evidence): 비중복 — 031은 `[검증]`이 **실행 가능한 자산을 지목하는가**(문서 축), 041은 그 자산이 **돌았는가**(실행 축)다. 031이 만든 표기를 041이 대조 대상으로 소비한다. 존재는 실행이 아니다.
- 2026-08-09 이웃 SPEC-040(gate-verdict): 비중복 — 040은 **킷 게이트 자신**이 무엇을 했는지, 041은 **게이트 밖의 검증 절차**가 무엇을 했는지다. 같은 다섯 종류를 쓰지만 묻는 대상이 다르고, 041이 040의 어휘를 재사용하는 것이 설계다.
- 2026-08-09 이웃 SPEC-021(test-execution): 비중복 — 021은 `commands.test`를 **실행**하고, 041은 그 실행이 **기록됐는지** 회계한다. 실행 vs 회계이고, 021의 게이트가 041의 기록기를 호출하는 것이 두 스펙의 접점이다.
- 2026-08-09 이웃 SPEC-007(verification-accounting): 비중복 — 007은 FR이 어느 클래스로 회계되는가(unit/smoke/deferred — **계획**), 041은 그 계획이 실제로 집행됐는가(**실행**)다. 분류 vs 집행이다.
- 2026-08-09 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 행위 자체의 전제·승인·생존을 보고, 041은 검증 자산 일반의 실행 기록을 본다. 035의 스모크 미선언 부채가 041의 침묵과 같은 계열이지만 대상이 배포 명령 vs 선언된 증거다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-09 | 초안 — `verificationRunPolicy`(off\|advisory\|hard, 기본 advisory) + `verificationRunLedger`·`verificationRunListCap`·`verificationRunTestAssets` + `verification-run-lib`(줄 파싱·분류·강도 처분·직렬화) + `check-verification-executed`(판정 + `--record` 기록기) + R14 규칙 등재 + `check-test-run`의 러너 자기기록 + CI 스테이지 자기기록. Node·Python 바이트 패리티 | 실측 제보: 검증 절차가 세 번 조용히 사라졌고(중도 포기·대상 0건 exit 0·전제 자원 부재로 미실행) 어떤 게이트도 걸리지 않았다 — spec↔code 정합만 보는 층에서는 **무행동과 성공이 동형**이다. 막을 것은 포기가 아니라 침묵이므로 사유 있는 미실행은 어떤 강도에서도 차단하지 않고 부채로만 표면화한다(차단하면 사유를 지어내고 원장이 거짓말을 담는다). 킷 자기적용에서 선언 증거 53건이 전부 "기록 없음"으로 떠, 러너와 CI 스테이지가 자기 결과를 남기도록 배선해 0으로 수렴시켰다 [검증: tooling/__tests__/verification-run.test.mjs] |
| 2026-08-09 | `verificationRunPolicy` advisory→**hard** 승격 + `verificationRunEnvBound`(환경 결속 선언) 신설 | 킷 자기적용에서 침묵 0건이 되어 승격 조건을 충족했으나, 승격 즉시 **교착**이 드러났다: `.github/workflows/sdd-gates.yml`은 GitHub Actions에서만 도는데 원장은 `.sdd/`(gitignore)라 "여기선 못 돈다"는 항구적 사실을 담지 못한다 — 로컬 스윕이 영구히 붉어지고, 영구히 붉은 게이트는 무시된다. **정책을 내리는 대신 막힌 출구를 열었다**(킷 규범: 교착의 해소는 캡을 푸는 것이 아니라 출구를 만드는 것): config에 `{ <glob>: <사유> }`로 선언하면 **침묵이 사유 있는 부채로** 바뀐다. 면제가 아니다 — 실행됨으로 세지 않고 매 실행 표면화하며, 실제 기록이 있으면 그쪽이 이긴다. 사유 없는 결속 항목은 조용한 면제라 무시한다 [검증: tooling/__tests__/verification-run.test.mjs] |
