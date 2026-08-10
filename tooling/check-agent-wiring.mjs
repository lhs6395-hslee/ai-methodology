#!/usr/bin/env node
// ─── 에이전트 배선 실재 게이트 (SPEC-051, R19) ───
// 오너 실측: "감시게이트 및 감시에이전트가 필요한데 — 즉 SDD에 의해 수행하는지 혼자 날뛰지
// 않는지 — 그게 동작을 하지 않아."
//
// R17(감시자 실재)은 커밋한 사람이 끌 수 없는 채널(CI)과 채택 영수증을 본다. 그런데 CI는
// **커밋 이후**에 돈다 — 에이전트가 스펙 없이 코드를 쓰고 있는 그 순간을 보는 층이 아니다.
// 그 순간을 보는 것은 에이전트측 훅(SessionStart·PreToolUse·PostToolUse)뿐인데, 그 배선은
// **어떤 축의 판정 대상도 아니었다.** 그래서 R17이 초록인 동안 감시 에이전트가 전무할 수 있었고,
// 실제로 킷 자신이 그 상태였다(`.claude/` 부재 — 이 층만 도그푸딩 0).
//
// **감시자가 있다와 감시자가 에이전트를 본다는 다른 사실이다.**
//
// 선언은 `tooling/harness/agent-hooks.list` 하나이고 설치기와 이 게이트가 같은 파일을 읽는다
// (SPEC-036에서 배운 것 — 목록이 둘이면 한쪽이 뒤처져도 아무도 모른다).
//
// agentWiringPolicy: off | advisory(기본) | hard(킷 자신).
import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import {
  parseAgentHookDecl, agentWiringFindings, mergeHookSettings,
  DEFAULT_AGENT_SETTINGS_FILE, DEFAULT_AGENT_HOOK_DECL, DEFAULT_AGENT_SCRIPT_DIR,
} from "./agent-wiring-lib.mjs";

import { armVerdict, verdict, judged, isMainEntry, VERDICT_KINDS } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const POLICY = String(cfg.agentWiringPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ agentWiringPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "agentWiringPolicy");
    console.log("에이전트 배선 게이트 — agentWiringPolicy:off (판정 안 함)"); return;
  }

  const abs = (rel) => join(ROOT, ...String(rel).split("/"));
  const declRel = String(cfg.agentHookDecl || DEFAULT_AGENT_HOOK_DECL);
  const declPath = abs(declRel);
  if (!existsSync(declPath)) {
    // 선언이 없으면 **무엇이 배선돼야 하는지 모른다** — 모르는 것을 위반으로 말하지 않는다.
    verdict(VERDICT_KINDS.INERT, `훅 선언 파일 없음 — ${declRel}`);
    console.log(`[안 봄(판정 입력 없음)] 에이전트 배선 게이트 — 훅 선언 파일이 없다(${declRel}).`
      + " 이 파일이 설치기와 게이트의 **단일 선언**이다 — 없으면 무엇이 배선돼야 하는지 알 수 없다."
      + " `sh scripts/sdd-init.sh`가 깔거나 킷 `tooling/harness/agent-hooks.list`를 복사하라.");
    return;
  }
  const decls = parseAgentHookDecl(readFileSync(declPath, "utf8"));
  if (!decls.length) {
    verdict(VERDICT_KINDS.INERT, "선언된 에이전트 훅 0건");
    console.log(`[안 봄(판정 입력 없음)] 에이전트 배선 게이트 — ${declRel}에 선언된 훅이 0건이다`
      + " — **0건은 '깨끗함'이 아니라 '볼 것이 없음'이다**.");
    return;
  }

  const settingsRel = String(cfg.agentSettingsFile || DEFAULT_AGENT_SETTINGS_FILE);
  const settingsPath = abs(settingsRel);
  let settings = null, parseError = "";
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); }
    catch { parseError = "설정 파일을 JSON으로 읽지 못했다"; }
  }

  const scriptDir = String(cfg.agentScriptDir || DEFAULT_AGENT_SCRIPT_DIR);
  // 실재 + **실행 가능**까지 본다 — 실행 권한 없는 스크립트는 배선돼 있어도 발동하지 않는다
  // (git 훅 축에서 이미 실측된 실패 모드다).
  const scriptExists = (name) => {
    const p = abs(`${scriptDir}/${name}`);
    if (!existsSync(p)) return false;
    try { accessSync(p, constants.R_OK); return true; } catch { return false; }
  };

  // ── 생성 모드 — 설치기가 쓸 병합 결과를 stdout으로 낸다(**쓰기는 설치기가 한다**).
  // 설치기가 JSON을 하드코딩하면 선언과 갈라지고, 실제로 그것이 이 결함의 한 원인이었다:
  // 하드코딩된 JSON이 사실상 정본이었고 어떤 검사도 그것과 대조되지 않았다. 이제 선언 하나에서
  // 설치·판정이 함께 나온다. 병합은 남의 훅을 보존하고 킷 훅만 갈아끼운다(재실행 idempotent).
  if (process.argv.includes("--emit-settings")) {
    const merged = mergeHookSettings(settings, decls, (script) => `sh ${scriptDir}/${script}`);
    verdict(VERDICT_KINDS.SKIPPED, "생성 모드(판정 아님) — 병합된 설정을 산출한다. 판정은 무인자 실행");
    process.stdout.write(JSON.stringify(merged, null, 2) + "\n");
    return;
  }

  const f = agentWiringFindings(decls, settings, scriptExists);
  const errors = [], warnings = [];
  const block = (msg) => (POLICY === "hard" ? errors : warnings).push(msg);

  if (parseError) {
    block(`${settingsRel}: ${parseError} — 에이전트가 이 파일을 읽지 못하면 훅이 하나도 발동하지 않는다`);
  } else if (f.settingsMissing) {
    block(`에이전트 설정 파일이 없다 — ${settingsRel}. 선언된 훅 ${decls.length}종이 **한 번도 발동한 적이 없다**는 뜻이다.`
      + " git 훅은 커밋 시점에 이미 작성된 코드를 보므로, 에이전트가 스펙 없이 코드를 쓰는 **그 순간**을 보는 층은 이것뿐이다."
      + " `sh scripts/sdd-init.sh`가 이 파일을 만든다(기존 hooks는 보존·병합)");
  }
  for (const d of f.missing) {
    block(`${d.event}${d.matcher ? `(${d.matcher})` : ""}에 \`${d.script}\`가 배선되지 않았다`
      + " — 그 이벤트에서 이 훅은 발동하지 않는다(선언만 있고 배선이 없으면 감시자는 없는 것과 같다)");
  }
  for (const d of f.narrowed) {
    block(`${d.event}의 \`${d.script}\` 매처가 좁다 — 도구 ${d.missingTools.join("·")}에서 발동하지 않는다`
      + `(선언: ${d.matcher}). 넓히는 것은 정상이지만 좁히면 그 도구가 감시 밖으로 나간다`);
  }
  for (const d of f.scriptMissing) {
    block(`\`${d.script}\`가 배선돼 있는데 ${scriptDir}/에 실재하지 않거나 읽을 수 없다`
      + " — 에이전트는 그 훅을 조용히 건너뛴다(존재는 실행이 아니다)");
  }

  judged(errors.length);
  const wiredCount = decls.length - f.missing.length;
  console.log(`에이전트 배선 게이트(agentWiringPolicy=${POLICY}): 선언 ${decls.length}종 · 배선 ${wiredCount}종`
    + ` · 매처 좁음 ${f.narrowed.length} · 스크립트 부재 ${f.scriptMissing.length} | 설정 ${settingsRel}`
    + (f.unchecked.length ? ` · 확인 못 함 ${f.unchecked.length}(통과 아님)` : ""));
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  // 3분류 계약(SPEC-054) — 차단하지 않지만 **초록에도 합산하지 않는다**(조용한 0건 금지).
  for (const u of f.unchecked) console.log(`  · \`${u.script}\` — ${u.why}(통과가 아니다: 부재로 단정하지 않는다)`);
  if (errors.length) {
    console.error(`\n✗ 감시 에이전트가 배선되지 않았다 ${errors.length}건:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error("\n→ `sh scripts/sdd-init.sh`(기존 hooks 보존 병합). 배선 실패는 조용히 넘어가지 않는다 — 설치기가 건수를 세고 0이면 실패로 말한다.");
    process.exit(1);
  }
  if (!warnings.length) {
    console.log(`  ✓ 선언된 에이전트 훅 ${decls.length}종이 모두 배선돼 있고 지목된 스크립트가 실재한다 — 감시자가 에이전트를 본다.`);
  }
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
