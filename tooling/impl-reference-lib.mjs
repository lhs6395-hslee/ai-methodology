// tooling/impl-reference-lib.mjs
// 지목 구현체 참조 판정 순수 코어 (SPEC-046) — **스펙이 이름으로 지목한 메커니즘은 실행 경로에 있어야 한다.**
//
// 실측 제보(2026-08-10, 사례 4): FR이 배포 범위 티켓 추출의 메커니즘으로 라이브러리 함수를
// 이름으로 지목했는데(`extractDeployTickets()`), 실제 표면(`Jenkinsfile`)은 그 함수를 부르지
// 않고 쉘로 같은 일을 다시 구현했다. 두 구현의 규칙이 갈라졌고 쉘 쪽에만 결함이 둘 있었다 —
// 다건 표기 `(PJT-149,133,…)`에서 첫 건만 잡아 두 커밋에서 19건이 배포 범위에서 조용히
// 누락됐고, 근거로 인용만 한 번호가 작업 대상으로 오인됐다.
//
// 게이트는 전부 초록이었다. FR을 커버하는 테스트가 있었고(R1), 표면 파일은 소유돼 있었다
// (orphan-surfaces). 그런데 그 테스트가 단언한 것은 **버그 있는 쉘 구현이 거기 있는지**였다:
//   expect(qa).toMatch(/DEPLOY_TICKETS=\$\(git log/)
// FR이 지목한 함수가 실제로 호출되는지는 아무도 보지 않았고, 그 함수는 테스트는 통과하지만
// 프로덕션 경로에서 한 번도 실행되지 않는 **고아 구현**이었다.
//
// 이 축이 값싼 이유: 이름은 저자가 **백틱으로 명시**한 것이다. SPEC-042가 거부한 "산문에서
// 고유명사 자동 추출"과 다르다 — 백틱은 추측이 아니라 "이건 리터럴 이름이다"라는 저술 행위이고,
// 그래서 선언 없이도 오탐이 없다(킷 실측: FR 라인의 백틱 스팬 전체 중 함수 호출형·모듈명만
// 6건 추출, 오탐 0건. `--strict`·`hard`·`surfaceFormat`·`sdd.config.json`은 모두 거부된다).
//
// 두 대상 집합을 본다:
//   ① 실행 경로 — 저장소의 비-테스트 소스에서 그 이름이 **참조**되는가(정의뿐이면 고아다).
//   ② 검증 경로 — 이 FR을 커버하는 파일에 그 이름이 있는가(없으면 그 테스트는 FR의 주장이
//      아니라 현재 구현의 형태를 단언하고 있을 개연성이 높다 — 제보의 "낡은 테스트가 버그를
//      지키고 있었다"가 정확히 그 모양이다). ②의 판정은 SPEC-042의 코어를 **재사용**한다.
//
// 순수 함수(IO 없음) — 파일 읽기·소스 집합 선별은 소비 게이트. Python 미러(SPEC-006).

// 함수 호출형 — `NAME(...)`. 이름 뒤에 **공백 없이** 여는 괄호여야 한다(실측: `EntityName
// (relation-type)`이 공백 허용 시 함수로 오인됐다).
const FN_SPAN = /^([A-Za-z_$][A-Za-z0-9_$]*)\([^)]*\)$/;
// 모듈 파일명 — 확장자로만 인정한다. 확장자 없는 이름을 모듈로 보면 config 키·enum이 다 걸린다.
const MOD_SPAN = /^([A-Za-z_$][A-Za-z0-9_.$-]*\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|rb|java|kt|sh|bash|tf|php))$/;

// 참조로 인정할 최소 등장 수. 함수는 정의(1) + 호출(1) = 2, 모듈은 자기 파일을 제외하고 1.
export const REFERENCE_BAR = Object.freeze({ fn: 2, mod: 1 });

// FR 선언 라인의 백틱 스팬에서 **구현체 이름**만 뽑는다. 반환 [{name, kind, span}](등장 순, 중복 제거).
// isTestName(name) → true면 제외한다: 테스트 파일명은 구현체가 아니라 검증 자산이고,
// 그것이 실재하는지는 SPEC-031·041이 이미 본다(같은 사실을 두 축이 고발하지 않는다).
export function namedImplementations(frText, isTestName = () => false) {
  const out = [], seen = new Set();
  for (const m of String(frText || "").matchAll(/`([^`]+)`/g)) {
    const span = m[1].trim();
    const fn = FN_SPAN.exec(span);
    const mod = MOD_SPAN.exec(span);
    let name = null, kind = null;
    if (fn) { name = fn[1]; kind = "fn"; }
    else if (mod && !isTestName(mod[1])) { name = mod[1]; kind = "mod"; }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, kind, span });
  }
  return out;
}

// 식별자 경계 매칭 — 대소문자를 구분한다(식별자는 대소문자가 의미를 가진다).
// `extractDeployTickets`가 `extractDeployTicketsV2`에 부분일치하면 "참조된다"가 거짓으로 참이 된다.
export function referenceCount(text, name) {
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(text || "").match(new RegExp(`(^|[^A-Za-z0-9_$])${esc}([^A-Za-z0-9_$]|$)`, "g")) || []).length;
}

// 판정 — units: [{specId, frId, names:[{name,kind}]}], sources: [{path, text}](비-테스트·비-산문).
// 반환 [{specId, frId, name, kind, refs, bar, sites}] — 기준 미달만.
// **소유 경계를 넘어 찾는다**: 라이브러리는 다른 스펙의 파일이 정당하게 소비한다(킷 실측 —
// 소유 파일 안에서만 찾았을 때 정상 모듈 3건이 거짓 고아로 떴다).
export function implReferenceFindings(units, sources) {
  const out = [];
  for (const u of units || []) {
    for (const { name, kind } of u.names || []) {
      const bar = REFERENCE_BAR[kind] ?? 1;
      let refs = 0; const sites = [];
      for (const s of sources || []) {
        // 모듈의 경우 **그 파일 자신의 언급은 참조가 아니다** — 헤더 주석에 자기 이름을 적는 것은
        // 흔하고, 그걸 참조로 세면 모든 모듈이 자동으로 통과한다.
        if (kind === "mod" && (s.path === name || String(s.path).endsWith("/" + name))) continue;
        const c = referenceCount(s.text, name);
        if (c) { refs += c; sites.push(s.path); }
      }
      if (refs < bar) out.push({ specId: u.specId, frId: u.frId, name, kind, refs, bar, sites });
    }
  }
  return out;
}
