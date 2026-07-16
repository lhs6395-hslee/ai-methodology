# Feature Specification: Multi-Runtime Gate Parity

**Module**: `sdd-tooling`  **Spec**: `SPEC-006`  **Created**: 2026-07-05  **Status**: Active
**Input**: 비-Node 런타임(Python `sdd_gates.py`·셸 `sdd_gates.sh`·Go `go-gate`)과 preset 템플릿이 Node 정본과 같은 문법·같은 판정으로 동작하도록 강제한다 — 런타임 간·경로 간 동작 차이는 "조용히 빠지는" 클래스를 만들므로 그 자체를 게이트 대상으로 삼는다.

---

## User Scenarios & Testing

### User Story 1 — 어떤 런타임을 골라도 같은 판정 (P1)
채택 프로젝트는 자기 스택에 맞춰 게이트 런타임을 하나 고른다(Node/Python/셸/Go). 어느 쪽을 골라도 같은 `sdd.config.json`으로 같은 판정이 나와야 한다. Python판 `sdd_gates.py`는 Node 게이트 스위트 전체(fr·ownership·cohesion·completeness·consistency·adequacy·orphan·converge·specsync·run)와 동작 패리티를 가진다. 셸판 `sdd_gates.sh`·Go판 `go-gate`는 핵심 3커맨드(fr·ownership·run)를 같은 ID 문법·같은 기본값으로 제공한다.
- **Independent Test**: `sdd-gates-py.test.mjs`가 같은 픽스처를 Node·Python 양쪽에 넣어 exit code와 출력 동일성을 검증. `sdd-gates-sh.test.mjs`가 셸판의 문법 동일성을 검증.
- **Acceptance (GWT)**: 1. **Given** the same fixture repo, **When** the Node gate and the Python gate evaluate it, **Then** both produce identical exit codes and identical report output.

### User Story 2 — 문법은 config 한 곳에서 파생 (P1)
spec ID 접두어(`specIdPrefixes`)와 요구 ID 접두어(`requirementIdPrefixes`)는 config에서 한 번 선언되고, 모든 런타임의 모든 파싱 사이트(선언 추출·집계·면제·`@covers`·spec-sync 라인 판정)가 그 파생 문법을 쓴다. 사이트 하나가 하드코딩으로 남으면 절단 태그·조용한 누락이 재발한다(도그푸딩 회귀의 뿌리).
- **Independent Test**: `check-req-prefix.test.mjs`(Node 사이트)·`sdd-gates-py.test.mjs`(Python)·`sdd-gates-sh.test.mjs`(셸)·`runtime-contract.test.mjs`(Go 소스 계약·DEFAULTS 정렬)가 사이트 누락을 회귀로 잡는다.
- **Acceptance (GWT)**: 1. **Given** a config with an extended requirement prefix, **When** any runtime parses a declaration or tag using that prefix, **Then** it is recognized identically at every parsing site.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 요구 ID의 레터 서픽스는 소문자 1자만 — 2자 서픽스나 서픽스+숫자 등 비문법 토큰은 어느 런타임에서도 부분(절단) 캡처 없이 통째로 불인정한다.
- 셸판은 ERE에 워드 경계가 없어 "과포집 후 정확형 필터" 2단계로 경계를 재현한다(비문법 태그의 절단 캡처 금지).
- 런타임별 DEFAULTS(specIdPrefixes 등)가 Node와 다르면 config 없는 프로젝트에서 판정이 갈라진다 — 기본값 자체도 패리티 대상이다.
- preset 경로(`.specify` ears-preset)로 작성된 spec이 정식 템플릿의 게이트 파싱 앵커를 결여하면 spec-first 강제에서 조용히 빠진다 — 템플릿 간 앵커 패리티도 게이트 대상이다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE SYSTEM SHALL provide a Python runtime gate with behavior parity to the full Node gate suite — coverage with prefix governance, ownership with key normalization and format validation, cohesion, completeness, consistency, adequacy, orphan surfaces, converge drift, spec-sync, and the stage runner — reading the same `sdd.config.json`.
- **FR-002** (event): WHEN any runtime parses requirement IDs at any site (declaration, aggregation, exemption, covers tag, spec-sync line judgment), THE SYSTEM SHALL derive the grammar from `requirementIdPrefixes` (three digits plus an optional single lowercase-letter suffix, boundary enforced) so that no site keeps a hardcoded prefix.
- **FR-003** (event): WHEN the same fixture is evaluated by the Node gate and the Python gate, THE SYSTEM SHALL produce an identical exit code and identical report output.
- **FR-004** (ubiquitous): THE SYSTEM SHALL keep the shell and Go runtimes' core commands (coverage with prefix governance, ownership, runner) on the same ID grammar and the same defaults as the Node canonical DEFAULTS.
- **FR-005** (unwanted): IF the ears-preset spec template omits any gate-parsed anchor present in the canonical module-spec template (an ownership category line including Files, the Dependencies section, Edge Cases, or Change Log), THEN THE SYSTEM SHALL fail the template-parity test so preset-path specs are never silently exempt from spec-first enforcement.

### Key Entities
- **runtime edition** — one of the four gate implementations (Node canonical, Python, shell, Go) sharing one config and one grammar.
- **parsing site** — any code location that recognizes a spec ID or requirement ID; the unit at which grammar drift causes silent loss.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: runtime-parity
- **Symbols**: sdd_gates.py, sdd_gates.sh, go-gate
- **Artifacts**: —
- **Files**: tooling/sdd_gates.py, tooling/sdd_gates.sh, tooling/go-gate/main.go, tooling/ears-preset/templates/spec-template.md, tooling/__tests__/sdd-gates-py.test.mjs, tooling/__tests__/sdd-gates-sh.test.mjs, tooling/__tests__/runtime-contract.test.mjs, tooling/__tests__/template-parity.test.mjs

## Dependencies (참조 — dedup 제외)
> 판정 알고리즘의 정본은 Node판이 소유한다 — 이 spec은 그 동작의 "복제 충실도"만 소유.
- **Modules**: key-pipeline, spec-quality-gates, spec-sync

---

## Success Criteria (측정형)
- **SC-001**: 같은 픽스처에 대한 Node↔Python 게이트 판정 불일치 0건(패리티 테스트 green).
- **SC-002**: 하드코딩 요구 접두어가 남은 파싱 사이트 0곳(전 런타임 회귀 테스트가 검출).

## Non-Functional Requirements
- **NFR-001**: Python판은 표준 라이브러리만 사용(3.7+), 셸판은 POSIX `sh`+`grep`+`awk`+`jq`만 사용 — 추가 의존 도입 금지.

## Assumptions / Clarifications Retained
- Go판은 로컬 툴체인이 없어도 소스 계약 테스트로 문법 회귀를 잡는다 — 실행 패리티 재검증은 Go 툴체인이 있는 CI에서 수행(REALITY_CHECK.md 갱신 대상).
- 셸/Go판의 ownership 키 정규화·형식검증(normalizeKey/validateKey)은 미포팅 상태다 — 소비 트리거 성립 시 승격(문서에 델타 명시, 조용한 패리티 주장 금지).

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 패리티 테스트 포함 전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-001·SPEC-002·SPEC-003(판정 정본 소유 spec들): 비중복 — 이 spec은 복제 충실도만 소유.
- 2026-07-05 이웃 SPEC-007(verification-accounting)·SPEC-008(spec-lifecycle): 비중복 — 회계·수명주기 판정의 Python 미러 충실도만 이 spec 범위.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-05 | 초안 — Python 전 게이트 패리티·requirementIdPrefixes 전 사이트 일반화·셸/Go 문법 정렬·preset 템플릿 앵커 패리티 | 진단 A-1/A-2/B-1/B-2: 런타임 간·경로 간 문법 불일치가 "조용히 빠지는" 클래스를 만듦 — 문법화(정의되지 않은 예외 제거) |
| 2026-07-05 | Python fr 게이트에 검증 회계(strictSpecs·requireAccounting·smokeManifest) 미러 + DEFAULTS 5키 정렬 + 회계 바이트 패리티 테스트 | SPEC-007 신설 동반 — 셸/Go fr에는 회계 계층 없음(핵심 3커맨드 계약 밖, 정직한 델타) |
| 2026-07-05 | Python completeness·specsync에 수명주기(Status·리뷰 기록·Draft 차단) 미러 + 바이트 패리티 테스트 + 템플릿 수명주기 앵커(Review Log·Dedup-Review·Status enum) 패리티 편입 | SPEC-008 신설 동반 — preset 경로 스펙이 수명주기 문법을 결여한 채 조용히 빠지는 것 방지 |
| 2026-07-05 | Python specsync에 `specSyncUnownedPolicy` 미러(silent/warn/error + 미정의 값 거부) + 패리티 테스트 | SPEC-003 FR-010 신설 동반(P2) |
| 2026-07-05 | Python `_git`에 `core.quotepath=off` 미러 | SPEC-003 quotepath 수정 동반 — 비ASCII 경로 판정 패리티 |
| 2026-07-05 | Python ownership에 `entityRegistry` 미러 + 바이트 패리티 테스트 | SPEC-002 FR-009 신설 동반(P3a) |
| 2026-07-05 | Python에 derivation·smokescan·retag 3커맨드 미러 + completeness 근거(선제 캡처) 검사 미러 + DEFAULTS 3키 정렬 + 출력·산출물 바이트 패리티 테스트 | SPEC-009~011 신설 동반 — 셸/Go fr·ownership에는 없음(핵심 3커맨드 계약 밖, 정직한 델타 — ci-examples 매트릭스 명시) |
| 2026-07-06 | Python에 접두어↔클래스 정합(fr 0b)·Files 카테고리 금지(ownership)·문법 규범(completeness)·글롭 staged 차단(specsync) 미러 + DEFAULTS `prefixClassExemptions` 정렬 + 바이트 패리티 테스트 4종 | SPEC-012·SPEC-013 신설 동반 — 셸/Go fr·ownership에는 없음(핵심 3커맨드 계약 밖, 정직한 델타 — ci-examples 매트릭스 명시) |
| 2026-07-06 | Python DEFAULTS의 `derivationClassGlobs` 기본값 보정 동기(iac 동반 파일·ci 구성요소 편입) — 값·순서 동일(runtime-contract ①이 강제) | SPEC-001 기본값 보정 동반 — 기본값 자체도 패리티 대상 |
| 2026-07-06 | Python에 `numbering_issues` 미러(fr 0c 배선) + 바이트 패리티 테스트 1종(INFRA-011 Node↔Python) | SPEC-014 신설 동반 — 번호 게이트도 런타임 중립 필수(셸/Go fr에는 없음 — 핵심 3커맨드 계약 밖, 정직한 델타) |
| 2026-07-06 | Python에 `object_storage_findings` 미러(completeness 배선) + DEFAULTS `objectStorageMarkers` 정렬 + 바이트 패리티 테스트 1종 | SPEC-016 신설 동반 — 오브젝트 스토리지 결정 게이트도 런타임 중립 필수(Node↔Python 동일 출력) |
| 2026-07-09 | Python specsync에 `draftBlockPolicy`(advisory\|hard) 미러 + DEFAULTS 정렬 + 패리티 테스트 1종 | SPEC-008 FR-007 신설 동반 — range 모드 Draft-block 승격도 런타임 중립 필수 |
| 2026-07-09 | Python ownership에 Entity 관계 검사(`parse_relation_entry`·`relation_type_finding`·`resolve_relations`·`find_cycles`) 미러 + DEFAULTS `relationTypes` 정렬 + 패리티 테스트 2종 | SPEC-017 신설 동반 — 관계 실재·순환 판정도 런타임 중립 필수 |
| 2026-07-06 | Python `object_storage_findings`에 감사 트레일 제외(`_before_audit_trail`) 동기 | SPEC-016 자기 서술 오탐 수정의 Node·Python 패리티 유지 |
| 2026-07-06 | Python STANDARD_PREFIXES·DEFAULTS.specIdPrefixes에 `CICD` + `prefix_class_finding`를 `CLASS_PREFIX{iac:INFRA,ci:CICD}`로 일반화(에러/warn 메시지 바이트 동일) + 패리티 테스트 1종(ci 전용 INFRA→CICD) | CICD 표준 접두어 신설 동반 — 접두어 거버넌스·prefix-class도 런타임 중립 필수 |
| 2026-07-06 | Python에 `parse_lifecycle`·`LIFECYCLE_ENUM` + completeness Lifecycle enum 검증 미러 + 패리티 테스트 1종 | SPEC-008 FR-006 동반 — Lifecycle 필드도 런타임 중립(Node↔Python 동일 출력) |
| 2026-07-06 | Python에 `test_infra_finding` + prefix_class TEST 면제 + fr 배선 미러 + 패리티 테스트 1종 | SPEC-015 신설 동반 — 테스트 인프라 격리·TEST 소유 허용도 런타임 중립 |
| 2026-07-06 | Python DEFAULTS에 `trackerCloseout {}` 동기 | 완료 루프 close-out knob의 DEFAULTS 런타임 패리티(runtime-contract 강제) — 게이트 소비는 없으나 기본값 자체가 패리티 대상 |
| 2026-07-15 | ears-preset 템플릿을 정식 `module-spec.md`와 바이트 재동기화(Lifecycle·FR 서픽스·relationTypes 안내 주석 3종) | doc-coverage 반영으로 정식 템플릿에 주석 추가 → FR-005 template-parity 유지 위해 preset 사본도 동일 갱신(게이트 동작 무변경) |
| 2026-07-15 | 셸(`sdd_gates.sh`)·Go(`go-gate/main.go`) `specIdPrefixes` 기본값·표준 접두어 집합·에러 문자열을 `SPEC/INFRA/TEST/CICD` 4종으로 통일 + `runtime-contract.test.mjs` 소스 계약 기대치를 4종으로 갱신 | CICD 절반 롤아웃 봉합 — Node·Python은 4종인데 셸/Go 기본값이 3종이라 config 없는 CICD 스펙이 런타임에 따라 통과/차단 갈리던 패리티 결함(감사 P1) 실증 후 정정(셸 CICD-001 통과 확인) |
| 2026-07-15 | Python(`sdd_gates.py`) PREFIX 위반 에러 문자열도 `표준 SPEC/INFRA/TEST/CICD`로 — 4판 에러 문자열 바이트 동일 완결 | 위 통일의 잔재 1곳(Python 에러 메시지만 3종) 정정 — Node·셸·Go와 바이트 동일 |
| 2026-07-15 | Python `cmd_cohesion` FR 카운터를 `__frToken` → `__frDecl`로 미러(Node cohesion 오탐 수정 동반) | cohesion FR 인용 오집계 수정의 런타임 패리티 — Node·Python 동일 판정 유지 |
| 2026-07-15 | Python STATUS_ENUM에 Planned·`classify_accounting`에 planned_specs·`cmd_fr` planned 수집·리포트 planned 세그먼트 미러(SPEC-018 FR-005 동반) | Planned 회계 런타임 패리티 — Node↔Python 회계 리포트 바이트 동일(`planned:N`) 확인 |
| 2026-07-16 | `numbering_issues`에 `retired_ids` 인자·DEFAULTS `retiredIds`·호출부 미러(SPEC-018 FR-006 동반) | numbering retirement-gap 런타임 패리티 — Node↔Python fr 리포트 바이트 동일 확인 |
| 2026-07-16 | Python spec-sync 메시지를 중립-우선 문구로 미러(SPEC-003 동반) — `node scripts/sdd-sync.mjs`/Change Log 안내, Claude 슬래시는 괄호 | 강제 메시지의 Node↔Python 바이트 동일 유지 — 중립화도 두 판이 함께 움직여야 패리티 불변 |
| 2026-07-16 | Python에 `escalations`·`semanticDriftPolicy` DEFAULTS·리네임 수집·drift 배선 미러(SPEC-019 동반) — spec-sync drift 출력 Node↔Python 바이트 동일(패리티 테스트 green) | semantic drift 런타임 패리티 — 리네임 승격 판정·리포트가 두 런타임에서 동일 |
| 2026-07-16 | Python에 `parse_drivers`·`cross_spec_relaxed`·`__idAlt` cfg·cross-spec 배선 미러(SPEC-020 동반) — spec-sync cross-spec 출력 Node↔Python 바이트 동일 | cross-spec 런타임 패리티 — Change-Driver 파싱·참조 완화가 두 런타임에서 동일 |
| 2026-07-16 | Python에 `test_run_verdict`·`cmd_testrun`·`testrun` 서브커맨드·`runTestsPolicy` DEFAULTS 미러(SPEC-021 동반) + 패리티 테스트 1종 — testrun 출력 Node↔Python 바이트 동일 | 테스트 실행 게이트 런타임 패리티 — FinOps가 Python 게이트로 도니 실행-결과 확인도 두 런타임 동일 |
| 2026-07-16 | Python에 `schema_drift_verdict`·`cmd_schemadrift`·`schemadrift` 서브커맨드·DEFAULTS 미러(SPEC-022 동반) + 패리티 테스트 1종 — schemadrift 출력 Node↔Python 바이트 동일 | R2′ 스키마 드리프트 게이트 런타임 패리티 — 배포 preflight가 두 런타임에서 동일 |
