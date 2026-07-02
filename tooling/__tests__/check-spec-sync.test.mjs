// tooling/__tests__/check-spec-sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPEC = (files, extra = "") => `# SPEC-001\n**Spec**: \`SPEC-001\`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Entities**: thing\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n${extra}`;

function repo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-ss-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "src/lib/pdf"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  for (const f of ["check-spec-sync.mjs", "spec-sync-lib.mjs", "ownership-keys.mjs", "sdd-config.mjs"])
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  return { root, g };
}
function runGate(root, args, env = {}) {
  try {
    const out = execFileSync("node", [join(root, "scripts/check-spec-sync.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("staged: Files 매치 코드 + 스펙 무변경 → FAIL(exit 1) + unstaged 힌트", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "export const v = 1;\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "export const v = 2;\n");
    g("add", "src/lib/pdf/parse.ts");
    writeFileSync(join(root, "msg"), "fix: hotfix\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /SPEC-001/);
    assert.match(r.out, /git add/); // §6.2 힌트
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("staged: 스펙 Change Log 표 행 동반 → PASS / 공백만 touch → FAIL(엄격)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-02 | ENOENT 픽스 | c1 |\n"));
    g("add", "-A");
    writeFileSync(join(root, "msg"), "fix: with spec\n");
    assert.equal(runGate(root, ["--staged", "--message-file", "msg"]).code, 0);
    // 공백만: 스펙에 빈 줄만 추가
    g("commit", "-qm", "ok");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "3\n");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-02 | ENOENT 픽스 | c1 |\n\n\n"));
    g("add", "-A");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out); // 새 항목 없음(공백뿐) — base...HEAD에도 없음(방금 커밋됨)
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("staged: changeset=브랜치 — 스펙이 이전 커밋(base...HEAD)에서 변경 → PASS(§5.8)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    // 커밋 A: 스펙에 FR 추가
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "**FR-002** THE SYSTEM SHALL y.\n"));
    g("add", "-A"); g("commit", "-qm", "spec: FR-002");
    // 커밋 B(staged): 코드만
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "src/lib/pdf/parse.ts");
    writeFileSync(join(root, "msg"), "feat: impl FR-002\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"], { SDD_DIFF_BASE: "main" });
    assert.equal(r.code, 0, r.out); // top-down 흐름 보존
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("트레일러: Spec-Impact: none <사유> → PASS / 사유 없음 → FAIL", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "src/lib/pdf/parse.ts");
    writeFileSync(join(root, "msg"), "chore: tweak\n\nSpec-Impact: none 포맷팅만 변경\n");
    assert.equal(runGate(root, ["--staged", "--message-file", "msg"]).code, 0);
    writeFileSync(join(root, "msg"), "chore: tweak\n\nSpec-Impact: none\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /사유/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("exempt glob·미선언 파일: exempt → PASS+기록 / Files 미매치 → 침묵 PASS", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", specSyncExemptGlobs: ["src/lib/pdf/generated/**"] }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    mkdirSync(join(root, "src/lib/pdf/generated"), { recursive: true });
    writeFileSync(join(root, "src/lib/pdf/generated/out.ts"), "1\n");
    writeFileSync(join(root, "unowned.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/lib/pdf/generated/out.ts"), "2\n");
    writeFileSync(join(root, "unowned.ts"), "2\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "chore\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /exempt/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("스펙 삭제+소유 코드 변경 → 시끄럽게 PASS(HEAD∪index) / 다중 소유 AND", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "sdd/specs/SPEC-002.md"), SPEC("src/lib/pdf/**").replace(/SPEC-001/g, "SPEC-002"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // 다중 소유: 한쪽(SPEC-001)만 Change Log 갱신 → FAIL(AND)
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-02 | 픽스 | c |\n"));
    g("add", "-A");
    writeFileSync(join(root, "msg"), "fix\n");
    let r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /SPEC-002/);
    // 스펙 삭제는 의미 변경으로 시끄럽게 통과
    g("rm", "-q", "sdd/specs/SPEC-002.md");
    r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /삭제/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("range 모드(인자 없음): 위반 → ⚠ + exit 0 (advisory, sdd-sync 소비)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A"); g("commit", "-qm", "code only");
    const r = runGate(root, [], { SDD_DIFF_BASE: "main" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
