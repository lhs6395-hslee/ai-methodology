// tooling/ownership-reality-lib.mjs
// 소유 키의 **실재 판정** 순수 코어 — 어댑터(정규식) 대신 **문법**으로 판정한다(SPEC-029).
//
// 왜 문법인가: entity 실재(SPEC-026)는 `entitySchemaSources`라는 정규식 어댑터에 판정을
// 위임한다. 어댑터는 프로젝트가 자유롭게 쓰는 신뢰 경계라서, 느슨하게 쓰면 판정이 조용히
// 퇴화한다(실측 우회 4경로: 임포트문을 스키마로 셈·주석 DDL 채택·스펙 자기참조·소스 제거로
// inert화). 그리고 surface 실재는 **정방향 판정 자체가 없었다** — orphan-surface는 역방향
// (코드→선언)만 보므로 "선언된 표면이 실재하는가"는 아무도 안 봤다(감사 M-2).
//
// 두 문법은 결정적이고 우회 불가다:
//   ① **모듈 문법** — entity 역할 키는 그 스펙 **파일명의 슬러그**여야 한다(1 spec = 1 모듈
//      레포). 파일명은 저장소 사실이라 어댑터로 흉내 낼 수 없다. 스키마가 정본인 레포는
//      기존 어댑터를 쓰고, 모듈이 정본인 레포는 이 문법을 쓴다 — 둘은 배타가 아니라
//      `entitySchemaSources`의 소스 종류로 공존한다(`{kind:"spec-slug"}`).
//   ② **심볼 문법** — surface 역할 키는 선언된 **소스 루트 아래 실재하는 파일 또는
//      디렉토리**여야 한다(basename 매치, 재귀). 디렉토리를 인정하는 것은 `go-gate`처럼
//      디렉토리가 표면인 경우가 실재하기 때문이다(실측).
//
// 예외 목록이 없다 — 불일치는 면제 등록이 아니라 **데이터 교정**으로 닫는다(파일명을 키에
// 맞추거나, 키를 실물 이름에 맞추거나, 소스 루트를 선언한다). 킷 자기적용 실측: 모듈 29/29,
// 심볼 52/52, 예외 0.
//
// 파일 IO는 소비 게이트가 하고 여기선 순수(문자열·집합만). Python판 sdd_gates.py 미러(SPEC-006).

// 스펙 파일명에서 슬러그 — `<PREFIX>-NNN-<slug>.md` → `<slug>`. 접두어/번호가 없으면 확장자만 제거.
// 레터 서픽스(`SPEC-001a`)도 번호부로 취급한다(ID 문법과 일치).
export function specSlug(filename) {
  const base = String(filename || "").replace(/^.*[/\\]/, "").replace(/\.md$/i, "");
  const m = base.match(/^[A-Za-z]+-\d{3}[a-z]?-(.+)$/);
  return (m ? m[1] : base).trim().toLowerCase();
}

// `entitySchemaSources`에 모듈 문법 소스가 선언됐나 — `{kind:"spec-slug"}`.
export function specSlugSourceDeclared(sources) {
  return (sources || []).some((s) => s && String(s.kind || "") === "spec-slug");
}

// 심볼(surface) 실재 판정 활성 조건: 정책 on + 소스 루트 선언 + surface 역할 카테고리 해석.
export function symbolRealityActive(policy, roots, roles) {
  return policy !== "off"
    && Array.isArray(roots) && roots.length > 0
    && Boolean(roles && roles.surface);
}

// 정책이 off가 아닌데 판정이 성립하지 않는 사유 — 침묵 금지(schemaBackingInertReasons와 동형).
// "hard 선언 + 무판정"은 거짓 안전이므로 소비 게이트가 차단한다.
import { inertReasons } from "./verdict-lib.mjs";

export function symbolRealityInertReasons(policy, roots, roles) {
  // 규칙 정본은 verdict-lib의 inertReasons — 축 셋에 같은 형태가 복제돼 있었다(R13 구조 중복).
  // 여기 남는 것은 **이 축의 사유 문구**뿐이다(문구는 규칙이 아니라 데이터다). 출력 불변.
  return inertReasons(policy, [
    { ok: Array.isArray(roots) && roots.length > 0, reason: "ownershipSourceRoots 비어 있음(소스 루트 미선언 — 대조할 실재 집합이 없음)" },
    { ok: Boolean(roles && roles.surface), reason: "surface 역할 카테고리 미해석(ownershipCategoryRoles에 surface 선언 없음 + 이름 폴백 실패)" },
  ]);
}

// 소유 surface 키가 실재 basename 집합에 없으면 위반. 키는 raw(여기서 트림·소문자).
// ownedBySpec: [{specId, surfaces:[raw...]}] · realSet: 소스 루트 아래 basename 집합(소문자).
// 반환 [{specId, symbol}] (선언 순 — 결정적).
//
// ⚠ 형식 표면(`POST /api/x`·`event:`·`job:`)은 파일이 아니므로 이 문법의 대상이 아니다 —
// 소비 게이트가 `surfaceFormat`으로 분기해 파일형 키만 넘긴다(웹 레포에 오발동 금지).
// realSet은 두 형태를 담는다 — basename(`lib.mjs`)과 **확장자 없는 상대경로**(`src/cli/x`).
// 후자가 있어야 점 표기 모듈 경로를 해석할 수 있다(아래 symbolCandidates 참조).
export function symbolRealityFindings(ownedBySpec, realSet) {
  const findings = [];
  for (const { specId, surfaces } of ownedBySpec || []) {
    for (const raw of surfaces || []) {
      const key = String(raw).trim().toLowerCase();
      if (!key || key === "—" || key === "-") continue;
      if (!symbolCandidates(key).some((c) => realSet.has(c))) findings.push({ specId, symbol: key });
    }
  }
  return findings;
}

// 한 심볼 키가 실재로 인정될 수 있는 후보 표기들 — 결정적 변환만, 추측 없음.
//
// 왜 필요한가(실측): 소비 프로젝트 finops는 표면을 **점 표기 모듈 경로**로 키한다
// (`src.cli.finops_ticket_chat`). 파일은 `src/cli/finops_ticket_chat.py`로 실재하는데
// basename 대조만 하면 영원히 매치하지 않아 **오탐률 100%**였고, 어떤 소스 루트 설정으로도
// 해결되지 않았다. 점을 경로 구분자로 읽는 것은 Python·Java 등의 표준 모듈 문법이므로
// 휴리스틱이 아니라 문법이다.
//
// 후보: ① 원문 그대로(basename·경로 모두) ② 점을 `/`로 바꾼 경로. ②는 점이 있고 `/`가
// 없을 때만 만든다 — 이미 경로면 변환할 것이 없고, `lib.mjs`처럼 확장자만 점인 경우도
// ①이 이미 잡는다(②는 `lib/mjs`가 되어 무해하게 실패).
//
// ⚠ "경로의 마지막 조각"은 후보로 넣지 않는다 — `src.cli.chat`에서 `chat`을 뽑으면 아무
// 위치의 `chat`이나 매치해 **틀린 키를 통과**시킨다. realSet이 소스 루트 접두어를 포함한
// 상대경로를 담으므로 ②만으로 실제 사례가 닫힌다(느슨한 후보를 의도적으로 뺀다).
export function symbolCandidates(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return [];
  const out = [k];
  if (k.includes(".") && !k.includes("/")) {
    out.push(k.split(".").join("/"));
  }
  return out;
}

// 파일형 표면 키인가 — 파일/디렉토리 이름으로 볼 수 있는 토큰만 심볼 문법에 넣는다.
// HTTP 표면(`GET /x`)·이벤트(`event:x`)·잡(`job:x`)·경로 표면(`/a/b`)은 제외한다.
export function isFileLikeSurface(key) {
  const s = String(key || "").trim();
  if (!s || s === "—" || s === "-") return false;
  if (/\s/.test(s)) return false;                 // `POST /api/x` 류
  if (/^[a-z]+:/i.test(s)) return false;          // `event:` `job:`
  if (s.startsWith("/")) return false;            // 경로 표면
  return true;
}
