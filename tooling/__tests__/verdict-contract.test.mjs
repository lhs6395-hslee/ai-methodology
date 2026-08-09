// 판정 타입 **계약**의 기계 강제(SPEC-040) — 코어 단위 테스트(verdict.test.mjs)와 다른 축이다.
// 여기서 막는 것: ① 스윕에 등재된 게이트가 타입을 선언하지 않는 것, ② off를 초록으로 세는 것,
// ③ "0건"이 무엇의 0건인지 밝히지 않는 것. 셋 다 실측된 결함이고, 셋 다 규범만으로는 재발했다.
// @covers SPEC-040/FR-002
// @covers SPEC-040/FR-003
// @covers SPEC-040/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateOutcome, tallyGates, tallyLine } from "../sdd-sync.mjs";
import { VERDICT_KINDS, formatVerdict } from "../verdict-lib.mjs";

const HERE = new URL("..", import.meta.url).pathname;
const SYNC_SRC = readFileSync(join(HERE, "sdd-sync.mjs"), "utf8");

// 규칙표에 등재된 게이트 파일 목록 — 소스에서 뽑는다(목록을 손으로 복제하면 그 복제가 다음 드리프트다).
function sweepGates() {
  const block = SYNC_SRC.slice(SYNC_SRC.indexOf("const RULES = ["), SYNC_SRC.indexOf("\n];", SYNC_SRC.indexOf("const RULES = [")));
  return [...new Set([...block.matchAll(/"((?:check|gen)-[a-z-]+\.mjs)"/g)].map((m) => m[1]))];
}

test("스윕 등재 게이트는 전부 판정 타입을 선언한다 — 미배선이 조용한 초록이 되던 자리(SC-003)", () => {
  const missing = [];
  for (const g of sweepGates()) {
    const src = readFileSync(join(HERE, g), "utf8");
    if (!src.includes("armVerdict(")) { missing.push(`${g}: armVerdict 미호출`); continue; }
    if (!/\bverdict\(|\bjudged\(/.test(src)) missing.push(`${g}: verdict()/judged() 호출 없음`);
  }
  assert.deepEqual(missing, [], `판정 타입 미선언 게이트:\n${missing.join("\n")}`);
});

test("스윕 등재 게이트는 훅 계층 좁힘(quietWhenSilent)을 쓸 수 없다 — 선언만으로 집계를 빠져나가지 못하게", () => {
  const abusing = sweepGates().filter((g) => /armVerdict\(\s*\{[^}]*quietWhenSilent/.test(readFileSync(join(HERE, g), "utf8")));
  assert.deepEqual(abusing, [], `스윕 게이트가 침묵 계약을 선언했다: ${abusing.join(", ")}`);
});

test("main-guard가 있는 게이트는 arm을 guard 안에서 한다 — import만 한 프로세스의 stdout을 깨뜨리지 않게", () => {
  // 실측: node --test는 자식 테스트 파일과 **fd 1로 IPC**한다. 게이트를 import한 테스트 파일에서
  // 종료 훅이 fd 1에 판정 줄을 쓰면 러너 프로토콜이 손상된다("Unable to deserialize cloned data").
  // 그래서 엔트리 판정이 있는 게이트는 arm도 그 안이어야 한다.
  const bad = [];
  for (const g of sweepGates()) {
    const src = readFileSync(join(HERE, g), "utf8");
    if (!/isMainEntry|import\.meta\.url ===/.test(src)) continue;   // guard 없는 순수 스크립트는 대상 아님
    const guardAt = src.search(/if \(isMainEntry|if \(import\.meta\.url ===/);
    const armAt = src.indexOf("armVerdict(");
    if (armAt >= 0 && armAt < guardAt) bad.push(g);
  }
  assert.deepEqual(bad, [], `main-guard 밖에서 arm하는 게이트: ${bad.join(", ")}`);
});

test("off는 clean이 아니다 — 실측 결함(R7·R9가 ✓ clean으로 렌더되던 것)의 회귀(SC-002)", () => {
  const r = gateOutcome({
    file: "check-engine-event.mjs",
    stdout: "Engines/Events 게이트 — engineRealityPolicy·eventAttributionPolicy 모두 off (판정 안 함)\n"
      + formatVerdict(VERDICT_KINDS.OFF, "engineRealityPolicy·eventAttributionPolicy") + "\n",
  });
  assert.equal(r.kind, VERDICT_KINDS.OFF);
  assert.equal(r.violation, false);
  assert.equal(r.flagged, false);       // 벽으로 막지는 않는다
  // 그러나 판정으로 세지 않는다 — 이것이 이전 판과 갈리는 지점이다.
  const t = tallyGates([{ gates: [{ kind: r.kind, violation: r.violation }] }]);
  assert.equal(t.judged, 0);
  assert.equal(t.off, 1);
  assert.match(tallyLine(t), /판정 0 · 안 봄 1\(off 1\) · 미판정 0/);
});

test("타입 없는 stdout은 미판정 — 초록 문장이 있어도 통과가 아니다", () => {
  const r = gateOutcome({ file: "x.mjs", stdout: "게이트: OK — 전부 통과\n" });
  assert.equal(r.kind, VERDICT_KINDS.UNTYPED);
  assert.equal(r.flagged, true);
  assert.match(r.summary, /미판정/);
});

test("위반은 판정 안에서만 성립한다 — 안 본 게이트는 위반을 낼 수 없다", () => {
  const inert = gateOutcome({ file: "x.mjs", stdout: "⚠ 뭔가 이상\n" + formatVerdict(VERDICT_KINDS.INERT, "소스 미선언") });
  assert.equal(inert.violation, false, "inert가 위반으로 분류됐다");
  const judged = gateOutcome({ file: "x.mjs", stdout: "⚠ 뭔가 이상\n" + formatVerdict(VERDICT_KINDS.JUDGED, "위반 1건") });
  assert.equal(judged.violation, true);
});

test("집계는 다섯 갈래를 각자 센다 — 요약이 초록의 분모를 밝힌다", () => {
  const t = tallyGates([{ gates: [
    { kind: "JUDGED", violation: false }, { kind: "JUDGED", violation: true },
    { kind: "OFF", violation: false }, { kind: "INERT", violation: false },
    { kind: "SKIPPED", violation: false }, { kind: "UNTYPED", violation: false },
  ] }]);
  assert.deepEqual(t, { total: 6, judged: 2, off: 1, inert: 1, skipped: 1, untyped: 1, violation: 1 });
  assert.match(tallyLine(t), /게이트 6종 = 판정 2 · 안 봄 3\(off 1 · inert 1 · 생략 1\) · 미판정 1/);
});

// ── FR-004: "0건"이 무엇의 0건인지 ──────────────────────────────────────────
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "sdd-vc-"));
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function runDup(root, config) {
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], duplicateLogicPolicy: "advisory", ...config }));
  const GATE = new URL("../check-duplicate-logic.mjs", import.meta.url).pathname;
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("대상 파일 0개면 '중복 없음'이 아니라 '아무것도 안 봤음'이다", () => {
  const root = repo({ "src/a.py": "import re\np = re.compile(r'\\\\s*\\\\(.*\\\\)$')\n" });
  try {
    const r = runDup(root, {});
    assert.match(r.out, /판정: INERT/);
    assert.doesNotMatch(r.out, /판정: JUDGED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("언어 미선언 + 안 본 확장자 잔존 → 부분 판정은 판정이 아니다(킷 기본은 킷의 언어다)", () => {
  const root = repo({ "src/a.mjs": "export const re = /abc/;\n", "src/b.py": "import re\nx = re.compile(r'abcdefgh')\n" });
  try {
    const r = runDup(root, {});
    assert.match(r.out, /판정: INERT — 언어 미선언/);
    assert.match(r.out, /\.py×1/, "안 본 확장자를 지목해야 한다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("언어를 선언하면 판정이 성립한다 — 선언은 책임지는 행위다", () => {
  const root = repo({ "src/a.mjs": "export const re = /abc/;\n", "src/b.py": "import re\nx = re.compile(r'abcdefgh')\n" });
  try {
    const r = runDup(root, { duplicateLiteralFileRegex: ["\\.mjs$"] });
    assert.match(r.out, /판정: JUDGED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
