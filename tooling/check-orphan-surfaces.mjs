#!/usr/bin/env node
// ─── Orphan-surface gate (reverse coverage) ───────────────
// surfaceGlobs로 지정한 "표면 파일"이 어떤 스펙의 ## Ownership Surfaces에
// 선언돼 있는지 확인. 없으면 스펙 없는 코드(고아) 경고 — "spec=SSOT"의 역방향.
// surfaceGlobs 비면 no-op. 기본 advisory(exit 0), --strict에서 exit 1.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const ROOT = cfg.__root;
const STRICT = process.argv.includes("--strict");
const globs = (cfg.surfaceGlobs ?? []).map((s) => new RegExp(s));

if (!globs.length) {
  verdict(VERDICT_KINDS.INERT, "surfaceGlobs 미설정 — 표면으로 볼 파일 집합이 없다");
  console.log("Orphan-surface gate: surfaceGlobs 미설정 — no-op"); process.exit(0);
}

// 1. 모든 스펙의 표면 키 수집(소문자 정규화).
// ⚠ 카테고리 **이름**이 아니라 **역할**로 찾는다(SPEC-001 FR-010). 이전 판은 `**Surfaces**:`를
// 하드코딩했고, 그래서 카테고리를 `Symbols`로 부르는 저장소에서는 선언 집합이 **항상 비어**
// 모든 표면이 고아로 뜨거나(오탐) 판정이 무의미했다 — 킷 자신이 그 상태였다(surfaceGlobs를
// 켜지 않아 inert로 가려져 있었을 뿐이다). 역할 해석은 `ownershipCategoryRoles`가 정본이고
// 미선언 시 이름 정규식 폴백(entit/surface/capabilit)이 적용된다.
const SURFACE_CAT = (cfg.__roles && cfg.__roles.surface) || "Surfaces";
const norm = (s) => s.trim().toLowerCase();
const declared = new Set();
const specDir = resolveFromRoot(cfg, cfg.specDir);
for (const f of (() => { try { return readdirSync(specDir); } catch { return []; } })()) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(join(specDir, f), "utf8");
  const re = new RegExp(`-\\s*\\*\\*${SURFACE_CAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*\\s*:\\s*([^\\n]+)`, "i");
  const m = text.match(re);
  if (m) for (const k of m[1].split(",")) { const v = norm(k); if (v && !v.startsWith("[") && v !== "—") declared.add(v); }
}

// 2. 표면 파일 수집(ROOT 상대경로, surfaceGlobs 매칭).
const IGNORE = new Set(cfg.ignoreDirs);
function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}
// 소유 스펙을 갖지 않기로 **선언된** 파일은 고아가 아니다 — 선언된 예외다.
// ⚠ 이 목록을 새로 만들지 않고 `specSyncExemptGlobs`를 재사용한다: 같은 사실("이 파일엔 소유
// 스펙이 없다")에 선언 자리가 둘이면 한쪽만 갱신돼 두 게이트가 다른 답을 낸다(R13이 잡는 중복의
// config 판). 그리고 예외는 조용히 사라지지 않는다 — 아래에서 건수를 세어 매 실행 표면화한다.
const EXEMPT = (cfg.specSyncExemptGlobs || []).map((g) => compileGlob(g));
const orphans = [];
let surfaces = 0;
let exempted = 0;
for (const p of walk(ROOT)) {
  const rel = p.replace(ROOT + "/", "");
  if (!globs.some((re) => re.test(rel))) continue;
  surfaces++;
  // 표면이 선언 집합 중 하나와 일치(부분 일치 허용 — 선언은 경로로 표기)
  const claimed = [...declared].some((d) => d === norm(rel) || norm(rel).includes(d) || d.includes(norm(rel)));
  if (claimed) continue;
  if (EXEMPT.some((re) => re.test(rel))) { exempted++; continue; }
  orphans.push(rel);
}

judged(orphans.length);
console.log(`Orphan-surface gate — 역할:${SURFACE_CAT} surfaces:${surfaces} declared:${declared.size} orphans:${orphans.length}${exempted ? ` · 선언된 예외 ${exempted}건(specSyncExemptGlobs — 부채로 표면화)` : ""} mode:${STRICT ? "strict" : "advisory"}`);
for (const o of orphans) console.log(`  · ${o}: 어떤 스펙 Ownership(Surfaces)에도 없음 → 스펙 누락 의심`);
if (orphans.length && STRICT) { console.error("\n✗ orphan-surface(strict): 표면을 소유하는 스펙 작성 또는 Ownership 등록"); process.exit(1); }
console.log("Orphan-surface gate: OK");
