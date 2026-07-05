#!/usr/bin/env node
// ─── Spec 완전성 게이트 (advisory) ───────────────────────────
// FR이 있는 spec은 측정 가능한 성공 기준(SC)과 인수조건(GWT)도 갖춰야 한다.
// ⚠ SC "충족"(런타임 지표)은 빌드 게이트가 못 잡는다 — "존재"만 점검(과장 금지).
//   충족 검증은 런타임/관측, 측정가능성은 Spec Kit `/checklist`이 담당.
// dedup·cohesion의 형제(같은 spec-quality 계층). FR 없는 spec(순수 인프라 등)은 면제.
//
// 신호(advisory, --strict로 강제):
//   · FR>0 인데 SC 0개 → warn
//   · FR>0 인데 인수조건(Given/Acceptance/수용기준) 없음 → warn
//   · 수명주기(SPEC-008, 전 spec 대상): Status 헤더 없음/enum 밖 값 → warn ·
//     Reviewed 이상인데 Review Log·Dedup-Review 기록 없음 → warn
// Usage: node scripts/check-spec-completeness.mjs [--strict]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { STATUS_ENUM, parseStatus, isReviewedPlus, hasReviewLogEntry, hasDedupReview } from "./lifecycle-lib.mjs";
import { changeLogRationaleFindings } from "./derivation-lib.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");

function specFiles() {
  let names;
  try { names = readdirSync(SPEC_DIR); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`);
    process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => join(SPEC_DIR, n));
}
const countIds = (re, t) => { const s = new Set(); for (const m of t.matchAll(re)) s.add(m[0]); return s.size; };

const files = specFiles();
const findings = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];
  // 수명주기(SPEC-008) — FR 유무와 무관하게 전 spec 대상. Status 없는 레거시는 warn(점진 도입).
  const status = parseStatus(text);
  if (status === null)
    findings.push({ specId, miss: `Status 헤더(수명주기 상태) 없음 — ${STATUS_ENUM.join("|")} 중 선언` });
  else if (!STATUS_ENUM.includes(status))
    findings.push({ specId, miss: `미정의 Status "${status}" — ${STATUS_ENUM.join("|")} 외 값 금지` });
  else if (isReviewedPlus(status)) {
    if (!hasReviewLogEntry(text))
      findings.push({ specId, miss: `Status ${status}인데 Review Log 기록(일시·수행자·판정) 없음 — Reviewed 전이는 /analyze·/checklist 결과 기록 필수` });
    if (!hasDedupReview(text, cfg.__specIdRe))
      findings.push({ specId, miss: `Status ${status}인데 Dedup-Review 기록(검토한 이웃 스펙 ID+판정 또는 "이웃 없음") 없음` });
  }
  // 선제 캡처(SPEC-009) — 실기록 Change Log 행의 근거 칸은 빈 값 불가(변경 의도는 저술 시점에만 남는다).
  for (const d of changeLogRationaleFindings(text))
    findings.push({ specId, miss: `Change Log ${d} 행의 근거 칸이 빈 값 — 변경 의도는 저술 시점에만 캡처 가능(선제 캡처)` });
  if (countIds(cfg.__frTokenRe, text) === 0) continue;     // FR 없는 spec은 면제 — 문법은 requirementIdPrefixes에서 파생(서픽스 FR도 FR)
  if (countIds(/\bSC-\d{3}\b/g, text) === 0)
    findings.push({ specId, miss: "SC(측정형 성공 기준) 없음" });
  if (!(/\b(Given|Acceptance)\b/i.test(text) || /수용\s*기준/.test(text)))
    findings.push({ specId, miss: "인수조건(Given-When-Then) 없음" });
}

console.log(`Spec 완전성 게이트: spec ${files.length}개 검사 (FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록, Change Log 실기록 행은 근거 필요).`);
if (findings.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} 완전성 미흡 ${findings.length}건:`);
  for (const f of findings) console.log(`  ${tag} ${f.specId}: ${f.miss}`);
  if (STRICT) { console.error(`\n✗ --strict: FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록, Change Log 실기록 행은 근거 필요.`); process.exit(1); }
  process.exit(0);
}
console.log(`✓ 완전성 구비 — SC·인수조건·수명주기·근거 기록 모두 충족.`);
