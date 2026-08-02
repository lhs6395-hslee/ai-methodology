// tooling/hooks-install-lib.mjs
// 훅 배선 실재 판정 순수 코어 (SPEC-036).
//
// 게이트 스크립트가 다 있어도 **.git/hooks에 훅이 없으면 아무것도 발동하지 않는다.** 그런데 기존
// "판정 확인"은 게이트의 inert만 봤지 훅 배선의 inert는 보지 않았다 — 실측 제보에서 게이트가 한 번도
// 돌지 않은 채 green으로 읽혔다. 미설치를 green으로 읽지 않는 것이 이 코어의 목적이다.
//
// 남의 훅이 같은 이름을 점유한 경우(husky 등)도 잡는다 — 파일은 있는데 킷 게이트를 호출하지 않으면
// 결과는 미설치와 같다. 그래서 설치된 훅에 마커(SDD_HOOK_MARKER)를 심고 그 존재로 판정한다.
export const SDD_HOOK_MARKER = "sdd-managed-hook";

// hooks.list 파싱 — 주석·빈 줄 제외, 순서 보존, 중복 제거.
export function parseHookList(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.split("#")[0].trim();
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

// expected: 훅 이름[] / installed: Map(name -> {exists, executable, content})
// 반환 findings[] — kind: missing | not-executable | foreign
export function hookFindings(expected, installed) {
  const findings = [];
  for (const name of expected || []) {
    const h = (installed && installed.get(name)) || null;
    if (!h || !h.exists) { findings.push({ kind: "missing", name }); continue; }
    if (!h.executable) { findings.push({ kind: "not-executable", name }); continue; }
    if (!String(h.content || "").includes(SDD_HOOK_MARKER)) { findings.push({ kind: "foreign", name }); }
  }
  return findings;
}
