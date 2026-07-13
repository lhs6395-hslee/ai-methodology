# 방법론 강제 hook 세트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채택(`sdd-init`) 순간 hook 세트를 배선해, 이후 모든 세션·커밋이 방법론 궤도(spec→code→test→sync)를 강제받게 한다.

**Architecture:** 두 레이어 — Claude Code hook(SessionStart·PreToolUse, 상기) + git hook(pre-commit, hard 차단). hook 스크립트는 `scripts/`에 config 구동. `sdd-init`가 `.claude/settings.json`(병합)과 git 훅을 배선. 계약(HARNESS.md)은 중립 유지.

**Tech Stack:** POSIX 셸 hook 스크립트, Claude Code `.claude/settings.json` hooks, git hooks, Node 게이트(plan ① 산출).

## Global Constraints

- **선행:** plan ①(결정성 게이트)이 먼저 — pre-commit이 강화된 `check-ownership`·PREFIX 게이트를 호출.
- **hook 스키마는 실측 확정:** 정확한 `.claude/settings.json` hook 필드(SessionStart 출력 주입 형식, PreToolUse 제어 형식)는 **기억으로 단정하지 않고 Claude Code 문서/`claude-api` 스킬로 확인 후** 배선(REALITY_CHECK 원칙).
- **하위호환:** 기존 `.claude/settings.json` 있으면 **병합**(사용자 hook 보존). opt-out 가능.
- **강도:** Claude Code hook = 상기(soft), git pre-commit = hard 차단. 완전 편집 차단 안 함(hotfix 허용).
- **표준 PREFIX = SPEC/INFRA/TEST.** 궤도 원칙 = "방법론은 읽는 문서가 아니라 벗어날 수 없는 궤도".
- **테스트:** 셸 스크립트는 실행 후 stdout/exit 검사(`node --test`로 감싸거나 셸 assert).

---

### Task 1: SessionStart hook 스크립트 (진입 시 방법론 주입)

**Files:**
- Create: `tooling/harness/sdd-session-context.sh`
- Test: `tooling/__tests__/session-context.test.mjs`

**Interfaces:**
- Produces: 실행 시 stdout에 방법론 요약(궤도·진입규칙·PREFIX 표준·`sdd/specs/` 위치)을 출력하는 스크립트. `sdd-init`가 SessionStart hook `command`로 배선.

- [ ] **Step 1: hook 출력 스키마 확인 (실측)**

Run(확인용): `claude-api` 스킬 또는 Claude Code 공식 문서에서 SessionStart hook이 stdout을 세션 컨텍스트에 주입하는지 / `hookSpecificOutput.additionalContext` JSON을 요구하는지 확정.
Expected: 주입 방식 결정(대개 stdout 텍스트 또는 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`).
→ 아래 스크립트는 **stdout 텍스트** 가정, JSON 필요 시 `printf '%s' "$JSON"`로 감싼다(Step 3 주석).

- [ ] **Step 2: Write the failing test**

```javascript
// tooling/__tests__/session-context.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

test("session-context: 궤도·진입규칙·PREFIX·spec위치를 출력", () => {
  const out = execFileSync("sh", [join(process.cwd(), "tooling/harness/sdd-session-context.sh")], { encoding: "utf8" });
  assert.match(out, /spec.?→.?code.?→.?test.?→.?sync/i); // 궤도
  assert.match(out, /MODULE_MAP/);                        // 진입 규칙
  assert.match(out, /SPEC.*INFRA.*TEST/);                 // PREFIX 표준
  assert.match(out, /sdd\/specs/);                        // spec 위치
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tooling/__tests__/session-context.test.mjs`
Expected: FAIL — 스크립트 없음.

- [ ] **Step 4: Write minimal implementation**

```sh
# tooling/harness/sdd-session-context.sh
# SessionStart hook — 세션 진입 시 방법론 궤도·진입규칙을 컨텍스트에 주입.
# 설계: docs/design/2026-07-01-methodology-enforcement-hooks-design.md §5
# (JSON 주입이 필요하면 이 텍스트를 additionalContext로 감싼다.)
cat <<'EOF'
[SDD 방법론 — 이 프로젝트는 채택된 강제 궤도 위에서 돈다]
궤도: spec → code → test → sync (이탈은 hook·게이트가 되돌림)
진입 규칙(새 기능/수정 시 반드시):
  1) MODULE_MAP.md 대조 — 기존 spec과 겹치면 그 spec 개정, 아니면 새 spec
  2) spec 위치 = sdd/specs/ (docs/superpowers/specs/ 아님)
  3) PREFIX 표준 = SPEC / INFRA / TEST 만 (FEAT 등 임의 생성 금지)
  4) FR은 EARS, 테스트는 @covers <PREFIX>-NNN/FR-NNN
  5) 코드 전에 spec부터 — superpowers 기본 흐름 대신 이 프로젝트 규약
게이트: check-fr-coverage·check-ownership·check-spec-cohesion·check-spec-consistency
동기화: /sdd-sync (drift 점검), pre-push 훅
EOF
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tooling/__tests__/session-context.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tooling/harness/sdd-session-context.sh tooling/__tests__/session-context.test.mjs
git commit -m "feat(hook): SessionStart 방법론 컨텍스트 주입 스크립트"
```

---

### Task 2: PreToolUse hook 스크립트 (편집 시 체크리스트)

**Files:**
- Create: `tooling/harness/sdd-edit-check.sh`
- Test: `tooling/__tests__/edit-check.test.mjs`

**Interfaces:**
- Consumes: hook 입력(도구명·파일경로 — Claude Code가 stdin JSON으로 전달)
- Produces: `src` 경로 편집이면 체크리스트를 stdout(경고), 아니면 침묵. `sdd-init`가 PreToolUse(`Write|Edit`) hook으로 배선.

- [ ] **Step 1: hook 입력/제어 스키마 확인 (실측)**

Run(확인): PreToolUse hook의 stdin JSON 형식(`tool_input.file_path` 등)과 비차단 경고 방식(exit 0 + stderr, 또는 `hookSpecificOutput`) 확정.
→ 아래는 stdin JSON에서 `file_path` 추출, 경고는 stdout, **비차단(exit 0)** 가정.

- [ ] **Step 2: Write the failing test**

```javascript
// tooling/__tests__/edit-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function run(input) {
  return execFileSync("sh", [join(process.cwd(), "tooling/harness/sdd-edit-check.sh")],
    { input: JSON.stringify(input), encoding: "utf8" });
}

test("src 편집이면 체크리스트 출력", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "src/recommend.ts" } });
  assert.match(out, /MODULE_MAP|대응 FR|PREFIX|@covers/);
});

test("문서 파일이면 침묵", () => {
  const out = run({ tool_name: "Write", tool_input: { file_path: "README.md" } });
  assert.equal(out.trim(), "");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tooling/__tests__/edit-check.test.mjs`
Expected: FAIL — 스크립트 없음.

- [ ] **Step 4: Write minimal implementation**

```sh
# tooling/harness/sdd-edit-check.sh
# PreToolUse hook — src 코드 편집 직전 방법론 체크리스트 상기(비차단).
# stdin: {"tool_name":"Write","tool_input":{"file_path":"..."}}
INPUT=$(cat)
# file_path 추출(jq 없이 grep — 의존 최소화)
FP=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
case "$FP" in
  src/*|*/src/*|lib/*|app/*)   # scanDirs 코드 경로(프로젝트 관례에 맞게 sdd-init가 조정)
    cat <<'EOF'
[SDD 편집 체크 — 코드 건드리기 전 확인]
  □ MODULE_MAP 대조했나 (기존 spec 개정 vs 새 spec)
  □ 이 변경에 대응하는 FR 있나 — 없으면 sdd/specs/에 spec부터
  □ PREFIX 표준(SPEC/INFRA/TEST)인가
  □ 테스트에 @covers <PREFIX>-NNN/FR-NNN 계획했나
EOF
    ;;
  *) : ;;  # 코드 아님 → 침묵
esac
exit 0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tooling/__tests__/edit-check.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tooling/harness/sdd-edit-check.sh tooling/__tests__/edit-check.test.mjs
git commit -m "feat(hook): PreToolUse 편집 체크리스트(src만, 비차단)"
```

---

### Task 3: git pre-commit 훅 (hard 차단)

**Files:**
- Create: `tooling/harness/pre-commit`
- Test: `tooling/__tests__/pre-commit.test.mjs`

**Interfaces:**
- Consumes: plan ① 게이트(`check-ownership`·`check-fr-coverage` PREFIX). git 스테이징.
- Produces: 스테이징에 코드 변경 있는데 ownership/PREFIX 위반이면 `exit 1`.

- [ ] **Step 1: Write the failing test**

```javascript
// tooling/__tests__/pre-commit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-pc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"] }));
  // 게이트·훅 복사
  for (const f of ["check-fr-coverage.mjs","check-ownership.mjs","ownership-keys.mjs","sdd-config.mjs"])
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  cpSync(join(process.cwd(), "tooling/harness/pre-commit"), join(root, "scripts/sdd-pre-commit.sh"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("표준 밖 접두어 스펙이 스테이징되면 pre-commit이 차단", () => {
  const root = setupRepo();
  try {
    writeFileSync(join(root, "sdd/specs/FEAT-001.md"), "# FEAT-001\n**FR-001** THE SYSTEM SHALL x.\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    let code = 0;
    try { execFileSync("sh", [join(root, "scripts/sdd-pre-commit.sh")], { cwd: root, stdio: ["ignore","pipe","pipe"] }); }
    catch (e) { code = e.status; }
    assert.equal(code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tooling/__tests__/pre-commit.test.mjs`
Expected: FAIL — 훅 없음.

- [ ] **Step 3: Write minimal implementation**

```sh
# tooling/harness/pre-commit
# git pre-commit — 방법론 게이트 hard 차단(스테이징에 spec/코드 변경 있을 때).
# sdd-init가 scripts/sdd-pre-commit.sh로 설치 + .git/hooks/pre-commit이 이를 호출.
set -e
DIR=$(git rev-parse --show-toplevel)
cd "$DIR"
STAGED=$(git diff --cached --name-only)
# 스펙 또는 코드 변경이 있을 때만 게이트(문서-only 커밋은 통과)
if printf '%s' "$STAGED" | grep -qE '(^|/)(sdd/specs/|src/|lib/|app/|tests/)'; then
  node scripts/check-fr-coverage.mjs   # PREFIX 화이트리스트·사유·조용한누락(exit 1)
  node scripts/check-ownership.mjs     # dedup·정규화·형식(exit 1)
fi
```

> `--no-verify` 우회는 git 로그·리뷰에 드러난다(설계 §5 정직 노트).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tooling/__tests__/pre-commit.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tooling/harness/pre-commit tooling/__tests__/pre-commit.test.mjs
git commit -m "feat(hook): git pre-commit — ownership·PREFIX hard 차단"
```

---

### Task 4: `sdd-init` 배선 (settings.json 병합 + git 훅)

**Files:**
- Modify: `tooling/sdd-init.sh`
- Test: `tooling/__tests__/init-hooks.test.mjs`

**Interfaces:**
- Consumes: Task 1~3 스크립트, plan ① 게이트
- Produces: 채택 시 `.claude/settings.json`(hooks 병합)·`scripts/sdd-pre-commit.sh`·`.git/hooks/pre-commit`·`scripts/sdd-session-context.sh`·`scripts/sdd-edit-check.sh` 설치

- [ ] **Step 1: hook 배선 JSON 형식 확인 (실측)**

Run(확인): `.claude/settings.json`의 `hooks.SessionStart`·`hooks.PreToolUse` 정확한 형식(matcher·command·type) 확정. 병합 시 기존 hooks 보존 방식(jq merge) 결정.

- [ ] **Step 2: Write the failing test**

```javascript
// tooling/__tests__/init-hooks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sdd-init가 hook·settings·pre-commit 배선", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-"));
  try {
    execFileSync("sh", [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"], { cwd: root, stdio: "ignore" });
    assert.ok(existsSync(join(root, ".claude/settings.json")));
    const s = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    assert.ok(s.hooks?.SessionStart, "SessionStart hook 배선");
    assert.ok(s.hooks?.PreToolUse, "PreToolUse hook 배선");
    assert.ok(existsSync(join(root, "scripts/sdd-session-context.sh")));
    assert.ok(existsSync(join(root, "scripts/sdd-pre-commit.sh")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tooling/__tests__/init-hooks.test.mjs`
Expected: FAIL — sdd-init에 hook 배선 없음.

- [ ] **Step 4: Write minimal implementation**

`sdd-init.sh`의 `--gate=node` 하네스 설치 블록에 추가(기존 pre-push 배선 옆):

```sh
# 방법론 강제 hook 세트 배선
copy "$KIT/tooling/harness/sdd-session-context.sh" "$T/scripts/sdd-session-context.sh"
copy "$KIT/tooling/harness/sdd-edit-check.sh"       "$T/scripts/sdd-edit-check.sh"
copy "$KIT/tooling/harness/pre-commit"              "$T/scripts/sdd-pre-commit.sh"
# git 훅 연결
if [ -d "$T/.git" ]; then
  printf '#!/bin/sh\nsh scripts/sdd-pre-commit.sh\n' > "$T/.git/hooks/pre-commit"
  chmod +x "$T/.git/hooks/pre-commit"
fi
# .claude/settings.json 병합(기존 보존; jq 있으면 merge, 없으면 신규 생성)
mkdir -p "$T/.claude"
SETTINGS="$T/.claude/settings.json"
NEW_HOOKS='{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"sh scripts/sdd-session-context.sh"}]}],"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"sh scripts/sdd-edit-check.sh"}]}]}}'
if [ -f "$SETTINGS" ] && command -v jq >/dev/null 2>&1; then
  tmp=$(mktemp); jq -s '.[0] * .[1]' "$SETTINGS" <(printf '%s' "$NEW_HOOKS") > "$tmp" && mv "$tmp" "$SETTINGS"
else
  printf '%s\n' "$NEW_HOOKS" > "$SETTINGS"
fi
```

> 정확한 hook JSON 스키마(matcher/command/type)는 Step 1 확인 결과로 확정 — 위는 알려진 형태.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tooling/__tests__/init-hooks.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tooling/sdd-init.sh tooling/__tests__/init-hooks.test.mjs
git commit -m "feat(init): 채택 시 hook 세트·settings.json·pre-commit 자동배선"
```

---

### Task 5: "채택 = 상시 강제 궤도" 원칙 명시

**Files:**
- Modify: `METHODOLOGY.md` (최상단 원칙)
- Modify: `templates/constitution.md` (원칙 추가)

**Interfaces:** 없음(문서)

- [ ] **Step 1: METHODOLOGY.md 최상단에 원칙 삽입**

제목(`# 방법론 …`) 다음, 3축 표 앞에 삽입:

```markdown
## 이 방법론은 "채택하면 벗어날 수 없는 궤도"다

이 방법론을 채택한 프로젝트는 채택(`sdd-init`) 순간부터 **`spec→code→test→sync` 궤도를 상시 강제**받는다. 이탈(문서 없는 코드, 임의 PREFIX, 미대조 스펙)은 **hook·게이트가 감지해 궤도로 되돌린다.** 방법론은 *읽는 문서*가 아니라 *벗어날 수 없는 궤도*다 — 그 강제 장치가 게이트(검증 시점 차단)와 hook 세트(세션·편집 시점 상기, `HARNESS.md`)다.
```

- [ ] **Step 2: constitution.md에 대응 원칙 한 줄 추가**

`templates/constitution.md`의 원칙 목록에 추가:

```markdown
- **상시 강제 궤도:** 채택 순간부터 spec→code→test→sync를 벗어나지 않는다. 이탈은 hook·게이트가 되돌린다.
```

- [ ] **Step 3: Commit**

```bash
git add METHODOLOGY.md templates/constitution.md
git commit -m "docs: '채택=상시 강제 궤도' 원칙 명시(METHODOLOGY·constitution)"
```

---

### Task 6: 사용법 — APPLYING.md · 방법론.html · README

**Files:**
- Modify: `APPLYING.md` (궤도 운영법)
- Modify: `방법론.html` (워크스루 + plan ① 결정성 섹션 통합)
- Modify: `README.md` (포인터)
- Test: HTML 유효성(브라우저 열림) + 게이트 스윕

**Interfaces:** 없음(문서/사용법)

- [ ] **Step 1: APPLYING.md에 "궤도 한 바퀴 운영법" 절 추가**

채택 절차 다음에 삽입 — 실제 출력 예시 포함:

```markdown
## 채택 후 궤도 한 바퀴 (운영법)
1. **세션 시작** — SessionStart hook이 방법론 요약·진입규칙을 띄운다. (출력: "[SDD 방법론 — …]" 궤도·PREFIX·spec 위치)
2. **새 기능** — MODULE_MAP 대조 → 겹치면 그 spec 개정, 아니면 `sdd/specs/`에 새 spec(PREFIX 표준). speckit.specify로 EARS FR.
3. **코드 편집** — PreToolUse hook이 체크리스트를 띄운다(MODULE_MAP·대응 FR·PREFIX·@covers).
4. **커밋** — pre-commit이 ownership·PREFIX를 검사. 위반 시 차단 → 스펙/키 고치고 재커밋. (예: "✗ 미등록 접두어 FEAT …")
5. **푸시** — pre-push가 `sdd-sync` drift 점검. drift면 `/sdd-sync`로 정렬.
6. **이탈 대응** — 게이트 실패 메시지대로: FR 없는 코드→spec 추가, 중복 키→통합, 과대 spec→분할.
```

- [ ] **Step 2: `방법론.html`에 결정성 섹션 + 궤도 워크스루 추가**

기존 "하네스 실전 워크스루" 섹션을 확장/보강:
- **키 생성 결정 절차** 섹션 신설(정규화 규칙 표 + 단계별 알고리즘 + 예시 — 설계 §4).
- **spec PREFIX** 설명(표준 SPEC/INFRA/TEST + 사유 관문 + 조용한 누락 — 설계 §5).
- **spec 경계 = 1 aggregate** 규칙(설계 §3.1).
- **"채택 후 궤도 한 바퀴"** 워크스루(hook·게이트가 언제·무엇을 띄우는지 단계별 + Step 1의 출력 예시).

(정확한 문구·SVG는 기존 `방법론.html` 스타일 재사용. 실제 게이트 출력을 실행해 캡처한 텍스트를 넣는다 — 추측 아님.)

- [ ] **Step 3: README.md 포인터 갱신**

구성 표에 `HARNESS.md`·게이트 항목 옆에 결정성·강제 궤도 한 줄 추가, `방법론.html` 포인터에 "채택 후 궤도 운영법 포함" 명시.

- [ ] **Step 4: 실측 — 게이트 출력을 실제로 뽑아 사용법에 반영**

Run:
```bash
node tooling/check-ownership.mjs --strict 2>&1 | head -5
node tooling/check-fr-coverage.mjs 2>&1 | head -5
sh tooling/harness/sdd-session-context.sh
```
Expected: 각 실제 출력을 APPLYING.md·`방법론.html` 예시에 복사(REALITY_CHECK — 추측 금지).

- [ ] **Step 5: 전체 게이트 스윕 회귀**

Run: `node --test tooling/__tests__/*.mjs`
Expected: plan ①+② 전 테스트 PASS.

- [ ] **Step 6: Commit**

```bash
git add APPLYING.md 방법론.html README.md
git commit -m "docs: 궤도 운영법 사용법 — APPLYING·방법론.html(결정성+워크스루)·README"
```

---

## Self-Review 결과

- **Spec 커버리지:** 설계 §3(hook 세트)→T1·T2·T3, §4(두 레이어)→T1~T3, §5(각 hook)→T1~T3, §6(sdd-init 배선)→T4, §8(궤도 원칙)→T5, §10.5(사용법)→T6, plan ① 미이관분(`방법론.html` 결정성)→T6 Step 2에 통합.
- **Placeholder:** hook 스키마 불확실부는 "확인 스텝(실측)"으로 명시 — placeholder 아님(확인 행위가 스텝). 스크립트 내용은 완전 코드. 문서 편집은 실제 출력 실측 지시.
- **타입/이름 일관성:** 스크립트 경로(`tooling/harness/*.sh` → 설치 시 `scripts/*.sh`)가 T1~T4에서 일치. pre-commit이 호출하는 게이트명(`check-fr-coverage`·`check-ownership`)이 plan ①과 일치.
- **선행 의존 명시:** Global Constraints에 "plan ① 먼저" 박음(pre-commit이 강화 게이트 호출).
- **정직성:** hook 스키마·게이트 출력은 실측 확정(REALITY_CHECK) — 추측 배선 금지.
