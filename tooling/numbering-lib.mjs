// tooling/numbering-lib.mjs
// 접두어별 spec-ID 번호 무결성 순수 코어 (SPEC-014).
// 입력: spec 파일 id 집합(["SPEC-001","INFRA-011",...]). 접두어별로 그룹핑해서
//   hard    : 중복 (prefix,num) / 최소 번호 ≠ 001(전역 잔번·잘못된 시작)
//   advisory: 실제 최소~최대 사이 내부 결번(제거·retag가 정당히 남기는 gap)
// 판정은 id 문자열 파싱·정수 비교만 — 파일시스템·본문 비의존, 출력은 접두어·번호 순 정렬(결정성).
// 실측 근거: 소비 프로젝트 A는 접두어별 순차, 소비 프로젝트 B는 재도출 후 retag로 전역 잔번(INFRA-011/013)을 남겨
// 두 프로젝트가 다른 번호 체계로 갈라짐 — 번호 모델이 미규정·미강제였다.
// 설계: SPEC-014 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

const pad3 = (n) => String(n).padStart(3, "0");

// 반환 {hard:[msg], advisory:[msg]}. 입력 순서 무관, 동일 입력 집합 → 동일 출력.
// retiredIds: 폐기 기록된 spec-ID 집합(config `retiredIds`) — 그 ID의 내부 gap은
//   사고성 결번이 아니라 정상 retirement gap이므로 advisory에서 제외(SPEC-018 FR-006).
export function numberingIssues(specIds, retiredIds = []) {
  const retired = new Set((retiredIds || []).map((s) => String(s).trim()));
  const byPrefix = new Map(); // prefix -> [num,...]
  for (const id of specIds || []) {
    const m = /^([A-Z]+)-(\d{3})$/.exec(id);
    if (!m) continue; // 미등록/비정형 id는 PREFIX 화이트리스트가 이미 처리(이중 보고 없음)
    if (!byPrefix.has(m[1])) byPrefix.set(m[1], []);
    byPrefix.get(m[1]).push(parseInt(m[2], 10));
  }
  const hard = [], advisory = [];
  for (const pfx of [...byPrefix.keys()].sort()) {
    const nums = byPrefix.get(pfx);
    // 중복
    const seen = new Set(), dups = new Set();
    for (const n of nums) (seen.has(n) ? dups : seen).add(n);
    for (const d of [...dups].sort((a, b) => a - b)) {
      hard.push(`${pfx}-${pad3(d)} 번호 중복 — 같은 접두어·번호가 둘 이상(유일해야 함)`);
    }
    const uniq = [...seen].sort((a, b) => a - b);
    if (uniq.length === 0) continue;
    // 폐기 ID 재사용(hard, SPEC-014 FR-004): retiredIds에 기록된 번호가 실재하면 과거 참조
    // (@verifies·Change Log·vcs-history)가 의미 다른 새 스펙으로 앨리어싱된다 — 무신호 재사용 차단(감사 M3).
    for (const n of uniq) {
      if (retired.has(`${pfx}-${pad3(n)}`)) {
        hard.push(`${pfx}-${pad3(n)} 폐기 ID 재사용 — retiredIds에 기록된 번호가 실재(과거 참조 앨리어싱). 새 번호를 쓰거나, 의도적 재사용이면 retiredIds에서 제거`);
      }
    }
    // 001 미시작 (전역 잔번·잘못된 시작) — 단, 선행 번호(001..min-1)가 전부 retiredIds에 기록돼
    // 있으면 정상 retirement gap이라 hard 아님(SPEC-014 FR-001 개정: 최소번호 스펙 폐기가
    // 접두어 전체 재번호를 강요하던 모순 해소 — SPEC-018 FR-006과 정합, 감사 M4).
    if (uniq[0] !== 1) {
      let leadingRetired = true;
      for (let n = 1; n < uniq[0]; n++) if (!retired.has(`${pfx}-${pad3(n)}`)) { leadingRetired = false; break; }
      if (!leadingRetired) {
        hard.push(`${pfx} 번호가 001부터 시작하지 않음 — 최소 ${pfx}-${pad3(uniq[0])} (접두어별 001 순차 규칙, SPEC-014). 재번호는 sdd-retag, 선행 번호가 폐기분이면 retiredIds에 기록`);
      }
    }
    // 내부 gap (실제 최소~최대) — 001 미시작분은 gap으로 재보고하지 않음
    const present = new Set(uniq), max = uniq[uniq.length - 1], missing = [];
    // retiredIds에 기록된 번호는 정상 retirement gap이라 재보고하지 않음(SPEC-018 FR-006)
    for (let n = uniq[0]; n <= max; n++) if (!present.has(n) && !retired.has(`${pfx}-${pad3(n)}`)) missing.push(n);
    if (missing.length) {
      advisory.push(`${pfx} 번호 중간 gap: ${missing.map(pad3).map((s) => `${pfx}-${s}`).join(", ")} — 제거·retag 잔분(정상일 수 있음)`);
    }
  }
  return { hard, advisory };
}
