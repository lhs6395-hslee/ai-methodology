# Feature Specification: Process SSOT (여러 스펙에 걸친 사슬은 아무도 소유하지 않는다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-047`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10, 사례 5) — close-out 사슬이 8단계(로컬 실측 → 커밋·푸시 → main 머지 → 배포 → 개발 실측 → 교차검증 일치 → dev-done → 리포터 확인)인데 조각이 **6개 문서에 흩어져** 있고 전 구간을 담은 문서가 없었다. "로컬 실측"과 "교차검증"은 한 스펙에, "dev-done"과 "리포터"는 다른 넷에, "브랜치·배포 순서"는 또 다른 둘에 있었다. 어느 문서를 읽어도 사슬의 일부만 보이므로 세션마다 flow를 재구성하고 매번 다른 곳이 빠졌다. 그리고 그 흩어짐이 코드에 그대로 나타났다 — 교차검증 함수가 `if (!peers.length) return { agree: true }`로 상대 기록이 없으면 통과했고, 양쪽 판정 기록이 **만날 저장소가 아예 없었다**(로컬은 작업 디렉터리, 클러스터 Job은 볼륨 없는 파드의 `/tmp`). 그 교차검증은 단 한 번도 비교를 수행한 적이 없고, 소유자가 결정한 "교차검증 일치 시에만 전이"는 명세에만 존재했다. 저장소 요구는 어느 FR에도 없고 코드 주석에만 있었다 — 인프라 산출물인데 인프라 스펙 밖이라 그쪽 리뷰에서도 빠졌다.

---

## User Scenarios & Testing

### User Story 1 — 사슬은 한 문서가 전 구간을 소유한다 (P1)
순차 프로세스의 단계가 여러 문서에 흩어지면 전체를 아는 사람이 없어진다. 선언된 단계 전부가 SSOT 문서 하나에 있어야 하고, 조각을 든 다른 문서는 그 SSOT를 가리켜야 한다.
- **Independent Test**: `process-ssot.test.mjs`가 순수 코어(단계 정규화·config 문법·빠진 단계·조각 보유·최소 단계 임계)와 게이트(미선언 inert·SSOT 부재·통과·advisory 비차단·off)를 단독 검증. [검증: tooling/__tests__/process-ssot.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a declared process, **When** its SSOT document omits some stage, **Then** the gate names the missing stages.

### User Story 2 — 비교는 기록이 만날 자리가 있어야 성립한다 (P1)
실행 사이의 대조·합의를 요구하는 단계는 그 기록이 만날 **저장소를 선언**해야 한다. 저장소가 없으면 그 비교는 "상대 기록 없음 → 통과"로 조용히 무행동이 되고, 그건 규칙이 있는데 한 번도 실행되지 않은 상태다.
- **Independent Test**: 같은 테스트가 비교 마커 단계의 저장소 미선언을 표면화하고 선언 후 통과함을 검증. [검증: tooling/__tests__/process-ssot.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a stage whose name claims cross-run comparison, **When** it declares no store, **Then** the gate surfaces it.

### User Story 3 — 선언된 저장소는 소유돼야 한다 (P1)
저장소는 인프라 산출물이다. 어느 스펙의 Ownership에도 없으면 그 산출물은 스펙 밖에 있고, 그러면 인프라 리뷰에서도 빠진다 — 제보에서 저장소 요구가 코드 주석에만 있었던 이유다.
- **Independent Test**: 같은 테스트가 미소유 저장소를 표면화하고 소유 시 통과함을 검증. [검증: tooling/__tests__/process-ssot.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a declared store that no spec's Files glob matches, **When** the gate runs, **Then** it reports the store as unowned.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **`processes` 미선언은 `INERT`다** — 순차 사슬이 없는 프로젝트에 사슬을 요구하면 거짓 요구다. 선언이 판정의 입구다.
- **1단계는 사슬이 아니다** — `stages`가 2개 미만이면 config 문법 위반이다.
- **선언했는데 SSOT 문서가 없으면 판정 실패다** — 없는 문서는 소유자가 없는 것과 같다.
- **단계 이름은 문자 그대로 찾는다** — 표기가 다르면 선언을 문서에 맞추는 것이 해소다(동의어 추정은 하지 않는다 — SPEC-033·042가 거부한 길).
- **조각 임계는 2단계다** — 1이면 사슬을 언급만 해도 걸려 오탐이 폭주한다(`processFragmentMinStages`).
- **참조는 경로 문자열의 등장으로 성립한다** — 새 문법을 만들지 않는다. 링크든 산문이든 SSOT 경로를 적으면 된다.
- **코드는 조각 보유 대상이 아니다** — 사슬은 문서가 소유한다. 산문(`.md`·`.html`)만 본다.
- **사슬의 순서가 옳은지는 판정하지 않는다** — 존재는 기계, 질은 리뷰.
- 비교 마커는 프로젝트가 갈아끼운다(`statefulStageMarkers`) — 어휘 교체이지 면제가 아니다.
- 기본 `advisory`. `hard`는 SSOT가 정착한 뒤가 종착지다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a process is declared with an SSOT document and at least two stages, the **process-ssot** (E) core in **process-ssot-lib.mjs** (S) SHALL report every declared stage name absent from that document. — capability: **process-ssot.consolidate** (C).
- **FR-002** (unwanted): IF a prose document holds at least the fragment threshold of declared stage names without containing the SSOT path, THEN **check-process-ssot.mjs** (S) SHALL report it as a fragment holder, warning under advisory and exiting non-zero under hard.
- **FR-003** (unwanted): IF a stage name claims cross-run comparison by marker while declaring no store, THEN the gate SHALL report it as a comparison without a meeting place; IF a declared store matches no spec's ownership globs, THEN the gate SHALL report it as unowned infrastructure.
- **FR-004** (state): WHILE no process is declared, THE SYSTEM SHALL declare itself inert rather than reporting zero violations; WHERE a declared SSOT document is absent, THE SYSTEM SHALL fail rather than skipping it.

### Key Entities
- **process-ssot** — the single document that owns a sequential chain end to end, as distinct from the specs that hold its fragments, so that no reader has to reconstruct the flow from pieces.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: process-ssot
- **Symbols**: process-ssot-lib.mjs, check-process-ssot.mjs
- **Artifacts**: —
- **Capabilities**: process-ssot.consolidate
- **Files**: tooling/process-ssot-lib.mjs, tooling/check-process-ssot.mjs, tooling/__tests__/process-ssot.test.mjs

## Dependencies (참조 — dedup 제외)
> 소유 글롭 해석은 SPEC-003, 판정 종류는 SPEC-040, 마커→요구 표기 형태는 SPEC-016·043, Python 복제는 SPEC-006 소유.
- **Modules**: spec-sync (references), gate-verdict (references), evidence-scope (references)
- **Symbols**: sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `process-ssot.test.mjs` 전 케이스 green — 단계 정규화·config 문법 3종·빠진 단계·조각 보유(자기 제외·참조 통과·1단계 제외)·비교 마커 저장소·마커 교체·미소유 저장소·게이트 5갈래. [검증: tooling/__tests__/process-ssot.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 제보의 8단계 사슬이 합성 재현으로 표면화된다 — 빠진 단계 5건·조각 보유 1건·저장소 미선언 1건이 각각 지목된다. [검증: tooling/__tests__/process-ssot.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 대조만의 순수 함수이고 파일 읽기·글롭 컴파일·소유 해석은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/process-ssot.test.mjs]

## Assumptions / Clarifications Retained
- 사슬의 **내용**이 옳은지는 판정하지 않는다 — 단계가 빠짐없이 한 문서에 있다는 사실만 센다. 순서·전이 조건의 타당성은 리뷰의 몫이다(존재는 기계, 질은 리뷰).
- **기각한 대안:** 사슬을 스펙들에서 **자동 재구성**하는 방식(각 스펙의 단계 언급을 모아 전체를 만든다). 그러면 게이트가 사슬의 저자가 되고, 재구성된 사슬이 실제 의도와 다를 때 아무도 그걸 모른다. 사슬은 사람이 한 문서에 쓴다. 재검토 조건: 없음.
- **기각한 대안:** 단계 이름의 동의어·유사 표기를 추정하는 방식. 오탐이 폭주하고 판정이 확률적이 된다 — SPEC-033·042가 이미 거부한 길이다. 재검토 조건: 없음. 표기 불일치의 해소는 선언을 문서에 맞추는 것이다.
- **기각한 대안:** 모든 단계에 저장소를 요구하는 방식. 대부분의 단계는 상태가 필요 없고(커밋·머지), 전부 요구하면 사람이 빈 값을 채운다. 비교·합의 마커와의 곱으로 좁힌다 — SPEC-043이 방아쇠 폭을 곱으로 좁힌 것과 같은 판단이다. 재검토 조건: 마커 없는 단계가 상태 부재로 실패한 실측이 나오면 마커를 넓힌다.
- **기각한 대안:** 저장소가 **실제로 쓰였는지** 확인하는 방식. 그건 SPEC-041(실행 원장)의 축이다 — 이 spec은 저장소가 **선언·소유됐는지**까지 본다. 존재는 실행이 아니다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 7종·게이트 e2e 5종·제보 8단계 사슬 합성 재현) + 소비 프로젝트 개선 요청(사례 5) → Active | FR-001~004 unit 커버. 킷 자기적용: 순차 사슬 미선언이라 `INERT`를 명시 출력(결합 0) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-020(cross-spec): 비중복 — 020은 스펙 **사이의 참조 정합**(키가 서로를 아는가), 047은 **순차 사슬의 전 구간 소유**다. 020은 그래프의 간선, 047은 사슬 전체를 담은 문서의 존재를 본다.
- 2026-08-10 이웃 SPEC-041(verification-run): 비중복 — 041은 선언된 검증이 **돌았는가**(실행 원장), 047은 사슬의 단계가 **한 문서에 있고 그 비교에 저장소가 있는가**다. 저장소가 실제로 쓰였는지는 041의 축이다.
- 2026-08-10 이웃 SPEC-045(intro-doc): 비중복 — 045는 **규칙표↔소개 문서**의 낡음, 047은 **순차 사슬↔조각 문서**의 흩어짐이다. 둘 다 "문서가 판정 대상"이라는 형태를 쓰지만 대조 쌍이 다르다.
- 2026-08-10 이웃 SPEC-043(evidence-scope): 비중복 — 043은 근거의 적용범위 표기, 047은 사슬의 전 구간 소유다. 047이 방아쇠를 마커와의 곱으로 좁힌 것은 043의 판단을 승계한 것이다.
- 2026-08-10 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 **행위**의 전제·승인·생존, 047은 배포를 포함한 **사슬 전체**의 문서 소유다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 엔트리 가드를 공용 `isMainEntry`(realpath 비교)로 교체 | 이 게이트가 `import.meta.url === \`file://${argv[1]}\`` 문자열 비교를 쓰고 있었다. 그 형태는 경로에 비-ASCII가 있거나 심볼릭 링크가 끼면 갈리고, 갈리면 main 블록이 **실행되지 않은 채 exit 0** — 통과가 아니라 무음 미실행이다. 킷은 이 결함을 이미 한 번 고쳤는데(SPEC-021 실측) 정의가 세 파일에 복사돼 있었고 이 게이트가 그 규범을 모른 채 깨진 형태로 태어났다. 정의를 `verdict-lib` 한 곳으로 모으고 재유입을 계약 테스트가 금지한다(SPEC-040 FR-005) [검증: tooling/__tests__/import-wiring.test.mjs] |
| 2026-08-10 | 초안 — `processes`·`processSsotPolicy`(off\|advisory\|hard, 기본 advisory)·`processSsotListCap`·`processFragmentMinStages`·`statefulStageMarkers` + `process-ssot-lib`(단계 정규화·config 문법·빠진 단계·조각 보유·비교 마커·미소유 저장소) + `check-process-ssot` + 스윕 R16 등재 | 제보 사례 5: 8단계 close-out 사슬의 조각이 6개 문서에 흩어져 전 구간 문서가 없었고, 어느 문서를 읽어도 일부만 보여 세션마다 flow를 재구성하며 매번 다른 곳이 빠졌다. 그 흩어짐이 코드의 무행동으로 나타났다 — 교차검증이 상대 기록 없으면 통과했고 두 기록이 만날 저장소가 아예 없어 **비교가 한 번도 수행된 적이 없다**. 사슬을 자동 재구성하는 길은 기각했다(게이트가 사슬의 저자가 되고, 재구성이 의도와 다를 때 아무도 모른다). 모든 단계에 저장소를 요구하는 길도 기각했다(대부분의 단계는 상태가 필요 없고, 전부 요구하면 사람이 빈 값을 채운다) — 비교·합의 마커와의 곱으로 좁혔다 [검증: tooling/__tests__/process-ssot.test.mjs] |
| 2026-08-10 | 순차 프로세스 픽스처의 복사 목록을 폐포 계산으로 교체 | 같은 드리프트 결함(삽입 위치가 다중행 import 안으로 들어가 `SyntaxError`가 났고 그 자리에서 잡혔다) |
