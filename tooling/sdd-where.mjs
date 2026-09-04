#!/usr/bin/env node
// ─── sdd-where — "이 변경은 어느 FR인가" 조회기 (SPEC-062) ───
//
//   node scripts/sdd-where.mjs <파일경로>              # 파일로 찾기
//   node scripts/sdd-where.mjs --key <소유 키>          # 키로 찾기(O(1) 해시 조회)
//   node scripts/sdd-where.mjs --keyword "예산 승인"     # 도메인 단어로 찾기
//   node scripts/sdd-where.mjs <대상> --json            # 기계 소비(에이전트·훅)
//
// 왜 있나(오너 제보): spec-first는 편집 시점에 이미 발화하는데 그 출력이 **스펙 ID까지만** 좁혀서
// 어느 FR인지는 스펙 통독으로 찾아야 했다. 그 통독이 에이전트 컨텍스트에 스펙 본문을 올리는
// 일이라 토큰 비용의 실체였고, 스펙이 늘면 선형으로 늘었다("스펙이 많아져도 오래 걸리면 안 된다").
//
// **인덱스 우선**: `sdd/FR_INDEX.json`(gen-fr-index.mjs 산출물)만 읽는다 — 스펙 파일을 열지
// 않으므로 스펙이 63개든 500개든 조회 비용이 같다. 인덱스가 없거나 낡으면 **조용히 틀린 답을
// 주지 않고** 그 사실을 말한 뒤 스펙 직접 읽기로 폴백한다(정확성 > 속도, 단 느리다고 알린다).
//
// ⚠ 판정기가 아니라 조회기다(verdict = SKIPPED). 후보를 못 좁혔으면 못 좁혔다고 말한다 —
// 유사도로 아무 FR이나 추천하지 않는다(틀린 확신은 통독보다 비싸다).
// 설계: SPEC-062.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, specMdFiles, isTestFile } from "./sdd-config.mjs";
import { compileGlob, parseFilesLine, stripInlineComment, buildSectionMap } from "./spec-sync-lib.mjs";
import { frDeclLines, locateFrs, locateSpecsByKeyword, formatCandidate } from "./fr-locator-lib.mjs";
import { INDEX_REL_PATH, specDigest } from "./gen-fr-index.mjs";

import { armVerdict, verdict, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();

const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const flagValue = (...names) => {
  const i = ARGS.findIndex((a) => names.includes(a));
  return i === -1 ? { value: null, valueIdx: -1 } : { value: ARGS[i + 1] ?? null, valueIdx: i + 1 };
};
const { value: KEYWORD, valueIdx: kwValueIdx } = flagValue("--keyword", "-k");
const { value: KEY, valueIdx: keyValueIdx } = flagValue("--key");
const positional = ARGS.filter((a, i) => !a.startsWith("-") && i !== kwValueIdx && i !== keyValueIdx);
const TARGET = positional[0] || null;

if (!TARGET && !KEYWORD && !KEY) {
  console.error("사용: node scripts/sdd-where.mjs <파일경로> | --key <소유 키> | --keyword <도메인 단어> [--json]");
  process.exit(1);
}

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const rel = TARGET
  ? String(TARGET).replace(/^\.\//, "").replace(new RegExp(`^${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "")
  : null;

// ── 인덱스 로드 + 신선도. digest는 stat만 하므로(내용 재독 없음) 이 검증 자체가 싸다.
let index = null;
let indexState = "missing";
try {
  const parsed = JSON.parse(readFileSync(resolveFromRoot(cfg, INDEX_REL_PATH), "utf8"));
  const fresh = parsed?.source?.digest === specDigest(specMdFiles(SPEC_DIR), ROOT.length + 1);
  index = parsed;
  indexState = fresh ? "fresh" : "stale";
} catch { indexState = "missing"; }
const useIndex = indexState === "fresh";

// ── 스펙·FR 재료. 인덱스가 최신이면 **스펙 파일을 열지 않는다**(이 축의 존재 이유).
let specs = [];      // [{specId, path, text?}] — text는 폴백 경로에서만 채운다
let frUnits = [];    // [{specId, frId, line}]
let owners = [];     // 파일 소유 스펙
if (useIndex) {
  const entries = Object.entries(index.specs);
  specs = entries.map(([specId, s]) => ({ specId, path: s.path }));
  if (rel) {
    const hit = new Set(index.fileOwners
      .filter(({ glob }) => { try { return compileGlob(glob).test(rel); } catch { return false; } })
      .map(({ spec }) => spec));
    owners = specs.filter((s) => hit.has(s.specId));
  }
  const scopeIds = new Set((owners.length ? owners : specs).map((s) => s.specId));
  for (const [specId, s] of entries) {
    if (!scopeIds.has(specId)) continue;
    for (const fr of s.frs) frUnits.push({ specId, frId: fr.id, line: fr.line });
  }
} else {
  for (const abs of specMdFiles(SPEC_DIR)) {
    let text; try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const name = abs.slice(abs.lastIndexOf("/") + 1);
    specs.push({
      specId: (text.match(cfg.__specIdRe) || [name])[0],
      path: `${cfg.specDir}/${name}`,
      text,
      globs: parseFilesLine(text).map(stripInlineComment).filter(Boolean),
    });
  }
  if (rel) owners = specs.filter((s) => s.globs.some((g) => { try { return compileGlob(g).test(rel); } catch { return false; } }));
  for (const s of (owners.length ? owners : specs)) {
    for (const { frId, line } of frDeclLines(s.text, cfg.__frDeclRe, cfg.__reqAlt)) {
      frUnits.push({ specId: s.specId, frId, line });
    }
  }
}

// ── covers 근거: 인덱스의 두 방향 맵으로 O(1) — 테스트를 다시 읽지 않는다.
const coversBy = new Map();
if (rel && useIndex) {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const tests = index.fileTests?.[base] || [];
  const raw = [];
  for (const t of tests) for (const k of index.testCovers?.[t] || []) raw.push({ file: t, key: k });
  const breadth = new Map(); // `${test}|${spec}` → 그 테스트가 그 스펙에서 태깅한 FR 수
  for (const { file, key } of raw) {
    const spec = key.slice(0, key.indexOf("/"));
    const bk = `${file}|${spec}`;
    breadth.set(bk, (breadth.get(bk) || 0) + 1);
  }
  for (const { file, key } of raw) {
    const spec = key.slice(0, key.indexOf("/"));
    if (!coversBy.has(key)) coversBy.set(key, []);
    coversBy.get(key).push({ file, breadth: breadth.get(`${file}|${spec}`) || 1 });
  }
}

// 편집 대상의 현재 내용 — FR이 이름으로 지목한 함수가 이 파일에 있는지 대조용(파일 1개 읽기).
let pathText = "";
if (rel) { try { pathText = readFileSync(join(ROOT, rel), "utf8"); } catch { /* 신규 파일 */ } }

// ── 키 조회(O(1) 해시) — 오너 요구의 정본 경로. 인덱스가 최신일 때만 성립한다.
let keyHits = null;
if (KEY) {
  const k = String(KEY).trim().toLowerCase();
  keyHits = useIndex ? (index.keyIndex?.[k] || []) : null;
}

const candidates = locateFrs(frUnits, {
  path: rel,
  pathText,
  coversBy: coversBy.size ? coversBy : null,
  keyword: KEYWORD,
  isTestName: (n) => isTestFile(n, cfg),
  moduleExtensions: cfg.implModuleExtensions,
});

// 키워드 모드의 스펙 단위 매치는 스펙 **본문**이 필요하다(FR 정본이 영어라 한글 도메인 단어는
// User Story·Edge Cases에 산다). 인덱스에는 본문을 담지 않으므로(담으면 인덱스가 스펙 전문만큼
// 커진다) 이 경로에서만 스펙을 읽는다 — 드문 경로이고, 그 비용을 출력에 밝힌다.
let specHits = [];
if (KEYWORD) {
  let withText = specs.filter((s) => s.text);
  if (!withText.length) {
    withText = [];
    for (const abs of specMdFiles(SPEC_DIR)) {
      let text; try { text = readFileSync(abs, "utf8"); } catch { continue; }
      const name = abs.slice(abs.lastIndexOf("/") + 1);
      withText.push({ specId: (text.match(cfg.__specIdRe) || [name])[0], path: `${cfg.specDir}/${name}`, text });
    }
  }
  specHits = locateSpecsByKeyword(withText, KEYWORD, { frDeclRe: cfg.__frDeclRe, reqAlt: cfg.__reqAlt, buildSectionMap });
}

verdict(VERDICT_KINDS.SKIPPED, "조회 모드(판정 아님) — 변경 대상의 FR 후보를 좁힌다");

if (JSON_OUT) {
  console.log(JSON.stringify({
    target: rel, key: KEY || null, keyword: KEYWORD || null,
    index: { state: indexState, path: INDEX_REL_PATH, used: useIndex },
    owners: owners.map((o) => ({ specId: o.specId, path: o.path })),
    scanned: { specs: specs.length, frs: frUnits.length, scopedToOwners: owners.length > 0 },
    keyHits, candidates, specHits,
  }, null, 2));
  process.exit(0);
}

// ── 사람용 출력.
const head = rel ? `대상: ${rel}` : KEY ? `키: ${KEY}` : `키워드: "${KEYWORD}"`;
console.log(`sdd-where — ${head}`);
if (indexState === "fresh") console.log(`· 인덱스 사용(${INDEX_REL_PATH}) — 스펙 파일을 읽지 않았다`);
else if (indexState === "stale") console.log(`· ⚠ 인덱스가 낡아 스펙을 직접 읽었다(느림) — \`node scripts/gen-fr-index.mjs\`로 재생성하라`);
else console.log(`· ⚠ 인덱스 없음 — 스펙을 직접 읽었다(느림). 만들면 이 조회가 스펙 수와 무관해진다: \`node scripts/gen-fr-index.mjs\``);

if (KEY) {
  if (keyHits === null) console.log(`키 조회는 인덱스가 있어야 한다(위 안내대로 생성하라).`);
  else if (!keyHits.length) console.log(`키 "${KEY}" — 어느 스펙도 소유 선언하지 않았다(신규 키면 소유 스펙을 먼저 정하라).`);
  else {
    for (const h of keyHits) {
      const s = index.specs[h.spec];
      console.log(`  · ${h.spec}(${s?.path}) — ${h.frs.length ? `앵커 FR: ${h.frs.join(", ")}` : `이 키를 굵게 앵커한 FR 없음(SPEC-023 FR-007 부채)`}`);
    }
  }
}

if (rel) {
  console.log(owners.length
    ? `소유 스펙 ${owners.length}건: ${owners.map((o) => `${o.specId}(${o.path})`).join(" · ")}`
    : `· 소유 스펙 없음 — 이 경로를 Files로 선언한 스펙이 없다(신규 파일이면 소유 스펙을 먼저 정하라, SPEC-003 unowned). 전 스펙에서 찾는다.`);
}
if (rel || KEYWORD) console.log(`FR 후보 ${candidates.length}건 / 검사한 FR ${frUnits.length}건(스펙 ${specs.length}개)`);

if (KEYWORD && specHits.length) {
  console.log(`키워드가 나타난 스펙 ${specHits.length}건:`);
  for (const h of specHits.slice(0, 10)) {
    const where = h.frLineHits
      ? `FR 라인 ${h.frLineHits}건 직접 매치`
      : h.sections.length
        ? `FR 라인 밖(${h.sections.slice(0, 3).join(" · ")}) — FR 미확정, 그 스펙 FR ${h.frTotal}개 중에서 고르라`
        : `과거 기록만(${h.auditSections.slice(0, 3).join(" · ")}) — 이 개념의 현재 주인은 아닐 수 있다`;
    console.log(`  · ${h.specId}(${h.path}) — ${where}`);
  }
  if (specHits.length > 10) console.log(`    … 외 ${specHits.length - 10}건`);
}

if (candidates.length) {
  for (const c of candidates) console.log(`  · ${formatCandidate(c)}`);
  // **후보=전체는 좁힌 것이 아니다**(도그푸딩 실측: 테스트 하나가 스펙 전 FR을 태깅하면 6/6이
  // 성공처럼 보였다). 목록은 그대로 내되 좁혀지지 않았다는 사실과 좁히는 방법을 함께 말한다.
  if (candidates.length === frUnits.length && frUnits.length > 1) {
    console.log(`· ⚠ 후보가 검사 대상 전체와 같다 — **좁혀지지 않았다**(정렬 1위는 근거가 가장 직접적인 FR이지만 확정은 아니다).`);
    console.log(`  원인은 대개 넓은 태깅이다: 테스트 하나가 그 스펙의 FR 전부를 \`@covers\`로 달면 그 태그는 "이 FR"을 가리키지 못한다.`);
    console.log(`  좁히려면: 테스트를 FR 단위로 쪼개 태깅하거나, FR 라인에서 이 파일·심볼을 백틱/굵은 키로 지목하라(SPEC-023·046).`);
  }
  console.log(`→ 이 중 해당 FR을 골라 그 스펙의 FR/Edge Cases/Change Log를 먼저 갱신하고 편집하라(spec-first).`);
} else if (rel || KEYWORD) {
  console.log("· 결정적 근거(테스트 @covers 태그 · FR의 백틱 지목 · 굵은 키 앵커 · FR 라인 키워드)로 좁히지 못했다 — 통독이 필요하다.");
  console.log(`  좁히려면 둘 중 하나를 심어라: ① 이 파일을 커버하는 테스트에 \`@covers <SPEC>/<FR>\` 태그, ② 그 FR 라인에서 이 파일·심볼을 백틱 또는 굵은 키로 지목(SPEC-023·046).`);
  if (rel && owners.length) console.log(`  지금 읽을 자리: ${owners.map((o) => o.path).join(" · ")} 의 Functional Requirements 절`);
}
process.exit(0);
