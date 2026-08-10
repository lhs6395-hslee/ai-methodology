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
