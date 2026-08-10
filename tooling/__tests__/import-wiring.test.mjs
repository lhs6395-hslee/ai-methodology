// 배선 무결성 (SPEC-050, R18) — **설치된 게이트가 애초에 로드되는가.**
//
// 실측 제보: `update.md` diff가 공유 lib 27개를 빠뜨려 게이트는 최신·lib은 구판인 부분 동기화가
// 됐고, 소비처는 판정이 아니라 `SyntaxError: … does not provide an export named 'bodyBeforeOwnership'`
// 를 받았다. 파일이 없는 것도 아니어서 배포 폐포 계약(SPEC-004)으로도 안 잡혔다.
// @covers SPEC-050/FR-001
// @covers SPEC-050/FR-002
// @covers SPEC-050/FR-003
// @covers SPEC-050/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localImports, moduleExports, wiringFindings, formatWiringViolation, importClosure, DEFAULT_WIRING_EXTENSIONS,
} from "../import-wiring-lib.mjs";

// ── 코어: import 절 파싱 ─────────────────────────────────────────────────────
test("명명 import는 원본 이름을 대조 대상으로 삼는다 — `a as b`의 b는 이 파일의 지역명이다", () => {
  const r = localImports(`import { parseSection, bodyBeforeOwnership as body } from "./ownership-keys.mjs";`);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].names, ["parseSection", "bodyBeforeOwnership"]);
});

test("패키지 import는 대상이 아니다 — 부분 동기화로 깨지는 것은 저장소 안에서 서로를 가리키는 모듈이다", () => {
  assert.deepEqual(localImports(`import { readFileSync } from "node:fs";\nimport x from "lodash";`), []);
});

test("네임스페이스·기본·부작용 import를 각각 알아본다", () => {
  const r = localImports([
    `import * as ns from "./a.mjs";`,
    `import def from "./b.mjs";`,
    `import "./c.mjs";`,
  ].join("\n"));
  assert.deepEqual(r.map((x) => x.specifier), ["./a.mjs", "./b.mjs", "./c.mjs"]);
  assert.equal(r[0].namespace, true);
  assert.equal(r[1].hasDefault, true);
  assert.deepEqual(r[2].names, []);
});

test("여러 줄에 걸친 import 절도 한 건으로 읽는다 — 킷 게이트가 실제로 그 형태다", () => {
  const r = localImports(`import {\n  parseReceipt, missingGates,\n  DEFAULT_WATCHDOG_RECEIPT,\n} from "./watchdog-lib.mjs";`);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].names, ["parseReceipt", "missingGates", "DEFAULT_WATCHDOG_RECEIPT"]);
});

// 실측: 이 축을 처음 돌렸을 때 **유일한 발견이 import-wiring-lib 자신의 주석**이었다.
// "주석 속 예시는 인용이지 결정이 아니다"(SPEC-044) — 킷의 주석 제거기를 재사용해 닫았다.
test("주석 속 import 예시는 대조 대상이 아니다 — 인용이지 결정이 아니다", () => {
  assert.deepEqual(localImports(`// 부작용 import(\`import "./x.mjs"\`) — 설명용 예시\nimport { a } from "./real.mjs";`)
    .map((x) => x.specifier), ["./real.mjs"]);
});

// ── 코어: export 집합 파싱 ───────────────────────────────────────────────────
test("함수·상수·클래스·중괄호·별칭·기본 export를 모두 집합에 넣는다", () => {
  const ex = moduleExports([
    `export function foo() {}`,
    `export async function bar() {}`,
    `export const BAZ = 1;`,
    `export class Qux {}`,
    // 문장 중간 선언 — `^export`로 앵커하면 놓치고, 놓친 export는 오탐이 된다.
    `const hidden = 2; export { hidden as shown };`,
    `export default foo;`,
  ].join("\n"));
  assert.deepEqual([...ex.names].sort(), ["BAZ", "Qux", "bar", "default", "foo", "shown"].sort());
  assert.deepEqual(ex.unmodeled, []);
});

test("주석 속 export 예시는 유령 export가 되지 않는다 — 그쪽이 거짓 음성이라 더 나쁘다", () => {
  const ex = moduleExports(`// \`export function ghost()\` 꼴을 이렇게 읽는다\nexport function real() {}`);
  assert.deepEqual([...ex.names], ["real"]);
});

test("구조분해 export는 **확인 못 함**으로 자백한다 — 이름을 신뢰할 만하게 뽑을 수 없다", () => {
  const ex = moduleExports(`export const { a, b } = obj;`);
  assert.equal(ex.unmodeled.length, 1);
});

test("로컬 `export * from`은 따라가고, 비-로컬은 확인 못 함이다", () => {
  const local = moduleExports(`export * from "./inner.mjs";`);
  assert.deepEqual(local.starFrom, ["./inner.mjs"]);
  assert.deepEqual(local.unmodeled, []);
  const bare = moduleExports(`export * from "some-package";`);
  assert.deepEqual(bare.starFrom, []);
  assert.equal(bare.unmodeled.length, 1);
});

// ── 코어: 판정 ───────────────────────────────────────────────────────────────
const graphOf = (files) => ({
  read: (k) => (k in files ? { text: files[k] } : null),
  resolve: (_from, spec) => spec.replace(/^\.\//, ""),
});

test("제보의 결함을 잡는다 — 파일은 있는데 요구된 export가 없다(부분 동기화)", () => {
  const { read, resolve } = graphOf({
    "check-spec-consistency.mjs": `import { parseSection, bodyBeforeOwnership } from "./ownership-keys.mjs";`,
    "ownership-keys.mjs": `export function parseSection() {}`,
  });
  const r = wiringFindings(["check-spec-consistency.mjs"], read, resolve);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].kind, "missing-export");
  assert.equal(r.violations[0].name, "bodyBeforeOwnership");
  // 해소 문장이 요약에 들어간다 — 사람이 스택을 읽지 않아도 되는 것이 이 축의 값이다.
  assert.match(formatWiringViolation(r.violations[0]), /부분 동기화/);
});

test("파일 자체가 없으면 다른 갈래다 — 복사 목록 누락(ERR_MODULE_NOT_FOUND)", () => {
  const { read, resolve } = graphOf({ "gate.mjs": `import { x } from "./gone.mjs";` });
  const r = wiringFindings(["gate.mjs"], read, resolve);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].kind, "missing-file");
});

test("전이적으로 걷는다 — 게이트가 직접 import하지 않는 깊은 lib의 구판도 같은 결함이다", () => {
  const { read, resolve } = graphOf({
    "gate.mjs": `import { mid } from "./mid.mjs";`,
    "mid.mjs": `import { deep } from "./deep.mjs";\nexport function mid() {}`,
    "deep.mjs": `export function other() {}`,
  });
  const r = wiringFindings(["gate.mjs"], read, resolve);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].from, "mid.mjs");
  assert.equal(r.violations[0].name, "deep");
});

test("확인 못 함은 위반이 아니다 — 없다고 단정하지 않는다(오탐이 이 축의 사망 원인)", () => {
  const { read, resolve } = graphOf({
    "gate.mjs": `import { maybe } from "./target.mjs";`,
    "target.mjs": `export * from "some-package";`,
  });
  const r = wiringFindings(["gate.mjs"], read, resolve);
  assert.deepEqual(r.violations, []);
  assert.equal(r.unchecked.length, 1);
});

test("로컬 재수출의 합집합을 인정한다 — 재수출된 이름은 실재하는 export다", () => {
  const { read, resolve } = graphOf({
    "gate.mjs": `import { inner } from "./facade.mjs";`,
    "facade.mjs": `export * from "./inner.mjs";`,
    "inner.mjs": `export function inner() {}`,
  });
  assert.deepEqual(wiringFindings(["gate.mjs"], read, resolve).violations, []);
});

test("순환 import에서 멈춘다 — 무한 루프는 게이트를 죽이고 죽은 게이트는 판정하지 않는다", () => {
  const { read, resolve } = graphOf({
    "a.mjs": `import { b } from "./b.mjs";\nexport function a() {}`,
    "b.mjs": `import { a } from "./a.mjs";\nexport function b() {}`,
  });
  assert.deepEqual(wiringFindings(["a.mjs"], read, resolve).violations, []);
});

test("같은 사실은 한 줄이다 — 여러 경로로 도달해도 중복 적재하지 않는다", () => {
  const { read, resolve } = graphOf({
    "g1.mjs": `import { gone } from "./t.mjs";`,
    "g2.mjs": `import { gone } from "./t.mjs";`,
    "t.mjs": `export function here() {}`,
  });
  const r = wiringFindings(["g1.mjs", "g2.mjs"], read, resolve);
  assert.equal(r.violations.length, 2);          // from이 다르므로 두 사실이다
  const same = wiringFindings(["g1.mjs", "g1.mjs"], read, resolve);
  assert.equal(same.violations.length, 1);       // 같은 사실은 한 줄
});

test("확장자 기본값은 킷 선언이다 — 코드에 고정하지 않는다", () => {
  assert.deepEqual([...DEFAULT_WIRING_EXTENSIONS], ["mjs", "js"]);
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
// 픽스처 복사 목록을 **손으로 적지 않는다.** 처음엔 5개를 손으로 적었고 `sdd-config.mjs`가
// 끌어오는 `ownership-keys.mjs`가 빠져 픽스처가 ERR_MODULE_NOT_FOUND로 죽었다 — 이 스레드가
// 고치고 있는 바로 그 드리프트를 테스트가 재연한 것이다. 목록은 폐포에서 계산한다(도그푸딩).
const KIT_SRC = (f) => readFileSync(join(process.cwd(), "tooling", f), "utf8");

function fixture(policy, extras = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-wiring-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", importWiringPolicy: policy, ...extras }));
  for (const f of importClosure(["check-import-wiring.mjs"], KIT_SRC)) {
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  }
  return root;
}
const run = (root) => {
  try {
    const out = execFileSync("node", [join(root, "scripts", "check-import-wiring.mjs")], { cwd: root, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
};

test("게이트가 부분 동기화를 hard에서 **실제로 막는다** — 통과 경로만 관측된 게이트는 미검증이다", () => {
  const root = fixture("hard");
  // 구판 lib을 심는다: 게이트는 최신인데 export 하나가 없다(제보의 형태 그대로).
  writeFileSync(join(root, "scripts", "stale-lib.mjs"), `export function present() {}\n`);
  writeFileSync(join(root, "scripts", "consumer.mjs"), `import { present, absent } from "./stale-lib.mjs";\n`);
  const r = run(root);
  assert.equal(r.code, 1, `hard에서 막지 않았다:\n${r.out}`);
  assert.match(r.out, /absent/);
  assert.match(r.out, /판정: JUDGED/);
});

test("advisory는 막지 않고 표면화한다 — 채택 중 프로젝트를 벽으로 세우지 않는다", () => {
  const root = fixture("advisory");
  writeFileSync(join(root, "scripts", "stale-lib.mjs"), `export function present() {}\n`);
  writeFileSync(join(root, "scripts", "consumer.mjs"), `import { present, absent } from "./stale-lib.mjs";\n`);
  const r = run(root);
  assert.equal(r.code, 0);
  assert.match(r.out, /absent/);
});

test("off는 판정하지 않는다고 선언한다 — clean이 아니다(SPEC-040)", () => {
  const root = fixture("off");
  const r = run(root);
  assert.match(r.out, /판정: OFF/);
});

test("모듈 0건이면 INERT다 — Python 런타임 전용 설치의 0건은 '깨끗함'이 아니다", () => {
  // 확장자 목록을 실재하지 않는 것으로 바꿔 열거 결과를 0건으로 만든다.
  const root = fixture("hard", { importWiringExtensions: ["nosuchext"] });
  const r = run(root);
  assert.match(r.out, /판정: INERT/);
  assert.match(r.out, /볼 것이 없음/);
});

// ── 엔트리 가드 계약 — 깨진 형태의 재유입 금지 ────────────────────────────────
// 킷은 이 결함을 한 번 고쳤는데(check-test-run·check-schema-drift·sdd-sync) 정의가 세 곳에
// 복사됐고, 그 뒤 새로 만든 게이트 3종(R15·R16·R17)이 **깨진 문자열 비교를 다시 도입했다**.
// 규범이 복사되면 네 번째 사본은 규범을 모른다 — 그래서 기계가 금지한다.
// @covers SPEC-040/FR-005
test("어떤 게이트도 문자열 비교 엔트리 가드를 쓰지 않는다 — 비-ASCII 경로에서 조용히 미실행된다", () => {
  const dir = join(process.cwd(), "tooling");
  const offenders = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".mjs")) continue;
    const t = readFileSync(join(dir, f), "utf8");
    // 코드에서만 본다 — 주석 속 설명은 이 규칙의 근거이지 위반이 아니다.
    for (const line of t.split("\n")) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      if (/import\.meta\.url\s*===\s*`file:\/\//.test(line)) offenders.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `문자열 비교 엔트리 가드가 남아 있다:\n  ${offenders.join("\n  ")}\n`
    + "→ `verdict-lib`의 `isMainEntry(import.meta.url)`를 쓰라(realpath 비교).");
});
