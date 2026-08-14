#!/usr/bin/env node
// ─── SDD 하네스 — detect 집계기 ───────────────────────────────
// HARNESS.md 규칙표의 detect 단계: 규칙별 detector 게이트를 일괄 실행하고
// "확인 필요/clean"을 규칙별로 리포트한다. 스킬 /sdd-sync 과 pre-push 훅이 소비.
// advisory(기본): 리포트 + exit 0. --strict: 발견 있으면 exit 1.
// --json: 기계 판독 리포트(스키마 v1)만 stdout에 출력(사람 텍스트 억제) — ask 층이 소비.
//
// 탐지 로직은 게이트에 있다(판정 신규 0). 이 파일은 오케스트레이션만.
// Usage: node scripts/sdd-sync.mjs [--strict] [--json]

import { execFileSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERDICT_KINDS, parseVerdict, stripVerdictLines, isJudged, KIND_LABEL, isMainEntry } from "./verdict-lib.mjs";

const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
// fileURLToPath: 한글 등 비-ASCII 경로에서 URL.pathname은 %-인코딩돼 게이트가 조용히 스킵된다(도그푸딩 발견).
const HERE = dirname(fileURLToPath(import.meta.url));

// 규칙 → detector 게이트(HARNESS.md 규칙표). 같은 디렉토리에서 게이트를 찾는다.
const RULES = [
  { rule: "R1 spec→code", gates: ["check-fr-coverage.mjs"] },
  { rule: "R2 code→spec", gates: ["check-converge-drift.mjs", "check-orphan-surfaces.mjs", "check-spec-sync.mjs"] },
  { rule: "R3 dedup+입도+완전성+일관성", gates: ["check-ownership.mjs", "check-spec-cohesion.mjs", "check-spec-completeness.mjs", "check-spec-consistency.mjs",
    // 보증 맵 드리프트(SPEC-028) — 맵이 현재 소유 선언과 갈라지면 "미판정" 가시성이 낡은 사실을
    // 보여준다. `--check`는 읽기 전용(재생성 안 함) — 강제점이 없어 사람이 기억해야 하던 구멍을 닫는다.
    { file: "gen-ownership-map.mjs", args: ["--check", "--if-present"] }] },
  // R5(감사 M1): 테스트 실행 결과 — runTestsPolicy가 off(기본)면 게이트가 스스로 no-op라 비용 0.
  // SPEC-021이 선언한 "CI·pre-push" 발동 지점의 실제 배선(선언만 있고 호출처 0곳이던 결함 봉합).
  { rule: "R5 test 실행(commands.test)", gates: ["check-test-run.mjs"] },
  // R6(SPEC-027): 강제 정책 강도의 단조성 — knob 하향(회피)을 차단. policyRatchetPolicy가
  // off면 게이트가 스스로 no-op. base config 미조회(최초 채택)면 skip이라 비용 0.
  { rule: "R6 정책 래칫(강도 단조)", gates: ["check-policy-ratchet.mjs"] },
  // R7(SPEC-030): Engines·Events 카테고리 — 전수성 구멍 봉합. 두 정책이 off(기본)면 게이트가
  // 스스로 no-op라 비용 0(옵트인 — ownershipCategoryRoles로 engine/event 역할 선언 시 활성).
  { rule: "R7 Engines·Events(전수성)", gates: ["check-engine-event.mjs"] },
  // R8·R9(SPEC-031·032): "선언이 실제로 동작하는가" 축. 문서 정합(R1~R3)이 green이어도 산출물이
  // 런타임에서 죽어 있을 수 있다(실측: 게이트 전종 통과인데 대시보드 패널 30여 개 사망).
  // 둘 다 기본 off라 미채택 프로젝트는 비용 0. 라이브 대조는 자격증명 없으면 skipped(하드 실패 금지).
  { rule: "R8 실행 증거([검증] 경로)", gates: ["check-evidence.mjs"] },
  { rule: "R9 라이브 대조(저장소 밖 진실)", gates: ["check-live-reality.mjs"] },
  // R10(SPEC-033): 동의어·형태 변이 — dedup이 키 문자열만 보는 사각. ①② 결정적(차단 가능),
  // ③ 확률적 후보는 **어떤 강도에서도 advisory**(LLM 오탐에 차단력을 주지 않는다). 기본 off.
  { rule: "R10 동의어·형태 변이", gates: ["check-synonym.mjs"] },
  // R11(SPEC-034): SC·NFR 검증 회계 — FR만 회계하던 사각. 성능·보안 목표가 산문으로 방치돼도
  // green이던 것을 닫는다. 기본 off(선언 문법이 있는 프로젝트만 발화).
  { rule: "R11 SC·NFR 검증 회계", gates: ["check-sc-coverage.mjs"] },
  // R12(SPEC-004 FR-013): 훅 배선 실재 — 게이트가 다 있어도 .git/hooks가 비어 있으면 아무것도
  // 발동하지 않는다. 게이트의 inert만 보고 훅의 inert를 안 보면 미설치가 green으로 읽힌다.
  { rule: "R12 훅 배선 실재", gates: ["check-hooks-installed.mjs"] },
  // R13(SPEC-038): 구현 중복 — dedup은 **선언 단위**(같은 파일을 두 스펙이 주장하는가)를 보고
  // 이 규칙은 **구현 단위**(같은 규칙을 두 곳이 구현하는가)를 본다. 실측: 병렬 서브에이전트가
  // 같은 규칙을 세 갈래로 만들었고 게이트 4종이 전부 green이었다.
  { rule: "R13 구현 중복(선언 아닌 구현)", gates: ["check-duplicate-logic.mjs"] },
  // R14(SPEC-041): 선언된 증거가 **돌았는가**. R8이 "증거가 실재하는가"까지 보고, 여기서 실행을 본다 —
  // 존재는 실행이 아니다. 원장 미선언이면 스스로 inert를 선언한다(SPEC-040).
  { rule: "R14 검증 실행(존재 아닌 실행)", gates: ["check-verification-executed.mjs"] },
  // R15(SPEC-045): 도구가 아니라 **설명**을 본다. 새로 배우는 사람은 코드가 아니라 소개 문서로
  // 방법론을 만나므로, 문서가 낡으면 존재하지 않는 규칙 체계를 가르친다. 소개 문서 미선언이면 inert.
  { rule: "R15 소개 문서 동기(설명이 도구를 따라잡는가)", gates: ["check-intro-doc.mjs"] },
  // R16(SPEC-047): 여러 스펙에 걸친 순차 사슬은 아무도 소유하지 않는다 — 조각이 흩어지면 어느
  // 문서를 읽어도 일부만 보이고, 그 흩어짐이 코드의 무행동으로 나타난다. 미선언이면 inert.
  { rule: "R16 순차 프로세스 SSOT(사슬을 누가 소유하는가)", gates: ["check-process-ssot.mjs"] },
  // R17(SPEC-048): 감시자 자신이 실재하는가. 무시하는 프로젝트는 게이트를 안 돌리므로 이 축은
  // **우회 불가한 채널(CI)**의 배선을 본다 — 훅은 우회되고 게이트 파일은 지워도 조용하다.
  { rule: "R17 감시자 실재(우회 불가한 채널이 있는가)", gates: ["check-watchdog.mjs"] },
  // R18(SPEC-050): 게이트가 애초에 **로드될 수 있는가**. 다른 축은 전부 게이트가 돈다고 가정하는데,
  // 부분 동기화된 설치에서는 게이트가 판정이 아니라 SyntaxError를 낸다. 이 축만 아무 게이트도
  // 실행하지 않고 판정한다 — import 그래프는 정적으로 결정 가능하다.
  { rule: "R18 배선 무결성(게이트가 로드되는가)", gates: ["check-import-wiring.mjs"] },
  // R19(SPEC-051): 감시자가 **에이전트를 보는가**. R17은 커밋 이후 채널(CI)을 보고, 이 축은
  // 에이전트가 도구를 쓰는 **순간** 발동하는 훅의 배선을 본다. 실측: 킷 자신에 이 배선이 통째로
  // 없었는데도 R17은 초록이었다 — 감시자가 있다와 감시자가 에이전트를 본다는 다른 사실이다.
  { rule: "R19 에이전트 배선(감시자가 에이전트를 보는가)", gates: ["check-agent-wiring.mjs"] },
  // R20(SPEC-052): **감사** 층 — 앞의 규칙들이 "에이전트가 명세대로 하는가"를 보는 동안 이 축은
  // "명세 코퍼스가 스스로와 정합한가"를 본다. 같은 대상에 SHALL과 SHALL NOT이 공존하면 급할 때
  // 에이전트는 자기가 먼저 본 쪽을 따른다. 결정적 절반만 차단하고 의미 충돌은 열거·판정 분업이다.
  { rule: "R20 명세 모순 감사(코퍼스가 스스로와 정합한가)", gates: ["check-spec-conflict.mjs"] },
  // R21(SPEC-053): 조사 전에 명세를 보게 하는 층. **커밋 게이트로는 원리상 볼 수 없다** —
  // 조회는 커밋도 파일 변경도 남기지 않는다. 스윕에서는 훅이 아니라 **선언 자체**를 판정한다
  // (잘못된 선언은 아무것도 막지 않고 아무것도 알리지 않는 조용한 무발화다).
  { rule: "R21 진단 가드 선언(조사 전에 명세를 보는가)", gates: ["check-diagnosis-guard.mjs"] },
  // R22(SPEC-055): 완료 판정이 **대상 상태**를 봤는가 — 로그·CI 상태는 대상이 아니라 대상에
  // 대한 이야기다. 실측 제보: 파이프라인 로그와 초록 CI로 배포 완료를 보고했는데 migrate Job이
  // 실패해 배포 스테이지가 스킵된 상태였다. 완료 주장 검사 0건이면 게이트가 스스로 INERT다.
  { rule: "R22 완료 판정 신호(대상 상태를 봤는가)", gates: ["check-completion-signal.mjs"] },
  // R23(SPEC-056): FR 정의가 FR 섹션 밖에 있으면 grammar-lib의 frDeclarations가 스캔 범위 밖이라
  // "선언 자체가 없다"로 사라지고, 그 사라짐이 dangling @covers라는 **다른 축**의 결함으로
  // 재등장한다. 이 축은 사라짐의 원인 자리를 직접 잡는다(실측: 같은 실수가 하루에 세 번 났다).
  { rule: "R23 FR 배치(섹션 밖 정의)", gates: ["check-fr-placement.mjs"] },
  // R24(SPEC-057): 감시자가 있고 사유도 매번 정확했는데 "이게 오늘 세 번째"라는 **기억**이
  // 없었다. 판정 방출기(armVerdict)가 모든 게이트의 차단을 원장에 자동으로 적고, 이 게이트가
  // 같은 (게이트,클래스)가 임계치를 넘겼는데 전용 가드가 없으면 가드를 만들라고 말한다.
  { rule: "R24 게이트 실패 에스컬레이션(반복이 기억되는가)", gates: ["check-gate-escalation.mjs"] },
  // R25(SPEC-058): SPEC-053·035와 같은 층(도구 호출 직전)이지만 구제 방식이 다르다 — 되돌리기
  // 어려운 행동(트래커 상태 전이·배포·파괴적 DB 조작)에는 독립 서브에이전트가 명세·실제 상태를
  // 대조 확인했다는 승인 마커(행동 해시 결속)를 요구한다. 실측: QA 실측·댓글까지 마친 티켓을
  // 배포도 안 된 채 종결 상태로 넘기려 했다 — 커밋 이전, 대화 안에서 끝나 기존 게이트가 못 본다.
  { rule: "R25 위험 행동 승인(독립 검증 없이 지나가지 않는가)", gates: ["check-risky-action.mjs"] },
];

// 게이트 ↔ Python 서브커맨드 **선언**. SPEC-006은 판정 게이트에 양판을 요구하는데, 그 대응은
// 어디에도 적혀 있지 않았다 — 그래서 미러 누락이 **사람이 손으로 대조할 때만** 발견됐다.
// 실측(2026-08-10): 그 대조를 처음 기계화하자 두 건이 즉시 나왔다 — R12 훅 배선과 R13 구현 중복이
// 여러 라운드 동안 Node 전용이었고, Python 런타임 프로젝트에서 그 두 축은 **아무도 보지 않는
// 상태**였다. 그 0건은 진짜 0건과 구분되지 않는다.
//
// 판정 게이트가 아닌 항목은 **사유를 적는다** — 빈 값은 "판정 게이트가 아니다"와 "잊었다"를
// 구분하지 못하고, 구분되지 않는 빈칸은 항상 후자를 숨긴다.
export const PY_SUBCOMMAND = Object.freeze({
  "check-fr-coverage.mjs": "fr",
  "check-converge-drift.mjs": "converge",
  "check-orphan-surfaces.mjs": "orphan",
  "check-spec-sync.mjs": "specsync",
  "check-ownership.mjs": "ownership",
  "check-spec-cohesion.mjs": "cohesion",
  "check-spec-completeness.mjs": "completeness",
  "check-spec-consistency.mjs": "consistency",
  "check-test-run.mjs": "testrun",
  "check-policy-ratchet.mjs": "ratchet",
  "check-engine-event.mjs": "engineevent",
  "check-evidence.mjs": "evidence",
  "check-live-reality.mjs": "livereality",
  "check-synonym.mjs": "synonym",
  "check-sc-coverage.mjs": "sccoverage",
  "check-hooks-installed.mjs": "hooksinstalled",
  "check-duplicate-logic.mjs": "duplicatelogic",
  "check-verification-executed.mjs": "verifyrun",
  "check-intro-doc.mjs": "introdoc",
  "check-process-ssot.mjs": "processssot",
  "check-watchdog.mjs": "watchdog",
  "check-import-wiring.mjs": "importwiring",
  "check-agent-wiring.mjs": "agentwiring",
  "check-spec-conflict.mjs": "specconflict",
  "check-diagnosis-guard.mjs": "diagnosisguard",
  "check-completion-signal.mjs": "completionsignal",
  "check-fr-placement.mjs": "frplacement",
  "check-gate-escalation.mjs": "gateescalation",
  "check-risky-action.mjs": "riskyaction",
  "gen-ownership-map.mjs": { notAJudge: "생성기 — 보증 맵을 다시 쓰고 드리프트만 알린다. 판정 출력(SPEC-040)이 아니므로 양판 대상이 아니다" },
});


const lastLine = (s) => (s || "").trim().split("\n").pop() || "";

// 스택 프레임·런타임 배너·소스 에코 — 크래시 stderr의 **구조적 소음**이다. 내용이 아니라 형태로
// 가른다(특정 런타임 어휘에 기대면 다른 런타임에서 통째로 빗나간다).
const CRASH_NOISE = [
  /^\s+at\s/,                      // 스택 프레임
  /^\s*\^+\s*$/,                   // 오류 위치 캐럿
  /^[\w.]+\s+v\d+\.\d+/,           // 런타임 배너(`Node.js v22.22.2`)
  /^\s*$/,                         // 빈 줄
];

// 크래시 요약 — **가장 정보량 있는 줄**을 고른다.
//
// 실측 제보(2026-08-10): 부분 동기화로 게이트가 이렇게 죽었는데
//     SyntaxError: The requested module './ownership-keys.mjs'
//                  does not provide an export named 'bodyBeforeOwnership'
//         at ModuleJob._instantiate (node:internal/…)
//     Node.js v22.22.2
// `lastLine(stderr)`이 뽑은 요약은 **`Node.js v22.22.2`** 였다. 원인 줄은 스택 위에 묻히고
// 스윕은 런타임 버전을 사유로 보고했으므로, 제보자가 스택을 직접 읽어 원인을 찾아야 했다.
// 마지막 줄이 요약인 것은 **게이트가 협조적으로 끝났을 때만** 참이다 — 크래시는 협조가 아니다.
export function crashSummary(stderr) {
  const lines = String(stderr || "").split("\n").filter((l) => !CRASH_NOISE.some((re) => re.test(l)));
  if (!lines.length) return "";
  // 던져진 오류 줄을 우선한다(`SyntaxError:`·`TypeError:`·`Error:` 꼴). 형태 판정이라
  // 메시지 본문이 어떤 언어든 무관하다.
  const thrown = lines.find((l) => /^[\w$.]*(Error|Exception)\b\s*:/.test(l.trim()));
  // 오류 줄이 없으면 첫 줄이다 — 크래시 stderr의 첫 줄은 대개 원인이고, 마지막 줄은 대개 배너다.
  return (thrown || lines[0]).trim();
}

// 순수 판정: 게이트 실행 결과(부재·크래시·stdout) → {flagged, summary}.
// **게이트의 stdout이 판정의 정본**이라는 계약 위에 서 있다 — 게이트는 자기 판정 줄만 stdout에
// 쓰고, 하위 프로세스 출력을 stdout으로 흘리지 않는다(그러면 여기 스캔이 러너 텍스트에 걸려
// green을 ⚠로 읽는다 — 감사 M-8, check-test-run.mjs가 fd 2로 리다이렉트해 지키는 규약).
// ⚠ **출력 0줄은 clean이 아니라 미판정이다:** exit 0과 "판정했음"은 다른 사실이다. 무음 미실행
// (엔트리 판정 실패·조건 분기 누락)은 exit 0으로 끝나므로, 출력 코드만 보면 거짓 green이 된다
// (실측: 비-ASCII 경로에서 check-test-run이 한 줄도 내지 않고 exit 0 → `runTestsPolicy: hard`가
// 여러 라운드 거짓 green). 판정 대상이 없어 발화하지 않는 게이트도 "off/no-op/skip" 한 줄을 낸다.
// ⚠ 분류의 정본은 **게이트가 선언한 판정 타입**이다(SPEC-040) — 산문 스캔이 아니다.
// 이전 판은 `/[⚠✗]/.test(stdout)`으로 추측했고, 그래서 "off (판정 안 함)"이라 적힌 줄을
// ✓ clean으로 분류했다(실측: R7 Engines·Events, R9 라이브 대조). **규범과 도구가 같은 사실을
// 다르게 말하는 상태**였다 — update.md §7은 off를 clean에서 떼라고 요구하는데 하네스가 합쳤다.
// 이제 게이트가 종류를 말하고, 이 함수는 그것을 읽기만 한다. 말하지 않으면 UNTYPED(미판정)다.
export function gateOutcome({ file, missing = false, crashed = false, stdout = "", stderr = "", timedOut = false, skippedBudget = false }) {
  const K = VERDICT_KINDS;
  const un = (summary) => ({ kind: K.UNTYPED, violation: false, flagged: true, summary });
  if (missing) return un(`(없음: ${file}) — detector 미설치라 이 규칙은 판정 없음(sdd-init/update로 배선 갱신 필요)`);
  // 시간 예산 — 훅이 몇 초를 넘기면 사람이 --no-verify로 우회하고, 그러면 훅이 통째로 무의미해진다.
  // 그래서 끊되 **조용히 통과시키지 않는다**: 못 본 것은 "미판정"으로 남아 flagged다(§exit 0 ≠ 판정했음).
  if (timedOut) return un(`(미판정: 시간 초과) — ${file}이 제한 시간 안에 끝나지 않아 판정하지 못했다(통과 아님). 전체 판정: node scripts/sdd-sync.mjs`);
  if (skippedBudget) return un(`(미판정: 시간 예산 소진) — ${file}을 실행하지 않았다(통과 아님). 전체 판정: node scripts/sdd-sync.mjs`);

  const v = parseVerdict(stdout);
  const body = stripVerdictLines(stdout);
  // 크래시면 stderr의 **원인 줄**을 찾는다(마지막 줄이 아니다 — 그건 런타임 배너다).
  const summary = lastLine(body) || (crashed ? crashSummary(stderr) : lastLine(stderr))
    || (crashed ? "(비정상 종료)" : "");

  // 판정 타입 미선언 — 배선 누락이거나 arm 이전에 터진 것. 어느 쪽이든 **통과가 아니다**.
  // (출력 0줄도 여기로 떨어진다 — 무음 미실행은 판정 줄조차 없으므로 같은 결론이다.)
  if (!v) {
    return un(crashed
      ? `(미판정: 판정 타입 없이 비정상 종료) — ${summary || "게이트가 판정 종류를 선언하기 전에 끝났다"}`
      : `(미판정: 게이트가 판정 종류를 선언하지 않음 — 배선 누락, exit 0 ≠ 판정함) ${summary}`.trim());
  }
  // 위반은 **JUDGED 안에서만** 성립한다 — 안 본 게이트는 위반을 낼 수 없다(그게 위험한 이유다).
  // ⚠ 건수도 **게이트가 선언한 것**을 읽는다(`judged(n)` → "위반 N건"). 본문의 `⚠`·`✗`를 세던
  // 이전 판은 **비차단으로 설계된 층의 경고까지 위반으로 집계**했다(실측: R13 확률적 층은 어떤
  // 강도에서도 차단하지 않는데 스윕이 ⚠ 한 줄을 보고 규칙을 붉게 칠했다). 같은 계열의 마지막
  // 추측이라 함께 제거한다 — 무엇이 위반인지는 게이트가 알고, 집계기는 읽기만 한다.
  const declaredViolations = Number((/위반\s+(\d+)\s*건/.exec(v.detail || "") || [, 0])[1]);
  const violation = isJudged(v.kind) && (crashed || declaredViolations > 0);
  return {
    kind: v.kind,
    violation,
    // strict가 막는 것은 **위반**과 **미판정**이다. off·inert·skipped는 막지 않되 clean에 합산하지도
    // 않는다 — 채택 중인 프로젝트를 벽으로 막지 않으면서 "안 봤다"는 사실은 매 실행 계상된다.
    flagged: violation || v.kind === K.UNTYPED,
    summary: summary || v.line,
    detail: v.detail,
  };
}

// 게이트 항목은 문자열이거나 {file, args} — 일부 detector는 읽기 전용 모드 인자가 필요하다
// (예: gen-ownership-map은 무인자면 파일을 **재생성**하므로 스윕에선 반드시 `--check`).
const gateFile = (g) => (typeof g === "string" ? g : g.file);
const gateArgs = (g) => (typeof g === "string" ? [] : (g.args || []));

// 시간 예산(SPEC-004 FR-012) — pre-push에서 스윕이 수십 초 걸리면 사람이 `--no-verify`로 우회하고
// 그 순간 훅 전체가 무의미해진다(실측 제보: 30초+ 타임아웃으로 매 push가 멈춰 우회가 습관이 됐다).
// 그래서 훅 경로에는 예산을 준다. 핵심은 **끊되 조용히 통과시키지 않는 것** — 못 본 게이트는
// "미판정"으로 남아 flagged이고, 전체 판정은 사람이 인자 없이 다시 돌린다.
//   --budget <ms> | env SDD_SYNC_BUDGET_MS (0·미지정 = 무제한)
const argBudget = (() => {
  const i = process.argv.indexOf("--budget");
  const v = i >= 0 ? Number(process.argv[i + 1]) : Number(process.env.SDD_SYNC_BUDGET_MS || 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
})();
// 훅 모드 위임(SPEC-004 FR-012) — pre-push에서 무거운 규칙을 **선언적으로** 다른 트리거에 넘긴다.
// 실측: 스윕 전체 30.3초 중 R5(스위트 실행)가 29.8초, 나머지 10규칙 합계 0.5초. 30초 훅은 반드시
// `--no-verify`로 우회되고 그 순간 훅 전체가 무의미해진다.
// **조용한 생략과 다른 점:** ①config에 실행 규칙을 선언하고 ②담당자를 명시해야 하며(둘 다 없으면
// 에러) ③위임된 규칙은 매 실행 "위임 — 누가 판정하는지"를 출력한다. 사유 있는 skipped(SPEC-032)와
// 같은 계약이라 flagged가 아니다. 사유 없이 사라지는 것만 미판정으로 센다.
const HOOK_MODE = process.argv.includes("--hook");
const startedAt = Date.now();
const remaining = () => (argBudget ? Math.max(0, argBudget - (Date.now() - startedAt)) : Infinity);

function runGate(g) {
  const file = gateFile(g);
  const path = join(HERE, file);
  if (!existsSync(path)) return gateOutcome({ file, missing: true });
  const left = remaining();
  if (left <= 0) return gateOutcome({ file, skippedBudget: true });
  try {
    // stdio: stderr를 캡처(부모로 inherit 금지) — 게이트가 크래시해도 누출 없이 리포트에 담는다.
    const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    if (Number.isFinite(left)) { opts.timeout = left; opts.killSignal = "SIGKILL"; }
    const out = execFileSync("node", [path, ...gateArgs(g)], opts);
    return gateOutcome({ file, stdout: out });
  } catch (e) {
    // 타임아웃은 크래시가 아니다 — "판정 못 함"으로 구분해야 통과로 오독되지 않는다.
    if (e && (e.killed || e.signal === "SIGKILL" || e.code === "ETIMEDOUT")) return gateOutcome({ file, timedOut: true });
    return gateOutcome({ file, crashed: true, stdout: e.stdout || "", stderr: e.stderr || "" });
  }
}

// 규칙별 detector 실행 → 데이터 모델(사람/JSON 공통). rule id는 안정 계약(R1/R2/R3).
function hookDelegation() {
  if (!HOOK_MODE) return null;
  let cfg = {};
  try { cfg = loadConfig(); } catch { return null; }
  const rules = cfg.syncHookRules;
  if (!Array.isArray(rules) || !rules.length) return null; // 미선언 = 전체 실행(하위호환)
  const to = String(cfg.syncHookDelegatedTo || "").trim();
  if (!to) {
    console.error("✗ syncHookRules를 선언했으면 syncHookDelegatedTo(누가 대신 판정하나)도 필수 — 담당자 없는 생략은 조용한 미판정이다.");
    process.exit(1);
  }
  return { run: new Set(rules.map(String)), to };
}
const DELEGATION = hookDelegation();

function collect() {
  return RULES.map(({ rule, gates }) => {
    const sp = rule.indexOf(" ");
    const id = rule.slice(0, sp); // "R1"
    const title = rule.slice(sp + 1); // "spec→code"
    if (DELEGATION && !DELEGATION.run.has(id)) {
      return { id, title, flagged: false, delegated: true, state: "안 봄",
        gates: [{ gate: gates.map(gateFile).join("·"), kind: VERDICT_KINDS.SKIPPED, violation: false, flagged: false,
          summary: `위임 — 이 훅에서는 판정하지 않는다(담당: ${DELEGATION.to}). 지금 보려면: node scripts/sdd-sync.mjs` }] };
    }
    const gateResults = gates.map((g) => {
      const r = runGate(g);
      return { gate: gateFile(g), kind: r.kind, violation: r.violation, flagged: r.flagged, summary: r.summary };
    });
    // 규칙의 상태는 셋이다 — 이전 판의 ✓clean/⚠ 두 상태가 "안 봄"을 clean 쪽으로 접었다.
    const state = gateResults.some((g) => g.violation || g.kind === VERDICT_KINDS.UNTYPED) ? "위반"
      : gateResults.every((g) => isJudged(g.kind)) ? "판정함" : "안 봄";
    return { id, title, state, flagged: gateResults.some((g) => g.flagged), gates: gateResults };
  });
}

// 세 상태의 표식 — 모르는 사람이 한 눈에 갈라 읽을 수 있어야 한다.
// "안 봄"이 초록이 아니라는 사실이 이 표식의 전부다.
const STATE_MARK = { "판정함": "✓ 판정함", "안 봄": "· 안 봄(판정 안 함 — 통과 아님)", "위반": "⚠ 확인 필요" };

// 게이트 단위 집계 — update.md §7이 요구하는 보고 형식을 **계산**한다(사람 눈대중이 아니라).
export function tallyGates(rules) {
  const t = { total: 0, judged: 0, off: 0, inert: 0, skipped: 0, untyped: 0, violation: 0 };
  for (const r of rules) for (const g of r.gates) {
    t.total += 1;
    if (g.violation) t.violation += 1;
    if (g.kind === VERDICT_KINDS.JUDGED) t.judged += 1;
    else if (g.kind === VERDICT_KINDS.OFF) t.off += 1;
    else if (g.kind === VERDICT_KINDS.INERT) t.inert += 1;
    else if (g.kind === VERDICT_KINDS.SKIPPED) t.skipped += 1;
    else t.untyped += 1;
  }
  return t;
}

export function tallyLine(t) {
  const unseen = t.off + t.inert + t.skipped;
  const why = [t.off && `off ${t.off}`, t.inert && `inert ${t.inert}`, t.skipped && `생략 ${t.skipped}`].filter(Boolean).join(" · ");
  return `게이트 ${t.total}종 = 판정 ${t.judged} · 안 봄 ${unseen}${why ? `(${why})` : ""} · 미판정 ${t.untyped}`;
}

// 엔트리 판정은 `verdict-lib`의 `isMainEntry`다(realpath 비교) — 정의가 한 곳에 있는 이유와
// 문자열 비교가 왜 조용히 미실행을 만드는지는 그 함수의 주석에 있다.

if (isMainEntry(import.meta.url)) {
  const rules = collect();
  const flaggedRules = rules.filter((r) => r.flagged).map((r) => r.id);
  const clean = flaggedRules.length === 0;
  const tally = tallyGates(rules);

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ schemaVersion: 2, clean, tally, flaggedRules, rules }, null, 2) + "\n");
  } else {
    console.log("SDD sync 리포트 — detector 일괄 실행 (HARNESS.md 규칙표)");
    for (const r of rules) {
      console.log(`\n● ${r.id} ${r.title}: ${r.delegated ? "· 위임" : STATE_MARK[r.state]}`);
      // 게이트 줄에 "무엇을 했는지"를 앞에 붙인다 — 요약 문장만 보고 초록으로 읽는 일을 막는다.
      for (const g of r.gates) {
        const mark = isJudged(g.kind) ? "" : `[${KIND_LABEL[g.kind] || g.kind}] `;
        console.log(`    [${g.gate}] ${mark}${g.summary}`);
      }
    }
    // ⚠ 집계 줄은 **항상** 나온다(clean일 때도). "전부 sync ✓"만 보고 12종이 off인 것을 모르는
    // 상태가 이 게이트 계열의 원래 결함이었다 — 초록의 분모를 같은 줄에서 밝힌다.
    console.log(`\n요약: ${tallyLine(tally)}`);
    if (tally.untyped) console.log(`  ✗ 미판정 ${tally.untyped}종 — 판정 종류를 선언하지 않은 게이트다(배선 누락). 통과가 아니다.`);
    if (tally.inert) console.log(`  ⚠ inert ${tally.inert}종 — 정책은 켜졌으나 판정 입력이 없다. "hard 선언 + 무판정 = 거짓 안전"의 자리다(update.md §6).`);
    console.log(
      clean
        ? `  ${tally.judged}종이 판정했고 위반 0건 — 판정한 범위 안에서 sync ✓${tally.off + tally.inert + tally.skipped ? " (안 본 것은 위 집계를 보라 — 초록이 아니다)" : ""}`
        : `  확인 필요 — ${rules.filter((r) => r.flagged).map((r) => `${r.id} ${r.title}`).join(", ")} → node scripts/sdd-sync.mjs 리포트로 의사결정(Claude Code: /sdd-sync)`
    );
  }
  if (STRICT && !clean) process.exit(1);
}
