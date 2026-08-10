// tooling/agent-wiring-lib.mjs
// 에이전트 배선 실재 순수 코어 (SPEC-051) — **감시자가 에이전트를 실제로 보는가.**
//
// 오너 실측 제보: "감시게이트 및 감시에이전트가 필요한데 — 즉 SDD에 의해 수행하는지 혼자
// 날뛰지 않는지 — 그게 동작을 하지 않아."
//
// 조사 결과 원인이 다섯이었고 전부 **조용한 0건** 계열이었다:
//   1. **킷 자신에 `.claude/`가 없었다** — 킷은 모든 축을 자기적용하는데 이 층만 도그푸딩 0.
//      그래서 이 배선이 동작하는 것을 킷이 한 번도 관측한 적이 없다.
//   2. **어떤 게이트도 에이전트 설정 파일을 보지 않았다** — R12는 `.git/hooks`, R17은 CI·영수증·
//      게이트 파일을 본다. 에이전트 훅은 **아무 축의 대상이 아니었다.**
//   3. **채택 영수증에 에이전트 훅이 기록되지 않았다** — `hooks`에 git 훅 4종만 있었다.
//   4. **`jq` 없으면 설치기가 배선을 조용히 건너뛰었다** — 설치는 "성공"으로 끝났다.
//      워크트리 결함을 몇 달간 가린 best-effort 침묵과 같은 모양이다(SPEC-036).
//   5. **편집 가드의 코드 경로가 하드코딩이었다**(`src/|lib/|app/`) — 킷의 `scanDirs`는
//      `tooling`이라, 배선했더라도 체크리스트가 발화할 수 없었다.
//
// **감시자가 있다(R17)와 감시자가 에이전트를 본다(이 축)는 다른 사실이다.** R17은 커밋한 사람이
// 끌 수 없는 채널(CI)의 실재를 보고, 이 축은 에이전트가 도구를 쓰는 **순간**에 발동하는 배선의
// 실재를 본다. git 훅은 이미 작성된 코드를 커밋 시점에 보므로, "지금 스펙 없이 코드를 쓰고 있다"를
// 그 자리에서 말할 수 있는 층은 여기뿐이다.
//
// 순수 함수(IO 없음) — 파일 읽기·존재 확인은 소비 게이트가 주입한다. Python 미러(SPEC-006).

import { TRI, tri } from "./check-outcome-lib.mjs";

// 매처 없는 이벤트의 표기. 선언 파일이 공백 구분 3필드이므로 빈 칸을 쓸 수 없다.
export const NO_MATCHER = "-";

// 킷 기본값. `null` config는 "킷 기본을 쓴다"는 **선언**이다 — 경로를 코드에 고정하면 다른
// 에이전트·다른 설치 레이아웃에서 판정이 통째로 사라지고, 그 0건이 진짜 0건과 구분되지 않는다.
export const DEFAULT_AGENT_SETTINGS_FILE = ".claude/settings.json";
export const DEFAULT_AGENT_HOOK_DECL = "scripts/agent-hooks.list";
export const DEFAULT_AGENT_SCRIPT_DIR = "scripts";

// 선언 파싱 — `<이벤트> <매처> <스크립트>`. 주석·빈 줄은 건너뛴다.
// 반환 [{event, matcher, script}](matcher는 `-`면 빈 문자열).
export function parseAgentHookDecl(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;            // 형식 미달은 선언이 아니다
    const [event, matcher, script] = parts;
    out.push({ event, matcher: matcher === NO_MATCHER ? "" : matcher, script });
  }
  return out;
}

// 설정에서 배선된 훅을 평평하게 뽑는다 — 반환 [{event, matcher, command}].
// 에이전트 설정 스키마: { hooks: { <이벤트>: [ { matcher?, hooks: [ {type, command} ] } ] } }
export function wiredHooks(settings) {
  const out = [];
  const hooks = settings && typeof settings === "object" ? settings.hooks : null;
  if (!hooks || typeof hooks !== "object") return out;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!g || typeof g !== "object") continue;
      const matcher = String(g.matcher ?? "");
      for (const h of Array.isArray(g.hooks) ? g.hooks : []) {
        if (!h || typeof h !== "object") continue;
        out.push({ event, matcher, command: String(h.command ?? "") });
      }
    }
  }
  return out;
}

// 매처는 **부분집합 판정**이다 — 선언한 도구 전부가 배선된 매처에 들어 있으면 충족.
// 넓히는 것(`Write|Edit` → `Write|Edit|MultiEdit`)은 정상이고, 좁히는 것은 그 도구에서
// 훅이 발동하지 않는다는 뜻이므로 어느 도구가 빠졌는지 이름으로 말한다.
// 정확 일치를 요구하면 정당한 확장이 전부 위반이 되어 게이트가 꺼진다(오탐이 사망 원인이다).
export function missingMatcherTokens(declared, wired) {
  const want = String(declared || "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!want.length) return [];                 // 매처 없는 이벤트 — 대조할 토큰이 없다
  const have = new Set(String(wired || "").split("|").map((s) => s.trim()).filter(Boolean));
  return want.filter((t) => !have.has(t));
}

// 커맨드가 이 스크립트를 지목하는가 — 경로 표기가 프로젝트마다 다르므로(`sh scripts/x.sh`,
// `./scripts/x.sh`, 절대경로) **파일명 기준**으로 본다. 경로를 요구하면 정당한 표기 차이가
// 위반이 되고, 파일명은 킷이 소유한 이름이라 충돌 위험이 낮다.
export function commandNamesScript(command, script) {
  if (!command || !script) return false;
  const re = new RegExp(`(^|[\\s/"'])${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s"']|$)`);
  return re.test(String(command));
}

// 판정 — decls: parseAgentHookDecl 결과, settings: 파싱된 설정(없으면 null),
// scriptExists(script) → boolean (실재+실행 가능 여부는 소비 게이트가 판단해 주입).
// 반환 { settingsMissing, missing, narrowed, scriptMissing }
//   settingsMissing — 설정 파일 자체가 없다(**한 번도 설치되지 않았다**는 다른 사실이다)
//   missing         — 그 이벤트에 이 스크립트를 지목하는 훅이 없다
//   narrowed        — 배선은 있는데 매처가 좁아 일부 도구에서 발동하지 않는다
//   scriptMissing   — 배선은 있는데 지목된 스크립트가 실재하지 않거나 실행 불가다
export function agentWiringFindings(decls, settings, scriptExists) {
  const missing = [], narrowed = [], scriptMissing = [], unchecked = [];
  const settingsMissing = !settings;
  const wired = wiredHooks(settings);
  for (const d of decls || []) {
    const hits = wired.filter((w) => w.event === d.event && commandNamesScript(w.command, d.script));
    if (!hits.length) { missing.push(d); continue; }
    // 배선이 여럿이면 **가장 넓은 것**으로 판정한다 — 하나라도 그 도구를 덮으면 발동한다.
    const gaps = hits.map((h) => missingMatcherTokens(d.matcher, h.matcher));
    const best = gaps.reduce((a, b) => (b.length < a.length ? b : a), gaps[0]);
    if (best.length) narrowed.push({ ...d, missingTools: best });
    // 3분류 계약(SPEC-054) — 스크립트 실재를 **확인하지 못한** 경우를 부재와 가르지 않으면
    // 읽기 실패가 "스크립트 없음"이라는 거짓 위반이 된다.
    const st = tri(typeof scriptExists === "function" ? scriptExists(d.script) : undefined);
    if (st === TRI.NO) scriptMissing.push(d);
    else if (st === TRI.UNKNOWN) unchecked.push({ script: d.script, why: "스크립트 실재를 확인하지 못했다" });
  }
  return { settingsMissing, missing, narrowed, scriptMissing, unchecked };
}

// 기존 설정에 이 배선을 **병합**한다 — 남의 훅은 보존하고 킷 훅만 갈아끼운다(재실행 idempotent).
// 킷 훅의 식별은 "선언된 스크립트 이름을 지목하는 커맨드"다. 경로 표기가 달라도 같은 훅이므로
// 표기 기준으로 지우면 옛 표기가 남아 훅이 두 번 발동한다.
export function mergeHookSettings(existing, decls, commandFor) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const fresh = buildHookSettings(decls, commandFor);
  const isOurs = (command) => (decls || []).some((d) => commandNamesScript(command, d.script));
  const merged = { ...base, hooks: { ...(base.hooks && typeof base.hooks === "object" ? base.hooks : {}) } };
  for (const [event, groups] of Object.entries(fresh.hooks)) {
    const kept = (Array.isArray(merged.hooks[event]) ? merged.hooks[event] : []).filter((g) => {
      const cmds = (g && Array.isArray(g.hooks) ? g.hooks : []).map((h) => String(h?.command ?? ""));
      // 킷 훅만 걷어낸다 — 그룹 안의 커맨드가 전부 남의 것이면 그룹을 보존한다.
      return !cmds.length || !cmds.every(isOurs);
    });
    merged.hooks[event] = [...kept, ...groups];
  }
  return merged;
}

// 설치기가 쓸 설정 조각을 **선언에서** 만든다 — 설치기가 JSON을 하드코딩하면 선언과 갈라진다
// (실측: 설치기의 하드코딩 JSON이 정본이었고 어떤 검사도 그것과 대조되지 않았다).
// 같은 이벤트·매처는 한 그룹으로 묶는다.
export function buildHookSettings(decls, commandFor) {
  const events = {};
  for (const d of decls || []) {
    const key = `${d.event} ${d.matcher}`;
    if (!events[key]) events[key] = { event: d.event, matcher: d.matcher, hooks: [] };
    events[key].hooks.push({ type: "command", command: commandFor(d.script) });
  }
  const hooks = {};
  for (const g of Object.values(events)) {
    if (!hooks[g.event]) hooks[g.event] = [];
    const entry = { hooks: g.hooks };
    if (g.matcher) entry.matcher = g.matcher;
    hooks[g.event].push(entry);
  }
  return { hooks };
}
