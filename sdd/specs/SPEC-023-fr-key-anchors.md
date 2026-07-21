# Feature Specification: FR Key Anchors (bold = 키 앵커 전용)

**Module**: `sdd-tooling`  **Spec**: `SPEC-023`  **Created**: 2026-07-17  **Status**: Active
**Input**: 소비 프로젝트 실측(스크린샷 리뷰): FR 선언 라인의 **bold**가 순수 수사적 강조(Fargate·PrivateLink 등)로 쓰여 기계도 리뷰어도 소비하지 않는다. 방법론엔 FR→Ownership 키 도출 절차(METHODOLOGY)와 키→본문 근거 게이트(consistency)가 있지만, **어느 단어가 어느 키의 원천인지**는 FR 본문에 흔적이 없었다. bold를 "키 앵커" 전용으로 예약하면 — FR 문장 안에서 entity/surface/capability 원천 토큰이 저술 시점에 선언되고, 결정적 대조(앵커↔선언 키)가 가능해진다. consistency(키→본문)의 역방향 짝으로 양방향 앵커가 닫힌다.

---

## User Scenarios & Testing

### User Story 1 — FR 안에서 키의 원천이 보인다 (P1)
`frKeyAnchorPolicy`를 켜면 FR 선언 라인의 평문 bold 토큰을 그 스펙의 Ownership ∪ Dependencies 키(정규화, 관계 서픽스 제거)와 대조한다. 매치는 "이 FR이 이 키의 근거"로 집계되고, 미매치는 수사적 강조(또는 미선언 키)로 표면화된다 — advisory는 경고, hard는 exit 1. 백틱 코드 스팬은 리터럴이라 앵커가 아니다(기존 `` `- **Files**:` `` 류 인용과 충돌 없음).
- **Independent Test**: `key-anchor.test.mjs`가 순수 코어(추출·정규화·대조)와 게이트 배선(off/advisory/hard)을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `frKeyAnchorPolicy: hard` and an FR line bolding a token that matches no declared key, **When** the consistency gate runs, **Then** it names the spec, requirement id, and token, and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 앵커 판정은 FR "선언 라인"(불릿의 `**FR-NNN**`로 시작)만 — 본문·Change Log의 FR 언급이나 여타 절의 bold는 무관.
- FR-ID 토큰 자체(`**FR-NNN**`)는 앵커가 아니다(선언 문법).
- bold로 감싼 코드(`**`x`**`)는 앵커가 아니다 — 코드 스팬을 먼저 제거하므로(앵커 = 평문 bold 전용 문법).
- 같은 라인의 같은 토큰 중복은 1회만 보고(결정적 순서 — 라인 순·등장 순).
- 매치 정규화: 트림·소문자 — Surface(`POST /api/x`)도 소문자 비교로 매치. Files 글롭·`—` 플레이스홀더는 키 집합에서 제외.
- 앵커는 선택이다(모든 FR이 키를 언급하진 않음) — 게이트는 "bold가 있으면 키여야 한다"만 강제하고 "키가 bold여야 한다"는 강제하지 않는다(후자는 consistency의 키→본문 근거가 이미 커버).
- 기본 `off` = 판정·출력 완전 무변(하위호환) — 소비 프로젝트는 기존 수사적 bold 정리 후 advisory→hard로 점진 승격.
- **(E) 엔티티 마커**(owner 요구): FR 선언 라인의 entity 앵커는 `**토큰** (E)`로 표기해 화면(Surface)·능력(Capability) 앵커와 구분한다 — "이 bold가 entity인지"의 가독성. entity 키인데 (E)가 없으면(누락)·entity가 아닌데 (E)가 붙으면(오부착) 위반. entity 카테고리가 없는 프로젝트(킷 Modules·파이프라인 Datasets)는 마커 판정 inert. 마커는 **entity 카테고리에만** 국한(전 카테고리 병기 아님 — 소음 최소화). frKeyAnchorPolicy 강도를 공유(advisory 경고·hard 차단).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `frKeyAnchorPolicy` is off (default), THE SYSTEM SHALL perform no anchor evaluation and keep the consistency gate's output unchanged.
- **FR-002** (event): WHEN the policy is advisory or hard, THE SYSTEM SHALL extract plain-bold tokens from each FR declaration line — excluding the requirement id and any code-span content — and match each, case-insensitively after trimming, against the spec's declared Ownership and Dependencies keys with relation-type suffixes stripped, reporting matched and unmatched counts.
- **FR-003** (unwanted): IF a bold token matches no declared key, THEN THE SYSTEM SHALL name the spec, requirement id, and token — warning under advisory and exiting non-zero under hard.
- **FR-004** (unwanted): IF the policy value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it and exit non-zero.
- **FR-005** (event): WHEN the policy is advisory or hard and the spec has an entity-like ownership category, THE SYSTEM SHALL require every FR-declaration-line bold token that matches an entity key to be immediately followed by an `(E)` marker, and require any `(E)` marker to follow only an entity key — reporting a missing marker on an entity anchor and a spurious marker on a non-entity anchor, warning under advisory and exiting non-zero under hard; where the spec has no entity-like category the marker evaluation is skipped.

### Key Entities
- **key anchor** — a plain-bold token on an FR declaration line declaring "this word is (the source of) a declared ownership/dependency key", distinct from rhetorical emphasis; an entity-category anchor additionally carries an `(E)` marker so entities are visually distinct from surface/capability anchors.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: fr-key-anchors
- **Symbols**: key-anchor-lib.mjs
- **Artifacts**: —
- **Files**: tooling/key-anchor-lib.mjs, tooling/__tests__/key-anchor.test.mjs

## Dependencies (참조 — dedup 제외)
> consistency 게이트 본체·키 파싱은 SPEC-002/001 소유(이 spec은 앵커 판정 코어만), 관계 서픽스 문법은 SPEC-017, Python 복제는 SPEC-006.
- **Modules**: spec-quality-gates (references), key-pipeline (references), entity-relations (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `key-anchor.test.mjs` 전 케이스 green + 앵커 판정 출력·exit의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 advisory로 켠 상태에서 미매치 0(도그푸딩 — 도입 시 실수확 1건: SPEC-003 FR-005의 수사적 bold "beginning"을 검출·정리).

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 파싱·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO는 소비 게이트(check-spec-consistency)가 수행.

## Assumptions / Clarifications Retained
- 앵커의 "의미 적정성"(이 FR에 앵커를 달았어야 하는가, 달지 않은 것이 정당한가)은 리뷰 경계 — 게이트는 "단 bold가 키인가"의 결정 신호만 강제한다.
- 카테고리 병기는 **entity에 한해** 채택한다(`**토큰** (E)`, owner 요구 "이게 entity인지 보이게") — entity는 aggregate-root 정체성이라 화면·능력 앵커와의 구분이 저술·리뷰에 가장 중요하다(FR-005). 나머지 카테고리(surface·capability)는 매치된 선언 절에서 기계 판정 가능하므로 병기하지 않는다(소음 최소화 — 초안의 전면 불채택을 entity 한정으로 개정).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-17 | 셀프리뷰(순수 코어 TDD·게이트 e2e off/advisory/hard·Node↔Python 바이트 패리티·킷 자신 advisory 실측) + owner 승인("hard까지 설계") → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-17 이웃 SPEC-002(spec-quality-gates): 비중복 — consistency 게이트 본체(키→본문 근거)는 SPEC-002 소유, 이 spec은 역방향(본문 bold→키) 판정 코어만 소유(소비는 SPEC-002 게이트).
- 2026-07-17 이웃 SPEC-013(spec-grammar-hardening): 비중복 — SPEC-013은 스펙 구조 문법(Module·SHALL·참조 실재), 이 spec은 FR 본문 내 강조의 의미론(키 앵커) — 층위가 다름(구조 vs 본문 표기).
- 2026-07-17 이웃 SPEC-001(key-pipeline): 비중복 — 키 정규화·도출 절차는 SPEC-001 소유, 이 spec은 그 키와 FR 본문 표기의 대조만.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-17 | 초안 — `frKeyAnchorPolicy`(off\|advisory\|hard) + `key-anchor-lib`(평문 bold 추출·코드 스팬 제외·키 대조) + consistency 게이트 배선, Node·Python 패리티. 킷 자신 advisory on | 소비 프로젝트 실측(owner 제기): FR bold가 수사적 장식뿐 — "어느 단어가 entity/surface인지" 강조가 키 도출의 가시적 앵커여야 한다는 제안. 도입 즉시 킷 자신에서 수사적 bold 1건(SPEC-003 "beginning") 실수확·정리 |
| 2026-07-21 | (E) 엔티티 마커 신설(FR-005) — FR 선언 라인의 entity 앵커는 `**토큰** (E)` 표기(entity 식별 가독성). `key-anchor-lib`에 `extractAnchorsWithMarkers`·`buildEntityKeySet`·`entityMarkerFindings` + consistency 게이트 배선(frKeyAnchorPolicy 강도 공유), Node·Python 패리티. Assumptions의 '카테고리 병기 불채택'을 entity 한정 채택으로 개정 | owner 요구: "FR에서 entity는 명조처리하고 뒤에 (E)를 붙여 이게 그거(entity)인지 알게" — 초안의 병기 전면 불채택 결정을 entity에 한해 뒤집음 |
