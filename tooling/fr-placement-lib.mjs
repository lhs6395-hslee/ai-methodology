// tooling/fr-placement-lib.mjs
// FR 배치 판정 순수 코어 (SPEC-056) — FR 정의가 `## Functional Requirements` 섹션 **안**에 있는가.
//
// 실측 제보(2026-08-11, gsn-ai-pm-management-tool): 에이전트가 하루에 같은 실수를 세 번 했다 —
// FR 정의를 FR 섹션 밖에 썼다(SPEC-015 FR-027 → Dedup-Review, TEST-003 FR-053 → Dedup-Review,
// TEST-003 FR-058 → Ownership). 파일은 멀쩡히 읽히고 스펙 문서로도 그럴싸해 보여서, 어긋남은
// **다른 게이트가 커버리지를 셀 때** 비로소 dangling @covers로 드러났다 — 사람이 그 자리에서
// 알아차릴 수 없는 부류다. 게이트는 세 번 다 사유를 정확히 말했지만 그 사유는 "정의를 못 찾았다"
// 였지 "엉뚱한 곳에 있다"가 아니었다 — **증상**을 말했지 **원인**을 말하지 않았다.
//
// grammar-lib.mjs의 frDeclarations(SPEC-013)는 이미 FR 섹션 **안**만 스캔한다 — 그래서 밖에 있는
// FR은 "선언 자체가 없다"로 사라지고, 그 사라짐이 dangling @covers라는 **다른 축**의 결함으로
// 재등장한다. 이 축은 사라짐의 **원인 자리**를 직접 잡는다: FR 형태의 줄(`isFrDeclLine`)이되 FR
// 섹션 밖에 있는 줄을 찾아 어느 섹션에 있는지·몇 번째 줄인지 함께 말한다.
//
// 순수 함수(IO 없음) — 파일 읽기·쓰기는 소비 게이트. Python 미러(SPEC-006).

import { isFrDeclLine } from "./key-anchor-lib.mjs";

export const FR_SECTION_HEADING = "Functional Requirements";

// 문서의 모든 H2(`## `) 섹션을 라인 범위로 나눈다 — sectionBlock(단일 헤딩 추출, lifecycle-lib.mjs)과
// 다른 능력이다: 여기는 **전수 열거**가 필요하다(어긋난 FR이 어느 섹션에 있는지 이름을 대야 한다).
// 반환 [{ name, startLine, endLine }] — startLine은 헤딩 다음 줄(0-based), endLine은 배타적.
// 첫 헤딩 이전의 줄은 name: null인 별도 구간을 갖는다(선두 서문 등).
export function sectionSpans(text) {
  const lines = String(text || "").split("\n");
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (m) heads.push({ line: i, name: m[1].trim() });
  }
  if (!heads.length) return [{ name: null, startLine: 0, endLine: lines.length }];
  const spans = [];
  if (heads[0].line > 0) spans.push({ name: null, startLine: 0, endLine: heads[0].line });
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].line + 1;
    const end = i + 1 < heads.length ? heads[i + 1].line : lines.length;
    spans.push({ name: heads[i].name, startLine: start, endLine: end });
  }
  return spans;
}

// 이름이 FR 섹션인가 — `sectionBlock`과 같은 규율(접두어 일치, 부제 허용: "Functional
// Requirements (EARS)"도 인정). frDeclarations의 매칭과 **동치**를 유지해야 두 축(정의 없음 vs
// 정의가 엉뚱한 곳)이 서로의 사각을 완전히 덮는다.
function isFrSectionName(name, heading) {
  return name != null && new RegExp(`^${heading}\\b`).test(name);
}

// FR 정의가 섹션 밖에 있는가 — 반환 findings[]: { frId, section, line(1-based) }.
// frDeclRe: cfg.__frDeclRe(정규식 객체 또는 source). reqAlt: cfg.__reqAlt.
// **FR 섹션이 없는 문서는 판정 대상이 아니다**(exempt) — 잡을 대상 자체가 없다(순수 인프라 스펙 등).
export function frPlacementFindings(text, frDeclRe, reqAlt = "FR", heading = FR_SECTION_HEADING) {
  const spans = sectionSpans(text);
  if (!spans.some((s) => isFrSectionName(s.name, heading))) return [];
  const lines = String(text || "").split("\n");
  const re = new RegExp(frDeclRe && frDeclRe.source ? frDeclRe.source : String(frDeclRe));
  const findings = [];
  for (const span of spans) {
    if (isFrSectionName(span.name, heading)) continue;   // FR 섹션 안 — 이 축의 대상이 아니다
    for (let i = span.startLine; i < span.endLine; i++) {
      if (!isFrDeclLine(lines[i], reqAlt)) continue;
      const m = lines[i].match(re);
      if (!m) continue;
      findings.push({ frId: m[1], section: span.name || "(첫 헤딩 이전)", line: i + 1 });
    }
  }
  return findings;
}

// --fix — FR 정의 블록을 FR 섹션 **끝**으로 옮긴다.
//
// 흡수 범위는 **FR 선언 줄 바로 다음부터, 빈 줄 없이 연속되는 `>` 줄까지만**이다. 실측: 더 넓게
// (다음 FR 선언 전까지 통째로) 흡수하자 빈 줄 하나를 건너뛴 인접 문단의 `> Bedrock 패턴은 …`
// 한 줄이 함께 딸려가 **남의 섹션 내용을 옮겼다.** 그래서 경계를 엄격히 좁힌다 — `>`가 아닌
// 어떤 줄(빈 줄 포함)을 만나면 그 자리에서 멈춘다.
//
// 훅은 이 함수를 부르지 않는다(게이트가 자동 교정하지 않는다) — `--fix`로 사람이 명시할 때만.
// 반환 { text, moved: [{ frId, from, toSection }] } — moved가 비면 text는 원본과 동일하다.
export function fixFrPlacement(text, frDeclRe, reqAlt = "FR", heading = FR_SECTION_HEADING) {
  const original = String(text || "");
  const findings = frPlacementFindings(original, frDeclRe, reqAlt, heading);
  if (!findings.length) return { text: original, moved: [] };

  const lines = original.split("\n");
  const spans = sectionSpans(original);
  const frSpan = spans.find((s) => isFrSectionName(s.name, heading));
  if (!frSpan) return { text: original, moved: [] };   // exempt와 동형 — 옮길 곳이 없다

  const blocks = findings.map((f) => {
    const start = f.line - 1;
    let end = start + 1;
    while (end < lines.length && /^\s*>/.test(lines[end])) end++;
    return { start, end, frId: f.frId, from: f.section };
  }).sort((a, b) => a.start - b.start);

  const kept = [];
  let cursor = 0;
  for (const b of blocks) { kept.push(...lines.slice(cursor, b.start)); cursor = b.end; }
  kept.push(...lines.slice(cursor));

  // frSpan.endLine은 **원본** 좌표다. 그 앞에서 제거된 줄 수만큼 kept 배열에서는 위치가 당겨진다
  // (제거는 전부 FR 섹션 밖에서 일어나므로 FR 섹션 안쪽 줄 번호 자체는 흔들리지 않는다).
  const removedBefore = blocks.filter((b) => b.start < frSpan.endLine)
    .reduce((n, b) => n + (b.end - b.start), 0);
  const insertAt = frSpan.endLine - removedBefore;

  const insertion = blocks.flatMap((b) => lines.slice(b.start, b.end));
  const finalLines = [...kept.slice(0, insertAt), ...insertion, ...kept.slice(insertAt)];

  return {
    text: finalLines.join("\n"),
    moved: blocks.map((b) => ({ frId: b.frId, from: b.from, toSection: heading })),
  };
}
