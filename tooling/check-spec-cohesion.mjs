#!/usr/bin/env node
// ─── Spec cohesion 게이트 (under-fragmentation / cramming 차단) ───
// check-ownership(dedup)의 거울상: dedup은 "2 spec이 같은 키"(과편화/중복),
// 이 게이트는 "1 spec이 키/FR 과다"(under-fragmentation = 한 spec에 여러 기능
// 욱여넣기)를 잡는다. 한 spec = 한 응집 capability 묶음(STRUCTURE.md).
//
// 신호(advisory, --strict로 강제):
//   · 카테고리별 소유 키 수 > maxKeysPerCategoryPerSpec (기본 4)
//   · FR 수 > maxFRsPerSpec (기본 8)
// 둘 다 sdd.config.json에서 조정. Ownership 없는 spec은 키 신호 건너뜀(FR만).
// 키 종류는 ownershipCategories를 그대로 따른다(비-웹 카테고리도 동일 적용).
//
// Usage: node scripts/check-spec-cohesion.mjs [--strict]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");
const CATEGORIES = cfg.ownershipCategories;
const MAX_KEYS = cfg.maxKeysPerCategoryPerSpec;
const MAX_FRS = cfg.maxFRsPerSpec;
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function specFiles() {
  let names;
  try { names = readdirSync(SPEC_DIR); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`);
    process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => join(SPEC_DIR, n));
}

// `## Ownership` 섹션 → 카테고리별 키 목록 (check-ownership.mjs와 동일 파서).
function parseOwnership(text) {
  const start = text.search(/^##\s+Ownership/m);
  if (start === -1) return null;
  const after = text.slice(start);
  const body = after.slice(after.indexOf("\n") + 1);
  const nextSec = body.search(/^##\s/m);
  const block = nextSec === -1 ? body : body.slice(0, nextSec);
  const out = {};
  for (const cat of CATEGORIES) {
    const line = block.match(new RegExp(`-\\s*\\*\\*${cat}\\*\\*\\s*:\\s*([^\\n]+)`, "i"));
    out[cat] = line
      ? line[1].split(",").map(norm).filter((k) => k && k !== "—" && k !== "[…]" && !k.startsWith("["))
      : [];
  }
  return out;
}

// 고유 FR-ID 수.
function countFRs(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bFR-\d{3}\b/g)) ids.add(m[0]);
  return ids.size;
}

const files = specFiles();
const violations = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];
  const frs = countFRs(text);
  if (frs > MAX_FRS) violations.push({ specId, kind: "FR", n: frs, max: MAX_FRS });
  const own = parseOwnership(text);
  if (own) {
    for (const cat of CATEGORIES) {
      if (own[cat].length > MAX_KEYS)
        violations.push({ specId, kind: cat, n: own[cat].length, max: MAX_KEYS });
    }
  }
}

console.log(`Spec 입도(cohesion) 게이트: spec ${files.length}개 검사 (키>${MAX_KEYS}/카테고리, FR>${MAX_FRS}).`);

if (violations.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} 과대 spec(분할 권고) ${violations.length}건:`);
  for (const v of violations) {
    console.log(`  ${tag} ${v.specId}: ${v.kind} ${v.n}개 > ${v.max} → capability별 분할 검토`);
  }
  if (STRICT) {
    console.error(`\n✗ --strict: 과대 spec은 분할 필요.`);
    process.exit(1);
  }
  process.exit(0);
}

console.log(`✓ 모든 spec이 입도 기준 내 — 분할 권고 없음.`);
