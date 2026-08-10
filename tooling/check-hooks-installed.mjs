#!/usr/bin/env node
// ─── 훅 배선 실재 게이트 (SPEC-036) ───
// 게이트 스크립트가 전부 있어도 `.git/hooks`에 훅이 없으면 **아무것도 발동하지 않는다.**
// 기존 "판정 확인"은 게이트의 inert만 봤지 훅 배선의 inert는 보지 않았다 — 실측 제보에서
// scripts/hooks에 pre-commit·pre-push가 버전관리돼 있었는데 .git/hooks엔 commit-msg만 복사돼
// 게이트가 한 번도 돌지 않은 채 green으로 읽혔다. 미설치를 green으로 읽지 않는 것이 목적이다.
//
// hooksInstalledPolicy: off | advisory(기본) | hard.
// git 없음·hooks.list 없음이면 침묵(이식성). 훅 경로는 `git rev-parse --git-path hooks`가 준다
// — worktree·core.hooksPath·bare를 한 번에 해결한다(손 조합은 워크트리에서 틀린 답을 냈다).
import { existsSync, readFileSync, readdirSync, accessSync, constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import { parseHookEntries, hookFindings, HOOK_FINDING_TEXT } from "./hooks-install-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const HERE = dirname(fileURLToPath(import.meta.url));
let cfg;
try { cfg = loadConfig(); } catch { process.exit(0); }
const POLICY = String(cfg.hooksInstalledPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ hooksInstalledPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "hooksInstalledPolicy");
  console.log("훅 배선 게이트 — hooksInstalledPolicy:off (판정 안 함)"); process.exit(0);
}
const HARD = POLICY === "hard";

// 탐색 순서 — **프로젝트 선언이 킷 기본값을 이긴다.** HERE(킷 tooling)를 먼저 보면 소비 프로젝트를
// 검사할 때 킷 자신의 목록이 이겨서 그 프로젝트가 선언하지도 않은 훅을 미설치로 지목한다(테스트가 잡음).
const listPath = [
  join(cfg.__root, "scripts", "hooks.list"),
  join(cfg.__root, "tooling", "harness", "hooks.list"),
  join(HERE, "harness", "hooks.list"),
].find(existsSync);
if (!listPath) {
  verdict(VERDICT_KINDS.INERT, "hooks.list 없음 — 어떤 훅이 있어야 하는지 선언이 없다");
  console.log("훅 배선 게이트 — hooks.list 없음(판정 대상 미선언, no-op)"); process.exit(0);
}
const entries = parseHookEntries(readFileSync(listPath, "utf8"));
const expected = entries.map((e) => e.name);
const sourceOf = new Map(entries.map((e) => [e.name, e.source]));

const git = (a) => { try { return execSync(`git ${a}`, { cwd: cfg.__root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
// 훅 디렉토리는 **git에게 묻는다** — 손으로 조합하지 않는다.
// 실측 제보(2026-08-10): `--git-dir` + `core.hooksPath`를 손으로 합치는 이전 판은 **git worktree에서
// 틀린 답을 냈다.** 워크트리에서 `.git`은 파일이고 `--git-dir`은 `.git/worktrees/<이름>` —
// **훅이 없는 워크트리 전용 디렉토리**를 준다(훅은 공통 디렉토리에 있다). 그래서 도입 프로젝트가
// 워크트리 기반이라 commit-msg·pre-commit·pre-push가 **한 번도 발동한 적이 없었고**, 그날의 모든
// 커밋이 게이트를 우회했다. `rev-parse --git-path hooks` 한 번이 워크트리와 `core.hooksPath`를
// **동시에** 해결한다 — 조합을 손으로 하는 것이 바로 그 결함의 원인이었다.
if (!git("rev-parse --git-dir")) {
  verdict(VERDICT_KINDS.INERT, "git 저장소 아님 — 훅이 설치될 자리가 없다");
  console.log("훅 배선 게이트 — git 저장소 아님(no-op)"); process.exit(0);
}
const hooksPath = git("rev-parse --git-path hooks");
if (!hooksPath) {
  verdict(VERDICT_KINDS.INERT, "훅 경로를 git에게서 얻지 못했다 — 판정할 자리를 모른다");
  console.log("훅 배선 게이트 — `git rev-parse --git-path hooks` 실패(판정 안 함)"); process.exit(0);
}
const hooksDir = isAbsolute(hooksPath) ? hooksPath : join(cfg.__root, hooksPath);

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
  const rec = { exists, executable, content };
  // 신선도 축 — 원본이 **선언된 훅만** 대조한다. 선언이 없으면 `source` 키를 넣지 않는다:
  // 코어가 "키 없음(미선언)"과 "null(읽기 실패)"을 다르게 판정하므로, 미선언을 null로 넘기면
  // 신선도를 알 수 없는 훅이 전부 `source-unreadable` 소음이 된다(오탐이 잦은 게이트는 꺼진다).
  const src = sourceOf.get(name);
  if (src) {
    const sp = isAbsolute(src) ? src : join(cfg.__root, ...src.split("/"));
    // 읽기 실패는 null로 넘긴다 — 코어가 "확인 못 함"으로 계상한다(통과가 아니다).
    try { rec.source = readFileSync(sp, "utf8"); } catch { rec.source = null; }
  }
  installed.set(name, rec);
}

const findings = hookFindings(expected, installed);
const rel = hooksDir.replace(cfg.__root + "/", "");
judged(findings.length);
console.log(`훅 배선 게이트(hooksInstalledPolicy=${POLICY}): 선언 ${expected.length}종 · 설치 ${expected.length - findings.length}종 — ${rel}`);

const tag = HARD ? "✗" : "⚠";
const INSTALL_HINT = " 설치: sh scripts/sdd-hooks-install.sh (킷: sh tooling/harness/self-hooks-install.sh)";
for (const f of findings) {
  const hint = (f.kind === "missing" || f.kind === "stale") ? INSTALL_HINT : "";
  console.log(`  ${tag} ${f.name}: ${HOOK_FINDING_TEXT[f.kind]}${hint}`);
}
// 신선도를 판정하지 **않은** 훅을 매 실행 밝힌다 — 안 본 것을 조용히 초록에 합산하지 않는다.
// (킷 자신의 훅은 설치기가 heredoc으로 매 실행 다시 쓰므로 대조할 원본 파일이 없다.)
const flagged = new Set(findings.map((f) => f.name));
// 이미 미설치·권한·마커로 지목된 훅은 세지 않는다 — 그 훅의 신선도는 물을 단계가 아니다.
const unjudged = expected.filter((n) => !sourceOf.get(n) && !flagged.has(n));
if (unjudged.length) {
  console.log(`  · 신선도 미판정 ${unjudged.length}종(${unjudged.join(", ")}) — hooks.list에 원본 경로가 선언되지 않았다.`
    + " 존재·실행권한·킷 마커는 판정했고 **내용 신선도는 보지 않았다**(낡은 사본은 미설치와 동급이다 — 원본 경로를 선언하면 대조한다).");
}
if (findings.length && HARD) {
  console.error(`\n✗ hooksInstalledPolicy=hard: 훅 ${findings.length}종이 배선되지 않았다 — 게이트 스크립트가 있어도 발동하지 않으므로 이 상태의 green은 거짓이다.`);
  process.exit(1);
}
if (!findings.length) {
  const fresh = expected.length - unjudged.length;
  console.log(`훅 배선 게이트: OK — 선언된 훅이 모두 설치·실행 가능하며 킷 훅이다${fresh ? ` (그중 ${fresh}종은 원본과 내용 일치까지 확인)` : ""}.`);
}
