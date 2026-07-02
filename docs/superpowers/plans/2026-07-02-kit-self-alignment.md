# 키트 자기 정렬 (self-application) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키트 자신의 `tooling/`(게이트 스위트, 73 tests)을 자기 방법론 궤도(spec→@covers→게이트→hook)에 편입한다 — §14 마이그레이션의 첫 실전이자 상시 도그푸딩.

**Architecture:** 루트 `sdd.config.json`(비-웹 카테고리) + `sdd/specs/` 4-spec(기능군별 aggregate) + 기존 테스트 `@covers` 태깅 + git 훅이 **`tooling/`을 직접 호출**(scripts/ 복사 없음 — 키트가 원본). 게이트 출력을 피드백 삼아 스펙을 다듬는다(self-hosting).

**Tech Stack:** 기존 게이트 그대로(추가 코드 0 목표), markdown spec, git hooks.

## Global Constraints

- **키트 = 원본**: 훅·명령은 `node tooling/check-*.mjs` 직접 호출. `scripts/` 중복 설치 금지(sdd-init는 소비 프로젝트용).
- **ownershipCategories = `["Modules","Symbols","Artifacts"]`** (비-웹 프리셋, `sdd.config.presets.md`). Modules=기능군 aggregate(spec당 1 — 경계 규칙), Symbols=공개 진입점(게이트 파일명·export 함수), Artifacts=설치 산출물(훅·스킬 등).
- **1 spec = 1 aggregate**: SPEC-001 키 파이프라인(ownership-keys·sdd-config) / SPEC-002 spec 품질 게이트군(fr-coverage·ownership·cohesion·completeness·consistency) / SPEC-003 spec-sync(코어 lib·게이트·commit-msg 훅) / SPEC-004 하네스·설치(sdd-sync·sdd-init·pre-commit/pre-push·SessionStart/PreToolUse·스킬).
- **FR은 EARS**(기존 *구현된* 동작을 서술 — 새 동작 발명 금지), **Files glob 완전성**(각 spec이 tooling 소유 파일+테스트를 빠짐없이), `### Edge Cases`·`## Change Log` 포함(템플릿 준수).
- **게이트가 심판**: 각 태스크 후 자기 게이트 실행이 수용 기준. cohesion 임계 초과 시 — 스펙 분할이 옳으면 분할, 키 표현이 문제면 config 임계 조정(사유를 Change Log에).
- **테스트 73/73 유지**, @covers 태그는 주석이라 동작 무영향.
- **정직**: 스펙은 구현된 현실만 서술(REALITY_CHECK).

---

### Task 1: config + MODULE_MAP + 4 specs

**Files:**
- Create: `sdd.config.json`(루트), `sdd/MODULE_MAP.md`, `sdd/specs/SPEC-001-key-pipeline.md`, `SPEC-002-spec-quality-gates.md`, `SPEC-003-spec-sync.md`, `SPEC-004-harness-install.md`

- [ ] **Step 1: `sdd.config.json`** — specDir `sdd/specs`, scanDirs `["tooling"]`, testFileRegex `["\\.test\\.mjs$"]`, ownershipCategories `["Modules","Symbols","Artifacts"]`, ignoreDirs 기본+`go-gate`, commands.test `node --test tooling/__tests__/*.mjs`. (specIdPrefixes는 기본 SPEC/INFRA/TEST.)
- [ ] **Step 2: 4 specs 작성** — `templates/module-spec.md` 골조로. 각 spec: Module 헤더 · EARS FR(구현 동작 요약 — spec당 5~8개, 게이트/기능당 1 FR 원칙) · `## Ownership`(Modules 1개=aggregate, Symbols=게이트 파일명들, **Files=tooling 소유 파일+`tooling/__tests__/해당*.test.mjs` glob**) · `## Dependencies`(SPEC-002~004는 SPEC-001의 key-pipeline 참조) · `### Edge Cases`(각 게이트의 알려진 경계 — 설계 문서에서) · `## Change Log`(초안 행).
- [ ] **Step 3: MODULE_MAP.md** — 단일 모듈(sdd-tooling) 매니페스트 + 4 spec 인덱스.
- [ ] **Step 4: 자기 게이트 실행(심판)** — `node tooling/check-ownership.mjs` `check-spec-cohesion.mjs` `check-spec-completeness.mjs` `check-spec-consistency.mjs` `check-fr-coverage.mjs` 전부 실행. dedup 충돌 0·PREFIX OK 필수. cohesion/consistency 경고는 스펙·config 조정으로 해소(사유 기록). fr-coverage는 @covers 전 단계라 "0 covered warn"이 정상 — exit 0 확인만.
- [ ] **Step 5: 테스트 스윕 73/73 + Commit** `feat(self): 키트 자기 spec 4종 + config + MODULE_MAP (자기 게이트 green)`

### Task 2: @covers 태깅 (기존 73 테스트 → FR 연결)

**Files:** Modify: `tooling/__tests__/*.test.mjs` (13파일, 주석 태그만)

- [ ] **Step 1**: 각 테스트 파일 상단(또는 test별)에 `// @covers SPEC-NNN/FR-NNN` 태그 — Task 1의 FR 매핑대로. 테스트 로직 무변경.
- [ ] **Step 2**: `node tooling/check-fr-coverage.mjs` — 4 spec 모두 커버리지 리포트에 잡히고 dangling @covers 0. 미커버 FR 남으면: 실제 테스트 없는 FR인지 확인 → 있으면 태그 추가, 정말 없으면 FR을 Edge Case로 강등(스펙이 현실 서술이어야 — 정직).
- [ ] **Step 3**: 스윕 73/73 + Commit `feat(self): 전 테스트 @covers 태깅 — FR↔test 사슬 결선`

### Task 3: 훅 배선 (키트 자신에)

**Files:** Create: `.git/hooks/pre-commit`, `.git/hooks/commit-msg`, `.git/hooks/pre-push` (tooling 직접 호출 래퍼)

- [ ] **Step 1**: 각 훅 작성 — `tooling/harness/pre-commit`·`commit-msg`·`pre-push`의 로직을 따르되 `scripts/` 대신 **`tooling/` 경로** 호출(예: `node tooling/check-spec-sync.mjs --staged --message-file "$1"`). `.git/hooks/`는 비추적이므로 **`tooling/harness/self-hooks-install.sh`**(3줄 설치 스크립트)를 추적 파일로 추가하고 실행해 배선. chmod +x.
- [ ] **Step 2**: **작동 실증** — 무해한 tooling 파일 변경을 스테이징해 스펙 미동반 커밋 시도 → commit-msg **FAIL 실측**(출력 캡처) → 해당 spec Change Log 행 추가 → 통과. (이게 §검증 데모.)
- [ ] **Step 3**: Commit `feat(self): 키트 자기 훅 배선(tooling 직접 호출) + 설치 스크립트` — 이 커밋 자체가 새 훅 아래에서 만들어짐(자기 강제 첫 커밋).

### Task 4: 문서 마감 + 머지

- [ ] **Step 1**: `ROADMAP.md` 자기 정렬 → ✅ 완료 이동(실증 출력 요지 포함). `README.md`에 "키트 자신도 자기 궤도 위"(1줄+sdd/ 위치). `APPLYING.md` §14에 "실전 사례: 이 키트 자신" 포인터.
- [ ] **Step 2**: 최종 스윕 + 자기 게이트 전 실행 green + Commit `docs(self): 자기 정렬 완료 기록`
- [ ] **Step 3**: main ff-merge + push.

## Self-Review 결과
- 커버리지: config/스펙화/태깅/훅/실증/문서 = 자기 정렬 정의 전부. 신규 게이트 코드 0(기존 재사용) — YAGNI.
- 위험: cohesion·consistency가 자기 스펙에 경고 → Task 1 Step 4가 심판 루프로 흡수(조정 사유 기록). @covers 매핑 불일치 → Task 2 Step 2의 강등 규칙(정직).
- 타입/이름: spec 파일명·ID(SPEC-001~004), 카테고리(Modules/Symbols/Artifacts), 훅 경로(tooling 직접) 일관.
