# Feature Specification: Spec Grammar Norm Hardening

**Module**: `sdd-tooling`  **Spec**: `SPEC-013`  **Created**: 2026-07-06  **Status**: Active
**Input**: 전 문서 감사에서 "규범은 문서에 있는데 게이트가 없는" 항목 중 결정적 기계 신호가 있는 것을 문법화한다: ① Module 헤더 존재(STORAGE §2.3 "본문 필수") ② Module 값 단일성(STRUCTURE.md 1 레포 = 1 모듈) ③ FR 선언 라인의 SHALL(EARS 5패턴 공통 필수 토큰) ④ Dedup-Review 기록이 참조한 이웃 스펙 ID의 실재(DEDUP.md 형식 검사의 연장) ⑤ `ownershipCategories`의 Files 금지(DEDUP.md §3 명시 금지) ⑥ Files 글롭 미지원 문법의 staged 차단(module-spec 템플릿 "금지" — 매치 실패 = 소유가 조용히 풀림). 순수 의미 판정 항목은 게이트가 아니라 리뷰 경계로 선언한다(METHODOLOGY).

---

## User Scenarios & Testing

### User Story 1 — 스펙 문법 규범을 completeness가 표면화 (P1)
Module 헤더가 없거나, 스펙 간 Module 값이 갈라지거나, FR 선언 라인에 SHALL이 없거나, Dedup-Review가 존재하지 않는 스펙을 참조하면 completeness 게이트가 advisory로 표면화하고 `--strict`에서 차단한다. 질(EARS 어휘·측정가능성·기록 내용)은 여전히 리뷰 몫 — 기계 신호(존재·실재·단일성)만 판정한다.
- **Independent Test**: `grammar-hardening.test.mjs`가 순수 코어와 completeness 통합(각 신호 warn·strict 실패·정합 스펙 무경고)을 임시 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec without a Module header, **When** the completeness gate runs with `--strict`, **Then** it exits non-zero naming that spec.

### User Story 2 — config·글롭 수준의 금지는 hard 차단 (P1)
`ownershipCategories`에 Files를 넣으면 글롭 문자열이 dedup 키로 유입돼 유일성·형식검증이 오판한다 — ownership 게이트가 config 검증으로 즉시 exit 1. Files 글롭의 미지원 문법(`{`·`?`·선두 `[`)은 매치 실패로 소유가 조용히 풀리므로 staged(commit-msg hard)에서 차단하고 range는 advisory를 유지한다(점진 도입 경로).
- **Independent Test**: `grammar-hardening.test.mjs`가 ownership exit 1과 spec-sync staged/range 분기를 git 픽스처로 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec whose Files line contains an unsupported glob token, **When** spec-sync runs in staged mode, **Then** it exits non-zero; in range mode it only warns.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **`Ownership.Files`의 리터럴 경로는 실재해야 한다(2026-07-28 신설).** 존재하지 않는 경로는 어떤 변경 파일과도 매치하지 않으므로 **그 스펙의 소유가 조용히 사라진다** — spec-first 강제가 그 파일에 발화하지 않고 게이트 출력에 신호도 없었다. 미지원 글롭 문법(위 항목)과 정확히 같은 실패 모드라 같은 강도로 다룬다(staged=`✗` hard / range=`⚠`). 실측(소비 프로젝트 finops): SPEC-015가 `iac_action/audit_store.py`를 소유 선언했는데 실제 모듈은 `store.py`였다 — 리네임 후 스펙이 안 따라온 드리프트가 소유권 상실로 남아 있었다. 글롭(`*`·`?`·`{}` 포함)은 대상에서 제외한다 — 오늘 0건 매치가 정당할 수 있다(아직 만들지 않은 디렉토리). 리터럴 경로엔 그 정당성이 없다: 지금 없으면 지금 틀린 것이다. ⚠ `symbolRealityPolicy`(SPEC-029 ②)는 `Surfaces`의 파일형 키만 보므로 `Files`는 사각지대였다 — 두 축이 다른 카테고리를 담당한다.
- SHALL 판정은 FR 선언 라인 단위다 — 다중행 서술이면 선언 라인에 SHALL이 오도록 쓴다(advisory라 형식 자유는 남는다). 라인 시작의 볼드 선언(`- **FR-…**` / `**FR-…**` — 불릿 유무 무관)만 대상이고, 산문 중간의 볼드 언급은 대상이 아니다.
- 삭제된 이웃 스펙을 참조하는 Dedup-Review 이력은 dangling으로 표면화된다 — 이력 자체는 보존하되 "이웃 없음(삭제됨)" 등 ID 없는 서술로 갱신한다.
- Module 값 단일성은 값이 선언된 스펙만 집계한다 — 헤더 부재는 별도 신호(이중 계산 없음).
- Files 카테고리 금지는 대소문자 무관("files"도 금지) — 우회 표기를 막는다.
- 글롭 staged 차단은 스펙 동반 위반과 독립이다 — 동반 위반이 있으면 그 에러 경로로, 없어도 글롭 위반만으로 exit 1.
- config 자기면제 판정은 **표기가 아니라 실제 매치**다 — `sdd.config.json`·`*.json`·`sdd*`·`**/*.json` 어느 표기든 config 경로를 매치하면 위반(우회 표기 차단, Files 카테고리 금지가 대소문자를 무관하게 보는 것과 동형). config가 서브디렉토리에 있으면 그 상대경로로 판정하므로 루트 밖 채택도 정확하다.
- 게이트 코드 디렉토리(`scripts/**`)는 **의도적으로 금지 목록 밖**이다 — 설치된 하네스의 소유 처방이 방법론에 아직 없어(`error`로 올리면 방법론 최신화 자체가 커밋 불가, exempt하면 게이트 코드가 무흔적 변경 구역) 금지가 처방 없는 강요가 된다. 하네스 소유 규범이 서면 이 목록에 추가 검토.
- 잘못된 글롭 문법은 이 판정에서 건너뛴다(크래시 방지) — 문법 자체는 FR-006이 별도로 본다.
- 선언 범위(FR-008)와 SHALL 판정(FR-003)은 **같은 라인 규율**을 쓴다 — 둘 다 `isFrDeclLine`(라인 시작·불릿 유무 무관) 단일 정의다. 규율이 갈라져 있던 동안(SHALL만 불릿 필수) 비불릿 스타일 스펙은 SHALL 검사에서 통째로 빠졌다: 거짓 **음성**이라 아무 findings도 내지 않아 조용했다. 선언 라인 정의가 킷에 둘 존재하면 좁은 쪽이 항상 조용한 구멍이 된다.
- SHALL 판정의 라인 규율은 요구 접두어(`requirementIdPrefixes`)를 반드시 넘겨받는다 — 넘기지 않으면 기본값 `FR`이 걸려 다중 접두어 사이트의 `**INFRA-…**` 선언이 라인 규율에서 탈락하고 검사 자체가 사라진다(실측 finops 11줄). 좁은 거짓 음성을 더 큰 거짓 음성으로 바꾸는 함정이라 회귀 테스트로 고정했다.
- Change Log·Assumptions·Dedup-Review에 굵은 요구 ID를 적는 것은 정당한 저술이다(이관·흡수 이력이 어느 번호로 갔는지 밝히는 것) — 선언 범위가 FR 섹션 밖을 보지 않으므로 게이트가 막지 않는다. 표 행은 `|`로 시작해 라인 시작 규율에서도 탈락한다.
- 같은 선언 라인 뒤쪽의 굵은 상호참조(`… SHALL x — **FR-002**를 확장`)는 선언이 아니다 — 라인의 첫 요구 토큰만 선언으로 센다.
- FR 섹션 명칭이 다른 사이트(현지어 헤딩 등)에서는 전문 폴백으로 퇴화한다 — 선언 집합이 통째로 비어 `@covers` dangling이 폭발하는 것이 더 나쁜 실패라서 안전한 방향을 택했다. 폴백에서도 라인 시작 규율은 유지되므로 표 행 오탐은 재발하지 않는다.
- 문법 혼용 판정(FR-009)은 **스펙 단위**다 — 저장소가 스펙별로 불릿/무불릿이 갈리는 것은 위반이 아니다(실측 소비 프로젝트 PM: 불릿만 9개·무불릿만 7개로 갈렸어도 파일 내부는 각각 일관). 템플릿의 규범 문장이 규정하는 것은 토큰 형태(`**FR-NNN** (패턴): 문장`)까지이고 불릿은 예시에만 나오므로, "불릿 필수"는 문서에 없는 새 의견이 된다 — 이 spec은 문서에 있는 규범만 게이트화한다. 한 파일 안의 혼용만이 실제 사고를 낸 잡음이다.
- FR-009는 FR-008과 같은 라인 규율을 쓰지만 **전문 폴백을 하지 않는다** — Assumptions·Change Log 등 다른 절이 요구 ID를 불릿으로 정당하게 인용하므로 폴백을 켜면 그 인용이 "불릿 쪽"으로 집계돼 거짓 혼용이 난다. FR-008은 집합이 비면 `@covers` dangling이 폭발해서 폴백이 안전한 방향이지만, FR-009는 advisory 신호일 뿐 커버리지 입력이 아니라 판정 유보가 안전한 방향이다(같은 규율, 반대 폴백 — 실패 모드가 반대라서).
- 셸/Go판에는 이 계층이 없다(핵심 3커맨드 계약 밖, 정직한 델타 — SPEC-006 Change Log·ci-examples 매트릭스 명시).

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the completeness gate reads a spec, the **spec-grammar-hardening** (E) judgment in **grammar-lib.mjs** (S) SHALL flag a missing Module header (advisory; non-zero under `--strict`) — the header STORAGE §2.3 declares mandatory. — capability: **spec-grammar-hardening.judge** (C).
- **FR-002** (event): WHEN specs declare more than one distinct Module value, THE SYSTEM SHALL flag the divergence listing the values (advisory) — one repo is one module, more modules mean more repos.
- **FR-003** (event): WHEN a spec's FR declaration line lacks the SHALL token, THE SYSTEM SHALL flag that FR id (advisory) — every EARS pattern carries SHALL; wording quality stays review's job.
- **FR-004** (event): WHEN a spec's Dedup-Review section references a spec ID that does not exist in the spec directory, THE SYSTEM SHALL flag the dangling reference (advisory) — extending the existence-and-form check to referential integrity.
- **FR-005** (unwanted): IF `ownershipCategories` contains Files in any letter case, THEN THE SYSTEM SHALL exit non-zero before parsing ownership — glob strings must never enter the dedup key space.
- **FR-006** (event): WHEN spec-sync runs in staged mode and any spec's Files line carries unsupported glob syntax, THE SYSTEM SHALL exit non-zero, WHILE range mode SHALL keep the warning advisory.
- **FR-007** (unwanted): IF `specSyncExemptGlobs` contains a glob that matches the config file itself, or a blanket glob (`**`, `**/*`), THEN THE SYSTEM SHALL name the offending entry with its reason and exit non-zero before parsing ownership — the exemption list is part of the control plane, so an entry that exempts the control plane or the whole tree would let every other weakening land with no persisted trace.

- **FR-009** (event): WHEN a spec declares its FR lines in both the bulleted and the unbulleted form inside the Functional Requirements section, the **spec-grammar-hardening** (E) judgment in **grammar-lib.mjs** (S) SHALL flag the mixture with both counts and one example id per form (advisory; non-zero under `--strict`), judging each spec on its own and skipping the judgment entirely when that section is absent — declaration detection stays bullet-agnostic by design, so the residual harm of a mixture falls on readers and one-off greps that see only one form.

- **FR-008** (ubiquitous): THE SYSTEM SHALL expose one **spec-grammar-hardening** (E) scope judgment in **grammar-lib.mjs** (S) that every requirement-aggregating gate consumes, counting a requirement as declared only when its bold token opens a line (bullet optional) inside the Functional Requirements section and taking the first such token on that line, and falling back to the whole document only when that section is absent — the shared token grammar itself stays untouched, so narrowing the scanned area is what separates authored declarations from the prose and history rows that legitimately cite requirement ids.

### Key Entities
- **spec grammar norm** — a documented, deterministic spec-form rule (required header, token, referential existence, forbidden config value, declaration scope) that gates can check without judging meaning.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: spec-grammar-hardening
- **Symbols**: grammar-lib.mjs
- **Artifacts**: —
- **Capabilities**: spec-grammar-hardening.judge
- **Files**: tooling/grammar-lib.mjs, tooling/__tests__/grammar-hardening.test.mjs

## Dependencies (참조 — dedup 제외)
> completeness·ownership 게이트 본체는 SPEC-002 소유, spec-sync 본체·글롭 스캐너는 SPEC-003 소유, 섹션 파서는 SPEC-008 소유(lifecycle-lib), Python 복제는 SPEC-006 소유.
- **Modules**: key-pipeline (references), spec-quality-gates (references), spec-sync (references), spec-lifecycle (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `grammar-hardening.test.mjs` 전 케이스 green + completeness/ownership/spec-sync 신규 신호 출력의 Node↔Python 바이트 동일(패리티 테스트 green). [검증: tooling/__tests__/grammar-hardening.test.mjs] [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-002**: 이 레포 자신이 completeness를 돌 때 신규 신호 0건(전 스펙 Module 단일·SHALL 구비·Dedup 참조 실재). [검증: .github/workflows/sdd-gates.yml]

## Non-Functional Requirements
- **NFR-001**: 전 판정은 텍스트 파싱·집합 비교로 결정적이며, EARS 어휘의 질·기록 내용의 질 등 의미 판정을 하지 않는다(리뷰 경계 침범 금지). [검증: tooling/__tests__/grammar-hardening.test.mjs]

## Assumptions / Clarifications Retained
- 감사에서 (b)로 분류된 순수 의미 항목(EARS 어휘 질, 역량/제품 구분, Entity 표기의 스키마 일치, verb 동의어성, 스펙 본문의 도메인 판정, 현지어본 병행 편집, 승인 절차)은 게이트가 아니라 METHODOLOGY의 리뷰 경계 선언이 정본 — 억지 게이트로 오판을 만들지 않는다.
- Files glob 완전성("빠짐없이 덮는가")은 이 spec 범위가 아니다 — `specSyncUnownedPolicy: "error"`(SPEC-003)가 closed-world로 닫는 기존 경로를 문서에서 재광고한다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-06 | 세션 리뷰(게이트 전종 + grammar-hardening/패리티 테스트 실행) | PASS |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-06 이웃 SPEC-002(spec-quality-gates): 비중복 — completeness·ownership 게이트 본체는 SPEC-002 소유, 이 spec은 문법 규범 판정 코어(grammar-lib)만 소유(SPEC-009 동형 패턴).
- 2026-07-06 이웃 SPEC-003(spec-sync): 비중복 — 글롭 스캐너(scanFilesLineIssues)·spec-sync 본체는 SPEC-003 소유, 이 spec은 staged 차단 정책만 소유.
- 2026-07-06 이웃 SPEC-008(spec-lifecycle): 비중복 — Dedup-Review 존재 판정은 SPEC-008 소유, 이 spec은 참조 ID 실재 판정만 추가.
- 2026-07-06 이웃 SPEC-012(prefix-class-consistency): 비중복 — SPEC-012는 접두어↔소유 파일 클래스 정합, 이 spec은 스펙 본문·config 문법 규범(대상이 다름).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-06 | 초안 — Module 존재·단일성, FR 라인 SHALL, Dedup-Review 참조 실재(advisory·strict) + Files 카테고리 금지·글롭 문법 staged 차단(hard) (Node·Python 동시) | 고도화 4차 전 문서 감사[검증]: 문서 규범 6건이 게이트 없이 존재 — 결정적 신호가 있는 것은 게이트로, 의미 판정은 리뷰 경계 선언으로(미강제 규범 제거) |
| 2026-07-16 | `grammar-hardening.test.mjs`의 check-spec-sync 임포트 클로저 복사 목록에 `drift-lib.mjs` 추가 | SPEC-019 동반: check-spec-sync의 새 import(drift-lib)를 테스트 하네스도 복사해야 ERR_MODULE_NOT_FOUND 없이 게이트 실행(픽스처 배선만, 판정 불변) |
| 2026-07-16 | 같은 복사 목록에 `cross-spec-lib.mjs` 추가 | SPEC-020 동반: check-spec-sync의 새 import(cross-spec-lib) 픽스처 배선(판정 불변) |
| 2026-07-27 | FR-007 신설 — `specSyncExemptGlobs` 무결성(config 자기면제·전면 면제 금지, 실제 매치 기준). `exemptGlobFindings` + check-ownership 배선, Node·Python 바이트 패리티. `scripts/**`는 의도적 제외(하네스 소유 처방 부재) | Ownership 감사 #21 A-4: `presets.md`·`METHODOLOGY.md`가 **프로즈로만** 금지하던 것을 게이트로 승격 — 실측 소비 프로젝트가 `sdd.config.json`을 실제로 등재해 config 변경이 무흔적 통과, 정책 하향·면제 확대·상한 상향이 전부 영속 흔적 0으로 실행되던 상태 |
| 2026-07-27 | FR 키 앵커 완성 — 소유 키 2건을 FR 선언 라인에 볼드+마커로 앵커 | SPEC-001 FR-010(역할 선언) 도입으로 킷 자신에게 SPEC-023 FR-005/007이 처음 발화 — 익명 주어 THE SYSTEM을 실제 수행 모듈/심볼로 바꿔 앵커 삽입(FR 의미·소유 불변) |
| 2026-07-28 | FR-008 신설 — FR "선언" 범위 단일 판정(`frDeclarations`): FR 섹션 안 라인 시작(불릿 유무 무관)의 첫 요구 토큰만 선언, 섹션 부재 시 전문 폴백. `isFrDeclLine`(SPEC-023) 재사용, Node·Python 미러. 요구 집계 5소비처(fr·cohesion·retag·smoke-scan·retire)를 이 단일 정의로 통일 | SPEC-014 FR-005(번호 중복 hard) 오탐 실측: 소비 프로젝트 PM에서 Change Log 표 행이 흡수 이력을 `FR-011→**FR-037**`로 굵게 적어 SPEC-003 8건·SPEC-004 4건이 거짓 중복으로 차단됐다(진짜 중복은 SPEC-004/FR-057 1건뿐). 공유 문법 `cfg.__frDeclRe`(SPEC-001 FR-009)를 바꾸면 5소비처에 파급되므로 **범위**만 좁혔다. 킷 스펙은 Change Log에 요구 ID를 볼드 없이 적는 관례라 자기적용에선 발현하지 않았음(전수 실측 0건) — 게이트 green이 안전의 증거가 아니었던 사례 |
| 2026-07-28 | FR-009 신설 — FR 선언 문법의 **스펙 내** 일관성(`frDeclStyleFindings`): 한 스펙이 불릿·무불릿을 섞으면 completeness advisory 1건(건수+예시 ID 각 1개), `--strict` hard. FR 섹션 부재 시 판정 유보(폴백 없음 — FR-008과 반대 방향). Node·Python 미러·바이트 패리티 실측, 테스트 6건(코어 4·completeness 통합 2) | 소비 프로젝트 PM 실측 역류(`sdd/KIT_ISSUES.md` K1): SPEC-004가 불릿 57 + 무불릿 112로 섞여 있었고, 그 혼용이 **진짜 FR 번호 중복 1건**(FR-057 — 차수 이력/My-Projects 두 선언)을 한쪽 문법만 보는 중복 스캔 grep의 거짓 음성으로 숨겼다. 킷은 이 실측 때문에 탐지를 불릿-무관으로 넓혔는데(FR-008·FR-003), 그것은 기계 쪽 구멍만 막았고 사람·임시 도구 쪽 구멍은 그대로였다 — 저술 단계에서 혼용 자체를 표면화하는 것이 남은 절반이다. 판정을 스펙 단위로 좁혀 저장소 통일을 강요하지 않은 이유: 템플릿 규범은 토큰 형태까지이고 불릿은 예시라, 불릿 필수는 문서에 없는 새 의견이 된다(K1 원안의 `frBulletPolicy` knob은 그래서 채택하지 않았다 — knob 없이 기존 advisory 신호 계층에 편입, config 표면·래칫 항목 0 증가). 자기적용·PM 양쪽 실측 0건이라 도입 비용도 0 |
| 2026-07-28 | FR-003 라인 규율을 `isFrDeclLine`(라인 시작·불릿 옵션)으로 통일 — 자체 `^\s*-\s*`(불릿 **필수**) 제거, `reqAlt`를 호출부가 주입. Node·Python 미러·바이트 패리티, 회귀 테스트 2건(비불릿 선언·다중 접두어) | FR-008이 "선언 = 라인 시작·불릿 옵션"을 규범으로 세운 직후 킷 안에 선언 라인 정의가 둘 생겼고, SHALL 검사만 좁은 쪽에 남아 비불릿 스타일 스펙을 통째로 건너뛰었다 — 거짓 **음성**(오탐과 달리 findings가 0건이라 조용하다). 실측: 킷 0줄·finops 0줄이지만 소비 프로젝트 PM에 비불릿 선언 173줄이 무검사였고, 마침 전부 SHALL을 갖고 있어(새 findings 0건) 발현이 늦었을 뿐이다. 넓히는 시점의 소비처 영향이 0인 지금이 가장 싼 순간이라 판단 — advisory 등급·판정 내용은 불변. 겸사겸사 드러난 함정을 고정: `reqAlt` 미주입 시 다중 접두어 사이트의 INFRA 선언 11줄(finops 실측)이 검사에서 사라진다 |
| 2026-07-28 | `Ownership.Files`의 **리터럴 경로 실재 검증** 신설 — 부재 경로를 staged에서 hard 차단(글롭은 대상 아님). `filesLineMissingPaths` 순수 코어 + spec-sync 배선, 회귀 테스트 2건 | 소비 프로젝트 finops 실측: SPEC-015의 Files에 `audit_store.py`가 있는데 실물은 `store.py`였고, 부재 경로는 아무 파일과도 매치하지 않아 **소유가 조용히 사라진 상태**였다. `symbolRealityPolicy`는 Surfaces만 보므로 Files는 어떤 가드도 안 보던 사각지대다. 미지원 글롭 문법과 실패 모드가 동일하므로(매치 실패=소유 상실) 같은 강도를 적용했다. 킷 자신은 리터럴 경로 전부 실재로 통과(오발동 0) |
| 2026-08-04 | 리터럴 경로 실재 검증의 **Python 이식**(`files_line_missing_paths` + `cmd_specsync` 배선·hard 판정) + 패리티 테스트 2건 | 2026-07-28 신설 당시 Node판만 만들고 Python 미러를 빠뜨렸다 — 이 축은 exit 1을 내는 **판정** 게이트라 양판 필수인데, Python 런타임 프로젝트에서는 같은 위반이 조용히 통과했다(동반 요구가 충족되면 exit 0). 실측 픽스처로 `node exit=1` / `py exit=0` 을 재현해 확인한 뒤 이식했다. SC-001이 "spec-sync 신규 신호의 Node↔Python 바이트 동일"을 이미 주장하고 있었으나 증거 테스트가 이 축을 짚지 않아 **거짓 충족**이었다 — 한쪽 런타임에만 있는 축은 축이 아니고, 패리티 주장은 그 축을 실제로 대조하는 테스트가 있을 때만 성립한다 |
| 2026-08-10 | `grammar-hardening.test.mjs`의 check-spec-sync 임포트 클로저 복사 목록에 `branch-observation-lib.mjs` 추가 | SPEC-049 동반: check-spec-sync가 차단 분기 발화를 원장에 남기려면 `branch-observation-lib`를 임포트하므로 테스트 하네스도 복사해야 ERR_MODULE_NOT_FOUND 없이 게이트가 돈다(픽스처 배선만, 판정 불변). 이 복사 목록 드리프트가 이번 라운드에도 6개 라이브러리에서 재발했으므로 `ship-closure.test.mjs`가 전이 폐쇄를 계약으로 검사한다 |
| 2026-08-10 | 문법 강화 픽스처의 복사 목록을 폐포 계산으로 교체 | 손목록은 반드시 드리프트한다 — 새 모듈 하나로 픽스처가 `ERR_MODULE_NOT_FOUND`로 죽었고, 그 crash는 문법 판정과 무관한 자리에서 떴다 |
