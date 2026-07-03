# SDD 방법론 업데이트 (GitHub 정본 → 이 프로젝트) — 이 파일 하나로 실행

> **한 줄 사용법:** `~/Documents/claude/sdd/prompts/update.md 를 수행해줘` (또는 그냥 "이 방법론 업데이트해줘").
> **대상:** 이미 채택된 프로젝트. **방법론 도구(게이트·훅·템플릿)만 최신으로. 스펙·작업물은 불변.**

**정본:** https://github.com/lhs6395-hslee/ai-methodology · 로컬 키트: `~/Documents/claude/sdd`

## 실행 순서
1. **키트 최신화.** 로컬 키트 `~/Documents/claude/sdd`를 `git pull`로 origin/main 최신화(뒤처졌으면 알린다).
2. **diff.** 이 프로젝트에 설치된 것(`scripts/`의 `*.mjs` 게이트 · `.git/hooks` · `.claude/skills` · `sdd/templates`)을 키트와 비교한다.
3. **승인 후 반영.** 바뀐 파일만 목록으로 보여주고, **사용자 승인을 받은 뒤에만** 반영한다 — 자동 덮어쓰기 금지. (`sdd-init`를 `--force` 없이 재실행하면 신규만 추가되고 기존은 보존. 게이트 코드 갱신은 diff 확인 후 명시적으로 복사.)
4. **확인.** 반영 후 게이트를 돌려 green 확인하고, 무엇이 바뀌었는지 요약한다.

## 불변 규칙
- 사용자 스펙·FR·작업물(`sdd/specs/*`)은 **절대 건드리지 않는다** — 최신화 대상은 방법론 도구(게이트·훅·템플릿)뿐.
- 자동 덮어쓰기 금지, 사람 승인 필수.
