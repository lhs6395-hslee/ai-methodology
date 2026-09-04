// tooling/object-storage-lib.mjs
// 오브젝트 스토리지 프로비저닝 결정 검사 순수 코어 (SPEC-016).
// 스펙 본문이 objectStorageMarkers 중 하나에 (대소문자 무시) 매치하면 `## Object Storage
// Decision` 섹션과 그 안의 Bucket·Consolidation 라벨을 요구한다 — 버킷 선택(신규 전용 vs
// 기존 네임스페이스)과 이전(consolidation) 기준을 설계 단계에 기록하도록. completeness
// advisory(존재만 강제; 4개 세부·질은 템플릿·리뷰 몫). markers=[] 이면 전면 비활성.
// 감지는 결정적 선언 신호가 아니라 마커 휴리스틱이라 severity가 advisory다(리마인더).
// 설계: SPEC-016 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

import { auditTrailHeadingRe } from "./grammar-lib.mjs";

const REQUIRED_LABELS = ["Bucket", "Consolidation"];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 감사 트레일(Review Log/Dedup-Review/Change Log) 이전까지 — 마커 스캔 대상.
// 스펙이 스토리지를 *도입*하는 신호는 설계 본문(FR·User Story·Infra Prereq·결정 섹션)에
// 있지, 감사 기록의 서술("S3 게이트 배선함")에 있지 않다 — 게이트의 자기 서술 오탐 방지.
function beforeAuditTrail(text) {
  // 절 목록의 정본은 grammar-lib(SPEC-013 — 스펙 문법의 주인)이다. 여기 리터럴로 두면 SPEC-062
  // 로케이터가 같은 목록을 따로 들고 두 축의 "감사 절" 정의가 갈린다(R13). 동작·출력 불변.
  const m = auditTrailHeadingRe().exec(text);
  return m ? text.slice(0, m.index) : text;
}

// `## Object Storage Decision` 헤딩부터 다음 헤딩 전까지의 본문. 없으면 null.
function sectionBody(text, heading) {
  const re = new RegExp(`^#{1,6}\\s*${escapeRegExp(heading)}\\s*$`, "im");
  const m = re.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,6}\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// 마커가 ASCII 단어(문자·숫자·공백)뿐이면 \b로 경계 인식 매치 — "bucket"이 "Bitbucket" 같은
// 고유명사의 부분문자열로 오탐하지 않게 한다(이슈 #21 M-1과 같은 부분문자열 오판정 계열).
// 한글 마커는 JS 정규식 \b가 비ASCII 글자를 단어문자로 인식하지 않아 경계가 엉뚱한 자리에
// 잡히므로, 기존 그대로 부분문자열 매치를 유지한다(오탐 확대보다 하위호환을 우선).
function markerPattern(m) {
  const esc = escapeRegExp(m);
  return /^[A-Za-z0-9 ]+$/.test(m) ? `\\b${esc}\\b` : esc;
}

// 반환: 경고 메시지 배열(없으면 []).
export function objectStorageFindings(specText, markers) {
  if (!markers || !markers.length) return [];
  const scan = beforeAuditTrail(specText);
  const matched = markers.some((m) => new RegExp(markerPattern(m), "i").test(scan));
  if (!matched) return [];
  const section = sectionBody(specText, "Object Storage Decision");
  if (section === null) {
    return ["오브젝트 스토리지(S3 등) 마커 매치 — '## Object Storage Decision' 섹션 없음(버킷 선택·이전 기준 기록 필요, SPEC-016)"];
  }
  const missing = REQUIRED_LABELS.filter((lbl) => !new RegExp(escapeRegExp(lbl), "i").test(section));
  if (missing.length) {
    return [`Object Storage Decision 섹션에 필수 라벨 없음: ${missing.join(", ")} (버킷 선택·이전 기준, SPEC-016)`];
  }
  return [];
}
