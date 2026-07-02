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
// Usage: node scripts/check-spec-completeness.mjs [--strict]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

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
  if (countIds(/\bFR-\d{3}[a-z]?\b/g, text) === 0) continue;     // FR 없는 spec은 면제(서픽스 FR도 FR)
  if (countIds(/\bSC-\d{3}\b/g, text) === 0)
    findings.push({ specId, miss: "SC(측정형 성공 기준)" });
  if (!(/\b(Given|Acceptance)\b/i.test(text) || /수용\s*기준/.test(text)))
    findings.push({ specId, miss: "인수조건(Given-When-Then)" });
}

console.log(`Spec 완전성 게이트: spec ${files.length}개 검사 (FR 있는 spec은 SC·인수조건 필요).`);
if (findings.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} 완전성 미흡 ${findings.length}건:`);
  for (const f of findings) console.log(`  ${tag} ${f.specId}: ${f.miss} 없음`);
  if (STRICT) { console.error(`\n✗ --strict: FR 있는 spec은 SC·인수조건 필요.`); process.exit(1); }
  process.exit(0);
}
console.log(`✓ FR 있는 spec 모두 SC·인수조건 구비.`);
