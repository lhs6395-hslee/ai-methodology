#!/usr/bin/env node
// ─── FR 인덱스 생성기 (SPEC-062) — 키 방식 O(1) 조회의 근거 파일 ───
//
//   생성: node scripts/gen-fr-index.mjs            → sdd/FR_INDEX.json 재작성
//   판정: node scripts/gen-fr-index.mjs --check     → 낡았으면 알린다(재생성은 하지 않는다)
//
// 왜 필요한가(오너 제보 + 실측): 스펙이 늘면 변경 1건의 비용이 선형으로 늘었다. 실측(킷 자신,
// 스펙 62개·1.1MB): 전 스펙을 읽는 게이트가 24종이고, **에이전트가 FR을 찾으려면 스펙 본문을
// 컨텍스트에 올려야 했다** — 그게 토큰 비용의 실체다(게이트 내부 IO는 토큰과 무관하지만, 사람·
// 에이전트의 통독은 토큰이다). 오너 요구: "키 방식으로 빠르게 찾아서 스펙이 많아져도 시간이
// 오래 걸리면 안 된다."
//
// 그래서 **미리 계산해 둔다.** 조회는 이 파일 하나를 읽고 해시 조회로 끝나므로 스펙이 62개든
// 500개든 조회 비용이 같다(O(1)). 그리고 조회기가 해당 항목만 출력하므로 에이전트 컨텍스트에는
// 스펙 본문이 아니라 **후보 몇 줄만** 들어간다.
//
// 낡음 판정은 **stat만** 한다(경로+크기+mtime의 sha256) — 내용을 다시 읽으면 인덱스의 이득이
// 사라진다. mtime이 바뀌었는데 내용이 같은 경우(체크아웃 등)는 "낡음"으로 뜨는데, 그 방향의
// 오탐은 "재생성하라"는 안내라서 안전하다(반대 방향 — 낡은 인덱스를 최신이라 말하는 것 — 만이
// 위험하다). 생성물이므로 판정 게이트가 아니다(SPEC-040 verdict: 생성 모드 = SKIPPED).
// 설계: SPEC-062.

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadConfig, resolveFromRoot, specMdFiles, walkFiles, isTestFile } from "./sdd-config.mjs";
import { parseFilesLine, stripInlineComment } from "./spec-sync-lib.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { frDeclLines } from "./fr-locator-lib.mjs";
import { extractAnchors } from "./key-anchor-lib.mjs";
import { namedImplementations } from "./impl-reference-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_REL_PATH = "sdd/FR_INDEX.json";

// 스펙 집합의 지문 — 경로·크기·mtime만 본다(읽지 않는다). 인덱스가 이 값을 들고 있고,
// 조회 시 현재 지문과 다르면 낡은 것이다.
export function specDigest(absPaths, rootPrefixLen = 0) {
  const h = createHash("sha256");
  for (const p of [...absPaths].sort()) {
    let st;
    try { st = statSync(p); } catch { continue; }
    h.update(`${p.slice(rootPrefixLen)}|${st.size}|${Math.floor(st.mtimeMs)}\n`);
  }
  return `sha256:${h.digest("hex")}`;
}

// 인덱스를 만든다(순수에 가깝게 — 입력은 이미 읽은 스펙 텍스트들이다).
// specs: [{specId, path, text}] · coversIndex: {"<SPEC>/<FR>": [테스트 경로...]}
export function buildIndex({ specs, coversIndex, fileTests, testCovers, digest, cfg }) {
  const out = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    source: { specCount: specs.length, digest },
    specs: {},
    keyIndex: {},      // 정규화 키 → [{spec, frs:[...]}]  ← 키 방식 조회의 핵심
    fileOwners: [],    // [{glob, spec}] — 경로 매칭은 조회 시(글롭이라 해시 조회 불가)
    coversIndex: coversIndex || {},
    // 조회가 **테스트를 다시 읽지 않도록** 두 방향을 미리 담는다: 어떤 테스트가 이 소스를
    // 언급하는가(fileTests) → 그 테스트가 무엇을 태깅했는가(testCovers). 이 둘이 없으면
    // covers 근거를 얻으려고 조회마다 레포의 테스트 전수를 읽어야 했다(인덱스를 두는 의미가 사라진다).
    fileTests: fileTests || {},   // basename → [테스트 경로...]
    testCovers: testCovers || {}, // 테스트 경로 → ["<SPEC>/<FR>", ...]
  };
  const categories = cfg.ownershipCategories || [];

  for (const { specId, path, text } of specs) {
    const own = parseSection(text, "Ownership", categories);
    const globs = parseFilesLine(text).map(stripInlineComment).filter(Boolean);
    const frs = frDeclLines(text, cfg.__frDeclRe, cfg.__reqAlt).map(({ frId, line }) => ({
      id: frId,
      line,
      // FR이 굵게 앵커한 키·백틱으로 지목한 구현체를 미리 뽑아 둔다 — 조회 시 다시 파싱하지 않는다.
      anchors: [...new Set(extractAnchors(line))],
      impls: namedImplementations(line, (n) => isTestFile(n, cfg), cfg.implModuleExtensions)
        .map(({ name, kind }) => ({ name, kind })),
    }));

    out.specs[specId] = { path, files: globs, keys: own, frs };
    for (const g of globs) out.fileOwners.push({ glob: g, spec: specId });

    // 키 → 스펙/FR. 소유 키는 그 스펙으로, 그리고 그 키를 앵커한 FR까지 이어 둔다.
    const addKey = (raw) => {
      const k = String(raw).replace(/\s*\([a-z][a-z0-9-]*\)\s*$/, "").trim().toLowerCase();
      if (!k || k === "—" || k === "-") return;
      if (!out.keyIndex[k]) out.keyIndex[k] = [];
      let slot = out.keyIndex[k].find((s) => s.spec === specId);
      if (!slot) { slot = { spec: specId, frs: [] }; out.keyIndex[k].push(slot); }
      for (const fr of frs) {
        if (fr.anchors.includes(k) && !slot.frs.includes(fr.id)) slot.frs.push(fr.id);
      }
    };
    for (const [cat, list] of Object.entries(own)) {
      if (/^files$/i.test(cat)) continue;   // 글롭은 키가 아니다(DEDUP.md §3)
      for (const raw of list || []) addKey(raw);
    }
  }
  return out;
}

// ── 실행부(IO) — **엔트리로 실행될 때만** 돈다.
// ⚠ 이 파일은 조회기(`sdd-where.mjs`)가 `INDEX_REL_PATH`·`specDigest`를 가져가는 **모듈**이기도
// 하다. 가드가 없던 첫 판은 import만으로 이 아래가 실행돼 **조회할 때마다 인덱스를 재생성**했고
// (도그푸딩에서 즉시 잡혔다: 조회 185ms + "생성" 로그 + 판정 줄 2회 출력), 그건 인덱스를 두는
// 이유 자체를 무너뜨린다. 엔트리 판정은 verdict-lib의 `isMainEntry`(realpath 비교)가 정본이다.
if (isMainEntry(import.meta.url)) {
  armVerdict();
  const cfg = loadConfig();
  const ROOT = cfg.__root;
  const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
  const CHECK = process.argv.includes("--check");
  const IF_PRESENT = process.argv.includes("--if-present");
  const absSpecs = specMdFiles(SPEC_DIR);
  const digest = specDigest(absSpecs, ROOT.length + 1);
  const indexAbs = resolveFromRoot(cfg, INDEX_REL_PATH);

  if (CHECK) {
    let cur = null;
    try { cur = JSON.parse(readFileSync(indexAbs, "utf8")); } catch { /* 없음/깨짐 */ }
    if (!cur) {
      if (IF_PRESENT) {
        verdict(VERDICT_KINDS.SKIPPED, `${INDEX_REL_PATH} 미생성 — 조회 인덱스는 선택 산출물(--if-present)`);
        console.log(`· FR 인덱스 없음(${INDEX_REL_PATH}) — 조회는 스펙 직접 읽기로 동작한다(느림). 만들려면: node scripts/gen-fr-index.mjs`);
        process.exit(0);
      }
      judged(1);
      console.log(`✗ FR 인덱스 없음 — \`node scripts/gen-fr-index.mjs\`로 생성하라(${INDEX_REL_PATH}).`);
      process.exit(1);
    }
    const stale = cur.source?.digest !== digest || cur.schemaVersion !== INDEX_SCHEMA_VERSION;
    judged(stale ? 1 : 0);
    if (stale) {
      console.log(`✗ FR 인덱스 낡음 — 스펙 집합이 인덱스 생성 시점과 다르다(스펙 ${absSpecs.length}개). \`node scripts/gen-fr-index.mjs\`로 재생성하라.`);
      process.exit(1);
    }
    console.log(`FR 인덱스: 최신 — ${INDEX_REL_PATH}(스펙 ${cur.source.specCount}개 · FR ${Object.values(cur.specs).reduce((n, s) => n + s.frs.length, 0)}개)`);
    process.exit(0);
  }

  // 생성 — covers 인덱스는 레포의 테스트 전수 스캔이 필요하다(그래서 **여기서 한 번만** 한다.
  // 조회마다 하면 인덱스를 두는 의미가 없다).
  const specs = [];
  for (const abs of absSpecs) {
    let text; try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const name = abs.slice(abs.lastIndexOf("/") + 1);
    specs.push({ specId: (text.match(cfg.__specIdRe) || [name])[0], path: `${cfg.specDir}/${name}`, text });
  }
  const coversIndex = {};
  const fileTests = {};
  const testCovers = {};
  const IGNORE = new Set(cfg.ignoreDirs);
  const all = walkFiles(ROOT, IGNORE);
  // 비-테스트 소스의 basename 집합 — 테스트가 어느 소스를 언급하는지 대조할 좌변.
  // 식별자 경계로 대조한다(`chat.ts`가 `mychat.ts`에 부분일치하면 결속이 거짓으로 참이 된다).
  const sourceBases = new Map(); // basename → 정규식
  for (const f of all) {
    if (isTestFile(f, cfg)) continue;
    const b = f.slice(f.lastIndexOf("/") + 1);
    if (!b || sourceBases.has(b)) continue;
    sourceBases.set(b, new RegExp(`(^|[^A-Za-z0-9_$])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_$]|$)`));
  }
  for (const f of all) {
    if (!isTestFile(f, cfg)) continue;
    let t; try { t = readFileSync(resolveFromRoot(cfg, f), "utf8"); } catch { continue; }
    for (const m of t.matchAll(cfg.__coversRe)) {
      const key = `${m[1]}/${m[2]}`;
      if (!coversIndex[key]) coversIndex[key] = [];
      if (!coversIndex[key].includes(f)) coversIndex[key].push(f);
      if (!testCovers[f]) testCovers[f] = [];
      if (!testCovers[f].includes(key)) testCovers[f].push(key);
    }
    for (const [b, re] of sourceBases) {
      if (!re.test(t)) continue;
      if (!fileTests[b]) fileTests[b] = [];
      fileTests[b].push(f);
    }
  }

  const index = buildIndex({ specs, coversIndex, fileTests, testCovers, digest, cfg });
  writeFileSync(indexAbs, `${JSON.stringify(index, null, 2)}\n`);
  const frCount = Object.values(index.specs).reduce((n, s) => n + s.frs.length, 0);
  verdict(VERDICT_KINDS.SKIPPED, "생성 모드(판정 아님) — 조회 인덱스를 산출한다. 드리프트 판정은 --check");
  console.log(`FR 인덱스 생성 — ${INDEX_REL_PATH}: 스펙 ${specs.length}개 · FR ${frCount}개 · 키 ${Object.keys(index.keyIndex).length}개 · covers ${Object.keys(coversIndex).length}건`);
}
