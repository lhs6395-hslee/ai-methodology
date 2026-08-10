#!/usr/bin/env node
// ─── 완료 판정 신호 강도 게이트 (SPEC-055, R22) ───
// 실측 제보: 배포 완료를 **파생 신호로 판정했다.** 파이프라인 로그에 성공 줄이 있고 CI가 초록이어서
// 완료로 보고했는데, 실제로는 migrate Job이 실패해 배포 스테이지가 스킵된 상태였다.
// **로그와 상태는 대상이 아니라 대상에 대한 이야기다.**
//
// 판정 대상은 **선언**이다 — 완료를 주장하는 검사가 무엇을 관측하는지 스스로 밝히게 만든다.
// 명령을 실행해 "이 명령이 정말 대상을 조회하는가"를 판정하지는 않는다: 그것은 정적으로 결정되지
// 않고, 추측으로 판정하면 오탐이 쌓여 사람이 게이트를 끈다. 선언을 요구하고 **선언을 판정한다.**
//
// completionSignalPolicy: off | advisory(기본) | hard.
import { loadConfig } from "./sdd-config.mjs";
import { completionFindings, SIGNAL_FINDING_TEXT, SIGNAL_KINDS, SIGNAL_KIND_TEXT, COMPLETION_MIN_SIGNAL } from "./completion-signal-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.completionSignalPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ completionSignalPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "completionSignalPolicy");
    console.log("완료 신호 게이트 — completionSignalPolicy:off (판정 안 함)"); return;
  }
  const HARD = POLICY === "hard";

  // 완료 주장은 **라이브 대조 선언**에서 온다(SPEC-032) — 저장소 밖 진실을 보는 검사가 곧
  // "됐는가"를 말하는 자리다. 다른 선언 원천이 생기면 여기 합친다(판정은 한 곳에서 한다).
  const checks = Array.isArray(cfg.liveRealityChecks) ? cfg.liveRealityChecks : [];
  const claims = checks.map((c) => ({
    id: String((c && c.id) || ""),
    assertsCompletion: Boolean(c && c.assertsCompletion),
    signal: c && c.signal,
  }));
  const asserting = claims.filter((c) => c.assertsCompletion);

  if (!asserting.length) {
    // **판정 입력이 없는 것을 clean으로 말하지 않는다**(SPEC-040 INERT).
    verdict(VERDICT_KINDS.INERT, `완료를 주장하는 검사 0건 — liveRealityChecks 항목에 assertsCompletion을 선언하면 판정한다`);
    console.log(`[안 봄(판정 입력 없음)] 완료 신호 게이트 — 완료를 주장하는 검사가 선언되지 않았다(검사 ${checks.length}건 중 0건).`);
    console.log(`  · "됐는가"를 말하는 검사에 \`assertsCompletion: true\`와 \`signal\`을 붙이면`
      + ` 그 판정이 **대상 상태를 봤는지** 대조한다 — ${SIGNAL_KINDS.map((k) => `${k}(${SIGNAL_KIND_TEXT[k]})`).join(" · ")}`);
    return;
  }

  const findings = completionFindings(asserting, COMPLETION_MIN_SIGNAL);
  judged(findings.length);
  console.log(`완료 신호 게이트(completionSignalPolicy=${POLICY}): 완료 주장 ${asserting.length}건 검사`
    + ` (하한 ${COMPLETION_MIN_SIGNAL}) — 위반 ${findings.length}건`);
  const tag = HARD ? "✗" : "⚠";
  for (const f of findings) {
    const got = f.got ? ` (선언: ${f.got})` : "";
    console.log(`  ${tag} [${f.id}]${got} ${SIGNAL_FINDING_TEXT[f.kind]}`);
  }
  if (findings.length && HARD) {
    console.error(`\n✗ completionSignalPolicy=hard: 완료 판정이 대상 상태를 관측하지 않는다 ${findings.length}건.`);
    console.error("  · 해소는 신호 종류를 고쳐 적는 것이 아니라 **대상을 조회하는 검사를 더하는 것**이다"
      + "(선언을 target-state로 바꾸면서 명령이 그대로면 그 선언은 거짓이 된다).");
    process.exit(1);
  }
  if (!findings.length) {
    console.log(`완료 신호 게이트: OK — 완료를 주장하는 ${asserting.length}건이 모두 대상 상태를 관측한다고 선언한다.`);
    console.log("  · 이 축은 **선언**을 판정한다 — 그 명령이 정말 대상을 조회하는지는 정적으로 결정되지 않는다"
      + "(추측으로 판정하면 오탐이 쌓이고, 오탐이 잦은 게이트는 꺼진다).");
  }
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
