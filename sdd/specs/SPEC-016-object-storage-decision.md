# Feature Specification: Object-Storage Provisioning Decision

**Module**: `sdd-tooling`  **Spec**: `SPEC-016`  **Created**: 2026-07-06  **Status**: Active
**Input**: 기능이 오브젝트 스토리지(S3·GCS·Blob 등)를 필요로 할 때 버킷을 무계획 자동 생성하면 버킷이 난립하고, 특히 테스트/QA 임시 버킷은 제품이 스토리지를 갖게 됐을 때 이전(consolidation) 경로가 설계되지 않아 잔존한다(실측: QA 메모 도구가 전용 버킷을 만들어 제품 버킷과 분리 방치). 스토리지 도입은 **설계 단계에서 결정을 묻고 스펙에 기록**하게 강제한다 — 버킷 선택(신규 전용 vs 기존 네임스페이스)과 이전 기준을. 감지는 NLP가 아니라 config 마커(`objectStorageMarkers`)라는 선언 신호로, 판정은 completeness advisory(존재만; 질은 리뷰 몫)로 한다.

---

## User Scenarios & Testing

### User Story 1 — 스토리지 도입 스펙은 결정을 기록해야 (P1)
스펙 본문이 오브젝트 스토리지 마커에 매치하는데 `## Object Storage Decision` 섹션이 없으면 completeness가 경고한다(`--strict`에서 hard). 저자는 버킷 선택과 이전 기준을 섹션에 적어 해소한다.
- **Independent Test**: `object-storage.test.mjs`가 순수 코어(마커 매치·섹션 존재·라벨 검사)를 임시 텍스트로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec body mentioning S3 with no Object Storage Decision section, **When** the completeness gate runs, **Then** it warns that the bucket-selection and consolidation decisions are unrecorded.

### User Story 2 — 결정 섹션은 버킷·이전 라벨을 담아야 (P1)
`## Object Storage Decision` 섹션이 있어도 `Bucket`·`Consolidation` 라벨이 없으면 경고한다 — 버킷을 새로 팔지/기존 네임스페이스에 얹을지, 그리고 임시 객체를 언제·어디로 옮길지가 비면 결정이 아니다.
- **Independent Test**: `object-storage.test.mjs`가 섹션은 있으나 라벨 결손 픽스처의 경고를 단독 검증.
- **Acceptance (GWT)**: 1. **Given** an Object Storage Decision section missing the Consolidation label, **When** the gate runs, **Then** it names the missing label.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 마커에 매치하지 않는 스펙은 판정 대상이 아니다(신호 없음 = 무관).
- `objectStorageMarkers`를 `[]`로 두면 이 검사는 전면 비활성(포터블 하위호환 — 스토리지 안 쓰는 프로젝트).
- 감지는 마커 문자열 매치라 휴리스틱이다 — "스토리지를 쓰지 않는다"는 서술도 매치할 수 있다. advisory라 오탐은 비차단이며 프로젝트가 마커를 튜닝한다(과장 금지: 결정적 선언 신호가 아님, 리마인더).
- 4개 세부(이전 트리거·대상 경로·이전 방식·키 네임스페이스)는 템플릿 체크리스트로 안내한다 — 게이트는 `Bucket`·`Consolidation` 라벨 존재만 검사(존재만 강제, 질은 리뷰 몫).
- 규칙을 정의할 뿐 스토리지를 만들지 않는 스펙(이 SPEC-016 자신)은 결정 섹션을 `해당 없음(N/A)`으로 둬 자기 게이트를 통과한다.
- 실제 버킷 생성·객체 이전 실행은 프로젝트 IaC/런북의 몫이다 — 게이트는 결정의 *기록*만 강제한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the completeness gate scans a spec whose body matches a configured object-storage marker, THE SYSTEM SHALL require an Object Storage Decision section and SHALL warn — hard under `--strict` — when that section is absent.
- **FR-002** (state): WHILE a spec carries an Object Storage Decision section, THE SYSTEM SHALL warn when it lacks the Bucket or the Consolidation label, so the bucket-selection and consolidation choices are recorded.
- **FR-003** (ubiquitous): THE SYSTEM SHALL read the marker set from `objectStorageMarkers` config (default list, empty list disables the check), keeping detection portable and stack-agnostic.

### Key Entities
- **object-storage decision** — the recorded bucket-selection (new dedicated bucket vs existing-bucket namespace) plus consolidation criteria a storage-introducing spec must carry.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: object-storage-decision
- **Symbols**: object-storage-lib.mjs
- **Artifacts**: —
- **Files**: tooling/object-storage-lib.mjs, tooling/__tests__/object-storage.test.mjs

## Dependencies (참조 — dedup 제외)
> completeness 게이트 본체는 SPEC-002 소유(이 spec은 결정 검사 코어만), config 어댑터·DEFAULTS는 SPEC-001, Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline, spec-quality-gates, runtime-parity

---

## Object Storage Decision
> 이 스펙은 오브젝트 스토리지 결정 규약을 *정의*할 뿐, 어떤 스토리지도 프로비저닝하지 않는다(자기 게이트 통과용 N/A 시연).
- **Bucket**: 해당 없음(N/A) — 이 스펙은 자원을 만들지 않는다.
- **Consolidation**: 해당 없음(N/A) — 이전 대상 객체가 없다.

## Success Criteria (측정형)
- **SC-001**: `object-storage.test.mjs` 전 케이스 green + completeness 출력의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 completeness를 돌 때 오브젝트 스토리지 경고 0건(SPEC-016은 N/A 결정 섹션 구비, 나머지 스펙은 마커 미매치 — 도그푸딩).

## Non-Functional Requirements
- **NFR-001**: 판정은 마커 문자열 매치·섹션 추출·라벨 존재 검사만으로 결정적이며, 레포 밖 스토리지 시스템 조회나 IaC 파싱을 하지 않는다.

## Assumptions / Clarifications Retained
- 감지는 결정적 선언 신호가 아니라 config 마커 휴리스틱이다 — 그래서 severity를 advisory로 두고(리마인더), 강제 승격은 `--strict`·팀 선택으로 남긴다.
- 4개 이전 세부는 템플릿(`templates/module-spec.md`)의 체크리스트가 SSOT다 — 게이트와 템플릿의 책임 분리(게이트=존재, 템플릿=내용 안내).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(object-storage·패리티 테스트 + 게이트 전종 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-002(spec-quality-gates): 비중복 — completeness 게이트 본체는 SPEC-002 소유, 이 spec은 오브젝트 스토리지 결정 검사 코어만 소유.
- 2026-07-06 이웃 SPEC-009(derivation-accounting): 비중복 — SPEC-009는 재도출 소스 회계·Change Log 근거, 이 spec은 스토리지 프로비저닝 결정 기록(직교 관심사).
- 2026-07-06 이웃 SPEC-013(spec-grammar-hardening): 비중복 — SPEC-013은 Module·SHALL·Dedup 등 일반 문법, 이 spec은 조건부(마커 매치) 섹션 요구.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — `objectStorageMarkers` 감지 + Object Storage Decision 섹션(Bucket·Consolidation 라벨) completeness 검사(advisory·--strict), Node·Python 동시 | QA 도구가 전용 S3 버킷을 무계획 생성해 제품 버킷과 분리 방치[실측] — 스토리지 도입 시 버킷 선택·이전 기준을 설계 단계에 기록하도록 강제 |
