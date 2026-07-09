// tooling/relation-lib.mjs
// Entity 간 구조화 관계 판정 순수 코어 (SPEC-017).
// `## Dependencies`의 `Entities:` 라인은 자유 텍스트라 대상 실재·소유 spec·순환을 검사할 수
// 없었다. `EntityName (relation-type)` 괄호 표기만 구조화된 관계로 파싱하고, 괄호 없는
// 기존 항목은 그대로 레거시 자유참조로 남겨 하위호환한다(opt-in은 문법 자체로).
// relation-type 어휘는 capabilityVerbs와 동형 — config(relationTypes)가 비어있으면 무제한.
// 실재·소유 spec 해석 실패는 hard, 순환 참조는 advisory(호출부가 심각도를 매긴다).
// 설계: SPEC-017 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

// relation-type 토큰: 소문자 kebab 1토큰만 — 공백·쉼표·대문자 섞인 기존 서술 괄호
// ("(deprecated, 검토 필요)" 등)와 우연히 겹치지 않게 방어(오검출 방지, 문서화된 리마인더).
const TYPE_RE = /^[a-z][a-z0-9-]*$/;

// "EntityName (relation-type)" → {name, type}. 괄호 없거나 토큰 문법 밖이면 {name: raw 전체, type: null}(레거시).
export function parseRelationEntry(raw) {
  const s = String(raw).trim();
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(s);
  if (m && TYPE_RE.test(m[2].trim())) return { name: m[1].trim(), type: m[2].trim() };
  return { name: s, type: null };
}

// allowedTypes가 비어있으면 어휘 무제한(capabilityVerbs 동형). type이 null(레거시)이면 항상 통과.
export function relationTypeFinding(type, allowedTypes) {
  if (!type) return null;
  if (!allowedTypes || !allowedTypes.length) return null;
  if (!allowedTypes.includes(type)) return `미등록 관계 종류 "${type}" — relationTypes에 등록 필요(임의 신설 금지)`;
  return null;
}

// specDeps: [{specId, entities:[{name,type}]}]. entityOwnerIndex: Map(entityKey -> ownerSpecId).
// 구조화 관계(type 있음)만 해석 대상 — 레거시 자유참조(type:null)는 그대로 통과(관여 안 함).
// 반환: {edges:[{from,to,type,entity}], missing:[{specId,entity,type}]}(대상 실재 X = hard 대상).
export function resolveRelations(specDeps, entityOwnerIndex) {
  const edges = [], missing = [];
  for (const { specId, entities } of specDeps) {
    for (const { name, type } of entities) {
      if (!type) continue;
      const owner = entityOwnerIndex.get(name);
      if (!owner) { missing.push({ specId, entity: name, type }); continue; }
      edges.push({ from: specId, to: owner, type, entity: name });
    }
  }
  return { edges, missing };
}

// spec 간 참조 그래프에서 순환 탐지(DFS 3색 마킹). 반환: 순환마다 spec-id 배열(발견 순서, 결정적).
export function findCycles(edges) {
  const graph = new Map();
  for (const e of edges) {
    if (!graph.has(e.from)) graph.set(e.from, []);
    graph.get(e.from).push(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = [];
  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (color.get(next) === GRAY) {
        const idx = stack.indexOf(next);
        cycles.push([...stack.slice(idx), next]);
      } else if (color.get(next) !== BLACK) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }
  for (const node of [...graph.keys()].sort()) if (color.get(node) !== BLACK) dfs(node);
  return cycles;
}
