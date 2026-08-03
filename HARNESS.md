# HARNESS — SDD 인터랙티브 sync 계약 (포터블)

> spec↔code 생애주기를 **사람-개입**으로 오케스트레이션하는 플로우 계약. 이 규칙표가 SSOT — 실행기(에이전트별)는 이 표를 해석한다. 탐지는 기존 게이트 재사용(판정 로직 신규 0). 결정은 항상 사람(작성=LLM, 승인=사람). 설계 근거: `docs/design/2026-06-30-harness-design.md`.

## 규칙표 {trigger, detect, ask, act}

| 규칙 | Trigger | Detect (게이트) | Ask (사람) | Act |
|---|---|---|---|---|
| **R1 spec→code** | spec 생성/변경 | `check-fr-coverage`(테스트 없는 FR ≈ 미구현 + 접두어↔클래스(SPEC-012, hard)·번호 무결성(SPEC-014)·TEST 인프라 격리(SPEC-015)·**Change Log가 선언한 FR의 실재**(SPEC-037 — `FR-018 신규`라고 적었으면 본문이 있어야 한다, `changeLogFrRefPolicy`)) | "이 FR들 코드 생성/업데이트?" | TDD(RED→GREEN) → 재검증 |
| **R2 code→spec** | 코드 변경·spec 무변경 | `check-converge-drift`·`check-orphan-surfaces`·`check-spec-sync`(range — Draft 소유 차단·unowned 정책 포함) | "기존 spec 개정 / 새 spec / 의도적 무시?" | `/converge`→intent→`/specify`(update·new)→`/analyze`→bless |
| **R3 dedup+입도+완전성+일관성** | spec 생성/변경 직후 | `check-ownership`(+`entityRegistry`·Files 카테고리 금지·Entity 관계(SPEC-017 — 실재 hard·순환 advisory)·Capability 귀속(SPEC-024 — entity 기준 스펙 경계))·`check-spec-cohesion`·`check-spec-completeness`(SC·인수조건 + 수명주기 기록 + Change Log 근거 + 문법 규범: Module 존재·단일성·SHALL·Dedup 참조 실재 + 오브젝트 스토리지 결정(SPEC-016 advisory))·`check-spec-consistency`(+FR 키 앵커 — bold↔소유·참조 키 대조, `frKeyAnchorPolicy`, SPEC-023) | "중복 통합 / 과대 spec 분할 / SC·인수조건·리뷰 기록·근거·문법 보강 / 근거 없는 키 정렬?" | 통합·분할·보강 → 재검증 |
| **R2′ code→deployed-runtime** | 배포 전(preflight) | `check-schema-drift`(코드 기대 스키마 ↔ 배포 DB 실측 diff — opt-in `schemaDriftManifest`, SPEC-022) | "배포 전 마이그레이션 적용 / baseline?" | migrate-on-deploy 또는 배포전 스키마 preflight |
| **R4 상시 sync** | push·주기·요청 | 위 일괄(`sdd-sync.mjs`) | drift → 해당 규칙 라우팅 | (R1/R2/R3의 act) |
| **R5 test 실행** | push(pre-push)·CI·완료 주장 시 | `check-test-run`(`runTestsPolicy` off=no-op·advisory·hard — `commands.test` 실행·exit 0 요구, SPEC-021) | "스위트 red — 완료 주장 전 green으로?" | 실패 테스트 수정 → 재실행 |
| **R8 실행 증거** | spec 저술·리뷰·CI | `check-evidence`(`[검증]`→실행 가능한 증거 경로 강제, SC 실행동사·UI 대상 등급 판정 — `executionEvidencePolicy` off=no-op·advisory·hard, SPEC-031) | "이 주장을 무엇으로 재현하나 — 경로가 있나?" | 증거 자산 작성 후 `[검증: <경로>]`로 지목, 없으면 자기신고 등급으로 정직하게 표기 |
| **R9 라이브 대조** | 배포 전·주기·가오픈 점검 | `check-live-reality`(저장소 밖 진실 — IaC state 미등재 선언, 라이브↔매니페스트 해시, 무소유 자원. 주입 어댑터 `liveRealityChecks`, 자격증명 없으면 **skipped(reason)**, SPEC-032) | "선언과 실물이 어긋났다 — 어느 쪽이 정본인가?" | 라이브가 최신이면 저장소를 먼저 맞춘 뒤(drift 흡수) 변경을 얹고, 결과를 인프라 스펙 Change Log에 기록 |
| **R10 동의어·형태 변이** | spec 생성/변경·주기 | `check-synonym`(dedup이 **키 문자열 유일성**만 보는 사각 — entity 역할 한정 3층: ①형태 변이(정규화 후 충돌)·②선언 동의어(`synonymRegistry`) = **결정적, `synonymPolicy` 강도대로 차단** / ③유사 후보(`entitySimilarityCommand` 주입) = **어떤 강도에서도 비차단**. 후보 목록 신선도(`# entity-set` 헤더 ↔ 현재 집합)도 비차단 advisory, SPEC-033) | "같은 실체면 정본 하나로 통일 / 다르면 기각 사유는? / 후보 목록이 낡았으면 재생성?" | 정본 통합(스펙 편집) 또는 `synonymReviewLedger`에 기각 사유 — 둘 다 **사유 필수**라 config 리뷰를 거친다 |
| **R11 SC·NFR 검증 회계** | spec 저술·리뷰·CI | `check-sc-coverage`(성공기준·비기능 목표가 검증 바인딩을 갖는가 — `[검증: 경로]` ∨ `evidenceManifest`의 증거·유예. FR만 회계하던 사각, `scCoveragePolicy` off=no-op·advisory·hard, SPEC-034) | "이 성능·보안 목표를 무엇이 검증하나 / 지금 못 돌리면 증거·사유는?" | 검증 자산 작성 후 `[검증: <경로>]`, 라이브 필요 시 `evidenceManifest`에 실행 로그·스냅샷 경로와 사유 |
| **R12 훅 배선 실재** | 채택·update·주기 | `check-hooks-installed`(선언된 훅이 `.git/hooks`에 설치·실행 가능·킷 훅인가 — 게이트 파일이 있어도 훅이 없으면 **한 번도 발동하지 않는다**. `hooksInstalledPolicy` off·advisory(기본)·hard, SPEC-036) | "강제가 실제로 걸려 있나 — 미설치·실행권한·남의 훅 점유?" | `sh scripts/sdd-hooks-install.sh`로 배선(설치기가 `hooks.list` 전체를 깔고 자기검증) |
| **R6 정책 래칫** | config 변경·push·CI | `check-policy-ratchet`(강제 강도의 단조성 — base 대비 **정책 knob 하향**과 **수치 임계 상향**(`maxFRsPerSpec` 등: 자를 늘려 재는 것도 완화다) 차단, `policyRatchetPolicy` off=no-op·advisory·hard, 예외는 `policyRatchetExceptions`, SPEC-027). **자기포함:** `policyRatchetPolicy` 자신도 래칫 대상이고 자기 강도는 base 시점과 현재 중 강한 쪽으로 판정된다 — 이 knob을 내려 판정을 끄는 한 줄 자폭이 불가하며, 정당한 롤백은 예외 선언(부채 표면화)으로만 가능 | "강도를 왜 낮췄나 / 캡을 왜 올렸나 — 위반은 **스펙 편집·분할·병합**으로 해소 / 진짜 재조정이면 예외 선언?" | knob 복원 또는 예외 선언 → 위반은 스펙 편집으로 소진 |

> **범위 밖(의도적):** `check-derivation`(재도출 소스 회계)·`sdd-smoke-scan`(증거 드리프트)은 이 하네스의 규칙표에 넣지 않는다 — 트리거가 "spec/코드 변경"이 아니라 **재채택(readopt)·증거 갱신** 이벤트라서다. 실행 지점은 readopt 절차(`prompts/readopt.md` 6~7단계)와 CI 스텝(`ci-examples.md`·`sdd-gates.yml` 주석)이 담당한다. `retag`는 게이트가 아니라 마이그레이션 도구(dry-run 기본)라 detect 대상이 아니다.

## 실행기 (Claude Code 1차 — 다른 에이전트는 같은 표로 자체 구현)
- **detect 집계:** `node scripts/sdd-sync.mjs [--strict]` → 규칙별 sync 리포트.
- **인터랙티브:** 스킬 `/sdd-sync` — 리포트 → 규칙별 사람 의사 확인 → act.
- **상시(R4·R5):** git pre-push 훅이 `sdd-sync.mjs`를 advisory 실행 → drift면 `/sdd-sync` 안내(기본 비차단, `SDD_SYNC_BLOCK=1`로 차단). R5(test 실행)는 같은 집계에 포함되고, 서버측 백스톱은 CI(킷 자신은 `.github/workflows/sdd-gates.yml`, CICD-001)가 담당.
- **병합 시점:** `pre-merge-commit` 훅이 pre-commit과 같은 품질 게이트를 무충돌 병합에도 실행 — 두 브랜치가 같은 스펙 번호·같은 ownership 키를 각자 들고 깨끗이 병합돼 main이 사후 red가 되는 경쟁 차단(감사 M5, `sdd-init`·self-hooks 배선).
- **비-Claude 에이전트(Kiro·Codex 등):** 슬래시 명령·SessionStart 주입은 Claude Code 편의 계층이다 — 강제(게이트+git 훅)와 절차(`prompts/`)는 실행기 무관이므로 슬래시를 못 써도 **같은 절차를 수동으로** 밟고 되묻지 않는다. 방법론 상시 주입은 그 에이전트의 상시-로드 문서(Kiro `.kiro/steering/sdd.md`·기타 `AGENTS.md`)에 이 규칙표/`sdd-session-context.sh` 출력을 옮겨 대체한다. 수동 첫-스펙 절차는 `prompts/adopt.md` §"에이전트 무관 실행".

## 불변
- 어느 방향도 **자동 덮어쓰기 금지** — 사람 의사 확인 게이트 필수.
- 탐지는 advisory 1차; `--strict` 승격은 팀 선택.
- **게이트 stdout이 판정의 정본** — 집계기는 게이트 stdout을 `⚠`/`✗`로 스캔한다. 그래서 게이트는 자기 판정 줄만 stdout에 쓰고 하위 프로세스(테스트 러너 등) 출력은 stderr로 보낸다. 어기면 green이 ⚠로 읽힌다(감사 M-8 실측: 킷 테스트 *이름*의 ⚠·✗ 31줄에 R5가 걸려 항상 "확인 필요" — 초록이 경고로 읽히면 사람이 ⚠를 무시하는 습관을 들여 진짜 경고를 놓친다).
- **라이브에 반영된 것은 커밋 전이라도 spec Change Log에 먼저 착지해야 한다** — 강제 지점은 커밋만이 아니다. `kubectl apply`·`helm upgrade`처럼 **배포가 커밋보다 먼저**인 궤도에서는 commit-msg 훅까지 아무 신호가 없어 그 사이 spec↔live 드리프트가 누적된다(실측: INFRA-005 역방향 흡수). PostToolUse 배포 가드(SPEC-035)가 배포 직후 상기시키되 **차단하지 않는다** — 이미 실행된 것을 막는 척하는 게이트는 신뢰를 잃는다. 차단은 커밋·CI가 계속 담당한다. **`advisory`와 `hard`의 차이는 부채 적재다** — 배포 시점의 비차단은 두 강도가 같지만(막을 대상이 없다), `hard`는 미기록 배포를 부채 파일에 적재하고 pre-commit이 그 잔여로 커밋을 막는다. 터미널 경고는 스크롤과 함께 죽고 파일은 남는다 — 승격해도 아무것도 달라지지 않는 정책은 승격 대상이 아니라 장식이다(실측 제보: 둘이 구분 불가능했다). 부채는 **소유 스펙 Change Log 행이 스테이징되는 순간에만** 자동 해소된다(파일을 지우는 것은 갚는 것이 아니다).
- **우회를 유발하는 강제는 강제가 아니다** — 훅이 수십 초 걸리면 사람은 `--no-verify`로 우회하고 그 순간 훅 전체가 무의미해진다(실측: 스윕 30.3초 중 R5 스위트 실행이 29.8초, 나머지 10규칙 0.5초 → 매 push가 멈춰 우회가 습관이 됐다). 훅 경로는 **몇 초 안에** 끝나야 한다. 다만 빼는 것은 **선언적 위임**이어야 한다 — `syncHookRules`로 실행 규칙을 적고 `syncHookDelegatedTo`로 담당자를 밝히면(없으면 에러) 매 실행 "위임 — 담당: …"이 출력되므로 사유 있는 skipped와 같다. 시간 예산 초과분은 위임이 아니라 **미판정**으로 flagged된다(조용한 통과 금지).
- **완화를 선택지로 내밀지 않는다** — 위반 해소안을 제시할 때 강도 하향·수치 임계 상향·면제 추가를 **권장안으로 올리지 않는다**(실측: 캡 10을 FR 12개가 넘기자 "캡을 12로 상향"이 권장안으로 제시됐다). 자를 늘려 재는 것은 해소가 아니라 회피다. 정당한 해소는 분할·병합·스펙 편집이고, 진짜 재조정은 `policyRatchetExceptions`로 부채를 표면화한다 — 래칫이 강도·임계 양쪽을 감시하므로 조용한 완화는 어차피 exit 1이다.
- **범위 축소·이월도 권장으로 내밀지 않는다 — 배치(순서)와 범위(무엇을)를 섞지 마라.** 확인된 결함의 해소안을 낼 때 "일부만 지금 고치기"를 **권장**으로 올리면, 나머지 확인된 결함을 **안 고치는 것이 기본값**이 된다(실측: 데이터로 확인된 CRITICAL/HIGH 취약점 앞에서 "read측 치명상 4건만 (권장) / 전부 / 스펙에만 기록"이 제시됐다 — 권장이 부분 수정이었다). "한 라운드에 검증 가능한 크기"는 옳은 공학이지만 그건 **어떻게 나눠 착지시킬지(순서)**이지 **무엇을 고칠지(범위)**가 아니다. 기본 권장은 **확인된 것 전부**이고, 크기는 배치로 쪼갠다(한 스펙 = 한 커밋, 빅뱅 금지). 진짜로 이월한다면 회피가 아니라 **결정**이어야 한다 — 무엇을·왜·언제까지·누가 위험을 수용했는지를 함께 적는다(사유 없는 이월은 미수정을 문서 형태로 세탁하는 것이다). 보안 결함은 특히: "스펙에만 기록"은 취약점을 라이브에 남긴 채 기록만 남기는 것이라, 수용자와 기한 없이는 선택지가 아니다.
- **교착의 해소는 캡을 푸는 것이 아니라 출구를 만드는 것이다** — 규범 A가 규범 B의 유일한 해소 경로를 막으면, 남은 선택지는 완화뿐이 되고 완화는 위 불변이 금지한다. 그 상태는 사람의 잘못이 아니라 **규칙 집합의 결함**이다(실측 제보: aggregate를 가질 수 없는 계층이 FR 캡을 넘겼을 때 `entity(min)`이 분할을 막아, 남은 출구가 캡 상향뿐이었다). 고치는 방향은 **막힌 출구를 여는 것**이지 캡을 푸는 것이 아니다 — `supportLayerSpecs`는 `entity(min)` 하나만 면제하고 모든 캡을 그대로 둔다. 그리고 새로 연 출구는 **사유 필수 + 무결성 검사 + 상시 표면화**를 달고 나온다(면제는 조용히 '완료'가 되지 않는다).
- **같은 주장에 대한 두 개의 선언은 반드시 대조된다 — 그리고 등급은 라벨이 아니라 경로로 판정한다.** 본문의 `[미확인]`과 매니페스트의 실측 증거가 동시에 참인 채로 통과하면, 두 기록 모두 신뢰를 잃는다(실측 제보: `[미확인]` FR이 smokeManifest에 증거를 갖고 있었고 아무도 대조하지 않았다). 게이트는 어느 쪽이 맞는지 모른다 — **모순을 지목하고 하나를 고치게 한다**(R8, SPEC-031 FR-007). 관련해서 검증 방법을 주장별 라벨(`@verifies method=browser` 등)로 선언하는 설계는 **기각한다**: 파일 위치는 게이트가 검증할 수 있고 라벨은 자기신고다. 라벨을 도입하면 이 방법론이 존재하는 이유(산문 자기신고로 소비된 `[검증]`)를 한 층 위에 재생산한다. 관례 밖 경로는 config(`browserEvidencePatterns`·`verificationKinds`)로 넓힌다 — config는 한 번 선언하고 리뷰에 걸리지만, 라벨은 매 주장마다 반복되는 자기신고다.
- **확률적 판정에는 차단력을 주지 않는다** — LLM·임베딩이 낸 후보로 빌드를 깨면 그 오탐이 곧 방법론의 오류가 된다. 확률적 층은 "무엇을 볼지"만 정하고 "무엇이 참인지"는 사람이 결정적 층(정본 선언·기각 원장)으로 착지시킨다. 이건 산문 규범이 아니라 **코드 분기**이며 회귀 테스트로 고정된다(R10 ③, SPEC-033 FR-006). 같은 이유로 후보 목록의 낡음도 차단하지 않는다 — 커밋마다 재생성을 요구하면 사람이 그 층을 통째로 떼어낸다(회피를 유발하는 강제는 강제가 아니다).
- **`exit 0` ≠ "판정했음"** — 게이트가 한 줄도 출력하지 않으면 clean이 아니라 **미판정**(flagged)이고, 규칙표가 선언한 게이트가 설치돼 있지 않은 것도 미판정이다. 판정 대상이 없어 발화하지 않는 게이트는 "off/no-op/skip"이라고 **명시한 한 줄**을 낸다 — 침묵은 근거가 아니다(실측: 비-ASCII 경로에서 `check-test-run`이 무음 exit 0이라 `runTestsPolicy: hard`가 여러 라운드 거짓 green이었고 집계기는 clean으로 읽었다).
- 게이트는 런타임 중립(4판), 실행기만 에이전트별.
- 로컬 훅·TDD는 `commands.test`(로컬 안전 유닛)만, 인프라 테스트는 개발서버·CI에서 `commands.smoke` — 로컬은 인프라 의존 테스트를 강제하지 않는다. 정본: METHODOLOGY §"검증은 환경으로 계층화된다"(+ `sdd.config.presets` 테스트 tier).

## 완료 루프의 꼬리 — 원점 트래커 close-out
작업이 tracked issue(QA/이슈 트래커)에서 유래했다면 verify/merge가 끝이 아니다 — **①트래커 dev-done(개발자) → ②이해관계자 완료 보고(무엇·왜·어떻게+검증 경로) → ③리포터 confirm(리포터/QA)**까지가 완료다. **2인 책임분리**: 개발자는 리포터의 confirm을 건드리지 않는다. 외부 시스템·사람 sign-off라 게이트가 아니라 규범이며(SC 충족과 동일 — 리뷰 경계), 실행기는 `speckit-fix` 스킬 마지막 단계(§완료형 스킬)다. 트래커 정체·보고 채널(수신자·형식)은 킷에 하드코딩하지 않고 `trackerCloseout` config(또는 CLAUDE.md 관례)로 인스턴스화한다(`{}`=비활성).
