#!/usr/bin/env node
// ─── Cross-spec ownership uniqueness gate ─────────────────
// 방법론 최대 빈칸을 기계로 메운다: "spec 간 중복인가?"를 사람 판단이 아니라
// **소유권 키 유일성**으로 결정·강제한다. (DEDUP.md, STRUCTURE.md 중복 규칙)
//
// 각 spec은 `## Ownership` 블록에 자신이 **소유하는 키**를 선언한다:
//   ## Ownership
//   - **Entities**: pjt_projects, pjt_project_staff
//   - **Surfaces**: POST /api/pjt/recommend, /tools/pjt-management/new
//   - **Capabilities**: project.create, staff.assign
//
// 규칙(같은 카테고리 내에서 위반 시 exit 1):
//   하나의 Entity / Surface / Capability 키는 **정확히 한 spec**만 소유한다.
//   2개 이상 spec이 같은 키를 선언하면 = 구조적 중복 → 실패.
//
// Ownership 블록이 없는 spec은 **warn**(점진 도입 — spec마다 채워가며 켠다).
// 의미적 중복(키는 다른데 의도 같음)은 이 게이트가 못 잡는다 → 같은 Entity
// 이웃 spec과 좁힌 리뷰로 보완(SPEC_REVIEW.md). 이 게이트는 구조적 중복 전담.
//
// 키 종류(CATEGORIES)·spec 위치는 sdd.config.json에서 온다 — 웹/CRUD가 아닌
// 프로젝트는 ownershipCategories를 바꿔 쓴다(예: Modules/Symbols/Artifacts).
// config 없으면 기존 Entities/Surfaces/Capabilities 기본값(하위호환).
//
// Usage: node scripts/check-ownership.mjs [--strict]
//   --strict : Ownership 블록 없는 spec도 실패(완전 강제)

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");

const CATEGORIES = cfg.ownershipCategories;
// 키 정규화: 앞뒤 공백 제거 + 소문자 + 내부 공백 1칸(Surface의 "POST  /x" 등 흡수).
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function specFiles() {
  let names;
  try { names = readdirSync(SPEC_DIR); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`);
    process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => join(SPEC_DIR, n));
}

// `## Ownership` 섹션을 잘라내 카테고리별 키 목록을 파싱.
function parseOwnership(text) {
  const start = text.search(/^##\s+Ownership/m);
  if (start === -1) return null; // 블록 없음
  const after = text.slice(start);
  const body = after.slice(after.indexOf("\n") + 1); // 헤더 줄 다음부터
  const nextSec = body.search(/^##\s/m);             // 다음 ## 섹션 전까지
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

const files = specFiles();
const owners = Object.fromEntries(CATEGORIES.map((c) => [c, new Map()]));
const missing = [];
let declaredCount = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];
  const own = parseOwnership(text);
  if (!own) { missing.push(specId); continue; }
  declaredCount++;
  for (const cat of CATEGORIES) {
    for (const key of own[cat]) {
      if (!owners[cat].has(key)) owners[cat].set(key, []);
      owners[cat].get(key).push(specId);
    }
  }
}

// 충돌(같은 키를 2+ spec이 소유) 수집
const conflicts = [];
for (const cat of CATEGORIES) {
  for (const [key, specs] of owners[cat]) {
    if (specs.length > 1) conflicts.push({ cat, key, specs: [...new Set(specs)] });
  }
}

console.log(`Ownership 게이트: spec ${files.length}개 중 ${declaredCount}개가 Ownership 선언.`);
if (missing.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} Ownership 블록 없음(${missing.length}): ${missing.join(", ")}`);
}

if (conflicts.length) {
  console.error(`\n✗ 중복 소유(구조적 중복) ${conflicts.length}건:`);
  for (const c of conflicts) {
    console.error(`  [${c.cat}] "${c.key}" ← ${c.specs.join(" + ")}  → 한 spec으로 통합/개정 필요`);
  }
  process.exit(1);
}

if (STRICT && missing.length) {
  console.error(`\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.`);
  process.exit(1);
}

console.log(`✓ 구조적 중복 없음 — 모든 ${CATEGORIES.join("/")} 키가 유일.`);
