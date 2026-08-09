#!/usr/bin/env node
// ─── 검증 실행 회계 게이트 (R14, SPEC-041) ───────────────────────────────────
// SPEC-031이 "선언된 증거가 **실재**하는가"까지 봤다면, 이 게이트는 "그 증거가 **돌았는가**"를 본다.
// 존재는 실행이 아니다 — 실측 제보에서 검증 절차가 세 번 조용히 사라졌고(중도 포기·대상 0건
// exit 0·전제 자원 부재로 미실행) 게이트는 전부 초록이었다.
//
// 판정 입력은 **실행 원장**(JSONL)이다: `verificationRunLedger`. 미선언이면 INERT(SPEC-040) —
// 볼 것이 없는 상태를 "위반 0건"으로 말하지 않는다.
//
// 기록: node scripts/check-verification-executed.mjs --record <asset> <outcome> [사유...]
//   CI 스테이지·에이전트·러너가 자기 결과를 append한다. outcome은 SPEC-040의 다섯 종류.
//   전제 자원이 없어 못 돌았으면 INERT를, 중도 포기했으면 SKIPPED를 **사유와 함께** 남긴다.
//
// 정책: verificationRunPolicy off|advisory(기본)|hard.
//   차단하는 것은 **침묵**(기록 없음)과 **깨진 기록**뿐이다. 사유 있는 포기는 어떤 강도에서도
//   막지 않는다 — 막으면 사람이 사유를 지어내고 그 순간 원장이 거짓말을 담기 시작한다.
import { readdirSync, readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { evidencePathsOf } from "./covers-backlink-lib.mjs";
import { parseRunLedger, classifyRuns, verificationRunVerdict, formatRunLine } from "./verification-run-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = String(cfg.verificationRunPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ verificationRunPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const LEDGER_REL = cfg.verificationRunLedger || null;
const LEDGER_ABS = LEDGER_REL ? resolveFromRoot(cfg, LEDGER_REL) : null;

// ── 기록 모드 — CI 스테이지·에이전트·러너가 자기 결과를 남긴다 ──────────────
const recIdx = process.argv.indexOf("--record");
if (recIdx !== -1) {
  const [asset, outcome, ...rest] = process.argv.slice(recIdx + 1);
  const detail = rest.join(" ").trim();
  if (!asset || !outcome) {
    verdict(VERDICT_KINDS.SKIPPED, "인자 부족 — 판정을 요청받지 못했다(usage)");
    console.error("usage: check-verification-executed.mjs --record <asset> <JUDGED|OFF|INERT|SKIPPED> [사유...]");
    process.exit(2);
  }
  if (!LEDGER_ABS) {
    verdict(VERDICT_KINDS.INERT, "verificationRunLedger 미선언 — 기록할 원장이 없다");
    console.error("✗ verificationRunLedger가 선언되지 않아 기록할 곳이 없다 — sdd.config.json에 경로를 선언하라.");
    process.exit(1);
  }
  if (String(outcome).toUpperCase() !== "JUDGED" && !detail) {
    verdict(VERDICT_KINDS.JUDGED, "위반 1건");
    console.error(`✗ ${outcome} 기록에 사유가 없다 — 포기는 허용하되 **사유 없는 포기는 기록이 아니다**(SPEC-041).`);
    process.exit(1);
  }
  mkdirSync(dirname(LEDGER_ABS), { recursive: true });
  appendFileSync(LEDGER_ABS, formatRunLine({ asset, outcome, detail, at: new Date().toISOString() }) + "\n");
  judged(0);
  console.log(`검증 실행 기록 — ${asset}: ${String(outcome).toUpperCase()}${detail ? ` (${detail})` : ""} → ${LEDGER_REL}`);
  process.exit(0);
}

// ── 판정 모드 ────────────────────────────────────────────────────────────────
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "verificationRunPolicy");
  console.log("검증 실행 회계 게이트 — verificationRunPolicy:off (판정 안 함)");
  process.exit(0);
}
const HARD = POLICY === "hard";

if (!LEDGER_ABS) {
  // 정책은 켜졌는데 원장이 없다 = 판정 입력 부재. "위반 0건"이 아니라 **아무것도 안 봤음**이다.
  verdict(VERDICT_KINDS.INERT, "verificationRunLedger 미선언 — 무엇이 실제로 돌았는지 볼 원장이 없다");
  console.log(`검증 실행 회계 게이트(verificationRunPolicy=${POLICY}): 판정 불가(inert) — verificationRunLedger 미선언(검증 절차가 결과를 기록할 곳이 없다)`);
  if (HARD) {
    console.error("\n✗ verificationRunPolicy=hard인데 원장이 없다 — hard 선언 + 무판정은 거짓 안전이다(SPEC-040). verificationRunLedger를 선언하고 러너·CI 스테이지가 --record로 남기게 하라.");
    process.exit(1);
  }
  process.exit(0);
}

// 선언된 실행 등급 증거 경로를 전 스펙에서 모은다 — 대조 축은 SPEC-031이 이미 강제하는 `[검증: <경로>]`다.
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
let names = [];
try { names = readdirSync(SPEC_DIR).sort().filter((n) => n.endsWith(".md")); }
catch { console.error(`✗ spec 디렉토리 없음: ${SPEC_DIR}`); process.exit(1); }

const declaredPaths = new Set();
for (const n of names) {
  for (const line of readFileSync(join(SPEC_DIR, n), "utf8").split("\n")) {
    for (const p of evidencePathsOf(line)) declaredPaths.add(p);
  }
}
const paths = [...declaredPaths].sort();

if (!paths.length) {
  // 증거 표기가 한 건도 없으면 대조할 축이 없다 — 0건은 "다 돌았다"가 아니다.
  verdict(VERDICT_KINDS.INERT, "선언된 실행 증거 경로 0건 — 대조할 축이 없다(SPEC-031 표기 부채)");
  console.log(`검증 실행 회계 게이트(verificationRunPolicy=${POLICY}): 판정 불가(inert) — 스펙에 \`[검증: <경로>]\` 표기가 0건이라 대조 대상이 없다`);
  process.exit(0);
}

const ledgerText = existsSync(LEDGER_ABS) ? readFileSync(LEDGER_ABS, "utf8") : "";
const { entries, malformed } = parseRunLedger(ledgerText);
const { executed, debt, silent } = classifyRuns(paths, entries, compileGlob);
const v = verificationRunVerdict(POLICY, { silent, malformed });
judged(v.violations);

const CAP = Number(cfg.verificationRunListCap) || 12;
const tag = HARD ? "✗" : "⚠";
console.log(`검증 실행 회계 게이트(verificationRunPolicy=${POLICY}): 선언 증거 ${paths.length}건 — 실행됨 ${executed.length}·사유 있는 미실행 ${debt.length}·기록 없음 ${silent.length}${malformed.length ? `·깨진 기록 ${malformed.length}` : ""} | 원장 ${LEDGER_REL}`);

// 사유 있는 미실행은 **부채**다 — 차단하지 않되 매 실행 보인다(포기가 조용히 '완료'가 되지 않게).
for (const d of debt.slice(0, CAP)) {
  console.log(`  · [${d.entry.outcome}] ${d.path} — ${d.entry.detail}`);
}
if (debt.length > CAP) console.log(`  · … 외 ${debt.length - CAP}건`);

for (const p of silent.slice(0, CAP)) {
  console.log(`  ${tag} 기록 없음: ${p} — 이 자산이 돌았다는 기록이 원장에 없다(안 돈 것과 구분되지 않는다). 러너·CI 스테이지가 --record로 남기게 하라`);
}
if (silent.length > CAP) console.log(`  ${tag} … 외 ${silent.length - CAP}건`);

for (const m of malformed.slice(0, CAP)) {
  console.log(`  ${tag} 깨진 기록: ${m.why} — ${m.raw.slice(0, 120)}`);
}

if (v.blocking) {
  console.error(`\n✗ verificationRunPolicy=hard: 선언된 증거가 돌았다는 기록이 없다(${silent.length}건)${malformed.length ? ` · 깨진 기록 ${malformed.length}건` : ""} — **존재는 실행이 아니다**. 돌렸으면 기록하고, 못 돌렸으면 사유와 함께 남겨라(포기는 허용, 침묵은 금지).`);
  process.exit(1);
}
if (!silent.length && !malformed.length) {
  console.log(debt.length
    ? `검증 실행 회계 게이트: OK — 침묵 0건(사유 있는 미실행 ${debt.length}건은 부채로 표면화 중).`
    : "검증 실행 회계 게이트: OK — 선언된 증거가 모두 실행 기록을 갖는다.");
}
