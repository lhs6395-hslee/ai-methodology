# 하네스 MVP (Gap 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec↔code 생애주기를 사람-개입으로 오케스트레이션하는 **하네스 MVP** 구축 — 포터블 계약 `HARNESS.md` + detect 집계기 `sdd-sync.mjs` + Claude Code 실행기(`/sdd-sync` 스킬 + pre-push 훅) + `sdd-init` 배선.

**Architecture:** 하네스 = 선언적 규칙표(`HARNESS.md`)를 실행기가 해석. 탐지는 **기존 게이트 5종 재사용**(판정 로직 신규 0). `sdd-sync.mjs`가 게이트들을 일괄 실행해 규칙별 리포트를 만들고, 스킬·훅이 그걸 소비. 결정은 항상 사람(작성=LLM, 승인=사람).

**Tech Stack:** Node ESM(`sdd-sync.mjs`, 기존 `check-*.mjs` 스폰), POSIX sh(훅·sdd-init), Markdown(계약·스킬). 검증 `node --test` + 픽스처.

## Global Constraints

- **git:** origin = github.com/lhs6395-hslee/ai-methodology, `main`에 바로 commit/push(사용자 관례). 메모리 [[ai-methodology-repo]].
- **포터블(C):** `HARNESS.md`(계약)·게이트(탐지기)는 런타임 중립. Claude Code 실행기(스킬·훅)만 에이전트별 — **Claude Code 전용으로 박지 말 것**. 메모리 [[harness-gap3-goal]], [principles.md §10](../../principles.md).
- **불변 원칙:** 어느 방향도 자동 덮어쓰기 금지 — 사람 의사 확인 게이트 필수(METHODOLOGY converge 정신).
- **탐지기 = Node 전용(현재):** 강화 게이트(converge-drift/orphan-surfaces/cohesion)는 Node판만 존재 → 하네스 MVP는 Node 기반(`--gate=node`).
- **게이트 테스트 실행:** `node --test tooling/__tests__/*.mjs` (Node 25.5 글로브 필수).
- **비목표(후속):** 연속 file-watch·스케줄 트리거, 규칙별 분리 명령, 다른 에이전트 실행기, R3 임베딩 의미리뷰. (설계 [2026-06-30-harness-design.md](../specs/2026-06-30-harness-design.md) §7)

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `HARNESS.md` (루트) | 포터블 플로우 계약(규칙표 SSOT) | 신규 |
| `tooling/sdd-sync.mjs` | detect 집계기(게이트 일괄→규칙별 리포트) | 신규 |
| `tooling/__tests__/sdd-sync.test.mjs` | 집계기 테스트 | 신규(2 케이스) |
| `tooling/harness/sdd-sync.SKILL.md` | `/sdd-sync` 실행기 playbook(템플릿) | 신규 |
| `tooling/harness/pre-push` | git pre-push 훅(R4 수시, 템플릿) | 신규 |
| `tooling/sdd-init.sh` | 스캐폴더 | node 게이트 목록 확장 + 하네스 설치 섹션 |
| `APPLYING.md` · `README.md` | 런북·개요 | 하네스 설치/소개 |

---

### Task 1: HARNESS.md — 포터블 플로우 계약

**Files:** Create `HARNESS.md` (저장소 루트)

**Interfaces:**
- Produces: 규칙표 SSOT. `sdd-sync.mjs`(detect 매핑)·스킬(act)·훅이 이 계약을 따른다.

- [ ] **Step 1: 파일 생성**

Create `HARNESS.md`:
```markdown
# HARNESS — SDD 인터랙티브 sync 계약 (포터블)

> spec↔code 생애주기를 **사람-개입**으로 오케스트레이션하는 플로우 계약. 이 규칙표가 SSOT — 실행기(에이전트별)는 이 표를 해석한다. 탐지는 기존 게이트 재사용(판정 로직 신규 0). 결정은 항상 사람(작성=LLM, 승인=사람). 설계 근거: `docs/superpowers/specs/2026-06-30-harness-design.md`.

## 규칙표 {trigger, detect, ask, act}

| 규칙 | Trigger | Detect (게이트) | Ask (사람) | Act |
|---|---|---|---|---|
| **R1 spec→code** | spec 생성/변경 | `check-fr-coverage`(테스트 없는 FR ≈ 미구현) | "이 FR들 코드 생성/업데이트?" | TDD(RED→GREEN) → 재검증 |
| **R2 code→spec** | 코드 변경·spec 무변경 | `check-converge-drift`·`check-orphan-surfaces` | "기존 spec 개정 / 새 spec / 의도적 무시?" | `/converge`→intent→`/specify`(update·new)→`/analyze`→bless |
| **R3 dedup+입도** | spec 생성/변경 직후 | `check-ownership`·`check-spec-cohesion` | "중복 통합 / 과대 spec 분할?" | 통합 또는 capability별 분할 → 재검증 |
| **R4 상시 sync** | push·주기·요청 | 위 일괄(`sdd-sync.mjs`) | drift → 해당 규칙 라우팅 | (R1/R2/R3의 act) |

## 실행기 (Claude Code 1차 — 다른 에이전트는 같은 표로 자체 구현)
- **detect 집계:** `node scripts/sdd-sync.mjs [--strict]` → 규칙별 sync 리포트.
- **인터랙티브:** 스킬 `/sdd-sync` — 리포트 → 규칙별 사람 의사 확인 → act.
- **상시(R4):** git pre-push 훅이 `sdd-sync.mjs`를 advisory 실행 → drift면 `/sdd-sync` 안내(기본 비차단, `SDD_SYNC_BLOCK=1`로 차단).

## 불변
- 어느 방향도 **자동 덮어쓰기 금지** — 사람 의사 확인 게이트 필수.
- 탐지는 advisory 1차; `--strict` 승격은 팀 선택.
- 게이트는 런타임 중립(4판), 실행기만 에이전트별.
```

- [ ] **Step 2: Checkpoint**

Run: `grep -cE "R1 spec→code|R2 code→spec|R3 dedup|R4 상시" HARNESS.md` → Expected: `4` 이상.
Run: `grep -oE "check-(fr-coverage|converge-drift|orphan-surfaces|ownership|spec-cohesion)" HARNESS.md | sort -u | wc -l` → Expected: `5` (5종 게이트 전부 참조).

---

### Task 2: sdd-sync.mjs — detect 집계기 (TDD)

**Files:**
- Create: `tooling/sdd-sync.mjs`
- Create test: `tooling/__tests__/sdd-sync.test.mjs`

**Interfaces:**
- 동작: 규칙별 detector 게이트를 같은 cwd로 스폰 → 게이트 출력에 `⚠`/`✗` 또는 비정상 종료가 있으면 그 규칙을 "확인 필요"로 표시 → 규칙별 리포트 출력. advisory(기본) exit 0; `--strict`는 발견 있으면 exit 1.
- Produces: 스킬·훅이 호출하는 단일 detect 진입점.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tooling/__tests__/sdd-sync.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const SYNC = new URL("../sdd-sync.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-sync-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [SYNC, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("clean 프로젝트(FR↔test 커버·중복/과대 없음) → 전부 sync, exit 0", () => {
  const dir = fixture({
    "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Capabilities**: a.create\n",
    "src/a.test.js": "// @covers SPEC-001/FR-001\nimport {test} from 'node:test';\ntest('a',()=>{expect(1).toBe(1)});\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /R3 dedup.*✓|✓ clean/s);
  assert.match(r.out, /전부 sync|sync ✓/);
});

test("과대 spec(cohesion 위반) → R3 확인 필요, --strict exit 1", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture({ "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const warn = run(dir);
  assert.match(warn.out, /R3 dedup.*확인 필요/s);
  assert.equal(run(dir, ["--strict"]).code, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tooling/__tests__/sdd-sync.test.mjs`
Expected: FAIL — `Cannot find module ...sdd-sync.mjs`.

- [ ] **Step 3: 집계기 구현**

Create `tooling/sdd-sync.mjs`:
```javascript
#!/usr/bin/env node
// ─── SDD 하네스 — detect 집계기 ───────────────────────────────
// HARNESS.md 규칙표의 detect 단계: 규칙별 detector 게이트를 일괄 실행하고
// "확인 필요/clean"을 규칙별로 리포트한다. 스킬 /sdd-sync 과 pre-push 훅이 소비.
// advisory(기본): 리포트 + exit 0. --strict: 발견 있으면 exit 1.
//
// 탐지 로직은 게이트에 있다(판정 신규 0). 이 파일은 오케스트레이션만.
// Usage: node scripts/sdd-sync.mjs [--strict]

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const STRICT = process.argv.includes("--strict");
const HERE = dirname(new URL(import.meta.url).pathname);

// 규칙 → detector 게이트(HARNESS.md 규칙표). 같은 디렉토리에서 게이트를 찾는다.
const RULES = [
  { rule: "R1 spec→code", gates: ["check-fr-coverage.mjs"] },
  { rule: "R2 code→spec", gates: ["check-converge-drift.mjs", "check-orphan-surfaces.mjs"] },
  { rule: "R3 dedup+입도", gates: ["check-ownership.mjs", "check-spec-cohesion.mjs"] },
];

function runGate(file) {
  const path = join(HERE, file);
  if (!existsSync(path)) return { flagged: false, last: `(없음: ${file})` };
  try {
    const out = execFileSync("node", [path], { encoding: "utf8" });
    return { flagged: /[⚠✗]/.test(out), last: out.trim().split("\n").pop() || "" };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    return { flagged: true, last: out.trim().split("\n").pop() || "(비정상 종료)" };
  }
}

console.log("SDD sync 리포트 — detector 일괄 실행 (HARNESS.md 규칙표)");
const flaggedRules = [];
for (const { rule, gates } of RULES) {
  let flagged = false;
  const lines = [];
  for (const g of gates) {
    const r = runGate(g);
    if (r.flagged) flagged = true;
    lines.push(`    [${g}] ${r.last}`);
  }
  console.log(`\n● ${rule}: ${flagged ? "⚠ 확인 필요" : "✓ clean"}`);
  for (const l of lines) console.log(l);
  if (flagged) flaggedRules.push(rule);
}

console.log(
  flaggedRules.length
    ? `\n요약: 확인 필요 — ${flaggedRules.join(", ")} → '/sdd-sync'로 의사결정`
    : `\n요약: 전부 sync ✓`
);
if (STRICT && flaggedRules.length) process.exit(1);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tooling/__tests__/sdd-sync.test.mjs`
Expected: `tests 2` / `pass 2` / `fail 0`.

- [ ] **Step 5: Checkpoint** — Run: `node --check tooling/sdd-sync.mjs && echo OK` → Expected: `OK`.

---

### Task 3: /sdd-sync 스킬 playbook (실행기 템플릿)

**Files:** Create `tooling/harness/sdd-sync.SKILL.md`

**Interfaces:**
- Consumes: `node scripts/sdd-sync.mjs`(Task 2)의 리포트. HARNESS.md 규칙표의 act.
- Produces: adopting 프로젝트의 `.claude/skills/sdd-sync/SKILL.md`로 설치될 playbook(Task 5).

- [ ] **Step 1: 파일 생성**

Create `tooling/harness/sdd-sync.SKILL.md`:
```markdown
---
name: sdd-sync
description: SDD 하네스 — spec↔code 일치를 인터랙티브로 점검·정렬. spec/코드 변경 후 또는 수시로 sync를 맞출 때 사용.
---
# /sdd-sync — SDD 인터랙티브 sync

`HARNESS.md` 계약(규칙표)을 실행한다. **탐지는 게이트, 결정은 사람, 작성은 LLM.**

## 절차
1. **Detect:** `node scripts/sdd-sync.mjs` 실행 → 규칙별 리포트 확보.
2. **요약:** 발견을 사람에게 한눈에 제시(R1 미구현 FR / R2 drift·고아표면 / R3 중복·과대 spec).
3. **규칙별 의사 확인** (발견 있는 규칙마다 사람에게 질문 — 절대 자동 진행 금지):
   - **R1** → "이 FR들 코드 생성/업데이트할까요?" 예 → `superpowers:test-driven-development`로 RED→GREEN 구현.
   - **R2** → "기존 spec 개정 / 새 spec / 의도적 무시?" → `/speckit.converge`로 갭 표면화 → **사람이 intent 한 줄 입력** → `/speckit.specify`(update·new)로 `코드 diff + intent` 기반 작성 → `/speckit.analyze` 정합 → **사람 bless**.
   - **R3** → "중복 spec 통합 / 과대 spec 분할?" → 통합 또는 capability별 분할(`STRUCTURE.md` 입도 규칙).
4. **재검증:** `node scripts/sdd-sync.mjs` 재실행 — clean이거나 사람이 멈출 때까지 반복.

## 불변
- **자동 덮어쓰기 금지** — 각 act 전에 사람 승인 게이트.
- Spec Kit 명령(`/speckit.*`) 미설치면 수동 절차 안내(`APPLYING.md` §1).
```

- [ ] **Step 2: Checkpoint** — Run: `grep -cE "^name: sdd-sync|자동 덮어쓰기 금지|sdd-sync.mjs" tooling/harness/sdd-sync.SKILL.md` → Expected: `3` 이상.

---

### Task 4: pre-push 훅 (R4 수시, 템플릿)

**Files:** Create `tooling/harness/pre-push`

**Interfaces:**
- Consumes: `scripts/sdd-sync.mjs`(adopting 프로젝트 설치 후).
- 동작: sync 점검, drift면 안내. 기본 비차단; `SDD_SYNC_BLOCK=1`이면 차단.

- [ ] **Step 1: 파일 생성**

Create `tooling/harness/pre-push`:
```sh
#!/bin/sh
# SDD 하네스 pre-push — spec↔code sync 점검 (HARNESS.md R4 "수시").
# 기본 비차단(안내만). 차단하려면: SDD_SYNC_BLOCK=1.
# 설치: ln -sf ../../scripts/sdd-pre-push.sh .git/hooks/pre-push
node scripts/sdd-sync.mjs --strict && exit 0
echo ""
echo "↑ spec↔code drift 가능 — '/sdd-sync'로 정렬 검토. (push는 계속됨)"
[ "${SDD_SYNC_BLOCK:-0}" = "1" ] && exit 1
exit 0
```

- [ ] **Step 2: Checkpoint** — Run: `sh -n tooling/harness/pre-push && echo "sh OK"` → Expected: `sh OK`.

---

### Task 5: sdd-init.sh 배선 — node 게이트 확장 + 하네스 설치

**Files:** Modify `tooling/sdd-init.sh`

**Interfaces:**
- Consumes: Task 1~4 산출물(`HARNESS.md`·`sdd-sync.mjs`·`harness/*`).
- Produces: adopting 프로젝트에 detector 게이트 전부 + 하네스 실행기 설치.

- [ ] **Step 1: node 게이트 목록에 강화 게이트 + cohesion 추가**

`old_string` (정확히):
```sh
  node) for f in sdd-config.mjs check-fr-coverage.mjs check-ownership.mjs sdd-run.mjs; do
          copy "$KIT/tooling/$f" "$T/scripts/$f"; done ;;
```
`new_string`:
```sh
  node) for f in sdd-config.mjs check-fr-coverage.mjs check-ownership.mjs sdd-run.mjs \
                 check-converge-drift.mjs check-orphan-surfaces.mjs check-test-adequacy.mjs check-spec-cohesion.mjs; do
          copy "$KIT/tooling/$f" "$T/scripts/$f"; done ;;
```

- [ ] **Step 2: 하네스 설치 섹션 추가 (게이트 case…esac 다음, 섹션 3 앞)**

`old_string` (정확히):
```sh
# ── 3. 방법론 설명서는 복사 안 함 — 키트 참조(드리프트 방지). 포인터만. ──
```
`new_string`:
```sh
# ── 2b. 하네스 (선택) — 인터랙티브 spec↔code sync (Claude Code 1차) ──
# 하네스 detector는 Node 게이트를 쓰므로 --gate=node 일 때만 설치.
if [ "$GATE" = "node" ]; then
  copy "$KIT/tooling/sdd-sync.mjs"               "$T/scripts/sdd-sync.mjs"
  copy "$KIT/tooling/harness/sdd-sync.SKILL.md"  "$T/.claude/skills/sdd-sync/SKILL.md"
  copy "$KIT/tooling/harness/pre-push"           "$T/scripts/sdd-pre-push.sh"
  say "  → 하네스 훅 설치(선택): ln -sf ../../scripts/sdd-pre-push.sh .git/hooks/pre-push"
  say "  → 계약: $KIT/HARNESS.md  · 스킬: /sdd-sync"
fi

# ── 3. 방법론 설명서는 복사 안 함 — 키트 참조(드리프트 방지). 포인터만. ──
```

- [ ] **Step 3: Checkpoint — 픽스처 스모크**

Run:
```sh
D=$(mktemp -d) && (cd "$D" && sh /Users/toule/Documents/claude/sdd/tooling/sdd-init.sh --gate=node >/dev/null 2>&1); \
ls "$D/scripts/sdd-sync.mjs" "$D/.claude/skills/sdd-sync/SKILL.md" "$D/scripts/sdd-pre-push.sh" \
   "$D/scripts/check-spec-cohesion.mjs" "$D/scripts/check-converge-drift.mjs" 2>&1 && echo "WIRE OK"; rm -rf "$D"
```
Expected: 5개 경로 모두 존재 + `WIRE OK`.

---

### Task 6: APPLYING.md + README — 하네스 문서화

**Files:** Modify `APPLYING.md`, `README.md`

- [ ] **Step 1: APPLYING.md에 하네스 설치 안내 추가**

`old_string` (정확히):
```markdown
## 4. 루프 가동
```
`new_string`:
```markdown
## 3b. (선택) 하네스 — 인터랙티브 spec↔code sync
`--gate=node`로 init하면 `scripts/sdd-sync.mjs`·`/sdd-sync` 스킬·`scripts/sdd-pre-push.sh`가 설치된다(계약: 키트 `HARNESS.md`). spec/코드 변경 후 또는 수시로 `/sdd-sync`로 R1~R4(spec→code·code→spec·dedup+입도·상시 sync)를 사람 확인 게이트로 정렬한다. push마다 점검하려면: `ln -sf ../../scripts/sdd-pre-push.sh .git/hooks/pre-push`(기본 비차단, `SDD_SYNC_BLOCK=1`로 차단).

## 4. 루프 가동
```

- [ ] **Step 2: README 파일 목록에 HARNESS.md 추가**

`old_string` (정확히):
```markdown
| [`principles.md`](principles.md) | 작업 원칙(전부정독·병렬=저비용티어·실패재시도·LLM작성/사람승인·언어/모델/인프라/CI 무관 §10) | 규칙 |
```
`new_string`:
```markdown
| [`principles.md`](principles.md) | 작업 원칙(전부정독·병렬=저비용티어·실패재시도·LLM작성/사람승인·언어/모델/인프라/CI 무관 §10) | 규칙 |
| [`HARNESS.md`](HARNESS.md) | **인터랙티브 spec↔code sync 계약**(규칙표 R1~R4·실행기 `/sdd-sync`·pre-push 훅) | ★ 하네스 |
```

- [ ] **Step 3: Checkpoint** — Run: `grep -c "HARNESS.md" README.md` → Expected: `1` 이상. Run: `grep -c "하네스" APPLYING.md` → Expected: `1` 이상.

---

### Task 7: 최종 검증

- [ ] **Step 1: 전체 게이트 테스트 (기존 9 + sdd-sync 2 = 11)**

Run: `node --test tooling/__tests__/*.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 11` / `pass 11` / `fail 0`.

- [ ] **Step 2: 계약↔구현 정합 통독**

`HARNESS.md` 규칙표의 detect 게이트 목록이 `tooling/sdd-sync.mjs`의 `RULES` 매핑과 일치하는지, 스킬의 act(R1 TDD / R2 converge·specify / R3 통합·분할)가 규칙표와 일치하는지 확인.

- [ ] **Step 3: Checkpoint — sdd-sync 스모크(키트에는 specDir 없음 확인)**

Run: `cd /Users/toule/Documents/claude/sdd && node tooling/sdd-sync.mjs 2>&1 | head -3`
Expected: 리포트 헤더 출력(키트엔 `sdd/specs` 없어 게이트가 ⚠/✗ → "확인 필요"가 정상 — 키트는 adopting 대상이 아님). 크래시 없이 리포트 형식이면 OK.

---

## Self-Review (작성자 점검)

**1. Spec coverage** — 설계(harness-design.md) 매핑: 규칙표=T1(HARNESS.md), detect 집계=T2(sdd-sync.mjs), 실행기 스킬=T3, R4 훅=T4, 배포(sdd-init)=T5, 문서=T6. §7 MVP 범위(계약+집계기+스킬+훅+배선) 전부 커버. 후속(watch/스케줄/타에이전트)은 비목표로 명시. ✓

**2. Placeholder scan** — 모든 산출물의 전체 본문(HARNESS.md·sdd-sync.mjs·테스트·SKILL.md·훅) + sdd-init 정확한 old/new 포함. "적절히/TODO" 없음. ✓

**3. Type consistency** — 규칙 라벨 통일(R1 spec→code / R2 code→spec / R3 dedup+입도 / R4 상시 sync)이 HARNESS.md·sdd-sync.mjs `RULES`·SKILL.md·테스트 assert 전부 일치. detect 게이트 5종 = HARNESS.md ↔ sdd-sync.mjs `RULES` 매핑 일치(R1:fr-coverage / R2:converge-drift,orphan-surfaces / R3:ownership,cohesion). 진입점 `node scripts/sdd-sync.mjs`가 SKILL·훅·HARNESS에서 동일. ✓

**범위 메모:** 하네스의 "지능"은 게이트(탐지·기검증)+스킬 playbook(사람 게이트)+사람 승인에 있다. sdd-sync.mjs는 오케스트레이션만(판정 신규 0). 후속: 연속 트리거·타 에이전트 실행기·임베딩 의미리뷰.
```
