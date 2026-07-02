# spec-first 강제 (Files·check-spec-sync·/speckit.fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코드가 바뀔 때 소유 스펙도 같은 changeset(브랜치)에 의미 있게 바뀌었는지를 commit-msg 훅에서 hard 강제한다.

**Architecture:** 순수 함수 코어(`spec-sync-lib.mjs`: glob 컴파일·섹션 귀속) 위에 오케스트레이터(`check-spec-sync.mjs`: staged/range 두 모드, 단일 귀속 코어)를 얹고, commit-msg 훅·sdd-sync R2·sdd-init 배선으로 연결한다. `/speckit.fix` 스킬이 버그픽스의 정공 경로.

**Tech Stack:** Node ESM(`.mjs`), `node --test`, git plumbing(`diff --cached`·`show :<p>`·`ls-files`·`ls-tree`), POSIX sh 훅.

**설계 SSOT:** `docs/superpowers/specs/2026-07-02-spec-first-enforcement-design.md` (4 리뷰 라운드 CLEAN). 이 plan의 §참조는 그 문서.

## Global Constraints

- **언어중립:** 게이트는 텍스트+git 파서, Node 런타임만 요구. Node판 먼저(§10.1 — sdd-init 비-node 게이트 선택 시 명시 경고, 조용한 부재 금지).
- **하위호환:** config 없으면 기존 동작. `Files:`는 `ownershipCategories`에 **추가 금지**(dedup·cohesion 오염). 공유 `parseSection`은 **변경 금지** — 방어 정규화(원시 라인 경고·`#`-strip)는 check-spec-sync 소유(§4.1).
- **강제력:** staged 모드(commit-msg 훅)=hard exit 1 / range 모드(인자 없음 기본)=advisory ⚠+exit 0. merge commit은 skip+기록(§5.6).
- **changeset=브랜치(§5.8):** staged 통과 = 의미 변경이 `staged diff ∪ base...HEAD`(base 기본 `origin/main`, env `SDD_DIFF_BASE`) 어딘가에 존재. base 해석 불가 시 staged만+경고.
- **두-이미지 귀속(§5.4):** staged 슬라이스=index판(`git show :<p>`) / branch 슬라이스=HEAD판(`git show HEAD:<p>`), 판정 합집합. 섹션 맵은 **레벨 무관**(`^#{2,3}`) **이름 기준**("Edge Cases"·"Change Log").
- **glob(§4.1):** `**`·`*`만, anchored, POSIX 슬래시·대소문자 구분. `a/**`는 `a` 비매치. 미지원 문법(`{`·`?`·`[`)은 원시 라인 스캔으로 **명시 경고**.
- **다중 소유 = AND(§6.1). 스펙 삭제=의미 변경(시끄럽게, HEAD∪index 로드로 가시). 순수 rename≠의미 변경.**
- **트레일러:** `Spec-Impact: none <사유>` — **사유 없으면 FAIL**(§5.5).
- **테스트 실행: 글로브 형식** `node --test tooling/__tests__/*.mjs` (디렉토리 형식은 Node v25 실패). 현재 기준 51 tests green — 회귀 금지.
- **정직:** 문서·출력이 실제 동작과 일치(과장 금지). init-then-execute 통합 테스트 필수(설치-드리프트 Critical 재발 방지 교훈).

---

### Task 1: config — `specSyncExemptGlobs`

**Files:**
- Modify: `tooling/sdd-config.mjs` (DEFAULTS)
- Test: `tooling/__tests__/sdd-config.test.mjs` (기존 확장)

**Interfaces:**
- Produces: `cfg.specSyncExemptGlobs` (string[], 기본 `[]`) — check-spec-sync가 exempt 판정에 사용.

- [ ] **Step 1: Write the failing test** — 기존 `sdd-config.test.mjs`에 추가:

```javascript
test("config: specSyncExemptGlobs 기본 []", () => {
  const cfg = loadConfig("/nonexistent");
  assert.deepEqual(cfg.specSyncExemptGlobs, []);
});
```

- [ ] **Step 2: Run** `node --test tooling/__tests__/sdd-config.test.mjs` — Expected: FAIL (필드 없음 → undefined).

- [ ] **Step 3: Implement** — `tooling/sdd-config.mjs`의 DEFAULTS에 추가(`maxFRsPerSpec` 근처):

```javascript
  // check-spec-sync 예외 glob(§5.5) — Files glob이 과포함한 생성물·락파일 등.
  // 통과하되 영속 흔적 없음(정직) — 목록 자체가 config 리뷰 대상.
  specSyncExemptGlobs: [],
```

- [ ] **Step 4: Run** 같은 명령 — Expected: PASS. 전체 글로브도 1회: 기존 회귀 없음.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(config): specSyncExemptGlobs (spec-sync 예외 glob)"`

---

### Task 2: 순수 코어 — `spec-sync-lib.mjs` (glob + 섹션 귀속)

**Files:**
- Create: `tooling/spec-sync-lib.mjs`
- Test: `tooling/__tests__/spec-sync-lib.test.mjs`

**Interfaces:**
- Produces (check-spec-sync가 소비):
  - `compileGlob(glob: string): RegExp` — anchored, `**`/`*`만
  - `scanFilesLineIssues(rawLine: string): string[]` — 미지원 문자(`{`·`?`·`[`) 목록
  - `stripInlineComment(value: string): string` — trailing `#…` 제거
  - `hasMeaningfulSpecChange(postImage: string, diffText: string): boolean` — §5.4 판정
  - (내부 노출) `buildSectionMap(text)`, `addedLines(diffText)`

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/spec-sync-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileGlob, scanFilesLineIssues, stripInlineComment, hasMeaningfulSpecChange } from "../spec-sync-lib.mjs";

test("compileGlob: ** 는 0+ 세그먼트, anchored, prefix 경계 안전", () => {
  const re = compileGlob("src/lib/pdf/**");
  assert.ok(re.test("src/lib/pdf/a.ts"));
  assert.ok(re.test("src/lib/pdf/a/b.ts"));
  assert.equal(re.test("src/lib/pdfx/a.ts"), false); // prefix 경계
  assert.equal(re.test("src/lib/pdf"), false);       // 디렉토리 자신 비매치(§4.1)
});

test("compileGlob: * 는 세그먼트 내, 점 이스케이프", () => {
  const re = compileGlob("src/app/api/*/route.ts");
  assert.ok(re.test("src/app/api/recommend/route.ts"));
  assert.equal(re.test("src/app/api/a/b/route.ts"), false); // * 는 / 넘지 않음
  assert.equal(compileGlob("next.config.ts").test("next2config.ts"), false); // . 리터럴
});

test("scanFilesLineIssues: 미지원 문법 경고 목록", () => {
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/{a,b}/**"), ["{"]);
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/lib/**"), []);
});

test("stripInlineComment: trailing #… 제거", () => {
  assert.equal(stripInlineComment("next.config.ts # 인라인 주석"), "next.config.ts");
  assert.equal(stripInlineComment("src/lib/**"), "src/lib/**");
});

const POST = [
  "# SPEC-001", "", "## User Scenarios & Testing", "", "### Edge Cases",
  "- 기존 엣지", "", "## Functional Requirements", "**FR-001** THE SYSTEM SHALL x.",
  "", "## Change Log", "| 날짜 | 변경 | 근거 |", "|---|---|---|", "| 2026-07-02 | 초안 | |",
].join("\n");

test("hasMeaningfulSpecChange: H3 Edge Cases 불릿 추가 → true (레벨 무관 귀속)", () => {
  // POST의 6행("- 기존 엣지") 다음에 "+- 새 엣지"가 추가됐다고 가정한 diff
  const post = POST.replace("- 기존 엣지", "- 기존 엣지\n- 새 엣지");
  const diff = "@@ -6,1 +6,2 @@\n - 기존 엣지\n+- 새 엣지";
  assert.equal(hasMeaningfulSpecChange(post, diff), true);
});

test("hasMeaningfulSpecChange: Change Log 표 행 추가 → true, 구분선만 → false", () => {
  const post = POST + "\n| 2026-07-03 | 픽스 | c1 |";
  const rowDiff = "@@ -14,1 +14,2 @@\n | 2026-07-02 | 초안 | |\n+| 2026-07-03 | 픽스 | c1 |";
  assert.equal(hasMeaningfulSpecChange(post, rowDiff), true);
  const sepDiff = "@@ -13,1 +13,2 @@\n |---|---|---|\n+|---|---|---|";
  assert.equal(hasMeaningfulSpecChange(POST + "\n|---|---|---|", sepDiff), false);
});

test("hasMeaningfulSpecChange: FR 라인 추가/삭제 → true, 공백·주석만 → false", () => {
  assert.equal(hasMeaningfulSpecChange(POST, "@@ -9,0 +10,1 @@\n+**FR-002** THE SYSTEM SHALL y."), true);
  assert.equal(hasMeaningfulSpecChange(POST, "@@ -2,0 +3,1 @@\n+"), false);           // 공백
  assert.equal(hasMeaningfulSpecChange(POST, "@@ -2,0 +3,1 @@\n+<!-- 주석 -->"), false); // 항목 아님
});
```

- [ ] **Step 2: Run** `node --test tooling/__tests__/spec-sync-lib.test.mjs` — Expected: FAIL (모듈 없음).

- [ ] **Step 3: Implement**

```javascript
// tooling/spec-sync-lib.mjs
// check-spec-sync 순수 코어 — glob 컴파일 + diff 섹션 귀속. git 비의존(테스트 용이).
// 설계: docs/superpowers/specs/2026-07-02-spec-first-enforcement-design.md §4.1·§5.4

// §4.1 지원 부분집합: **(0+ 경로 세그먼트)·*(세그먼트 내). anchored, POSIX, 대소문자 구분.
export function compileGlob(glob) {
  let re = "";
  for (let i = 0; i < glob.length; ) {
    if (glob.startsWith("**/", i)) { re += "(?:[^/]+/)*"; i += 3; }
    else if (glob.slice(i) === "**") { re += "(?:[^/]+/)*[^/]+"; i = glob.length; }
    else if (glob[i] === "*") { re += "[^/]*"; i += 1; }
    else { re += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&"); i += 1; }
  }
  return new RegExp(`^${re}$`);
}

// §4.1: 원시 `- **Files**:` 라인에서 미지원 문법 스캔 — parseSection이 `[` 토큰을
// placeholder로 조용히 버리기 전에 경고해야 하므로 반드시 원시 라인 기준.
export function scanFilesLineIssues(rawLine) {
  return ["{", "?", "["].filter((ch) => rawLine.includes(ch));
}

// §4.1: parseSection 반환값의 trailing " # …" strip (공유 파서는 불변).
export function stripInlineComment(value) {
  return value.replace(/\s+#.*$/, "").trim();
}

// §5.4 step 1: 레벨 무관(#{2,3}) 헤더의 "이름" 기준 라인번호→섹션 맵.
export function buildSectionMap(postImage) {
  const sections = [];
  postImage.split("\n").forEach((l, i) => {
    const m = l.match(/^#{2,3}\s+(.+?)\s*$/);
    if (m) sections.push({ name: m[1], start: i + 1 }); // 1-based
  });
  return sections;
}

function sectionAt(sections, lineNo) {
  let cur = null;
  for (const s of sections) { if (s.start <= lineNo) cur = s.name; else break; }
  return cur;
}

// §5.4 step 2: unified diff에서 추가 라인의 new-file 라인번호 추출.
export function addedLines(diffText) {
  const out = [];
  let ln = 0;
  for (const l of diffText.split("\n")) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { ln = parseInt(h[1], 10); continue; }
    if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("\\")) continue;
    if (l.startsWith("+")) { out.push({ line: ln, text: l.slice(1) }); ln++; }
    else if (!l.startsWith("-")) ln++; // context
  }
  return out;
}

const isBullet = (t) => /^\s*-\s+\S/.test(t);
const isTableRow = (t) => /^\s*\|/.test(t) && !/^\s*\|[\s:|-]+\|?\s*$/.test(t); // 구분선 제외

// §5.4 step 3: 의미 있는 변경 판정 (post-image + 그 이미지 기준 diff 한 슬라이스).
export function hasMeaningfulSpecChange(postImage, diffText) {
  if (/^[+-].*\*\*FR-\d{3}\*\*/m.test(diffText)) return true; // FR 라인 +/- (패턴 기반)
  const sections = buildSectionMap(postImage);
  for (const { line, text } of addedLines(diffText)) {
    const sec = sectionAt(sections, line);
    if (!sec) continue;
    if ((isBullet(text) || isTableRow(text)) && /(edge cases|change log)/i.test(sec)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run** — Expected: PASS (7 tests). 전체 글로브 1회 회귀 확인.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(gate): spec-sync 순수 코어 — glob 컴파일·레벨무관 섹션 귀속(§4.1·§5.4)"`

---

### Task 3: `check-spec-sync.mjs` — 오케스트레이터 (두 모드)

**Files:**
- Create: `tooling/check-spec-sync.mjs`
- Test: `tooling/__tests__/check-spec-sync.test.mjs`

**Interfaces:**
- Consumes: Task 2 전 함수 · `parseSection(text,"Ownership",["Files"])` · `cfg.specSyncExemptGlobs`·`cfg.specDir`·`cfg.__specIdRe`
- Produces: CLI — staged 모드 `--staged --message-file <p>`(hard exit 1) / range 모드 `[base]`(advisory exit 0, ⚠ 출력 — sdd-sync가 `[⚠✗]`로 플래깅).

- [ ] **Step 1: Write the failing test** — 임시 git 레포 픽스처(기존 `pre-commit.test.mjs` 패턴):

```javascript
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
```

- [ ] **Step 2: Run** `node --test tooling/__tests__/check-spec-sync.test.mjs` — Expected: FAIL (파일 없음).

- [ ] **Step 3: Implement**

```javascript
#!/usr/bin/env node
// ─── spec-first 강제 게이트 (§5) ─────────────────────────────
// 소유(Files) 코드가 바뀌면 소유 스펙의 의미 있는 변경(FR/Edge Cases/Change Log)이
// 같은 changeset(브랜치=staged ∪ base...HEAD, §5.8)에 있어야 한다.
// 모드: --staged --message-file <p> = hard(exit 1, commit-msg 훅) / [base] = range advisory(exit 0).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadConfig } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { compileGlob, scanFilesLineIssues, stripInlineComment, hasMeaningfulSpecChange } from "./spec-sync-lib.mjs";

const cfg = loadConfig();
const args = process.argv.slice(2);
const STAGED = args.includes("--staged");
const mi = args.indexOf("--message-file");
const MSG = mi >= 0 ? args[mi + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && i !== mi + 1);
const BASE = positional[0] || process.env.SDD_DIFF_BASE || "origin/main";

const sh = (c) => execSync(c, { cwd: cfg.__root, encoding: "utf8" });
const shOk = (c) => { try { return sh(c); } catch { return null; } };
const lines = (s) => (s || "").split("\n").map((x) => x.trim()).filter(Boolean);

// ① 트레일러(§5.5): staged 모드에서만.
if (STAGED && MSG) {
  const msg = readFileSync(MSG, "utf8");
  const m = msg.match(/^Spec-Impact:\s*none\s*(.*)$/m);
  if (m) {
    if (!m[1].trim()) { console.error("✗ spec-sync: `Spec-Impact: none`은 사유 필수 (`Spec-Impact: none <사유>`)"); process.exit(1); }
    console.log(`spec-sync: Spec-Impact: none — 통과 (사유: ${m[1].trim()}) [트레일러가 커밋에 영속]`);
    process.exit(0);
  }
}

// ② 변경 파일 수집(§5.7): staged = cached ∪ base...HEAD / range = base...HEAD.
const branchDiffOk = shOk(`git rev-parse -q --verify ${BASE.split("...")[0]}`) !== null && shOk(`git diff --name-only ${BASE}...HEAD`) !== null;
const changed = new Set();
if (branchDiffOk) lines(shOk(`git diff --name-only ${BASE}...HEAD`)).forEach((f) => changed.add(f));
else console.log(`· spec-sync: base(${BASE}) 해석 불가 — ${STAGED ? "staged만 판정(경고)" : "판정 불가, 건너뜀"}`);
if (STAGED) lines(sh("git diff --cached --name-only")).forEach((f) => changed.add(f));
if (!STAGED && !branchDiffOk) process.exit(0);

// ③ 스펙 로드(§5.1): HEAD ∪ index 합집합(삭제 가시화).
const specPaths = new Set([
  ...lines(shOk(`git ls-files -- ${cfg.specDir}`) || ""),
  ...lines(shOk(`git ls-tree -r --name-only HEAD -- ${cfg.specDir}`) || ""),
].filter((p) => p.endsWith(".md")));
const specs = []; // {id, path, globs[], deletedInIndex}
for (const p of specPaths) {
  const idx = shOk(`git show :${JSON.stringify(p).slice(1, -1) ? p : p}`);
  const head = shOk(`git show HEAD:${p}`);
  const text = idx ?? head ?? "";
  const id = (text.match(cfg.__specIdRe) || [p])[0];
  const globs = new Set();
  for (const src of [idx, head]) {
    if (!src) continue;
    for (const raw of src.split("\n")) {
      if (/^-\s*\*\*Files\*\*\s*:/.test(raw)) {
        const issues = scanFilesLineIssues(raw);
        if (issues.length) console.log(`⚠ [${id}] Files에 미지원 glob 문법 ${issues.join(" ")} — **·* 만 지원(§4.1), 해당 토큰은 매치되지 않을 수 있음`);
      }
    }
    parseSection(src, "Ownership", ["Files"]).Files.map(stripInlineComment).filter(Boolean).forEach((g) => globs.add(g));
  }
  specs.push({ id, path: p, globs: [...globs].map((g) => ({ g, re: compileGlob(g) })), deletedInIndex: idx === null && head !== null });
}

// ④ 판정: 변경 코드 파일 → 소유 스펙(AND, §6.1) → 의미 변경(두-이미지 합집합, §5.4·§5.8).
const exempt = (cfg.specSyncExemptGlobs || []).map(compileGlob);
const specSet = new Set(specs.map((s) => s.path));
const violations = []; // {file, spec}
const memo = new Map(); // spec.path -> boolean(meaningful)
function meaningful(spec) {
  if (memo.has(spec.path)) return memo.get(spec.path);
  let ok = false;
  if (spec.deletedInIndex) { console.log(`⚠ [${spec.id}] 스펙 파일 삭제 — 의미 변경으로 인정(수명주기 리뷰 대상)`); ok = true; }
  if (!ok && STAGED) {
    const d = shOk(`git diff --cached -- ${spec.path}`);
    const post = shOk(`git show :${spec.path}`);
    if (d && post && hasMeaningfulSpecChange(post, d)) ok = true;
  }
  if (!ok && branchDiffOk) {
    const d = shOk(`git diff ${BASE}...HEAD -- ${spec.path}`);
    const post = shOk(`git show HEAD:${spec.path}`);
    if (d && post && hasMeaningfulSpecChange(post, d)) ok = true;
  }
  memo.set(spec.path, ok);
  return ok;
}
for (const f of changed) {
  if (specSet.has(f) || f.startsWith(cfg.specDir + "/")) continue;      // 스펙 자신은 코드 아님
  if (exempt.some((re) => re.test(f))) { console.log(`· exempt: ${f} (specSyncExemptGlobs — 영속 흔적 없음)`); continue; }
  for (const s of specs) {
    if (!s.globs.some(({ re }) => re.test(f))) continue;
    if (!meaningful(s)) violations.push({ file: f, spec: s.id });
  }
}

// ⑤ 리포트.
const mode = STAGED ? "staged(hard)" : `range(advisory, base:${BASE})`;
console.log(`spec-sync 게이트 — mode:${mode} changed:${changed.size} specs:${specs.length}`);
if (!violations.length) { console.log("spec-sync: OK — 소유 코드 변경에 스펙 동반됨(또는 대상 없음)."); process.exit(0); }
for (const v of violations) console.log(`  ${STAGED ? "✗" : "⚠"} ${v.file} → 소유 스펙 ${v.spec}에 의미 있는 변경 없음(FR/Edge Cases/Change Log)`);
if (STAGED) {
  console.error(`\n✗ spec-first 위반: 소유 스펙을 같은 changeset에 갱신하라 — /speckit.fix 사용.`);
  console.error(`  · 스펙을 이미 수정했다면 \`git add\`로 스테이징했는지 확인(§6.2).`);
  console.error(`  · 진짜 스펙 무관이면 커밋 메시지에 \`Spec-Impact: none <사유>\` 트레일러.`);
  process.exit(1);
}
console.log("spec-sync: advisory — '/sdd-sync' 또는 /speckit.fix로 정렬 검토.");
```

> 주의: `git show :${p}`의 JSON.stringify 잔재 같은 이상한 표현 금지 — 위 코드에서 `shOk(\`git show :${p}\`)`로 단순화해 구현하라(경로에 공백 없음 전제는 스펙 파일명 규약 `<PREFIX>-NNN*.md`로 보장).

- [ ] **Step 4: Run** — Expected: PASS (7 tests). 전체 글로브 1회(기존+신규 전부 green).

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(gate): check-spec-sync — staged(hard)/range(advisory), changeset=브랜치, HEAD∪index"`

---

### Task 4: commit-msg 훅

**Files:**
- Create: `tooling/harness/commit-msg`
- Test: `tooling/__tests__/commit-msg-hook.test.mjs`

**Interfaces:**
- Consumes: `scripts/check-spec-sync.mjs`(Task 3)
- Produces: `.git/hooks/commit-msg`로 설치될 셸 스크립트(인자 `$1`=메시지 파일).

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/commit-msg-hook.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-cm-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  for (const f of ["check-spec-sync.mjs", "spec-sync-lib.mjs", "ownership-keys.mjs", "sdd-config.mjs"])
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  cpSync(join(process.cwd(), "tooling/harness/commit-msg"), join(root, "scripts/sdd-commit-msg.sh"));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  return { root, g };
}
const runHook = (root, msgPath) => {
  try { execFileSync("sh", [join(root, "scripts/sdd-commit-msg.sh"), msgPath], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); return 0; }
  catch (e) { return e.status; }
};

test("훅: 소유 코드만 staged → exit 1 / merge 상태(MERGE_HEAD) → skip exit 0", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), "# SPEC-001\n**FR-001** x\n## Ownership\n- **Files**: src/**\n## Change Log\n|d|c|r|\n|---|---|---|\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "1\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/a.ts"), "2\n"); g("add", "src/a.ts");
    writeFileSync(join(root, "m"), "fix\n");
    assert.equal(runHook(root, join(root, "m")), 1);
    // merge 상태 시뮬레이션: MERGE_HEAD 존재 → skip
    writeFileSync(join(root, ".git/MERGE_HEAD"), "0000000000000000000000000000000000000000\n");
    assert.equal(runHook(root, join(root, "m")), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run** — Expected: FAIL (훅 없음).

- [ ] **Step 3: Implement**

```sh
#!/bin/sh
# git commit-msg — spec-first 강제(check-spec-sync staged 모드). $1 = 커밋 메시지 파일.
# sdd-init가 scripts/sdd-commit-msg.sh로 설치 + .git/hooks/commit-msg가 호출.
DIR=$(git rev-parse --show-toplevel) || { echo "sdd commit-msg: git 저장소 아님" >&2; exit 1; }
cd "$DIR"
# merge commit → skip(§5.6): 브랜치 커밋 강제 + pre-push range가 백스톱.
if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  echo "sdd commit-msg: merge commit — spec-sync skip (range 백스톱이 커버)" >&2
  exit 0
fi
[ -f scripts/check-spec-sync.mjs ] || { echo "sdd commit-msg: check-spec-sync 없음 — sdd-init 재실행 필요" >&2; exit 1; }
node scripts/check-spec-sync.mjs --staged --message-file "$1"
```

- [ ] **Step 4: Run** — Expected: PASS. 전체 글로브 1회.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(hook): commit-msg — spec-sync staged 강제(merge skip)"`

---

### Task 5: `/speckit.fix` 스킬 원본

**Files:**
- Create: `tooling/harness/speckit-fix.SKILL.md`

**Interfaces:** Produces: sdd-init가 `.claude/skills/speckit-fix/SKILL.md`로 복사(Task 6).

- [ ] **Step 1: Write the skill** (문서 — 기존 `sdd-sync.SKILL.md` 스타일 준수):

```markdown
---
name: speckit-fix
description: 버그픽스를 SDD 경로로 — 재현 테스트(RED)→스펙 착지(FR 또는 Edge Cases+Change Log)→GREEN→게이트. 코드부터 고치고 싶은 hotfix일수록 이 스킬로.
---

# /speckit.fix — 버그픽스 SDD 경로 (§7)

버그는 기능 루프(0~8)가 아니라 이 경로로. **어느 쪽이든 스펙을 반드시 건드린다** — check-spec-sync(commit-msg hard)가 이를 강제하므로, 이 스킬이 정공법이다.

## 절차
1. **재현 실패 테스트 작성** (Superpowers TDD RED). `@covers <SPEC-ID>/FR-NNN` 태그 유지.
2. **스펙 영향 판정** — 소유 스펙은 `Ownership.Files` glob으로 확인:
   - **FR이 바뀌는 버그**(동작 계약 수정) → 소유 스펙 FR 개정/추가.
   - **순수 구현 버그**(계약 불변) → 소유 스펙 `### Edge Cases`에 재현 조건 1줄 + `## Change Log`에 행 추가(`| YYYY-MM-DD | <무엇> | <왜/커밋> |`).
3. **GREEN** — 최소 수정으로 테스트 통과.
4. **게이트**: `node scripts/check-fr-coverage.mjs` · `check-ownership.mjs` · `check-spec-sync.mjs`(commit-msg가 자동 실행) 통과.
5. **사람 승인** 후 머지.

## 탈출구 (정직)
- 진짜 스펙 무관(포맷팅·주석)이면 커밋 메시지 트레일러 `Spec-Impact: none <사유>` — 사유 필수, 커밋에 영속.
- 급한 hotfix도 2번의 Edge Cases+Change Log 두 줄이면 게이트를 정공으로 통과한다 — 트레일러 남용 금지.
```

- [ ] **Step 2: Verify** — `sh -n` 대상 아님(md). 육안: 절차가 설계 §7과 일치, 게이트 이름 실재(`check-fr-coverage.mjs` 등), 과장 없음.

- [ ] **Step 3: Commit** `git add -A && git commit -m "feat(skill): /speckit.fix — 버그픽스 SDD 경로(스펙 착지 강제)"`

---

### Task 6: sdd-init 배선 + init-then-execute 통합 테스트

**Files:**
- Modify: `tooling/sdd-init.sh` (node 게이트 복사 목록 + commit-msg 훅 + 스킬 + package.json 스크립트)
- Test: `tooling/__tests__/init-spec-sync.test.mjs`

**Interfaces:**
- Consumes: Tasks 3–5 산출물.
- Produces: 채택 프로젝트에 `scripts/check-spec-sync.mjs`·`scripts/spec-sync-lib.mjs`·`scripts/sdd-commit-msg.sh`·`.git/hooks/commit-msg`·`.claude/skills/speckit-fix/SKILL.md`·(package.json 있으면) `check:spec-sync` 스크립트.

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/init-spec-sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sdd-init: spec-sync 게이트·lib·commit-msg 훅·스킬 배선 + 실제 실행 무crash", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-iss-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    for (const f of ["scripts/check-spec-sync.mjs", "scripts/spec-sync-lib.mjs", "scripts/sdd-commit-msg.sh", ".git/hooks/commit-msg", ".claude/skills/speckit-fix/SKILL.md"])
      assert.ok(existsSync(join(root, f)), `${f} 설치`);
    // init-then-execute: 설치물만으로 range 모드 실행 — MODULE_NOT_FOUND 금지
    const r = (() => { try { return { code: 0, out: execFileSync("node", [join(root, "scripts/check-spec-sync.mjs")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; } })();
    assert.ok(!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(r.out), r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-init: package.json 있으면 check:spec-sync 스크립트 추가(병합, 기존 보존)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-pkg-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc" } }, null, 2));
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts.build, "tsc"); // 기존 보존
    assert.match(pkg.scripts["check:spec-sync"] || "", /check-spec-sync/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run** — Expected: FAIL (배선 없음).

- [ ] **Step 3: Implement** — `tooling/sdd-init.sh` 편집(정확 위치는 파일 읽고 결정):
  1. node 게이트 복사 for-loop 목록에 `check-spec-sync.mjs spec-sync-lib.mjs` 추가.
  2. 하네스 설치 블록(`--gate=node`)에:

```sh
copy "$KIT/tooling/harness/commit-msg" "$T/scripts/sdd-commit-msg.sh"
mkdir -p "$T/.claude/skills/speckit-fix"
copy "$KIT/tooling/harness/speckit-fix.SKILL.md" "$T/.claude/skills/speckit-fix/SKILL.md"
if [ -d "$T/.git" ]; then
  printf '#!/bin/sh\nsh scripts/sdd-commit-msg.sh "$1"\n' > "$T/.git/hooks/commit-msg"
  chmod +x "$T/.git/hooks/commit-msg"
fi
# package.json 있으면 check:spec-sync 스크립트 병합(node로 — jq 불요, 기존 보존)
if [ -f "$T/package.json" ]; then
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));p.scripts=p.scripts||{};p.scripts["check:spec-sync"]=p.scripts["check:spec-sync"]||"node scripts/check-spec-sync.mjs";fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+"\n");' "$T/package.json"
fi
```

  3. 비-node 게이트(`sh|py|go`) 경로에 경고 1줄(§10.1): `say "  ⚠ spec-sync는 Node 필요 — --gate=node 또는 node 설치 후 재실행(ROADMAP 포팅 참조)"`.

- [ ] **Step 4: Run** — Expected: PASS (2 tests). 전체 글로브 1회(기존 init 테스트 포함 회귀 없음).

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(init): spec-sync 게이트·commit-msg 훅·speckit-fix 스킬·package.json 배선 + init-then-execute"`

---

### Task 7: sdd-sync R2 배선 + HARNESS.md

**Files:**
- Modify: `tooling/sdd-sync.mjs` (R2 gates), `HARNESS.md` (R2 행)
- Test: `tooling/__tests__/sdd-sync.test.mjs` (기존 확장)

**Interfaces:** Consumes: check-spec-sync range 모드(인자 없음 기본 — sdd-sync는 무인자 실행).

- [ ] **Step 1: Write the failing test** — 기존 sdd-sync 테스트에 추가: R2 리포트 라인에 `check-spec-sync.mjs`가 나타나는지(clean 픽스처에서 `[check-spec-sync.mjs]` 문자열 존재 assert).

```javascript
test("R2에 check-spec-sync(range)가 배선됨", () => {
  const dir = fixture({ /* 기존 clean 픽스처 재사용 */ });
  const r = run(dir);
  assert.match(r.out, /check-spec-sync\.mjs/);
});
```
(기존 파일의 `fixture`/`run` 헬퍼와 clean 픽스처 내용을 그대로 재사용 — 파일 열어 동일 패턴으로.)

- [ ] **Step 2: Run** — Expected: FAIL (R2 gates에 없음).

- [ ] **Step 3: Implement**
  - `tooling/sdd-sync.mjs` RULES의 R2 행: `gates: ["check-converge-drift.mjs", "check-orphan-surfaces.mjs", "check-spec-sync.mjs"]`.
  - `HARNESS.md` R2 행의 Detect 열: `` `check-converge-drift`·`check-orphan-surfaces`·`check-spec-sync`(range) `` 로 갱신.
  - **주의:** sdd-sync 테스트 픽스처에 스펙이 있으면 range 모드가 base(origin/main) 해석 불가 → "건너뜀" 출력 — 그래도 clean 판정 유지 확인(⚠ 미포함 확인).

- [ ] **Step 4: Run** — Expected: PASS. 전체 글로브 1회.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(harness): sdd-sync R2에 check-spec-sync(range) 배선 + HARNESS.md"`

---

### Task 8: 템플릿·Constitution·방법론 문서

**Files:**
- Modify: `templates/module-spec.md`(Ownership에 Files 필드 + Edge Cases/Change Log 필수화 주석), `templates/constitution.md`(원칙 I 강화), `STRUCTURE.md`·`DEDUP.md`(Files 완전성·INFRA config 소유 관행), `METHODOLOGY.md`(버그픽스=/speckit.fix)
- Test: 게이트 스윕(문서 태스크)

- [ ] **Step 1: templates/module-spec.md** — `## Ownership` 블록의 Capabilities 줄 다음에:

```markdown
- **Files**: [이 spec이 소유하는 코드 파일 glob — 예: `src/lib/<feature>/**, src/app/api/<feature>/**`. **`**`·`*`만 지원**(중괄호·`?`·`[` 금지), 콤마 구분, 인라인 주석 금지. route뿐 아니라 그 기능의 라이브러리까지 빠짐없이(§Files 완전성). check-spec-sync가 이 glob으로 코드→스펙 동반을 강제]
```
  `### Edge Cases`와 `## Change Log`에 필수화 주석 1줄씩: `<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->`

- [ ] **Step 2: templates/constitution.md** — 원칙 I(Spec=SSOT) 본문에 추가:

```markdown
owned Files의 코드 변경은 동일 changeset(브랜치)에 스펙 변경(FR·Edge Case·Change Log)을 동반한다. 순수 기계적/버그픽스 변경도 Edge Case+Change Log 항목을 남긴다(`/speckit.fix`). `check-spec-sync` 게이트(commit-msg hard)가 강제하며, 예외는 `Spec-Impact: none <사유>` 트레일러로만(커밋에 영속).
```

- [ ] **Step 3: STRUCTURE.md·DEDUP.md·METHODOLOGY.md** — 각 1~2단락:
  - STRUCTURE: Files 완전성(라이브러리까지) + 과광역 glob 경고(AND 부담) + INFRA 스펙의 config 파일 소유 관행(§6.3·§9 — 설계 문서 문구 복사).
  - DEDUP: `Files:`는 dedup 대상 아님(매핑 전용, ownershipCategories 추가 금지) 명시.
  - METHODOLOGY: 0~8 루프 아래 "버그픽스는 `/speckit.fix`(§7)" 1줄 + spec⇄code 동기화 절에 check-spec-sync 언급.

- [ ] **Step 4: Run** `node --test tooling/__tests__/*.mjs` — Expected: 전량 PASS(문서만 변경).

- [ ] **Step 5: Commit** `git add -A && git commit -m "docs: Files 필드·필수화·Files 완전성·spec-first 원칙(템플릿·constitution·STRUCTURE·DEDUP·METHODOLOGY)"`

---

### Task 9: 사용법·데모 실측 — APPLYING·방법론.html·README·ROADMAP

**Files:**
- Modify: `APPLYING.md`(궤도 운영법에 commit-msg 단계 + spec-sync 출력 실측), `방법론.html`(spec-first 섹션: Files·check-spec-sync·speckit.fix — 기존 스타일·파일명 유지, **index.html로 rename 금지**), `README.md`(구성표), `ROADMAP.md`(spec-first 완료 이동)
- Test: 데모 실측 + 게이트 스윕

- [ ] **Step 1: 데모 실측(REALITY_CHECK)** — 임시 레포에서 실제로:

```bash
# Task 3 테스트 픽스처 방식으로 임시 레포 구성 후:
node scripts/check-spec-sync.mjs --staged --message-file msg   # FAIL 출력 캡처
# Change Log 행 추가 후 재실행                                    # PASS 출력 캡처
```
캡처한 **실제 출력**을 APPLYING·방법론.html 예시에 사용(추측 금지).

- [ ] **Step 2: APPLYING.md** — "채택 후 궤도 한 바퀴"의 커밋 단계에 commit-msg(spec-sync hard) 추가 + 실측 출력 + `/speckit.fix`·`Spec-Impact` 해소법. pre-commit(fr·ownership)과 commit-msg(spec-sync)가 **다른 훅**임을 명시.

- [ ] **Step 3: 방법론.html** — `#determinism`/`#orbit` 스타일에 맞춰 spec-first 섹션 추가: Files 소유매핑 그림(코드 파일→glob→스펙), 3분류 표(기능/hotfix/무관), changeset=브랜치 설명, `/speckit.fix` 흐름, 실측 출력. 태그 균형 확인.

- [ ] **Step 4: README.md·ROADMAP.md** — README 구성표에 spec-first 한 줄(HARNESS 항목 갱신), ROADMAP "진행 중"의 spec-first를 ✅ 완료로 이동(커밋 범위 기입).

- [ ] **Step 5: Run** `node --test tooling/__tests__/*.mjs` — Expected: 전량 PASS.

- [ ] **Step 6: Commit** `git add -A && git commit -m "docs: spec-first 사용법·데모 실측(APPLYING·방법론.html·README·ROADMAP)"`

---

## Self-Review 결과

- **Spec 커버리지:** 설계 §4(Files·glob)→T2·T8, §5.1~5.8(게이트)→T3, §5.6(훅)→T4, §6(3분류·AND·partial·6.3)→T3·T8, §7(/speckit.fix)→T5, §8(constitution·템플릿)→T8, §9(완전성)→T8, §10(배선·10.1 경고)→T6, §11(sdd-sync·HARNESS)→T7, §12(정직)→T8·T9, §13(검증)→T2·T3·T4·T6 테스트+T9 데모, §14(마이그레이션)→T8 템플릿+T9 APPLYING 노트.
- **Placeholder:** 코드 스텝 전부 완전 코드. T8·T9 문서 문구는 설계 §의 확정 문구 복사 지시(문구 실재).
- **타입/이름 일관성:** `compileGlob`/`scanFilesLineIssues`/`stripInlineComment`/`hasMeaningfulSpecChange`(T2 정의=T3 소비), `check-spec-sync.mjs`·`spec-sync-lib.mjs`·`sdd-commit-msg.sh` 경로가 T3~T7에서 일치. `parseSection(text,"Ownership",["Files"])` 시그니처는 기존 lib과 일치.
- **경계:** Task 3 Step 3 코드의 `git show` 경로 주입은 스펙 파일명 규약(공백 없음)으로 안전 — 구현 시 그대로.
