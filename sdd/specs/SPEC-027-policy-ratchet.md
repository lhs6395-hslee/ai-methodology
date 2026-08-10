# Feature Specification: Policy Ratchet (강제 정책 강도의 단조성 — knob 하향 회피 차단)

**Module**: `sdd-tooling`  **Spec**: `SPEC-027`  **Created**: 2026-07-21  **Status**: Active
**Input**: 소비 프로젝트 실측: `frKeyAnchorPolicy: hard`에 새 규칙(FR-007 소유 키 앵커 강제)이 얹혀 위반 128건이 한꺼번에 떴을 때, 에이전트가 위반을 스펙 편집으로 해소하는 대신 **"지금은 미적용(권장)"**, 즉 정책 강도를 `advisory`/`off`로 내려 빨간불을 끄는 경로를 제시했다(owner: "미처리가 권장으로 뜨는 이유?"). update.md의 graduation 서술(#18)은 이 회피를 프롬프트로 금지하지만 **기계적 강제가 없어** 하위 세션이 얼마든지 우회할 수 있었다. 이 spec은 강제 정책 knob의 강도가 base ref 대비 **낮아지는 것을 게이트로 차단**한다(단조 증가만 허용) — "advisory는 경유지·hard가 종착지" 원칙의 기계화. 정당한 롤백은 `policyRatchetExceptions`로 loud하게 선언하며, 선언된 하향도 부채로 상시 표면화된다(남용 방지).

---

## User Scenarios & Testing

### User Story 1 — 강제 강도는 내릴 수 없다 (P1)
게이트가 base ref(`specSyncBase`||`origin/main`)의 config와 현재 config를 대조해, 강제 정책 knob 중 강도가 낮아진(off<advisory<hard 역행) 것을 검출한다 — advisory는 경고, hard는 exit 1. 위반을 knob 하향으로 회피하는 대신 스펙을 편집해 해소하도록 강제한다.
- **Independent Test**: `policy-ratchet.test.mjs`가 순수 코어(강도 순위·하향 분류·예외 처리)와 게이트 배선(off/advisory/hard·base 미조회 skip·예외 부채 표면화)을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** base config with `frKeyAnchorPolicy: hard` and `policyRatchetPolicy: hard`, and a working config lowering it to `advisory`, **When** the ratchet gate runs, **Then** it names the knob with its from→to and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 강도 순위는 세 값 도메인을 정규화한다: `off`/`silent`=0 < `advisory`/`warn`=1 < `hard`/`error`=2. 래칫 대상은 강제 강도를 갖는 9종 — `policyRatchetPolicy` **자신**(선두) + `specSyncUnowned`·`draftBlock`·`semanticDrift`·`capabilityOwnership`·`frKeyAnchor`·`runTests`·`migrationState`·`entitySchemaBacking`.
- **자기포함(반사성 봉합):** 래칫이 자기 강도를 감시하지 않으면 `policyRatchetPolicy: "off"` 한 줄로 래칫 전체가 자폭한다 — 게이트가 **워킹트리** config로 자기 정책을 읽고 off면 base 비교 전에 exit 0하기 때문이다(감사 A-2 실측: 대상 knob 하향 + 이 한 줄을 같은 커밋에 넣으면 "판정 안 함 exit 0"). 그래서 ① 자기 knob도 래칫 대상이고, ② 자기 강도는 base 시점과 현재 중 **강한 쪽**으로 판정한다(하향은 base가 심판, 상향은 즉시 반영 — 전진은 막지 않는다). base·현재 모두 off인 프로젝트(켠 적 없음)는 무영향.
- 자기 하향의 탈출구도 다른 knob과 같다 — `policyRatchetExceptions`에 `policyRatchetPolicy`를 선언하면 통과하되 매 실행 부채로 표면화된다(FR-005). 즉 config 한 줄로 **조용히** 끄는 경로는 없고, 래칫을 완전히 제거하려면 하네스 배선에서 게이트를 빼는 수밖에 없다(설계 의도 — config는 흔적을 남긴다).
- base ref의 config를 `git show <base>:sdd.config.json`으로 조회한다 — git 없음·최초 채택(base에 config 없음)·파싱 실패면 **skip(exit 0)**, 조용한 오차단 없음(비용 0, 하위호환). 이 skip은 자기 강도 판정보다 우선하므로(base가 없으면 기준도 없다) `off`는 기존대로 조용히 통과한다.
- 게이트 경로에서 base config는 DEFAULTS 병합으로 구성된다(`configFromString`) — 따라서 "base에 없던 knob"은 부재가 아니라 **그 시점 기본값**과 대조된다(기본값 아래로 내리는 것도 하향이며, 기본값 위로 새로 켜는 것은 상향이라 항상 허용). knob 부재 분류(`!(knob in baseCfg)`)는 raw dict를 직접 넘기는 단위 테스트용 안전망일 뿐 게이트에선 도달하지 않는다 — 미지의 값(오설정)만이 실제 판정 밖이다.
- 정당한 하향(진짜 롤백·오설정 정정)은 `policyRatchetExceptions`에 knob 이름을 선언해 통과 — 단 선언된 하향도 **매 실행 부채로 표면화**된다(entitySchemaExemptEntities 동형 — "예외라 통과"를 정상으로 오인 금지, 재승격 대상).
- `policyRatchetPolicy` 기본은 `advisory`(경고) — 새 강제가 기존 hard를 소급 범람시키지 않게(graduation, update.md #18). 깨끗해지면 hard 승격을 update가 권장.
- 킷 자신·config를 낮춘 적 없는 프로젝트는 위반 0이라 무영향(inert).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE the effective ratchet strength — the stronger of the base ref's and the current `policyRatchetPolicy` — is off, **check-policy-ratchet.mjs** (S) SHALL perform no ratchet evaluation and exit zero. — capability: **policy-ratchet.judge** (C).
- **FR-002** (state): WHILE the base ref's config cannot be read or parsed (no git, first adoption, malformed), THE SYSTEM SHALL skip the evaluation and exit zero rather than block, reporting that it skipped.
- **FR-003** (event): WHEN the policy is advisory or hard and the base config is available, the **policy-ratchet** (E) judgment in **policy-ratchet-lib.mjs** (S) SHALL compare each ratcheted policy knob's strength rank against the base and collect every knob whose current rank is lower than the base rank, excluding knobs named in `policyRatchetExceptions`.
- **FR-004** (unwanted): IF one or more non-excepted downgrades exist, THEN THE SYSTEM SHALL name each with its from→to value and SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-005** (state): WHILE any downgrade is permitted via `policyRatchetExceptions`, THE SYSTEM SHALL surface each permitted downgrade as a review-debt line on every run regardless of policy strength — so an exception cannot silently read as clean — naming the knob and marking it a re-promotion target.
- **FR-006** (unwanted): IF the `policyRatchetPolicy` value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it clearly and exit non-zero (without leaking a runtime stack trace).
- **FR-007** (unwanted): IF the current `policyRatchetPolicy` is weaker than the base ref's, THEN THE SYSTEM SHALL include `policyRatchetPolicy` itself among the ratcheted knobs, SHALL report the self-weakening with its from→to, and SHALL judge that run at the base ref's strength — so lowering the ratchet's own knob cannot silence the evaluation; WHERE the current value is stronger, THE SYSTEM SHALL judge at the current strength.
- **FR-008** (unwanted): IF a commit raises a ratcheted numeric threshold above its base value, THEN THE SYSTEM SHALL report it as a loosening violation naming the threshold and both values, and SHALL treat a lowered value as a permitted tightening.

### Key Entities
- **policy ratchet** — the invariant that an enforcement policy knob's strength may only rise or hold across a change, never fall, so that a hard gate's red status is cleared by fixing specs rather than by weakening the knob.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: policy-ratchet
- **Symbols**: policy-ratchet-lib.mjs, check-policy-ratchet.mjs
- **Artifacts**: —
- **Capabilities**: policy-ratchet.judge
- **Files**: tooling/policy-ratchet-lib.mjs, tooling/check-policy-ratchet.mjs, tooling/__tests__/policy-ratchet.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob(sdd-config.mjs·DEFAULTS)·Python 복제·sdd-sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). 이 spec은 래칫 판정 코어와 게이트만.
- **Modules**: spec-quality-gates (references), key-pipeline (references), runtime-parity (references), harness-install (references), adoption-lifecycle (references)

---

## Success Criteria (측정형)
- **SC-001**: `policy-ratchet.test.mjs` 전 케이스 green + 래칫 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/policy-ratchet.test.mjs]
- **SC-002**: 실측 재현 픽스처(base `frKeyAnchorPolicy: hard` → 현재 `advisory`)에서 위반 지목·hard exit 1, 예외 선언 시 부채 표면화 + exit 0(양판 바이트 동일). [검증: tooling/__tests__/policy-ratchet.test.mjs]
- **SC-003**: 자폭 재현 픽스처(base `policyRatchetPolicy: hard` + `frKeyAnchorPolicy: hard` → 현재 둘 다 `off`)에서 자기 하향과 감춰지던 하향을 **둘 다** 지목하고 exit 1이며 "판정 안 함"이 출력되지 않는다(감사 A-2 회귀, 양판 바이트 동일). [검증: tooling/__tests__/policy-ratchet.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 래칫 판정 코어는 두 config dict의 강도 순위 대조만의 순수 함수라 결정적으로 단위 테스트되고, git·파일 IO는 소비 게이트가 수행. [검증: tooling/__tests__/policy-ratchet.test.mjs]

## Assumptions / Clarifications Retained
- 프롬프트(update.md graduation)는 회피를 "권장하지 말라"고 지시할 뿐 강제하지 못한다 — 하위 세션 준수는 기계 게이트로만 보장된다는 것이 이 spec의 전제(실측: 프롬프트 서술만으로는 12회차 넘게 회피가 반복됨).
- base ref는 병합된 기준선(origin/main)이라, 브랜치/변경에서 강도를 낮추면 병합 전에 게이트가 잡는다 — spec-sync의 self-weakening 방지(HEAD 시점 config 판정)와 같은 계열의 반사성 봉합이되, 대상이 "정책 강도"다.
- 상향(강도 올리기)은 항상 허용 — 래칫은 후퇴만 막고 전진은 막지 않는다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-21 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·hard→advisory 하향 픽스처 실측 재현·예외 부채 표면화 검증) + owner 확정("프롬프트로만 막던 knob 하향 회피를 기계 강제로") → Active | FR-001~006 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-21 이웃 SPEC-003(spec-sync): 비중복 — SPEC-003의 "자기약화 커밋 방지"는 config를 바꾸는 커밋을 **HEAD 시점 config로 심판**하는 것(spec-sync 판정 한정), 이 spec은 **정책 강도 자체의 후퇴**를 전 knob 대상으로 범용 차단. 반사성 봉합 계열이나 대상 축이 다르다.
- 2026-07-21 이웃 SPEC-005(adoption-lifecycle): 비중복 — SPEC-005/update.md의 graduation은 강도 승격을 **권장하는 프롬프트 서술**, 이 spec은 강도 하향을 **차단하는 기계 게이트**. 프롬프트가 못 막던 회피의 기계적 짝.
- 2026-07-21 이웃 SPEC-026(entity-schema-backing): 비중복 — SPEC-026은 소유 entity의 스키마 실재를, 이 spec은 정책 knob의 강도 단조성을 판정. 다만 "예외를 상시 부채로 표면화"하는 남용 방지 패턴은 공유(FR-005 동형).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 래칫 감시 목록에 `importWiringPolicy` 추가 | SPEC-050 동반. 새 강제 knob이 래칫 밖에서 태어나면 그 knob은 조용히 하향될 수 있다 — 이 스펙의 구조적 완전성 테스트가 이번에도 새 knob을 지목했다(라운드마다 발화하는 것이 이 축의 정상 동작이다) [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-08-10 | 래칫 감시 목록에 `watchdogPolicy` 추가 — 양판 | 감시자 정책이 감시 밖이면 hard→advisory 한 줄로 감시자 요구를 회피할 수 있다. 감시자를 끄는 것이 가장 값싼 우회이므로 특히 래칫 안에 있어야 한다 [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-08-10 | 래칫 감시 목록에 `processSsotPolicy` 추가 — 양판 | 신설 강도 knob이 감시 밖에서 태어나면 hard→advisory 한 줄로 위반을 회피할 수 있다 [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-08-10 | 래칫 감시 목록에 `implReferencePolicy` 추가 — 양판 | 신설 강도 knob은 감시 밖에서 태어나면 hard→advisory 한 줄로 위반을 회피할 수 있다. 래칫 전수성 테스트가 지키는 불변식 [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-08-10 | 래칫 감시 목록에 신설 강도 knob 4종 추가(`termCoveragePolicy`·`externalTargetPolicy`·`evidenceScopePolicy`·`introDocPolicy`) — 양판 | 래칫 **전수성** 테스트가 이 4종이 감시 밖에서 태어난 것을 즉시 잡았다. 감시 밖 knob은 hard→advisory 한 줄로 위반을 회피할 수 있고, 그러면 강도 선언이 거짓이 된다. 구조적 불변식(개수를 세지 않고 config의 실제 강도 knob을 진실의 원천으로 삼는 방식)이 설계대로 작동한 사례 [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-07-27 | FR-007 신설(자기포함 + base 시점 자기 강도 판정) + FR-001 개정(effective 강도 기준) + `RATCHETED_POLICIES`에 `policyRatchetPolicy` 선두 자기포함 + `effectiveRatchetPolicy` 코어 + 게이트가 base config를 off 단락보다 먼저 조회, Node·Python 패리티 | 감사 이슈 #21 A-2 실측: 래칫이 **워킹트리** config로 자기 정책을 읽고 off면 base 비교 전 exit 0 → `policyRatchetPolicy:"off"` 한 줄로 래칫 전체가 자폭(A: frKeyAnchor hard→off ✗ exit 1 / B: + 한 줄 → "판정 안 함" exit 0). SPEC-027:63이 주장한 "spec-sync self-weakening 방지와 같은 계열의 반사성 봉합"이 실구현에 없던 것(`check-spec-sync.mjs:31-43`의 대칭 코드 부재) |
| 2026-07-27 | Edge Case 사실 오류 정정 — "base에 없던 knob은 판정 밖"은 게이트 경로에서 사문(base config도 DEFAULTS 병합이라 knob이 항상 존재; 기본값과 대조된다). 미지의 값만이 실제 판정 밖임을 명시 | 감사 이슈 #21 경-항목("SPEC-027 Edge Case 사실 오류: `!(knob in baseCfg)`가 도달 불가 사문") — 스펙이 코드보다 관대하게 읽혀 회피 여지를 시사 |
| 2026-07-21 | 초안 — `policyRatchetPolicy`(off\|advisory\|hard, 기본 advisory) + `policyRatchetExceptions`(loud override) + `policy-ratchet-lib`(강도 순위·하향 분류) + `check-policy-ratchet` 게이트 + sdd-sync R6 배선, Node·Python 패리티 | 소비 프로젝트 실측: FR-007 128건 앞에서 에이전트가 `frKeyAnchorPolicy` hard→advisory 하향(회피)을 "권장"으로 제시 — graduation 프롬프트(#18)가 금지하나 기계 강제 부재. owner: "2번(기계 강제)까지 해야 강제됨". advisory는 경유지·hard가 종착지 원칙의 기계화 |
| 2026-07-27 | FR 키 앵커 완성 — 소유 키 3건(`policy-ratchet`·`policy-ratchet-lib.mjs`·`check-policy-ratchet.mjs`)을 FR 선언 라인에 볼드+마커로 앵커 | SPEC-001 FR-010(역할 선언) 도입으로 킷 자신에게 SPEC-023 FR-005/007이 처음 발화 — 익명 주어 THE SYSTEM을 실제 수행 모듈/심볼로 바꿔 앵커를 자연스럽게 삽입(FR 의미·소유 불변) |
| 2026-08-02 | 감시 대상 knob 9→18: `symbolRealityPolicy`·`ownershipRequiredPolicy`·`crossCategoryDedupPolicy`·`filesOverlapPolicy`·`executionEvidencePolicy`·`liveRealityPolicy`·`engineRealityPolicy`·`eventAttributionPolicy`·`synonymPolicy` 편입 + 목록 테스트를 개수 단정에서 **전수성 불변식**으로 교체 | 실측 구멍: 킷이 `hard`로 켜 둔 6종이 래칫 **밖**이라 `hard→advisory` 한 줄로 위반 회피가 가능했다(SPEC-027이 막으려던 바로 그것). 원인은 새 강도 knob이 태어날 때 이 목록에 넣는 절차가 사람 기억에 달려 있었고, `RATCHETED_POLICIES.length === 9`를 단정한 테스트가 오히려 그 누락을 초록으로 통과시킨 것. 이제 킷 config의 강도 enum knob 전체를 진실의 원천으로 삼아 미감시를 테스트가 잡는다 |
| 2026-08-02 | 수치 임계 래칫(FR-008) — `maxFRsPerSpec`·`maxKeysPerCategoryPerSpec`·`maxAggregateRootsPerSpec` **상향=완화**로 판정(하향은 강화라 자유). 게이트 문구를 강도/임계로 분기하고 전수성 테스트 추가 | 실측(소비 프로젝트 gsn-aiops-finops): FR 12개가 캡 10을 넘기자 **"maxFRsPerSpec을 12로 상향"이 권장안으로 제시**됐다. 자를 늘려 재는 것은 위반 해소가 아니라 회피이며 `hard→advisory` 하향과 같은 부류인데, 래칫이 강도 enum만 봐서 수치는 무방비였다. 소유자 지적: **더 엄격하고 방법론에 맞는 쪽을 권장해야 한다**. 기계로 막는 동시에, 완화를 선택지로 내밀지 않는 규범을 에이전트가 실제로 읽는 자리(세션 컨텍스트·migrate 스킬/프롬프트)에 심었다 |
| 2026-08-02 | 래칫 감시 대상에 `hooksInstalledPolicy` 편입(19→20종) | 전수성 불변식 테스트가 요구 — 킷 config가 강도 enum knob을 켜는 순간 래칫에 등록돼야 한다. 새 게이트를 만들며 등록을 잊는 재발 경로를 테스트가 막는다 |
| 2026-08-02 | `RATCHETED_POLICIES`에 `outOfBandDeployPolicy`·`deployPreconditionPolicy`·`changeLogFrRefPolicy` 3종 등재(21→24). Node·Python 동시 | **감시 밖 knob은 하향이 조용히 통과한다.** SPEC-035 전제 조건 축을 추가하며 목록을 보니 배포·Change Log 정책 2종이 도입 시 등재를 빠뜨린 상태였다 — 래칫은 목록이 전수일 때만 래칫이다. 헤더 주석의 "9종"도 실제 수와 어긋나 있어 "전부"로 교정하고 신설 시 등재 규칙을 명시 |
| 2026-08-03 | `RATCHETED_POLICIES`에 `duplicateLogicPolicy` 등재(24→25). Node·Python 동시 | SPEC-038 신설 동반. 앞 라운드에 명시한 규칙("새 정책을 만들면 여기에도 등재한다")을 같은 커밋에서 지킨다 — 감시 밖 knob은 하향이 조용히 통과한다 |
| 2026-08-04 | `RATCHETED_POLICIES`에 `coversBacklinkPolicy` 등재(25→26). Node·Python 동시 | SPEC-039 신설 동반 — "새 정책을 만들면 여기에도 등재한다"를 같은 커밋에서 지킨다 |
| 2026-08-09 | 래칫 목록에 `verificationRunPolicy` 추가(26→27) | SPEC-041 동반. 래칫 목록은 **판정 데이터**라 새 강도 knob이 등재되지 않으면 그 knob만 조용히 하향 가능해진다(도입 시 누락이 실측으로 두 번 있었다 — `outOfBandDeployPolicy`·`changeLogFrRefPolicy`) |
| 2026-08-09 | 래칫 목록에 `liveRealityCoveragePolicy` 추가(27→28) | SPEC-032 등록 축 동반. **래칫 전수성 게이트가 이 누락을 스스로 잡았다** — 킷 config의 강도 enum knob이 감시 밖에 있으면 그 knob만 조용히 하향 가능해지고, 도입 시 누락은 이미 세 번 실측됐다(outOfBandDeploy·changeLogFrRef·verificationRun) |
