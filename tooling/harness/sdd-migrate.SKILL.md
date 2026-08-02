---
name: sdd-migrate
description: SDD 스펙 마이그레이션 실행기 — /sdd-update가 표면화한 백로그(capability 귀속·FR 키 앵커·entity 입도)를 실제 스펙 재구성으로 실행. 특히 entity 재구성(유령 entity·aggregate root)과 키 앵커(bold) 정합. 스펙 편집은 스펙별 원자 커밋 + 사람 승인 관문. update=목록, migrate=실행.
---
# /sdd-migrate — 백로그를 실제 스펙 재구성으로 실행

**update와의 차이(핵심):** `/sdd-update`는 마이그레이션 백로그를 **표면화만** 한다(불변 규칙상 스펙 불변) — 그래서 반복해도 목록이 똑같다. 이 스킬은 그 백로그를 **실제 스펙 재구성으로 실행**한다. update = 목록, migrate = 실행. 정본 절차: `prompts/migrate.md`(clean machine엔 raw: `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/prompts/migrate.md`, 정본 `<ref>`=`main`; 로컬 키트면 `<KIT>/prompts/migrate.md`).

## 인자
- `<project-path>` (선택): 대상 프로젝트 루트. 없으면 현재 디렉토리.
- `<methodology-url>` (선택): 기본 `https://github.com/lhs6395-hslee/ai-methodology`.

## 무엇을 고치나 (특히 entity·bold)
- **Capability 귀속(SPEC-024)** — `entity.verb`의 entity가 소유/참조 아님(유령 entity·기술 계층 스펙).
- **FR 키 앵커(SPEC-023)** — FR 라인의 평문 **bold**가 키 아님(필드명·파일경로·강조어를 굵게).
- **Entity 입도(SPEC-017)** — aggregate root 초과 소유 → root 1 + 나머지 `Name (relation-type)`.

## 절차 (정본 `prompts/migrate.md`)
1. **백로그 수집** — 게이트 스윕(`node scripts/sdd-sync.mjs` 등). 표면화 knob이 `off`면 먼저 `advisory`로 켜고 재수집.
2. **triage** — 각 위반을 A(약칭 개명)/B(교차 aggregate — 소유 스펙 이관 vs 이 스펙이 Entities 소유 선언; `Dependencies` 참조는 해소 아님)/C(유령 entity 재구성), 키 앵커는 수사적 강등/키 승격, 입도는 root+관계로 분류하고 제안 후보를 붙인다.
3. **승인 관문(HALT)** — 스펙별 제안을 제시하고 **승인 후에만** 편집. 판단 항목(유령 entity의 테이블/UI 여부·root 선정·B의 이관 vs 소유 선언)은 **추정 금지, 물어본다**(도메인 사실 창작 금지).
3b. **완화를 선택지로 내밀지 않는다.** 게이트 위반의 해소안을 제시할 때 강도 하향(`hard→advisory`)·수치 임계 상향(`maxFRsPerSpec` 등)·면제 목록 추가를 **권장안으로 올리지 않는다** — 그건 위반을 없앤 게 아니라 자를 바꿔 잰 것이다. 정당한 해소는 **분할·병합·스펙 편집**이고, 진짜 재조정이 필요하면 `policyRatchetExceptions`로 부채를 표면화한다(래칫이 강도·임계 양쪽을 감시하므로 조용한 완화는 어차피 exit 1이다).
3c. **방향 전환이면 기각 이유를 남긴다** — 옛 구성을 지우는 마이그레이션(예: 서버리스→프로비저닝)은 본문에서 흔적을 지우되 `## Assumptions / Clarifications Retained`에 **무엇을 왜 기각했나 + 재검토 조건**을 남긴다. Change Log는 사건이라 밀려 내려가고, 상시 유효한 제약은 그 절에서만 계속 읽힌다.
4. **적용** — 승인 항목만, **한 스펙 = 한 커밋**(빅뱅 금지), Change Log 행 동반(spec-first), 게이트 재실행 확인. 프로덕션 코드는 안 건드림(코드 변경 필요 시 `/speckit.fix`).
5. **루프 → 승격** — 백로그 빌 때까지 반복(미승인은 advisory로 보존·재표면화). 0 되면 `frKeyAnchorPolicy`·`capabilityOwnershipPolicy`를 `hard`로 승격 제안.

## 불변
- **자동 덮어쓰기 금지, 스펙 확정은 사람 승인** — 무인 재작성 금지.
- **도메인 사실 창작 금지** — 무엇이 실제 테이블인가·어느 Entity가 root인가는 물어서 결정.
- **한 스펙 = 한 커밋**(spec-first, Change Log 동반). 미승인 백로그는 advisory로 보존.
