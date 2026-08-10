// @covers SPEC-004/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { importClosure } from "../import-wiring-lib.mjs";

// 픽스처가 복사할 모듈을 읽는 주입기. 손목록은 반드시 드리프트한다 — 실측: 새 모듈
// 하나(check-outcome-lib.mjs)를 추가하자 손목록을 든 픽스처 5곳이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다(소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");


// 코드 경로 판정은 **config의 scanDirs가 정본이다**(SPEC-051). 이전 판은 쉘이 `src/|lib/|app/`를
// 하드코딩했고, 그래서 이 테스트도 킷 cwd에서 `src/…`가 코드로 읽히는 것에 의존했다 — 실측:
// 킷의 scanDirs는 `tooling`이라 체크리스트가 실제로는 한 번도 발화할 수 없었는데 테스트는 초록이었다.
// 그래서 픽스처가 config를 준다(테스트가 판정 입력을 명시하게 만드는 것이 이 수정의 요점이다).
function fixture(scanDirs) {
  const root = mkdtempSync(join(tmpdir(), "sdd-editchk-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs }));
  // 복사 목록은 **손으로 적지 않는다** — import 폐포에서 계산한다(SPEC-050).
  for (const f of importClosure(["check-pre-edit.mjs"], KIT_SRC))
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  cpSync(join(process.cwd(), "tooling/harness/sdd-edit-check.sh"), join(root, "sdd-edit-check.sh"));
  return root;
}

function run(input, scanDirs = ["src", "lib"]) {
  const root = fixture(scanDirs);
  try {
    return execFileSync("sh", [join(root, "sdd-edit-check.sh")],
      { input: JSON.stringify(input), encoding: "utf8", cwd: root });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// 게이트를 직접 돌린다 — 강도 사다리는 **종료코드**로 판정되므로 stdout 문자열만 보는 `run`으로는
// 관측할 수 없다(그 사각이 정확히 이 라운드에 고친 결함이다: 쉘이 종료코드를 삼켰다).
function runGate(root, rel) {
  const gate = join(root, "scripts", "check-pre-edit.mjs");
  try { return { code: 0, out: execFileSync("node", [gate, rel], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("src 편집이면 체크리스트 출력", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "src/recommend.ts" } });
  assert.match(out, /MODULE_MAP/);
  assert.match(out, /FR/);
  assert.match(out, /PREFIX/);
  assert.match(out, /@covers/);
});

test("중첩 lib 경로도 체크리스트 출력", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "packages/lib/util.ts" } }, ["lib"]);
  assert.match(out, /MODULE_MAP/);
});

test("문서 파일이면 침묵", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "README.md" } });
  assert.equal(out.trim(), "");
});

// @covers SPEC-051/FR-005
test("scanDirs 밖 경로는 체크리스트를 내지 않는다 — 판정 대상은 config가 정한다", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "tooling/x.mjs" } }, ["src"]);
  assert.doesNotMatch(out, /MODULE_MAP/);
});

// @covers SPEC-051/FR-005
test("scanDirs가 `tooling`이면 tooling 경로가 코드다 — 하드코딩된 어휘 밖에서도 발화한다", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "tooling/x.mjs" } }, ["tooling"]);
  assert.match(out, /MODULE_MAP/);
});

// ── 강도 사다리: 편집 시점에 **금지할 수단**이 있어야 한다 ────────────────────
// 이전 판은 `off|advisory`에서 끝나 이 층이 표현할 수 있는 최대치가 경고였다 — 오너가 여러 세션에
// 걸쳐 "명세를 읽지 않고 멋대로 하는 것"을 금지했는데 **경고는 급할 때 가장 먼저 무시된다.**
// @covers SPEC-003/FR-001
test("hard: 소유 스펙 미수정 편집을 **실제로 막는다**(exit 2) — 그리고 대신 갈 길을 준다", () => {
  const root = fixture(["src"]);
  try {
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], preEditSpecFirstPolicy: "hard" }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
      "# S\n**Spec**: `SPEC-001`\n\n## Ownership\n- **Files**: src/**\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");   // 코드만 변경(스펙 미수정)
    const r = runGate(root, "src/a.ts");
    assert.equal(r.code, 2, `PreToolUse 차단은 비-0이어야 한다: ${r.out}`);
    assert.match(r.out, /SPEC-001/);
    // **대신 갈 길**: 어느 절을 고치면 풀리는지 — 막기만 하면 아무도 모르는 우회로를 찾는다.
    assert.match(r.out, /어디:/);
    assert.match(r.out, /Edge Cases/);
    assert.match(r.out, /명세 편집/, "차단을 걷어내는 길이 명세 편집임을 말해야 한다");
    assert.doesNotMatch(r.out, /Spec-Impact: none <사유>[\s\S]*Spec-Impact: none <사유>/, "안내 중복 금지");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hard여도 **판정 못 하는 자리는 막지 않는다** — 거짓 차단은 오탐이고 오탐은 게이트를 끈다", () => {
  const root = fixture(["src"]);
  try {
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], preEditSpecFirstPolicy: "hard" }));
    // git 저장소가 아니다 → 변경 집합을 알 수 없다 → 침묵 통과
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
      "# S\n**Spec**: `SPEC-001`\n\n## Ownership\n- **Files**: src/**\n");
    assert.equal(runGate(root, "src/a.ts").code, 0, "git 없음에서 막으면 거짓 차단이다");
    // 미소유 경로 → 침묵 통과(소유가 없으면 순서를 말할 대상이 없다)
    const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    writeFileSync(join(root, "other.txt"), "x\n");
    g("add", "-A");
    assert.equal(runGate(root, "other.txt").code, 0, "미소유 경로에서 막으면 거짓 차단이다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("정책 enum 밖 값 → exit 1(문법화) — 정의되지 않은 강도를 조용히 advisory로 읽지 않는다", () => {
  const root = fixture(["src"]);
  try {
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], preEditSpecFirstPolicy: "deny" }));
    const r = runGate(root, "src/a.ts");
    assert.equal(r.code, 1);
    assert.match(r.out, /preEditSpecFirstPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("쉘이 차단 종료코드를 전파한다 — 이전 판은 `2>/dev/null`로 삼켜 hard가 도달 불가였다", () => {
  const root = fixture(["src"]);
  try {
    writeFileSync(join(root, "sdd.config.json"),
      JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], preEditSpecFirstPolicy: "hard" }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
      "# S\n**Spec**: `SPEC-001`\n\n## Ownership\n- **Files**: src/**\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
    let code = 0, out = "";
    try {
      out = execFileSync("sh", [join(root, "sdd-edit-check.sh")],
        { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/a.ts" } }),
          encoding: "utf8", cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { code = e.status ?? 1; out = (e.stdout || "") + (e.stderr || ""); }
    assert.equal(code, 2, `쉘이 차단을 전파해야 한다: ${out}`);
    // 체크리스트를 **보여준 뒤** 막는다 — 막으면서 무엇을 하라는지 안 주면 우회로를 찾는다.
    assert.match(out, /MODULE_MAP/, "차단해도 체크리스트는 보여야 한다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
