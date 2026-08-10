// tooling/hooks-install-lib.mjs
// 훅 배선 실재 판정 순수 코어 (SPEC-036).
//
// 게이트 스크립트가 다 있어도 **.git/hooks에 훅이 없으면 아무것도 발동하지 않는다.** 그런데 기존
// "판정 확인"은 게이트의 inert만 봤지 훅 배선의 inert는 보지 않았다 — 실측 제보에서 게이트가 한 번도
// 돌지 않은 채 green으로 읽혔다. 미설치를 green으로 읽지 않는 것이 이 코어의 목적이다.
//
// 남의 훅이 같은 이름을 점유한 경우(husky 등)도 잡는다 — 파일은 있는데 킷 게이트를 호출하지 않으면
// 결과는 미설치와 같다. 그래서 설치된 훅에 마커(SDD_HOOK_MARKER)를 심고 그 존재로 판정한다.
//
// ── 신선도 축(2026-08-10 추가) ────────────────────────────────────────────────
// 실측 제보(소비 프로젝트 gsn-ai-pm-management-tool): 이 게이트가 **낡은 사본을 green으로 보고했고**
// 그 결과 hard로 켜둔 감시 게이트가 한 번도 발동하지 못했다.
//     scripts/sdd-commit-msg.sh  (저장소본, 31행) — 게이트 호출 있음
//     .git/hooks/commit-msg      (설치본, 26행) — 그 호출 **없음**(누락 5행이 호출 블록 전체)
//     processCompliancePolicy = hard, 게이트 직접 호출 시 exit 1·위반 3건 — 게이트는 옳았다
//     check-hooks-installed → OK (선언 3종·설치 3종)
// 원인은 두 층이었다: ①설치기가 사본을 갱신하지 않았다(존재하면 skip) ②이 코어가 존재·실행권한·
// 마커만 보고 **내용 신선도를 대조하지 않았다.**
//
// 이것은 SPEC-036이 막으려던 실패의 **재발**이다. 그 전제는 "훅이 없으면 아무것도 발동하지 않는다"
// 였는데, **훅이 있어도 낡으면 같은 결과**라는 경우가 판정에서 빠져 있었다. 훅 경로를 문자열로
// 가정해 워크트리에서 조용히 skip한 선례와 같은 층의 결함이다.
export const SDD_HOOK_MARKER = "sdd-managed-hook";

// hooks.list 한 줄 → { name, source }.
//   `<훅 이름>`                    — 신선도 미선언(원본이 없거나 heredoc 생성)
//   `<훅 이름>  <원본 경로>`        — 그 경로를 원본으로 삼아 신선도까지 판정
// 소비 게이트가 `source`를 읽어 파일 내용을 주입한다(경로 해석·읽기는 IO라 코어 밖이다).
export function parseHookEntries(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const [name, source] = line.split(/\s+/);
    if (out.some((e) => e.name === name)) continue;   // 순서 보존·중복 제거
    out.push({ name, source: source || null });
  }
  return out;
}

// 이름만 필요한 호출부(설치기 자기검증 등)를 위한 얇은 투영 — 같은 파서 하나를 쓴다
// (파서가 둘이면 한쪽만 고쳐진다: 이 파일이 존재하는 이유와 같은 계열의 실수다).
export function parseHookList(text) {
  return parseHookEntries(text).map((e) => e.name);
}

// expected: 훅 이름[] / installed: Map(name -> {exists, executable, content, source?})
// 반환 findings[] — kind: missing | not-executable | foreign | stale | source-unreadable
//
// `source`의 세 상태를 **구분한다** — 셋을 합치면 이 축이 다시 거짓 green을 만든다:
//   · 키 없음(undefined) — 원본이 선언되지 않았다 → 신선도를 **판정하지 않는다**(위반 아님).
//   · null              — 선언은 됐는데 **읽지 못했다** → `source-unreadable`(통과 아님).
//   · 문자열            — 내용을 대조한다. 다르면 `stale`.
export function hookFindings(expected, installed) {
  const findings = [];
  for (const name of expected || []) {
    const h = (installed && installed.get(name)) || null;
    if (!h || !h.exists) { findings.push({ kind: "missing", name }); continue; }
    if (!h.executable) { findings.push({ kind: "not-executable", name }); continue; }
    if (!String(h.content || "").includes(SDD_HOOK_MARKER)) { findings.push({ kind: "foreign", name }); continue; }
    // 신선도 — 여기까지 왔으면 "킷 훅이 설치·실행 가능"하다. 그래도 **낡으면 발동하지 않는다.**
    if (!("source" in h)) continue;                   // 원본 미선언 — 판정 대상 아님
    if (h.source === null || h.source === undefined) {
      // "검사 못 함"을 "통과"로 출력하지 않는다(clean / could-not-check / violation 3분류).
      findings.push({ kind: "source-unreadable", name });
      continue;
    }
    if (String(h.content) !== String(h.source)) {
      // 미설치와 **동급**이다 — 그 훅이 부르기로 된 게이트는 발동하지 않는다.
      findings.push({ kind: "stale", name });
    }
  }
  return findings;
}

// 사람이 읽는 한 줄 — 원인과 해소를 같이 낸다.
export const HOOK_FINDING_TEXT = Object.freeze({
  missing: "설치되지 않았다 — 이 훅이 부르기로 된 게이트는 한 번도 발동하지 않는다",
  "not-executable": "실행 권한이 없다 — git이 조용히 건너뛴다",
  foreign: "킷 훅이 아니다(마커 없음) — 남의 훅이 그 이름을 점유했고 결과는 미설치와 같다",
  stale: "설치본이 원본과 다르다(**낡은 사본**) — 원본에 배선된 게이트 호출이 이 사본에는 없을 수 있다."
    + " 미설치와 동급이다: 실측 제보에서 누락된 5행이 게이트 호출 블록 전체였고, hard 정책이 한 번도 발동하지 못했다",
  "source-unreadable": "원본을 읽지 못해 신선도를 **확인하지 못했다** — 통과가 아니다(검사 못 함과 통과는 다른 사실이다)",
});
