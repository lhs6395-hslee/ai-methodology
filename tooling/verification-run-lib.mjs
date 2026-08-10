// 검증 **실행** 회계 — 선언된 증거가 실제로 돌았는가 (SPEC-041)
//
// 실측 제보(2026-08-10) — 검증 절차가 세 번 조용히 사라졌다:
//   ① 에이전트가 "재현 데이터가 없다"며 실측을 중도 포기했는데 어떤 게이트도 걸리지 않았다.
//   ② 검증 러너가 대상 0건으로 exit 0 종료해 "성공"과 "아무것도 안 함"이 구분되지 않았다.
//   ③ 배포 훅 Job이 참조 이미지가 없어 **한 번도 뜨지 않았고**(ECR 리포조차 없음),
//      비차단 스테이지라 파이프라인은 SUCCESS로 초록이었다.
// 공통 원인: 기존 게이트는 spec↔code 정합만 본다. **런타임에 검증이 실제로 수행됐는지**는
// 아무도 검사하지 않았고, 그래서 "무행동"이 "성공"과 동형이 됐다.
//
// SPEC-031(실행 증거)은 `[검증: <경로>]`가 **실재하는 자산**을 지목하는지까지 본다 — 파일이
// 거기 있는가. 이 층은 그다음 질문이다: **그 자산이 돌았는가.** 존재는 실행이 아니다.
// (SPEC-040이 게이트 자신에게 물은 질문을, 게이트 **밖의** 검증 절차에 묻는 것이다.)
//
// 계약: 프로젝트가 실행 원장(JSONL)을 남기고 이 층이 선언된 증거와 대조한다.
//   {"asset":"tests/e2e/login.spec.ts","outcome":"JUDGED","detail":"12 passed","at":"2026-08-10T04:00:00Z"}
//   {"asset":"sdd/verification/BROWSER-SMOKE.md","outcome":"SKIPPED","detail":"스테이징 계정 미발급"}
// `outcome`은 **SPEC-040의 다섯 종류를 그대로** 쓴다 — 게이트와 검증 절차가 같은 어휘로 말하지
// 않으면 "안 봤다"가 두 가지 뜻을 갖게 되고, 두 뜻은 언젠가 갈라진다.

import { VERDICT_KINDS } from "./verdict-lib.mjs";

// 원장 한 줄 파싱. 반환 {asset, outcome, detail, at} | {malformed, raw, why}.
// ⚠ 깨진 줄을 **버리지 않는다** — 버리면 "기록했는데 형식이 틀림"이 "기록 안 함"과 같아지고,
// 그건 이 층이 막으려는 침묵과 정확히 같은 모양이다.
export function parseRunLine(raw) {
  const line = String(raw || "").trim();
  if (!line || line.startsWith("#")) return null;   // 빈 줄·주석은 기록이 아니다
  let o;
  try { o = JSON.parse(line); } catch { return { malformed: true, raw: line, why: "JSON 아님" }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { malformed: true, raw: line, why: "객체 아님" };
  const asset = String(o.asset || "").trim();
  const outcome = String(o.outcome || "").trim().toUpperCase();
  const detail = String(o.detail || "").trim();
  // **종류가 다른 기록은 깨진 기록이 아니다.** 한 원장에 자산 기록(`asset`)과 분기 발화 기록
  // (`branch`, SPEC-049)이 함께 산다 — 원장을 둘로 나누면 한쪽만 갱신돼 두 회계가 갈라진다.
  // 그래서 상대 종류는 **조용히 건너뛴다**. 실측: 이 구분 없이 분기 기록을 넣자 자산 축이
  // 그것을 "asset 없음"으로 세어 hard에서 거짓 차단이 났다(같은 파일을 두 파서가 볼 때의 기본 계약).
  if (!asset && String(o.branch || "").trim()) return null;
  if (!asset) return { malformed: true, raw: line, why: "asset·branch 둘 다 없음 — 무엇에 대한 기록인지 알 수 없다" };
  if (!Object.hasOwn(VERDICT_KINDS, outcome)) {
    return { malformed: true, raw: line, why: `outcome "${o.outcome}" — ${Object.keys(VERDICT_KINDS).join("|")} 중 하나` };
  }
  // **포기는 허용하되 침묵은 금지한다** — 안 본 것을 기록하면서 사유를 안 적으면 기록이 아니다.
  if (outcome !== VERDICT_KINDS.JUDGED && !detail) {
    return { malformed: true, raw: line, why: `${outcome}에 detail(사유) 없음 — 포기는 허용하되 사유 없는 포기는 기록이 아니다` };
  }
  return { asset, outcome, detail, at: String(o.at || "").trim() };
}

export function parseRunLedger(text) {
  const entries = [], malformed = [];
  for (const raw of String(text || "").split("\n")) {
    const p = parseRunLine(raw);
    if (!p) continue;
    (p.malformed ? malformed : entries).push(p);
  }
  return { entries, malformed };
}

// 자산 경로 ↔ 원장 항목 매칭. 매칭 폭은 SPEC-031의 증거 경로 인정 폭과 **같다** —
// 정확 일치 · 글롭 · 디렉토리 지목. 좁히면 정당한 스위트 지목이 거짓 미실행이 된다.
// matcher: (pattern) => RegExp — 글롭 컴파일은 호출자가 주입한다(순수성 유지).
function covers(entryAsset, path, matcher) {
  const a = entryAsset.replace(/\/+$/, "");
  if (a === path) return true;
  if (path.startsWith(a + "/")) return true;              // 디렉토리 지목
  if (/[*?[\]]/.test(entryAsset)) { try { return matcher(entryAsset).test(path); } catch { return false; } }
  return false;
}

// 선언된 증거 경로 목록 × 원장 → 갈래별 분류.
//   executed  — JUDGED 기록이 있다(실제로 돌았다)
//   debt      — 안 봤다는 기록이 **사유와 함께** 있다(포기는 허용 — 표면화하되 차단 않음)
//   silent    — 아무 기록도 없다. **이것이 ①이다** — 조용히 사라진 검증.
// 같은 자산에 여러 기록이 있으면 **마지막이 유효**하다(원장은 append-only 로그다).
// envBound: { <glob>: <사유> } — **이 환경에서는 돌 수 없다**고 config에 durable하게 선언한 자산.
// 원장은 세션·CI 로컬 상태(gitignore)라 "여기선 못 돈다"는 항구적 사실을 담을 수 없다: 체크아웃마다
// 다시 적어야 하고, 그 번거로움이 곧 사람이 정책을 끄는 이유가 된다(실측 교착: 킷의 CI 워크플로는
// GitHub Actions에서만 돌아 로컬 스윕이 영구히 붉었다).
// ⚠ 이것은 **면제가 아니다** — 실행됨으로 세지 않고 사유 있는 부채로 계상해 매 실행 표면화한다.
// 바뀌는 것은 "침묵 → 사유 있는 미실행"뿐이고, 실제 실행 기록이 있으면 그쪽이 이긴다.
export function classifyRuns(evidencePaths, entries, matcher, envBound = {}) {
  const executed = [], debt = [], silent = [];
  const bounds = Object.entries(envBound || {});
  for (const path of evidencePaths) {
    let hit = null;
    for (const e of entries) if (covers(e.asset, path, matcher)) hit = e;   // 마지막 승
    if (!hit) {
      const b = bounds.find(([glob]) => covers(glob, path, matcher));
      if (b && String(b[1] || "").trim()) {
        debt.push({ path, entry: { asset: b[0], outcome: VERDICT_KINDS.INERT, detail: `${String(b[1]).trim()} (환경 결속 선언)`, at: "" } });
        continue;
      }
      silent.push(path);
      continue;
    }
    if (hit.outcome === VERDICT_KINDS.JUDGED) executed.push({ path, entry: hit });
    else debt.push({ path, entry: hit });
  }
  return { executed, debt, silent };
}

// 강도 처분. **차단하는 것은 침묵과 깨진 기록뿐이다** — 사유 있는 포기는 어떤 강도에서도
// 막지 않는다(막으면 사람이 사유를 지어내고, 그 순간 원장이 거짓말을 담기 시작한다).
export function verificationRunVerdict(policy, { silent, malformed }) {
  const blocking = policy === "hard" && (silent.length > 0 || malformed.length > 0);
  return { blocking, violations: silent.length + malformed.length };
}

// 원장 한 줄 직렬화 — 기록기(게이트 `--record`·프로젝트 스크립트)가 공유한다.
// `at`은 호출자가 준다(순수성 — 이 코어는 시계를 읽지 않는다).
export function formatRunLine({ asset, outcome, detail = "", at = "" }) {
  return JSON.stringify({ asset: String(asset), outcome: String(outcome).toUpperCase(), detail: String(detail), at: String(at) });
}
