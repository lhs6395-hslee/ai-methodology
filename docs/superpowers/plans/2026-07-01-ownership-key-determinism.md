# Ownership 키 결정성 게이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dedup의 입력(키·spec 경계)을 결정적으로 만든다 — 정규화 절대규칙·소유/참조 분리·PREFIX 거버넌스를 게이트로 강제.

**Architecture:** 공통 키 라이브러리(`ownership-keys.mjs`: 파싱·정규화·형식검증)를 만들고 `check-ownership`·`check-spec-cohesion`·`check-spec-consistency`가 공유(현재 `parseOwnership`이 두 파일에 중복 — 이번에 DRY 통합). 전부 config 구동. Node판부터 구현(Go·셸·Python 포팅은 ROADMAP).

**Tech Stack:** Node ESM(`.mjs`), `node --test`, `sdd.config.json`.

## Global Constraints

- **언어중립:** 게이트는 텍스트 파서, Node 런타임만 요구(대상 프로젝트 언어 무관).
- **하위호환:** `sdd.config.json` 없으면/필드 없으면 기존 동작. 기존 `## Ownership`은 "소유"로 해석.
- **강제력:** dedup(정규화 후 유일성)·PREFIX 화이트리스트·사유 누락 = `exit 1`. 형식위반(verb/점표기/경로) = 기본 warn, `--strict`에서 `exit 1`. 일관성(근거 없는 키) = advisory(warn).
- **테스트 실행:** `node --test tooling/__tests__/*.mjs` — **글로브 형식**(디렉토리 형식 `node --test tooling/__tests__/`는 Node v25에서 실패).
- **정본 언어 영어, 방법론 문서 한국어 유지.**
- **표준 PREFIX = `SPEC`·`INFRA`·`TEST`.** 그 밖은 `prefixRationale` 사유 필수.

---

### Task 1: config 스키마 확장 (`sdd-config.mjs`)

**Files:**
- Modify: `tooling/sdd-config.mjs` (DEFAULTS + 파생값)
- Test: `tooling/__tests__/sdd-config.test.mjs` (없으면 Create)

**Interfaces:**
- Produces: `cfg.specIdPrefixes`(기본 `["SPEC","INFRA","TEST"]`) · `cfg.prefixRationale`(기본 `{}`) · `cfg.capabilityVerbs`(기본 `[]`) · `cfg.surfacePathParam`(기본 `"{name}"`) · `cfg.__crudVerbs`(파생: `["create","read","update","delete","list"]`) · `cfg.__allVerbs`(파생: crud + capabilityVerbs, 소문자 Set)

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/sdd-config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../sdd-config.mjs";

test("config: 새 필드 기본값", () => {
  const cfg = loadConfig("/nonexistent"); // config 파일 없음 → DEFAULTS
  assert.deepEqual(cfg.specIdPrefixes, ["SPEC", "INFRA", "TEST"]);
  assert.deepEqual(cfg.prefixRationale, {});
  assert.deepEqual(cfg.capabilityVerbs, []);
  assert.equal(cfg.surfacePathParam, "{name}");
});

test("config: verb 파생값(crud + 도메인)", () => {
  const cfg = loadConfig("/nonexistent");
  assert.ok(cfg.__allVerbs.has("create"));
  assert.ok(cfg.__allVerbs.has("list"));
  assert.equal(cfg.__allVerbs.has("recommend"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/sdd-config.test.mjs`
Expected: FAIL — `specIdPrefixes`가 `["SPEC"]`(기존 기본값), `__allVerbs` undefined.

- [ ] **Step 3: Write minimal implementation**

`tooling/sdd-config.mjs`의 `DEFAULTS`에서 `specIdPrefixes: ["SPEC"]`를 아래로 변경하고 새 필드 추가:

```javascript
  specIdPrefixes: ["SPEC", "INFRA", "TEST"],   // 표준 3종(§5.1) — 그 밖은 prefixRationale 필수
  prefixRationale: {},                          // 표준 밖 접두어 → 도입 사유(빈 값이면 게이트 exit 1)
  capabilityVerbs: [],                          // CRUD 기본에 더할 도메인 verb
  surfacePathParam: "{name}",                   // Surface path param 표준 표기
```

`loadConfig`의 파생값 블록(`cfg.__coversRe = ...` 다음)에 추가:

```javascript
  const CRUD = ["create", "read", "update", "delete", "list"];
  cfg.__crudVerbs = CRUD;
  cfg.__allVerbs = new Set(
    [...CRUD, ...(cfg.capabilityVerbs || [])].map((v) => String(v).trim().toLowerCase())
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/sdd-config.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add tooling/sdd-config.mjs tooling/__tests__/sdd-config.test.mjs
git commit -m "feat(config): PREFIX 표준·prefixRationale·capabilityVerbs·surfacePathParam"
```

---

### Task 2: 공통 키 라이브러리 (`ownership-keys.mjs`)

**Files:**
- Create: `tooling/ownership-keys.mjs`
- Test: `tooling/__tests__/ownership-keys.test.mjs`

**Interfaces:**
- Consumes: `cfg`(Task 1의 `__allVerbs`·`surfacePathParam`·`ownershipCategories`)
- Produces:
  - `parseSection(text, heading, categories)` → `{ [category]: string[] }`  (`## Ownership` 또는 `## Dependencies` 파싱)
  - `normalizeKey(category, raw, cfg)` → `string`  (카테고리별 결정적 정규화)
  - `validateKey(category, key, cfg)` → `string|null`  (형식 위반이면 이유 문자열, OK면 null)

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/ownership-keys.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSection, normalizeKey, validateKey } from "../ownership-keys.mjs";
import { loadConfig } from "../sdd-config.mjs";

const cfg = { ...loadConfig("/nonexistent"), capabilityVerbs: ["recommend"] };
cfg.__allVerbs = new Set(["create","read","update","delete","list","recommend"]);
const CATS = ["Entities", "Surfaces", "Capabilities"];

test("parseSection: Ownership과 Dependencies를 구분해 읽는다", () => {
  const text = [
    "## Ownership",
    "- **Entities**: recommendation",
    "- **Capabilities**: staff.recommend",
    "## Dependencies",
    "- **Entities**: staff, project",
  ].join("\n");
  const own = parseSection(text, "Ownership", CATS);
  const dep = parseSection(text, "Dependencies", CATS);
  assert.deepEqual(own.Entities, ["recommendation"]);
  assert.deepEqual(dep.Entities, ["staff", "project"]);
  assert.deepEqual(own.Capabilities, ["staff.recommend"]);
});

test("normalizeKey: Surface = 메서드 대문자 + 경로 소문자 + param 표준형 + trailing slash 제거", () => {
  assert.equal(normalizeKey("Surfaces", "post /api/Recommend/:id/", cfg), "POST /api/recommend/{id}");
});

test("normalizeKey: Capability = 소문자, 점표기 유지", () => {
  assert.equal(normalizeKey("Capabilities", "Staff.Recommend", cfg), "staff.recommend");
});

test("normalizeKey: Entity = 소문자 그대로", () => {
  assert.equal(normalizeKey("Entities", "  Pjt_Projects ", cfg), "pjt_projects");
});

test("validateKey: 미등록 verb는 위반", () => {
  assert.equal(validateKey("Capabilities", "staff.suggest", cfg) !== null, true);
  assert.equal(validateKey("Capabilities", "staff.recommend", cfg), null);
});

test("validateKey: 점 2개 이상이면 위반", () => {
  assert.equal(validateKey("Capabilities", "a.b.c", cfg) !== null, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/ownership-keys.test.mjs`
Expected: FAIL — `ownership-keys.mjs` 없음.

- [ ] **Step 3: Write minimal implementation**

```javascript
// tooling/ownership-keys.mjs
// 공통 키 라이브러리 — 파싱·정규화·형식검증. check-ownership/cohesion/consistency 공유.
// 설계: docs/design/2026-06-30-ownership-key-derivation-design.md §4

// `## <heading>` 섹션을 잘라 카테고리별 키 배열로. 헤더 다음~다음 ## 전까지.
export function parseSection(text, heading, categories) {
  const start = text.search(new RegExp(`^##\\s+${heading}\\b`, "m"));
  const out = Object.fromEntries(categories.map((c) => [c, []]));
  if (start === -1) return out;
  const after = text.slice(start);
  const body = after.slice(after.indexOf("\n") + 1);
  const nextSec = body.search(/^##\s/m);
  const block = nextSec === -1 ? body : body.slice(0, nextSec);
  for (const cat of categories) {
    const line = block.match(new RegExp(`-\\s*\\*\\*${cat}\\*\\*\\s*:\\s*([^\\n]+)`, "i"));
    out[cat] = line
      ? line[1].split(",").map((k) => k.trim()).filter((k) => k && k !== "—" && k !== "[…]" && !k.startsWith("["))
      : [];
  }
  return out;
}

// 카테고리별 결정적 정규화(§4 표).
export function normalizeKey(category, raw, cfg) {
  const s = String(raw).trim();
  if (category === "Surfaces") {
    // "<METHOD> <path>" 또는 "event:.."/"job:.." — 메서드 대문자, path 소문자, param 표준형, trailing slash 제거
    const m = s.match(/^(\S+)\s+(.+)$/);
    if (!m) return s.toLowerCase();
    const method = m[1].toUpperCase();
    let path = m[2].toLowerCase().replace(/[:{<]([a-z0-9_]+)[>}]?/g, cfg.surfacePathParam.replace("name", "$1"));
    path = path.replace(/\/+$/, "") || "/";
    return `${method} ${path}`;
  }
  // Entity·Capability = 소문자 + 내부 공백 정리
  return s.toLowerCase().replace(/\s+/g, " ");
}

// 형식 검증 — 위반이면 이유 문자열, OK면 null.
export function validateKey(category, key, cfg) {
  if (category === "Capabilities") {
    const parts = key.split(".");
    if (parts.length !== 2) return `Capability는 entity.verb 형식(점 1개)이어야 함: "${key}"`;
    if (!cfg.__allVerbs.has(parts[1])) return `미등록 verb "${parts[1]}" — capabilityVerbs에 등록 필요: "${key}"`;
    return null;
  }
  if (category === "Surfaces") {
    if (!/^[A-Z]+ \S/.test(key) && !/^(event|job):/.test(key))
      return `Surface는 "<METHOD> <path>" 또는 "event:/job:" 형식이어야 함: "${key}"`;
    return null;
  }
  return null; // Entity는 형식 제약 없음(스키마 식별자 그대로)
}
```

> `surfacePathParam.replace("name", "$1")`: 기본 `"{name}"` → `"{$1}"`로 캡처그룹 삽입. `:id`·`{id}`·`<id>` 모두 `{id}`로.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/ownership-keys.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add tooling/ownership-keys.mjs tooling/__tests__/ownership-keys.test.mjs
git commit -m "feat(gate): 공통 키 lib — 파싱·카테고리별 정규화·형식검증"
```

---

### Task 3: `check-ownership` 강화 (Dependencies 분리 · 정규화 · 형식검증)

**Files:**
- Modify: `tooling/check-ownership.mjs`
- Test: `tooling/__tests__/check-ownership.test.mjs` (기존 확장; 없으면 Create)

**Interfaces:**
- Consumes: `parseSection`·`normalizeKey`·`validateKey`(Task 2), `cfg`(Task 1)
- Produces: (CLI) `check-ownership.mjs [--strict]` — dedup 충돌·형식위반 리포트

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/check-ownership.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(specs, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-own-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", capabilityVerbs: ["recommend"],
  }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Dependencies의 키는 dedup 대상이 아니다(거짓양성 해소)", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n## Dependencies\n- **Entities**: staff\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: staff\n"; // staff를 소유 → A는 참조라 충돌 아님
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 0, r.out);
});

test("같은 Ownership 키를 2 spec이 소유하면 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: Recommendation\n"; // 정규화 후 같은 키
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /recommendation/);
});

test("미등록 verb는 --strict에서 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Capabilities**: staff.suggest\n";
  assert.equal(run({ "SPEC-001.md": A }).code, 0);            // 기본 warn
  assert.equal(run({ "SPEC-001.md": A }, ["--strict"]).code, 1); // strict 차단
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/check-ownership.test.mjs`
Expected: FAIL — 현재 `check-ownership`은 Dependencies 개념 없음, 정규화 약함(대소문자만), 형식검증 없음.

- [ ] **Step 3: Write minimal implementation**

`tooling/check-ownership.mjs`를 공통 lib 사용으로 교체(핵심 변경부):

```javascript
import { parseSection, normalizeKey, validateKey } from "./ownership-keys.mjs";
// ... loadConfig 등 기존 유지 ...
const CATEGORIES = cfg.ownershipCategories;

const owners = Object.fromEntries(CATEGORIES.map((c) => [c, new Map()]));
const missing = [], formatIssues = [];
let declaredCount = 0;

for (const file of specFiles()) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];
  const own = parseSection(text, "Ownership", CATEGORIES);
  const hasAny = CATEGORIES.some((c) => own[c].length);
  if (!hasAny) { missing.push(specId); continue; }
  declaredCount++;
  for (const cat of CATEGORIES) {
    for (const raw of own[cat]) {
      const key = normalizeKey(cat, raw, cfg);
      const bad = validateKey(cat, key, cfg);
      if (bad) formatIssues.push({ specId, cat, bad });
      if (!owners[cat].has(key)) owners[cat].set(key, []);
      owners[cat].get(key).push(specId);
    }
  }
}
// 충돌 수집(기존 로직 유지) → conflicts
// ... 리포트 ...
if (formatIssues.length) {
  const tag = STRICT ? "✗" : "⚠";
  for (const f of formatIssues) console.log(`${tag} [${f.specId}] ${f.bad}`);
}
if (conflicts.length) { /* 기존 exit 1 */ }
if (STRICT && (missing.length || formatIssues.length)) process.exit(1);
```

> Dependencies는 파싱하되 `owners`에 넣지 않는다(dedup 제외). 형식검증은 Ownership 키에 적용.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/check-ownership.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tooling/check-ownership.mjs tooling/__tests__/check-ownership.test.mjs
git commit -m "feat(gate): check-ownership 강화 — Dependencies 분리·정규화·형식검증"
```

---

### Task 4: `check-spec-consistency` 신규 (근거 없는 키 advisory)

**Files:**
- Create: `tooling/check-spec-consistency.mjs`
- Test: `tooling/__tests__/check-spec-consistency.test.mjs`

**Interfaces:**
- Consumes: `parseSection`(Task 2), `cfg`
- Produces: (CLI) `check-spec-consistency.mjs [--strict]` — 본문에 근거 없는 키 경고

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/check-spec-consistency.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(specBody, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-cons-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  writeFileSync(join(root, "sdd", "specs", "SPEC-001.md"), specBody);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-spec-consistency.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("본문에 근거 있는 키는 clean", () => {
  const body = "# SPEC-001\nWHEN 조회, THE SYSTEM SHALL recommendation을 반환.\n## Ownership\n- **Entities**: recommendation\n";
  const r = run(body);
  assert.equal(r.code, 0);
  assert.match(r.out, /clean|OK|근거/);
});

test("본문 어디에도 없는 키는 advisory 경고(exit 0)", () => {
  const body = "# SPEC-001\nWHEN 조회, THE SYSTEM SHALL 결과 반환.\n## Ownership\n- **Entities**: ghostentity\n";
  const r = run(body);
  assert.equal(r.code, 0);              // advisory
  assert.match(r.out, /ghostentity/);
});

test("--strict에서 근거 없는 키는 exit 1", () => {
  const body = "# SPEC-001\nSHALL 결과 반환.\n## Ownership\n- **Entities**: ghostentity\n";
  assert.equal(run(body, ["--strict"]).code, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/check-spec-consistency.test.mjs`
Expected: FAIL — 파일 없음.

- [ ] **Step 3: Write minimal implementation**

```javascript
// tooling/check-spec-consistency.mjs
// FR↔Ownership 일관성(advisory) — 선언한 키의 핵심 토큰이 본문에 0회 등장하면
// "근거 없는 키" 경고. 자연어 NLP 없이 grep 근사 → 결정적·advisory.
// 설계: 2026-06-30-ownership-key-derivation-design.md §6.2
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");
const CATEGORIES = cfg.ownershipCategories;

// 키에서 핵심 토큰 추출: 영숫자 조각(2자+). 예: "staff.recommend" → ["staff","recommend"], "POST /api/x" → ["api","x"]
const tokens = (key) => (key.toLowerCase().match(/[a-z][a-z0-9_]{1,}/g) || []).filter((t) => !["post","get","put","delete","patch","api","event","job"].includes(t));

const findings = [];
let specCount = 0;
for (const f of (() => { try { return readdirSync(SPEC_DIR); } catch { return []; } })()) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const specId = (text.match(cfg.__specIdRe) || [f])[0];
  const own = parseSection(text, "Ownership", CATEGORIES);
  const hay = text.toLowerCase();
  specCount++;
  for (const cat of CATEGORIES) {
    for (const key of own[cat]) {
      const toks = tokens(key);
      if (toks.length && !toks.some((t) => hay.includes(t)))
        findings.push({ specId, cat, key });
    }
  }
}

console.log(`Spec 일관성(advisory): spec ${specCount}개 검사 — 근거 없는 키 ${findings.length}건.`);
for (const f of findings) console.log(`  ⚠ [${f.specId}] ${f.cat} "${f.key}": 본문에 근거 토큰 없음 → FR과 정렬 확인`);
if (findings.length && STRICT) { console.error("\n✗ --strict: 근거 없는 키."); process.exit(1); }
console.log(findings.length ? "일관성: advisory 경고(비차단)" : "일관성: OK — 모든 키에 본문 근거.");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/check-spec-consistency.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tooling/check-spec-consistency.mjs tooling/__tests__/check-spec-consistency.test.mjs
git commit -m "feat(gate): check-spec-consistency — 근거 없는 키 advisory(FR↔Ownership)"
```

---

### Task 5: `check-spec-cohesion` aggregate 신호 추가

**Files:**
- Modify: `tooling/check-spec-cohesion.mjs` (공통 lib 사용 + Entities 다수 신호)
- Test: `tooling/__tests__/check-spec-cohesion.test.mjs` (기존 확장)

**Interfaces:**
- Consumes: `parseSection`(Task 2)
- Produces: (CLI) 기존 + "Entities(aggregate) 2개+ = 분할 검토" advisory

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/check-spec-cohesion.test.mjs (추가 테스트)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(body) {
  const root = mkdtempSync(join(tmpdir(), "sdd-coh-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  writeFileSync(join(root, "sdd", "specs", "SPEC-001.md"), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-spec-cohesion.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("Ownership Entities 2개+ = aggregate 다수 분할 신호(advisory)", () => {
  const body = "# SPEC-001\n## Ownership\n- **Entities**: recommendation, invoice\n";
  const r = run(body);
  assert.equal(r.code, 0);                        // advisory
  assert.match(r.out, /aggregate|분할/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/check-spec-cohesion.test.mjs`
Expected: FAIL — 현재 cohesion은 키>4만 봄(2개엔 침묵).

- [ ] **Step 3: Write minimal implementation**

`check-spec-cohesion.mjs`에서 자체 `parseOwnership`을 `parseSection`(공통 lib) 사용으로 교체하고, 위반 수집 루프에 추가:

```javascript
import { parseSection } from "./ownership-keys.mjs";
// ... 기존 MAX_KEYS/MAX_FRS 유지 ...
const own = parseSection(text, "Ownership", CATEGORIES);
if (own) {
  // 신규: Entities(aggregate root) 다수 = 여러 aggregate 삼킴 신호
  const entCat = CATEGORIES.find((c) => /entit/i.test(c)) || CATEGORIES[0];
  if (own[entCat] && own[entCat].length > 1)
    violations.push({ specId, kind: `${entCat}(aggregate)`, n: own[entCat].length, max: 1 });
  // 기존: 카테고리별 키>MAX_KEYS
  for (const cat of CATEGORIES) {
    if (own[cat].length > MAX_KEYS) violations.push({ specId, kind: cat, n: own[cat].length, max: MAX_KEYS });
  }
}
```

> 리포트 문구에 "aggregate 다수 → capability별 분할 검토" 포함(기존 advisory 유지, exit 0).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/check-spec-cohesion.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tooling/check-spec-cohesion.mjs tooling/__tests__/check-spec-cohesion.test.mjs
git commit -m "feat(gate): cohesion에 aggregate 다수(Entities>1) 분할 신호"
```

---

### Task 6: PREFIX 화이트리스트 + 조용한 누락 제거 + 사유 관문

**Files:**
- Modify: `tooling/check-fr-coverage.mjs` (스캔·PREFIX 검증)
- Test: `tooling/__tests__/check-prefix.test.mjs`

**Interfaces:**
- Consumes: `cfg.specIdPrefixes`·`cfg.prefixRationale`(Task 1)
- Produces: (CLI) 표준 밖 접두어 파일 = exit 1, 사유 없으면 exit 1

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/check-prefix.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-pfx-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(root, "sdd", "specs", n), b);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-fr-coverage.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("표준 밖 접두어(FEAT)는 조용히 건너뛰지 않고 exit 1", () => {
  const r = run({ "FEAT-001.md": "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FEAT/);
});

test("사유(prefixRationale) 있으면 FEAT 통과", () => {
  const r = run(
    { "FEAT-001.md": "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n" },
    { specIdPrefixes: ["SPEC","INFRA","TEST","FEAT"], prefixRationale: { FEAT: "레거시 마법사 기능군" } }
  );
  assert.notEqual(r.code, 1); // PREFIX 사유는 통과(FR 커버리지 warn은 별개)
});

test("표준 접두어(SPEC/INFRA/TEST)는 정상", () => {
  const r = run({ "INFRA-001.md": "# INFRA-001\n인프라 spec.\n" });
  assert.notEqual(r.code, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/check-prefix.test.mjs`
Expected: FAIL — 현재는 미등록 접두어를 조용히 `continue`(exit 0).

- [ ] **Step 3: Write minimal implementation**

`check-fr-coverage.mjs`의 spec 수집 루프 앞에 PREFIX 검증 추가:

```javascript
const STANDARD = new Set(["SPEC", "INFRA", "TEST"]);
const allowed = new Set(cfg.specIdPrefixes);
const rationale = cfg.prefixRationale || {};
const prefixErrors = [];

for (const f of readdirSync(SPEC_DIR)) {
  const m = f.match(/^([A-Z]+)-\d{3}/);
  if (!f.endsWith(".md") || !m) continue;
  const pfx = m[1];
  if (!allowed.has(pfx)) {
    prefixErrors.push(`미등록 접두어 "${pfx}" (${f}) — 표준 SPEC/INFRA/TEST. 임의 생성 금지, 필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가`);
  } else if (!STANDARD.has(pfx) && !(rationale[pfx] && String(rationale[pfx]).trim())) {
    prefixErrors.push(`표준 밖 접두어 "${pfx}" — prefixRationale["${pfx}"]에 도입 사유 필요(빈 값 불가)`);
  }
}
if (prefixErrors.length) {
  console.error("✗ PREFIX 위반:");
  for (const e of prefixErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
```

> 기존 `continue`(등록 접두어만 수집)는 유지하되, 위 검증이 **모든** `XXX-NNN.md`를 먼저 보고 표준 밖/사유 없음을 차단.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/check-prefix.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tooling/check-fr-coverage.mjs tooling/__tests__/check-prefix.test.mjs
git commit -m "feat(gate): PREFIX 화이트리스트·조용한누락 제거·사유 관문"
```

---

### Task 7: 템플릿 + 방법론 문서 반영

**Files:**
- Modify: `templates/module-spec.md` (`## Dependencies` 섹션 + 키 생성 절차 주석)
- Modify: `DEDUP.md` · `METHODOLOGY.md` · `STORAGE.md` · `STRUCTURE.md`
- Test: 게이트 스윕(문서엔 단위테스트 대신 전 게이트 자체 실행)

**Interfaces:**
- Consumes: 없음(문서)
- Produces: 없음(문서)

- [ ] **Step 1: `templates/module-spec.md`에 Dependencies + 절차 추가**

`## Ownership` 블록 다음에 삽입:

```markdown
## Dependencies (참조 — dedup 제외)
> 이 spec이 **읽기/호출만** 하는 다른 aggregate의 키(소유 아님). Ownership과 같은 정규화·형식.
- **Entities**: [다른 spec 소유 Entity 중 참조하는 것]
- **Surfaces**: [호출하는 외부 route/이벤트]

<!-- 키 생성 결정 절차(사람=LLM 동일 결과):
  Capability: ①핵심 Entity ②동작 1개 ③허용 verb 매핑 ④entity.verb 조립 ⑤미등록 verb면 config 등록 후
  Surface:    ①메서드 대문자 ②path 소문자 ③param {name} ④trailing slash 제거
  Entity:     스키마 테이블/타입명 그대로 소문자
  경계: 1 spec = 1 aggregate root(§3.1). 다른 aggregate는 위 Dependencies로. -->
```

- [ ] **Step 2: 방법론 문서 4종에 반영**

- `DEDUP.md`: 소유/참조 분리(§3), 정규화 절대규칙 요약, 거짓양성 해소를 §3 근처에 추가.
- `METHODOLOGY.md`: EARS 절 근처에 "키 생성 결정 절차(EARS→키)"와 verb 집합 한 단락.
- `STORAGE.md`: §2 스펙 저장 규칙에 PREFIX 표준 3종·사유 관문·조용한 누락 제거.
- `STRUCTURE.md`: 라인 7 "1 spec = 1 응집 capability 묶음"을 "1 spec = 1 aggregate(핵심 Entity) — dedup이 경계 강제(§3.1)"로 정밀화 + Dependencies 언급.

(각 편집은 설계 문서 §9 표의 대응 항목 — 정확한 문구는 설계 §3~§5 복사.)

- [ ] **Step 3: 게이트 스윕으로 회귀 확인**

Run:
```bash
node --test tooling/__tests__/*.mjs
```
Expected: 전 테스트 PASS (Task 1~6 + 기존).

- [ ] **Step 4: 키트 자체 spec에 게이트 실행(자기적용 스모크)**

Run(키트 루트, 픽스처로):
```bash
node tooling/check-ownership.mjs && node tooling/check-spec-consistency.mjs && node tooling/check-spec-cohesion.mjs
```
Expected: 스펙 디렉토리 없으면 명시적 메시지(조용한 실패 없음), 있으면 정상 리포트.

- [ ] **Step 5: Commit**

```bash
git add templates/module-spec.md DEDUP.md METHODOLOGY.md STORAGE.md STRUCTURE.md
git commit -m "docs: 소유/참조 분리·키 생성 절차·PREFIX 표준·1spec=1aggregate 반영"
```

---

## Self-Review 결과

- **Spec 커버리지:** 설계 §3(데이터모델)→T3·T7, §3.1(경계)→T5·T7, §4(정규화)→T2, §4.1(verb)→T1·T2, §4.2(절차)→T7, §5(PREFIX)→T1·T6, §6.1(ownership강화)→T3, §6.2(consistency)→T4, §6.4(cohesion)→T5, §8(config)→T1, §9(문서)→T7. **`방법론.html` 반영은 plan ②(hook)의 사용법 작업과 함께** — 두 설계가 같은 HTML을 건드리므로 한 번에.
- **Placeholder:** T7 문서 편집은 "설계 §복사"로 지시(문구는 설계 문서에 실재) — 실행 시 그 문구 복사. 코드 스텝은 전부 완전 코드.
- **타입 일관성:** `parseSection`/`normalizeKey`/`validateKey` 시그니처가 T2 정의와 T3·T4·T5 사용에서 일치.
- **경계 노트:** `방법론.html`은 plan ②로 이관(중복 편집 방지).
