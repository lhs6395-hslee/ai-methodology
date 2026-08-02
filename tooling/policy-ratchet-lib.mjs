// ─── 정책 래칫 lib (SPEC-027) ──────────────────────────────
// 순수 함수(I/O 없음) — Node 게이트와 Python 미러(sdd_gates.py)의 공통 판정 규칙.
// 강제 정책 knob은 강도를 "낮출 수 없다"(단조 증가만 허용). 하향은 명시적 예외 선언(loud)이
// 없으면 위반 — hard에서 빨간불이 뜨자 knob을 advisory/off로 내려 회피하는 escape를 봉쇄.
// (실측: 소비 프로젝트가 FR-007 128건 앞에서 frKeyAnchorPolicy=hard→advisory 하향을 "권장"으로 제시.)

// 강도 순위 — 모든 강제 정책 knob의 값 도메인을 3단계로 정규화.
//   off/silent(0, 비활성) < advisory/warn(1, 경고) < hard/error(2, 차단).
export const POLICY_RANK = { off: 0, silent: 0, advisory: 1, warn: 1, hard: 2, error: 2 };

// 래칫 대상 정책 knob — 강제 강도를 갖는 9종(sdd-config.mjs DEFAULTS 기준).
// **자기포함**(`policyRatchetPolicy`가 목록의 첫 항목): 래칫 자신의 강도가 감시 밖이면
// `policyRatchetPolicy:"off"` 한 줄로 래칫 전체가 자폭한다 — 게이트가 워킹트리 config로 자기
// 정책을 읽고 off면 base 비교 전에 exit 0하기 때문(감사 A-2 실측: 대상 knob 하향 + 이 한 줄을
// 같은 커밋에 넣으면 "판정 안 함 exit 0"). 자기 하향을 먼저 지목하도록 목록 선두에 둔다.
export const RATCHETED_POLICIES = [
  "policyRatchetPolicy",
  "specSyncUnownedPolicy",
  "draftBlockPolicy",
  "semanticDriftPolicy",
  "capabilityOwnershipPolicy",
  "frKeyAnchorPolicy",
  "runTestsPolicy",
  "migrationStatePolicy",
  "entitySchemaBackingPolicy",
  "symbolRealityPolicy",
  "ownershipRequiredPolicy",
  "crossCategoryDedupPolicy",
  "filesOverlapPolicy",
  "executionEvidencePolicy",
  "liveRealityPolicy",
  "engineRealityPolicy",
  "eventAttributionPolicy",
  "synonymPolicy",
  "e2eTestsPolicy",
  "scCoveragePolicy",
];

// 수치 임계도 강제 강도다 — **값을 올리는 것이 완화**다.
// 실측(다른 소비 프로젝트): FR 12개로 캡(10)을 넘기자 "maxFRsPerSpec을 12로 상향"이 **권장안**으로
// 제시됐다. 그건 위반을 해소한 게 아니라 자를 늘려 재는 것이고, 강도 knob을 hard→advisory로 내리는
// 것과 같은 회피다(방법론 금지: 미채택·완화를 권장으로 내세우지 않는다). 캡 초과의 정당한 해소는
// **분할 또는 병합**이고, 진짜 재조정이면 예외 선언으로 부채를 표면화한다.
export const RATCHETED_LIMITS = [
  "maxFRsPerSpec",
  "maxKeysPerCategoryPerSpec",
  "maxAggregateRootsPerSpec",
];

export function numOf(v) {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function rankOf(v) {
  const r = POLICY_RANK[String(v)];
  return r === undefined ? null : r;
}

// 이 실행을 심판할 래칫 자신의 강도 — base 시점과 현재 중 **강한 쪽**.
// 하향(자기약화)은 base가 심판하고(워킹트리 한 줄로 판정을 끄지 못한다), 상향은 즉시 반영한다
// (전진은 막지 않는다). check-spec-sync가 staged 판정을 HEAD 시점 config로 내리는 것과 동형의
// 반사성 봉합이되, 대상이 "래칫 자신의 강도"다. base가 미지의 값이면 판정 밖 → 현재 값 사용
// (게이트의 enum 검증이 담당). base·현재 모두 off인 프로젝트는 무영향(하위호환).
export function effectiveRatchetPolicy(basePolicy, curPolicy) {
  const b = rankOf(basePolicy), c = rankOf(curPolicy);
  if (b === null || c === null) return curPolicy;
  return b > c ? basePolicy : curPolicy;
}

// base config 대비 current config에서 강도가 낮아진 knob을 분류한다.
//   violations       — 예외 선언 없이 하향된 knob(차단 대상).
//   allowedDowngrades — policyRatchetExceptions에 선언돼 허용된 하향(부채로 표면화 — 남용 방지).
// base에 없는 knob·미지의 값은 판정 밖(null 취급, 건너뜀) — 하위호환. 단 소비 게이트는 base
// config를 DEFAULTS 병합으로 구성하므로(configFromString) 게이트 경로에서 knob은 항상 존재한다:
// base config에 안 적힌 knob은 "부재"가 아니라 **그 시점 DEFAULTS 값**과 대조된다(기본값 아래로
// 내리는 것도 하향). knob 부재 분기는 raw dict를 직접 넘기는 호출자(단위 테스트)용 안전망.
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
  for (const knob of RATCHETED_LIMITS) {
    if (!baseCfg || !(knob in baseCfg)) continue;
    const from = numOf(baseCfg[knob]);
    const to = numOf(curCfg ? curCfg[knob] : undefined);
    if (from === null || to === null) continue;
    if (to > from) { // 자를 늘리는 것 = 완화
      const rec = { knob, from: baseCfg[knob], to: curCfg[knob], kind: "limit" };
      (ex.has(knob) ? allowedDowngrades : violations).push(rec);
    }
  }
  return { violations, allowedDowngrades };
}
