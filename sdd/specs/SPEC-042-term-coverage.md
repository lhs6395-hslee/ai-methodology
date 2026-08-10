# Feature Specification: Term Coverage (인용은 시험이 아니다 — 동어반복하는 커버 태그)

**Module**: `sdd-tooling`  **Spec**: `SPEC-042`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10) — 스펙과 코드가 어긋난 채로 **모든 게이트가 green을 유지한** 사례. 요구는 "Claude in Chrome(MCP)로 측정한다"였는데 구현은 실제 Chrome 바이너리를 그냥 띄우는 것이었고(MCP 경로는 애초에 없었다), 그 요구를 커버한다는 테스트는 **선택자가 문자열 `chrome`을 돌려주는지**와 **러너가 선택자 이름을 언급하는지**만 확인했다. 요구의 주장과 테스트의 주장이 완전히 분리돼 있는데 커버리지 회계는 둘을 구분하지 못했다 — 태그가 있으면 커버된 것이다. 제보의 진단 그대로: 현재 게이트는 **연결의 존재**만 검증하고 **연결의 진위**는 검증하지 않는다.

---

## User Scenarios & Testing

### User Story 1 — 요구가 이름 댄 대상을 커버가 건드리지 않으면 그 커버는 의심스럽다 (P1)
요구 본문이 특정 프로토콜·외부 시스템·제품을 지목했는데, 그 요구를 커버하는 어떤 파일에도 그 이름이 없다면 그 커버는 최소한 요구가 말한 대상을 만지지 않았다. 그 사실 하나만 표면화한다.
- **Independent Test**: `term-coverage.test.mjs`가 순수 코어(주장 용어 추출·미실증 판정·동의어·단어 경계·미커버 무판정·용어집 공백)를 단독 검증. [검증: tooling/__tests__/term-coverage.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a requirement whose text names a declared term, **When** none of its covering files contain that term, **Then** the gate surfaces it as unsubstantiated.

### User Story 2 — 용어집은 프로젝트가 선언한다 (P1)
무엇이 "요구가 이름 댄 대상"인지는 도메인마다 다르다. 킷이 산문에서 고유명사를 자동 추출하면 문장 첫 단어와 Title-Case가 전부 걸려 오탐이 폭주하고, 오탐이 잦은 게이트는 꺼진다. 선언은 책임지는 행위이고, 선언하지 않은 프로젝트에는 이 축이 **판정하지 않았음**을 매 실행 알린다.
- **Independent Test**: 같은 테스트가 용어집이 비면 어떤 유닛도 판정되지 않음을 검증하고, 게이트는 미선언 상태를 명시 출력한다. [검증: tooling/__tests__/term-coverage.test.mjs]
- **Acceptance (GWT)**: 1. **Given** no glossary is declared, **When** the gate runs, **Then** it states that this axis judged nothing instead of reporting zero violations.

### User Story 3 — 파라프레이즈는 동의어로 닫는다 (P2)
구현이 정당하게 다른 이름을 쓰는 경우(`Playwright`를 `chromium-driver`로 감싼 어댑터)가 있다. 해소는 면제 목록이 아니라 **동의어 등록**이다 — 등록은 "이 이름과 저 이름이 같은 것을 가리킨다"는 지식의 기록이고, 면제는 그 지식을 버리는 행위다.
- **Independent Test**: 같은 테스트가 동의어 등록 전후로 판정이 갈리는 것을 검증. [검증: tooling/__tests__/term-coverage.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an implementation that uses a registered synonym, **When** the gate runs, **Then** the term is treated as substantiated.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **커버 파일이 0건이면 판정하지 않는다** — "커버 안 됨"은 R1·R2의 사실이다. 두 사실을 한 문장에 섞으면 사람이 어느 쪽을 고쳐야 할지 모른다.
- **이 신호는 재현율이 없다** — 파라프레이즈된 정당한 구현은 못 잡고, 우연히 같은 단어가 주석에 있어도 통과로 읽는다. 그래서 이 축은 "테스트가 부적절하다"를 판정하지 않고 "이름이 없다"만 말한다.
- **ASCII 용어는 단어 경계로만 맞는다** — `connectMCP`는 `MCP`를 이름 댄 것이 아니다. 부분일치는 실측에서 대량 오탐을 냈다(`page`→`TicketPackage`).
- **한 파일이라도 그 이름을 담으면 실증으로 본다** — 여러 커버 파일 전부에 이름을 요구하면 헬퍼 분리가 위반이 된다.
- 기본 `advisory`. `hard`는 용어집이 정착하고 미실증이 0으로 수렴한 뒤가 종착지다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a declared glossary term appears in a requirement's declaration line, the **term-coverage** (E) core in **term-coverage-lib.mjs** (S) SHALL check every file that covers that requirement for the same term or one of its registered synonyms, matching ASCII terms on word boundaries and non-ASCII terms as substrings. — capability: **term-coverage.substantiate** (C).
- **FR-002** (unwanted): IF a requirement claims a glossary term and none of its covering files contain that term or a synonym, THEN **check-fr-coverage.mjs** (S) SHALL report it as unsubstantiated, warning under advisory and exiting non-zero under hard.
- **FR-003** (state): WHILE a requirement has no covering file, THE SYSTEM SHALL make no judgement about it on this axis; WHERE no glossary is declared, THE SYSTEM SHALL state that this axis judged nothing rather than reporting zero violations.

### Key Entities
- **term-coverage** — the fact that a covering file at least mentions the thing its requirement named, as distinct from the covering tag existing, so that a tautological test cannot pass for a substantive one.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: term-coverage
- **Symbols**: term-coverage-lib.mjs
- **Artifacts**: —
- **Capabilities**: term-coverage.substantiate
- **Files**: tooling/term-coverage-lib.mjs, tooling/__tests__/term-coverage.test.mjs

## Dependencies (참조 — dedup 제외)
> 마커 매칭 코어는 SPEC-031, 태그 수집·양방향 결속은 SPEC-039, 판정 종류는 SPEC-040, Python 복제는 SPEC-006 소유.
- **Modules**: execution-evidence (references), covers-backlink (references), gate-verdict (references)
- **Symbols**: check-fr-coverage.mjs

---

## Success Criteria (측정형)
- **SC-001**: `term-coverage.test.mjs` 전 케이스 green — 주장 용어 추출·실측 재현(동어반복 표면화)·한 파일 실증·동의어 해소·경계 미달 미실증·미커버 무판정·용어집 공백 무판정·단어 경계. [검증: tooling/__tests__/term-coverage.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다 — 용어집 미선언·미실증 표면화 두 갈래에서 확인. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 용어집 미선언 상태가 "위반 0건"이 아니라 "판정하지 않음"으로 출력된다. [검증: tooling/__tests__/term-coverage.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 대조만의 순수 함수이고 파일 읽기·커버 파일 수집은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/term-coverage.test.mjs]

## Assumptions / Clarifications Retained
- 테스트가 요구의 **의미**를 실제로 시험하는지는 판정하지 않는다 — 그건 사람/LLM 리뷰의 몫이고, SPEC-031·SPEC-039가 세운 경계(존재는 기계, 질은 리뷰) 그대로다. 이 축은 그 경계 안에서 값싸고 결정적인 한 조각만 가져간다.
- **기각한 대안:** 요구 산문에서 고유명사를 자동 추출하는 방식. Title-Case 단어와 문장 첫 단어를 전부 잡아 오탐이 폭주한다 — SPEC-033이 이미 거부한 길이다. 재검토 조건: 없음. 대상 지목은 선언으로 한다.
- **기각한 대안:** 커버 테스트의 단언문을 파싱해 "요구를 실제로 검증하는가"를 판정하는 방식. 언어·프레임워크마다 단언 문법이 다르고 의미 판정은 정적으로 불가능하다. 재검토 조건: 없음.
- **기각한 대안:** 면제 목록(`termCoverageExemptions`). 파라프레이즈의 정당한 해소는 동의어 등록이다 — 동의어는 지식을 남기고 면제는 지식을 버린다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 8종·킷 자기적용 실측) + 소비 프로젝트 개선 요청(스펙↔코드 괴리가 green 유지) → Active | FR-001~003 unit 커버. 킷 자기적용: 용어집 미선언 상태를 "판정하지 않음"으로 명시 출력 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-039(covers-backlink): 비중복 — 039는 태그와 요구가 **서로를 인정하는가**(번호 충돌 탐지), 042는 커버 파일이 요구가 **이름 댄 대상을 건드리는가**다. 039는 두 문서의 상호 참조, 042는 문서의 주장과 코드 본문의 대조다.
- 2026-08-10 이웃 SPEC-031(execution-evidence): 비중복 — 031은 증거가 **실행 가능한 자산을 지목하는가**(경로 등급), 042는 그 자산의 **본문에 대상 이름이 있는가**다. 031의 `markerHits`를 042가 재사용하는 것이 접점이다.
- 2026-08-10 이웃 SPEC-033(duplicate-logic): 비중복 — 033은 구현끼리의 중복, 042는 문서 주장과 구현의 괴리다. 033이 "자동 추출은 오탐 폭풍"이라는 판단을 남겼고 042가 그 판단을 승계해 용어집을 선언으로 둔다.
- 2026-08-10 이웃 SPEC-007(verification-accounting): 비중복 — 007은 요구가 어느 검증 클래스로 회계되는가, 042는 그 회계가 가리키는 파일이 대상을 만지는가다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 판정 코어를 SPEC-046(지목 구현체 참조)의 커버 파일 축이 **재사용**하도록 경계 명시(코드 변경 없음 — 소비처 추가) | 같은 대조("이름이 커버 파일에 있는가")를 두 번 구현하면 두 축이 언젠가 다른 답을 내고, 그때 사람은 어느 쪽을 믿어야 할지 모른다. 046은 이름의 **출처**만 다르다(선언 용어집 vs 저자가 백틱으로 명시한 구현체명) [검증: tooling/__tests__/impl-reference.test.mjs] |
| 2026-08-10 | 초안 — `termGlossary`(문자열 또는 `{term, synonyms}`) + `termCoveragePolicy`(off\|advisory\|hard, 기본 advisory) + `termCoverageListCap` + `term-coverage-lib`(주장 용어 추출·미실증 판정) + `check-fr-coverage` R1c 배선 | 소비 프로젝트 실측 제보: 요구가 "Claude in Chrome(MCP)"를 주장했는데 커버 테스트는 선택자가 문자열 `chrome`을 돌려주는지만 확인했고 세 게이트가 전부 초록이었다 — 연결의 **존재**만 보고 **진위**는 안 봤기 때문이다. 완전한 해법(의미 검증)은 리뷰의 몫이므로 그 경계 안에서 결정적인 한 조각만 가져간다: 요구가 이름 댄 대상이 커버 파일에 문자 그대로 없다. 용어집을 자동 추출로 두면 오탐이 폭주해 정책이 꺼지므로 프로젝트 선언으로 한다 [검증: tooling/__tests__/term-coverage.test.mjs] |
