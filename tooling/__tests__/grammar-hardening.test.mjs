// tooling/__tests__/grammar-hardening.test.mjs
// 스펙 문법 규범 강제(SPEC-013) — 순수 코어 + completeness/ownership/spec-sync 게이트 통합.
// @covers SPEC-013/FR-001
// @covers SPEC-013/FR-002
// @covers SPEC-013/FR-003
// @covers SPEC-013/FR-004
// @covers SPEC-013/FR-005
// @covers SPEC-013/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseModule, frLinesMissingShall, dedupReviewDanglingIds, ownershipCategoriesFindings } from "../grammar-lib.mjs";

const FR_DECL_SRC = "\\*\\*((?:FR)-\\d{3}[a-z]?)\\*\\*";
const SPEC_ID_RE = /(?:SPEC|INFRA|TEST)-\d{3}/;

// ── 순수 코어 ──

test("parseModule: 백틱·비백틱·부재", () => {
  assert.equal(parseModule("**Module**: `sdd-tooling`  **Spec**: `SPEC-001`"), "sdd-tooling");
  assert.equal(parseModule("**Module**: mymod\n"), "mymod");
  assert.equal(parseModule("# 제목뿐\n"), null);
});

test("frLinesMissingShall: SHALL 없는 FR 선언 라인만 지목", () => {
  const text = "- **FR-001** (event): WHEN x, THE SYSTEM SHALL y.\n- **FR-002** (event): does y without keyword.\n- **FR-003a** THE SYSTEM SHALL z.\n";
  assert.deepEqual(frLinesMissingShall(text, FR_DECL_SRC), ["FR-002"]);
});

test("dedupReviewDanglingIds: 실재하지 않는 이웃 ID만 정렬 반환·섹션 없으면 빈 배열", () => {
  const text = "## Dedup-Review\n- 이웃 SPEC-001: 비중복\n- 이웃 SPEC-999(삭제됨)·INFRA-042 검토\n\n## Change Log\n";
  assert.deepEqual(dedupReviewDanglingIds(text, SPEC_ID_RE, new Set(["SPEC-001"])), ["INFRA-042", "SPEC-999"]);
  assert.deepEqual(dedupReviewDanglingIds("본문뿐", SPEC_ID_RE, new Set()), []);
});

test("ownershipCategoriesFindings: Files(대소문자 무관) 금지", () => {
  assert.equal(ownershipCategoriesFindings(["Entities", "Surfaces"]).length, 0);
  assert.match(ownershipCategoriesFindings(["Entities", "Files"])[0], /Files.*금지/);
  assert.equal(ownershipCategoriesFindings(["files"]).length, 1);
});

// ── completeness 게이트 통합 ──

function runGate(gate, files, config = {}, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-gram-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  try {
    const out = execFileSync("node", [join(process.cwd(), `tooling/${gate}`), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const FULL = (id, module, fr = "- **FR-001** THE SYSTEM SHALL x.") =>
  `# ${id}\n**Module**: \`${module}\`  **Spec**: \`${id}\`  **Status**: Draft\n${fr}\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n\n## Ownership\n- **Entities**: thing${id.slice(-1)}\n`;

test("completeness: Module 헤더 없음 → warn, --strict → exit 1", () => {
  const spec = `# SPEC-001\n**Spec**: \`SPEC-001\`  **Status**: Draft\n- **FR-001** THE SYSTEM SHALL x.\n- **SC-001**: y.\n\nAcceptance: Given.\n`;
  const soft = runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec });
  assert.equal(soft.code, 0, soft.out);
  assert.match(soft.out, /Module 헤더 없음/);
  assert.equal(runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec }, {}, ["--strict"]).code, 1);
});

test("completeness: Module 값 불일치(1 레포=1 모듈) → warn + 값 나열", () => {
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": FULL("SPEC-001", "mod-a"),
    "sdd/specs/SPEC-002.md": FULL("SPEC-002", "mod-b"),
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 레포 = 1 모듈/);
  assert.match(r.out, /mod-a, mod-b/);
});

test("completeness: SHALL 없는 FR 라인 → warn(FR ID 지목)", () => {
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": FULL("SPEC-001", "m", "- **FR-001** THE SYSTEM SHALL x.\n- **FR-002** just does y."),
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /FR-002.*SHALL 없음/);
  assert.doesNotMatch(r.out, /FR-001.*SHALL 없음/);
});

test("completeness: Dedup-Review의 dangling 이웃 ID → warn", () => {
  const spec = FULL("SPEC-001", "m") + `\n## Dedup-Review\n- 2026-07-06 이웃 SPEC-777: 비중복\n`;
  const r = runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /존재하지 않는 스펙 "SPEC-777"/);
});

test("completeness: 정합 스펙(Module 단일·SHALL·실재 이웃)은 신규 warn 0", () => {
  const a = FULL("SPEC-001", "m") + `\n## Dedup-Review\n- 이웃 SPEC-002: 비중복\n`;
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": a, "sdd/specs/SPEC-002.md": FULL("SPEC-002", "m"),
  });
  assert.equal(r.code, 0, r.out);
  for (const re of [/Module 헤더 없음/, /1 레포 = 1 모듈/, /SHALL 없음/, /존재하지 않는 스펙/]) assert.doesNotMatch(r.out, re);
});

// ── ownership 게이트 통합(Files 카테고리 금지) ──

test("ownership: ownershipCategories에 Files → exit 1", () => {
  const r = runGate("check-ownership.mjs",
    { "sdd/specs/SPEC-001.md": FULL("SPEC-001", "m") },
    { ownershipCategories: ["Entities", "Files"] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Files.*금지/);
});

// ── spec-sync staged: 미지원 glob 문법 hard ──

function repo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-gram-ss-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  for (const f of ["check-spec-sync.mjs", "spec-sync-lib.mjs", "ownership-keys.mjs", "sdd-config.mjs", "lifecycle-lib.mjs", "drift-lib.mjs", "cross-spec-lib.mjs"])
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  return { root, g };
}
const SS_SPEC = (files) => `# SPEC-001\n**Spec**: \`SPEC-001\`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | r |\n`;

function runSync(root, args) {
  try {
    const out = execFileSync("node", [join(root, "scripts/check-spec-sync.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("spec-sync: 미지원 glob 문법(?)은 staged=exit 1 / range=advisory 유지", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SS_SPEC("src/lib/?.ts"));
    writeFileSync(join(root, "src/other.txt"), "x\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/other.txt"), "y\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "chore: touch\n");
    const staged = runSync(root, ["--staged", "--message-file", "msg"]);
    assert.equal(staged.code, 1, staged.out);
    assert.match(staged.out, /미지원 glob 문법/);
    g("commit", "-qm", "c"); g("branch", "-m", "main");
    const range = runSync(root, ["HEAD~1"]);
    assert.equal(range.code, 0, range.out);
    assert.match(range.out, /미지원 glob 문법/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
