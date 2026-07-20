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

// FR "선언 라인"인가 — 불릿의 **<REQ>-NNN[a]** 로 시작하는 라인만(본문·Change Log의 FR 언급과 구분).
export function isFrDeclLine(line, reqAlt = "FR") {
  return new RegExp(`^\\s*-?\\s*\\*\\*(?:${reqAlt})-\\d{3}[a-z]?\\*\\*`).test(line);
}

// FR 선언 라인에서 앵커 후보 추출 — 코드 스팬 제거 후 평문 bold 토큰, FR-ID 제외.
// 반환: 정규화(트림·소문자) 토큰 배열(등장 순, 중복 유지 — 보고는 호출부가 dedup).
export function extractAnchors(line, reqAlt = "FR") {
  const idRe = new RegExp(`^(?:${reqAlt})-\\d{3}[a-z]?$`);
  const out = [];
  const stripped = stripCodeSpans(line);
  for (const m of stripped.matchAll(/\*\*([^*]+?)\*\*/g)) {
    const tok = m[1].trim();
    if (!tok || idRe.test(tok)) continue;
    out.push(tok.toLowerCase());
  }
  return out;
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
