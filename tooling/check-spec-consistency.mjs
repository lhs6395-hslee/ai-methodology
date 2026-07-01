// tooling/check-spec-consistency.mjs
// FR↔Ownership 일관성(advisory) — 선언한 키의 핵심 토큰이 본문에 0회 등장하면
// "근거 없는 키" 경고. 자연어 NLP 없이 grep 근사 → 결정적·advisory.
// 설계: 2026-06-30-ownership-key-derivation-design.md §6.2
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");
const CATEGORIES = cfg.ownershipCategories;

// 키에서 핵심 토큰 추출: 영숫자 조각(2자+). 예: "staff.recommend" → ["staff","recommend"], "POST /api/x" → ["api","x"]
const tokens = (key) => (key.toLowerCase().match(/[a-z][a-z0-9_]{1,}/g) || []).filter((t) => !["post","get","put","delete","patch","api","event","job"].includes(t));

const findings = [];
let specCount = 0;
for (const f of (() => { try { return readdirSync(SPEC_DIR); } catch { return []; } })()) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const specId = (text.match(cfg.__specIdRe) || [f])[0];
  const own = parseSection(text, "Ownership", CATEGORIES);
  // Extract body (FR text) — everything before the Ownership section
  const ownershipStart = text.search(/^##\s+Ownership\b/m);
  // Only the FR body BEFORE ## Ownership grounds keys; the Ownership block (and any
  // post-Ownership sections) are intentionally excluded so a key isn't grounded by its own declaration.
  const body = ownershipStart === -1 ? text : text.slice(0, ownershipStart);
  const hay = body.toLowerCase();
  specCount++;
  for (const cat of CATEGORIES) {
    for (const key of own[cat]) {
      const toks = tokens(key);
      if (toks.length && !toks.some((t) => hay.includes(t)))
        findings.push({ specId, cat, key });
    }
  }
}

console.log(`Spec 일관성(advisory): spec ${specCount}개 검사 — 근거 없는 키 ${findings.length}건.`);
for (const f of findings) console.log(`  ⚠ [${f.specId}] ${f.cat} "${f.key}": 본문에 근거 토큰 없음 → FR과 정렬 확인`);
if (findings.length && STRICT) { console.error("\n✗ --strict: 근거 없는 키."); process.exit(1); }
console.log(findings.length ? "일관성: advisory 경고(비차단)" : "일관성: OK — 모든 키에 본문 근거.");
