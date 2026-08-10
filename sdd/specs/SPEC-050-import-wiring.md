# Feature Specification: Import Wiring Integrity (설치된 게이트가 애초에 로드되는가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-050`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10) — `prompts/update.md` 2~3단계의 diff를 "내용 다른 파일"만 보는 방식으로 수행했더니 **공유 lib 27개가 목록에서 누락**됐고, 그중 `ownership-keys.mjs`를 빠뜨린 결과 `check-spec-consistency.mjs`가 판정 대신 `SyntaxError: The requested module './ownership-keys.mjs' does not provide an export named 'bodyBeforeOwnership'`을 냈다. **부분 동기화**다 — 게이트 코드는 최신이고 lib은 구판이다. 파일이 없는 것도 아니어서 배포 폐포 계약(SPEC-004 SC-002)으로도 잡히지 않는다: 그 계약은 *파일이 배포되는가*를 보고 이 결함은 *배포된 파일이 요구된 export를 갖는가*다. 제보의 요청 두 가지: (a) 2단계 diff 절차에 "게이트가 import하는 모든 로컬 모듈까지 재귀적으로 diff 대상"을 명시하거나 (b) 스윕이 시작 시 import 그래프 무결성을 점검해 `UNTYPED` 대신 명확한 "배선 불일치" 판정을 내라. 부수로 드러난 것: 크래시 요약이 stderr **마지막 줄**이어서 스윕이 사유로 `Node.js v22.22.2`(런타임 배너)를 보고했고, 제보자가 스택을 직접 읽어 원인을 찾아야 했다.

---

## User Scenarios & Testing

### User Story 1 — 파일은 있는데 요구된 export가 없는 상태를 잡는다 (P1)
부분 동기화는 파일 실재 검사를 통과한다. 게이트가 최신이고 lib이 구판이면 로드 시점에 `SyntaxError`가 나고, 그 신호는 **고장 지점이 아닌 다른 곳**에서 뜬다.
- **Independent Test**: `import-wiring.test.mjs`가 순수 코어(import 절 파싱·export 집합 파싱·전이 판정)와 게이트 차단을 단독 검증. [검증: tooling/__tests__/import-wiring.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a module that imports a name its target does not export, **When** the gate runs, **Then** it names both the missing export and the file to re-copy.

### User Story 2 — 확인 못 함을 통과로 접지 않는다 (P1)
파서가 export 집합을 확정할 수 없는 형태(비-로컬 `export * from`·구조분해 export)가 있다. 그때 "없다"고 단정하면 **오탐**이고, 오탐이 잦은 게이트는 꺼진다. clean으로 접으면 이 축의 존재 이유가 사라진다.
- **Independent Test**: 같은 테스트가 비-로컬 재수출·구조분해 export를 위반 0건 + 확인 못 함 1건으로 분류함을 검증. [검증: tooling/__tests__/import-wiring.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a target whose export set cannot be determined, **When** the gate runs, **Then** it reports the target as unchecked and does not count it as either clean or violating.

### User Story 3 — 판정 시작점이 0건이면 판정하지 않는다 (P1)
Python 런타임 전용 설치에는 대조할 import 그래프가 없다. 그 0건을 "깨끗함"으로 읽으면 거짓 초록이다.
- **Independent Test**: 같은 테스트가 모듈 0건에서 판정 종류가 INERT이고 출력이 그 사실을 말함을 검증. [검증: tooling/__tests__/import-wiring.test.mjs]
- **Acceptance (GWT)**: 1. **Given** no modules of the judged extensions in the gate directory, **When** the gate runs, **Then** it declares INERT rather than reporting zero violations.

### User Story 4 — 크래시 요약은 원인 줄이다 (P1)
게이트 크래시는 원래도 미판정으로 계상돼 초록이 아니었다(SPEC-040). 문제는 **침묵이 아니라 오진**이었다 — 사유가 런타임 버전 배너면 사람이 원인까지 가는 길이 없다.
- **Independent Test**: `sdd-sync.test.mjs`가 실제 ESM export 크래시 stderr에서 요약이 배너가 아닌 던져진 오류 줄임을, 그리고 그 코어가 `gateOutcome`에 실제로 배선됐음을 검증. [검증: tooling/__tests__/sdd-sync.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a crash whose last stderr line is a runtime banner, **When** the sweep summarizes it, **Then** the summary is the thrown error line.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **주석 속 import·export 예시는 대조 대상이 아니다** — 인용이지 결정이 아니다(SPEC-044). 실측: 이 축을 처음 돌렸을 때 유일한 발견이 자기 코어의 주석에 있던 예시였다. 주석 제거는 킷의 기존 코어를 **재사용**한다(새로 구현하면 R13이 잡는 중복이고, 규칙이 두 곳에 생기면 한쪽만 고쳐진다).
- **주석 속 export는 유령 export가 되면 안 된다** — 그 방향은 **거짓 음성**(없는 export를 있다고 읽어 위반을 놓친다)이고 오탐보다 나쁘다.
- **export 파싱을 줄머리에 앵커하지 않는다** — 앵커하면 문장 중간 선언(`const x = 1; export { x };`)을 놓치고, 놓친 export는 "없다"로 읽혀 오탐이 된다. 문장 경계를 요구해 `myexport` 같은 식별자와 가른다.
- **패키지 import는 대상이 아니다** — 그건 설치 관리자의 일이고, 부분 동기화로 깨지는 것은 저장소 안에서 서로를 가리키는 모듈이다.
- **전이적으로 걷는다** — 게이트가 직접 import하지 않는 깊은 lib이 구판이어도 같은 결함이다.
- **순환 import에서 멈춘다** — 무한 루프는 게이트를 죽이고, 죽은 게이트는 판정하지 않는다.
- **같은 사실은 한 줄이다** — 여러 경로로 도달해도 중복 적재하지 않는다.
- **판정 시작점은 게이트 자신의 디렉터리다** — 설치 위치를 config로 묻지 않는다(게이트는 자기가 어디 있는지 안다). 킷은 `tooling/`, 소비 프로젝트는 `scripts/`가 같은 규칙으로 해석된다.
- **해소 경로가 하나뿐이므로 면제가 없다** — 정본에서 그 모듈을 다시 복사하는 것 말고 정당한 해소가 없고, 면제를 두면 깨진 배선이 "완료"로 남는다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a module's text is parsed, the **import-wiring** (E) core in **import-wiring-lib.mjs** (S) SHALL extract local relative imports with their originally-named bindings, namespace and default forms, and SHALL exclude package specifiers and text inside full-line comments so that documentation examples are never judged. — capability: **import-wiring.resolve** (C).
- **FR-002** (event): WHEN a target module's export set is parsed, the core SHALL recognize function, class, variable, braced, aliased, star-reexport and default forms at statement boundaries rather than line starts, SHALL union the exports of local star re-exports transitively, and SHALL report forms it cannot determine as unchecked rather than absent.
- **FR-003** (event): WHEN entry modules are walked, **check-import-wiring.mjs** (S) SHALL report a missing target file and a missing named export as distinct kinds, SHALL walk the graph transitively while terminating on cycles, and SHALL declare INERT when the gate directory holds no module of the judged extensions.
- **FR-004** (unwanted): IF a violation is found and the policy is strict, THEN the gate SHALL block naming the missing export and the module to re-copy from upstream; IF the policy is advisory, THEN it SHALL surface the same finding without blocking.
- **FR-005** (event): WHEN a gate crashes, **sdd-sync.mjs** (S) SHALL summarize the failure using the thrown-error line selected after structurally filtering stack frames, carets and runtime banners, so that the reported cause is never the runtime version string.

### Key Entities
- **import-wiring** — the fact that an installed gate set's modules resolve each other's declared exports, as distinct from those files merely being present, so that a half-synchronized install cannot masquerade as a working one.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: import-wiring
- **Symbols**: import-wiring-lib.mjs, check-import-wiring.mjs
- **Artifacts**: —
- **Capabilities**: import-wiring.resolve
- **Files**: tooling/import-wiring-lib.mjs, tooling/check-import-wiring.mjs, tooling/__tests__/import-wiring.test.mjs

## Dependencies (참조 — dedup 제외)
> 주석 제거 코어는 SPEC-044 소유, 스윕·크래시 요약은 SPEC-004 소유, 판정 종류 어휘는 SPEC-040, 배포 목록은 SPEC-004, Python 복제는 SPEC-006 소유.
- **Modules**: external-target (references), harness-install (references), gate-verdict (references)
- **Symbols**: sdd-sync.mjs, external-target-lib.mjs

---

## Success Criteria (측정형)
- **SC-001**: `import-wiring.test.mjs` 전 케이스 green — 절 파싱 5종·export 파싱 4종·전이 판정 6종·게이트 4종(hard 차단·advisory 비차단·off·inert). [검증: tooling/__tests__/import-wiring.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다(8 시나리오: export 없음·파일 없음·확인 못 함·통과·advisory·off·inert·값 위반). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 모듈 78종·전이 폐포 78종을 걸어 위반 0건·확인 못 함 0건이고, 도입 전 측정에서 명명 import 456건 대조 오탐 0건이었다 — 오탐이 이 축의 사망 원인이므로 도입 전에 쟀다. [검증: tooling/__tests__/import-wiring.test.mjs]
- **SC-004**: 실제 ESM export 크래시 stderr에서 스윕 요약이 런타임 배너가 아니라 던져진 오류 줄이고, 그 선택이 `gateOutcome`에 배선돼 있다. [검증: tooling/__tests__/sdd-sync.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 대조만의 순수 함수이고 파일 읽기·경로 해석·디렉터리 열거는 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/import-wiring.test.mjs]

## Assumptions / Clarifications Retained
- 제보가 제시한 두 선택지 (a) 문서 문구 (b) 기계 점검 중 **둘 다** 채택했다. 문구만으로 두면 킷이 프로즈로만 금지하는 상태가 되고(그 패턴은 이미 여러 번 실패했다), 게이트만 두면 절차를 따르는 사람이 왜 그래야 하는지 모른 채 따른다.
- 이 축이 `UNTYPED`를 대체하지 않는다. 크래시한 게이트는 여전히 미판정으로 계상된다(SPEC-040) — 이 축은 그 크래시가 **일어나기 전에** 원인을 이름으로 말하고, 부수로 크래시 요약의 오진을 고친다. 두 사실을 합치지 않은 이유: 로드 실패가 아닌 크래시(런타임 예외·설정 부재)도 요약이 필요하다.
- **기각한 대안:** 대상 모듈을 동적 `import()`해 실제 export 집합을 읽는 방식. 정확하지만 대상의 최상위 코드를 **실행**하므로, 게이트가 게이트를 import하는 경우 부작용이 돈다. 정적 파싱은 오탐 위험을 지지만 그 위험은 교정 집합으로 측정 가능하고(456건·오탐 0), 확정 못 하는 형태는 자백한다. 재검토 조건: 순수성이 기계로 보장되는 모듈 표기가 생기면 그 집합에서만 동적 import를 검토한다.
- **기각한 대안:** 판정 대상 디렉터리를 config로 선언받는 방식. 선언이 낡으면 이 축이 조용히 빈 집합을 보게 되고, 그건 이 축이 막으려는 결함과 같은 모양이다. 게이트 자신의 위치는 낡을 수 없다. 재검토 조건: 게이트가 여러 디렉터리에 분산 설치되는 사이트가 나오면 그때 선언을 검토한다.
- **기각한 대안:** 이 축을 스윕 시작 시 전처리로 두고 실패 시 다른 게이트를 아예 돌리지 않는 방식. 한 lib이 구판이어도 나머지 20종의 판정은 여전히 참이고, 전부 막으면 부분 동기화가 "아무것도 모르는 상태"로 악화된다. 규칙표의 한 축으로 두어 다른 판정과 나란히 계상한다. 재검토 조건: 없음.
- **기각한 대안:** 크래시 요약에서 런타임별 오류 어휘 목록을 유지하는 방식. 목록 밖 런타임에서 통째로 빗나가고 그 실패가 조용하다 — 스택 프레임·캐럿·배너를 **형태로** 걸러내는 쪽이 어휘에 독립적이다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(도입 전 교정 집합 측정 456건·오탐 0 → 양성 대조 2/2 → 순수 코어 TDD 15종 + 게이트 4종 + 양판 패리티 8시나리오) + 소비 프로젝트 개선 요청(부분 동기화 crash) → Active | FR-001~005 unit 커버. 킷 자기적용: 모듈 78종 위반 0건. 도그푸딩으로 발견·수정 3건 — 자기 주석 오탐, 앵커링 오탐 위험, 픽스처 손 목록 드리프트 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-004(harness-install): 비중복 — 004의 전이 폐포 계약은 **배포 목록에 파일이 있는가**(설치기 소스 검사), 050은 **설치된 파일이 요구된 export를 갖는가**(설치 결과 검사)다. 제보의 결함은 파일이 있었으므로 004를 통과했다 — 한 칸 더 안쪽이다. 크래시 요약(FR-005)은 004가 소유한 `sdd-sync.mjs`를 수정하지만 그 판정 축은 이 스펙의 것이다.
- 2026-08-10 이웃 SPEC-040(gate-verdict): 비중복 — 040은 게이트가 판정 종류를 **선언하는** 계약이고 크래시를 미판정으로 계상한다, 050은 그 크래시가 **일어나기 전에** 원인을 이름으로 말한다. 040이 침묵을 막았고 050이 오진을 막는다.
- 2026-08-10 이웃 SPEC-048(watchdog): 비중복 — 048은 감시자가 **실재하는가**(CI 배선·영수증), 050은 실재하는 감시자가 **로드되는가**다. 게이트 파일이 전부 있고 CI가 걸려 있어도 lib 하나가 구판이면 그 게이트는 판정하지 않는다.
- 2026-08-10 이웃 SPEC-036(hook-wiring): 비중복 — 036은 훅이 발동하는 **경로**의 실재(git이 아는 훅 자리), 050은 발동한 게이트가 로드되는 **모듈 그래프**의 실재다. 둘 다 "배선"이지만 층이 다르고, 둘 다 조용한 무력화라는 실패 모양을 공유한다.
- 2026-08-10 이웃 SPEC-038(duplicate-logic): 비중복 — 038은 같은 규칙이 두 곳에 **구현**됐는가, 050은 한 곳의 구현이 다른 곳에서 **참조 가능한가**다. 실측으로 둘이 만난 자리가 있다: 050의 코어가 R13에 중복 2건으로 걸려 별칭 정규식을 상수로 뽑았다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `import-wiring-lib`(절 파싱·export 집합 파싱·전이 판정 3갈래) + `check-import-wiring` + `importWiringPolicy`·`importWiringExtensions` + 스윕 R18 등재 + 배포 목록·래칫 감시 편입 + `sdd-sync` 크래시 요약을 원인 줄 선택으로 교정, 양판 | 제보: update 절차의 diff가 공유 lib 27개를 빠뜨려 **부분 동기화**가 됐고 소비처는 판정이 아니라 `SyntaxError`를 받았다. 파일 실재만 보던 기존 계약으로는 원리상 안 잡힌다. 제보가 준 두 선택지(문구 vs 기계)를 **둘 다** 채택 — 프로즈로만 금지하는 상태는 이미 여러 번 실패했고, 게이트만 두면 절차를 따르는 사람이 이유를 모른다. 도입 순서를 오탐 위험 기준으로 잡았다: 킷 전체를 교정 집합으로 먼저 재고(명명 import 456건·오탐 0·미모델 0) 그다음 양성 대조를 확인한 뒤 배선했다 — 오탐이 잦은 게이트는 꺼지므로 이 순서가 설계의 일부다. 도그푸딩이 즉시 3건을 잡았다: ①자기 코어의 주석 속 예시(SPEC-044 코어 재사용으로 해소) ②`^export` 앵커링이 문장 중간 선언을 놓쳐 오탐이 될 위험(문장 경계로 교체) ③테스트 픽스처의 손 복사 목록이 `ownership-keys.mjs`를 빠뜨려 이 스레드가 고치는 드리프트를 재연(폐포 계산으로 교체). 부수로 크래시 요약을 고쳤다 — 스윕이 사유로 `Node.js v22.22.2`를 보고하고 있었다(마지막 줄이 요약인 것은 게이트가 협조적으로 끝났을 때만 참이다) [검증: tooling/__tests__/import-wiring.test.mjs] |
