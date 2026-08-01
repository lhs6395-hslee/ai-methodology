# Feature Specification: Execution Evidence (실행 증거 등급 — `[검증]`을 실행 가능한 경로로 강제)

**Module**: `sdd-tooling`  **Spec**: `SPEC-031`  **Created**: 2026-07-30  **Status**: Active
**Input**: 소비 프로젝트 실측(gsn-ai-pm, 가오픈 점검) — `npm run check:sdd` 8종 게이트 **전부 통과** 상태에서 Grafana 대시보드 패널 30여 개가 죽어 있었다. INFRA-005 FR-017~023이 5개 대시보드를 규정하고 `[검증]` 태그가 붙어 있었으며 SC-002는 "각 대시보드가 선언된 데이터소스에서 값을 렌더한다"고 규정했는데, **렌더를 확인하는 실행 코드가 0줄**이었다. 실제 원인 2건(deprecated 배열형 `statistics: ["Sum"]` → Grafana가 쿼리를 건너뜀, `$alb_name`(constant 변수) 보간 실패 → `{"LoadBalancer":["$alb_name"]}` 리터럴 전송)은 **파일만 읽는 게이트에 무증상**이고, API로 값을 질의하는 검증으로도 통과한다(변수를 미리 치환해 질의하므로) — 브라우저가 실제 보내는 payload를 가로채야 드러났다. 즉 `[검증]`이 **산문 자기신고**로 소비되며 위험이 누적됐다. 이 spec은 그 태그를 **실행 가능한 증거 경로**로 승격한다.

---

## User Scenarios & Testing

### User Story 1 — 증거 없는 `[검증]`은 통과하지 못한다 (P1)
게이트가 FR 선언 라인·SC 라인의 검증 태그를 파싱해 (a) 경로 없는 `[검증]`, (b) 실재하지 않는 자산을 지목한 `[검증: path]`, (c) 실행 동사를 주장하는데 실행 등급 증거가 없는 SC를 각각 지목한다 — advisory는 경고, hard는 exit 1. 자기신고 등급(`[검증 — 코드 실측]`·`[미확인]`)은 유지하되 실행 등급과 표기로 구분된다.
- **Independent Test**: `evidence.test.mjs`가 순수 코어(태그 파싱·실행 동사·브라우저 등급 판정·판정 조합)와 게이트 배선(off/advisory/hard·자산 실재·표 행 제외)을 단독 검증. [검증: tooling/__tests__/evidence.test.mjs]
- **Acceptance (GWT)**: 1. **Given** `executionEvidencePolicy: hard` and an FR line carrying a bare `[검증]`, **When** the gate runs, **Then** it names that spec and FR id with finding `bare-tag` and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 판정 범위는 **FR 선언 라인과 SC 라인**뿐이다 — 표 행(`|`로 시작하는 Change Log·Review Log)의 `[검증]` 언급은 **이력 서술이지 주장이 아니므로** 제외한다(킷 자신의 9개 언급이 전부 그 경우라, 제외하지 않으면 자기적용이 즉시 거짓양성 9건을 낸다).
- 실행 동사 어휘는 **부분일치**라 흔한 합성어 오탐을 피해야 한다 — 실측: `재생`을 어휘에 넣으면 "**재생**성 매니페스트"(regenerate)를 오탐한다(킷 시운전에서 SPEC-010 SC-001이 거짓양성으로 잡혀 기본 어휘에서 제외). 프로젝트는 `executionVerbs`로 교체한다.
- 브라우저 마커는 **주장 라인 자체**에서만 찾는다 — 스펙 전문을 훑으면 무관한 언급(예: "웹 UI 병합")이 오탐을 낸다(킷 시운전에서 SPEC-020이 그렇게 걸려 실측 교정).
- **UI/브라우저 경로가 있는 대상은 API 단독 검증을 실행 등급으로 인정하지 않는다**(실측 교훈) — 주장 라인에 UI 마커(대시보드·화면·패널…)가 있는데 증거 경로가 브라우저 등급 패턴(e2e·playwright·cypress…)에 맞지 않으면 표면화한다. 이는 **근사**다(경로 이름 기반) — 정확한 판정은 사람 몫이고 게이트는 "이 증거로는 렌더 단계를 못 본다"는 의심만 제기한다.
- 증거 경로는 파일·디렉토리 모두 인정하고 `*`·`?` 글롭을 지원한다(`tests/e2e/**` 형태의 스위트 지목 허용).
- 기본 `off` — 기존 프로젝트에 소급 범람하지 않는다. 깨끗해지면 `hard` 승격(graduation, 킷 자신은 hard).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `executionEvidencePolicy` is off, **check-evidence.mjs** (S) SHALL perform no evaluation and exit zero. — capability: **execution-evidence.judge** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **execution-evidence** (E) parser in **evidence-lib.mjs** (S) SHALL classify each verification tag on an FR-declaration or SC line as executable (`[검증: path]`), bare (`[검증]`), self-reported (`[검증 — …]`), or unknown (`[미확인]`), excluding table rows from evaluation.
- **FR-003** (unwanted): IF a claim carries a bare `[검증]` with no evidence path, or an executable tag names an asset that does not exist in the repository, THEN THE SYSTEM SHALL report the spec id, claim id, and finding kind, exiting non-zero under hard and warning under advisory.
- **FR-004** (unwanted): IF a success criterion asserts an execution verb (renders / responds / works …) without an executable-grade evidence path, THEN THE SYSTEM SHALL surface it as a finding — self-reported grades do not satisfy an execution claim.
- **FR-005** (unwanted): IF a claim names a UI or browser target while its evidence paths match no browser-grade pattern, THEN THE SYSTEM SHALL surface it, because API-only verification passes variable-interpolation and render-stage defects.
- **FR-006** (unwanted): IF the `executionEvidencePolicy` value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it clearly and exit non-zero (without leaking a runtime stack trace).

### Key Entities
- **execution evidence** — the property that a verification claim points at a runnable asset (test, script, suite) that exercises the declared behavior, as opposed to prose self-report, so that "[검증]" means someone can re-run the proof rather than that someone once asserted it.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: execution-evidence
- **Symbols**: evidence-lib.mjs, check-evidence.mjs
- **Artifacts**: —
- **Capabilities**: execution-evidence.judge
- **Files**: tooling/evidence-lib.mjs, tooling/check-evidence.mjs, tooling/__tests__/evidence.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob·Python 복제·sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). 이 spec은 증거 등급 판정 코어와 게이트만. 회계(unit/smoke/deferred)는 SPEC-007이 별도 축.
- **Modules**: key-pipeline (references), spec-quality-gates (references), runtime-parity (references), harness-install (references), verification-accounting (references)

---

## Success Criteria (측정형)
- **SC-001**: `evidence.test.mjs` 전 케이스 green + 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/evidence.test.mjs]
- **SC-002**: 재현 픽스처(빈 태그·없는 자산·실행 동사 SC·등급 불일치) 4종에서 각 finding을 지목하고 hard exit 1, 킷 자신은 hard에서 위반 0(양판 바이트 동일). [검증: tooling/__tests__/evidence.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 파싱·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 자산 실재 판정(파일 IO·글롭)은 소비 게이트가 주입한다.

## Assumptions / Clarifications Retained
- 이 게이트는 "증거가 **존재하고 실행 가능한 자산을 지목하는가**"만 본다 — 그 증거가 실제로 옳은 것을 검사하는지(테스트의 질)는 판정하지 않는다(SPEC-002 NFR·SPEC-007과 동일한 경계: 존재는 기계, 질은 리뷰).
- 브라우저 등급 판정은 경로 이름 근사다. 정확히는 "렌더 payload를 가로채는가"인데 그건 정적으로 못 본다 — 그래서 의심 표면화까지가 게이트의 몫이다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-30 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·킷 자기적용 hard green) + owner 개정 요청("[검증]에 실행 가능한 증거 경로 강제") → Active | FR-001~006 unit 커버. 시운전이 킷 자신에서 거짓양성 2건(재생/UI 마커)을 실수확해 어휘·범위를 교정 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-30 이웃 SPEC-007(verification-accounting): 비중복 — SPEC-007은 FR이 unit/smoke/deferred 중 **어디로 회계되는가**(빠짐 없음), 이 spec은 그 주장이 **실행 가능한 자산을 지목하는가**(증거의 등급). 회계는 분류, 이 spec은 등급.
- 2026-07-30 이웃 SPEC-010(smoke-scan): 비중복 — SPEC-010은 `@verifies` 태그를 코드에서 수집해 매니페스트를 재생성, 이 spec은 스펙 본문의 `[검증]` 주장에 경로를 강제. 수집 대상(코드 태그 vs 스펙 주장)이 다르다.
- 2026-07-30 이웃 SPEC-032(live-reality): 비중복 — 같은 "선언↔런타임" 축의 두 절반이다. 이 spec은 **저술 경계**(증거 자산을 지목했는가), SPEC-032는 **런타임 경계**(저장소 밖 실물과 일치하는가). 이 spec은 저장소 안만 보고, SPEC-032는 밖을 본다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-30 | 초안 — `executionEvidencePolicy`(off\|advisory\|hard) + `executionVerbs`·`browserMarkers`·`browserEvidencePatterns` knob + `evidence-lib`(태그 파싱·등급 판정) + `check-evidence` 게이트 + sdd-sync R8, Node·Python 바이트 패리티. 킷 자신 hard 채택 | owner 개정 요청 R1(실측 gsn-ai-pm): 게이트 8종 green인데 대시보드 패널 30여 개 사망 — `[검증]`이 산문 자기신고로 소비되고 렌더 확인 코드가 0줄이었다. API 단독 검증도 통과하는 결함(변수 보간)이라 UI 대상엔 브라우저 등급을 요구 |
