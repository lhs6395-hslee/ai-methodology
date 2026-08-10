// tooling/term-coverage-lib.mjs
// 의미 커버리지 판정 순수 코어 (SPEC-042) — @covers는 "이 FR을 인용한 테스트가 있다"는 뜻이지
// "이 FR을 시험한다"는 뜻이 아니다.
//
// 실측 제보(2026-08-10): FR 원문이 "THE SYSTEM SHALL choose Claude in Chrome (chrome) …"를
// 주장했는데 구현은 Playwright의 `channel:"chrome"`(그냥 실제 Chrome 바이너리 실행 — MCP
// 프로토콜과 무관, Claude-in-Chrome 경로는 애초에 없었다)이었다. 그런데 커버 테스트는:
//   expect(d).toMatchObject({ driver: "chrome", headless: false });
//   expect(runner).toContain("pickMeasureDriver");
// 를 볼 뿐이다 — "선택자가 문자열 chrome을 돌려주는가"와 "레이블을 언급하는가"만 확인하고,
// FR이 주장한 "Claude in Chrome"·"MCP"가 무엇을 의미하는지는 안 본다. FR의 주장과 테스트의
// 주장이 완전히 분리돼 있는데 커버리지 회계는 둘을 구분하지 못했다(태그 존재 = 통과).
//
// 완전한 해법(테스트가 FR의 의미를 실제로 검증하는가)은 사람/LLM 리뷰의 몫이다 — SPEC-031·
// SPEC-039가 이미 세운 경계 그대로다: 존재는 기계, 질은 리뷰. 여기서는 그 경계 안에서
// 값싸고 결정적인 신호 하나만 잡는다: **FR이 스스로 특정한 고유명사(프로토콜명·외부
// 시스템명·제품명)가 그 FR을 커버하는 어떤 파일에도 문자 그대로 나타나지 않는다.** 이것이
// 성립하면 그 커버는 최소한 "이 FR이 이름을 댄 대상"을 건드리지 않았다는 뜻이고, 사례 1처럼
// 동어반복(레이블 값만 확인)일 개연성이 높다.
//
// ⚠ 이 신호는 **재현율이 없다**(SPEC-033 ③층·SPEC-031 브라우저 마커와 같은 경계) —
// 파라프레이즈된 구현("Claude in Chrome"을 `chromeMcpBridge`로 부르는 정당한 구현)은 못
// 잡고, 우연히 같은 단어가 주석·무관 문자열에 있어도 통과로 읽는다. 그래서 용어집은
// **프로젝트가 선언**한다 — 킷은 EARS 산문에서 "고유명사"를 자동으로 뽑지 않는다(자동
// 추출은 Title-Case 단어·문장 시작 대문자를 다 잡아 오탐 폭풍을 낸다 — 이건 SPEC-033이
// 이미 거부한 길이다). 그리고 이 신호는 "용어가 문자 그대로 없다"는 사실만 말하지,
// "테스트가 부적절하다"를 판정하지 않는다 — 파라프레이즈는 동의어 등록으로 해소한다.
//
// 순수 함수(IO 없음) — 파일 읽기·글롭 컴파일·커버 파일 수집은 소비 게이트. Python 미러(SPEC-006).

import { markerHits } from "./evidence-lib.mjs";

// glossary 항목 하나의 인정 표현 집합 — 문자열이면 그 자체, 객체면 term + synonyms.
function termForms(entry) {
  const t = typeof entry === "string" ? entry : entry.term;
  const syn = typeof entry === "string" ? [] : (entry.synonyms || []);
  return [t, ...syn].filter(Boolean);
}

function displayTerm(entry) {
  return typeof entry === "string" ? entry : entry.term;
}

// FR 하나 × 용어집 → 이 FR이 실제로 주장한 용어명 목록(표시용, 등장 순서 아님·글로서리 순).
export function claimedTerms(frText, glossary) {
  const out = [];
  for (const entry of glossary || []) {
    if (termForms(entry).some((f) => markerHits(frText, f))) out.push(displayTerm(entry));
  }
  return out;
}

// 판정 — units: [{specId, frId, text, coveringTexts:[...]}].
//   text          : FR SHALL 선언 라인(스펙 본문에서 그 줄 그대로).
//   coveringTexts : 이 FR을 커버하는 파일들의 본문. **빈 배열이면 판정하지 않는다** —
//                   "커버 안 됨"은 R1(dangling/미커버)의 몫이고, 이 축은 "커버는 됐는데
//                   FR이 이름 댄 대상이 그 커버 안에 없다"만 본다(두 사실을 섞지 않는다).
// 반환 [{specId, frId, term}] — FR이 주장했는데 **모든** 커버 파일에 없는 용어(선언 순).
export function termCoverageFindings(units, glossary) {
  const out = [];
  if (!glossary || !glossary.length) return out;
  for (const u of units || []) {
    if (!u.coveringTexts || !u.coveringTexts.length) continue;
    for (const entry of glossary) {
      const forms = termForms(entry);
      if (!forms.some((f) => markerHits(u.text, f))) continue;       // FR이 이 용어를 주장 안 함
      const substantiated = u.coveringTexts.some((ct) => forms.some((f) => markerHits(ct, f)));
      if (!substantiated) out.push({ specId: u.specId, frId: u.frId, term: displayTerm(entry) });
    }
  }
  return out;
}
