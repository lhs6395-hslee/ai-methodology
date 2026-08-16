// tooling/__tests__/action-approval.test.mjs
// 위험 행동 승인(SPEC-058) — 실측 제보: 커밋 이전, 대화 안에서 위험 행동(트래커 종결 전이 등)이
// 독립 검증 없이 진행됐다. 순수 코어 단독 검증 + 게이트 카나리아.
// @covers SPEC-058/FR-001
// @covers SPEC-058/FR-002
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashAction, parseRiskyActionPatterns, validateRiskyActionPatterns, matchRiskyAction,
  parseApprovalLedger, makeApprovalRecord, findApproval, ACTION_APPROVAL_GUARD_FINDING_TEXT,
  DEFAULT_ACTION_APPROVAL_LEDGER, DEFAULT_APPROVAL_TTL_SECONDS,
  canonicalToolPayload, toolCallFromHookInput,
} from "../action-approval-lib.mjs";

test("DEFAULT_ACTION_APPROVAL_LEDGER는 .sdd/ 아래다 — 커밋 대상이 아니다", () => {
  assert.equal(DEFAULT_ACTION_APPROVAL_LEDGER, ".sdd/action-approvals.jsonl");
  assert.match(DEFAULT_ACTION_APPROVAL_LEDGER, /^\.sdd\//);
});

test("hashAction: 같은 문자열은 같은 해시, 다른 문자열은 다른 해시 — 결정적", () => {
  const a = hashAction("tracker transition ticket=123 to=dev-done");
  const b = hashAction("tracker transition ticket=123 to=dev-done");
  const c = hashAction("tracker transition ticket=456 to=dev-done");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64); // sha256 hex
});

test("hashAction: 앞뒤 공백만 trim한다 — 그 외 정규화는 하지 않는다(다른 행동을 뭉개지 않는다)", () => {
  assert.equal(hashAction("  cmd x  "), hashAction("cmd x"));
  assert.notEqual(hashAction("cmd  x"), hashAction("cmd x")); // 중간 공백 정규화는 하지 않는다
});

test("parseRiskyActionPatterns: 필드 정규화 — 없으면 빈 문자열", () => {
  const [e] = parseRiskyActionPatterns([{ match: "deploy" }]);
  assert.deepEqual(e, { match: "deploy", tool: "", class: "", verifyAgainst: "", why: "" });
});

// @covers SPEC-058/FR-005
test("validateRiskyActionPatterns: no-matcher·ambiguous-matcher·bad-regex·bad-tool·class·verifyAgainst·why를 각각 잡는다", () => {
  const entries = parseRiskyActionPatterns([
    { match: "", tool: "", class: "c", verifyAgainst: "v", why: "w" },      // no-matcher
    { match: "m", tool: "t", class: "c", verifyAgainst: "v", why: "w" },    // ambiguous-matcher
    { match: "[", class: "c", verifyAgainst: "v", why: "w" },               // bad-regex
    { tool: "[", class: "c", verifyAgainst: "v", why: "w" },                // bad-tool
    { match: "m", class: "", verifyAgainst: "v", why: "w" },                // no-class
    { match: "m", class: "c", verifyAgainst: "", why: "w" },                // no-verify-against
    { match: "m", class: "c", verifyAgainst: "v", why: "" },                // no-why
    { match: "m", class: "c", verifyAgainst: "v", why: "w" },               // clean(match)
    { tool: "t", class: "c", verifyAgainst: "v", why: "w" },                // clean(tool)
  ]);
  const findings = validateRiskyActionPatterns(entries);
  assert.deepEqual(findings.map((f) => f.kind),
    ["no-matcher", "ambiguous-matcher", "bad-regex", "bad-tool", "no-class", "no-verify-against", "no-why"]);
});

// @covers SPEC-058/FR-001
test("matchRiskyAction: 첫 매치를 낸다(선언 순서), 미매치·빈 명령은 null", () => {
  const entries = parseRiskyActionPatterns([
    { match: "tracker.*dev-done", class: "tracker-transition", verifyAgainst: "CLOSEOUT_FLOW", why: "순서 위반 방지" },
    { match: "terraform apply", class: "deploy", verifyAgainst: "재현 가능 리비전", why: "" },
  ]);
  assert.equal(matchRiskyAction({ toolName: "Bash", command: "" }, entries), null);
  assert.equal(matchRiskyAction({ toolName: "Bash", command: "ls -la" }, entries), null);
  assert.equal(matchRiskyAction({ toolName: "Bash", command: "tracker transition ticket=1 to=dev-done" }, entries).class, "tracker-transition");
  assert.equal(matchRiskyAction({ toolName: "Bash", command: "terraform apply -auto-approve" }, entries).class, "deploy");
});

// @covers SPEC-058/FR-001
// @covers SPEC-058/FR-009
test("matchRiskyAction: tool 항목은 도구명으로 매칭한다 — command 유무와 무관", () => {
  const entries = parseRiskyActionPatterns([
    { tool: "mcp__github__merge_pull_request", class: "pr-merge", verifyAgainst: "CI 상태·리뷰 승인", why: "머지는 되돌리기 어렵다" },
    { match: "terraform apply", class: "deploy", verifyAgainst: "v", why: "w" },
  ]);
  assert.equal(matchRiskyAction({ toolName: "mcp__github__merge_pull_request", command: "" }, entries).class, "pr-merge");
  assert.equal(matchRiskyAction({ toolName: "mcp__github__get_me", command: "" }, entries), null);
  // Bash 명령은 tool 항목에 안 걸리고 match 항목에 걸린다.
  assert.equal(matchRiskyAction({ toolName: "Bash", command: "terraform apply -auto-approve" }, entries).class, "deploy");
});

// @covers SPEC-058/FR-009
test("canonicalToolPayload: 키 순서와 무관하게 같은 내용은 같은 문자열", () => {
  const a = canonicalToolPayload("mcp__github__merge_pull_request", { owner: "o", repo: "r", pullNumber: 1 });
  const b = canonicalToolPayload("mcp__github__merge_pull_request", { pullNumber: 1, repo: "r", owner: "o" });
  assert.equal(a, b);
  const c = canonicalToolPayload("mcp__github__merge_pull_request", { owner: "o", repo: "r", pullNumber: 2 });
  assert.notEqual(a, c);
});

// @covers SPEC-058/FR-009
test("toolCallFromHookInput: Bash는 command로, 그 외 도구는 toolInput 전체로 낸다", () => {
  const bash = toolCallFromHookInput([], () => JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls -la" } }));
  assert.deepEqual(bash, { toolName: "Bash", command: "ls -la", toolInput: { command: "ls -la" } });
  const tool = toolCallFromHookInput([], () => JSON.stringify({ tool_name: "mcp__github__merge_pull_request", tool_input: { owner: "o", repo: "r", pullNumber: 1 } }));
  assert.deepEqual(tool, { toolName: "mcp__github__merge_pull_request", command: "", toolInput: { owner: "o", repo: "r", pullNumber: 1 } });
  const viaFlag = toolCallFromHookInput(["--command", "ls -la"], () => "");
  assert.equal(viaFlag.toolName, "Bash");
  assert.equal(viaFlag.command, "ls -la");
});

test("parseApprovalLedger: 정상 줄·빈 줄·깨진 줄을 가른다 — 깨진 줄은 조용히 버리지 않는다", () => {
  const raw = [
    JSON.stringify({ hash: "a", class: "x" }),
    "",
    "이건 JSON이 아니다",
    JSON.stringify(["배열도 레코드가 아니다"]),
    JSON.stringify({ hash: "b", class: "y" }),
  ].join("\n");
  const { records, unreadable } = parseApprovalLedger(raw);
  assert.equal(records.length, 2);
  assert.equal(unreadable, 2);
});

test("makeApprovalRecord: 필드가 없으면 정직하게 빈 값/unknown — 지어내지 않는다", () => {
  const r = makeApprovalRecord({});
  assert.deepEqual(r, { hash: "", class: "", note: "", ts: null, sessionId: "unknown" });
});

// @covers SPEC-058/FR-003
test("findApproval: 해시 일치 + 신선(ttl 이내)만 유효하다", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const records = [
    makeApprovalRecord({ hash: "h1", class: "c", note: "확인함", ts: "2026-08-14T11:50:00.000Z" }), // 10분 전
  ];
  assert.ok(findApproval("h1", records, 900, now)); // ttl 900초=15분 이내 — 유효
  assert.equal(findApproval("h1", records, 300, now), null); // ttl 5분 — 만료
  assert.equal(findApproval("h2", records, 900, now), null); // 해시 불일치 — 다른 행동
});

test("findApproval: nowMs 미주입이면 판정하지 않는다 — 신선도를 추정하지 않는다", () => {
  const records = [makeApprovalRecord({ hash: "h1", class: "c", note: "n", ts: "2026-08-14T11:50:00.000Z" })];
  assert.equal(findApproval("h1", records, 900), null); // nowMs 없음
});

test("findApproval: 미래 시각(시계 역행 등)은 신뢰하지 않는다 — 음수 나이는 무효", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const records = [makeApprovalRecord({ hash: "h1", class: "c", note: "n", ts: "2026-08-14T12:05:00.000Z" })];
  assert.equal(findApproval("h1", records, 900, now), null);
});

test("findApproval: 여러 유효 승인 중 가장 최근을 낸다(결정적)", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const records = [
    makeApprovalRecord({ hash: "h1", class: "c", note: "old", ts: "2026-08-14T11:55:00.000Z" }),
    makeApprovalRecord({ hash: "h1", class: "c", note: "new", ts: "2026-08-14T11:58:00.000Z" }),
  ];
  assert.equal(findApproval("h1", records, 900, now).note, "new");
});

test("모든 가드 위반 종류에 사람이 읽는 문장이 있다", () => {
  for (const k of ["no-matcher", "ambiguous-matcher", "bad-regex", "bad-tool", "no-class", "no-verify-against", "no-why"]) {
    assert.ok(String(ACTION_APPROVAL_GUARD_FINDING_TEXT[k] || "").trim(), k);
  }
});

test("DEFAULT_APPROVAL_TTL_SECONDS는 양수다", () => {
  assert.ok(DEFAULT_APPROVAL_TTL_SECONDS > 0);
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync as _readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClosure } from "../import-wiring-lib.mjs";

const KIT_SRC = (f) => _readFileSync(join(process.cwd(), "tooling", f), "utf8");
const LIBS = importClosure(["check-risky-action.mjs"], KIT_SRC);

function fixture(config = {}, ledgerLines = null) {
  const root = mkdtempSync(join(tmpdir(), "sdd-risky-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify(config));
  if (ledgerLines) {
    mkdirSync(join(root, ".sdd"), { recursive: true });
    writeFileSync(join(root, ".sdd/action-approvals.jsonl"), ledgerLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return root;
}
function runHook(root, command) {
  const gate = join(root, "scripts", "check-risky-action.mjs");
  try {
    return { code: 0, out: execFileSync("node", [gate, "--hook"], { cwd: root, encoding: "utf8", input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
function runHookTool(root, toolName, toolInput) {
  const gate = join(root, "scripts", "check-risky-action.mjs");
  try {
    return { code: 0, out: execFileSync("node", [gate, "--hook"], { cwd: root, encoding: "utf8", input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }), stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
function runSweep(root) {
  const gate = join(root, "scripts", "check-risky-action.mjs");
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
function runRecord(root, command, cls, note) {
  const gate = join(root, "scripts", "check-risky-action.mjs");
  try {
    return { code: 0, out: execFileSync("node", [gate, "--record", "--command", command, "--class", cls, "--note", note], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

const PATTERNS = [{ match: "tracker.*dev-done", class: "tracker-transition", verifyAgainst: "CLOSEOUT_FLOW 순서 대조", why: "배포 전 종결 전이 방지" }];
const RISKY_CMD = "tracker transition ticket=123 to=dev-done";

// @covers SPEC-058/FR-002
// @covers SPEC-058/FR-007
test("게이트: 위험 행동을 hard에서 실제로 막는다 — class·확인방법·record 안내를 낸다", () => {
  const root = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    const r = runHook(root, RISKY_CMD);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /tracker-transition/);
    assert.match(r.out, /CLOSEOUT_FLOW/);
    assert.match(r.out, /--record/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  // advisory는 막지 않는다.
  const adv = fixture({ riskyActionPolicy: "advisory", riskyActionPatterns: PATTERNS });
  try {
    const r = runHook(adv, RISKY_CMD);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /advisory/);
  } finally { rmSync(adv, { recursive: true, force: true }); }
});

// @covers SPEC-058/FR-006
test("게이트: hard 차단 시 원장에 class·hash를 선언한다(SPEC-057 소비 계약)", () => {
  const root = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    runHook(root, RISKY_CMD);
    const ledger = _readFileSync(join(root, ".sdd/gate-failures.jsonl"), "utf8");
    const rec = JSON.parse(ledger.trim().split("\n").pop());
    assert.equal(rec.class, "tracker-transition");
    assert.equal(rec.target, hashAction(RISKY_CMD));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 무관 명령·선언 없음은 침묵 통과한다(hard여도)", () => {
  const root = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    const r = runHook(root, "ls -la");
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
  const noPatterns = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: [] });
  try {
    const r = runHook(noPatterns, RISKY_CMD);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
  } finally { rmSync(noPatterns, { recursive: true, force: true }); }
});

// @covers SPEC-058/FR-003
// @covers SPEC-058/FR-004
test("게이트: --record로 승인을 남기면 같은 행동은 통과한다 — 다른 행동은 안 통과한다(해시 결속)", () => {
  const root = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    const before = runHook(root, RISKY_CMD);
    assert.equal(before.code, 2, before.out);
    const rec = runRecord(root, RISKY_CMD, "tracker-transition", "배포 완료·CLOSEOUT_FLOW 3단계 확인함");
    assert.equal(rec.code, 0, rec.out);
    assert.match(rec.out, /승인 기록됨/);
    const after = runHook(root, RISKY_CMD);
    assert.equal(after.code, 0, after.out); // 같은 행동 — 통과
    const other = runHook(root, "tracker transition ticket=999 to=dev-done");
    assert.equal(other.code, 2, other.out); // 다른 티켓 — 승인이 안 걸린다(해시 불일치)
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-058/FR-004
test("게이트: --record는 --command·--class·--note 중 하나라도 없으면 exit 1", () => {
  const root = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    const gate = join(root, "scripts", "check-risky-action.mjs");
    let threw = false;
    try { execFileSync("node", [gate, "--record", "--command", RISKY_CMD], { cwd: root, encoding: "utf8" }); }
    catch (e) { threw = true; assert.equal(e.status, 1); }
    assert.ok(threw);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 승인이 만료(ttl 초과)되면 다시 막는다", () => {
  const root = fixture(
    { riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS, riskyActionApprovalTtlSeconds: 1 },
    [{ hash: hashAction(RISKY_CMD), class: "tracker-transition", note: "확인함", ts: new Date(Date.now() - 5000).toISOString(), sessionId: "s1" }],
  );
  try {
    const r = runHook(root, RISKY_CMD);
    assert.equal(r.code, 2, r.out); // 5초 전 승인, ttl 1초 — 만료
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 스윕 모드 — 선언 미검·미선언(INERT)·off·enum 밖", () => {
  const clean = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: PATTERNS });
  try {
    const r = runSweep(clean);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ 패턴 1종/);
  } finally { rmSync(clean, { recursive: true, force: true }); }

  const broken = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: [{ match: "x" }] });
  try {
    const r = runSweep(broken);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no-class|class가 없다/);
  } finally { rmSync(broken, { recursive: true, force: true }); }

  const inert = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: [] });
  try {
    const r = runSweep(inert);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /미선언/);
  } finally { rmSync(inert, { recursive: true, force: true }); }

  const off = fixture({ riskyActionPolicy: "off", riskyActionPatterns: PATTERNS });
  try { assert.doesNotMatch(runSweep(off).out, /위험 행동 승인 게이트\(/); } finally { rmSync(off, { recursive: true, force: true }); }

  const bad = fixture({ riskyActionPolicy: "deny", riskyActionPatterns: PATTERNS });
  try {
    const r = runSweep(bad);
    assert.equal(r.code, 1);
    assert.match(r.out, /riskyActionPolicy 값 위반/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});

const TOOL_PATTERNS = [{ tool: "mcp__github__merge_pull_request", class: "pr-merge", verifyAgainst: "CI 상태·리뷰 승인 확인", why: "머지는 되돌리기 어렵다" }];
const TOOL_NAME = "mcp__github__merge_pull_request";
const TOOL_INPUT = { owner: "o", repo: "r", pullNumber: 26 };

// @covers SPEC-058/FR-002
// @covers SPEC-058/FR-003
// @covers SPEC-058/FR-009
test("게이트: MCP 도구 호출(tool 항목)도 Bash와 동일하게 막고, 승인 후 통과하며, 다른 페이로드는 재차단한다", () => {
  const root = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: TOOL_PATTERNS });
  try {
    const blocked = runHookTool(root, TOOL_NAME, TOOL_INPUT);
    assert.equal(blocked.code, 2, blocked.out);
    assert.match(blocked.out, /pr-merge/);
    assert.match(blocked.out, /--record/);
    // 안내에 찍힌 정준 페이로드를 그대로 --record --command에 넣는다(사람이 지어내지 않는다).
    const payload = canonicalToolPayload(TOOL_NAME, TOOL_INPUT);
    assert.ok(blocked.out.includes(payload), blocked.out);

    const rec = runRecord(root, payload, "pr-merge", "CI 성공·리뷰 승인 확인함");
    assert.equal(rec.code, 0, rec.out);

    const after = runHookTool(root, TOOL_NAME, TOOL_INPUT);
    assert.equal(after.code, 0, after.out); // 같은 호출 — 통과

    const otherPr = runHookTool(root, TOOL_NAME, { owner: "o", repo: "r", pullNumber: 27 });
    assert.equal(otherPr.code, 2, otherPr.out); // 다른 PR — 승인이 안 걸린다(해시 불일치)

    const irrelevant = runHookTool(root, "mcp__github__get_me", {});
    assert.equal(irrelevant.code, 0);
    assert.equal(irrelevant.out.trim(), ""); // 무관 도구 — 침묵 통과
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-058/FR-005
test("게이트: 스윕 모드 — no-matcher·ambiguous-matcher·bad-tool도 hard에서 막는다", () => {
  const noMatcher = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: [{ class: "c", verifyAgainst: "v", why: "w" }] });
  try {
    const r = runSweep(noMatcher);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /match·tool이 둘 다 없다/);
  } finally { rmSync(noMatcher, { recursive: true, force: true }); }

  const ambiguous = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: [{ match: "m", tool: "t", class: "c", verifyAgainst: "v", why: "w" }] });
  try {
    const r = runSweep(ambiguous);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /match·tool이 둘 다 있다/);
  } finally { rmSync(ambiguous, { recursive: true, force: true }); }

  const badTool = fixture({ riskyActionPolicy: "hard", riskyActionPatterns: [{ tool: "[", class: "c", verifyAgainst: "v", why: "w" }] });
  try {
    const r = runSweep(badTool);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /도구명 패턴\(tool\)이 정규식으로 컴파일되지 않는다/);
  } finally { rmSync(badTool, { recursive: true, force: true }); }
});
