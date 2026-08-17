// 가드 함수 우회 (SPEC-059) — "이 상태 전이는 반드시 이 함수를 거쳐야 한다"는 스펙 문장이
// 코드에서 실제로 강제되는가.
// 실측 제보(소비 프로젝트, 2026-08-17): canTransition()/crossCheckVerdicts()가 dev-done
// 전이의 필수 관문인데, 실제 쓰기 경로(page-notes/route.ts)는 이 함수들을 전혀 호출하지
// 않았다(참조 0건) — 화면에서 직접 상태를 바꾸면 사슬 전체가 조용히 우회된다.
// @covers SPEC-059/FR-004
// @covers SPEC-059/FR-005
// @covers SPEC-059/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInvariantGuards, guardMissingFindings, guardBypassFindings } from "../invariant-guard-lib.mjs";

const GATE = fileURLToPath(new URL("../check-invariant-guard.mjs", import.meta.url));

// ── 순수 코어 ────────────────────────────────────────────────────────────────
test("validateInvariantGuards — guard·guardFile·guardedWriteSurfaces 필수", () => {
  assert.deepEqual(validateInvariantGuards([{ guard: "", guardFile: "g.mjs", guardedWriteSurfaces: ["s.ts"] }]).length, 1);
  assert.deepEqual(validateInvariantGuards([{ guard: "canTransition", guardFile: "", guardedWriteSurfaces: ["s.ts"] }]).length, 1);
  assert.deepEqual(validateInvariantGuards([{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: [] }]).length, 1);
  assert.deepEqual(validateInvariantGuards([{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: ["s.ts"] }]), []);
});

test("guardMissingFindings — guardFile에 가드 정의 자체가 없으면 지목", () => {
  const guards = [{ guard: "canTransition", guardFile: "g.mjs" }];
  assert.deepEqual(guardMissingFindings(guards, () => "export function otherFn() {}"),
    [{ guard: "canTransition", guardFile: "g.mjs", reason: "guardFile에 정의가 없다" }]);
  assert.deepEqual(guardMissingFindings(guards, () => "export function canTransition() {}"), []);
});

test("실측 재현 — 쓰기 표면이 가드를 전혀 참조하지 않으면 우회로 지목한다(참조 0건)", () => {
  const guards = [{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: ["route.ts"] }];
  const { findings } = guardBypassFindings(guards, () => "export async function PATCH() { patch.done = true; }");
  assert.deepEqual(findings, [{ guard: "canTransition", surface: "route.ts", count: 0, reason: "가드 참조 0건" }]);
});

test("가드가 import만 되고 호출되지 않으면(참조 1건) 여전히 우회로 지목한다", () => {
  const guards = [{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: ["route.ts"] }];
  const { findings } = guardBypassFindings(guards, () => 'import { canTransition } from "./g.mjs";\npatch.done = true;');
  assert.deepEqual(findings.length, 1);
  assert.match(findings[0].reason, /호출 흔적이 없다/);
});

test("가드가 import되고 호출되면(참조 2건 이상) 통과", () => {
  const guards = [{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: ["route.ts"] }];
  const { findings } = guardBypassFindings(guards,
    () => 'import { canTransition } from "./g.mjs";\nif (canTransition({record}).ok) patch.done = true;');
  assert.deepEqual(findings, []);
});

test("guardedFieldPattern이 있으면 그 필드를 안 건드리는 표면은 대상 밖이다", () => {
  const guards = [{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: ["unrelated.ts"], guardedFieldPattern: "\\bdone\\b" }];
  const { findings } = guardBypassFindings(guards, () => "export async function GET() { return list(); }");
  assert.deepEqual(findings, [], "done 필드를 안 건드리므로 가드 미참조라도 대상이 아니다");
});

test("표면 파일이 없으면 확인 못 함으로 분리한다 — 부재를 우회로 단정하지 않는다", () => {
  const guards = [{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: ["missing.ts"] }];
  const { findings, unchecked } = guardBypassFindings(guards, () => null);
  assert.deepEqual(findings, []);
  assert.deepEqual(unchecked, [{ guard: "canTransition", surface: "missing.ts", reason: "표면 파일 부재" }]);
});

// ── 게이트 e2e ────────────────────────────────────────────────────────────
function fixture(files, config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-guard-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("invariantGuards 미등록은 INERT — 검사할 가드가 없다는 뜻이지 통과가 아니다", () => {
  const root = fixture({}, { invariantGuardPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: INERT/);
    assert.match(r.out, /미등록/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("실측 재현 — 등록된 가드가 쓰기 표면에서 전혀 호출되지 않으면 hard에서 차단한다", () => {
  const root = fixture({
    "scripts/qa-agent-lib.mjs": "export function canTransition() {}\n",
    "src/route.ts": "export async function PATCH() { patch.done = true; }\n",
  }, {
    invariantGuards: [{ guard: "canTransition", guardFile: "scripts/qa-agent-lib.mjs", guardedWriteSurfaces: ["src/route.ts"] }],
    invariantGuardPolicy: "hard",
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /우회된다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("가드가 실제로 호출되면 통과한다", () => {
  const root = fixture({
    "scripts/qa-agent-lib.mjs": "export function canTransition() {}\n",
    "src/route.ts": 'import { canTransition } from "../scripts/qa-agent-lib.mjs";\nif (canTransition().ok) patch.done = true;\n',
  }, {
    invariantGuards: [{ guard: "canTransition", guardFile: "scripts/qa-agent-lib.mjs", guardedWriteSurfaces: ["src/route.ts"] }],
    invariantGuardPolicy: "hard",
  });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ 등록된 모든 가드가/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("guardFile 자체에 가드 정의가 없으면 그 자체로 위반이다", () => {
  const root = fixture({
    "scripts/qa-agent-lib.mjs": "export function otherFn() {}\n",
    "src/route.ts": "export async function PATCH() {}\n",
  }, {
    invariantGuards: [{ guard: "canTransition", guardFile: "scripts/qa-agent-lib.mjs", guardedWriteSurfaces: ["src/route.ts"] }],
    invariantGuardPolicy: "hard",
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /정의가 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("advisory는 막지 않고 표면화한다", () => {
  const root = fixture({
    "scripts/qa-agent-lib.mjs": "export function canTransition() {}\n",
    "src/route.ts": "export async function PATCH() { patch.done = true; }\n",
  }, { invariantGuards: [{ guard: "canTransition", guardFile: "scripts/qa-agent-lib.mjs", guardedWriteSurfaces: ["src/route.ts"] }] });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /⚠ .*우회된다/);
    assert.match(r.out, /판정: JUDGED — 위반 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("config 문법 위반(빈 guardedWriteSurfaces)은 즉시 차단", () => {
  const root = fixture({}, {
    invariantGuards: [{ guard: "canTransition", guardFile: "g.mjs", guardedWriteSurfaces: [] }],
    invariantGuardPolicy: "hard",
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /guardedWriteSurfaces 1개 이상 필수/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("off는 판정하지 않는다고 선언한다", () => {
  const root = fixture({}, {
    invariantGuards: [{ guard: "x", guardFile: "g.mjs", guardedWriteSurfaces: ["s.ts"] }],
    invariantGuardPolicy: "off",
  });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: OFF/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
