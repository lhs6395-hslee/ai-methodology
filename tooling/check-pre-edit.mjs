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

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict({ quietWhenSilent: true });  // 훅 편의 계층 — 발동 조건이 아니면 침묵이 계약이다(SPEC-040)

const ARGS = process.argv.slice(2);
const IS_CODE_PATH = ARGS.includes("--is-code-path");   // 배선 질의 모드(아래) — 판정이 아니다
const target = ARGS.find((a) => !a.startsWith("--"));
if (!target) process.exit(0);

let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
if (String(cfg.preEditSpecFirstPolicy ?? "advisory") === "off") process.exit(0);

const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);

// ── 코드 경로 질의(`--is-code-path <경로>`) — exit 0이면 코드, 1이면 아니다.
// 편집 가드 쉘(`sdd-edit-check.sh`)이 체크리스트를 보일지 결정하는 데 쓴다. **왜 여기냐**:
// 이전 판은 쉘이 `case src/|lib/|app/`으로 경로를 **하드코딩**했고, 주석은 "sdd-init가 조정한다"고
// 적혀 있었지만 설치기는 그 파일을 그대로 복사만 했다. 실측: 킷의 `scanDirs`는 `tooling`이라
// 체크리스트가 **한 번도 발화할 수 없었다** — 하드코딩된 어휘 밖의 프로젝트에서 판정이 통째로
// 사라지고 그 0건이 진짜 0건과 구분되지 않는다(SPEC-051). config가 정본이다.
if (IS_CODE_PATH) {
  const relq = String(target).replace(/^\.\//, "");
  const dirs = (cfg.scanDirs || []).map((d) => String(d).replace(/^\.\//, "").replace(/\/+$/, ""));
  const hit = dirs.some((d) => d && (relq === d || relq.startsWith(`${d}/`) || relq.includes(`/${d}/`)));
  verdict(VERDICT_KINDS.SKIPPED, "경로 질의 모드(판정 아님) — 코드 경로 여부만 답한다");
  process.exit(hit ? 0 : 1);
}
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

judged(stale.length);
console.log(`[SDD spec-first — 편집 전 순서 확인] ${rel}`);
for (const o of stale) console.log(`  ⚠ 소유 스펙 ${o.specId}(${o.file})이 이 브랜치에서 아직 미수정 — 코드보다 명세가 먼저다`);
console.log("  → 먼저 그 스펙의 FR/Edge Cases/Change Log를 갱신하고 편집하라(커밋 시점엔 commit-msg 훅이 hard로 막는다).");
process.exit(0);
