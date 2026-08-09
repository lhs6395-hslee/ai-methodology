#!/usr/bin/env node
// ─── 동의어·형태 변이 게이트 (SPEC-033) ─────────────────────
// 의미적 중복의 결정적 포획층. dedup(SPEC-002)이 키 문자열 유일성만 보는 사각을 닫는다.
//   ① 형태 변이 — 정규화 후 충돌(order/orders/pjt_order): 결정적 → 정책 강도대로 차단 가능
//   ② 선언 동의어 — synonymRegistry의 별칭 사용: 결정적 → 정책 강도대로 차단 가능
//   ③ 유사 후보 — entitySimilarityCommand(SBERT·LLM·WordNet 주입) 결과: **언제나 advisory**
//
// ③이 절대 차단하지 않는 이유(구조적 보장): 확률적 판정이 빌드를 깨면 그 오탐이 곧 방법론의
// 오류가 된다. LLM은 "무엇을 볼지"만 정하고 "무엇이 참인지"는 사람이 ①②(결정적)로 착지시킨다.
// 미결 후보는 registry(같음) 또는 기각 원장(다름+사유)에 들어가기 전까지 매 실행 재부상한다.
// off|advisory|hard. 명령 실행 실패는 skipped(reason) — 오프라인에서 하드 실패 금지.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection, normalizeKey } from "./ownership-keys.mjs";
import {
  canonicalForm, lexicalCollisions, validateSynonymRegistry, declaredSynonymFindings,
  parseCandidatePairs, classifyCandidates, validateLedger,
  entitySetFingerprint, parseCandidateHeader, candidateFreshness,
} from "./synonym-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = String(cfg.synonymPolicy ?? "off");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ synonymPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "synonymPolicy");
  console.log("동의어 게이트 — synonymPolicy:off (판정 안 함)");
  process.exit(0);
}
const HARD = POLICY === "hard";
const CATEGORIES = cfg.ownershipCategories;
const ENT_CAT = cfg.__roles.entity;
const PREFIXES = cfg.keyPrefixes || [];
const REGISTRY = cfg.synonymRegistry || {};
const LEDGER = cfg.synonymReviewLedger || {};
const SIM_CMD = cfg.entitySimilarityCommand || null;

// 소유 키 수집 — entity 역할 카테고리만(동의어 문제의 최고가치 표적. 감사 권고: entity로 좁힌다).
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
let names;
try { names = readdirSync(SPEC_DIR).sort(); } catch { console.error(`✗ spec 디렉토리 없음: ${SPEC_DIR}`); process.exit(1); }
const owned = [];
for (const n of names.filter((x) => /\.md$/.test(x))) {
  const text = readFileSync(join(SPEC_DIR, n), "utf8");
  const specId = (text.match(cfg.__specIdRe) || [n])[0];
  const own = parseSection(text, "Ownership", CATEGORIES);
  if (!ENT_CAT) continue;
  for (const raw of own[ENT_CAT] || []) owned.push({ specId, category: ENT_CAT, key: normalizeKey(ENT_CAT, raw, cfg) });
}
if (!ENT_CAT) {
  verdict(VERDICT_KINDS.INERT, "entity 역할 카테고리 미해석(ownershipCategoryRoles)");
  console.log(`동의어 게이트(synonymPolicy=${POLICY}): 판정 불가(inert) — entity 역할 카테고리 미해석(ownershipCategoryRoles)`);
  if (HARD) { console.error("\n✗ synonymPolicy=hard인데 판정 대상이 없다(거짓 안전) — entity 역할을 선언하거나 정책을 off로."); process.exit(1); }
  process.exit(0);
}
const ownedKeys = new Set(owned.map((o) => String(o.key).trim().toLowerCase()));

// config 무결성(결정적) — 사유 없는 선언·모순 별칭·실재하지 않는 정본은 즉시 에러.
const cfgErrors = [...validateSynonymRegistry(REGISTRY, ownedKeys), ...validateLedger(LEDGER)];
if (cfgErrors.length) {
  console.error("✗ 동의어 설정 오류:");
  for (const e of cfgErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ①② 결정적 판정
const collisions = lexicalCollisions(owned, PREFIXES);
const declared = declaredSynonymFindings(owned, REGISTRY);
const deterministic = collisions.length + declared.length;

// ③ 확률적 후보(옵트인) — 실행 실패는 skipped, 결과는 언제나 advisory.
let cand = { unresolved: [], resolvedByRegistry: 0, resolvedByLedger: 0 };
let simSkipped = "";
let fresh = null; // null=최신 | {kind:"undeclared"|"stale"}
const curFp = entitySetFingerprint([...ownedKeys]);
if (SIM_CMD) {
  try {
    const out = execSync(String(SIM_CMD), {
      cwd: cfg.__root, encoding: "utf8", timeout: Number(cfg.entitySimilarityTimeoutMs ?? 120000),
      stdio: ["ignore", "pipe", "pipe"],
    });
    cand = classifyCandidates(parseCandidatePairs(out), REGISTRY, LEDGER);
    fresh = candidateFreshness(parseCandidateHeader(out), curFp);
  } catch (e) {
    simSkipped = String((e && (e.stderr || e.message)) || "").trim().split("\n").filter(Boolean).pop() || "실행 실패";
  }
}

// 유사 후보 층(③)이 돌지 못했으면 전수를 본 것이 아니다 — 결정적 층에 위반이 없어도 SKIPPED다.
if (simSkipped && !collisions.length && !declared.length) verdict(VERDICT_KINDS.SKIPPED, `유사 후보 층 미실행 — ${simSkipped}`);
else judged(collisions.length + declared.length);
const tag = HARD ? "✗" : "⚠";
console.log(`동의어 게이트(synonymPolicy=${POLICY}): entity ${owned.length}건 — 형태 충돌 ${collisions.length}·선언 별칭 ${declared.length}·미결 후보 ${cand.unresolved.length}`);

for (const c of collisions) {
  const list = c.members.map((m) => `${m.key}(${m.specId})`).join(" + ");
  console.log(`  ${tag} 형태 변이 충돌 "${c.canonical}" ← ${list} — 같은 실체면 정본 하나로 통일, 다르면 이름을 구분되게(단복수·접두어 차이는 같은 키다)`);
}
for (const d of declared) {
  console.log(`  ${tag} [${d.specId}] "${d.key}" — synonymRegistry가 "${d.canonical}"의 별칭으로 선언한 이름이다: 정본으로 통일하라`);
}
if (simSkipped) {
  console.log(`  · [skipped] 유사 후보 탐지(entitySimilarityCommand) — ${simSkipped} (판정 못 함이지 '후보 없음'이 아니다)`);
}
for (const p of cand.unresolved) {
  console.log(`  ⚠ 미결 후보: "${p.a}" ↔ "${p.b}"${p.score ? ` (score ${p.score})` : ""} — 사람이 결정하라: 같으면 synonymRegistry에 정본·별칭+사유, 다르면 synonymReviewLedger["${p.a}::${p.b}"]에 기각 사유`);
}
if (cand.resolvedByRegistry || cand.resolvedByLedger) {
  console.log(`  · 후보 중 이미 결정됨: 정본 통합 ${cand.resolvedByRegistry}건 · 기각 원장 ${cand.resolvedByLedger}건`);
}
if (cand.unresolved.length) {
  console.log("  · 미결 후보는 **차단하지 않는다**(확률적 판정에 차단력을 주지 않는다) — 다만 결정 전까지 매 실행 재부상한다(조용한 소실 없음).");
}
// 신선도 — 확률적 산출물에 대한 결정적 검사. 언제나 advisory(낡음이 커밋을 막으면 ③이 떼어진다).
if (fresh && fresh.kind === "stale") {
  console.log(`  ⚠ 후보 목록이 낡았다 — 생성 당시 entity ${fresh.declared.count}건(${fresh.declared.hash}) → 현재 ${curFp.count}건(${curFp.hash}). 재생성하라: 그 사이 추가된 entity는 **아직 아무도 보지 않았다**(미결 후보 0이 '다 봤다'는 뜻이 아니다).`);
} else if (fresh && fresh.kind === "undeclared") {
  console.log(`  · 후보 목록 신선도 미선언 — 생성기 출력에 \`# entity-set: ${curFp.count} ${curFp.hash}\` 한 줄을 넣으면 낡음을 판정한다(없으면 낡아도 알 수 없다).`);
} else if (SIM_CMD && !simSkipped) {
  console.log(`  · 후보 목록 신선도: 최신 (entity-set ${curFp.count} ${curFp.hash})`);
}

// hard는 ①②(결정적)만 차단한다 — ③은 정책과 무관하게 advisory(구조적 보장).
if (deterministic && HARD) {
  console.error("\n✗ synonymPolicy=hard: 형태 변이 충돌·선언된 별칭 사용은 구조적 중복이다 — 정본으로 통일하라(미결 후보는 차단 대상이 아니다).");
  process.exit(1);
}
if (!deterministic && !cand.unresolved.length && !simSkipped) console.log("동의어 게이트: OK — 형태 충돌·선언 별칭·미결 후보 0건.");
