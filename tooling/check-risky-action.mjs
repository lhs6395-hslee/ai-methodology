#!/usr/bin/env node
// ─── 위험 행동 승인 게이트 (SPEC-058, R25) ───
// 실측 제보(2026-08-14): 같은 세션에서 두 사고가 났다 — QA 실측·트래커 댓글까지 마친 뒤 아직
// 배포도 안 된 티켓을 종결 상태로 넘기려 했고, 그 실수를 고치라고 하자 규칙을 개인 memory
// 파일에 적으려 했다(정작 그 프로젝트 명세가 "규칙을 사적 메모리에만 박으려 함"을 이미 실패
// 사례로 지목해뒀는데도). 둘 다 **커밋 이전**, 대화 안에서 끝나 기존 커밋 게이트가 원리상
// 관여할 지점이 없었다. SPEC-053(진단가드)·SPEC-035(배포가드)와 같은 층(도구 호출 직전)이지만
// 구제 방식이 다르다 — 이 축은 "독립 컨텍스트 서브에이전트가 명세 원문·실제 상태를 대조해
// 확인했다"는 증거(승인 마커)를 요구한다.
//
// **게이트는 서브에이전트를 스스로 부르지 않는다.** 차단 메시지가 "확인 후 --record로 마커를
// 남겨라"를 지시할 뿐이고, 실제 호출은 차단당한 실행기가 자기 도구로 한다. 이 게이트는 마커의
// 존재·행동 해시 일치·신선도만 결정론적으로 본다 — 검증의 진실성은 판정 대상이 아니다.
//
// riskyActionPolicy: off | advisory(기본) | hard.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import {
  parseRiskyActionPatterns, validateRiskyActionPatterns, matchRiskyAction, hashAction,
  parseApprovalLedger, makeApprovalRecord, findApproval, ACTION_APPROVAL_GUARD_FINDING_TEXT,
  DEFAULT_ACTION_APPROVAL_LEDGER, DEFAULT_APPROVAL_TTL_SECONDS,
  canonicalToolPayload, toolCallFromHookInput,
} from "./action-approval-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

// SPEC-057 소비 계약의 클래스 접두어 — 패턴별 class는 declaraion이 정하지만, 이 게이트 자신이
// 낸 차단이라는 사실은 이 접두어로 구분한다(같은 class 문자열이 다른 게이트에서도 쓰일 수 있어
// 게이트명은 gate-failure-lib의 (gate,class) 쌍이 이미 구분한다 — 여기서는 별도 접두어 불필요).
function ledgerPath(cfg) {
  const rel = String(cfg.riskyActionLedger || DEFAULT_ACTION_APPROVAL_LEDGER);
  return join(cfg.__root, ...rel.split("/"));
}

function readLedger(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function recordMode(cfg, argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const command = get("--command");
  const cls = get("--class");
  const note = get("--note");
  if (!command || !cls || !note) {
    console.error("✗ --record는 --command·--class·--note가 모두 필요하다(승인 근거를 지어내지 않는다).");
    process.exit(1);
  }
  const hash = hashAction(command);
  const record = makeApprovalRecord({
    hash, class: cls, note, ts: new Date().toISOString(), sessionId: process.env.SDD_SESSION_ID || "unknown",
  });
  const path = ledgerPath(cfg);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, (existsSync(path) ? readFileSync(path, "utf8") : "") + JSON.stringify(record) + "\n");
  verdict(VERDICT_KINDS.SKIPPED, "--record 모드(판정이 아니라 승인 기록)");
  console.log(`위험 행동 승인 게이트: 승인 기록됨 — class="${cls}" hash=${hash.slice(0, 12)}… (유효기간은 riskyActionApprovalTtlSeconds)`);
}

function main() {
  const cfg = loadConfig();
  const argv = process.argv.slice(2);
  const POLICY = String(cfg.riskyActionPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ riskyActionPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  const HOOK = argv.includes("--hook");
  const RECORD = argv.includes("--record");
  const entries = parseRiskyActionPatterns(cfg.riskyActionPatterns);

  if (POLICY === "off") {
    if (HOOK) process.exit(0);              // 훅 계층 — 침묵이 계약이다
    verdict(VERDICT_KINDS.OFF, "riskyActionPolicy");
    console.log("위험 행동 승인 게이트 — riskyActionPolicy:off (판정 안 함)"); return;
  }

  if (RECORD) { recordMode(cfg, argv); return; }

  // ── 훅 모드 ────────────────────────────────────────────────────────────────
  if (HOOK) {
    if (!entries.length) process.exit(0);   // 선언 없음 — 훅에서는 침묵
    const { toolName, command, toolInput } = toolCallFromHookInput(process.argv, () => readFileSync(0, "utf8"));
    const entry = matchRiskyAction({ toolName, command }, entries);
    if (!entry) process.exit(0);            // 위험 패턴 미매치 — 침묵이 정답

    // Bash(match)는 명령 문자열을 그대로 해시한다(하위호환). 그 외 도구(tool)는 명령 문자열이
    // 없으므로 {tool, input}의 정준 페이로드를 해시한다 — --record --command에 그대로 넘길 문자열.
    const payload = entry.tool ? canonicalToolPayload(toolName, toolInput) : command;
    const hash = hashAction(payload);
    const ttl = Number(cfg.riskyActionApprovalTtlSeconds) || DEFAULT_APPROVAL_TTL_SECONDS;
    const raw = readLedger(ledgerPath(cfg));
    const { records } = raw == null ? { records: [] } : parseApprovalLedger(raw);
    const approval = findApproval(hash, records, ttl, Date.now());
    if (approval) process.exit(0);          // 유효한 승인 있음 — 침묵 통과

    // 매치했는데 유효한 승인이 없다 — 이 게이트의 핵심 판정. class·target을 메타로 남겨
    // SPEC-057 에스컬레이션이 반복을 집계할 수 있게 한다(선언이지 추측이 아니다). judged()는
    // meta를 받지 않으므로(건수만) verdict()를 직접 부른다.
    verdict(VERDICT_KINDS.JUDGED, "위반 1건", { class: entry.class, target: hash });
    console.log(`[SDD 위험 행동] 클래스 "${entry.class}" — 독립 검증 없이는 진행할 수 없다(riskyActionPolicy=${POLICY}).`);
    console.log(`  왜: ${entry.why}`);
    console.log(`  확인 방법: ${entry.verifyAgainst}`);
    console.log("  → 별도 컨텍스트의 서브에이전트를 만들어 위 내용을 실제로 대조 확인시켜라(이 게이트는 그 호출을 스스로 하지 않는다).");
    if (entry.tool) {
      console.log(`  → 확인되면(도구 호출 — 아래 행동 페이로드를 정확히 그대로 붙여넣는다): node scripts/check-risky-action.mjs --record --command '${payload}' --class "${entry.class}" --note "<확인 근거>"`);
    } else {
      console.log(`  → 확인되면: node scripts/check-risky-action.mjs --record --command "<이 행동의 원문 명령 그대로>" --class "${entry.class}" --note "<확인 근거>"`);
    }
    console.log(`  → 그 다음 이 행동을 재시도하라(승인 유효기간 ${ttl}초, 행동 문자열이 정확히 같아야 한다).`);
    if (POLICY === "hard") {
      console.error("\n✗ riskyActionPolicy=hard: 승인 마커 없이 위험 행동을 차단한다.");
      process.exit(2);                      // PreToolUse 규약 — 비-0이 도구 실행을 막는다
    }
    console.log("  · advisory — 차단하지 않는다. hard로 승격하면 이 행동은 여기서 멈춘다.");
    return;
  }

  // ── 스윕 모드: 선언 자체를 판정한다 ────────────────────────────────────────
  if (!entries.length) {
    verdict(VERDICT_KINDS.INERT, "riskyActionPatterns 미선언 — 무엇에 발화할지 모른다");
    console.log("위험 행동 승인 게이트 — `riskyActionPatterns` 미선언: **판정하지 않는다**."
      + " 되돌리기 어려운 행동(트래커 상태 전이·배포·파괴적 DB 조작 등)이 있으면"
      + " Bash는 `{ match: <명령 정규식>, class, verifyAgainst, why }`, 그 외 도구 호출은"
      + " `{ tool: <도구명 정규식>, class, verifyAgainst, why }`로 선언하라(둘 중 하나만).");
    return;
  }
  const findings = validateRiskyActionPatterns(entries);
  judged(findings.length);
  console.log(`위험 행동 승인 게이트(riskyActionPolicy=${POLICY}): 패턴 ${entries.length}종 선언 — 선언 위반 ${findings.length}`);
  const tag = POLICY === "hard" ? "✗" : "⚠";
  for (const f of findings) (POLICY === "hard" ? console.error : console.log)(`  ${tag} [${f.at}] ${ACTION_APPROVAL_GUARD_FINDING_TEXT[f.kind]}`);
  if (findings.length && POLICY === "hard") {
    console.error("\n✗ 위험 행동 패턴 선언이 깨졌다 — 이 축의 자기결함은 **조용한 무발화**다.");
    process.exit(1);
  }
  if (!findings.length) {
    console.log(`  ✓ 패턴 ${entries.length}종이 모두 class·verifyAgainst·사유를 갖는다.`);
    console.log("  · 이 층은 **도구 호출 직전**에 발동한다 — 실시간 대화는 커밋도 파일 변경도 남기지 않으므로"
      + " 커밋 게이트로는 원리상 볼 수 없다. 배선 실재는 R19(에이전트 배선)가 판정한다.");
  }
}

if (isMainEntry(import.meta.url)) {
  armVerdict({ quietWhenSilent: process.argv.includes("--hook") });
  main();
}
