// tooling/check-outcome-lib.mjs
// 판정 3분류의 **반환 계약** (SPEC-054) — clean / could-not-check / violation.
//
// 제보 요청(2026-08-10): "clean / could-not-check / violation을 판정 코어의 반환 계약으로
// 못박아달라. 오늘 새로 쓴 `judgeMigrationSet()`은 저널을 읽지 못하면 could-not-check를 낸다.
// 반면 기존 `hookFindings()`는 원본을 못 읽는 경우가 아예 없어서 **'검사 못 함'이 통과로 흘렀다.**
// 킷 차원에서 이 3분류를 반환 타입으로 강제하면 개별 게이트가 실수할 여지가 줄어든다."
//
// ── 왜 게이트 층의 SPEC-040으로 부족한가 ─────────────────────────────────────
// SPEC-040은 **게이트**가 자기 판정 종류를 선언하게 만든다(JUDGED·OFF·INERT·SKIPPED·UNTYPED).
// 그런데 그 선언은 게이트가 코어의 반환값을 **해석한 결과**다. 코어가 "못 봤다"를 표현할 통로가
// 없으면 게이트는 그 사실을 알 방법이 없고, 빈 findings를 clean으로 읽는다.
// **판정이 사라지는 자리는 코어와 게이트의 경계다.**
//
// ── 실측: 존재 판정기의 붕괴 ─────────────────────────────────────────────────
// 킷의 판정 코어 중 6종이 존재 판정기를 주입받는데, 그중 4종이 `boolean`만 받았다:
//     agent-wiring · diagnosis-guard · spec-sync · watchdog
// 파일을 **읽지 못한** 경우(권한·I/O 오류)가 `false`로 붕괴해 "없음"= **위반**으로 보고된다.
// `hooks-install`이 겪은 것의 반대 방향이다(그쪽은 "통과"로 흘렀다). 두 방향 모두 틀렸다 —
// 모르는 것을 아는 것처럼 말하는 순간 그 판정은 거짓이다.
//
// 의존 0 — 이 파일은 어떤 모듈도 import하지 않는다. 모든 판정 코어가 부담 없이 쓸 수 있어야
// 계약이 실제로 퍼진다(무거운 계약은 채택되지 않고, 채택되지 않은 계약은 계약이 아니다).

// 판정 종류 — **셋뿐이고 더 늘리지 않는다.**
export const CHECK_KINDS = Object.freeze({
  // 봤고, 문제 없다. 이것만이 초록의 자격을 갖는다.
  CLEAN: "clean",
  // **못 봤다.** 통과가 아니고 위반도 아니다 — 표면화하되 차단하지 않는다.
  UNCHECKED: "could-not-check",
  // 봤고, 문제가 있다.
  VIOLATION: "violation",
});

// 존재·가용성 판정기의 3상태. `boolean`을 그대로 받아도 동작한다(하위호환) — 새 계약을
// 도입하면서 기존 호출부를 전부 깨면 그 계약은 채택되지 않는다.
export const TRI = Object.freeze({ YES: "yes", NO: "no", UNKNOWN: "unknown" });

// boolean | TRI → TRI 정규화. `undefined`·`null`은 **UNKNOWN**이다(모르는 것을 없다고 하지 않는다).
export function tri(value) {
  if (value === true || value === TRI.YES) return TRI.YES;
  if (value === false || value === TRI.NO) return TRI.NO;
  return TRI.UNKNOWN;
}

// 던지는 판정기를 3상태로 감싼다 — 소비 게이트가 `existsSync`·`readFileSync`를 넘길 때 쓴다.
// 예외를 `false`로 삼키던 자리가 정확히 이 결함의 발생 지점이었다.
export function triGuard(fn) {
  return (...args) => {
    try { return tri(fn(...args)); } catch { return TRI.UNKNOWN; }
  };
}

// 코어의 반환값을 계약 형태로 정규화한다.
//   { kind, violations, unchecked }
// 우선순위: 위반이 하나라도 있으면 VIOLATION, 없고 못 본 것이 있으면 UNCHECKED, 둘 다 없으면 CLEAN.
// **위반이 UNCHECKED를 가리지 않는다** — 둘은 같은 반환값에 함께 실린다(하나를 보고 다른 하나를
// 잊는 것이 이 계열 결함의 본체다).
export function checkOutcome(violations = [], unchecked = []) {
  const v = Array.isArray(violations) ? violations : [];
  const u = Array.isArray(unchecked) ? unchecked : [];
  const kind = v.length ? CHECK_KINDS.VIOLATION : (u.length ? CHECK_KINDS.UNCHECKED : CHECK_KINDS.CLEAN);
  return { kind, violations: v, unchecked: u };
}

// 여러 코어의 결과를 합친다 — 축이 여럿인 게이트가 각 코어의 3분류를 잃지 않게.
export function mergeOutcomes(...outcomes) {
  const v = [], u = [];
  for (const o of outcomes) {
    if (!o) continue;
    v.push(...(Array.isArray(o.violations) ? o.violations : []));
    u.push(...(Array.isArray(o.unchecked) ? o.unchecked : []));
  }
  return checkOutcome(v, u);
}

// 게이트가 사람에게 낼 한 줄 — **못 본 것을 초록에 합산하지 않는다.**
export function outcomeSummary(outcome, subject = "판정") {
  const o = outcome || checkOutcome();
  if (o.kind === CHECK_KINDS.VIOLATION) return `${subject}: 위반 ${o.violations.length}건`
    + (o.unchecked.length ? ` · 확인 못 함 ${o.unchecked.length}건(통과 아님)` : "");
  if (o.kind === CHECK_KINDS.UNCHECKED) return `${subject}: 위반 0건 · **확인 못 함 ${o.unchecked.length}건** — 통과가 아니다`;
  return `${subject}: 위반 0건 · 확인 못 함 0건`;
}
