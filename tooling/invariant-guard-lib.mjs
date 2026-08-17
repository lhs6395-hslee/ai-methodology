// tooling/invariant-guard-lib.mjs
// 가드 함수 우회 판정 순수 코어 (SPEC-059) — **"이 상태 전이는 반드시 이 함수를 거쳐야 한다"는
// 스펙 문장이 코드에서 실제로 강제되는가.**
//
// 실측 제보(소비 프로젝트, 2026-08-17): `canTransition()`/`crossCheckVerdicts()`가 dev-done
// 전이의 필수 관문(불변식 A/B)인데, 실제 쓰기 경로(`page-notes/route.ts`)는 이 함수들을
// 전혀 호출하지 않았다(참조 0건) — 화면에서 직접 상태를 바꾸면 사슬 전체가 조용히 우회된다.
// `check-ownership`은 "누가 이 엔티티를 소유하는가"만 보고 "그 엔티티의 상태를 쓰는 모든
// 표면이 지정된 가드 함수를 실제로 호출하는가"는 보지 않는다 — 이 축이 그 빈 자리다.
//
// 판정 근거는 참조 횟수다(SPEC-046 impl-reference-lib.mjs의 `referenceCount`/`REFERENCE_BAR`를
// 재사용 — 같은 이유로 이미 검증된 임계치를 새로 만들지 않는다): 가드를 단순 언급(주석·import
// 없는 텍스트)이 아니라 실제로 가져와 호출한다는 최소 증거는 "이름이 그 파일에 2회 이상
// 등장한다"이다(import 절 + 호출식). 1회뿐이면 import만 있고 호출은 없거나, 애초에 안 쓰인다.
//
// 순수 함수(IO 없음) — 파일 읽기는 소비 게이트가 주입한다.
import { referenceCount, REFERENCE_BAR } from "./impl-reference-lib.mjs";

// config 형식 검증 — guard·guardFile 필수, guardedWriteSurfaces는 1개 이상의 비어있지 않은
// 경로 배열이어야 한다. guardedFieldPattern은 선택(정규식 문자열).
export function validateInvariantGuards(guards) {
  const errors = [];
  for (const [i, raw] of (guards || []).entries()) {
    const g = raw && typeof raw === "object" ? raw : {};
    const guard = String(g.guard ?? "").trim();
    const guardFile = String(g.guardFile ?? "").trim();
    const surfaces = Array.isArray(g.guardedWriteSurfaces) ? g.guardedWriteSurfaces.filter((s) => String(s ?? "").trim()) : [];
    if (!guard) errors.push(`invariantGuards[${i}] — guard(가드 함수 이름) 필수`);
    if (!guardFile) errors.push(`invariantGuards[${i}] — guardFile(가드가 정의된 파일) 필수`);
    if (!surfaces.length) errors.push(`invariantGuards[${i}] — guardedWriteSurfaces 1개 이상 필수(빈 배열은 검사 대상 없음과 같다)`);
    if (g.guardedFieldPattern !== undefined && typeof g.guardedFieldPattern !== "string") {
      errors.push(`invariantGuards[${i}].guardedFieldPattern — 문자열(정규식 소스)이어야 한다`);
    }
  }
  return errors;
}

// 가드 자신이 실재하는지(guardFile에 그 이름이 최소 1회 등장 — 정의 자체가 없으면 애초에
// 아무도 부를 수 없다).
export function guardMissingFindings(guards, guardFileText) {
  const out = [];
  for (const g of guards || []) {
    const text = guardFileText(g.guardFile);
    if (text === null) { out.push({ guard: g.guard, guardFile: g.guardFile, reason: "guardFile 부재" }); continue; }
    if (referenceCount(text, g.guard) < 1) out.push({ guard: g.guard, guardFile: g.guardFile, reason: "guardFile에 정의가 없다" });
  }
  return out;
}

// 표면 파일이 가드를 실제로 참조하는지. `surfaceText(path)` → string|null(못 읽으면 null,
// 확인 못 함으로 분리 — 부재를 위반으로 단정하지 않는다). guardedFieldPattern이 있으면 그
// 패턴이 텍스트에 등장하는 표면만 검사 대상으로 좁힌다(그 필드를 아예 안 건드리는 표면까지
// 걸면 등록자가 guardedWriteSurfaces를 넓게 적었을 때 오탐이 폭주한다).
export function guardBypassFindings(guards, surfaceText) {
  const findings = [], unchecked = [];
  for (const g of guards || []) {
    const fieldRe = g.guardedFieldPattern ? new RegExp(g.guardedFieldPattern) : null;
    for (const surface of g.guardedWriteSurfaces || []) {
      const text = surfaceText(surface);
      if (text === null) { unchecked.push({ guard: g.guard, surface, reason: "표면 파일 부재" }); continue; }
      if (fieldRe && !fieldRe.test(text)) continue; // 그 필드를 안 건드리는 표면은 대상 밖
      const count = referenceCount(text, g.guard);
      if (count < REFERENCE_BAR.fn) {
        findings.push({ guard: g.guard, surface, count, reason: count === 0 ? "가드 참조 0건" : "가드가 import만 되고 호출 흔적이 없다(참조 1건)" });
      }
    }
  }
  return { findings, unchecked };
}
