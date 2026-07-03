---
name: sdd-readopt
description: SDD 완전 재채택 — 안전망 태그 후 sdd-init --force 재배선, 구 sdd/specs 정리(코드 무변경), 현 코드 reverse-engineer로 스펙 초안 재도출→승인 게이트 멈춤. 이미 sdd/가 있는데 낡거나 어긋났을 때.
---
# /sdd-readopt — 완전 재채택 (코드 보존 · 확정=사람)

**정본 절차(SSOT):** `prompts/readopt.md` 를 **그대로 실행**한다. **clean machine(clone 불필요)엔 `<methodology-url>` raw로 읽어 실행**: `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/prompts/readopt.md`(정본 `<ref>`=`main`; 특정 브랜치 검증 시 그 브랜치 ref). 로컬 키트가 있으면 `<KIT>/prompts/readopt.md`(캐시 위치 관례 `~/Documents/claude/sdd`)도 동일. tooling은 그 절차가 partial+sparse로 확보한다. 아래는 요약 + 고정 규칙 — **원본과 충돌 시 원본 우선**.

## 인자
- `<project-path>` (선택): 대상 프로젝트 루트. 없으면 현재 디렉토리.
- `<methodology-url>` (선택): 기본 `https://github.com/lhs6395-hslee/ai-methodology`.

## 절차 (prompts/readopt.md 요약)
1. **⚑ 안전망(필수).** `git add -A && git commit` 후 `git tag sdd-pre-readopt-<YYYY-MM-DD 오늘날짜>` 로 현재 상태를 스냅샷한다 — 손실 0, 언제든 태그로 복구. **이 단계 없이 다음으로 진행하지 않는다.**
2. **방법론 읽기.** `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md` 정독. `[검증]/[추론]/[미확인]` 구분.
3. **강제 재배선.** 대상 루트에서 `sh <KIT>/tooling/sdd-init.sh --gate=node --force`(키트가 로컬에 없으면 `prompts/readopt.md` 절차대로 partial+sparse로 tooling 확보 후 실행 — 전체 clone 불필요, 최신 도구로 덮어씀).
4. **config 맞춤.** `sdd.config.json`을 이 프로젝트 언어로(프리셋: `tooling/sdd.config.presets.md`).
5. **구 산출물 정리.** 기존 `sdd/specs/*`를 걷어낸다 — **프로덕션 코드는 그대로**, 1단계 안전망 태그에 스냅샷 보존.
6. **스펙 재도출(초안).** 현 코드 실태를 reverse-engineer해 EARS FR 스펙 **초안**을 새로 만든다. `sdd/specs/`에만, PREFIX=SPEC/INFRA/TEST, 1 spec=1 aggregate.
7. **⛔ 승인 게이트에서 멈춤.** 초안을 제시하고 확정을 기다린다.
8. **승인 후 결선.** `@covers` 태깅 → 게이트 green → 커밋.

## 고정 규칙
- **코드 무변경.** 재채택은 `sdd/` 산출물만 새로 세운다 — 프로덕션 코드/테스트는 건드리지 않는다.
- 승인 없이 스펙을 확정하거나, "코드에 맞춘다"며 스펙/코드를 덮어쓰지 않는다.
- 나머지는 `/sdd-start` 고정 규칙과 동일(sdd/specs·PREFIX·1 aggregate·작성=LLM/확정=사람).
