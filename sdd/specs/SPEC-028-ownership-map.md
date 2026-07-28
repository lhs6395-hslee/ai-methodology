# Feature Specification: Ownership Map (소유 키별 보증 상태의 가시화)

**Module**: `sdd-tooling`  **Spec**: `SPEC-028`  **Created**: 2026-07-27  **Status**: Active
**Input**: owner 실측 문제: "gitlab에서 ownership key에서 엔티티와 각각의 키들의 게런티가 잘되어있는지 확인이 너무 힘드네." 스펙의 `## Ownership` 블록은 키 이름만 나열하고, 그 키가 유일성 검증을 받았는지·구조 SSOT에 실재하는지·표면이 코드에 있는지·FR에 앵커됐는지 페이지에 아무 표시가 없다. 게이트는 요약 한 줄만 내므로 **초록이 "전부 검증됨"으로 읽히지만**, 실제로는 가드 여럿이 inert(정책 off·소스 없음·역할 미해석)인 채 조용히 통과한다 — 실측: 킷 자신의 소유 키 94건 중 79건이 실재 미판정, 그 상태로 요약은 clean. 이것이 "방법론의 신뢰가 떨어진다"는 owner 판단의 직접 근거였다. 이 spec은 소유 키를 **키 단위 보증 표**로 생성해, `미판정`을 키마다 드러낸다.

---

## User Scenarios & Testing

### User Story 1 — 키를 보면 무엇이 보증됐는지 보인다 (P1)
생성기가 소유 선언을 읽어 키별 표를 만든다 — 키·소유 스펙·유일성·FR 앵커·실재. 각 칸은 `✓`(그 가드가 실제로 판정해 통과), `✗`(위반), `면제 — 사유`, 또는 **`미판정`**(그 가드가 이 레포에서 발화하지 않음)이다. 표 위에는 가드 포스처 표와 미판정 가드 수 경고가 붙는다. 산출물은 마크다운이라 GitLab/GitHub이 그대로 렌더한다.
- **Independent Test**: `ownership-map.test.mjs`가 픽스처 레포(가드 조합별)로 생성 결과의 칸 값·집계·포스처 표를 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a repo whose `entitySchemaBackingPolicy` is off, **When** the map is generated, **Then** every entity key's reality cell reads the unjudged marker rather than a pass mark, and the posture table names that guard as unjudged with its reason.

### User Story 2 — 맵이 게이트와 갈라지지 않는다 (P1)
판정은 새로 만들지 않고 게이트의 판정 코어(`schemaBackingFindings`·`capabilityOwnershipFindings`·`unanchoredOwnedKeyFindings`·`normalizeKey`)를 그대로 재사용한다. 그래서 같은 입력에 같은 답이 나오고, 리포트 전용 로직이 진실을 왜곡할 수 없다. `--check`는 파일을 쓰지 않고 최신인지만 검사해 손작성 인덱스처럼 낡는 것을 막는다.
- **Independent Test**: 같은 픽스처에서 맵의 위반 집계와 해당 게이트의 위반 수가 일치함을 검증.
- **Acceptance (GWT)**: 1. **Given** a spec that owns a key absent from the structural SSOT, **When** both the ownership gate and the map run, **Then** the map's violation count for that role equals the gate's.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 역할이 해석되지 않은 카테고리(킷 `Artifacts` 등)의 키도 표에 싣되 역할별 절이 아니라 "역할 없는 카테고리 키"로 모으고, 역할 의존 칸은 `—`로 둔다 — 누락이 아니라 판정 대상 밖임을 표기.
- 유일성은 정책 knob이 없어 항상 발화한다 — 같은 키를 둘 이상이 소유하면 소유 스펙을 함께 적어 어느 스펙끼리 겹치는지 페이지에서 바로 보인다.
- 면제(`entitySchemaExemptEntities`)는 `✓`가 아니라 `면제 — 사유`로 구분한다 — 면제를 통과로 읽으면 "수십 건 면제 위의 hard = 거짓 완료"가 다시 숨는다.
- `--check`는 생성 결과와 파일이 바이트 동일한지만 본다 — 드리프트면 exit 1로 재생성을 요구하고, 파일이 아예 없어도 드리프트다.
- 스키마 소스 글롭은 레포 전 파일 순회로 매칭하므로 `ignoreDirs`를 존중한다 — 빌드 산출물의 타입 선언이 실재 집합을 오염시키지 않게.
- 생성물이므로 직접 편집 금지를 파일 머리에 적는다 — 손작성 `MODULE_MAP.md`가 드리프트한 실측을 되풀이하지 않게.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN the **ownership-map** (E) generator **gen-ownership-map.mjs** (S) runs, THE SYSTEM SHALL read every spec's owned declaration for the configured categories and emit one markdown row per owned key carrying the key, its owning spec, and one cell per guard. — capability: **ownership-map.generate** (C).
- **FR-002** (event): WHEN a guard does not fire in this repo — policy off, adapter sources empty, role unresolved, or globs unset — THE SYSTEM SHALL render that guard's cells as an explicit unjudged marker rather than a pass mark, and SHALL list the guard in a posture table together with the reason reported by that guard's own inert-reason core.
- **FR-003** (event): WHEN one or more guards are unjudged, THE SYSTEM SHALL emit a warning line above the key tables stating how many guards are unjudged and naming them, so a reader cannot mistake a green summary for full verification.
- **FR-004** (event): WHEN an owned entity is permitted by the exemption registry, THE SYSTEM SHALL render its reality cell as an exemption carrying the recorded reason, distinct from a pass mark.
- **FR-005** (ubiquitous): THE SYSTEM SHALL derive every verdict by calling the same judgment cores the gates call, performing no independent evaluation of its own, so the map and the gates cannot disagree.
- **FR-006** (event): WHEN invoked with the check flag, THE SYSTEM SHALL write nothing and instead compare the generated text with the file on disk, exiting non-zero when they differ or the file is absent, naming the regeneration command.
- **FR-007** (ubiquitous): THE SYSTEM SHALL take category names, roles, policies, and adapter sources entirely from config so the same generator serves data-backed products, tooling repos whose categories carry no capability role, and pipelines alike.

### Key Entities
- **ownership map** — the generated per-key guarantee table: for each owned key, which guard actually judged it and with what verdict, plus the repo's guard posture and the unjudged count.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: ownership-map
- **Symbols**: gen-ownership-map.mjs
- **Artifacts**: sdd/OWNERSHIP_MAP.md
- **Capabilities**: ownership-map.generate
- **Files**: tooling/gen-ownership-map.mjs, tooling/__tests__/ownership-map.test.mjs, sdd/OWNERSHIP_MAP.md

## Dependencies (참조 — dedup 제외)
> 판정 코어는 각 소유 스펙이 제공하고 이 spec은 조립·표기만 한다.
- **Modules**: key-pipeline (references), spec-quality-gates (references), fr-key-anchors (references), capability-ownership (references), entity-schema-backing (references), spec-sync (references)

---

## Success Criteria (측정형)
- **SC-001**: `ownership-map.test.mjs` 전 케이스 green + 맵의 역할별 위반 집계가 같은 픽스처에서 해당 게이트의 위반 수와 100% 일치.
- **SC-002**: 킷 자신·데이터 백킹 소비 프로젝트·미판정 가드가 섞인 소비 프로젝트 세 형태에서 생성이 성공하고, 각 레포의 가드 포스처가 그 레포 config와 일치한다(실측 대조).

## Non-Functional Requirements
- **NFR-001**: 생성은 읽기 전용 판정과 텍스트 조립뿐이라 결정적이며(같은 입력 → 바이트 동일 출력), `--check`가 그 결정성 위에서 드리프트를 판정한다.

## Assumptions / Clarifications Retained
- 맵은 게이트를 **대체하지 않는다** — 차단은 게이트가, 가시화는 맵이 한다. 맵이 위반을 보여도 exit는 0이다(`--check`의 드리프트 판정만 예외).
- 표면 실재는 orphan-surface 게이트가 역방향(코드→선언)만 보므로 맵의 surface 실재 칸은 "그 게이트가 발화하는가"까지만 말한다 — 키 단위 정방향 실재 판정은 아직 방법론에 없다(감사 #21 M-2, ROADMAP 보류 항목).
- 킷 자신의 entity(모듈명)에는 DB 스키마 같은 구조 SSOT 계층이 없다 — SPEC-026이 데이터 스키마 세계를 전제하므로, 구조 SSOT가 없는 레포는 정책을 off로 두는 것이 정당하다. 다만 그 off가 **사유 없이** 조용하면 맵에서 미판정 79건이 근거 없이 남는다 — 사유 기록 규범은 별도 항목으로 이관.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-27 | 셀프리뷰(픽스처 단위 + 킷·finops·PM 3레포 실측 생성 + 게이트 집계 일치 대조) + owner 확정("게런티 확인이 너무 힘들다" → 키 단위 가시화) → Active | FR-001~007 unit 커버 |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-07-27 이웃 SPEC-002(spec-quality-gates): 비중복 — SPEC-002는 위반을 **차단**하는 게이트군, 이 spec은 판정 결과를 **가시화**하는 생성물. 판정 코어를 공유하되 차단은 하지 않는다(맵 exit 0).
- 2026-07-27 이웃 SPEC-009(derivation-accounting): 비중복 — SPEC-009는 재도출 소스 클래스의 회계(무엇으로부터 스펙을 뽑았나), 이 spec은 소유 키의 보증 상태(무엇이 그 키를 검증했나) — 축이 다르다.
- 2026-07-27 이웃 SPEC-010(smoke-scan): 비중복 — SPEC-010은 검증 태그↔매니페스트 드리프트(FR 검증 회계), 이 spec은 Ownership 키↔가드 판정. 둘 다 "생성·드리프트 검사" 패턴을 쓰지만 대상이 FR vs 소유 키로 다르다.
- 2026-07-27 이웃 `MODULE_MAP.md`(SPEC 없음, 템플릿): 비중복 — MODULE_MAP은 손작성 **스펙 인덱스**(모듈 정체성·spec 목록), 이 맵은 생성 **키 보증 표**. 손작성 인덱스가 드리프트한 실측이 이 spec을 생성물로 만든 이유다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-27 | 초안 — `gen-ownership-map.mjs`(키별 보증 표 + 가드 포스처 + 미판정 경고 + `--check` 드리프트) + `sdd/OWNERSHIP_MAP.md` 산출. 판정은 기존 게이트 코어 재사용(독자 판정 금지) | owner: "gitlab에서 ownership key의 게런티 확인이 너무 힘들다" + "방법론의 신뢰가 떨어지고 있는 상태". 실측 근거: 킷 소유 키 94건 중 79건이 실재 미판정인데 게이트 요약은 clean — 초록이 검증을 뜻하지 않는다는 사실이 페이지에 드러나지 않았다 |
| 2026-07-28 | 배포 배선 — `sdd-init` Node 복사 목록에 편입(설치 목록은 SPEC-004 소유; 여기엔 판정 근거만 기록) | 생성기가 킷에만 있어 소비 프로젝트가 맵을 못 받던 배포 누락. 채택 판정: 이 spec의 Artifacts가 소비 프로젝트 경로 산출물(`sdd/OWNERSHIP_MAP.md`)이고 동인이 owner의 실측 문제(GitLab 키 보증 확인) → **킷 내부 도그푸딩 전용이 아니라 소비 프로젝트 산출물**. finops 라운드가 이 판정을 절차 없이 브리핑에서 추론해야 했던 공백은 `prompts/update.md` 4단계에 판정 규칙으로 규범화 |
| 2026-07-28 | 엔트리 판정을 realpath 비교(`isMainEntry`)로 | SPEC-021과 동일 결함 — 비-ASCII 경로에서 생성·`--check` 모두 무음 미실행이라 맵 드리프트가 조용히 통과했다(보증 가시화 자체가 무력화되는 자리) |
| 2026-07-28 | 맵의 surface 실재 칸을 심볼 문법 판정으로 교체(정방향 살아 있으면 키 단위 `✓`/`✗`, 역방향만이면 그 사실을 명시, 둘 다 없으면 `미판정`) + entity 칸에 모듈 문법 반영. 가드 포스처의 surface 행이 두 방향을 함께 판정 | 종전에는 `surfaceGlobs`만 보고 살아 있으면 전 키를 일괄 `✓(orphan 게이트)`로 적었다 — 키 단위로는 아무것도 판정하지 않았는데 통과 표시가 나갔다. SPEC-029 FR-006. 실재 미판정 칸 79→0 |
