// tooling/check-spec-consistency.mjs
// FR↔Ownership 일관성(advisory) — 선언한 키의 핵심 토큰이 본문에 0회 등장하면
// "근거 없는 키" 경고. 자연어 NLP 없이 grep 근사 → 결정적·advisory.
// 설계: 2026-06-30-ownership-key-derivation-design.md §6.2
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { buildKeySet, anchorFindings, buildKeyKindMap, categoryMarkerFindings, backtickKeyFindings, unanchoredOwnedKeyFindings } from "./key-anchor-lib.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");
const CATEGORIES = cfg.ownershipCategories;
// FR 키 앵커(SPEC-023) — off(기본)|advisory|hard. 켜면 FR 선언 라인의 평문 bold를
// 소유∪참조 키와 대조(consistency의 키→본문 근거와 역방향 짝 — 양방향 앵커).
const ANCHOR_POLICY = cfg.frKeyAnchorPolicy || "off";
if (!["off", "advisory", "hard"].includes(ANCHOR_POLICY)) {
  console.error(`✗ frKeyAnchorPolicy 값 위반 "${ANCHOR_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}

// 키에서 핵심 토큰 추출: 영숫자 조각(2자+). 예: "staff.recommend" → ["staff","recommend"], "POST /api/x" → ["api","x"]
const tokens = (key) => (key.toLowerCase().match(/[a-z][a-z0-9_]{1,}/g) || []).filter((t) => !["post","get","put","delete","patch","api","event","job"].includes(t));

const findings = [];
const anchors = { matched: 0, findings: [] }; // findings: {specId, fr, token}
const markers = { missing: [], wrong: [], backtick: [], unanchored: [] }; // 마커 findings
const MARKERS = cfg.frAnchorMarkers || { entity: "E", surface: "R", capability: "C" };
let specCount = 0;
for (const f of (() => { try { return readdirSync(SPEC_DIR); } catch { return []; } })().sort()) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const specId = (text.match(cfg.__specIdRe) || [f])[0];
  const own = parseSection(text, "Ownership", CATEGORIES);
  // FR 키 앵커 대조(SPEC-023) — 정책이 켜진 경우만(off면 판정·출력 무변).
  if (ANCHOR_POLICY !== "off") {
    const deps = parseSection(text, "Dependencies", CATEGORIES);
    const lines = text.split("\n");
    const keySet = buildKeySet(own, deps);
    const r = anchorFindings(lines, keySet, cfg.__reqAlt);
    anchors.matched += r.matched.length;
    for (const u of r.unmatched) anchors.findings.push({ specId, ...u });
    // 카테고리 마커(SPEC-023 확장): 굵은 키마다 종류 표기 — entity (E)·surface (R)·capability (C).
    const kindMap = buildKeyKindMap(own, deps);
    const cm = categoryMarkerFindings(lines, kindMap, MARKERS, cfg.__reqAlt);
    for (const m of cm.missing) markers.missing.push({ specId, ...m });
    for (const m of cm.wrong) markers.wrong.push({ specId, ...m });
    // 굵게 ⟺ 키 세 번째 방향(FR-006): 백틱에 든 선언 키는 앵커여야 함(리터럴 아님).
    for (const m of backtickKeyFindings(lines, kindMap, MARKERS, cfg.__reqAlt)) markers.backtick.push({ specId, ...m });
    // 소유 키 앵커 강제(FR-007, (B)): 소유 entity/surface/capability 키는 FR에 굵게 앵커돼야 함.
    for (const m of unanchoredOwnedKeyFindings(lines, buildKeyKindMap(own, {}), MARKERS, cfg.__reqAlt)) markers.unanchored.push({ specId, ...m });
  }
  // Extract body (FR text) — everything before the Ownership section
  const ownershipStart = text.search(/^##\s+Ownership\b/m);
  // Only the FR body BEFORE ## Ownership grounds keys; the Ownership block (and any
  // post-Ownership sections) are intentionally excluded so a key isn't grounded by its own declaration.
  const body = ownershipStart === -1 ? text : text.slice(0, ownershipStart);
  const hay = body.toLowerCase();
  specCount++;
  for (const cat of CATEGORIES) {
    for (const key of own[cat]) {
      const toks = tokens(key);
      if (toks.length && !toks.some((t) => hay.includes(t)))
        findings.push({ specId, cat, key });
    }
  }
}

console.log(`Spec 일관성(advisory): spec ${specCount}개 검사 — 근거 없는 키 ${findings.length}건.`);
for (const f of findings) console.log(`  ⚠ [${f.specId}] ${f.cat} "${f.key}": 본문에 근거 토큰 없음 → FR과 정렬 확인`);
// FR 키 앵커 리포트(SPEC-023) — bold는 키 앵커 전용: 미매치 = 수사적 강조 또는 미선언 키.
const markerCount = markers.missing.length + markers.wrong.length + markers.backtick.length + markers.unanchored.length;
const anchorHard = ANCHOR_POLICY === "hard" && (anchors.findings.length > 0 || markerCount > 0);
if (ANCHOR_POLICY !== "off") {
  console.log(`키 앵커(frKeyAnchorPolicy=${ANCHOR_POLICY}): 매치 ${anchors.matched} · 미매치 ${anchors.findings.length} · 카테고리 마커 위반 ${markerCount}`);
  for (const a of anchors.findings) {
    console.log(`  ${anchorHard ? "✗" : "⚠"} [${a.specId}] ${a.fr} bold "${a.token}" — 소유·참조 키 아님: 수사적 강조면 백틱/평문으로, 키면 Ownership/Dependencies에 선언`);
  }
  // 카테고리 마커(SPEC-023 확장) — 굵은 키마다 종류 표기: entity (E)·surface (R)·capability (C).
  for (const m of markers.missing) {
    console.log(`  ${anchorHard ? "✗" : "⚠"} [${m.specId}] ${m.fr} bold "${m.token}" — 카테고리 마커 없음: **${m.token}** (${m.expected})로 표기(굵은 키의 종류 명시)`);
  }
  for (const m of markers.wrong) {
    console.log(`  ${anchorHard ? "✗" : "⚠"} [${m.specId}] ${m.fr} bold "${m.token}" (${m.got}) — 마커 불일치: 이 키의 카테고리는 (${m.expected})`);
  }
  // 굵게 ⟺ 키(FR-006) — 백틱에 든 선언 키는 앵커여야 한다(리터럴 아님).
  for (const m of markers.backtick) {
    console.log(`  ${anchorHard ? "✗" : "⚠"} [${m.specId}] ${m.fr} 백틱 "${m.token}" — 선언 키는 백틱(리터럴)이 아니라 앵커: **${m.token}** (${m.expected})로 표기`);
  }
  // 소유 키 앵커 강제(FR-007) — 소유 키는 FR에 굵게 앵커돼야 한다(산문·백틱에만 있으면 위반).
  for (const m of markers.unanchored) {
    console.log(`  ${anchorHard ? "✗" : "⚠"} [${m.specId}] 소유 ${m.kind} 키 "${m.key}" — 어느 FR에도 굵게 앵커되지 않음: 이 키를 세우는 FR에서 **${m.key}** (${m.expected})로 표기`);
  }
}
if (findings.length && STRICT) { console.error("\n✗ --strict: 근거 없는 키."); process.exit(1); }
if (anchorHard) { console.error("\n✗ frKeyAnchorPolicy=hard: FR 선언 라인의 bold는 키 앵커 전용이며 각 키는 카테고리 마커(E/R/C) 필수 — 위 토큰을 정리하라(SPEC-023)."); process.exit(1); }
console.log(findings.length ? "일관성: advisory 경고(비차단)" : "일관성: OK — 모든 키에 본문 근거.");
