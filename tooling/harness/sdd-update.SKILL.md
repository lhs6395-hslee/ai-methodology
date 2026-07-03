---
name: sdd-update
description: SDD 평상시 동기화 — /sdd-sync(+필요시 /speckit.fix)를 감싸 코드↔스펙 드리프트를 표면화하고 게이트 green을 유지. 스펙 확정은 사람 승인. 방법론 도구 자체 최신화는 prompts/update.md 경로.
---
# /sdd-update — 평상시 spec↔code 동기화

**두 가지 "업데이트"를 구분한다:**
- **(A) 코드↔스펙 sync** — 일상 드리프트 정렬. 이 스킬이 `/sdd-sync` 흐름을 감싼다(기본).
- **(B) 방법론 도구 최신화** — 게이트·훅·템플릿을 GitHub 정본으로. 정본 절차 `prompts/update.md`를 그대로 실행. **clean machine(clone 불필요)엔 raw로 읽어 실행**: `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/prompts/update.md`(정본 `<ref>`=`main`; 특정 브랜치 검증 시 그 브랜치 ref); 로컬 키트가 있으면 `<KIT>/prompts/update.md`(캐시 위치 관례 `~/Documents/claude/sdd`)도 동일. 키트 최신화는 `git pull`(있으면)/partial+sparse(없으면)로 — 전체 clone 아님.

## 인자
- `<project-path>` (선택): 대상 프로젝트 루트. 없으면 현재 디렉토리.
- `<methodology-url>` (선택): 기본 `https://github.com/lhs6395-hslee/ai-methodology`.

## 절차 (A — 코드↔스펙 sync)
1. **Detect.** `/sdd-sync` 실행(`node scripts/sdd-sync.mjs` 집계) → R1(미구현 FR)·R2(drift·고아표면)·R3(중복·과대 spec) 리포트.
2. **규칙별 사람 확인.** 발견이 있는 규칙마다 사람에게 질문 — **자동 진행 금지**. 버그성 드리프트(코드가 spec보다 앞섬)는 `/speckit.fix`(RED 재현 → 스펙 착지 → GREEN → 게이트).
3. **정렬·재검증.** 승인 후에만 스펙 갱신/코드 생성. 게이트를 재실행해 green을 확인한다.

## 절차 (B — 방법론 도구 최신화)
→ `prompts/update.md` 그대로 실행: 키트 `git pull` → 프로젝트 설치물(`scripts/*.mjs`·`.git/hooks`·`.claude/skills`·`sdd/templates`) diff → **승인 후에만** 반영(자동 덮어쓰기 금지) → 게이트 green 확인.

## 불변
- **자동 덮어쓰기 금지, 스펙 확정은 사람 승인.**
- 사용자 스펙·FR·작업물(`sdd/specs/*`)은 (B)에서도 건드리지 않는다 — 최신화 대상은 방법론 도구(게이트·훅·템플릿)뿐.
