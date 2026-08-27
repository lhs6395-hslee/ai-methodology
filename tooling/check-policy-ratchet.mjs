#!/usr/bin/env node
// ─── 정책 래칫 게이트 (SPEC-027) ───────────────────────────
// 강제 정책 knob의 강도를 낮추는 커밋을 차단한다(단조 증가만 허용). base ref의 config 대비
// 현재 config에서 하향된 knob을 검출 — "hard에서 위반이 대량으로 떠도 knob을 내려 회피"를 봉쇄.
// off(no-op) | advisory(기본, 경고 exit 0) | hard(위반 시 exit 1). git·base config 없으면 skip.
// 자기포함: `policyRatchetPolicy` 자신도 래칫 대상이고, 그 강도가 base보다 낮으면 base 시점
// 강도로 이 실행을 판정한다 — 한 줄 자폭(감사 A-2) 봉쇄.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadConfig, configFromString } from "./sdd-config.mjs";
import {
  classifyRatchet, effectiveRatchetPolicy,
  exemptionFindings, classifyExemptionRatchet, exemptionKnobs, exemptionEntries,
  EXEMPTION_FINDING_TEXT, classifyStructuralRatchet, STRUCTURAL_FINDING_TEXT,
} from "./policy-ratchet-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const curPolicy = cfg.policyRatchetPolicy || "advisory";

if (!["off", "advisory", "hard"].includes(curPolicy)) {
  console.error(`✗ policyRatchetPolicy 값 위반 "${curPolicy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) || process.env.SDD_DIFF_BASE || cfg.specSyncBase || "origin/main";
const offNotice = () => {
  verdict(VERDICT_KINDS.OFF, "policyRatchetPolicy");
  console.log("정책 래칫 게이트 — policyRatchetPolicy:off (판정 안 함)");
};

const sh = (c) => execSync(c.replace(/^git /, "git -c core.quotepath=off "), { cwd: cfg.__root, encoding: "utf8" });
const shOk = (c) => { try { return sh(c); } catch { return null; } };

// base ref에서 config를 읽는다 — repo 루트 상대경로로 조회(cfg.__path는 절대경로).
// **off 단락보다 먼저** 읽는다: 래칫 자신의 강도도 base 시점 값으로 판정해야 하기 때문(FR-007,
// 감사 A-2). 워킹트리 config만 보고 off에서 조기 종료하면 `policyRatchetPolicy:"off"` 한 줄로
// 래칫 전체가 자폭한다. base를 못 읽으면 그때 기존 경로(off 고지·skip)로 되돌아간다(하위호환).
const cfgRel = (shOk("git ls-files --full-name -- sdd.config.json") || "").trim().split("\n")[0]
  || (cfg.__path ? cfg.__path.slice(cfg.__root.length + 1) : "sdd.config.json");
const baseRaw = shOk(`git show ${BASE}:${cfgRel}`);

if (baseRaw === null) {
  if (curPolicy === "off") { offNotice(); process.exit(0); }
  verdict(VERDICT_KINDS.SKIPPED, `base(${BASE}) config 조회 불가 — 비교 대상이 없다(git 없음·최초 채택)`);
  console.log(`정책 래칫 게이트 — base(${BASE}) config 조회 불가(git 없음·최초 채택) — 건너뜀`);
  process.exit(0);
}
const baseCfg = configFromString(baseRaw, cfg.__root);
if (!baseCfg) {
  if (curPolicy === "off") { offNotice(); process.exit(0); }
  verdict(VERDICT_KINDS.SKIPPED, `base(${BASE}) config 파싱 실패 — 비교 대상을 읽지 못했다`);
  console.log(`정책 래칫 게이트 — base(${BASE}) config 파싱 실패 — 건너뜀`);
  process.exit(0);
}

// 자기 강도 판정(FR-007): 하향이면 base 시점 강도가 이 실행을 심판한다(상향은 즉시 반영).
const policy = effectiveRatchetPolicy(baseCfg.policyRatchetPolicy, curPolicy);
const HARD = policy === "hard";
if (policy !== curPolicy) {
  console.log(`· 정책 래칫: policyRatchetPolicy ${curPolicy}(현재)가 base(${BASE})의 ${baseCfg.policyRatchetPolicy}보다 약함 — base 시점 강도로 판정(자기약화 방지, SPEC-027)`);
}
if (policy === "off") { offNotice(); process.exit(0); }

const { violations, allowedDowngrades } = classifyRatchet(baseCfg, cfg, cfg.policyRatchetExceptions || []);

console.log(`정책 래칫 게이트 — base:${BASE} mode:${policy} violations:${violations.length} allowed-downgrades:${allowedDowngrades.length}`);

// 예외로 허용된 하향도 항상 부채로 표면화한다(남용 방지 — "예외라 통과"를 정상으로 오인 금지).
for (const d of allowedDowngrades) {
  console.log(`  · [부채] ${d.knob}: ${d.from} → ${d.to} (policyRatchetExceptions로 허용된 하향 — 재승격 대상)`);
}
for (const v of violations) {
  const why = v.kind === "limit"
    ? "임계 완화 금지 — 캡 초과는 **분할 또는 병합**으로 해소하는 것이지 자를 늘려 재는 것이 아니다"
    : "강도 하향 금지(단조 증가만)";
  console.log(`  · ${v.knob}: ${v.from} → ${v.to} — ${why}. 정당한 재조정이면 policyRatchetExceptions에 "${v.knob}" 선언(부채로 표면화)`);
}

// ── 면제 래칫 — 면제는 "지금 green을 만들기 위해" 추가되고 아무도 걷어내지 않는다.
//    강도·임계 래칫이 knob을 지키는 동안 **면제 목록이 게이트를 무력화하는 우회로**였다.
const exKnobs = exemptionKnobs(cfg, cfg.exemptionKnobs);
const exTotal = exKnobs.reduce((n, k) => n + exemptionEntries(cfg[k]).length, 0);
const exFindings = exemptionFindings(cfg, cfg.exemptionRegistry, cfg.exemptionKnobs);
const { grown, allowedGrowth } = classifyExemptionRatchet(baseCfg, cfg, cfg.exemptionKnobs, cfg.policyRatchetExceptions || []);
// stale-record는 부패 신호이지 위반이 아니다 — 표면화하고 차단하지 않는다.
const exBlocking = exFindings.filter((f) => f.kind !== "stale-record");

console.log(`면제 래칫: knob ${exKnobs.length}종 · 면제 ${exTotal}건 — 미등록·형식 위반 ${exBlocking.length} · 증가 ${grown.length}`);
for (const g of allowedGrowth) {
  console.log(`  · [부채] ${g.knob}: 면제 ${g.from} → ${g.to} (policyRatchetExceptions로 허용된 증가 — 걷어낼 대상)`);
}
for (const g of grown) {
  console.log(`  · ${g.knob}: 면제가 ${g.from} → ${g.to}건으로 **늘었다** — 래칫은 줄어드는 방향만 허용한다.`
    + " 정당한 신규 면제가 필요하면 다른 면제를 걷어내거나 policyRatchetExceptions에 그 knob을 선언하라(부채로 표면화된다)");
}
for (const f of exFindings.slice(0, 20)) {
  const tail = f.kind === "missing-field" ? ` — \`${f.field}\` 없음(${f.exKind})` : "";
  console.log(`  ${f.kind === "stale-record" ? "·" : " "} ${f.knob}[${f.entry}]: ${EXEMPTION_FINDING_TEXT[f.kind]}${tail}`);
}
if (exFindings.length > 20) console.log(`   … 외 ${exFindings.length - 20}건`);

// ── 구조적 knob 래칫 — 강도·상한·면제개수 어디에도 안 잡히는 "감시 표면" 축(이슈 #21 A-3).
const { violations: structViolations, allowedDowngrades: structAllowed } = classifyStructuralRatchet(baseCfg, cfg, cfg.policyRatchetExceptions || []);
console.log(`구조 래칫: 감시 표면 축소 ${structViolations.length}건 · 허용된 축소 ${structAllowed.length}건`);
for (const d of structAllowed) {
  console.log(`  · [부채] ${d.knob}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)} (policyRatchetExceptions로 허용됨 — 재승격 대상)`);
}
for (const v of structViolations) {
  console.log(`  · ${v.knob}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)} — ${STRUCTURAL_FINDING_TEXT[v.kind]}. 정당한 변경이면 policyRatchetExceptions에 "${v.knob}" 선언(부채로 표면화)`);
}

const totalViolations = violations.length + exBlocking.length + grown.length + structViolations.length;
judged(totalViolations);
if (totalViolations) {
  const parts = [];
  if (violations.length) parts.push("강제 강도를 낮췄다(정책 하향 ∨ 수치 임계 완화)");
  if (exBlocking.length) parts.push("면제가 사유·분류 없이 존재한다(넷이 없는 면제는 이월이 아니라 방치다)");
  if (grown.length) parts.push("면제 개수가 늘었다(래칫은 줄어드는 방향만 허용)");
  if (structViolations.length) parts.push("감시·강제 표면이 좁아졌다(등록 목록 축소·배제 목록 확장·강제 지점 재지정)");
  const msg = `정책 래칫 위반 — ${parts.join(" / ")}. 위반을 knob 조정이나 면제 추가로 회피하지 말고 스펙을 편집해 해소하라(advisory는 경유지·hard가 종착지).`;
  if (HARD) { console.error(`\n✗ ${msg}`); process.exit(1); }
  console.log(`\n⚠ ${msg} (policyRatchetPolicy:advisory — 경고)`);
  process.exit(0);
}
console.log(`정책 래칫 게이트: OK — 강도 하향·임계 완화 없음, 면제 ${exTotal}건 전부 분류·사유 등록됨.`);
