# Feature Specification: Intro Doc Sync (설명이 도구보다 늦으면 그 설명은 거짓이 된다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-045`  **Created**: 2026-08-10  **Status**: Active
**Input**: 오너 지시(2026-08-10) — "방법론 키트가 업데이트되거나 수정되면 **강제게이트로** 소개용 html도 업데이트되도록 해라." 그리고 그 지시를 실행하며 확인한 실측: 규칙표에 R14가 생겼는데 소개 문서(`docs/방법론.html`)는 R13까지만 말하고 있었고, 아무 게이트도 그 사실을 몰랐다 — 문서는 어떤 축에서도 판정 대상이 아니었기 때문이다. 킷은 규칙을 늘려 왔고 소개 문서는 손으로 따라왔으며, 그 손은 미끄러진다.

---

## User Scenarios & Testing

### User Story 1 — 신설 규칙은 설명 없이 지나가지 못한다 (P1)
규칙표가 규칙을 선언하면 그 규칙을 설명하는 문서도 그것을 알아야 한다. 새로 배우는 사람은 코드가 아니라 소개 문서로 방법론을 만나므로, 문서에 없는 규칙은 그 사람에게 존재하지 않는다.
- **Independent Test**: `intro-doc.test.mjs`가 순수 코어(규칙표 행에서만 ID 추출·단어 경계 대조·산문 언급 무시)와 게이트(미선언 inert·문서 부재 차단·hard 차단)를 단독 검증. [검증: tooling/__tests__/intro-doc.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a rule declared in the rule table, **When** no declared intro document mentions its identifier, **Then** the gate reports it and blocks under hard.

### User Story 2 — 문서가 인용한 숫자는 기계가 검산한다 (P1)
숫자는 가장 먼저 낡고 가장 늦게 들킨다. 문서가 `data-sdd-count`로 표시한 숫자만 대조한다 — 표시는 문서가 **자원해서** 다는 것이고, 그 선언이 곧 "이 숫자를 기계 검산 대상으로 올린다"는 약속이다.
- **Independent Test**: 같은 테스트가 일치·불일치·미지원 키·표시 없음 네 갈래를 검증. [검증: tooling/__tests__/intro-doc.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a document citing a count that no longer matches reality, **When** the gate runs, **Then** it names the cited and actual values.

### User Story 3 — 규칙표를 고친 커밋에는 설명도 있다 (P2)
코드 변경이 소유 스펙을 동반하는 것과 같은 규율을 규칙표↔소개 문서에 적용한다. 규칙이 바뀌면 그 규칙을 설명하는 문서도 같은 changeset에서 바뀌어야 한다.
- **Independent Test**: 같은 테스트가 스테이징 집합이 없을 때 이 축이 판정하지 않는 것과, 규칙표만 스테이징됐을 때 표면화하는 것을 검증. [검증: tooling/__tests__/intro-doc.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a changeset that modifies the rule table but no intro document, **When** the gate runs, **Then** it reports the missing companion update.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **`introDocs` 미선언은 `INERT`다** — 대조할 문서가 없는 상태를 "위반 0건"으로 말하지 않는다(SPEC-040).
- **선언했는데 없는 문서는 판정 실패다** — 없는 것을 "다 맞다"로 세면 선언이 무의미해진다. 경로 오타가 조용한 통과가 되지 않는다.
- **규칙 ID는 규칙표 행에서만 뽑는다** — 산문의 "R9를 참고" 같은 언급은 규칙 **선언**이 아니다. 선언 소스가 둘이면 어느 쪽이 정본인지 모른다.
- **단어 경계로 대조한다** — `R1`이 `R14`에 부분일치하면 "R1은 설명돼 있다"가 거짓으로 참이 된다.
- **인용 수치는 표시한 것만 본다** — 모든 숫자를 긁으면 버전·연도·비율까지 잡아 오탐이 폭주한다(SPEC-033·SPEC-042가 자동 추출을 거부한 것과 같은 판단).
- **오타난 인용 키는 위반이다** — 지원하지 않는 키가 조용히 "검산됨"으로 읽히면 이 축이 있으나 마나가 된다.
- **동반 갱신은 스테이징 집합을 알 때만 판정한다** — git 없음·커밋 밖 실행에서는 모르는 것을 위반으로 말하지 않는다.
- **문서의 내용이 옳은지는 판정하지 않는다** — 존재는 기계, 질은 리뷰.
- **면제 경로를 두지 않는다** — 문서 갱신을 면제로 넘길 수 있으면 그 면제가 곧 정상 경로가 되고, 그러면 이 규칙은 없는 것과 같다. 해소는 문서 편집 하나뿐이다.
- 킷 자신은 `hard`로 쓴다(오너 지시가 강제게이트였다). 소비 프로젝트 기본은 `advisory`이고 `introDocs` 미선언이면 결합 0이다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the rule table declares a rule identifier in a table row, the **intro-doc** (E) core in **intro-doc-lib.mjs** (S) SHALL check every declared intro document for that identifier on word boundaries and SHALL report identifiers that appear in none of them. — capability: **intro-doc.synchronise** (C).
- **FR-002** (event): WHEN an intro document marks a number with a machine-check attribute, **check-intro-doc.mjs** (S) SHALL compare it against the computed actual for that key and SHALL report both a mismatched value and an unsupported key, warning under advisory and exiting non-zero under hard.
- **FR-003** (unwanted): IF the changeset modifies the rule table while no declared intro document is part of it, THEN the gate SHALL report the missing companion update; IF a declared intro document does not exist on disk, THEN the gate SHALL fail rather than skipping it.
- **FR-004** (state): WHILE no intro document is declared, THE SYSTEM SHALL declare itself inert rather than reporting zero violations; WHERE the staged set is unknown, THE SYSTEM SHALL make no judgement about companion updates.

### Key Entities
- **intro-doc** — the document a newcomer meets the methodology through, as distinct from the tooling it describes, so that a stale explanation cannot teach a rule system that no longer exists.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: intro-doc
- **Symbols**: intro-doc-lib.mjs, check-intro-doc.mjs
- **Artifacts**: —
- **Capabilities**: intro-doc.synchronise
- **Files**: tooling/intro-doc-lib.mjs, tooling/check-intro-doc.mjs, tooling/__tests__/intro-doc.test.mjs, docs/방법론.html, docs/ownership-key.html, docs/ownership-key-easy.html

## Dependencies (참조 — dedup 제외)
> 규칙표는 SPEC-004(하네스)의 산출물, 스윕 등재는 SPEC-004, 판정 종류는 SPEC-040, 동반 갱신 규율의 원형은 SPEC-003, Python 복제는 SPEC-006 소유.
- **Modules**: harness-install (references), gate-verdict (references), spec-sync (references)
- **Symbols**: sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `intro-doc.test.mjs` 전 케이스 green — 규칙표 행만 추출·산문 무시·단어 경계·인용 일치/불일치/미지원 키/표시 없음·동반 갱신 3갈래·미선언 inert·문서 부재 차단. [검증: tooling/__tests__/intro-doc.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다 — 미선언 inert·규칙 누락·인용 불일치 세 갈래에서 확인. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 규칙 ID 누락 0건·인용 수치 불일치 0건이며, 이 규칙을 도입한 커밋 자체가 R14·R15 누락과 낡은 스펙 종수를 먼저 잡았다. [검증: tooling/__tests__/intro-doc.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 대조만의 순수 함수이고 파일 읽기·git 조회·실제 수치 계산은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/intro-doc.test.mjs]

## Assumptions / Clarifications Retained
- 문서가 규칙을 **올바르게** 설명하는지는 판정하지 않는다 — 규칙 번호가 나온다는 사실만 센다. 설명의 질은 리뷰의 몫이고, 그 경계는 SPEC-031·039가 이미 세웠다.
- **기각한 대안:** 소개 문서를 규칙표에서 **생성**하는 방식(문서를 산출물로 만들어 드리프트를 원천 차단). 소개 문서는 서술·비유·실측 이야기가 본체이고 그건 생성할 수 없다 — 생성하면 표만 남고 이해가 사라진다. 재검토 조건: 없음. 단 `change_log.html`처럼 **순수 표**인 문서는 계속 생성물로 둔다(SPEC-028의 경계 그대로).
- **기각한 대안:** 모든 스펙 ID가 소개 문서에 나오도록 요구하는 방식. 45종 중 20종이 정당하게 소개 문서 밖이다(내부 배선·런타임 미러 등) — 전부 요구하면 거짓 요구가 되고, 거짓 요구가 잦은 게이트는 꺼진다. 재검토 조건: 없음. 규칙 ID는 규칙표가 곧 방법론의 골격이라 다르다.
- **기각한 대안:** 문서의 모든 숫자를 자동으로 긁어 대조하는 방식. 버전·연도·비율·예시 화면의 숫자까지 잡아 오탐이 폭주한다. 표시(`data-sdd-count`)는 문서가 자원하는 선언이고, 선언은 책임지는 행위다. 재검토 조건: 표시 없는 낡은 숫자가 실측으로 문제를 일으키면 **비차단 표면화**로만 넓힌다.
- **기각한 대안:** 면제 등록부(`introDocExemptions`). 문서 갱신을 면제로 넘길 수 있으면 그 면제가 정상 경로가 된다. 오너 지시는 강제게이트였다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD·게이트 e2e·킷 자기적용 hard) + 오너 지시(키트 변경 시 소개 HTML 강제 갱신) → Active | FR-001~004 unit 커버. 킷 자기적용: 도입 즉시 R14·R15 누락 2건과 낡은 스펙 종수 1건을 잡았고, 문서 편집으로 0으로 수렴 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-003(spec-sync): 비중복 — 003은 **코드↔스펙** 동반 갱신, 045는 **규칙표↔소개 문서** 동반 갱신이다. 규율의 형태를 재사용하지만 대상 쌍이 다르고, 045는 판정 축이 셋(ID 커버리지·인용 검산·동반)이라 003의 단일 축과 겹치지 않는다.
- 2026-08-10 이웃 SPEC-028(ownership-map): 비중복 — 028은 **생성물**의 드리프트(재생성으로 해소), 045는 **저술물**의 낡음(사람이 써서 해소)이다. 생성할 수 없는 문서를 대상으로 삼는 것이 045의 존재 이유다.
- 2026-08-10 이웃 SPEC-004(harness-install): 비중복 — 004는 규칙표와 스윕을 **소유**하고, 045는 그 규칙표를 **입력으로 읽어** 문서와 대조한다. 004의 산출물이 045의 판정 축이다.
- 2026-08-10 이웃 SPEC-042(term-coverage): 비중복 — 042는 요구가 이름 댄 것이 코드에 있는가, 045는 규칙표가 선언한 것이 문서에 있는가다. 같은 "선언↔본문 대조" 형태이고 대상 쌍이 다르다.
- 2026-08-10 이웃 SPEC-040(gate-verdict): 비중복 — 040은 판정 종류의 어휘를 정하고, 045는 그 어휘를 소비한다(미선언 inert).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 소개 문서에 훅 신선도 절 추가("훅이 있어도 낡으면 없는 것과 같다") | R15 동반 갱신. 이 절의 본체는 **설치본 vs 저장소본 대조 블록**이다 — 31행/26행, 누락 5행이 호출 블록 전체, 게이트 직접 호출은 exit 1인데 배선 게이트는 OK. 그 네 줄을 나란히 보지 않으면 "게이트는 옳았고 배선이 낡았다"가 전달되지 않는다. 판정 종류를 늘린 이유(미설치와 동급)와 늘리지 **않은** 것(모든 복사를 갱신하게 만들지 않음 — 사용자 편집 보존)도 함께 적었다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | 소개 문서에 R19(에이전트 배선) 절 추가 + 인용 수치 3종 갱신(rules 17→18·gates 23→24·specs 51→52) | R15가 빠진 규칙 설명과 세 숫자를 각각 지목해 막았다. 이 절은 **관측 시점 표**가 본체다 — CI는 커밋 이후, git 훅은 커밋 시점, 에이전트 훅은 도구 사용 순간이고, 그 셋을 늘어놓지 않으면 "R17이 초록인데 감시가 없다"가 왜 가능한지 설명되지 않는다. 새로 배우는 사람에게는 규칙표 한 줄로 전달되지 않는 종류다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | 소개 문서에 절 2개 추가(R18 배선 무결성·크래시 요약 오진) + 인용 수치 3종 갱신(rules 16→17·gates 22→23·specs 50→51) + 엔트리 가드를 공용 `isMainEntry`로 교체 | R15가 세 숫자와 빠진 규칙 설명을 각각 지목해 막았다 — 규칙을 늘리는 라운드마다 이 규칙이 문서를 끌고 온다. 엔트리 가드 교체는 이 게이트 자신의 결함 수정이다: 이 파일이 `import.meta.url === \`file://…\`` 문자열 비교를 쓰고 있었고, 그 형태는 비-ASCII 경로에서 갈려 **게이트가 실행되지 않은 채 exit 0**이 된다(SPEC-040 FR-005) [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | 소개 문서에 절 2개 추가(차단 분기 발화 회계·배선 경로 해석) + 인용 수치 `specs` 49→50 | R15가 낡은 `specs` 인용을 다시 지목해 막았다. 두 절은 이번 라운드의 실측 두 건을 설명한다: ①명세·구현·단위테스트가 모두 정상인데 기록이 만날 저장소가 없어 교차검증이 단 한 번도 수행되지 않은 사례(SPEC-049) ②워크트리에서 `.git`이 파일이라 훅 배선이 통째로 무력화된 사례(SPEC-036). 둘 다 **정적 검사가 원리상 통과라고 답하는** 결함이라, 새로 배우는 사람에게는 규칙표만으로 전달되지 않는다 — 서술이 본체다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | 소개 문서에 R16·R17 서술 추가 + 인용 수치 3종 갱신(rules 16·gates 22·specs 49) | R15가 세 숫자의 낡음을 각각 지목해 막았다 — 규칙을 늘리는 라운드마다 이 규칙이 문서를 끌고 온다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | **하드코딩 제거** — 판정에 쓰이는 어휘·확장자·경로를 config knob으로 승격(`syncRulesFile`·`implModuleExtensions`·`localHostPatterns`·`processDocRegex`, 전부 null 기본 = 킷 기본값 선언) | 오너 규범: 하드코딩을 지양한다. 게이트가 어휘·확장자·경로를 고정하면 목록 밖 프로젝트에서 판정이 통째로 사라지고, **그 0건이 진짜 0건과 구분되지 않는다**(SPEC-038·040의 계열). 실측 이식성 결함: 소개 문서 게이트가 스윕 규칙표를 `tooling/sdd-sync.mjs`로 고정해 읽었는데 `sdd-init.sh`는 게이트를 `scripts/`에 깔아, 소비 사이트에서 게이트 종수 인용이 조용히 미지원 키가 되고 문서의 정직한 숫자가 "오타난 키"로 오진됐다. 후보 경로 해석으로 고치고, 못 찾으면 0으로 세지 않고 미지원으로 남긴다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | 소개 문서 3종에 R1e(지목 구현체 참조) 서술 추가 + 인용 수치 `specs` 46→47 갱신 | **이 규칙이 자기 일을 했다**: SPEC-046을 만들자 `specs` 인용이 46인데 실제 47이라고 즉시 막았고, 규칙표에 R1e 서술이 추가되며 동반 갱신 축도 소개 문서를 요구했다. 낡은 숫자와 빠진 설명이 커밋 전에 잡히는 것이 이 규칙의 존재 이유다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | 초안 — `introDocs`·`introDocRuleSource`·`introDocPolicy`(off\|advisory\|hard, 킷은 hard) + `intro-doc-lib`(규칙 ID 추출·누락 대조·인용 수치 검산·동반 갱신) + `check-intro-doc` + 스윕 R15 등재 + 소개 문서에 R14·R15 설명과 기계 검산 인용 3건 추가 | 오너 지시: 키트가 바뀌면 소개용 HTML도 강제게이트로 갱신되게 하라. 실행하며 확인한 실측: 규칙표에 R14가 생겼는데 소개 문서는 R13까지였고 아무 게이트도 몰랐다 — 문서가 판정 대상이 아니었기 때문이다. 새로 배우는 사람은 코드가 아니라 이 문서로 방법론을 만나므로 낡은 문서는 존재하지 않는 규칙 체계를 가르친다. 문서를 규칙표에서 생성하는 길은 기각했다(서술·비유·실측 이야기가 본체이고 그건 생성할 수 없다 — 생성하면 표만 남고 이해가 사라진다). 인용 수치는 문서가 자원해서 표시한 것만 본다: 모든 숫자를 긁으면 버전·연도까지 잡아 오탐이 폭주한다. 면제 경로는 두지 않았다 — 문서 갱신을 면제로 넘길 수 있으면 그 면제가 정상 경로가 된다 [검증: tooling/__tests__/intro-doc.test.mjs] |
