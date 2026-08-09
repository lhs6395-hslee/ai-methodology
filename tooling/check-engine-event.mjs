#!/usr/bin/env node
// ─── Engines & Events 게이트 (SPEC-030) ─────────────────────
// 감사(#21) 전수성 구멍 봉합: 순수 엔진(코드-모듈)과 배치 job·이벤트가 E/S/C 어디에도 안 맞아
// 유령 entity 날조·`job:` Surface 개명으로 우회하던 것을, 두 옵트인 역할로 담아 실재·귀속을 강제한다.
//   engine → enginesSources(코드-모듈 SSOT) 실재 대조 (engineRealityPolicy)
//   event  → 발신 entity 귀속(`entity.event-name`) + eventCatalogSources 실재 (eventAttributionPolicy)
// 역할은 ownershipCategoryRoles로 **선언 전용**(이름 폴백 없음) — 미선언이면 inert(하위호환).
// off|advisory(경고 exit 0)|hard(exit 1). Python판 sdd_gates.py 미러(SPEC-006).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot, walkFiles } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import {
  roleActive, roleInertReasons, realityFindings, eventAttributionFindings,
  validateSchemaPatterns, extractSchemaEntities,
} from "./engine-event-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const CATEGORIES = cfg.ownershipCategories;
const roles = cfg.__roles;
const ENG_POLICY = cfg.engineRealityPolicy || "off";
const EV_POLICY = cfg.eventAttributionPolicy || "off";

// 정책 값 검증(문법화 — 정의 안 된 값 금지)
for (const [name, val] of [["engineRealityPolicy", ENG_POLICY], ["eventAttributionPolicy", EV_POLICY]]) {
  if (!["off", "advisory", "hard"].includes(val)) {
    console.error(`✗ ${name} 값 위반 "${val}" — off|advisory|hard 중 하나`);
    process.exit(1);
  }
}
if (ENG_POLICY === "off" && EV_POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "engineRealityPolicy·eventAttributionPolicy");
  console.log("Engines/Events 게이트 — engineRealityPolicy·eventAttributionPolicy 모두 off (판정 안 함)");
  process.exit(0);
}

// 스펙별 소유 키 수집
function specUnits() {
  let names;
  try { names = readdirSync(SPEC_DIR).sort(); } catch { console.error(`✗ spec 디렉토리 없음: ${SPEC_DIR}`); process.exit(1); }
  return names.filter((n) => /\.md$/.test(n)).map((n) => {
    const text = readFileSync(join(SPEC_DIR, n), "utf8");
    const specId = (text.match(cfg.__specIdRe) || [n])[0];
    return { specId, own: parseSection(text, "Ownership", CATEGORIES) };
  });
}
// SSOT 파일 수집(루트 1회 순회) → 소스별 글롭 매치·패턴으로 실재 식별자 집합.
function ssotSet(sources) {
  const IGNORE = new Set(cfg.ignoreDirs);
  const all = [];
  // 정본은 sdd-config의 walkFiles — 두 게이트에 본문 동일로 있던 것(R13 구조 중복).
  walkFiles(ROOT, IGNORE, "", all);
  const units = [];
  for (const src of sources || []) {
    const globs = (src.globs || []).map(compileGlob);
    const patterns = src.patterns || [];
    if (!globs.length || !patterns.length) continue;
    for (const rel of all) {
      if (!globs.some((rx) => rx.test(rel))) continue;
      try { units.push({ text: readFileSync(join(ROOT, rel), "utf8"), patterns }); } catch { /* skip */ }
    }
  }
  return extractSchemaEntities(units);
}
function exemptSet(map, knob) {
  const errs = [];
  for (const [k, reason] of Object.entries(map || {})) if (!String(reason || "").trim()) errs.push(k);
  if (errs.length) { console.error(`✗ ${knob} 빈 사유: ${errs.join(", ")} — 면제는 사유 필수(entityRegistry 동형)`); process.exit(1); }
  return new Set(Object.keys(map || {}).map((k) => k.trim().toLowerCase()));
}

const units = specUnits();
let failed = false;
// 축이 둘이라 판정 종류도 축별로 갈린다 — 하나라도 실제로 봤으면 JUDGED, 둘 다 못 봤으면 INERT.
let violCount = 0, judgedAxes = 0;
const inertAxes = [];

// ── engine 실재 ──
if (ENG_POLICY !== "off") {
  const ENG_CAT = roles.engine;
  const inert = roleInertReasons(ENG_POLICY, cfg.enginesSources, ENG_CAT, "enginesSources", "engine");
  if (inert.length) {
    inertAxes.push(`engine: ${inert.join(" · ")}`);
    console.log(`Engine 실재(engineRealityPolicy=${ENG_POLICY}): 판정 불가 — ${inert.join(" · ")}`);
    if (ENG_POLICY === "hard") { console.error("\n✗ engineRealityPolicy=hard인데 무판정(거짓 안전) — enginesSources·engine 역할을 선언하거나 정책을 off로."); failed = true; }
  } else {
    const patErrs = validateSchemaPatterns(cfg.enginesSources);
    if (patErrs.length) { console.error(`✗ enginesSources 잘못된 정규식: ${patErrs.map((e) => `[${e.index}] ${e.pattern}`).join(", ")}`); process.exit(1); }
    const set = ssotSet(cfg.enginesSources);
    const exempt = exemptSet(cfg.engineExemptKeys, "engineExemptKeys");
    const owned = units.map((u) => ({ specId: u.specId, keys: u.own[ENG_CAT] || [] }));
    const f = realityFindings(owned, set, exempt);
    const tag = ENG_POLICY === "hard" ? "✗" : "⚠";
    console.log(`Engine 실재(engineRealityPolicy=${ENG_POLICY}): 위반 ${f.length}건 — 소유 engine이 코드-모듈 SSOT에 없음`);
    for (const v of f) console.log(`  ${tag} ${v.specId}: engine "${v.key}" — enginesSources에 실재하지 않음(코드-모듈로 실재시키거나 데이터 교정; 순수 로직이 아니면 entity/surface로 재분류)`);
    judgedAxes += 1; violCount += f.length;
    if (f.length && ENG_POLICY === "hard") failed = true;
  }
}

// ── event 귀속 + 카탈로그 실재 ──
if (EV_POLICY !== "off") {
  const EV_CAT = roles.event;
  const ENT_CAT = roles.entity;
  const inert = roleInertReasons(EV_POLICY, cfg.eventCatalogSources, EV_CAT, "eventCatalogSources", "event");
  if (inert.length) {
    inertAxes.push(`event: ${inert.join(" · ")}`);
    console.log(`Event 귀속(eventAttributionPolicy=${EV_POLICY}): 판정 불가 — ${inert.join(" · ")}`);
    if (EV_POLICY === "hard") { console.error("\n✗ eventAttributionPolicy=hard인데 무판정(거짓 안전) — eventCatalogSources·event 역할을 선언하거나 정책을 off로."); failed = true; }
  } else {
    const patErrs = validateSchemaPatterns(cfg.eventCatalogSources);
    if (patErrs.length) { console.error(`✗ eventCatalogSources 잘못된 정규식: ${patErrs.map((e) => `[${e.index}] ${e.pattern}`).join(", ")}`); process.exit(1); }
    const catalog = ssotSet(cfg.eventCatalogSources);
    const exempt = exemptSet(cfg.eventExemptKeys, "eventExemptKeys");
    const ownedEvents = units.map((u) => ({ specId: u.specId, keys: u.own[EV_CAT] || [] }));
    const ownedEntities = {};
    for (const u of units) ownedEntities[u.specId] = (ENT_CAT ? (u.own[ENT_CAT] || []) : []).map((e) => String(e).trim().toLowerCase());
    const attr = eventAttributionFindings(ownedEvents, ownedEntities);
    const real = realityFindings(ownedEvents, catalog, exempt);
    const tag = EV_POLICY === "hard" ? "✗" : "⚠";
    console.log(`Event 귀속(eventAttributionPolicy=${EV_POLICY}): 귀속 위반 ${attr.length}건, 카탈로그 실재 위반 ${real.length}건`);
    for (const v of attr) console.log(`  ${tag} ${v.specId}: event "${v.key}" — 발신 entity(${v.entity || "없음"})를 이 스펙이 소유하지 않음. \`entity.event-name\` 형식으로 소유 entity에 귀속(capability 귀속 동형)`);
    for (const v of real) console.log(`  ${tag} ${v.specId}: event "${v.key}" — eventCatalogSources에 실재하지 않음(이벤트 카탈로그에 등록하거나 데이터 교정)`);
    judgedAxes += 1; violCount += attr.length + real.length;
    if ((attr.length || real.length) && EV_POLICY === "hard") failed = true;
  }
}

if (!judgedAxes) verdict(VERDICT_KINDS.INERT, inertAxes.join(" / ") || "판정 가능한 축 없음");
else judged(violCount);
if (failed) process.exit(1);
console.log("Engines/Events 게이트: OK.");
