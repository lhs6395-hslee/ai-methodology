// tooling/__tests__/policy-ratchet.test.mjs — 정책 래칫 (SPEC-027)
// 강제 정책 knob의 강도는 낮출 수 없다(단조 증가만) — hard에서 위반이 떠도 knob을 내려
// 빨간불을 끄는 escape를 봉쇄(실측: frKeyAnchorPolicy hard→advisory "권장").
// @covers SPEC-027/FR-001
// @covers SPEC-027/FR-002
// @covers SPEC-027/FR-003
// @covers SPEC-027/FR-004
// @covers SPEC-027/FR-005
// @covers SPEC-027/FR-006
// @covers SPEC-027/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rankOf, classifyRatchet, effectiveRatchetPolicy, RATCHETED_POLICIES } from "../policy-ratchet-lib.mjs";

const GATE = new URL("../check-policy-ratchet.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("rankOf: off/silent<advisory/warn<hard/error, 미지의 값은 null", () => {
  assert.equal(rankOf("off"), 0);
  assert.equal(rankOf("silent"), 0);
  assert.equal(rankOf("advisory"), 1);
  assert.equal(rankOf("warn"), 1);
  assert.equal(rankOf("hard"), 2);
  assert.equal(rankOf("error"), 2);
  assert.equal(rankOf("bogus"), null);
  assert.equal(rankOf(undefined), null);
});

test("classifyRatchet: 하향만 위반 — 상향·동일·미지 값·base 미존재 knob은 통과", () => {
  const base = { frKeyAnchorPolicy: "hard", capabilityOwnershipPolicy: "advisory", runTestsPolicy: "off" };
  const cur = {
    frKeyAnchorPolicy: "advisory",       // 하향 → 위반
    capabilityOwnershipPolicy: "hard",   // 상향 → 통과
    runTestsPolicy: "off",               // 동일 → 통과
    migrationStatePolicy: "advisory",    // base에 없음 → 판정 밖
  };
  const { violations, allowedDowngrades } = classifyRatchet(base, cur, []);
  assert.deepEqual(violations, [{ knob: "frKeyAnchorPolicy", from: "hard", to: "advisory" }]);
  assert.deepEqual(allowedDowngrades, []);
});

test("classifyRatchet: policyRatchetExceptions에 선언된 하향은 위반 아닌 허용부채로 분리", () => {
  const base = { frKeyAnchorPolicy: "hard", entitySchemaBackingPolicy: "hard" };
  const cur = { frKeyAnchorPolicy: "off", entitySchemaBackingPolicy: "advisory" };
  const { violations, allowedDowngrades } = classifyRatchet(base, cur, ["frKeyAnchorPolicy"]);
  assert.deepEqual(violations, [{ knob: "entitySchemaBackingPolicy", from: "hard", to: "advisory" }]);
  assert.deepEqual(allowedDowngrades, [{ knob: "frKeyAnchorPolicy", from: "hard", to: "off" }]);
});

test("classifyRatchet: 미지의 값(오설정)은 심판하지 않음(FR-006 게이트가 값 검증 담당)", () => {
  const { violations } = classifyRatchet({ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "bogus" }, []);
  assert.deepEqual(violations, []); // rank null → 건너뜀
});

test("RATCHETED_POLICIES: 강제 강도를 갖는 9종 — 래칫 자신을 포함(자기포함)", () => {
  assert.equal(RATCHETED_POLICIES.length, 9);
  assert.ok(RATCHETED_POLICIES.includes("frKeyAnchorPolicy"));
  // 감사 A-2: 자기포함이 없으면 `policyRatchetPolicy:"off"` 한 줄로 래칫 전체가 자폭한다.
  assert.ok(RATCHETED_POLICIES.includes("policyRatchetPolicy"));
  assert.equal(RATCHETED_POLICIES[0], "policyRatchetPolicy"); // 자기약화를 먼저 지목
});

test("effectiveRatchetPolicy: 자기 강도는 base·현재 중 강한 쪽 — 하향은 base가 심판, 상향은 즉시", () => {
  assert.equal(effectiveRatchetPolicy("hard", "off"), "hard");        // 자기약화 → base 시점 강도
  assert.equal(effectiveRatchetPolicy("advisory", "off"), "advisory");
  assert.equal(effectiveRatchetPolicy("off", "hard"), "hard");        // 상향은 즉시 반영
  assert.equal(effectiveRatchetPolicy("off", "off"), "off");          // 켠 적 없는 프로젝트 = 무영향
  assert.equal(effectiveRatchetPolicy("hard", "hard"), "hard");
  assert.equal(effectiveRatchetPolicy("bogus", "off"), "off");        // 미지의 base 값은 판정 밖(현재값)
  assert.equal(effectiveRatchetPolicy(undefined, "advisory"), "advisory");
});

test("classifyRatchet: policyRatchetPolicy 자신의 하향도 위반으로 분류(A-2)", () => {
  const { violations } = classifyRatchet(
    { policyRatchetPolicy: "hard", frKeyAnchorPolicy: "hard" },
    { policyRatchetPolicy: "off", frKeyAnchorPolicy: "off" }, []);
  assert.deepEqual(violations, [
    { knob: "policyRatchetPolicy", from: "hard", to: "off" },
    { knob: "frKeyAnchorPolicy", from: "hard", to: "off" },
  ]);
});

// ── 게이트 e2e (실 git repo — base ref 대비 판정) ──

function gitRepo(baseCfg, curCfg) {
  const root = mkdtempSync(join(tmpdir(), "sdd-ratchet-"));
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify(baseCfg));
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  git(["branch", "-M", "main"]);
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify(curCfg)); // 워킹 트리를 현재 config로
  return root;
}
function run(root, base = "main") {
  try {
    const out = execFileSync("node", [GATE, base], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: base도 off(켠 적 없음) → 판정 안 함 exit 0", () => {
  const root = gitRepo(
    { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "off" },
    { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "off" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /policyRatchetPolicy:off/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── A-2 재현(감사): 자기포함 없으면 한 줄로 래칫 전체가 자폭한다 ──

test("게이트: base hard인데 워킹트리 off 한 줄 → 자폭 불가, base 시점 강도로 판정 exit 1 (A-2)", () => {
  const root = gitRepo(
    { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "hard" },
    { frKeyAnchorPolicy: "off", policyRatchetPolicy: "off" }); // 회피 커밋: 대상 knob + 래칫 자신을 함께 off
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /base 시점 강도/);                              // 자기약화 감지 고지
    assert.match(r.out, /policyRatchetPolicy: hard → off/);             // 자기 하향도 지목
    assert.match(r.out, /frKeyAnchorPolicy: hard → off/);               // 감춰지던 위반이 다시 보인다
    assert.doesNotMatch(r.out, /판정 안 함/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: base advisory(기본) → 워킹트리 off는 advisory로 판정 ⚠ exit 0 (소급 범람 금지)", () => {
  const root = gitRepo({ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "off", policyRatchetPolicy: "off" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /policyRatchetPolicy: advisory → off/);
    assert.match(r.out, /⚠/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 자기 하향도 policyRatchetExceptions로 loud 선언하면 부채 표면화 + exit 0", () => {
  const root = gitRepo(
    { policyRatchetPolicy: "hard" },
    { policyRatchetPolicy: "off", policyRatchetExceptions: ["policyRatchetPolicy"] });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[부채\] policyRatchetPolicy: hard → off/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 상향(off→hard)은 즉시 반영 — 그 실행부터 hard로 판정", () => {
  const root = gitRepo(
    { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "off" },
    { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /frKeyAnchorPolicy: hard → advisory/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: base 조회 불가 + 워킹트리 off → 기존대로 off 고지 exit 0 (하위호환)", () => {
  const root = gitRepo({ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "off", policyRatchetPolicy: "off" });
  try {
    const r = run(root, "no-such-ref");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /policyRatchetPolicy:off/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: hard 하향 → advisory는 ⚠ exit 0 / hard는 ✗ exit 1 (실측 재현)", () => {
  for (const [mode, wantCode] of [["advisory", 0], ["hard", 1]]) {
    const root = gitRepo({ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "advisory", policyRatchetPolicy: mode });
    try {
      const r = run(root);
      assert.equal(r.code, wantCode, `${mode}: ${r.out}`);
      assert.match(r.out, /frKeyAnchorPolicy: hard → advisory/);
      assert.match(r.out, /정책 래칫 위반/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("게이트: 상향·동일 → OK exit 0", () => {
  const root = gitRepo({ frKeyAnchorPolicy: "advisory" }, { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK — 강도 하향 없음/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 예외 선언된 하향은 통과하되 부채로 표면화(조용한 우회 방지)", () => {
  const root = gitRepo(
    { frKeyAnchorPolicy: "hard" },
    { frKeyAnchorPolicy: "off", policyRatchetPolicy: "hard", policyRatchetExceptions: ["frKeyAnchorPolicy"] });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[부채\] frKeyAnchorPolicy: hard → off/);
    assert.match(r.out, /재승격 대상/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: enum 밖 정책 값 → exit 1 (FR-006)", () => {
  const root = gitRepo({ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "hard", policyRatchetPolicy: "strict" });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /policyRatchetPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: base ref 조회 불가(없는 ref) → skip exit 0 (FR-002)", () => {
  const root = gitRepo({ frKeyAnchorPolicy: "hard" }, { frKeyAnchorPolicy: "off", policyRatchetPolicy: "hard" });
  try {
    const r = run(root, "no-such-ref");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /조회 불가|건너뜀/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
