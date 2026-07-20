// tooling/capability-ownership-lib.mjs
// Capability 귀속 판정 순수 코어 (SPEC-024).
// 방법론의 스펙 경계는 entity 기준이다 — "entity 키가 같으면 같은 스펙, verb가 달라도
// 같은 entity면 같은 스펙에 FR 신설, 참조·종속 entity는 relation(Dependencies)으로"(owner 확정).
// 따라서 capability `x.verb`는 entity `x`를 **소유한** 스펙만 선언할 수 있다:
//   · entity 없이 capability만 소유한 "엔진/헬퍼" 스펙(기술 계층 분할)은 존재 위반 —
//     능력들을 각자의 aggregate 스펙으로 이관한다(실측: budget-engine이 pjt_projects.compute·
//     budget.aggregate를 들고 Entities 0개로 태어난 사례).
//   · 참조 entity 위의 capability도 위반 — 그 능력은 entity 소유 스펙의 FR이다.
// 판정은 문자열 정규화·집합 대조만(git·파일시스템 비의존). Python판 sdd_gates.py 미러(SPEC-006).

// 검사 활성 조건 — entity류·capability류 카테고리가 둘 다 있을 때만(웹/CRUD 계열).
// 비-웹 카테고리(Modules/Symbols/Artifacts·Datasets/Jobs/Sinks 등)엔 capability 개념이 없어 무영향.
export function capabilityCheckActive(categories) {
  return (categories || []).some((c) => /entit/i.test(c))
    && (categories || []).some((c) => /capabilit/i.test(c));
}

// 스펙 한 장 판정 — 소유 capability들의 entity 조각이 소유 entity 집합에 있는가.
//   ownedEntities/ownedCapabilities: 그 스펙 Ownership의 해당 카테고리 키(raw — 여기서 정규화).
// 점 없는 capability는 형식 위반이라 validateKey가 담당(이중 보고 금지 — 여기선 스킵).
// 반환: [{capability, entity}] (선언 순 — 결정적).
export function capabilityOwnershipFindings(ownedEntities, ownedCapabilities) {
  const owned = new Set((ownedEntities || []).map((k) => String(k).trim().toLowerCase()));
  const findings = [];
  for (const raw of ownedCapabilities || []) {
    const cap = String(raw).trim().toLowerCase();
    const dot = cap.indexOf(".");
    if (dot <= 0) continue;
    const entity = cap.slice(0, dot);
    if (!owned.has(entity)) findings.push({ capability: cap, entity });
  }
  return findings;
}
