# 방법론 실질 빈칸 게이트 3종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SDD 키트가 기계적으로 못 닫던 3개 빈칸 — ① 빈 껍데기 테스트(거짓 green) ② converge 미실행 drift ③ 스펙 없는 코드(orphan surface) — 를 잡는 게이트 3종을 키트에 추가한다.

**Architecture:** 기존 config 구동 게이트(`sdd-config.mjs` 로더)와 동일 패턴의 Node 스크립트 3개를 추가한다. 전부 **기본 advisory(warn, exit 0)** — 기존 incremental 철학대로 빌드를 깨지 않고 가시화부터. `--strict`로 차단 승격. 테스트는 의존성 0(`node:test`+`node:assert`+임시 픽스처). 다중 런타임(셸/Python/Go) 포팅은 Task 4(별도).

**Tech Stack:** Node 20+ ESM, 기존 `tooling/sdd-config.mjs`(loadConfig/resolveFromRoot/isTestFile/`__coversRe`), `node:test`.

## Global Constraints

- 새 게이트는 **기존 게이트와 같은 구조**: `tooling/<name>.mjs`, `import {...} from "./sdd-config.mjs"`, `--strict` 플래그, config 구동(하드코딩 금지 — 언어/경로/접두어는 `sdd.config.json`에서).
- **기본 advisory**: 위반은 warn + exit 0. `--strict`에서만 exit 1.
- 새 config 키 추가 시 `tooling/sdd-config.mjs`의 `DEFAULTS`에 **하위호환 기본값**과 함께 등록(없어도 기존 동작 불변).
- 테스트는 **의존성 0**: `node:test` + `node:assert/strict`, 임시 디렉토리(`node:fs` mkdtempSync)에 픽스처 생성 후 `execSync`로 게이트 실행, exit code·stdout 검증.
- 출력 형식은 기존 게이트 톤 유지(`<name> gate — … config:<tag>` + `  · …` + `✓`/`✗`).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: 테스트 적정성 게이트 (빈 껍데기 @covers 차단)

`@covers` 태그만 달고 단언(assertion)이 없는 테스트 파일을 잡는다. FR↔test 게이트의 "거짓 green"(태깅됨 ≠ 의미 있음)을 보완. 파일 단위 coarse 검사(단언 토큰 ≥1 존재).

**Files:**
- Create: `tooling/check-test-adequacy.mjs`
- Modify: `tooling/sdd-config.mjs` (DEFAULTS에 `assertionPatterns` 추가)
- Test: `tooling/__tests__/check-test-adequacy.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()`, `resolveFromRoot(cfg, rel)`, `isTestFile(name, cfg)`, `cfg.__root`, `cfg.scanDirs`, `cfg.ignoreDirs` (기존 `sdd-config.mjs` export).
- Produces: 실행형 게이트 `node tooling/check-test-adequacy.mjs [--strict]`. 새 config 키 `assertionPatterns: string[]`(정규식 소스, 기본값은 아래).

- [ ] **Step 1: config에 assertionPatterns 기본값 추가 (TDD 전 준비)**

`tooling/sdd-config.mjs`의 `DEFAULTS` 객체에 `ownershipCategories` 다음 줄에 추가:

```js
  // 테스트 "단언" 토큰 정규식(test-adequacy 게이트용). 언어 무관 폭넓은 기본값.
  assertionPatterns: [
    "\\b(expect|assert|assertEquals|assertThat|should)\\b",
    "\\bt\\.(Error|Fatal|Errorf|Fatalf)\\b",
    "\\b(require|assert)\\.",
  ],
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tooling/__tests__/check-test-adequacy.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-test-adequacy.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-adq-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

test("@covers 있고 단언 있으면 통과", () => {
  const dir = fixture({
    "sdd.config.json": JSON.stringify({ scanDirs: ["tests"] }),
    "tests/a.test.ts": `// @covers SPEC-001/FR-001\ntest("x", () => { expect(1).toBe(1); });`,
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK/);
});

test("@covers 있는데 단언 없으면 strict에서 실패", () => {
  const dir = fixture({
    "sdd.config.json": JSON.stringify({ scanDirs: ["tests"] }),
    "tests/empty.test.ts": `// @covers SPEC-001/FR-001\ntest("x", () => {});`,
  });
  const warn = run(dir);          // 기본 advisory → exit 0
  assert.equal(warn.code, 0);
  assert.match(warn.out, /empty\.test\.ts/);
  const strict = run(dir, ["--strict"]);
  assert.equal(strict.code, 1);
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `node --test tooling/__tests__/check-test-adequacy.test.mjs`
Expected: FAIL — `check-test-adequacy.mjs` 없음(MODULE_NOT_FOUND).

- [ ] **Step 4: 게이트 구현**

`tooling/check-test-adequacy.mjs`:

```js
#!/usr/bin/env node
// ─── Test adequacy gate (level 1) ─────────────────────────
// @covers 태그를 단 테스트 파일이 단언(assertion)을 하나도 안 하면 잡는다.
// FR↔test 게이트는 "태깅됨"만 보므로 빈 껍데기 테스트가 거짓 green을 만든다 —
// 이 게이트가 그 틈을 메운다. 파일 단위 coarse 검사(단언 토큰 ≥1).
// 기본 advisory(warn, exit 0), --strict에서 exit 1. config: assertionPatterns.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, isTestFile } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const SCAN_DIRS = cfg.scanDirs.map((d) => resolveFromRoot(cfg, d));
const IGNORE = new Set(cfg.ignoreDirs);
const STRICT = process.argv.includes("--strict");
const ASSERT = cfg.assertionPatterns.map((s) => new RegExp(s));

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else if (isTestFile(name, cfg)) acc.push(p);
  }
  return acc;
}

const offenders = [];
let withCovers = 0;
for (const dir of SCAN_DIRS) {
  for (const f of walk(dir)) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("@covers")) continue;
    withCovers++;
    if (!ASSERT.some((re) => re.test(text))) offenders.push(f.replace(ROOT + "/", ""));
  }
}

const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
console.log(`Test adequacy gate — @covers files:${withCovers} no-assertion:${offenders.length} mode:${STRICT ? "strict" : "advisory"} config:${cfgTag}`);
for (const o of offenders) console.log(`  · ${o}: @covers 있으나 단언 없음(빈 껍데기 의심)`);
if (offenders.length && STRICT) {
  console.error("\n✗ test adequacy 위반(strict): 위 파일에 단언 추가 또는 @covers 제거");
  process.exit(1);
}
console.log("Test adequacy gate: OK");
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `node --test tooling/__tests__/check-test-adequacy.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: 커밋**

```bash
git add tooling/check-test-adequacy.mjs tooling/sdd-config.mjs tooling/__tests__/check-test-adequacy.test.mjs
git commit -m "feat(gate): add test-adequacy gate (empty @covers test detection)"
```

---

### Task 2: converge-drift 게이트 (코드 변경 ↔ 스펙 무변경 탐지)

PR/변경 범위에서 코드(scanDirs)는 바뀌었는데 스펙(specDir)은 안 바뀌었으면 경고 — bottom-up drift(hotfix 후 `/converge` 미실행)를 가시화.

**Files:**
- Create: `tooling/check-converge-drift.mjs`
- Test: `tooling/__tests__/check-converge-drift.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()`, `cfg.__root`, `cfg.scanDirs`, `cfg.specDir`.
- Produces: `node tooling/check-converge-drift.mjs [<base-ref>] [--strict]`. base 기본 = env `SDD_DIFF_BASE` 또는 `origin/main`. git 불가 시 skip(exit 0).

- [ ] **Step 1: 실패하는 테스트 작성**

`tooling/__tests__/check-converge-drift.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-converge-drift.mjs", import.meta.url).pathname;

function git(dir, args) { execFileSync("git", args, { cwd: dir, stdio: "ignore" }); }
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "sdd-cv-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "sdd/specs"), { recursive: true });
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ scanDirs: ["src"], specDir: "sdd/specs" }));
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "sdd/specs/SPEC-001.md"), "**Spec**: `SPEC-001`\n");
  git(dir, ["add", "-A"]); git(dir, ["commit", "-qm", "base"]);
  git(dir, ["branch", "-M", "main"]);
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("코드만 바뀌고 스펙 무변경 → advisory 경고(exit 0), strict 실패", () => {
  const dir = repo();
  writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "hotfix"], { cwd: dir });
  const warn = run(dir, ["main"]);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /스펙 무변경|drift/);
  const strict = run(dir, ["main", "--strict"]);
  assert.equal(strict.code, 1);
});

test("코드와 스펙 함께 변경 → 통과", () => {
  const dir = repo();
  writeFileSync(join(dir, "src/a.ts"), "export const a = 3;\n");
  writeFileSync(join(dir, "sdd/specs/SPEC-001.md"), "**Spec**: `SPEC-001`\nupdated\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "feat+spec"], { cwd: dir });
  const r = run(dir, ["main"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK/);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node --test tooling/__tests__/check-converge-drift.test.mjs`
Expected: FAIL — 게이트 파일 없음.

- [ ] **Step 3: 게이트 구현**

`tooling/check-converge-drift.mjs`:

```js
#!/usr/bin/env node
// ─── Converge-drift gate ──────────────────────────────────
// 변경 범위에 코드(scanDirs)는 있는데 스펙(specDir)은 없으면 경고.
// hotfix 후 /converge 미실행으로 스펙↔코드가 벌어지는 이음매를 가시화.
// 기본 advisory(exit 0), --strict에서 exit 1. git 없으면 skip.
import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";

const cfg = loadConfig();
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const base = args.find((a) => !a.startsWith("--")) || process.env.SDD_DIFF_BASE || "origin/main";

let changed;
try {
  changed = execSync(`git diff --name-only ${base}...HEAD`, { cwd: cfg.__root, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
} catch {
  console.log(`· converge-drift: git diff(${base}) 불가 — 건너뜀`);
  process.exit(0);
}

const inDir = (p, d) => p === d || p.startsWith(d.replace(/\/$/, "") + "/");
const codeChanged = changed.filter((p) => cfg.scanDirs.some((d) => inDir(p, d)));
const specChanged = changed.some((p) => inDir(p, cfg.specDir));

console.log(`Converge-drift gate — base:${base} changed:${changed.length} code:${codeChanged.length} spec-changed:${specChanged} mode:${STRICT ? "strict" : "advisory"}`);
if (codeChanged.length && !specChanged) {
  console.log(`  · 코드 ${codeChanged.length}건 변경인데 스펙 무변경 — /converge 로 갭 표면화 후 spec 갱신 검토`);
  for (const p of codeChanged.slice(0, 10)) console.log(`    - ${p}`);
  if (STRICT) { console.error("\n✗ converge-drift(strict): 스펙 동반 변경 또는 의도적 면제 필요"); process.exit(1); }
}
console.log("Converge-drift gate: OK");
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node --test tooling/__tests__/check-converge-drift.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
git add tooling/check-converge-drift.mjs tooling/__tests__/check-converge-drift.test.mjs
git commit -m "feat(gate): add converge-drift gate (code-changed-without-spec detection)"
```

---

### Task 3: orphan-surface 게이트 (스펙 없는 코드 표면 탐지 = 역-커버리지)

`surfaceGlobs`로 지정한 "표면 파일"(라우트/엔트리포인트 등) 각각이 어떤 스펙의 `## Ownership` Surfaces에 의해 소유되는지 확인. 안 잡히면 고아(스펙 없는 코드) 경고.

**Files:**
- Create: `tooling/check-orphan-surfaces.mjs`
- Modify: `tooling/sdd-config.mjs` (DEFAULTS에 `surfaceGlobs` 추가, 기본 `[]`=비활성)
- Test: `tooling/__tests__/check-orphan-surfaces.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()`, `resolveFromRoot`, `cfg.__root`, `cfg.specDir`. Ownership 파싱은 이 파일 안에서 자체 구현(아래 `parseSurfaces`).
- Produces: `node tooling/check-orphan-surfaces.mjs [--strict]`. config 키 `surfaceGlobs: string[]`(파일 경로 매칭 정규식). 빈 배열이면 게이트 no-op(통과).

- [ ] **Step 1: config에 surfaceGlobs 기본값 추가**

`tooling/sdd-config.mjs`의 `DEFAULTS`에 `assertionPatterns` 다음 줄에 추가:

```js
  // orphan-surface 게이트가 "표면 파일"로 볼 경로 정규식. 기본 [] = 게이트 비활성.
  // 예(Next.js): ["src/app/.*/route\\.ts$", "src/app/.*/page\\.tsx$"]
  surfaceGlobs: [],
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tooling/__tests__/check-orphan-surfaces.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-orphan-surfaces.mjs", import.meta.url).pathname;

function fixture(cfg, files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-orph-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify(cfg));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const CFG = { specDir: "sdd/specs", surfaceGlobs: ["src/app/.*/route\\.ts$"] };

test("표면이 스펙 Ownership에 선언돼 있으면 통과", () => {
  const dir = fixture(CFG, {
    "src/app/api/chat/route.ts": "export function POST() {}",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src/app/api/chat/route.ts\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK/);
});

test("스펙에 없는 표면 → advisory 경고(exit 0), strict 실패", () => {
  const dir = fixture(CFG, {
    "src/app/api/orphan/route.ts": "export function GET() {}",
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n## Ownership\n- **Surfaces**: src/app/api/chat/route.ts\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /orphan\/route\.ts/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `node --test tooling/__tests__/check-orphan-surfaces.test.mjs`
Expected: FAIL — 게이트 파일 없음.

- [ ] **Step 4: 게이트 구현**

`tooling/check-orphan-surfaces.mjs`:

```js
#!/usr/bin/env node
// ─── Orphan-surface gate (reverse coverage) ───────────────
// surfaceGlobs로 지정한 "표면 파일"이 어떤 스펙의 ## Ownership Surfaces에
// 선언돼 있는지 확인. 없으면 스펙 없는 코드(고아) 경고 — "spec=SSOT"의 역방향.
// surfaceGlobs 비면 no-op. 기본 advisory(exit 0), --strict에서 exit 1.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const ROOT = cfg.__root;
const STRICT = process.argv.includes("--strict");
const globs = (cfg.surfaceGlobs ?? []).map((s) => new RegExp(s));

if (!globs.length) { console.log("Orphan-surface gate: surfaceGlobs 미설정 — no-op"); process.exit(0); }

// 1. 모든 스펙의 Ownership Surfaces 키 수집(소문자 정규화).
const norm = (s) => s.trim().toLowerCase();
const declared = new Set();
const specDir = resolveFromRoot(cfg, cfg.specDir);
for (const f of (() => { try { return readdirSync(specDir); } catch { return []; } })()) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(join(specDir, f), "utf8");
  const m = text.match(/-\s*\*\*Surfaces\*\*\s*:\s*([^\n]+)/i);
  if (m) for (const k of m[1].split(",")) { const v = norm(k); if (v && !v.startsWith("[") && v !== "—") declared.add(v); }
}

// 2. 표면 파일 수집(ROOT 상대경로, surfaceGlobs 매칭).
const IGNORE = new Set(cfg.ignoreDirs);
function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}
const orphans = [];
let surfaces = 0;
for (const p of walk(ROOT)) {
  const rel = p.replace(ROOT + "/", "");
  if (!globs.some((re) => re.test(rel))) continue;
  surfaces++;
  // 표면이 선언 집합 중 하나와 일치(부분 일치 허용 — 선언은 경로로 표기)
  const claimed = [...declared].some((d) => d === norm(rel) || norm(rel).includes(d) || d.includes(norm(rel)));
  if (!claimed) orphans.push(rel);
}

console.log(`Orphan-surface gate — surfaces:${surfaces} declared:${declared.size} orphans:${orphans.length} mode:${STRICT ? "strict" : "advisory"}`);
for (const o of orphans) console.log(`  · ${o}: 어떤 스펙 Ownership(Surfaces)에도 없음 → 스펙 누락 의심`);
if (orphans.length && STRICT) { console.error("\n✗ orphan-surface(strict): 표면을 소유하는 스펙 작성 또는 Ownership 등록"); process.exit(1); }
console.log("Orphan-surface gate: OK");
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `node --test tooling/__tests__/check-orphan-surfaces.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: 커밋**

```bash
git add tooling/check-orphan-surfaces.mjs tooling/sdd-config.mjs tooling/__tests__/check-orphan-surfaces.test.mjs
git commit -m "feat(gate): add orphan-surface gate (spec-less code detection)"
```

---

### Task 4: 키트 통합 — CI 예시·문서·다중 런타임 메모

세 게이트를 키트 문서/CI 예시에 엮고, 다중 런타임 포팅 범위를 명시한다.

**Files:**
- Modify: `tooling/ci-examples.md` (게이트 명령 표에 3종 추가)
- Modify: `tooling/sdd-gates.yml` (선택 스텝으로 3종 추가, 주석)
- Modify: `SSOT.md` (§4 근처에 "보강 게이트 3종 = advisory" 한 단락)
- Modify: `principles.md` §10 또는 REALITY_CHECK (검증 결과 기록)

- [ ] **Step 1: ci-examples.md 게이트 표에 행 추가**

`## 게이트 명령` 표에 세 줄 추가(런타임 4판 중 Node 열만 채우고 나머지는 "Node 우선, 포팅 예정" 표기):

```
| 테스트 적정성 | `node check-test-adequacy.mjs` | (포팅 예정) |
| converge drift | `node check-converge-drift.mjs [base]` | (포팅 예정) |
| orphan surface | `node check-orphan-surfaces.mjs` | (포팅 예정) |
```

- [ ] **Step 2: sdd-gates.yml에 선택 스텝(주석) 추가**

기존 strict 승격 주석 아래에:

```yaml
      # 보강 게이트(advisory — 빌드 안 깸; 익으면 --strict 승격):
      # - run: node scripts/check-test-adequacy.mjs
      # - run: node scripts/check-converge-drift.mjs ${{ github.event.pull_request.base.ref || 'origin/main' }}
      # - run: node scripts/check-orphan-surfaces.mjs
```

- [ ] **Step 3: SSOT.md에 한 단락**

`## 4` 끝에 추가:

```markdown
> **보강 게이트(advisory):** test-adequacy(빈 껍데기 @covers)·converge-drift(코드↔스펙)·orphan-surface(스펙 없는 코드)는 §방법론 한계를 *부분* 기계화한다. 기본 warn(빌드 안 깸), 익으면 `--strict`. 의미적 중복·스펙 정확성은 여전히 사람 몫.
```

- [ ] **Step 4: 전체 테스트 + 기존 게이트 회귀 확인**

Run:
```bash
node --test tooling/__tests__/
node tooling/check-fr-coverage.mjs   # 기존 게이트 회귀 없음 확인(exit 0/정상 출력)
```
Expected: 새 테스트 6 PASS, 기존 게이트 정상.

- [ ] **Step 5: 다중 런타임 포팅 — 범위 메모(구현 아님)**

`docs/superpowers/plans/`에 후속 메모 추가 또는 이 파일 하단에 기록: "3종을 셸/Python/Go판에 포팅해 4판 패리티 달성"은 별도 계획. 현재는 Node 레퍼런스 + advisory로 가치 검증 우선.

- [ ] **Step 6: 커밋**

```bash
git add tooling/ci-examples.md tooling/sdd-gates.yml SSOT.md docs/superpowers/plans/
git commit -m "docs(gate): wire 3 reinforcement gates into CI examples + SSOT"
```

---

## Self-Review

- **Spec coverage:** 빈칸 3개(테스트 적정성·converge drift·orphan surface) 각각 Task 1/2/3, 통합 Task 4. ✓
- **Placeholder scan:** 모든 코드 스텝에 완전 코드 포함, TODO 없음. ✓ (Task 4 Step 5는 "구현 아님 — 범위 메모"로 명시적 비구현.)
- **Type consistency:** 세 게이트 모두 `loadConfig()`·`resolveFromRoot`·`isTestFile`·`cfg.__root`/`cfg.__path`/`cfg.scanDirs`/`cfg.specDir`/`cfg.ignoreDirs`만 사용 — 기존 `sdd-config.mjs` export와 일치. 새 키 `assertionPatterns`·`surfaceGlobs`는 Task 1/3 Step 1에서 DEFAULTS 등록. ✓

## 알려진 한계 (이 계획이 닫지 *못*하는 것)
- test-adequacy는 **파일 단위**(단언 토큰 존재)라 "단언은 있지만 무의미"는 못 잡음 → 진짜 적정성은 mutation testing(`commands`에 stryker/mutmut 연결)로 별도.
- orphan-surface는 **경로 표기 표면**에만 동작(surfaceGlobs 설정 필요). route가 아닌 능력(라이브러리 함수)엔 부적합.
- converge-drift는 **휴리스틱**(코드↔스펙 동시 변경 여부)이라 의도적 무관 변경엔 오탐 가능 → advisory 기본이 맞음.
