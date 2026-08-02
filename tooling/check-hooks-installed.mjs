#!/usr/bin/env node
// ─── 훅 배선 실재 게이트 (SPEC-036) ───
// 게이트 스크립트가 전부 있어도 `.git/hooks`에 훅이 없으면 **아무것도 발동하지 않는다.**
// 기존 "판정 확인"은 게이트의 inert만 봤지 훅 배선의 inert는 보지 않았다 — 실측 제보에서
// scripts/hooks에 pre-commit·pre-push가 버전관리돼 있었는데 .git/hooks엔 commit-msg만 복사돼
// 게이트가 한 번도 돌지 않은 채 green으로 읽혔다. 미설치를 green으로 읽지 않는 것이 목적이다.
//
// hooksInstalledPolicy: off | advisory(기본) | hard.
// git 없음·hooks.list 없음이면 침묵(이식성). bare/worktree는 core.hooksPath를 존중한다.
import { existsSync, readFileSync, readdirSync, accessSync, constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import { parseHookList, hookFindings } from "./hooks-install-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
const POLICY = String(cfg.hooksInstalledPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ hooksInstalledPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") { console.log("훅 배선 게이트 — hooksInstalledPolicy:off (판정 안 함)"); process.exit(0); }
const HARD = POLICY === "hard";

// 탐색 순서 — **프로젝트 선언이 킷 기본값을 이긴다.** HERE(킷 tooling)를 먼저 보면 소비 프로젝트를
// 검사할 때 킷 자신의 목록이 이겨서 그 프로젝트가 선언하지도 않은 훅을 미설치로 지목한다(테스트가 잡음).
const listPath = [
  join(cfg.__root, "scripts", "hooks.list"),
  join(cfg.__root, "tooling", "harness", "hooks.list"),
  join(HERE, "harness", "hooks.list"),
].find(existsSync);
if (!listPath) { console.log("훅 배선 게이트 — hooks.list 없음(판정 대상 미선언, no-op)"); process.exit(0); }
const expected = parseHookList(readFileSync(listPath, "utf8"));

const git = (a) => { try { return execSync(`git ${a}`, { cwd: cfg.__root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const gitDir = git("rev-parse --git-dir");
if (!gitDir) { console.log("훅 배선 게이트 — git 저장소 아님(no-op)"); process.exit(0); }
const custom = git("config --get core.hooksPath");
const hooksDir = custom
  ? (isAbsolute(custom) ? custom : join(cfg.__root, custom))
  : join(isAbsolute(gitDir) ? gitDir : join(cfg.__root, gitDir), "hooks");

const installed = new Map();
let present = [];
try { present = readdirSync(hooksDir); } catch { /* 디렉토리 자체가 없다 = 전부 미설치 */ }
for (const name of expected) {
  const p = join(hooksDir, name);
  const exists = present.includes(name) && existsSync(p);
  let executable = false, content = "";
  if (exists) {
    try { accessSync(p, constants.X_OK); executable = true; } catch { executable = false; }
    try { content = readFileSync(p, "utf8"); } catch { content = ""; }
  }
  installed.set(name, { exists, executable, content });
}

const findings = hookFindings(expected, installed);
const rel = hooksDir.replace(cfg.__root + "/", "");
console.log(`훅 배선 게이트(hooksInstalledPolicy=${POLICY}): 선언 ${expected.length}종 · 설치 ${expected.length - findings.length}종 — ${rel}`);

const tag = HARD ? "✗" : "⚠";
for (const f of findings) {
  if (f.kind === "missing") console.log(`  ${tag} ${f.name} 미설치 — 이 훅이 담당하는 게이트는 **한 번도 발동하지 않는다**(게이트 파일이 있어도 무의미). 설치: sh scripts/sdd-hooks-install.sh (킷: sh tooling/harness/self-hooks-install.sh)`);
  else if (f.kind === "not-executable") console.log(`  ${tag} ${f.name} 실행 권한 없음 — git이 조용히 건너뛴다(파일은 있는데 안 도는 상태). chmod +x`);
  else console.log(`  ${tag} ${f.name}이 킷 훅이 아니다(마커 없음) — 다른 도구(husky 등)가 같은 이름을 점유했다면 킷 게이트는 발동하지 않는다. 두 훅을 합치거나 킷 훅에서 위임하라`);
}
if (findings.length && HARD) {
  console.error(`\n✗ hooksInstalledPolicy=hard: 훅 ${findings.length}종이 배선되지 않았다 — 게이트 스크립트가 있어도 발동하지 않으므로 이 상태의 green은 거짓이다.`);
  process.exit(1);
}
if (!findings.length) console.log("훅 배선 게이트: OK — 선언된 훅이 모두 설치·실행 가능하며 킷 훅이다.");
