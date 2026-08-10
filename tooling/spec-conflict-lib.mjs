// tooling/spec-conflict-lib.mjs
// 명세 자기모순 감사 순수 코어 (SPEC-052, R20) — **명세 코퍼스가 스스로와 충돌하지 않는가.**
//
// 오너 지시: "명세가 충돌되는 것도 없도록 방법론이 잘 구성되어야 한다. 예를 들면 spec 1은 A를
// 해라, spec 2는 A를 하지 말아라 — 애초에 이런 구멍도 없어야 한다."
//
// 실측 제보(2026-08-10): 에이전트가 배포 실패 원인을 조사하며 ArgoCD sync 실패를 원인으로 단정해
// 보고했다. 그런데 그 문자열은 이미 명세의 Edge Case에 있었고, 같은 문서 273행에 소유자 결정
// ("배포는 GitOps가 힘드니 젠킨스에서 바로 배포한다")과 그에 따른 요구 신설이 기록돼 있었다.
// 소유자는 여러 세션에 걸쳐 "ArgoCD 쓰지 마라"를 지시했는데 **재발했다.** 명세 안에 서로 반대
// 방향을 가리키는 지시가 공존하면, 급할 때 에이전트는 자기가 먼저 본 쪽을 따른다.
//
// ── 이 코어는 감사의 **결정적 절반**이다 ─────────────────────────────────────
// "같은 기능에 1은 A, 2는 B" 같은 의미 충돌은 확률적 판정이고, 이 킷은 확률적 판정에 차단력을
// 주지 않는다. 반면 **같은 대상에 대한 상반된 지시**(SHALL ↔ SHALL NOT)는 정적으로 결정된다 —
// 그 절반을 게이트로 만들고 차단한다. 나머지 절반은 열거기가 쌍을 전수 열거하고 사람·LLM이
// 판정하는 층으로 남는다(SPEC-033 동의어 후보와 같은 분업: **전수성은 열거기가 보장한다**).
//
// ── 오탐 억제가 설계의 절반이다 ──────────────────────────────────────────────
// 이 축은 오탐이 나면 즉시 꺼진다. 도입 전 킷 코퍼스(지시 445건)로 재며 세 번 조정했다:
//   1. 고정 길이 술어 머리(앞 K토큰) 비교 → **짧은 술어를 통째로 건너뛰는 회수 구멍**이 있었다
//      (`SHALL NOT use ArgoCD.`는 2토큰이라 K=3에서 판정 대상 밖). **포함 관계**로 교체.
//   2. 술어가 뒤 절까지 삼켜 무관한 지시가 겹쳤다(`; WHERE the command exit…`) → **절 경계**에서 끊는다.
//   3. `report it as a violation` 같은 **흔한 술어**는 주어가 달라도 겹쳤다(실측 오탐: 면제 글롭
//      판정 vs 래칫 판정). 어휘 목록을 박지 않고 **말뭉치 희귀도**로 갈랐다 — 공유 토큰에 코퍼스
//      전체에서 드문 토큰이 하나도 없으면 후보로 세지 않는다. 목록이 아니라 통계라 자기교정적이다.
// 최종: 킷 오탐 0 · 양성 대조(긴 형태·짧은 형태) 2/2.
//
// 순수 함수(IO 없음) — 스펙 읽기는 소비 게이트가 주입한다. Python 미러(SPEC-006).

// 부정 극성 마커. EARS 정본이 영어이므로 킷 문법이고, 프로젝트 어휘가 아니다.
export const DEFAULT_NEGATION_MARKERS = Object.freeze(["NOT", "NEVER"]);
// 술어를 끊는 절 경계 — 여기서 새 EARS 절이 시작되므로 그 뒤는 다른 지시의 문맥이다.
export const DEFAULT_CLAUSE_BREAKS = Object.freeze([";", "WHERE", "WHEN", "WHILE", "IF", "THEN", " so that "]);
// 기능어 — 술어의 내용 토큰만 남긴다. 목록이 판정을 좌우하지 않도록 희귀도 판정을 함께 쓴다.
export const DEFAULT_STOPWORDS = Object.freeze([
  "a", "an", "the", "its", "their", "that", "this", "those", "these", "of", "to", "for", "in", "on", "at", "by",
  "with", "and", "or", "not", "be", "is", "are", "as", "so", "it", "they", "them", "from", "into", "than",
  "then", "when", "if", "while", "where", "only", "rather",
]);
// 최소 내용 토큰 수 — 1토큰 술어("report")끼리의 겹침은 신호가 아니다.
export const DEFAULT_MIN_TOKENS = 2;
// 희귀 토큰 기준 — 이 수 이하의 스펙에만 등장하는 토큰이 "구별력 있는" 토큰이다.
export const DEFAULT_MAX_DOC_FREQ = 3;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 지시 추출 — 한 줄에 여러 지시가 올 수 있다(`SHALL X … and SHALL NOT Y`).
// 반환 [{ neg, predicate }] — predicate는 절 경계까지만.
export function lineDirectives(line, negationMarkers = null, clauseBreaks = null) {
  const negs = (negationMarkers || DEFAULT_NEGATION_MARKERS).map(esc).join("|");
  const re = new RegExp(`\\bSHALL(\\s+(?:${negs}))?\\b`, "g");
  const src = String(line || "");
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ at: m.index, len: m[0].length, neg: Boolean(m[1]) });
  const breaks = clauseBreaks || DEFAULT_CLAUSE_BREAKS;
  const breakRe = new RegExp(breaks.map((b) => (/^[A-Z]+$/.test(b) ? `\\b${esc(b)}\\b` : esc(b))).join("|"));
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].at + marks[i].len;
    const to = i + 1 < marks.length ? marks[i + 1].at : src.length;
    // 절 경계에서 끊는다 — 뒤 절은 다른 지시의 문맥이고, 삼키면 무관한 지시가 겹친다(실측 오탐).
    out.push({ neg: marks[i].neg, predicate: src.slice(from, to).split(breakRe)[0] });
  }
  return out;
}

// 술어 → 내용 토큰 집합. 거친 단수화(`spec's`·`specs` → `spec`)로 표기 차이를 흡수한다.
export function predicateTokens(predicate, stopwords = null) {
  const stop = new Set((stopwords || DEFAULT_STOPWORDS).map((s) => String(s).toLowerCase()));
  const toks = String(predicate || "").toLowerCase()
    .replace(/`/g, "").replace(/\*\*/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/'s$/, "").replace(/s$/, ""))
    .filter((t) => t && !stop.has(t));
  return new Set(toks);
}

// 코퍼스에서 지시를 모은다. specs: [{ id, file, text }], isDeclLine: (line) => boolean.
// 반환 [{ specId, file, neg, predicate, tokens }].
export function collectDirectives(specs, isDeclLine, opts = {}) {
  const out = [];
  for (const s of specs || []) {
    for (const line of String(s.text || "").split("\n")) {
      if (!isDeclLine(line)) continue;
      for (const d of lineDirectives(line, opts.negationMarkers, opts.clauseBreaks)) {
        const tokens = predicateTokens(d.predicate, opts.stopwords);
        if (tokens.size < (opts.minTokens ?? DEFAULT_MIN_TOKENS)) continue;
        out.push({ specId: s.id, file: s.file, neg: d.neg, predicate: d.predicate.trim(), tokens });
      }
    }
  }
  return out;
}

// 토큰별 문서빈도(등장 스펙 수) — 흔한 술어를 가려내는 자기교정 통계.
export function docFrequency(directives) {
  const df = new Map();
  for (const d of directives || []) {
    for (const t of d.tokens) {
      if (!df.has(t)) df.set(t, new Set());
      df.get(t).add(d.specId);
    }
  }
  return df;
}

// 판정 — 상반 극성 + 토큰 포함 + 공유 토큰에 희귀 토큰 존재.
// 반환 { conflicts, sameSpec, directives } — conflicts는 교차 스펙, sameSpec은 한 스펙 내.
// **둘을 합치지 않는다**: 한 문서가 스스로와 모순인 것과 두 문서가 어긋난 것은 해소 방법이 다르다
// (전자는 그 스펙의 편집, 후자는 어느 쪽이 정본인지의 결정 — 소유자 판단이 필요할 수 있다).
export function specConflicts(directives, opts = {}) {
  const maxDf = opts.maxDocFreq ?? DEFAULT_MAX_DOC_FREQ;
  const df = docFrequency(directives);
  const rare = (tokens) => [...tokens].some((t) => (df.get(t) || new Set()).size <= maxDf);
  const subset = (a, b) => [...a].every((t) => b.has(t));
  const conflicts = [], sameSpec = [];
  const list = directives || [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (A.neg === B.neg) continue;                        // 같은 방향 — 모순이 아니다
      if (!(subset(A.tokens, B.tokens) || subset(B.tokens, A.tokens))) continue;
      const shared = A.tokens.size <= B.tokens.size ? A.tokens : B.tokens;
      if (!rare(shared)) continue;                          // 흔한 술어끼리의 겹침 — 주어가 다를 개연성
      const pair = {
        positive: A.neg ? B : A,
        negative: A.neg ? A : B,
        shared: [...shared].sort(),
      };
      (A.specId === B.specId ? sameSpec : conflicts).push(pair);
    }
  }
  return { conflicts, sameSpec, directives: list.length };
}

// 사람이 읽는 두 줄 — **어느 쪽이 정본인지는 게이트가 정하지 않는다.**
// 모순의 해소는 어느 지시가 살아남을지의 결정이고 그건 소유자의 판단이다. 게이트는 둘을 나란히
// 보여주고 결정을 요구한다(추정으로 한쪽을 고르면 그 추정이 다음 모순의 씨앗이 된다).
export function formatConflict(pair) {
  const p = pair.positive, n = pair.negative;
  return [
    `${p.specId} ${p.neg ? "SHALL NOT" : "SHALL"} ${p.predicate}`,
    `${n.specId} ${n.neg ? "SHALL NOT" : "SHALL"} ${n.predicate}`,
    `공유 대상: ${pair.shared.join(" · ")} — 어느 쪽이 정본인지 결정해 한쪽을 고쳐라(게이트는 정하지 않는다)`,
  ];
}
