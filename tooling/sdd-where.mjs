#!/usr/bin/env node
// ─── sdd-where — "이 변경은 어느 FR인가" 조회기 (SPEC-062) ───
//
//   사용: node scripts/sdd-where.mjs <파일경로>          # 파일로 찾기
//         node scripts/sdd-where.mjs --keyword "예산 승인"  # 도메인 단어로 찾기(파일이 아직 없을 때)
//         node scripts/sdd-where.mjs <파일경로> --json     # 기계 소비(에이전트·훅)
//
// 왜 있나(오너 제보): spec-first는 이미 편집 시점에 발화하는데 그 출력이 **스펙 ID까지만** 좁혀서,
// 어느 FR인지는 매번 스펙 통독으로 찾아야 했다. FR 상한이 50인 프로젝트에서 변경 1건마다 그 비용을
// 낸다("뭐 하나 바꾸는데 너무 오래 걸린다"). 이 스크립트는 그 통독을 **명령 한 번**으로 바꾼다.
//
// ⚠ 이것은 **판정기가 아니라 조회기**다(SPEC-040 verdict는 SKIPPED로 선언한다 — 게이트 스윕의
// 판정 집계에 섞이면 "조회했다"가 "판정했다"로 오독된다). 그래서 exit code로 옳고 그름을 말하지
// 않는다: 후보를 찾았든 못 찾았든 exit 0이고, **못 좁혔으면 못 좁혔다고 출력한다**(거짓 확신 금지).
// 설계: SPEC-062.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, specMdFiles, walkFiles, isTestFile } from "./sdd-config.mjs";
import { compileGlob, parseFilesLine, buildSectionMap } from "./spec-sync-lib.mjs";
import { frDeclLines, locateFrs, locateSpecsByKeyword, formatCandidate } from "./fr-locator-lib.mjs";

import { armVerdict, verdict, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();

const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const kwIdx = ARGS.findIndex((a) => a === "--keyword" || a === "-k");
const KEYWORD = kwIdx !== -1 ? ARGS[kwIdx + 1] : null;
// ⚠ `--keyword`가 없으면 제외할 인덱스도 없다 — `kwIdx + 1`을 그대로 쓰면 -1+1=0이 되어
// **첫 인자가 조용히 버려진다**(도그푸딩 첫 실행에서 즉시 잡힌 결함).
const kwValueIdx = kwIdx === -1 ? -1 : kwIdx + 1;
const positional = ARGS.filter((a, i) => !a.startsWith("-") && i !== kwValueIdx);
const TARGET = positional[0] || null;

if (!TARGET && !KEYWORD) {
  console.error("사용: node scripts/sdd-where.mjs <파일경로> | --keyword <도메인 단어> [--json]");
  process.exit(1);
}

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const rel = TARGET
  ? String(TARGET).replace(/^\.\//, "").replace(new RegExp(`^${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "")
  : null;

// ── 스펙 로드 + 소유 판정(Files glob) — 파일 모드면 소유 스펙으로 범위를 좁히고, 소유가 없거나
// 키워드 모드면 **전 스펙**을 본다(범위를 좁힐 근거가 없을 때 조용히 0건을 내지 않는다).
const specs = [];
for (const abs of specMdFiles(SPEC_DIR)) {
  let text; try { text = readFileSync(abs, "utf8"); } catch { continue; }
  const name = abs.slice(abs.lastIndexOf("/") + 1);
  specs.push({
    specId: (text.match(cfg.__specIdRe) || [name])[0],
    path: `${cfg.specDir}/${name}`,
    text,
    globs: parseFilesLine(text),
  });
}
const owners = rel
  ? specs.filter((s) => s.globs.some((g) => { try { return compileGlob(g).test(rel); } catch { return false; } }))
  : [];
const scope = owners.length ? owners : specs;

// ── FR 선언 라인 수집(범위 내 전부) — 후보를 못 좁혔을 때 "몇 개 중 몇 개"를 말하기 위해 총수도 센다.
const frUnits = [];
for (const s of scope) {
  for (const { frId, line } of frDeclLines(s.text, cfg.__frDeclRe, cfg.__reqAlt)) {
    frUnits.push({ specId: s.specId, frId, line });
  }
}

// ── 근거 재료 수집(IO는 여기서, 판정은 순수 코어에서).
let pathText = "";
if (rel) { try { pathText = readFileSync(join(ROOT, rel), "utf8"); } catch { /* 새 파일일 수 있다 — 침묵 */ } }

// covers 근거: **이 파일을 참조하는 테스트**의 `@covers` 태그. 테스트가 스스로 적어둔 결속이라
// 가장 강한 근거이고, 어느 테스트가 그 말을 했는지까지 출처로 남긴다.
// **태깅 폭**(그 테스트가 한 스펙에서 태깅한 FR 수)도 함께 센다 — 폭이 넓은 태그는 "이 FR"이
// 아니라 "이 스펙 전반"을 뜻하므로 코어가 감쇠한다(SPEC-062 coversScore).
const coversBy = new Map();
if (rel) {
  const IGNORE = new Set(cfg.ignoreDirs);
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const baseRe = new RegExp(`(^|[^A-Za-z0-9_$])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_$]|$)`);
  const raw = []; // [{file, specId, frId}]
  for (const f of walkFiles(ROOT, IGNORE)) {
    if (!isTestFile(f, cfg)) continue;
    let t; try { t = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    if (!baseRe.test(t)) continue;                       // 이 파일을 언급하지 않는 테스트는 근거 아님
    const seen = new Set();
    for (const m of t.matchAll(cfg.__coversRe)) {
      const key = `${m[1]}/${m[2]}`;
      if (seen.has(key)) continue;                       // 같은 파일이 같은 FR을 재태깅해도 1건
      seen.add(key);
      raw.push({ file: f, specId: m[1], frId: m[2] });
    }
  }
  const breadth = new Map(); // `${file}|${specId}` → 그 파일이 그 스펙에서 태깅한 FR 수
  for (const r of raw) {
    const k = `${r.file}|${r.specId}`;
    breadth.set(k, (breadth.get(k) || 0) + 1);
  }
  for (const r of raw) {
    const key = `${r.specId}/${r.frId}`;
    if (!coversBy.has(key)) coversBy.set(key, []);
    coversBy.get(key).push({ file: r.file, breadth: breadth.get(`${r.file}|${r.specId}`) || 1 });
  }
}

const candidates = locateFrs(frUnits, {
  path: rel,
  pathText,
  coversBy: coversBy.size ? coversBy : null,
  keyword: KEYWORD,
  isTestName: (n) => isTestFile(n, cfg),
  moduleExtensions: cfg.implModuleExtensions,
});

// 키워드 모드는 **스펙 단위 매치도** 함께 낸다 — FR 정본이 영어라 한글 도메인 단어는 FR 라인이
// 아니라 User Story·Edge Cases·Change Log에 산다(SPEC-062 locateSpecsByKeyword 주석의 실측).
const specHits = KEYWORD
  ? locateSpecsByKeyword(specs, KEYWORD, { frDeclRe: cfg.__frDeclRe, reqAlt: cfg.__reqAlt, buildSectionMap })
  : [];

verdict(VERDICT_KINDS.SKIPPED, "조회 모드(판정 아님) — 변경 대상의 FR 후보를 좁힌다");

if (JSON_OUT) {
  console.log(JSON.stringify({
    target: rel, keyword: KEYWORD || null,
    owners: owners.map((o) => ({ specId: o.specId, path: o.path })),
    scanned: { specs: scope.length, frs: frUnits.length, scopedToOwners: owners.length > 0 },
    candidates,
    specHits,
  }, null, 2));
  process.exit(0);
}

// ── 사람용 출력.
console.log(`sdd-where — ${rel ? `대상: ${rel}` : `키워드: "${KEYWORD}"`}`);
if (rel) {
  console.log(owners.length
    ? `소유 스펙 ${owners.length}건: ${owners.map((o) => `${o.specId}(${o.path})`).join(" · ")}`
    : `· 소유 스펙 없음 — 이 경로를 Files로 선언한 스펙이 없다(신규 파일이면 소유 스펙을 먼저 정하라, SPEC-003 unowned). 전 스펙에서 찾는다.`);
}
console.log(`FR 후보 ${candidates.length}건 / 검사한 FR ${frUnits.length}건(스펙 ${scope.length}개)`);

// 키워드 모드: FR 라인을 못 맞혀도 **그 개념의 주인 스펙**은 대개 나온다(한글 절 매치).
if (KEYWORD && specHits.length) {
  console.log(`키워드가 나타난 스펙 ${specHits.length}건:`);
  for (const h of specHits.slice(0, 10)) {
    const where = h.frLineHits
      ? `FR 라인 ${h.frLineHits}건 직접 매치`
      : h.sections.length
        ? `FR 라인 밖(${h.sections.slice(0, 3).join(" · ")}) — FR 미확정, 그 스펙 FR ${h.frTotal}개 중에서 고르라`
        // 감사 절만 매치 = **과거 기록**이다(현재 주인이 아니다) — 그 사실을 그대로 적는다.
        : `과거 기록만(${h.auditSections.slice(0, 3).join(" · ")}) — 이 개념의 현재 주인은 아닐 수 있다`;
    console.log(`  · ${h.specId}(${h.path}) — ${where}`);
  }
  if (specHits.length > 10) console.log(`    … 외 ${specHits.length - 10}건`);
}

if (!candidates.length) {
  // **못 좁혔으면 못 좁혔다고 말한다.** 유사도로 아무 FR이나 추천하지 않는다 — 조회기의 거짓
  // 확신은 통독보다 비싸다(틀린 FR에 Change Log를 달면 그 결정이 잘못된 자리에 기록된다).
  console.log("· 결정적 근거(테스트 @covers 태그 · FR의 백틱 지목 · 굵은 키 앵커 · FR 라인 키워드)로 좁히지 못했다 — 통독이 필요하다.");
  console.log(`  좁히려면 둘 중 하나를 심어라: ① 이 파일을 커버하는 테스트에 \`@covers <SPEC>/<FR>\` 태그, ② 그 FR 라인에서 이 파일·심볼을 백틱 또는 굵은 키로 지목(SPEC-023·046).`);
  if (rel && owners.length) console.log(`  지금 읽을 자리: ${owners.map((o) => o.path).join(" · ")} 의 Functional Requirements 절`);
  process.exit(0);
}
for (const c of candidates) console.log(`  · ${formatCandidate(c)}`);
// **후보=전체는 좁힌 것이 아니다.** 근거 0건만 실패로 다루면, 테스트 하나가 스펙 전 FR을 태깅한
// 레포에서 "6/6 후보"가 성공처럼 보인다(도그푸딩 실측: SPEC-060). 정렬 1위는 여전히 유용하므로
// 목록은 그대로 내되, 좁혀지지 않았다는 사실과 좁히는 방법을 함께 말한다.
if (candidates.length === frUnits.length && frUnits.length > 1) {
  console.log(`· ⚠ 후보가 검사 대상 전체와 같다 — **좁혀지지 않았다**(정렬 1위는 근거가 가장 직접적인 FR이지만 확정은 아니다).`);
  console.log(`  원인은 대개 넓은 태깅이다: 테스트 하나가 그 스펙의 FR 전부를 \`@covers\`로 달면 그 태그는 "이 FR"을 가리키지 못한다.`);
  console.log(`  좁히려면: 테스트를 FR 단위로 쪼개 태깅하거나, FR 라인에서 이 파일·심볼을 백틱/굵은 키로 지목하라(SPEC-023·046).`);
}
console.log(`→ 이 중 해당 FR을 골라 그 스펙의 FR/Edge Cases/Change Log를 먼저 갱신하고 편집하라(spec-first).`);
process.exit(0);
