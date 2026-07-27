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
import { classifyRatchet, effectiveRatchetPolicy } from "./policy-ratchet-lib.mjs";

const cfg = loadConfig();
const curPolicy = cfg.policyRatchetPolicy || "advisory";

if (!["off", "advisory", "hard"].includes(curPolicy)) {
  console.error(`✗ policyRatchetPolicy 값 위반 "${curPolicy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) || process.env.SDD_DIFF_BASE || cfg.specSyncBase || "origin/main";
const offNotice = () => console.log("정책 래칫 게이트 — policyRatchetPolicy:off (판정 안 함)");

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
  console.log(`정책 래칫 게이트 — base(${BASE}) config 조회 불가(git 없음·최초 채택) — 건너뜀`);
  process.exit(0);
}
const baseCfg = configFromString(baseRaw, cfg.__root);
if (!baseCfg) {
  if (curPolicy === "off") { offNotice(); process.exit(0); }
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
  console.log(`  · ${v.knob}: ${v.from} → ${v.to} — 강도 하향 금지(단조 증가만). 정당한 롤백이면 policyRatchetExceptions에 "${v.knob}" 선언`);
}

if (violations.length) {
  const msg = "정책 래칫 위반 — 강제 정책 강도를 낮췄다. 위반을 knob 하향으로 회피하지 말고 스펙을 편집해 해소하라(advisory는 경유지·hard가 종착지).";
  if (HARD) { console.error(`\n✗ ${msg}`); process.exit(1); }
  console.log(`\n⚠ ${msg} (policyRatchetPolicy:advisory — 경고)`);
  process.exit(0);
}
console.log("정책 래칫 게이트: OK — 강도 하향 없음.");
