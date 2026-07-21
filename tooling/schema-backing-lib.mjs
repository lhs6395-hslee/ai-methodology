// tooling/schema-backing-lib.mjs
// Entity 스키마 백킹 판정 순수 코어 (SPEC-026).
// 방법론: 1 spec = 1 aggregate root(실재 entity). Ownership.Entities에 선언된 소유 entity는
// 구조 SSOT(DB 스키마·마이그레이션·proto 등)에 실재하는 식별자여야 한다 — 지어낸 개념 entity
// (UI 흐름·화면: wizard·project_list 류)에 capability를 얹어 capability 귀속(SPEC-024)을
// 우회하는 것을 차단한다(실측: 소비 프로젝트가 pjt_projects.create를 wizard.create로 개명해
// 가짜 entity `wizard`를 등록·통과시킴 — registry+귀속 두 가드를 동시에 우회).
// 인프라 무관: 구조 SSOT 위치·추출 패턴은 config 어댑터(entitySchemaSources)로 주입한다 —
// Drizzle·Prisma·SQL DDL·proto·어떤 스키마든 같은 게이트가 동작(파일 IO는 게이트가, 여기선 순수).
// 판정은 문자열 집합 대조만(git 비의존). off|advisory|hard. Python판 sdd_gates.py 미러(SPEC-006).

// 활성 조건: 정책 on + 스키마 소스 선언 + Entities류 카테고리 존재.
// 셋 중 하나라도 없으면 inert — 스키마 없는 프로젝트(순수 라이브러리)·킷 자신(Modules 카테고리)·
// 파이프라인(Datasets)은 영향 없음(하위호환).
export function schemaBackingActive(policy, sources, categories) {
  return policy !== "off"
    && Array.isArray(sources) && sources.length > 0
    && (categories || []).some((c) => /entit/i.test(c));
}

// 스키마 소스 텍스트에서 실재 entity 식별자 추출 — units: [{text, patterns:["정규식문자열"]}].
// 각 패턴의 캡처그룹 1이 식별자. 전역 매치. 정규화(트림·소문자) 집합 반환.
export function extractSchemaEntities(units) {
  const set = new Set();
  for (const { text, patterns } of units || []) {
    for (const p of patterns || []) {
      const rx = new RegExp(p, "g");
      for (const m of String(text || "").matchAll(rx)) {
        const id = String(m[1] ?? "").trim().toLowerCase();
        if (id) set.add(id);
      }
    }
  }
  return set;
}

// 스펙별 소유 entity가 스키마 집합(∪ 면제)에 없으면 위반. 소유 entity는 raw(여기서 정규화).
// ownedBySpec: [{specId, entities:[raw...]}]. 반환 [{specId, entity}] (선언 순 — 결정적).
export function schemaBackingFindings(ownedBySpec, schemaSet, exemptSet) {
  const findings = [];
  for (const { specId, entities } of ownedBySpec || []) {
    for (const raw of entities || []) {
      const ent = String(raw).trim().toLowerCase();
      if (!ent || ent === "—" || ent === "-") continue;
      if (!schemaSet.has(ent) && !(exemptSet && exemptSet.has(ent))) {
        findings.push({ specId, entity: ent });
      }
    }
  }
  return findings;
}
