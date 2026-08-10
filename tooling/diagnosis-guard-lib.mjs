// tooling/diagnosis-guard-lib.mjs
// 진단 진입점 명세 강제 열람 순수 코어 (SPEC-053, R21) — **조사 전에 명세를 보게 한다.**
//
// 실측 제보(2026-08-10): 에이전트가 배포 실패 원인을 조사하며 `kubectl get application`을 뒤져
// ArgoCD sync 실패를 원인으로 단정해 보고했다. 그런데 그 문자열은 이미 명세의 Edge Case에 있었고,
// 같은 문서에 소유자 결정("배포는 GitOps가 힘드니 젠킨스에서 바로 배포한다")과 그에 따른 요구
// 신설이 기록돼 있었다. 소유자는 여러 세션에 걸쳐 "ArgoCD 쓰지 마라"를 지시했는데 **재발했고,
// 결론까지 틀렸다**(진짜 원인은 스냅샷 누락 → migrate Job 실패였다).
//
// ── 왜 커밋 게이트로는 불가능한가 ─────────────────────────────────────────────
// "조사 전에 명세를 읽었는가"는 정적으로 판정되지 않는다. 그리고 **조회는 커밋도 파일 변경도
// 남기지 않는다** — 커밋 시점 게이트는 원리상 이 행동을 볼 수 없다. 유일하게 결정적인 지점은
// **도구 호출 직전**이다. 그 순간에 명령 패턴을 보고 관련 명세의 위치를 띄우는 것은 결정적이다.
//
// ── 두 강도 ──────────────────────────────────────────────────────────────────
//   · surface — 막지 않고 **관련 명세 위치를 띄운다.** 강제 노출만으로 충분한 경우가 있다.
//   · deny    — 막는다(PreToolUse 규약상 비-0). 소유자가 이미 금지한 경로의 재발을 끊는다.
//
// ── 오탐이 이 축의 사망 원인이다 ──────────────────────────────────────────────
// **명세를 읽는 명령은 반드시 통과해야 한다.** 제보자가 만든 첫 사례도 그것을 카나리아로 고정했다
// (차단 4/4 · 통과 3/3, 명세 grep은 통과). 명세 읽기를 막으면 "읽어라"고 하면서 읽기를 막는
// 자기모순이 되고, 그 순간 사람이 훅을 끈다.
//
// 순수 함수(IO 없음) — 명세 파일 읽기·훅 입력 파싱은 소비 게이트가 주입한다. Python 미러(SPEC-006).

export const GUARD_MODES = Object.freeze(["surface", "deny"]);

// 명세를 **읽는** 행위로 인정하는 기본 패턴. 이 목록에 걸리면 어떤 규칙도 그 명령을 막지 않는다.
// 경로가 아니라 **읽기 도구 + 스펙 경로**의 곱으로 좁힌다 — `cat`만으로 통과시키면 무엇이든
// `cat`으로 감싸 우회할 수 있다.
export const DEFAULT_SPEC_READ_PATTERNS = Object.freeze([
  "\\b(grep|rg|cat|head|tail|less|sed|awk|find|ls)\\b[^|;]*\\bsdd/specs?\\b",
  "\\b(grep|rg|cat|head|tail|less|sed|awk)\\b[^|;]*\\b(SPEC|INFRA|TEST|CICD)-\\d",
]);

// 명세에서 "여기를 읽어라"로 지목할 절 — 결정 이력이 사는 곳이다.
// 스펙 이름만 알려주면 사람은 처음부터 읽고, 그러면 급할 때 안 읽는다.
export const DEFAULT_GUIDE_SECTIONS = Object.freeze(["Edge Cases", "Change Log", "Assumptions"]);

// 선언 파싱 — diagnosisSpecMap: [{ match, spec, mode, why, instead }]
// match: 명령에 대한 정규식 / spec: 그 답이 있는 스펙 파일 경로 또는 ID
export function parseDiagnosisMap(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object") continue;
    out.push({
      match: String(raw.match ?? ""),
      spec: String(raw.spec ?? ""),
      mode: String(raw.mode ?? "surface"),
      why: String(raw.why ?? ""),
      instead: Array.isArray(raw.instead) ? raw.instead.map(String) : [],
    });
  }
  return out;
}

// 선언 검증 — 이 축의 자기결함은 **조용한 무발화**다: 잘못된 선언은 아무것도 막지 않고
// 아무것도 알리지 않는다. 그래서 선언 자체를 판정한다(specExists는 소비 게이트가 주입).
// 반환 findings[] — kind: no-match | bad-regex | no-spec | missing-spec | bad-mode | deny-without-instead | no-why
export function validateDiagnosisMap(entries, specExists) {
  const findings = [];
  for (const [i, e] of (entries || []).entries()) {
    const at = e.match || `#${i + 1}`;
    if (!e.match) { findings.push({ kind: "no-match", at }); continue; }
    try { new RegExp(e.match); } catch { findings.push({ kind: "bad-regex", at }); continue; }
    if (!e.spec) findings.push({ kind: "no-spec", at });
    else if (typeof specExists === "function" && !specExists(e.spec)) findings.push({ kind: "missing-spec", at, spec: e.spec });
    if (!GUARD_MODES.includes(e.mode)) findings.push({ kind: "bad-mode", at, got: e.mode });
    if (!e.why.trim()) findings.push({ kind: "no-why", at });
    // deny는 **대신 볼 곳**을 반드시 준다. 막기만 하면 사람은 우회로를 찾고, 그 우회로는
    // 아무도 모르는 경로가 된다("우회를 유발하는 강제는 강제가 아니다").
    if (e.mode === "deny" && !e.instead.length) findings.push({ kind: "deny-without-instead", at });
  }
  return findings;
}

// 명세 읽기인가 — 어떤 규칙보다 먼저 판정한다.
export function isSpecRead(command, patterns = null) {
  const pats = patterns || DEFAULT_SPEC_READ_PATTERNS;
  return pats.some((p) => { try { return new RegExp(p, "i").test(String(command || "")); } catch { return false; } });
}

// 판정 — 반환 { verdict: "allow"|"surface"|"deny", entry, specRead }
// 규칙이 여럿 걸리면 **deny가 이긴다**(가장 강한 것이 이긴다 — 약한 쪽이 이기면 선언을 늘려
// 강제를 약화시킬 수 있다).
export function judgeCommand(command, entries, specReadPatterns = null) {
  const cmd = String(command || "");
  if (!cmd.trim()) return { verdict: "allow", entry: null, specRead: false };
  if (isSpecRead(cmd, specReadPatterns)) return { verdict: "allow", entry: null, specRead: true };
  let hit = null;
  for (const e of entries || []) {
    if (!e.match || !GUARD_MODES.includes(e.mode)) continue;
    let re;
    try { re = new RegExp(e.match, "i"); } catch { continue; }
    if (!re.test(cmd)) continue;
    if (e.mode === "deny") return { verdict: "deny", entry: e, specRead: false };
    if (!hit) hit = e;
  }
  return hit ? { verdict: "surface", entry: hit, specRead: false } : { verdict: "allow", entry: null, specRead: false };
}

// 사람이 읽는 안내 — **스펙 이름이 아니라 절 위치까지** 준다.
// 이름만 주면 처음부터 읽어야 하고, 급할 때 처음부터 읽는 사람은 없다.
export function formatGuidance(entry, sections = null) {
  const secs = (sections || DEFAULT_GUIDE_SECTIONS).join(" · ");
  const lines = [
    entry.mode === "deny"
      ? `✗ 이 조회는 금지돼 있다 — 조회하지 말고 ${entry.spec}를 읽어라.`
      : `· 이 조회의 답이 이미 명세에 있을 수 있다 — ${entry.spec}를 먼저 보라.`,
    `  왜: ${entry.why}`,
    `  어디: ${entry.spec} 의 ${secs}(결정 이력이 사는 절)`,
  ];
  if (entry.instead.length) lines.push(`  대신 볼 곳: ${entry.instead.join(" · ")}`);
  return lines;
}

export const GUARD_FINDING_TEXT = Object.freeze({
  "no-match": "명령 패턴이 없다 — 무엇에 발화할지 모르는 선언은 아무것도 막지 않는다",
  "bad-regex": "명령 패턴이 정규식으로 컴파일되지 않는다 — 이 규칙은 **조용히 무발화**다",
  "no-spec": "답이 있는 스펙을 지목하지 않았다 — 읽으라고 할 대상이 없다",
  "missing-spec": "지목한 스펙이 실재하지 않는다 — 읽으라는 곳이 없으면 안내가 거짓이 된다",
  "bad-mode": `강도가 ${GUARD_MODES.join("|")} 중 하나가 아니다`,
  "no-why": "사유가 없다 — 왜 이 조회가 아닌지 모르면 사람은 규칙을 우회한다",
  "deny-without-instead": "금지인데 **대신 볼 곳**이 없다 — 막기만 하면 사람은 아무도 모르는 우회로를 찾는다",
});
