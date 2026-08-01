# Feature Specification: Live Reality (라이브 대조 — 저장소 밖 진실과의 일치)

**Module**: `sdd-tooling`  **Spec**: `SPEC-032`  **Created**: 2026-07-30  **Status**: Active
**Input**: 소비 프로젝트 실측(gsn-ai-pm, 가오픈 점검) — 게이트 8종이 전부 저장소 **안**만 본다. 그 결과 (a) terraform state가 17일 정지(serial 50, 마지막 apply 2026-07-15, 작성 CLI 1.13.5인데 코드 `required_version >= 1.15` → init 실패), (b) 코드에 선언됐으나 state에 없는 모듈 6건(전부 CLI out-of-band 생성, import 미실행), (c) NAT Gateway가 state에도 없고 재생성 스케줄 DISABLED — **아무도 소유하지 않는 자원**(사라지면 egress 상실 = 로그인·스토리지·알림·이미지 pull 동시 정지), (d) 라이브 ConfigMap 해시 ≠ 저장소 매니페스트 해시인데 저장소를 정본으로 믿고 apply해 **라이브가 회귀**(정상 렌더되던 패널까지 전멸). 인프라 스펙의 대상은 클라우드 실물인데 검증은 저장소 안에서만 하므로 이 전부가 무증상이다. 이 spec은 **저장소 밖 진실을 보는 유일한 게이트**를 별도 등급으로 도입한다.

---

## User Scenarios & Testing

### User Story 1 — 선언과 실물의 어긋남을 목록으로 본다 (P1)
프로젝트가 `liveRealityChecks`로 명령을 주입하면(인프라 무관 어댑터), 게이트가 각 명령을 실행해 **stdout 한 줄 = 위반 항목 하나**로 읽는다 — terraform state에 없는 선언 모듈, 라이브와 다른 매니페스트, 무소유 자원이 각각 목록으로 출력된다. 자격증명·네트워크가 없어 명령이 실패하면 **skipped(reason)**으로 명시하고 통과한다(하드 실패 금지).
- **Independent Test**: `live-reality.test.mjs`가 순수 코어(설정 무결성·결과 분류·집계)와 게이트 배선(off/advisory/hard·위반 목록·skipped·inert)을 단독 검증. [검증: tooling/__tests__/live-reality.test.mjs]
- **Acceptance (GWT)**: 1. **Given** `liveRealityPolicy: hard` and a terraform check whose command prints two module names, **When** the gate runs, **Then** it lists both items under that check and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **실행 실패는 언제나 skipped이며 위반으로 승격하지 않는다** — 오프라인·자격증명 없음·바이너리 없음·타임아웃 전부. 자격증명 없는 CI에서 인프라 게이트가 빌드를 깨면 채택이 불가능하다는 제약이다. 대신 skipped는 매 실행 **사유와 함께** 출력되고 "위반 없음이 아니라 판정 못 함"이라고 명시된다(조용한 green 금지).
- 정책이 켜졌는데 `liveRealityChecks`가 비면 **inert 고지**, hard면 exit 1 — "hard 선언 + 무판정"은 거짓 안전(SPEC-002 FR-010 동형).
- 인프라 무관: 게이트는 terraform·kubectl·클라우드 SDK를 알지 못한다. `kind`(terraform/kubernetes/ownership/custom)는 **출력 분류용 라벨**일 뿐 판정 로직이 아니다 — 무엇을 어떻게 조회할지는 전적으로 주입된 명령의 몫이다.
- 위반이 있으면 **회귀 방향 규범**을 함께 출력한다(APPLYING §라이브 우선 대조): 라이브가 저장소보다 최신이면 저장소를 먼저 라이브에 맞춘 뒤(drift 흡수) 변경을 얹는다. 낡은 저장소를 그대로 apply하면 라이브가 되돌아간다(실측 사고).
- 대조 결과는 해당 인프라 스펙의 Change Log에 남긴다(무엇이 어긋났고 어느 방향으로 해소했는지) — 게이트가 그 규범을 출력으로 유도하되, 기록 자체는 사람·리뷰 몫이다.
- 기본 `off` — 명령 주입이 없으면 비용 0. 킷 자신은 클라우드 자원이 없어 off(inert)다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `liveRealityPolicy` is off, **check-live-reality.mjs** (S) SHALL perform no evaluation and exit zero. — capability: **live-reality.judge** (C).
- **FR-002** (unwanted): IF a `liveRealityChecks` entry lacks an id or command, duplicates an id, or names an unknown kind, THEN THE SYSTEM SHALL report each config error and exit non-zero before running anything.
- **FR-003** (event): WHEN the policy is advisory or hard and checks are declared, the **live-reality** (E) classifier in **live-reality-lib.mjs** (S) SHALL run each command in the repository root and read every non-empty stdout line as one violation item, treating empty output as clean.
- **FR-004** (unwanted): IF a check command exits non-zero or times out, THEN THE SYSTEM SHALL classify that check as skipped with the failure reason and SHALL NOT count it as a violation, so that credential-less and offline environments pass.
- **FR-005** (unwanted): IF violations exist, THEN THE SYSTEM SHALL list them per check with counts, emit the regression-direction norm (live-first reconciliation) and the Change Log requirement, exiting non-zero under hard and warning under advisory.
- **FR-006** (state): WHILE the policy is not off and no checks are declared, THE SYSTEM SHALL disclose the inert state on every run and exit non-zero under hard (a hard declaration that judges nothing is false safety).

### Key Entities
- **live reality** — the state of the deployed world (cloud resources, cluster objects, IaC state) that an infrastructure spec actually governs, as distinct from the repository files that merely declare it; the gap between the two is invisible to every repository-only gate.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: live-reality
- **Symbols**: live-reality-lib.mjs, check-live-reality.mjs
- **Artifacts**: —
- **Capabilities**: live-reality.judge
- **Files**: tooling/live-reality-lib.mjs, tooling/check-live-reality.mjs, tooling/__tests__/live-reality.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob·Python 복제·sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). 이 spec은 라이브 대조 판정 코어와 게이트만.
- **Modules**: key-pipeline (references), runtime-parity (references), harness-install (references), execution-evidence (references), runtime-schema-drift (references)

---

## Success Criteria (측정형)
- **SC-001**: `live-reality.test.mjs` 전 케이스 green + 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/live-reality.test.mjs]
- **SC-002**: 재현 픽스처에서 terraform·kubernetes·ownership 위반이 각각 목록으로 출력되고, 바이너리 없는 환경(자격증명 없음 대리)에서는 전부 skipped(사유 포함)로 hard에서도 exit 0. [검증: tooling/__tests__/live-reality.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 실행 결과(exit code·stdout·stderr) → 분류의 순수 함수라 결정적으로 단위 테스트되고, 명령 실행·타임아웃은 소비 게이트가 수행한다.

## Assumptions / Clarifications Retained
- "무엇이 라이브 진실인가"는 주입된 명령이 답한다 — 게이트는 클라우드 API·state 포맷을 알지 못하고, 알아서도 안 된다(인프라 무관성이 이식성의 전제).
- skipped는 부채다. 자격증명 있는 환경(배포 파이프라인·운영자 로컬)에서 주기적으로 돌지 않으면 이 축은 사실상 꺼진 것이다 — 그 배선은 프로젝트 CI의 몫이다.
- 이 게이트는 **탐지**만 한다. 해소(import·apply·drift 흡수)는 사람이 방향을 정해 수행하며, 방향 규범은 APPLYING(라이브 우선 대조)이 정본이다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-30 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·위반/skipped/inert 3분기 실측) + owner 개정 요청("라이브 대조 게이트 신설, 자격증명 없으면 skipped") → Active | FR-001~006 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-30 이웃 SPEC-022(runtime-schema-drift): 비중복 — SPEC-022는 **코드 기대 스키마 ↔ 배포 DB 실측**이라는 단일 축의 전용 게이트(배포 preflight), 이 spec은 IaC state·클러스터 오브젝트·자원 소유권을 **주입 어댑터**로 일반화한 축이다. 같은 "저장소 밖" 계열이나 대상과 계약(한 줄=한 위반)이 다르다.
- 2026-07-30 이웃 SPEC-031(execution-evidence): 비중복 — 같은 "선언↔런타임" 축의 두 절반. SPEC-031은 저장소 안에서 증거 자산 지목을, 이 spec은 저장소 밖 실물 일치를 판정한다.
- 2026-07-30 이웃 SPEC-003(spec-sync): 비중복 — SPEC-003은 코드↔스펙 동반 변경(문서 정합), 이 spec은 선언↔실물 정합. 축이 다르다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-30 | 초안 — `liveRealityPolicy`(off\|advisory\|hard) + `liveRealityChecks`(주입 어댑터, stdout 한 줄=위반 1건) + `liveRealityTimeoutMs` + `live-reality-lib`(분류·집계) + `check-live-reality` 게이트 + sdd-sync R9, Node·Python 바이트 패리티 | owner 개정 요청 R2(실측 gsn-ai-pm): terraform state 17일 정지·선언 모듈 6건 state 부재·NAT Gateway 무소유·라이브↔저장소 해시 불일치가 전부 게이트에 무증상. 제약대로 실행 실패는 skipped(reason)로 두어 자격증명 없는 환경에서 하드 실패하지 않는다 |
