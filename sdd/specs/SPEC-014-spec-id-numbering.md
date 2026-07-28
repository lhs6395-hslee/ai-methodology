# Feature Specification: Spec-ID and FR Numbering Integrity

**Module**: `sdd-tooling`  **Spec**: `SPEC-014`  **Created**: 2026-07-06  **Status**: Active
**Input**: 접두어(SPEC/INFRA/TEST)는 화이트리스트로 강제되지만 **번호 매김 규칙은 미규정·미강제**였다 — 소비 프로젝트 실측에서 소비 프로젝트 A는 접두어별 순차(INFRA-001..004·TEST-001), 소비 프로젝트 B는 재도출을 SPEC-로 만든 뒤 retag해 전역 잔번(INFRA-011·INFRA-013, SPEC 쪽엔 011·013 gap)을 남겨 **두 프로젝트가 서로 다른 번호 체계**로 갈라졌다. 번호는 순전히 spec 파일 id 집합(접두어+영패딩 번호)만으로 판정 가능한 결정 신호다 — 접두어별로 **001부터 시작·중복 금지**를 hard로 강제하고, 001..max 사이 **중간 gap은 advisory**(제거·retag가 정당히 남기는 구멍)로 표면화한다. 같은 결함 계열이 **요구 번호(FR)** 층위에도 있었다 — FR 식별자는 `<SPEC-ID>/FR-NNN`이라 앞의 스펙 ID가 이미 네임스페이스인데, 규범이 안 적혀 있어 어떤 프로젝트는 전역 연번(한 스펙이 001·047·048·051·066처럼 갈라져 가독성 파괴)을 쓰고 어떤 프로젝트는 두 브랜치가 같은 스펙에 동시 추가해 **같은 번호가 2회 중복돼도 어떤 게이트에도 걸리지 않았다**. 번호 층위가 둘(spec-ID·FR)이지만 판정은 같은 "접두어+3자리 집합"이라 한 aggregate가 소유하고, severity만 분리한다(FR 중복=hard, FR 001미시작·결번=advisory).

---

## User Scenarios & Testing

### User Story 1 — 접두어별 번호가 001부터 유일하게 (P1)
각 접두어의 spec 번호는 001부터 시작하고 중복이 없어야 한다. 전역 잔번(예: INFRA가 011부터)이나 같은 번호 두 개는 fr 게이트가 exit 1로 차단하고 문제 id를 지목한다. 해소는 `sdd-retag`(재번호 맵 기계 이행, SPEC-011)로 한다.
- **Independent Test**: `numbering.test.mjs`가 순수 코어(접두어별 그룹핑·중복·001미시작·gap 판정)를 임시 id 집합으로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a prefix whose lowest spec number is 011, **When** the coverage gate runs, **Then** it reports the non-001 start with the offending id and exits non-zero.

### User Story 2 — 제거·retag가 남긴 중간 gap은 막지 않는다 (P1)
스펙을 제거(Status: Removed)하거나 다른 접두어로 retag하면 번호 시퀀스 중간에 구멍이 생긴다. 이는 정당하므로 001..max 사이 결번은 advisory 경고로만 표면화하고(빌드 비차단), `--strict`에서만 hard로 승격한다.
- **Independent Test**: `numbering.test.mjs`가 `[001,002,004]` 픽스처의 gap을 advisory로, `--strict` 승격을 hard로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a prefix with numbers 001, 002, 004, **When** the coverage gate runs without `--strict`, **Then** it warns about the missing middle number and exits zero.

### User Story 3 — FR 번호는 스펙마다 001부터, 중복은 차단 (P1)
FR 식별자는 `<SPEC-ID>/FR-NNN`이고 스펙 ID가 네임스페이스라 번호는 **스펙 안에서만** 유일하면 된다 — 그래서 표준은 스펙별 001 연번이고, 스펙 A의 FR-001과 스펙 B의 FR-001은 충돌이 아니다. 한 스펙 안 같은 번호 중복은 병합 사고(두 브랜치가 같은 번호를 각자 추가)이므로 hard로 차단하고, 001 미시작·중간 결번은 폐기 흔적일 수 있어 advisory로만 표면화한다.
- **Independent Test**: `numbering.test.mjs`가 순수 코어(스펙별 중복·001미시작·결번·레터 서픽스·도메인 요구 접두어)를 임시 FR 목록으로 단독 검증하고, `check-fr-coverage.test.mjs`가 게이트 배선(중복 exit 1 · advisory exit 0 · `--strict` 승격)을 픽스처로 검증.
- **Acceptance (GWT)**: 1. **Given** a spec declaring the same requirement id twice, **When** the coverage gate runs, **Then** it exits non-zero naming `<SPEC-ID>/FR-NNN`. 2. **Given** a spec whose requirement numbers start at 005 with a hole at 006, **When** the gate runs without `--strict`, **Then** it warns on both and exits zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 접두어별로 독립 판정한다 — SPEC와 INFRA는 각자 001부터 순차이며 서로의 번호에 간섭하지 않는다(전역 공유 번호는 비-001 시작으로 드러난다).
- 미등록 접두어 파일은 이 판정 이전에 PREFIX 화이트리스트가 이미 에러 처리한다(이중 보고 없음).
- gap 계산은 그 접두어의 실제 최소 번호부터 max까지의 내부 결번만 센다 — 001 미시작은 gap이 아니라 별도 hard 신호다(소비 프로젝트 B INFRA `[011,013]` → hard "001 미시작" + advisory "INFRA-012 gap", 001~010은 gap으로 재보고하지 않음).
- 맨 앞 spec을 제거해 001 자체가 사라진 정당 케이스는 선행 번호 전부가 `retiredIds`에 기록돼 있을 때만 통과한다(FR-001 개정 — 감사 M4에서 YAGNI 해제: `sdd-retire`가 구성적으로 이 케이스를 만들 수 있음이 확인됨). 일부만 기록이면 여전히 hard(사고성 결번과 구분).
- 실재 ID가 `retiredIds`에도 있으면 폐기 ID 재사용으로 hard(FR-004) — 과거 참조(@verifies·Change Log·vcs-history)가 의미 다른 새 스펙으로 앨리어싱되는 것을 차단. 의도적 재사용은 retiredIds에서 제거로 선언.
- 판정 severity는 fr 게이트 한 곳에서 결정한다(hard=중복·001미시작, advisory=gap·`--strict` 승격) — 번호는 단일 관심사라 게이트를 쪼개지 않는다.
- 셸/Go판 fr에는 이 계층이 없다(핵심 3커맨드 계약 밖, 정직한 델타 — SPEC-006).
- FR 번호는 spec-ID와 달리 **001 미시작이 hard가 아니다**(advisory) — spec-ID는 파일 집합이 전부 관측되므로 비-001 시작이 곧 잔번 사고지만, FR은 폐기(SPEC-018)가 맨 앞 번호를 지우는 정당 경로가 있고 FR용 `retiredIds` 기록이 없어 사고와 폐기를 구분할 신호가 없다. 구분 신호 없이 hard를 걸면 정당한 폐기가 스펙 전체 FR 재번호를 강요한다.
- FR 번호 중복만은 정책 knob 없이 항상 hard다 — 정당한 케이스가 없고(같은 스펙에 같은 식별자 둘), 앞선 선언이 뒤 선언에 조용히 덮이거나 `@covers` 한 태그가 두 요구를 동시에 만족한 것처럼 회계되어 커버리지가 거짓 green이 된다.
- 스펙 간 FR 번호는 서로 간섭하지 않는다(스펙 ID가 네임스페이스) — 판정은 스펙 단위로 독립 수행하고, 스펙 간 FR 이동은 번호가 바뀌는 재번호이므로 `sdd-retag`(SPEC-011)가 `@covers`·smokeManifest를 함께 이행한다.
- 레터 서픽스(FR-003a)는 FR-003과 **별개 ID**라 중복이 아니고, 기저 번호 003으로 접혀 결번을 만들지도 않는다. 완전 동일 ID(FR-003a 2회)만 중복이다.
- FR 선언 수집은 `cfg.__frDeclRe` 단일 문법(SPEC-001 FR-009)을 그대로 소비한다 — 게이트가 자체 정규식을 두면 사이트별 `requirementIdPrefixes`(도메인 접두어 INFRA-NNN 등)가 조용히 빠진다. 문법은 공유하되 **선언의 범위**는 SPEC-013 FR-008이 판정한다(FR 섹션 안 라인 시작).
- (2026-07-28 개정) 초판은 "문서 어디든 볼드 요구 ID = 선언"으로 보고, 산문의 볼드 인용이 팬텀 FR로 집계돼 중복 hard로 드러나는 것을 **기능**(산문 리터럴 금지의 기계 보강)이라고 적었다. 실측이 이를 뒤집었다 — Change Log가 이관·흡수 이력을 "구 SPEC-008 FR-011→**FR-037**"로 굵게 적는 것은 정당한 저술인데, 그 행 하나가 12건의 거짓 중복 hard를 만들어 정당한 스펙을 커밋 불가로 만들었다(소비 프로젝트 PM 실측). 팬텀 FR 표면화의 이득보다 정당한 이력 저술을 막는 손실이 크다는 판정. 선언은 FR 섹션 안 라인 시작으로 좁힌다.
- 중복 판정의 입력이 좁혀졌어도 severity는 불변이다 — 좁힌 범위 안에서 같은 번호가 둘이면 여전히 정책 knob 없이 hard(진짜 중복 은닉 없음: PM 실측에서 SPEC-004/FR-057 1건이 그대로 남았다).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the coverage gate evaluates the spec-file id set, the **spec-id-numbering** (E) judgment in **numbering-lib.mjs** (S) SHALL group ids by prefix and SHALL exit non-zero when any prefix contains a duplicate number or its lowest number is not one, naming the offending id — except that a lowest number above one is accepted when every preceding number of that prefix is recorded in `retiredIds` (retiring the lowest-numbered spec is a legitimate gap, not a renumbering trigger). — capability: **spec-id-numbering.judge** (C).
- **FR-002** (state): WHILE a prefix's numbers span from its lowest to its highest with interior holes, THE SYSTEM SHALL report each missing number as an advisory warning and SHALL promote it to a hard failure only under `--strict`, so removals and retags may legitimately leave gaps.
- **FR-003** (ubiquitous): THE SYSTEM SHALL derive the numbering judgment purely from the id set (prefix plus zero-padded number), performing no filesystem walk or spec-body inspection.
- **FR-004** (unwanted): IF a present spec id is also recorded in `retiredIds`, THEN THE SYSTEM SHALL exit non-zero naming the reused id — a retired id resurrected by a new spec silently aliases every historical reference (Change Log rows, `@verifies` evidence, vcs history) to a semantically different spec.
- **FR-005** (unwanted): IF one spec declares the same requirement id more than once, THEN the **spec-id-numbering** (E) judgment in **numbering-lib.mjs** (S) SHALL exit non-zero naming that spec-qualified requirement id and pointing at the retag path, evaluating each spec independently so identical numbers in different specs never collide (the spec id is already the namespace), and SHALL take its declaration input from the shared declaration-scope judgment (SPEC-013) rather than from a whole-document token scan, so history rows and prose that cite requirement ids are never counted as declarations.
- **FR-006** (state): WHILE a spec's requirement numbers do not begin at one or contain interior holes, THE SYSTEM SHALL report each as an advisory warning and SHALL promote it to a hard failure only under `--strict`, because retirement legitimately erases requirement numbers and no per-requirement retirement record exists to tell accident from removal.

### Key Entities
- **prefix number sequence** — the per-prefix ordered set of spec numbers the gate checks for start-at-001, uniqueness, and interior contiguity.
- **requirement number sequence** — the per-spec, per-requirement-prefix ordered set of requirement numbers the gate checks for uniqueness (hard) and start-at-001 plus interior contiguity (advisory); letter-suffixed ids fold onto their base number.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: spec-id-numbering
- **Symbols**: numbering-lib.mjs
- **Artifacts**: —
- **Capabilities**: spec-id-numbering.judge
- **Files**: tooling/numbering-lib.mjs, tooling/__tests__/numbering.test.mjs

## Dependencies (참조 — dedup 제외)
> fr 게이트 본체·PREFIX 화이트리스트는 SPEC-002 소유(이 spec은 번호 판정 코어만), 재번호 해소 수단은 SPEC-011(retag), Python 복제는 SPEC-006 소유.
- **Modules**: spec-quality-gates (references), retag (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `numbering.test.mjs` 전 케이스 green + fr 번호 판정 출력·exit의 Node↔Python 바이트 동일(패리티 테스트 green).
- **SC-002**: 이 레포 자신이 fr 게이트를 돌 때 번호 위반 0건(spec-ID는 접두어별 001 연속, FR은 28스펙 전부 001 연번·중복 0·결번 0 — 도그푸딩 실측).

## Non-Functional Requirements
- **NFR-001**: 판정은 id 문자열 파싱·정수 비교만으로 결정적이며, 접두어별 출력은 정렬되어 실행 간 안정적이다.

## Assumptions / Clarifications Retained
- 번호 모델의 정본은 "접두어별 001 순차"다 — 전역 공유 번호는 채택하지 않는다(가독성·접두어별 독립성). 이 결정은 STORAGE 접두어 의미(§2.2)와 정합.
- FR 번호 모델의 정본은 "**스펙별 001 연번**"이다 — 식별자가 `<SPEC-ID>/FR-NNN`이라 앞의 스펙 ID가 이미 네임스페이스이므로 뒤 번호가 전역 유일성을 다시 벌 필요가 없고, 그 대가로 가독성을 파는 것은 손해다(전역 연번은 한 스펙이 001·047·048·051·066으로 갈라진다). 규범 정본은 `STORAGE.md` §2-4, 저술 안내는 `templates/module-spec.md` 주석.
- 판정 코어는 spec-ID·FR 두 층위가 **순수 원형 하나**(`groupNumbers`)를 공유한다 — 둘 다 "접두어+3자리[+레터 서픽스] 집합"의 중복·최소·내부 결번 판정이라 판정층 재사용이 자연스럽다. 반면 severity는 공유하지 않는다(spec-ID 001미시작=hard vs FR 001미시작=advisory) — 정책층을 합치면 한쪽 도메인의 완화가 다른 쪽으로 새기 때문에 문구·판정 정책은 도메인별 함수로 분리했다.
- 소비 프로젝트의 기존 FR 번호 위반(전역 연번 잔재·병합 중복) 정규화는 각 프로젝트가 `sdd-retag`로 수행하는 다운스트림 작업이며 이 spec 범위 밖이다.
- 소비 프로젝트의 기존 위반(예: 소비 프로젝트 B INFRA-011/013) 정규화는 각 프로젝트가 `sdd-retag`로 수행하는 다운스트림 작업이며 이 spec 범위 밖이다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(numbering·패리티 테스트 + 게이트 전종 실행) | PASS |
| 2026-07-27 | 세션 리뷰(FR 번호 층위 확장 — 규범 착지·numbering/게이트/패리티 테스트 + sdd-sync 전종 실행 + 킷 28스펙 자기적용 실측 0건) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-002(spec-quality-gates): 비중복 — PREFIX 등록 거버넌스·fr 본체는 SPEC-002 소유, 이 spec은 번호 무결성 판정 코어만 소유.
- 2026-07-06 이웃 SPEC-012(prefix-class-consistency): 비중복 — SPEC-012는 접두어↔소스클래스 정합, 이 spec은 접두어 내부 번호 순차성(직교 관심사).
- 2026-07-06 이웃 SPEC-011(traceability-retag): 비중복 — 위반 해소 수단(재번호)은 SPEC-011 소유, 이 spec은 판정만.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — 접두어별 001시작·중복 hard·중간 gap advisory(`--strict` 승격), Node·Python 동시 | 소비 프로젝트 A(접두어별)·소비 프로젝트 B(전역 INFRA-011/013) 번호 체계 불일치[검증] — 번호 모델이 미규정·미강제라 프로젝트마다 제각각 |
| 2026-07-16 | `numberingIssues`에 `retiredIds` 인자 추가 — 폐기 기록된 번호의 gap은 advisory에서 제외(사고성 결번과 구분), Node·Python 패리티 + 테스트 2건 | SPEC-018 FR-006 동반(소비): 폐기 워크플로가 남기는 번호 gap을 정상 retirement gap으로 인지 — 판정 코어는 이 spec 소유 |
| 2026-07-16 | FR-001 개정 + FR-004 신설 — ① 001-미시작 hard에 retiredIds 면제(선행 번호 전부 폐기 기록이면 정상 gap — 최소번호 스펙 폐기가 접두어 전체 재번호·retag 연쇄를 강요하던 모순 해소, SPEC-018 FR-006과 정합) ② 폐기 ID 재사용 hard(실재 ID ∈ retiredIds = exit 1). Node·Python 패리티 | 감사 M3·M4: retiredIds가 내부 gap만 면제해 SPEC-001 폐기 시 fr 게이트 영구 red + 폐기 ID를 새 스펙이 재사용해도 무신호(과거 참조 앨리어싱)이던 두 결함 — SPEC-018/STRUCTURE의 "retiredIds가 처리한다" 약속과 SPEC-014 실구현의 문서 모순도 해소 |
| 2026-07-27 | FR 키 앵커 완성 — 소유 키 2건을 FR 선언 라인에 볼드+마커로 앵커 | SPEC-001 FR-010(역할 선언) 도입으로 킷 자신에게 SPEC-023 FR-005/007이 처음 발화 — 익명 주어 THE SYSTEM을 실제 수행 모듈/심볼로 바꿔 앵커 삽입(FR 의미·소유 불변) |
| 2026-07-27 | FR 번호 층위 확장 — 요구 2건 신설(스펙 내 중복 hard·001미시작/결번 advisory), 판정 원형 `groupNumbers`를 spec-ID 판정과 공유, Node·Python 패리티 + 테스트 14건 | owner가 per-spec FR 연번을 표준으로 확정했는데 규범이 킷 문서 어디에도 없어 프로젝트마다 갈렸다[검증]: 킷 자신 28/28은 이미 per-spec(암묵), 한 소비 프로젝트는 readopt 잔재로 전역 연번(한 스펙이 001·047·048·051·066 — 가독성 파괴), 다른 소비 프로젝트는 두 브랜치가 같은 스펙에 동시 추가해 4개 번호가 각 2회 중복됐는데 **어떤 게이트에도 걸리지 않음** — 규범 미기재 + 중복 무신호 두 구멍을 함께 봉합 |
| 2026-07-28 | FR-005 개정(오탐 봉합) — 중복 판정의 **입력**을 SPEC-013 FR-008 선언 범위(FR 섹션 안 라인 시작)로 교체. severity·출력 문구·`--strict` 승격 전부 불변. Edge Cases의 "팬텀 FR 표면화 = 기능" 항목을 개정 근거와 함께 뒤집음 | 직전 커밋(`509b9d9`) 오탐 실측: 소비 프로젝트 PM에서 Change Log 표 행의 이관 이력(`FR-011→**FR-037**`)이 선언으로 집계돼 SPEC-003 FR-037~044·SPEC-004 FR-165~168 총 12건이 거짓 중복 hard로 차단, 진짜 중복은 SPEC-004/FR-057 1건뿐. 킷 자기적용에선 Change Log가 요구 ID를 볼드 없이 적는 관례라 발현 0건이었다(전수 grep 실측) — 자기적용 green이 오탐 부재의 증거가 아니었다 |
