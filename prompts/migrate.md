# SDD 스펙 마이그레이션 실행 (백로그 → 실제 재구성) — 이 파일 하나로 실행

> **한 줄 사용법:** 대화창에 `이 프로젝트 스펙 마이그레이션 해줘` 또는 설치돼 있으면 `/sdd-migrate`.
> **대상:** 이미 채택된 프로젝트로, `/sdd-update`(또는 raw `prompts/update.md`)가 **마이그레이션 백로그를 표면화한** 상태.
> **update와의 차이(핵심):** `update`는 백로그를 **표면화만** 한다(스펙 불변) — 그래서 아무리 반복해도 목록이 똑같다. 이 절차는 그 백로그를 **실제 스펙 재구성으로 실행**한다(사람 승인 관문 경유). update = 목록, migrate = 실행.

**정본:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw로 받았다면 그 `<ref>`를, 로컬 키트면 `main`을 REF로 쓴다.

## 무엇을 고치나 (백로그 3종 — 특히 entity·bold)
1. **Capability 귀속(SPEC-024) + entity 실재(SPEC-026)** — `entity.verb`의 entity 조각이 그 스펙의 소유 entity(또는 `## Dependencies` 참조)가 아님(SPEC-024), 또는 소유 entity가 구조 SSOT(스키마)에 실재하지 않는 **유령 entity**(SPEC-026 — 지어낸 개념 `wizard`·`project_list`에 capability를 얹어 귀속을 우회). "entity 없이 capability만 소유하는 기술 계층 스펙"도 여기.
2. **FR 키 앵커(SPEC-023)** — FR 라인의 평문 **bold**가 소유·참조 키가 아님(수사적 강조·필드명·파일경로를 굵게 침), 또는 entity 앵커에 `(E)` 마커 누락·비-entity에 `(E)` 오부착(FR-005).
3. **Entity 입도(SPEC-005 cohesion·SPEC-017 관계)** — 한 스펙이 aggregate root(Entities)를 `maxAggregateRootsPerSpec` 초과 소유 → root 1개 + 나머지는 `Dependencies`의 `Name (relation-type)`로.

## 실행 순서
1. **백로그 수집.** 게이트 스윕을 돌려(`node scripts/sdd-sync.mjs`, 또는 `check-ownership`·`check-spec-consistency`·`check-spec-cohesion` 개별) 위 3종 advisory를 스펙별로 모은다. **전제:** 표면화 knob(`frKeyAnchorPolicy`·`capabilityOwnershipPolicy`)이 `advisory` 이상이어야 백로그가 나온다 — `off`면 먼저 `advisory`로 켜고(update.md 4단계) 재수집.
2. **스펙별 triage — 각 위반에 제안 후보를 붙인다:**
   | 유형 | 버킷 | 제안 |
   |---|---|---|
   | Capability | **A 약칭 불일치** | 명사가 소유/참조 entity의 스키마명과 유사(`budget`↔`pjt_budgets`) → capability를 스키마 키로 개명 |
   | Capability | **B 교차 aggregate** | 명사가 *다른 스펙*이 소유한 entity → 그 FR을 소유 스펙으로 이관, 또는 `## Dependencies`에 `Name (references)` 선언 |
   | Capability | **C 유령 entity** | 명사가 어느 스펙에도 없거나 스키마에 실재 안 함(`wizard`·`project_list` 등 — SPEC-026 스키마 백킹이 검출) → **원인별 해소(면제 남용 금지)**: (1) UI/흐름 개념(FR이 실 테이블 조작)이면 **Surface 강등 + capability를 실 entity(`pjt_projects.<verb>`)로 재키** — 이게 대다수, (2) 인프라·proto entity면 **그 구조 SSOT(terraform·`.proto`)를 `entitySchemaSources`에 소스 추가**(면제 아님), (3) 실 외부 aggregate(외부 API 자원 등)만 `entitySchemaExemptEntities` 소수 면제. ⚠ 수십 건을 일괄 면제하고 hard 올리는 것은 거짓 완료(실측) — 대량이면 readopt 대상 |
   | 키 앵커 | **수사적** | bold가 필드명·파일경로·강조어 → 평문 또는 백틱(`` `...` ``)으로 강등 |
   | 키 앵커 | **키여야 함** | bold가 실제 소유/참조 키인데 미선언 → Ownership/Dependencies에 선언 |
   | 키 앵커 | **카테고리 마커** | 굵은 키에 종류 마커 누락·불일치 → entity `**x** (E)`·surface/route `**x** (R)`·capability `**x** (C)`로 맞춤(FR-005; 글자는 `frAnchorMarkers`) |
   | 입도 | **분할/관계** | root 1개 선정(독립 생성·삭제 Entity) + 나머지 `Name (relation-type)`로 이동 (또는 root+자식 모델이면 `maxAggregateRootsPerSpec` 상향을 사유와 함께) |
3. **승인 관문 (HALT — 자동 확정 금지).** 스펙별 제안을 사람에게 제시하고 **승인을 받은 뒤에만** 편집한다. 특히 판단 항목(C 유령 entity의 테이블/UI 여부, aggregate root 선정, B의 이관 vs 참조)은 **추정하지 말고 물어본다** — 도메인 사실(무엇이 실제 테이블인가)을 창작하지 않는다.
4. **적용 (스펙별 원자 커밋 — 빅뱅 금지).** 승인 항목만 편집하고 각 스펙에 Change Log 행(근거 포함)을 동반한다(spec-first). 한 스펙 = 한 커밋. 편집 후 게이트를 재실행해 그 스펙이 clean(또는 남은 게 advisory)임을 확인한다. 프로덕션 코드는 이 절차가 건드리지 않는다(코드 변경이 필요하면 `/speckit.fix` 별도 경로).
5. **루프.** 백로그가 빌 때까지 스펙별로 반복. 미승인 항목은 그대로 advisory로 남아 다음 update/migrate에 재표면화된다(조용한 소실 없음).
6. **hard 승격 권장(종착지).** 백로그가 0이 되면 `frKeyAnchorPolicy`·`capabilityOwnershipPolicy`(및 해당되는 다른 강도 knob)를 **`hard`로 승격하기를 권장**하고 사용자 승인 시 반영한다 — advisory는 경유지일 뿐 종착지가 아니다. hard로 올려야 재발(장식 bold·유령 capability·entity 없는 스펙)이 커밋 시점에 차단된다. 미승격 시 사유를 남긴다(다음 라운드 재권장).

## 불변 규칙
- **스펙 편집·프로덕션 코드 변경은 기록된 사람 승인 없이 하지 않는다** — 무인 자동 재작성 금지(작성=LLM·확정=사람).
- **도메인 사실을 창작하지 않는다** — "이 명사가 실제 테이블인가", "어느 Entity가 root인가"는 물어서 결정.
- **한 스펙 = 한 커밋**(빅뱅 재작성 금지) — 각 편집은 spec-first(Change Log 동반).
- 미승인 백로그는 advisory로 보존 — 다음 라운드에 재표면화(소실 없음).
