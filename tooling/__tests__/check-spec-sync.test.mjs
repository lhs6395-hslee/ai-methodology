// tooling/__tests__/check-spec-sync.test.mjs
// @covers SPEC-003/FR-001
// @covers SPEC-003/FR-002
// @covers SPEC-003/FR-003
// @covers SPEC-003/FR-005
// @covers SPEC-003/FR-006
// @covers SPEC-003/FR-010
// @covers SPEC-008/FR-004
// @covers SPEC-008/FR-007
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
  for (const f of ["check-spec-sync.mjs", "spec-sync-lib.mjs", "ownership-keys.mjs", "sdd-config.mjs", "lifecycle-lib.mjs", "drift-lib.mjs", "cross-spec-lib.mjs"])
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

test("미지원 glob 경고는 spec당 1회만(중복 스캔 dedupe)", () => {
  const { root, g } = repo();
  try {
    // placeholder Files line committed to both idx and head (identical)
    const specWithPlaceholder = SPEC("[소유 경로]");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), specWithPlaceholder);
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // stage an unowned file to trigger gate
    writeFileSync(join(root, "src/other.ts"), "unowned\n");
    g("add", "src/other.ts");
    writeFileSync(join(root, "msg"), "chore\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    // count occurrences of "미지원 glob"
    const matches = (r.out.match(/미지원 glob/g) || []);
    assert.equal(matches.length, 1, `expected 1 warning, got ${matches.length}:\n${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("range: 첫 positional 인자(base)가 --message-file 부재 시에도 인식됨(mi=-1 오배제 회귀)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A"); g("commit", "-qm", "code only");
    const r = runGate(root, ["main"]); // env 없이 positional만 — 이전엔 origin/main으로 조용히 대체됐다
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /base:main/);
    assert.match(r.out, /⚠/); // main 기준 코드-only 변경이 실제로 판정됨
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── P2: specSyncUnownedPolicy (silent|warn|error) — @covers는 파일 헤더에 ──

const setPolicy = (root, policy, exempt = []) =>
  writeFileSync(join(root, "sdd.config.json"),
    JSON.stringify({ specDir: "sdd/specs", specSyncUnownedPolicy: policy, specSyncExemptGlobs: exempt }));

test("unowned 정책: warn → ⚠ 라인 + 통과 / error(staged) → ✗ exit 1 / exempt로 탈출", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/stray.ts"), "unowned\n");
    g("add", "src/stray.ts");
    writeFileSync(join(root, "msg"), "chore\n");

    setPolicy(root, "warn");
    const warn = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(warn.code, 0, warn.out);
    assert.match(warn.out, /⚠ unowned: src\/stray\.ts .*specSyncUnownedPolicy=warn/);

    setPolicy(root, "error");
    const err = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(err.code, 1, err.out);
    assert.match(err.out, /✗ unowned: src\/stray\.ts/);
    assert.match(err.out, /closed-world/);

    setPolicy(root, "error", ["src/stray.ts"]);
    const ex = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(ex.code, 0, ex.out);
    assert.match(ex.out, /exempt: src\/stray\.ts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unowned 정책: error도 range 모드에선 advisory(⚠ + exit 0) / 미정의 정책 값 → exit 1", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/stray.ts"), "unowned\n");
    g("add", "-A"); g("commit", "-qm", "stray");

    setPolicy(root, "error");
    const range = runGate(root, ["main"]);
    assert.equal(range.code, 0, range.out);
    assert.match(range.out, /⚠ unowned: src\/stray\.ts/);

    setPolicy(root, "block-everything");
    const bad = runGate(root, ["main"]);
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /specSyncUnownedPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── P4: draftBlockPolicy (advisory|hard) — MR 웹 UI 병합이 로컬 훅을 우회하는 사각지대 봉합 ──

const DRAFT_SPEC = (files) =>
  `# SPEC-001\n**Spec**: \`SPEC-001\`  **Status**: Draft\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Entities**: thing\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n`;

test("Draft 소유 코드: range 모드 기본값(advisory) → ⚠ Draft 표시 + exit 0(하위호환)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), DRAFT_SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A"); g("commit", "-qm", "code only");
    const r = runGate(root, ["main"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠ src\/lib\/pdf\/parse\.ts → 소유 스펙 SPEC-001이 Draft 상태/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Draft 소유 코드: draftBlockPolicy=hard → range 모드에서도 ✗ exit 1(웹 UI 병합 우회 방지)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), DRAFT_SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A"); g("commit", "-qm", "code only");
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", draftBlockPolicy: "hard" }));
    const r = runGate(root, ["main"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /✗ src\/lib\/pdf\/parse\.ts → 소유 스펙 SPEC-001이 Draft 상태/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("draftBlockPolicy=hard여도 non-draft 위반(스펙 무변경)은 range에서 advisory 유지", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "main"); g("checkout", "-qb", "feat");
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A"); g("commit", "-qm", "code only");
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", draftBlockPolicy: "hard" }));
    const r = runGate(root, ["main"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("draftBlockPolicy 미정의 값 → exit 1(문법화, 정의되지 않은 값 금지)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", draftBlockPolicy: "nope" }));
    writeFileSync(join(root, "src/other.ts"), "x\n");
    g("add", "src/other.ts");
    writeFileSync(join(root, "msg"), "chore\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /draftBlockPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("비ASCII 경로(quotepath): 한글 파일명 소유 코드도 인용 없이 매치·판정된다", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    mkdirSync(join(root, "src/lib/pdf"), { recursive: true });
    writeFileSync(join(root, "src/lib/pdf/한글모듈.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/lib/pdf/한글모듈.ts"), "2\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "fix: hotfix\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out); // 소유 매치가 됐다는 증거(인용된 "\354…" 문자열이면 침묵 통과해버림)
    assert.match(r.out, /한글모듈\.ts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-019/FR-001
test("semantic drift: 소유 파일 리네임 + FR라인 무변경(hard) → ✗ exit 1 / FR라인 변경 → PASS / Spec-Impact → PASS", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", semanticDriftPolicy: "hard" }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "export const v = 1;\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // 리네임 + 스펙엔 Change Log 행만 추가(spec-first는 충족, FR 라인은 미변경 → drift 승격 위반)
    g("mv", "src/lib/pdf/parse.ts", "src/lib/pdf/parser.ts");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-16 | 리네임 | |\n"));
    g("add", "-A");
    writeFileSync(join(root, "msg"), "refactor: rename parse\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /semantic drift/);
    assert.match(r.out, /SPEC-001/);

    // FR 선언 라인을 실제로 바꾸면 충족 → PASS
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"),
      SPEC("src/lib/pdf/**", "| 2026-07-16 | 리네임 | |\n").replace("SHALL x.", "SHALL y."));
    g("add", "-A");
    const r2 = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r2.code, 0, r2.out);

    // FR 라인은 그대로 두되 Spec-Impact 트레일러로 충족 → PASS
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-16 | 리네임 | |\n"));
    g("add", "-A");
    writeFileSync(join(root, "msg"), "refactor: rename parse\n\nSpec-Impact: 파일명만 정리, 동작 불변\n");
    const r3 = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r3.code, 0, r3.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-020/FR-002
test("cross-spec: 공유 파일을 타 스펙 기능 때문에 변경 + Change-Driver → 참조 완화(PASS) / 없으면 위반 / 가짜 동인 비완화", () => {
  const { root, g } = repo();
  const S2 = (files, cl = "| 2026-07-01 | 초안 | |\n") =>
    `# SPEC-002\n**Spec**: \`SPEC-002\`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL z.\n\n## Ownership\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n${cl}`;
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "sdd/specs/SPEC-002.md"), S2("src/shared/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    mkdirSync(join(root, "src/shared"), { recursive: true });
    writeFileSync(join(root, "src/shared/util.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // SPEC-002 소유 공유 파일을 SPEC-001 기능 때문에 변경. SPEC-001만 의미변경(Change Log), SPEC-002 무변경.
    writeFileSync(join(root, "src/shared/util.ts"), "2\n");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-16 | 공유 util 확장 | |\n"));
    g("add", "-A");

    // 동인 없음 → SPEC-002 위반
    writeFileSync(join(root, "msg"), "feat: use shared util\n");
    const noDriver = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(noDriver.code, 1, noDriver.out);
    assert.match(noDriver.out, /SPEC-002/);

    // Change-Driver: SPEC-001(의미변경 동인) → SPEC-002 참조 완화 PASS
    writeFileSync(join(root, "msg"), "feat: use shared util\n\nChange-Driver: SPEC-001 공유 util을 pdf 기능이 확장\n");
    const withDriver = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(withDriver.code, 0, withDriver.out);
    assert.match(withDriver.out, /cross-spec/);

    // 가짜 동인(미실재 SPEC-999) → 완화 안 됨, 위반 유지
    writeFileSync(join(root, "msg"), "feat: x\n\nChange-Driver: SPEC-999 없는 스펙\n");
    const bogus = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(bogus.code, 1, bogus.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 감사 봉합(2026-07-16): T1 config 자기보호 · T2 상태 화이트리스트 · T3 트레일러 스코프 ·
//    T4 동인 경로 스코프 · M2 specSyncBase ──

// @covers SPEC-003/FR-002 — staged 판정은 HEAD 시점 config로(자기약화 커밋 방지)
test("HEAD-config 판정: config 약화+소유 코드 변경 한 커밋 → 약화 전(HEAD) config가 심판(FAIL)", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // config 불변 커밋엔 HEAD-config 노트가 없다(하위호환)
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1b\n");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**") + "\n| 2026-07-16 | 개정 | |\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "feat: normal\n");
    const normal = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(normal.code, 0, normal.out);
    assert.doesNotMatch(normal.out, /HEAD 시점 config로 판정/);
    g("commit", "-qm", "normal");
    // 같은 커밋에서 src/**를 exempt로 약화 + 소유 코드 변경(스펙 무변경) → HEAD config가 심판 → 위반
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", specSyncExemptGlobs: ["src/**"] }));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "chore: relax config\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /HEAD 시점 config로 판정/);
    assert.match(r.out, /SPEC-001/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-008/FR-004 — 상태 화이트리스트: Draft만이 아니라 Planned·enum 밖도 코드 못 이끎
test("상태 화이트리스트: Planned·enum 밖(Wip) 소유 코드 → staged FAIL / Status 미선언(레거시)은 통과", () => {
  const { root, g } = repo();
  const S = (status) =>
    `# SPEC-001\n**Spec**: \`SPEC-001\`  **Status**: ${status}\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Entities**: thing\n- **Files**: src/lib/pdf/**\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n`;
  try {
    for (const [status, wantFail] of [["Planned", true], ["Wip", true], ["Active", false]]) {
      writeFileSync(join(root, "sdd/specs/SPEC-001.md"), S(status));
      writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
      g("add", "-A"); g("commit", "-qm", `base-${status}`);
      writeFileSync(join(root, "src/lib/pdf/parse.ts"), `2-${status}\n`);
      // 스펙도 함께 갱신(동반) — 상태 차단은 동반 여부와 무관해야 한다
      writeFileSync(join(root, "sdd/specs/SPEC-001.md"), S(status) + `\n| 2026-07-16 | ${status} 개정 | |\n`);
      g("add", "-A");
      writeFileSync(join(root, "msg"), "feat: x\n");
      const r = runGate(root, ["--staged", "--message-file", "msg"]);
      if (wantFail) {
        assert.equal(r.code, 1, `${status}: ${r.out}`);
        assert.match(r.out, new RegExp(`SPEC-001이 ${status} 상태`));
      } else {
        assert.equal(r.code, 0, `${status}: ${r.out}`);
      }
      g("commit", "-qm", `advance-${status}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-003/FR-003 — 트레일러는 동반·상태 차단만 면제, unowned closed-world·글롭 문법은 못 우회
test("트레일러 스코프: Spec-Impact: none이 unowned(error)·글롭 문법 hard를 우회하지 못한다", () => {
  const { root, g } = repo();
  try {
    // unowned closed-world: 트레일러 있어도 차단
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", specSyncUnownedPolicy: "error" }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "unowned.ts"), "1\n");
    g("add", "unowned.ts");
    writeFileSync(join(root, "msg"), "chore: x\n\nSpec-Impact: none 포맷팅\n");
    const u = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(u.code, 1, u.out);
    assert.match(u.out, /unowned/);
    g("reset", "-q", "HEAD", "unowned.ts");
    // 글롭 문법 위반: 트레일러 있어도 차단
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/{pdf}/**"));
    g("add", "-A");
    const gl = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(gl.code, 1, gl.out);
    assert.match(gl.out, /glob 문법|미지원 glob/);
    // 동반 요구·Draft 차단은 여전히 트레일러로 면제(문서화된 탈출구) — 기존 트레일러 PASS 테스트가 커버
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-020/FR-005 — 동인 경로 스코프: @glob 매치 파일만 완화(무스코프 전역 팬아웃 봉합)
test("cross-spec 경로 스코프: Change-Driver @glob → 매치 파일만 완화, 밖 파일은 위반 유지", () => {
  const { root, g } = repo();
  const S2 = (files) =>
    `# SPEC-002\n**Spec**: \`SPEC-002\`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL z.\n\n## Ownership\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | |\n`;
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "sdd/specs/SPEC-002.md"), S2("src/shared/**"));
    mkdirSync(join(root, "src/shared"), { recursive: true });
    writeFileSync(join(root, "src/shared/a.ts"), "1\n");
    writeFileSync(join(root, "src/shared/b.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    // 두 공유 파일 변경 + SPEC-001만 의미변경. 스코프 동인은 a.ts만 귀속.
    writeFileSync(join(root, "src/shared/a.ts"), "2\n");
    writeFileSync(join(root, "src/shared/b.ts"), "2\n");
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**", "| 2026-07-16 | 확장 | |\n"));
    g("add", "-A");
    writeFileSync(join(root, "msg"), "feat: x\n\nChange-Driver: SPEC-001 @src/shared/a.ts pdf 기능이 a만 확장\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /cross-spec: src\/shared\/a\.ts/);      // a는 완화
    assert.match(r.out, /✗ src\/shared\/b\.ts → 소유 스펙 SPEC-002/); // b는 위반 유지
    // 무스코프(레거시)는 둘 다 완화 → PASS
    writeFileSync(join(root, "msg"), "feat: x\n\nChange-Driver: SPEC-001 pdf 기능이 공유 유틸 확장\n");
    const legacy = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(legacy.code, 0, legacy.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @covers SPEC-003/FR-006 — specSyncBase config knob: 기본 브랜치가 origin/main이 아니어도 base 선언으로 changeset=브랜치 유지
test("specSyncBase: config로 base 선언 → 멀티커밋 브랜치(스펙 선커밋→코드 후커밋)가 staged에서 통과", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", specSyncBase: "trunk" }));
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**"));
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    g("branch", "-m", "trunk"); g("checkout", "-qb", "feat");
    // 커밋 1: 스펙만(선커밋)
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SPEC("src/lib/pdf/**") + "\n| 2026-07-16 | 선커밋 개정 | |\n");
    g("add", "-A"); g("commit", "-qm", "spec first");
    // 커밋 2: 코드만 — base(trunk)...HEAD 합집합으로 스펙 선커밋이 인식되어야 한다
    writeFileSync(join(root, "src/lib/pdf/parse.ts"), "2\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "feat: code follow-up\n");
    const r = runGate(root, ["--staged", "--message-file", "msg"]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /해석 불가/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
