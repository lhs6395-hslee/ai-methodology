// tooling/drift-lib.mjs
// semantic drift 승격 판정 순수 코어 (SPEC-019).
// 리네임·소유 이동은 "의미가 바뀌었을 수 있다"는 신호 — spec-sync 요구를
//   "Change Log 한 줄" → "FR 선언 라인 변경 ∨ Spec-Impact 트레일러"로 승격한다.
// 판정은 집합 연산만(git·파일시스템 비의존) — 트리거 집합·충족 집합 → 위반 집합.
// 게이트는 "리네임됐으니 FR 본문을 다시 보라"까지만. "제대로 고쳤나"(본문↔코드 의미)는 리뷰 경계.
// 설계: SPEC-019 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

export const DRIFT_POLICY_ENUM = ["off", "advisory", "hard"];

// triggered: 리네임/소유이동이 건드린 소유 스펙 id 집합(Set|Array)
// satisfied: FR 선언 라인이 바뀐 소유 스펙 id 집합(Set|Array)
// hasSpecImpact: changeset에 Spec-Impact 트레일러 존재(bool) — 있으면 전체 충족(정직한 사유 선언)
// policy: "off"|"advisory"|"hard"
// 반환 {violations:[id...(정렬)], hard:bool, policyError:string|null}. 동일 입력 → 동일 출력.
export function escalations(triggered, satisfied, hasSpecImpact, policy) {
  if (!DRIFT_POLICY_ENUM.includes(policy)) {
    return { violations: [], hard: false, policyError: `semanticDriftPolicy 값 위반 "${policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)` };
  }
  if (policy === "off") return { violations: [], hard: false, policyError: null };
  if (hasSpecImpact) return { violations: [], hard: false, policyError: null };
  const sat = new Set(satisfied || []);
  const violations = [...new Set(triggered || [])].filter((id) => !sat.has(id)).sort();
  return { violations, hard: policy === "hard", policyError: null };
}
