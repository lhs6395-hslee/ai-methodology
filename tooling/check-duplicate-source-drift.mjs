#!/usr/bin/env node
// ─── 훅/게이트 사본 드리프트 게이트 (SPEC-059, R26) ───
// "배선돼 있는가"(SPEC-036)가 아니라 "같은 논리적 규칙을 표현한다고 주장하는 두 파일이
// 실제로 같은 게이트를 부르는가"를 본다. 등록(`duplicateSourcePairs`)이 없으면 검사할
// 사본 쌍이 없다는 뜻이다 — 그 0건을 "드리프트 없음(초록)"으로 읽지 않는다(INERT).
//
// duplicateSourceDriftPolicy: off | advisory(기본) | hard.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import { validateDuplicateSourcePairs, driftFindings } from "./duplicate-source-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const POLICY = String(cfg.duplicateSourceDriftPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ duplicateSourceDriftPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "duplicateSourceDriftPolicy");
    console.log("훅/게이트 사본 드리프트 게이트 — duplicateSourceDriftPolicy:off (판정 안 함)");
    return;
  }

  const pairs = Array.isArray(cfg.duplicateSourcePairs) ? cfg.duplicateSourcePairs : [];
  if (!pairs.length) {
    // 등록이 없으면 검사할 사본 쌍이 없다 — 이 0건은 "드리프트 없음"이 아니라 "볼 것이 없음"이다.
    verdict(VERDICT_KINDS.INERT, "duplicateSourcePairs 미등록 — 검사할 사본 쌍이 없다");
    console.log("[안 봄(판정 입력 없음)] 훅/게이트 사본 드리프트 게이트 — duplicateSourcePairs가 비어 있다."
      + " 같은 논리적 훅·게이트를 표현한다고 주장하는 파일 쌍이 있으면"
      + " `{ a: <경로>, b: <경로>, reason: <왜 둘인가> }`로 등록하라.");
    return;
  }

  const cfgErrors = validateDuplicateSourcePairs(pairs);
  if (cfgErrors.length) {
    judged(cfgErrors.length);
    console.log(`훅/게이트 사본 드리프트 게이트(duplicateSourceDriftPolicy=${POLICY}): 등록 ${pairs.length}쌍`);
    for (const e of cfgErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  const errors = [], warnings = [], unchecked = [];
  const block = (msg) => (POLICY === "hard" ? errors : warnings).push(msg);

  for (const { a, b, reason } of pairs) {
    const absA = join(ROOT, a), absB = join(ROOT, b);
    if (!existsSync(absA) || !existsSync(absB)) {
      unchecked.push(`${a} ↔ ${b} — 한쪽 이상 파일 부재(${!existsSync(absA) ? a : b} 없음), 대조 못 함`);
      continue;
    }
    const { onlyInA, onlyInB } = driftFindings(readFileSync(absA, "utf8"), readFileSync(absB, "utf8"));
    if (onlyInA.length || onlyInB.length) {
      const parts = [];
      if (onlyInA.length) parts.push(`${a}에만 있음: ${onlyInA.join(", ")}`);
      if (onlyInB.length) parts.push(`${b}에만 있음: ${onlyInB.join(", ")}`);
      block(`${a} ↔ ${b}(${reason}): 부르는 게이트 목록이 갈렸다 — ${parts.join(" / ")}.`
        + " 어느 쪽이 최신인지는 이 게이트가 정하지 않는다 — 둘을 맞추거나, 한쪽이 다른 쪽을 생성하도록 리팩터하라");
    }
  }

  judged(errors.length);
  console.log(`훅/게이트 사본 드리프트 게이트(duplicateSourceDriftPolicy=${POLICY}): 등록 ${pairs.length}쌍 대조`
    + (unchecked.length ? ` · 확인 못 함 ${unchecked.length}건(통과 아님)` : ""));
  for (const u of unchecked) console.log(`  · ${u}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length) {
    console.error(`\n✗ 훅/게이트 사본이 갈라져 있다 ${errors.length}건:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  if (!warnings.length && !unchecked.length) console.log("  ✓ 등록된 모든 사본 쌍이 같은 게이트 목록을 부른다.");
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
