# Feature Specification: SC Coverage (비기능 검증의 1급 회계 — SC·NFR 검증 바인딩)

**Module**: `sdd-tooling`  **Spec**: `SPEC-034`  **Created**: 2026-08-02  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(운영 대시보드 인스턴스) — 부하 테스트와 보안/침투 테스트를 준비했는데 SDD 궤도가 이를 자동으로 스펙에 귀속시키지 못했다. 사람이 "TEST-002가 맞다"고 수동 판단해야 했고 그 전까지 산출물은 스펙 없이 scratchpad에 남았다. 원인은 회계의 비대칭이다: `check-fr-coverage`는 FR만 회계하고(unit ∨ e2e ∨ smoke ∨ deferred), **Success Criteria·NFR은 산문으로만 존재**해 "이 목표를 무엇이 검증하나"를 강제하는 게이트가 없었다 — 성능·보안 목표가 검증 바인딩 없이 방치돼도 green이다.

---

## User Scenarios & Testing

### User Story 1 — 성능·보안 목표도 검증에 묶인다 (P1)
스펙 저자가 SC·NFR을 적으면 게이트가 각 항목에 검증 바인딩을 요구한다: 실행 가능한 검증 경로를 지목하거나(`[검증: tests/load/x.js]`), 실행 불가면 증거·사유로 회계한다(`evidenceManifest`). 검증 종류(unit·e2e·load·pentest…)는 사람이 손으로 적지 않고 **경로가 어디 있는지로 기계가 유도**한다.
- **Independent Test**: `sc-coverage.test.mjs`가 순수 코어(라인 파싱·종류 유도·매니페스트 무결성·분류)와 게이트 배선(off/advisory/hard·미회계 지목·skipped 없음)을 단독 검증. [검증: tooling/__tests__/sc-coverage.test.mjs]
- **Acceptance (GWT)**: 1. **Given** `scCoveragePolicy: hard` and an SC line with no tag and no manifest entry, **When** the gate runs, **Then** it names that SC and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **새 문법을 만들지 않는다** — 바인딩은 SPEC-031이 이미 강제하는 `[검증: <경로>]`를 그대로 쓴다. 종류를 별도 태그로 적게 하면 그 자체가 또 하나의 자기신고가 되므로, 분류는 `verificationKinds` 글롭이 경로에서 유도한다(사람은 태그 하나만 단다).
- **`[미확인]`만 적은 것은 회계가 아니다** — 정직한 자기신고지만 "아무도 안 봤음"과 구분되지 않는다. `evidenceManifest`에 사유와 함께 착지해야 회계로 인정된다.
- 매니페스트 무결성은 판정 **전에** 검사한다(smokeManifest 동형): 키 형식, `kind` 없음, `deferred`인데 `reason` 없음, 그 외인데 `evidence` 없음 → 즉시 exit 1. 사유 없는 유예는 미검증을 문서 형태로 세탁하는 것이다.
- 종류 글롭 미선언이면 모든 바인딩이 `other`로 분류된다 — **회계는 성립한다**(분류 불명이 미회계는 아니다).
- `hard`인데 SC·NFR 선언 라인이 하나도 없으면 거짓 안전이라 exit 1(다른 게이트의 inert 규칙과 동형).
- 기본 `off`. 선언 라인 문법(`- **SC-001**: …`)은 템플릿 형식이라 미채택 프로젝트는 비용 0.
- **선언 형식 드리프트를 게이트가 스스로 본다** — 라인 **머리**가 굵은 SC/NFR 토큰인데 선언으로 파싱되지 않으면 형식 불일치로 표면화한다(어떤 강도에서도). 실측 제보의 요지는 "정규식이 한 형태를 놓쳤다"가 아니라 **"놓친 것이 경고 없이 사라졌다"**였다 — 미회계로도 안 잡히고 항목 수에서 아예 빠졌다. 정규식은 고쳤지만 다음 형태 변이는 또 조용히 빠질 것이므로 **변이 자체**를 표면화한다. 라인 머리로 한정하는 이유: 산문 중간의 `**SC-002**가 그것을 본다` 같은 언급은 선언이 아니다(SPEC-002의 팬텀 교훈).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `scCoveragePolicy` is off, **check-sc-coverage.mjs** (S) SHALL perform no evaluation and exit zero.
- **FR-002** (event): WHEN the policy is advisory or hard, the **sc-coverage** (E) core in **sc-coverage-lib.mjs** (S) SHALL collect every Success Criteria and Non-Functional Requirement declaration line from every spec and classify each as verified, evidence, deferred, or unaccounted. — capability: **sc-coverage.account** (C).
- **FR-003** (event): WHERE a declaration carries an evidence tag, THE SYSTEM SHALL derive its verification kind from the pointer path using the declared kind globs, and SHALL report an unmatched pointer as other rather than as unaccounted.
- **FR-004** (unwanted): IF the evidence manifest has an entry with a malformed key, a missing kind, a deferred entry without a rationale, or a non-deferred entry without an evidence pointer, THEN THE SYSTEM SHALL report each error and exit non-zero before judging.
- **FR-005** (unwanted): IF a declaration has neither an evidence tag nor a manifest entry, THEN THE SYSTEM SHALL name it as unaccounted and, under hard, exit non-zero.
- **FR-006** (unwanted): IF the policy is hard while no declaration exists at all, THEN THE SYSTEM SHALL report the false safety and exit non-zero.

### Key Entities
- **sc-coverage** — the accounting that binds every stated success criterion and non-functional requirement to something that verifies it, so that performance, availability, and security goals cannot pass as prose the way functional requirements no longer can.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: sc-coverage
- **Symbols**: sc-coverage-lib.mjs, check-sc-coverage.mjs
- **Artifacts**: —
- **Capabilities**: sc-coverage.account
- **Files**: tooling/sc-coverage-lib.mjs, tooling/check-sc-coverage.mjs, tooling/__tests__/sc-coverage.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob·Python 복제·sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). FR 검증 회계는 SPEC-007이 소유하고 이 spec은 SC·NFR 축만 담당한다. `[검증]` 태그 문법과 증거 등급은 SPEC-031 소유.
- **Modules**: key-pipeline (references), verification-accounting (references), execution-evidence (references), runtime-parity (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `sc-coverage.test.mjs` 전 케이스 green + 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/sc-coverage.test.mjs]
- **SC-002**: 재현 픽스처에서 태그 있는 SC는 verified·매니페스트 evidence/deferred는 각 구간·태그도 매니페스트도 없는 SC는 미회계로 지목되고, hard에서 exit 1. [검증: tooling/__tests__/sc-coverage.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 정규식 파싱·집합 대조만의 순수 함수라 결정적이며, 파일 읽기·글롭 컴파일은 소비 게이트가 수행한다(런타임 미러 가능성 보존). [검증: tooling/__tests__/sc-coverage.test.mjs]

## Assumptions / Clarifications Retained
- 증거의 **질**은 판정하지 않는다 — 존재와 회계만 본다(smokeManifest와 같은 경계). "이 부하 시나리오가 정말 그 SC를 재현하나"는 스펙 리뷰 몫이다.
- 비기능 TEST 스펙 아키타입(부하·침투를 담는 TEST-NNN 유형)은 규범 문서가 정의하고, 이 게이트는 그 스펙의 SC가 검증에 묶였는지만 본다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-02 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티) + 소유자 개선 요청(비기능 검증 1급 회계) → Active | FR-001~006 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-02 이웃 SPEC-007(verification-accounting): 비중복 — 007은 **FR**의 검증 클래스 회계(unit·e2e·smoke·deferred), 이 spec은 **SC·NFR** 축. 대상이 요구 vs 성공기준으로 갈린다.
- 2026-08-02 이웃 SPEC-031(execution-evidence): 비중복 — 031은 `[검증]` 태그가 **실행 가능한 것을 지목하는가**(증거 등급), 이 spec은 **모든 SC·NFR이 바인딩을 갖는가**(전수성). 질 vs 전수성이다.
- 2026-08-02 이웃 SPEC-010(smoke-scan): 비중복 — 010은 `@verifies` 태그 수집·매니페스트 자동 채움(수집 실행), 이 spec은 SC·NFR의 회계 규칙. 수집 vs 규칙이다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | `scDeclDrift` 신설 — 라인 머리가 굵은 SC/NFR 토큰인데 선언으로 파싱되지 않으면 표면화(강도 무관) | 실측 제보 ③: `**NFR-001** (security):` 형태가 회계에서 **조용히 빠졌다**. 정규식의 분류 접미 허용은 이미 고쳐져 있었지만 제보의 진짜 요지는 다른 것이었다 — **누락이 경고 없이 일어난다**(회계 게이트가 자기 사각을 못 본다). 한 형태를 고치는 것은 다음 형태 변이를 막지 못하므로, 변이 자체를 신호로 만든다. 사실의 노출은 정책 강도와 무관하다: 강도는 차단 여부만 정한다 [검증: tooling/__tests__/sc-coverage.test.mjs] |
| 2026-08-02 | 초안 — `scCoveragePolicy`(off\|advisory\|hard) + `verificationKinds`(경로→종류 유도 글롭) + `evidenceManifest`(증거·유예 회계) + `sc-coverage-lib`(라인 파싱·분류) + `check-sc-coverage` 게이트 + sdd-sync R11, Node·Python 바이트 패리티 | 실측 제보: 부하·침투 테스트가 스펙에 자동 귀속되지 못하고 scratchpad에 남았다. 회계가 FR에만 있어 성능·보안 목표는 산문으로 방치돼도 green이었다. 새 태그 문법을 만들지 않고 SPEC-031의 `[검증]`을 재사용하며, 종류는 경로에서 유도해 자기신고를 피한다 |
| 2026-08-02 | `SC_DECL_RE`가 분류 접미 `(security)`·`(performance)`를 허용 — FR 선언 정규식이 EARS 분류를 받는 것과 일관. Node·Python 동시 | 실측 제보(gsn-aiops-finops-module): `- **NFR-001** (security): …` 형태가 **미회계로도 안 잡히고** 집계에서 조용히 사라졌다. 킷 자신에 적용하니 SC·NFR 항목 수가 110 → 118로 늘어, 회계 게이트가 자기 사각을 8건 갖고 있었음이 드러났다 [검증: tooling/__tests__/sc-coverage.test.mjs] |
| 2026-08-02 | 킷 자기적용 `scCoveragePolicy: advisory → **hard**` — SC·NFR 120건 전부 회계(verified 118·evidence 1·deferred 1·미회계 0). `verificationKinds`에 `ci` 추가, `evidenceManifest` 최초 사용(CICD-001 2건) | 백로그 101건을 소진했다. 결속 경로는 **추측 금지** 3출처뿐: ①SC 문장이 백틱으로 스스로 지목한 테스트 ②도그푸딩 주장 → 킷에 게이트를 돌리는 CI ③그 외 → 그 스펙이 Ownership.Files로 소유 선언한 테스트. 남은 2건은 레포 밖 실행 로그라 매니페스트로 착지 — CICD-001/SC-002는 음성 대조 실험 미실행이라 **deferred+사유**(정직한 미검증이 회계된 자리) [검증: tooling/__tests__/sc-coverage.test.mjs] |
