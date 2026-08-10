// tooling/branch-observation-lib.mjs
// 실행 관측 회계 순수 코어 (SPEC-049) — **차단 분기가 필드에서 발화한 적이 있는가.**
//
// 실측 제보(2026-08-10, 사례 6): 어떤 프로젝트의 QA 러너에 "로컬·개발 판정이 일치할 때만
// 전이한다"는 규칙이 있었고 **명세·구현·단위테스트가 모두 정상**이었다:
//     상대 기록 불일치 → 마감 금지  ✓ (테스트 통과)
//     상대 기록 일치   → 마감 허용  ✓ (테스트 통과)
// 그런데 판정 기록의 저장 위치가 로컬은 작업 디렉터리, 클러스터 Job은 볼륨 없는 파드의 `/tmp`
// 였다. 두 기록이 만날 저장소가 아예 없었으므로 **그 교차검증은 단 한 번도 비교를 수행한 적이
// 없다.** 소유자 결정으로 도입된 규칙이 몇 달간 명세에만 존재했다.
//
// 결함은 **배선**에 있었고 코드를 읽는 어떤 검증기도 "정상"이라 답했을 것이다 — 정적 검사로는
// 원리상 잡히지 않는다. 그런데 증거는 이미 매 실행 로그에 있었다:
//     교차검증: 상대 환경 판정 기록 없음 — 대조 생략
// "생략"이 통과처럼 읽혔고, **그 값이 몇 달간 한 번도 달라지지 않았다는 사실**을 신호로 읽는
// 장치만 없었다. 이 코어가 그 장치다.
//
// 세 가지를 각각 다른 사실로 회계한다 — 셋을 한 갈래로 묶으면 해소 방법이 섞인다:
//   · **미관측**(기록 자체가 0건)   — 배선이 아직 없다. 러너가 `--record-branch`를 부르게 하라.
//   · **미발화**(기록은 있는데 FIRED 0회) — 차단 경로가 한 번도 돌지 않았다. 제보의 결함이 이것이다.
//   · **단조**(사유가 한 종류뿐)     — 값이 한 번도 달라진 적이 없다. 배선이 죽었을 개연성이 높다.
//
// ⚠ 이 축은 **어떤 강도에서도 차단하지 않는다.** 원장은 세션·CI 로컬 상태라 신선한 체크아웃에서
// 비어 있는 것이 정상이고(SPEC-041), 그 상태를 벽으로 막으면 사람이 정책을 통째로 끈다. 대신
// **매 실행 부채로 표면화**한다 — 이 결함이 몇 달을 살아남은 이유가 정확히 "표면화되지 않음"이었다.
//
// 순수 함수(IO 없음) — 원장 읽기·기록은 소비 게이트. Python 미러(SPEC-006).

// 분기 발화 결과의 어휘. `FIRED`만이 "차단 경로가 실제로 돌았다"를 뜻한다 —
// 나머지는 그 실행에서 그 분기가 발화하지 않았다는 참인 진술이다.
export const BRANCH_OUTCOMES = Object.freeze(["FIRED", "PASSED", "SKIPPED"]);

// 원장의 **분기 기록** 한 줄 — `{"branch":"<키>","outcome":"FIRED","detail":"…"}`.
// 자산 기록(SPEC-041의 `asset`)과 **다른 종류**다: 자산은 "이 파일이 돌았나", 분기는 "이 조건이
// 발화했나"다. 한 원장에 섞여 있어도 키 이름으로 갈린다(같은 파일에 두 사실을 담는 것이 설계다 —
// 원장이 둘이면 한쪽만 갱신돼 두 회계가 갈라진다).
export function parseBranchLine(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let o;
  try { o = JSON.parse(s); } catch { return { broken: true, raw: s }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { broken: true, raw: s };
  const branch = String(o.branch ?? "").trim();
  if (!branch) return null;                      // 분기 기록이 아니다(자산 기록일 수 있다)
  const outcome = String(o.outcome ?? "").trim();
  const detail = String(o.detail ?? "").trim();
  if (!BRANCH_OUTCOMES.includes(outcome)) return { broken: true, raw: s, branch };
  return { branch, outcome, detail };
}

export function parseBranchLedger(text) {
  const entries = [], broken = [];
  for (const line of String(text || "").split("\n")) {
    const p = parseBranchLine(line);
    if (!p) continue;
    if (p.broken) { broken.push(p); continue; }
    entries.push(p);
  }
  return { entries, broken };
}

// 판정 — declared: { "<키>": "<이 분기가 무엇을 막는가>" }, entries: parseBranchLedger의 결과.
// 반환 [{key, reason, records, fired, details, cls}](키 정렬).
//   cls: "observed" | "unobserved" | "never-fired" | "monotone"
export function classifyBranches(declared, entries) {
  const byKey = new Map();
  for (const e of entries || []) {
    if (!byKey.has(e.branch)) byKey.set(e.branch, []);
    byKey.get(e.branch).push(e);
  }
  const out = [];
  for (const key of Object.keys(declared || {}).sort()) {
    const recs = byKey.get(key) || [];
    const fired = recs.filter((r) => r.outcome === "FIRED").length;
    const details = [...new Set(recs.map((r) => r.detail))];
    let cls;
    if (!recs.length) cls = "unobserved";
    else if (!fired) cls = "never-fired";
    // 단조 — 기록이 여러 번인데 사유가 한 종류뿐이면 값이 한 번도 달라진 적이 없다.
    // 1회 기록은 단조라 부를 수 없다(변할 기회가 없었다) — 2회 이상에서만 신호로 읽는다.
    else if (recs.length >= 2 && details.length === 1) cls = "monotone";
    else cls = "observed";
    out.push({ key, reason: String(declared[key] ?? ""), records: recs.length, fired, details: details.length, cls });
  }
  return out;
}

// 선언되지 않은 키로 기록된 것 — 낡은 러너이거나 오타다. 조용히 버리면 그 기록은 없는 것과 같다.
export function undeclaredBranches(declared, entries) {
  const known = new Set(Object.keys(declared || {}));
  return [...new Set((entries || []).map((e) => e.branch))].filter((b) => !known.has(b)).sort();
}

// config 형식 검증 — 사유 없는 선언은 "무엇을 막는 분기인지" 모르는 선언이다.
export function validateBranchDeclarations(declared) {
  const errors = [];
  for (const [key, reason] of Object.entries(declared || {})) {
    if (!String(reason ?? "").trim()) {
      errors.push(`blockingBranches["${key}"] — 사유 필수(이 분기가 무엇을 막는가; 빈 값은 무언의 선언이다)`);
    }
  }
  return errors;
}

export function formatBranchLine({ branch, outcome, detail = "", at = "" }) {
  const o = { branch: String(branch), outcome: String(outcome) };
  if (detail) o.detail = String(detail);
  if (at) o.at = String(at);
  return JSON.stringify(o);
}

// 게이트가 자기 차단 분기의 발화를 남기는 편의 계층 — 파일 쓰기는 소비 게이트가 주입한다.
// 원장이 선언되지 않았으면 **아무 일도 하지 않는다**(원치 않는 프로젝트에 결합 0).
// ⚠ 순수 코어가 아니다(IO 주입형) — 그래서 append 함수를 인자로 받는다.
export function recordBranch(append, { branch, outcome, detail = "", at = "" }) {
  if (typeof append !== "function" || !branch || !BRANCH_OUTCOMES.includes(String(outcome))) return false;
  append(formatBranchLine({ branch, outcome, detail, at }) + "\n");
  return true;
}
