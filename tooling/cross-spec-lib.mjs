// tooling/cross-spec-lib.mjs
// 공유 표면 변경 동인(Change-Driver) 파싱·참조 완화 판정 순수 코어 (SPEC-020).
// 한 스펙 소유 파일을 다른 스펙 기능 때문에 고칠 때, 억지 Change Log 대신
//   `Change-Driver: <SPEC-ID> <사유>` 트레일러로 진짜 동인을 선언하면 소유 스펙 요구를 완화.
// 완화는 동인이 실재·의미변경일 때만(가짜 동인 우회 금지) — 실재·의미 확인은 소비 게이트가.
// 판정은 문자열 파싱·집합 연산만(git·파일시스템 비의존).
// 설계: SPEC-020 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

// 커밋 메시지에서 `Change-Driver: <SPEC-ID> <사유>` 트레일러 파싱.
//   idAlt: spec ID 접두어 대안(예 "SPEC|INFRA|TEST|CICD"). 사유 빈 항목은 버림.
// 반환 [{id, reason}] (등장 순).
export function parseDrivers(msg, idAlt) {
  const re = new RegExp(`^Change-Driver:[ \\t]*((?:${idAlt})-\\d{3})[ \\t]+(.+)$`, "gm");
  const out = [];
  let m;
  while ((m = re.exec(msg || ""))) if (m[2].trim()) out.push({ id: m[1], reason: m[2].trim() });
  return out;
}

// 소유 스펙 owner의 요구가 참조 완화되는가 — 자기 자신이 아닌 "의미 있게 바뀐 동인"이 하나라도 있으면 true.
//   meaningfulDrivers: 실재·의미변경으로 검증된 동인 spec id 집합(Set|Array).
export function crossSpecRelaxed(owner, meaningfulDrivers) {
  return [...new Set(meaningfulDrivers || [])].some((d) => d !== owner);
}
