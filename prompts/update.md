# SDD 방법론 업데이트 (GitHub 정본 → 이 프로젝트) — 이 파일 하나로 실행

> **한 줄 사용법 (clean machine · clone 불필요):** 대화창에 아래 한 줄(또는 그냥 "이 방법론 업데이트해줘").
> ```
> https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/update.md 읽고 그대로 수행해줘
> ```
> 위 URL의 정본 ref는 `main`(자기참조 — 특정 브랜치에서 받으면 그 ref를 이어 쓴다). 키트가 로컬에 있으면 `<KIT>/prompts/update.md 를 수행해줘`도 동일.
> **대상:** 이미 채택된 프로젝트. **방법론 도구(게이트·훅·템플릿) 최신화 + 고도화로 생긴 새 config knob·규범을 이 프로젝트에 인스턴스화. 스펙·작업물은 불변.** — 방법론이 무엇이 바뀌든 이 한 줄로 프로젝트가 따라잡는다(자동 전파).

**정본:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw URL로 받았다면 그 URL의 `<ref>` 세그먼트를 REF로, 로컬 키트로 실행 중이면 REF=`main`으로 간주한다(아래 `--branch`/pull에 사용).

## 실행 순서
1. **키트 최신화(전체 clone 없이).** 로컬 키트가 있으면 `git -C "$KIT" pull` 로 최신화하고, 없으면 partial+sparse로 확보한다(뒤처졌으면 알린다):
   ```sh
   KIT="${SDD_KIT:-$HOME/Documents/claude/sdd}"           # 로컬 키트 캐시 위치(관례)
   REF="main"                          # update.md를 받은 ref (정본 main; 자기참조 — 브랜치에서 받으면 그 ref)
   if [ -d "$KIT/.git" ]; then
     git -C "$KIT" fetch origin "$REF" && git -C "$KIT" pull --ff-only origin "$REF"
   else                                                    # partial+sparse — 전체 clone 아님
     git clone --filter=blob:none --sparse --branch "$REF" \
       https://github.com/lhs6395-hslee/ai-methodology "$KIT"
     git -C "$KIT" sparse-checkout set tooling templates prompts
   fi
   ```
2. **diff.** 이 프로젝트에 설치된 것(`scripts/`의 `*.mjs` 게이트 · `.git/hooks` · `.claude/skills` · `sdd/templates`)을 키트(`$KIT/tooling`·`$KIT/templates`)와 비교한다.
3. **승인 후 반영.** 바뀐 파일만 목록으로 보여주고, **사용자 승인을 받은 뒤에만** 반영한다 — 자동 덮어쓰기 금지. (`sdd-init`를 `--force` 없이 재실행하면 신규만 추가되고 기존은 보존. 게이트 코드 갱신은 diff 확인 후 명시적으로 복사.)
4. **새 config knob·규범 인스턴스화 (고도화 자동 전파 — 이 단계가 빠지면 도구만 새롭고 방법론 고도화는 프로젝트에 도달하지 않는다).**
   - **새 knob 탐지:** 키트 DEFAULTS(`$KIT/tooling/sdd-config.mjs` + `$KIT/tooling/sdd.config.presets.md` 필드표)와 이 프로젝트 `sdd.config.json`을 비교해, 프로젝트에 **없는 새 knob**을 목적과 함께 나열한다.
   - **인스턴스화 판정 (knob별):**
     - *값이 프로젝트별인 knob*(예: `trackerCloseout`의 트래커·보고 채널) → **자동 추정 금지.** 먼저 이 프로젝트 `CLAUDE.md`/관례에 선언돼 있으면 그 값으로 채우고, 없으면 **사용자에게 물어** 인스턴스화한다. 해당 없으면 기본 비활성값(`{}`·`[]`)으로 두고 사유를 남긴다.
     - *기본값으로 충분한 knob* → 그대로 둔다(하위호환).
   - **새 규범 반영:** 이번 최신화로 들어온 새 규범(예: 완료 루프 close-out — `speckit-fix` 스킬 단계·`METHODOLOGY.md`)이 프로젝트 관례(`CLAUDE.md`) 기입을 요구하면 사용자 확인 후 반영한다.
   - 원칙: 이 단계는 **어떤 미래 knob에도** 동작하도록 generic이다 — 특정 knob명을 하드코딩하지 않고 "DEFAULTS엔 있는데 프로젝트에 없는 것"을 기준으로 판단한다.
5. **확인.** 반영 후 게이트를 돌려 green 확인하고, 무엇이 바뀌었는지(도구·knob·규범) 요약한다.

## 불변 규칙
- 사용자 스펙·FR·작업물(`sdd/specs/*`)은 **절대 건드리지 않는다** — 최신화 대상은 방법론 도구(게이트·훅·템플릿)와 config knob·규범 인스턴스화뿐.
- 기존 config 값은 보존한다 — 새 knob만 추가/인스턴스화(기존 값 덮어쓰기 금지).
- 자동 덮어쓰기 금지, 사람 승인 필수. 값이 프로젝트별인 knob은 추정하지 말고 CLAUDE.md 관례 또는 사용자에게 확인.
