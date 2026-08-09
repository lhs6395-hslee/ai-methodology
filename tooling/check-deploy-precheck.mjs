#!/usr/bin/env node
// ─── 배포 전제 조건 가드 (SPEC-035 FR-006, PreToolUse) ───
// 기존 배포 가드가 묻는 것: **"이 배포가 스펙에 반영됐나?"**
// 이 게이트가 묻는 것:     **"이 배포가 재현 가능한 리비전에서 나오는가?"**
//
// 실측 제보: 킷 가드가 `terraform apply`를 정확히 감지하고도 막지 못했다. 감지 후 묻는 것이
// 스펙 반영 여부 하나뿐이었기 때문이다. 그리고 PostToolUse는 이미 실행된 뒤라 사후 상기뿐이었고,
// 그 상기는 **같은 세션의 두 번째 apply**도 막지 못했다.
//
// 전제 조건은 다르다 — 미커밋 트리·upstream 뒤처짐은 **순수 git 조회**라 배포 **전에** 판정
// 가능하고 오탐이 거의 없다. 막을 수 있는 것을 사후로 미루면 그냥 늦는 것이다.
// 그래서 이것만 PreToolUse로 앞당기고, 스펙 드리프트는 PostToolUse에 그대로 둔다(되돌릴 수
// 없는 것을 막는 척하지 않는다는 원칙은 유지 — 축이 다를 뿐이다).
//
//   사용: node scripts/check-deploy-precheck.mjs --command "terraform apply -var-file=x.tfvars"
//         또는 stdin으로 PreToolUse 훅 JSON({"tool_input":{"command":"…"}})
//
// exit 0 = 통과·판정 안 함 / exit 2 = hard 차단(PreToolUse 규약: 비-0이 도구 실행을 막는다).
// 배포 명령이 아니거나 정책 off·git 없음이면 침묵(오탐 금지 — 오탐이 잦으면 훅이 꺼진다).

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";
import {
  DEFAULT_DEPLOY_PATTERNS, parseDeployCommand,
  deployPreconditionFindings, deployPreconditionVerdict, deployApprovalFindings, commandFromHookInput } from "./deploy-guard-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict({ quietWhenSilent: true });  // 훅 편의 계층 — 발동 조건이 아니면 침묵이 계약이다(SPEC-040)

// 정본은 deploy-guard-lib의 commandFromHookInput — 두 게이트에 본문 동일로 있던 것(R13 구조 중복).
const readCommand = () => commandFromHookInput(process.argv, () => readFileSync(0, "utf8"));

const command = readCommand();
if (!command.trim()) process.exit(0);

let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
const POLICY = String(cfg.deployPreconditionPolicy ?? "off");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ deployPreconditionPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") process.exit(0);

const parsed = parseDeployCommand(command, cfg.outOfBandDeployCommands || DEFAULT_DEPLOY_PATTERNS);
if (!parsed.matched) process.exit(0);

// 승인·파괴 판정은 **git이 없어도** 성립한다(명령 문자열만 본다) — 아래 git 조회 실패로 조기
// 종료하기 전에 먼저 모은다. 파괴적 명령의 동의는 매 실행 환경변수로 표현된다(standing policy가
// 아니라 per-invocation 선언 — 그래야 흔적이 남고 습관이 되지 않는다).
const approval = deployApprovalFindings(command, { destroyOk: String(process.env.SDD_DESTROY_OK || "") === "1" });

const ROOT = cfg.__root;
const git = (args) => {
  try { return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};
// git 없음 — 재현 가능성은 판정 불가지만 승인·파괴 판정은 유효하다(조기 종료가 그 축을 삼키면 안 된다).
const noGit = git("rev-parse --git-dir") === null;

// git 사실 수집. upstream이 없으면 behind는 **모르는 것**이지 0이 아니다.
const findings = [...approval];
if (!noGit) {
  const dirty = [];
  for (const line of (git("status --porcelain") || "").split("\n")) {
    const p = line.slice(3).trim().split(" -> ").pop();
    if (p) dirty.push(p.replace(/^"|"$/g, ""));
  }
  const branch = (git("rev-parse --abbrev-ref HEAD") || "").trim();
  const upstream = (git("rev-parse --abbrev-ref --symbolic-full-name @{u}") || "").trim() || null;
  let behind = null;
  if (upstream) {
    const counts = (git(`rev-list --left-right --count ${upstream}...HEAD`) || "").trim().split(/\s+/);
    behind = counts.length === 2 ? Number(counts[0]) : null;
  }
  findings.push(...deployPreconditionFindings({ dirty, behind, upstream, branch }, parsed.paths));
}
const v = deployPreconditionVerdict(POLICY, findings);
if (!v.violations.length && !v.unknowns.length) process.exit(0); // 깨끗한 리비전에서 나가는 배포 — 침묵

// unknowns는 위반이 아니라 "못 본 것"이다 — 위반 0인데 unknown만 있으면 전수를 본 게 아니다.
if (!v.violations.length && v.unknowns.length) verdict(VERDICT_KINDS.SKIPPED, `전제 ${v.unknowns.length}건을 판정하지 못했다(upstream 없음 등)`);
else judged(v.violations.length);
const tag = v.blocking ? "✗" : "⚠";
console.log(`[SDD 배포 전제] \`${parsed.tool}\` — 재현 가능한 리비전에서 나오는가 · 승인한 것이 적용되는가(deployPreconditionPolicy=${POLICY})`);
for (const f of v.violations) console.log(`  ${tag} ${f.detail}`);
for (const f of v.unknowns) console.log(`  · ${f.detail}`);

if (v.blocking) {
  console.error("\n✗ 배포 전제 조건 미충족 — 커밋(또는 pull) 후 배포하라. 지금 나가면 라이브 상태를 되돌릴 좌표가 없다.");
  console.error("  · 의도적 예외라면 `deployPreconditionPolicy`를 advisory로 내리지 말고(래칫 위반) 이 배포를 커밋 뒤로 미뤄라.");
  if (v.violations.some((f) => f.kind === "destructive")) {
    console.error("  · 삭제가 의도한 것이면 무엇이 지워지는지 확인한 뒤 `SDD_DESTROY_OK=1`을 붙여 재실행하라(매 실행 선언 — 습관이 되지 않게).");
  }
  process.exit(2); // PreToolUse 규약 — 비-0이 도구 실행을 막는다
}
if (POLICY === "advisory" && v.violations.length) {
  console.log("  · advisory — 차단하지 않는다. hard로 승격하면 이 배포는 여기서 멈춘다.");
} else if (!v.violations.length) {
  // 미판정만 남은 경우 — hard에서도 차단하지 않는다. 모르는 것을 위반으로 세지 않되, 침묵도 안 한다.
  console.log("  · 위반은 없다. 다만 위 항목은 **판정하지 못한 것**이라 '통과'와 같지 않다.");
}
process.exit(0);
