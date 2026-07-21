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
// 굵은 키마다 그게 무슨 종류인지 표기한다(owner 요구): entity `(E)`·surface/route `(R)`·capability `(C)`.
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

// 키 → 카테고리 종류(entity|surface|capability) 맵 — 마커 대조용. Ownership∪Dependencies에서
// /entit/·/surface/·/capabilit/ 매칭 카테고리만(Files·기타 제외), 관계 서픽스 제거, 첫 등장 우선.
// 그 세 종류 카테고리가 하나도 없으면(킷 Modules/Symbols·파이프라인 Datasets 등) 빈 맵 → 마커 판정 inert.
export function buildKeyKindMap(ownSections, depSections) {
  const map = new Map();
  const kindOf = (cat) =>
    /entit/i.test(cat) ? "entity" : /surface/i.test(cat) ? "surface" : /capabilit/i.test(cat) ? "capability" : null;
  const add = (raw, kind) => {
    const k = String(raw).replace(/\s*\([a-z][a-z0-9-]*\)\s*$/, "").trim().toLowerCase();
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
