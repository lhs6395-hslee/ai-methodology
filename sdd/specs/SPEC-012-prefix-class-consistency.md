# Feature Specification: Prefix–Derivation-Class Consistency

**Module**: `sdd-tooling`  **Spec**: `SPEC-012`  **Created**: 2026-07-06  **Status**: Active
**Input**: STORAGE §2.2가 접두어에 부여한 의미(SPEC=기능, INFRA=인프라 prerequisite, TEST=테스트 전용)와 readopt 착지 규칙(iac/ci 소스 → INFRA 스펙)이 미강제 규범이었다 — PREFIX 게이트는 "등록됐나 + 표준 밖이면 사유 있나"만 검사해 인프라 실체를 SPEC-에 넣어도 통과했다(소비 프로젝트 실측). 스펙이 소유한(Files) 레포 실파일을 derivation 소스 클래스(iac·ci)로 분류해, **비-테스트 소유 파일이 전적으로 인프라 클래스인데 접두어가 INFRA-가 아니면 차단**한다. 의미 판정(NLP)이 아니라 이미 선언된 결정 신호(Ownership Files 글롭 × derivationClassGlobs)만 쓴다.

---

## User Scenarios & Testing

### User Story 1 — 인프라 스펙의 접두어 착지를 기계 강제 (P1)
재도출이 terraform/CI 정의에서 도출한 스펙을 SPEC- 접두어로 착지시키면 fr 게이트의 접두어↔클래스 정합 검사가 exit 1로 차단하고, 소유 실파일 수와 예시 파일을 지목한다. 접두어를 INFRA-로 재번호(sdd-retag)하거나, 정당한 사유가 있으면 `prefixClassExemptions`에 사유와 함께 등록한다(빈 사유·존재하지 않는 ID는 에러 — prefixRationale·entityRegistry와 동형 거버넌스).
- **Independent Test**: `prefix-class.test.mjs`가 순수 코어(분류·판정·면제 검증)와 fr 게이트 통합(차단·면제·warn)을 임시 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec whose owned non-test files are all IaC/CI-class and whose prefix is not INFRA, **When** the coverage gate runs, **Then** it reports the mismatch with an example file and exits non-zero.

### User Story 2 — 정당한 부수 소유는 과잉발동 없이 통과 (P1)
기능 SPEC-이 Infrastructure Prerequisites로 부수적 IaC/CI 파일(FR 몇 개 분량)을 코드와 함께 소유하는 것은 정당하다. 임계는 자의적 비율이 아니라 **전체성(totality)** — 비-인프라·비-테스트 소유 파일이 하나라도 있으면 판정하지 않으므로 혼합 소유 스펙은 자동 통과한다.
- **Independent Test**: `prefix-class.test.mjs`가 코드+IaC 혼합 소유 픽스처의 통과를 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a feature spec owning both code files and a Dockerfile, **When** the coverage gate runs, **Then** no prefix-class violation is reported.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 테스트 파일(testFileRegex 매치)은 분류 대상이 아니다 — 인프라 스펙도 자기 테스트를 소유하므로 테스트가 전체성 판정을 깨면 안 된다.
- Files 글롭이 레포 실파일에 하나도 매치되지 않는 스펙은 판정 대상이 아니다(검출 0 = 신호 없음).
- INFRA- 접두어인데 소유 Files의 iac/ci 검출이 0건이면 에러가 아니라 경고다 — 인프라 실체는 레포 밖(플랫폼 레포·사내 CI)에 실재할 수 있다(과장 금지, SPEC-009 D3와 동일 원칙).
- 분류 글롭은 `derivationClassGlobs`(클래스 단위 교체)에서 파생한다 — 분류 기준의 SSOT는 SPEC-009의 소스 클래스 enum 하나다. ops-docs는 INFRA 착지 클래스가 아니다(verification 절·검증 태그로 착지).
- 면제된 스펙이 현재 위반이 아니면 경고(정리 대상) — 죽은 면제가 조용히 남지 않는다.
- 미등록 접두어 파일은 이 판정 이전에 PREFIX 화이트리스트가 이미 에러 처리한다(이중 보고 없음).
- 셸/Go판 fr에는 이 계층이 없다(핵심 3커맨드 계약 밖, 정직한 델타 — SPEC-006 Change Log·ci-examples 매트릭스 명시).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the coverage gate evaluates spec prefixes, THE SYSTEM SHALL match each spec's owned repo files (Ownership Files globs, non-test, ignoreDirs excluded) against the infra source classes (iac, ci) and SHALL exit non-zero when a spec whose owned files are entirely infra-class does not use the INFRA prefix, naming the file count and an example file.
- **FR-002** (unwanted): IF a spec owns at least one non-infra, non-test file, THEN THE SYSTEM SHALL NOT flag that spec — the threshold is totality, so incidental infra ownership by a feature spec never over-fires.
- **FR-003** (event): WHEN `prefixClassExemptions` declares a spec, THE SYSTEM SHALL require an existing spec ID and a non-empty rationale (error otherwise), SHALL skip the INFRA-prefix requirement for that spec, and SHALL warn when the exemption is currently unused.
- **FR-004** (state): WHILE a spec uses the INFRA prefix but none of its owned files matches an infra class, THE SYSTEM SHALL warn without failing so out-of-repo infrastructure remains declarable.
- **FR-005** (ubiquitous): THE SYSTEM SHALL derive infra-class detection from `derivationClassGlobs` (class-level replacement over defaults) so the classification has a single source shared with the derivation accounting enum.

### Key Entities
- **infra source class** — the subset of derivation source classes (iac, ci) whose artifacts land as INFRA specs per the readopt procedure.
- **prefix-class exemption** — a config-registered, rationale-carrying declaration that a specific spec may keep a non-INFRA prefix despite all-infra ownership.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: prefix-class-consistency
- **Symbols**: prefix-class-lib.mjs
- **Artifacts**: —
- **Files**: tooling/prefix-class-lib.mjs, tooling/__tests__/prefix-class.test.mjs

## Dependencies (참조 — dedup 제외)
> fr 게이트 본체는 SPEC-002 소유(이 spec은 정합 판정 코어만), 글롭 컴파일·Files 파싱은 SPEC-003·SPEC-001 소유, 소스 클래스 enum·derivationClassGlobs는 SPEC-009 소유, Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline, spec-quality-gates, spec-sync, derivation-accounting, runtime-parity

---

## Success Criteria (측정형)
- **SC-001**: `prefix-class.test.mjs` 전 케이스 green + fr 접두어↔클래스 출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 fr 게이트를 돌 때 접두어↔클래스 위반 0건(도그푸딩 — iac/ci 실체 0인 문서·툴 키트로 트리거 없음이 정상).

## Non-Functional Requirements
- **NFR-001**: 판정은 글롭 매칭·파일 존재·고정 문자열 비교만으로 결정적이며, 스펙 본문의 의미 판정(NLP)·레포 밖 시스템 조회를 하지 않는다.

## Assumptions / Clarifications Retained
- 접두어 의미의 정본은 STORAGE §2.2, 착지 규칙의 정본은 prompts/readopt.md 6단계 — 이 게이트는 그 규범의 기계 신호(소유 파일 클래스)만 강제한다. 스펙 본문이 "정말 인프라 명세인가"는 리뷰 경계(METHODOLOGY 리뷰 경계 선언).
- INFRA 접두어 문자열은 표준 3종 고정에서 온다 — 프로젝트가 인프라용 커스텀 접두어를 쓰려면 prefixClassExemptions로 선언한다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(게이트 전종 + prefix-class/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-002(spec-quality-gates): 비중복 — fr 게이트 본체·PREFIX 등록 거버넌스는 SPEC-002 소유, 이 spec은 접두어↔클래스 정합 판정 코어만 소유.
- 2026-07-06 이웃 SPEC-009(derivation-accounting): 비중복 — SPEC-009는 소스 클래스의 인제스트 회계, 이 spec은 그 클래스 분류를 접두어 강제에 재사용(회계 vs 정합).
- 2026-07-06 이웃 SPEC-011(traceability-retag): 비중복 — 위반 해소 수단(재번호)은 SPEC-011 소유, 이 spec은 판정만.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — 소유 실파일 전체성 판정·prefixClassExemptions 거버넌스·INFRA 미검출 warn(Node·Python 동시) | 고도화 4차: 접두어 의미(STORAGE §2.2·readopt iac/ci→INFRA)가 문서에만 있고 게이트가 없어 인프라 스펙이 SPEC-로 착지해도 통과[검증] — 미강제 규범 제거 |
