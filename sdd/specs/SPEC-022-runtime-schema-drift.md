# Feature Specification: Runtime Schema Drift Accounting (R2′)

**Module**: `sdd-tooling`  **Spec**: `SPEC-022`  **Created**: 2026-07-16  **Status**: Active
**Input**: SDD 드리프트 게이트는 **spec↔code** 두 축(R1 spec→code, R2 code→spec)만 본다 — **code가 기대하는 런타임 스키마 ↔ 실제 배포된 DB** 축(R2′)은 어떤 게이트도 커버하지 않는다. 실측(도그푸딩): 코드(schema SSOT)엔 컬럼이 있고 spec↔code 게이트는 전부 green인데 배포 DB엔 미적용 → 배포 후 `column does not exist`(42703) 500이 동일 클래스로 3회 반복. 근본은 마이그레이션이 CI 자동 적용이 아니라 수동 out-of-band라 "코드 기대 스키마"와 "배포 스키마"가 조용히 벌어짐. 프로젝트가 DB 스키마 SSOT+마이그레이션을 쓸 때만 활성(opt-in)인 `check-schema-drift` 게이트로 이 축을 회계한다 — DB/ORM 중립(조회 방법을 명령으로 주입).

---

## User Scenarios & Testing

### User Story 1 — 배포 전 스키마 드리프트를 preflight로 잡는다 (P1)
`schemaDriftManifest`에 "코드 기대 스키마 조회"와 "배포 DB 스키마 조회" 두 명령을 선언하면, 게이트가 둘을 실행해 (table.column) 집합을 diff한다 — **코드엔 있는데 배포 DB에 없는** 식별자가 드리프트다. `migrationStatePolicy`가 `hard`면 빌드를 깨고 `advisory`면 경고한다. **로컬 훅이 아니라 배포 파이프라인 preflight(migrate 직전)에 건다** — 배포 시점에만 배포 DB를 조회할 수 있으므로(draftBlockPolicy가 다룬 "웹 UI 병합은 로컬 훅을 안 탄다"와 동형: 강제 지점이 로컬 밖).
- **Independent Test**: `schema-drift.test.mjs`가 순수 판정(`schemaDriftVerdict`)과 게이트를 주입 명령으로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `migrationStatePolicy: hard` and a manifest whose expected command lists a column absent from the deployed command's output, **When** the gate runs, **Then** it reports that column as drift and exits non-zero.

### User Story 2 — 조회 실패는 조용히 통과하지 않는다 (P1)
expected/deployed 조회 명령 중 하나라도 실패하면(자격증명·연결 부재 등) 드리프트를 **판정할 수 없음**을 표면화한다 — `hard`는 exit 1, `advisory`는 경고. 조용한 통과 금지(env-tier probe 실패 규범과 동형: 미검증이 숨지 못하게).
- **Independent Test**: `schema-drift.test.mjs`가 조회 실패(`ran=false`) × 정책 조합을 검증.
- **Acceptance (GWT)**: 1. **Given** `migrationStatePolicy: hard` and a deployed-schema command that exits non-zero, **When** the gate runs, **Then** it reports drift cannot be determined and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- `schemaDriftManifest`가 null/미설정(기본)이면 게이트는 no-op(exit 0) + "DB 스키마 SSOT 프로젝트는 배포 preflight에 설정 권장" 안내(하위호환, 기존 프로젝트 영향 0).
- 배포에만 있고 코드엔 없는 식별자는 드리프트로 치지 않는다(코드 기대 − 배포 실측 방향만) — 추가 컬럼은 위험이 아니라 관용(마이그레이션 순서·미사용 잔재일 수 있음).
- enum 밖 `migrationStatePolicy` 값은 exit 1(문법화).
- 게이트는 DB에 직접 연결하지 않는다 — 프로젝트의 조회 명령만 실행(킷은 특정 DB/ORM/드라이버 비의존, `commands.test` 실행과 동형).
- 조회 명령 출력 형식은 프로젝트 몫(줄당 식별자 1개, 예 `table.column`) — 게이트는 trim 후 집합 비교만.
- **brownfield baseline**: 수동 DDL로 운영돼 온 기존 DB에 마이그레이션 도구를 처음 도입할 땐, 저널에 현 스키마를 "적용됨"으로 baseline 마킹(실 DDL 미실행) 후 신규분만 적용 — 이 절차는 규범(METHODOLOGY)이며 게이트 밖(도구·저널은 프로젝트 소관).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `schemaDriftManifest` is absent or lacks an `expected` or `deployed` command (default), THE SYSTEM SHALL not execute any command and SHALL exit zero, noting the gate is inactive.
- **FR-002** (event): WHEN `schemaDriftManifest` declares both commands, THE SYSTEM SHALL run each, compute the schema identifiers present in the expected set but absent from the deployed set, and report them as drift — exiting non-zero WHILE `migrationStatePolicy` is `hard` and warning without failing WHILE `advisory`.
- **FR-003** (unwanted): IF either declared command fails to run, THEN THE SYSTEM SHALL report that drift cannot be determined and SHALL NOT pass silently — exiting non-zero WHILE `hard`, warning WHILE `advisory`.
- **FR-004** (unwanted): IF `migrationStatePolicy` holds a value outside `advisory|hard`, THEN THE SYSTEM SHALL report it and exit non-zero.

### Key Entities
- **schema drift manifest** — the `{expected, deployed}` pair of DB/ORM-neutral commands that emit the code-expected and deployed schema identifier sets.
- **runtime drift** — schema identifiers the code expects but the deployed database lacks (the deploy-time failure class), distinct from spec↔code drift.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: runtime-schema-drift
- **Symbols**: check-schema-drift.mjs, schema-drift-lib.mjs
- **Artifacts**: —
- **Files**: tooling/check-schema-drift.mjs, tooling/schema-drift-lib.mjs, tooling/__tests__/schema-drift.test.mjs

## Dependencies (참조 — dedup 제외)
> config 문법은 SPEC-001, 명령 실행 패턴은 SPEC-021(test-run)·SPEC-004(sdd-run) 동형, Python 복제는 SPEC-006. 이 spec은 R2′ 드리프트 판정 계층만 소유.
- **Modules**: key-pipeline (references), test-execution (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `schema-drift.test.mjs` 전 케이스 green + `schemaDriftVerdict` 판정·출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: `schemaDriftManifest` 미설정 프로젝트(이 레포 포함)에서 게이트가 no-op exit 0(하위호환 — 기존 프로젝트 영향 0).

## Non-Functional Requirements
- **NFR-001**: 판정 코어(`schemaDriftVerdict`)는 두 집합·정책·조회성공여부만 보는 순수 함수라 결정적으로 단위 테스트되고, 명령 실행(부작용)은 게이트 래퍼가 수행한다.

## Assumptions / Clarifications Retained
- 게이트는 특정 ORM(drizzle 등)·DB(Postgres 등)를 모른다 — 프로젝트가 스키마 조회 방법을 명령으로 주입(objectStorageMarkers·derivationManifest·commands.test와 동형의 주입 원칙).
- "무엇을 마이그레이트할지"·마이그레이션 실행·brownfield baseline 저널링은 프로젝트 도구 소관 — 이 spec은 드리프트 **회계**(있음/없음 diff)만 하고 마이그레이션을 실행하지 않는다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-16 | 셀프리뷰(schemaDriftVerdict 순수 코어 TDD·게이트 e2e·Node↔Python 패리티·회귀) + owner 착수 승인 → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-16 이웃 SPEC-003(spec-sync)·converge-drift: 비중복 — 그것들은 spec↔code(R1·R2) 드리프트, 이 spec은 code↔deployed-runtime(R2′). 축이 배포 경계까지 확장된 직교 관심사.
- 2026-07-16 이웃 SPEC-021(test-execution): 비중복 — SPEC-021은 테스트 스위트 실행 결과, 이 spec은 배포 스키마 정합. 둘 다 "green이 배포 안전을 보장하나"의 다른 면(실행 vs 스키마).
- 2026-07-16 이웃 SPEC-016(object-storage): 비중복 — SPEC-016은 스토리지 프로비저닝 결정 문서화, 이 spec은 DB 스키마 배포 드리프트(자원 종류·검사 축이 다름).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-16 | 초안 — `schemaDriftManifest`{expected,deployed} + `migrationStatePolicy`(advisory|hard) + `check-schema-drift` 게이트(코드 기대 vs 배포 실측 diff) + 순수 코어 `schemaDriftVerdict`, Node·Python 패리티 | 도그푸딩(소비 프로젝트 B): spec↔code green인데 배포 DB 컬럼 미적용으로 42703 500이 3회 반복 — 드리프트 철학을 배포 경계(R2′)까지 확장, migrate-on-deploy/preflight 규범 동반 |
