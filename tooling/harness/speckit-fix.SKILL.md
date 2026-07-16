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
4b. **테스트 스위트 실행 확인** — 위 게이트는 커버리지 태그 회계일 뿐 **스위트를 실행하지 않는다**(커버리지 green ≠ 실행 green). 완료를 주장하기 전 프로젝트가 선언한 `commands.test`를 실제로 실행해 **green(또는 문서화된 skip)** 임을 확인한다: `node scripts/check-test-run.mjs`(또는 `python3 scripts/sdd_gates.py testrun`) — `runTestsPolicy`가 켜져 있으면 실행·판정, off면 수동 실행. env-gated 테스트는 의존성 부재 시 error가 아니라 사유 포함 skip이라 결과가 error 0으로 명확해야 한다.
5. **사람 승인** 후 머지.
6. **원점 트래커 close-out** — 작업이 tracked issue에서 유래했고 `trackerCloseout`(config/CLAUDE.md)이 설정됐으면:
   - ① 원점 트래커 항목을 **dev-done**으로 표시한다. 리포터의 최종 sign-off(confirm)는 **건드리지 않는다**(2인 책임분리: dev-done → reporter-confirmed).
   - ② 이해관계자에게 **완료 보고** 전송 — 무엇을·왜·어떻게 고쳤는지 + 검증 경로. 이 보고가 리포터의 최종 수용 테스트를 트리거한다.
   - ③ 리포터/QA가 최종 검증 후 **confirmed**로 마감(개발자 몫 아님).
   - 트래커 정체·보고 채널은 `trackerCloseout`에서 인스턴스화(하드코딩 금지). 외부 시스템·사람 sign-off라 게이트가 강제하지 않는다 — 완료의 규범이므로 사람이 수행한다.

## 탈출구 (정직)
- 진짜 스펙 무관(포맷팅·주석)이면 커밋 메시지 트레일러 `Spec-Impact: none <사유>` — 사유 필수, 커밋에 영속.
- 급한 hotfix도 2번의 Edge Cases+Change Log 두 줄이면 게이트를 정공으로 통과한다 — 트레일러 남용 금지.
