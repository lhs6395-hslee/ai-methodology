// tooling/duplicate-source-lib.mjs
// 훅/게이트 사본 드리프트 판정 순수 코어 (SPEC-059) — **같은 논리적 규칙을 표현한다고 주장하는
// 두 파일이 실제로 같은 게이트를 부르는가.**
//
// 실측 제보(소비 프로젝트, 2026-08-17): `scripts/hooks/commit-msg`(실제로 설치되는 파일)와
// `scripts/sdd-commit-msg.sh`(자기 헤더에 "내가 설치되는 훅이다"라고 잘못 주장하는 사본)가
// 이미 갈라져 있었다 — 후자에만 `check-gate-escalation.mjs` 호출이 있었다. `check-hooks-installed`
// (SPEC-036)는 "설치 대상이 실재하는가"만 보고 "병행 사본이 내용까지 같은가"는 보지 않는다.
//
// 판정 축: 두 파일이 각자 부르는 게이트(`check-*.mjs`) 목록을 텍스트에서 뽑아 대조한다.
// 한쪽에만 있는 호출이 있으면 드리프트다 — **어느 쪽이 최신인지는 판정하지 않는다**(존재는
// 기계, 어느 쪽이 옳은지는 리뷰). 등록(`duplicateSourcePairs`)이 없으면 검사 대상이 없다.
//
// 순수 함수(IO 없음) — 파일 읽기는 소비 게이트가 주입한다.

export const GATE_CALL_RE = /\bcheck-[a-z0-9][a-z0-9-]*\.mjs\b/g;

// 텍스트에서 게이트 호출 언급을 중복 제거해 뽑는다(정렬해 결정적 출력).
export function gateCallsIn(text) {
  const set = new Set();
  for (const m of String(text || "").matchAll(GATE_CALL_RE)) set.add(m[0]);
  return [...set].sort();
}

// config 형식 검증 — a/b/reason 모두 비어 있지 않아야 하고 a와 b는 달라야 한다(자기 자신과
// "사본"일 수 없다). reason 필수(entityRegistry 류 면제 선언과 같은 관례 — 사유 없는 등록은
// 등록이 아니다).
export function validateDuplicateSourcePairs(pairs) {
  const errors = [];
  for (const [i, raw] of (pairs || []).entries()) {
    const p = raw && typeof raw === "object" ? raw : {};
    const a = String(p.a ?? "").trim();
    const b = String(p.b ?? "").trim();
    const reason = String(p.reason ?? "").trim();
    if (!a || !b) errors.push(`duplicateSourcePairs[${i}] — a·b 둘 다 파일 경로 필수`);
    else if (a === b) errors.push(`duplicateSourcePairs[${i}] — a와 b가 같다(자기 자신은 사본이 아니다)`);
    if (!reason) errors.push(`duplicateSourcePairs[${i}] — reason 필수(사유 없는 등록은 등록이 아니다)`);
  }
  return errors;
}

// 두 텍스트의 게이트 호출 목록을 대조한다. { onlyInA, onlyInB } — 둘 다 비었으면 드리프트 없음.
export function driftFindings(textA, textB) {
  const a = new Set(gateCallsIn(textA));
  const b = new Set(gateCallsIn(textB));
  const onlyInA = [...a].filter((x) => !b.has(x)).sort();
  const onlyInB = [...b].filter((x) => !a.has(x)).sort();
  return { onlyInA, onlyInB };
}
