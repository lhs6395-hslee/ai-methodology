// tooling/__tests__/gate-failure.test.mjs
// 게이트 실패 원장(SPEC-057) — 감시가 아니라 기억이 없다는 실측. 순수 코어 단독 검증.
// @covers SPEC-057/FR-001
// @covers SPEC-057/FR-002
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLedger, makeFailureRecord, classCounts, guardFindings, escalationFindings,
  DEFAULT_GATE_FAILURE_LEDGER, DEFAULT_ESCALATION_THRESHOLD, GUARD_FINDING_TEXT,
} from "../gate-failure-lib.mjs";

test("로컬 세션 상태다 — `.sdd/`(커밋 대상 아님)이지 `sdd/`(채택 선언)가 아니다", () => {
  assert.equal(DEFAULT_GATE_FAILURE_LEDGER, ".sdd/gate-failures.jsonl");
  assert.match(DEFAULT_GATE_FAILURE_LEDGER, /^\.sdd\//);
});

// @covers SPEC-057/FR-003
test("parseLedger: 정상 줄·빈 줄·깨진 줄을 가른다 — 깨진 줄은 조용히 버리지 않는다", () => {
  const raw = [
    JSON.stringify({ gate: "a.mjs", kind: "JUDGED" }),
    "",
    "이건 JSON이 아니다",
    JSON.stringify(["배열도 레코드가 아니다"]),
    JSON.stringify({ gate: "b.mjs", kind: "JUDGED" }),
  ].join("\n");
  const { records, unreadable } = parseLedger(raw);
  assert.equal(records.length, 2);
  assert.equal(unreadable, 2);   // 산문 1줄 + 배열 1줄
});

test("makeFailureRecord: 필드가 없으면 없는 대로 정직하게 null/unknown — 지어내지 않는다", () => {
  const r = makeFailureRecord({ gate: "check-x.mjs", kind: "JUDGED", detail: "위반 1건", exitCode: 1 });
  assert.deepEqual(r, {
    gate: "check-x.mjs", kind: "JUDGED", detail: "위반 1건", exitCode: 1,
    class: null, target: null, ts: null, sessionId: "unknown",
  });
});

test("makeFailureRecord: meta의 class·target을 옮긴다", () => {
  const r = makeFailureRecord({ gate: "check-fr-placement.mjs", kind: "JUDGED", detail: "위반 1건",
    exitCode: 1, meta: { class: "fr-outside-section", target: "sdd/specs/SPEC-001.md" },
    ts: "2026-08-11T00:00:00.000Z", sessionId: "s1" });
  assert.equal(r.class, "fr-outside-section");
  assert.equal(r.target, "sdd/specs/SPEC-001.md");
  assert.equal(r.ts, "2026-08-11T00:00:00.000Z");
  assert.equal(r.sessionId, "s1");
});

test("classCounts: class 없는 레코드는 집계하지 않는다 — 선언 없는 실패는 가시성이지 강제가 아니다", () => {
  const recs = [
    { gate: "check-ownership.mjs", kind: "JUDGED" },        // class 없음
    { gate: "check-fr-placement.mjs", class: "fr-outside-section" },
  ];
  const c = classCounts(recs);
  assert.equal(c.length, 1);
  assert.equal(c[0].gate, "check-fr-placement.mjs");
  assert.equal(c[0].count, 1);
});

test("classCounts: 같은 (gate,class) 반복을 센다 — 실측 그대로 3회", () => {
  const recs = Array.from({ length: 3 }, (_, i) => ({
    gate: "check-fr-placement.mjs", class: "fr-outside-section",
    target: `sdd/specs/SPEC-00${i + 1}.md`, ts: `2026-08-11T0${i}:00:00.000Z`,
  }));
  const [c] = classCounts(recs);
  assert.equal(c.count, 3);
  assert.deepEqual(c.targets, ["sdd/specs/SPEC-001.md", "sdd/specs/SPEC-002.md", "sdd/specs/SPEC-003.md"]);
  assert.equal(c.lastTs, "2026-08-11T02:00:00.000Z");   // 세 ts 중 최댓값(사전순 비교로 충분한 ISO 형식)
});

test("classCounts: 정렬은 count 내림차순, 동률은 gate·class 사전순(결정적)", () => {
  const recs = [
    { gate: "b.mjs", class: "x" }, { gate: "b.mjs", class: "x" },
    { gate: "a.mjs", class: "y" }, { gate: "a.mjs", class: "y" }, { gate: "a.mjs", class: "y" },
    { gate: "a.mjs", class: "x" },
  ];
  const c = classCounts(recs);
  assert.deepEqual(c.map((x) => `${x.gate}/${x.class}:${x.count}`),
    ["a.mjs/y:3", "a.mjs/x:1", "b.mjs/x:2"].sort((a, b) => {
      const [, na] = a.split(":"); const [, nb] = b.split(":");
      return Number(nb) - Number(na);
    }));
  // 명시적으로 기대 순서를 고정한다(위 계산은 자기증명이 아니라 눈으로 검산한 값이어야 한다).
  assert.deepEqual(c.map((x) => `${x.gate}/${x.class}`), ["a.mjs/y", "b.mjs/x", "a.mjs/x"]);
});

test("guardFindings: 4필드 중 하나라도 없으면 incomplete, note 없으면 no-reason(무언의 면제 금지)", () => {
  assert.deepEqual(guardFindings([{ gate: "g", class: "c", guard: "h.mjs" }]),
    [{ kind: "no-reason", at: "g/c" }]);
  assert.deepEqual(guardFindings([{ gate: "g", class: "c" }]),
    [{ kind: "incomplete", at: "g/c" }]);
  assert.deepEqual(guardFindings([{ gate: "g", class: "c", guard: "h.mjs", note: "사유" }]), []);
});

test("guardFindings: 가드 파일 실재를 exists()로 확인한다 — 선언만으로 믿지 않는다", () => {
  const guards = [{ gate: "g", class: "c", guard: "missing.mjs", note: "사유" }];
  assert.deepEqual(guardFindings(guards, () => false), [{ kind: "stale", at: "g/c", guard: "missing.mjs" }]);
  assert.deepEqual(guardFindings(guards, () => true), []);
  // exists 미주입이면 존재 확인을 하지 않는다(순수 코어는 IO를 모른다) — 형식만 본다.
  assert.deepEqual(guardFindings(guards), []);
});

test("escalationFindings: 임계치 이상인데 가드가 없는 그룹만 낸다", () => {
  const counts = [
    { gate: "check-fr-placement.mjs", class: "fr-outside-section", count: 3, targets: [], lastTs: null },
    { gate: "check-ownership.mjs", class: "dup", count: 2, targets: [], lastTs: null },
  ];
  assert.deepEqual(escalationFindings(counts, [], 3).map((c) => c.gate), ["check-fr-placement.mjs"]);
  // 임계치 미만은 몇 번이든 표면화하지 않는다(벌이 아니라 기억이 목적 — 문턱 아래는 정상 소음이다).
  assert.deepEqual(escalationFindings(counts, [], 10), []);
});

test("escalationFindings: 유효한 가드가 등록된 (gate,class)는 임계치를 넘겨도 침묵한다", () => {
  const counts = [{ gate: "check-fr-placement.mjs", class: "fr-outside-section", count: 5, targets: [], lastTs: null }];
  const guards = [{ gate: "check-fr-placement.mjs", class: "fr-outside-section", guard: "check-x.mjs", note: "해소됨" }];
  assert.deepEqual(escalationFindings(counts, guards, 3), []);
});

test("DEFAULT_ESCALATION_THRESHOLD = 3 — 실측 사고(하루 세 번)와 같은 문턱", () => {
  assert.equal(DEFAULT_ESCALATION_THRESHOLD, 3);
});

test("모든 가드 위반 종류에 사람이 읽는 문장이 있다", () => {
  for (const k of ["incomplete", "no-reason", "stale"]) assert.ok(String(GUARD_FINDING_TEXT[k] || "").trim(), k);
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync as _readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClosure } from "../import-wiring-lib.mjs";

const KIT_SRC = (f) => _readFileSync(join(process.cwd(), "tooling", f), "utf8");
const LIBS = importClosure(["check-gate-escalation.mjs"], KIT_SRC);

function fixture(config = {}, ledgerLines = null) {
  const root = mkdtempSync(join(tmpdir(), "sdd-esc-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...config }));
  if (ledgerLines) {
    mkdirSync(join(root, ".sdd"), { recursive: true });
    writeFileSync(join(root, ".sdd/gate-failures.jsonl"), ledgerLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return root;
}
function run(root) {
  const gate = join(root, "scripts", "check-gate-escalation.mjs");
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const REPEATED = Array.from({ length: 3 }, () => ({ gate: "check-fr-placement.mjs", class: "fr-outside-section", target: "sdd/specs/SPEC-001.md" }));

// @covers SPEC-057/FR-004
test("게이트: 임계치 넘은 미가드 클래스를 hard에서 실제로 막는다", () => {
  const root = fixture({ gateFailureEscalationPolicy: "hard" }, REPEATED);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /fr-outside-section/);
    assert.match(r.out, /3회 반복/);
    assert.match(r.out, /gateFailureGuards/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  // advisory는 막지 않는다.
  const adv = fixture({ gateFailureEscalationPolicy: "advisory" }, REPEATED);
  try {
    const r = run(adv);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠/);
  } finally { rmSync(adv, { recursive: true, force: true }); }
});

test("게이트: 등록된 가드가 있으면 침묵 통과한다(hard여도) — 가드 파일이 실재해야 한다", () => {
  const root = fixture({
    gateFailureEscalationPolicy: "hard",
    gateFailureGuards: [{ gate: "check-fr-placement.mjs", class: "fr-outside-section", guard: "scripts/check-gate-escalation.mjs", note: "실재하는 파일이면 통과한다는 것만 확인 — 이 테스트에선 임의의 실재 파일을 가드로 쓴다" }],
  }, REPEATED);
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-057/FR-005
test("게이트: 가드 선언이 불완전하거나(4필드) 사유가 없으면 exit 1 — 조용한 무발화를 만들지 않는다", () => {
  const noReason = fixture({ gateFailureEscalationPolicy: "advisory",
    gateFailureGuards: [{ gate: "g", class: "c", guard: "scripts/check-gate-escalation.mjs" }] }, REPEATED);
  try {
    const r = run(noReason);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /사유/);
  } finally { rmSync(noReason, { recursive: true, force: true }); }
  const staleGuard = fixture({ gateFailureEscalationPolicy: "advisory",
    gateFailureGuards: [{ gate: "g", class: "c", guard: "scripts/does-not-exist.mjs", note: "사유" }] }, REPEATED);
  try {
    const r = run(staleGuard);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /실재하지 않는다/);
  } finally { rmSync(staleGuard, { recursive: true, force: true }); }
});

// @covers SPEC-057/FR-006
test("게이트: 원장이 없으면 INERT — 판정 못 함을 위반으로도 통과로도 말하지 않는다", () => {
  const root = fixture({ gateFailureEscalationPolicy: "hard" });   // ledgerLines 없음
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /원장 없음/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 임계치 미만은 침묵 통과, off는 판정하지 않는다고 선언한다, enum 밖은 exit 1", () => {
  const below = fixture({ gateFailureEscalationPolicy: "hard" }, REPEATED.slice(0, 2));
  try { assert.equal(run(below).code, 0); } finally { rmSync(below, { recursive: true, force: true }); }
  const off = fixture({ gateFailureEscalationPolicy: "off" }, REPEATED);
  try { assert.doesNotMatch(run(off).out, /게이트 실패 에스컬레이션\(/); } finally { rmSync(off, { recursive: true, force: true }); }
  const bad = fixture({ gateFailureEscalationPolicy: "deny" });
  try {
    const r = run(bad);
    assert.equal(r.code, 1);
    assert.match(r.out, /gateFailureEscalationPolicy 값 위반/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});
