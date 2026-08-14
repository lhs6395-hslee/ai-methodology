# Feature Specification: FR Placement (FR 정의가 섹션 안에 있는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-056`  **Created**: 2026-08-11  **Status**: Active
**Input**: 실측 제보(2026-08-11, gsn-ai-pm-management-tool) — 에이전트가 **하루에 같은 실수를 세 번** 했다: FR 정의(`- **FR-NNN**`)를 `## Functional Requirements` 섹션이 아니라 다른 섹션(Dedup-Review, Ownership)에 적었다(SPEC-015 FR-027, TEST-003 FR-053, TEST-003 FR-058). 파일은 멀쩡히 파싱되고 스펙 문서로도 그럴싸해 보여서 사람이 그 자리에서 알아차릴 수 없었고, 어긋남은 **다른 게이트가 커버리지를 셀 때** dangling `@covers`로 뒤늦게 드러났다 — 원인 자리가 아니라 결과 자리에서, 그것도 늦게. 제보자가 실제로 만들어 검증한 참조 구현(`fr-placement-lib.mjs` + `check-fr-placement.mjs`)을 이 킷에 일반화해 편입한다.

---

## User Scenarios & Testing

### User Story 1 — 섹션 밖 FR 정의는 원인 자리에서 잡는다 (P1)
FR 정의 줄이 `## Functional Requirements` 섹션 밖에 있으면, 그 파일은 여전히 유효한 마크다운이고 다른 문법 게이트를 통과한다. 어긋남이 드러나는 자리는 그 FR을 `@covers`가 지목하려 할 때이고, 그때는 이미 원인에서 멀다.
- **Independent Test**: `fr-placement.test.mjs`가 순수 코어(`sectionSpans`·`frPlacementFindings`)와 게이트 배선을 단독 검증. [검증: tooling/__tests__/fr-placement.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a spec with a `## Functional Requirements` section and an FR-shaped line in a different section, **When** the gate runs at hard strength, **Then** it exits non-zero naming the FR id, the section it was found in, and the line number.

### User Story 2 — FR 섹션이 없는 스펙은 대상이 아니다 (P1)
순수 인프라 스펙 등은 FR 섹션 자체가 없을 수 있다. 이 축은 "섹션 안이냐 밖이냐"를 판정하므로 섹션이 아예 없으면 판정 대상이 성립하지 않는다.
- **Independent Test**: 같은 테스트가 FR 섹션 부재 스펙에서 findings가 0건임을 확인. [검증: tooling/__tests__/fr-placement.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a spec with no `## Functional Requirements` heading, **When** the core scans it, **Then** it reports zero findings regardless of FR-shaped lines present.

### User Story 3 — 이력·인용은 정의가 아니다 (P1)
Change Log 표의 `| 2026-08-11 | **FR-058** 신설 — … |`나 본문 산문의 FR 참조는 그 FR을 **다시 정의**하는 것이 아니라 가리키는 것이다. 이런 줄까지 위반으로 잡으면 오탐이 되고, 오탐이 잦은 게이트는 꺼진다.
- **Independent Test**: 같은 테스트가 Change Log 행·산문 참조·인용 블록을 findings에서 제외함을 확인(`isFrDeclLine` 재사용 — key-anchor-lib.mjs의 기존 줄 분류기와 동일 기준). [검증: tooling/__tests__/fr-placement.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a Change Log table row or prose sentence mentioning an FR id, **When** the core scans the file, **Then** that line is not reported as a placement violation.

### User Story 4 — `--fix`는 훅이 아니라 사람이 명시적으로 돌린다 (P1)
자동 교정을 훅 안에서 하면 사람이 커밋한 내용과 저장소 내용이 조용히 갈린다. 훅은 잡아서 `--fix`를 알려주는 데까지만 하고, 실제 이동은 사람이 명시적으로 실행한다.
- **Independent Test**: 같은 테스트가 훅 실행 경로(인자 없음)에서 파일이 절대 바뀌지 않음과, `--fix` 인자가 있을 때만 파일이 바뀜을 별도로 확인. [검증: tooling/__tests__/fr-placement.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a spec with a misplaced FR, **When** the gate runs without `--fix`, **Then** the file on disk is unchanged and the gate only reports what running `--fix` would do.

### User Story 5 — 흡수 범위는 인접한 근거 줄까지만이다 (P1)
FR 블록을 옮길 때 그 FR에 딸린 `>` 인용(근거) 줄까지 함께 옮겨야 온전하지만, 흡수 범위를 넓게 잡으면 **다른 문단의 인용**까지 쓸어간다(참조 구현의 실제 회귀).
- **Independent Test**: 인접한 빈 줄 뒤에 있는 남의 `>` 인용은 그대로 두고, FR 줄에 바로 이어지는 `>` 줄만 함께 옮기는 회귀 테스트. [검증: tooling/__tests__/fr-placement.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a misplaced FR line immediately followed by its own blockquote lines, then a blank line, then an unrelated blockquote from a different paragraph, **When** `--fix` runs, **Then** only the FR line and its immediately adjacent blockquote lines move, and the unrelated blockquote stays behind.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **정의 판정은 `isFrDeclLine` 재사용이다** — 새 정규식을 이 축에서 새로 만들면 FR 커버리지 게이트(`key-anchor-lib.mjs`)가 "정의"로 보는 것과 이 축이 "정의"로 보는 것이 갈릴 수 있다. 같은 판정기를 재사용해 `frDeclarations`(섹션 안)와 `frPlacementFindings`(섹션 밖)가 FR-형태 줄 전체를 겹침·빈틈 없이 분할하게 한다.
- **여러 개의 H2 섹션을 일반 열거한다(`sectionSpans`)** — 기존 `sectionBlock`(lifecycle-lib.mjs)은 이름이 주어진 단일 섹션만 뽑는다. 이 축은 위반이 **어느** 섹션에 있는지 이름을 보고해야 하므로 전체 H2 구간을 필요로 한다.
- **`--fix`는 판정이 아니다** — `--fix` 실행은 `SKIPPED` 판정 타입을 방출한다(판정 게이트의 정상 실행 경로가 아니라 교정 유틸리티 경로임을 명시).
- **`advisory`는 막지 않는다** — 강도 사다리를 지킨다. 채택 중 프로젝트를 벽으로 세우지 않는다.
- **차단 시 실패 클래스를 선언한다(`fr-outside-section`)** — SPEC-057의 에스컬레이션 집계가 "선언된 클래스만 센다"는 계약의 첫 소비자다. 이 게이트가 클래스를 선언하지 않으면 실제 사고(하루 세 번)가 SPEC-057이 도입된 뒤에도 원장에 보이지 않는다.
- **commit-msg 체인에서 spec-sync 뒤에 둔다** — 스펙이 애초에 동반됐는지가 그 안의 배치보다 우선이다. 순서를 바꾸면 스펙 없는 커밋에도 배치 오류를 먼저 말해 사람이 엉뚱한 곳을 고친다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **fr-placement** (E) core in **fr-placement-lib.mjs** (S) SHALL classify every FR-shaped declaration line in a spec as inside or outside the `## Functional Requirements` heading's span, reusing the existing declaration-line classifier so the in-section and out-of-section partitions never overlap or leave a gap. — capability: **fr-placement.classify** (C).
- **FR-002** (unwanted): IF a spec has no `## Functional Requirements` heading at all, THEN the core SHALL report zero findings for that spec, because a spec that never declares the section is not a target of this check.
- **FR-003** (unwanted): IF an FR-shaped line appears inside a Change Log table row or ordinary prose rather than as a line-start declaration, THEN the core SHALL NOT report it, because history and reference are not definitions.
- **FR-004** (event): WHEN **check-fr-placement.mjs** (S) finds an FR declared outside the section, it SHALL report the FR id, the containing section's name, and the line number, and it SHALL exit non-zero only when `frPlacementPolicy` is `hard`.
- **FR-005** (unwanted): WHILE the gate runs without `--fix`, it SHALL NOT modify any file on disk under any policy strength, because silent auto-correction would desynchronize what a person committed from what is on disk.
- **FR-006** (event): WHEN a person runs `check-fr-placement.mjs --fix`, the tool SHALL move each misplaced FR declaration line together with only its immediately adjacent blockquote lines to the end of the Functional Requirements section, and it SHALL NOT absorb a blockquote separated from the declaration by a blank line.
- **FR-007** (event): WHEN the gate blocks under `hard` strength, it SHALL declare the failure class `fr-outside-section` and the offending spec file as the verdict's escalation metadata, so a gate-failure ledger consumer (SPEC-057) can count repeats without inferring the class from free text.
- **FR-008** (ubiquitous): THE gate's report and exit code SHALL be identical between the canonical runtime and the Python runtime, as required for judging gates.

### Key Entities
- **FR placement** — whether a line-start FR declaration (`- **FR-NNN**` or `**FR-NNN**`) lives inside the spec's `## Functional Requirements` section span, as distinct from whether the FR exists at all (SPEC-002 fr-coverage) or is anchored in plain text (SPEC-023 frKeyAnchor) — a well-formed, anchored, counted FR can still be misplaced, and misplacement is invisible until a downstream coverage gate sees a dangling `@covers`.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: fr-placement
- **Symbols**: fr-placement-lib.mjs, check-fr-placement.mjs
- **Artifacts**: —
- **Capabilities**: fr-placement.classify
- **Files**: tooling/fr-placement-lib.mjs, tooling/check-fr-placement.mjs, tooling/__tests__/fr-placement.test.mjs

## Dependencies (참조 — dedup 제외)
> FR 정의 줄 분류기(`isFrDeclLine`)는 SPEC-023 소유, 판정 타입은 SPEC-040 소유, 에스컬레이션 집계 소비는 SPEC-057 소유, Python 복제는 SPEC-006 소유.
- **Modules**: fr-key-anchors (references), gate-verdict (references), gate-failure (references)
- **Symbols**: key-anchor-lib.mjs, verdict-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `fr-placement.test.mjs` 전 케이스 green — `sectionSpans` 다중 헤딩·헤딩 없음 1, `frPlacementFindings` 섹션 밖·Change Log 제외·산문 제외·FR 섹션 없음(exempt) 1, `fixFrPlacement` 이동·인접 인용 흡수·비인접 인용 보존(회귀)·다중 FR 순서 1, 게이트 카나리아(hard 차단·출력 내용·advisory 비차단·--fix 파일 변경·훅 무교정·exempt·off/enum) 1. [검증: tooling/__tests__/fr-placement.test.mjs]
- **SC-002**: 판정 출력과 `--fix` 파일 바이트가 Node↔Python 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 게이트가 hard에서 섹션 밖 FR을 **실제로 차단**한다 — 통과 경로만 관측된 게이트는 미검증이다(SPEC-048 카나리아 계약). [검증: tooling/__tests__/fr-placement.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어(`fr-placement-lib.mjs`)는 텍스트 입력만의 순수 함수이고 파일 IO·config 읽기는 소비 게이트가 하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/fr-placement.test.mjs]

## Assumptions / Clarifications Retained
- 참조 구현(제보자가 소비 프로젝트 브랜치 `sdd-coding`에서 이미 만들어 검증한 `fr-placement-lib.mjs`/`check-fr-placement.mjs`)을 그대로 복사하지 않고 이 킷의 기존 어휘(`isFrDeclLine`·`VERDICT_KINDS`·`loadConfig`)에 맞춰 재작성했다 — 킷은 참조 구현이 겪은 인접 인용 과다 흡수 버그를 회귀 테스트로 먼저 박아 넣은 뒤 구현했다.
- **기각한 대안:** 훅이 발견 즉시 `--fix`를 자동 적용하는 방식. 사람이 커밋한 내용과 저장소 내용이 갈리는 조용한 절단을 만든다 — 이 킷의 기존 원칙(`조용한 절단·조용한 통과 금지`)과 정면으로 충돌한다. 재검토 조건: 없음.
- **기각한 대안:** FR 블록 이동 시 다음 섹션 시작 전까지 뒤따르는 모든 줄을 함께 옮기는 방식(더 단순한 구현). 참조 구현이 실제로 이 형태로 겪은 버그이고, 인용 아닌 다른 문단의 `>` 인용까지 쓸어간다. 재검토 조건: 없음.
- **기각한 대안:** Change Log·산문 참조도 정규식으로 더 세밀히 구분해 별도 판정하는 방식. `isFrDeclLine`이 이미 "정의 줄"과 "참조"를 구분하는 단일 기준이고, 이 축이 별도 기준을 만들면 fr-coverage 게이트가 세는 정의와 이 축이 보는 정의가 갈릴 수 있다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-11 | 셀프리뷰(코어 TDD 다수 + 게이트 카나리아 다수 + 양판 패리티) + 제보 요청(참조 구현 일반화 편입) → Active | FR-001~008 unit 커버. 킷 자기적용: 킷 자신의 스펙에서 섹션 밖 FR 0건 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-11 이웃 SPEC-002(spec-quality-gates, fr-coverage): 비중복 — 002는 FR이 **존재하고 커버되는가**(회계), 056은 그 FR이 **어디에 적혔는가**(배치)다. 섹션 안에 있든 밖에 있든 002의 회계는 성립할 수 있고, 정확히 그 갈라짐이 dangling `@covers`로 늦게 드러난 이유다.
- 2026-08-11 이웃 SPEC-023(fr-key-anchor): 비중복 — 023은 평문 bold 표기가 소유∪참조 키와 대조되는가(어휘 앵커), 056은 그 표기가 **속한 섹션**이 맞는가(구조 배치)다. 023의 판정기(`isFrDeclLine`)를 056이 재사용해 "정의 줄"의 정의를 이원화하지 않는다.
- 2026-08-11 이웃 SPEC-013(spec-grammar-hardening): 비중복 — 013은 스펙 문서 전반의 문법 규범(Module 헤더·SHALL 문형·글롭 문법), 056은 FR 정의 줄 하나의 **섹션 소속**만 본다. 013을 통과한 문서도 056 기준으로는 위반일 수 있다.
- 2026-08-11 이웃 SPEC-057(gate-failure): 비중복이자 첫 소비 관계 — 057은 임의 게이트의 반복 차단을 원장에 적고 집계하는 일반 메커니즘이고, 056은 그 메커니즘의 **첫 실측 소비자**다(`fr-outside-section` 클래스 선언). 057이 없어도 056은 독립적으로 작동하고, 056이 없어도 057은 다른 게이트의 클래스를 집계할 수 있다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-11 | 초안 — `fr-placement-lib`(`sectionSpans` 일반 H2 열거·`frPlacementFindings`·`fixFrPlacement` 인접 인용만 흡수) + `check-fr-placement`(hard/advisory/off·`--fix`·훅 무교정·`fr-outside-section` 클래스 선언) + `frPlacementPolicy` knob + 스윕 R23 등재 + commit-msg 체인(spec-sync 뒤) + 배포 목록·양판 대응 편입, 양판 | 실측 제보: 에이전트가 하루에 같은 실수를 세 번 했다(FR을 섹션 밖에 썼다). 게이트는 세 번 다 잡았고 매번 사유를 정확히 말했지만, 그 판정이 발생하는 **원인 자리**(섹션 배치)에서가 아니라 **결과 자리**(dangling `@covers`)에서 늦게 드러났다. 소비 프로젝트가 이미 만들어 검증한 참조 구현을 일반화해 킷에 편입했고, 그 구현이 실제로 겪은 "인접 인용 과다 흡수" 버그를 회귀 테스트로 먼저 박아 넣은 뒤 흡수 범위를 FR 줄 직후 연속된 `>` 줄로만 제한했다. 훅이 자동 교정하지 않는 이유: 조용한 교정은 커밋 내용과 저장소 내용을 갈라놓는다 — 이 킷이 이미 금지한 형태다. commit-msg에서 spec-sync 뒤에 두는 이유: 스펙 동반 여부가 배치보다 우선이다 [검증: tooling/__tests__/fr-placement.test.mjs] |
