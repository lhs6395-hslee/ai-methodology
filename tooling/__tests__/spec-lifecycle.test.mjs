// tooling/__tests__/spec-lifecycle.test.mjs
// 스펙 수명주기(SPEC-008): Status enum 문법화 + Reviewed 이상 리뷰 기록(Review Log·
// Dedup-Review) 존재 검사(completeness) + Draft 스펙 소유 코드 차단(spec-sync).
// 원칙: 시간 순서가 아니라 상태 순서 강제 · Status 없는 레거시는 warn만(점진 도입).
// @covers SPEC-008/FR-001
// @covers SPEC-008/FR-002
// @covers SPEC-008/FR-003
// @covers SPEC-008/FR-004
// @covers SPEC-008/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPLETENESS = new URL("../check-spec-completeness.mjs", import.meta.url).pathname;
const SPECSYNC = new URL("../check-spec-sync.mjs", import.meta.url).pathname;

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "sdd-lc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], testFileRegex: ["\\.test\\.mjs$"] }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function run(bin, root, args = []) {
  try {
    const out = execFileSync("node", [bin, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// 완비 스펙 조각(수명주기 기록 포함) — Status만 갈아끼움.
const full = (status, extra = "") =>
  `**Module**: \`m\`  **Spec**: \`SPEC-001\`  **Status**: ${status}\n- **FR-001** (event): THE SYSTEM SHALL x.\n**Given** x **When** y **Then** z\n- **SC-001**: 90%\n${extra}`;
const REVIEW_LOG = "## Review Log\n| 일시 | 수행자 | 판정 |\n|---|---|---|\n| 2026-07-05 | 세션 리뷰 | PASS |\n";
const DEDUP_REVIEW = "## Dedup-Review\n- 2026-07-05 이웃 없음: 단독 spec\n";

// ── completeness: Status enum (FR-001) ──

test("completeness: Status 헤더 없음 → warn(레거시), 미정의 Status 값 → warn, --strict 실패", () => {
  const noStatus = fixture({ "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n- **FR-001** (event): x.\n**Given** x\n- **SC-001**: 90%\n" });
  const badStatus = fixture({ "sdd/specs/SPEC-001.md": full("Shipped") });
  try {
    const a = run(COMPLETENESS, noStatus);
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /Status 헤더\(수명주기 상태\) 없음/);
    const b = run(COMPLETENESS, badStatus);
    assert.equal(b.code, 0, b.out);
    assert.match(b.out, /미정의 Status "Shipped"/);
    assert.equal(run(COMPLETENESS, badStatus, ["--strict"]).code, 1);
  } finally { rmSync(noStatus, { recursive: true, force: true }); rmSync(badStatus, { recursive: true, force: true }); }
});

// ── completeness: Reviewed 이상 → Review Log(FR-002) + Dedup-Review(FR-003) ──

test("completeness: Reviewed 이상인데 Review Log/Dedup-Review 기록 없음 → warn, --strict 실패", () => {
  const bare = fixture({ "sdd/specs/SPEC-001.md": full("Active") });
  const logOnly = fixture({ "sdd/specs/SPEC-001.md": full("Reviewed", REVIEW_LOG) });
  const complete = fixture({ "sdd/specs/SPEC-001.md": full("Active", REVIEW_LOG + DEDUP_REVIEW) });
  const draft = fixture({ "sdd/specs/SPEC-001.md": full("Draft") });
  try {
    const a = run(COMPLETENESS, bare);
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /Review Log 기록.*없음/);
    assert.match(a.out, /Dedup-Review 기록.*없음/);
    const b = run(COMPLETENESS, logOnly);
    assert.doesNotMatch(b.out, /Review Log 기록.*없음/);
    assert.match(b.out, /Dedup-Review 기록.*없음/);
    const c = run(COMPLETENESS, complete);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /모두 충족/);
    const d = run(COMPLETENESS, draft); // Draft는 리뷰 기록 요구 없음(상태 순서)
    assert.doesNotMatch(d.out, /Review Log 기록.*없음/);
    assert.equal(run(COMPLETENESS, bare, ["--strict"]).code, 1);
  } finally {
    for (const r of [bare, logOnly, complete, draft]) rmSync(r, { recursive: true, force: true });
  }
});

test("completeness: 플레이스홀더([YYYY-MM-DD])만 있는 Review Log는 기록 아님", () => {
  const root = fixture({
    "sdd/specs/SPEC-001.md": full("Active",
      "## Review Log\n| 일시 | 수행자 | 판정 |\n|---|---|---|\n| [YYYY-MM-DD] | [수행자] | [판정] |\n" + DEDUP_REVIEW),
  });
  try {
    const r = run(COMPLETENESS, root);
    assert.match(r.out, /Review Log 기록.*없음/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── spec-sync: Draft 소유 코드 차단 (FR-004) + 레거시 면제 (FR-005) ──

function gitFixture(status) {
  const statusLine = status ? `  **Status**: ${status}` : "";
  const root = fixture({
    "sdd/specs/SPEC-001.md": `# SPEC-001\n**Spec**: \`SPEC-001\`${statusLine}\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Entities**: thing\n- **Files**: src/lib/**\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n`,
    "src/lib/a.ts": "export const v = 1;\n",
  });
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  g("add", "-A"); g("commit", "-qm", "base");
  return { root, g };
}

test("spec-sync staged: Draft 스펙 소유 코드 변경 → 스펙 동반해도 exit 1, 트레일러로만 탈출", () => {
  const { root, g } = gitFixture("Draft");
  try {
    writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
    // 스펙에 의미 있는 변경(Change Log 행)을 동반해도 Draft면 차단돼야 한다.
    const spec = execFileSync("cat", [join(root, "sdd/specs/SPEC-001.md")], { encoding: "utf8" });
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), spec + "| 2026-07-05 | v 상향 | 근거 |\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "feat: draft 중 코드\n");
    const fail = run(SPECSYNC, root, ["--staged", "--message-file", "msg"]);
    assert.equal(fail.code, 1, fail.out);
    assert.match(fail.out, /SPEC-001이 Draft 상태/);
    assert.match(fail.out, /Reviewed 이상 승격/);
    writeFileSync(join(root, "msg2"), "feat: draft 중 코드\n\nSpec-Impact: none 프로토타이핑 스파이크\n");
    const pass = run(SPECSYNC, root, ["--staged", "--message-file", "msg2"]);
    assert.equal(pass.code, 0, pass.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("spec-sync staged: Active 스펙 + 의미 변경 동반 → 통과 / Status 없는 레거시 → Draft 차단 미적용", () => {
  for (const status of ["Active", null]) {
    const { root, g } = gitFixture(status);
    try {
      writeFileSync(join(root, "src/lib/a.ts"), "export const v = 2;\n");
      const spec = execFileSync("cat", [join(root, "sdd/specs/SPEC-001.md")], { encoding: "utf8" });
      writeFileSync(join(root, "sdd/specs/SPEC-001.md"), spec + "| 2026-07-05 | v 상향 | 근거 |\n");
      g("add", "-A");
      writeFileSync(join(root, "msg"), "feat: with spec\n");
      const r = run(SPECSYNC, root, ["--staged", "--message-file", "msg"]);
      assert.equal(r.code, 0, `status=${status}: ${r.out}`);
      assert.doesNotMatch(r.out, /Draft 상태/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
