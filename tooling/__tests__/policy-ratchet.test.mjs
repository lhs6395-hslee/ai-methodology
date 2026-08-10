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
// @covers SPEC-027/FR-008
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rankOf, numOf, classifyRatchet, effectiveRatchetPolicy, RATCHETED_POLICIES, RATCHETED_LIMITS } from "../policy-ratchet-lib.mjs";

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

test("RATCHETED_POLICIES: 래칫 자신을 포함(자기포함)하고 자기약화를 먼저 지목한다", () => {
  assert.ok(RATCHETED_POLICIES.includes("frKeyAnchorPolicy"));
  // 감사 A-2: 자기포함이 없으면 `policyRatchetPolicy:"off"` 한 줄로 래칫 전체가 자폭한다.
  assert.ok(RATCHETED_POLICIES.includes("policyRatchetPolicy"));
  assert.equal(RATCHETED_POLICIES[0], "policyRatchetPolicy"); // 자기약화를 먼저 지목
  assert.equal(new Set(RATCHETED_POLICIES).size, RATCHETED_POLICIES.length); // 중복 없음
});

// 실측 계기: 다른 소비 프로젝트에서 FR 12개가 캡(10)을 넘기자 "maxFRsPerSpec을 12로 상향"이
// **권장안**으로 제시됐다. 자를 늘려 재는 것은 위반 해소가 아니라 회피이며, hard→advisory 하향과
// 같은 부류다(방법론 금지: 완화를 권장으로 내세우지 않는다). 캡 초과의 해소는 분할 또는 병합이다.
test("수치 임계 래칫: 상향=완화(위반) · 하향=강화(통과) · 예외 선언은 부채로 표면화", () => {
  const base = { maxFRsPerSpec: 10, maxKeysPerCategoryPerSpec: 7, maxAggregateRootsPerSpec: 1 };
  const up = classifyRatchet(base, { ...base, maxFRsPerSpec: 12 }, []);
  assert.equal(up.violations.length, 1);
  assert.deepEqual(up.violations[0], { knob: "maxFRsPerSpec", from: 10, to: 12, kind: "limit" });
  assert.equal(classifyRatchet(base, { ...base, maxFRsPerSpec: 8 }, []).violations.length, 0); // 강화는 자유
  assert.equal(classifyRatchet(base, base, []).violations.length, 0);
  const exd = classifyRatchet(base, { ...base, maxAggregateRootsPerSpec: 2 }, ["maxAggregateRootsPerSpec"]);
  assert.equal(exd.violations.length, 0);
  assert.equal(exd.allowedDowngrades.length, 1); // 조용히 통과하지 않고 부채로 남는다
  assert.equal(numOf("hard"), null); // 강도 문자열은 수치 판정 대상이 아니다
});

// 캡을 읽는 게이트가 늘어날 때 래칫 등록을 잊는 것이 이 구멍의 재발 경로다.
test("수치 래칫 전수성: 코드가 읽는 max* 임계는 모두 래칫 감시 안에 있어야 한다", () => {
  const srcs = ["../check-spec-cohesion.mjs", "../sdd-config.mjs"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const used = [...new Set([...srcs.matchAll(/\bmax[A-Z][A-Za-z]*\b/g)].map((m) => m[0]))];
  const unwatched = used.filter((k) => !RATCHETED_LIMITS.includes(k));
  assert.deepEqual(unwatched, [],
    `수치 임계가 래칫 밖이면 캡 상향 한 줄로 위반을 회피할 수 있다: ${unwatched.join(", ")}`);
});

// 구조적 불변식 — 개수를 세지 않는다. 숫자를 박아두면 새 강도 knob이 래칫 **밖**에 태어나도
// 테스트는 초록이다(실측: synonymPolicy 등 6종이 hard인 채로 감시 밖에 있었고, `9`를 단정한
// 이 테스트가 그걸 통과시켰다). 그래서 "킷이 실제로 켠 강도 knob"을 진실의 원천으로 삼는다.
test("래칫 전수성: 킷 config의 모든 강도 enum knob은 래칫 감시 안에 있어야 한다", () => {
  const cfg = JSON.parse(readFileSync(new URL("../../sdd.config.json", import.meta.url), "utf8"));
  const STRENGTH = new Set(["off", "silent", "advisory", "warn", "hard", "error"]);
  const unwatched = Object.entries(cfg)
    .filter(([k, v]) => /Policy$/.test(k) && typeof v === "string" && STRENGTH.has(v))
    .map(([k]) => k)
    .filter((k) => !RATCHETED_POLICIES.includes(k));
  assert.deepEqual(unwatched, [],
    `강도 knob이 래칫 밖이면 hard→advisory 한 줄로 위반을 회피할 수 있다: ${unwatched.join(", ")}`);
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
    { policyRatchetPolicy: "off", policyRatchetExceptions: ["policyRatchetPolicy"],
      exemptionRegistry: { policyRatchetExceptions: { policyRatchetPolicy: { kind: "debt", reason: "테스트 픽스처 — 예외 경로 검증용", clearBy: "픽스처 제거 시 함께 사라진다", due: "2026-12-31", acceptor: "테스트" } } } });
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
    assert.match(r.out, /OK — 강도 하향·임계 완화 없음/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 예외 선언된 하향은 통과하되 부채로 표면화(조용한 우회 방지)", () => {
  const root = gitRepo(
    { frKeyAnchorPolicy: "hard" },
    { frKeyAnchorPolicy: "off", policyRatchetPolicy: "hard", policyRatchetExceptions: ["frKeyAnchorPolicy"],
      exemptionRegistry: { policyRatchetExceptions: { frKeyAnchorPolicy: { kind: "debt", reason: "테스트 픽스처 — 예외 경로 검증용", clearBy: "픽스처 제거 시 함께 사라진다", due: "2026-12-31", acceptor: "테스트" } } } });
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

// ── 면제 래칫(SPEC-027 확장) — 면제는 추가되고 아무도 걷어내지 않는다 ──────────
// 실측 제보: 소비 저장소의 게이트 다수가 면제로 무력화돼 있었고, 제보자 자신이 새 게이트를
// 세운 직후 "면제해서 green 만들기"를 반사적으로 선택했다(오너가 막았다).
// **게이트를 세우는 순간이 면제 유혹이 가장 큰 시점**이라 이 래칫이 필요하다.
// @covers SPEC-027/FR-009
import {
  exemptionKnobs, exemptionEntries, exemptionFindings, classifyExemptionRatchet,
  EXEMPTION_KINDS, EXEMPTION_FINDING_TEXT,
} from "../policy-ratchet-lib.mjs";

test("면제 knob은 이름 규약으로 자동 탐지된다 — 손 목록은 새 knob을 놓친다", () => {
  const cfg = { specSyncExemptGlobs: [], policyRatchetExceptions: [], fooExemptBars: [], unrelated: 1 };
  assert.deepEqual(exemptionKnobs(cfg), ["fooExemptBars", "policyRatchetExceptions", "specSyncExemptGlobs"]);
});

test("선언이 있으면 그것이 이긴다 — 자동 탐지는 기본값이지 강제가 아니다", () => {
  assert.deepEqual(exemptionKnobs({ aExempt: [], bException: [] }, ["aExempt"]), ["aExempt"]);
});

test("면제 목록은 배열·객체 둘 다 받는다", () => {
  assert.deepEqual(exemptionEntries(["a", "b"]), ["a", "b"]);
  assert.deepEqual(exemptionEntries({ a: {}, b: {} }), ["a", "b"]);
  assert.deepEqual(exemptionEntries(null), []);
});

test("등록되지 않은 면제는 위반이다 — 넷이 없는 면제는 이월이 아니라 방치다", () => {
  const f = exemptionFindings({ xExemptList: ["a"] }, {});
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "unregistered");
});

test("종류 미선언은 위반이다 — 분류를 강제해야 debt를 boundary로 위장한 흔적이 남는다", () => {
  const f = exemptionFindings({ xExemptList: ["a"] }, { xExemptList: { a: { reason: "그냥" } } });
  assert.equal(f[0].kind, "bad-kind");
  assert.deepEqual([...EXEMPTION_KINDS], ["boundary", "debt"]);
});

test("debt는 4필드 전부 필수다 — 사유·해소조건·기한·위험수용자", () => {
  const f = exemptionFindings({ xExemptList: ["a"] },
    { xExemptList: { a: { kind: "debt", reason: "임시" } } });
  assert.deepEqual(f.map((x) => x.field).sort(), ["acceptor", "clearBy", "due"]);
});

// 구조적 경계에 기한을 요구하면 **거짓 날짜**가 생기고, 거짓 날짜는 날짜 없음보다 나쁘다.
test("boundary는 기한을 요구하지 않는다 — 대신 왜 영구인지를 요구한다", () => {
  const ok = exemptionFindings({ xExemptList: ["a"] },
    { xExemptList: { a: { kind: "boundary", reason: "산문", whyPermanent: "코드 표면이 아니다" } } });
  assert.deepEqual(ok, []);
  const bad = exemptionFindings({ xExemptList: ["a"] },
    { xExemptList: { a: { kind: "boundary", reason: "산문" } } });
  assert.deepEqual(bad.map((x) => x.field), ["whyPermanent"]);
});

test("등록부에만 남은 레코드는 표면화하되 차단하지 않는다 — 부패 신호이지 위반이 아니다", () => {
  const f = exemptionFindings({ xExemptList: [] }, { xExemptList: { gone: { kind: "boundary", reason: "r", whyPermanent: "w" } } });
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "stale-record");
});

test("면제 개수가 늘면 위반이다 — 래칫은 줄어드는 방향만 허용한다", () => {
  const r = classifyExemptionRatchet({ xExemptList: ["a"] }, { xExemptList: ["a", "b"] });
  assert.deepEqual(r.grown, [{ knob: "xExemptList", from: 1, to: 2 }]);
  assert.deepEqual(r.allowedGrowth, []);
});

test("줄어드는 것은 통과다 — 걷어내기가 정상 경로다", () => {
  assert.deepEqual(classifyExemptionRatchet({ xExemptList: ["a", "b"] }, { xExemptList: ["a"] }).grown, []);
});

test("policyRatchetExceptions 선언이 있으면 증가가 부채로 표면화된다 — 조용한 증가가 되지 않는다", () => {
  const r = classifyExemptionRatchet({ xExemptList: ["a"] }, { xExemptList: ["a", "b"] }, null, ["xExemptList"]);
  assert.deepEqual(r.grown, []);
  assert.equal(r.allowedGrowth.length, 1);
});

test("다섯 판정 종류 전부가 사람이 읽는 문장을 갖는다", () => {
  for (const k of ["unregistered", "bad-kind", "missing-field", "stale-record"]) {
    assert.ok(String(EXEMPTION_FINDING_TEXT[k] || "").length > 10, `${k} 문구 없음`);
  }
});

// ── 킷 자기적용 — 등록하는 순간 부채가 드러난다 ──────────────────────────────
test("킷의 면제 전부가 분류·사유를 갖는다(도그푸딩) — 등록이 곧 리뷰다", () => {
  const cfg = JSON.parse(readFileSync(new URL("../../sdd.config.json", import.meta.url).pathname, "utf8"));
  const f = exemptionFindings(cfg, cfg.exemptionRegistry, cfg.exemptionKnobs)
    .filter((x) => x.kind !== "stale-record");
  assert.deepEqual(f, [], `킷 면제에 미등록·형식 위반이 남아 있다:\n${JSON.stringify(f, null, 2)}`);
});
