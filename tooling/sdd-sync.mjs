#!/usr/bin/env node
// ─── SDD 하네스 — detect 집계기 ───────────────────────────────
// HARNESS.md 규칙표의 detect 단계: 규칙별 detector 게이트를 일괄 실행하고
// "확인 필요/clean"을 규칙별로 리포트한다. 스킬 /sdd-sync 과 pre-push 훅이 소비.
// advisory(기본): 리포트 + exit 0. --strict: 발견 있으면 exit 1.
// --json: 기계 판독 리포트(스키마 v1)만 stdout에 출력(사람 텍스트 억제) — ask 층이 소비.
//
// 탐지 로직은 게이트에 있다(판정 신규 0). 이 파일은 오케스트레이션만.
// Usage: node scripts/sdd-sync.mjs [--strict] [--json]

import { execFileSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";
import { dirname, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
// fileURLToPath: 한글 등 비-ASCII 경로에서 URL.pathname은 %-인코딩돼 게이트가 조용히 스킵된다(도그푸딩 발견).
const HERE = dirname(fileURLToPath(import.meta.url));

// 규칙 → detector 게이트(HARNESS.md 규칙표). 같은 디렉토리에서 게이트를 찾는다.
const RULES = [
  { rule: "R1 spec→code", gates: ["check-fr-coverage.mjs"] },
  { rule: "R2 code→spec", gates: ["check-converge-drift.mjs", "check-orphan-surfaces.mjs", "check-spec-sync.mjs"] },
  { rule: "R3 dedup+입도+완전성+일관성", gates: ["check-ownership.mjs", "check-spec-cohesion.mjs", "check-spec-completeness.mjs", "check-spec-consistency.mjs",
    // 보증 맵 드리프트(SPEC-028) — 맵이 현재 소유 선언과 갈라지면 "미판정" 가시성이 낡은 사실을
    // 보여준다. `--check`는 읽기 전용(재생성 안 함) — 강제점이 없어 사람이 기억해야 하던 구멍을 닫는다.
    { file: "gen-ownership-map.mjs", args: ["--check", "--if-present"] }] },
  // R5(감사 M1): 테스트 실행 결과 — runTestsPolicy가 off(기본)면 게이트가 스스로 no-op라 비용 0.
  // SPEC-021이 선언한 "CI·pre-push" 발동 지점의 실제 배선(선언만 있고 호출처 0곳이던 결함 봉합).
  { rule: "R5 test 실행(commands.test)", gates: ["check-test-run.mjs"] },
  // R6(SPEC-027): 강제 정책 강도의 단조성 — knob 하향(회피)을 차단. policyRatchetPolicy가
  // off면 게이트가 스스로 no-op. base config 미조회(최초 채택)면 skip이라 비용 0.
  { rule: "R6 정책 래칫(강도 단조)", gates: ["check-policy-ratchet.mjs"] },
  // R7(SPEC-030): Engines·Events 카테고리 — 전수성 구멍 봉합. 두 정책이 off(기본)면 게이트가
  // 스스로 no-op라 비용 0(옵트인 — ownershipCategoryRoles로 engine/event 역할 선언 시 활성).
  { rule: "R7 Engines·Events(전수성)", gates: ["check-engine-event.mjs"] },
  // R8·R9(SPEC-031·032): "선언이 실제로 동작하는가" 축. 문서 정합(R1~R3)이 green이어도 산출물이
  // 런타임에서 죽어 있을 수 있다(실측: 게이트 전종 통과인데 대시보드 패널 30여 개 사망).
  // 둘 다 기본 off라 미채택 프로젝트는 비용 0. 라이브 대조는 자격증명 없으면 skipped(하드 실패 금지).
  { rule: "R8 실행 증거([검증] 경로)", gates: ["check-evidence.mjs"] },
  { rule: "R9 라이브 대조(저장소 밖 진실)", gates: ["check-live-reality.mjs"] },
  // R10(SPEC-033): 동의어·형태 변이 — dedup이 키 문자열만 보는 사각. ①② 결정적(차단 가능),
  // ③ 확률적 후보는 **어떤 강도에서도 advisory**(LLM 오탐에 차단력을 주지 않는다). 기본 off.
  { rule: "R10 동의어·형태 변이", gates: ["check-synonym.mjs"] },
  // R11(SPEC-034): SC·NFR 검증 회계 — FR만 회계하던 사각. 성능·보안 목표가 산문으로 방치돼도
  // green이던 것을 닫는다. 기본 off(선언 문법이 있는 프로젝트만 발화).
  { rule: "R11 SC·NFR 검증 회계", gates: ["check-sc-coverage.mjs"] },
  // R12(SPEC-004 FR-013): 훅 배선 실재 — 게이트가 다 있어도 .git/hooks가 비어 있으면 아무것도
  // 발동하지 않는다. 게이트의 inert만 보고 훅의 inert를 안 보면 미설치가 green으로 읽힌다.
  { rule: "R12 훅 배선 실재", gates: ["check-hooks-installed.mjs"] },
];

const lastLine = (s) => (s || "").trim().split("\n").pop() || "";

// 순수 판정: 게이트 실행 결과(부재·크래시·stdout) → {flagged, summary}.
// **게이트의 stdout이 판정의 정본**이라는 계약 위에 서 있다 — 게이트는 자기 판정 줄만 stdout에
// 쓰고, 하위 프로세스 출력을 stdout으로 흘리지 않는다(그러면 여기 스캔이 러너 텍스트에 걸려
// green을 ⚠로 읽는다 — 감사 M-8, check-test-run.mjs가 fd 2로 리다이렉트해 지키는 규약).
// ⚠ **출력 0줄은 clean이 아니라 미판정이다:** exit 0과 "판정했음"은 다른 사실이다. 무음 미실행
// (엔트리 판정 실패·조건 분기 누락)은 exit 0으로 끝나므로, 출력 코드만 보면 거짓 green이 된다
// (실측: 비-ASCII 경로에서 check-test-run이 한 줄도 내지 않고 exit 0 → `runTestsPolicy: hard`가
// 여러 라운드 거짓 green). 판정 대상이 없어 발화하지 않는 게이트도 "off/no-op/skip" 한 줄을 낸다.
export function gateOutcome({ file, missing = false, crashed = false, stdout = "", stderr = "", timedOut = false, skippedBudget = false }) {
  if (missing) return { flagged: true, summary: `(없음: ${file}) — detector 미설치라 이 규칙은 판정 없음(sdd-init/update로 배선 갱신 필요)` };
  // 시간 예산 — 훅이 몇 초를 넘기면 사람이 --no-verify로 우회하고, 그러면 훅이 통째로 무의미해진다.
  // 그래서 끊되 **조용히 통과시키지 않는다**: 못 본 것은 "미판정"으로 남아 flagged다(§exit 0 ≠ 판정했음).
  if (timedOut) return { flagged: true, summary: `(미판정: 시간 초과) — ${file}이 제한 시간 안에 끝나지 않아 판정하지 못했다(통과 아님). 전체 판정: node scripts/sdd-sync.mjs` };
  if (skippedBudget) return { flagged: true, summary: `(미판정: 시간 예산 소진) — ${file}을 실행하지 않았다(통과 아님). 전체 판정: node scripts/sdd-sync.mjs` };
  if (crashed) return { flagged: true, summary: lastLine(stdout) || lastLine(stderr) || "(비정상 종료)" };
  if (!stdout.trim()) return { flagged: true, summary: `(출력 없음 — 게이트가 한 줄도 판정하지 않음: 무음 미실행 의심, exit 0 ≠ 판정함)` };
  return { flagged: /[⚠✗]/.test(stdout), summary: lastLine(stdout) };
}

// 게이트 항목은 문자열이거나 {file, args} — 일부 detector는 읽기 전용 모드 인자가 필요하다
// (예: gen-ownership-map은 무인자면 파일을 **재생성**하므로 스윕에선 반드시 `--check`).
const gateFile = (g) => (typeof g === "string" ? g : g.file);
const gateArgs = (g) => (typeof g === "string" ? [] : (g.args || []));

// 시간 예산(SPEC-004 FR-012) — pre-push에서 스윕이 수십 초 걸리면 사람이 `--no-verify`로 우회하고
// 그 순간 훅 전체가 무의미해진다(실측 제보: 30초+ 타임아웃으로 매 push가 멈춰 우회가 습관이 됐다).
// 그래서 훅 경로에는 예산을 준다. 핵심은 **끊되 조용히 통과시키지 않는 것** — 못 본 게이트는
// "미판정"으로 남아 flagged이고, 전체 판정은 사람이 인자 없이 다시 돌린다.
//   --budget <ms> | env SDD_SYNC_BUDGET_MS (0·미지정 = 무제한)
const argBudget = (() => {
  const i = process.argv.indexOf("--budget");
  const v = i >= 0 ? Number(process.argv[i + 1]) : Number(process.env.SDD_SYNC_BUDGET_MS || 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
})();
// 훅 모드 위임(SPEC-004 FR-012) — pre-push에서 무거운 규칙을 **선언적으로** 다른 트리거에 넘긴다.
// 실측: 스윕 전체 30.3초 중 R5(스위트 실행)가 29.8초, 나머지 10규칙 합계 0.5초. 30초 훅은 반드시
// `--no-verify`로 우회되고 그 순간 훅 전체가 무의미해진다.
// **조용한 생략과 다른 점:** ①config에 실행 규칙을 선언하고 ②담당자를 명시해야 하며(둘 다 없으면
// 에러) ③위임된 규칙은 매 실행 "위임 — 누가 판정하는지"를 출력한다. 사유 있는 skipped(SPEC-032)와
// 같은 계약이라 flagged가 아니다. 사유 없이 사라지는 것만 미판정으로 센다.
const HOOK_MODE = process.argv.includes("--hook");
const startedAt = Date.now();
const remaining = () => (argBudget ? Math.max(0, argBudget - (Date.now() - startedAt)) : Infinity);

function runGate(g) {
  const file = gateFile(g);
  const path = join(HERE, file);
  if (!existsSync(path)) return gateOutcome({ file, missing: true });
  const left = remaining();
  if (left <= 0) return gateOutcome({ file, skippedBudget: true });
  try {
    // stdio: stderr를 캡처(부모로 inherit 금지) — 게이트가 크래시해도 누출 없이 리포트에 담는다.
    const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    if (Number.isFinite(left)) { opts.timeout = left; opts.killSignal = "SIGKILL"; }
    const out = execFileSync("node", [path, ...gateArgs(g)], opts);
    return gateOutcome({ file, stdout: out });
  } catch (e) {
    // 타임아웃은 크래시가 아니다 — "판정 못 함"으로 구분해야 통과로 오독되지 않는다.
    if (e && (e.killed || e.signal === "SIGKILL" || e.code === "ETIMEDOUT")) return gateOutcome({ file, timedOut: true });
    return gateOutcome({ file, crashed: true, stdout: e.stdout || "", stderr: e.stderr || "" });
  }
}

// 규칙별 detector 실행 → 데이터 모델(사람/JSON 공통). rule id는 안정 계약(R1/R2/R3).
function hookDelegation() {
  if (!HOOK_MODE) return null;
  let cfg = {};
  try { cfg = loadConfig(); } catch { return null; }
  const rules = cfg.syncHookRules;
  if (!Array.isArray(rules) || !rules.length) return null; // 미선언 = 전체 실행(하위호환)
  const to = String(cfg.syncHookDelegatedTo || "").trim();
  if (!to) {
    console.error("✗ syncHookRules를 선언했으면 syncHookDelegatedTo(누가 대신 판정하나)도 필수 — 담당자 없는 생략은 조용한 미판정이다.");
    process.exit(1);
  }
  return { run: new Set(rules.map(String)), to };
}
const DELEGATION = hookDelegation();

function collect() {
  return RULES.map(({ rule, gates }) => {
    const sp = rule.indexOf(" ");
    const id = rule.slice(0, sp); // "R1"
    const title = rule.slice(sp + 1); // "spec→code"
    if (DELEGATION && !DELEGATION.run.has(id)) {
      return { id, title, flagged: false, delegated: true,
        gates: [{ gate: gates.map(gateFile).join("·"), flagged: false,
          summary: `위임 — 이 훅에서는 판정하지 않는다(담당: ${DELEGATION.to}). 지금 보려면: node scripts/sdd-sync.mjs` }] };
    }
    const gateResults = gates.map((g) => {
      const r = runGate(g);
      return { gate: gateFile(g), flagged: r.flagged, summary: r.summary };
    });
    return { id, title, flagged: gateResults.some((g) => g.flagged), gates: gateResults };
  });
}

// 엔트리 판정은 realpath 비교다 — `file://${argv[1]}` 문자열 비교는 비-ASCII 경로(%-인코딩)·
// 심볼릭 링크(/var↔/private/var)에서 갈려 main 블록이 **조용히 미실행**된다(SPEC-021 실측 결함).
function isMainEntry(metaUrl) {
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isMainEntry(import.meta.url)) {
  const rules = collect();
  const flaggedRules = rules.filter((r) => r.flagged).map((r) => r.id);
  const clean = flaggedRules.length === 0;

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, clean, flaggedRules, rules }, null, 2) + "\n");
  } else {
    console.log("SDD sync 리포트 — detector 일괄 실행 (HARNESS.md 규칙표)");
    for (const r of rules) {
      console.log(`\n● ${r.id} ${r.title}: ${r.delegated ? "· 위임" : r.flagged ? "⚠ 확인 필요" : "✓ clean"}`);
      for (const g of r.gates) console.log(`    [${g.gate}] ${g.summary}`);
    }
    console.log(
      clean
        ? `\n요약: 전부 sync ✓`
        : `\n요약: 확인 필요 — ${rules.filter((r) => r.flagged).map((r) => `${r.id} ${r.title}`).join(", ")} → node scripts/sdd-sync.mjs 리포트로 의사결정(Claude Code: /sdd-sync)`
    );
  }
  if (STRICT && !clean) process.exit(1);
}
