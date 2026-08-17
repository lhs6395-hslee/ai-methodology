// 진단 진입점 명세 강제 열람 (SPEC-053, R21) — **조사 전에 명세를 보게 한다.**
//
// 실측 제보: 에이전트가 배포 실패 원인을 조사하며 ArgoCD sync 실패를 원인으로 단정해 보고했다.
// 그 문자열은 이미 명세 Edge Case에 있었고, 같은 문서에 소유자 결정("젠킨스에서 바로 배포")이
// 기록돼 있었다. 소유자가 여러 세션에 걸쳐 금지한 경로가 재발했고 **결론까지 틀렸다.**
// 커밋 게이트로는 원리상 불가능하다 — 조회는 커밋도 파일 변경도 남기지 않는다.
// @covers SPEC-053/FR-001
// @covers SPEC-053/FR-002
// @covers SPEC-053/FR-003
// @covers SPEC-053/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDiagnosisMap, validateDiagnosisMap, isSpecRead, judgeCommand, formatGuidance,
  GUARD_MODES, GUARD_FINDING_TEXT, DEFAULT_SPEC_READ_PATTERNS,
} from "../diagnosis-guard-lib.mjs";
import { localImports } from "../import-wiring-lib.mjs";

const RULE = (over = {}) => ({
  match: "kubectl get application", spec: "INFRA-004.md", mode: "deny",
  why: "소유자 결정으로 GitOps를 쓰지 않는다", instead: ["젠킨스 빌드 결과"], ...over,
});

// ── 선언 파싱·검증 ───────────────────────────────────────────────────────────
test("선언은 배열이고 mode 기본은 surface다", () => {
  const e = parseDiagnosisMap([{ match: "x", spec: "S.md" }]);
  assert.equal(e[0].mode, "surface");
  assert.deepEqual([...GUARD_MODES], ["surface", "deny"]);
});

test("이 축의 자기결함은 조용한 무발화다 — 깨진 정규식은 아무것도 막지 않는다", () => {
  const f = validateDiagnosisMap(parseDiagnosisMap([RULE({ match: "[unclosed" })]), () => true);
  assert.equal(f[0].kind, "bad-regex");
});

test("지목한 스펙이 실재하지 않으면 안내가 거짓이 된다", () => {
  const f = validateDiagnosisMap(parseDiagnosisMap([RULE()]), () => false);
  assert.deepEqual(f.map((x) => x.kind), ["missing-spec"]);
});

// 막기만 하면 사람은 우회로를 찾고, 그 우회로는 아무도 모르는 경로가 된다.
test("금지는 **대신 볼 곳**을 반드시 준다 — 우회를 유발하는 강제는 강제가 아니다", () => {
  const f = validateDiagnosisMap(parseDiagnosisMap([RULE({ instead: [] })]), () => true);
  assert.deepEqual(f.map((x) => x.kind), ["deny-without-instead"]);
  // surface는 대안이 없어도 된다(막지 않으므로 우회 유인이 없다)
  assert.deepEqual(validateDiagnosisMap(parseDiagnosisMap([RULE({ mode: "surface", instead: [] })]), () => true), []);
});

test("사유 없는 규칙은 위반이다 — 왜 아닌지 모르면 사람은 규칙을 우회한다", () => {
  const f = validateDiagnosisMap(parseDiagnosisMap([RULE({ why: "" })]), () => true);
  assert.deepEqual(f.map((x) => x.kind), ["no-why"]);
});

test("모든 판정 종류가 사람이 읽는 문장을 갖는다", () => {
  for (const k of Object.keys(GUARD_FINDING_TEXT)) assert.ok(GUARD_FINDING_TEXT[k].length > 10, k);
});

// ── 명세 읽기는 무엇보다 먼저 통과한다 ───────────────────────────────────────
// 명세 읽기를 막으면 "읽어라"면서 읽기를 막는 자기모순이 되고, 그 순간 사람이 훅을 끈다.
test("명세를 읽는 명령은 어떤 규칙보다 먼저 통과한다 — 자기모순 방지", () => {
  const e = parseDiagnosisMap([RULE({ match: "kubectl|grep" })]);
  const r = judgeCommand("grep -n argocd sdd/specs/INFRA-004.md", e);
  assert.equal(r.verdict, "allow");
  assert.equal(r.specRead, true);
});

test("스펙 ID를 지목한 읽기도 통과한다", () => {
  assert.equal(isSpecRead("rg SPEC-036 ."), true);
  assert.equal(isSpecRead("cat sdd/specs/x.md"), true);
});

test("읽기 도구 없이 경로만 있으면 명세 읽기가 아니다 — cat으로 감싸 우회하는 길을 막는다", () => {
  assert.equal(isSpecRead("rm -rf sdd/specs"), false);
  assert.ok(DEFAULT_SPEC_READ_PATTERNS.length >= 2);
});

// ── 판정 ─────────────────────────────────────────────────────────────────────
test("deny가 surface를 이긴다 — 약한 쪽이 이기면 선언을 늘려 강제를 약화시킬 수 있다", () => {
  const e = parseDiagnosisMap([RULE({ match: "kubectl", mode: "surface" }), RULE({ match: "kubectl", mode: "deny" })]);
  assert.equal(judgeCommand("kubectl get application", e).verdict, "deny");
});

test("무관한 명령은 침묵이 정답이다 — 매 명령에 한 줄이 붙으면 사람이 훅을 끈다", () => {
  assert.equal(judgeCommand("npm test", parseDiagnosisMap([RULE()])).verdict, "allow");
  assert.equal(judgeCommand("", parseDiagnosisMap([RULE()])).verdict, "allow");
});

test("안내는 스펙 이름이 아니라 **절 위치**까지 준다 — 이름만 주면 급할 때 안 읽는다", () => {
  const lines = formatGuidance(parseDiagnosisMap([RULE()])[0]);
  assert.match(lines.join("\n"), /Edge Cases/);
  assert.match(lines.join("\n"), /Change Log/);
  assert.match(lines.join("\n"), /대신 볼 곳/);
});

// ── 게이트: 훅 모드 카나리아(제보의 차단 4/4 · 통과 3/3 형태) ─────────────────
function fixture(policy, map) {
  const root = mkdtempSync(join(tmpdir(), "sdd-diag-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", diagnosisGuardPolicy: policy, diagnosisSpecMap: map }));
  writeFileSync(join(root, "sdd", "specs", "INFRA-004.md"), "**Spec**: `INFRA-004`\n## Edge Cases\n- ArgoCD sync 실패\n");
  const seen = new Set(); const stack = ["check-diagnosis-guard.mjs"];
  const TOOLING = fileURLToPath(new URL("..", import.meta.url));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let t; try { t = readFileSync(join(TOOLING, f), "utf8"); } catch { continue; }
    for (const imp of localImports(t)) stack.push(imp.specifier.replace(/^\.\//, ""));
  }
  for (const f of seen) cpSync(join(TOOLING, f), join(root, "scripts", f));
  return root;
}
const hook = (root, command) => {
  try {
    const out = execFileSync("node", [join(root, "scripts", "check-diagnosis-guard.mjs"), "--hook"],
      { cwd: root, encoding: "utf8", input: JSON.stringify({ tool_input: { command } }) });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
};
const sweep = (root) => {
  try { return { code: 0, out: execFileSync("node", [join(root, "scripts", "check-diagnosis-guard.mjs")], { cwd: root, encoding: "utf8", input: "" }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
};
const MAP = [RULE()];

test("훅이 금지된 조회를 exit 2로 막는다 — PreToolUse 규약(비-0이 도구 실행을 막는다)", () => {
  const r = hook(fixture("hard", MAP), "kubectl get application -A");
  assert.equal(r.code, 2, `막지 않았다:\n${r.out}`);
  assert.match(r.out, /INFRA-004/);
  assert.match(r.out, /대신 볼 곳/);
});

test("훅이 명세 읽기는 통과시킨다 — 이 통과가 없으면 축이 자기모순이다", () => {
  const r = hook(fixture("hard", MAP), "grep -n 'kubectl get application' sdd/specs/INFRA-004.md");
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "");
});

test("surface는 막지 않고 위치를 띄운다 — 강제 노출만으로 충분한 경우가 있다", () => {
  const r = hook(fixture("hard", [RULE({ mode: "surface" })]), "kubectl get application");
  assert.equal(r.code, 0);
  assert.match(r.out, /먼저 보라/);
});

test("advisory는 금지도 막지 않는다 — 강도 사다리를 지킨다", () => {
  const r = hook(fixture("advisory", MAP), "kubectl get application");
  assert.equal(r.code, 0);
  assert.match(r.out, /INFRA-004/);
});

test("무관 명령에는 아무 출력도 없다 — 훅 계층은 침묵이 계약이다(SPEC-040)", () => {
  const r = hook(fixture("hard", MAP), "npm test");
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "");
});

// ── 게이트: 스윕 모드(선언 판정) ─────────────────────────────────────────────
test("스윕 모드가 깨진 선언을 hard에서 막는다", () => {
  const r = sweep(fixture("hard", [RULE({ spec: "NOPE.md" })]));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /실재하지 않는다/);
  assert.match(r.out, /판정: JUDGED/);
});

test("스윕 모드는 stdin을 읽지 않는다 — 데이터 없는 파이프에서 블록되면 판정이 통째로 사라진다", () => {
  const root = fixture("hard", MAP);
  const r = execFileSync("node", [join(root, "scripts", "check-diagnosis-guard.mjs")],
    { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 });
  assert.match(r, /판정: JUDGED/);
});

test("선언이 없으면 INERT다 — 무엇에 발화할지 모르는 것을 위반으로 말하지 않는다", () => {
  const r = sweep(fixture("hard", []));
  assert.match(r.out, /판정: INERT/);
  assert.match(r.out, /원리상 볼 수 없는 층/);
});

test("off는 판정하지 않는다고 선언한다", () => {
  assert.match(sweep(fixture("off", MAP)).out, /판정: OFF/);
});

// ── 킷 자기적용 + 층 합성 ────────────────────────────────────────────────────
test("킷이 자기 진단 규칙을 선언하고 있다 — 이 층만 도그푸딩 0이면 다음 결함이 안 보인다", () => {
  const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../../sdd.config.json", import.meta.url)), "utf8"));
  const e = parseDiagnosisMap(cfg.diagnosisSpecMap);
  assert.ok(e.length > 0, "킷이 진단 규칙을 선언하지 않았다");
  assert.deepEqual(validateDiagnosisMap(e, () => true).filter((f) => f.kind !== "missing-spec"), []);
});

// 이 가드는 감시 에이전트 층에 살고, 그 배선의 실재는 R19가 판정한다 — 층이 합성된다.
test("가드가 에이전트 훅 선언에 등재돼 있다 — 배선 실재는 R19가 본다", () => {
  const decl = readFileSync(fileURLToPath(new URL("../harness/agent-hooks.list", import.meta.url)), "utf8");
  assert.match(decl, /sdd-diagnosis-check\.sh/);
});

test("가드 쉘은 검사 못 함을 통과로 출력하지 않는다", () => {
  const sh = readFileSync(fileURLToPath(new URL("../harness/sdd-diagnosis-check.sh", import.meta.url)), "utf8");
  assert.match(sh, /검사 못 함/);
  assert.match(sh, /--hook/);
});
