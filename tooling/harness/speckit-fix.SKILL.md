---
name: speckit-fix
description: 버그픽스를 SDD 경로로 — 재현 테스트(RED)→스펙 착지(FR 또는 Edge Cases+Change Log)→GREEN→게이트. 코드부터 고치고 싶은 hotfix일수록 이 스킬로.
---

# /speckit.fix — 버그픽스 SDD 경로 (§7)

버그는 기능 루프(0~8)가 아니라 이 경로로. **어느 쪽이든 스펙을 반드시 건드린다** — check-spec-sync(commit-msg hard)가 이를 강제하므로, 이 스킬이 정공법이다.

## 절차
1. **재현 실패 테스트 작성** (Superpowers TDD RED). `@covers <SPEC-ID>/FR-NNN` 태그 유지.
2. **스펙 영향 판정** — 소유 스펙은 `Ownership.Files` glob으로 확인:
   - **FR이 바뀌는 버그**(동작 계약 수정) → 소유 스펙 FR 개정/추가.
   - **순수 구현 버그**(계약 불변) → 소유 스펙 `### Edge Cases`에 재현 조건 1줄 + `## Change Log`에 행 추가(`| YYYY-MM-DD | <무엇> | <왜/커밋> |`).
3. **GREEN** — 최소 수정으로 테스트 통과.
4. **게이트**: `node scripts/check-fr-coverage.mjs` · `check-ownership.mjs` · `check-spec-sync.mjs`(commit-msg가 자동 실행) 통과.
5. **사람 승인** 후 머지.

## 탈출구 (정직)
- 진짜 스펙 무관(포맷팅·주석)이면 커밋 메시지 트레일러 `Spec-Impact: none <사유>` — 사유 필수, 커밋에 영속.
- 급한 hotfix도 2번의 Edge Cases+Change Log 두 줄이면 게이트를 정공으로 통과한다 — 트레일러 남용 금지.
