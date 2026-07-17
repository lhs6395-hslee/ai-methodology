# Feature Specification: TEST Removable Domain (Runtime + Infra)

**Module**: `sdd-tooling`  **Spec**: `SPEC-015`  **Created**: 2026-07-06  **Status**: Active
**Input**: `TEST` 접두어는 사실상 "vitest 스위트"로만 쓰여, **런타임·전용 인프라를 가진 삭제 예정 비제품 도구**(예: 개발/QA 기간용 페이지 메모 도구)를 담을 자리가 없었다 — 그래서 그런 도구가 제품 SPEC/INFRA 스펙으로 승격돼 도메인이 누수되고, 나중에 삭제하려면 제품 스펙 여러 곳을 수술해야 했다. TEST를 "테스트/QA 도메인(런타임·인프라를 자기완결로 소유하는 삭제 가능 비제품 도메인)"으로 확장한다: TEST 스펙의 **인프라 소유를 허용**(prefix-class 면제)하되, 테스트 인프라는 네임스페이스 마커(`testInfraGlobs`)로 구분해 **제품 스펙에 새지 않게 격리**한다. 수명 성격은 `Lifecycle: removable`(SPEC-008 FR-006)로 표기.

---

## User Scenarios & Testing

### User Story 1 — 테스트 인프라는 TEST 도메인에 격리 (P1)
`testInfraGlobs`(예: `**/qa/**`)에 매치하는 인프라 파일을 제품 스펙(SPEC/INFRA/CICD)이 소유하면 fr 게이트가 exit 1로 차단하고 예시 파일을 지목한다 — 테스트 인프라는 TEST 스펙만 소유한다.
- **Independent Test**: `test-domain.test.mjs`가 순수 코어(비-TEST 소유 위반·TEST 정상·미매치·비활성)를 임시 입력으로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** an INFRA spec owning a file under `**/qa/**` with `testInfraGlobs` set, **When** the coverage gate runs, **Then** it flags the isolation violation naming an example file.

### User Story 2 — TEST 스펙은 자기 인프라를 소유할 수 있다 (P1)
TEST 스펙이 소유한 실파일이 전적으로 iac/ci여도 prefix-class 게이트가 차단하지 않는다 — TEST는 자기완결 도메인이라 자기 런타임·인프라를 소유한다(격리는 US1이 별도로 강제).
- **Independent Test**: `test-domain.test.mjs`가 `prefixClassFinding("TEST", [iac, ci])` = null을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a TEST spec whose owned files are all iac/ci, **When** the coverage gate runs, **Then** no prefix-class violation is reported.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `testInfraGlobs`가 `[]`(기본)이면 격리 검사는 전면 비활성 — 스택무관·하위호환(테스트 인프라 개념을 쓰지 않는 프로젝트).
- TEST 스펙이 testInfra 파일을 소유하는 것은 정상(격리의 정당 소유자) — prefix가 TEST면 격리 판정은 항상 통과.
- 격리와 소유 허용은 짝이다: 소유 허용(prefix-class 면제)은 SPEC-012 lib, 격리 강제(testInfraGlobs)는 이 spec lib — 한쪽만으로는 "TEST가 자기 인프라를 갖되 제품엔 안 샌다"가 성립하지 않는다.
- 수명 성격: TEST 도메인은 `Lifecycle: removable`(SPEC-008 FR-006) 관례 — 기계가 삭제 예정 도구를 제품과 구분(강제는 아님, 선택 필드).
- 실제 자원 삭제·이전은 프로젝트 IaC/런북의 몫 — 게이트는 소유·격리의 *선언*만 강제한다.
- 셸/Go판 fr에는 이 계층이 없다(핵심 3커맨드 계약 밖, 정직한 델타 — SPEC-006).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the coverage gate evaluates owned files, THE SYSTEM SHALL exit non-zero when a file matching `testInfraGlobs` is owned by a non-TEST spec, naming an example file, so test infrastructure stays isolated to the TEST domain.
- **FR-002** (state): WHILE a spec uses the TEST prefix, THE SYSTEM SHALL exempt it from the prefix-class infra requirement so a TEST spec may own its own runtime and infrastructure (iac/ci) files.
- **FR-003** (ubiquitous): THE SYSTEM SHALL read `testInfraGlobs` from config (empty list disables the isolation check), keeping the test-infra namespace convention portable and stack-agnostic.

### Key Entities
- **test infrastructure** — infra files under the test/QA namespace (`testInfraGlobs`) that only a TEST-prefixed spec may own.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: test-domain
- **Symbols**: test-domain-lib.mjs
- **Artifacts**: —
- **Files**: tooling/test-domain-lib.mjs, tooling/__tests__/test-domain.test.mjs

## Dependencies (참조 — dedup 제외)
> fr 게이트 본체는 SPEC-002, prefix-class 면제(TEST)는 SPEC-012 lib, 수명 성격 필드는 SPEC-008, config 어댑터는 SPEC-001, Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline (references), spec-quality-gates (references), spec-lifecycle (references), prefix-class-consistency (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `test-domain.test.mjs` 전 케이스 green + fr 격리 판정의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 fr 게이트를 돌 때 테스트 인프라 격리 위반 0건(`testInfraGlobs` 기본 [] — 도그푸딩, 트리거 없음이 정상).

## Non-Functional Requirements
- **NFR-001**: 판정은 글롭 매칭·접두어 문자열 비교만으로 결정적이며, 레포 밖 시스템 조회나 IaC 파싱을 하지 않는다.

## Assumptions / Clarifications Retained
- TEST 접두어 의미의 정본은 STORAGE §2.2 — 이 spec은 그 규범의 기계 신호(소유 허용 + 네임스페이스 격리)만 강제한다. "무엇이 정말 삭제 예정 도구인가"는 리뷰 경계(`METHODOLOGY.md`).
- 테스트 인프라 네임스페이스 관행(리소스명·모듈 경로에 qa/test 마커)은 프로젝트가 `testInfraGlobs`로 선언한다 — 킷은 기본값을 강요하지 않는다([]).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(test-domain·패리티 테스트 + 게이트 전종 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-012(prefix-class-consistency): 비중복 — SPEC-012는 iac→INFRA·ci→CICD 접두어 정합(+TEST 면제 지점), 이 spec은 테스트 인프라 격리(네임스페이스 강제)·TEST 도메인 정의.
- 2026-07-06 이웃 SPEC-008(spec-lifecycle): 비중복 — SPEC-008은 Lifecycle 필드 문법, 이 spec은 TEST 도메인이 그 필드(removable)를 쓰는 소비자.
- 2026-07-06 이웃 SPEC-016(object-storage-decision): 비중복 — SPEC-016은 스토리지 프로비저닝 결정 기록, 이 spec은 TEST 도메인의 인프라 소유·격리.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — TEST 인프라 소유 허용(prefix-class 면제) + `testInfraGlobs` 네임스페이스 격리 게이트(Node·Python), Lifecycle removable 관례 | QA 도구가 제품 SPEC/INFRA로 승격돼 도메인 누수[실측] — TEST를 런타임·인프라 자기완결 삭제가능 도메인으로 확장 |
