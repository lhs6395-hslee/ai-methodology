#!/usr/bin/env node
// ─── 실행 증거 게이트 (SPEC-031) ────────────────────────────
// "선언이 실제로 동작하는가" 축의 저술 경계 절반: `[검증]` 태그를 **실행 가능한 증거 경로**로 강제.
// 판정 범위는 FR 선언 라인·SC 라인뿐(Change Log 산문의 이력 언급은 주장이 아니라 제외).
//   [검증: path] → 자산 실재해야 함 / [검증] → 경로 없는 빈 주장 / SC 실행동사 → 실행 등급 요구
// off|advisory(경고 exit 0)|hard(exit 1). Python판 sdd_gates.py 미러(SPEC-006).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { evidenceFindings, DEFAULT_BROWSER_MARKERS } from "./evidence-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

import { parseSection } from "./ownership-keys.mjs";
import { isDeployArtifact } from "./live-reality-lib.mjs";

const cfg = loadConfig();
// 배포 산출물 마커 — SPEC-032의 등록 축과 **같은 선언**을 쓴다(같은 사실에 목록이 둘이면 갈라진다).
// 미선언이면 이 축은 발화하지 않는다(조용한 기본값 금지 — SPEC-040 ②).
const DEPLOY_MARKERS = Array.isArray(cfg.deployArtifactMarkers) && cfg.deployArtifactMarkers.length
  ? cfg.deployArtifactMarkers : null;
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const POLICY = String(cfg.executionEvidencePolicy ?? "off");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ executionEvidencePolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "executionEvidencePolicy");
  console.log("실행 증거 게이트 — executionEvidencePolicy:off (판정 안 함)");
  process.exit(0);
}
const HARD = POLICY === "hard";
const VERBS = cfg.executionVerbs || [];
const BROWSER_MARKERS = cfg.browserMarkers && cfg.browserMarkers.length ? cfg.browserMarkers : DEFAULT_BROWSER_MARKERS;
const BROWSER_PATTERNS = cfg.browserEvidencePatterns || [];

// 레포 파일 집합(증거 자산 실재 판정용) — ignoreDirs 제외 1회 순회. 디렉토리도 자산으로 인정.
const IGNORE = new Set(cfg.ignoreDirs);
const FILES = new Set(), DIRS = new Set();
(function walk(dir, rel = "") {
  let entries; try { entries = readdirSync(dir).sort(); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name), r = rel ? `${rel}/${name}` : name;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!IGNORE.has(name)) { DIRS.add(r); walk(p, r); } }
    else FILES.add(r);
  }
})(ROOT);
function assetExists(path) {
  const p = String(path).replace(/^\.\//, "").replace(/\/$/, "");
  if (FILES.has(p) || DIRS.has(p)) return true;
  if (/[*?]/.test(p)) { const rx = compileGlob(p); return [...FILES].some((f) => rx.test(f)); }
  return false;
}

// 스펙별 주장(FR 선언·SC) 수집. 표 행(Change Log 등)은 제외 — 이력 서술이지 주장이 아니다.
function specUnits() {
  let names;
  try { names = readdirSync(SPEC_DIR).sort(); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`); process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => {
    const text = readFileSync(join(SPEC_DIR, n), "utf8");
    const specId = (text.match(cfg.__specIdRe) || [n])[0];
    const claims = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("|")) continue;               // 표 행(Change Log·Review Log) 제외
      // __frDeclRe는 global 플래그라 String.match가 캡처그룹을 주지 않는다 — exec로 그룹을 얻고
      // lastIndex를 초기화한다(공유 정규식의 상태 이월로 다음 라인이 조용히 미스매치되는 함정).
      cfg.__frDeclRe.lastIndex = 0;
      const fr = cfg.__frDeclRe.exec(t);
      cfg.__frDeclRe.lastIndex = 0;
      if (fr) { claims.push({ id: fr[1], kind: "FR", text: t }); continue; }
      // SC와 NFR을 한 정규식으로 — NFR은 실행 동사 규칙 대상이 아니고(SC 전용) 매니페스트
      // 대조만을 위해 수집한다. kind는 접두어에서 나온다.
      const sc = t.match(/\*\*((?:SC|NFR)-\d{3}[a-z]?)\*\*/);
      if (sc) claims.push({ id: sc[1], kind: sc[1].startsWith("N") ? "NFR" : "SC", text: t });
    }
    // 이 스펙이 **배포 산출물을 소유**하는가 — 증거 등급 분리의 트리거 절반(SPEC-031 FR 확장).
    // 마커만으로 걸면 배포를 *다루는* 스펙(가드 로직 등)까지 잡힌다. 소유가 대상성을 가른다.
    const artiCat = (cfg.__roles && cfg.__roles.artifact) || "Artifacts";
    const ownsDeployArtifact = DEPLOY_MARKERS
      ? (parseSection(text, "Ownership", [artiCat])[artiCat] || []).some((k) => isDeployArtifact(k, DEPLOY_MARKERS))
      : false;
    return { specId, claims, ownsDeployArtifact };
  });
}

// 회계 매니페스트 조회 — 본문과 매니페스트는 같은 주장에 대한 두 개의 선언이라 모순할 수 있는데
// 그동안 아무도 둘을 대조하지 않았다(실측 제보: `[미확인]` FR이 매니페스트엔 실측을 갖고 있었다).
// 여기서는 **키와 method만** 본다 — 무결성 검증은 각자의 소유 게이트(fr-coverage·sc-coverage)가 한다.
function loadRawManifest(value, label) {
  let raw = value;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(readFileSync(resolveFromRoot(cfg, raw), "utf8")); }
    catch { return new Map(); } // 읽기·파싱 실패는 소유 게이트의 판정 대상이다(여기서 중복 차단하지 않는다)
  }
  const out = new Map();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const method = v && typeof v === "object" ? String(v.method ?? v.kind ?? "").trim() : "";
      out.set(k, { source: label, method });
    }
  }
  return out;
}
const SMOKE = loadRawManifest(cfg.smokeManifest, "smokeManifest");
const EVID = loadRawManifest(cfg.evidenceManifest, "evidenceManifest");
const manifestOf = (specId, claimId) =>
  (/^(SC|NFR)-/.test(claimId) ? EVID : SMOKE).get(`${specId}/${claimId}`) || null;

const units = specUnits();
const findings = evidenceFindings(units, assetExists, { verbs: VERBS, browserMarkers: BROWSER_MARKERS, browserPatterns: BROWSER_PATTERNS,
  deployMarkers: cfg.deployMarkers, deployPatterns: cfg.deployEvidencePatterns, manifestOf,
  browserGradeMethods: cfg.browserGradeMethods, deployGradeMethods: cfg.deployGradeMethods });
const claimCount = units.reduce((n, u) => n + u.claims.length, 0);

judged(findings.length);
console.log(`실행 증거 게이트(executionEvidencePolicy=${POLICY}): spec ${units.length}개·주장 ${claimCount}건 검사 — 위반 ${findings.length}건`);
const tag = HARD ? "✗" : "⚠";
for (const f of findings) {
  console.log(`  ${tag} [${f.specId}] ${f.claimId} (${f.finding}) — ${f.detail}`);
}
if (findings.length && HARD) {
  console.error(`\n✗ executionEvidencePolicy=hard: \`[검증]\`은 실행 가능한 증거 경로를 지목해야 한다 — 산문 자기신고로 충족되지 않는다(실측: 게이트 전종 green인데 대시보드 패널 30여 개 사망).`);
  process.exit(1);
}
if (!findings.length) console.log("실행 증거 게이트: OK — 모든 주장이 실행 증거를 지목하거나 자기신고로 명시됨.");
