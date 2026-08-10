// tooling/__tests__/runtime-contract.test.mjs
// 런타임 소스 계약 — 실행 없이도 문법 드리프트를 잡는 회귀 그물.
// ① DEFAULTS 패리티: Python DEFAULTS를 실제 로드해 Node DEFAULTS와 값 비교
//    (기본값이 갈라지면 config 없는 프로젝트에서 런타임별 판정이 갈라진다).
// ② 하드코딩 금지: 어떤 런타임 소스에도 요구 ID 정규식이 리터럴(FR-…)로 남으면 안 됨 —
//    전 사이트가 requirementIdPrefixes 파생값을 써야 한다(사이트 누락 = 절단·조용한 누락 회귀).
// ③ Go 소스 계약: 로컬 Go 툴체인 없이도 파생 정규식·경계 강제·거버넌스 존재를 소스로 확인
//    (실행 패리티 재검증은 Go 툴체인이 있는 CI에서 — SPEC-006 Assumptions).
// @covers SPEC-006/FR-002
// @covers SPEC-006/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DEFAULTS } from "../sdd-config.mjs";

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

let hasPython = true;
try { execFileSync("python3", ["--version"], { stdio: "ignore" }); } catch { hasPython = false; }

test("① Python DEFAULTS = Node DEFAULTS (키·값 동일)", hasPython ? false : { skip: "python3 없음" }, () => {
  const PY = new URL("../sdd_gates.py", import.meta.url).pathname;
  const raw = execFileSync("python3", ["-c",
    `import json, runpy; d = runpy.run_path(${JSON.stringify(PY)}); print(json.dumps(d["DEFAULTS"]))`,
  ], { encoding: "utf8" });
  const pyDefaults = JSON.parse(raw);
  assert.deepEqual(Object.keys(pyDefaults).sort(), Object.keys(DEFAULTS).sort(), "DEFAULTS 키 집합 불일치");
  for (const k of Object.keys(DEFAULTS)) {
    assert.deepEqual(pyDefaults[k], DEFAULTS[k], `DEFAULTS["${k}"] 값 불일치`);
  }
});

test("② 하드코딩 요구 ID 정규식 금지 — 전 런타임 소스", () => {
  // 리터럴 "FR-" + 자릿수 수량자가 정규식으로 남아 있으면 파생 메커니즘을 우회한 사이트다.
  const patterns = [/FR-\\d\{3\}/, /FR-\[0-9\]\{3\}/];
  for (const rel of ["sdd_gates.py", "sdd_gates.sh", "go-gate/main.go",
    "sdd-config.mjs", "check-fr-coverage.mjs", "check-spec-cohesion.mjs",
    "check-spec-completeness.mjs", "spec-sync-lib.mjs"]) {
    const text = src(rel);
    for (const re of patterns) {
      assert.doesNotMatch(text, re, `${rel}: 하드코딩 요구 ID 정규식 잔존(파생값 미사용 사이트)`);
    }
  }
});

test("③ Go 소스 계약: requirementIdPrefixes 파생·서픽스 경계·PREFIX 거버넌스", () => {
  const go = src("go-gate/main.go");
  assert.match(go, /requirementIdPrefixes/, "config 키 부재");
  assert.match(go, /\{"SPEC", "INFRA", "TEST", "CICD"\}/, "specIdPrefixes 기본값이 Node DEFAULTS와 다름");
  assert.match(go, /\{"FR"\}/, "requirementIdPrefixes 기본값 부재");
  assert.match(go, /reqAlt \+ `\)-\\d\{3\}\[a-z\]\?\)\\\*\\\*`/, "frDecl 파생·서픽스 문법 부재");
  assert.match(go, /reqAlt \+ `\)-\\d\{3\}\[a-z\]\?\)\\b`/, "covers 파생·경계(\\b) 강제 부재");
  assert.match(go, /PREFIX 위반/, "PREFIX 거버넌스 부재");
});

test("③ 셸 소스 계약: REQALT 파생·과포집 후 정확형 필터·거버넌스", () => {
  const sh = src("sdd_gates.sh");
  assert.match(sh, /requirementIdPrefixes \| arr_or_default FR/, "requirementIdPrefixes 기본값 부재");
  assert.match(sh, /specIdPrefixes \| arr_or_default SPEC INFRA TEST CICD/, "specIdPrefixes 기본값이 Node DEFAULTS와 다름");
  assert.match(sh, /\$\{REQALT\}\)-\[0-9\]\{3\}\[a-z\]\?\$/, "정확형 필터(경계 재현) 부재");
  assert.match(sh, /PREFIX 위반/, "PREFIX 거버넌스 부재");
});

// ④ 경로 인용 계약 — **전수**로 강제한다(SPEC-006 FR-002: 판정은 런타임에 따라 갈리지 않는다).
//
// 실측(도그푸딩, 2026-08-10): `git diff --cached --name-only`는 비ASCII 경로를 8진수 문자열로
// **인용해서** 낸다(`"docs/\353\260\251\353\262\225\353\241\240.html"`). 그 문자열은 어떤 소유
// 글롭·문서 목록과도 매치하지 않으므로 판정이 **양방향으로** 틀린다:
//   · 소유 귀속이 조용히 사라진다(위반이 통과로) — fr-coverage·pre-edit
//   · 자기 갱신을 놓친 것으로 오판한다(통과가 위반으로) — intro-doc이 자기 문서를 고친 커밋을 차단했다
// 두 게이트는 이미 `sh` 래퍼로 정규화하고 있었고 세 게이트가 빠져 있었다 — **한 곳이라도 빠지면
// 그 자리가 결함이다.** 그래서 규범이 아니라 소스 전수 열거로 못박는다.
// @covers SPEC-006/FR-006
test("④ 경로 인용 계약: 모든 런타임의 git 프로세스 기동이 core.quotepath=off를 단다", () => {
  // **프로세스를 띄우는 줄만** 본다. 래퍼 호출부(`git("diff …")`)는 기동이 아니고, 오류 문구 속
  // `git diff(...)`는 산문이다 — 주석 속 예시가 인용이지 결정이 아닌 것과 같다. 이 구분을 놓치면
  // 오탐이 쌓이고, 오탐이 잦은 게이트는 꺼진다(첫 판이 실제로 산문 2줄과 래퍼 호출 3줄을 잡았다).
  const SPAWN = /\b(?:execSync|execFileSync|spawnSync|subprocess\.run)\s*\(/;
  const GIT_CMD = /(?:`|"|')git\s|"git"\s*,|\[\s*"git"/;
  const QUOTED_OFF = /core\.quotepath=off/i;
  const offenders = [];
  for (const rel of readdirSync(new URL("..", import.meta.url).pathname)) {
    if (!/^(?:check-|sdd-|gen-)[\w-]*\.mjs$/.test(rel) && rel !== "sdd_gates.py") continue;
    const lines = src(rel).split("\n");
    for (const [i, line] of lines.entries()) {
      if (/^\s*(?:\/\/|#)/.test(line)) continue;
      if (!SPAWN.test(line) || !GIT_CMD.test(line)) continue;
      // 기동이 여러 줄에 걸칠 수 있다 — 인자 목록이 이어지는 다음 줄까지 함께 본다.
      const window = [line, lines[i + 1] || ""].join(" ");
      if (QUOTED_OFF.test(window)) continue;
      offenders.push(`${rel}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [],
    `git 기동이 core.quotepath=off 없이 호출된다 — 비ASCII 경로가 8진수로 인용되면 판정이 조용히, 그리고 양방향으로 틀린다: ${offenders.join(" · ")}`);
});
