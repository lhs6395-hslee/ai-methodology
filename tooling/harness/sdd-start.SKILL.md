---
name: sdd-start
description: SDD 최초 채택 — 깨끗한 프로젝트에 sdd-init로 강제 배선 후 현 코드를 reverse-engineer해 EARS FR 스펙 초안을 만들고 승인 게이트에서 멈춘다. 아직 sdd/가 없을 때.
---
# /sdd-start — SDD 최초 채택 (작성=LLM · 확정=사람)

**정본 절차(SSOT):** `prompts/adopt.md` 를 **그대로 실행**한다 — 절차 원본은 그 파일 한 곳(중복 저장 안 함). **clean machine(clone 불필요)엔 `<methodology-url>` raw로 읽어 실행**: `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/prompts/adopt.md`(정본 `<ref>`=`main`; 특정 브랜치 검증 시 그 브랜치 ref). 로컬 키트가 있으면 `<KIT>/prompts/adopt.md`(캐시 위치 관례 `~/Documents/claude/sdd`)도 동일. 게이트·훅용 tooling은 그 절차가 partial+sparse로 확보한다(전체 clone 아님). 아래는 그 요약 + 고정 규칙(가드레일) — **원본과 충돌 시 원본 우선**.

## 인자
- `<project-path>` (선택): 대상 프로젝트 루트. 없으면 현재 디렉토리.
- `<methodology-url>` (선택): 정본 방법론 URL. 기본 `https://github.com/lhs6395-hslee/ai-methodology`.

## 선행 판별
- 대상에 이미 `sdd/`가 있으면 **중단** → `/sdd-readopt`(완전 재채택)로 안내한다. 이 스킬은 SDD가 없던 프로젝트 전용.

## 절차 (prompts/adopt.md 요약)
1. **방법론 읽기(다운로드 불필요).** 키트/URL의 `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md` 정독. "된다"는 실행 증거로만, `[검증]/[추론]/[미확인]` 구분.
2. **강제 배선(1회).** 대상 루트에서 `sh <KIT>/tooling/sdd-init.sh --gate=node`(키트가 로컬에 없으면 `prompts/adopt.md` 절차대로 partial+sparse로 tooling만 확보 후 실행 — 전체 clone 불필요) → `sdd/` 레이아웃·게이트(~25파일)·git 훅(pre-commit·commit-msg)·SessionStart/PreToolUse·스킬 설치.
3. **config 맞춤.** `sdd.config.json`(scanDirs·testFileRegex·commands·specIdPrefixes·ownershipCategories)을 이 프로젝트 언어로(프리셋: `tooling/sdd.config.presets.md`).
4. **reverse-engineer 초안.** 현 코드를 읽어 EARS FR 스펙 **초안**을 도출한다 → `sdd/specs/`에만, PREFIX=SPEC/INFRA/TEST, 1 spec=1 aggregate.
5. **⛔ 승인 게이트에서 멈춤.** 초안을 사람에게 제시하고 **확정을 기다린다**. 승인 전에는 대량 생성·확정·덮어쓰기 금지.
6. **승인 후 결선.** `@covers` 태깅 → 게이트 green → 커밋(자기 훅 통과).

## 고정 규칙 (발명 금지)
- spec은 `sdd/specs/`에만. PREFIX=SPEC/INFRA/TEST(표준 밖 접두어는 사유+승인 후 `sdd.config.json`의 `specIdPrefixes`+`prefixRationale`에 등록).
- 1 spec = 1 aggregate. 소유 코드 변경엔 **같은 changeset에 소유 spec 변경**을 동반한다.
- **작성=LLM, 확정=사람.** 승인 없이 스펙 확정·덮어쓰기 금지 — 여기서 멈추는 것이 이 스킬의 핵심 계약이다.
