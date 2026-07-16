<!-- SDD:BEGIN — 이 블록은 sdd-init이 관리한다. 이 프로젝트 고유 내용은 마커 밖에 적어라. -->
# SDD 방법론 — 에이전트 컨텍스트 (상시 로드)

이 프로젝트는 채택된 SDD 강제 궤도 위에서 돈다. 어떤 에이전트(Claude Code·Kiro·Codex·기타)로 작업하든 아래를 따른다. (Claude Code는 SessionStart 훅이 같은 내용을 주입하지만, 이 문서는 **실행기 무관**하게 그 컨텍스트를 보장한다.)

**궤도:** spec → code → test → sync (이탈은 git 훅·게이트가 되돌린다)

**진입 규칙 (새 기능/수정 시 반드시):**
1. `sdd/MODULE_MAP.md` 대조 — 기존 spec과 겹치면 그 spec 개정, 아니면 새 spec
2. spec 위치 = `sdd/specs/` · 설계 문서(승인 전) = `docs/design/`
3. PREFIX 표준 = SPEC / INFRA / TEST / CICD (FEAT 등 임의 생성 금지 — 필요하면 사용자 승인 후 `specIdPrefixes` 등록)
4. FR은 EARS(SHALL 필수), 테스트는 `@covers <PREFIX>-NNN/FR-NNN`
5. 코드 전에 spec부터 — 작성=LLM, 승인=사람. 1 spec = 1 aggregate
6. 소유 코드 변경엔 같은 changeset에 소유 spec 변경 동반(순수 hotfix만 `Spec-Impact: none <사유>` 트레일러)

**강제는 실행기 무관:** git 훅(commit-msg·pre-commit)과 게이트(`check-fr-coverage`·`check-ownership`·`check-spec-sync` 등)가 **누가 커밋하든** 발화한다. 게이트 직접 실행 = `node scripts/<gate>.mjs` (또는 `python3 scripts/sdd_gates.py <gate>`).

**슬래시 없이 진행하라(Kiro·Codex 등):** 슬래시 명령(`/sdd-*`·`/speckit.*`)은 Claude Code 편의 래퍼일 뿐이다. 슬래시를 못 쓰는 환경에서 **"슬래시를 못 쓰는데 어쩌죠?"라고 되묻지 말고, 같은 절차를 그대로 수동으로 밟는다:**
- 최초 채택 / 재채택 / 평상시 sync = `prompts/{adopt,readopt,update}.md` 절차 그대로
- 첫 스펙 / 신규 스펙 = `templates/module-spec.md` 복사 → `sdd/specs/SPEC-NNN-<slug>.md` → FR(EARS)·Ownership·SC·Review Log 채움 → 셀프리뷰(`SPEC_REVIEW.md`) → 게이트 green → 사용자 승인
- drift 점검 = `node scripts/sdd-sync.mjs`

**정본:** 방법론 = `METHODOLOGY.md`·`STRUCTURE.md`·`HARNESS.md`, 진입 = `prompts/adopt.md`. (전체는 SDD 키트를 참조 — 이 문서는 요약이다.)
<!-- SDD:END -->
