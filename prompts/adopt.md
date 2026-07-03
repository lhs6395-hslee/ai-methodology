# SDD 시작 (최초 채택) — 이 파일 하나로 실행

> **한 줄 사용법:** 대화창에서 `~/Documents/claude/sdd/prompts/adopt.md 를 그대로 수행해줘` (또는 GitHub raw URL 지정). 에이전트는 아래를 순서대로, 추측 없이 실행한다.
> **대상:** SDD를 아직 안 쓰던 새 프로젝트. 이미 `sdd/`가 있으면 [`readopt.md`](readopt.md)를 써라.

**정본 방법론:** https://github.com/lhs6395-hslee/ai-methodology · 로컬 키트: `~/Documents/claude/sdd`

## 실행 순서
1. **방법론 읽기(다운로드 불필요).** 키트의 `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md`를 정독한다. 키트가 로컬에 없으면 `git clone https://github.com/lhs6395-hslee/ai-methodology ~/Documents/claude/sdd` 1회. "된다"는 실제 실행 증거로만 말하고 `[검증]/[추론]/[미확인]`으로 구분한다.
2. **강제 배선(1회).** 이 프로젝트 루트에서 `sh ~/Documents/claude/sdd/tooling/sdd-init.sh --gate=node` 실행 → `sdd/` 레이아웃 · 게이트(~25파일) · git 훅(`pre-commit`·`commit-msg`) · SessionStart/PreToolUse · 스킬 설치. (언어 무관 — 게이트는 node 런타임만 쓰고 언어차는 `sdd.config.json`으로 흡수.)
3. **config 맞춤.** `sdd.config.json`의 `scanDirs`·`testFileRegex`·`commands`·`specIdPrefixes`·`ownershipCategories`를 이 프로젝트 언어로 맞춘다(프리셋: `tooling/sdd.config.presets.md`).
4. **확인.** 세션 재시작(SessionStart가 방법론 주입) 후 게이트를 돌려 green 확인.

여기까지는 **설치·배선까지만**. 스펙 대량 생성은 사용자 승인 후.

## 고정 규칙 (발명 금지)
- spec은 `sdd/specs/`에만 둔다.
- PREFIX는 **SPEC/INFRA/TEST**. 새 PREFIX가 필요하면 사유와 함께 사용자 승인 후 `sdd.config.json`의 `specIdPrefixes`에 등록.
- **1 spec = 1 aggregate.**
- 소유 코드 변경엔 **같은 changeset에 소유 spec 변경을 동반**한다(순수 hotfix만 커밋 트레일러 `Spec-Impact: none <사유>`).
- 작성=LLM, 승인=사용자. 스펙 확정은 사용자 승인 후.
