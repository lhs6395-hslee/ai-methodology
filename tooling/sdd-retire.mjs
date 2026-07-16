#!/usr/bin/env node
// ─── SPEC-018: 명세 폐기 커맨드 ──────────────────────────────────
// 필요 없어진 SPEC/FR을 지우고 참조(@covers·smoke 매니페스트·번호 gap)를 재sync한다.
// dry-run 기본(계획 보고), --write 적용(all-or-nothing). 테스트 코드는 안 건드리고 dangling만 보고.
// Usage: node scripts/sdd-retire.mjs <SPEC-ID | SPEC-ID/FR-NNN> [--write]
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, isTestFile } from "./sdd-config.mjs";
import { parseTarget, planRetirement, removeFrFromSpecText, pruneManifest, inboundReferences } from "./retire-lib.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { parseRelationEntry } from "./relation-lib.mjs";
import { sectionBlock } from "./lifecycle-lib.mjs";

const cfg = loadConfig();
const WRITE = process.argv.includes("--write");
const target = process.argv.find((a) => /^[A-Z]+-\d{3}(\/FR-\d{3}[a-z]?)?$/.test(a));
if (!target) { console.error("usage: sdd-retire <SPEC-ID | SPEC-ID/FR-NNN> [--write]"); process.exit(2); }

const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const SCAN = cfg.scanDirs.map((d) => resolveFromRoot(cfg, d));
const IGNORE = new Set(cfg.ignoreDirs);

// 1. 스펙 코퍼스 — frsBySpec(정의만)·specText·경로
const frsBySpec = new Map(), specText = new Map(), specPath = new Map();
for (const f of readdirSync(SPEC_DIR)) {
  if (!f.endsWith(".md")) continue;
  const id = f.match(cfg.__specIdRe)?.[0]; if (!id) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const frs = new Set(); for (const m of text.matchAll(cfg.__frDeclRe)) frs.add(m[1]);
  frsBySpec.set(id, frs); specText.set(id, text); specPath.set(id, join(SPEC_DIR, f));
}
// 2. @covers 인덱스
const coversIndex = [];
const walk = (dir) => { let e; try { e = readdirSync(dir); } catch { return; }
  for (const n of e) { const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) { if (!IGNORE.has(n)) walk(p); }
    else if (isTestFile(n, cfg)) { const t = readFileSync(p, "utf8");
      for (const m of t.matchAll(cfg.__coversRe)) coversIndex.push({ file: p.replace(cfg.__root + "/", ""), spec: m[1], fr: m[2] }); } } };
SCAN.forEach(walk);
// 3. 매니페스트
const manRel = cfg.smokeManifest ? String(cfg.smokeManifest) : null;
let manifest = {}; const manPath = manRel ? resolveFromRoot(cfg, manRel) : null;
if (manPath) { try { manifest = JSON.parse(readFileSync(manPath, "utf8")); } catch { manifest = {}; } }
const manifestKeys = Object.keys(manifest);
const deferredKeys = manifestKeys.filter((k) => manifest[k]?.method === "deferred");

// 3b. inbound 참조(FR-008): 타 스펙의 구조화 관계(Dependencies)·Dedup-Review 언급 — 스펙 전체 폐기 시
// 남으면 관계 실재 hard(SPEC-017)·dangling advisory(SPEC-013)로 삭제 커밋이 막힌다. 계획이 미리 지목.
const t = parseTarget(target);
const CATS = cfg.ownershipCategories;
const ENT_CAT = CATS.find((c) => /entit/i.test(c)) || CATS[0];
const ownedKeys = t && specText.has(t.specId)
  ? new Set(parseSection(specText.get(t.specId), "Ownership", [ENT_CAT])[ENT_CAT] || [])
  : new Set();
const parseDeps = (text) => (parseSection(text, "Dependencies", [ENT_CAT])[ENT_CAT] || []).map(parseRelationEntry);
const inboundRefs = t && !t.frId
  ? inboundReferences(t.specId, ownedKeys, specText, parseDeps, (text) => sectionBlock(text, "Dedup-Review"))
  : [];

// 4. 계획
const plan = planRetirement(target, { frsBySpec, coversIndex, manifestKeys, deferredKeys, inboundRefs });
if (!plan.ok) { console.error(`✗ sdd-retire: ${plan.reason}`); process.exit(1); }

console.log(`폐기 계획 — ${target}  (${WRITE ? "WRITE" : "dry-run"})`);
for (const r of plan.removals) console.log(`  · 제거: ${r.whole ? `${r.specId} (스펙 전체)` : `${r.specId}/${r.frId} (FR 선언)`}`);
if (plan.manifestKeys.length) console.log(`  · smoke 매니페스트 키 제거: ${plan.manifestKeys.join(", ")}`);
if (plan.danglingCovers.length) {
  console.log(`  · dangling @covers(사람이 원자적 삭제 — 자동 안 함):`);
  for (const c of plan.danglingCovers) console.log(`      ${c.file}: @covers ${c.spec}/${c.fr}`);
}
if (plan.numberingGap) console.log(`  · 번호 gap: ${plan.numberingGap} (retiredIds에 등록 시 numbering이 정상 처리 — FR-006)`);
if (plan.inboundRefs.length) {
  console.log(`  · 참조 스펙 갱신 필요(같은 PR — 남으면 관계 실재 hard/SPEC-017·dangling advisory/SPEC-013에 막힘):`);
  for (const r of plan.inboundRefs) {
    console.log(`      ${r.spec} — ${r.kind === "relation" ? `Dependencies 관계 ${r.detail}` : `Dedup-Review에 ${r.detail} 언급("이웃 없음(삭제됨)" 등으로 갱신)`}`);
  }
}

if (!WRITE) { console.log("\ndry-run — 적용하려면 --write. 테스트 삭제는 사람이 원자적 PR로."); process.exit(0); }

// 5. 적용(all-or-nothing) — 매니페스트 prune + FR 라인 제거(또는 스펙 파일 삭제)
if (manPath && plan.manifestKeys.length) writeFileSync(manPath, JSON.stringify(pruneManifest(manifest, plan.manifestKeys), null, 2) + "\n");
for (const r of plan.removals) {
  if (r.whole) { rmSync(specPath.get(r.specId)); console.log(`✓ 삭제: ${specPath.get(r.specId).replace(cfg.__root + "/", "")}`); }
  else { writeFileSync(specPath.get(r.specId), removeFrFromSpecText(specText.get(r.specId), r.frId)); console.log(`✓ FR 제거: ${r.specId}/${r.frId}`); }
}
console.log("✓ 적용 완료. dangling @covers는 위 목록대로 사람이 삭제(원자적 PR).");
