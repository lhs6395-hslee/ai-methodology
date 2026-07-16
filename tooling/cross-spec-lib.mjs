// tooling/cross-spec-lib.mjs
// 공유 표면 변경 동인(Change-Driver) 파싱·참조 완화 판정 순수 코어 (SPEC-020).
// 한 스펙 소유 파일을 다른 스펙 기능 때문에 고칠 때, 억지 Change Log 대신
//   `Change-Driver: <SPEC-ID> [@<glob>[,<glob>]] <사유>` 트레일러로 진짜 동인을 선언하면 소유 스펙 요구를 완화.
// 완화는 동인이 실재·의미변경일 때만(가짜 동인 우회 금지) — 실재·의미 확인은 소비 게이트가.
// 경로 스코프(@glob, FR-005): 선언하면 매치 파일만 완화 — 무스코프 트레일러가 커밋 내
// 무관한 모든 파일의 소유 스펙까지 일괄 완화하던 전역 팬아웃을 귀속으로 좁힌다(감사 T4).
// 무스코프(레거시)는 유지되나 완화 팬아웃이 게이트 출력에 파일 단위로 드러난다.
// 판정은 문자열 파싱·집합 연산만(git·파일시스템 비의존).
// 설계: SPEC-020 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

// 커밋 메시지에서 `Change-Driver: <SPEC-ID> [@<glob>[,<glob>]] <사유>` 트레일러 파싱.
//   idAlt: spec ID 접두어 대안(예 "SPEC|INFRA|TEST|CICD"). 사유 빈 항목은 버림.
// 반환 [{id, globs, reason}] (등장 순). globs: 스코프 글롭 배열 | null(무스코프=전 파일).
export function parseDrivers(msg, idAlt) {
  const re = new RegExp(`^Change-Driver:[ \\t]*((?:${idAlt})-\\d{3})[ \\t]+(?:@(\\S+)[ \\t]+)?(.+)$`, "gm");
  const out = [];
  let m;
  while ((m = re.exec(msg || ""))) {
    if (!m[3].trim()) continue;
    const globs = m[2] ? m[2].split(",").map((g) => g.trim()).filter(Boolean) : null;
    out.push({ id: m[1], globs, reason: m[3].trim() });
  }
  return out;
}

// 파일 f에 대해 소유 스펙 owner를 완화하는 동인 id들(정렬) — 자기 자신 아닌 "의미 있게 바뀐"
// 동인 중, 무스코프이거나 스코프 글롭이 f에 매치하는 것만(FR-005).
//   entries: parseDrivers 결과 중 의미변경 검증을 통과한 것들. matchGlob(glob, file): 소비측 주입
//   (게이트의 compileGlob 재사용 — 이 코어는 글롭 문법에 비의존).
export function relaxingDrivers(owner, file, entries, matchGlob) {
  const ids = new Set();
  for (const d of entries || []) {
    if (d.id === owner) continue;
    if (d.globs && !d.globs.some((g) => matchGlob(g, file))) continue;
    ids.add(d.id);
  }
  return [...ids].sort();
}

// (하위호환) 소유 스펙 owner의 요구가 완화되는가 — 자기 자신 아닌 의미변경 동인이 하나라도 있으면 true.
// 무스코프 판정만 필요할 때의 축약 — 경로 스코프 판정은 relaxingDrivers를 쓴다.
export function crossSpecRelaxed(owner, meaningfulDrivers) {
  return [...new Set(meaningfulDrivers || [])].some((d) => d !== owner);
}
