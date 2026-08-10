// tooling/intro-doc-lib.mjs
// 소개 문서 동기 판정 순수 코어 (SPEC-045) — **설명이 도구보다 늦으면 그 설명은 거짓이 된다.**
//
// 킷은 규칙을 늘려 왔고 소개 문서는 손으로 따라왔다. 그 손이 두 군데서 미끄러진 것이 실측으로
// 확인됐다: 규칙표에 R14가 생겼는데 소개 문서는 R13까지만 말하고 있었고, 소개 문서가 인용한
// "게이트 18종"은 실제 19종이 된 뒤에도 그대로였다. 둘 다 아무 게이트도 잡지 않았다 —
// 문서는 어떤 축에서도 판정 대상이 아니었기 때문이다.
//
// 새로 배우는 사람은 코드가 아니라 이 문서로 방법론을 만난다. 문서가 낡으면 그 사람은
// 존재하지 않는 규칙 체계를 배우고, 그 오해는 조용히 오래 간다. 그래서 소개 문서는 부산물이
// 아니라 **산출물**이고, 산출물은 게이트가 본다.
//
// 세 축, 전부 결정적이다:
//   ① 규칙 ID 커버리지 — 규칙표의 R번호가 소개 문서에 전부 나오는가(신설 규칙의 누락).
//   ② 인용 수치 검산 — 문서가 `data-sdd-count`로 표시한 숫자가 실제와 같은가(낡은 숫자).
//   ③ 동반 갱신 — 규칙표가 이 changeset에서 바뀌었으면 소개 문서도 같이 바뀌었는가.
//
// ②의 표시는 문서가 **자원해서** 다는 것이다: 숫자를 기계 검산 대상으로 올리겠다는 선언이고,
// 안 달면 그 숫자는 이 축의 판정 대상이 아니다. 강제로 모든 숫자를 긁으면 버전·연도·비율까지
// 잡아 오탐이 폭주한다(SPEC-033이 거부한 자동 추출과 같은 함정).
//
// 문서의 **내용이 옳은지**는 판정하지 않는다 — 존재는 기계, 질은 리뷰(SPEC-031·039의 경계).
// 순수 함수(IO 없음) — 파일 읽기·git diff는 소비 게이트. Python 미러(SPEC-006).

// 규칙표 행에서 규칙 ID를 뽑는다 — `| **R14 검증 실행…** | …` 꼴의 표 행 첫 칸.
// 산문 속 언급("R9 라이브 대조를 참고")은 규칙 **선언**이 아니므로 표 행만 본다.
export function ruleIdsOf(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = /^\s*\|\s*\*{0,2}(R\d+)\b/.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// 소개 문서 어디에도 나오지 않는 규칙 ID(선언 순). 단어 경계로 맞춘다 — `R1`이 `R14`에
// 부분일치하면 "R1은 설명돼 있다"가 거짓으로 참이 된다.
export function missingRuleIds(ruleIds, docTexts) {
  const texts = docTexts || [];
  return (ruleIds || []).filter((id) => !texts.some((t) => new RegExp(`(^|[^A-Za-z0-9])${id}([^0-9]|$)`).test(String(t || ""))));
}

// 문서가 기계 검산에 올린 숫자 — `<span data-sdd-count="gates">19</span>`.
// 반환 [{key, cited}](등장 순). 숫자가 아닌 본문은 무시한다(표시만 하고 값을 안 넣은 것은
// 검산 대상이 없는 것이지 위반이 아니다 — 위반은 "틀린 숫자"이지 "빈 태그"가 아니다).
export function citedCounts(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/data-sdd-count\s*=\s*"([a-z-]+)"\s*>\s*([0-9,]+)/g)) {
    out.push({ key: m[1], cited: Number(m[2].replace(/,/g, "")) });
  }
  return out;
}

// 인용 대 실제. actuals에 없는 키는 **미지원 키**로 표면화한다 — 오타난 키가 조용히
// "검산됨"으로 읽히면 이 축이 있으나 마나가 된다.
export function countMismatches(cites, actuals) {
  const out = [];
  for (const c of cites || []) {
    if (!(c.key in (actuals || {}))) { out.push({ key: c.key, cited: c.cited, actual: null }); continue; }
    if (actuals[c.key] !== c.cited) out.push({ key: c.key, cited: c.cited, actual: actuals[c.key] });
  }
  return out;
}

// 동반 갱신 — 규칙표가 바뀐 changeset에는 소개 문서도 있어야 한다.
// changed: 이 changeset이 건드린 경로 집합(Set 또는 배열). null이면 판정하지 않는다
// (커밋 밖 실행·git 없음 — 모르는 것을 위반으로 말하지 않는다).
export function companionMissing(changed, ruleSource, introDocs) {
  if (!changed) return false;
  const set = changed instanceof Set ? changed : new Set(changed || []);
  if (!set.has(ruleSource)) return false;
  return !(introDocs || []).some((d) => set.has(d));
}
