#!/usr/bin/env node
// ─── 배포 시간창 게이트 (SPEC-060, pre-push 훅) ───
// 실측 근거: 손으로 짠 CI/CD 파이프라인이 배포 창을 지키려 했지만, 판정 지점이 **로컬 브랜치
// 이름**이었다 — 로컬 브랜치가 우연히 배포 브랜치와 같은 이름인데 다른 원격 브랜치로 push하면
// 조용히 오탐/미탐이 났다. 이 게이트는 git pre-push 프로토콜(stdin)의 **실제 push 대상
// remoteRef**로만 판정한다(deploy-window-lib.parsePrePushRefs).
//
// `sdd.pipeline.config.json`이 없으면(마법사를 안 돌린 프로젝트) 조용히 통과한다 — 이 축은
// 선언-의존이다(riskyActionPatterns·liveRealityChecks와 같은 계열).
//
// exit 0 = 통과·판정 안 함 / exit 1 = hard 차단(git pre-push 훅 규약 — 비-0이 push를 막는다).
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import { deployWindowVerdict, parsePrePushRefs, targetsDeployBranch } from "./deploy-window-lib.mjs";
import { PIPELINE_CONFIG_FILE } from "./pipeline-setup-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function readPipelineConfig(cfg) {
  const rel = String(cfg.pipelineConfigFile || PIPELINE_CONFIG_FILE);
  const path = join(cfg.__root, ...rel.split("/"));
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function commitMessageFor(root, oid) {
  if (!oid || /^0+$/.test(oid)) return "";
  try { return execSync(`git -c core.quotepath=off log -1 --format=%B ${oid}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
}

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.deployWindowPolicy ?? "off");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ deployWindowPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") process.exit(0); // 훅 계층 — 침묵이 계약이다

  const pipeline = readPipelineConfig(cfg);
  if (!pipeline || !Array.isArray(pipeline.promotions) || !pipeline.promotions.length) process.exit(0); // 미선언 — 침묵

  const argv = process.argv.slice(2);
  let stdin = "";
  if (argv.includes("--hook")) { try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; } }
  const refFlag = argv.indexOf("--refs");
  if (refFlag >= 0 && argv[refFlag + 1]) stdin = argv[refFlag + 1];
  const refs = parsePrePushRefs(stdin);
  const deployBranch = String(pipeline.deployBranch || "main");
  if (!targetsDeployBranch(refs, deployBranch)) process.exit(0); // 이번 push는 배포 브랜치를 향하지 않는다

  const targetRef = refs.find((r) => r.remoteRef === `refs/heads/${deployBranch}`);
  const message = commitMessageFor(cfg.__root, targetRef ? targetRef.localOid : "");

  const applicable = pipeline.promotions.filter((p) => p.from === deployBranch && p.deployWindow && p.deployWindow.enabled);
  if (!applicable.length) process.exit(0); // 이 배포 브랜치에 걸린 시간창이 없다 — 침묵

  const results = applicable.map((p) => ({ promotion: `${p.from}→${p.to}`, verdict: deployWindowVerdict(p.deployWindow, Date.now(), message) }));
  const blocking = results.filter((r) => r.verdict.status === "out-of-window" || r.verdict.status === "misconfigured");

  if (!blocking.length) process.exit(0); // 창 안 또는 예외됨 — 조용할 자격이 있다

  judged(blocking.length);
  console.log(`[SDD 배포 시간창] 배포 브랜치 \`${deployBranch}\` push — 승격 지점 ${applicable.length}개 중 ${blocking.length}개가 창 밖(deployWindowPolicy=${POLICY})`);
  for (const r of blocking) console.log(`  ${POLICY === "hard" ? "✗" : "⚠"} [${r.promotion}] ${r.verdict.detail}`);

  if (POLICY === "hard") {
    console.error("\n✗ 배포 시간창 밖 — push가 막혔다. 창 안에 다시 시도하거나 위 안내대로 예외 트레일러를 붙여라.");
    process.exit(1); // git pre-push 규약 — 비-0이 push를 막는다
  }
  console.log("  · advisory — 막지 않는다. hard로 승격하면 이 push는 여기서 멈춘다.");
  process.exit(0);
}

if (isMainEntry(import.meta.url)) {
  armVerdict({ quietWhenSilent: true });
  main();
}
