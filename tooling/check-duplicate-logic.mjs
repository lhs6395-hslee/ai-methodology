#!/usr/bin/env node
// ─── 구현 중복 게이트 (SPEC-038, R13) ───
// dedup(`check-ownership`)의 사각: 그쪽은 **선언 단위**를 본다 — "같은 파일을 두 스펙이 주장하는가",
// "entity 키가 유일한가". 이 게이트는 **구현 단위**를 본다 — "같은 규칙을 두 곳이 구현하는가".
//
// 실측 제보(operations-dashboard 2026-08-03): 병렬 서브에이전트가 같은 별칭 제거 규칙을 세 갈래로
// 만들었고(`stripNameAlias`·`stripAlias`가 **같은 파일에** 공존 + 인라인 3곳) 게이트 4종이 전부
// green이었다. 통합하던 사람이 또 하나 만든 것이 두 번째 사고다.
//
// 두 층(SPEC-033과 같은 판단):
//   ① 결정적 — 동일 정규식 리터럴이 2곳 이상. 정책 강도대로 차단한다.
//   ② 확률적 — 주입 어댑터(`duplicateLogicCommand`)의 후보. **어떤 강도에서도 차단하지 않는다.**
//
// off|advisory(기본)|hard. Python 미러(SPEC-006).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import {
  DEFAULT_DUPLICATE_LITERAL_PATTERNS, DEFAULT_DUPLICATE_MIN_LENGTH, DEFAULT_DUPLICATE_FILE_REGEX,
  extractLiterals, duplicateLiteralFindings, staleAllowEntries, parseDuplicateCandidates,
} from "./duplicate-logic-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = String(cfg.duplicateLogicPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ duplicateLogicPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "duplicateLogicPolicy");
  console.log("구현 중복 게이트 — duplicateLogicPolicy:off (판정 안 함)");
  process.exit(0);
}
const HARD = POLICY === "hard";
const PATTERNS = cfg.duplicateLiteralPatterns && cfg.duplicateLiteralPatterns.length
  ? cfg.duplicateLiteralPatterns : DEFAULT_DUPLICATE_LITERAL_PATTERNS;
const MIN_LEN = Number(cfg.duplicateLiteralMinLength) || DEFAULT_DUPLICATE_MIN_LENGTH;
const CAP = Number(cfg.duplicateLogicListCap) || 12;
const IGNORE = new Set(cfg.ignoreDirs);
const TEST_RES = (cfg.testFileRegex || []).map((r) => new RegExp(r));
// ⚠ 킷 기본값은 **킷의 언어**(JS/TS)다 — 그 사실이 소비 프로젝트에서 조용한 0건이 된다(SPEC-040 ②).
// 실측: Python+Terraform 프로젝트가 이 게이트를 advisory로 켜면 기본 정규식이 아무 파일도 잡지
// 못해 "중복 0건"을 보고하는데, 그 0은 진짜 0과 구분되지 않는다. 그래서 **미선언 상태를 추적**해
// 아래에서 "안 본 확장자"가 남으면 INERT로 자백시킨다. 기본값을 없애지는 않는다(JS 프로젝트의
// 하위호환) — 대신 기본값에 기대는 동안 무엇을 안 봤는지 매 실행 말한다.
const FILE_REGEX_DECLARED = Boolean(cfg.duplicateLiteralFileRegex && cfg.duplicateLiteralFileRegex.length);
const FILE_RES = (FILE_REGEX_DECLARED ? cfg.duplicateLiteralFileRegex : DEFAULT_DUPLICATE_FILE_REGEX).map((r) => new RegExp(r));
const isTest = (rel) => TEST_RES.some((re) => re.test(rel));

// scanDirs 순회 — 테스트 파일은 기본 제외(단언이 같은 문자열을 반복하는 것은 중복이 아니다).
const files = [];        // 리터럴이 **있는** 파일만 — 판정 입력이지 "본 파일 수"가 아니다
let matchedFiles = 0;    // 대상 패턴에 걸린 파일 수(리터럴 0개여도 본 것이다 — 둘을 섞으면
                         // "정규식을 안 쓰는 JS 저장소"가 "아무것도 안 봤음"으로 오분류된다)
const skippedExt = new Map();   // 확장자 → 건수(대상 밖으로 밀려난 소스)
for (const dir of cfg.scanDirs || []) {
  const abs = resolveFromRoot(cfg, dir);
  (function walk(d, rel) {
    let entries; try { entries = readdirSync(d).sort(); } catch { return; }
    for (const name of entries) {
      const p = join(d, name), r = rel ? `${rel}/${name}` : `${dir}/${name}`;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!IGNORE.has(name)) walk(p, r); continue; }
      if (!FILE_RES.some((re) => re.test(r))) {           // 대상 확장자 밖 — 문서·셸의 슬래시는 정규식이 아니다
        const ext = (name.match(/\.[^.]+$/) || [""])[0];
        if (ext) skippedExt.set(ext, (skippedExt.get(ext) || 0) + 1);
        continue;
      }
      if (!cfg.duplicateLogicIncludeTests && isTest(r)) continue;
      matchedFiles += 1;
      let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
      const literals = extractLiterals(text, PATTERNS, MIN_LEN);
      if (literals.length) files.push({ path: r, literals });
    }
  })(abs, dir);
}

const allow = cfg.duplicateLogicAllow && typeof cfg.duplicateLogicAllow === "object" && !Array.isArray(cfg.duplicateLogicAllow)
  ? cfg.duplicateLogicAllow : {};
const { findings, errors } = duplicateLiteralFindings(files, allow);
if (errors.length) {
  console.error("✗ duplicateLogicAllow 오류:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ② 확률적 층 — 주입 어댑터. 비-0 = skipped(사유). "판정 못 함"과 "중복 없음"을 섞지 않는다.
let cand = { status: "off", items: [], reason: "" };
if (String(cfg.duplicateLogicCommand || "").trim()) {
  const cmd = String(cfg.duplicateLogicCommand);
  try {
    const out = execSync(cmd, { cwd: cfg.__root, encoding: "utf8", timeout: Number(cfg.duplicateLogicTimeoutMs) || 120000, stdio: ["ignore", "pipe", "pipe"] });
    cand = { status: "ran", items: parseDuplicateCandidates(out), reason: "" };
  } catch (e) {
    const why = String(e.stderr || e.message || "").trim().split("\n").filter(Boolean).pop() || `exit ${e.status}`;
    cand = { status: "skipped", items: [], reason: why };
  }
}

const litCount = files.reduce((n, f) => n + f.literals.length, 0);
// 판정 종류(SPEC-040) — "0건"이 무엇의 0건인지 밝힌다.
//   ① 볼 파일이 0개  → 아무것도 안 봤다(언어 불일치의 전형)
//   ② 언어 미선언인데 안 본 확장자가 남음 → 킷 기본(JS/TS)에 기댄 부분 판정이다. 전수가 아니다.
// ②를 JUDGED로 부르면 "이 저장소에 중복이 없다"는 문장이 되는데, 실제로는 일부만 본 것이다.
const skippedList = [...skippedExt.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e}×${n}`);
if (!matchedFiles) {
  verdict(VERDICT_KINDS.INERT, "판정 대상 파일 0개 — duplicateLiteralFileRegex가 이 프로젝트의 소스와 맞지 않는다");
} else if (!FILE_REGEX_DECLARED && skippedList.length) {
  verdict(VERDICT_KINDS.INERT, `언어 미선언 — 킷 기본(JS/TS) 패턴으로 ${matchedFiles}개만 봤고 ${skippedList.join(" ")}는 보지 않았다`
    + " · duplicateLiteralPatterns·duplicateLiteralFileRegex를 이 프로젝트 언어로 함께 선언하라");
} else {
  judged(findings.length);
}
console.log(`구현 중복 게이트(duplicateLogicPolicy=${POLICY}): 파일 ${files.length}개·리터럴 ${litCount}건(하한 ${MIN_LEN}자) — 중복 ${findings.length}건`
  + (Object.keys(allow).length ? ` · 면제 ${Object.keys(allow).length}건` : ""));

const tag = HARD ? "✗" : "⚠";
for (const f of findings.slice(0, CAP)) {
  const where = f.sites.map((s) => `${s.path}:${s.line}`).join(" · ");
  console.log(`  ${tag} 같은 규칙이 ${f.sites.length}곳에 있다 — /${f.literal}/ → ${where}`);
}
if (findings.length > CAP) console.log(`  ${tag} … 외 ${findings.length - CAP}건 (전체는 duplicateLogicListCap 상향 또는 게이트 단독 실행)`);

// 면제는 clean일 때도 보인다 — 조용한 '완료'가 되지 않게(다른 면제 항목과 같은 경계).
if (Object.keys(allow).length) {
  console.log(`· 정당한 중복으로 면제 ${Object.keys(allow).length}건(부채·리뷰 대상): ${Object.keys(allow).map((l) => `/${l}/`).join(", ")}`);
  const stale = staleAllowEntries(files, allow);
  if (stale.length) console.log(`  ⚠ 낡은 면제 ${stale.length}건 — 더 이상 중복이 아니다(지워라): ${stale.map((l) => `/${l}/`).join(", ")}`);
}

// 확률적 층 — 비차단. 상태를 반드시 한 줄로 말한다(침묵은 근거가 아니다).
if (cand.status === "off") console.log("· 확률적 층: duplicateLogicCommand 미선언 — 구조 중복(같은 본문·다른 이름)은 판정하지 않았다(미판정, 위반 없음이 아니다)");
else if (cand.status === "skipped") console.log(`· 확률적 층: skipped — ${cand.reason}(도구 실패를 '중복 없음'으로 읽지 않는다)`);
else if (!cand.items.length) console.log("· 확률적 층: 후보 0건");
else {
  console.log(`· 확률적 층 후보 ${cand.items.length}건(비차단 — 확률적 판정에는 차단력을 주지 않는다):`);
  for (const c of cand.items.slice(0, CAP)) console.log(`    ⚠ ${c.a} ↔ ${c.b}${c.note ? ` — ${c.note}` : ""}`);
}

if (findings.length && HARD) {
  console.error(`\n✗ duplicateLogicPolicy=hard: 같은 규칙이 두 곳에 구현돼 있다 — 하나로 통합하고 나머지는 그것을 호출하라.`);
  console.error(`  · 정말 무관한 중복이면 duplicateLogicAllow에 **사유와 함께** 등록하라(면제는 부채로 매 실행 표면화된다).`);
  console.error(`  · 실측 계기: 병렬 작업자들이 격리 지시를 성실히 따르며 각자 헬퍼를 만들어 같은 규칙이 세 갈래로 갈렸다 — 게이트 4종 전부 green이었다.`);
  process.exit(1);
}
if (!findings.length) console.log("구현 중복 게이트: OK — 결정적 층에서 중복 리터럴 0건.");
