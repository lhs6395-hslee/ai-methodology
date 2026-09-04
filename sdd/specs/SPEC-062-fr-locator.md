# Feature Specification: FR Locator (변경 대상 → 어느 FR인가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-062`  **Created**: 2026-09-04  **Status**: Active
**Input**: 오너 제보(실측) — "뭐 하나 바꾸는데 너무 오래 걸린다. 변경할 때 FR 찾는 게 너무 오래 걸리는 것 같다." 진단: spec-first는 이미 편집 시점에 발화하지만(`check-pre-edit.mjs`가 매 편집마다 파일→소유 스펙을 계산) 그 출력이 **스펙 ID까지만** 좁히고 "그 스펙의 FR/Edge Cases/Change Log를 보라"에서 멈춘다 — 어느 FR인지는 사람·에이전트가 **스펙 통독**으로 찾아야 했다. 킷 자신은 스펙당 FR 최대 11개라 통독이 싸지만 소비 프로젝트(gsn-ai-pm-management-tool)는 `maxFRsPerSpec: 50`·`entityRegistry` 53건이라 같은 절차가 수 배 비싸고, 그 비용을 **변경 1건마다** 낸다. 재료는 이미 전부 계산되고 있었다(테스트의 `@covers` 태그 · FR 라인이 백틱으로 지목한 구현체 · FR의 굵은 키 앵커) — 다만 **이 질문에 답하는 자리가 없었다.** `sdd/OWNERSHIP_MAP.md`(SPEC-028)는 키→가드 맵이라 축이 다르다.

---

## User Scenarios & Testing

### User Story 1 — 편집 시점에 어느 FR인지 이미 화면에 있다 (P1)
소유 스펙이 미수정인 파일을 편집하려 하면 pre-edit 훅이 소유 스펙과 함께 **FR 후보와 그 근거**를 출력한다. 실측 재현: FR 4개짜리 스펙에서 `budget-approval.ts`를 편집하려 하면 후보 1건(`FR-002`, 근거 `named-fn(approveBudget) + named-mod(budget-approval.ts)`)으로 좁혀져 통독이 0회가 된다.
- **Independent Test**: `fr-locator.test.mjs`가 순수 코어(근거 4종·감쇠·정렬·감사 절 분리)와 소비처 배선(훅 출력·조회기)을 단독 검증. [검증: tooling/__tests__/fr-locator.test.mjs]
- **Acceptance (GWT)**: 1. **Given** FR 4개 중 하나만 그 파일의 함수를 백틱으로 지목한 스펙, **When** 그 파일에 pre-edit 훅이 돌면, **Then** 후보 1건과 근거 종류가 출력되고 Node·Python 출력이 바이트 동일하다.

### User Story 2 — 스펙이 늘어도 조회 비용은 같다 (P1)
조회는 미리 계산한 인덱스 파일 하나를 읽는다. 실측 재현: 스펙 63개·FR 372개인 이 레포에서 `sdd-where`가 스펙 파일을 0회 읽고 68~76ms에 답하며(초안은 매 조회에 1.1MB 전수 읽기), 인덱스가 낡으면 그 사실을 말하고 스펙 직접 읽기로 폴백한다.
- **Independent Test**: `fr-index.test.mjs`가 지문·인덱스 구축·드리프트 판정을 단위로, 그리고 "인덱스 최신이면 스펙을 읽지 않는다"를 스펙 내용 바꿔치기(크기·mtime 보존)로 단독 검증. [검증: tooling/__tests__/fr-index.test.mjs]
- **Acceptance (GWT)**: 1. **Given** 인덱스가 최신인 레포, **When** 그 인덱스를 만든 뒤 스펙 본문을 크기·mtime을 유지한 채 다른 내용으로 바꿔치기하고 조회하면, **Then** 결과가 인덱스 기준으로 불변이다(스펙을 읽지 않았다는 증거) — 반대로 인덱스를 지우면 조회가 "인덱스 없음"을 알리고 폴백한다.
### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **추측하지 않는다.** 근거 4종은 전부 결정적 대조(태그 멤버십·이름 일치·앵커 대응·부분문자열)다. 유사도로 "비슷해 보이는 FR"을 추천하지 않는다 — 조회기의 거짓 확신은 통독보다 비싸다(틀린 FR에 Change Log를 달면 결정이 잘못된 자리에 기록된다).
- **못 좁혔으면 못 좁혔다고 말한다(FR-002).** 근거 0건인 FR은 후보에서 제외하고, 소비처가 "0건 — 통독 필요" + 좁히는 방법(테스트 태그 심기·FR 라인에서 지목)을 출력한다. 근거 없는 FR을 섞으면 목록이 길어지며 조회의 의미가 사라진다.
- **후보 = 전체도 실패다(FR-003).** 실측: 테스트 파일 하나가 SPEC-060의 FR 6개를 모두 `@covers`로 태깅해 조회 결과가 6/6이 됐다. 그 태그는 "이 FR"이 아니라 "이 파일이 이 스펙 전반을 검증한다"는 뜻이므로 태깅 폭으로 감쇠하고(정렬 1위는 여전히 가장 직접적인 근거), 소비처가 "좁혀지지 않았다"를 명시한다.
- **정본 언어와 작업 언어의 간극은 조회기가 메운다(FR-004).** 이 킷은 FR 정본이 영어(EARS)이고 한글 서술은 User Story·Edge Cases·Change Log에 산다. 그래서 "배포창"으로 찾으면 FR 라인 매치가 0건이다 — 실제로 그 개념의 주인이 있는데도. 키워드 모드는 스펙 단위 매치도 내고, **감사 트레일(Change Log·Review Log·Dedup-Review) 매치는 "과거 기록"으로 분리**한다(그 개념의 현재 주인이 아니다 — 실측: "유령 entity"로 조회하니 현재 주인 SPEC-026 옆에 과거 한 번 언급한 SPEC-001·002·030이 같은 무게로 섞였다). 감사 절 목록의 정본은 `grammar-lib`이며 SPEC-016의 마커 스캔도 같은 규율을 쓴다.
- **훅은 싼 근거만 쓴다(FR-005).** 편집마다 도는 자리이므로 대상 파일 1개 + 소유 스펙 1개 읽기로 끝나는 지목·앵커 대조까지만 한다. 테스트 전수 스캔이 필요한 `@covers` 근거는 조회기의 몫이다 — 편집마다 레포를 순회하면 훅이 느려지고, **느린 훅은 우회된다.**
- **조회기는 판정기가 아니다(FR-006).** verdict는 SKIPPED(조회 모드)로 선언한다 — 게이트 스윕의 판정 집계에 섞이면 "조회했다"가 "판정했다"로 오독된다. exit code로 옳고 그름을 말하지 않는다(후보를 찾았든 못 찾았든 0).
- **키 방식 O(1) 조회는 생성물 인덱스로 닫았다(FR-007·008).** 초안은 매 조회에 전 스펙을 읽어 비용이 스펙 수에 선형이었다 — 오너 요구는 "스펙이 많아져도 오래 걸리면 안 된다"였다. 지금은 조회가 `sdd/FR_INDEX.json` 하나를 읽는다. 실측(킷 자신, 스펙 63개·FR 372개·키 269개·covers 366건 · 인덱스 340KB): 생성 89~198ms · 신선도 판정 57~65ms · 조회 68~76ms(스펙 읽기 0회). 초안이 이 자리에 남겼던 부채가 이것이고, 예고대로 근거 산출 코어는 폐기 없이 인덱스 **생성 단계**로 이동했다.
- **낡음은 stat만으로 판정한다.** 지문은 경로·크기·mtime의 해시다 — 내용을 다시 읽으면 인덱스의 이득이 그 자리에서 사라진다. 체크아웃처럼 내용이 같은데 mtime만 바뀐 경우는 "낡음"으로 뜨지만, 그 방향의 오탐은 "재생성하라"는 안내라 안전하다. 위험한 것은 반대 방향(낡은 인덱스를 최신이라 말하는 것)뿐이고 stat 지문은 그 방향으로 틀리지 않는다.
- **인덱스는 캐시이고 정본은 스펙이다.** 낡거나 없으면 조용히 쓰지 않는다 — 그 사실과 재생성 명령을 출력하고 스펙 직접 읽기로 폴백한다(정확성 > 속도, 단 느리다고 알린다). 그래서 인덱스가 없는 소비 프로젝트에서도 이 축은 동작한다(느릴 뿐).
- **생성기는 모듈이기도 하므로 엔트리 가드가 필수다(FR-009).** 실측 회귀: 첫 판은 가드가 없어 조회기가 `INDEX_REL_PATH`를 import하는 것만으로 실행부가 돌아 **조회할 때마다 인덱스를 재생성**했다(조회 185ms·"생성" 로그 혼입·판정 줄 2회). 읽으려는 캐시를 읽기 전에 다시 만들면 대체한 비용보다 비싸진다 — 인덱스를 두는 이유 자체가 무너진다.
- **Python 판은 인덱스를 소비하지 않는다(의도된 비대칭).** mtime 기반 지문을 두 런타임에서 부동소수점까지 동일하게 재현할 보장이 없고, 두 판이 서로 다른 신선도 판정을 내리는 위험은 낡은 인덱스를 쓰는 것보다 나쁘다(같은 편집에서 한 판은 최신, 다른 판은 낡음이라 말한다). Python은 스펙을 직접 읽으므로 **출력은 여전히 바이트 동일**하다(FR-005 패리티 불변) — 차이는 속도뿐이다.
- **인덱스에 스펙 본문은 담지 않는다.** 담으면 인덱스가 스펙 전문만큼 커져 "파일 하나만 읽는다"는 이득이 사라진다. 그래서 본문이 필요한 키워드 모드(FR-004)만 스펙을 읽고, 그 비용을 출력에 밝힌다(다른 모드는 "스펙 파일을 읽지 않았다"를 명시).
- **인덱스는 면제 산출물이다.** `specSyncExemptGlobs`에 등재한다 — 생성물이라 소유 스펙 Files의 폐쇄세계 판정에 걸리면 커밋이 막힌다(`sdd/OWNERSHIP_MAP.md`·`sdd/derivation.json`과 같은 처분). 드리프트는 대신 `sdd-sync` R3가 `--check --if-present`로 알린다(미생성은 실패가 아니다 — 선택 산출물).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN given a change target — a repository-relative path, its current text, or a domain keyword — the **fr-locator** (E) core in **fr-locator-lib.mjs** (S) SHALL return FR candidates whose evidence is one or more of four deterministic matches: a `@covers` tag from a test that references the target, a function named in the FR line's backticks that appears in the target's text, a module named in those backticks that equals the target's basename, or a bold key anchor that corresponds to the target path — and SHALL NOT infer candidates by similarity. — capability: **fr-locator.locate** (C).
- **FR-002** (unwanted): IF an FR has zero evidence, THEN THE SYSTEM SHALL exclude it from the returned candidates, so a consumer can report "not narrowed — read the spec" rather than presenting an unfiltered list as a result.
- **FR-003** (event): WHEN a `@covers` tag comes from a test that tags many FRs of the same spec, THE SYSTEM SHALL attenuate that evidence's weight by the tag's breadth and SHALL carry the breadth in the reported reason, because a broad tag asserts "this file verifies this spec" rather than "this FR".
- **FR-004** (event): WHEN a domain keyword is given, THE SYSTEM SHALL additionally report which specs contain it and in which sections, separating matches that fall only inside audit-trail sections as past record rather than current ownership — because the FR canon is English while working prose is not, so a keyword may have no FR-line match even when its owning spec exists.
- **FR-005** (event): WHEN the pre-edit hook `check-pre-edit.mjs` (SPEC-003) reports an unmodified owning spec, THE SYSTEM SHALL print the top FR candidates with their evidence and the count against that spec's total FRs, using only the cheap evidence (target text and owning spec, no repository scan), and SHALL point to the full lookup for the rest; the Node and Python runtimes SHALL produce byte-identical output.
- **FR-006** (state): WHILE **sdd-where.mjs** (S) runs, THE SYSTEM SHALL declare a skipped (lookup-mode) verdict rather than a judgment and SHALL exit zero regardless of whether candidates were found, so the gate sweep cannot read a lookup as a judgment.
- **FR-007** (event): WHEN **gen-fr-index.mjs** (S) runs, THE SYSTEM SHALL precompute a lookup index at `sdd/FR_INDEX.json` — every spec's FR declaration lines with the bold keys they anchor and the implementations their backticks name, an owned-key index, the file-owner globs, and both directions of the test tagging — stamped with a fingerprint of the spec set taken from paths, sizes and modification times only, never from spec content; under the check flag it SHALL write nothing and instead report staleness by comparing that fingerprint, reporting an absent index as skipped rather than failed when invoked with the if-present flag. — capability: **fr-locator.generate** (C).
- **FR-008** (state): WHILE the stored fingerprint equals the current spec set's, the lookup and the pre-edit hook SHALL answer from the index alone and SHALL read no spec file, so lookup cost does not grow with the number of specs; otherwise they SHALL report the index as stale or missing, name the regeneration command, and fall back to reading the specs.
- **FR-009** (unwanted): IF the generator is imported as a module rather than run as an entry point, THEN THE SYSTEM SHALL perform no file IO, because a lookup that regenerates the index it is about to read costs more than the read it replaced.

### Key Entities
- **fr-locator** — the mapping from a change target (file, symbol, or domain word) to the requirements that govern it, assembled from evidence other axes already compute, so that finding "which FR" costs a lookup instead of a full read of the spec.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: fr-locator
- **Symbols**: fr-locator-lib.mjs, sdd-where.mjs, gen-fr-index.mjs
- **Artifacts**: sdd/FR_INDEX.json
- **Capabilities**: fr-locator.locate, fr-locator.generate
- **Files**: tooling/fr-locator-lib.mjs, tooling/sdd-where.mjs, tooling/gen-fr-index.mjs, tooling/__tests__/fr-locator.test.mjs, tooling/__tests__/fr-index.test.mjs, sdd/FR_INDEX.json

## Dependencies (참조 — dedup 제외)
> 근거 재료의 정본은 각 소유 스펙이다 — `@covers` 회계(SPEC-007) · FR이 지목한 구현체(SPEC-046) · 굵은 키 앵커(SPEC-023) · 심볼↔경로 대응(SPEC-029) · 감사 절 목록·FR 선언 라인 범위(SPEC-013). 훅 본체는 SPEC-003, Python 복제는 SPEC-006.
- **Modules**: verification-accounting (references), impl-reference (references), fr-key-anchors (references), ownership-reality (references), spec-grammar-hardening (references), spec-sync (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `fr-locator.test.mjs` 전 케이스 green + pre-edit 훅 출력의 Node↔Python 바이트 동일(실측 픽스처로 확인). [검증: tooling/__tests__/fr-locator.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-002**: 실측 재현 픽스처(FR 4개 중 하나만 대상 파일의 함수를 백틱으로 지목)에서 후보가 1건으로 좁혀지고 근거 종류가 출력된다 — 통독 0회. [검증: tooling/__tests__/fr-locator.test.mjs]
- **SC-003**: 넓은 태깅(테스트 1개가 스펙 FR 전부 태깅) 픽스처에서 covers 근거가 감쇠되고 정렬 1위가 추가 근거(앵커·지목)를 가진 FR이며, 소비처가 "좁혀지지 않았다"를 출력한다. [검증: tooling/__tests__/fr-locator.test.mjs]
- **SC-004**: 인덱스가 최신일 때 조회가 스펙 파일을 0회 읽는다 — 스펙 본문을 크기·mtime 보존해 바꿔치기해도 결과 불변임으로 증명, 그리고 인덱스 삭제 시 폴백 안내가 출력된다. [검증: tooling/__tests__/fr-index.test.mjs]
- **SC-005**: `sdd-sync` R3가 `gen-fr-index --check --if-present`를 돌려 인덱스 드리프트를 스윕에서 알린다(최신=통과 · 낡음=비영 종료 · 미생성=SKIPPED). [검증: tooling/__tests__/fr-index.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 후보 산출 코어는 문자열·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO(스펙 읽기·테스트 스캔·경로 정규화)는 소비처가 수행한다. [검증: tooling/__tests__/fr-locator.test.mjs]
- **NFR-002**: 신선도 판정은 스펙 내용을 읽지 않고 stat(경로·크기·mtime)만으로 한다 — 판정 자체가 인덱스의 이득을 소모하지 않는다(실측 57~65ms). [검증: tooling/__tests__/fr-index.test.mjs]

## Assumptions / Clarifications Retained
- 조회 비용은 인덱스로 스펙 수와 무관해졌다(초안의 부채 해소) — 남은 선형 비용은 인덱스 **생성**이고, 그건 스펙이 바뀔 때만 낸다. 킷 실측 89~198ms(스펙이 바뀐 커밋에서만 낸다).
- 이 축은 게이트 스윕 전체를 빠르게 하지 않는다 — 같은 실측에서 `sdd-sync` 전 게이트 스윕 124초의 대부분(92초)은 유닛 스위트를 돌리는 `check-test-run`이고 스펙 파싱이 아니다. 인덱스가 줄이는 것은 **사람·에이전트가 FR을 찾는 비용**(통독 → 조회)이며, 그것이 오너가 제보한 비용이다.
- 조회기는 Node 전용이다 — `sdd-retire.mjs`와 같은 이유(대화형 편의 계층이고 게이트 스윕의 판정 대상이 아니다). 반면 pre-edit 훅은 판정 경로라 Python 미러가 필수다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-09-04 | 셀프리뷰(순수 코어 단위·훅 e2e·Node↔Python 바이트 패리티 실측·킷 자기 조회 도그푸딩 3케이스) + 오너 제보 기반 | FR-001~006 unit 커버, 조회 비용 부채는 Edge Case에 명시 |
| 2026-09-04 | 셀프리뷰(인덱스 증분 — 생성·드리프트 판정·인덱스 우선 조회·엔트리 가드 회귀를 픽스처로 실측) | FR-007~009 unit 커버, 초안 Edge Case의 미해소 부채 해소(스펙 읽기 0회 증명) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-09-04 이웃 SPEC-028(ownership-map): 비중복 — SPEC-028은 **소유 키별로 어느 가드가 판정했는가**(보증 맵), 이 spec은 **변경 대상별로 어느 FR이 지배하는가**(요구 조회). 둘 다 맵이지만 좌변과 우변이 모두 다르다.
- 2026-09-04 이웃 SPEC-028(ownership-map) 인덱스 증분 재검토: 비중복 — 둘 다 생성물이지만 SPEC-028의 `--check`는 본문을 재생성해 텍스트를 비교하고(사람이 읽는 산출물이라 내용 동일성이 관심사), 이 spec의 `--check`는 stat 지문만 비교한다(기계가 읽는 캐시이고 내용 재독이 곧 이득 소모다). 좌변도 다르다 — 키→가드 vs 변경 대상→FR.
- 2026-09-04 이웃 SPEC-046(impl-reference): 비중복 — SPEC-046은 FR이 지목한 구현체가 **실행 경로에서 참조되는가**를 판정(위반 탐지), 이 spec은 그 지목을 **조회의 근거로 소비**한다(판정 아님).
- 2026-09-04 이웃 SPEC-003(spec-sync): 비중복 — spec-first 강제·pre-edit 훅 본체는 SPEC-003 소유이고, 이 spec은 그 훅이 출력할 **FR 후보 산출**만 소유한다(훅은 소비처).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-09-04 | 인덱스 증분 — `gen-fr-index`(생성·stat 지문·`--check --if-present`) 신설, `sdd-where`·`check-pre-edit`를 인덱스 우선으로 전환, `sdd-sync` R3에 드리프트 판정 배선, `sdd/FR_INDEX.json`을 `specSyncExemptGlobs`에 등재 | 오너 요구: 키 방식 O(1) 조회 — "스펙이 많아져도 시간이 오래 걸리면 안 된다". 초안이 Edge Case에 남긴 미해소 부채(조회 비용이 스펙 수에 선형)를 닫았다[실측: 63 스펙·372 FR에서 생성 89~198ms·조회 68~76ms·스펙 읽기 0회, 종전 매 조회 1.1MB 전수]. 도그푸딩 실수확 1건: 엔트리 가드가 없어 조회기의 import만으로 인덱스가 매 조회 재생성됐다(185ms·판정 줄 2회) [검증: tooling/__tests__/fr-index.test.mjs] |
| 2026-09-04 | 초안 — `fr-locator-lib`(근거 4종 산출·태깅 폭 감쇠·감사 절 분리) + `sdd-where` 조회기(파일·키워드 모드, JSON 출력) + `check-pre-edit` 출력에 FR 후보 주입(Node·Python 바이트 동일). `grammar-lib`에 감사 절 목록 정본(`AUDIT_TRAIL_SECTIONS`) 신설하고 SPEC-016 마커 스캔이 그것을 쓰도록 교체(같은 목록이 Node·Python 각 1곳에 리터럴로 박혀 있었다 — R13) | 오너 제보: 변경 1건마다 FR 탐색이 통독이라 너무 오래 걸린다. 재료(테스트 태그·FR 지목·키 앵커)는 이미 계산되고 있었고 답하는 자리만 없었다. 도그푸딩에서 결함 2건 즉시 실수확 — ① `--keyword` 미지정 시 첫 인자가 조용히 버려지는 인자 파싱 결함, ② 넓은 태깅으로 후보가 전체와 같아지는데 성공처럼 보이던 출력 [검증: tooling/__tests__/fr-locator.test.mjs, tooling/__tests__/sdd-gates-py.test.mjs] |
