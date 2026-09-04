// tooling/__tests__/fr-index.test.mjs — FR 조회 인덱스 (SPEC-062 인덱스 증분)
// 오너 요구: 키 방식 O(1) 조회 — "스펙이 많아져도 시간이 오래 걸리면 안 된다".
// 그래서 이 스위트의 핵심 단정은 성능 수치가 아니라 **스펙을 읽지 않았다는 사실**이다
// (수치는 기계마다 흔들리지만 "읽지 않았다"는 결정적으로 증명된다 — 아래 바꿔치기 트릭).
// @covers SPEC-062/FR-007
// @covers SPEC-062/FR-008
// @covers SPEC-062/FR-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../sdd-config.mjs";
import { buildIndex, specDigest, INDEX_REL_PATH, INDEX_SCHEMA_VERSION } from "../gen-fr-index.mjs";

const cfg = loadConfig("/nonexistent");
const GEN = new URL("../gen-fr-index.mjs", import.meta.url).pathname;
const WHERE = new URL("../sdd-where.mjs", import.meta.url).pathname;
const HOOK = new URL("../check-pre-edit.mjs", import.meta.url).pathname;

const SPEC = [
  "# Budget",
  "**Spec**: `SPEC-001`  **Status**: Active",
  "## Functional Requirements (EARS)",
  "- **FR-001** (event): WHEN a request hits **POST /api/budget** (S), THE SYSTEM SHALL create via `createBudget()`.",
  "- **FR-002** (event): WHEN approval is requested, THE SYSTEM SHALL route through `approveBudget()` in `budget-approval.ts`.",
  "## Ownership",
  "- **Entities**: budget",
  "- **Surfaces**: budget-approval.ts",
  "- **Files**: src/app/**",
  "## Change Log",
  "| 2026-09-04 | 초안 | 근거 |",
].join("\n");

function fixture({ code = "export function approveBudget(id) { return id; }\n" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-frindex-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", scanDirs: ["src"], preEditSpecFirstPolicy: "advisory", surfaceFormat: "any",
  }));
  writeFileSync(join(root, "sdd/specs/SPEC-001-budget.md"), SPEC);
  writeFileSync(join(root, "src/app/budget-approval.ts"), code);
  writeFileSync(join(root, "src/app/budget-approval.test.ts"),
    "// @covers SPEC-001/FR-002\nimport './budget-approval.ts';\n");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  git("add", "-A"); git("commit", "-qm", "init"); git("branch", "-M", "main");
  writeFileSync(join(root, "src/app/budget-approval.ts"), code + "// tweak\n"); // 코드만 만진 상태
  return root;
}
function run(script, root, args = []) {
  try { return { code: 0, out: execFileSync("node", [script, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
// mtime을 정수 초로 고정한다. 지문은 `Math.floor(mtimeMs)`를 쓰고 mtime 복원은 부동소수를
// 거치므로(실측: 829.1943 → 828.999) 고정하지 않으면 1ms 흔들려 "낡음"으로 뜬다 — 그 방향의
// 오탐은 운영에서는 안전하지만(재생성 안내), 테스트에서는 결정성을 깬다.
const PINNED = 1_700_000_000;
function pinMtime(abs) { utimesSync(abs, PINNED, PINNED); }

// 스펙 파일의 **내용만** 바꾸고 크기·mtime은 유지한다. 지문이 stat만 보므로 인덱스는 여전히
// "최신"이고, 따라서 조회 결과가 불변이면 그 조회는 스펙을 읽지 않았다는 증거가 된다.
function swapContentKeepingStat(abs, replacement) {
  const size = statSync(abs).size;
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(readFileSync(abs, "utf8")),
    "바꿔치기는 크기가 같아야 지문이 유지된다");
  writeFileSync(abs, replacement);
  pinMtime(abs);
  assert.equal(statSync(abs).size, size);
}

// ── 순수 코어 ──

// FR-007: 지문은 stat만 본다(내용을 읽으면 인덱스의 이득이 그 자리에서 사라진다).
test("specDigest: 경로·크기·mtime만 본다 — 내용이 달라도 stat이 같으면 같은 지문", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-digest-"));
  try {
    const abs = join(root, "SPEC-001-a.md");
    writeFileSync(abs, "AAAA");
    pinMtime(abs);
    const before = specDigest([abs]);
    swapContentKeepingStat(abs, "BBBB");
    assert.equal(specDigest([abs]), before, "내용 변경은 stat 지문에 보이지 않는다(설계된 성질)");

    writeFileSync(abs, "BBBBB"); pinMtime(abs);        // 크기가 변하면 보인다
    assert.notEqual(specDigest([abs]), before);
    assert.match(before, /^sha256:[0-9a-f]{64}$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("specDigest: 입력 순서와 무관하고, 없는 파일은 조용히 건너뛴다", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-digest2-"));
  try {
    const a = join(root, "SPEC-001-a.md"); const b = join(root, "SPEC-002-b.md");
    writeFileSync(a, "x"); writeFileSync(b, "yy");
    assert.equal(specDigest([a, b]), specDigest([b, a]));
    assert.equal(specDigest([a, b, join(root, "gone.md")]), specDigest([a, b]));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("buildIndex: 키→스펙/앵커 FR · 파일 소유 글롭 · FR별 앵커·지목을 미리 담는다", () => {
  const idx = buildIndex({
    specs: [{ specId: "SPEC-001", path: "sdd/specs/SPEC-001-budget.md", text: SPEC }],
    coversIndex: { "SPEC-001/FR-002": ["src/app/budget-approval.test.ts"] },
    fileTests: { "budget-approval.ts": ["src/app/budget-approval.test.ts"] },
    testCovers: { "src/app/budget-approval.test.ts": ["SPEC-001/FR-002"] },
    digest: "sha256:test", cfg,
  });
  assert.equal(idx.schemaVersion, INDEX_SCHEMA_VERSION);
  assert.equal(idx.source.specCount, 1);
  const s = idx.specs["SPEC-001"];
  assert.deepEqual(s.frs.map((f) => f.id), ["FR-001", "FR-002"]);
  assert.match(s.frs[0].line, /^- \*\*FR-001\*\* \(event\):/, "FR 선언 라인 전문을 담아 조회가 스펙을 다시 파싱하지 않는다");
  assert.ok(s.frs[1].impls.some((i) => i.name === "approveBudget"), JSON.stringify(s.frs[1].impls));

  // 키 조회는 소문자 정규화 · Files 글롭은 키가 아니다(DEDUP.md §3).
  assert.deepEqual(idx.keyIndex["budget"], [{ spec: "SPEC-001", frs: [] }]);
  assert.ok(idx.keyIndex["budget-approval.ts"], "Surfaces 키가 색인된다");
  assert.equal(idx.keyIndex["src/app/**"], undefined);
  assert.deepEqual(idx.fileOwners, [{ glob: "src/app/**", spec: "SPEC-001" }]);

  // covers 근거를 조회 시 테스트 재독 없이 재구성할 두 방향이 함께 있어야 한다.
  assert.deepEqual(idx.fileTests["budget-approval.ts"], ["src/app/budget-approval.test.ts"]);
  assert.deepEqual(idx.testCovers["src/app/budget-approval.test.ts"], ["SPEC-001/FR-002"]);
});

// ── 생성기 e2e ──

// FR-007: 생성 모드는 판정이 아니다(SPEC-040 verdict 규율).
test("생성 e2e: 인덱스를 쓰고 SKIPPED(생성 모드)로 선언한다 — 판정 아님", () => {
  const root = fixture();
  try {
    const r = run(GEN, root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /판정: SKIPPED — 생성 모드/);
    assert.match(r.out, /FR 인덱스 생성/);
    const idx = JSON.parse(readFileSync(join(root, INDEX_REL_PATH), "utf8"));
    assert.equal(idx.source.specCount, 1);
    assert.deepEqual(idx.coversIndex["SPEC-001/FR-002"], ["src/app/budget-approval.test.ts"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--check e2e: 최신=통과 · 스펙 변경=낡음(비영) · 미생성은 --if-present에서 SKIPPED", () => {
  const root = fixture();
  try {
    const missing = run(GEN, root, ["--check", "--if-present"]);
    assert.equal(missing.code, 0, missing.out);
    assert.match(missing.out, /판정: SKIPPED/);
    assert.match(missing.out, /FR 인덱스 없음/);

    const hard = run(GEN, root, ["--check"]);           // 플래그 없이는 결손이 실패다
    assert.equal(hard.code, 1, hard.out);

    run(GEN, root);
    const fresh = run(GEN, root, ["--check", "--if-present"]);
    assert.equal(fresh.code, 0, fresh.out);
    assert.match(fresh.out, /FR 인덱스: 최신/);

    // 스펙 집합이 바뀌면(크기 변화) 낡음 — 재생성은 하지 않고 알리기만 한다.
    const before = readFileSync(join(root, INDEX_REL_PATH), "utf8");
    writeFileSync(join(root, "sdd/specs/SPEC-001-budget.md"), `${SPEC}\n- **FR-003** (state): WHILE on, THE SYSTEM SHALL log.\n`);
    const stale = run(GEN, root, ["--check", "--if-present"]);
    assert.equal(stale.code, 1, stale.out);
    assert.match(stale.out, /낡음/);
    assert.match(stale.out, /gen-fr-index\.mjs/);
    assert.equal(readFileSync(join(root, INDEX_REL_PATH), "utf8"), before, "--check는 쓰지 않는다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FR-009: 조회기가 상수·지문을 가져가는 **모듈**이기도 하다 — import만으로 실행부가 돌면
// 조회마다 인덱스를 재생성한다(도그푸딩 실수확). 엔트리 가드의 회귀 테스트.
test("엔트리 가드: import만으로는 아무 IO도 하지 않는다(조회마다 재생성 회귀)", () => {
  const root = fixture();
  try {
    const probe = execFileSync("node", ["-e", `import(${JSON.stringify(GEN)}).then(m => console.log("loaded", m.INDEX_REL_PATH))`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(probe.trim(), `loaded ${INDEX_REL_PATH}`, probe);
    assert.equal(existsSync(join(root, INDEX_REL_PATH)), false, "import이 인덱스를 만들었다 — 가드 회귀");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 인덱스 우선 조회 e2e ──

// FR-008: 최신이면 스펙 파일을 열지 않는다. 증명은 stat 보존 바꿔치기다.
test("조회 e2e: 인덱스가 최신이면 스펙을 읽지 않는다(내용 바꿔치기에도 결과 불변)", () => {
  const root = fixture();
  try {
    pinMtime(join(root, "sdd/specs/SPEC-001-budget.md"));
    run(GEN, root);
    const withIndex = run(WHERE, root, ["src/app/budget-approval.ts"]);
    assert.equal(withIndex.code, 0, withIndex.out);
    assert.match(withIndex.out, /인덱스 사용.*스펙 파일을 읽지 않았다/);
    assert.match(withIndex.out, /SPEC-001\/FR-002/);

    // 스펙 본문을 전부 지우되 크기·mtime은 유지 → 지문은 그대로라 인덱스는 "최신"이다.
    const specAbs = join(root, "sdd/specs/SPEC-001-budget.md");
    swapContentKeepingStat(specAbs, "x".repeat(Buffer.byteLength(SPEC)));
    const after = run(WHERE, root, ["src/app/budget-approval.ts"]);
    assert.equal(after.out, withIndex.out, "스펙을 읽었다면 결과가 달라졌을 것이다");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("조회 e2e: 인덱스 없음·낡음은 조용히 넘기지 않고 알린 뒤 스펙 직접 읽기로 폴백한다", () => {
  const root = fixture();
  try {
    const noIdx = run(WHERE, root, ["src/app/budget-approval.ts"]);
    assert.match(noIdx.out, /⚠ 인덱스 없음/);
    assert.match(noIdx.out, /SPEC-001\/FR-002/, "폴백은 느릴 뿐 답은 같다");

    run(GEN, root);
    writeFileSync(join(root, "sdd/specs/SPEC-001-budget.md"), `${SPEC}\n<!-- 한 줄 추가 -->\n`);
    const staleIdx = run(WHERE, root, ["src/app/budget-approval.ts"]);
    assert.match(staleIdx.out, /⚠ 인덱스가 낡아 스펙을 직접 읽었다/);
    assert.match(staleIdx.out, /gen-fr-index\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("조회 e2e: --key는 인덱스 해시 조회다(인덱스 없으면 그 사실을 말한다)", () => {
  const root = fixture();
  try {
    const before = run(WHERE, root, ["--key", "budget-approval.ts"]);
    assert.match(before.out, /키 조회는 인덱스가 있어야 한다/);

    run(GEN, root);
    const hit = run(WHERE, root, ["--key", "Budget-Approval.TS"]);   // 대소문자 무관
    assert.equal(hit.code, 0, hit.out);
    assert.match(hit.out, /SPEC-001\(sdd\/specs\/SPEC-001-budget\.md\)/);

    const miss = run(WHERE, root, ["--key", "존재하지않는키zzz"]);
    assert.equal(miss.code, 0, miss.out);
    assert.match(miss.out, /어느 스펙도 소유 선언하지 않았다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FR-008: 훅도 같은 인덱스를 쓴다 — 그리고 인덱스는 **답을 바꾸지 않는다**(캐시이므로).
test("훅 e2e: 인덱스 유무와 무관하게 출력이 같다 — 인덱스는 캐시이고 정본이 아니다", () => {
  const root = fixture();
  try {
    const noIdx = run(HOOK, root, ["src/app/budget-approval.ts"]);
    run(GEN, root);
    const withIdx = run(HOOK, root, ["src/app/budget-approval.ts"]);
    assert.match(noIdx.out, /FR 후보 1건 \/ 그 스펙 FR 2건/);
    assert.equal(withIdx.out, noIdx.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// SC-005: 스윕 배선 — R3가 인덱스 드리프트를 알린다.
test("sdd-sync 배선: R3가 gen-fr-index --check --if-present를 돌린다(양판 대상 아님)", async () => {
  const { PY_SUBCOMMAND } = await import("../sdd-sync.mjs");
  assert.equal(typeof PY_SUBCOMMAND["gen-fr-index.mjs"], "object");
  assert.match(PY_SUBCOMMAND["gen-fr-index.mjs"].notAJudge, /생성기/);
  const src = readFileSync(new URL("../sdd-sync.mjs", import.meta.url).pathname, "utf8");
  assert.match(src, /gen-fr-index\.mjs".*"--check", "--if-present"/s);
});
