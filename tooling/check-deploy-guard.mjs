#!/usr/bin/env node
// ─── out-of-band 배포 가드 (SPEC-035, PostToolUse) ───
// spec-first 강제 지점을 **커밋**에서 **배포 행위**까지 앞당긴다.
//
// 실측 제보: infra 산출물을 워킹트리에서 고친 뒤 `kubectl apply`로 라이브에 즉시 반영하는 패턴에서,
// `check-spec-sync`가 commit-msg 훅이라 커밋 전까지 아무 신호가 없다. 배포가 커밋보다 먼저인 궤도라
// 커밋을 미루는 동안 spec↔live 드리프트가 누적된다(INFRA-005 역방향 흡수 사례).
//
//   사용: node scripts/check-deploy-guard.mjs --command "kubectl apply -f k8s/x.yaml"
//         또는 stdin으로 PostToolUse 훅 JSON({"tool_input":{"command":"…"}})
//
// **항상 exit 0** — PostToolUse는 명령이 이미 실행된 뒤에 돈다. 막을 것이 없고, 배포를 되돌리는 것은
// 게이트의 일이 아니다. 할 수 있는 일은 즉시 상기시키는 것이다. 진짜 차단은 커밋(commit-msg)·CI가 한다.
// git 없음·미소유 경로·정책 off면 침묵(오탐 금지 — 오탐이 잦으면 사람이 훅을 꺼버린다).

import { readdirSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { compileGlob, parseFilesLine } from "./spec-sync-lib.mjs";
import { DEFAULT_DEPLOY_PATTERNS, parseDeployCommand, deployGuardFindings, debtLine, deploySmokeVerdict, commandFromHookInput } from "./deploy-guard-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict({ quietWhenSilent: true });  // 훅 편의 계층 — 발동 조건이 아니면 침묵이 계약이다(SPEC-040)

// 정본은 deploy-guard-lib의 commandFromHookInput — 두 게이트에 본문 동일로 있던 것(R13 구조 중복).
const readCommand = () => commandFromHookInput(process.argv, () => readFileSync(0, "utf8"));

const command = readCommand();
if (!command.trim()) process.exit(0);

let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
const POLICY = String(cfg.outOfBandDeployPolicy ?? "advisory");
if (POLICY === "off") process.exit(0);

const parsed = parseDeployCommand(command, cfg.outOfBandDeployCommands || DEFAULT_DEPLOY_PATTERNS);
if (!parsed.matched) process.exit(0);

// ── 축 ①: 배포판 거짓 안전(SPEC-035 FR-007) — 명령의 성공은 서비스의 생존이 아니다.
// 경로 유무와 **무관하게** 판정한다: 경로가 없는 배포(`kubectl rollout restart` 등)도 서비스를
// 죽일 수 있고, 실측 사례가 정확히 "apply 성공 · CI 초록 · 전 요청 403"이었다.
// 스펙 드리프트 축(아래)이 경로 없음으로 조기 종료하던 자리에 이 축이 먼저 발화한다.
const SMOKE_TAG = "[SDD 배포 스모크]";
const smoke = deploySmokeVerdict(cfg.deploySmokeCommand, (cmd) => {
  try {
    execSync(cmd, { cwd: cfg.__root, encoding: "utf8", timeout: Number(cfg.deploySmokeTimeoutMs) || 60000, stdio: ["ignore", "pipe", "pipe"] });
    return { exitCode: 0, stderr: "" };
  } catch (e) { return { exitCode: e.status ?? 1, stderr: String(e.stderr || e.message || "") }; }
});
// 출력은 미룬다 — **스모크가 통과했고 드리프트도 없으면 조용할 자격이 있다**(오탐이 잦은 훅은
// 꺼진다). 반대로 통과하지 못했으면 침묵은 "살아 있음"과 구분되지 않으므로 반드시 말한다.
const smokeLine = smoke.status === "dead" ? `${SMOKE_TAG} ✗ ${smoke.detail}`
  : smoke.status === "undeclared" ? `${SMOKE_TAG} ⚠ ${smoke.detail}`
  : "";

const ROOT = cfg.__root;
const git = (args) => {
  try { return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};
if (git("rev-parse --git-dir") === null) process.exit(0); // git 없음 — 침묵

// 워킹트리 미커밋 경로(추적 변경 + 미추적) — 배포 소스가 커밋됐으면 정상 궤도다.
const status = git("status --porcelain") || "";
const dirty = new Set();
for (const line of status.split("\n")) {
  const p = line.slice(3).trim().split(" -> ").pop();
  if (p) dirty.add(p.replace(/^"|"$/g, ""));
}

// ── 축 ②: 스펙 드리프트. 경로가 없으면 소유 판정이 성립하지 않으므로 여기서 끝낸다
// (스모크 축은 경로와 무관하다 — 조기 종료가 그 축까지 삼키던 것이 결함이었다).
if (!parsed.paths.length) {
  // 경로가 없어 소유 축은 못 봤다 — 스모크 축만 말했으면 그 사실을 타입으로 밝힌다.
  if (smokeLine) { verdict(VERDICT_KINDS.SKIPPED, "배포 명령에서 소스 경로를 못 읽어 스펙 드리프트 축은 판정하지 못했다"); console.log(smokeLine); }
  process.exit(0);
}

// 스펙 Files glob → 소유 스펙 색인
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
let names = [];
try { names = readdirSync(SPEC_DIR).sort().filter((n) => /\.md$/.test(n)); } catch { process.exit(0); }
const index = [];
for (const n of names) {
  let text; try { text = readFileSync(join(SPEC_DIR, n), "utf8"); } catch { continue; }
  const globs = parseFilesLine(text);   // Files 라인 문법은 spec-sync-lib 단일 사이트(SPEC-038 실수확)
  if (!globs.length) continue;
  const res = [];
  for (const g of globs) { try { res.push(compileGlob(g)); } catch { /* 잘못된 글롭은 문법 게이트 소관 */ } }
  index.push({ specId: (text.match(cfg.__specIdRe) || [n])[0], file: `${cfg.specDir}/${n}`, res });
}

const norm = (p) => String(p).replace(/^\.\//, "").replace(new RegExp(`^${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
const ownerOf = (p) => {
  const rel = norm(p);
  const hit = index.find((e) => e.res.some((re) => re.test(rel)));
  return hit ? hit.specId : null;
};
const specFileOf = (specId) => (index.find((e) => e.specId === specId) || {}).file || "";
const specTouched = (specId) => {
  const f = specFileOf(specId);
  if (!f) return { changed: false, diff: "" };
  const changed = dirty.has(f);
  const diff = changed ? (git(`diff -- "${f}"`) || "") : "";
  return { changed, diff };
};

const deployed = parsed.paths.map(norm);
const findings = deployGuardFindings(deployed, dirty, ownerOf, specTouched);
// 스모크 결과도 부채 대상이다 — 죽은 배포와 아무도 확인 안 한 배포는 커밋 전에 갚아야 한다.
if (POLICY === "hard" && smoke.status !== "alive") {
  findings.push({ kind: smoke.status === "dead" ? "smoke-dead" : "smoke-undeclared", path: parsed.tool, specId: "" });
}
if (!findings.length && !smokeLine) process.exit(0); // 소스가 커밋됐고 스모크도 통과 — 조용할 자격이 있다
judged(findings.length);
if (smokeLine) console.log(smokeLine);
if (!findings.length) process.exit(0);

console.log(`[SDD 배포 가드] out-of-band 배포 감지 — \`${parsed.tool}\` (미커밋 소스가 라이브에 반영됨)`);
console.log("  라이브에 반영된 것은 **커밋 전이라도** spec Change Log에 먼저 착지해야 한다 — 커밋을 미루는 동안 spec↔live 드리프트가 누적된다.");
for (const f of findings) {
  if (f.kind === "unowned") {
    console.log(`  ⚠ ${f.path} — 어느 스펙도 소유하지 않는 배포 소스다. 소유 스펙을 만들거나 Files 글롭에 편입하라(미소유는 드리프트 레이더 밖).`);
  } else if (f.kind === "spec-untouched") {
    console.log(`  ⚠ ${f.path} → 소유 ${f.specId} 미수정 — 배포했는데 스펙이 그대로다. ${specFileOf(f.specId)}의 Change Log에 이번 반영을 먼저 적어라.`);
  } else if (f.kind === "no-changelog") {
    console.log(`  ⚠ ${f.path} → ${f.specId}는 수정됐지만 **Change Log 행이 추가되지 않았다** — 본문만 고치면 "언제 무엇을 왜 라이브에 넣었나"가 남지 않는다.`);
  } else if (f.kind === "smoke-dead") {
    console.log(`  ✗ ${f.path} — 배포는 성공했으나 스모크 실패(위 참조). 라이브가 죽었을 수 있다 — 지금 확인하라.`);
  } else if (f.kind === "smoke-undeclared") {
    console.log(`  ⚠ ${f.path} — \`deploySmokeCommand\` 미선언(위 참조). 배포 계약에 생존 확인을 넣어라.`);
  } else if (f.kind === "thin-record") {
    console.log(`  ⚠ ${f.path} → ${f.specId} Change Log ${f.rows}행이 최소 기록 형식 미달 — {날짜 | 무엇을 | 왜}를 채우고 실측 여부를 \`[검증: <경로>]\` 또는 \`[미확인]\`으로 표기하라.`);
  }
}

// hard = 부채 적재. advisory는 터미널 한 번으로 끝나고 스크롤과 함께 죽는다 — 그 차이가 승격의 실체다.
if (POLICY === "hard") {
  const rel = String(cfg.outOfBandDeployDebtFile || ".sdd/deploy-debt.jsonl");
  const abs = join(ROOT, ...rel.split("/").filter(Boolean));
  const date = new Date().toISOString().slice(0, 10);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    appendFileSync(abs, findings.map((f) => debtLine(date, parsed.tool, f)).join("\n") + "\n", "utf8");
    console.log(`  · outOfBandDeployPolicy=hard — 위 ${findings.length}건을 세션 부채로 적재했다: ${rel}`);
    console.log("    다음 커밋은 pre-commit(check-deploy-debt)이 막는다. 소유 스펙 Change Log에 행을 추가하면 그 자리에서 해소된다.");
  } catch (e) {
    console.log(`  ⚠ 부채 파일 기록 실패(${rel}): ${e.message} — 기록되지 않았으므로 이 경고가 유일한 흔적이다.`);
  }
} else {
  console.log("  · advisory — 이 경고는 차단하지 않고 어디에도 남지 않는다(배포는 이미 끝났다). hard로 승격하면 세션 부채로 적재돼 다음 커밋에서 막힌다.");
}
