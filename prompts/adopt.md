# SDD 시작 (최초 채택) — 이 파일 하나로 실행

> **한 줄 사용법 (clean machine · clone 불필요):** 대화창에 아래 한 줄을 붙여넣는다. 에이전트가 이 파일을 raw로 읽고 순서대로, 추측 없이 실행한다.
> ```
> https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/adopt.md 읽고 그대로 수행해줘
> ```
> 위 URL의 정본 ref는 `main`(자기참조 — 특정 브랜치에서 받으면 그 ref를 이어 쓴다). 키트가 로컬에 있으면 `<KIT>/prompts/adopt.md 를 그대로 수행해줘`도 동일하다.
> **대상:** SDD를 아직 안 쓰던 새 프로젝트. 이미 `sdd/`가 있으면 [`readopt.md`](readopt.md)를 써라.

**정본 방법론:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw URL로 받았다면 그 URL의 `<ref>` 세그먼트를 REF로 삼고, 로컬 키트로 실행 중이면 REF=`main`으로 간주한다. 아래 `<ref>`·raw base는 모두 이 REF를 쓴다 — 그래서 브랜치/ main 어느 쪽에서 fetch해도 동일하게 동작하고, 머지 시 문서 수정이 필요 없다.

## 실행 순서
1. **방법론 읽기(다운로드 불필요).** `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md`를 정독한다 — 로컬 키트가 있으면 그 파일을, 없으면 이 파일과 **같은 raw base**(`https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/`)에서 직접 읽는다(clone 불필요). "된다"는 실제 실행 증거로만 말하고 `[검증]/[추론]/[미확인]`으로 구분한다.
2. **강제 배선(1회) — tooling 확보 후 `sdd-init`.** 게이트·훅은 로컬 파일이어야 돌아가므로 **전체 clone 없이** tooling만 확보한다(partial + sparse):
   ```sh
   KIT="${SDD_KIT:-$HOME/Documents/claude/sdd}"           # 로컬 키트 캐시 위치(관례) — 없으면 아래로 생성
   REF="main"                          # adopt.md를 받은 ref (정본 main; 자기참조 — 브랜치에서 받으면 그 ref)
   if [ ! -f "$KIT/tooling/sdd-init.sh" ]; then           # 없을 때만: partial+sparse — 전체 clone(526KB) 아님 (sh로 실행하므로 -f 검사)
     git clone --filter=blob:none --sparse --branch "$REF" \
       https://github.com/lhs6395-hslee/ai-methodology "$KIT"
     git -C "$KIT" sparse-checkout set tooling templates prompts
   fi
   sh "$KIT/tooling/sdd-init.sh" --gate=node              # ← 이 프로젝트 루트에서 실행
   ```
   → `sdd/` 레이아웃 · 게이트(~30파일) · git 훅(`pre-commit`·`commit-msg`) · SessionStart/PreToolUse · 스킬 설치. (언어 무관 — 게이트는 node 런타임만 쓰고 언어차는 `sdd.config.json`으로 흡수.)
3. **config 맞춤.** `sdd.config.json`의 `scanDirs`·`testFileRegex`·`commands`·`specIdPrefixes`·`ownershipCategories`를 이 프로젝트 언어로 맞춘다(프리셋: `tooling/sdd.config.presets.md`).
4. **확인.** 세션 재시작(SessionStart가 방법론 주입) 후 게이트를 돌려 green 확인.

여기까지는 **설치·배선까지만**. 스펙 대량 생성은 사용자 승인 후.

## 에이전트 무관 실행 (Claude Code 외 — Kiro·Codex·기타)
> **슬래시 명령(`/sdd-start`·`/speckit.*`·`/sdd-sync`)과 SessionStart 방법론 주입은 Claude Code 편의 계층일 뿐이다.** 강제(게이트 + git 훅)와 절차(이 `prompts/`)는 **실행기 무관** — 어느 에이전트/무-에이전트에서도 동일하게 돈다(git 훅이 누가 커밋하든 발화). 슬래시를 못 쓰는 환경(Kiro 등)에서 **"슬래시 명령을 못 쓰는데 수동으로 할까요?"라고 되묻지 말고, 같은 절차를 그대로 수동으로 밟아 진행한다** — 그게 정공법이다.
> - **방법론 컨텍스트 상시 주입**이 필요하면(Claude의 SessionStart 대체), 그 에이전트의 상시-로드 문서에 방법론 요약을 넣는다 — Kiro는 `.kiro/steering/sdd.md`, 그 외는 `AGENTS.md`(또는 해당 에이전트의 규칙 파일). 내용은 `tooling/harness/sdd-session-context.sh`의 출력(궤도·진입 규칙) 또는 `HARNESS.md` 규칙표를 옮긴다.
> - **슬래시 ↔ 수동 대응**: `/sdd-start`·`/sdd-readopt`·`/sdd-update`는 각각 `prompts/{adopt,readopt,update}.md` 절차 그대로(SSOT), `/speckit.fix`는 "소유 스펙을 같은 changeset에 갱신"(§6.2)을 손으로, `/sdd-sync`는 `node scripts/sdd-sync.mjs`를 직접 실행. 슬래시가 하던 일은 전부 CLI/수동 절차로 존재한다.

### 첫 스펙 작성 (수동 — 슬래시 없이)
`/speckit.specify`가 하던 것을 손으로 한다:
1. `templates/module-spec.md`(로컬 키트) 또는 raw base의 `templates/module-spec.md`를 복사해 `sdd/specs/SPEC-001-<slug>.md`로 만든다.
2. **채운다:** `Module`(1 레포=1 모듈)·`Status`·User Story·**FR(EARS 형식, SHALL 필수)**·`## Ownership`(Modules/Symbols/Artifacts/Files — 유일 키)·`## Success Criteria`·`## Review Log`·`## Dedup-Review`·`## Change Log`. FR ID는 본문에 리터럴로 적지 않는다(팬텀 집계 방지, `**FR-001**` 선언 라인만).
3. **셀프리뷰**(EARS 모호어·단일동작·측정형 — `SPEC_REVIEW.md`) 후 게이트 green 확인(`check-fr-coverage`·`check-ownership`·`check-spec-completeness`).
4. **사용자 승인** 후 확정. 코드 착지는 그 다음(작성=LLM, 승인=사람).

> **retrofit(기존 코드에 사후 스펙)은 `Status: Reviewed`로 바로 작성한다 — Draft 아님.** 템플릿 기본값 `Draft`는 **코드가 아직 없는 신규 기능**(spec-first)용이다. 이미 있는 코드를 스펙화하는 retrofit은 **작성 시점에 이미 코드 대조 검토가 끝난 상태**이므로, Draft로 두면 spec-sync 게이트가 "그 스펙이 소유한 (이미 존재하던) 코드를 같은 changeset에서 건드리는 것"을 Draft 차단으로 막아 **매 스펙마다 Draft→커밋실패→Reviewed 승격→재커밋**을 반복하게 된다(실측: 한 세션에서 SPEC-001~004 4회). 그러니 같은 저술 세션에서 **Review Log에 한 줄(일시·수행자=코드 대조 검토·판정)을 채우고 `Status: Reviewed`로 바로 작성**하라(신규 기능처럼 코드가 아직 없는 경우만 Draft가 맞다).

## 고정 규칙 (발명 금지)
- spec은 `sdd/specs/`에만 둔다.
- PREFIX는 **SPEC/INFRA/TEST**. 새 PREFIX가 필요하면 사유와 함께 사용자 승인 후 `sdd.config.json`의 `specIdPrefixes`에 등록.
- **1 spec = 1 aggregate.**
- 소유 코드 변경엔 **같은 changeset에 소유 spec 변경을 동반**한다(순수 hotfix만 커밋 트레일러 `Spec-Impact: none <사유>`).
- 작성=LLM, 승인=사용자. 스펙 확정은 사용자 승인 후.
