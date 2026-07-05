// tooling/lifecycle-lib.mjs
// 스펙 수명주기 순수 코어 — Status enum 파싱·검증 + 리뷰 기록(Review Log·Dedup-Review) 존재 판정.
// completeness(존재 검사)·spec-sync(Draft 차단)가 소비. git·파일시스템 비의존(테스트 용이).
// 원칙: 시간 순서(temporal)가 아니라 **상태 순서**를 강제한다 — "Reviewed 이상이면 리뷰 기록이
// 존재해야 한다"는 상태의 요구지, 명령 실행의 순서 감시가 아니다. 설계: SPEC-008.
// Python판 sdd_gates.py가 동일 동작을 미러(SPEC-006 패리티).

// 수명주기 enum. Draft→Reviewed→Approved→Active→Deprecated(→Removed=폐기 종단, STRUCTURE.md).
export const STATUS_ENUM = ["Draft", "Reviewed", "Approved", "Active", "Deprecated", "Removed"];

// Reviewed 이상(리뷰를 통과한 상태) — Review Log·Dedup-Review 기록이 존재해야 하는 상태들.
const REVIEWED_PLUS = new Set(["Reviewed", "Approved", "Active"]);

// 스펙 헤더의 `**Status**: <값>` 파싱. 없으면 null(레거시 — 수명주기 강제 밖, 점진 도입).
export function parseStatus(text) {
  const m = text.match(/\*\*Status\*\*\s*:\s*([A-Za-z]+)/);
  return m ? m[1] : null;
}

export function isReviewedPlus(status) {
  return REVIEWED_PLUS.has(status);
}

// `## <heading>` 섹션 블록 추출(다음 ## 전까지). 섹션 없으면 null.
export function sectionBlock(text, heading) {
  const m = text.match(new RegExp(`^##\\s+${heading}\\b`, "m"));
  if (!m) return null;
  const after = text.slice(m.index);
  const body = after.slice(after.indexOf("\n") + 1);
  const next = body.search(/^##\s/m);
  return next === -1 ? body : body.slice(0, next);
}

// Review Log 기록 존재: `## Review Log` 섹션에 실제 일시(YYYY-MM-DD)가 있는 기록 행 ≥1.
// 플레이스홀더([YYYY-MM-DD])는 기록이 아니다. 판정·수행자의 "질"은 기계가 못 본다 — 존재만.
export function hasReviewLogEntry(text) {
  const block = sectionBlock(text, "Review Log");
  return block !== null && /\d{4}-\d{2}-\d{2}/.test(block);
}

// Dedup-Review 기록 존재: `## Dedup-Review` 섹션에 검토한 이웃 스펙 ID(specIdRe) ≥1
// 또는 명시적 "이웃 없음" 선언. 판정 내용은 사람/LLM 몫(DEDUP.md 경계) — 존재·형식만.
export function hasDedupReview(text, specIdRe) {
  const block = sectionBlock(text, "Dedup-Review");
  if (block === null) return false;
  return new RegExp(specIdRe.source).test(block) || /이웃 없음/.test(block);
}
