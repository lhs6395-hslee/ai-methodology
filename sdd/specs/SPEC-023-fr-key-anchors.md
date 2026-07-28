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
- **키 추출은 백틱·괄호 주석을 벗긴다 — 안 벗기면 앵커가 구조적으로 불가능해진다(2026-07-28 신설).** 소비 프로젝트는 `Ownership`·`Dependencies` 항목에 백틱과 사유를 함께 적는다 (`` `pjt_salary_ranges` (spec-007 소유 — rank별 최소 월급 조회) ``). 종전 추출은 ASCII 소문자 kebab 괄호 서픽스만 벗겨서 이 항목이 **통째로 키**가 됐고, 그러면 그 키를 굵게 앵커해도 "소유·참조 키 아님" 미매치가 되어 **저술자가 앵커를 붙일 방법이 없었다**. 실측(PM SPEC-004): 이런 항목 7건, `pjt_salary_ranges` 단독 키는 맵에 부재. 추출 규칙은 두 갈래로 결정적이다 — ① 백틱으로 시작하면 첫 백틱 스팬 내용(사유 안 괄호·백틱 중첩에 안전) ② 아니면 첫 ` (` 앞까지. ⚠ **이 교정은 오탐만 줄이지 않는다** — 맵에 정상 키가 늘면서, 그 키를 백틱에 둔 FR이 이제 FR-006 위반으로 드러난다(실측 A/B: 같은 파일에서 이 규칙만 바꿔 PM 마커 위반 9→17, 8건은 Ownership에 백틱째 선언된 surface 키가 FR에서도 백틱이던 **가려진 진짜 위반**). 강도는 불변이고 보이는 것만 늘어난다. ⚠ 산문을 그대로 적은 항목(`aws eks 클러스터(infra-002 소유)`·`*(없음 — …)*`)은 손대지 않는다 — 산문에서 키를 뽑는 것은 추측이고, 그건 표기 문제가 아니라 **선언 문제**다(실측 PM 7건 잔존).
- 앵커 판정은 FR "선언 라인"(불릿의 `**FR-NNN**`로 시작)만 — 본문·Change Log의 FR 언급이나 여타 절의 bold는 무관.
- FR-ID 토큰 자체(`**FR-NNN**`)는 앵커가 아니다(선언 문법).
- bold로 감싼 코드(`**`x`**`)는 앵커가 아니다 — 코드 스팬을 먼저 제거하므로(앵커 = 평문 bold 전용 문법).
- 같은 라인의 같은 토큰 중복은 1회만 보고(결정적 순서 — 라인 순·등장 순).
- 매치 정규화: 트림·소문자 — Surface(`POST /api/x`)도 소문자 비교로 매치. Files 글롭·`—` 플레이스홀더는 키 집합에서 제외.
- **굵게 ⟺ 사유 있는 키(양방향 규율, owner 요구 "굵은 글씨가 왜 굵은지 알 수 있어야").** FR 선언 라인에서: (a) 굵은 토큰은 반드시 선언 키여야 하고(아니면 위반 — FR-003), (b) 굵은 키는 반드시 그 카테고리 마커를 달아야 하며(FR-005), (c) **surface·capability** 선언 키를 백틱(리터럴)에 두면 위반(FR-006 — 그쪽 정본은 앵커뿐). **entity 키는 반대다 — 백틱이 정본 표기다**(2026-07-28 owner 결정: 백틱은 "entity 키 혹은 그 종속(컬럼·필드·enum 값)"을 뜻한다). 그래서 서식이 키의 종류를 말한다: 백틱 = 데이터 모델 / 볼드+마커 = 앵커. 그리고 (d) **소유 키는 각각 FR에 최소 1회 굵게 앵커돼야 한다**(FR-007 — 산문/백틱에만 있으면 위반, owner (B) "모든 키 참조를 굵게+마커로 강제"). 결과: 남는 굵은 것은 전부 "마커 달린 선언 키"(= 사유가 있음), 소유 키는 전부 FR에 굵게 드러나고, 비키(필드·enum·경로)는 백틱/평문. 기계 판정 범위: 각 소유 키가 **최소 1회** 앵커됐는가(FR-007) + 굵은 것/백틱의 정합(FR-003/005/006). 같은 키를 여러 번 산문 언급한 것까지 매번 굵게 강제하진 않는다(키당 1회 앵커면 충족 — 그 이상은 저술 재량).
- 기본 `off` = 판정·출력 완전 무변(하위호환) — 소비 프로젝트는 기존 수사적 bold 정리 후 advisory→hard로 점진 승격.
- **카테고리 마커(E/S/C)**(owner 요구 "굵은 글씨가 어떤 종류인지 구분"): FR 선언 라인의 각 bold 키 앵커는 그 키의 **카테고리 마커**를 단다 — entity `**토큰** (E)`·surface `**토큰** (S)`·capability `**토큰** (C)`(글자는 `frAnchorMarkers`로 설정 가능). 마커가 없으면(누락)·키의 카테고리와 다른 마커면(불일치) 위반. 키가 아닌 bold는 여기 대상 아님(base 앵커 미매치가 처리). entity/surface/capability 카테고리가 하나도 없는 프로젝트(킷 Modules·파이프라인 Datasets)는 마커 판정 inert. frKeyAnchorPolicy 강도를 공유(advisory 경고·hard 차단).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `frKeyAnchorPolicy` is off (default), THE SYSTEM SHALL perform no anchor evaluation and keep the consistency gate's output unchanged. — capability: **fr-key-anchors.judge** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **fr-key-anchors** (E) core in **key-anchor-lib.mjs** (S) SHALL extract plain-bold tokens from each FR declaration line — excluding the requirement id and any code-span content — and match each, case-insensitively after trimming, against the spec's declared Ownership and Dependencies keys with relation-type suffixes stripped, reporting matched and unmatched counts.
- **FR-003** (unwanted): IF a bold token matches no declared key, THEN THE SYSTEM SHALL name the spec, requirement id, and token — warning under advisory and exiting non-zero under hard.
- **FR-004** (unwanted): IF the policy value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it and exit non-zero.
- **FR-005** (event): WHEN the policy is advisory or hard, THE SYSTEM SHALL require every FR-declaration-line bold token that matches a declared key to be immediately followed by that key's category marker — entity/surface/capability mapped to letters via `frAnchorMarkers` (default `(E)`/`(S)`/`(C)`, the initials of the Entities/Surfaces/Capabilities categories) — reporting a missing marker or a marker whose letter mismatches the key's category, warning under advisory and exiting non-zero under hard; bold tokens that are not keys are left to the base anchor check, and where the spec declares no entity/surface/capability category the marker evaluation is skipped.
- **FR-006** (unwanted): IF the policy is advisory or hard and a declared surface or capability key appears inside a code-span (backtick literal) on an FR declaration line, THEN THE SYSTEM SHALL report it — those keys must be bold anchors carrying their category marker, not backtick literals — warning under advisory and exiting non-zero under hard; entity keys are excluded because the backtick is their canonical notation (the backtick means "an entity key, or something dependent on one — a column, a field, an enum value"), and non-key code-spans are untouched. Together with FR-003/FR-005 this makes the notation itself state the kind: backtick for the data model, bold-plus-marker for anchors.
- **FR-007** (unwanted): IF the policy is advisory or hard and an owned entity/surface/capability key is never bold-anchored in any FR declaration line of its spec (it appears only in prose or backticks, or not at all), THEN THE SYSTEM SHALL report it — the key must be surfaced as `**key** (marker)` in the FR(s) that establish it — warning under advisory and exiting non-zero under hard. This is the mandatory-anchoring direction (owner: force every key reference to bold+marker): each owned key must be visibly anchored at least once, so no key hides in prose. Where the spec owns no entity/surface/capability key the check is inert.

### Key Entities
- **key anchor** — a plain-bold token on an FR declaration line declaring "this word is (the source of) a declared ownership/dependency key", distinct from rhetorical emphasis; each anchor carries its category marker (`(E)` entity / `(S)` surface / `(C)` capability) so a reader can tell at a glance what kind of key each bold token is.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: fr-key-anchors
- **Symbols**: key-anchor-lib.mjs
- **Artifacts**: —
- **Capabilities**: fr-key-anchors.judge
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
- 카테고리 병기는 **전 카테고리**에 채택한다(entity `(E)`·surface `(S)`·capability `(C)`, owner 요구 "굵은 글씨가 어떤 종류인지 구분") — 초안은 병기 전면 불채택이었으나, 저자·리뷰어가 FR을 읽을 때 각 굵은 키의 종류를 즉시 아는 가독성 이득이 소음보다 크다는 owner 판단으로 개정(FR-005). 글자는 카테고리 이름의 머리글자이며 `frAnchorMarkers`로 프로젝트가 조정 가능(예: Surfaces를 라우트 전용으로 쓰면 `(R)`).

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
| 2026-07-21 | FR-005 일반화 — entity 전용 `(E)`에서 **전 카테고리 마커(E/R/C)** 로 확장: 굵은 키마다 종류 표기(entity `(E)`·surface/route `(R)`·capability `(C)`, `frAnchorMarkers` 설정 가능). `buildEntityKeySet`→`buildKeyKindMap`, `entityMarkerFindings`→`categoryMarkerFindings`(누락·불일치), `extractAnchorsWithMarkers`가 마커 글자 캡처. Node·Python 바이트 패리티 | owner 요구: "라우트면 (R), 이런 식으로 굵은 글씨가 어떤 건지 구분해달라" — (E)는 entity 케이스였고 실제 요청은 카테고리별 마커 |
| 2026-07-21 | FR-006 신설 — "굵게 ⟺ 사유 있는 키" 완성: 백틱(리터럴)에 든 선언 키를 위반으로(앵커여야). `extractCodeSpans`·`backtickKeyFindings` + consistency 게이트 배선, Node·Python 패리티. Assumptions '앵커는 선택'을 양방향 규율로 개정 | owner: "모든 키 참조를 굵게+마커로 강제, 키 아니면 굵게 금지 — 굵은 글씨가 왜 굵은지 알 수 있게" |
| 2026-07-21 | FR-007 신설 — 소유 키 앵커 강제((B) 완성): 소유 entity/surface/capability 키가 어느 FR에도 굵게 앵커 안 되면 위반(산문/백틱만은 불충분). `unanchoredOwnedKeyFindings` + consistency 배선, Node·Python 패리티. Assumptions '산문 강제 불가(저술 지침)'를 '키당 최소 1회 앵커 강제'로 개정 | owner: "finops도 강제하기로 했잖아 — 모든 키 참조를 굵게+마커로". 이전 라운드가 백틱 키(FR-006)만 잡고 산문 소유 키를 방치한 것을 (B)대로 강제 |
| 2026-07-27 | surface 마커 기본값 `(R)`→`(S)` — 마커 글자를 **카테고리 이름의 머리글자**(Entities/Surfaces/Capabilities)로 통일. DEFAULTS·게이트 fallback(Node·Python)·테스트 픽스처·프롬프트/프리셋 서술 일괄 교체. `frAnchorMarkers`는 그대로라 라우트 전용 프로젝트는 `{surface:"R"}`로 되돌릴 수 있음(하위호환) | owner 확정: "강조하는건 총 3개 — Entity는 (E), Surface는 (S), Capabilities는 (C)". 직전 라운드가 owner의 "라우트면 (R)" 발언을 카테고리 글자로 굳혀 `Surfaces`≠`R` 불일치를 만든 것을 교정(소비 프로젝트 2곳 200건 마커 마이그레이션 동반) |
| 2026-07-27 | `buildKeyKindMap`이 역할 선언(`cfg.__roles`)을 받아 키 종류를 판정(미전달 시 이름 폴백) | SPEC-001 FR-010 동반: 카테고리 이름이 아니라 선언된 역할로 마커 종류 결정 — 킷 자신(Modules=entity·Symbols=surface)에서 FR-005/006/007이 처음으로 발화 |
| 2026-07-27 | FR 키 앵커 완성 — 소유 키 2건을 FR 선언 라인에 볼드+마커로 앵커 | SPEC-001 FR-010(역할 선언) 도입으로 킷 자신에게 SPEC-023 FR-005/007이 처음 발화 — 익명 주어 THE SYSTEM을 실제 수행 모듈/심볼로 바꿔 앵커 삽입(FR 의미·소유 불변) |
| 2026-07-28 | FR-006 **축소** — 백틱 금지 대상을 surface·capability 키로 한정하고 entity 키는 제외(백틱이 entity의 정본 표기). Assumptions (c)항 개정, Node·Python 패리티, 회귀 테스트 3건 추가 | owner 결정(2026-07-28): "배경(백틱)은 무조건 entity키 혹은 그 종속에만 되는걸로 정의합시다". 종전 FR-006은 entity 키를 백틱에 두면 위반이라 이 정의와 **정면 충돌**했다. 결과 규범은 더 단순하다 — **서식이 키의 종류를 말한다**: 백틱=데이터 모델(entity와 그 컬럼·필드·enum), 볼드+마커=앵커. 강도 하향 아님(surface·capability 판정 불변, entity는 규칙 자체가 반대로 정의됨) |
| 2026-07-28 | 키 추출(`bareKey`) 신설 — 백틱·괄호 주석을 벗겨 키 본체만 남긴다. Node·Python 미러, 회귀 테스트 1건 | PM SPEC-004의 Dependencies 7건이 `` `키` (사유) `` 형태라 통째로 키가 되어 **앵커가 구조적으로 불가능**했다(저술자가 굵게 써도 미매치). 앵커 밀도를 올리려던 라운드가 이 벽에 막혀 118건 중 4건만 앵커할 수 있었던 직접 원인이다. A/B 실측(같은 파일에서 이 규칙만 교체): PM 마커 위반 9→17 — 늘어난 8건은 가려져 있던 진짜 FR-006 위반이다. 킷 자기적용은 0 유지(킷은 Ownership에 백틱을 쓰지 않는다) |
