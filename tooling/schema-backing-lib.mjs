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
import { compileGlob } from "./spec-sync-lib.mjs";

export function schemaBackingInertReasons(policy, sources, roles) {
  // 규칙 정본은 verdict-lib의 inertReasons — 축 셋에 같은 형태가 복제돼 있었다(R13 구조 중복).
  // 여기 남는 것은 **이 축의 사유 문구**뿐이다(문구는 규칙이 아니라 데이터다). 출력 불변.
  return inertReasons(policy, [
    { ok: Array.isArray(sources) && sources.length > 0, reason: "entitySchemaSources 비어 있음(구조 SSOT 어댑터 미선언 — 대조할 실재 집합이 없음)" },
    { ok: Boolean(roles && roles.entity), reason: "entity 역할 카테고리 미해석(ownershipCategoryRoles에 entity 선언 없음 + 이름 폴백 실패)" },
  ]);
}

// 패턴 문자열에서 선두 인라인 플래그 그룹 `(?im)` 류를 떼어내고 {body, flags}를 반환한다
// (이슈 #21 M-4/M-5, Python 미러 `_compile_schema_pattern` — 두 엔진이 **같은 문자열 처리**를
// 거쳐야 컴파일 결과가 갈리지 않는다). 세 가지를 여기서 고정한다:
//   ① **m(멀티라인)은 항상 켠다.** 이전 판은 "g"만 줘서 `^model` 같은 라인 앵커가 텍스트
//      전체의 시작에만 걸려 사실상 매치 불가 — 소스가 뭐든 추출 0건 → 소유 entity 전부가
//      유령으로 hard 차단되고, 진단은 원인을 전혀 가리키지 못해 "일괄 면제"로 유도했다.
//      `^`/`$` 없는 기존 패턴은 m 플래그의 영향을 받지 않으므로 순수 추가다.
//   ② **인라인 플래그는 i·s만 인정한다**(m은 이미 기본이라 명시해도 무해). Python 전용 구문인
//      `(?m)`을 Node가 파싱하지 못해 같은 문자열이 엔진별로 성공/에러로 갈리던 것을, 두 엔진이
//      **직접 문자열을 파싱해 플래그로 승격**시킴으로써 없앤다 — RegExp 엔진에 그대로 맡기지 않는다.
//   ③ 인식 못 하는 인라인 플래그(x 등)나 잘못된 정규식은 컴파일 실패로 취급 — 조용히 다른 뜻으로
//      해석하지 않는다.
const INLINE_FLAGS_RE = /^\(\?([a-zA-Z]+)\)/;
export function compileSchemaPattern(pattern) {
  const src = String(pattern);
  let body = src;
  let requested = "";
  const m = INLINE_FLAGS_RE.exec(src);
  if (m) {
    if (![...m[1]].every((c) => "ims".includes(c))) throw new Error(`지원하지 않는 인라인 플래그: ${m[1]}`);
    requested = m[1];
    body = src.slice(m[0].length);
  }
  const flags = "gm" + [...new Set([...requested].filter((c) => c !== "m"))].join("");
  return new RegExp(body, flags);
}

// entitySchemaSources 글롭이 스펙 디렉토리를 가리키는 완전 순환을 차단한다(이슈 #21 C-1 실측
// 우회로 4개 중 "스펙 자기참조 글롭" — `globs:["sdd/specs/**"]`로 스펙 자신이 자기 소유 entity의
// 실재 근거가 됨: 유령 entity를 스펙에 적어 넣으면 그 스펙 자신이 그 entity의 "구조 SSOT"가
// 되어 백킹이 항상 성립한다). config 무결성 게이트(A-4 grammar-lib.mjs exemptGlobFindings)와
// 동형 — probe 경로 매치로 판정한다(실제 파일 열거 없이 순수하게). specDir은 호출부(config)가
// 주입 — 서브디렉토리 채택을 지원한다. 순수 함수, 반환: 사유 문자열 배열.
export function schemaSourceGlobFindings(sources, specDir) {
  const findings = [];
  const dir = String(specDir || "sdd/specs").replace(/\/+$/, "");
  const probe = `${dir}/SPEC-000-probe.md`;
  (sources || []).forEach((src, index) => {
    for (const raw of (src && src.globs) || []) {
      const g = String(raw).trim();
      if (!g) continue;
      let re;
      try { re = compileGlob(g); } catch { continue; }
      if (re.test(probe)) {
        findings.push(`entitySchemaSources[${index}].globs "${g}" — 스펙 디렉토리(${dir})를 가리킴: 스펙 자신이 스펙 소유 entity의 실재 근거가 되면 완전 순환이다(구조 SSOT는 코드·스키마·IaC여야 한다, 이슈 #21 C-1)`);
      }
    }
  });
  return findings;
}

// 스키마 소스별 패턴 문자열의 정규식 유효성 검사 — 잘못된 정규식은 {index, pattern}로 수집한다
// (게이트가 크래시하지 않고 명확히 보고하도록). 엔진별 예외 메시지는 담지 않는다(Node↔Python 패리티).
export function validateSchemaPatterns(sources) {
  const errors = [];
  (sources || []).forEach((src, index) => {
    for (const p of (src && src.patterns) || []) {
      try { compileSchemaPattern(p); }
      catch { errors.push({ index, pattern: String(p) }); }
    }
  });
  return errors;
}

// import 문·주석 라인의 매치는 구조 SSOT 선언으로 인정하지 않는다(이슈 #21 C-1 실측 우회로 2·3:
// `import { type Wizard } from …`의 Wizard를 정규식 어댑터가 실재 entity로 오인증했고,
// `-- TODO: CREATE TABLE wizard` 같은 주석 DDL도 정석 어댑터에서 백킹을 성립시켰다). 매치가
// 일어난 "줄" 시작이 import·라인 주석(//·#·--)·블록 주석 시작/계속(/*·*)이면 그 매치를 버린다 —
// 판정은 줄 단위라 한 줄에 캡처가 여럿이어도 균일하게 적용된다. loose-adapter형 오탐(TODO 목록
// 항목의 명사 등)은 기계로 완전히 닫히지 않는다 — 그 나머지는 표본 표면화(schemaSourceSamples)로
// 사람 승인에 맡긴다(이슈 #21 C-1, 완전 자동화 불가 영역).
const IMPORT_OR_COMMENT_RE = /^\s*(import\b|\/\/|\/\*|\*(?!\/)|#|--)/;

function lineAt(text, idx) {
  const start = text.lastIndexOf("\n", idx - 1) + 1;
  let end = text.indexOf("\n", idx);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

// 패턴별 매치를 순회하며 import·주석 라인을 걸러낸 식별자를 낸다(extractSchemaEntities·
// schemaSourceSamples 공유 코어 — 같은 필터링 로직의 리터럴 중복을 피한다, R13).
function* matchedIdentifiers(text, patterns) {
  const t = String(text || "");
  for (const p of patterns || []) {
    let rx;
    try { rx = compileSchemaPattern(p); } catch { continue; }
    for (const m of t.matchAll(rx)) {
      if (IMPORT_OR_COMMENT_RE.test(lineAt(t, m.index))) continue;
      const id = String(m[1] ?? "").trim().toLowerCase();
      if (id) yield id;
    }
  }
}

// 스키마 소스 텍스트에서 실재 entity 식별자 추출 — units: [{text, patterns:["정규식문자열"]}].
// 각 패턴의 캡처그룹 1이 식별자. 전역 매치. 정규화(트림·소문자) 집합 반환.
// 잘못된 정규식은 건너뛴다(크래시 방지 — 유효성은 validateSchemaPatterns가 별도 보고).
export function extractSchemaEntities(units) {
  const set = new Set();
  for (const { text, patterns } of units || []) {
    for (const id of matchedIdentifiers(text, patterns)) set.add(id);
  }
  return set;
}

// 소스 파일별 추출 표본 — 어댑터 **품질**은 정규식 문법만으로 판정할 수 없다(이슈 #21 C-1:
// 느슨한 어댑터 `type Wizard = {}`는 기계적으로 걸러낼 문법 결함이 없다). 이 함수는 소비 게이트가
// "어떤 파일에서 어떤 식별자가 나왔는가"를 매 실행 표면화하도록 원자료를 낸다 — 그 위에서
// /sdd-update 등 사람 개입 지점이 최종 승인한다. units: [{text, patterns, file}] — file 없는
// unit은 표본에서 제외(내부 호출 하위호환). 반환: [{file, entities:[...]}] file 오름차순.
export function schemaSourceSamples(units) {
  const byFile = new Map();
  for (const { text, patterns, file } of units || []) {
    if (!file) continue;
    for (const id of matchedIdentifiers(text, patterns)) {
      if (!byFile.has(file)) byFile.set(file, []);
      const arr = byFile.get(file);
      if (!arr.includes(id)) arr.push(id);
    }
  }
  return [...byFile.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, entities]) => ({ file, entities }));
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
