// 순차 프로세스 SSOT(SPEC-047) — 여러 스펙에 걸친 사슬은 아무도 소유하지 않는다.
// 실측 제보(사례 5): 8단계 close-out 사슬의 조각이 6개 문서에 흩어져 전 구간 문서가 없었고,
// 그 흩어짐이 코드에 그대로 나타났다 — 교차검증 함수가 상대 기록이 없으면 통과했고
// (`if (!peers.length) return { agree: true }`), 양쪽 판정 기록이 만날 저장소가 아예 없었다.
// @covers SPEC-047/FR-001
// @covers SPEC-047/FR-002
// @covers SPEC-047/FR-003
// @covers SPEC-047/FR-004
// @covers SPEC-047/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProcesses, stagesOf, ssotMissingStages, fragmentFindings,
  statelessStageFindings, unownedStateFindings, DEFAULT_STATEFUL_STAGE_MARKERS,
  invariantOf, invariantsOf, validateInvariants, ssotMissingInvariants,
  unenforcedInvariantFindings, staleEnforcementMentionFindings,
} from "../process-ssot-lib.mjs";

import { importClosure } from "../import-wiring-lib.mjs";

// 픽스처가 복사할 모듈을 읽는 주입기. 손목록은 반드시 드리프트한다 — 실측: 새 모듈
// 하나(check-outcome-lib.mjs)를 추가하자 손목록을 든 픽스처들이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다(소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");


// 제보의 실제 사슬.
const CHAIN = ["로컬 실측", "커밋·푸시", "main 머지", "배포", "개발 실측", "교차검증 일치", "dev-done", "리포터 확인"];

test("단계 선언은 문자열과 {name, state} 둘 다 받는다", () => {
  assert.deepEqual(stagesOf({ stages: ["a", { name: "b", state: "s/b.jsonl" }, { name: "" }] }),
    [{ name: "a", state: "" }, { name: "b", state: "s/b.jsonl" }]);
});

test("config 형식은 문법화한다 — 정의되지 않은 형태를 조용히 통과시키지 않는다", () => {
  assert.deepEqual(validateProcesses({ x: { ssot: "", stages: ["a", "b"] } }).length, 1);
  assert.deepEqual(validateProcesses({ x: { ssot: "d.md", stages: ["a"] } }).length, 1, "1단계는 사슬이 아니다");
  assert.deepEqual(validateProcesses({ x: "not an object" }).length, 1);
  assert.deepEqual(validateProcesses({ x: { ssot: "d.md", stages: ["a", "b"] } }), []);
});

test("실측 재현 — SSOT가 전 구간을 담지 않으면 빠진 단계를 지목한다", () => {
  const stages = stagesOf({ stages: CHAIN });
  const partial = "## close-out\n로컬 실측 후 커밋·푸시하고 main 머지한다.\n";
  assert.deepEqual(ssotMissingStages(partial, stages), ["배포", "개발 실측", "교차검증 일치", "dev-done", "리포터 확인"]);
  const whole = "## close-out\n" + CHAIN.join(" → ") + "\n";
  assert.deepEqual(ssotMissingStages(whole, stages), []);
});

test("실측 재현 — 조각을 든 문서는 전체를 가리켜야 한다(6개 문서에 흩어진 자리)", () => {
  const stages = stagesOf({ stages: CHAIN });
  const docs = [
    { path: "SSOT.md", text: CHAIN.join(" → ") },                       // 자기 자신은 대상 아님
    { path: "a.md", text: "로컬 실측과 교차검증 일치를 다룬다" },          // 2단계 보유, 참조 없음 → 걸린다
    { path: "b.md", text: "dev-done과 리포터 확인은 SSOT.md를 따른다" },  // 2단계 보유, 참조 있음 → 통과
    { path: "c.md", text: "배포만 언급한다" },                            // 1단계 → 대상 아님(오탐 방지)
  ];
  assert.deepEqual(fragmentFindings(docs, stages, "SSOT.md"),
    [{ path: "a.md", stages: ["로컬 실측", "교차검증 일치"] }]);
});

test("실측 재현 — 비교·합의 단계는 기록이 만날 저장소를 선언해야 한다", () => {
  // 저장소가 없으면 그 비교는 "상대 기록 없음 → 통과"로 조용히 무행동이 된다.
  assert.deepEqual(statelessStageFindings(stagesOf({ stages: CHAIN })), ["교차검증 일치"]);
  const withState = stagesOf({ stages: [...CHAIN.slice(0, 5), { name: "교차검증 일치", state: ".sdd/measure-runs.jsonl" }, ...CHAIN.slice(6)] });
  assert.deepEqual(statelessStageFindings(withState), []);
});

test("마커는 프로젝트가 갈아끼운다 — 어휘 교체이지 면제가 아니다", () => {
  assert.ok(DEFAULT_STATEFUL_STAGE_MARKERS.includes("교차검증"));
  assert.deepEqual(statelessStageFindings(stagesOf({ stages: ["reconcile step"] })), ["reconcile step"]);
  assert.deepEqual(statelessStageFindings(stagesOf({ stages: ["reconcile step"] }), ["교차검증"]), []);
});

test("선언된 저장소는 소유돼야 한다 — 인프라 산출물이 스펙 밖에 있으면 리뷰에서도 빠진다", () => {
  const stages = stagesOf({ stages: [{ name: "교차검증 일치", state: ".sdd/measure-runs.jsonl" }] });
  assert.deepEqual(unownedStateFindings(stages, () => false),
    [{ stage: "교차검증 일치", state: ".sdd/measure-runs.jsonl" }]);
  assert.deepEqual(unownedStateFindings(stages, () => true), []);
});

// ── 불변식 강제 여부(4번째 축, FR-005) ──────────────────────────────────────
// 실측 근거: CLOSEOUT_FLOW.md의 불변식 F가 "qa-agent가 실측을 완전히 대체하기 전까지 유효한
// 임시 규칙"이라는 문구로 몇 주간 남아 있었다 — 강제 코드가 생긴 뒤에도 문서가 갱신되지
// 않으면 아무도 모른다.
test("불변식 선언은 문자열(강제 없음)과 {name, enforcement} 둘 다 받는다", () => {
  assert.deepEqual(invariantOf("불변식 E"), { name: "불변식 E", enforcement: null });
  assert.deepEqual(invariantOf({ name: "불변식 F", enforcement: "scripts/check-x.mjs" }),
    { name: "불변식 F", enforcement: "scripts/check-x.mjs" });
  assert.deepEqual(invariantOf({ name: "불변식 F", enforcement: null }), { name: "불변식 F", enforcement: null });
  assert.deepEqual(invariantsOf({}), [], "invariants 생략은 완전히 하위호환(검사 대상 0건)");
});

test("불변식 config 문법 — name은 필수, enforcement는 문자열|null만 허용", () => {
  assert.deepEqual(validateInvariants([{ name: "", enforcement: null }]).length, 1, "빈 이름은 규칙 없음과 같다");
  assert.deepEqual(validateInvariants([{ name: "F", enforcement: 42 }]).length, 1, "enforcement는 문자열|null만");
  assert.deepEqual(validateInvariants([{ name: "F", enforcement: "s.mjs" }, "G"]), []);
});

test("실측 재현 — 불변식 이름도 단계처럼 SSOT 문서에 문자 그대로 없으면 지목한다", () => {
  const invs = invariantsOf({ invariants: ["불변식 A", "불변식 F"] });
  assert.deepEqual(ssotMissingInvariants("불변식 A만 적혀 있다", invs), ["불변식 F"]);
  assert.deepEqual(ssotMissingInvariants("불변식 A와 불변식 F 둘 다 있다", invs), []);
});

test("강제한다고 선언했는데 그 파일이 저장소에 없으면 위반 — 강제 주장이 거짓이다", () => {
  const invs = invariantsOf({ invariants: [{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }] });
  assert.deepEqual(unenforcedInvariantFindings(invs, () => false),
    [{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }]);
  assert.deepEqual(unenforcedInvariantFindings(invs, () => true), []);
});

test("enforcement:null(명시적 미강제)은 파일 실재 검사 대상이 아니다 — 허용된 선언이다", () => {
  const invs = invariantsOf({ invariants: [{ name: "불변식 E", enforcement: null }] });
  assert.deepEqual(unenforcedInvariantFindings(invs, () => false), [], "강제한다는 주장 자체가 없으니 파일 부재는 위반이 아니다");
});

test("실측 재현 — 코드는 강제하는데 SSOT 문서 본문이 그 사실을 말하지 않으면 드리프트로 지목", () => {
  const invs = invariantsOf({ invariants: [{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }] });
  assert.deepEqual(staleEnforcementMentionFindings("불변식 F는 임시 규칙이다(강제 코드 언급 없음)", invs),
    [{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }]);
  assert.deepEqual(staleEnforcementMentionFindings("불변식 F는 scripts/check-x.mjs로 코드로 강제됨", invs), []);
});

// ── 게이트 e2e ────────────────────────────────────────────────────────────
// 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
const LIBS = importClosure(["check-process-ssot.mjs"], KIT_SRC);
function repo(files, config) {
  const root = mkdtempSync(join(tmpdir(), "sdd-proc-"));
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
  const gate = join(root, "scripts", "check-process-ssot.mjs");
  try { return { code: 0, out: execFileSync("node", [gate], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("processes 미선언은 INERT — 순차 사슬이 없는 프로젝트에 사슬을 요구하면 거짓 요구다", () => {
  const root = repo({}, {});
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: INERT/);
    assert.match(r.out, /processes 미선언/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("선언했는데 SSOT 문서가 없으면 표면화 — 소유자가 없는 것과 같다", () => {
  const root = repo({}, { processes: { closeout: { ssot: "docs/CLOSEOUT.md", stages: CHAIN } }, processSsotPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /SSOT 문서가 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("전 구간 + 참조 + 소유된 저장소면 통과한다 — 해소는 문서를 합치고 저장소를 소유하는 것", () => {
  const stages = [...CHAIN.slice(0, 5), { name: "교차검증 일치", state: ".sdd/measure-runs.jsonl" }, ...CHAIN.slice(6)];
  const root = repo({
    "docs/CLOSEOUT.md": "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n",
    "sdd/specs/SPEC-001.md": "# S\n**Spec**: `SPEC-001`\n로컬 실측과 교차검증 일치는 docs/CLOSEOUT.md를 따른다.\n"
      + "## Ownership\n- **Entities**: run\n- **Files**: .sdd/**\n",
  }, { processes: { closeout: { ssot: "docs/CLOSEOUT.md", stages } }, processSsotPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ 전 구간이 SSOT에 있고/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("advisory는 막지 않고 표면화한다 — 채택 중 프로젝트를 벽으로 세우지 않는다", () => {
  const root = repo({ "docs/CLOSEOUT.md": "# close-out\n로컬 실측만 적혀 있다\n" },
    { processes: { closeout: { ssot: "docs/CLOSEOUT.md", stages: CHAIN } } });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /⚠ .*전 구간을 담지 않는다/);
    assert.match(r.out, /판정: JUDGED — 위반 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("off는 판정하지 않는다고 선언한다 — clean이 아니다(SPEC-040)", () => {
  const root = repo({}, { processes: { x: { ssot: "a.md", stages: ["a", "b"] } }, processSsotPolicy: "off" });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /판정: OFF/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 게이트 e2e — 불변식 강제 여부(4번째 축, FR-005) ─────────────────────────
const INVARIANT_STAGES = [...CHAIN.slice(0, 5), { name: "교차검증 일치", state: ".sdd/measure-runs.jsonl" }, ...CHAIN.slice(6)];
const INVARIANT_OWNER = "sdd/specs/SPEC-001.md";
function invariantRepo(invariants, ssotBody, extra = {}) {
  return repo({
    "docs/CLOSEOUT.md": ssotBody,
    [INVARIANT_OWNER]: "# S\n**Spec**: `SPEC-001`\n로컬 실측과 교차검증 일치는 docs/CLOSEOUT.md를 따른다.\n"
      + "## Ownership\n- **Entities**: run\n- **Files**: .sdd/**\n",
  }, { processes: { closeout: { ssot: "docs/CLOSEOUT.md", stages: INVARIANT_STAGES, invariants } }, processSsotPolicy: "hard", ...extra });
}

test("불변식이 강제된다고 선언했는데 그 파일이 저장소에 없으면 hard에서 차단", () => {
  const root = invariantRepo([{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }],
    "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n불변식 F는 scripts/check-x.mjs로 강제된다.\n");
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /불변식 "불변식 F".*그 파일이 저장소에 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("코드는 강제하는데 SSOT 문서가 그 사실을 말하지 않으면(드리프트) hard에서 차단", () => {
  const root = invariantRepo([{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }],
    "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n불변식 F는 임시 규칙이다.\n");
  writeFileSync(join(root, "scripts", "check-x.mjs"), "// 존재 확인용\n");
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /SSOT.*본문은.*그 사실을 말하지 않는다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("불변식 이름이 SSOT 문서에 없으면 hard에서 차단(단계와 동일 원칙)", () => {
  const root = invariantRepo([{ name: "불변식 F", enforcement: null }],
    "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n");
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /선언된 불변식을 담지 않는다.*불변식 F/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("강제 파일 실재 + 문서 자기언급 + 이름 등장이면 통과 — 불변식이 있어도 사슬은 green", () => {
  const root = invariantRepo([{ name: "불변식 F", enforcement: "scripts/check-x.mjs" }],
    "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n"
    + "불변식 F는 scripts/check-x.mjs로 코드로 강제된다.\n");
  writeFileSync(join(root, "scripts", "check-x.mjs"), "// 존재 확인용\n");
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /불변식 1건\(강제 1건 · 명시적 미강제 0건\)/);
    assert.match(r.out, /✓ 전 구간이 SSOT에 있고.*불변식은 강제되거나 명시적으로 미강제다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("enforcement:null(명시적 미강제)은 강제 파일 부재로 걸리지 않는다 — 모든 불변식이 코드일 필요는 없다", () => {
  const root = invariantRepo([{ name: "불변식 E", enforcement: null }],
    "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n불변식 E는 리포터 전용이다(수동 절차).\n");
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /불변식 1건\(강제 0건 · 명시적 미강제 1건\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("invariants 생략은 완전히 하위호환 — 기존 3축 판정에 영향 없다", () => {
  const root = repo({
    "docs/CLOSEOUT.md": "# close-out\n" + CHAIN.join(" → ") + "\n저장소: .sdd/measure-runs.jsonl\n",
    [INVARIANT_OWNER]: "# S\n**Spec**: `SPEC-001`\n로컬 실측과 교차검증 일치는 docs/CLOSEOUT.md를 따른다.\n"
      + "## Ownership\n- **Entities**: run\n- **Files**: .sdd/**\n",
  }, { processes: { closeout: { ssot: "docs/CLOSEOUT.md", stages: INVARIANT_STAGES } }, processSsotPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /불변식 0건\(강제 0건 · 명시적 미강제 0건\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("불변식 config 문법 위반(빈 이름)은 문법 오류로 즉시 차단", () => {
  const root = repo({}, { processes: { closeout: { ssot: "docs/CLOSEOUT.md", stages: CHAIN, invariants: [{ name: "", enforcement: null }] } }, processSsotPolicy: "hard" });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /name 필수/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
