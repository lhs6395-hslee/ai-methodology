# Feature Specification: Ownership Key Pipeline & Config Adapter

**Module**: `sdd-tooling`  **Spec**: `SPEC-001`  **Created**: 2026-07-02  **Status**: Active
**Input**: 소유권 키의 결정적 파싱·정규화·형식검증과, 언어/스택 무관 config 어댑터를 하나의 파이프라인으로 제공한다.

---

## User Scenarios & Testing

### User Story 1 — 결정적 키 파이프라인 (P1)
게이트(ownership·cohesion·consistency·spec-sync)는 사람의 판단 대신 **결정적 함수**로 소유권 키를 다뤄야 한다. `ownership-keys.mjs`의 `parseSection`·`normalizeKey`·`validateKey`가 spec 텍스트에서 카테고리별 키를 뽑고, 카테고리별 규칙으로 정규화하고, 형식을 검증한다. 같은 입력이면 사람이든 LLM이든 같은 결과가 나온다.
- **Independent Test**: `ownership-keys.test.mjs`가 `## Ownership` 블록을 넣고 파싱 결과·정규화형·검증 사유가 표대로임을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec text with a `## Ownership` section, **When** `parseSection` runs for the configured categories, **Then** it returns one trimmed key array per category with placeholder(`[…]`)·dash tokens excluded.

### User Story 2 — config 한 장으로 언어 중립 (P1)
`sdd-config.mjs`의 `loadConfig`는 프로젝트 루트의 `sdd.config.json`을 읽고 빠진 필드를 `DEFAULTS`로 채운 뒤, 모든 게이트가 공유하는 파생값(`__root`·`__testRegex`·`__specIdRe`·`__coversRe`·`__allVerbs`)을 계산한다. config 파일이 없으면 JS/TS 기본과 동일하게 동작한다(하위호환).
- **Independent Test**: `sdd-config.test.mjs`가 부분 config를 주고 DEFAULTS 병합·파생 정규식·verb 집합을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a partial `sdd.config.json`, **When** `loadConfig` runs, **Then** unset fields fall back to DEFAULTS and `commands` is shallow-merged.

### Edge Cases
- `parseSection`으로 넘어온 값이 `—`, `[…]`, 또는 `[`로 시작하는 placeholder 토큰이면 키에서 제외한다(빈 카테고리 허용, 조용한 오탐 방지).
- `normalizeKey`의 Surface 경로에 매칭되는 `<METHOD> <path>` 형태가 없으면(공백 분리 실패) 전체를 소문자화한 fallback을 반환한다. `surfaceFormat: "path"|"any"`이면 애초에 METHOD 파싱을 생략하고 소문자 경로(trailing slash 제거)로 정규화한다(파일 라우팅·비-HTTP 자원용).
- `loadConfig`가 `sdd.config.json` JSON 파싱에 실패하면 stderr로 경로·사유를 출력하고 `process.exit(1)`한다(조용한 무시 금지).
- `validateKey`의 Capability는 점 1개(`entity.verb`)가 아니거나 verb가 `__allVerbs`(CRUD + 등록 verb)에 없으면 위반 사유 문자열을 돌려준다.
- `__coversRe`의 요구 ID 문법은 접두어(`requirementIdPrefixes` 파생, 기본 `FR`) + 3자리 + 선택적 소문자 서픽스 1자이며 경계까지 요구한다 — 2자 서픽스 토큰은 부분(절단) 캡처 없이 통째로 불인정(절단 오판 금지). (ID 예시를 리터럴로 안 쓰는 이유: 게이트가 예시 토큰을 이 spec의 FR로 집계하기 때문 — SPEC-003과 동일 규칙.)
- 요구 ID 정규식 3종(`__frDeclRe`·`__frTokenRe`·`__coversRe`)은 전부 `requirementIdPrefixes` 한 곳에서 파생된다 — 게이트가 자체 요구 정규식을 하드코딩하면 사이트 간 문법 불일치(절단 태그·조용한 누락)가 재발한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 각 FR은 구현된 동작을 서술한다(발명 금지).

- **FR-001** (event): WHEN `parseSection` receives a heading and category list, THE SYSTEM SHALL slice the text from that `## <heading>` line to the next `## ` line and return one comma-split, trimmed key array per category, excluding empty, `—`, and bracket-prefixed placeholder tokens.
- **FR-002** (event): WHERE `surfaceFormat` is `http` (default), WHEN a Surfaces key is normalized, THE SYSTEM SHALL uppercase the METHOD, lowercase the path, rewrite `:id`/`<id>`/`{id}` params to the configured `surfacePathParam` `{name}` form, and strip the trailing slash; WHERE `surfaceFormat` is `path` or `any`, THE SYSTEM SHALL instead lowercase the key and strip the trailing slash without METHOD/param parsing (file-path surfaces).
- **FR-003** (event): WHEN a non-Surfaces key (Entity or Capability class) is normalized, THE SYSTEM SHALL lowercase it and collapse internal whitespace to single spaces.
- **FR-004** (unwanted): IF a Capabilities key is not exactly `entity.verb` (one dot) or its verb is absent from the configured verb set, THEN THE SYSTEM SHALL return a violation reason string instead of null.
- **FR-005** (unwanted): WHERE `surfaceFormat` is `http` (default), IF a Surfaces key does not match `<METHOD> <path>` or the `event:`/`job:` form, THEN THE SYSTEM SHALL return a violation reason string; WHERE `surfaceFormat` is `path`, IF the key contains whitespace or non-path characters THEN it is a violation; WHERE `surfaceFormat` is `any`, no surface format is enforced.
- **FR-006** (ubiquitous): THE SYSTEM SHALL resolve the config by walking upward from the start directory for `sdd.config.json`, merge the parsed user object over `DEFAULTS`, and shallow-merge the `commands` map.
- **FR-007** (event): WHEN config is loaded, THE SYSTEM SHALL derive the shared regexes `__specIdRe` and `__coversRe` from `specIdPrefixes`, set `__root` to the config directory (or the start directory when no config file exists), and build `__allVerbs` from CRUD plus `capabilityVerbs`.
- **FR-008** (unwanted): IF `sdd.config.json` exists but fails to parse as JSON, THEN THE SYSTEM SHALL print the path and error to stderr and exit with a non-zero code.
- **FR-009** (event): WHEN config is loaded, THE SYSTEM SHALL derive the requirement-ID regexes — declaration (`__frDeclRe`), token (`__frTokenRe`), and covers (`__coversRe`) — from `requirementIdPrefixes` (default FR) with an optional single lowercase-letter suffix and boundary enforcement, as the single grammar shared by every parsing site.

### Key Entities
- **config object** — the merged runtime config: `specDir`, `scanDirs`, `ignoreDirs`, `testFileRegex`, `ownershipCategories`, `specIdPrefixes`, plus derived `__root`/`__testRegex`/`__specIdRe`/`__coversRe`/`__allVerbs`.
- **ownership key** — a single normalized identifier owned by exactly one spec (Module / Symbol / Artifact token).

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키. 카테고리는 `sdd.config.json`의 `ownershipCategories`(Modules/Symbols/Artifacts)와 일치.
- **Modules**: key-pipeline
- **Symbols**: ownership-keys.mjs, sdd-config.mjs
- **Artifacts**: —
- **Files**: tooling/ownership-keys.mjs, tooling/sdd-config.mjs, tooling/__tests__/ownership-keys.test.mjs, tooling/__tests__/sdd-config.test.mjs

## Dependencies (참조 — dedup 제외)
> 없음 — 이 spec이 파이프라인의 뿌리다(다른 spec들이 이것을 참조).

---

## Success Criteria (측정형)
- **SC-001**: `ownership-keys.test.mjs`·`sdd-config.test.mjs`의 모든 케이스가 통과하며(현재 green), 동일 입력에 대한 `parseSection`/`normalizeKey`/`validateKey` 결과가 100% 재현된다.
- **SC-002**: config 파일이 없는 프로젝트에서 `loadConfig`가 `DEFAULTS`와 동일한 유효 config를 산출한다(하위호환 회귀 0건).

## Non-Functional Requirements
- **NFR-001**: 파이프라인은 순수 텍스트 파서로 Node 런타임만 요구하고 대상 프로젝트 언어에 비의존한다.

## Assumptions / Clarifications Retained
- `ownershipCategories` 헤더 문자열은 config 값과 정확히 일치해야 게이트가 파싱한다(정규화 표기 규칙은 설계 §4 표를 따른다).

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 게이트 전종·전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-002(spec-quality-gates): 비중복 — 이 spec은 파싱·정규화·config 코어, SPEC-002는 그 소비 게이트.
- 2026-07-05 이웃 SPEC-007(verification-accounting): 비중복 — 회계 키 문법은 이 spec의 파생값을 소비만.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | `__coversRe` 레터 서픽스(소문자 1자) 지원 + 경계 강제 | 도그푸딩(PM솔루션 f36494a): 정본 갱신이 프로젝트 커스터마이즈를 덮어 가짜 dangling 발생 — 기본 지원으로 흡수(/speckit.fix) |
| 2026-07-02 | `surfaceFormat`(http\|path\|any) config 추가 — FR-002/005 개정 + `normalizeKey`/`validateKey` 분기 + 테스트 | 도그푸딩(PM솔루션): Next.js 파일 라우팅·비-HTTP 자원(Dockerfile·IaC)을 Surface로 모델링 — HTTP 강제를 config로 완화 |
| 2026-07-05 | `requirementIdPrefixes` config + 요구 ID 정규식 3종 파생(FR-009) | 진단 B-2: 요구 접두어가 전 사이트에 하드코딩 — specIdPrefixes와 같은 config 파생으로 일반화(문법화, SPEC-006 연동) |
| 2026-07-05 | DEFAULTS에 회계·정책 키 5종 추가(`strictSpecs`·`requireAccounting`·`smokeManifest`·`specSyncUnownedPolicy`·`entityRegistry`) — 전부 비활성 기본값(하위호환) | 고도화 2차(B-3·P1~P3): 소비 게이트들의 새 문법은 config 어댑터 한 곳에서 선언(SPEC-007 등 연동, 런타임 DEFAULTS 패리티는 계약 테스트가 강제) |
| 2026-07-05 | DEFAULTS에 재도출·증거 스캔 키 3종 추가(`smokeScanDirs`·`derivationManifest`·`derivationClassGlobs`) — 전부 비활성 기본값(하위호환) | SPEC-009·SPEC-010 신설 동반 — 새 문법의 기본값도 config 어댑터 한 곳에서 선언(런타임 DEFAULTS 패리티는 계약 테스트가 강제) |
| 2026-07-06 | DEFAULTS에 `prefixClassExemptions` 추가 — 비활성 기본값(하위호환) | SPEC-012 신설 동반 — 접두어↔클래스 면제 레지스트리도 config 어댑터 한 곳에서 선언(런타임 DEFAULTS 패리티는 계약 테스트가 강제) |
| 2026-07-06 | `derivationClassGlobs` 기본값 보정 — 분류 원칙을 "정의 파일 + 동반·보조 파일"로: iac에 .dockerignore·kustomization·*.hcl·서브디렉토리 compose, ci에 .github/actions·.gitlab/ci·cloudbuild·travis·drone 편입(중복 루트 전용 항목은 `**/X`로 정리 — 루트 X 매치 동일) | B안: .dockerignore 등 인프라 동반 파일이 "other"로 새서 전체성 판정·D3 검출을 약화 — 접두어↔클래스 게이트(SPEC-012)와 재도출 회계(SPEC-009)의 분류 SSOT를 한 곳에서 보정 |
| 2026-07-06 | DEFAULTS에 `objectStorageMarkers`(멀티클라우드 기본 목록) 추가 | SPEC-016 신설 동반 — 오브젝트 스토리지 결정 게이트의 감지 마커를 config 어댑터가 파생·병합([]로 비활성) |
| 2026-07-06 | DEFAULTS.specIdPrefixes에 `CICD` 편입 → `["SPEC","INFRA","TEST","CICD"]` | CICD 표준 접두어 신설 — 파일명·SPEC_ID·@covers 정규식이 이 목록에서 파생되므로 CICD-NNN이 1급 수용됨 |
| 2026-07-06 | DEFAULTS에 `testInfraGlobs`(기본 []) 추가 | SPEC-015 신설 동반 — 테스트 인프라 네임스페이스 마커를 config 어댑터가 파생([]로 비활성) |
| 2026-07-06 | DEFAULTS에 `trackerCloseout`(기본 {}) 추가 | 완료 루프 close-out 규범 — 원점 트래커/보고 채널 인스턴스화 knob(게이트 아닌 스킬·사람 소비, {}로 비활성) |
| 2026-07-09 | DEFAULTS에 `draftBlockPolicy`(기본 "advisory") 추가 | SPEC-008 FR-007 신설 동반 — Draft-block을 range 모드에서도 hard로 승격하는 knob의 기본값을 config 어댑터가 선언(하위호환 유지) |
| 2026-07-09 | DEFAULTS에 `relationTypes`(기본 []) 추가 | SPEC-017 신설 동반 — Entity 관계 relation-type 어휘(capabilityVerbs 동형)의 기본값을 config 어댑터가 선언(빈 목록=무제한, 하위호환) |
| 2026-07-09 | `ownership-keys.mjs` 설계 근거 주석 경로 정정(`docs/superpowers/specs/` → `docs/design/`) | STORAGE §2.7 신설 동반 — 킷 자신의 설계 문서가 새 규약 위치로 이동, 참조 경로 동기(동작 변경 없음) |
