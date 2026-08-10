#!/usr/bin/env node
// ─── 진단 진입점 명세 강제 열람 (SPEC-053, R21) ───
// 실측 제보: 에이전트가 명세에 이미 답이 있는데 읽지 않고 실측으로 다시 찾았고 결론까지 틀렸다.
// 소유자가 여러 세션에 걸쳐 금지한 조회 경로가 재발했다.
//
// **커밋 게이트로는 원리상 불가능하다** — 조회는 커밋도 파일 변경도 남기지 않는다. 유일하게
// 결정적인 지점은 **도구 호출 직전**이고, 그래서 이 게이트는 두 모드로 산다:
//
//   ① 훅 모드(인자·stdin에 명령이 있음) — PreToolUse. surface는 위치를 띄우고 deny는 exit 2.
//   ② 스윕 모드(명령 없음) — **선언 자체를 판정한다.** 이 축의 자기결함은 조용한 무발화다:
//      잘못된 선언은 아무것도 막지 않고 아무것도 알리지 않는다.
//
// diagnosisGuardPolicy: off | advisory(기본) | hard(킷 자신).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import {
  parseDiagnosisMap, validateDiagnosisMap, judgeCommand, formatGuidance,
  GUARD_FINDING_TEXT, DEFAULT_GUIDE_SECTIONS,
} from "./diagnosis-guard-lib.mjs";

import { armVerdict, verdict, judged, isMainEntry, VERDICT_KINDS } from "./verdict-lib.mjs";

// 훅 입력에서 명령을 뽑는다 — PreToolUse는 `{"tool_input":{"command":"…"}}`를 stdin으로 준다.
// ⚠ stdin은 **훅 모드에서만** 읽는다. 무조건 읽으면 스윕이 이 게이트를 파이프로 잡을 때
// 데이터 없는 열린 파이프에서 영원히 블록된다(실측: 스윕이 타임아웃까지 매달렸다). 훅이 몇 초를
// 넘기면 사람이 우회하고, 스윕이 멈추면 그날의 판정이 통째로 사라진다 — 둘 다 조용한 실패다.
function commandFromArgs(argv, hook) {
  const rest = argv.filter((a) => a !== "--hook");
  if (rest.length) return rest.join(" ");
  if (!hook) return "";
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { return ""; }
  if (!raw.trim()) return "";
  try {
    const o = JSON.parse(raw);
    return String(o?.tool_input?.command ?? o?.command ?? "");
  } catch {
    // JSON이 아니면 원문을 명령으로 본다(사람이 직접 부를 때).
    return raw.trim();
  }
}

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.diagnosisGuardPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ diagnosisGuardPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  const HOOK = process.argv.includes("--hook");
  const command = commandFromArgs(process.argv.slice(2), HOOK);
  const entries = parseDiagnosisMap(cfg.diagnosisSpecMap);
  const sections = cfg.diagnosisGuideSections || DEFAULT_GUIDE_SECTIONS;

  if (POLICY === "off") {
    // 훅 계층에서는 침묵이 계약이다 — 매 Bash 명령에 한 줄이 붙으면 소음이 되고 사람이 훅을 끈다.
    if (HOOK) process.exit(0);
    verdict(VERDICT_KINDS.OFF, "diagnosisGuardPolicy");
    console.log("진단 가드 게이트 — diagnosisGuardPolicy:off (판정 안 함)"); return;
  }

  // ── 훅 모드 ────────────────────────────────────────────────────────────────
  if (HOOK || command) {
    if (!entries.length) process.exit(0);                 // 선언 없음 — 훅에서는 침묵
    const r = judgeCommand(command, entries, cfg.diagnosisSpecReadPatterns);
    if (r.verdict === "allow") process.exit(0);           // 명세 읽기·무관 명령 — 침묵이 정답
    const lines = formatGuidance(r.entry, sections);
    if (r.verdict === "deny" && POLICY === "hard") {
      for (const l of lines) console.error(l);
      console.error("  (이 조회가 정말 필요하면 그 스펙을 고쳐 금지를 걷어내라 — 우회가 아니라 명세 편집이다)");
      process.exit(2);                                    // PreToolUse 규약 — 비-0이 도구 실행을 막는다
    }
    for (const l of lines) console.log(l);
    process.exit(0);                                      // advisory·surface — 노출만 하고 막지 않는다
  }

  // ── 스윕 모드: 선언 자체를 판정한다 ────────────────────────────────────────
  if (!entries.length) {
    verdict(VERDICT_KINDS.INERT, "diagnosisSpecMap 미선언 — 무엇에 발화할지 모른다");
    console.log("[안 봄(판정 입력 없음)] 진단 가드 게이트 — `diagnosisSpecMap` 미선언: **판정하지 않는다**."
      + " 조사 전에 읽어야 할 명세가 있으면 `{ match: <명령 정규식>, spec: <그 답이 있는 스펙>, mode: surface|deny, why, instead }`로 선언하라."
      + " 조회는 커밋도 파일 변경도 남기지 않으므로 **커밋 게이트로는 원리상 볼 수 없는 층**이다.");
    return;
  }
  const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
  let specNames = [];
  try { specNames = readdirSync(SPEC_DIR); } catch { specNames = []; }
  const specExists = (ref) => {
    const r = String(ref);
    if (existsSync(join(cfg.__root, ...r.split("/")))) return true;
    // ID로 지목했으면 그 ID를 가진 스펙 파일이 있으면 인정한다.
    return specNames.some((n) => n.includes(r));
  };
  const findings = validateDiagnosisMap(entries, specExists);
  judged(POLICY === "hard" ? findings.length : 0);
  const deny = entries.filter((e) => e.mode === "deny").length;
  console.log(`진단 가드 게이트(diagnosisGuardPolicy=${POLICY}): 규칙 ${entries.length}종`
    + ` (금지 ${deny} · 노출 ${entries.length - deny}) — 선언 위반 ${findings.length}`);
  const tag = POLICY === "hard" ? "✗" : "⚠";
  for (const f of findings) {
    const extra = f.spec ? ` (${f.spec})` : f.got ? ` (${f.got})` : "";
    (POLICY === "hard" ? console.error : console.log)(`  ${tag} [${f.at}] ${GUARD_FINDING_TEXT[f.kind]}${extra}`);
  }
  if (findings.length && POLICY === "hard") {
    console.error("\n✗ 진단 가드 선언이 깨졌다 — 이 축의 자기결함은 **조용한 무발화**다:"
      + " 잘못된 선언은 아무것도 막지 않고 아무것도 알리지 않는다.");
    process.exit(1);
  }
  if (!findings.length) {
    console.log(`  ✓ 규칙 ${entries.length}종이 모두 실재하는 스펙을 지목하고 사유·대안을 갖는다.`);
    console.log("  · 이 층은 **도구 호출 직전**에 발동한다 — 조회는 커밋도 파일 변경도 남기지 않으므로"
      + " 커밋 게이트로는 원리상 볼 수 없다. 배선 실재는 R19(에이전트 배선)가 판정한다.");
  }
}

if (isMainEntry(import.meta.url)) {
  // ⚠ `quietWhenSilent`는 **훅 모드에서만**이다. 이 게이트는 스윕에도 등재돼 있고(R21),
  // SPEC-040은 스윕 등재 게이트가 이 옵션을 쓰는 것을 금지한다 — 스윕에서 침묵하면 "판정 안 함"이
  // 집계에서 사라진다. 훅 계층에서만 침묵이 계약이다(매 Bash 명령에 한 줄이 붙으면 소음이 되고
  // 소음이 되는 순간 사람이 훅을 끈다). config 값 위반처럼 판정을 시작조차 못 한 경우 스윕에서는
  // UNTYPED로 자백하는 것이 정직하다.
  armVerdict({ quietWhenSilent: process.argv.includes("--hook") });
  main();
}
