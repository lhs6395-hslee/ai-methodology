# Feature Specification: Smoke Evidence Auto-Scan

**Module**: `sdd-tooling`  **Spec**: `SPEC-010`  **Created**: 2026-07-05  **Status**: Active
**Input**: smokeManifest(SPEC-007)의 비-unit 검증 엔트리를 손으로 잇는 비용을 제거한다 — 증거가 사는 파일(테스트·CI 정의·스크립트·runbook 어디든)에 검증 태그(`<주석> @… <SPEC-ID>/<FR-ID> <method>: <evidence>` — 태그명은 verifies)를 두면 `smoke-scan`이 수집해 매니페스트를 **결정적으로 재생성**(`--write`)하고, 기본 check 모드가 태그↔매니페스트 드리프트를 차단한다. 수동 엔트리(태그 없는 키)는 보존된다.

---

## User Scenarios & Testing

### User Story 1 — 증거는 증거가 사는 자리에 적고, 매니페스트는 재생성한다 (P1)
수작업 스펙의 강점이던 "smoke 실증거 연결"은 사람이 매니페스트에 손으로 이어 붙인 결과였다 — 재생성마다 그 연결이 끊긴다. 이제 증거의 SSOT는 증거가 사는 파일이다: CI 정의의 주석 한 줄, smoke 스크립트의 헤더, runbook의 항목에 검증 태그를 남기면 `smoke-scan --write`가 키 문법(config 파생, SPEC-006)으로 수집해 `{method, evidence}` 엔트리를 만든다. evidence에는 파일 경로 provenance가 결합되고(정렬 결정성 — 같은 트리는 같은 매니페스트), method=deferred면 evidence 자리가 reason이 된다. 레포 밖 실증거(빌드 로그·run URL)는 레포 안 태그가 그 좌표를 가리켜야 수집된다 — 게이트가 레포 밖을 아는 척하지 않는다(정직한 경계).
- **Independent Test**: `smoke-scan.test.mjs`가 CI 정의·스크립트 픽스처에서 수집→생성→값 검증을 단독 수행.
- **Acceptance (GWT)**: 1. **Given** a CI definition file carrying a valid verification tag, **When** smoke-scan runs with `--write`, **Then** the manifest contains that key with the tag's method and a path-prefixed evidence string.

### User Story 2 — 태그와 매니페스트의 드리프트는 빌드가 깬다 (P1)
자동 채움이 의미 있으려면 수동 편집과의 이중 진실이 생기면 안 된다. 기본(check) 모드는 태그 파생 엔트리가 매니페스트에 그대로 있는지 검증한다 — 누락·값 불일치는 exit 1과 함께 `--write` 재생성을 안내한다. 태그가 없는 키는 수동 회계(deferred 백로그 등)로 남을 수 있고 check·write 모두 보존한다(SPEC-007의 수동 선언 경로는 유지).
- **Independent Test**: `smoke-scan.test.mjs`가 드리프트 exit 1 → `--write` → check exit 0 사이클과 수동 엔트리 보존을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a tag whose derived entry is absent from the manifest, **When** smoke-scan runs in check mode, **Then** it exits non-zero naming that key.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 태그도 매니페스트도 없으면 no-op이다(하위호환). 태그가 있는데 `smokeManifest` 미설정이면 에러 — 수집물이 갈 곳 없이 증발하지 않는다.
- 스캔 범위는 `smokeScanDirs`(미설정이면 `scanDirs`) — 테스트 파일 한정이 아니라 전 텍스트 파일이며, 매니페스트 파일 자신은 소스에서 제외한다.
- 유효 키가 따라오지 않는 태그 낱말(산문 언급)은 무시한다 — @covers와 동일 관례. 유효 키 뒤의 형식 위반(method·콜론·본문 누락)은 조용히 버리지 않고 에러다(의도가 명확한 태그의 절단 금지).
- 한 키에 서로 다른 method의 태그가 공존하면 에러 — 같은 method의 다중 태그는 경로 정렬로 병합된다.
- `--write`의 키 순서는 정렬로 결정적이다 — 손으로 배열한 순서는 보존되지 않는다(재생성물이라는 계약).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the scan runs, THE SYSTEM SHALL collect verification tags from every file under `smokeScanDirs` (defaulting to `scanDirs`) using the config-derived spec/requirement key grammar, comment style agnostic, mapping a deferred method's body to reason and any other method's body to evidence.
- **FR-002** (unwanted): IF a tag references a nonexistent FR, is malformed after a valid key, mixes conflicting methods for one FR, or tags exist while `smokeManifest` is unset, THEN THE SYSTEM SHALL report it and exit non-zero (no silent skip).
- **FR-003** (event): WHEN run with `--write`, THE SYSTEM SHALL regenerate the manifest deterministically — tag-derived entries with path-provenance evidence joined in sorted order, manual entries (keys without tags) preserved verbatim, keys sorted.
- **FR-004** (event): WHEN run in check mode, THE SYSTEM SHALL exit non-zero if any tag-derived entry is missing from or differs from the manifest (the manifest is a regenerable artifact — no silent drift).
- **FR-005** (state): WHILE no tags exist and no manifest is configured, THE SYSTEM SHALL remain a no-op with exit zero (backward compatible adoption).

### Key Entities
- **verification tag** — the in-repo declaration `<SPEC-ID>/<FR-ID> <method>: <body>` living where the evidence lives; the SSOT smoke-scan collects.
- **tag-derived entry** — the manifest value regenerated from tags (method + path-prefixed body), distinct from preserved manual entries.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: smoke-scan
- **Symbols**: sdd-smoke-scan.mjs
- **Artifacts**: —
- **Files**: tooling/sdd-smoke-scan.mjs, tooling/__tests__/smoke-scan.test.mjs

## Dependencies (참조 — dedup 제외)
> 매니페스트 문법·회계 분류는 SPEC-007 소유(이 spec은 자동 채움·드리프트 검사만), 키 문법 파생은 SPEC-001, Python 복제는 SPEC-006.
- **Modules**: key-pipeline (references), verification-accounting (references), runtime-parity (references)
- **Artifacts**: sdd/smoke-manifest.json

---

## Success Criteria (측정형)
- **SC-001**: `smoke-scan.test.mjs` 전 케이스 green + check·write 출력과 재생성 매니페스트의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신의 smoke-scan check가 green(태그 파생·수동 엔트리 이중 진실 0건).

## Non-Functional Requirements
- **NFR-001**: 수집·재생성은 순수 텍스트/JSON 파서로 결정적이며, evidence 본문의 의미 판정을 하지 않는다(존재·문법만 — SPEC-007 원칙 유지).

## Assumptions / Clarifications Retained
- method 어휘는 SPEC-007과 동일하게 자유형(deferred만 예약) — 태그의 method가 그대로 매니페스트에 실린다.
- CI 실행 결과(빌드 번호·런 URL)를 태그 본문에 갱신하는 주체는 사람 또는 그 프로젝트의 CI 스크립트다 — 이 도구는 레포 안 텍스트만 읽는다(레포 밖 조회 없음).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(게이트 전종 + smoke-scan/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-05 이웃 SPEC-007(verification-accounting): 비중복 — 매니페스트의 문법·검증·회계 분류는 SPEC-007 소유, 이 spec은 태그 수집·재생성·드리프트 검사만 소유.
- 2026-07-05 이웃 SPEC-009(derivation-accounting): 비중복 — SPEC-009는 소스 클래스 단위 인제스트 회계, 이 spec은 FR 단위 증거 엔트리의 자동 채움(층위가 다름).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-05 | 초안 — 검증 태그 문법·smoke-scan 수집/재생성(--write)/드리프트 검사(Node·Python 동시) | 고도화 3차: 재생성 비교[검증]에서 smoke 실증거 연결만 수동으로 남음 — 증거가 사는 파일을 SSOT로 승격해 수동 연결 제거(B) |
