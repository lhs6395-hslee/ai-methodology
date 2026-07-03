# SDD 시작 (최초 채택) — 이 파일 하나로 실행

> **한 줄 사용법 (clean machine · clone 불필요):** 대화창에 아래 한 줄을 붙여넣는다. 에이전트가 이 파일을 raw로 읽고 순서대로, 추측 없이 실행한다.
> ```
> https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/feat/lifecycle-commands/prompts/adopt.md 읽고 그대로 수행해줘
> ```
> `feat/lifecycle-commands`는 현재 검증 브랜치 — **main 머지 후 `main`으로 승격**한다. 키트가 로컬에 있으면 `<KIT>/prompts/adopt.md 를 그대로 수행해줘`도 동일하다.
> **대상:** SDD를 아직 안 쓰던 새 프로젝트. 이미 `sdd/`가 있으면 [`readopt.md`](readopt.md)를 써라.

**정본 방법론:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw URL로 받았다면 그 URL의 `<ref>` 세그먼트를 REF로 삼고, 로컬 키트로 실행 중이면 REF=`main`으로 간주한다. 아래 `<ref>`·raw base는 모두 이 REF를 쓴다 — 그래서 브랜치/ main 어느 쪽에서 fetch해도 동일하게 동작하고, 머지 시 문서 수정이 필요 없다.

## 실행 순서
1. **방법론 읽기(다운로드 불필요).** `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md`를 정독한다 — 로컬 키트가 있으면 그 파일을, 없으면 이 파일과 **같은 raw base**(`https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/`)에서 직접 읽는다(clone 불필요). "된다"는 실제 실행 증거로만 말하고 `[검증]/[추론]/[미확인]`으로 구분한다.
2. **강제 배선(1회) — tooling 확보 후 `sdd-init`.** 게이트·훅은 로컬 파일이어야 돌아가므로 **전체 clone 없이** tooling만 확보한다(partial + sparse):
   ```sh
   KIT="${SDD_KIT:-$HOME/Documents/claude/sdd}"           # 로컬 키트 캐시 위치(관례) — 없으면 아래로 생성
   REF="feat/lifecycle-commands"                          # adopt.md를 받은 ref (main 머지 후 main)
   if [ ! -x "$KIT/tooling/sdd-init.sh" ]; then           # 없을 때만: partial+sparse — 전체 clone(526KB) 아님
     git clone --filter=blob:none --sparse --branch "$REF" \
       https://github.com/lhs6395-hslee/ai-methodology "$KIT"
     git -C "$KIT" sparse-checkout set tooling templates prompts
   fi
   sh "$KIT/tooling/sdd-init.sh" --gate=node              # ← 이 프로젝트 루트에서 실행
   ```
   → `sdd/` 레이아웃 · 게이트(~25파일) · git 훅(`pre-commit`·`commit-msg`) · SessionStart/PreToolUse · 스킬 설치. (언어 무관 — 게이트는 node 런타임만 쓰고 언어차는 `sdd.config.json`으로 흡수.)
3. **config 맞춤.** `sdd.config.json`의 `scanDirs`·`testFileRegex`·`commands`·`specIdPrefixes`·`ownershipCategories`를 이 프로젝트 언어로 맞춘다(프리셋: `tooling/sdd.config.presets.md`).
4. **확인.** 세션 재시작(SessionStart가 방법론 주입) 후 게이트를 돌려 green 확인.

여기까지는 **설치·배선까지만**. 스펙 대량 생성은 사용자 승인 후.

## 고정 규칙 (발명 금지)
- spec은 `sdd/specs/`에만 둔다.
- PREFIX는 **SPEC/INFRA/TEST**. 새 PREFIX가 필요하면 사유와 함께 사용자 승인 후 `sdd.config.json`의 `specIdPrefixes`에 등록.
- **1 spec = 1 aggregate.**
- 소유 코드 변경엔 **같은 changeset에 소유 spec 변경을 동반**한다(순수 hotfix만 커밋 트레일러 `Spec-Impact: none <사유>`).
- 작성=LLM, 승인=사용자. 스펙 확정은 사용자 승인 후.
