#!/usr/bin/env node
// ─── 가드 함수 우회 게이트 (SPEC-059, R26) ───
// "누가 이 엔티티를 소유하는가"(check-ownership)가 아니라 "이 상태를 쓰는 모든 표면이
// 지정된 가드 함수를 실제로 호출하는가"를 본다. 등록(`invariantGuards`)이 없으면 검사할
// 가드가 없다는 뜻이다 — 그 0건을 "우회 없음(초록)"으로 읽지 않는다(INERT).
//
// invariantGuardPolicy: off | advisory(기본) | hard.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./sdd-config.mjs";
import { validateInvariantGuards, guardMissingFindings, guardBypassFindings } from "./invariant-guard-lib.mjs";
import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const POLICY = String(cfg.invariantGuardPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ invariantGuardPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "invariantGuardPolicy");
    console.log("가드 함수 우회 게이트 — invariantGuardPolicy:off (판정 안 함)");
    return;
  }

  const guards = Array.isArray(cfg.invariantGuards) ? cfg.invariantGuards : [];
  if (!guards.length) {
    verdict(VERDICT_KINDS.INERT, "invariantGuards 미등록 — 검사할 가드가 없다");
    console.log("[안 봄(판정 입력 없음)] 가드 함수 우회 게이트 — invariantGuards가 비어 있다."
      + " '이 상태 전이는 반드시 이 함수를 거쳐야 한다'는 불변식이 있으면"
      + " `{ guard, guardFile, guardedWriteSurfaces: [...], guardedFieldPattern? }`로 등록하라.");
    return;
  }

  const cfgErrors = validateInvariantGuards(guards);
  if (cfgErrors.length) {
    judged(cfgErrors.length);
    console.log(`가드 함수 우회 게이트(invariantGuardPolicy=${POLICY}): 등록 ${guards.length}건`);
    for (const e of cfgErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  const readOrNull = (rel) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return null;
    try { return readFileSync(abs, "utf8"); } catch { return null; }
  };

  const errors = [], warnings = [];
  const block = (msg) => (POLICY === "hard" ? errors : warnings).push(msg);

  const missing = guardMissingFindings(guards, readOrNull);
  for (const m of missing) {
    block(`가드 "${m.guard}"(${m.guardFile}): ${m.reason} — 존재하지 않는 함수를 가드로 등록했다`);
  }

  const { findings, unchecked } = guardBypassFindings(guards, readOrNull);
  for (const f of findings) {
    block(`가드 "${f.guard}"가 ${f.surface}에서 우회된다 — ${f.reason}(참조 ${f.count}건).`
      + " 이 표면은 이 상태를 직접 쓰면서 가드를 거치지 않는다는 뜻이다. 가드를 호출하도록 고치거나,"
      + " 실제로 가드가 필요 없으면 guardedWriteSurfaces에서 이 표면을 빼라(침묵으로 남기지 않는다)");
  }

  judged(errors.length);
  console.log(`가드 함수 우회 게이트(invariantGuardPolicy=${POLICY}): 가드 ${guards.length}건`
    + (unchecked.length ? ` · 확인 못 함 ${unchecked.length}건(통과 아님)` : ""));
  for (const u of unchecked) console.log(`  · ${u.guard} ↔ ${u.surface} — ${u.reason}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length) {
    console.error(`\n✗ 가드가 우회되는 표면이 있다 ${errors.length}건:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  if (!warnings.length && !unchecked.length) console.log("  ✓ 등록된 모든 가드가 지목된 표면 전부에서 실제로 참조된다.");
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
