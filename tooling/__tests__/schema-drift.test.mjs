// @covers SPEC-022/FR-001
// @covers SPEC-022/FR-002
// @covers SPEC-022/FR-003
// @covers SPEC-022/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaDriftVerdict, MIGRATION_ENUM } from "../schema-drift-lib.mjs";

// ── 순수 판정 코어 ──
test("FR-002: 코드 기대엔 있으나 배포에 없는 컬럼 → 드리프트, hard=exit 1", () => {
  const v = schemaDriftVerdict(["t.a", "t.b", "t.c"], ["t.a", "t.b"], true, "hard");
  assert.deepEqual(v.drift, ["t.c"]);
  assert.equal(v.exit, 1);
  assert.match(v.line, /코드 기대엔 있으나 배포에 없음: t\.c/);
});

test("FR-002: 일치 → 드리프트 없음 exit 0", () => {
  const v = schemaDriftVerdict(["t.a", "t.b"], ["t.a", "t.b", "t.extra"], true, "hard");
  assert.deepEqual(v.drift, []);
  assert.equal(v.exit, 0);
  assert.match(v.line, /드리프트 없음/);
});

test("FR-002: advisory는 드리프트 있어도 exit 0(경고)", () => {
  const v = schemaDriftVerdict(["t.c"], [], true, "advisory");
  assert.deepEqual(v.drift, ["t.c"]);
  assert.equal(v.exit, 0);
  assert.match(v.line, /⚠/);
});

test("FR-003: 조회 실패(ran=false) → 판정 불가, hard=exit 1 / advisory=exit 0", () => {
  assert.equal(schemaDriftVerdict([], [], false, "hard").exit, 1);
  assert.match(schemaDriftVerdict([], [], false, "hard").line, /판정 불가/);
  assert.equal(schemaDriftVerdict([], [], false, "advisory").exit, 0);
});

test("FR-004: enum 밖 정책 → valid=false, exit 1", () => {
  const v = schemaDriftVerdict(["t.a"], [], true, "bogus");
  assert.equal(v.valid, false);
  assert.equal(v.exit, 1);
  assert.match(v.line, /migrationStatePolicy 값 위반/);
  assert.deepEqual(MIGRATION_ENUM, ["advisory", "hard"]);
});

test("결정성: 드리프트 정렬·중복 제거", () => {
  const v = schemaDriftVerdict(["t.z", "t.a", "t.z"], [], true, "hard");
  assert.deepEqual(v.drift, ["t.a", "t.z"]);
});

// ── 게이트 e2e (주입 명령 실행) ──
function runGate(cfg) {
  const root = mkdtempSync(join(tmpdir(), "sdd-schemadrift-"));
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-schema-drift.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("FR-001: manifest 미설정 → no-op exit 0", () => {
  const r = runGate({});
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /미설정.*비활성/);
});

test("게이트 e2e: hard + 배포에 없는 컬럼(주입 명령) → exit 1", () => {
  const r = runGate({
    migrationStatePolicy: "hard",
    schemaDriftManifest: { expected: "printf 't.a\\nt.b\\n'", deployed: "printf 't.a\\n'" },
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /t\.b/);
});

test("게이트 e2e: hard + 일치 → exit 0", () => {
  const r = runGate({
    migrationStatePolicy: "hard",
    schemaDriftManifest: { expected: "printf 't.a\\n'", deployed: "printf 't.a\\nt.b\\n'" },
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /드리프트 없음/);
});
