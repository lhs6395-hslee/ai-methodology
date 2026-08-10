# Feature Specification: Capability Ownership (스펙 경계 = entity 기준의 기계화)

**Module**: `sdd-tooling`  **Spec**: `SPEC-024`  **Created**: 2026-07-20  **Status**: Active
**Input**: 소비 프로젝트 실측(budget-engine): Entities 0개인 스펙이 `pjt_projects.compute`·`budget.aggregate` 등 capability 4개를 소유한 채 태어남 — 도메인(aggregate)이 아니라 기술 계층(엔진/헬퍼) 기준 분할. owner 확정 모델: **"entity 키가 같으면 같은 스펙, verb가 달라도 같은 entity면 같은 스펙에 FR 신설, 참조·종속 entity는 relation(Dependencies)으로"** — 즉 capability `x.verb`는 entity `x`를 **소유한** 스펙만 선언할 수 있다. 기존엔 이 경계 규칙에 기계 신호가 없었고(cohesion은 "entity 과다"만 검사 — 0개+capability 소유는 무검사), METHODOLOGY의 "Dependencies의 entity여도 무방" 문장이 탈출구로 읽혔다(개정 동반).

---

## User Scenarios & Testing

### User Story 1 — entity 없는 capability 스펙은 태어나지 못한다 (P1)
ownership 게이트가 각 스펙의 소유 capability에 대해 entity 조각(첫 점 앞, 정규화)이 그 스펙의 소유 entity 집합에 있는지 대조한다. entity 0개+capability 소유(기술 계층 스펙)와 남의 entity 위 capability가 모두 위반 — advisory는 경고, hard는 exit 1. 라우팅 결정트리("키 산출 → 소유 스펙 개정, 새 spec 금지")의 사후 강제판.
- **Independent Test**: `capability-ownership.test.mjs`가 순수 코어(활성 판정·귀속 대조)와 게이트 배선(off/advisory/hard)을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** `capabilityOwnershipPolicy: hard` and a spec owning `budget.aggregate` with no owned `budget` entity, **When** the ownership gate runs, **Then** it names the spec, capability, and entity segment, and exits non-zero.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **분할 실행의 두 함정 — 앵커 승계와 캐시 컬럼 판정(2026-07-28 실측).** PM SPEC-004를 11 조각으로 분할하며 드러났고, 둘 다 모르면 조용히 부채가 쌓인다.
  · **앵커 승계**: 이관하는 FR이 어떤 소유 키를 **유일하게** 앵커하고 있으면, 그 키를 남기는 쪽에서 다른 FR이 앵커를 승계해야 한다 — 안 하면 **미앵커 소유 키**가 생긴다(SPEC-023 FR-007 위반). 실측 3건(구 FR-003이 `pjt-detail-client.tsx`를, FR-085가 `pjt-gantt.tsx`를, FR-110이 `get /tools/pjt-management/new`를 유일하게 앵커하고 있었다). 이관 전에 **양방향으로** 확인해라 — 옮기는 키의 앵커가 남는지, 남는 키의 앵커가 옮겨가는지.
  · **캐시·포인터 컬럼 동시 쓰기는 복수 aggregate가 아니다**: 자식 표를 쓰면서 부모의 집계 캐시(`fee_cost`·`material_cost`)나 포인터(`exec_stage`·`revision_no`)를 함께 갱신하는 것은 **그 표의 쓰기 계약 안**이다. 이 기준이 없으면 거의 모든 FR이 "복수 aggregate"로 분류돼 분할이 불가능해 보인다(실측: 이 기준 적용 전 복수 34건 → 적용 후 aggregate별 배정 21건 성립).
- **표면 스펙(surface-only spec)은 정당한 종류다 — 금지되는 것은 capability 없는 entity가 아니라 entity 없는 capability다(2026-07-28 명명).** 이 게이트가 금지하는 것(FR-002)은 **소유 capability의 entity 귀속 실패**뿐이다 — capability를 하나도 소유하지 않으면 판정이 공허하게 통과한다. 그래서 `Surfaces`만 소유하고 `Entities`·`Capabilities`를 두지 않는 스펙은 **이미 합법인데 이름이 없었다.** 그 결과 실행자가 "어느 aggregate에도 안 붙는 FR"을 만나면 귀속 불가로 남기게 됐다(실측: PM SPEC-004의 판정 불가 52건 중 **37건**이 이 부류 — 화면 크롬·내비게이션 17, 문서추출 파이프라인 12, 마법사 로컬 draft 6, 표현 규칙 2). **경계선**: capability는 "이 시스템이 무엇을 할 수 있다"는 **주장**이라 반드시 aggregate에 귀속돼야 한다. surface는 "어디서 무슨 일이 일어난다"는 **위치**라 aggregate가 없어도 성립한다. 따라서 표면 스펙은 ① `Surfaces`를 소유하고 ② `Entities`·`Capabilities` 불릿을 **두지 않으며**(`—` 플레이스홀더가 아니라 항목 자체를 생략 — 실측 선례: 소비 프로젝트 PM의 SPEC-010·SPEC-014·TEST-001이 이 형태로 전 게이트 통과) ③ 읽고 쓰는 entity는 `## Dependencies`로 참조한다. ⚠ 표면 스펙도 입도 상한(`maxKeysPerCategoryPerSpec`·`maxFRsPerSpec`)에서 면제되지 않는다 — 귀속 애매한 FR의 하수구가 되는 것을 그 상한이 막는다.
- **분할에는 선행 조건이 하나 더 있다 — FR이 aggregate를 지목해야 한다(2026-07-28 실측).** 위 순서(대상 분할 → 이관)를 실행하려 해도, 분할은 "이 FR이 어느 aggregate 소관인가"를 FR마다 정해야 하는데 그 근거가 스펙에 없을 수 있다. 실측(소비 프로젝트 PM, SPEC-004): aggregate root 6개·Capabilities가 entity별로 10/4/3/3/2/1로 **깔끔히 갈리는데도** FR 169개 중 **124개(73%)가 볼드 앵커를 아예 갖지 않는다.** 정당한 통과다 — SPEC-023 FR-007은 소유 키가 *어느 FR엔가 최소 1회* 앵커되면 충족이므로, 34개 FR이 전 키를 앵커하면 나머지 135개는 앵커 없이 지나간다. 그 결과 **aggregate 경계는 명확한데 FR 귀속 근거가 없는** 상태가 된다(예: "`isViewing`이 참이면 내부 탭을 숨긴다" — 문장만으로 소관 aggregate가 정해지지 않는다). ⚠ 따라서 실제 순서는 **3단**이다: ① FR 앵커 밀도 확보(각 FR이 자기 대상을 표기) → ② aggregate 단위 분할 → ③ capability 이관. ①을 건너뛰고 ②를 하면 124개 FR의 귀속을 저술자가 아닌 실행자가 추정하게 되고, 그 추정은 스펙 경계를 대신 결정하는 것이다. ①은 판단이 아니라 저술이므로(이미 문장이 말하는 대상을 표기) 위임 가능하지만, ②는 리뷰 경계다.
- **이관 대상 스펙이 이미 입도 상한을 넘었을 때 — 분할이 선행이다(2026-07-28 신설).** 처방("능력을 그 entity를 소유한 스펙으로 이관")을 그대로 적용하면 대상 스펙이 더 커진다. 실측(소비 프로젝트 PM): 면제 4건 이관 시 대상 스펙이 169 FR → **228 FR**(상한 50), Surfaces 38→44, Capabilities 23→27. cohesion이 이미 "여러 aggregate 삼킴"으로 경고하던 스펙이다. **둘은 경쟁이 아니라 순서다** — entity 경계가 정확성 규칙이므로 먼저지만, 대상의 상한 초과는 **선행 위반**이다. 순서: 대상 스펙을 aggregate 단위로 분할 → 그 다음 이관. 순서를 뒤집으면 스펙 해체·`strictSpecs` 상실·키 충돌이 한꺼번에 온다(PM 실측: `pjt_projects.aggregate`·`.analyze`가 대상 스펙에 이미 다른 의미로 존재). 즉 이관이 막힌 것처럼 보일 때 진짜 블로커는 이관이 아니라 대상의 미분할이다. 분할 경계는 리뷰 경계(`METHODOLOGY.md` §entity 경계와 입도).
- entity류·capability류 카테고리가 **둘 다** 있을 때만 활성 — 비-웹 카테고리(킷 자신의 Modules/Symbols/Artifacts, 파이프라인의 Datasets/Jobs/Sinks)는 capability 개념이 없어 무영향.
- **그러나 inert는 침묵하지 않는다:** 정책이 off가 아닌데 카테고리 때문에 판정이 성립하지 않으면 게이트가 사유를 출력한다 — `hard`면 그 자체로 차단(hard 선언 + 무판정 = 거짓 안전), `advisory`면 플레인 고지(경고 글리프 없이 — 기본값이 advisory라 비-웹 프로젝트의 하네스 리포트를 소급 오염시키지 않는다). 정당한 inert의 탈출구는 정책을 **명시적 `off`**로 두는 것이며, 그 하향은 래칫(SPEC-027)이 loud하게 기록한다. 근거: 감사 A-1 실측 — `Entities`를 의미 동일한 `Aggregates`로 개명하면 `hard` 정책이 완전 no-op이 되면서 유령 entity가 `✓ 구조적 중복 없음`으로 통과(exit 0)했고 스킵 신호가 한 줄도 없었다.
- 점 없는 capability는 형식 위반이라 `validateKey`가 담당 — 이 판정은 스킵(이중 보고 금지).
- 대조는 정규화(트림·소문자) — Ownership 선언의 표기 편차에 비의존.
- 참조 entity(Dependencies) 위의 capability도 위반이다 — 참조는 읽기/호출 선언이지 능력 소유 근거가 아니며, 그 능력은 entity 소유 스펙의 FR이다(owner 확정: verb가 달라도 같은 스펙).
- 위반 해소는 두 방향: (a) capability를 entity 소유 스펙으로 이관(+FR 이동), (b) 이 스펙이 실제 그 aggregate면 Entities에 소유 선언(그러면 dedup이 타 스펙과의 충돌을 검증).
- 기본 `advisory` — 핵심 경계 규칙이라 off가 아닌 advisory로 태어나되 빌드는 안 깬다(기존 위반 스펙의 마이그레이션은 update 백로그 경로).
- **지원 계층 출구는 `ownershipRequiredPolicy`까지 연다** — `supportLayerSpecs`에 사유와 함께 등록된 스펙은 **Files 선언만으로** Ownership 요구를 충족한다. 실측 제보: aggregate 없는 부가 계층이 ①캡 초과라 분할해야 하는데 ②분리 스펙은 entity가 없어 capability를 소유할 수 없고 ③그러면 키가 0이라 Ownership 게이트가 막아 **출구가 없었다**. Files가 있으면 중복 검사의 사각이 아니다 — `filesOverlapPolicy`(G3)가 그 글롭의 실파일 겹침을 판정하므로 이 출구는 dedup을 약화시키지 않는다. 등록 없이 키 0이면 여전히 막히고, 등록만 하고 Files도 없으면 막힌다(등록은 백지수표가 아니다). 그리고 이 출구는 **매 실행 표면화**한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (state): WHILE `capabilityOwnershipPolicy` is off, THE SYSTEM SHALL perform no capability-ownership evaluation and keep the ownership gate's output unchanged. — capability: **capability-ownership.judge** (C).
- **FR-002** (event): WHEN the policy is advisory or hard, the **capability-ownership** (E) core in **capability-ownership-lib.mjs** (S) SHALL require, for each owned capability key, that its entity segment — the token before the first dot, compared after trimming and lowercasing — be among the spec's own owned entity keys, reporting each violation with the spec id, capability, and entity segment.
- **FR-003** (unwanted): IF violations exist, THEN THE SYSTEM SHALL warn and exit zero under advisory, and SHALL exit non-zero under hard.
- **FR-004** (unwanted): IF the policy value is outside off|advisory|hard, THEN THE SYSTEM SHALL report it and exit non-zero.
- **FR-005** (unwanted): IF the policy is not off but the configured ownership categories cannot support the judgment — no entity-like or no capability-like category — THEN THE SYSTEM SHALL yield each missing-category reason so the consuming gate can surface the inert policy instead of passing silently.

### Key Entities
- **capability ownership** — the rule that a capability key belongs to the spec owning its entity segment: spec boundaries are entity-based, so verbs never spawn specs and engines never own foreign capabilities.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: capability-ownership
- **Symbols**: capability-ownership-lib.mjs
- **Artifacts**: —
- **Capabilities**: capability-ownership.judge
- **Files**: tooling/capability-ownership-lib.mjs, tooling/__tests__/capability-ownership.test.mjs

## Dependencies (참조 — dedup 제외)
> ownership 게이트 본체·키 정규화·verb 형식은 SPEC-002/001 소유(이 spec은 귀속 판정 코어만), 참조 entity의 관계 문법은 SPEC-017, Python 복제는 SPEC-006.
- **Modules**: spec-quality-gates (references), key-pipeline (references), entity-relations (references), runtime-parity (references)

---

## Success Criteria (측정형)
- **SC-001**: `capability-ownership.test.mjs` 전 케이스 green + 귀속 판정 출력·exit의 Node↔Python 바이트 동일(패리티 테스트 green). [검증: tooling/__tests__/capability-ownership.test.mjs]
- **SC-002**: budget-engine 픽스처(Entities 0 + capability 4)에서 위반 4건 전부 지목·hard exit 1(실측 재현 — 도입 검증에서 양판 바이트 동일 확인). [검증: tooling/__tests__/capability-ownership.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열 정규화·집합 대조만의 순수 함수라 결정적으로 단위 테스트되고, 파일 IO는 소비 게이트(check-ownership)가 수행. [검증: tooling/__tests__/capability-ownership.test.mjs]

## Assumptions / Clarifications Retained
- "이 스펙이 정말 그 aggregate인가"(소유 선언으로 해소할지 이관할지)는 리뷰 몫 — 게이트는 귀속 신호만 강제한다.
- 교차-aggregate 기능(여러 테이블을 읽는 검색·리포트)은 주 변경/산출 대상 aggregate의 스펙에 귀속한다 — 라우팅 트리의 "어느 aggregate를 변경하는가" 기준과 동일(별도 예외 없음).

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-20 | 셀프리뷰(순수 코어 TDD·게이트 e2e·Node↔Python 바이트 패리티·budget-engine 픽스처 실측 재현) + owner 모델 확정("entity 키 동일=같은 스펙, verb는 FR 신설, 참조는 relation") → Active | FR-001~004 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-20 이웃 SPEC-002(spec-quality-gates): 비중복 — ownership 게이트 본체·dedup·verb 형식은 SPEC-002/001 소유, 이 spec은 capability↔entity 귀속 판정 코어만 소유(소비는 SPEC-002 게이트).
- 2026-07-20 이웃 SPEC-017(entity-relations): 비중복 — SPEC-017은 Dependencies "참조"의 실재·순환, 이 spec은 Ownership "소유"의 귀속 — 방향이 반대(참조 검증 vs 소유 검증).
- 2026-07-20 이웃 SPEC-023(fr-key-anchors): 비중복 — SPEC-023은 FR 본문 표기(bold↔키), 이 spec은 Ownership 블록 내 카테고리 간 정합(capability↔entity).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 지원 계층 출구를 `ownershipRequiredPolicy`까지 확장 — `supportLayerSpecs` 등록 + Files 선언이면 Ownership 요구 충족(매 실행 표면화) | 실측 제보 ④: 세 hard 규칙이 맞물려 **출구가 없는 상태**가 나왔다. `supportLayerSpecs`는 cohesion의 `entity(min)`만 면제했고 Ownership 요구는 그대로라, 무상태 근거 주입 계층의 분리 스펙을 실제로 작성했다가 롤백해야 했다. 남은 선택지가 (a) advisory 방치 (b) 억지 TypedDict로 entity 세우기뿐이었고 **둘 다 방법론이 경계하는 것**이다. 킷 규범대로 캡을 풀지 않고 **막힌 출구를 열었다** — Files 선언이 있으면 dedup 사각이 아니라는 사실(G3가 판정한다)이 근거이고, 그래서 이 출구는 강제를 약화시키지 않는다. 범위: 이 판정은 저장소 안 Files 글롭이 실재할 때 성립하며, 레포 밖 실체만 가진 계층은 여전히 키 선언이 필요하다 [검증: tooling/__tests__/check-ownership.test.mjs] |
| 2026-07-20 | 초안 — `capabilityOwnershipPolicy`(off\|advisory\|hard, 기본 advisory) + `capability-ownership-lib`(귀속 판정) + ownership 게이트 배선, Node·Python 패리티. METHODOLOGY "Dependencies의 entity여도 무방" 탈출구 문장 개정 동반 | 소비 프로젝트 실측(budget-engine — Entities 0개+capability 4개, owner 판정: "이 스펙은 생성되면 안 되는 것"): 스펙 경계=entity 기준에 기계 신호가 없어 기술 계층 스펙이 태어남. 픽스처 재현에서 위반 4건 전부 지목·양판 바이트 동일 확인 |
| 2026-07-27 | FR-005 신설(`capabilityInertReasons` — 정책 on + 카테고리 불일치 사유) + FR-001 개정(off만 무판정) + Edge Case "inert는 침묵하지 않는다", Node·Python 패리티 | 감사 이슈 #21 A-1 실측: 카테고리를 `Entities`→`Aggregates`로 개명하면 `capabilityOwnershipPolicy: hard`가 완전 no-op이 되고 스킵 신호가 한 줄도 없어 유령 entity가 `✓ 구조적 중복 없음` exit 0으로 통과. SPEC-026 FR-005가 *개별 면제*를 부채로 표면화하는 것과 동형으로 *정책 전체의 inert*도 표면화 — 정당한 inert는 명시적 `off`가 탈출구 |
| 2026-07-27 | `capabilityCheckActive`·`capabilityInertReasons`가 카테고리 배열 대신 역할(`{entity,surface,capability}`)을 받는다 | SPEC-001 FR-010 동반: 이름 추측 제거 — 카테고리를 개명해도 선언이 있으면 판정이 유지된다 |
| 2026-07-27 | 킷 자신은 `capabilityOwnershipPolicy` **advisory 유지**(명시적 off로 내리지 않음) | 킷 카테고리엔 capability 역할이 없어 inert지만, off로 내리면 SPEC-027 래칫이 강도 하향으로 정당하게 차단한다(도그푸딩 발견). 매 실행 출력되는 inert 사유 한 줄이 곧 표면화이므로 침묵시킬 이유가 없다 — "정당한 inert는 명시적 off"라는 서술과 래칫의 단조성이 충돌하는 지점은 별도 과제로 이관 |
| 2026-07-27 | FR 키 앵커 완성 — 소유 키 2건을 FR 선언 라인에 볼드+마커로 앵커 | SPEC-001 FR-010(역할 선언) 도입으로 킷 자신에게 SPEC-023 FR-005/007이 처음 발화 — 익명 주어 THE SYSTEM을 실제 수행 모듈/심볼로 바꿔 앵커 삽입(FR 의미·소유 불변) |
| 2026-07-28 | `capability-ownership.test.mjs` 픽스처 복사 목록에 `key-anchor-lib.mjs` 추가 | SPEC-013 FR-008 동반: `grammar-lib.mjs`의 새 import를 픽스처도 복사해야 게이트가 실행된다(배선만, 판정 불변) |
| 2026-07-28 | `capability-ownership.test.mjs` 픽스처 lib 목록에 `ownership-reality-lib.mjs` 추가 | `check-ownership.mjs`가 새 lib을 임포트하게 되어 이 테스트의 임시 픽스처가 모듈 해석에 실패했다 — 판정 내용 무변경, 픽스처 배선만 |
| 2026-07-28 | `capabilityOwnershipPolicy` off→**hard** 승격. 킷 30개 스펙이 `<슬러그>.<verb>` capability를 소유하게 되어 판정이 처음 발화한다 — 귀속 위반 0건 | capability entity가 곧 그 스펙의 모듈 키(=파일명 슬러그, SPEC-029 ①)이므로 귀속이 구조적으로 성립한다. 미판정 가드 1종 → 0종 |
| 2026-07-28 | Edge Case 신설 — 이관 처방과 cohesion 상한이 반대로 당길 때의 **순서**(대상 분할 선행 → 이관) | 소비 프로젝트 PM이 면제 4건을 처방대로 이관하려다 멈췄고, 그 정지 판단이 옳았다: 대상 스펙이 169 FR로 이미 상한을 4배 넘어 이관하면 228 FR이 된다. 킷에 두 규범의 우선순위 명문이 없어 실행자가 판단할 근거가 없었다(METHODOLOGY 입도 언급 0건 — 실측). 정확성(entity 경계)이 먼저지만 대상의 상한 초과는 선행 위반이라는 순서를 명문화했다 |
| 2026-07-28 | Edge Case 보강 — 분할의 선행 조건에 **FR 앵커 밀도**를 추가(실제 순서는 3단: 앵커 → 분할 → 이관) | 직전 항목이 "대상 분할 선행"까지만 말해 실행자가 곧바로 분할을 시도할 수 있었다. PM SPEC-004 실측: aggregate 경계는 명확한데(6 root·capability 10/4/3/3/2/1) FR 169개 중 **124개가 앵커 없음**이라 FR 귀속 근거가 스펙에 없다 — SPEC-023 FR-007이 "키당 최소 1회"만 요구하므로 정당한 통과다. 앵커 밀도를 먼저 올리지 않으면 실행자가 124개 FR의 귀속을 추정하게 되고 그것은 스펙 경계를 대신 결정하는 것이다 |
| 2026-07-28 | **표면 스펙(surface-only spec)을 정당한 종류로 명명** — `Surfaces`만 소유하고 `Entities`·`Capabilities`를 두지 않는 스펙. 판정 로직·강도 무변경(FR-002가 이미 공허 통과) | owner 지시: "판정 불가한 건 방법론을 수정해서라도 업데이트해야지". 실측(PM SPEC-004): 판정 불가 52건 중 **37건**이 어느 aggregate에도 붙지 않는 화면·파이프라인·draft·표현 FR인데, 그 집이 방법론에 **이름이 없어서** 실행자가 귀속 불가로 남길 수밖에 없었다. 금지 대상은 entity 없는 **capability**(남의 aggregate 위 능력 주장)이고 entity 없는 **surface**는 아니다 — capability는 주장이라 aggregate 귀속이 필요하고 surface는 위치라 필요 없다. 선례는 이미 실재했다(PM SPEC-010·SPEC-014·TEST-001) — 규범만 없었다 |
| 2026-07-28 | Edge Case 신설 — 분할 실행의 두 함정(앵커 승계·캐시 컬럼 판정). 그리고 `METHODOLOGY.md`의 3단 순서 주장을 **실행 결과로 정정**(앵커 밀도는 선행 조건이 아니다) | PM SPEC-004 분할 11조각 완주 실측. ① 앵커 밀도는 올릴 수 **없었다**(118건 중 문장에 선언 키를 지닌 것이 4건) — 그런데도 분할이 성공했고 귀속 근거는 앵커가 아니라 **FR 전수 판독**이 제공했다. 즉 초판이 선행 조건이라 적은 것이 실제로는 보조 신호였다. ② aggregate 축으로 51%가 갈라지지 않아 화면·파이프라인 축을 병용했다(aggregate 스펙 5 + 표면 스펙 5 + 외부 이관 11). ③ 조각 단위 원자 커밋이 회귀 2건을 즉시 잡았다. 결과: SPEC-004 FR 169→92 · aggregate root 6→**1** · cohesion 경고 11→10 · 총 FR 590·`unaccounted:0` 전 구간 보존 |
