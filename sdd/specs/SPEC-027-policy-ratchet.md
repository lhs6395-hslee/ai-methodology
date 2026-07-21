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
- 강도 순위는 세 값 도메인을 정규화한다: `off`/`silent`=0 < `advisory`/`warn`=1 < `hard`/`error`=2. 래칫 대상은 강제 강도를 갖는 8종(`specSyncUnowned`·`draftBlock`·`semanticDrift`·`capabilityOwnership`·`frKeyAnchor`·`runTests`·`migrationState`·`entitySchemaBacking`).
- base ref의 config를 `git show <base>:sdd.config.json`으로 조회한다 — git 없음·최초 채택(base에 config 없음)·파싱 실패면 **skip(exit 0)**, 조용한 오차단 없음(비용 0, 하위호환).
- base에 없던 knob(최초 도입)·미지의 값은 판정 밖 — 래칫은 "존재하던 강도를 낮췄는가"만 심판하고, 새로 켜는 것은 항상 허용(상향은 자유).
- 정당한 하향(진짜 롤백·오설정 정정)은 `policyRatchetExceptions`에 knob 이름을 선언해 통과 — 단 선언된 하향도 **매 실행 부채로 표면화**된다(entitySchemaExemptEntities 동형 — "예외라 통과"를 정상으로 오인 금지, 재승격 대상).
- `policyRatchetPolicy` 기본은 `advisory`(경고) — 새 강제가 기존 hard를 소급 범람시키지 않게(graduation, update.md #18). 깨끗해지면 hard 승격을 update가 권장.
- 킷 자신·config를 낮춘 적 없는 프로젝트는 위반 0이라 무영향(inert).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `policyRatchetPolicy` is off, THE SYSTEM SHALL perform no ratchet evaluation and exit zero.
- **FR-002** (state): WHILE the base ref's config cannot be read or parsed (no git, first adoption, malformed), THE SYSTEM SHALL skip the evaluation and exit zero rather than block, reporting that it skipped.
- **FR-003** (event): WHEN the policy is advisory or hard and the base config is available, THE SYSTEM SHALL compare each ratcheted policy knob's strength rank against the base and collect every knob whose current rank is lower than the base rank, excluding knobs named in `policyRatchetExceptions`.
- **FR-004** (unwanted): IF one or more non-excepted downgrades exist, THEN THE SYSTEM SHALL name each with its from→to value and SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-005** (state): WHILE any downgrade is permitted via `policyRatchetExceptions`, THE SYSTEM SHALL surface each permitted downgrade as a review-debt line on every run regardless of policy strength — so an exception cannot silently read as clean — naming the knob and marking it a re-promotion target.
- **FR-006** (unwanted): IF the `policyRatchetPolicy` value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it clearly and exit non-zero (without leaking a runtime stack trace).

### Key Entities
- **policy ratchet** — the invariant that an enforcement policy knob's strength may only rise or hold across a change, never fall, so that a hard gate's red status is cleared by fixing specs rather than by weakening the knob.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: policy-ratchet
- **Symbols**: policy-ratchet-lib.mjs, check-policy-ratchet.mjs
- **Artifacts**: —
- **Files**: tooling/policy-ratchet-lib.mjs, tooling/check-policy-ratchet.mjs, tooling/__tests__/policy-ratchet.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob(sdd-config.mjs·DEFAULTS)·Python 복제·sdd-sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). 이 spec은 래칫 판정 코어와 게이트만.
- **Modules**: spec-quality-gates (references), key-pipeline (references), runtime-parity (references), harness-install (references), adoption-lifecycle (references)

---

## Success Criteria (측정형)
- **SC-001**: `policy-ratchet.test.mjs` 전 케이스 green + 래칫 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인).
- **SC-002**: 실측 재현 픽스처(base `frKeyAnchorPolicy: hard` → 현재 `advisory`)에서 위반 지목·hard exit 1, 예외 선언 시 부채 표면화 + exit 0(양판 바이트 동일).

## Non-Functional Requirements
- **NFR-001**: 래칫 판정 코어는 두 config dict의 강도 순위 대조만의 순수 함수라 결정적으로 단위 테스트되고, git·파일 IO는 소비 게이트가 수행.

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
| 2026-07-21 | 초안 — `policyRatchetPolicy`(off\|advisory\|hard, 기본 advisory) + `policyRatchetExceptions`(loud override) + `policy-ratchet-lib`(강도 순위·하향 분류) + `check-policy-ratchet` 게이트 + sdd-sync R6 배선, Node·Python 패리티 | 소비 프로젝트 실측: FR-007 128건 앞에서 에이전트가 `frKeyAnchorPolicy` hard→advisory 하향(회피)을 "권장"으로 제시 — graduation 프롬프트(#18)가 금지하나 기계 강제 부재. owner: "2번(기계 강제)까지 해야 강제됨". advisory는 경유지·hard가 종착지 원칙의 기계화 |
