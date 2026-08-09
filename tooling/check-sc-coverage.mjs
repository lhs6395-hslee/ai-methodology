#!/usr/bin/env node
// ─── SC·NFR 검증 회계 게이트 (SPEC-034) ─────────────────────
// check-fr-coverage가 FR만 회계하는 사각을 닫는다 — 성능·보안·가용성 목표는 SC/NFR에 산문으로
// 적히고 "이 목표를 무엇이 검증하나"를 강제하는 게이트가 없었다(실측 제보: 부하·침투 테스트
// 산출물이 어느 스펙에도 귀속되지 못하고 scratchpad에 남았다).
//
// 계약: 각 SC·NFR은 셋 중 하나여야 한다.
//   ① `[검증: <경로>]`  — 실행 가능한 검증을 지목(종류는 verificationKinds 글롭으로 유도)
//   ② evidenceManifest에 {kind, evidence} — CI에서 못 도는 검증(라이브 클러스터·WAF)의 증거 회계
//   ③ evidenceManifest에 {kind:"deferred", reason} — 아직 안 함을 **사유와 함께** 선언
// 셋 다 아니면 unaccounted. `[미확인]`만 적은 것도 unaccounted다 — 정직하지만 회계는 아니다.
//
// scCoveragePolicy: off(기본) | advisory | hard. 매니페스트 무결성 위반은 판정 전 exit 1.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { parseScLine, validateEvidenceManifest, classifyScCoverage } from "./sc-coverage-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = String(cfg.scCoveragePolicy ?? "off");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ scCoveragePolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "scCoveragePolicy");
  console.log("SC·NFR 회계 게이트 — scCoveragePolicy:off (판정 안 함)");
  process.exit(0);
}
const HARD = POLICY === "hard";

// 매니페스트 — 경로 문자열이면 파일에서, 객체면 그대로.
let manifestRaw = cfg.evidenceManifest;
if (typeof manifestRaw === "string" && manifestRaw.trim()) {
  try { manifestRaw = JSON.parse(readFileSync(resolveFromRoot(cfg, manifestRaw), "utf8")); }
  catch (e) { console.error(`✗ evidenceManifest 읽기 실패: ${manifestRaw} — ${e.message}`); process.exit(1); }
}
const { entries, errors: mErrors } = validateEvidenceManifest(manifestRaw && typeof manifestRaw === "object" ? manifestRaw : {});
if (mErrors.length) {
  console.error("✗ evidenceManifest 오류:");
  for (const e of mErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// 검증 종류 글롭 — 컴파일해 두고 경로를 분류한다.
const kindGlobs = {};
for (const [k, globs] of Object.entries(cfg.verificationKinds || {})) kindGlobs[k] = (globs || []).map(compileGlob);
const matcher = (re, p) => re.test(String(p).replace(/^\.\//, ""));
const kindsCompiled = kindGlobs;

const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
let names;
try { names = readdirSync(SPEC_DIR).sort(); } catch { console.error(`✗ spec 디렉토리 없음: ${SPEC_DIR}`); process.exit(1); }

const items = [];
for (const n of names.filter((x) => /\.md$/.test(x))) {
  const text = readFileSync(join(SPEC_DIR, n), "utf8");
  const specId = (text.match(cfg.__specIdRe) || [n.replace(/\.md$/, "")])[0];
  for (const line of text.split("\n")) {
    const it = parseScLine(line);
    if (it) items.push({ specId, ...it });
  }
}

const { classes, counts } = classifyScCoverage(items, entries, kindsCompiled, matcher);
const byKind = {};
for (const [, v] of classes) if (v.kind) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
const kindTag = Object.keys(byKind).sort().map((k) => `${k}:${byKind[k]}`).join(" ") || "—";

console.log(`SC·NFR 회계 게이트(scCoveragePolicy=${POLICY}): 항목 ${items.length}건 — verified ${counts.verified}·evidence ${counts.evidence}·deferred ${counts.deferred}·미회계 ${counts.unaccounted} | 종류(${kindTag})`);

const tag = HARD ? "✗" : "⚠";
// 항목 0건은 "깨끗함"이 아니라 "볼 것이 없었음"이다 — SC 문법이 안 잡힌 상태와 구분되지 않는다.
const bad = [...classes].filter(([, v]) => v.cls === "unaccounted").map(([k, v]) => ({ k, v })).sort((a, b) => a.k.localeCompare(b.k));
if (items.length === 0) verdict(VERDICT_KINDS.INERT, "SC·NFR 선언 라인이 0건 — 판정 대상을 찾지 못했다");
else judged(bad.length);
// 목록 상한 — 마이그레이션 초기엔 미회계가 수십~수백 건이라 전량 출력이 다른 게이트 판정을 덮는다.
// 감추는 게 아니라 "외 N건"으로 총량을 명시한다(헤더의 미회계 카운트가 진실의 원천).
const CAP = Number(cfg.scCoverageListCap ?? 12);
for (const { k, v } of bad.slice(0, CAP)) {
  const why = v.kind === "미확인"
    ? "`[미확인]`은 정직한 자기신고지만 회계가 아니다 — evidenceManifest에 사유와 함께 착지시켜라"
    : "`[검증: <경로>]`로 실행 가능한 검증을 지목하거나, 실행 불가면 evidenceManifest에 {kind, evidence} 또는 {kind:\"deferred\", reason}";
  console.log(`  ${tag} ${k} — 검증 바인딩 없음: ${why}`);
}
if (bad.length > CAP) {
  console.log(`  ${tag} … 외 ${bad.length - CAP}건 (전체 목록은 scCoverageListCap 상향 또는 게이트 단독 실행으로 확인)`);
}
if (items.length === 0) {
  console.log(`  · 판정 대상 없음 — SC·NFR 선언 라인(\`- **SC-001**: …\`)이 한 건도 없다`);
  if (HARD) { console.error("\n✗ scCoveragePolicy=hard인데 판정 대상이 없다(거짓 안전) — SC 문법을 확인하거나 정책을 off로."); process.exit(1); }
}
if (bad.length && HARD) {
  console.error(`\n✗ scCoveragePolicy=hard: SC·NFR ${bad.length}건에 검증 바인딩이 없다 — 성능·보안 목표가 검증 없이 통과하는 것이 이 게이트가 막는 것이다.`);
  process.exit(1);
}
if (!bad.length && items.length) console.log("SC·NFR 회계 게이트: OK — 모든 SC·NFR이 검증·증거·유예 중 하나로 회계됨.");
