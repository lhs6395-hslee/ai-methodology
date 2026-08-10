# Feature Specification: Spec Conflict Audit (명세 코퍼스가 스스로와 정합한가)

**Module**: `sdd-tooling`  **Spec**: `SPEC-052`  **Created**: 2026-08-10  **Status**: Active
**Input**: 오너 지시(2026-08-10) — "명세가 충돌되는 것도 없도록 방법론이 잘 구성이 되어야 한다는거야. 예를 들면 spec 1은 A를 해라 spec 2는 A를 하지말아라 애초에 이런 구멍도 없어야한다는거고, 동일한 기능에 1은 A를 해라 2는 B를 해라 이런식으로 되면 안된다는거야." 실측 제보(같은 날, gsn-ai-pm-management-tool): 에이전트가 배포 실패 원인을 조사하며 ArgoCD sync 실패를 원인으로 단정해 보고했는데, 그 문자열은 이미 `INFRA-004` Edge Case에 있었고 같은 문서 273행에 소유자 결정("배포는 GitOps가 힘드니 젠킨스에서 바로 배포한다")과 그에 따른 요구 신설이 기록돼 있었으며 48행에는 "ArgoCD sync가 멈춰 있어도 Jenkins가 직접 적용한다"까지 있었다. 소유자는 여러 세션에 걸쳐 "ArgoCD 쓰지 마라"를 지시했는데 **재발했다.** 진짜 원인은 다른 곳(스냅샷 누락 → migrate Job 실패 → 배포 스테이지 스킵)이었다. 명세 안에 서로 반대 방향을 가리키는 지시가 공존하면 **급할 때 에이전트는 자기가 먼저 본 쪽을 따른다.**

---

## User Scenarios & Testing

### User Story 1 — 같은 대상에 상반된 지시가 공존하면 둘 다 게이트를 통과한다 (P1)
개별 스펙이 각자 문법·소유·커버리지 판정을 통과해도 코퍼스 전체는 모순일 수 있다. 기존 축은 전부 **한 스펙 안** 또는 **스펙↔코드** 관계를 보고, 스펙↔스펙의 지시 방향은 아무 축도 보지 않았다.
- **Independent Test**: `spec-conflict.test.mjs`가 순수 코어(지시 추출·절 경계·토큰화·포함 판정·희귀도)와 게이트 차단을 단독 검증. [검증: tooling/__tests__/spec-conflict.test.mjs]
- **Acceptance (GWT)**: 1. **Given** two specs whose directives share a target with opposite polarity, **When** the gate runs, **Then** it blocks showing both directives side by side.

### User Story 2 — 게이트는 어느 쪽이 정본인지 정하지 않는다 (P1)
모순의 해소는 "어느 지시가 살아남는가"의 결정이고 그건 소유자의 판단이다. 게이트가 추정으로 한쪽을 고르면 그 추정이 다음 모순의 씨앗이 된다.
- **Independent Test**: 같은 테스트가 출력이 두 지시를 나란히 보여주고 결정을 요구함을 검증. [검증: tooling/__tests__/spec-conflict.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a detected conflict, **When** the finding is formatted, **Then** it names both sides and states that the gate does not choose.

### User Story 3 — 오탐이 나면 이 축은 즉시 꺼진다 (P1)
"오탐이 잦은 게이트는 꺼진다"는 이 킷의 반복 실측이다. 그래서 도입 **전에** 킷 코퍼스로 재고, 세 번 조정했다.
- **Independent Test**: 같은 테스트가 다른 목적어·같은 방향·1토큰 술어·흔한 술어 각 갈래를 후보 0건으로 확인하고, 킷 코퍼스 전수에서 0건임을 단언. [검증: tooling/__tests__/spec-conflict.test.mjs]
- **Acceptance (GWT)**: 1. **Given** two directives sharing only corpus-common tokens, **When** the gate runs, **Then** it reports no conflict.

### User Story 4 — 감사는 감시와 다른 층이고, 감사자는 감시 대상이 될 수 없다 (P1)
감시 게이트·감시 에이전트는 "대화 세션 에이전트가 명세대로 하는가"를 본다. 감사는 "명세 코퍼스가 스스로와 정합한가"를 본다. 급할 때 명세를 무시하는 에이전트에게 감사를 겸하게 하면 그 점검이 가장 먼저 생략된다 — 고발 장치가 고발 대상의 협조를 요구하면 그것은 강제가 아니다.
- **Independent Test**: 같은 테스트가 게이트가 별도 실행으로 차단함을 검증하고, 스윕 R20 등재로 우회 불가한 채널(CI)에 실린다. [검증: tooling/__tests__/spec-conflict.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a conflicting corpus, **When** the sweep runs, **Then** R20 reports it independently of any agent's cooperation.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **한 줄에 여러 지시가 온다** — `SHALL X … and SHALL NOT Y`는 두 지시다. 하나로 읽으면 정당한 범위 분리가 모순으로 잡힌다.
- **술어는 절 경계에서 끊는다** — 실측 오탐: 술어가 뒤 절(`; WHERE the command exit…`)까지 삼켜 무관한 두 지시가 겹쳤다.
- **고정 길이 술어 머리 비교는 짧은 술어를 통째로 건너뛴다** — `SHALL NOT use ArgoCD.`는 2토큰이라 K=3에서 판정 대상 밖이었다(회수 구멍). **포함 관계**로 판정한다.
- **흔한 술어끼리의 겹침은 후보가 아니다** — `report it as a violation`은 여러 스펙의 공통 표현이라 주어가 달라도 겹친다(실측 오탐: 면제 글롭 판정 vs 래칫 판정). 어휘 목록을 박지 않고 **말뭉치 희귀도**로 가른다 — 목록이 아니라 통계라 자기교정적이다.
- **1토큰 술어는 판정하지 않는다** — 겹침이 신호가 되지 못한다.
- **문서빈도는 스펙 단위로 센다** — 한 스펙이 같은 말을 여러 번 써도 1이다(그러지 않으면 반복 서술이 희귀도를 왜곡한다).
- **한 스펙 내 모순과 교차 스펙 모순을 합치지 않는다** — 전자는 그 스펙의 편집, 후자는 어느 쪽이 정본인지의 결정이다. 해소 방법이 다르면 다른 사실이다.
- **SHALL 지시가 0건이면 판정하지 않는다** — EARS 극성이 없는 코퍼스에서 0건은 '깨끗함'이 아니라 '볼 것이 없음'이다. 어휘가 다르면 `specConflictNegationMarkers`를 갈아끼운다 — 면제가 아니라 어휘 교체다.
- **의미 충돌은 이 축이 판정하지 않는다** — "동일 기능에 1은 A, 2는 B"는 확률적 판정이고 이 킷은 확률적 판정에 차단력을 주지 않는다. 그 층은 쌍을 **기계가 전수 열거**하고 사람·LLM이 판정한다(SPEC-033과 같은 분업 — 전수성은 열거기가 보장한다).
- **면제 경로가 없다** — 해소는 어느 지시가 정본인지 결정해 한쪽을 고치는 것뿐이다. 면제를 두면 모순이 "완료"로 남는다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN a requirement declaration line is read, the **spec-conflict** (E) core in **spec-conflict-lib.mjs** (S) SHALL extract every directive on that line with its polarity, and SHALL truncate each predicate at the first clause boundary so that a following clause is never absorbed into an unrelated directive. — capability: **spec-conflict.audit** (C).
- **FR-002** (event): WHEN two directives of opposite polarity are compared, the core SHALL treat them as conflicting only when one predicate's content tokens are contained in the other's and the shared tokens include at least one token appearing in no more than the configured number of specs, so that predicates common across the corpus do not pair on subject-independent wording.
- **FR-003** (unwanted): IF conflicting directives are found, THEN **check-spec-conflict.mjs** (S) SHALL report intra-spec and cross-spec conflicts as separate counts, SHALL present both directives without selecting a canonical one, and SHALL block at strict strength; IF no spec or no polarity-bearing directive exists, THEN it SHALL declare itself inert rather than reporting zero violations.
- **FR-004** (state): WHILE the audit runs as its own execution wired into the sweep, it SHALL NOT depend on the audited agent's cooperation, and its semantic counterpart SHALL remain non-blocking at any strength.

### Key Entities
- **spec-conflict** — the state of a specification corpus being consistent with itself, as distinct from each spec being individually well-formed, so that two documents cannot point an agent in opposite directions while both pass every other gate.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: spec-conflict
- **Symbols**: spec-conflict-lib.mjs, check-spec-conflict.mjs
- **Artifacts**: —
- **Capabilities**: spec-conflict.audit
- **Files**: tooling/spec-conflict-lib.mjs, tooling/check-spec-conflict.mjs, tooling/__tests__/spec-conflict.test.mjs

## Dependencies (참조 — dedup 제외)
> FR 선언 라인 문법은 SPEC-023 소유, 스윕 등재는 SPEC-004, 판정 종류 어휘는 SPEC-040, 확률적 층의 열거·판정 분업 선례는 SPEC-033, Python 복제는 SPEC-006 소유.
- **Modules**: fr-key-anchors (references), harness-install (references), gate-verdict (references), entity-synonym (references)
- **Symbols**: key-anchor-lib.mjs, sdd-sync.mjs

---

## Success Criteria (측정형)
- **SC-001**: `spec-conflict.test.mjs` 전 케이스 green — 지시 추출 4·판정 양성 3·오탐 억제 4·정본 미선택 1·킷 자기적용 1·게이트 5. [검증: tooling/__tests__/spec-conflict.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다(10 시나리오). [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 도입 전 킷 코퍼스 측정에서 지시 441건 대조 **오탐 0건**이고 양성 대조(긴 술어·짧은 술어)가 2/2 발화했다 — 오탐이 이 축의 사망 원인이므로 도입 순서를 측정 우선으로 잡았다. [검증: tooling/__tests__/spec-conflict.test.mjs]
- **SC-004**: 킷 자기적용에서 교차 스펙 모순 0건·한 스펙 내 모순 0건이다. [검증: tooling/__tests__/spec-conflict.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·집합 대조만의 순수 함수이고 스펙 읽기는 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/spec-conflict.test.mjs]

## Assumptions / Clarifications Retained
- 감사는 **감시와 다른 층**이다. 감시 게이트(R1~R19)·감시 에이전트(R19가 배선을 보장하는 층)는 에이전트의 수행을 보고, 감사(R20)는 명세 코퍼스를 본다. 그리고 감사를 감시 에이전트에 겸하게 하지 않은 이유는 순환이다 — 급할 때 명세를 무시하는 에이전트가 감사자가 되면 그 점검이 가장 먼저 생략된다.
- 감사의 **주기**: 스펙을 건드린 changeset(스윕이 커밋·푸시·CI에서 돈다)이 1차 발화 지점이다. 모순은 스펙이 편집될 때 태어나므로 그 순간이 가장 값싸다.
- **기각한 대안:** 의미 충돌까지 한 게이트에서 차단하는 방식. "동일 기능에 1은 A, 2는 B"는 확률적 판정이고 여기에 차단력을 주면 오탐이 커밋을 막아 사람이 정책을 끈다(R10 ③층에서 이미 확립된 경계). 열거는 기계·판정은 사람이라는 분업을 유지한다. 재검토 조건: 없음.
- **기각한 대안:** 고정 길이 술어 머리(앞 K토큰) 비교. 짧은 술어가 판정 대상에서 통째로 빠지는 회수 구멍이 있었고(`SHALL NOT use ArgoCD.`), 그 구멍은 조용하다. 포함 관계가 두 방향을 함께 덮는다. 재검토 조건: 없음.
- **기각한 대안:** 흔한 술어를 어휘 목록(stopword 확장)으로 걸러내는 방식. 목록은 프로젝트마다 다르고 목록 밖 표현에서 오탐이 되살아난다 — **말뭉치 희귀도**는 그 코퍼스에서 스스로 계산되므로 프로젝트가 바뀌어도 따라온다. 재검토 조건: 희귀도가 통하지 않는 코퍼스(스펙 수가 극히 적어 모든 토큰이 희귀)가 나오면 `specConflictMaxDocFreq`로 조정한다.
- **기각한 대안:** 게이트가 어느 지시를 정본으로 골라 자동 수정하는 방식. 판정 게이트가 판정 대상을 고치면 언제나 초록이고, 추정으로 고른 정본이 다음 모순의 씨앗이 된다. 재검토 조건: 없음.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(도입 전 킷 코퍼스 측정 3회 반복 조정 → 오탐 0·양성 대조 2/2 → 코어 TDD 13종 + 게이트 5종 + 양판 패리티 10시나리오) + 오너 지시(명세 충돌 구멍 제거) → Active | FR-001~004 unit 커버. 킷 자기적용: 스펙 52건·지시 441건 대조 모순 0건 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-002(spec-quality-gates): 비중복 — 002는 **한 스펙의 품질**(입도·완전성·일관성)을 보고 052는 **스펙 사이의 지시 방향**을 본다. 052가 잡는 모순은 두 스펙이 각각 002를 통과한 상태에서 성립한다.
- 2026-08-10 이웃 SPEC-033(entity-synonym): 비중복 — 033은 같은 것을 **다르게 부르는가**(이름 층), 052는 같은 것에 **반대를 지시하는가**(방향 층)다. 확률적 층의 열거·판정 분업 설계는 033에서 그대로 가져왔다.
- 2026-08-10 이웃 SPEC-020(cross-spec-change): 비중복 — 020은 공유 표면 변경의 **동인 추적**, 052는 코퍼스의 **내용 모순**이다. 020은 왜 바뀌었는지, 052는 무엇이 서로 어긋났는지다.
- 2026-08-10 이웃 SPEC-018(spec-retirement): 비중복 — 018은 폐기된 요구의 **정리**, 052는 살아 있는 요구끼리의 충돌이다. 다만 052가 낸 모순의 정당한 해소가 018(한쪽 폐기)일 수 있다.
- 2026-08-10 이웃 SPEC-051(agent-wiring): 비중복 — 051은 **감시**(에이전트가 명세대로 하는가)의 배선, 052는 **감사**(명세가 정합한가)다. 오너가 셋으로 정리한 구조에서 051은 감시 층, 052는 감사 층이고, 감사자가 감시 대상이 될 수 없다는 것이 두 스펙을 나눈 이유다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `spec-conflict-lib`(지시 추출·절 경계 절단·내용 토큰화·포함 판정·말뭉치 희귀도) + `check-spec-conflict` + `specConflictPolicy` 외 5 knob + 스윕 R20 등재 + 배포 목록·래칫 편입, 양판 | 오너 지시: "spec 1은 A를 해라, spec 2는 A를 하지 말아라 — 애초에 이런 구멍도 없어야 한다." 실측: 명세 안에 반대 방향 지시가 공존한 탓에 소유자가 여러 세션에 걸쳐 금지한 경로가 재발했고, 에이전트는 명세에 답이 있는데 읽지 않고 실측으로 다시 찾아 결론까지 틀렸다. 이 축은 **감사의 결정적 절반**만 차단한다 — 의미 충돌은 확률적이라 차단력을 주지 않고 열거·판정 분업으로 남긴다(SPEC-033 선례). 도입 순서를 측정 우선으로 잡았다: 킷 코퍼스로 재며 세 번 조정했고 ①고정 길이 술어 머리 비교의 회수 구멍(짧은 술어 스킵) ②술어가 뒤 절을 삼키는 오탐 ③흔한 술어의 주어-무관 겹침을 각각 포함 관계·절 경계·말뭉치 희귀도로 닫아 **오탐 0·양성 대조 2/2**에 도달했다. 희귀도를 쓴 이유: 어휘 목록은 프로젝트마다 다르고 목록 밖에서 오탐이 되살아나는데 통계는 그 코퍼스에서 스스로 계산된다. 게이트가 정본을 고르지 않는 이유: 추정으로 고른 정본이 다음 모순의 씨앗이 된다 [검증: tooling/__tests__/spec-conflict.test.mjs] |
