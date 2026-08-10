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
// 반환 {wired:[경로…], files:number} — wired가 비면 **우회 불가한 채널이 없다**.
export function ciWiring(ciFiles, markers) {
  const list = markers && markers.length ? markers : DEFAULT_SWEEP_INVOCATION_MARKERS;
  const wired = [];
  for (const f of ciFiles || []) {
    const text = String((f || {}).text || "");
    if (list.some((m) => text.includes(String(m)))) wired.push(f.path);
  }
  return { wired, files: (ciFiles || []).length };
}
