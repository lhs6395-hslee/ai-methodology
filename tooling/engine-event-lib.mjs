// tooling/engine-event-lib.mjs
// Engines & Events 카테고리 판정 순수 코어 (SPEC-030).
// 감사(#21) 전수성 구멍: 순수 엔진/정책/값객체(entity도 route도 능력도 아님)와 배치 job·이벤트가
// E/S/C 어디에도 안 맞아, 저자가 유령 entity 날조·대량 면제·`job:` Surface 개명으로 우회했다.
// 두 옵트인 역할을 신설한다(ownershipCategoryRoles로 선언 — 이름 폴백 없음):
//   engine — 코드-모듈 SSOT(함수·클래스·모듈)에 실재해야 하는 비-aggregate 순수 로직. capability 소유 금지.
//   event  — 발신 entity에 귀속(`entity.event-name`)되고 이벤트 카탈로그 SSOT에 실재해야 하는 신호/배치.
// SSOT 위치·추출은 config 어댑터(enginesSources·eventCatalogSources)로 주입(인프라 무관).
// 추출·유효성 검사는 schema-backing-lib과 동일 규칙을 재사용(DRY). off|advisory|hard. Python 미러(SPEC-006).

export { validateSchemaPatterns, extractSchemaEntities } from "./schema-backing-lib.mjs";

// 활성 조건: 정책 on + SSOT 소스 선언 + 역할 카테고리 해석. 셋 중 하나라도 없으면 inert.
export function roleActive(policy, sources, roleCat) {
  return policy !== "off"
    && Array.isArray(sources) && sources.length > 0
    && Boolean(roleCat);
}

// 정책이 off가 아닌데 판정 불가(inert)인 사유 — 침묵 금지(schemaBackingInertReasons 동형).
export function roleInertReasons(policy, sources, roleCat, sourcesKnob, roleName) {
  if (policy === "off") return [];
  const reasons = [];
  if (!Array.isArray(sources) || sources.length === 0)
    reasons.push(`${sourcesKnob} 비어 있음(${roleName} SSOT 어댑터 미선언 — 대조할 실재 집합이 없음)`);
  if (!roleCat)
    reasons.push(`${roleName} 역할 카테고리 미해석(ownershipCategoryRoles에 ${roleName} 선언 없음 — engine/event는 선언 전용)`);
  return reasons;
}

// SSOT 실재 대조: 소유 키(raw, 여기서 정규화)가 SSOT 집합 ∪ 면제에 없으면 위반.
// engine 실재·event 카탈로그 실재 공용. ownedBySpec: [{specId, keys:[raw...]}]. 반환 [{specId, key}](선언 순).
export function realityFindings(ownedBySpec, ssotSet, exemptSet) {
  const findings = [];
  for (const { specId, keys } of ownedBySpec || []) {
    for (const raw of keys || []) {
      const k = String(raw).trim().toLowerCase();
      if (!k || k === "—" || k === "-") continue;
      if (ssotSet.has(k)) continue;
      if (exemptSet && exemptSet.has(k)) continue;
      findings.push({ specId, key: k });
    }
  }
  return findings;
}

// event 키를 발신 entity로 분해 — `entity.event-name`(첫 점 기준). 점 없으면 entity=null(귀속 불가).
export function splitEventKey(raw) {
  const s = String(raw).trim().toLowerCase();
  const i = s.indexOf(".");
  return i < 0 ? { entity: null, name: s } : { entity: s.slice(0, i), name: s.slice(i + 1) };
}

// event 귀속: 각 event 키의 발신 entity가 그 스펙이 소유한 entity 집합에 있어야 한다(capability 귀속 동형).
// ownedEventsBySpec: [{specId, keys:[raw...]}], ownedEntitiesBySpec: {specId: [entity정규화...]}.
// 반환 [{specId, key, entity}](선언 순) — entity=null이면 "귀속 없음"(점 없는 키).
export function eventAttributionFindings(ownedEventsBySpec, ownedEntitiesBySpec) {
  const findings = [];
  for (const { specId, keys } of ownedEventsBySpec || []) {
    const owned = new Set((ownedEntitiesBySpec && ownedEntitiesBySpec[specId]) || []);
    for (const raw of keys || []) {
      const k = String(raw).trim().toLowerCase();
      if (!k || k === "—" || k === "-") continue;
      const { entity } = splitEventKey(k);
      if (!entity || !owned.has(entity)) findings.push({ specId, key: k, entity });
    }
  }
  return findings;
}
