#!/usr/bin/env node
// ─── 명세 자기모순 감사 게이트 (SPEC-052, R20) ───
// 오너 지시: "명세가 충돌되는 것도 없도록 방법론이 잘 구성되어야 한다 — spec 1은 A를 해라,
// spec 2는 A를 하지 말아라. 애초에 이런 구멍도 없어야 한다."
//
// 이 게이트는 **감사의 결정적 절반**이다. 감시 게이트·감시 에이전트는 "대화 세션 에이전트가
// 명세대로 하는가"를 보고, 감사는 "명세 코퍼스가 스스로와 정합한가"를 본다 — 층이 다르다.
// 그리고 **감사자는 감시 대상이 될 수 없다**: 급할 때 명세를 무시하는 에이전트에게 "명세 충돌도
// 같이 봐 줘"를 맡기면 그 점검이 가장 먼저 생략된다(고발 장치가 고발 대상의 협조를 요구하면
// 그것은 강제가 아니다). 그래서 별도 실행이고, 결정적 절반은 게이트가 차단한다.
//
// specConflictPolicy: off | advisory | hard(킷 자신).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { isFrDeclLine } from "./key-anchor-lib.mjs";
import {
  collectDirectives, specConflicts, formatConflict,
  DEFAULT_MIN_TOKENS, DEFAULT_MAX_DOC_FREQ,
} from "./spec-conflict-lib.mjs";

import { armVerdict, verdict, judged, isMainEntry, VERDICT_KINDS } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.specConflictPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ specConflictPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "specConflictPolicy");
    console.log("명세 모순 감사 게이트 — specConflictPolicy:off (판정 안 함)"); return;
  }

  const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
  let names = [];
  try { names = readdirSync(SPEC_DIR).sort().filter((n) => /\.md$/.test(n)); } catch { names = []; }
  if (!names.length) {
    verdict(VERDICT_KINDS.INERT, "스펙 0건 — 대조할 코퍼스가 없다");
    console.log("[안 봄(판정 입력 없음)] 명세 모순 감사 게이트 — 스펙이 0건이다"
      + " — **0건은 '깨끗함'이 아니라 '볼 것이 없음'이다**."); return;
  }
  const specs = [];
  for (const n of names) {
    let text; try { text = readFileSync(join(SPEC_DIR, n), "utf8"); } catch { continue; }
    specs.push({ id: (text.match(cfg.__specIdRe) || [n.replace(/\.md$/, "")])[0], file: `${cfg.specDir}/${n}`, text });
  }

  const reqAlt = cfg.__reqAlt || "FR";
  const opts = {
    minTokens: cfg.specConflictMinTokens ?? DEFAULT_MIN_TOKENS,
    maxDocFreq: cfg.specConflictMaxDocFreq ?? DEFAULT_MAX_DOC_FREQ,
    stopwords: cfg.specConflictStopwords || null,
    negationMarkers: cfg.specConflictNegationMarkers || null,
    clauseBreaks: cfg.specConflictClauseBreaks || null,
  };
  const directives = collectDirectives(specs, (l) => isFrDeclLine(l, reqAlt), opts);
  if (!directives.length) {
    // 지시가 0건 — SHALL 문법을 쓰지 않는 코퍼스다. 0건을 깨끗함으로 읽지 않는다.
    verdict(VERDICT_KINDS.INERT, "SHALL 지시 0건 — EARS 문법이 없어 극성을 판정할 수 없다");
    console.log(`[안 봄(판정 입력 없음)] 명세 모순 감사 게이트 — 스펙 ${specs.length}건에서 SHALL 지시를 찾지 못했다.`
      + " 이 축은 EARS 극성(SHALL ↔ SHALL NOT)으로 판정하므로 그 문법이 없으면 **판정하지 않는다**"
      + "(어휘가 다르면 `specConflictNegationMarkers`를 갈아끼워라 — 면제가 아니라 어휘 교체다).");
    return;
  }

  const { conflicts, sameSpec } = specConflicts(directives, opts);
  const total = conflicts.length + sameSpec.length;
  judged(POLICY === "hard" ? total : 0);
  console.log(`명세 모순 감사 게이트(specConflictPolicy=${POLICY}): 스펙 ${specs.length}건 · 지시 ${directives.length}건 대조`
    + ` — 교차 스펙 모순 ${conflicts.length} · 한 스펙 내 모순 ${sameSpec.length}`);

  const tag = POLICY === "hard" ? "✗" : "⚠";
  const sink = POLICY === "hard" ? (s) => console.error(s) : (s) => console.log(s);
  if (total) {
    if (POLICY === "hard") console.error(`\n✗ 명세가 스스로와 모순이다 ${total}건 — 급할 때 에이전트는 자기가 먼저 본 쪽을 따른다:`);
    for (const p of sameSpec) {
      const [a, b, why] = formatConflict(p);
      sink(`  ${tag} [한 스펙 내] ${a}`);
      sink(`     ${" ".repeat(11)}${b}`);
      sink(`     → ${why}`);
    }
    for (const p of conflicts) {
      const [a, b, why] = formatConflict(p);
      sink(`  ${tag} [교차 스펙] ${a}`);
      sink(`     ${" ".repeat(11)}${b}`);
      sink(`     → ${why}`);
    }
    if (POLICY === "hard") {
      console.error("\n→ 해소는 **어느 지시가 정본인지 결정해 한쪽을 고치는 것**뿐이다(면제 경로 없음)."
        + " 실측: 명세 안에 반대 방향 지시가 공존한 탓에 소유자가 여러 세션에 걸쳐 금지한 경로가 재발했다.");
      process.exit(1);
    }
    return;
  }
  console.log(`  ✓ 상반된 지시 0건 — 같은 대상에 SHALL과 SHALL NOT이 공존하지 않는다.`);
  console.log("  · 이 축은 감사의 **결정적 절반**이다 — \"같은 기능에 1은 A, 2는 B\" 같은 의미 충돌은"
    + " 확률적 판정이라 차단력을 주지 않는다(그 층은 쌍을 전수 열거해 사람·LLM이 판정한다).");
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
