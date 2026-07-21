# Feature Specification: Spec Migration Executor (/sdd-migrate)

**Module**: `sdd-tooling`  **Spec**: `SPEC-025`  **Created**: 2026-07-21  **Status**: Active
**Input**: 실측(소비 프로젝트 AI PM): `/sdd-update`가 마이그레이션 백로그를 표면화해도 **스펙은 불변**이라(불변 규칙), 사용자가 update를 반복해도 "목록이 똑같다"만 반복되고 실제 재구성은 일어나지 않았다. 백로그를 **실제 스펙 재구성으로 실행**하는 별도 실행기가 없었다 — update(read-only 표면화)와 분리된 `/sdd-migrate`(승인 경유 편집)를 설치형 스킬로 정의한다. 특히 entity 재구성(capability 귀속·유령 entity·aggregate root)과 FR 키 앵커(bold) 정합을 다룬다.

---

## User Scenarios & Testing

### User Story 1 — 백로그를 실제 재구성으로 실행 (P1)
`/sdd-migrate`는 게이트 스윕으로 열린 백로그(capability 귀속·키 앵커·entity 입도)를 수집해 스펙별로 triage(약칭 개명 / 교차 aggregate / 유령 entity, 수사적 bold / 키 승격, root+관계)하고, 제안을 사람에게 제시한 뒤 **승인 항목만** 스펙별 원자 커밋으로 적용한다. update가 목록이면 migrate는 실행이다.
- **Independent Test**: `migrate-skill.test.mjs`가 스킬·정본 절차 파일의 존재·frontmatter·불변식 문구(승인 관문·한 스펙 한 커밋·update와의 차이·entity/bold 처리)를 검증.
- **Acceptance (GWT)**: 1. **Given** an adopted project with an open capability-ownership/key-anchor/cohesion backlog, **When** `/sdd-migrate` runs, **Then** it collects and triages the backlog and halts at a human-approval gate before editing any spec.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 표면화 knob(`frKeyAnchorPolicy`·`capabilityOwnershipPolicy`)이 `off`면 백로그가 비어 나온다 — 먼저 `advisory`로 켜고 재수집(update.md 4단계와 동일 전제).
- 유령 entity가 실제 테이블인지(→Entities 선언) UI/흐름 개념인지(→Surface 강등)는 도메인 사실이라 창작하지 않고 사용자에게 물어 결정한다.
- 미승인 백로그 항목은 그대로 advisory로 남아 다음 update/migrate에 재표면화된다(조용한 소실 없음).
- 빅뱅 재작성 금지 — 한 스펙 = 한 커밋(각 편집 spec-first, Change Log 동반). 여러 스펙을 한 커밋에 묶지 않는다.
- 프로덕션 코드는 이 절차가 편집하지 않는다 — 코드 변경이 필요하면 `/speckit.fix` 별도 경로.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN `/sdd-migrate` runs, THE SYSTEM SHALL collect the open migration backlog by running the gate sweep and triage each violation — capability-ownership (rename / cross-aggregate / ghost-entity), key-anchor (rhetorical demotion / key promotion), and cohesion (aggregate-root + relation) — attaching a proposed fix.
- **FR-002** (event): WHEN a spec restructuring proposal is ready, THE SYSTEM SHALL halt at a human-approval gate before editing any spec, and SHALL ask rather than assume for judgment items — whether a noun is a real table, which entity is the aggregate root, and move-versus-reference for cross-aggregate capabilities.
- **FR-003** (event): WHEN the user approves items, THE SYSTEM SHALL apply them as spec-first edits with an accompanying Change Log row, one spec per commit (never a big-bang rewrite), and re-run the gates to confirm.
- **FR-004** (unwanted): IF `/sdd-migrate` would finalize or overwrite a spec or production code without recorded approval, or would invent a domain fact, THEN THE SYSTEM SHALL refuse and wait for approval.
- **FR-005** (state): WHILE backlog items remain unapproved, THE SYSTEM SHALL leave them as advisory so they resurface on the next update/migrate, and SHALL offer to promote `frKeyAnchorPolicy`/`capabilityOwnershipPolicy` to hard only once the backlog is clear.

### Key Entities
- **migration backlog** — the open set of new-syntax advisories (capability-ownership, key-anchor, cohesion/relation) collected from the gate sweep, triaged per spec with a proposed fix.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts). Symbols = 스킬 소스, Artifacts = 설치 산출물.
- **Modules**: spec-migration
- **Symbols**: sdd-migrate.SKILL.md, migrate.md
- **Artifacts**: .claude/skills/sdd-migrate/SKILL.md
- **Files**: tooling/harness/sdd-migrate.SKILL.md, prompts/migrate.md, tooling/__tests__/migrate-skill.test.mjs

## Dependencies (참조 — dedup 제외)
> 백로그를 내는 게이트는 각 소유 스펙 소관(이 spec은 실행 워크플로만): capability 귀속은 SPEC-024, 키 앵커는 SPEC-023, 입도·관계는 SPEC-005(cohesion)·SPEC-017, 표면화는 SPEC-003(sdd-sync)·`/sdd-update`. 스킬 설치기는 SPEC-004.
- **Modules**: capability-ownership (references), fr-key-anchors (references), entity-relations (references), adoption-lifecycle (references), harness-install (references)

---

## Success Criteria (측정형)
- **SC-001**: `migrate-skill.test.mjs` 전 케이스 green — 스킬 frontmatter·정본 절차·불변식(승인 관문·한 스펙 한 커밋·도메인 사실 창작 금지·update와의 차이) 존재 검사.
- **SC-002**: 소비 프로젝트에서 `/sdd-update`(목록) → `/sdd-migrate`(실행)로 백로그가 실제 스펙 재구성으로 소진된다(승인 경유) — "update 반복해도 똑같다"가 해소.

## Non-Functional Requirements
- **NFR-001**: 실행기는 판정 로직을 신규로 만들지 않는다 — 백로그는 기존 게이트(SPEC-023/024/017/cohesion)가 내고, 이 스킬은 triage·승인·적용 오케스트레이션만(런타임 중립, 실행기=에이전트).

## Assumptions / Clarifications Retained
- 마이그레이션의 "옳음"(어느 entity가 root인가·유령 entity 처리)은 리뷰 경계 — 스킬은 결정을 구조화하고 적용할 뿐 도메인 판단을 대신하지 않는다.
- 완전 무인 자동 재작성은 방법론 핵심 원칙(작성=LLM·확정=사람)에 어긋나므로 채택하지 않는다 — 기계적 후보 제시 + 사람 승인 + 적용.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-21 | 셀프리뷰(스킬·정본 절차·테스트 + 게이트 전종 실행) + owner 승인("b로 — /sdd-migrate 실행기, update가 재구성으로 이어져야") → Active | FR-001~005 unit 커버(스킬 계약 테스트) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-21 이웃 SPEC-005(adoption-lifecycle): 비중복 — SPEC-005의 start/readopt/update는 채택·표면화(스펙 read-only), 이 spec은 표면화된 백로그의 **편집 실행**(스펙 재구성). update=목록/migrate=실행으로 관심사가 갈린다.
- 2026-07-21 이웃 SPEC-024(capability-ownership): 비중복 — SPEC-024는 위반 판정 게이트, 이 spec은 그 위반을 해소하는 편집 워크플로(판정 소비).
- 2026-07-21 이웃 SPEC-023(fr-key-anchors): 비중복 — SPEC-023은 bold↔키 대조 게이트, 이 spec은 미매치 bold를 강등/승격하는 편집 워크플로(소비).

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-21 | 초안 — `/sdd-migrate` 실행기 스킬 + 정본 절차 `prompts/migrate.md` + 계약 테스트. update(표면화)와 분리된 백로그 실행(승인 관문·한 스펙 한 커밋). entity 재구성·키 앵커 정합 중심 | 실측(소비 프로젝트): update 반복해도 스펙 불변("똑같다") — 백로그를 실제 재구성으로 실행하는 경로 부재. owner가 (b) 실행기 스킬 선택, "update가 방법론 방식에 따라 스펙 재구성으로 이어져야" |
