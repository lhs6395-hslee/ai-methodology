// tooling/object-storage-lib.mjs
// 오브젝트 스토리지 프로비저닝 결정 검사 순수 코어 (SPEC-016).
// 스펙 본문이 objectStorageMarkers 중 하나에 (대소문자 무시) 매치하면 `## Object Storage
// Decision` 섹션과 그 안의 Bucket·Consolidation 라벨을 요구한다 — 버킷 선택(신규 전용 vs
// 기존 네임스페이스)과 이전(consolidation) 기준을 설계 단계에 기록하도록. completeness
// advisory(존재만 강제; 4개 세부·질은 템플릿·리뷰 몫). markers=[] 이면 전면 비활성.
// 감지는 결정적 선언 신호가 아니라 마커 휴리스틱이라 severity가 advisory다(리마인더).
// 설계: SPEC-016 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

const REQUIRED_LABELS = ["Bucket", "Consolidation"];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// 반환: 경고 메시지 배열(없으면 []).
export function objectStorageFindings(specText, markers) {
  if (!markers || !markers.length) return [];
  const matched = markers.some((m) => new RegExp(escapeRegExp(m), "i").test(specText));
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
