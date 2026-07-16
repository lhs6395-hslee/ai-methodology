// tooling/schema-drift-lib.mjs
// 런타임 스키마 드리프트 판정 순수 코어 (SPEC-022) — R2'(code↔deployed-runtime).
// SDD 드리프트는 spec↔code(R1·R2)만 봤다. code가 기대하는 스키마 ↔ 실제 배포된 DB 축은
// 어떤 게이트도 못 봐서, spec↔code green인데 배포 DB에 컬럼이 없어 500(42703)이 나는 사각지대가 있었다.
// 이 코어는 두 스키마 식별자 집합(코드 기대 vs 배포 실측)을 diff — "코드엔 있는데 배포에 없음"이 위험 드리프트.
// DB/ORM 중립: 두 집합을 어떻게 얻는지는 프로젝트가 명령으로 주입(게이트 래퍼가 실행), 이 코어는 순수 집합 연산.
// 설계: SPEC-022 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

export const MIGRATION_ENUM = ["advisory", "hard"];

// expected/deployed: 스키마 식별자 배열(예 "table.column" 또는 "table"). ran: 두 조회가 성공했나(bool).
// policy: "advisory"|"hard". 반환 {valid, exit, drift:[정렬], line}. line이 출력 바이트 정본.
export function schemaDriftVerdict(expected, deployed, ran, policy) {
  if (!MIGRATION_ENUM.includes(policy)) {
    return { valid: false, exit: 1, drift: [], line: `✗ migrationStatePolicy 값 위반 "${policy}" — advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)` };
  }
  const hard = policy === "hard";
  if (!ran) {
    return { valid: true, exit: hard ? 1 : 0, drift: [], line: `${hard ? "✗" : "⚠"} 런타임 스키마 드리프트 게이트 — expected/deployed 스키마 조회 실패, 드리프트 판정 불가(조용한 통과 금지 — migrationStatePolicy:${policy})` };
  }
  const dep = new Set(deployed || []);
  const drift = [...new Set(expected || [])].filter((x) => !dep.has(x)).sort();
  if (drift.length === 0) {
    return { valid: true, exit: 0, drift: [], line: `런타임 스키마 드리프트 게이트 — 배포 스키마가 코드 기대와 일치(드리프트 없음, migrationStatePolicy:${policy})` };
  }
  return { valid: true, exit: hard ? 1 : 0, drift, line: `${hard ? "✗" : "⚠"} 런타임 스키마 드리프트 — 코드 기대엔 있으나 배포에 없음: ${drift.join(", ")} (migrationStatePolicy:${policy})` };
}
