// ─── 정책 래칫 lib (SPEC-027) ──────────────────────────────
// 순수 함수(I/O 없음) — Node 게이트와 Python 미러(sdd_gates.py)의 공통 판정 규칙.
// 강제 정책 knob은 강도를 "낮출 수 없다"(단조 증가만 허용). 하향은 명시적 예외 선언(loud)이
// 없으면 위반 — hard에서 빨간불이 뜨자 knob을 advisory/off로 내려 회피하는 escape를 봉쇄.
// (실측: 소비 프로젝트가 FR-007 128건 앞에서 frKeyAnchorPolicy=hard→advisory 하향을 "권장"으로 제시.)

// 강도 순위 — 모든 강제 정책 knob의 값 도메인을 3단계로 정규화.
//   off/silent(0, 비활성) < advisory/warn(1, 경고) < hard/error(2, 차단).
export const POLICY_RANK = { off: 0, silent: 0, advisory: 1, warn: 1, hard: 2, error: 2 };

// 래칫 대상 정책 knob — 강제 강도를 갖는 8종(sdd-config.mjs DEFAULTS 기준).
export const RATCHETED_POLICIES = [
  "specSyncUnownedPolicy",
  "draftBlockPolicy",
  "semanticDriftPolicy",
  "capabilityOwnershipPolicy",
  "frKeyAnchorPolicy",
  "runTestsPolicy",
  "migrationStatePolicy",
  "entitySchemaBackingPolicy",
];

export function rankOf(v) {
  const r = POLICY_RANK[String(v)];
  return r === undefined ? null : r;
}

// base config 대비 current config에서 강도가 낮아진 knob을 분류한다.
//   violations       — 예외 선언 없이 하향된 knob(차단 대상).
//   allowedDowngrades — policyRatchetExceptions에 선언돼 허용된 하향(부채로 표면화 — 남용 방지).
// base에 없는 knob(최초 채택 전)·미지의 값은 판정 밖(null 취급, 건너뜀) — 하위호환.
export function classifyRatchet(baseCfg, curCfg, exceptions = []) {
  const ex = new Set(exceptions || []);
  const violations = [];
  const allowedDowngrades = [];
  for (const knob of RATCHETED_POLICIES) {
    if (!baseCfg || !(knob in baseCfg)) continue; // base 미존재 = 래칫 기준 없음
    const from = rankOf(baseCfg[knob]);
    const to = rankOf(curCfg ? curCfg[knob] : undefined);
    if (from === null || to === null) continue; // 미지의 값은 심판하지 않음
    if (to < from) {
      const rec = { knob, from: baseCfg[knob], to: curCfg[knob] };
      (ex.has(knob) ? allowedDowngrades : violations).push(rec);
    }
  }
  return { violations, allowedDowngrades };
}
