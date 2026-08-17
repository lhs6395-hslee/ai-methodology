// 에이전트 배선 실재 (SPEC-051, R19) — **감시자가 에이전트를 실제로 보는가.**
//
// 오너 실측: "감시게이트 및 감시에이전트가 필요한데 — 즉 SDD에 의해 수행하는지 혼자 날뛰지
// 않는지 — 그게 동작을 하지 않아." 조사 결과 킷 자신에 `.claude/`가 없었고(이 층만 도그푸딩 0)
// 그런데도 감시자 축(R17)은 초록이었다 — R17은 CI·영수증을 보고 이 층을 보지 않기 때문이다.
// @covers SPEC-051/FR-001
// @covers SPEC-051/FR-002
// @covers SPEC-051/FR-003
// @covers SPEC-051/FR-004
// @covers SPEC-051/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAgentHookDecl, wiredHooks, missingMatcherTokens, commandNamesScript,
  agentWiringFindings, buildHookSettings, mergeHookSettings,
  DEFAULT_AGENT_SETTINGS_FILE, NO_MATCHER,
} from "../agent-wiring-lib.mjs";
import { localImports } from "../import-wiring-lib.mjs";

const TOOLING = fileURLToPath(new URL("..", import.meta.url));
const DECL = "SessionStart  -           sdd-session-context.sh\nPreToolUse    Write|Edit  sdd-edit-check.sh\n";

// ── 선언 파싱 ────────────────────────────────────────────────────────────────
test("선언은 공백 3필드이고 `-`는 매처 없음이다 — 주석·빈 줄은 선언이 아니다", () => {
  const d = parseAgentHookDecl(`# 주석\n\n${DECL}`);
  assert.deepEqual(d, [
    { event: "SessionStart", matcher: "", script: "sdd-session-context.sh" },
    { event: "PreToolUse", matcher: "Write|Edit", script: "sdd-edit-check.sh" },
  ]);
});

test("킷의 실제 선언 파일이 파싱되고 선언 전부를 뽑는다 — 설치기와 게이트의 단일 선언이다", () => {
  // 개수를 박지 않는다 — 훅을 추가할 때 이 테스트가 먼저 깨지면 "숫자만 고치기"가 정상 경로가 된다.
  // 대신 **선언 파일이 진실의 원천**임을 고정한다(SPEC-051: 목록이 둘이면 한쪽이 뒤처진다).
  const d = parseAgentHookDecl(readFileSync(join(TOOLING, "harness/agent-hooks.list"), "utf8"));
  assert.ok(d.length >= 4, `선언이 너무 적다(${d.length})`);
  assert.deepEqual([...new Set(d.map((x) => x.event))].sort(), ["PostToolUse", "PreToolUse", "SessionStart"]);
  assert.ok(d.every((x) => x.script.endsWith(".sh")), "스크립트가 아닌 선언이 있다");
  assert.equal(NO_MATCHER, "-");
});

// ── 매처는 부분집합 판정 ─────────────────────────────────────────────────────
test("매처를 넓히는 것은 정상이다 — 정확 일치를 요구하면 정당한 확장이 전부 위반이 된다", () => {
  assert.deepEqual(missingMatcherTokens("Write|Edit", "Write|Edit|MultiEdit"), []);
});

test("매처를 좁히면 빠진 도구를 이름으로 말한다 — 그 도구가 감시 밖으로 나갔다", () => {
  assert.deepEqual(missingMatcherTokens("Write|Edit", "Write"), ["Edit"]);
});

test("매처 없는 이벤트는 대조할 토큰이 없다", () => {
  assert.deepEqual(missingMatcherTokens("", "anything"), []);
});

// ── 커맨드 ↔ 스크립트 결속 ───────────────────────────────────────────────────
test("커맨드는 파일명 기준으로 본다 — 경로 표기 차이가 위반이 되면 게이트가 꺼진다", () => {
  for (const cmd of ["sh scripts/sdd-edit-check.sh", "./scripts/sdd-edit-check.sh", "/abs/p/sdd-edit-check.sh"]) {
    assert.equal(commandNamesScript(cmd, "sdd-edit-check.sh"), true, cmd);
  }
  assert.equal(commandNamesScript("sh scripts/other.sh", "sdd-edit-check.sh"), false);
});

// ── 판정 ─────────────────────────────────────────────────────────────────────
const settingsWith = (event, matcher, command) => ({
  hooks: { [event]: [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command }] }] },
});

test("설정 파일이 없으면 그것 자체가 하나의 사실이다 — 선언된 훅이 한 번도 발동한 적이 없다", () => {
  const f = agentWiringFindings(parseAgentHookDecl(DECL), null, () => true);
  assert.equal(f.settingsMissing, true);
  assert.equal(f.missing.length, 2);
});

test("킷의 실제 결함을 재현한다 — 배선 0종이면 감시 에이전트는 없는 것과 같다", () => {
  const f = agentWiringFindings(parseAgentHookDecl(DECL), { hooks: {} }, () => true);
  assert.equal(f.missing.length, 2);
  assert.deepEqual(f.narrowed, []);
});

test("배선은 있는데 매처가 좁으면 별개 사실이다 — 배선 있음과 발동함은 다르다", () => {
  const s = settingsWith("PreToolUse", "Write", "sh scripts/sdd-edit-check.sh");
  const f = agentWiringFindings(parseAgentHookDecl(DECL), s, () => true);
  assert.equal(f.narrowed.length, 1);
  assert.deepEqual(f.narrowed[0].missingTools, ["Edit"]);
});

test("배선이 여럿이면 가장 넓은 것으로 판정한다 — 하나라도 그 도구를 덮으면 발동한다", () => {
  const s = { hooks: { PreToolUse: [
    { matcher: "Write", hooks: [{ type: "command", command: "sh scripts/sdd-edit-check.sh" }] },
    { matcher: "Write|Edit", hooks: [{ type: "command", command: "sh scripts/sdd-edit-check.sh" }] },
  ] } };
  const f = agentWiringFindings(parseAgentHookDecl(DECL), s, () => true);
  assert.deepEqual(f.narrowed, []);
});

test("배선돼 있는데 스크립트가 없으면 에이전트가 조용히 건너뛴다 — 존재는 실행이 아니다", () => {
  const s = settingsWith("PreToolUse", "Write|Edit", "sh scripts/sdd-edit-check.sh");
  const f = agentWiringFindings(parseAgentHookDecl(DECL), s, () => false);
  assert.equal(f.scriptMissing.length, 1);
});

// ── 병합 — 남의 훅 보존 + 재실행 idempotent ──────────────────────────────────
test("병합은 남의 훅을 보존하고 킷 훅만 갈아끼운다", () => {
  const decls = parseAgentHookDecl(DECL);
  const existing = { hooks: { PreToolUse: [
    { matcher: "Write", hooks: [{ type: "command", command: "sh other/lint.sh" }] },
  ] } };
  const m = mergeHookSettings(existing, decls, (s) => `sh scripts/${s}`);
  const cmds = wiredHooks(m).filter((w) => w.event === "PreToolUse").map((w) => w.command);
  assert.ok(cmds.includes("sh other/lint.sh"), "남의 훅이 사라졌다");
  assert.ok(cmds.includes("sh scripts/sdd-edit-check.sh"));
});

test("재실행해도 훅이 두 번 발동하지 않는다 — 표기가 달라도 같은 훅이면 갈아끼운다", () => {
  const decls = parseAgentHookDecl(DECL);
  const old = { hooks: { PreToolUse: [
    { matcher: "Write|Edit", hooks: [{ type: "command", command: "./scripts/sdd-edit-check.sh" }] },
  ] } };
  const m = mergeHookSettings(old, decls, (s) => `sh scripts/${s}`);
  const hits = wiredHooks(m).filter((w) => commandNamesScript(w.command, "sdd-edit-check.sh"));
  assert.equal(hits.length, 1, "옛 표기가 남아 훅이 두 번 발동한다");
});

test("설치기가 쓸 설정은 선언에서 나온다 — 하드코딩된 JSON은 선언과 갈라진다", () => {
  const built = buildHookSettings(parseAgentHookDecl(DECL), (s) => `sh scripts/${s}`);
  assert.deepEqual(Object.keys(built.hooks), ["SessionStart", "PreToolUse"]);
  assert.equal(built.hooks.SessionStart[0].matcher, undefined);   // 매처 없는 이벤트엔 키를 넣지 않는다
  assert.equal(built.hooks.PreToolUse[0].matcher, "Write|Edit");
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
function closureCopyList(entry) {
  const seen = new Set(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let t; try { t = readFileSync(join(TOOLING, f), "utf8"); } catch { continue; }
    for (const imp of localImports(t)) stack.push(imp.specifier.replace(/^\.\//, ""));
  }
  return [...seen];
}

function fixture({ policy = "hard", decl = DECL, settings = undefined, scripts = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-agentwire-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], agentWiringPolicy: policy }));
  for (const f of closureCopyList("check-agent-wiring.mjs")) cpSync(join(TOOLING, f), join(root, "scripts", f));
  if (decl !== null) writeFileSync(join(root, "scripts", "agent-hooks.list"), decl);
  for (const s of scripts) { writeFileSync(join(root, "scripts", s), "#!/bin/sh\n"); chmodSync(join(root, "scripts", s), 0o755); }
  if (settings !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(settings, null, 2));
  }
  return root;
}
const run = (root, args = []) => {
  try { return { code: 0, out: execFileSync("node", [join(root, "scripts", "check-agent-wiring.mjs"), ...args], { cwd: root, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
};

test("게이트가 미배선을 hard에서 **실제로 막는다** — 킷이 실제로 이 상태였다", () => {
  const r = run(fixture({ settings: { hooks: {} }, scripts: ["sdd-session-context.sh", "sdd-edit-check.sh"] }));
  assert.equal(r.code, 1, `막지 않았다:\n${r.out}`);
  assert.match(r.out, /배선되지 않았다/);
  assert.match(r.out, /판정: JUDGED/);
});

test("설정 파일 부재는 별도 문장으로 말한다 — 한 번도 발동한 적이 없다는 뜻이다", () => {
  const r = run(fixture({ scripts: ["sdd-session-context.sh", "sdd-edit-check.sh"] }));
  assert.equal(r.code, 1);
  assert.match(r.out, /에이전트 설정 파일이 없다/);
  assert.match(r.out, /한 번도 발동한 적이 없다/);
});

test("advisory는 막지 않고 표면화한다 — 채택 중 프로젝트를 벽으로 세우지 않는다", () => {
  const r = run(fixture({ policy: "advisory" }));
  assert.equal(r.code, 0);
  assert.match(r.out, /⚠/);
});

test("선언 파일이 없으면 INERT다 — 무엇이 배선돼야 하는지 모르는 것을 위반으로 말하지 않는다", () => {
  const r = run(fixture({ decl: null }));
  assert.match(r.out, /판정: INERT/);
  assert.match(r.out, /단일 선언/);
});

test("선언 0건도 INERT다 — 0건은 '깨끗함'이 아니라 '볼 것이 없음'이다", () => {
  const r = run(fixture({ decl: "# 주석만\n" }));
  assert.match(r.out, /판정: INERT/);
  assert.match(r.out, /볼 것이 없음/);
});

test("off는 판정하지 않는다고 선언한다 — clean이 아니다(SPEC-040)", () => {
  assert.match(run(fixture({ policy: "off" })).out, /판정: OFF/);
});

test("설정이 깨진 JSON이면 훅이 하나도 발동하지 않는다 — 그 사실을 말한다", () => {
  const root = fixture({ scripts: ["sdd-session-context.sh", "sdd-edit-check.sh"] });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), "{ not json");
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /JSON으로 읽지 못했다/);
});

test("--emit-settings는 판정이 아니라 산출이다 — 쓰기는 설치기가 한다", () => {
  const root = fixture({ policy: "hard", scripts: ["sdd-session-context.sh", "sdd-edit-check.sh"] });
  const r = run(root, ["--emit-settings"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /판정: SKIPPED/);
  const json = JSON.parse(r.out.split("\n").filter((l) => !l.startsWith("판정: ")).join("\n"));
  assert.ok(json.hooks.SessionStart, "SessionStart가 산출되지 않았다");
  // 산출된 설정을 그대로 심으면 게이트가 통과해야 한다 — 설치·판정이 같은 선언에서 나오는지의 계약.
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(json, null, 2));
  assert.equal(run(root).code, 0, "설치기가 만든 설정이 게이트를 통과하지 못한다 — 선언이 갈라졌다");
});

// ── 킷 자기적용 — 이 층만 도그푸딩이 0이었다 ─────────────────────────────────
test("킷 자신이 에이전트 훅을 배선하고 있다 — 이 층만 도그푸딩 0이었던 것이 결함의 본체다", () => {
  const settings = JSON.parse(readFileSync(fileURLToPath(new URL("../../.claude/settings.json", import.meta.url)), "utf8"));
  const decls = parseAgentHookDecl(readFileSync(join(TOOLING, "harness/agent-hooks.list"), "utf8"));
  const f = agentWiringFindings(decls, settings, () => true);
  assert.equal(f.settingsMissing, false);
  assert.deepEqual(f.missing, []);
  assert.deepEqual(f.narrowed, []);
  assert.equal(DEFAULT_AGENT_SETTINGS_FILE, ".claude/settings.json");
});

// ── 편집 가드의 코드 경로가 config에서 온다(하드코딩 금지) ────────────────────
// 실측: 이전 판은 `case src/|lib/|app/`로 하드코딩했고 주석은 "sdd-init가 조정한다"고 적혀
// 있었지만 설치기는 그대로 복사만 했다 — 킷의 scanDirs는 `tooling`이라 체크리스트가 한 번도
// 발화할 수 없었다. 하드코딩된 어휘 밖에서 판정이 사라지고 그 0건이 진짜 0건과 구분되지 않는다.
test("편집 가드는 코드 경로를 하드코딩하지 않는다 — scanDirs가 정본이다", () => {
  const sh = readFileSync(join(TOOLING, "harness/sdd-edit-check.sh"), "utf8");
  const code = sh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /case\s+"\$FP"/, "경로 case 하드코딩이 남아 있다");
  assert.match(code, /--is-code-path/, "config 기반 질의를 쓰지 않는다");
});

test("검사 못 함을 통과로 출력하지 않는다 — `|| true` 침묵이 이 층의 결함을 가렸다", () => {
  const sh = readFileSync(join(TOOLING, "harness/sdd-edit-check.sh"), "utf8");
  assert.match(sh, /검사 못 함/);
});
