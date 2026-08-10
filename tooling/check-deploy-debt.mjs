#!/usr/bin/env node
// ─── out-of-band 배포 부채 게이트 (SPEC-035, pre-commit) ───
// `outOfBandDeployPolicy=hard`가 실제로 무엇을 하는가에 대한 답.
//
// 실측 제보: advisory와 hard가 **출력도 동작도 같았다** — 승격해도 달라지는 것이 없으면
// 그 정책은 승격 대상이 아니라 장식이다. 배포 시점(PostToolUse)은 여전히 막을 수 없지만,
// 막을 수 있는 지점이 하나 남아 있다: **아직 오지 않은 커밋**.
//   hard  → check-deploy-guard가 미기록 배포를 부채 파일(JSONL)에 적재
//   여기  → 커밋 직전에 남은 부채를 판정. 소유 스펙 Change Log가 이번 커밋에 착지했으면 해소.
//
// 해소는 자동이다 — 사람이 파일을 손으로 지우게 하면 부채는 "지우기"로 갚아진다.
// 갚는 방법은 하나뿐이다: 라이브에 넣은 것을 소유 스펙 Change Log에 적는 것.
//
// Usage: node scripts/check-deploy-debt.mjs   (pre-commit)
// 정책이 hard가 아니거나 부채 파일이 없으면 즉시 exit 0(침묵).

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseDebt, settleDebt, changeLogAdded, deploySmokeVerdict } from "./deploy-guard-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict({ quietWhenSilent: true });  // 훅 편의 계층 — 발동 조건이 아니면 침묵이 계약이다(SPEC-040)

let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
if (String(cfg.outOfBandDeployPolicy ?? "advisory") !== "hard") process.exit(0);

const ROOT = cfg.__root;
const rel = String(cfg.outOfBandDeployDebtFile || ".sdd/deploy-debt.jsonl");
const abs = join(ROOT, ...rel.split("/").filter(Boolean));
if (!existsSync(abs)) process.exit(0);

let text = "";
try { text = readFileSync(abs, "utf8"); } catch { process.exit(0); }
const { open, malformed } = parseDebt(text);
if (!open.length && !malformed.length) process.exit(0);

const git = (args) => {
  // core.quotepath=off — 비ASCII 경로가 8진수로 인용되면 경로 대조가 조용히 어긋난다(전 게이트 공통 계약).
  try { return execSync(`git -c core.quotepath=off ${args}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};

// 스펙 ID → 파일 경로 색인(부채는 ID만 들고 있다).
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const specFileOf = new Map();
try {
  for (const n of readdirSync(SPEC_DIR).sort().filter((f) => /\.md$/.test(f))) {
    const t = readFileSync(join(SPEC_DIR, n), "utf8");
    specFileOf.set((t.match(cfg.__specIdRe) || [n])[0], `${cfg.specDir}/${n}`);
  }
} catch { /* 스펙 디렉토리 없음 — 해소 판정 불가, 부채는 그대로 남는다 */ }

// 부채 종류마다 갚는 길이 다르다 — 도달 불가능한 해소 조건은 강제가 아니라 벽돌이다.
const resolvedSpec = (specId) => {
  const f = specFileOf.get(specId);
  if (!f) return false;
  const diff = git(`diff --cached -- "${f}"`);
  return diff ? changeLogAdded(diff) : false;
};
// 스모크 부채는 **지금 다시 판정**해서 갚는다(스펙 편집으로는 갚을 수 없는 종류다).
// 죽은 배포 부채가 있을 때만 명령을 실제로 돌린다 — 드물고 긴급한 경우에만 비용을 낸다.
let smokeNow = null;
const smokeSettles = (kind) => {
  const declared = String(cfg.deploySmokeCommand || "").trim();
  if (kind === "smoke-undeclared") return declared.length > 0;   // 계약 공백이 닫혔다
  if (kind !== "smoke-dead") return false;
  if (!declared) return false;                                    // 확인할 방법이 없으면 갚아지지 않는다
  if (smokeNow === null) {
    smokeNow = deploySmokeVerdict(declared, (cmd) => {
      try {
        execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: Number(cfg.deploySmokeTimeoutMs) || 60000, stdio: ["ignore", "pipe", "pipe"] });
        return { exitCode: 0, stderr: "" };
      } catch (e) { return { exitCode: e.status ?? 1, stderr: String(e.stderr || e.message || "") }; }
    });
    console.log(`  · 죽은 배포 부채가 있어 스모크를 재실행했다 — ${smokeNow.status === "alive" ? "통과(서비스 생존 확인)" : "여전히 실패"}`);
  }
  return smokeNow.status === "alive";
};
const { settled, remaining } = settleDebt(open, (d) => {
  if (String(d.kind || "").startsWith("smoke-")) return smokeSettles(d.kind);
  return !!d.specId && resolvedSpec(d.specId);
});

// 해소분만 지운다 — 남은 것은 파일에 그대로 보존(깨진 줄 포함: 파싱 실패로 부채를 지우면 그게 세탁이다).
if (settled.length) {
  const keep = [...remaining.map((d) => d.raw), ...malformed];
  try { writeFileSync(abs, keep.length ? keep.join("\n") + "\n" : "", "utf8"); } catch { /* 못 지워도 판정은 아래가 한다 */ }
}

judged(remaining.length + malformed.length);
console.log(`배포 부채 게이트 — ${rel}: 해소 ${settled.length}건 · 잔여 ${remaining.length}건${malformed.length ? ` · 파싱 불가 ${malformed.length}건` : ""}`);
for (const d of settled) {
  console.log(String(d.kind || "").startsWith("smoke-")
    ? `  ✓ ${d.kind} ← ${d.path} (스모크 계약 충족 — 해소)`
    : `  ✓ ${d.specId} ← ${d.path} (Change Log 행 착지 — 해소)`);
}

if (!remaining.length && !malformed.length) {
  console.log("✓ 미기록 배포 부채 없음.");
  process.exit(0);
}
for (const d of remaining) {
  const where = String(d.kind || "").startsWith("smoke-")
    ? (d.kind === "smoke-dead" ? "**서비스가 죽어 있을 수 있다**" : "`deploySmokeCommand` 미선언")
    : (d.specId ? `소유 ${d.specId}(${specFileOf.get(d.specId) || "파일 미발견"})` : "소유 스펙 없음");
  console.log(`  ✗ ${d.date} \`${d.tool}\` → ${d.path} — ${where} [${d.kind}]`);
}
for (const s of malformed) console.log(`  ✗ 파싱 불가한 부채 줄(지우지 않고 보존): ${s.slice(0, 120)}`);
console.error(`\n✗ 라이브에 반영됐지만 기록되지 않은 배포가 ${remaining.length + malformed.length}건 남아 있다 — spec↔live 드리프트는 커밋을 미룰수록 커진다.`);
console.error(`  갚는 방법: 소유 스펙 Change Log에 {날짜 | 무엇을 | 왜} 행을 추가하고 실측 여부를 \`[검증: <경로>]\`/\`[미확인]\`으로 표기한 뒤 함께 스테이징하라 — 그 순간 자동 해소된다.
  스모크 부채는 스펙 편집으로 갚아지지 않는다: \`smoke-undeclared\`는 \`deploySmokeCommand\`를 선언하면, \`smoke-dead\`는 그 명령이 다시 통과하면(=서비스가 살아나면) 해소된다.`);
console.error(`  부채 파일을 손으로 지우는 것은 갚는 것이 아니다(기록은 여전히 없다).`);
process.exit(1);
