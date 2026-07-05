# Feature Specification: Traceability Retag Migration

**Module**: `sdd-tooling`  **Spec**: `SPEC-011`  **Created**: 2026-07-05  **Status**: Active
**Input**: 재도출이 FR 키를 재번호할 때 남는 추적 태그 재연결 비용을 제거한다 — 기본 원칙은 **키 보존**(재생성은 기존 태그가 참조하는 키를 그대로 쓴다)이고, 재번호가 불가피하면 마이그레이션 맵(`{old→new|null}`)을 `retag` 도구가 결정적으로 적용한다: 커버리지·검증 태그와 smokeManifest 키를 경계 강제 치환하고, 폐기(null)는 보고만 한다(잔존 태그는 fr 게이트 R1이 그물).

---

## User Scenarios & Testing

### User Story 1 — 재번호는 맵 한 장으로 끝난다 (P1)
재생성 후 태그를 손으로 다시 다는 비용이 "재생성 주저"의 원인이었다. 이제 재도출 절차는 기존 태그 인벤토리를 1급 입력으로 읽어 FR 키를 보존하는 것이 기본이고, 구조가 실제로 바뀌어 재번호가 필요하면 LLM이 마이그레이션 맵을 제안하고 이 도구가 기계 적용한다. dry-run(기본)이 파일:라인 단위 치환 계획·매니페스트 rename·참조 0건 경고를 보고하고, `--write`가 적용한다. 맵 검증(키 문법·대상 FR 실재)이 실패하면 아무것도 쓰지 않는다(all-or-nothing).
- **Independent Test**: `retag.test.mjs`가 맵 검증 실패 무변경·dry-run 보고·write 적용·멱등을 임시 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a migration map whose target FR does not exist in current specs, **When** retag runs with `--write`, **Then** it exits non-zero and no file is modified.

### User Story 2 — 절단 치환이 없어야 신뢰한다 (P1)
키 치환이 서픽스 키를 오염시키면(FR-001 치환이 FR-001a를 건드리면) 자동화가 추적을 깬다. 치환은 태그 문맥 + 키 경계에서만 일어난다 — 레터 서픽스 문법(SPEC-006)과 동일한 경계 규칙. 폐기(null) 키의 태그는 기계 삭제하지 않는다(주변 코드 파손 위험) — 수동 제거 대상으로 보고하고, 잔존하면 fr 게이트 R1(dangling)이 차단한다.
- **Independent Test**: `retag.test.mjs`가 서픽스 키 비오염과 null 보고·비삭제를 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a map migrating a base key while a suffixed sibling key is tagged in tests, **When** retag runs with `--write`, **Then** the suffixed tag is untouched.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 맵의 old 키가 어디에도 참조되지 않으면 경고(이미 이행됐거나 오타) — 조용히 넘어가지 않는다.
- smokeManifest 키도 치환 대상이다(태그와 매니페스트가 함께 이행) — null 폐기 키의 매니페스트 엔트리는 삭제하지 않고 수동 제거 대상으로 보고한다.
- 같은 old 키가 여러 파일·여러 태그 종류에 걸쳐 있어도 전부 계획에 잡힌다 — 치환은 멱등(재실행 시 참조 0건).
- 스캔 범위는 `scanDirs ∪ smokeScanDirs` — 검증 태그가 사는 비-테스트 파일도 포함된다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (unwanted): IF the migration map is unloadable or non-object, a key or value violates the derived key grammar, or a non-null target FR does not exist in current specs, THEN THE SYSTEM SHALL report it and exit non-zero without modifying any file (all-or-nothing).
- **FR-002** (event): WHEN run without `--write`, THE SYSTEM SHALL report each planned rewrite with file and line, manifest key renames, null-mapped keys as manual-removal targets, and zero-reference old keys as warnings — modifying nothing.
- **FR-003** (event): WHEN run with `--write`, THE SYSTEM SHALL apply boundary-enforced replacement of coverage and verification tags across `scanDirs` and `smokeScanDirs` and rename matching smokeManifest keys, idempotently (a rerun finds zero references).
- **FR-004** (ubiquitous): THE SYSTEM SHALL never truncation-match a suffixed key — a base key's migration SHALL NOT touch a suffixed sibling's tags, and null-mapped tags SHALL be reported rather than machine-deleted (residuals remain caught by the coverage gate).

### Key Entities
- **migration map** — the JSON record `{old key → new key | null}` of a re-derivation's renumbering decisions; the single input that replays them mechanically.
- **rewrite plan** — the deterministic list of (file, line, tag, old→new) produced before any write; dry-run's report and write's exact work order.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: retag
- **Symbols**: sdd-retag.mjs
- **Artifacts**: —
- **Files**: tooling/sdd-retag.mjs, tooling/__tests__/retag.test.mjs

## Dependencies (참조 — dedup 제외)
> 태그·키 문법 파생은 SPEC-001, 커버리지 판정(R1)은 SPEC-002, 검증 태그 문법은 SPEC-010, Python 복제는 SPEC-006.
- **Modules**: key-pipeline, spec-quality-gates, smoke-scan, runtime-parity
- **Artifacts**: sdd/smoke-manifest.json

---

## Success Criteria (측정형)
- **SC-001**: `retag.test.mjs` 전 케이스 green + dry-run·write 출력과 치환 산출물의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 재번호 시나리오(픽스처)에서 수동 재태깅 0건 — 맵 적용만으로 fr 게이트 R1 green 도달.

## Non-Functional Requirements
- **NFR-001**: 치환은 태그 문맥·키 경계로 한정된 결정적 문자열 연산이며, 코드 의미 분석·태그 라인 삭제를 하지 않는다.

## Assumptions / Clarifications Retained
- 마이그레이션 맵의 작성 주체는 재도출 세션(LLM 제안 + 사람 승인)이다 — 이 도구는 맵의 의미(왜 이 키가 저 키인가)를 판정하지 않는다.
- 키 보존이 기본이므로 이 도구의 사용은 예외 경로다 — 절차 정본은 prompts/readopt.md.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(게이트 전종 + retag/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-05 이웃 SPEC-002(spec-quality-gates): 비중복 — R1(dangling) 판정은 SPEC-002 소유, 이 spec은 태그의 기계 이행만 소유(잔존은 R1에 위임).
- 2026-07-05 이웃 SPEC-010(smoke-scan): 비중복 — 검증 태그의 수집·재생성은 SPEC-010, 이 spec은 키 이행(rename)만.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-05 | 초안 — 마이그레이션 맵 문법·retag dry-run/write·경계 강제·null 비삭제(Node·Python 동시) | 고도화 3차: 재생성 비교[검증]에서 @covers 재연결 비용이 재생성 주저의 원인 — 키 보존 기본 + 기계 이행으로 비용 제거(C) |
