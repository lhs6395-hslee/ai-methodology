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
- `normalizeKey`의 Surface 경로에 매칭되는 `<METHOD> <path>` 형태가 없으면(공백 분리 실패) 전체를 소문자화한 fallback을 반환한다.
- `loadConfig`가 `sdd.config.json` JSON 파싱에 실패하면 stderr로 경로·사유를 출력하고 `process.exit(1)`한다(조용한 무시 금지).
- `validateKey`의 Capability는 점 1개(`entity.verb`)가 아니거나 verb가 `__allVerbs`(CRUD + 등록 verb)에 없으면 위반 사유 문자열을 돌려준다.
- `__coversRe`의 FR ID 문법은 `FR-` + 3자리 + 선택적 소문자 서픽스 1자(`FR-003a`)이며 경계까지 요구한다 — 2자 서픽스(`FR-003ab`)는 부분 캡처(`FR-003a`/`FR-003`) 없이 통째로 불인정(절단 오판 금지).

---

## Functional Requirements (EARS)
> 정본은 영어. 각 FR은 구현된 동작을 서술한다(발명 금지).

- **FR-001** (event): WHEN `parseSection` receives a heading and category list, THE SYSTEM SHALL slice the text from that `## <heading>` line to the next `## ` line and return one comma-split, trimmed key array per category, excluding empty, `—`, and bracket-prefixed placeholder tokens.
- **FR-002** (event): WHEN a Surfaces key is normalized, THE SYSTEM SHALL uppercase the METHOD, lowercase the path, rewrite `:id`/`<id>`/`{id}` params to the configured `surfacePathParam` `{name}` form, and strip the trailing slash.
- **FR-003** (event): WHEN a non-Surfaces key (Entity or Capability class) is normalized, THE SYSTEM SHALL lowercase it and collapse internal whitespace to single spaces.
- **FR-004** (unwanted): IF a Capabilities key is not exactly `entity.verb` (one dot) or its verb is absent from the configured verb set, THEN THE SYSTEM SHALL return a violation reason string instead of null.
- **FR-005** (unwanted): IF a Surfaces key does not match `<METHOD> <path>` or the `event:`/`job:` form, THEN THE SYSTEM SHALL return a violation reason string.
- **FR-006** (ubiquitous): THE SYSTEM SHALL resolve the config by walking upward from the start directory for `sdd.config.json`, merge the parsed user object over `DEFAULTS`, and shallow-merge the `commands` map.
- **FR-007** (event): WHEN config is loaded, THE SYSTEM SHALL derive the shared regexes `__specIdRe` and `__coversRe` from `specIdPrefixes`, set `__root` to the config directory (or the start directory when no config file exists), and build `__allVerbs` from CRUD plus `capabilityVerbs`.
- **FR-008** (unwanted): IF `sdd.config.json` exists but fails to parse as JSON, THEN THE SYSTEM SHALL print the path and error to stderr and exit with a non-zero code.

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

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | `__coversRe` 레터 서픽스(FR-003a) 지원 + 경계 강제 | 도그푸딩(PM솔루션 f36494a): 정본 갱신이 프로젝트 커스터마이즈를 덮어 가짜 dangling 발생 — 기본 지원으로 흡수(/speckit.fix) |
