# Feature Specification: Reverse-Derivation Source Accounting

**Module**: `sdd-tooling`  **Spec**: `SPEC-009`  **Created**: 2026-07-05  **Status**: Active
**Input**: 재도출(reverse-engineer)의 "조용한 미인제스트" 클래스를 제거한다 — 재생성이 읽어야 하는 소스를 9클래스 고정 enum(code·iac·ci·ops-docs·build-evidence·vcs-history·prior-traceability·prior-intent·human-intent)으로 문법화하고, 모든 클래스가 `derivationManifest`에 mapped ∨ none ∨ deferred로 **회계**되게 강제한다. 검출 가능한 클래스는 레포 실재와 교차검사(실재하는데 none = exit 1)하고, 재도출 불가능한 순수 인간 의도는 저술 시점 **선제 캡처**(Change Log 근거 존재 검사)로 닫는다.

---

## User Scenarios & Testing

### User Story 1 — 재생성이 무엇을 읽었는지 선언으로 강제 (P1)
두 프로젝트 재생성 비교에서 초기 재도출이 src/ 밖(terraform/k8s/CI)을 아예 읽지 않아 INFRA FR이 통째로 손실됐다 — 프롬프트 보완으로 사후 복구했지만, 그건 "정의되지 않은 예외"다. 이제 재도출 스코프는 소스 클래스 enum으로 문법화되고, 프로젝트는 `sdd/derivation.json`에 클래스별로 mapped(어디로 매핑됐나)·none(스캔했으나 없음)·deferred(사유와 함께 보류)를 선언한다. `derivation` 게이트가 전 클래스 회계를 강제하고, 글롭으로 검출 가능한 클래스(iac·ci·ops-docs)와 스캔 검출 클래스(code·prior-traceability)는 레포 실재와 교차검사한다 — IaC 파일이 실재하는데 none 선언이면 빌드가 깨진다. evidence/reason의 질은 기계가 못 본다 — **존재만** 강제(질은 리뷰 몫, SPEC-007과 동일 원칙).
- **Independent Test**: `derivation.test.mjs`가 미회계·미정의 클래스·빈 사유·검출 교차검사(D3)를 임시 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a repo containing an IaC file and a manifest declaring the iac class as none, **When** the derivation gate runs, **Then** it reports the detected file and exits non-zero.

### User Story 2 — 재도출 불가능한 것은 저술 시점에 캡처 (P1)
어디에도 기록되지 않은 순수 인간 의도(왜 이 변경을 했나)는 사후 재도출이 원리적으로 불가능하다 — 이 경계를 예외가 아니라 문법으로 만든다: human-intent는 회계 클래스로 선언되고(경계의 명시), Change Log의 실기록 행(실제 날짜)은 근거 칸이 비어 있으면 completeness 게이트가 표면화한다(advisory, `--strict` 하드). 변경의 "왜"가 저술 시점에 스펙 안에 남으므로 다음 재생성의 vcs-history·prior-intent 소스가 된다.
- **Independent Test**: `derivation.test.mjs`가 근거 빈 값 warn/strict 실패·플레이스홀더 행 면제를 completeness 게이트 실행으로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec whose Change Log has a dated row with an empty rationale cell, **When** the completeness gate runs with `--strict`, **Then** it exits non-zero naming that row's date.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `derivationManifest` 미설정(null)이면 게이트는 no-op이다(하위호환 — 회계는 켜는 순간부터 전 클래스 강제).
- mapped 선언인데 레포 내 검출 0건은 에러가 아니라 경고다 — 운영 인프라 실체는 레포 밖에 실재할 수 있다(예: 사내 Jenkins webhook 체인). evidence가 그 실체를 가리키는지는 리뷰 몫.
- 검출 불가 클래스(build-evidence·vcs-history·prior-intent·human-intent)는 교차검사 없이 존재 회계만 — 레포 밖 실체를 게이트가 아는 척하지 않는다(과장 금지).
- `derivationClassGlobs`의 클래스 키는 글롭 검출 대상(iac·ci·ops-docs)만 허용 — 미정의 클래스 키는 에러(오타가 검출 해제로 이어지는 것 방지).
- Change Log의 플레이스홀더 행(`[YYYY-MM-DD]`)·헤더·구분선은 근거 검사 대상이 아니다 — 실제 날짜(YYYY-MM-DD) 행만 실기록.
- ignoreDirs에 포함된 디렉토리는 검출 순회에서 빠진다 — 그 안의 IaC를 회계하려면 ignoreDirs에서 빼거나 mapped evidence로 직접 가리킨다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN `derivationManifest` is configured, THE SYSTEM SHALL load the JSON file and exit non-zero for a missing file, a parse failure, or a non-object top level.
- **FR-002** (ubiquitous): THE SYSTEM SHALL define the derivation source domain as the fixed nine-class enum (code, iac, ci, ops-docs, build-evidence, vcs-history, prior-traceability, prior-intent, human-intent) and SHALL report an unknown class key or an unaccounted class as an error — no undefined exceptions, no silent non-ingestion.
- **FR-003** (event): WHEN a class entry is validated, THE SYSTEM SHALL require status mapped, none, or deferred; a mapped entry SHALL carry non-empty evidence and a none or deferred entry SHALL carry a non-empty reason (existence only — quality is review's job).
- **FR-004** (event): WHEN a class is repo-detectable (glob classes via `derivationClassGlobs`, code via scanDirs files, prior traceability via existing coverage tags), THE SYSTEM SHALL exit non-zero if matching artifacts exist while the class is declared none, and SHALL warn (not fail) when a mapped class has zero in-repo matches so out-of-repo reality remains declarable.
- **FR-005** (state): WHILE `derivationManifest` is unset, THE SYSTEM SHALL keep the gate a no-op with current behavior unchanged (backward compatible adoption).
- **FR-006** (event): WHEN the completeness gate reads a spec's Change Log, THE SYSTEM SHALL flag any really-dated row whose rationale cell is empty (advisory; non-zero under `--strict`) — authored-time capture of intent that cannot be re-derived later.

### Key Entities
- **source class** — one of the nine fixed derivation input kinds; the unit at which "what regeneration read" is accounted.
- **derivation manifest** — the JSON map from source class to `{status, evidence|reason}`, the declared record of ingestion coverage.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: derivation-accounting
- **Symbols**: check-derivation.mjs, derivation-lib.mjs
- **Artifacts**: sdd/derivation.json
- **Files**: tooling/check-derivation.mjs, tooling/derivation-lib.mjs, tooling/__tests__/derivation.test.mjs

## Dependencies (참조 — dedup 제외)
> completeness 게이트 본체는 SPEC-002 소유(이 spec은 근거 판정 코어만), config 파생·글롭 컴파일은 SPEC-001·SPEC-003 소유, Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline, spec-quality-gates, spec-sync, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `derivation.test.mjs` 전 케이스 green + derivation·completeness 근거 출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 `derivationManifest`로 돌 때 미회계 클래스 0건 + 전 스펙 Change Log 실기록 행의 근거 빈 값 0건.

## Non-Functional Requirements
- **NFR-001**: 회계 판정은 순수 텍스트/JSON 파서와 파일 존재 검사로 결정적이며, evidence/reason의 의미 판정(NLP)·레포 밖 시스템 조회를 하지 않는다.

## Assumptions / Clarifications Retained
- 소스 클래스 → 산출물 매핑 규약(iac/ci/ops-docs→INFRA 스펙, build-evidence→smoke evidence, vcs-history→Change Log 근거, prior-traceability→FR 키 보존, prior-intent→Story·Clarifications 이월)은 절차 문서(prompts/readopt.md·METHODOLOGY.md)가 정본 — 게이트는 회계의 존재·형식만 강제한다.
- 9클래스 enum의 확장은 이 spec 개정(리뷰 관문)으로만 — 프로젝트 임의 클래스 신설 금지(PREFIX 거버넌스와 동형).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(게이트 전종 + derivation/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-05 이웃 SPEC-007(verification-accounting): 비중복 — SPEC-007은 FR의 검증 상태 회계, 이 spec은 재도출 소스의 인제스트 회계(대상이 다름: FR vs 소스 클래스).
- 2026-07-05 이웃 SPEC-002(spec-quality-gates): 비중복 — completeness 게이트 본체는 SPEC-002 소유, 이 spec은 근거 판정 코어(derivation-lib)만 소유(SPEC-008과 동형 패턴).
- 2026-07-05 이웃 SPEC-006(runtime-parity): 비중복 — derivation 동작의 Python 복제 충실도는 SPEC-006 소유.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-05 | 초안 — 소스 클래스 9종 enum·derivationManifest 회계·검출 교차검사·Change Log 근거 선제 캡처(Node·Python 동시) | 고도화 3차: 재생성 비교[검증]에서 초기 재도출이 비-src 소스를 조용히 누락 + 순수 인간 의도는 사후 복원 불가 — 회계·선제 캡처로 문법화(정의되지 않은 예외 제거) |
