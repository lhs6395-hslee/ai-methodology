// tooling/sc-coverage-lib.mjs
// SC·NFR 검증 회계 판정 순수 코어 (SPEC-034) — 비기능 검증의 1급 회계.
//
// 문제: `check-fr-coverage`는 **FR만** 회계한다(unit ∨ e2e ∨ smoke ∨ deferred, requireAccounting).
// Success Criteria·NFR은 산문으로만 존재하고 "이 목표엔 실행 가능한 검증이 있어야 한다"를 강제하는
// 게이트가 없다 — 성능·보안 목표가 검증 바인딩 없이 방치돼도 green이다(실측 제보: 부하·침투 테스트
// 산출물이 스펙에 귀속되지 못하고 scratchpad에 남았다).
//
// 설계 — **새 문법을 만들지 않는다.** 바인딩은 SPEC-031이 이미 강제하는 `[검증: <경로>]` 태그를
// 그대로 쓰고, **검증 종류(kind)는 그 경로가 어디 있는지로 결정적으로 유도**한다(`verificationKinds`
// 글롭). 그래서 저자는 태그 하나만 달면 되고, load·pentest 같은 분류는 기계가 붙인다 — 사람이
// 종류를 손으로 적으면 그 자체가 또 하나의 자기신고가 된다.
//
// 실행 불가한 검증(라이브 클러스터·WAF·관리형 DB 필요)은 `evidenceManifest`에 **증거 포인터와
// 사유**로 회계한다(smokeManifest 동형) → `deferred-with-evidence`. 둘 다 없으면 `unaccounted`.
// 순수 함수(IO 없음) — 파일 읽기는 소비 게이트. Python 미러(SPEC-006).

// SC/NFR 선언 라인: `- **SC-001**: …` / `- **NFR-002**: …` (템플릿 형식)
export const SC_DECL_RE = /^\s*[-*]\s+\*\*(SC|NFR)-(\d+)\*\*\s*:/;

// 태그: `[검증: 경로]` / `[검증:경로]` — 코드 스팬은 인용문이므로 판정 대상이 아니다(SPEC-031 동형).
const TAG_RE = /\[검증\s*[:：]\s*([^\]]+)\]/;
const UNKNOWN_RE = /\[미확인\]/;

export function parseScLine(line) {
  const raw = String(line || "");
  const m = raw.match(SC_DECL_RE);
  if (!m) return null;
  const stripped = raw.replace(/`[^`]*`/g, " "); // 코드 스팬 인용 — 산문이 태그를 흉내내지 못하게
  const tag = stripped.match(TAG_RE);
  return {
    id: `${m[1]}-${m[2]}`,
    kindOfId: m[1],                                  // SC | NFR
    pointer: tag ? tag[1].trim() : "",
    unknown: UNKNOWN_RE.test(stripped),
  };
}

// 경로 → 검증 종류. verificationKinds = { load: ["tests/load/**"], pentest: [...], ... }
// 첫 매치가 이긴다(선언 순서가 우선순위). 어디에도 안 걸리면 "other" — 회계는 되지만 분류 불명.
export function kindOfPointer(pointer, kinds, matcher) {
  const p = String(pointer || "").trim();
  if (!p) return "";
  for (const [kind, globs] of Object.entries(kinds || {})) {
    for (const g of globs || []) if (matcher(g, p)) return kind;
  }
  return "other";
}

// 매니페스트 무결성 — smokeManifest 동형: evidence 또는 reason이 **반드시** 있어야 한다.
// 사유 없는 deferred는 "조용한 미검증"을 문서 형태로 세탁하는 것이라 즉시 에러.
export function validateEvidenceManifest(manifest) {
  const entries = new Map();
  const errors = [];
  for (const [key, v] of Object.entries(manifest || {})) {
    if (!/^[A-Za-z]+-\d+[A-Za-z]?\/(SC|NFR)-\d+$/.test(key)) {
      errors.push(`evidenceManifest "${key}" — 키 형식은 "<SPEC-ID>/<SC-NNN|NFR-NNN>"`);
      continue;
    }
    const o = v && typeof v === "object" && !Array.isArray(v) ? v : null;
    if (!o) { errors.push(`evidenceManifest "${key}" — 객체여야 한다({kind, evidence, reason})`); continue; }
    const kind = String(o.kind ?? "").trim();
    if (!kind) { errors.push(`evidenceManifest "${key}" — kind 없음(빈 값 불가)`); continue; }
    const evidence = String(o.evidence ?? "").trim();
    const reason = String(o.reason ?? "").trim();
    if (kind === "deferred") {
      if (!reason) { errors.push(`evidenceManifest "${key}" — kind=deferred는 reason 필수(왜 아직 검증하지 않나)`); continue; }
    } else if (!evidence) {
      errors.push(`evidenceManifest "${key}" — evidence 필수(실행 로그·대시보드 스냅샷 등 근거 경로; 존재만 강제, 질은 리뷰 몫)`);
      continue;
    }
    entries.set(key, { kind, evidence, reason });
  }
  return { entries, errors };
}

// 회계 분류. items: [{specId, id, pointer, unknown}] / manifest: validateEvidenceManifest의 entries
// 반환 {classes: Map("SPEC/SC" -> {cls, kind}), counts}
export function classifyScCoverage(items, manifest, kinds, matcher) {
  const classes = new Map();
  const counts = { verified: 0, evidence: 0, deferred: 0, unaccounted: 0 };
  for (const it of items || []) {
    const key = `${it.specId}/${it.id}`;
    let cls = "unaccounted";
    let kind = "";
    if (it.pointer) {
      cls = "verified";
      kind = kindOfPointer(it.pointer, kinds, matcher);
    } else if (manifest && manifest.has(key)) {
      const e = manifest.get(key);
      kind = e.kind;
      cls = e.kind === "deferred" ? "deferred" : "evidence";
    } else if (it.unknown) {
      // `[미확인]`은 정직한 자기신고지만 회계가 아니다 — 매니페스트에 사유와 함께 착지해야 한다.
      cls = "unaccounted";
      kind = "미확인";
    }
    classes.set(key, { cls, kind });
    counts[cls]++;
  }
  return { classes, counts };
}
