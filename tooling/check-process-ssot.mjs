#!/usr/bin/env node
// ─── 순차 프로세스 SSOT 게이트 (SPEC-047, R16) ───
// 여러 스펙에 걸친 순차 사슬은 아무도 소유하지 않는다 — 그래서 조각이 흩어지고, 어느 문서를
// 읽어도 일부만 보이고, 세션마다 flow를 재구성하며 매번 다른 곳이 빠진다.
//
// 실측 제보(사례 5): 8단계 close-out 사슬의 조각이 6개 문서에 흩어져 전 구간 문서가 없었고,
// 그 흩어짐이 코드에 그대로 나타났다 — 교차검증 함수가 상대 기록이 없으면 통과했고, 양쪽 판정
// 기록이 만날 저장소가 아예 없었다. 그 교차검증은 단 한 번도 비교를 수행한 적이 없다.
//
// processSsotPolicy: off | advisory(기본) | hard.  processes 미선언이면 INERT.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, walkFiles, isSpecMdName } from "./sdd-config.mjs";
import { compileGlob, stripInlineComment } from "./spec-sync-lib.mjs";
import { parseSection } from "./ownership-keys.mjs";
import {
  validateProcesses, stagesOf, ssotMissingStages, fragmentFindings,
  statelessStageFindings, unownedStateFindings, DEFAULT_PROCESS_DOC_REGEX,
  invariantsOf, validateInvariants, ssotMissingInvariants,
  unenforcedInvariantFindings, staleEnforcementMentionFindings,
} from "./process-ssot-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const POLICY = String(cfg.processSsotPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ processSsotPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "processSsotPolicy");
    console.log("순차 프로세스 게이트 — processSsotPolicy:off (판정 안 함)"); return;
  }
  const processes = cfg.processes && typeof cfg.processes === "object" && !Array.isArray(cfg.processes) ? cfg.processes : {};
  const names = Object.keys(processes).sort();
  if (!names.length) {
    // 순차 사슬이 없는 프로젝트에 사슬을 요구하면 거짓 요구다 — 선언이 판정의 입구다.
    verdict(VERDICT_KINDS.INERT, "processes 미선언 — 판정할 순차 사슬이 없다");
    console.log("순차 프로세스 게이트 — **processes 미선언: 판정하지 않는다**."
      + " 여러 스펙에 걸친 순차 사슬(배포 close-out·승인 흐름 등)이 있으면 `processes`에"
      + " `{ ssot: <전 구간 문서>, stages: [<단계>…] }`로 선언하라. 그러면 ①전 구간이 그 문서 하나에 있는지"
      + " ②조각을 든 다른 문서가 그 문서를 참조하는지 ③비교·합의 단계가 기록이 만날 저장소를 선언하고"
      + " 그 저장소가 소유되는지를 본다.");
    return;
  }
  const cfgErrors = validateProcesses(processes);
  // 불변식 config 문법도 같은 자리에서 함께 문법화한다(정의되지 않은 형태를 조용히 통과시키지
  // 않는다) — 원본(raw) 배열로 검사한다: invariantsOf()는 이름 빈 항목을 조용히 걸러내므로
  // 그 필터를 통과한 값으로 검사하면 "이름 없음" 오류를 영영 못 잡는다.
  for (const name of names) {
    cfgErrors.push(...validateInvariants((processes[name] || {}).invariants || []).map((e) => `processes["${name}"].${e}`));
  }
  if (cfgErrors.length) {
    judged(cfgErrors.length);
    console.log(`순차 프로세스 게이트(processSsotPolicy=${POLICY}): 프로세스 ${names.length}종 선언`);
    for (const e of cfgErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  // 소유 판정 입력 — 스펙들의 Files 글롭(저장소 소유 여부).
  const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
  const IGNORE = new Set(cfg.ignoreDirs);
  const specNames = (() => { try { return readdirSync(SPEC_DIR).filter(isSpecMdName).sort(); } catch { return []; } })();
  const ownedGlobs = [];
  const specTexts = [];
  for (const n of specNames) {
    const text = readFileSync(join(SPEC_DIR, n), "utf8");
    specTexts.push({ path: `${cfg.specDir}/${n}`, text });
    for (const g of parseSection(text, "Ownership", ["Files"]).Files.map(stripInlineComment).filter(Boolean)) {
      ownedGlobs.push(compileGlob(g));
    }
  }
  const isOwned = (p) => ownedGlobs.some((re) => re.test(String(p)));

  // 조각 보유 후보 문서 — 스펙 + 산문 문서. 코드는 대상이 아니다(사슬은 문서가 소유한다).
  // 확장자를 게이트에 박지 않는다 — 프로젝트가 `.rst`·`.adoc`으로 문서를 쓰면 그 사슬이 통째로
  // 안 보이게 된다(킷 기본은 선언하고, 프로젝트는 `processDocRegex`로 교체한다).
  const PROSE = new RegExp(String(cfg.processDocRegex || DEFAULT_PROCESS_DOC_REGEX));
  const docs = [...specTexts];
  for (const rel of walkFiles(ROOT, IGNORE, "", [])) {
    if (!PROSE.test(rel) || docs.some((d) => d.path === rel)) continue;
    try { docs.push({ path: rel, text: readFileSync(join(ROOT, rel), "utf8") }); } catch { /* 못 읽은 문서는 없는 것으로 본다 */ }
  }

  const errors = [], warnings = [];
  const block = (msg) => (POLICY === "hard" ? errors : warnings).push(msg);
  let stageTotal = 0, stateTotal = 0, invariantTotal = 0, invariantEnforcedTotal = 0;

  for (const name of names) {
    const proc = processes[name];
    const stages = stagesOf(proc);
    const ssotPath = String(proc.ssot).trim();
    stageTotal += stages.length;
    stateTotal += stages.filter((s) => s.state).length;

    const ssotAbs = join(ROOT, ssotPath);
    if (!existsSync(ssotAbs)) {
      block(`프로세스 "${name}": SSOT 문서가 없다 — ${ssotPath}. 선언했는데 없는 문서는 소유자가 없는 것과 같다`);
      continue;
    }
    const ssotText = readFileSync(ssotAbs, "utf8");

    // ① 전 구간 소유
    const miss = ssotMissingStages(ssotText, stages);
    if (miss.length) {
      block(`프로세스 "${name}": SSOT(${ssotPath})가 전 구간을 담지 않는다 — 빠진 단계 ${miss.length}건: ${miss.join(" · ")}.`
        + ` 어느 문서를 읽어도 사슬의 일부만 보이면 세션마다 flow를 재구성하고 매번 다른 곳이 빠진다`);
    }
    // ① 조각 보유자는 전체를 가리켜야 한다
    const frags = fragmentFindings(docs, stages, ssotPath, Number(cfg.processFragmentMinStages) || 2);
    for (const f of frags.slice(0, Number(cfg.processSsotListCap) || 12)) {
      block(`프로세스 "${name}": ${f.path}가 단계 ${f.stages.length}건(${f.stages.slice(0, 3).join(" · ")}${f.stages.length > 3 ? " …" : ""})을 담았는데`
        + ` SSOT(${ssotPath})를 참조하지 않는다 — 조각을 든 문서는 전체를 가리켜야 한다(참조는 경로를 적으면 성립한다)`);
    }
    if (frags.length > (Number(cfg.processSsotListCap) || 12)) {
      block(`프로세스 "${name}": 조각 보유 문서 … 외 ${frags.length - (Number(cfg.processSsotListCap) || 12)}건 (processSsotListCap 상향으로 확인)`);
    }

    // ② 비교·합의 단계는 기록이 만날 저장소를 선언한다
    for (const st of statelessStageFindings(stages, cfg.statefulStageMarkers)) {
      block(`프로세스 "${name}": 단계 "${st}"는 실행 사이의 비교·합의를 요구하는데 **기록이 만날 저장소를 선언하지 않았다**`
        + ` — 비교는 두 기록이 같은 자리에서 만나야 성립한다. 저장소가 없으면 그 비교는 "상대 기록 없음 → 통과"로 조용히 무행동이 된다`
        + `(실측: 로컬은 작업 디렉터리, 클러스터 Job은 볼륨 없는 파드의 /tmp였다). stages 항목을 { name, state: <경로> }로 선언하라`);
    }
    // ② 선언된 저장소는 소유돼야 한다
    for (const u of unownedStateFindings(stages, isOwned)) {
      block(`프로세스 "${name}": 단계 "${u.stage}"의 저장소 "${u.state}"를 **어느 스펙도 소유하지 않는다**`
        + ` — 인프라 산출물인데 스펙 밖에 있으면 그쪽 리뷰에서도 빠진다(실측: 저장소 요구가 어느 FR에도 없고 코드 주석에만 있었다).`
        + ` 어느 스펙의 Ownership Files에 편입하라`);
    }

    // ④ 불변식 강제 여부 — 사슬(stages)과 별개로 SSOT가 선언하는 규칙. 미선언(invariants
    // 생략)이면 완전히 건너뛴다(하위호환 — 모든 프로세스가 불변식을 나눠 가질 필요는 없다).
    const invariants = invariantsOf(proc);
    if (invariants.length) {
      invariantTotal += invariants.length;
      invariantEnforcedTotal += invariants.filter((iv) => iv.enforcement).length;
      const missInv = ssotMissingInvariants(ssotText, invariants);
      if (missInv.length) {
        block(`프로세스 "${name}": SSOT(${ssotPath})가 선언된 불변식을 담지 않는다 — 빠진 불변식 ${missInv.length}건: ${missInv.join(" · ")}.`
          + ` 불변식 이름도 단계처럼 문서에 문자 그대로 있어야 한다`);
      }
      for (const u of unenforcedInvariantFindings(invariants, (p) => existsSync(join(ROOT, p)))) {
        block(`프로세스 "${name}": 불변식 "${u.name}"이 "${u.enforcement}"로 강제된다고 선언했는데 그 파일이 저장소에 없다`
          + ` — 강제한다는 주장이 거짓이다. 파일을 만들거나 enforcement를 null로 바꿔 "명시적으로 미강제"라고 선언하라`);
      }
      for (const s of staleEnforcementMentionFindings(ssotText, invariants)) {
        block(`프로세스 "${name}": 불변식 "${s.name}"은 config에 "${s.enforcement}"로 강제된다고 돼 있는데 SSOT(${ssotPath}) 본문은`
          + ` 그 사실을 말하지 않는다 — 문서가 여전히 "임시 규칙"이라고만 말하는 동안 코드는 이미 강제하고 있었던 드리프트와 같은 모양이다.`
          + ` 문서에 강제 스크립트 경로를 언급하도록 갱신하라`);
      }
    }
  }

  judged(errors.length);
  console.log(`순차 프로세스 게이트(processSsotPolicy=${POLICY}): 프로세스 ${names.length}종 · 단계 ${stageTotal}건`
    + ` · 저장소 선언 ${stateTotal}건 · 문서 ${docs.length}건 대조(${PROSE.source})`
    + ` · 불변식 ${invariantTotal}건(강제 ${invariantEnforcedTotal}건 · 명시적 미강제 ${invariantTotal - invariantEnforcedTotal}건)`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length) {
    console.error(`\n✗ 순차 사슬이 흩어져 있다 ${errors.length}건:`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  if (!warnings.length) console.log("  ✓ 전 구간이 SSOT에 있고 조각 보유 문서가 그것을 가리키며, 비교 단계의 저장소는 선언·소유됐고, 불변식은 강제되거나 명시적으로 미강제다.");
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
