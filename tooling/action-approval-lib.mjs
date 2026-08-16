// tooling/action-approval-lib.mjs
// 위험 행동 승인 순수 코어 (SPEC-058) — **도구 호출 직전에, 독립 검증 없이 위험 행동이 지나가지
// 않게 한다.**
//
// 실측 제보(2026-08-14, gsn-ai-pm-management-tool): 같은 세션에서 두 사고가 났다 — ① QA 실측·
// 트래커 댓글까지 마친 뒤 아직 배포도 안 된 티켓 3건을 `dev-done`(종결 상태 전이)으로 넘기려
// 했다(그 프로젝트의 `CLOSEOUT_FLOW`/FR-027이 순서를 명문화해뒀는데도) ② 이 반복 실수를 고치라고
// 하자 개인 memory 파일에 규칙을 적으려 했다(정작 그 프로젝트 `INFRA-004 FR-046/047`이 "규칙을
// 명세 아닌 사적 메모리에만 박으려 함"을 이미 실패 사례로 지목해뒀는데도 확인하지 않았다). 둘 다
// **커밋 이전**, 대화 안에서 끝났다 — SPEC-053(진단가드)·SPEC-035(배포가드)와 같은 층(도구 호출
// 직전)이지만 구제 방식이 다르다: 저 둘은 "이미 답이 있는 명세를 읽어라"/"전제 조건을 봐라"이고,
// 이 축은 트래커 상태 전이·배포·파괴적 DB 조작처럼 **되돌리기 어려운** 행동에 대해 "독립 컨텍스트
// 서브에이전트가 명세 원문·실제 배포/DB 상태를 실제로 대조해 확인했다는 증거"를 요구한다.
//
// ── 게이트는 서브에이전트를 스스로 부르지 않는다 ─────────────────────────────
// 이 코어와 그 소비 게이트는 결정론적이다 — LLM을 호출하지 않고, Node·Python 양판이 가능하다.
// "독립 서브에이전트를 불러 확인시켜라"는 차단 메시지의 **지시**일 뿐이고, 실제 호출은 차단당한
// 실행기(에이전트) 자신이 자기 도구(Task 등)로 수행한다. 판정은 그 결과로 남는 **승인 마커**의
// 존재·행동 해시 일치·신선도만 본다 — 검증이 실제로 옳았는지는 이 축의 판정 대상이 아니다(질은
// 그 서브에이전트 호출의 몫, 이 축은 회계다). **완전 자율 감사 에이전트는 범위 밖이다**(SPEC-057과
// 같은 경계): 언제·어떻게 서브에이전트를 부를지는 매번 실행기가 판단하고, 이 축은 마커 회계만
// 결정적으로 만든다.
//
// ── 마커는 행동 페이로드 해시로 결속한다 ─────────────────────────────────────
// 세션 단위·패턴 단위로 승인을 재사용하면 한 번의 승인이 **다른 대상**의 같은 종류 행동까지
// 통과시킨다(예: 티켓 A의 종결 승인이 티켓 B의 종결까지 덮는다). 그래서 승인 마커는 실행될
// 명령 문자열의 해시에 결속되고, 다른 페이로드는 다른 해시라 별도 승인이 필요하다.
//
// 순수 함수(IO 없음) — 원장 파일 읽기·쓰기, 해시 계산에 쓸 crypto 주입은 소비 게이트가 한다.
// Python 미러(SPEC-006).

import { createHash } from "node:crypto";
import { parseLedger } from "./gate-failure-lib.mjs";

// 원장 줄 파싱은 SPEC-057(gate-failure-lib)의 parseLedger를 그대로 재사용한다 — JSONL 한 줄을
// 레코드로 읽고 깨진 줄을 조용히 버리지 않는 규율은 이 축에서도 동일하고, 두 번째로 같은
// 판정 로직을 구현하면 R13(구현 중복)이 잡는 그 형태가 된다.
export { parseLedger as parseApprovalLedger };

// 행동 페이로드 → 해시. 공백을 앞뒤로 trim만 하고 그 외 정규화는 하지 않는다 — 명령 문자열을
// "비슷하게" 정규화하면 실제로 다른 행동이 같은 해시로 뭉개질 수 있다(안전이 아니라 완화다).
export function hashAction(command) {
  return createHash("sha256").update(String(command || "").trim(), "utf8").digest("hex");
}

// **로컬 세션 상태다 — 커밋 대상이 아니다**(`.sdd/gate-failures.jsonl`과 같은 층. SPEC-057의
// 원장과 같은 이유: "승인했다"는 지금까지 무슨 일이 있었는가의 누적 로그이지 채택 선언이 아니다).
export const DEFAULT_ACTION_APPROVAL_LEDGER = ".sdd/action-approvals.jsonl";
export const DEFAULT_APPROVAL_TTL_SECONDS = 900; // 15분 — 실측 사고 규모에 맞춘 초기값, 프로젝트가 조정

// 선언 파싱 — riskyActionPatterns: [{ match, tool, class, verifyAgainst, why }]
// match: Bash 명령을 매칭할 정규식(도구명 "Bash") / tool: 그 외 도구 호출을 매칭할 도구명 정규식
// (mcp__github__merge_pull_request 등 — 실측: 2026-08-14, MCP 도구 호출은 명령 문자열이 없어
// match로는 원천적으로 못 잡는다). 한 항목은 둘 중 정확히 하나만 갖는다 — 섞으면 "이 항목이
// Bash용인지 도구용인지" 판정 규칙이 두 갈래로 갈라진다(단순함을 유지한다, 오너의 명시적 선택:
// 서브명령 세부 매칭이 아니라 위험해 보이는 도구를 명시적으로 나열).
// class: 에스컬레이션 집계 키(SPEC-057 소비) / verifyAgainst: 서브에이전트가 무엇과 대조해야 하는가
export function parseRiskyActionPatterns(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object") continue;
    out.push({
      match: String(raw.match ?? ""),
      tool: String(raw.tool ?? ""),
      class: String(raw.class ?? ""),
      verifyAgainst: String(raw.verifyAgainst ?? ""),
      why: String(raw.why ?? ""),
    });
  }
  return out;
}

// 선언 검증 — 이 축의 자기결함은 **조용한 무발화**다: 잘못된 선언은 아무것도 막지 않고
// 아무것도 알리지 않는다.
// 반환 findings[] — kind: no-matcher | ambiguous-matcher | bad-regex | bad-tool | no-class | no-verify-against | no-why
export function validateRiskyActionPatterns(entries) {
  const findings = [];
  for (const [i, e] of (entries || []).entries()) {
    const at = e.class || e.match || e.tool || `#${i + 1}`;
    const hasMatch = !!e.match;
    const hasTool = !!e.tool;
    if (!hasMatch && !hasTool) { findings.push({ kind: "no-matcher", at }); continue; }
    if (hasMatch && hasTool) { findings.push({ kind: "ambiguous-matcher", at }); continue; }
    if (hasMatch) { try { new RegExp(e.match); } catch { findings.push({ kind: "bad-regex", at }); continue; } }
    if (hasTool) { try { new RegExp(e.tool); } catch { findings.push({ kind: "bad-tool", at }); continue; } }
    if (!e.class.trim()) findings.push({ kind: "no-class", at });
    if (!e.verifyAgainst.trim()) findings.push({ kind: "no-verify-against", at });
    if (!e.why.trim()) findings.push({ kind: "no-why", at });
  }
  return findings;
}

// 위험 행동 매칭 — 첫 매치를 낸다(순서가 선언이다. 여러 패턴이 걸리면 먼저 선언된 것을 본다).
// call: { toolName, command } — Bash는 command로, 그 외 도구는 toolName으로 매칭한다.
export function matchRiskyAction(call, entries) {
  const toolName = String((call && call.toolName) || "");
  const command = String((call && call.command) || "");
  for (const e of entries || []) {
    if (e.tool) {
      if (!toolName) continue;
      let re;
      try { re = new RegExp(e.tool, "i"); } catch { continue; }
      if (re.test(toolName)) return e;
      continue;
    }
    if (e.match) {
      if (!command.trim()) continue;
      let re;
      try { re = new RegExp(e.match, "i"); } catch { continue; }
      if (re.test(command)) return e;
    }
  }
  return null;
}

// 도구 호출(비-Bash)의 정준 페이로드 — 해시 대상 문자열을 만든다. 키 순서를 정렬해 같은 내용이
// 항상 같은 문자열이 되게 한다(hostToolInput의 키 삽입 순서에 결속되면 같은 호출도 다른 해시가
// 나올 수 있다). hashAction()에 그대로 넘기면 되므로 별도 해시 함수를 새로 만들지 않는다.
export function canonicalToolPayload(toolName, toolInput) {
  return JSON.stringify({ tool: String(toolName || ""), input: sortKeysDeep(toolInput || {}) });
}
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeysDeep(v[k]); return o; }, {});
  }
  return v;
}

// PreToolUse 훅 입력에서 도구 호출을 읽는다 — commandFromHookInput(SPEC-035)의 일반화판.
// Bash는 tool_input.command를 그대로 command로 낸다(하위호환). 그 외 도구는 command가 비고
// toolInput 전체가 남는다(canonicalToolPayload가 그것으로 해시 페이로드를 만든다).
export function toolCallFromHookInput(argv, readStdin) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const flagCommand = get("--command");
  if (flagCommand !== undefined) return { toolName: "Bash", command: flagCommand, toolInput: { command: flagCommand } };
  let raw = "";
  try { raw = readStdin(); } catch { return { toolName: "", command: "", toolInput: null }; }
  if (!raw.trim()) return { toolName: "", command: "", toolInput: null };
  try {
    const j = JSON.parse(raw);
    const toolName = String(j.tool_name || "");
    const toolInput = j.tool_input || {};
    return { toolName, command: String(toolInput.command || ""), toolInput };
  } catch { return { toolName: "", command: "", toolInput: null }; }
}

// 원장에 남길 승인 레코드 하나.
export function makeApprovalRecord({ hash, class: cls, note, ts, sessionId }) {
  return {
    hash: String(hash || ""),
    class: String(cls || ""),
    note: String(note || ""),
    ts: ts || null,
    sessionId: sessionId || "unknown",
  };
}

// 이 행동에 유효한(해시 일치 + 신선) 승인이 있는가 — 있으면 그 레코드를, 없으면 null.
// nowMs·ttlSeconds는 소비 게이트가 주입한다(코어는 시각을 스스로 재지 않는다).
// 여러 개면 가장 최근(ts 최댓값)을 본다 — 결정적 선택.
export function findApproval(hash, records, ttlSeconds = DEFAULT_APPROVAL_TTL_SECONDS, nowMs = null) {
  if (nowMs == null) return null; // now 미주입 — 신선도를 판정할 수 없다(추정하지 않는다).
  let best = null;
  for (const r of records || []) {
    if (!r || r.hash !== hash || !r.ts) continue;
    const ageMs = nowMs - Date.parse(r.ts);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlSeconds * 1000) continue;
    if (!best || r.ts > best.ts) best = r;
  }
  return best;
}

export const ACTION_APPROVAL_GUARD_FINDING_TEXT = Object.freeze({
  "no-matcher": "match·tool이 둘 다 없다 — 무엇에 발화할지 모르는 선언은 아무것도 막지 않는다",
  "ambiguous-matcher": "match·tool이 둘 다 있다 — 한 항목은 Bash 명령용(match)이거나 도구명용(tool) 중 하나만 갖는다",
  "bad-regex": "명령 패턴(match)이 정규식으로 컴파일되지 않는다 — 이 규칙은 **조용히 무발화**다",
  "bad-tool": "도구명 패턴(tool)이 정규식으로 컴파일되지 않는다 — 이 규칙은 **조용히 무발화**다",
  "no-class": "class가 없다 — 에스컬레이션 집계(SPEC-057)가 이 선언을 인식할 키가 없다",
  "no-verify-against": "verifyAgainst가 없다 — 서브에이전트가 무엇과 대조해야 하는지 모른다",
  "no-why": "사유가 없다 — 왜 이 행동에 승인이 필요한지 모르면 사람은 규칙을 우회한다",
});
