# Feature Specification: Entity Synonym (동의어·형태 변이 — 의미적 중복의 결정적 포획층)

**Module**: `sdd-tooling`  **Spec**: `SPEC-033`  **Created**: 2026-07-30  **Status**: Active
**Input**: 감사(이슈 #21) semantic-dup 6건 — dedup(SPEC-002)은 **키 문자열의 유일성**만 본다. 그래서 `order`/`orders`/`pjt_order`처럼 형태만 다른 같은 실체, `user`/`member`처럼 말만 다른 같은 개념이 전부 통과한다. owner 판단: 의미적 중복도 툴로 처리하되 **entity로 범위를 좁힌다**(aggregate root = 중복의 최고가치 표적, 대상이 수십 개라 오탐 검토가 사람 손에 감당된다). 결정적 제약(owner): **"LLM으로 맡기면 분명히 실수가 발생하고, 그걸 방지하기 위한 툴킷이 필요하다."** 그래서 확률적 판정에는 **어떤 강도에서도 차단력을 주지 않고**, 사람이 결정적 층(정본 선언·기각 원장)으로 착지시켜야만 후보가 소멸하도록 설계한다.

---

## User Scenarios & Testing

### User Story 1 — 형태 변이는 기계가, 의미 판정은 사람이 (P1)
게이트가 소유 entity 키를 세 층으로 판정한다: ① 정규화 후 충돌하는 **형태 변이**(단복수·케이스·접두어), ② `synonymRegistry`가 선언한 **별칭 사용**, ③ 외부 툴(SBERT·LLM·WordNet)이 주입한 **유사 후보**. ①②는 결정적이라 정책 강도대로 차단하고, ③은 정책과 무관하게 언제나 advisory이며 사람이 정본 선언 또는 기각 원장으로 결정할 때까지 매 실행 재부상한다.
- **Independent Test**: `synonym.test.mjs`가 순수 코어(정규화·충돌·registry 무결성·후보 분류)와 게이트 배선(off/advisory/hard·③ 비차단 보장·skipped)을 단독 검증. [검증: tooling/__tests__/synonym.test.mjs]
- **Acceptance (GWT)**: 1. **Given** `synonymPolicy: hard` and two specs owning `order` and `pjt_orders`, **When** the gate runs, **Then** it reports one lexical collision naming both keys and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **확률적 층은 구조적으로 차단하지 못한다** — `hard`여도 미결 후보만 남으면 exit 0이다. 이는 산문 규범이 아니라 코드 분기이며 테스트로 고정된다(오탐이 빌드를 깨면 그 실수가 곧 방법론의 오류가 된다는 owner 제약).
- **미결 후보는 조용히 사라지지 않는다** — 정본 통합(`synonymRegistry`)이나 기각(`synonymReviewLedger`) 중 하나로 착지해야만 목록에서 빠진다. 둘 다 **사유 필수**라 config 리뷰 관문을 거친다(entityRegistry 동형) — LLM이 조용히 정본을 바꿀 수 없다.
- registry 무결성은 결정적으로 검사한다: 사유 없음·별칭 0개·정본이 어느 스펙에도 소유되지 않음(실재하지 않는 정본 선언)·한 별칭이 두 정본에 걸림(모순) → 즉시 에러.
- 단수화는 **보수적**이다 — `status`·`class`·`analysis`처럼 `ss`/`us`/`is`/`os`로 끝나는 말은 건드리지 않는다(과잉 병합이 정본을 흔드는 것이 오탐보다 나쁘다). 3글자 이하도 제외.
- 접두어 제거는 `keyPrefixes`가 비면 **하지 않는다** — 프로젝트가 선언한 접두어만 벗긴다(임의 병합 금지). 토큰이 전부 접두어면 원형을 유지한다.
- 판정 대상은 **entity 역할 카테고리만**이다 — surface(경로)·capability(`entity.verb`)는 형태 규칙이 다르고, entity가 동의어 문제의 최고가치 표적이다. entity 역할 미해석이면 inert이고 hard면 거짓 안전이라 exit 1.
- 후보 생성기 실행 실패(오프라인·바이너리 없음·타임아웃)는 **skipped(사유)** — "후보 없음"이 아니라 "판정 못 함"으로 명시한다.
- 기본 `off`. ③은 `entitySimilarityCommand`를 꽂아야 동작하는 옵트인이라, 킷·미채택 프로젝트는 비용 0.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `synonymPolicy` is off, **check-synonym.mjs** (S) SHALL perform no evaluation and exit zero. — capability: **entity-synonym.judge** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **entity-synonym** (E) core in **synonym-lib.mjs** (S) SHALL fold each owned entity key to a canonical form — case/separator tokenization, conservative singularization, and declared-prefix stripping — and report every canonical form claimed by two or more distinct keys as a lexical collision.
- **FR-003** (unwanted): IF an owned entity key is declared as an alias in `synonymRegistry`, THEN THE SYSTEM SHALL report it with its canonical key so the spec is unified onto the canonical name.
- **FR-004** (unwanted): IF `synonymRegistry` or `synonymReviewLedger` has an entry with an empty rationale, an alias equal to its canonical, an alias bound to two canonicals, or a canonical no spec owns, THEN THE SYSTEM SHALL report each error and exit non-zero before judging.
- **FR-005** (event): WHERE `entitySimilarityCommand` is declared, WHEN the gate runs, THE SYSTEM SHALL execute it, read each stdout line as a candidate pair, drop pairs already resolved by the registry or the ledger, and surface the remainder as unresolved candidates requiring a human decision; WHERE the command fails, THE SYSTEM SHALL report it as skipped with the reason.
- **FR-006** (unwanted): IF only unresolved candidates exist and no deterministic finding does, THEN THE SYSTEM SHALL exit zero even under hard — probabilistic judgment SHALL never gain blocking power, regardless of policy strength.
- **FR-007** (unwanted): IF the `synonymPolicy` value is outside off|advisory|hard, or the entity role is unresolved while the policy is hard, THEN THE SYSTEM SHALL report it clearly and exit non-zero.

### Key Entities
- **entity-synonym** — the judgment that two owned entity keys denote one concept, split into a deterministic half (canonical-form collision, declared aliases) that may block and a probabilistic half (injected similarity candidates) that may only surface, so that machine guessing never silently redefines the domain.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: entity-synonym
- **Symbols**: synonym-lib.mjs, check-synonym.mjs
- **Artifacts**: —
- **Capabilities**: entity-synonym.judge
- **Files**: tooling/synonym-lib.mjs, tooling/check-synonym.mjs, tooling/__tests__/synonym.test.mjs

## Dependencies (참조 — dedup 제외)
> config knob·Python 복제·sync 배선·설치 매니페스트는 각 소유 스펙(001/006/004). 키 파싱·정규화는 SPEC-001, 구조적 dedup은 SPEC-002가 소유하고 이 spec은 그 사각(형태·의미)만 담당한다.
- **Modules**: key-pipeline (references), spec-quality-gates (references), runtime-parity (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `synonym.test.mjs` 전 케이스 green + 판정 출력·exit의 Node↔Python 바이트 동일(패리티 확인). [검증: tooling/__tests__/synonym.test.mjs]
- **SC-002**: 재현 픽스처에서 형태 충돌(`order`/`pjt_orders`)은 hard exit 1, **미결 후보만 남으면 hard에서도 exit 0**(확률적 비차단 보장), registry·원장 무결성 위반은 판정 전 exit 1. [검증: tooling/__tests__/synonym.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 정규화·집합 대조만의 순수 함수라 결정적이며, 외부 툴 실행·타임아웃은 소비 게이트가 수행한다(킷은 SBERT·LLM을 번들하지 않는다 — 이식성).

## Assumptions / Clarifications Retained
- 외부 툴 선택은 프로젝트 몫이다 — 임베딩(SBERT·fastembed·로컬 Ollama), 어휘 DB(WordNet), 스키마 매칭(Valentine), LLM judge 중 무엇이든 "한 줄 = 한 후보 쌍" 계약만 지키면 된다.
- 이 게이트는 후보의 **품질**을 판정하지 않는다. 나쁜 생성기는 미결 후보를 잔뜩 만들 뿐이고, 그 잡음의 대가는 사람의 기각 원장 작성이다 — 그래서 생성기 임계값 조정은 프로젝트의 책임이다.
- 형태 변이 규칙(단수화·접두어)은 영어·식별자 관례를 가정한다. 다른 언어 도메인은 `keyPrefixes`와 registry 선언으로 보완한다(자동 추론 확대 금지).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-30 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·확률적 비차단 계약 실측 고정) + owner 확정("①+②+③ 전부" + "LLM 실수를 방지하는 툴킷이 필요") → Active | FR-001~007 unit 커버. 킷 자기적용 advisory에서 형태 충돌 0(entity 33건) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-30 이웃 SPEC-002(spec-quality-gates): 비중복 — SPEC-002의 dedup은 **정규화된 키 문자열의 유일성**(같은 글자), 이 spec은 **다른 글자가 같은 개념인가**(형태 변이·선언 동의어·유사 후보). 감사가 지목한 그 사각을 담당한다.
- 2026-07-30 이웃 SPEC-001(key-pipeline): 비중복 — SPEC-001의 `normalizeKey`는 카테고리 문법 정규화(METHOD 대문자·경로 소문자 등)로 **표기 통일**, 이 spec의 `canonicalForm`은 단복수·접두어까지 접는 **동일성 판정 전용 폴딩**이다(소유 키 자체를 바꾸지 않는다).
- 2026-07-30 이웃 SPEC-026(entity-schema-backing): 비중복 — SPEC-026은 소유 entity가 스키마에 **실재하는가**, 이 spec은 실재하는 둘이 **같은 것인가**. 실재 판정과 동일성 판정은 축이 다르다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-30 | 초안 — `synonymPolicy`(off\|advisory\|hard) + `synonymRegistry`(정본·별칭·사유) + `synonymReviewLedger`(기각 원장) + `keyPrefixes` + `entitySimilarityCommand`(외부 툴 주입) + `synonym-lib`(정규화·충돌·분류) + `check-synonym` 게이트 + sdd-sync R10, Node·Python 바이트 패리티 | 감사(#21) semantic-dup: dedup이 키 문자열만 봐서 `order`/`orders`·`user`/`member`가 통과. owner 확정 "①+②+③ 전부" + **"LLM 실수 방지 툴킷"** — 확률적 층에 차단력을 주지 않고(코드 분기·테스트 고정), 미결 후보를 사유 있는 결정으로만 소멸시키는 포획 구조로 설계 |
