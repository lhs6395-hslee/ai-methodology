# OWNERSHIP MAP — 소유 키별 보증 상태 (생성물)

> **이 파일은 `tooling/gen-ownership-map.mjs`가 생성한다 — 직접 편집하지 말 것.** 각 소유 키가 *실제로 어느 가드에 의해* 보증되는지 보여준다.
> 게이트 요약 한 줄이 초록이어도 가드가 inert면 그 키는 **검증되지 않은 것**이다 — 그 사실을 키마다 드러내는 것이 이 표의 목적이다.
> 판정은 게이트의 판정 코어를 그대로 재사용하므로 맵과 게이트가 갈라지지 않는다. config: `sdd.config.json`

## 가드 포스처 (이 레포에서 실제로 발화하는가)

| 가드 | 상태 | 강도 | 근거 |
|---|---|---|---|
| 구조적 중복(dedup) | **발화** | hard(정책 없음) | — |
| FR 키 앵커(SPEC-023) | **발화** | advisory | — |
| capability 귀속(SPEC-024) | **발화** | hard | — |
| entity 실재(SPEC-026) | **발화** | hard | — |
| surface 실재(orphan, SPEC-003) | **발화** | advisory | — |
| entity 등록제(entityRegistry) | **발화** | hard(채우면) | — |

## 카테고리 → 역할

| 카테고리 | 역할 |
|---|---|
| Modules | entity |
| Symbols | surface |
| Artifacts | —(역할 없음) |
| Capabilities | capability |

## Entity 키 (aggregate root) — 42건

| 키 | 소유 스펙 | 유일성 | FR 앵커 | 실재 |
|---|---|---|---|---|
| `adoption-lifecycle` | SPEC-005 | ✓ | ✓ | ✓ |
| `capability-ownership` | SPEC-024 | ✓ | ✓ | ✓ |
| `changelog-fr-ref` | SPEC-037 | ✓ | ✓ | ✓ |
| `covers-backlink` | SPEC-039 | ✓ | ✓ | ✓ |
| `cross-spec-change` | SPEC-020 | ✓ | ✓ | ✓ |
| `deploy-guard` | SPEC-035 | ✓ | ✓ | ✓ |
| `derivation-accounting` | SPEC-009 | ✓ | ✓ | ✓ |
| `duplicate-logic` | SPEC-038 | ✓ | ✓ | ✓ |
| `engine-event` | SPEC-030 | ✓ | ✓ | ✓ |
| `entity-relations` | SPEC-017 | ✓ | ✓ | ✓ |
| `entity-schema-backing` | SPEC-026 | ✓ | ✓ | ✓ |
| `entity-synonym` | SPEC-033 | ✓ | ✓ | ✓ |
| `execution-evidence` | SPEC-031 | ✓ | ✓ | ✓ |
| `fr-key-anchors` | SPEC-023 | ✓ | ✓ | ✓ |
| `gate-verdict` | SPEC-040 | ✓ | ✓ | ✓ |
| `harness-install` | SPEC-004 | ✓ | ✓ | ✓ |
| `hook-wiring` | SPEC-036 | ✓ | ✓ | ✓ |
| `key-pipeline` | SPEC-001 | ✓ | ✓ | ✓ |
| `kit-ci` | CICD-001 | ✓ | ✓ | ✓ |
| `live-reality` | SPEC-032 | ✓ | ✓ | ✓ |
| `object-storage-decision` | SPEC-016 | ✓ | ✓ | ✓ |
| `ownership-map` | SPEC-028 | ✓ | ✓ | ✓ |
| `ownership-reality` | SPEC-029 | ✓ | ✓ | ✓ |
| `policy-ratchet` | SPEC-027 | ✓ | ✓ | ✓ |
| `prefix-class-consistency` | SPEC-012 | ✓ | ✓ | ✓ |
| `retag` | SPEC-011 | ✓ | ✓ | ✓ |
| `runtime-parity` | SPEC-006 | ✓ | ✓ | ✓ |
| `runtime-schema-drift` | SPEC-022 | ✓ | ✓ | ✓ |
| `sc-coverage` | SPEC-034 | ✓ | ✓ | ✓ |
| `semantic-drift` | SPEC-019 | ✓ | ✓ | ✓ |
| `smoke-scan` | SPEC-010 | ✓ | ✓ | ✓ |
| `spec-grammar-hardening` | SPEC-013 | ✓ | ✓ | ✓ |
| `spec-id-numbering` | SPEC-014 | ✓ | ✓ | ✓ |
| `spec-lifecycle` | SPEC-008 | ✓ | ✓ | ✓ |
| `spec-migration` | SPEC-025 | ✓ | ✓ | ✓ |
| `spec-quality-gates` | SPEC-002 | ✓ | ✓ | ✓ |
| `spec-retirement` | SPEC-018 | ✓ | ✓ | ✓ |
| `spec-sync` | SPEC-003 | ✓ | ✓ | ✓ |
| `test-domain` | SPEC-015 | ✓ | ✓ | ✓ |
| `test-execution` | SPEC-021 | ✓ | ✓ | ✓ |
| `verification-accounting` | SPEC-007 | ✓ | ✓ | ✓ |
| `verification-run` | SPEC-041 | ✓ | ✓ | ✓ |

## Surface 키 — 80건

| 키 | 소유 스펙 | 유일성 | FR 앵커 | 실재 |
|---|---|---|---|---|
| `capability-ownership-lib.mjs` | SPEC-024 | ✓ | ✓ | ✓ |
| `changelog-fr-lib.mjs` | SPEC-037 | ✓ | ✓ | ✓ |
| `check-converge-drift.mjs` | SPEC-003 | ✓ | ✓ | ✓ |
| `check-deploy-debt.mjs` | SPEC-035 | ✓ | ✓ | ✓ |
| `check-deploy-guard.mjs` | SPEC-035 | ✓ | ✓ | ✓ |
| `check-deploy-precheck.mjs` | SPEC-035 | ✓ | ✓ | ✓ |
| `check-derivation.mjs` | SPEC-009 | ✓ | ✓ | ✓ |
| `check-duplicate-logic.mjs` | SPEC-038 | ✓ | ✓ | ✓ |
| `check-engine-event.mjs` | SPEC-030 | ✓ | ✓ | ✓ |
| `check-evidence.mjs` | SPEC-031 | ✓ | ✓ | ✓ |
| `check-fr-coverage.mjs` | SPEC-002 | ✓ | ✓ | ✓ |
| `check-hooks-installed.mjs` | SPEC-036 | ✓ | ✓ | ✓ |
| `check-live-reality.mjs` | SPEC-032 | ✓ | ✓ | ✓ |
| `check-orphan-surfaces.mjs` | SPEC-003 | ✓ | ✓ | ✓ |
| `check-ownership.mjs` | SPEC-002 | ✓ | ✓ | ✓ |
| `check-policy-ratchet.mjs` | SPEC-027 | ✓ | ✓ | ✓ |
| `check-pre-edit.mjs` | SPEC-003 | ✓ | ✓ | ✓ |
| `check-sc-coverage.mjs` | SPEC-034 | ✓ | ✓ | ✓ |
| `check-schema-drift.mjs` | SPEC-022 | ✓ | ✓ | ✓ |
| `check-spec-cohesion.mjs` | SPEC-002 | ✓ | ✓ | ✓ |
| `check-spec-completeness.mjs` | SPEC-002 | ✓ | ✓ | ✓ |
| `check-spec-consistency.mjs` | SPEC-002 | ✓ | ✓ | ✓ |
| `check-spec-sync.mjs` | SPEC-003 | ✓ | ✓ | ✓ |
| `check-synonym.mjs` | SPEC-033 | ✓ | ✓ | ✓ |
| `check-test-adequacy.mjs` | SPEC-002 | ✓ | ✓ | ✓ |
| `check-test-run.mjs` | SPEC-021 | ✓ | ✓ | ✓ |
| `check-verification-executed.mjs` | SPEC-041 | ✓ | ✓ | ✓ |
| `covers-backlink-lib.mjs` | SPEC-039 | ✓ | ✓ | ✓ |
| `cross-spec-lib.mjs` | SPEC-020 | ✓ | ✓ | ✓ |
| `deploy-guard-lib.mjs` | SPEC-035 | ✓ | ✓ | ✓ |
| `derivation-lib.mjs` | SPEC-009 | ✓ | ✓ | ✓ |
| `drift-lib.mjs` | SPEC-019 | ✓ | ✓ | ✓ |
| `duplicate-logic-lib.mjs` | SPEC-038 | ✓ | ✓ | ✓ |
| `engine-event-lib.mjs` | SPEC-030 | ✓ | ✓ | ✓ |
| `evidence-lib.mjs` | SPEC-031 | ✓ | ✓ | ✓ |
| `gen-ownership-map.mjs` | SPEC-028 | ✓ | ✓ | ✓ |
| `go-gate` | SPEC-006 | ✓ | ✓ | ✓ |
| `grammar-lib.mjs` | SPEC-013 | ✓ | ✓ | ✓ |
| `hooks-install-lib.mjs` | SPEC-036 | ✓ | ✓ | ✓ |
| `hooks.list` | SPEC-036 | ✓ | ✓ | ✓ |
| `key-anchor-lib.mjs` | SPEC-023 | ✓ | ✓ | ✓ |
| `lifecycle-lib.mjs` | SPEC-008 | ✓ | ✓ | ✓ |
| `live-reality-lib.mjs` | SPEC-032 | ✓ | ✓ | ✓ |
| `migrate.md` | SPEC-025 | ✓ | ✓ | ✓ |
| `numbering-lib.mjs` | SPEC-014 | ✓ | ✓ | ✓ |
| `object-storage-lib.mjs` | SPEC-016 | ✓ | ✓ | ✓ |
| `ownership-keys.mjs` | SPEC-001 | ✓ | ✓ | ✓ |
| `ownership-reality-lib.mjs` | SPEC-029 | ✓ | ✓ | ✓ |
| `policy-ratchet-lib.mjs` | SPEC-027 | ✓ | ✓ | ✓ |
| `pre-commit` | SPEC-004 | ✓ | ✓ | ✓ |
| `pre-push` | SPEC-004 | ✓ | ✓ | ✓ |
| `prefix-class-lib.mjs` | SPEC-012 | ✓ | ✓ | ✓ |
| `relation-lib.mjs` | SPEC-017 | ✓ | ✓ | ✓ |
| `retire-lib.mjs` | SPEC-018 | ✓ | ✓ | ✓ |
| `sc-coverage-lib.mjs` | SPEC-034 | ✓ | ✓ | ✓ |
| `schema-backing-lib.mjs` | SPEC-026 | ✓ | ✓ | ✓ |
| `schema-drift-lib.mjs` | SPEC-022 | ✓ | ✓ | ✓ |
| `sdd_gates.py` | SPEC-006 | ✓ | ✓ | ✓ |
| `sdd_gates.sh` | SPEC-006 | ✓ | ✓ | ✓ |
| `sdd-config.mjs` | SPEC-001 | ✓ | ✓ | ✓ |
| `sdd-deploy-check.sh` | SPEC-035 | ✓ | ✓ | ✓ |
| `sdd-deploy-precheck.sh` | SPEC-035 | ✓ | ✓ | ✓ |
| `sdd-edit-check.sh` | SPEC-004 | ✓ | ✓ | ✓ |
| `sdd-init.sh` | SPEC-004 | ✓ | ✓ | ✓ |
| `sdd-migrate.skill.md` | SPEC-025 | ✓ | ✓ | ✓ |
| `sdd-readopt.skill.md` | SPEC-005 | ✓ | ✓ | ✓ |
| `sdd-retag.mjs` | SPEC-011 | ✓ | ✓ | ✓ |
| `sdd-retire.mjs` | SPEC-018 | ✓ | ✓ | ✓ |
| `sdd-run.mjs` | SPEC-004 | ✓ | ✓ | ✓ |
| `sdd-session-context.sh` | SPEC-004 | ✓ | ✓ | ✓ |
| `sdd-smoke-scan.mjs` | SPEC-010 | ✓ | ✓ | ✓ |
| `sdd-start.skill.md` | SPEC-005 | ✓ | ✓ | ✓ |
| `sdd-sync.mjs` | SPEC-004 | ✓ | ✓ | ✓ |
| `sdd-update.skill.md` | SPEC-005 | ✓ | ✓ | ✓ |
| `spec-sync-lib.mjs` | SPEC-003 | ✓ | ✓ | ✓ |
| `synonym-lib.mjs` | SPEC-033 | ✓ | ✓ | ✓ |
| `test-domain-lib.mjs` | SPEC-015 | ✓ | ✓ | ✓ |
| `verdict-lib.mjs` | SPEC-040 | ✓ | ✓ | ✓ |
| `verification-accounting.mjs` | SPEC-007 | ✓ | ✓ | ✓ |
| `verification-run-lib.mjs` | SPEC-041 | ✓ | ✓ | ✓ |

## Capability 키 — 44건

| 키 | 소유 스펙 | 유일성 | FR 앵커 | 실재 |
|---|---|---|---|---|
| `adoption-lifecycle.adopt` | SPEC-005 | ✓ | ✓ | ✓ |
| `capability-ownership.judge` | SPEC-024 | ✓ | ✓ | ✓ |
| `changelog-fr-ref.judge` | SPEC-037 | ✓ | ✓ | ✓ |
| `covers-backlink.judge` | SPEC-039 | ✓ | ✓ | ✓ |
| `cross-spec-change.judge` | SPEC-020 | ✓ | ✓ | ✓ |
| `deploy-guard.gate` | SPEC-035 | ✓ | ✓ | ✓ |
| `derivation-accounting.account` | SPEC-009 | ✓ | ✓ | ✓ |
| `duplicate-logic.judge` | SPEC-038 | ✓ | ✓ | ✓ |
| `engine-event.judge` | SPEC-030 | ✓ | ✓ | ✓ |
| `entity-relations.resolve` | SPEC-017 | ✓ | ✓ | ✓ |
| `entity-schema-backing.judge` | SPEC-026 | ✓ | ✓ | ✓ |
| `entity-synonym.judge` | SPEC-033 | ✓ | ✓ | ✓ |
| `execution-evidence.judge` | SPEC-031 | ✓ | ✓ | ✓ |
| `fr-key-anchors.judge` | SPEC-023 | ✓ | ✓ | ✓ |
| `gate-verdict.account` | SPEC-040 | ✓ | ✓ | ✓ |
| `gate-verdict.emit` | SPEC-040 | ✓ | ✓ | ✓ |
| `harness-install.install` | SPEC-004 | ✓ | ✓ | ✓ |
| `hook-wiring.gate` | SPEC-036 | ✓ | ✓ | ✓ |
| `key-pipeline.parse` | SPEC-001 | ✓ | ✓ | ✓ |
| `kit-ci.gate` | CICD-001 | ✓ | ✓ | ✓ |
| `live-reality.judge` | SPEC-032 | ✓ | ✓ | ✓ |
| `object-storage-decision.judge` | SPEC-016 | ✓ | ✓ | ✓ |
| `ownership-map.generate` | SPEC-028 | ✓ | ✓ | ✓ |
| `ownership-reality.judge` | SPEC-029 | ✓ | ✓ | ✓ |
| `policy-ratchet.judge` | SPEC-027 | ✓ | ✓ | ✓ |
| `prefix-class-consistency.judge` | SPEC-012 | ✓ | ✓ | ✓ |
| `retag.migrate` | SPEC-011 | ✓ | ✓ | ✓ |
| `runtime-parity.mirror` | SPEC-006 | ✓ | ✓ | ✓ |
| `runtime-schema-drift.judge` | SPEC-022 | ✓ | ✓ | ✓ |
| `sc-coverage.account` | SPEC-034 | ✓ | ✓ | ✓ |
| `semantic-drift.judge` | SPEC-019 | ✓ | ✓ | ✓ |
| `smoke-scan.scan` | SPEC-010 | ✓ | ✓ | ✓ |
| `spec-grammar-hardening.judge` | SPEC-013 | ✓ | ✓ | ✓ |
| `spec-id-numbering.judge` | SPEC-014 | ✓ | ✓ | ✓ |
| `spec-lifecycle.judge` | SPEC-008 | ✓ | ✓ | ✓ |
| `spec-migration.migrate` | SPEC-025 | ✓ | ✓ | ✓ |
| `spec-quality-gates.judge` | SPEC-002 | ✓ | ✓ | ✓ |
| `spec-retirement.retire` | SPEC-018 | ✓ | ✓ | ✓ |
| `spec-sync.enforce` | SPEC-003 | ✓ | ✓ | ✓ |
| `test-domain.judge` | SPEC-015 | ✓ | ✓ | ✓ |
| `test-execution.run` | SPEC-021 | ✓ | ✓ | ✓ |
| `verification-accounting.account` | SPEC-007 | ✓ | ✓ | ✓ |
| `verification-run.account` | SPEC-041 | ✓ | ✓ | ✓ |
| `verification-run.record` | SPEC-041 | ✓ | ✓ | ✓ |

## 역할 없는 카테고리 키 — 17건

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
| `sdd/duplicate-candidates.tsv` | SPEC-038 | ✓ | — | — |
| `sdd/ownership_map.md` | SPEC-028 | ✓ | — | — |
| `sdd/smoke-manifest.json` | SPEC-007 | ✓ | — | — |

## 집계

- 소유 키 총 **183건** (entity 42 · surface 80 · capability 44 · 역할없음 17)
- 유일성 위반 **0건**
- FR 앵커 미충족 **0건** / 미판정 0건
- 실재 위반 **0건** / 면제 0건 / 미판정 0건

