// 판정 3분류의 반환 계약 (SPEC-054) — clean / could-not-check / violation.
//
// 제보 요청: "clean / could-not-check / violation을 판정 코어의 반환 계약으로 못박아달라.
// 기존 `hookFindings()`는 원본을 못 읽는 경우가 아예 없어서 **'검사 못 함'이 통과로 흘렀다.**"
// 실측: 킷의 판정 코어 6종이 존재 판정기를 주입받는데 그중 4종이 boolean만 받아, 읽기 실패가
// `false`로 붕괴해 "없음"= **거짓 위반**을 냈다(hooks-install의 반대 방향).
// @covers SPEC-054/FR-001
// @covers SPEC-054/FR-002
// @covers SPEC-054/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CHECK_KINDS, TRI, tri, triGuard, checkOutcome, mergeOutcomes, outcomeSummary,
} from "../check-outcome-lib.mjs";
import { missingGates } from "../watchdog-lib.mjs";
import { filesLineMissingPaths } from "../spec-sync-lib.mjs";
import { agentWiringFindings, parseAgentHookDecl } from "../agent-wiring-lib.mjs";
import { validateDiagnosisMap, parseDiagnosisMap } from "../diagnosis-guard-lib.mjs";

const TOOLING = new URL("..", import.meta.url).pathname;

// ── 3상태 정규화 ─────────────────────────────────────────────────────────────
test("종류는 셋뿐이다 — 더 늘리면 '이건 어디에 넣지'가 생기고 그 순간 예외가 태어난다", () => {
  assert.deepEqual(Object.values(CHECK_KINDS), ["clean", "could-not-check", "violation"]);
});

test("boolean은 그대로 받는다 — 새 계약이 기존 호출부를 다 깨면 채택되지 않는다", () => {
  assert.equal(tri(true), TRI.YES);
  assert.equal(tri(false), TRI.NO);
});

test("undefined·null은 UNKNOWN이다 — 모르는 것을 없다고 하지 않는다", () => {
  assert.equal(tri(undefined), TRI.UNKNOWN);
  assert.equal(tri(null), TRI.UNKNOWN);
});

test("던지는 판정기는 UNKNOWN이 된다 — 예외를 false로 삼키던 자리가 결함의 발생 지점이었다", () => {
  assert.equal(triGuard(() => { throw new Error("EACCES"); })(), TRI.UNKNOWN);
  assert.equal(triGuard(() => true)(), TRI.YES);
});

test("위반이 있으면 VIOLATION, 없고 못 본 것이 있으면 UNCHECKED, 둘 다 없으면 CLEAN", () => {
  assert.equal(checkOutcome([], []).kind, CHECK_KINDS.CLEAN);
  assert.equal(checkOutcome([], ["x"]).kind, CHECK_KINDS.UNCHECKED);
  assert.equal(checkOutcome(["v"], ["x"]).kind, CHECK_KINDS.VIOLATION);
});

test("위반이 UNCHECKED를 가리지 않는다 — 하나를 보고 다른 하나를 잊는 것이 이 계열 결함의 본체다", () => {
  const o = checkOutcome(["v"], ["x"]);
  assert.equal(o.unchecked.length, 1);
  assert.match(outcomeSummary(o), /확인 못 함 1건\(통과 아님\)/);
});

test("못 본 것을 초록에 합산하지 않는다", () => {
  assert.match(outcomeSummary(checkOutcome([], ["x"])), /통과가 아니다/);
  assert.doesNotMatch(outcomeSummary(checkOutcome([], [])), /통과가 아니다/);
});

test("여러 축의 결과를 합쳐도 3분류가 보존된다", () => {
  const m = mergeOutcomes(checkOutcome([], ["a"]), checkOutcome(["b"], []));
  assert.equal(m.kind, CHECK_KINDS.VIOLATION);
  assert.deepEqual([m.violations.length, m.unchecked.length], [1, 1]);
});

// ── 전환된 4종 코어: 읽기 실패가 거짓 위반이 되지 않는다 ──────────────────────
test("watchdog: 존재를 확인 못 한 게이트는 '지워졌다'가 아니다", () => {
  const receipt = { gates: ["a.mjs", "b.mjs"] };
  const r = missingGates(receipt, (g) => (g === "a.mjs" ? false : undefined));
  assert.deepEqual(r.gone, ["a.mjs"]);
  assert.deepEqual(r.unchecked, ["b.mjs"]);
});

test("spec-sync: 실재를 확인 못 한 리터럴 경로는 '없다'가 아니다 — 그리고 필터는 그대로다", () => {
  const r = filesLineMissingPaths(["gone.mjs", "unknown.mjs", "src/**", "—", "[placeholder]"],
    (t) => (t === "gone.mjs" ? false : undefined));
  assert.deepEqual(r.missing, ["gone.mjs"]);
  assert.deepEqual(r.unchecked, ["unknown.mjs"]);   // 글롭·대시·placeholder는 판정 대상 밖(원본 범위 유지)
});

test("agent-wiring: 스크립트 실재를 확인 못 하면 부재로 보고하지 않는다", () => {
  const decls = parseAgentHookDecl("PreToolUse Bash x.sh\n");
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "sh scripts/x.sh" }] }] } };
  const f = agentWiringFindings(decls, settings, () => undefined);
  assert.deepEqual(f.scriptMissing, []);
  assert.equal(f.unchecked.length, 1);
});

test("diagnosis-guard: 스펙 실재를 확인 못 하면 missing-spec이 아니라 spec-unchecked다", () => {
  const e = parseDiagnosisMap([{ match: "x", spec: "S.md", mode: "surface", why: "w" }]);
  assert.deepEqual(validateDiagnosisMap(e, () => undefined).map((f) => f.kind), ["spec-unchecked"]);
});

// ── 계약 전수성 — 새 코어가 계약 밖에서 태어나지 못하게 ───────────────────────
// 이 축의 재발 경로는 "새 코어가 boolean 판정기를 받는 것"이다. 목록을 손으로 유지하면
// 다음 코어가 감시 밖에서 태어나므로 **소스에서 찾는다**.
// @covers SPEC-054/FR-004
test("존재 판정기를 주입받는 모든 판정 코어는 could-not-check 통로를 갖는다", () => {
  // **존재·가용성 판정기**로 한정한다. `readStdin` 같은 입력 획득 주입은 대상이 아니다 —
  // 그건 "있는지 모른다"를 낼 자리가 아니고, 넓히면 오탐이 쌓여 계약이 꺼진다.
  const INJECT = /export function \w+\([^)]*\b\w*[Ee]xists\b[^)]*\)/;
  const CHANNEL = /unchecked|could-not-check|unreadable|확인 못 함|unresolved|TRI\.UNKNOWN/;
  const missing = [];
  for (const f of readdirSync(join(TOOLING)).filter((n) => n.endsWith("-lib.mjs"))) {
    const t = readFileSync(join(TOOLING, f), "utf8");
    if (!INJECT.test(t)) continue;
    if (!CHANNEL.test(t)) missing.push(f);
  }
  assert.deepEqual(missing, [], `존재 판정기를 받는데 "검사 못 함" 통로가 없다(읽기 실패가 통과 또는 거짓 위반으로 붕괴한다):\n  ${missing.join("\n  ")}`);
});
