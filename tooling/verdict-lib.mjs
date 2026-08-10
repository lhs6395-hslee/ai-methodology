// 게이트 판정의 **타입** (SPEC-040)
//
// 실측 결함(이 파일이 존재하는 이유): 킷의 스윕이 "판정 안 함"을 `✓ clean`으로 렌더했다.
//   ● R7 Engines·Events(전수성): ✓ clean
//       engineRealityPolicy·eventAttributionPolicy 모두 off (판정 안 함)
// 게이트는 산문으로 "off (판정 안 함)"이라 말했는데 집계기는 그 줄에 `⚠`·`✗`가 없다는 이유로
// clean으로 분류했다. 즉 **규범과 도구가 같은 사실을 다르게 말하고 있었다** — update.md §7은
// 보고를 "판정 출력 M종 · 명시적 off/no-op/inert K종 · 미판정 0종"으로 적으라고 강제하는데,
// 하네스 자신은 off를 clean에 합산했다. 모르는 사람은 초록 줄 12개를 보고 12개가 검증됐다고 읽는다.
//
// 원인은 계약의 형태다: 게이트가 **산문**을 반환하고 집계기가 **문자열로 추측**했다
// (`/[⚠✗]/.test(stdout)`). 추측은 어휘가 바뀌면 조용히 틀리고, 새 게이트가 새 표현을 쓰면
// 아무도 모르게 clean이 된다. 고칠 것은 어휘가 아니라 **반환 타입**이다.
//
// 그래서 게이트는 자기 판정의 **종류를 선언**한다. 빈 출력·초록 문장이 아니라 타입이 정본이다.
// (같은 결론에 먼저 도달한 사례: FinOps Agent Ontology 문서 §01-4 — 빈 배열 대신 업무 의미가
//  다른 typed outcome을 반환한다. `ANSWER_READY` / `*_DATA_REQUIRED` / `DENY` / `NOT_FOUND` /
//  `STALE`. "데이터 없음"과 "실제 0"을 같은 값으로 반환하는 한 호출자는 둘을 가를 수 없다.)

// 판정 종류 — **다섯 개뿐이고 더 늘리지 않는다.** 종류가 늘면 "이건 어디에 넣지"가 생기고
// 그 순간 예외가 태어난다. 새 상황은 반드시 이 다섯 중 하나로 분류된다.
export const VERDICT_KINDS = Object.freeze({
  // 봤다. 그리고 결과를 안다(위반 0건도 판정이다 — 이것만이 초록의 자격을 갖는다).
  JUDGED: "JUDGED",
  // 안 봤다 — **사람이 껐기 때문에**. 해소: 정책을 켠다.
  OFF: "OFF",
  // 안 봤다 — **켜져 있는데 볼 것이 없어서**(소스·매니페스트·역할·어휘 미선언).
  // OFF와 가르는 이유: 해소 방법이 다르다. OFF는 켜면 되고 INERT는 입력을 만들어야 한다.
  // 이 둘을 한 상태로 묶으면 "켰으니 됐다"가 성립해버린다(실측: hard 선언 + 무판정 = 거짓 안전).
  INERT: "INERT",
  // 안 봤다 — **사유 있는 생략**(어댑터 실패·시간 예산·다른 트리거로 위임).
  // 사유가 없으면 이 종류를 쓸 수 없다(조용한 생략 금지).
  SKIPPED: "SKIPPED",
  // 게이트가 자기 판정 종류를 선언하지 않았다 = **배선 누락**. 통과가 아니다.
  // 이 값은 게이트가 직접 쓰는 게 아니라 방출기가 자동으로 채운다(아래 armVerdict).
  UNTYPED: "UNTYPED",
});

const KIND_SET = new Set(Object.values(VERDICT_KINDS));

// stdout에 실리는 형태 — 사람이 읽을 수 있고 기계가 파싱할 수 있다.
//   판정: JUDGED — 위반 0건
//   판정: OFF — engineRealityPolicy·eventAttributionPolicy
//   판정: INERT — duplicateLiteralFileRegex 미선언(이 프로젝트 언어를 볼 수 없음)
// 종류 토큰만 영문 대문자로 고정한다(번역 표류로 파싱이 깨지지 않게), 사유는 프로젝트 언어로.
export const VERDICT_PREFIX = "판정:";

export function formatVerdict(kind, detail) {
  const k = KIND_SET.has(kind) ? kind : VERDICT_KINDS.UNTYPED;
  const d = String(detail ?? "").trim();
  return d ? `${VERDICT_PREFIX} ${k} — ${d}` : `${VERDICT_PREFIX} ${k}`;
}

// stdout에서 판정 줄을 뽑는다. 여러 줄이면 **마지막**이 유효하다(게이트가 진행 중에 갱신할 수 있다).
// 반환 {kind, detail, line} | null. null은 "선언 없음"이고 호출자가 UNTYPED로 처리한다.
const VERDICT_RE = new RegExp(`^\\s*${VERDICT_PREFIX}\\s*([A-Z]+)\\s*(?:—\\s*(.*))?$`);

export function parseVerdict(stdout) {
  let found = null;
  for (const line of String(stdout || "").split("\n")) {
    const m = VERDICT_RE.exec(line);
    if (!m) continue;
    const kind = KIND_SET.has(m[1]) ? m[1] : VERDICT_KINDS.UNTYPED;
    found = { kind, detail: (m[2] || "").trim(), line: line.trim() };
  }
  return found;
}

// 판정 줄을 제외한 stdout — 사람에게 보여줄 요약을 뽑을 때 쓴다(판정 줄이 마지막이라
// `lastLine(stdout)`이 요약 자리를 빼앗는 것을 막는다).
export function stripVerdictLines(stdout) {
  return String(stdout || "").split("\n").filter((l) => !VERDICT_RE.test(l)).join("\n");
}

// 초록의 자격 — **JUDGED만**이다. 나머지 넷은 전부 "안 봤다"이고, 안 본 것은 통과가 아니다.
export function isJudged(kind) { return kind === VERDICT_KINDS.JUDGED; }

// "안 봤다"의 사람 말 — 세 상태 렌더(판정함·안 봄·위반)에서 이유를 한 단어로 붙인다.
export const KIND_LABEL = Object.freeze({
  JUDGED: "판정함",
  OFF: "안 봄(정책 off)",
  INERT: "안 봄(판정 입력 없음)",
  SKIPPED: "안 봄(사유 있는 생략)",
  UNTYPED: "미판정(판정 종류 미선언 — 배선 누락)",
});

// 판정 입력 점검의 정본 — "정책이 켜졌는데 볼 것이 없으면 inert"는 축마다 반복되는 **같은 규칙**이다.
// R13 구조 중복 실측: engine-event-lib·ownership-reality-lib·schema-backing-lib에 같은 형태가 셋
// 있었다. 규칙은 여기 하나로 두고 **사유 문구는 축이 갖는다**(문구는 규칙이 아니라 데이터다).
//   inertReasons(policy, [{ ok, reason }, …]) → 충족되지 않은 것들의 사유 배열(off면 빈 배열)
export function inertReasons(policy, checks) {
  if (policy === "off") return [];
  return (checks || []).filter((c) => c && !c.ok).map((c) => c.reason);
}

// ── 방출기(게이트가 쓰는 유일한 진입점) ──────────────────────────────────────
// 설계: 게이트의 **모든 종료 경로**에서 정확히 한 줄이 나와야 한다. 분기마다 print를 심으면
// 반드시 빠뜨리는 분기가 생기고(그 분기가 곧 조용한 clean이다), 그래서 종료 훅에서 낸다.
//
// ⚠ `console.log`를 쓰지 않는 이유: stdout이 파이프일 때 Node의 쓰기는 비동기라
// `process.on("exit")` 안에서는 유실될 수 있다. 스윕은 게이트를 파이프로 잡으므로
// 그 유실이 곧 "판정 줄 없음"= UNTYPED 오분류가 된다. `fs.writeSync(1, …)`은 동기다.
import { writeSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

let PENDING = null;

export function verdict(kind, detail) { PENDING = { kind, detail }; }

// 게이트 상단에서 한 번 호출한다. 이후 어떤 경로로 끝나든(정상·process.exit·예외) 한 줄이 나온다.
//
// `quietWhenSilent` — **훅 편의 계층 전용**(check-pre-edit·배포 3종). 이 계층은 PreToolUse처럼
// 매 명령에 붙어 돌고 발동 조건이 아니면 **아무것도 출력하지 않는 것이 계약**이다. 여기에
// 판정 줄을 강제하면 모든 Bash 명령마다 한 줄이 붙어 소음이 되고, 소음이 되는 순간 사람이
// 훅을 끈다(킷 규범: "오탐이 잦은 게이트는 꺼진다"). 그래서 규칙을 이렇게 좁힌다:
//   **말을 했으면 무엇을 했는지도 말한다.** 한 마디도 안 했으면 판정 줄도 없다.
// 예외가 아니라 좁힌 계약이다 — 스윕에 집계되는 판정 게이트는 이 옵션을 쓸 수 없고,
// 그 사실을 `verdict-contract.test.mjs`가 규칙표와 대조해 강제한다(선언만으로 빠져나갈 수 없음).
export function armVerdict(opts = {}) {
  const quiet = Boolean(opts.quietWhenSilent);
  process.on("exit", () => {
    if (!PENDING && quiet) return;   // 훅 계층 + 발동 안 함 = 침묵이 정답
    const v = PENDING || { kind: VERDICT_KINDS.UNTYPED, detail: "게이트가 판정 종류를 선언하지 않았다(배선 누락 — verdict() 호출 없음)" };
    try { writeSync(1, formatVerdict(v.kind, v.detail) + "\n"); } catch { /* stdout 닫힘 — 방출 불가 */ }
  });
}

// 흔한 판정을 한 줄로 — 위반 건수만 주면 JUDGED의 사유 문구가 통일된다(어휘 표류 방지).
export function judged(violations = 0) {
  verdict(VERDICT_KINDS.JUDGED, violations > 0 ? `위반 ${violations}건` : "위반 0건");
}

// 이 파일이 직접 실행된 엔트리인가 — **realpath 비교다.**
//
// `import.meta.url === \`file://${process.argv[1]}\`` 문자열 비교는 두 곳에서 갈린다:
//   (a) 경로에 비-ASCII가 있으면 `import.meta.url`만 퍼센트 인코딩된다
//       (`…/한글경로/g.mjs` → `…/%ED%95%9C…/g.mjs`)
//   (b) macOS `/var`↔`/private/var` 심볼릭 링크
// 갈리면 main 블록이 **조용히 실행되지 않고** 게이트는 한 줄도 없이 exit 0 — 통과가 아니라
// 무음 미실행인데 exit 코드만 보는 확인은 초록으로 읽는다(SPEC-021 실측: 한글 경로 소비
// 프로젝트에서 `runTestsPolicy: hard`가 여러 라운드 거짓 green).
//
// 이 함수가 **공용**인 이유: 킷은 이 결함을 한 번 고쳤는데(check-test-run·check-schema-drift·
// sdd-sync) 세 곳에 각자 복사됐고, 그 뒤 새로 만든 게이트 3종이 **깨진 형태를 다시 도입했다**
// (R15·R16·R17). 규범이 세 번 복사되면 네 번째는 규범을 모른다 — 그래서 정의를 한 곳에 두고,
// 깨진 형태의 재유입은 `verdict-contract.test.mjs`가 금지한다(고친 것으로 끝내지 않는다).
export function isMainEntry(metaUrl) {
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]); }
  catch { return false; }
}
