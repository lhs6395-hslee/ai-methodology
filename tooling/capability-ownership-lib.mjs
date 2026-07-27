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

// 검사 활성 조건 — entity 역할·capability 역할 카테고리가 둘 다 해석될 때만.
// 역할은 config가 **선언**하고(ownershipCategoryRoles) 미선언 시 이름 정규식으로 폴백한다
// (resolveCategoryRoles, SPEC-001 FR-010) — 카테고리 이름에 의존하던 추측을 없앤 자리다.
// capability 역할이 없는 프로젝트(킷 Modules/Symbols·파이프라인 Datasets/Jobs 등)엔 무영향.
// roles: {entity, surface, capability} — 각 카테고리명 or null.
export function capabilityCheckActive(roles) {
  return Boolean(roles && roles.entity && roles.capability);
}

// 정책이 off가 **아닌데** 판정이 성립하지 않는(inert) 사유 — 침묵 금지(감사 A-1 실측: `Entities`를
// 의미 동일한 `Aggregates`로 개명하면 `capabilityOwnershipPolicy: hard`가 완전 no-op이 되면서
// 스킵 신호가 한 줄도 없었다 → 유령 entity가 "✓ 구조적 중복 없음"으로 통과). "hard 선언 + 무판정"은
// 거짓 안전이므로 소비 게이트가 차단하고, 정당한 inert(순수 라이브러리·파이프라인 등 capability
// 개념 자체가 없는 프로젝트)는 정책을 **명시적 off**로 두어 조용히 통과한다(문서화된 탈출구).
// 반환: 사유 문자열 배열(빈 배열 = 판정 성립 ∨ 명시적 off). 순수 — 출력·exit은 소비 게이트.
export function capabilityInertReasons(policy, roles) {
  if (policy === "off") return [];
  const reasons = [];
  if (!(roles && roles.entity)) {
    reasons.push("entity 역할 카테고리 미해석(ownershipCategoryRoles에 entity 선언 없음 + 이름 폴백 실패)");
  }
  if (!(roles && roles.capability)) {
    reasons.push("capability 역할 카테고리 미해석(ownershipCategoryRoles에 capability 선언 없음 + 이름 폴백 실패)");
  }
  return reasons;
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
