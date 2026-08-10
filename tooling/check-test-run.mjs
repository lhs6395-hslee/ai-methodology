#!/usr/bin/env node
// ─── 테스트 스위트 실행 게이트 (SPEC-021) ─────────────────────
// 커버리지 태그 회계(check-fr-coverage)·단언 존재(check-test-adequacy)는 "태깅됨"·"단언함"만
// 볼 뿐 스위트를 실제로 실행하지 않는다 — "커버리지 green"이 "실행 green"으로 오인된다.
// 이 게이트는 runTestsPolicy(off|advisory|hard)로 `commands.test`(로컬 안전 tier)를 실제 실행해
// exit 0(green)을 확인한다. 러너/언어 중립 — 선언된 명령을 그대로 돌리고 exit code만 판정.
// 실행이 느려 pre-commit엔 배선하지 않는다(완료 시점·CI·pre-push opt-in).
// 설계: SPEC-021 (Python판 sdd_gates.py testrun이 동일 동작을 미러 — SPEC-006 패리티).
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { formatRunLine } from "./verification-run-lib.mjs";

export const RUN_TESTS_ENUM = ["off", "advisory", "hard"];

// 순수 판정: 정책 × 명령유무 × exit code → {valid, exit, line}. line이 출력 바이트의 정본.
export function testRunVerdict(policy, hasCommand, exitCode) {
  if (!RUN_TESTS_ENUM.includes(policy)) {
    return { valid: false, exit: 1, line: `✗ runTestsPolicy 값 위반 "${policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)` };
  }
  if (policy === "off") {
    return { valid: true, exit: 0, line: "테스트 실행 게이트 — runTestsPolicy:off (실행 안 함; 완료 주장 전 commands.test 수동 실행 권장 — 커버리지 회계 ≠ 실행 결과)" };
  }
  const hard = policy === "hard";
  if (!hasCommand) {
    return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "⚠"} 테스트 실행 게이트 — runTestsPolicy:${policy}인데 commands.test 미선언 — 실행으로 검증 불가(커버리지 회계 ≠ 실행 결과)` };
  }
  if (exitCode === 0) {
    return { valid: true, exit: 0, line: `테스트 실행 게이트 — commands.test green (runTestsPolicy:${policy})` };
  }
  return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "⚠"} 테스트 실행 게이트 — commands.test 실패 (exit ${exitCode}, runTestsPolicy:${policy})` };
}

// e2e 축 순수 판정(SPEC-021 확장) — 실행 결과 3분기: pass / fail / skipped(사유).
//
// **check-live-reality(SPEC-032)와 같은 계약이되 반전에 주의한다.** 라이브 대조는 "명령이 비-0이면
// 판정 못 함(skipped)"이지만, 테스트에서 비-0은 **실패**다. 그래서 실행 가능 여부를 결과 코드로
// 추론하지 않고 **별도 프로브**(e2ePrecheck)로 판정한다 — 프로브 실패 = skipped(사유), 프로브
// 통과 후 비-0 = 진짜 실패. 둘을 섞으면 "앱이 안 떠서 못 돌렸다"와 "돌렸는데 깨졌다"가 같은
// 초록/빨강이 되어 거짓 안전이 다시 생긴다.
//
// hard인데 skipped면 실패다 — "판정 못 했는데 통과"는 이 킷이 §6에서 금지한 거짓 안전이다.
// 그래서 e2e는 pre-commit에 배선하지 않고 pre-push·CI에서만 돈다(앱 기동 전제).
export const E2E_ENUM = ["off", "advisory", "hard"];

export function e2eRunVerdict(policy, hasCommand, { skipped = "", exitCode = null } = {}) {
  if (!E2E_ENUM.includes(policy)) {
    return { valid: false, exit: 1, line: `✗ e2eTestsPolicy 값 위반 "${policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)` };
  }
  if (policy === "off") {
    return { valid: true, exit: 0, line: "e2e 실행 축 — e2eTestsPolicy:off (판정 안 함; e2e로만 커버된 FR은 check-fr-coverage가 e2e 버킷으로 표면화한다)" };
  }
  const hard = policy === "hard";
  if (!hasCommand) {
    return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "⚠"} e2e 실행 축 — e2eTestsPolicy:${policy}인데 commands.e2e 미선언 — 판정 대상이 없다(거짓 안전)` };
  }
  if (skipped) {
    return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "·"} e2e 실행 축 — [skipped] ${skipped} (판정 못 함이지 '통과'가 아니다${hard ? "; hard에서 미판정은 거짓 안전이라 실패로 센다" : ""})` };
  }
  if (exitCode === 0) {
    return { valid: true, exit: 0, line: `e2e 실행 축 — commands.e2e green (e2eTestsPolicy:${policy})` };
  }
  return { valid: true, exit: hard ? 1 : 0, line: `${hard ? "✗" : "⚠"} e2e 실행 축 — commands.e2e 실패 (exit ${exitCode}, e2eTestsPolicy:${policy})` };
}

// 게이트 진입(직접 실행 시에만) — import 시엔 순수 함수만 노출.

// 엔트리 판정은 `verdict-lib`의 `isMainEntry`다(realpath 비교) — 정의가 한 곳에 있는 이유와
// 문자열 비교가 왜 조용히 미실행을 만드는지는 그 함수의 주석에 있다.
if (isMainEntry(import.meta.url)) {
  // ⚠ arm은 **엔트리일 때만**이다 — 이 모듈을 import만 한 프로세스(테스트 러너 등)에서
  // 종료 훅이 fd 1에 쓰면 그 프로세스의 stdout 프로토콜을 깨뜨린다(실측: node --test IPC 손상).
  armVerdict();
  const cfg = loadConfig();
  const policy = cfg.runTestsPolicy || "off";
  const cmd = (cfg.commands || {}).test;
  let exitCode = null;
  if (RUN_TESTS_ENUM.includes(policy) && policy !== "off" && cmd) {
    // stdio: 자식(테스트 러너)의 stdout을 **부모 stderr(fd 2)로** 보낸다 — `"inherit"`가 아니다.
    // 이유(감사 M-8): 이 게이트의 stdout은 판정 줄 하나가 정본인데(위 `line`), 러너 출력을
    // stdout으로 흘리면 하네스(sdd-sync)가 게이트 stdout 전체를 ⚠/✗로 스캔하다 **러너 텍스트에
    // 걸려** green인 게이트를 "확인 필요"로 읽는다(실측: 킷 자신의 테스트 *이름*에 ⚠·✗가 31줄
    // 들어 있어 R5가 항상 ⚠ — 초록이 경고로 읽히면 사람이 ⚠를 무시하는 습관이 생겨 진짜 경고를
    // 놓친다). fd 2 리다이렉트라 버퍼링·maxBuffer 없이 실시간 출력·진단 가치는 그대로 보존된다.
    try { execSync(cmd, { cwd: cfg.__root, stdio: ["ignore", 2, 2] }); exitCode = 0; }
    catch (e) { exitCode = typeof e.status === "number" ? e.status : 1; }
  }
  const v = testRunVerdict(policy, !!cmd, exitCode);

  // e2e 축 — 선언·정책이 있을 때만 발화한다(미채택 프로젝트 비용 0).
  const e2ePolicy = String(cfg.e2eTestsPolicy || "off");
  const e2eCmd = (cfg.commands || {}).e2e;
  let skipped = "";
  let e2eExit = null;
  if (E2E_ENUM.includes(e2ePolicy) && e2ePolicy !== "off" && e2eCmd) {
    const probe = cfg.e2ePrecheck;
    if (probe) {
      try { execSync(String(probe), { cwd: cfg.__root, stdio: ["ignore", "pipe", "pipe"], timeout: Number(cfg.e2ePrecheckTimeoutMs ?? 60000) }); }
      catch (e) {
        const tail = String((e && (e.stderr || e.message)) || "").trim().split("\n").filter(Boolean).pop();
        skipped = `실행 전제 미충족(e2ePrecheck 실패) — ${tail || "사유 불명"}`;
      }
    }
    if (!skipped) {
      try { execSync(String(e2eCmd), { cwd: cfg.__root, stdio: ["ignore", 2, 2] }); e2eExit = 0; }
      catch (e) { e2eExit = typeof e.status === "number" ? e.status : 1; }
    }
  }
  const ve = e2eRunVerdict(e2ePolicy, !!e2eCmd, { skipped, exitCode: e2eExit });
  // 이 게이트의 원래 결함이 정확히 여기였다 — 정책이 hard인데 명령이 없으면 아무것도 안 돌고
  // exit 0으로 끝났다(여러 라운드 거짓 green). 이제 그 상태는 INERT로 자백된다.
  let kind, why;
  if (policy === "off") { kind = VERDICT_KINDS.OFF; why = "runTestsPolicy"; }
  else if (!cmd) { kind = VERDICT_KINDS.INERT; why = "commands.test 미선언 — 돌릴 스위트가 없다"; }
  else if (skipped) { kind = VERDICT_KINDS.SKIPPED; why = `e2e 전제 미충족 — ${skipped}`; }
  else { kind = VERDICT_KINDS.JUDGED; why = ""; }
  if (kind === VERDICT_KINDS.JUDGED) judged((v.exit ? 1 : 0) + (ve.exit ? 1 : 0));
  else verdict(kind, why);

  // ── 러너는 자기 실행을 **기록**한다(SPEC-041) ────────────────────────────
  // 실측 제보 ②: 러너가 대상 0건으로 exit 0 종료해 "성공"과 "아무것도 안 함"이 구분되지 않았다.
  // 여기서 원장에 남기는 종류가 그 구분이다 — green은 JUDGED, 명령 없음은 INERT, 전제 미충족은
  // SKIPPED(사유). 기록하지 않으면 R14가 이 자산을 "기록 없음"으로 센다(침묵 = 안 돈 것).
  const assets = Array.isArray(cfg.verificationRunTestAssets) ? cfg.verificationRunTestAssets : [];
  const ledgerRel = cfg.verificationRunLedger || null;
  if (assets.length && ledgerRel) {
    const outcome = kind === VERDICT_KINDS.JUDGED && !v.exit && !ve.exit ? VERDICT_KINDS.JUDGED : (kind === VERDICT_KINDS.JUDGED ? VERDICT_KINDS.SKIPPED : kind);
    const detail = outcome === VERDICT_KINDS.JUDGED
      ? `commands.test green (runTestsPolicy:${policy})`
      : (why || `스위트 실패(exit ${v.exit || ve.exit}) — 통과 기록으로 남기지 않는다`);
    const abs = resolveFromRoot(cfg, ledgerRel);
    try {
      mkdirSync(dirname(abs), { recursive: true });
      const at = new Date().toISOString();
      for (const a of assets) appendFileSync(abs, formatRunLine({ asset: a, outcome, detail, at }) + "\n");
    } catch (e) { console.error(`· 검증 실행 기록 실패(${ledgerRel}): ${e.message}`); }
  }
  // 출력 순서: e2e 축 먼저, 스위트 판정 마지막 — 하네스(sdd-sync)가 게이트 stdout의 **마지막 줄**을
  // 요약으로 쓰기 때문이다. 위반은 ⚠/✗ 스캔으로 잡히므로 순서와 무관하게 flagged된다.
  (ve.valid && ve.exit === 0 ? console.log : console.error)(ve.line);
  (v.valid ? console.log : console.error)(v.line);
  process.exit(v.exit || ve.exit);
}
