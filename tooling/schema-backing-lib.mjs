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

// 활성 조건: 정책 on + 스키마 소스 선언 + entity 역할 카테고리 해석.
// 역할은 config가 선언하고(ownershipCategoryRoles) 미선언 시 이름 정규식 폴백(SPEC-001 FR-010) —
// 카테고리 이름 추측을 없앤 자리다. 셋 중 하나라도 없으면 inert(사유는 아래 함수가 표면화).
// roles: {entity, surface, capability} — 각 카테고리명 or null.
export function schemaBackingActive(policy, sources, roles) {
  return policy !== "off"
    && Array.isArray(sources) && sources.length > 0
    && Boolean(roles && roles.entity);
}

// 정책이 off가 **아닌데** 판정이 성립하지 않는(inert) 사유 — 침묵 금지(감사 A-1·A-3 실측:
// `entitySchemaSources: []` 한 줄 또는 카테고리 개명으로 `entitySchemaBackingPolicy: hard`가
// 완전 no-op이 되면서 스킵 신호가 없었다). FR-005가 *개별 면제*를 매 실행 부채로 표면화하는 것과
// 동형으로, *정책 전체의 inert*도 매 실행 표면화한다 — "hard 선언 + 무판정"은 거짓 안전이므로
// 소비 게이트가 차단하고, 스키마 없는 프로젝트는 정책을 명시적 off(기본값)로 두어 조용히 통과한다.
// 반환: 사유 문자열 배열(빈 배열 = 판정 성립 ∨ off). 순수 — 출력·exit은 소비 게이트.
import { inertReasons } from "./verdict-lib.mjs";

export function schemaBackingInertReasons(policy, sources, roles) {
  // 규칙 정본은 verdict-lib의 inertReasons — 축 셋에 같은 형태가 복제돼 있었다(R13 구조 중복).
  // 여기 남는 것은 **이 축의 사유 문구**뿐이다(문구는 규칙이 아니라 데이터다). 출력 불변.
  return inertReasons(policy, [
    { ok: Array.isArray(sources) && sources.length > 0, reason: "entitySchemaSources 비어 있음(구조 SSOT 어댑터 미선언 — 대조할 실재 집합이 없음)" },
    { ok: Boolean(roles && roles.entity), reason: "entity 역할 카테고리 미해석(ownershipCategoryRoles에 entity 선언 없음 + 이름 폴백 실패)" },
  ]);
}

// 스키마 소스별 패턴 문자열의 정규식 유효성 검사 — 잘못된 정규식은 {index, pattern}로 수집한다
// (게이트가 크래시하지 않고 명확히 보고하도록). 엔진별 예외 메시지는 담지 않는다(Node↔Python 패리티).
export function validateSchemaPatterns(sources) {
  const errors = [];
  (sources || []).forEach((src, index) => {
    for (const p of (src && src.patterns) || []) {
      try { new RegExp(p, "g"); }
      catch { errors.push({ index, pattern: String(p) }); }
    }
  });
  return errors;
}

// 스키마 소스 텍스트에서 실재 entity 식별자 추출 — units: [{text, patterns:["정규식문자열"]}].
// 각 패턴의 캡처그룹 1이 식별자. 전역 매치. 정규화(트림·소문자) 집합 반환.
// 잘못된 정규식은 건너뛴다(크래시 방지 — 유효성은 validateSchemaPatterns가 별도 보고).
export function extractSchemaEntities(units) {
  const set = new Set();
  for (const { text, patterns } of units || []) {
    for (const p of patterns || []) {
      let rx;
      try { rx = new RegExp(p, "g"); } catch { continue; }
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
//
// slugBySpec(선택): specId → 그 스펙 파일명의 슬러그. **모듈 문법**(SPEC-029 ①)이 선언된
// 레포에서 쓴다 — entity가 DB 테이블이 아니라 코드 모듈인 경우, 실재의 정본은 스키마가 아니라
// **그 스펙의 파일명**이다. 전역 집합이 아니라 **스펙별** 대조라는 점이 중요하다: 전역이면
// SPEC-010이 SPEC-011의 슬러그를 소유해도 통과한다(키 유일성만으론 뒤바뀜을 못 잡는다).
// 미전달(null)이면 종전과 완전히 동일하게 동작한다 — 기존 사이트 출력 바이트 불변.
export function schemaBackingFindings(ownedBySpec, schemaSet, exemptSet, slugBySpec) {
  const findings = [];
  for (const { specId, entities } of ownedBySpec || []) {
    const slug = slugBySpec ? slugBySpec[specId] : undefined;
    for (const raw of entities || []) {
      const ent = String(raw).trim().toLowerCase();
      if (!ent || ent === "—" || ent === "-") continue;
      if (schemaSet.has(ent)) continue;
      if (exemptSet && exemptSet.has(ent)) continue;
      if (slug && ent === slug) continue;                       // 모듈 문법으로 실재 확인
      findings.push({ specId, entity: ent });
    }
  }
  return findings;
}
