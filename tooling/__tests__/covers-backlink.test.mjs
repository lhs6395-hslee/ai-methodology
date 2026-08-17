// tooling/__tests__/covers-backlink.test.mjs — @covers 양방향 결속 (SPEC-039)
// 실측 제보(operations-dashboard 2026-08-03/04): 테스트가 없는 FR-085를 태깅해 R1이 정확히 잡았는데,
// **다른 세션이 무관한 기능**(승인 화면 메일주소 필드)을 FR-085로 착지시킨 순간 위반이 사라지고
// 초록이 됐다. 태그는 returnTo 안전성 테스트를, FR-085는 메일주소 필드를 말하는데 회계는
// "FR-085는 unit으로 커버됨"이라고 보고한다. **번호가 겹치기만 하면 통과한다** — 실재는 동일성이 아니다.
// @covers SPEC-039/FR-001
// @covers SPEC-039/FR-002
// @covers SPEC-039/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evidencePathsOf, coversBacklinkFindings, coversBacklinkVerdict } from "../covers-backlink-lib.mjs";
import { compileGlob } from "../spec-sync-lib.mjs";

const GATE = fileURLToPath(new URL("../check-fr-coverage.mjs", import.meta.url));
const TAG = "// @cov" + "ers ";   // 자기 게이트 스캔 중화
const matcher = (p, path) => { try { return compileGlob(p).test(path); } catch { return false; } };

// ── 순수 코어 ──

test("evidencePathsOf: 경로 목록만 · [미확인]·서술형·코드 스팬은 경로 없음", () => {
  assert.deepEqual(evidencePathsOf("- **FR-001** x. [검증: src/a.test.ts]"), ["src/a.test.ts"]);
  assert.deepEqual(evidencePathsOf("- **FR-002** x. [검증: tests/e2e/**, src/b.test.ts]"),
    ["tests/e2e/**", "src/b.test.ts"]);
  assert.deepEqual(evidencePathsOf("- **FR-003** x. [미확인]"), []);
  assert.deepEqual(evidencePathsOf("- **FR-004** x. [검증 — 코드 실측]"), []);
  // 문법을 설명하는 스펙이 자기 예시로 걸리면 안 된다(SPEC-031 동형)
  assert.deepEqual(evidencePathsOf("- **FR-005** 형식은 `[검증: 경로]`다."), []);
});

test("coversBacklinkFindings(실측 재현): 번호는 맞지만 FR이 그 파일을 인정하지 않으면 불일치", () => {
  const declared = new Set(["SPEC-003/FR-085"]);
  // 다른 세션이 FR-085를 메일주소 필드로 착지시키며 그 검증 경로를 적었다
  const evidence = new Map([["SPEC-003/FR-085", ["src/app/approve/__tests__/email-field.test.ts"]]]);
  const tags = [{ file: "src/app/verify-2fa/_lib/__tests__/return-to.test.ts", specId: "SPEC-003", frId: "FR-085" }];
  const { findings, counts } = coversBacklinkFindings(tags, evidence, declared, matcher);
  assert.deepEqual(counts, { matched: 0, mismatch: 1, unlabeled: 0 });
  assert.equal(findings[0].kind, "mismatch");
  assert.deepEqual(findings[0].evidence, ["src/app/approve/__tests__/email-field.test.ts"]);
});

test("coversBacklinkFindings: 정확 일치·글롭·디렉토리 지목은 통과 / FR에 태그 없으면 미표기(위반 아님)", () => {
  const declared = new Set(["S-001/FR-001", "S-001/FR-002", "S-001/FR-003", "S-001/FR-004"]);
  const evidence = new Map([
    ["S-001/FR-001", ["src/a.test.ts"]],
    ["S-001/FR-002", ["tests/e2e/**"]],
    ["S-001/FR-003", ["tests/unit"]],          // 디렉토리 지목 — 그 아래 전부 인정(SPEC-031과 같은 폭)
  ]);                                           // FR-004는 검증 표기 없음
  const tags = [
    { file: "src/a.test.ts", specId: "S-001", frId: "FR-001" },
    { file: "tests/e2e/login.e2e.ts", specId: "S-001", frId: "FR-002" },
    { file: "tests/unit/deep/x.test.ts", specId: "S-001", frId: "FR-003" },
    { file: "src/z.test.ts", specId: "S-001", frId: "FR-004" },
  ];
  const { counts } = coversBacklinkFindings(tags, evidence, declared, matcher);
  assert.deepEqual(counts, { matched: 3, mismatch: 0, unlabeled: 1 });
});

test("coversBacklinkFindings: 실재하지 않는 FR은 R1의 몫이라 여기서 세지 않는다(이중 판정 금지)", () => {
  const { counts } = coversBacklinkFindings(
    [{ file: "a.test.ts", specId: "S-001", frId: "FR-999" }], new Map(), new Set(["S-001/FR-001"]), matcher);
  assert.deepEqual(counts, { matched: 0, mismatch: 0, unlabeled: 0 });
});

test("coversBacklinkVerdict: mismatch만 차단 · 미표기는 어떤 강도에서도 비차단", () => {
  assert.equal(coversBacklinkVerdict("off", { mismatch: 5 }).judged, false);
  assert.equal(coversBacklinkVerdict("advisory", { mismatch: 5 }).blocking, false);
  assert.equal(coversBacklinkVerdict("hard", { mismatch: 1 }).blocking, true);
  // 표기 부채가 본 신호를 덮으면 사람이 정책을 끈다
  assert.equal(coversBacklinkVerdict("hard", { mismatch: 0, unlabeled: 283 }).blocking, false);
});

// ── 게이트 e2e (실측 재현) ──

function fixture(cfg, frLine, testTag) {
  const root = mkdtempSync(join(tmpdir(), "sdd-bl-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...cfg }));
  writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
    `**Spec**: \`SPEC-001\`\n## Functional Requirements (EARS)\n${frLine}\n`);
  writeFileSync(join(root, "src/return-to.test.mjs"), `${TAG}${testTag}\nexpect(1).toBe(1);\n`);
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
// 다른 세션이 무관한 기능을 같은 번호로 착지시킨 상태 — 번호는 실재하므로 R1은 침묵한다.
const COLLIDED = "- **FR-001** (event): WHEN an approver opens the screen, THE SYSTEM SHALL show the email field. [검증: src/email-field.test.mjs]";

test("게이트 e2e(실측 재현): off → 판정 안 함 / advisory ⚠ exit 0 / hard ✗ exit 1", () => {
  const off = fixture({ coversBacklinkPolicy: "off" }, COLLIDED, "SPEC-001/FR-001");
  const adv = fixture({}, COLLIDED, "SPEC-001/FR-001");
  const hard = fixture({ coversBacklinkPolicy: "hard" }, COLLIDED, "SPEC-001/FR-001");
  const bad = fixture({ coversBacklinkPolicy: "warn" }, COLLIDED, "SPEC-001/FR-001");
  try {
    const o = run(off);
    assert.doesNotMatch(o.out, /@covers 결속/);
    assert.doesNotMatch(o.out, /번호 충돌 의심/);       // off면 이 축은 침묵(R1은 여전히 통과 — 번호가 실재하므로)

    const a = run(adv);
    assert.equal(a.code, 0);
    assert.match(a.out, /번호 충돌 의심/);
    assert.match(a.out, /return-to\.test\.mjs/);
    assert.match(a.out, /email-field\.test\.mjs/);      // FR이 인정하는 증거를 함께 보여준다
    assert.match(a.out, /불일치 1/);

    const h = run(hard);
    assert.equal(h.code, 1);
    assert.match(h.out, /번호 충돌 의심/);

    assert.equal(run(bad).code, 1);
    assert.match(run(bad).out, /coversBacklinkPolicy 값 위반/);
  } finally { for (const r of [off, adv, hard, bad]) rmSync(r, { recursive: true, force: true }); }
});

test("게이트 e2e: FR이 그 테스트를 인정하면 통과 / 검증 표기 없으면 미표기 버킷(hard에서도 통과)", () => {
  const ok = fixture({ coversBacklinkPolicy: "hard" },
    "- **FR-001** (event): WHEN x, THE SYSTEM SHALL y. [검증: src/return-to.test.mjs]", "SPEC-001/FR-001");
  const unl = fixture({ coversBacklinkPolicy: "hard" },
    "- **FR-001** (event): WHEN x, THE SYSTEM SHALL y.", "SPEC-001/FR-001");
  try {
    const r = run(ok);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /일치 1/);
    assert.match(r.out, /결속 불일치 0건/);

    const u = run(unl);
    assert.equal(u.code, 0, "표기 부채는 어떤 강도에서도 차단하지 않는다");
    assert.match(u.out, /미표기 1건\(부채·비차단\)/);
    assert.match(u.out, /대조할 축이 없다/);
  } finally { for (const x of [ok, unl]) rmSync(x, { recursive: true, force: true }); }
});

test("게이트 e2e: 헤더가 버킷 합과 맞는다 — 재태깅분이 사라진 것처럼 보이면 그게 조용한 누락이다", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-bl2-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  try {
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
      "**Spec**: `SPEC-001`\n## Functional Requirements (EARS)\n- **FR-001** (event): WHEN x, THE SYSTEM SHALL y. [검증: src/a.test.mjs]\n");
    // 같은 파일이 같은 FR을 두 번 태깅 — 총량 2, 판정 1
    writeFileSync(join(root, "src/a.test.mjs"), `${TAG}SPEC-001/FR-001\n${TAG}SPEC-001/FR-001\nexpect(1).toBe(1);\n`);
    const r = run(root);
    assert.match(r.out, /태그 2건 → 판정 1건\(같은 파일이 같은 FR을 재태깅한 1건은 1건으로 셈\)/);
    assert.match(r.out, /일치 1·불일치 0·미표기 0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
