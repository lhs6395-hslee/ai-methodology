#!/usr/bin/env node
// ─── 게이트 실패 에스컬레이션 (SPEC-057, R24) ───
// 실측 제보(2026-08-11): 에이전트가 하루에 같은 실수를 세 번 했다(FR을 섹션 밖에 썼다). 게이트는
// 세 번 다 잡았고 매번 사유를 정확히 말했다 — 그런데 **"이게 오늘 세 번째"라는 정보가 어디에도
// 없었다.** 지금 없는 것은 감시자가 아니라 **기억**이다.
//
// 원장(.sdd/gate-failures.jsonl)은 verdict-lib.mjs의 armVerdict가 모든 판정 게이트의 차단을
// 자동으로 적는다 — 이 게이트는 그것을 읽어 같은 (게이트,클래스)가 임계치를 넘겼는데 전용
// 가드가 없으면 "가드를 만들어라"를 말한다. **목적은 벌이 아니라 가시성이다**: 세 번째에 이
// 게이트가 뜨면 그날의 반복은 애초에 없었다.
//
// gateFailureEscalationPolicy: off | advisory(기본) | hard.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import {
  parseLedger, classCounts, guardFindings, escalationFindings, GUARD_FINDING_TEXT,
  DEFAULT_GATE_FAILURE_LEDGER, DEFAULT_ESCALATION_THRESHOLD,
} from "./gate-failure-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.gateFailureEscalationPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ gateFailureEscalationPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "gateFailureEscalationPolicy");
    console.log("게이트 실패 에스컬레이션 — gateFailureEscalationPolicy:off (판정 안 함)"); return;
  }
  const HARD = POLICY === "hard";
  const ROOT = cfg.__root;
  const rel = String(cfg.gateFailureLedger || DEFAULT_GATE_FAILURE_LEDGER);
  const abs = join(ROOT, ...rel.split("/"));

  let raw = null;
  try { raw = readFileSync(abs, "utf8"); } catch { /* 원장 없음 — 아직 차단 이력이 없다 */ }
  if (raw == null) {
    verdict(VERDICT_KINDS.INERT, `원장이 없다 — ${rel}. 게이트가 아직 차단한 적이 없거나 이 작업본이 새로 만들어졌다`);
    console.log(`게이트 실패 에스컬레이션 — 원장 없음(${rel}, 판정 안 함).`);
    return;
  }

  // 선언 자체를 판정한다 — 이 축의 자기결함은 **조용한 무발화**다(4필드 중 하나라도 없으면 그
  // 가드는 아무것도 가리지 못하는데 침묵하면 사람은 "가드가 있어서 침묵한다"로 오해한다).
  const guards = Array.isArray(cfg.gateFailureGuards) ? cfg.gateFailureGuards : [];
  const gErrors = guardFindings(guards, (g) => existsSync(join(ROOT, ...String(g).split("/"))));
  if (gErrors.length) {
    verdict(VERDICT_KINDS.JUDGED, `가드 선언 오류 ${gErrors.length}건`);
    console.error("✗ gateFailureGuards 선언 오류:");
    for (const e of gErrors) console.error(`  ✗ [${e.at}] ${GUARD_FINDING_TEXT[e.kind]}${e.guard ? `: ${e.guard}` : ""}`);
    process.exit(1);
  }

  const { records, unreadable } = parseLedger(raw);
  const threshold = Number(cfg.gateFailureEscalationThreshold) || DEFAULT_ESCALATION_THRESHOLD;
  const counts = classCounts(records);
  const findings = escalationFindings(counts, guards, threshold);

  judged(findings.length);
  const classed = counts.reduce((n, c) => n + c.count, 0);
  console.log(`게이트 실패 에스컬레이션(gateFailureEscalationPolicy=${POLICY}): 원장 ${records.length}건(클래스 선언 ${classed}건)`
    + ` — 임계치 ${threshold} 초과 미가드 ${findings.length}건`
    + (unreadable ? ` · 확인 못 함(파싱 실패) ${unreadable}건` : ""));
  const tag = HARD ? "✗" : "⚠";
  for (const f of findings) {
    const targets = f.targets.slice(0, 3).join(", ") + (f.targets.length > 3 ? " …" : "");
    console.log(`  ${tag} [${f.gate}] "${f.class}" 클래스가 ${f.count}회 반복됐다(대상: ${targets || "—"}) — 전용 가드가 없다.`);
    console.log(`     → gateFailureGuards에 { gate: "${f.gate}", class: "${f.class}", guard: "<새 게이트 파일>", note: "<왜 해소되는가>" }를`
      + " 추가하거나, 그 전에 전용 가드를 실제로 만들어라(선언만으로는 다음 실행에서 다시 잡힌다 — 가드 파일 실재를 대조한다).");
  }
  if (findings.length && HARD) {
    console.error("\n✗ gateFailureEscalationPolicy=hard: 반복된 실패 클래스가 있는데 전용 가드가 없다 — 같은 실수를 다시 겪었다.");
    process.exit(1);
  }
  if (!findings.length) console.log("게이트 실패 에스컬레이션: OK — 임계치를 넘긴 미가드 클래스가 없다.");
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
