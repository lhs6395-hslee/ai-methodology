# SOURCES — 방법론 주장 외부 확증 기록 (공식문서/블로그)

> 키트의 방법론 주장을 1차/공식 출처로 검증한 기록. 검증일 2026-06-26. 태그: `[검증]`=출처로 확인 · `[보강]`=대체로 맞으나 정정/보완.

| # | 주장 (키트 내 위치) | 판정 | 출처 |
|---|---|---|---|
| 1 | Spec Kit 커맨드: constitution/specify/clarify/plan/tasks/analyze/checklist/implement/taskstoissues/converge (METHODOLOGY, SPEC_REVIEW) | [검증] | https://github.com/github/spec-kit |
| 2 | **converge는 "코드를 spec/plan/tasks에 대조해 남은 작업을 새 task로 추가"할 뿐 — spec을 자동 재작성하지 않음** (SSOT §2·§5, METHODOLOGY 동기화) | [검증] 공식 README 문구와 일치 | https://github.com/github/spec-kit |
| 3 | **`/specify`는 생성 + 갱신 모두** 가능 → bottom-up code→spec에 사용 (METHODOLOGY) | [검증] | https://github.com/github/spec-kit |
| 4 | Spec Kit **에이전트 비종속, 30+ 에이전트** 지원 (METHODOLOGY 왜-SpecKit) | [검증] "works with 30+ AI coding agents" | https://github.com/github/spec-kit |
| 5 | **EARS는 Spec Kit 내장/공식 아님** — feature request로만 존재(미내장). preset 커스터마이즈 필요·업데이트 시 재정합 (SSOT §2, REALITY_CHECK) | [검증] 이슈는 "Feature Request: EARS Integration" | https://github.com/github/spec-kit/issues/1356 |
| 6 | EARS = Rolls-Royce Aero, **IEEE RE'09(2009)**, 5패턴(Ubiquitous/Event/State/Unwanted/Optional) (METHODOLOGY, templates) | [검증] | https://alistairmavin.com/ears/ · https://www.researchgate.net/publication/224079416 |
| 6a | EARS 저자 = **Mavin · Wilkinson · Harwood · Novak** (나 단독으로 적었으면 공저자 보강) | [보강] | https://alistairmavin.com/ears/ |
| 7 | OpenSpec = **Fission-AI, brownfield-first**, `openspec/specs/`=현재진실 vs `openspec/changes/`=델타(ADDED/MODIFIED/REMOVED) (METHODOLOGY 왜-SpecKit, STRUCTURE) | [검증] | https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md |
| 8 | Superpowers = **obra(Jesse Vincent)** 스킬 프레임워크, TDD(RED-GREEN-REFACTOR), verification-before-completion(검증 출력 직접 확인), 멀티호스트(Claude Code/Cursor/Codex/Copilot CLI/Gemini CLI/OpenCode), **Anthropic 공식 마켓(2026-01-15~)** (METHODOLOGY, principles) | [검증/보강] 창작자=Jesse Vincent(obra)로 명기 | https://github.com/obra/superpowers |

## 정정/보강 요약 (이번 검증으로 반영)
- EARS 저자를 Mavin 단독이 아니라 **공저(Mavin·Wilkinson·Harwood·Novak)** 로 표기.
- Superpowers 창작자 **Jesse Vincent(obra)/Prime Radiant**, Claude Code 공식 마켓 등재(2026-01-15) 명기. (라이선스는 미확인 — 단정 금지)
- 그 외 핵심 주장(converge 동작, specify 갱신, EARS 비공식, OpenSpec 모델)은 **공식 출처와 일치 — 정정 없음.**

## 미확인 (단정하지 말 것)
- Superpowers/Spec Kit 정확한 라이선스 문구, 특정 버전 세부 동작은 각 레포 LICENSE/릴리스로 별도 확인.
