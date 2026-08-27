// ─── 정책 래칫 lib (SPEC-027) ──────────────────────────────
// 순수 함수(I/O 없음) — Node 게이트와 Python 미러(sdd_gates.py)의 공통 판정 규칙.
// 강제 정책 knob은 강도를 "낮출 수 없다"(단조 증가만 허용). 하향은 명시적 예외 선언(loud)이
// 없으면 위반 — hard에서 빨간불이 뜨자 knob을 advisory/off로 내려 회피하는 escape를 봉쇄.
// (실측: 소비 프로젝트가 FR-007 128건 앞에서 frKeyAnchorPolicy=hard→advisory 하향을 "권장"으로 제시.)

// 강도 순위 — 모든 강제 정책 knob의 값 도메인을 3단계로 정규화.
//   off/silent(0, 비활성) < advisory/warn(1, 경고) < hard/error(2, 차단).
export const POLICY_RANK = { off: 0, silent: 0, advisory: 1, warn: 1, hard: 2, error: 2 };

// 래칫 대상 정책 knob — 강제 강도를 갖는 **전부**(sdd-config.mjs DEFAULTS 기준).
// 목록에서 빠진 knob은 하향이 조용히 통과한다 — 새 정책을 만들면 여기에도 등재한다
// (실측: outOfBandDeployPolicy·changeLogFrRefPolicy가 도입 시 누락돼 감시 밖이었다).
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
  "hooksInstalledPolicy",
  "outOfBandDeployPolicy",
  "deployPreconditionPolicy",
  "changeLogFrRefPolicy",
  "duplicateLogicPolicy",
  "coversBacklinkPolicy",
  "verificationRunPolicy",
  "termCoveragePolicy",
  "externalTargetPolicy",
  "evidenceScopePolicy",
  "introDocPolicy",
  "implReferencePolicy",
  "processSsotPolicy",
  "watchdogPolicy",
  "importWiringPolicy",
  "agentWiringPolicy",
  "specConflictPolicy",
  "diagnosisGuardPolicy",
  "completionSignalPolicy",
  "preEditSpecFirstPolicy",
  "frPlacementPolicy",
  "gateFailureEscalationPolicy",
  "liveRealityCoveragePolicy",
  "riskyActionPolicy",
  "deployWindowPolicy",
  "capabilityVerbPolicy",
  "enforcementReachabilityPolicy",
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

// ─── 면제 래칫 (SPEC-027 확장, 2026-08-10) ──────────────────────────────────
// 실측 제보: 이 저장소의 게이트 다수가 **면제로 무력화**돼 있었다. 면제는 "지금 green을 만들기
// 위해" 추가되고 **그 뒤 아무도 걷어내지 않는다.** 제보자의 자기관찰이 이 축의 근거다 — 새 게이트를
// 세우자 결손 1건이 표면화됐고 그의 반사적 선택지가 "면제해서 green 만들기"였다. 오너가 그것을
// 막았다("왜 필요할 때는 제외시키면 안 되지"). **게이트를 세우는 순간이 면제 유혹이 가장 큰 시점**
// 이므로 래칫이 필요하다.
//
// ⚠ 면제를 한 종류로 다루지 않는다. 두 종류이고 **요구 필드가 다르다**:
//   · boundary — 구조적 경계(미소유 파일 카테고리 등). 영구이고 기한이 없다.
//                기한을 요구하면 **거짓 날짜**가 생기고, 거짓 날짜는 날짜 없음보다 나쁘다.
//                대신 "왜 영구인가"를 요구한다.
//   · debt     — 임시 부채. 제보가 요구한 4필드(사유·해소조건·기한·위험수용자) 전부 필수.
// 종류 미선언은 위반이다 — 분류를 강제해야 "급할 때 debt를 boundary로 위장"이 흔적을 남긴다.
export const EXEMPTION_KINDS = Object.freeze(["boundary", "debt"]);

// 면제 knob은 **이름 규약으로 자동 탐지**한다. 손 목록을 두면 새 면제 knob이 감시 밖에서
// 태어난다 — 강도 래칫이 이미 그 드리프트를 겪었다(`outOfBandDeployPolicy` 등 도입 시 누락).
const EXEMPTION_KNOB_RE = /(Exempt|Exception)/;
// 예외 선언 knob의 정본 이름 — 개수 래칫의 자기참조 출구(아래 classifyExemptionRatchet 주석).
export const RATCHET_EXCEPTION_KNOB = "policyRatchetExceptions";
export function exemptionKnobs(cfg, declared = null) {
  if (Array.isArray(declared) && declared.length) return [...declared].sort();
  return Object.keys(cfg || {}).filter((k) => EXEMPTION_KNOB_RE.test(k)).sort();
}

// knob 값 → 면제 항목 문자열 목록. 배열·객체(키가 항목)·null을 받는다.
export function exemptionEntries(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object") return Object.keys(value);
  return [];
}

// 항목별 등록부 레코드 검증. 반환 findings[] — kind: unregistered | bad-kind | missing-field
// registry: { "<knob>": { "<항목>": {kind, reason, clearBy, due, acceptor, whyPermanent} } }
export function exemptionFindings(cfg, registry, declaredKnobs = null) {
  const findings = [];
  const reg = registry && typeof registry === "object" ? registry : {};
  for (const knob of exemptionKnobs(cfg, declaredKnobs)) {
    const entries = exemptionEntries(cfg[knob]);
    const perKnob = (reg[knob] && typeof reg[knob] === "object") ? reg[knob] : {};
    for (const entry of entries) {
      const rec = perKnob[entry];
      if (!rec || typeof rec !== "object") {
        findings.push({ kind: "unregistered", knob, entry });
        continue;
      }
      const k = String(rec.kind || "");
      if (!EXEMPTION_KINDS.includes(k)) {
        findings.push({ kind: "bad-kind", knob, entry, got: k });
        continue;
      }
      // 종류별 요구 필드 — debt는 제보가 요구한 4종, boundary는 사유 + 영구 근거.
      const need = k === "debt"
        ? ["reason", "clearBy", "due", "acceptor"]
        : ["reason", "whyPermanent"];
      for (const f of need) {
        if (!String(rec[f] ?? "").trim()) findings.push({ kind: "missing-field", knob, entry, field: f, exKind: k });
      }
    }
    // 등록부에만 남은 레코드 — 면제는 지웠는데 기록이 남았다. 위반은 아니지만 부패의 시작이므로 표면화.
    for (const entry of Object.keys(perKnob)) {
      if (!entries.includes(entry)) findings.push({ kind: "stale-record", knob, entry });
    }
  }
  return findings;
}

// 개수 래칫 — **줄어드는 방향만 허용한다.** base보다 늘면 위반이다.
// 정당한 신규 면제가 필요하면 다른 면제를 걷어내거나 `policyRatchetExceptions`에 그 knob을
// 선언한다(그 선언 자체가 부채로 표면화되므로 조용한 증가가 되지 않는다).
export function classifyExemptionRatchet(baseCfg, curCfg, declaredKnobs = null, exceptions = []) {
  const ex = new Set(exceptions || []);
  const grown = [], allowedGrowth = [];
  const knobs = new Set([
    ...exemptionKnobs(baseCfg || {}, declaredKnobs),
    ...exemptionKnobs(curCfg || {}, declaredKnobs),
  ]);
  for (const knob of [...knobs].sort()) {
    // ⚠ 예외 선언 자체는 개수 래칫에서 뺀다 — **교착의 해소는 캡을 푸는 것이 아니라 출구를 만드는
    //    것이다.** 정당한 롤백을 선언하려면 이 목록에 항목을 넣어야 하는데, 그 증가를 막으면 남는
    //    길은 "조용히 하는 것"뿐이고 그게 더 나쁘다. 무한정 자라지 않는 이유는 따로 있다:
    //    이 목록의 항목도 debt 4필드(사유·해소조건·기한·수용자)를 요구받고 매 실행 부채로
    //    표면화된다 — 증가가 자유로운 것이 아니라 **큰 소리로 책임지는 것**이다.
    if (knob === RATCHET_EXCEPTION_KNOB) continue;
    if (!baseCfg || !(knob in baseCfg)) continue;         // base 기준 없음 — 하위호환
    const from = exemptionEntries(baseCfg[knob]).length;
    const to = exemptionEntries(curCfg ? curCfg[knob] : undefined).length;
    if (to > from) (ex.has(knob) ? allowedGrowth : grown).push({ knob, from, to });
  }
  return { grown, allowedGrowth };
}

// ─── 구조적 knob 래칫 (SPEC-027 확장, 이슈 #21 A-3) ──────────────────────────
// 강도(off/advisory/hard)도 상한(RATCHETED_LIMITS)도 면제 개수(exemption ratchet)도
// 아닌 네 번째 축 — "감시·강제의 범위 자체"를 정의하는 knob. 실측(이슈 #21 A-3):
// `policyRatchetPolicy: hard`를 유지한 채로 21개 knob(entityRegistry:{}·ignoreDirs+=
// "src"·specDir 재지정 등)을 한 커밋에 바꿔도 `violations:0 · exit 0` — 이 축을 보는
// 코드가 없었다. 세 모양으로 나뉜다(각각 "완화"의 방향이 다르다):
//
//   (a) 원소가 줄면 완화 — 등록·허용 목록이 비워지면(또는 줄면) 그 목록이 강제하던 항목의
//       보호가 사라진다. entityRegistry({}로 붕괴 = 등록 요구 전체 비활성),
//       relationTypes([]=무제한 — 감사로 교정된 전제: 무제한인 것은 이 knob뿐),
//       strictSpecs(제거된 spec은 그 즉시 strict 미적용), testFileRegex(패턴이 줄면
//       그만큼 파일이 "테스트 아님"으로 검증 회계에서 빠진다).
//   (b) 원소가 늘면 완화 — 배제·정당화 범위가 넓어질수록 게이트가 보지 않는 표면이 커진다.
//       ignoreDirs(순회 자체에서 제외 — 위반을 "안 본 것"으로 만든다),
//       retiredIds(번호 결번 정당화 사유가 임의로 늘면 진짜 결번과 구분할 신호가 없다).
//   (c) 포인터/리다이렉션 knob — "약해짐"의 방향 자체가 없다(개명은 정당할 수 있다).
//       그러나 이 값이 강제 지점을 결정하므로 base 대비 **변경 자체**를 표면화해야 한다
//       (완전 차단이 아니라 확인 요구 — policyRatchetExceptions로 승인하면 조용해진다,
//       기존 강도·상한 래칫과 같은 탈출구). specDir(스펙 디렉터리 재지정으로 판정 대상
//       축소) · smokeManifest/derivationManifest(null로 되돌리면 그 회계가 게이트
//       no-op) · specSyncBase(base ref를 조작하면 diff 자체가 빈다) · commands.test
//       ("true" 같은 무판정 명령으로 교체하면 runTests hard가 항상 green).
//
// capabilityVerbs는 의도적으로 이 목록에서 뺐다 — growth 자체가 "동사 등록"이라는
// 정상 행위와 구분 안 되고, 그 정합적 해소(사유 필드 승격 + 미등록 hard화)는 별도
// 과제(이슈 #21 E-5/E-6)의 몫이라 여기서 손대면 두 해법이 겹친다.
export const RATCHETED_SETS_SHRINK = ["entityRegistry", "relationTypes", "strictSpecs", "testFileRegex"];
export const RATCHETED_SETS_GROW = ["ignoreDirs", "retiredIds"];
export const RATCHETED_POINTERS = ["specDir", "smokeManifest", "derivationManifest", "specSyncBase", "commands.test"];

function pointerValue(cfg, dotted) {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), cfg);
}

// 배열은 length, 객체(레지스트리류)는 키 개수, 그 외(null 등)는 0 — RATCHETED_LIMITS의
// numOf와 동형으로 "판정 가능한 크기"만 뽑는다.
function setSize(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return 0;
}

// base config 대비 current config에서 감시 표면이 좁아진 knob을 분류한다.
// classifyRatchet·classifyExemptionRatchet과 같은 모양(violations/allowedDowngrades,
// exceptions는 policyRatchetExceptions 재사용) — 세 번째 래칫이 아니라 같은 래칫의 확장이다.
export function classifyStructuralRatchet(baseCfg, curCfg, exceptions = []) {
  const ex = new Set(exceptions || []);
  const violations = [];
  const allowedDowngrades = [];
  const push = (knob, from, to, kind) => {
    const rec = { knob, from, to, kind };
    (ex.has(knob) ? allowedDowngrades : violations).push(rec);
  };
  for (const knob of RATCHETED_SETS_SHRINK) {
    if (!baseCfg || !(knob in baseCfg)) continue; // base 미존재 = 래칫 기준 없음(하위호환)
    const from = setSize(baseCfg[knob]);
    const to = setSize(curCfg ? curCfg[knob] : undefined);
    if (to < from) push(knob, from, to, "set-shrink");
  }
  for (const knob of RATCHETED_SETS_GROW) {
    if (!baseCfg || !(knob in baseCfg)) continue;
    const from = setSize(baseCfg[knob]);
    const to = setSize(curCfg ? curCfg[knob] : undefined);
    if (to > from) push(knob, from, to, "set-grow");
  }
  for (const knob of RATCHETED_POINTERS) {
    const from = baseCfg ? pointerValue(baseCfg, knob) : undefined;
    if (from === undefined) continue; // base가 이 포인터를 모르면 판정 밖(하위호환)
    const to = pointerValue(curCfg || {}, knob);
    if (JSON.stringify(from) !== JSON.stringify(to)) push(knob, from, to, "pointer-changed");
  }
  return { violations, allowedDowngrades };
}

export const STRUCTURAL_FINDING_TEXT = Object.freeze({
  "set-shrink": "감시·강제 대상 집합이 줄었다 — 래칫은 늘어나는(또는 유지되는) 방향만 허용한다",
  "set-grow": "배제·정당화 범위가 늘었다 — 그만큼 게이트가 보지 않는 표면이 커진다",
  "pointer-changed": "강제 지점을 결정하는 값이 base 대비 바뀌었다 — 정당한 개명일 수 있으나 확인 없이 조용히 넘어가지 않는다",
});

export const EXEMPTION_FINDING_TEXT = Object.freeze({
  unregistered: "면제가 **사유·분류 없이** 존재한다 — `exemptionRegistry`에 등록하라(넷이 없는 면제는 이월이 아니라 방치다)",
  "bad-kind": `면제 종류가 ${EXEMPTION_KINDS.join("|")} 중 하나가 아니다 — boundary(구조적·영구) / debt(임시 부채)로 분류하라`,
  "missing-field": "면제 레코드에 필수 필드가 없다",
  "stale-record": "등록부에만 남은 레코드 — 면제는 걷어냈는데 기록이 남았다(등록부 부패의 시작)",
});
