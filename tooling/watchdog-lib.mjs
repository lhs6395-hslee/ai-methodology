// tooling/watchdog-lib.mjs
// 감시자 실재 판정 순수 코어 (SPEC-048) — **각 프로젝트가 방법론을 무시한다**(오너 실측).
//
// 이 축의 출발점은 순환이다: 방법론을 무시하는 프로젝트는 게이트를 돌리지 않고, 그러면 게이트가
// 무시를 고발할 기회 자체가 없다. 고발 장치가 고발 대상의 협조를 필요로 하는 구조다.
//
// 그 순환을 끊는 것은 **우회 불가한 채널**뿐이다. 실측으로 확인된 채널의 성질:
//   · 로컬 훅  — `--no-verify`로 우회된다. 웹 UI 머지는 훅을 아예 타지 않는다(SPEC-008 실측).
//   · 게이트 파일 — 지워도 아무 일도 일어나지 않는다(지운 사실을 지운 쪽이 알린 적 없다).
//   · **서버측 CI** — 커밋한 사람이 끌 수 없다. 유일하게 우회 불가하다.
// 그래서 "감시자가 반드시 생성된다"의 실체는 **CI에 스윕이 배선돼 있다**는 사실이고,
// 이 코어가 판정하는 것도 그것이다. 훅·게이트 파일은 보조 채널로 함께 세지만, CI가 없으면
// 나머지가 다 있어도 그 프로젝트는 언제든 조용히 방법론을 벗어날 수 있다.
//
// 채택은 **영수증**을 남긴다 — 설치기가 무엇을 깔았는지 기계가 읽을 수 있는 형태로.
// 영수증이 없으면 "채택했다"는 말은 자기신고이고, 자기신고는 판정이 아니다(SPEC-031의 경계).
// ⚠ 영수증은 **커밋한다**. SPEC-041의 실행 원장은 세션 상태라 커밋하지 않지만, 영수증은
// "이 저장소가 이 방법론을 채택했다"는 **선언**이다 — 체크아웃마다 사라지면 선언이 아니다.
//
// 무엇을 판정하지 않는가: CI가 실제로 **돌았는가**(그건 SPEC-041의 실행 축), 킷이 상류 대비
// 낡았는가(네트워크 없이는 알 수 없고, 모르는 것을 위반으로 말하지 않는다 — 대신 영수증의
// 채택 시점·커밋을 매 실행 그대로 보여줘 사람이 판단하게 한다).
//
// 순수 함수(IO 없음) — 파일 읽기·글롭 순회는 소비 게이트. Python 미러(SPEC-006).

// CI 파일이 스윕을 호출한다고 볼 마커 — 러너 이름이 아니라 **스윕 진입점**을 찾는다.
// 프로젝트가 래퍼 스크립트로 감싸면 `sweepInvocationMarkers`로 교체한다(하드코딩 지양).
export const DEFAULT_SWEEP_INVOCATION_MARKERS = ["sdd-sync", "sdd_gates.py", "sdd-run", "sdd-gates"];

// **마커가 라벨에 걸리는 것을 호출로 읽지 않는다.** 이 축 최악의 자기결함이 정확히 그것이었다:
// 킷의 워크플로 파일명이 `sdd-gates.yml`이고 그 안에 `name: sdd-gates`가 있어서 마커
// `"sdd-gates"`가 **자기 이름에** 매치했다. CI는 스윕을 한 번도 부르지 않았는데 이 게이트는
// 여러 달 "✓ 우회 불가한 채널에 스윕이 배선돼 있다"를 보고했다 — **감시자 실재를 판정하는
// 게이트가 자기 파일명에 속은 것이다.** 그 사이 스윕 등재 게이트 9종이 어떤 우회 불가 층에도
// 없었고, 그중에는 이 게이트 자신과 감사 게이트(R20)·감시 에이전트 배선(R19)이 있었다.
//
// 그래서 호출로 인정할 **선행 문맥**을 문법화한다. 경로 구분자나 러너 토큰이 앞에 와야 한다 —
// `node tooling/sdd-sync.mjs`(`/`), `npm run sdd-gates`(`run `). `name: sdd-gates`는 탈락한다.
const INVOCATION_LEAD = "(?:/|\\./|node\\s+|python3?\\s+|sh\\s+|bash\\s+|make\\s+|npx\\s+|(?:npm|pnpm|yarn)\\s+run\\s+)";
// **데이터 파일은 프로그램이 아니다.** 선행 문맥만 보면 두 번째 거짓 양성이 남는다: 킷 워크플로에
// `node tooling/check-verification-executed.mjs --record ".github/workflows/sdd-gates.yml"`가 있어서
// 마커 `sdd-gates`가 **인자 안의 경로**에 `/` 선행으로 매치했다. 그래서 뒤따르는 확장자도 본다 —
// 실행 확장자(`.mjs`·`.py`·`.sh`…)이거나 확장자가 없어야 호출이다. `.yml`은 읽히는 것이지 도는 것이 아니다.
const INVOCATION_TAIL = "(?:\\.(?:mjs|cjs|js|py|sh|bash))?(?![\\w.-])";
const invocationRe = (marker) =>
  new RegExp(INVOCATION_LEAD + String(marker).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + INVOCATION_TAIL);
// 라벨 줄 — YAML·CI 설정에서 사람에게 보일 이름을 담는 키. 여기 있는 마커는 선언이 아니라 표기다.
const LABEL_LINE = /^\s*(?:name|id|title|description|displayName|stage|job)\s*:/;
const COMMENT_LINE = /^\s*(?:#|\/\/)/;

// 스윕을 **부르는** 줄인가 — 반환 {invoked:boolean, labelOnly:boolean}.
// 두 사실을 가른다: 아예 없는 것과 **라벨에만 있는 것**은 다르고, 후자가 거짓 초록의 원인이므로
// 게이트가 그 이름을 대야 한다("검사 못 함을 통과로 출력하지 않는다"와 같은 규율).
export function sweepInvocation(text, markers) {
  const list = markers && markers.length ? markers : DEFAULT_SWEEP_INVOCATION_MARKERS;
  let labelOnly = false;
  for (const raw of String(text || "").split("\n")) {
    for (const m of list) {
      const marker = String(m);
      if (!raw.includes(marker)) continue;
      if (COMMENT_LINE.test(raw)) continue;              // 주석 속 예시는 인용이지 결정이 아니다
      if (invocationRe(marker).test(raw)) return { invoked: true, labelOnly: false };
      if (LABEL_LINE.test(raw)) labelOnly = true;
    }
  }
  return { invoked: false, labelOnly };
}

// 스윕 호출이 **차단하는가** — CI 스텝은 비-0에서 잡을 실패시키므로, 관건은 스윕이 비-0을 내는가다.
// `--strict` 없는 스윕은 advisory 발견에서 exit 0으로 끝난다: **보고하고 통과하는 채널**이다.
// 우회 불가한 채널이 통과만 하면 그것은 채널이 아니라 로그다.
const STRICT_FLAG = /--strict\b/;
export function sweepBlocking(text, markers) {
  const list = markers && markers.length ? markers : DEFAULT_SWEEP_INVOCATION_MARKERS;
  for (const raw of String(text || "").split("\n")) {
    if (COMMENT_LINE.test(raw)) continue;
    if (!list.some((m) => invocationRe(m).test(raw))) continue;
    if (STRICT_FLAG.test(raw)) return true;
  }
  return false;
}

// 스윕 규칙표에 등재된 게이트 파일 집합 — **스윕이 무엇을 도는가의 정본**이다.
// 경로는 고정하지 않는다: 킷은 `tooling/`, 소비 프로젝트는 설치기가 `scripts/`에 깐다
// (고정하면 소비 사이트에서 이 판정이 조용히 사라지고 그 0건은 진짜 0건과 구분되지 않는다).
export const DEFAULT_SWEEP_SOURCE_CANDIDATES = Object.freeze([
  "tooling/sdd-sync.mjs", "scripts/sdd-sync.mjs", "sdd-sync.mjs",
]);
const SWEEP_GATE_ENTRY = /"((?:check|gen)-[a-z-]+\.mjs)"/g;
export function sweepGateFiles(syncSource) {
  const src = String(syncSource || "");
  const i = src.indexOf("const RULES = [");
  if (i < 0) return null;                    // 규칙표를 못 찾았다 — **0종이 아니다**(모르는 것을 숫자로 말하지 않는다)
  const end = src.indexOf("\n];", i);
  const blk = src.slice(i, end < 0 ? undefined : end);
  return [...new Set([...blk.matchAll(SWEEP_GATE_ENTRY)].map((m) => m[1]))];
}

// CI가 스윕을 부르지 않고 **게이트를 손으로 열거**하면, 그 목록에서 빠진 스윕 등재 게이트는
// 어떤 우회 불가 층에도 없다 — 사람이 손으로 스윕을 칠 때만 도는 게이트다.
// 손목록은 반드시 드리프트한다(설치기 복사 목록·픽스처 목록이 이미 같은 결함을 냈다):
// **목록은 적는 것이 아니라 계산하는 것이고, CI에서 그 계산은 "스윕을 부르는 것"이다.**
// 반환 [게이트 파일명…] — 비면 전부 덮인다.
export function gatesOutsideCi(sweepGates, ciTexts, markers) {
  const texts = (ciTexts || []).map((t) => String(t || ""));
  if (texts.some((t) => sweepInvocation(t, markers).invoked)) return [];   // 스윕이 전부를 덮는다
  const joined = texts.join("\n");
  return (sweepGates || []).map(String).filter((g) => g && !joined.includes(g));
}
// 채택 영수증의 기본 경로 — `.sdd/`가 아니다: 그쪽은 gitignore라 선언이 사라진다.
import { TRI, tri } from "./check-outcome-lib.mjs";

export const DEFAULT_WATCHDOG_RECEIPT = "sdd/adoption.json";
export const DEFAULT_WATCHDOG_CI_GLOBS = [".github/workflows/**", ".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml", ".circleci/**"];

// 영수증 파싱 — 형식 위반은 조용히 통과시키지 않는다(정의되지 않은 형태 = 판정 불가).
// 반환 {receipt, errors}. receipt는 정규화된 객체(errors가 있으면 부분적).
export function parseReceipt(raw) {
  const errors = [];
  let data = raw;
  if (typeof raw === "string") {
    // 파서의 예외 문구는 런타임마다 다르다 — 판정 문장에 넣으면 Node↔Python 바이트 동일이
    // 깨지고, 그 차이는 "같은 사실을 두 판이 다르게 말한다"가 된다(SPEC-006의 불변).
    try { data = JSON.parse(raw); } catch { return { receipt: null, errors: ["채택 영수증이 JSON으로 파싱되지 않는다 — 형식이 깨졌거나 빈 파일이다"] }; }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { receipt: null, errors: ["채택 영수증은 객체여야 한다({ kitCommit, installedAt, gate, gates, hooks })"] };
  }
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const receipt = {
    kitCommit: String(data.kitCommit ?? "").trim(),
    installedAt: String(data.installedAt ?? "").trim(),
    gate: String(data.gate ?? "").trim(),
    gates: arr(data.gates),
    hooks: arr(data.hooks),
  };
  if (!receipt.installedAt) errors.push("채택 영수증에 installedAt이 없다 — 언제 채택했는지가 갱신 판단의 유일한 근거다");
  if (!receipt.gates.length) errors.push("채택 영수증에 gates가 없다 — 무엇이 깔렸는지 모르면 사라진 것도 모른다");
  return { receipt, errors };
}

// 영수증이 선언한 게이트 중 지금 없는 것 — 지워진 감시자는 지운 사실을 스스로 알리지 않는다.
export function missingGates(receipt, exists) {
  // 3분류 계약(SPEC-054) — 존재 판정기가 **모른다**고 답할 수 있다. 이전 판은 boolean만 받아
  // 읽기 실패가 `false`로 붕괴해 "게이트가 지워졌다"는 **거짓 위반**을 냈다.
  const gone = [], unknown = [];
  for (const g of (receipt && Array.isArray(receipt.gates) ? receipt.gates : [])) {
    const t = tri(exists ? exists(g) : undefined);
    if (t === TRI.NO) gone.push(g);
    else if (t === TRI.UNKNOWN) unknown.push(g);
  }
  return { gone, unchecked: unknown };   // 두 사실은 두 필드다(배열에 속성을 붙이면 소비처가 깨진다)
}

// CI에 스윕이 배선됐는가. ciFiles: [{path, text}].
// 반환 {wired, labelOnly, blocking, files}
//   wired     — 스윕을 **부르는** 파일. 비면 우회 불가한 채널이 없다.
//   labelOnly — 마커가 **라벨에만** 있는 파일. 배선이 아니면서 배선처럼 보이는 상태다(거짓 초록).
//   blocking  — 그 호출이 비-0을 낼 수 있는가(`--strict`). 통과만 하는 채널은 채널이 아니라 로그다.
export function ciWiring(ciFiles, markers) {
  const wired = [], labelOnly = [];
  let blocking = false;
  for (const f of ciFiles || []) {
    const text = String((f || {}).text || "");
    const hit = sweepInvocation(text, markers);
    if (hit.invoked) {
      wired.push(f.path);
      if (sweepBlocking(text, markers)) blocking = true;
    } else if (hit.labelOnly) labelOnly.push(f.path);
  }
  return { wired, labelOnly, blocking, files: (ciFiles || []).length };
}
