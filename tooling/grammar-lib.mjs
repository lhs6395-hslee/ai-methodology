// tooling/grammar-lib.mjs
// 스펙 문법 규범 순수 코어 (SPEC-013) — 문서(STORAGE·STRUCTURE·METHODOLOGY·DEDUP)에 규범으로
// 선언됐지만 게이트가 없던 항목의 결정적 판정을 문법화한다:
//   · Module 헤더 존재(STORAGE §2.3 "본문 필수") + 값 단일성(STRUCTURE.md 1 레포 = 1 모듈)
//   · FR 선언 라인의 SHALL 토큰(EARS 5패턴 공통 필수 — METHODOLOGY EARS 규칙의 기계 신호)
//   · Dedup-Review 기록이 참조한 이웃 스펙 ID의 실재(DEDUP.md "존재·형식" 검사의 연장)
//   · ownershipCategories의 Files 금지(DEDUP.md §3 명시 금지 — 글롭이 dedup 키로 유입 방지)
// completeness·ownership 게이트가 소비. 질(EARS 어휘·측정가능성·판정 내용)은 리뷰 몫 —
// 존재·실재·고정 enum 등 기계 신호만 판정한다(과장 금지).
// 설계: SPEC-013 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

import { sectionBlock } from "./lifecycle-lib.mjs";

// 스펙 헤더의 `**Module**: <name>` 파싱(백틱 유무 무관). 없으면 null.
export function parseModule(text) {
  const m = text.match(/\*\*Module\*\*\s*:\s*`?([^`\n]+?)`?\s*(?:\*\*|$)/m);
  return m && m[1].trim() ? m[1].trim() : null;
}

// FR 선언 라인(- **FR-NNN** …) 중 SHALL 토큰이 없는 라인의 FR ID들.
// EARS 5패턴(ubiquitous/event/state/unwanted/optional) 모두 "THE SYSTEM SHALL"을 포함한다.
// frDeclSource = cfg.__frDeclRe.source (requirementIdPrefixes 파생 — 전 사이트 동일 문법).
// 라인 단위 판정(다중행 서술이면 선언 라인에 SHALL이 오도록) — advisory 신호.
export function frLinesMissingShall(text, frDeclSource) {
  const lineRe = new RegExp(`^\\s*-\\s*${frDeclSource}`);
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(lineRe);
    if (m && !/\bSHALL\b/.test(line)) out.push(m[1]);
  }
  return out;
}

// Dedup-Review 섹션이 언급한 스펙 ID 중 실재하지 않는 것(오타·삭제 잔재) — 정렬 반환.
// 삭제된 이웃의 이력은 "이웃 없음(삭제됨)" 등 ID 없는 서술로 갱신한다(이력 자체는 보존).
export function dedupReviewDanglingIds(text, specIdRe, knownIds) {
  const block = sectionBlock(text, "Dedup-Review");
  if (block === null) return [];
  const seen = new Set();
  for (const m of block.matchAll(new RegExp(specIdRe.source, "g"))) seen.add(m[0]);
  return [...seen].filter((id) => !knownIds.has(id)).sort();
}

// ownershipCategories에 Files 금지(DEDUP.md §3) — Files는 spec-sync 소유선언 전용 필드로
// dedup 키가 아니며, 카테고리로 들어오면 glob 문자열이 키 유일성·형식검증에 유입돼 오판한다.
export function ownershipCategoriesFindings(categories) {
  return (categories || [])
    .filter((c) => String(c).trim().toLowerCase() === "files")
    .map((c) => `ownershipCategories에 "${c}" 금지 — Files는 spec-sync 소유선언 전용(dedup 키 아님, DEDUP.md §3)`);
}
