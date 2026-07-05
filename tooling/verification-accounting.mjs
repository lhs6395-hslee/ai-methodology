// tooling/verification-accounting.mjs
// FR 검증 회계(accounting) 순수 코어 — smokeManifest 로드·검증 + FR 분류.
// check-fr-coverage가 소비. 분류: unit(@covers) > smoke(manifest) > deferred > unaccounted.
// 원칙: evidence/reason의 "질"은 기계가 못 본다 — **존재만** 강제(빈 값 = 에러), 질은 리뷰 몫.
// 설계: SPEC-007 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// smokeManifest(JSON 파일) 로드+검증.
//   cfg.smokeManifest 미설정 → { entries: null, errors: [] } (현행 동작).
//   specs = Map(SPEC-ID -> Set(FR-ID)) — dangling 키 검증에 사용.
// 반환 errors: M0(파일/파싱) · M1(키 문법·dangling) · M2(빈 method/evidence/reason).
export function loadManifest(cfg, specs) {
  if (!cfg.smokeManifest) return { entries: null, errors: [] };
  const rel = String(cfg.smokeManifest);
  const path = join(cfg.__root, ...rel.split("/").filter(Boolean));
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch { return { entries: null, errors: [`M0 smokeManifest 파일 없음: ${rel}`] }; }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { entries: null, errors: [`M0 smokeManifest JSON 파싱 실패: ${rel} — ${e.message}`] }; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { entries: null, errors: [`M0 smokeManifest 최상위는 객체여야 함: ${rel}`] };
  }

  const keyRe = new RegExp(`^((?:${cfg.__idAlt})-\\d{3})\\/((?:${cfg.__reqAlt})-\\d{3}[a-z]?)$`);
  const errors = [];
  const entries = new Map(); // "SPEC/FR" -> { method, evidence, reason }
  for (const key of Object.keys(data)) {
    const m = key.match(keyRe);
    if (!m) { errors.push(`M1 manifest 키 형식 위반 "${key}" — "SPEC-NNN/FR-NNN" 형식이어야 함`); continue; }
    const [, spec, fr] = m;
    if (!specs.has(spec) || !specs.get(spec).has(fr)) {
      errors.push(`M1 dangling manifest 키 "${key}" — no such FR`);
      continue;
    }
    const v = data[key];
    const method = v && typeof v === "object" && !Array.isArray(v) ? String(v.method ?? "").trim() : "";
    if (!method) { errors.push(`M2 "${key}": method 없음(빈 값 불가)`); continue; }
    if (method === "deferred") {
      if (!String(v.reason ?? "").trim()) { errors.push(`M2 "${key}": method=deferred는 reason 필수(빈 값 불가)`); continue; }
    } else if (!String(v.evidence ?? "").trim()) {
      errors.push(`M2 "${key}": evidence 필수(빈 값 불가 — 존재만 강제, 질은 리뷰 몫)`);
      continue;
    }
    entries.set(key, { method, evidence: v.evidence, reason: v.reason });
  }
  return { entries, errors };
}

// FR별 분류. entries가 null이면 unit/unaccounted 2분류만(=manifest 미설정에서 requireAccounting).
// 반환: { classes: Map("SPEC/FR" -> class), counts: {unit, smoke, deferred, unaccounted} }
export function classify(specs, covered, entries) {
  const classes = new Map();
  const counts = { unit: 0, smoke: 0, deferred: 0, unaccounted: 0 };
  for (const [spec, frs] of specs) {
    for (const fr of frs) {
      const key = `${spec}/${fr}`;
      let cls = "unaccounted";
      if (covered.has(spec) && covered.get(spec).has(fr)) cls = "unit"; // unit이 manifest보다 우선
      else if (entries && entries.has(key)) cls = entries.get(key).method === "deferred" ? "deferred" : "smoke";
      classes.set(key, cls);
      counts[cls]++;
    }
  }
  return { classes, counts };
}
