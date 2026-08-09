// tooling/key-anchor-lib.mjs
// FR 키 앵커 판정 순수 코어 (SPEC-023).
// FR 선언 라인의 **bold**는 수사적 강조가 아니라 "이 토큰이 Ownership/Dependencies 키다"의
// 선언(키 앵커)으로 예약한다 — FR→키 도출(METHODOLOGY 키 생성 절차)의 원천 단어가 스펙
// 본문에 흔적 없이 사라지던 것을, 저술 시점 표기 + 결정적 대조로 가시화한다.
// consistency 게이트(키→본문 근거)의 역방향 짝: 앵커(본문→키)와 합쳐 양방향이 닫힌다.
//
// 문법: 앵커 = "평문 bold"(**pjt_projects**). 백틱 코드 스팬(`...`)은 리터럴 인용이라
// 앵커가 아니며, 코드 스팬 안의 **도 강조가 아니다(마크다운 의미론 그대로 — 기존
// `- **Files**:` 류 인용과 충돌 없음). FR-ID 토큰(**FR-NNN**)은 앵커에서 제외.
// 정책: frKeyAnchorPolicy off(기본 — 판정 안 함)|advisory(미매치 경고)|hard(미매치 exit 1).
// 판정은 문자열 파싱·집합 대조만(git·파일시스템 비의존). Python판 sdd_gates.py 미러(SPEC-006).

// 카테고리 역할 해석의 **정본**은 key-pipeline(SPEC-001)이다 — 이름 폴백 정규식을 여기 복제하면
// 두 사이트가 갈라진다(R13이 실측으로 잡은 중복). ownership-keys는 이 파일을 참조하지 않아 순환 없음.
import { resolveCategoryRoles } from "./ownership-keys.mjs";

// 코드 스팬 제거 — `...` 안은 리터럴(강조 아님). 짝 안 맞는 홀 백틱은 그대로 둔다(안전).
export function stripCodeSpans(line) {
  return String(line).replace(/`[^`]*`/g, "");
}

// 코드 스팬(백틱) 내용 추출 — 선언 키가 백틱에 있으면 앵커로 승격 대상(SPEC-023 FR-006).
export function extractCodeSpans(line) {
  const out = [];
  for (const m of String(line).matchAll(/`([^`]+)`/g)) out.push(m[1].trim());
  return out;
}

// FR "선언 라인"인가 — 불릿의 **<REQ>-NNN[a]** 로 시작하는 라인만(본문·Change Log의 FR 언급과 구분).
export function isFrDeclLine(line, reqAlt = "FR") {
  return new RegExp(`^\\s*-?\\s*\\*\\*(?:${reqAlt})-\\d{3}[a-z]?\\*\\*`).test(line);
}

// FR 선언 라인에서 앵커+카테고리 마커 추출 — 코드 스팬 제거 후 평문 bold 토큰과 그 뒤 "(X)" 마커.
// 굵은 키마다 그게 무슨 종류인지 표기한다(owner 요구): entity `(E)`·surface `(S)`·capability `(C)`.
// 반환: [{token(정규화 트림·소문자), marker(대문자 1글자 or null)}] (등장 순), FR-ID 제외.
export function extractAnchorsWithMarkers(line, reqAlt = "FR") {
  const idRe = new RegExp(`^(?:${reqAlt})-\\d{3}[a-z]?$`);
  const out = [];
  const stripped = stripCodeSpans(line);
  for (const m of stripped.matchAll(/\*\*([^*]+?)\*\*(?:\s*\(([A-Za-z])\))?/g)) {
    const tok = m[1].trim();
    if (!tok || idRe.test(tok)) continue;
    out.push({ token: tok.toLowerCase(), marker: m[2] ? m[2].toUpperCase() : null });
  }
  return out;
}

// FR 선언 라인에서 앵커 후보 추출 — 코드 스팬 제거 후 평문 bold 토큰, FR-ID 제외.
// 반환: 정규화(트림·소문자) 토큰 배열(등장 순, 중복 유지 — 보고는 호출부가 dedup).
export function extractAnchors(line, reqAlt = "FR") {
  return extractAnchorsWithMarkers(line, reqAlt).map((a) => a.token);
}

// 스펙의 대조 키 집합 — Ownership ∪ Dependencies 전 카테고리(Files 제외 — 글롭은 키가 아님),
// 정규화(트림·소문자) + Dependencies 구조화 관계의 "(relation-type)" 서픽스 제거(SPEC-017 문법).
export function buildKeySet(ownSections, depSections) {
  const keys = new Set();
  const add = (raw) => {
    const k = String(raw).replace(/\s*\([a-z][a-z0-9-]*\)\s*$/, "").trim().toLowerCase();
    if (k && k !== "—" && k !== "-") keys.add(k);
  };
  for (const sec of [ownSections, depSections]) {
    for (const [cat, list] of Object.entries(sec || {})) {
      if (/^files$/i.test(cat)) continue;
      for (const raw of list || []) add(raw);
    }
  }
  return keys;
}

// Ownership·Dependencies 항목에서 **키 본체만** 남긴다 — 앵커 대조의 좌변.
//
// 벗기는 것: ① 감싼 백틱 ② 뒤따르는 괄호 주석·관계 서픽스(내용 무관, 반복). 이 위치의
// 괄호는 항상 주석 아니면 relation-type이다 — entity 식별자·`entity.verb`·`METHOD /path`
// 어디에도 괄호가 없다.
//
// ⚠ 종전엔 `\([a-z][a-z0-9-]*\)$`(ASCII 소문자 kebab)만 벗겨서, **백틱이나 비-ASCII 사유를
// 단 항목은 키 본체가 추출되지 않았다** — 그러면 그 키를 굵게 앵커해도 "소유·참조 키 아님"
// 미매치가 되어 **앵커가 구조적으로 불가능**해진다. 실측(소비 프로젝트 PM SPEC-004):
// `` `pjt_salary_ranges` (spec-007 소유 — rank별 최소 월급 조회) `` 형태 7건이 통째로 키가
// 되어 `pjt_salary_ranges` 단독 키가 맵에 없었다. 킷 자기적용으로는 안 보였다 — 킷 스펙은
// Dependencies에 백틱·한글 주석을 달지 않는다.
//
// ⚠ 이 교정은 오탐만 줄이는 것이 **아니다**. 맵에 정상 키가 늘면서, 그 키를 마커 없이 굵게
// 쓴 FR이 이제 마커 위반으로 드러난다 — 종전엔 "키가 아님"으로 오분류돼 가려져 있던 **진짜
// 위반**이다(실측: PM 마커 위반 9 → 17). 강도는 그대로이고 보이는 것만 늘어난다.
//
// 추출 규칙(결정적, 두 갈래):
//   ① 항목이 백틱으로 시작하면 **첫 백틱 스팬의 내용**이 키다 — 사유 안에 괄호·백틱이
//      중첩돼도(`` `x` (… `f()` …) ``) 안전하다. 괄호 짝 세기로는 이 형태를 못 벗긴다.
//   ② 아니면 첫 ` (` 앞까지가 키다 — `pjt_projects (references)` 류.
// 둘 다 아니면(산문을 그대로 적은 항목) 손대지 않는다 — 산문에서 키를 뽑는 것은 추측이고,
// 그 항목은 어차피 앵커 대상이 될 수 없다(실측: 소비 프로젝트에 `aws eks 클러스터`처럼
// 서술을 Dependencies에 적은 항목이 있다 — 그건 표기 문제가 아니라 선언 문제다).
export function bareKey(raw) {
  const s = String(raw ?? "").trim();
  const tick = s.match(/^`([^`]+)`/);
  if (tick) return tick[1].trim().toLowerCase();
  const paren = s.split(/\s+\(/)[0];
  return paren.trim().toLowerCase();
}

// 키 → 카테고리 종류(entity|surface|capability) 맵 — 마커 대조용. Ownership∪Dependencies에서
// **역할이 해석된** 카테고리만(Files·역할 없는 카테고리 제외), 관계 서픽스 제거, 첫 등장 우선.
// 역할은 config가 선언하고(ownershipCategoryRoles) 미선언 시 이름 정규식 폴백(SPEC-001 FR-010).
// roles 미전달 시 기존 이름 규칙으로 동작(하위호환). 셋 다 미해석이면 빈 맵 → 마커 판정 inert.
export function buildKeyKindMap(ownSections, depSections, roles = null) {
  const map = new Map();
  const byRole = roles && (roles.entity || roles.surface || roles.capability)
    ? new Map([[roles.entity, "entity"], [roles.surface, "surface"], [roles.capability, "capability"]]
        .filter(([c]) => c)
        .map(([c, k]) => [String(c).trim().toLowerCase(), k]))
    : null;
  // 역할 미전달 시의 이름 폴백은 **정본이 하나**여야 한다 — 여기 복제돼 있던 정규식이
  // resolveCategoryRoles의 것과 갈라지면 같은 카테고리를 두 사이트가 다르게 읽는다(R13 실측).
  const nameFallback = (cat) => {
    const r = resolveCategoryRoles([cat], null);
    return r.entity ? "entity" : r.surface ? "surface" : r.capability ? "capability" : null;
  };
  const kindOf = (cat) => (byRole ? (byRole.get(String(cat).trim().toLowerCase()) || null) : nameFallback(cat));
  const add = (raw, kind) => {
    const k = bareKey(raw);
    if (k && k !== "—" && k !== "-" && !map.has(k)) map.set(k, kind);
  };
  for (const sec of [ownSections, depSections]) {
    for (const [cat, list] of Object.entries(sec || {})) {
      const kind = kindOf(cat);
      if (!kind) continue;
      for (const raw of list || []) add(raw, kind);
    }
  }
  return map;
}

// 카테고리 마커 판정(SPEC-023 확장) — FR 선언 라인의 각 bold 키 앵커가 그 키의 카테고리 마커를
// 달았는지 대조한다(굵은 키가 무슨 종류인지 즉시 구분 — owner 요구). markers = {entity,surface,capability}
// → 각 종류의 마커 글자(기본 E/R/C). 키가 아닌 bold는 여기서 스킵(anchorFindings가 미매치로 처리).
// keyKindMap이 비면 판정 안 함(inert). 반환 {missing:[{fr,token,expected}], wrong:[{fr,token,expected,got}]}.
export function categoryMarkerFindings(frLines, keyKindMap, markers, reqAlt = "FR") {
  const frId = new RegExp(`\\*\\*((?:${reqAlt})-\\d{3}[a-z]?)\\*\\*`);
  const missing = [], wrong = [];
  if (!keyKindMap || keyKindMap.size === 0) return { missing, wrong };
  for (const line of frLines || []) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    const fr = (line.match(frId) || [null, "?"])[1];
    const seen = new Set();
    for (const { token, marker } of extractAnchorsWithMarkers(line, reqAlt)) {
      if (seen.has(token)) continue;
      seen.add(token);
      const kind = keyKindMap.get(token);
      if (!kind) continue; // 키가 아니면 스킵(base anchorFindings 소관)
      const expected = (markers && markers[kind]) ? String(markers[kind]).toUpperCase() : null;
      if (!expected) continue;
      if (!marker) missing.push({ fr, token, expected });
      else if (marker !== expected) wrong.push({ fr, token, expected, got: marker });
    }
  }
  return { missing, wrong };
}

// 백틱 안에 선언 키가 있으면 위반(SPEC-023 FR-006) — 키는 리터럴(백틱)이 아니라 **키** (마커) 앵커여야
// 한다. "굵게 ⟺ 키" 규율의 세 번째 방향(키를 굵게 강제). keyKindMap 비면 inert. 반환 [{fr,token,expected}].
export function backtickKeyFindings(frLines, keyKindMap, markers, reqAlt = "FR") {
  const frId = new RegExp(`\\*\\*((?:${reqAlt})-\\d{3}[a-z]?)\\*\\*`);
  const out = [];
  if (!keyKindMap || keyKindMap.size === 0) return out;
  for (const line of frLines || []) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    const fr = (line.match(frId) || [null, "?"])[1];
    const seen = new Set();
    for (const span of extractCodeSpans(line)) {
      const tok = span.trim().toLowerCase();
      if (seen.has(tok)) continue;
      seen.add(tok);
      const kind = keyKindMap.get(tok);
      if (!kind) continue;
      // entity 키는 백틱이 **정본 표기**다(owner 결정 2026-07-28) — 백틱의 뜻이 "entity 키 혹은
      // 그 종속(컬럼·필드·enum 값)"으로 좁혀졌고, 그래서 entity를 백틱에 둔 것은 위반이 아니다.
      // surface·capability 키는 여전히 위반이다 — 그쪽 정본은 볼드+마커 앵커뿐이다. 결과적으로
      // **서식이 키의 종류를 말한다**: 백틱 = 데이터 모델 / 볼드+마커 = 앵커.
      if (kind === "entity") continue;
      const expected = (markers && markers[kind]) ? String(markers[kind]).toUpperCase() : null;
      if (!expected) continue;
      out.push({ fr, token: tok, expected });
    }
  }
  return out;
}

// 소유 키 앵커 강제(SPEC-023 FR-007, owner (B) "모든 키 참조를 굵게+마커로 강제") — 스펙이 소유한
// entity/surface/capability 키는 각각 FR 선언 라인에서 최소 1회 굵게 앵커돼야 한다. 산문/백틱에만
// 있고 굵게 앵커 안 된 소유 키는 위반(그 키를 FR에서 **키** (마커)로 드러내라). ownedKindMap 비면 inert.
// 마커 정합은 FR-005가 별도 판정 — 여기선 "굵게 등장했는가"만(이중 보고 방지). 반환 [{key,kind,expected}].
export function unanchoredOwnedKeyFindings(frLines, ownedKindMap, markers, reqAlt = "FR") {
  const out = [];
  if (!ownedKindMap || ownedKindMap.size === 0) return out;
  const anchored = new Set();
  for (const line of frLines || []) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    for (const { token } of extractAnchorsWithMarkers(line, reqAlt)) anchored.add(token);
  }
  for (const [key, kind] of ownedKindMap) {
    if (anchored.has(key)) continue;
    const expected = (markers && markers[kind]) ? String(markers[kind]).toUpperCase() : null;
    out.push({ key, kind, expected });
  }
  return out;
}

// 스펙 한 장 판정 — frLines(선언 라인 배열)의 앵커를 keySet과 대조.
// 반환 {matched:[{fr,token}], unmatched:[{fr,token}]} (라인 순, 라인 내 등장 순 — 결정적).
export function anchorFindings(frLines, keySet, reqAlt = "FR") {
  const frId = new RegExp(`\\*\\*((?:${reqAlt})-\\d{3}[a-z]?)\\*\\*`);
  const matched = [], unmatched = [];
  for (const line of frLines || []) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    const fr = (line.match(frId) || [null, "?"])[1];
    const seen = new Set(); // 같은 라인 내 같은 토큰 중복 보고 방지
    for (const tok of extractAnchors(line, reqAlt)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      (keySet.has(tok) ? matched : unmatched).push({ fr, token: tok });
    }
  }
  return { matched, unmatched };
}
