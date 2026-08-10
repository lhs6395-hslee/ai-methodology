#!/usr/bin/env node
// ─── 감시자 실재 게이트 (SPEC-048, R17) ───
// 오너 실측: **각 프로젝트가 방법론을 무시한다.** 그 무시는 순환 때문에 잡히지 않는다 —
// 무시하는 프로젝트는 게이트를 안 돌리고, 그러면 게이트가 무시를 고발할 기회가 없다.
//
// 순환을 끊는 것은 **우회 불가한 채널**뿐이다. 로컬 훅은 `--no-verify`로 우회되고 웹 UI 머지는
// 훅을 아예 타지 않으며, 게이트 파일은 지워도 아무 일도 일어나지 않는다. 유일하게 커밋한 사람이
// 끌 수 없는 것이 **서버측 CI**다. 그래서 "감시자가 반드시 생성된다"의 실체는 CI 배선이다.
//
// watchdogPolicy: off | advisory(기본) | hard.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, walkFiles } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import {
  parseReceipt, missingGates, ciWiring,
  DEFAULT_WATCHDOG_RECEIPT, DEFAULT_WATCHDOG_CI_GLOBS,
} from "./watchdog-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const POLICY = String(cfg.watchdogPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ watchdogPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "watchdogPolicy");
    console.log("감시자 게이트 — watchdogPolicy:off (판정 안 함)"); return;
  }
  const rel = String(cfg.watchdogReceipt || DEFAULT_WATCHDOG_RECEIPT);
  const abs = join(ROOT, ...rel.split("/"));
  const errors = [], warnings = [];
  const block = (msg) => (POLICY === "hard" ? errors : warnings).push(msg);

  // ── CI 배선 — 영수증과 무관하게 **항상** 본다. 우회 불가한 채널의 실재가 이 축의 핵심이고,
  //    영수증이 없다는 이유로 이 사실을 안 보면 "채택 안 함"이 곧 "판정 안 함"이 된다(순환 복귀).
  const ciGlobs = (cfg.watchdogCiGlobs || DEFAULT_WATCHDOG_CI_GLOBS).map(compileGlob);
  const ciFiles = [];
  for (const p of walkFiles(ROOT, new Set(cfg.ignoreDirs), "", [])) {
    if (!ciGlobs.some((re) => re.test(p))) continue;
    try { ciFiles.push({ path: p, text: readFileSync(join(ROOT, p), "utf8") }); } catch { /* 못 읽은 파일은 없는 것으로 본다 */ }
  }
  const ci = ciWiring(ciFiles, cfg.sweepInvocationMarkers);
  if (!ci.wired.length) {
    block(`CI에 스윕이 배선되지 않았다(CI 파일 ${ci.files}건 검사) — **우회 불가한 감시 채널이 없다**.`
      + " 로컬 훅은 --no-verify로 우회되고 웹 UI 머지는 훅을 타지 않으며, 게이트 파일은 지워도 아무 일도 일어나지 않는다."
      + " 커밋한 사람이 끌 수 없는 것은 서버측 CI뿐이다 — 스윕을 도는 워크플로를 추가하라(sdd-init.sh가 템플릿을 깐다)");
  }

  // ── 채택 영수증 — "채택했다"를 자기신고에서 기계가 읽는 사실로 바꾼다.
  let receipt = null;
  if (!existsSync(abs)) {
    block(`채택 영수증이 없다 — ${rel}. "채택했다"는 말이 자기신고로만 존재하면 무엇이 깔렸는지·언제 깔렸는지`
      + " 아무도 모르고, 지워진 감시자도 지워진 사실을 알리지 않는다. `sh scripts/sdd-init.sh`가 영수증을 남긴다"
      + "(⚠ 영수증은 **커밋한다** — 실행 원장과 달리 이것은 세션 상태가 아니라 채택 선언이다)");
  } else {
    const parsed = parseReceipt(readFileSync(abs, "utf8"));
    for (const e of parsed.errors) block(`${rel}: ${e}`);
    receipt = parsed.receipt;
    if (receipt) {
      const gone = missingGates(receipt, (g) => existsSync(join(ROOT, ...String(g).split("/"))));
      if (gone.length) {
        block(`영수증이 선언한 게이트 ${gone.length}건이 지금 없다: ${gone.slice(0, 6).join(", ")}${gone.length > 6 ? " …" : ""}`
          + " — 감시자가 지워졌는데 아무도 알리지 않았다(지워진 강제는 강제가 아니다)");
      }
    }
  }

  judged(errors.length);
  const stamp = receipt
    ? `채택 ${receipt.installedAt || "(시점 미기록)"}${receipt.kitCommit ? ` · 킷 ${receipt.kitCommit.slice(0, 10)}` : ""}`
      + ` · 게이트 ${receipt.gates.length}종${receipt.gate ? ` · 런타임 ${receipt.gate}` : ""}`
    : "영수증 없음";
  console.log(`감시자 게이트(watchdogPolicy=${POLICY}): ${stamp} · CI 배선 ${ci.wired.length}/${ci.files}건`
    + (ci.wired.length ? ` (${ci.wired.slice(0, 3).join(", ")})` : ""));
  // 상류 대비 낡음은 **판정하지 않는다** — 네트워크 없이 알 수 없고, 모르는 것을 위반으로 말하지
  // 않는다. 대신 채택 시점·킷 커밋을 매 실행 그대로 보여줘 사람이 갱신 시점을 판단하게 한다.
  if (receipt) console.log("  · 킷 최신화는 prompts/update.md 절차로 한다 — 위 채택 시점이 오래됐다면 그것이 신호다(게이트는 상류를 모른다).");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length) {
    console.error(`\n✗ 감시자가 실재하지 않는다 ${errors.length}건:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  if (!warnings.length) console.log("  ✓ 우회 불가한 채널(CI)에 스윕이 배선돼 있고 채택 영수증이 실재한다.");
}

if (import.meta.url === `file://${process.argv[1]}`) { armVerdict(); main(); }
