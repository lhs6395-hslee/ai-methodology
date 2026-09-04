# Feature Specification: FR Locator (변경 대상 → 어느 FR인가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-062`  **Created**: 2026-09-04  **Status**: Active
**Input**: 오너 제보(실측) — "뭐 하나 바꾸는데 너무 오래 걸린다. 변경할 때 FR 찾는 게 너무 오래 걸리는 것 같다." 진단: spec-first는 이미 편집 시점에 발화하지만(`check-pre-edit.mjs`가 매 편집마다 파일→소유 스펙을 계산) 그 출력이 **스펙 ID까지만** 좁히고 "그 스펙의 FR/Edge Cases/Change Log를 보라"에서 멈춘다 — 어느 FR인지는 사람·에이전트가 **스펙 통독**으로 찾아야 했다. 킷 자신은 스펙당 FR 최대 11개라 통독이 싸지만 소비 프로젝트(gsn-ai-pm-management-tool)는 `maxFRsPerSpec: 50`·`entityRegistry` 53건이라 같은 절차가 수 배 비싸고, 그 비용을 **변경 1건마다** 낸다. 재료는 이미 전부 계산되고 있었다(테스트의 `@covers` 태그 · FR 라인이 백틱으로 지목한 구현체 · FR의 굵은 키 앵커) — 다만 **이 질문에 답하는 자리가 없었다.** `sdd/OWNERSHIP_MAP.md`(SPEC-028)는 키→가드 맵이라 축이 다르다.

---

## User Scenarios & Testing

### User Story 1 — 편집 시점에 어느 FR인지 이미 화면에 있다 (P1)
소유 스펙이 미수정인 파일을 편집하려 하면 pre-edit 훅이 소유 스펙과 함께 **FR 후보와 그 근거**를 출력한다. 실측 재현: FR 4개짜리 스펙에서 `budget-approval.ts`를 편집하려 하면 후보 1건(`FR-002`, 근거 `named-fn(approveBudget) + named-mod(budget-approval.ts)`)으로 좁혀져 통독이 0회가 된다.
- **Independent Test**: `fr-locator.test.mjs`가 순수 코어(근거 4종·감쇠·정렬·감사 절 분리)와 소비처 배선(훅 출력·조회기)을 단독 검증. [검증: tooling/__tests__/fr-locator.test.mjs]
- **Acceptance (GWT)**: 1. **Given** FR 4개 중 하나만 그 파일의 함수를 백틱으로 지목한 스펙, **When** 그 파일에 pre-edit 훅이 돌면, **Then** 후보 1건과 근거 종류가 출력되고 Node·Python 출력이 바이트 동일하다.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **추측하지 않는다.** 근거 4종은 전부 결정적 대조(태그 멤버십·이름 일치·앵커 대응·부분문자열)다. 유사도로 "비슷해 보이는 FR"을 추천하지 않는다 — 조회기의 거짓 확신은 통독보다 비싸다(틀린 FR에 Change Log를 달면 결정이 잘못된 자리에 기록된다).
- **못 좁혔으면 못 좁혔다고 말한다(FR-002).** 근거 0건인 FR은 후보에서 제외하고, 소비처가 "0건 — 통독 필요" + 좁히는 방법(테스트 태그 심기·FR 라인에서 지목)을 출력한다. 근거 없는 FR을 섞으면 목록이 길어지며 조회의 의미가 사라진다.
- **후보 = 전체도 실패다(FR-003).** 실측: 테스트 파일 하나가 SPEC-060의 FR 6개를 모두 `@covers`로 태깅해 조회 결과가 6/6이 됐다. 그 태그는 "이 FR"이 아니라 "이 파일이 이 스펙 전반을 검증한다"는 뜻이므로 태깅 폭으로 감쇠하고(정렬 1위는 여전히 가장 직접적인 근거), 소비처가 "좁혀지지 않았다"를 명시한다.
- **정본 언어와 작업 언어의 간극은 조회기가 메운다(FR-004).** 이 킷은 FR 정본이 영어(EARS)이고 한글 서술은 User Story·Edge Cases·Change Log에 산다. 그래서 "배포창"으로 찾으면 FR 라인 매치가 0건이다 — 실제로 그 개념의 주인이 있는데도. 키워드 모드는 스펙 단위 매치도 내고, **감사 트레일(Change Log·Review Log·Dedup-Review) 매치는 "과거 기록"으로 분리**한다(그 개념의 현재 주인이 아니다 — 실측: "유령 entity"로 조회하니 현재 주인 SPEC-026 옆에 과거 한 번 언급한 SPEC-001·002·030이 같은 무게로 섞였다). 감사 절 목록의 정본은 `grammar-lib`이며 SPEC-016의 마커 스캔도 같은 규율을 쓴다.
- **훅은 싼 근거만 쓴다(FR-005).** 편집마다 도는 자리이므로 대상 파일 1개 + 소유 스펙 1개 읽기로 끝나는 지목·앵커 대조까지만 한다. 테스트 전수 스캔이 필요한 `@covers` 근거는 조회기의 몫이다 — 편집마다 레포를 순회하면 훅이 느려지고, **느린 훅은 우회된다.**
- **조회기는 판정기가 아니다(FR-006).** verdict는 SKIPPED(조회 모드)로 선언한다 — 게이트 스윕의 판정 집계에 섞이면 "조회했다"가 "판정했다"로 오독된다. exit code로 옳고 그름을 말하지 않는다(후보를 찾았든 못 찾았든 0).
- **⚠ 미해소 부채 — 조회 비용이 스펙 수에 선형이다.** 현재 조회기는 매 호출마다 전 스펙을 읽고(킷 실측: 62 스펙·1.1MB·106ms), covers 근거를 위해 테스트 파일도 전수 스캔한다. 오너 요구는 **키 방식 O(1) 조회**("스펙이 많아져도 시간이 오래 걸리면 안 된다")이고, 같은 실측에서 더 큰 병목이 드러났다: 전 스펙을 읽는 게이트가 24개이고 `sdd-sync` 전 게이트 스윕이 **124초**다. 해법은 이 축을 생성물 인덱스(키→스펙/FR·파일→스펙/FR·covers·용어)로 바꿔 조회를 파일 1개 읽기로 만드는 것이며(`gen-ownership-map`이 이미 쓰는 생성물 패턴), **다음 증분의 과제로 남긴다.** 지금 판을 그대로 두는 이유: 근거 산출 코어는 인덱스 방식에서도 그대로 재사용된다(인덱스 생성 시 한 번 계산). 부채를 감추지 않기 위해 이 절에 남긴다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN given a change target — a repository-relative path, its current text, or a domain keyword — the **fr-locator** (E) core in **fr-locator-lib.mjs** (S) SHALL return FR candidates whose evidence is one or more of four deterministic matches: a `@covers` tag from a test that references the target, a function named in the FR line's backticks that appears in the target's text, a module named in those backticks that equals the target's basename, or a bold key anchor that corresponds to the target path — and SHALL NOT infer candidates by similarity. — capability: **fr-locator.locate** (C).
- **FR-002** (unwanted): IF an FR has zero evidence, THEN THE SYSTEM SHALL exclude it from the returned candidates, so a consumer can report "not narrowed — read the spec" rather than presenting an unfiltered list as a result.
- **FR-003** (event): WHEN a `@covers` tag comes from a test that tags many FRs of the same spec, THE SYSTEM SHALL attenuate that evidence's weight by the tag's breadth and SHALL carry the breadth in the reported reason, because a broad tag asserts "this file verifies this spec" rather than "this FR".
- **FR-004** (event): WHEN a domain keyword is given, THE SYSTEM SHALL additionally report which specs contain it and in which sections, separating matches that fall only inside audit-trail sections as past record rather than current ownership — because the FR canon is English while working prose is not, so a keyword may have no FR-line match even when its owning spec exists.
- **FR-005** (event): WHEN **check-pre-edit.mjs** (S) reports an unmodified owning spec, THE SYSTEM SHALL print the top FR candidates with their evidence and the count against that spec's total FRs, using only the cheap evidence (target text and owning spec, no repository scan), and SHALL point to the full lookup for the rest; the Node and Python runtimes SHALL produce byte-identical output.
- **FR-006** (state): WHILE **sdd-where.mjs** (S) runs, THE SYSTEM SHALL declare a skipped (lookup-mode) verdict rather than a judgment and SHALL exit zero regardless of whether candidates were found, so the gate sweep cannot read a lookup as a judgment.

### Key Entities
- **fr-locator** — the mapping from a change target (file, symbol, or domain word) to the requirements that govern it, assembled from evidence other axes already compute, so that finding "which FR" costs a lookup instead of a full read of the spec.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: fr-locator
- **Symbols**: fr-locator-lib.mjs, sdd-where.mjs
- **Artifacts**: —
- **Capabilities**: fr-locator.locate
- **Files**: tooling/fr-locator-lib.mjs, tooling/sdd-where.mjs, tooling/__tests__/fr-locator.test.mjs

## Dependencies (참조 — dedup 제외)
> 근거 재료의 정본은 각 소유 스펙이다 — `@covers` 회계(SPEC-007) · FR이 지목한 구현체(SPEC-046) · 굵은 키 앵커(SPEC-023) · 심볼↔경로 대응(SPEC-029) · 감사 절 목록·FR 선언 라인 범위(SPEC-013). 훅 본체는 SPEC-003, Python 복제는 SPEC-006.
- **Modules**: verification-accounting (references), impl-reference (references), fr-key-anchors (references), ownership-reality (references), spec-grammar-hardening (references), spec-sync (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `fr-locator.test.mjs` 전 케이스 green + pre-edit 훅 출력의 Node↔Python 바이트 동일(실측 픽스처로 확인). [검증: tooling/__tests__/fr-locator.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-002**: 실측 재현 픽스처(FR 4개 중 하나만 대상 파일의 함수를 백틱으로 지목)에서 후보가 1건으로 좁혀지고 근거 종류가 출력된다 — 통독 0회. [검증: tooling/__tests__/fr-locator.test.mjs]
- **SC-003**: 넓은 태깅(테스트 1개가 스펙 FR 전부 태깅) 픽스처에서 covers 근거가 감쇠되고 정렬 1위가 추가 근거(앵커·지목)를 가진 FR이며, 소비처가 "좁혀지지 않았다"를 출력한다. [검증: tooling/__tests__/fr-locator.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 후보 산출 코어는 문자열·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO(스펙 읽기·테스트 스캔·경로 정규화)는 소비처가 수행한다. [검증: tooling/__tests__/fr-locator.test.mjs]

## Assumptions / Clarifications Retained
- 조회 비용은 현재 스펙 수에 선형이다(위 Edge Case의 미해소 부채) — 오너 요구인 키 방식 O(1) 조회는 생성물 인덱스로 다음 증분에서 닫는다. 이 spec의 코어는 그때 인덱스 **생성기**의 계산 단계로 재사용된다(폐기가 아니다).
- 조회기는 Node 전용이다 — `sdd-retire.mjs`와 같은 이유(대화형 편의 계층이고 게이트 스윕의 판정 대상이 아니다). 반면 pre-edit 훅은 판정 경로라 Python 미러가 필수다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-09-04 | 셀프리뷰(순수 코어 단위·훅 e2e·Node↔Python 바이트 패리티 실측·킷 자기 조회 도그푸딩 3케이스) + 오너 제보 기반 | FR-001~006 unit 커버, 조회 비용 부채는 Edge Case에 명시 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-09-04 이웃 SPEC-028(ownership-map): 비중복 — SPEC-028은 **소유 키별로 어느 가드가 판정했는가**(보증 맵), 이 spec은 **변경 대상별로 어느 FR이 지배하는가**(요구 조회). 둘 다 맵이지만 좌변과 우변이 모두 다르다.
- 2026-09-04 이웃 SPEC-046(impl-reference): 비중복 — SPEC-046은 FR이 지목한 구현체가 **실행 경로에서 참조되는가**를 판정(위반 탐지), 이 spec은 그 지목을 **조회의 근거로 소비**한다(판정 아님).
- 2026-09-04 이웃 SPEC-003(spec-sync): 비중복 — spec-first 강제·pre-edit 훅 본체는 SPEC-003 소유이고, 이 spec은 그 훅이 출력할 **FR 후보 산출**만 소유한다(훅은 소비처).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-09-04 | 초안 — `fr-locator-lib`(근거 4종 산출·태깅 폭 감쇠·감사 절 분리) + `sdd-where` 조회기(파일·키워드 모드, JSON 출력) + `check-pre-edit` 출력에 FR 후보 주입(Node·Python 바이트 동일). `grammar-lib`에 감사 절 목록 정본(`AUDIT_TRAIL_SECTIONS`) 신설하고 SPEC-016 마커 스캔이 그것을 쓰도록 교체(같은 목록이 Node·Python 각 1곳에 리터럴로 박혀 있었다 — R13) | 오너 제보: 변경 1건마다 FR 탐색이 통독이라 너무 오래 걸린다. 재료(테스트 태그·FR 지목·키 앵커)는 이미 계산되고 있었고 답하는 자리만 없었다. 도그푸딩에서 결함 2건 즉시 실수확 — ① `--keyword` 미지정 시 첫 인자가 조용히 버려지는 인자 파싱 결함, ② 넓은 태깅으로 후보가 전체와 같아지는데 성공처럼 보이던 출력 [검증: tooling/__tests__/fr-locator.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
