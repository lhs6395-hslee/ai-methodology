#!/usr/bin/env node
// ─── 소개 문서 동기 게이트 (SPEC-045, R15) ───
// 설명이 도구보다 늦으면 그 설명은 거짓이 된다. 새로 배우는 사람은 코드가 아니라 소개 문서로
// 방법론을 만나므로, 낡은 문서는 존재하지 않는 규칙 체계를 가르친다.
//
// 실측(이 게이트를 처음 걸었을 때): 규칙표에 R14가 생겼는데 소개 문서는 R13까지였고,
// 문서가 인용한 "게이트 18종"은 실제 19종이 된 뒤에도 그대로였다. 둘 다 아무 게이트도 안 잡았다.
//
// introDocPolicy: off | advisory | hard(킷 기본).  introDocs 미선언이면 INERT.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot, isSpecMdName } from "./sdd-config.mjs";
import { ruleIdsOf, missingRuleIds, citedCounts, countMismatches, companionMissing } from "./intro-doc-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const POLICY = String(cfg.introDocPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ introDocPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "introDocPolicy");
    console.log("소개 문서 게이트 — introDocPolicy:off (판정 안 함)"); return;
  }
  const docs = (cfg.introDocs || []).filter(Boolean);
  const ruleSource = String(cfg.introDocRuleSource || "HARNESS.md");
  if (!docs.length) {
    verdict(VERDICT_KINDS.INERT, "introDocs 미선언 — 대조할 소개 문서가 없다");
    console.log("소개 문서 게이트 — **introDocs 미선언: 판정하지 않는다**."
      + " 방법론을 설명하는 문서(HTML·MD)를 선언하면 ①규칙표의 규칙 ID가 그 문서에 다 있는지"
      + " ②문서가 `data-sdd-count`로 올린 숫자가 실제와 맞는지 ③규칙표를 고친 커밋에 그 문서가 함께 있는지를 본다.");
    return;
  }
  const missingDocs = docs.filter((d) => !existsSync(join(ROOT, d)));
  if (missingDocs.length) {
    // 선언했는데 없는 문서는 **판정 실패**다 — 없는 것을 "다 맞다"로 세면 선언이 무의미해진다.
    judged(missingDocs.length);
    console.log(`소개 문서 게이트(introDocPolicy=${POLICY}): 문서 ${docs.length}건 선언`);
    for (const d of missingDocs) console.error(`  ✗ 선언된 소개 문서 없음: ${d} — 경로 오타이거나 삭제됨(조용한 스킵 금지)`);
    process.exit(1);
  }
  const srcPath = join(ROOT, ruleSource);
  if (!existsSync(srcPath)) {
    verdict(VERDICT_KINDS.INERT, `규칙표 소스 없음 — ${ruleSource}`);
    console.log(`소개 문서 게이트 — 규칙표 소스 \`${ruleSource}\`가 없어 대조할 축이 없다(introDocRuleSource로 지정).`);
    return;
  }
  const docTexts = docs.map((d) => readFileSync(join(ROOT, d), "utf8"));
  const ruleIds = ruleIdsOf(readFileSync(srcPath, "utf8"));
  const errors = [], warnings = [];
  const block = (msg) => (POLICY === "hard" ? errors : warnings).push(msg);

  // ① 규칙 ID 커버리지 — 신설 규칙이 소개 문서에 안 실린 것.
  const missIds = missingRuleIds(ruleIds, docTexts);
  for (const id of missIds) {
    block(`규칙 ${id}가 소개 문서 어디에도 없다 — 규칙표(${ruleSource})는 이 규칙을 선언하는데 설명 문서는 모른다.`
      + ` 새로 배우는 사람은 이 문서로 방법론을 만난다: ${docs.join(" 또는 ")}에 ${id}를 설명하라`);
  }

  // ② 인용 수치 검산 — 문서가 자원해서 올린 숫자만 본다.
  const actuals = actualCounts(cfg, ROOT, ruleIds);
  let citedTotal = 0;
  for (const [i, text] of docTexts.entries()) {
    const cites = citedCounts(text);
    citedTotal += cites.length;
    for (const m of countMismatches(cites, actuals)) {
      if (m.actual === null) {
        block(`${docs[i]}: 미지원 인용 키 "${m.key}" — 지원 키는 ${Object.keys(actuals).join("·")}. 오타난 키는 검산되지 않는다(조용히 "확인됨"으로 읽히는 자리)`);
      } else {
        block(`${docs[i]}: 인용 수치 "${m.key}"가 ${m.cited}인데 실제는 ${m.actual} — 문서가 낡았다(숫자는 가장 먼저 낡고 가장 늦게 들킨다)`);
      }
    }
  }

  // ③ 동반 갱신 — 규칙표를 고쳤으면 설명도 같이 고친다.
  let changed = null;
  try {
    const out = execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const staged = out.split("\n").map((x) => x.trim()).filter(Boolean);
    if (staged.length) changed = new Set(staged);
  } catch { /* git 없음·커밋 밖 실행 — 모르는 것을 위반으로 말하지 않는다 */ }
  if (companionMissing(changed, ruleSource, docs)) {
    block(`규칙표(${ruleSource})가 이 changeset에서 바뀌었는데 소개 문서는 그대로다`
      + ` — 규칙이 바뀌면 그 규칙을 설명하는 문서도 같은 커밋에서 바뀌어야 한다(${docs.join(" 또는 ")})`);
  }

  judged(errors.length);
  console.log(`소개 문서 게이트(introDocPolicy=${POLICY}): 문서 ${docs.length}건 · 규칙 ${ruleIds.length}종 대조 · 인용 수치 ${citedTotal}건 검산`
    + (changed ? " · 동반 갱신 판정함" : " · 동반 갱신은 판정 안 함(스테이징 집합 없음)"));
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length) {
    console.error(`\n✗ 소개 문서가 도구보다 늦었다 ${errors.length}건:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  if (!warnings.length) console.log("  ✓ 규칙 ID 누락 0건 · 인용 수치 불일치 0건 — 설명이 도구를 따라잡고 있다.");
}

// 검산 가능한 실제 값. 여기 없는 키를 문서가 인용하면 ②가 미지원 키로 잡는다.
function actualCounts(cfg, ROOT, ruleIds) {
  const out = { rules: ruleIds.length };
  // 게이트 종수 — 스윕 규칙표에 등재된 게이트 파일의 유일 개수가 정본이다.
  // **경로를 고정하지 않는다**: 킷 저장소는 `tooling/`, 소비 프로젝트는 `sdd-init.sh`가 `scripts/`에
  // 깔고, 프로젝트가 다른 곳에 둘 수도 있다. 고정하면 소비 사이트에서 이 키가 조용히 미지원이 되고,
  // 문서가 인용한 숫자는 "오타난 키"로 오진된다(훅 목록 탐색과 같은 후보 해석 방식, SPEC-036 선례).
  const sync = [cfg.syncRulesFile, "tooling/sdd-sync.mjs", "scripts/sdd-sync.mjs", "sdd-sync.mjs"]
    .filter(Boolean).map((rel) => join(ROOT, ...String(rel).split("/"))).find((abs) => existsSync(abs));
  if (sync) {
    const src = readFileSync(sync, "utf8");
    const i = src.indexOf("const RULES = [");
    if (i >= 0) {
      const blk = src.slice(i, src.indexOf("\n];", i));
      out.gates = new Set([...blk.matchAll(/"((?:check|gen)-[a-z-]+\.mjs)"/g)].map((m) => m[1])).size;
    }
  }
  // 스윕 규칙표를 못 찾으면 `gates`는 **미지원 키로 남는다** — 0으로 세면 문서의 인용이
  // "실제는 0"이라는 거짓 판정을 받는다. 모르는 것을 숫자로 말하지 않는다.
  // 스펙 종수 — specDir의 <PREFIX>-NNN.md 개수.
  try {
    out.specs = readdirSync(resolveFromRoot(cfg, cfg.specDir)).filter(isSpecMdName).length;
  } catch { /* specDir 없음 — specs 키 미지원으로 남는다 */ }
  return out;
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
