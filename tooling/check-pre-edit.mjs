#!/usr/bin/env node
// ─── pre-edit spec-first 경고 (SPEC-003 FR-012 소비, PreToolUse) ───
// spec-first가 commit-msg 훅에만 걸려 **사후 검사**였다: 코드를 다 쓴 뒤에야 순서 위반이 드러난다.
// 실측(소비 프로젝트 gsn-ai-pm): 소유 surface를 편집하는 동안 마찰이 0이라 순서 위반이 자각되지
// 않은 채 커밋 시점까지 진행됐다. 이 스크립트는 **편집 직전** 소유 스펙 미수정을 경고한다.
//   사용: node scripts/check-pre-edit.mjs <편집 대상 경로>
// 비차단(항상 exit 0) — 마찰을 만들되 작업을 막지 않는다. 정책: preEditSpecFirstPolicy off|advisory.
// git 없음·소유 스펙 없음·경로 미소유면 침묵(오탐 금지).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { compileGlob, parseFilesLine } from "./spec-sync-lib.mjs";

const target = process.argv[2];
if (!target) process.exit(0);

let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
if (String(cfg.preEditSpecFirstPolicy ?? "advisory") === "off") process.exit(0);

const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const rel = String(target).replace(/^\.\//, "").replace(new RegExp(`^${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");

// 스펙별 Files glob → 이 경로를 소유한 스펙 찾기.
let names = [];
try { names = readdirSync(SPEC_DIR).sort().filter((n) => /\.md$/.test(n)); } catch { process.exit(0); }
const owners = [];
for (const n of names) {
  let text; try { text = readFileSync(join(SPEC_DIR, n), "utf8"); } catch { continue; }
  const globs = parseFilesLine(text);   // Files 라인 문법은 spec-sync-lib 단일 사이트(SPEC-038 실수확)
  if (!globs.length) continue;
  if (globs.some((g) => { try { return compileGlob(g).test(rel); } catch { return false; } })) {
    owners.push({ specId: (text.match(cfg.__specIdRe) || [n])[0], file: `${cfg.specDir}/${n}` });
  }
}
if (!owners.length) process.exit(0); // 미소유 경로 — 침묵

// 이 브랜치에서 이미 손댄 파일 집합(워킹트리 ∪ staged ∪ base...HEAD).
const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
const BASE = process.env.SDD_DIFF_BASE || cfg.specSyncBase || "origin/main";
const touched = new Set(
  [sh("git diff --name-only"), sh("git diff --cached --name-only"), sh(`git diff --name-only ${BASE}...HEAD`)]
    .join("\n").split("\n").map((s) => s.trim()).filter(Boolean),
);
if (!touched.size) process.exit(0); // git 없음/판정 불가 — 침묵(오탐 금지)

const stale = owners.filter((o) => !touched.has(o.file));
if (!stale.length) process.exit(0); // 소유 스펙이 이미 이 브랜치에서 수정됨 — 정상 순서

console.log(`[SDD spec-first — 편집 전 순서 확인] ${rel}`);
for (const o of stale) console.log(`  ⚠ 소유 스펙 ${o.specId}(${o.file})이 이 브랜치에서 아직 미수정 — 코드보다 명세가 먼저다`);
console.log("  → 먼저 그 스펙의 FR/Edge Cases/Change Log를 갱신하고 편집하라(커밋 시점엔 commit-msg 훅이 hard로 막는다).");
process.exit(0);
