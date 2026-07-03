# SDD 재채택 (완전 재시작) — 이 파일 하나로 실행

> **한 줄 사용법:** `~/Documents/claude/sdd/prompts/readopt.md 를 그대로 수행해줘`. 에이전트는 아래를 순서대로, 추측 없이 실행한다.
> **대상:** 이미 `sdd/` 산출물이 있는데(스펙·게이트가 낡거나 어긋남) 현 방법론으로 **처음부터 다시** 세울 때. **코드는 남기고 `sdd/` 산출물만 새로.** (PM/FinOps 등.)

**정본 방법론:** https://github.com/lhs6395-hslee/ai-methodology · 로컬 키트: `~/Documents/claude/sdd`

## 실행 순서
1. **안전망(필수).** `git add -A && git commit` 후 `git tag sdd-pre-readopt-<오늘날짜>`로 현재 상태를 스냅샷한다 — 진짜 손실 0, 언제든 태그로 복구.
2. **방법론 읽기.** 키트(`~/Documents/claude/sdd`, 없으면 clone 1회)의 `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md` 정독. `[검증]/[추론]/[미확인]` 구분.
3. **강제 배선.** 프로젝트 루트에서 `sh ~/Documents/claude/sdd/tooling/sdd-init.sh --gate=node --force` (최신 도구로 덮어씀).
4. **config 맞춤.** `sdd.config.json`을 이 프로젝트 언어로(프리셋: `tooling/sdd.config.presets.md`).
5. **구 산출물 정리.** 기존 `sdd/specs/*`를 걷어낸다 — 코드는 그대로, 1단계 스냅샷 태그에 남아 있음.
6. **스펙 재도출.** 현재 코드 실태를 읽어 EARS FR 스펙을 새로 도출한다(reverse-engineer). spec은 `sdd/specs/`에만, PREFIX는 SPEC/INFRA/TEST, 1 spec=1 aggregate. **초안을 만들되 대량 생성·확정은 사용자 승인 후.**
7. **결선.** `@covers` 태깅 → 게이트 green → 커밋(자기 훅 통과).

## 고정 규칙
- [`adopt.md`](adopt.md)의 고정 규칙과 동일.
- 사용자 승인 없이 스펙을 확정하거나, "코드에 맞춘다"며 스펙/코드를 덮어쓰지 않는다.
