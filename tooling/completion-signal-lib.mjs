// tooling/completion-signal-lib.mjs
// 완료 판정의 **신호 강도** 순수 코어 (SPEC-055) — 무엇을 보고 "됐다"고 말했는가.
//
// 실측 제보(2026-08-10): 배포가 끝났는지를 **파생 신호로 판정했다.** 파이프라인 로그에 성공 줄이
// 있었고 CI 상태가 초록이었으므로 완료로 보고했는데, 실제로는 migrate Job이 실패해 배포 스테이지가
// 스킵된 상태였다. 로그와 상태는 **대상이 아니라 대상에 대한 이야기**다.
//
// ── 왜 별도의 축인가 ─────────────────────────────────────────────────────────
// SPEC-031(실행 증거)은 **증거 자산의 등급**을 본다 — 단위테스트인가 브라우저인가 배포본인가.
// 이 축은 **판정이 무엇을 관측했는가**를 본다. 둘은 직교한다: 브라우저 등급 자산이라도 그 실행
// 로그를 읽어 완료를 말하면 파생 신호이고, 초라한 셸 한 줄이라도 대상 상태를 직접 조회하면
// 대상 신호다. 등급이 높은 증거가 약한 신호로 소비되는 것이 정확히 제보가 겪은 형태다.
//
// ── 세 종류뿐이다 ────────────────────────────────────────────────────────────
// 넷째를 만들면 경계 판단이 필요해지고, 경계 판단이 필요한 분류는 급할 때 편한 쪽으로 기운다
// (SPEC-054의 3분류와 같은 이유).
//
// 순수 함수(IO 없음) — 명령 실행·config 읽기는 소비 게이트가 한다. Python 미러(SPEC-006).

// 강한 것이 먼저다 — 순서가 곧 등급이다(별도 랭크 표를 두면 둘이 갈라진다).
export const SIGNAL_KINDS = Object.freeze([
  // 대상을 **직접 조회한다** — 클러스터·DB·엔드포인트·파일시스템의 지금 상태.
  "target-state",
  // 대상에 **대한 이야기**를 읽는다 — 로그·CI 상태·저널·리포트·이슈 코멘트.
  "derived",
  // 사람·에이전트의 **진술** — "배포했습니다", "확인했습니다".
  "self-report",
]);

// 완료를 주장하려면 이 등급 이상이어야 한다. **파생 신호는 완료의 근거가 아니다.**
export const COMPLETION_MIN_SIGNAL = "target-state";

export function signalRank(kind) {
  const i = SIGNAL_KINDS.indexOf(String(kind || ""));
  return i < 0 ? -1 : SIGNAL_KINDS.length - i;      // 강할수록 큰 값, 미지값은 -1
}

// 선언 파싱 — 값이 없으면 **추정하지 않는다.** 기본값을 주면 그 기본값이 조용히 정답이 되고,
// 그 순간 이 축은 "선언을 요구하는 축"에서 "아무것도 요구하지 않는 축"이 된다.
export function parseSignal(value) {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

// 판정 — claims: [{ id, assertsCompletion:boolean, signal, why }]
// 반환 findings[] — kind: no-signal | bad-signal | weak-signal
//   no-signal   — 완료를 주장하는데 무엇을 봤는지 선언이 없다(가장 흔한 형태다)
//   bad-signal  — 종류가 열거 밖이다(오타는 조용한 무발화가 된다)
//   weak-signal — 파생·자기신고만으로 완료를 주장한다(제보가 겪은 형태 그대로)
export function completionFindings(claims, minSignal = COMPLETION_MIN_SIGNAL) {
  const need = signalRank(minSignal);
  const findings = [];
  for (const c of claims || []) {
    const id = String((c && c.id) || "").trim() || "(무명)";
    if (!c || !c.assertsCompletion) continue;        // 완료를 주장하지 않는 검사는 이 축의 대상이 아니다
    const sig = parseSignal(c.signal);
    if (!sig) { findings.push({ kind: "no-signal", id }); continue; }
    if (!SIGNAL_KINDS.includes(sig)) { findings.push({ kind: "bad-signal", id, got: sig }); continue; }
    if (signalRank(sig) < need) findings.push({ kind: "weak-signal", id, got: sig });
  }
  return findings;
}

// 사람이 읽는 한 줄 — 원인과 **해소 방법**을 같이 낸다.
export const SIGNAL_FINDING_TEXT = Object.freeze({
  "no-signal": "완료를 주장하는데 **무엇을 관측했는지 선언이 없다** — `signal`을 적어라"
    + `(${SIGNAL_KINDS.join(" | ")}). 기본값을 두지 않는 이유: 추정한 기본값은 조용히 정답이 된다`,
  "bad-signal": `신호 종류가 열거 밖이다(${SIGNAL_KINDS.join(" | ")}) — 오타는 **조용한 무발화**가 된다`,
  "weak-signal": "**파생 신호만으로 완료를 주장한다** — 로그·CI 상태·저널은 대상이 아니라 대상에 대한"
    + " 이야기다. 실측: 파이프라인 로그에 성공 줄이 있고 CI가 초록이어서 배포 완료로 보고했는데"
    + " migrate Job이 실패해 배포 스테이지가 스킵된 상태였다. 대상 상태를 직접 조회하는 검사를 하나 더해라",
});

// 신호 종류를 사람에게 설명하는 한 줄 — 게이트가 매 실행 무엇을 요구하는지 말한다.
export const SIGNAL_KIND_TEXT = Object.freeze({
  "target-state": "대상을 직접 조회한다(클러스터·DB·엔드포인트의 지금 상태)",
  derived: "대상에 대한 이야기를 읽는다(로그·CI 상태·저널·리포트)",
  "self-report": "사람·에이전트의 진술",
});
