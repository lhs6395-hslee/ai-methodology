// tooling/__tests__/live-reality.test.mjs — 라이브 대조 (SPEC-032)
// 저장소 밖 진실(IaC state·클러스터 실물·자원 소유권)과의 일치를 주입 어댑터로 판정.
// 자격증명 없는 환경에서 하드 실패 금지 — 실행 실패는 언제나 skipped(reason).
// @covers SPEC-032/FR-001
// @covers SPEC-032/FR-002
// @covers SPEC-032/FR-003
// @covers SPEC-032/FR-004
// @covers SPEC-032/FR-005
// @covers SPEC-032/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateChecks, classifyResult, summarize } from "../live-reality-lib.mjs";

const GATE = new URL("../check-live-reality.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("validateChecks: id·command 필수, id 중복·미지의 kind는 에러", () => {
  assert.deepEqual(validateChecks([{ id: "a", command: "echo", kind: "terraform" }]), []);
  const errs = validateChecks([
    { command: "echo" },                          // id 없음
    { id: "a", command: "echo" }, { id: "a", command: "echo" }, // 중복
    { id: "b" },                                  // command 없음
    { id: "c", command: "echo", kind: "nope" },   // 미지의 kind
  ]);
  assert.equal(errs.length, 4);
  assert.match(errs[0], /id 필요/);
  assert.match(errs[1], /중복/);
  assert.match(errs[2], /command 필요/);
  assert.match(errs[3], /알 수 없는 kind/);
});

test("classifyResult: exit 0 + stdout 줄 = 위반 항목 / 빈 stdout = clean", () => {
  const v = classifyResult({ id: "tf", exitCode: 0, stdout: "module.a\nmodule.b\n" });
  assert.equal(v.status, "violations");
  assert.deepEqual(v.items, ["module.a", "module.b"]);
  assert.equal(classifyResult({ id: "tf", exitCode: 0, stdout: "  \n" }).status, "clean");
});

test("classifyResult: exit≠0은 언제나 skipped(reason) — 위반으로 승격하지 않는다(자격증명 없음)", () => {
  const s = classifyResult({ id: "tf", exitCode: 1, stdout: "", stderr: "Unable to locate credentials\n" });
  assert.equal(s.status, "skipped");
  assert.match(s.reason, /credentials/);
  // stdout에 내용이 있어도 실행 실패면 위반이 아니다(부분 출력 오독 금지)
  assert.equal(classifyResult({ id: "x", exitCode: 2, stdout: "junk\n", stderr: "" }).status, "skipped");
});

test("summarize: clean·violations·skipped·항목 수 집계", () => {
  const s = summarize([
    { status: "violations", items: ["a", "b"] }, { status: "clean", items: [] }, { status: "skipped", items: [] },
  ]);
  assert.deepEqual(s, { clean: 1, violations: 1, skipped: 1, items: 2 });
});

// ── 게이트 e2e ──

function fixture(cfg) {
  const root = mkdtempSync(join(tmpdir(), "sdd-lr-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: off → 판정 안 함 exit 0", () => {
  const root = fixture({});
  try { const r = run(root); assert.equal(r.code, 0); assert.match(r.out, /off \(판정 안 함\)/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: terraform·kubernetes·ownership 위반이 각각 목록으로 출력 + hard exit 1 (수용 기준 3)", () => {
  const root = fixture({ liveRealityPolicy: "hard", liveRealityChecks: [
    { id: "tf", kind: "terraform", label: "state에 없는 선언 모듈", command: "printf 'module.nat_gateway\\nmodule.alb_logs\\n'" },
    { id: "k8s", kind: "kubernetes", label: "라이브와 다른 매니페스트", command: "printf 'cm/grafana-dashboard-overview\\n'" },
    { id: "own", kind: "ownership", label: "무소유 자원", command: "printf 'nat-0abc (ManagedBy=scheduler-lambda)\\n'" },
  ] });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /state에 없는 선언 모듈 \(terraform\) — 2건/);
    assert.match(r.out, /- module\.nat_gateway/);
    assert.match(r.out, /라이브와 다른 매니페스트 \(kubernetes\) — 1건/);
    assert.match(r.out, /무소유 자원 \(ownership\) — 1건/);
    assert.match(r.out, /라이브가 저장소보다 최신이면/); // 회귀 방향 규범(R4)
    assert.match(r.out, /Change Log에 남긴다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 자격증명·바이너리 없음 → 전부 skipped(사유)로 hard에서도 exit 0 (수용 기준 5)", () => {
  const root = fixture({ liveRealityPolicy: "hard", liveRealityChecks: [
    { id: "tf", kind: "terraform", label: "terraform plan", command: "sdd-no-such-binary plan" },
    { id: "aws", kind: "ownership", label: "무소유 자원", command: "sh -c 'echo \"Unable to locate credentials\" >&2; exit 255'" },
  ] });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /skipped 2/);
    assert.match(r.out, /\[skipped\] terraform plan/);
    assert.match(r.out, /Unable to locate credentials/);
    assert.match(r.out, /판정 못 함/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: clean(빈 출력) → OK / advisory는 위반 있어도 exit 0", () => {
  const clean = fixture({ liveRealityPolicy: "hard", liveRealityChecks: [{ id: "a", command: "printf ''" }] });
  try { const r = run(clean); assert.equal(r.code, 0, r.out); assert.match(r.out, /라이브와 일치/); }
  finally { rmSync(clean, { recursive: true, force: true }); }
  const adv = fixture({ liveRealityPolicy: "advisory", liveRealityChecks: [{ id: "a", command: "printf 'x\\n'" }] });
  try { const r = run(adv); assert.equal(r.code, 0, r.out); assert.match(r.out, /⚠/); }
  finally { rmSync(adv, { recursive: true, force: true }); }
});

test("게이트: hard인데 검사 0건 → inert 거짓 안전 차단 / 잘못된 설정·enum 밖 정책 → exit 1", () => {
  const inert = fixture({ liveRealityPolicy: "hard" });
  try { const r = run(inert); assert.equal(r.code, 1, r.out); assert.match(r.out, /판정 불가\(inert\)/); }
  finally { rmSync(inert, { recursive: true, force: true }); }
  const badCfg = fixture({ liveRealityPolicy: "advisory", liveRealityChecks: [{ id: "", command: "" }] });
  try { const r = run(badCfg); assert.equal(r.code, 1); assert.match(r.out, /설정 오류/); }
  finally { rmSync(badCfg, { recursive: true, force: true }); }
  const badPol = fixture({ liveRealityPolicy: "strict" });
  try { const r = run(badPol); assert.equal(r.code, 1); assert.match(r.out, /liveRealityPolicy 값 위반/); }
  finally { rmSync(badPol, { recursive: true, force: true }); }
});
