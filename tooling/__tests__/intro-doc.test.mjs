// 소개 문서 동기(SPEC-045) — 설명이 도구보다 늦으면 그 설명은 거짓이 된다.
// 실측: 규칙표에 R14가 생겼는데 소개 문서는 R13까지였고 아무 게이트도 몰랐다 —
// 문서가 어떤 축에서도 판정 대상이 아니었기 때문이다.
// @covers SPEC-045/FR-001
// @covers SPEC-045/FR-002
// @covers SPEC-045/FR-003
// @covers SPEC-045/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ruleIdsOf, missingRuleIds, citedCounts, countMismatches, companionMissing } from "../intro-doc-lib.mjs";
import { importClosure } from "../import-wiring-lib.mjs";

// 픽스처가 복사할 모듈을 읽는 주입기. 손목록은 반드시 드리프트한다 — 실측: 새 모듈
// 하나(check-outcome-lib.mjs)를 추가하자 손목록을 든 픽스처들이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다(소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");


const TABLE = [
  "| 규칙 | 언제 | 게이트 |",
  "|---|---|---|",
  "| **R1 spec→code** | x | `check-fr-coverage` |",
  "| **R2′ code→runtime** | x | `check-schema-drift` |",
  "| **R14 검증 실행** | x | `check-verification-executed` |",
  "",
  "산문에서 R99를 참고하라고 적어도 그것은 규칙 선언이 아니다.",
].join("\n");

test("규칙 ID는 규칙표 행에서만 뽑는다 — 산문 언급은 선언이 아니다", () => {
  assert.deepEqual(ruleIdsOf(TABLE), ["R1", "R2", "R14"]);   // R2′은 R2 행, R99는 산문
});

test("단어 경계로 대조한다 — R1이 R14에 부분일치하면 '설명돼 있다'가 거짓으로 참이 된다", () => {
  assert.deepEqual(missingRuleIds(["R1", "R14"], ["<p>R14만 설명한다</p>"]), ["R1"]);
  assert.deepEqual(missingRuleIds(["R1", "R14"], ["<p>R1</p>", "<p>R14</p>"]), []);
});

test("인용 수치는 표시한 것만 본다 — 강제로 모든 숫자를 긁으면 버전·연도까지 잡힌다", () => {
  const doc = `버전 2.7 · 규칙 <span data-sdd-count="rules">14</span>종 · 게이트 <span data-sdd-count="gates">20</span>종`;
  assert.deepEqual(citedCounts(doc), [{ key: "rules", cited: 14 }, { key: "gates", cited: 20 }]);
  assert.deepEqual(citedCounts("표시 없는 숫자 42는 대상이 아니다"), []);
});

test("불일치와 미지원 키를 모두 낸다 — 오타난 키가 조용히 '확인됨'으로 읽히지 않게", () => {
  const cites = [{ key: "rules", cited: 13 }, { key: "gates", cited: 20 }, { key: "rulez", cited: 14 }];
  assert.deepEqual(countMismatches(cites, { rules: 14, gates: 20 }), [
    { key: "rules", cited: 13, actual: 14 },
    { key: "rulez", cited: 14, actual: null },
  ]);
});

test("동반 갱신 — 규칙표를 고친 changeset에는 소개 문서가 있어야 한다", () => {
  const docs = ["docs/a.html"];
  assert.equal(companionMissing(new Set(["HARNESS.md"]), "HARNESS.md", docs), true);
  assert.equal(companionMissing(new Set(["HARNESS.md", "docs/a.html"]), "HARNESS.md", docs), false);
  assert.equal(companionMissing(new Set(["tooling/x.mjs"]), "HARNESS.md", docs), false);
  // 스테이징 집합을 모르면 판정하지 않는다 — 모르는 것을 위반으로 말하지 않는다.
  assert.equal(companionMissing(null, "HARNESS.md", docs), false);
});

// ── 게이트 e2e ────────────────────────────────────────────────────────────
// 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
const LIBS = importClosure(["check-intro-doc.mjs"], KIT_SRC);
function repo(files, config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-idoc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of LIBS) cpSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), join(root, "scripts", f));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function run(root) {
  const gate = join(root, "scripts", "check-intro-doc.mjs");
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("introDocs 미선언은 INERT — 대조할 문서가 없는 상태를 '위반 0건'으로 말하지 않는다", () => {
  const root = repo({ "HARNESS.md": TABLE }, {});
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: INERT/);
    assert.match(r.out, /introDocs 미선언/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("선언했는데 없는 문서는 판정 실패 — 경로 오타가 조용한 통과가 되지 않는다", () => {
  const root = repo({ "HARNESS.md": TABLE }, { introDocs: ["docs/gone.html"] });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /선언된 소개 문서 없음/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("규칙 누락은 hard에서 막고 advisory에서 표면화한다 — 실측 재현(R14가 문서에 없던 자리)", () => {
  const files = { "HARNESS.md": TABLE, "docs/intro.html": "<p>R1과 R2를 설명한다</p>" };
  const hard = repo(files, { introDocs: ["docs/intro.html"], introDocPolicy: "hard" });
  try {
    const r = run(hard);
    assert.equal(r.code, 1);
    assert.match(r.out, /규칙 R14가 소개 문서 어디에도 없다/);
  } finally { rmSync(hard, { recursive: true, force: true }); }
  const adv = repo(files, { introDocs: ["docs/intro.html"], introDocPolicy: "advisory" });
  try {
    const r = run(adv);
    assert.equal(r.code, 0, "advisory는 막지 않는다");
    assert.match(r.out, /⚠ 규칙 R14가/);
    assert.match(r.out, /판정: JUDGED — 위반 0건/);
  } finally { rmSync(adv, { recursive: true, force: true }); }
});

test("인용 수치가 낡으면 실제 값을 함께 말한다 — 숫자는 가장 먼저 낡고 가장 늦게 들킨다", () => {
  const root = repo({
    "HARNESS.md": TABLE,
    "docs/intro.html": `<p>R1 R2 R14 — 규칙 <span data-sdd-count="rules">99</span>종</p>`,
  }, { introDocs: ["docs/intro.html"], introDocPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /인용 수치 "rules"가 99인데 실제는 3/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("규칙표 소스가 없으면 INERT — 대조할 축이 없는 것을 '다 맞다'로 세지 않는다", () => {
  const root = repo({ "docs/intro.html": "<p>x</p>" }, { introDocs: ["docs/intro.html"] });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: INERT/);
    assert.match(r.out, /규칙표 소스/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("off는 판정하지 않는다고 선언한다 — clean이 아니다(SPEC-040)", () => {
  const root = repo({ "HARNESS.md": TABLE }, { introDocs: ["docs/x.html"], introDocPolicy: "off" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: OFF/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
