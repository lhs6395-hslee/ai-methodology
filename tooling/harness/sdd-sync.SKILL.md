---
name: sdd-sync
description: SDD 하네스 — spec↔code 일치를 인터랙티브로 점검·정렬. spec/코드 변경 후 또는 수시로 sync를 맞출 때 사용.
---
# /sdd-sync — SDD 인터랙티브 sync

`HARNESS.md` 계약(규칙표)을 실행한다. **탐지는 게이트, 결정은 사람, 작성은 LLM.**

## 절차
1. **Detect:** `node scripts/sdd-sync.mjs --json` 실행 → 결정적 리포트(스키마 v1: `clean`·`flaggedRules`·`rules[].{id,title,flagged,gates[].{gate,flagged,summary}}`)를 파싱해 규칙별 상태 확보. **텍스트 스크래핑 금지** — 라우팅은 안정 rule id(R1/R2/R3)로. (사람용 요약이 필요하면 `--json` 없이 재실행.)
2. **요약:** `flaggedRules`를 사람에게 한눈에 제시(R1 미구현 FR / R2 drift·고아표면 / R3 중복·과대 spec).
3. **규칙별 의사 확인** (발견 있는 규칙마다 사람에게 질문 — 절대 자동 진행 금지):
   - **R1** → "이 FR들 코드 생성/업데이트할까요?" 예 → `superpowers:test-driven-development`로 RED→GREEN 구현.
   - **R2** → "기존 spec 개정 / 새 spec / 의도적 무시?" → `/speckit.converge`로 갭 표면화 → **사람이 intent 한 줄 입력** → `/speckit.specify`(update·new)로 `코드 diff + intent` 기반 작성 → `/speckit.analyze` 정합 → **사람 bless**.
   - **R3** → "중복 spec 통합 / 과대 spec 분할?" → 통합 또는 capability별 분할(`STRUCTURE.md` 입도 규칙).
4. **재검증:** `node scripts/sdd-sync.mjs` 재실행 — clean이거나 사람이 멈출 때까지 반복.

## 불변
- **자동 덮어쓰기 금지** — 각 act 전에 사람 승인 게이트.
- Spec Kit 명령(`/speckit.*`) 미설치면 수동 절차 안내(`APPLYING.md` §1).
