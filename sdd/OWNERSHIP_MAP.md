# OWNERSHIP MAP — 소유 키별 보증 상태 (생성물)

> **이 파일은 `tooling/gen-ownership-map.mjs`가 생성한다 — 직접 편집하지 말 것.** 각 소유 키가 *실제로 어느 가드에 의해* 보증되는지 보여준다.
> 게이트 요약 한 줄이 초록이어도 가드가 inert면 그 키는 **검증되지 않은 것**이다 — 그 사실을 키마다 드러내는 것이 이 표의 목적이다.
> 판정은 게이트의 판정 코어를 그대로 재사용하므로 맵과 게이트가 갈라지지 않는다. config: `sdd.config.json`

## 가드 포스처 (이 레포에서 실제로 발화하는가)

| 가드 | 상태 | 강도 | 근거 |
|---|---|---|---|
| 구조적 중복(dedup) | **발화** | hard(정책 없음) | — |
| FR 키 앵커(SPEC-023) | **발화** | advisory | — |
| capability 귀속(SPEC-024) | **미판정** | advisory | capability 역할 카테고리 미해석(ownershipCategoryRoles에 capability 선언 없음 + 이름 폴백 실패) |
| entity 실재(SPEC-026) | **미판정** | off | — |
| surface 실재(orphan, SPEC-003) | **미판정** | advisory | surfaceGlobs 미설정 — orphan-surface no-op |
| entity 등록제(entityRegistry) | **발화** | hard(채우면) | — |

> ⚠ **3개 가드가 미판정입니다** — capability 귀속(SPEC-024) · entity 실재(SPEC-026) · surface 실재(orphan, SPEC-003). 아래 표의 해당 칸은 "검증됨"이 아니라 "아무도 안 봤음"을 뜻합니다.

## 카테고리 → 역할

| 카테고리 | 역할 |
|---|---|
| Modules | entity |
| Symbols | surface |
| Artifacts | —(역할 없음) |

## Entity 키 (aggregate root) — 29건

| 키 | 소유 스펙 | 유일성 | FR 앵커 | 실재 |
|---|---|---|---|---|
| `adoption-lifecycle` | SPEC-005 | ✓ | ✓ | 미판정 |
| `capability-ownership` | SPEC-024 | ✓ | ✓ | 미판정 |
| `cross-spec-change` | SPEC-020 | ✓ | ✓ | 미판정 |
| `derivation-accounting` | SPEC-009 | ✓ | ✓ | 미판정 |
| `entity-relations` | SPEC-017 | ✓ | ✓ | 미판정 |
| `entity-schema-backing` | SPEC-026 | ✓ | ✓ | 미판정 |
| `fr-key-anchors` | SPEC-023 | ✓ | ✓ | 미판정 |
| `harness-install` | SPEC-004 | ✓ | ✓ | 미판정 |
| `key-pipeline` | SPEC-001 | ✓ | ✓ | 미판정 |
| `kit-ci` | CICD-001 | ✓ | ✓ | 미판정 |
| `object-storage-decision` | SPEC-016 | ✓ | ✓ | 미판정 |
| `ownership-map` | SPEC-028 | ✓ | ✓ | 미판정 |
| `policy-ratchet` | SPEC-027 | ✓ | ✓ | 미판정 |
| `prefix-class-consistency` | SPEC-012 | ✓ | ✓ | 미판정 |
| `retag` | SPEC-011 | ✓ | ✓ | 미판정 |
| `runtime-parity` | SPEC-006 | ✓ | ✓ | 미판정 |
| `runtime-schema-drift` | SPEC-022 | ✓ | ✓ | 미판정 |
| `semantic-drift` | SPEC-019 | ✓ | ✓ | 미판정 |
| `smoke-scan` | SPEC-010 | ✓ | ✓ | 미판정 |
| `spec-grammar-hardening` | SPEC-013 | ✓ | ✓ | 미판정 |
| `spec-id-numbering` | SPEC-014 | ✓ | ✓ | 미판정 |
| `spec-lifecycle` | SPEC-008 | ✓ | ✓ | 미판정 |
| `spec-migration` | SPEC-025 | ✓ | ✓ | 미판정 |
| `spec-quality-gates` | SPEC-002 | ✓ | ✓ | 미판정 |
| `spec-retirement` | SPEC-018 | ✓ | ✓ | 미판정 |
| `spec-sync` | SPEC-003 | ✓ | ✓ | 미판정 |
| `test-domain` | SPEC-015 | ✓ | ✓ | 미판정 |
| `test-execution` | SPEC-021 | ✓ | ✓ | 미판정 |
| `verification-accounting` | SPEC-007 | ✓ | ✓ | 미판정 |

## Surface 키 — 52건

| 키 | 소유 스펙 | 유일성 | FR 앵커 | 실재 |
|---|---|---|---|---|
| `capability-ownership-lib.mjs` | SPEC-024 | ✓ | ✓ | 미판정 |
| `check-converge-drift.mjs` | SPEC-003 | ✓ | ✓ | 미판정 |
| `check-derivation.mjs` | SPEC-009 | ✓ | ✓ | 미판정 |
| `check-fr-coverage.mjs` | SPEC-002 | ✓ | ✓ | 미판정 |
| `check-orphan-surfaces.mjs` | SPEC-003 | ✓ | ✓ | 미판정 |
| `check-ownership.mjs` | SPEC-002 | ✓ | ✓ | 미판정 |
| `check-policy-ratchet.mjs` | SPEC-027 | ✓ | ✓ | 미판정 |
| `check-schema-drift.mjs` | SPEC-022 | ✓ | ✓ | 미판정 |
| `check-spec-cohesion.mjs` | SPEC-002 | ✓ | ✓ | 미판정 |
| `check-spec-completeness.mjs` | SPEC-002 | ✓ | ✓ | 미판정 |
| `check-spec-consistency.mjs` | SPEC-002 | ✓ | ✓ | 미판정 |
| `check-spec-sync.mjs` | SPEC-003 | ✓ | ✓ | 미판정 |
| `check-test-adequacy.mjs` | SPEC-002 | ✓ | ✓ | 미판정 |
| `check-test-run.mjs` | SPEC-021 | ✓ | ✓ | 미판정 |
| `cross-spec-lib.mjs` | SPEC-020 | ✓ | ✓ | 미판정 |
| `derivation-lib.mjs` | SPEC-009 | ✓ | ✓ | 미판정 |
| `drift-lib.mjs` | SPEC-019 | ✓ | ✓ | 미판정 |
| `gen-ownership-map.mjs` | SPEC-028 | ✓ | ✓ | 미판정 |
| `go-gate` | SPEC-006 | ✓ | ✓ | 미판정 |
| `grammar-lib.mjs` | SPEC-013 | ✓ | ✓ | 미판정 |
| `key-anchor-lib.mjs` | SPEC-023 | ✓ | ✓ | 미판정 |
| `lifecycle-lib.mjs` | SPEC-008 | ✓ | ✓ | 미판정 |
| `migrate.md` | SPEC-025 | ✓ | ✓ | 미판정 |
| `numbering-lib.mjs` | SPEC-014 | ✓ | ✓ | 미판정 |
| `object-storage-lib.mjs` | SPEC-016 | ✓ | ✓ | 미판정 |
| `ownership-keys.mjs` | SPEC-001 | ✓ | ✓ | 미판정 |
| `policy-ratchet-lib.mjs` | SPEC-027 | ✓ | ✓ | 미판정 |
| `pre-commit` | SPEC-004 | ✓ | ✓ | 미판정 |
| `pre-push` | SPEC-004 | ✓ | ✓ | 미판정 |
| `prefix-class-lib.mjs` | SPEC-012 | ✓ | ✓ | 미판정 |
| `relation-lib.mjs` | SPEC-017 | ✓ | ✓ | 미판정 |
| `retire-lib.mjs` | SPEC-018 | ✓ | ✓ | 미판정 |
| `schema-backing-lib.mjs` | SPEC-026 | ✓ | ✓ | 미판정 |
| `schema-drift-lib.mjs` | SPEC-022 | ✓ | ✓ | 미판정 |
| `sdd_gates.py` | SPEC-006 | ✓ | ✓ | 미판정 |
| `sdd_gates.sh` | SPEC-006 | ✓ | ✓ | 미판정 |
| `sdd-config.mjs` | SPEC-001 | ✓ | ✓ | 미판정 |
| `sdd-edit-check.sh` | SPEC-004 | ✓ | ✓ | 미판정 |
| `sdd-init.sh` | SPEC-004 | ✓ | ✓ | 미판정 |
| `sdd-migrate.skill.md` | SPEC-025 | ✓ | ✓ | 미판정 |
| `sdd-readopt.skill.md` | SPEC-005 | ✓ | ✓ | 미판정 |
| `sdd-retag.mjs` | SPEC-011 | ✓ | ✓ | 미판정 |
| `sdd-retire.mjs` | SPEC-018 | ✓ | ✓ | 미판정 |
| `sdd-run.mjs` | SPEC-004 | ✓ | ✓ | 미판정 |
| `sdd-session-context.sh` | SPEC-004 | ✓ | ✓ | 미판정 |
| `sdd-smoke-scan.mjs` | SPEC-010 | ✓ | ✓ | 미판정 |
| `sdd-start.skill.md` | SPEC-005 | ✓ | ✓ | 미판정 |
| `sdd-sync.mjs` | SPEC-004 | ✓ | ✓ | 미판정 |
| `sdd-update.skill.md` | SPEC-005 | ✓ | ✓ | 미판정 |
| `spec-sync-lib.mjs` | SPEC-003 | ✓ | ✓ | 미판정 |
| `test-domain-lib.mjs` | SPEC-015 | ✓ | ✓ | 미판정 |
| `verification-accounting.mjs` | SPEC-007 | ✓ | ✓ | 미판정 |

## 역할 없는 카테고리 키 — 16건

| 키 | 소유 스펙 | 유일성 | FR 앵커 | 실재 |
|---|---|---|---|---|
| `.claude/settings.json` | SPEC-004 | ✓ | — | — |
| `.claude/skills/sdd-migrate/skill.md` | SPEC-025 | ✓ | — | — |
| `.claude/skills/sdd-readopt/skill.md` | SPEC-005 | ✓ | — | — |
| `.claude/skills/sdd-start/skill.md` | SPEC-005 | ✓ | — | — |
| `.claude/skills/sdd-sync/skill.md` | SPEC-004 | ✓ | — | — |
| `.claude/skills/sdd-update/skill.md` | SPEC-005 | ✓ | — | — |
| `.claude/skills/speckit-fix/skill.md` | SPEC-004 | ✓ | — | — |
| `.git/hooks/commit-msg` | SPEC-003 | ✓ | — | — |
| `.git/hooks/pre-commit` | SPEC-004 | ✓ | — | — |
| `.git/hooks/pre-push` | SPEC-004 | ✓ | — | — |
| `.github/workflows/sdd-gates.yml` | CICD-001 | ✓ | — | — |
| `.kiro/steering/sdd.md` | SPEC-004 | ✓ | — | — |
| `agents.md` | SPEC-004 | ✓ | — | — |
| `sdd/derivation.json` | SPEC-009 | ✓ | — | — |
| `sdd/ownership_map.md` | SPEC-028 | ✓ | — | — |
| `sdd/smoke-manifest.json` | SPEC-007 | ✓ | — | — |

## 집계

- 소유 키 총 **97건** (entity 29 · surface 52 · capability 0 · 역할없음 16)
- 유일성 위반 **0건**
- FR 앵커 미충족 **0건** / 미판정 0건
- 실재 위반 **0건** / 면제 0건 / 미판정 81건

