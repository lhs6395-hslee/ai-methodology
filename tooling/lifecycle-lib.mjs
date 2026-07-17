// tooling/lifecycle-lib.mjs
// 스펙 수명주기 순수 코어 — Status enum 파싱·검증 + 리뷰 기록(Review Log·Dedup-Review) 존재 판정.
// completeness(존재 검사)·spec-sync(Draft 차단)가 소비. git·파일시스템 비의존(테스트 용이).
// 원칙: 시간 순서(temporal)가 아니라 **상태 순서**를 강제한다 — "Reviewed 이상이면 리뷰 기록이
// 존재해야 한다"는 상태의 요구지, 명령 실행의 순서 감시가 아니다. 설계: SPEC-008.
// Python판 sdd_gates.py가 동일 동작을 미러(SPEC-006 패리티).

// 수명주기 enum. Planned(선언·미구현 백로그)→Draft→Reviewed→Approved→Active→Deprecated(→Removed=폐기 종단, STRUCTURE.md).
// Planned: 아직 안 지은 스펙 — 0-coverage가 의도적(회계에서 planned 분류, R3 미검증 아님; SPEC-018 FR-005).
export const STATUS_ENUM = ["Planned", "Draft", "Reviewed", "Approved", "Active", "Deprecated", "Removed"];

// Reviewed 이상(리뷰를 통과한 상태) — Review Log·Dedup-Review 기록이 존재해야 하는 상태들.
const REVIEWED_PLUS = new Set(["Reviewed", "Approved", "Active"]);

// 수명 성격(Status와 직교) — removable(pre-prod 삭제 예정 비제품 도구) vs permanent(제품·영구).
// Status가 "어느 단계인가"라면 Lifecycle은 "언젠가 지워질 것인가". 선택 필드(없으면 무관),
// 있으면 enum 밖 값은 completeness가 warn(--strict 하드). TEST 도메인은 removable 관례(SPEC-015).
export const LIFECYCLE_ENUM = ["removable", "permanent"];

// 스펙 헤더의 `**Lifecycle**: <값>` 파싱. 없으면 null(선택 필드 — 하위호환).
export function parseLifecycle(text) {
  const m = text.match(/\*\*Lifecycle\*\*\s*:\s*([A-Za-z]+)/);
  return m ? m[1] : null;
}

// 스펙 헤더의 `**Status**: <값>` 파싱. 없으면 null(레거시 — 수명주기 강제 밖, 점진 도입).
export function parseStatus(text) {
  const m = text.match(/\*\*Status\*\*\s*:\s*([A-Za-z]+)/);
  return m ? m[1] : null;
}

export function isReviewedPlus(status) {
  return REVIEWED_PLUS.has(status);
}

// 소유 코드 변경을 이끌 수 있는 상태(SPEC-008 FR-008) — 리뷰를 통과했거나 수명 종료 단계.
// 화이트리스트 방식: Draft만이 아니라 Planned(리뷰 전)·enum 밖 값(Wip 등)도 코드를 못 이끈다 —
// "Draft 문자열만 검사"는 상태 순서 보장이 아니라 한 상태의 이름 검사였다(감사 T2).
// null(레거시 — Status 미선언)은 통과(점진 도입 유지).
const CODE_LEADING = new Set(["Reviewed", "Approved", "Active", "Deprecated", "Removed"]);
export function canLeadCode(status) {
  return status === null || CODE_LEADING.has(status);
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
