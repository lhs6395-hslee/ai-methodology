// tooling/process-ssot-lib.mjs
// 순차 프로세스 SSOT 판정 순수 코어 (SPEC-047) — **여러 스펙에 걸친 사슬은 아무도 소유하지 않는다.**
//
// 실측 제보(2026-08-10, 사례 5): close-out 사슬이 8단계인데 조각이 6개 문서에 흩어져 있고 전
// 구간을 담은 문서가 **없었다**. "로컬 실측"과 "교차검증"은 한 스펙에, "dev-done"과 "리포터"는
// 다른 넷에, "브랜치·배포 순서"는 또 다른 둘에 있었다. 어느 문서를 읽어도 사슬의 일부만 보이므로
// 세션마다 flow를 재구성하고, 매번 다른 곳이 빠졌다.
//
// 그리고 그 흩어짐이 코드에 그대로 나타났다. 교차검증 함수가:
//   if (!peers.length) return { agree: true, … };   // 상대 기록 없으면 통과
// 게다가 양쪽 실행의 판정 기록이 **만날 저장소가 아예 없었다** — 로컬은 작업 디렉터리, 클러스터
// Job은 볼륨 없는 파드의 `/tmp`. 그 교차검증은 단 한 번도 비교를 수행한 적이 없고, 소유자가
// 결정한 "교차검증 일치 시에만 전이"는 명세에만 존재했다. 저장소 요구는 어느 FR에도 없고 코드
// 주석에만 있었다(인프라 산출물인데 인프라 스펙 밖이라 그쪽 리뷰에서도 빠졌다).
//
// 두 사실을 각각 기계가 본다:
//   ① **전 구간 소유** — 선언된 단계 전부가 SSOT 문서 하나에 있어야 한다. 그리고 단계를 둘 이상
//      담은 다른 문서는 SSOT를 **참조**해야 한다(조각 보유자는 전체를 가리켜야 한다).
//   ② **영속 상태의 실재** — 실행 사이의 비교·합의를 요구하는 단계는 그 기록이 만날 **저장소를
//      선언**해야 하고, 선언된 저장소는 어느 스펙이든 **소유**해야 한다. 소유되지 않은 저장소는
//      "인프라 스펙 밖의 인프라 산출물"이고, 그게 제보가 겪은 정확한 모양이다.
//
// 무엇을 판정하지 않는가: 사슬의 순서가 옳은지, 각 단계의 정의가 충분한지 — 그건 리뷰의 몫이다
// (존재는 기계, 질은 리뷰). 그리고 프로세스 **미선언**이면 아무것도 판정하지 않는다: 순차 사슬이
// 없는 프로젝트에 사슬을 요구하면 그건 거짓 요구다.
//
// 순수 함수(IO 없음) — 파일 읽기·소유 해석은 소비 게이트. Python 미러(SPEC-006).

// 사슬의 조각을 담을 수 있는 문서 종류 — 게이트에 박지 않고 여기서 선언한다(프로젝트는
// `processDocRegex`로 교체). `.rst`·`.adoc`으로 문서를 쓰는 프로젝트에서 사슬이 통째로 안 보이는
// 일을 막는다.
export const DEFAULT_PROCESS_DOC_REGEX = "\\.(md|markdown|html|rst|adoc|txt)$";

// 실행 사이의 **비교·합의**를 요구하는 단계 마커. 이 마커가 걸리면 영속 저장소를 선언해야 한다 —
// 비교는 두 기록이 같은 자리에서 만나야 성립하고, 만날 자리가 없으면 그 비교는 수행된 적이 없다.
export const DEFAULT_STATEFUL_STAGE_MARKERS = [
  "교차검증", "교차 검증", "대조", "비교", "합의", "일치", "집계", "취합",
  "cross-check", "crosscheck", "cross check", "reconcile", "compare", "agree", "aggregate",
];

// 단계 선언 정규화 — 문자열이면 이름만, 객체면 {name, state}.
export function stageOf(entry) {
  if (typeof entry === "string") return { name: entry, state: "" };
  return { name: String((entry || {}).name ?? ""), state: String((entry || {}).state ?? "").trim() };
}

export function stagesOf(proc) {
  return ((proc || {}).stages || []).map(stageOf).filter((s) => s.name);
}

// config 형식 검증 — 정의되지 않은 형태를 조용히 통과시키면 선언이 무의미해진다.
export function validateProcesses(processes) {
  const errors = [];
  for (const [name, proc] of Object.entries(processes || {})) {
    if (!proc || typeof proc !== "object" || Array.isArray(proc)) {
      errors.push(`processes["${name}"] — 객체여야 한다({ ssot, stages })`); continue;
    }
    if (!String(proc.ssot ?? "").trim()) errors.push(`processes["${name}"].ssot — 전 구간을 담는 문서 경로 필수(빈 값은 소유자 없음과 같다)`);
    const stages = stagesOf(proc);
    if (stages.length < 2) errors.push(`processes["${name}"].stages — 2단계 이상 선언 필수(1단계는 사슬이 아니다)`);
  }
  return errors;
}

// ① SSOT 문서에 없는 단계(선언 순). 단계 이름은 **문자 그대로** 찾는다 — 이름이 문서에 없으면
//    그 문서는 전 구간을 담지 않았다. 표기가 다르면 선언을 문서에 맞추는 것이 해소다.
export function ssotMissingStages(ssotText, stages) {
  const s = String(ssotText || "");
  return (stages || []).filter((st) => !s.includes(st.name)).map((st) => st.name);
}

// ① 조각 보유 문서 — 단계를 minStages개 이상 담았는데 SSOT를 참조하지 않는 문서.
//    docs: [{path, text}]. ssotPath는 그 자신이므로 제외한다.
//    "참조"는 SSOT 경로 문자열의 등장으로 본다(새 문법 없음 — 링크든 산문이든 경로를 적으면 된다).
export function fragmentFindings(docs, stages, ssotPath, minStages = 2) {
  const names = (stages || []).map((s) => s.name);
  const out = [];
  for (const d of docs || []) {
    if (!d || d.path === ssotPath) continue;
    const text = String(d.text || "");
    const held = names.filter((n) => text.includes(n));
    if (held.length < minStages) continue;
    if (text.includes(ssotPath)) continue;              // 전체를 가리키고 있다
    out.push({ path: d.path, stages: held });
  }
  return out;
}

// ② 비교·합의를 요구하는데 저장소를 선언하지 않은 단계.
export function statelessStageFindings(stages, markers) {
  const list = markers && markers.length ? markers : DEFAULT_STATEFUL_STAGE_MARKERS;
  return (stages || [])
    .filter((st) => !st.state && list.some((m) => st.name.toLowerCase().includes(String(m).toLowerCase())))
    .map((st) => st.name);
}

// ② 선언됐는데 아무 스펙도 소유하지 않는 저장소. isOwned(path) → boolean (게이트 주입).
export function unownedStateFindings(stages, isOwned) {
  const own = typeof isOwned === "function" ? isOwned : () => true;
  return (stages || []).filter((st) => st.state && !own(st.state)).map((st) => ({ stage: st.name, state: st.state }));
}

// ─── 불변식 강제 여부 (4번째 축) ────────────────────────────────────────────
// 사슬(stages)과 별개로, SSOT 문서는 흔히 그 사슬을 지키는 "불변식"도 함께 선언한다
// (예: CLOSEOUT_FLOW.md의 "사슬을 지키는 불변식" 절). 불변식은 stage가 아니다 — 순서상의
// 한 단계가 아니라 사슬 전체에 걸리는 규칙이다. 이 규칙이 실제로 코드로 강제되는지, 강제
// 안 된다면 그 사실이 최소한 명시적으로 선언됐는지를 본다. "강제한다고 적혀 있는데 그
// 파일이 없다"·"강제됐는데 문서는 여전히 임시 규칙이라고 말한다" 둘 다 놓치면 안 되는
// 드리프트다 — 소비 프로젝트 실측: CLOSEOUT_FLOW.md의 불변식 F가 "qa-agent가 실측을 완전히
// 대체하기 전까지 유효한 임시 규칙"이라는 문구로 몇 주간 머물렀고, 그 사이 강제 코드가
// 생겼는지 여부를 문서만 봐서는 알 수 없었다.

// 불변식 선언 정규화 — 문자열이면 이름만(강제 없음), 객체면 {name, enforcement}.
// enforcement는 문자열(강제 스크립트 경로) 또는 null/생략(명시적 미강제) 이어야 한다.
export function invariantOf(entry) {
  if (typeof entry === "string") return { name: entry, enforcement: null };
  const e = entry || {};
  const raw = e.enforcement;
  return { name: String(e.name ?? ""), enforcement: raw === undefined || raw === null ? null : String(raw) };
}

export function invariantsOf(proc) {
  return ((proc || {}).invariants || []).map(invariantOf).filter((i) => i.name);
}

// config 형식 검증 — enforcement에 문자열·null·undefined 외의 타입을 조용히 통과시키지 않는다.
export function validateInvariants(invariants) {
  const errors = [];
  for (const raw of invariants || []) {
    const isObj = raw && typeof raw === "object" && !Array.isArray(raw);
    const name = typeof raw === "string" ? raw : isObj ? String(raw.name ?? "") : "";
    if (!name.trim()) { errors.push(`invariants[] — name 필수(빈 값은 규칙 없음과 같다)`); continue; }
    if (isObj && "enforcement" in raw) {
      const enf = raw.enforcement;
      if (enf !== null && typeof enf !== "string") {
        errors.push(`invariants["${name}"].enforcement — 문자열(강제 스크립트 경로) 또는 null이어야 한다`);
      }
    }
  }
  return errors;
}

// 불변식 이름도 단계 이름과 같은 원칙 — SSOT 문서에 문자 그대로 없으면 그 문서는 이 불변식을
// 담지 않은 것이다(동의어 추정 없음, 표기 불일치의 해소는 선언을 문서에 맞추는 것).
export function ssotMissingInvariants(ssotText, invariants) {
  const s = String(ssotText || "");
  return (invariants || []).filter((iv) => !s.includes(iv.name)).map((iv) => iv.name);
}

// enforcement가 선언됐는데 그 파일이 저장소에 실재하지 않으면 위반 — "강제한다"는 주장이
// 거짓이다. fileExists(path) → boolean (게이트 주입, 코어는 I/O 없음).
export function unenforcedInvariantFindings(invariants, fileExists) {
  const exists = typeof fileExists === "function" ? fileExists : () => true;
  return (invariants || [])
    .filter((iv) => iv.enforcement && !exists(iv.enforcement))
    .map((iv) => ({ name: iv.name, enforcement: iv.enforcement }));
}

// enforcement가 선언됐는데 그 경로 문자열이 SSOT 문서 본문 어디에도 없으면 위반 — config는
// "코드로 강제된다"고 아는데 사람이 읽는 문서는 그 사실을 말하지 않는 드리프트(문서가
// "임시 규칙"이라고 계속 말하는 동안 코드는 이미 강제하고 있었던 실측 사례가 근거).
export function staleEnforcementMentionFindings(ssotText, invariants) {
  const s = String(ssotText || "");
  return (invariants || [])
    .filter((iv) => iv.enforcement && !s.includes(iv.enforcement))
    .map((iv) => ({ name: iv.name, enforcement: iv.enforcement }));
}
