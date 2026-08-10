#!/usr/bin/env node
// ─── FR ↔ test traceability gate ──────────────────────────
// Closes the seam SSOT.md §4 identifies: Superpowers locks code↔test, but
// FR↔test is otherwise manual. This script enforces it mechanically.
//
// It scans (paths/patterns come from sdd.config.json — language/stack-agnostic):
//   - <specDir>/<PREFIX>-*.md       → declared FR-IDs per spec
//   - <scanDirs>/** test files      → `<comment> @covers <SPEC-ID>/FR-NNN` tags
//     (comment style — // or # or -- — is irrelevant; only the tag text matters)
//   <PREFIX> defaults to SPEC; extend via specIdPrefixes in sdd.config.json
//   (e.g. ["SPEC","TEST","INFRA"]) so non-app specs are first-class without a fork.
//
// Rules (exit non-zero on violation):
//   R1. Every @covers tag must reference a FR that actually exists in that spec.
//   R2. Implemented specs (those with ≥1 covering test) must have EVERY FR covered.
//       Specs with ZERO covering tests are treated as "not yet implemented" and
//       only warn (so we can adopt the gate incrementally, spec by spec).
//
// Language/stack is config-driven: testFileRegex/scanDirs/ignoreDirs/specDir in
// sdd.config.json. No config → JS/TS defaults (backward compatible).
//
// Usage: node scripts/check-fr-coverage.mjs [--strict]
//   --strict : also fail when a spec has zero covering tests (full enforcement)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot, isTestFile, DEFAULTS, isE2eFile, walkFiles, isSpecMdName } from "./sdd-config.mjs";
import { loadManifest, classify } from "./verification-accounting.mjs";
import { parseStatus } from "./lifecycle-lib.mjs";
import { compileGlob, stripInlineComment } from "./spec-sync-lib.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { INFRA_SOURCE_CLASSES, prefixClassFinding, validateExemptions } from "./prefix-class-lib.mjs";
import { numberingIssues, frNumberingIssues } from "./numbering-lib.mjs";
import { changeLogFrRefs, changeLogFrFindings } from "./changelog-fr-lib.mjs";
import { evidencePathsOf, coversBacklinkFindings, coversBacklinkVerdict } from "./covers-backlink-lib.mjs";
import { frDeclarations } from "./grammar-lib.mjs";
import { testInfraFinding } from "./test-domain-lib.mjs";
import { termCoverageFindings } from "./term-coverage-lib.mjs";
import { externalTargetFindings } from "./external-target-lib.mjs";
import { namedImplementations, implReferenceFindings, DEFAULT_IMPL_PROSE_REGEX } from "./impl-reference-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const ROOT = cfg.__root;
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const SCAN_DIRS = cfg.scanDirs.map((d) => resolveFromRoot(cfg, d));
const IGNORE = new Set(cfg.ignoreDirs);
const STRICT = process.argv.includes("--strict");

const FR_DECL = cfg.__frDeclRe;          // **FR-006**, **FR-003a** in spec prose — 문법은 requirementIdPrefixes에서 파생(사이트 간 통일)
const SPEC_ID = cfg.__specIdRe;          // e.g. /(?:SPEC|TEST|INFRA)-\d{3}/ (from specIdPrefixes)
const COVERS = cfg.__coversRe;           // @covers <PREFIX>-NNN/FR-NNN (from specIdPrefixes)
const PREFIXES = cfg.specIdPrefixes && cfg.specIdPrefixes.length ? cfg.specIdPrefixes : DEFAULTS.specIdPrefixes;

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (IGNORE.has(name)) continue;
      walk(p, acc);
    } else if (isTestFile(name, cfg)) {
      acc.push(p);
    }
  }
  return acc;
}

// 0. PREFIX whitelist pre-check — must run before spec collection.
//    Scans ALL ^[A-Z]+-NNN.md files; unregistered prefix → exit 1 (no silent skip).
//    Non-standard prefix without rationale → exit 1.
const STANDARD = new Set(["SPEC", "INFRA", "TEST", "CICD"]);
const allowed = new Set(cfg.specIdPrefixes && cfg.specIdPrefixes.length ? cfg.specIdPrefixes : DEFAULTS.specIdPrefixes);
const rationale = cfg.prefixRationale || {};
const prefixErrors = [];

for (const f of readdirSync(SPEC_DIR)) {
  const m = f.match(/^([A-Z]+)-\d{3}/);
  if (!f.endsWith(".md") || !m) continue;
  const pfx = m[1];
  if (!allowed.has(pfx)) {
    prefixErrors.push(`미등록 접두어 "${pfx}" (${f}) — 표준 SPEC/INFRA/TEST/CICD. 임의 생성 금지, 필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가`);
  } else if (!STANDARD.has(pfx) && !(rationale[pfx] && String(rationale[pfx]).trim())) {
    prefixErrors.push(`표준 밖 접두어 "${pfx}" — prefixRationale["${pfx}"]에 도입 사유 필요(빈 값 불가)`);
  }
}
// 0b. 접두어↔클래스 정합(SPEC-012): 소유(Files) 비-테스트 실파일이 **전적으로** iac/ci
//     클래스인 스펙은 INFRA- 접두어여야 한다 — STORAGE §2.2의 접두어 의미(readopt 착지
//     규칙 iac/ci→INFRA)를 기계 강제. 비-인프라 소유 파일이 하나라도 있으면 통과(전체성
//     임계 — 기능 SPEC-의 부수 IaC/CI 소유는 정당). 면제는 prefixClassExemptions(사유 필수).
const exemptions = cfg.prefixClassExemptions || {};
const specMdNames = readdirSync(SPEC_DIR).filter(isSpecMdName).sort();
const knownIds = new Set(specMdNames.map((f) => f.match(SPEC_ID)?.[0]).filter(Boolean));
prefixErrors.push(...validateExemptions(exemptions, knownIds));
const classGlobs = {};
{
  const userGlobs = cfg.derivationClassGlobs || {};
  for (const cls of INFRA_SOURCE_CLASSES) classGlobs[cls] = (userGlobs[cls] || DEFAULTS.derivationClassGlobs[cls] || []).map(compileGlob);
}
// 레포 실재 순회 — ignoreDirs 제외·정렬(check-derivation과 동형, 결정성).
// 정본은 sdd-config의 walkFiles — 네 게이트에 본문 동일로 복붙돼 있던 것(R13 구조 중복).
const walkAll = (dir, relBase = "", acc = []) => walkFiles(dir, IGNORE, relBase, acc);
const allRepoFiles = walkAll(ROOT);
const testInfraGlobs = (cfg.testInfraGlobs || []).map(compileGlob); // SPEC-015: 테스트 인프라 네임스페이스
const prefixClassWarnings = [];
const ownershipUnits = [];   // {specId, specText, files:[…]} — 결정 입도 판정 입력(SPEC-044)
for (const f of specMdNames) {
  const id = f.match(SPEC_ID)?.[0];
  if (!id) continue; // 미등록 접두어는 위 0단계가 이미 에러 처리
  const pfx = f.match(/^([A-Z]+)-/)[1];
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const globs = parseSection(text, "Ownership", ["Files"]).Files.map(stripInlineComment).filter(Boolean).map(compileGlob);
  const matched = globs.length ? allRepoFiles.filter((p) => globs.some((re) => re.test(p))).sort() : [];
  const owned = matched.filter((p) => !isTestFile(p.split("/").pop(), cfg));
  // 결정 입도 축(SPEC-044)은 테스트도 본다 — 실측 사례의 `BASE_URL` 폴백은 e2e 설정에 있었다.
  if (matched.length) ownershipUnits.push({ specId: id, specText: text, files: matched });
  const finding = prefixClassFinding(pfx, owned, classGlobs);
  const exempted = !!String(exemptions[id] ?? "").trim();
  if (finding && finding.kind === "error") {
    if (!exempted) prefixErrors.push(`접두어↔클래스 부정합 "${id}" — 소유 실파일 ${finding.infra.length}건 전부 인프라-계열(예: ${finding.infra[0]}) → ${finding.expected.join("/")}- 접두어여야 함(STORAGE §2.2: iac→INFRA·ci→CICD). 부수 소유가 정당하면 prefixClassExemptions["${id}"]에 사유 등록`);
    continue;
  }
  if (exempted) prefixClassWarnings.push(`prefixClassExemptions["${id}"]: 현재 접두어↔클래스 위반 아님 — 선등록이 아니면 정리 대상`);
  if (finding && finding.kind === "warn") prefixClassWarnings.push(`${id}: ${finding.prefix}- 접두어인데 소유 Files의 해당 클래스(${finding.prefix === "INFRA" ? "iac" : "ci"}) 검출 0건 — 레포 밖 실체(evidence로 확인) 또는 접두어 재검토`);
  // 테스트 인프라 격리(SPEC-015): testInfraGlobs 매치 파일은 TEST 스펙만 소유.
  const tiFinding = testInfraFinding(pfx, owned, testInfraGlobs);
  if (tiFinding) prefixErrors.push(`테스트 인프라 격리 위반 "${id}" — testInfraGlobs 매치 파일(예: ${tiFinding.files[0]})은 TEST 스펙이 소유해야 함(제품 스펙 소유 금지, SPEC-015)`);
}
// 0c. 접두어별 spec-ID 번호 무결성(SPEC-014): 중복·001미시작 hard, 내부 gap advisory(--strict 승격).
{
  const { hard, advisory } = numberingIssues([...knownIds], cfg.retiredIds);
  prefixErrors.push(...hard);
  for (const a of advisory) (STRICT ? prefixErrors : prefixClassWarnings).push(a);
}
if (prefixErrors.length) {
  console.error("✗ PREFIX 위반:");
  for (const e of prefixErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// 1. Collect declared FRs per spec.
//    "선언"의 범위는 SPEC-013 frDeclarations 단일 정의 — `## Functional Requirements` 섹션 안의
//    라인 시작(불릿 유무 무관). 문서 전문 스캔은 Change Log의 이관·흡수 이력(`FR-011→**FR-037**`)을
//    선언으로 집계해 거짓 "FR 번호 중복" hard를 냈다(PM tool 실측 12건). 문법(cfg.__frDeclRe)은
//    SPEC-001 FR-009 공유 자산이라 손대지 않는다 — 좁힌 것은 범위뿐.
const specs = new Map();    // SPEC-ID -> Set(FR-ID)
const frDecls = new Map();
const clRefs = new Map();  // SPEC-ID -> {declared:Map, retired:Set} (SPEC-037)
const frEvidence = new Map(); // "SPEC/FR" -> [검증 경로…] (SPEC-039 대조 축)
const frText = new Map();     // "SPEC/FR" -> FR 선언 라인 원문 (SPEC-042 의미 커버리지 입력)
const normText = new Map();   // "SPEC/<FR|NFR|SC>" -> 규범 선언 라인 원문 (SPEC-046 지목 구현체 입력)
// 규범 선언 라인 문법 — 요구 접두어는 config에서 파생하고(사이트 간 통일) NFR·SC는 고정 어휘다.
const NORM_DECL = new RegExp(`^\\s*-?\\s*\\*\\*((?:${cfg.__reqAlt}|NFR|SC)-\\d{3}[a-z]?)\\*\\*`);
const coverTags = [];         // {file, specId, frId} — 양방향 결속 판정 입력  // SPEC-ID -> [FR-ID,...] 선언 순서 그대로(중복 판정용 — Set은 중복을 삼킨다)
for (const f of readdirSync(SPEC_DIR)) {
  if (!f.endsWith(".md") || !PREFIXES.some((p) => f.startsWith(p + "-"))) continue;
  const id = f.match(SPEC_ID)?.[0];
  if (!id) continue;
  const text = readFileSync(join(SPEC_DIR, f), "utf8");
  const list = frDeclarations(text, FR_DECL, cfg.__reqAlt);
  frDecls.set(id, list);
  specs.set(id, new Set(list));
  // FR 선언 라인별 `[검증: 경로]` — @covers 양방향 결속의 대조 축(SPEC-039). 새 문법 없음.
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|")) continue;                 // 표 행(Change Log)은 이력이지 선언이 아니다
    cfg.__frDeclRe.lastIndex = 0;
    const fr = cfg.__frDeclRe.exec(t);
    cfg.__frDeclRe.lastIndex = 0;
    if (!fr) continue;
    const paths = evidencePathsOf(t);
    if (paths.length) frEvidence.set(`${id}/${fr[1]}`, paths);
    if (!frText.has(`${id}/${fr[1]}`)) frText.set(`${id}/${fr[1]}`, t);
  }
  // 규범 선언 라인 전체(FR + NFR + SC) — 지목 구현체 참조 축(SPEC-046)의 입력.
  // **frText와 분리한다**: frText는 SPEC-042(의미 커버리지)가 FR만 보도록 정한 집합이고,
  // 여기서 넓히면 다른 축의 판정 범위가 조용히 바뀐다(킷 실측: 지목 구현체는 SC·NFR 라인에 많다).
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|")) continue;
    const m = NORM_DECL.exec(t);
    if (!m) continue;
    if (!normText.has(`${id}/${m[1]}`)) normText.set(`${id}/${m[1]}`, t);
  }
  // Change Log가 **선언한** FR 집합(SPEC-037) — 새 검사와 결번 advisory가 같은 소스를 쓴다.
  clRefs.set(id, changeLogFrRefs(text, cfg.__reqAlt, cfg.__idAlt, {
    neu: cfg.changeLogNewVerbs, rev: cfg.changeLogReviseVerbs, ret: cfg.changeLogRetireVerbs,
  }));
}

// 1b. FR 번호 무결성(SPEC-014 FR-005/006): 스펙별 001 연번 — 중복 hard, 001미시작·결번 advisory.
//     FR 선언 파싱은 cfg.__frDeclRe 단일 문법(SPEC-001 FR-009)을 그대로 소비한다(자체 정규식 없음).
const frNumHard = [], frNumAdvisory = [];
const clFindings = [];
const CL_POLICY = String(cfg.changeLogFrRefPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(CL_POLICY)) {
  console.error(`✗ changeLogFrRefPolicy 값 위반 "${CL_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
for (const id of [...frDecls.keys()].sort()) {
  const refs = clRefs.get(id) || { declared: new Map(), retired: new Set() };
  // 결번 advisory는 선언 집합을 참조해 문구가 갈린다(SPEC-037 FR-003) — 폐기 흔적(정당)과
  // "선언했는데 본문 없음"(결함)이 같은 문장으로 나오던 것을 끊는다. 판정 소스는 하나다.
  const { hard, advisory } = frNumberingIssues(id, frDecls.get(id),
    CL_POLICY === "off" ? new Set() : new Set(refs.declared.keys()));
  frNumHard.push(...hard);
  frNumAdvisory.push(...advisory);
  if (CL_POLICY !== "off") clFindings.push(...changeLogFrFindings(id, refs.declared, frDecls.get(id)));
}

// 2. Collect @covers tags from test files.
const covered = new Map();   // SPEC-ID -> Set(FR-ID covered)
const coverFiles = new Map();    // "SPEC/FR" -> Set(파일 절대경로) — 의미 커버리지 입력(SPEC-042)
const coverFileText = new Map(); // 파일 절대경로 -> 본문(태그가 있는 파일만 보관)
const coverSeen = new Set();       // "SPEC/FR" — 커버 태그가 하나라도 있는 FR
const runnableCovered = new Set(); // "SPEC/FR" — e2e가 **아닌** 파일이 커버한 FR
const badRefs = [];          // tags pointing to nonexistent FRs
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(COVERS)) {
      const [, spec, fr] = m;
      if (!covered.has(spec)) covered.set(spec, new Set());
      covered.get(spec).add(fr);
      // e2e-only 판정용: FR별로 "e2e가 아닌 커버 파일"이 하나라도 있었는지 기록.
      const key = `${spec}/${fr}`;
      coverSeen.add(key);
      coverTags.push({ file: file.replace(ROOT + "/", ""), specId: spec, frId: fr });
      if (!coverFiles.has(key)) coverFiles.set(key, new Set());
      coverFiles.get(key).add(file);
      if (!coverFileText.has(file)) coverFileText.set(file, text);
      if (!isE2eFile(file, cfg)) runnableCovered.add(key);
      const declared = specs.get(spec);
      if (!declared || !declared.has(fr)) {
        badRefs.push({ file, spec, fr });
      }
    }
  }
}

// 커밋 스테이징 집합(있으면) — 위반의 **귀속**을 가르는 데만 쓴다. 판정 집합은 워킹트리 전역이다.
// null = 알 수 없음(커밋 밖 실행·git 없음·CI) → 종전대로 전부 hard.
let commitScope = null;
try {
  const out = execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const staged = out.split("\n").map((x) => x.trim()).filter(Boolean);
  if (staged.length) commitScope = new Set(staged);
} catch { /* git 없음·저장소 아님 — 귀속 판정 불가 */ }

// 3. Evaluate rules.
const errors = [];
const warnings = [...prefixClassWarnings]; // 0b의 advisory(미사용 면제·INFRA 검출 0건)

// FR 번호 무결성(1b) 배선 — 중복은 정책 knob 없이 항상 hard, advisory는 `--strict`에서만 승격.
errors.push(...frNumHard);
for (const a of frNumAdvisory) (STRICT ? errors : warnings).push(a);
// Change Log ↔ FR 실재(SPEC-037): 선언만 하고 본문을 안 쓴 것. 처방을 함께 낸다 —
// 계약을 FR로 착지시키거나, 진짜 폐기라면 폐기로 표기해 정당한 흔적으로 만든다.
for (const f of clFindings) {
  const msg = `[${f.specId}] Change Log가 ${f.id} ${f.verb}를 선언했으나 FR 절에 본문 없음 — 계약을 FR로 착지시키거나, 폐기라면 "${f.id} 폐기"로 표기하라(changeLogFrRefPolicy=${CL_POLICY})`;
  (CL_POLICY === "hard" || STRICT ? errors : warnings).push(msg);
}

// R1: bad references
for (const { file, spec, fr } of badRefs) {
  // 귀속 분리(제보 곁가지 판정): 판정 집합은 **워킹트리 전역**을 유지한다 — 범위를 staged로 좁히면
  // 커밋 밖 파일의 dangling 태그가 영구히 안 보이고, 그 손실을 선택지로 내미는 것은 완화를 권장으로
  // 올리는 것과 같다(HARNESS 불변). 대신 **강도를 귀속으로 가른다**: 이 커밋이 건드리지 않은 파일의
  // 위반은 advisory로 낮춘다. 실측 제보: 커밋과 무관한 untracked 파일이 커밋을 막아 "파일을 잠시
  // 옮겨 커밋"이라는 우회를 유발했다 — 우회를 유발하는 강제는 강제가 아니다.
  // 스테이징 집합을 알 수 없으면(커밋 밖 실행·git 없음·CI) 종전대로 hard다 — CI는 전부 막는다.
  const relFile = file.replace(ROOT + "/", "");
  const msg = `R1 dangling @covers ${spec}/${fr} in ${relFile} — no such FR in ${spec}`;
  if (commitScope && !commitScope.has(relFile)) {
    warnings.push(`${msg} · **이 커밋 범위 밖**이라 차단하지 않는다(남아 있다 — 그 파일을 커밋할 때 막힌다)`);
  } else {
    errors.push(msg);
  }
}

// R1b: `@covers` 양방향 결속(SPEC-039) — 태그가 가리키는 FR과 FR이 인정하는 증거가 서로를 아는가.
// R1(dangling)은 **실재**만 본다: 번호가 겹치기만 하면 통과한다(실측 제보: 다른 세션이 무관한 기능을
// 같은 번호로 착지시킨 순간 위반이 사라지고 초록이 됐다). 실재는 동일성이 아니다.
const BL_POLICY = String(cfg.coversBacklinkPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(BL_POLICY)) {
  console.error(`✗ coversBacklinkPolicy 값 위반 "${BL_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (BL_POLICY !== "off") {
  const declaredKeys = new Set();
  for (const [sid, frs] of specs) for (const f of frs) declaredKeys.add(`${sid}/${f}`);
  const bl = coversBacklinkFindings(coverTags, frEvidence, declaredKeys,
    (pattern, path) => { try { return compileGlob(pattern).test(path); } catch { return false; } });
  const v = coversBacklinkVerdict(BL_POLICY, bl.counts);
  const cap = Number(cfg.coversBacklinkListCap) || 12;
  // 헤더는 **버킷 합과 맞아야 한다** — 태그 총량만 적으면 (파일,FR) 중복분이 사라진 것처럼 읽히고,
  // 그 외형이 곧 "조용한 누락"이다. 유일 건수와 총량을 함께 적어 차이를 설명한다.
  const uniq = bl.counts.matched + bl.counts.mismatch + bl.counts.unlabeled;
  const dedup = coverTags.length - uniq;
  console.log(`@covers 결속(coversBacklinkPolicy=${BL_POLICY}): 태그 ${coverTags.length}건 → 판정 ${uniq}건`
    + (dedup > 0 ? `(같은 파일이 같은 FR을 재태깅한 ${dedup}건은 1건으로 셈)` : "")
    + ` — 일치 ${bl.counts.matched}·불일치 ${bl.counts.mismatch}·미표기 ${bl.counts.unlabeled}`);
  const mism = bl.findings.filter((f) => f.kind === "mismatch");
  for (const f of mism.slice(0, cap)) {
    const msg = `[${f.specId}/${f.frId}] ${f.file} — FR의 검증 목록(${f.evidence.join(", ")})이 이 파일을 인정하지 않는다: **번호 충돌 의심**(태그와 FR이 서로 다른 것을 말하고 있다)`;
    (v.blocking ? errors : warnings).push(msg);
  }
  if (mism.length > cap) (v.blocking ? errors : warnings).push(`@covers 결속 불일치 … 외 ${mism.length - cap}건 (coversBacklinkListCap 상향으로 확인)`);
  // 미표기는 **위반이 아니다** — 표기 부채라 어떤 강도에서도 차단하지 않는다.
  // 섞으면 도입 첫날 수백 건이 쏟아져 본 신호(불일치)가 묻히고, 그러면 사람이 정책을 끈다.
  if (bl.counts.unlabeled) {
    console.log(`  · backlink 미표기 ${bl.counts.unlabeled}건(부채·비차단) — 해당 FR에 \`[검증: <경로>]\`가 없어 대조할 축이 없다. 표기하면 그 FR은 이 검사의 보호를 받는다.`);
  }
  if (!mism.length) console.log("  ✓ 결속 불일치 0건 — 태그와 FR이 서로를 인정한다(미표기는 위 별도 집계).");
}

// R1c: 의미 커버리지(SPEC-042) — R1은 번호의 실재를, R1b는 서로를 인정하는가를 본다. 둘 다
// 통과해도 남는 사실이 있다: **테스트가 FR이 이름 댄 대상을 아예 건드리지 않는 것**. 실측 제보
// (2026-08-10): FR이 "Claude in Chrome(MCP)"를 주장하는데 커버 테스트는 선택자가 문자열 "chrome"을
// 돌려주는지만 봤다 — 동어반복이 세 게이트를 모두 통과했다. 여기서 잡는 것은 그 중 값싸고 결정적인
// 한 조각뿐이다: FR이 등록 용어를 말했는데 커버 파일 어디에도 그 용어가 없다. 질(테스트가 의미를
// 시험하는가)은 여전히 리뷰의 몫이다(SPEC-031·039가 그은 경계 그대로).
const TC_POLICY = String(cfg.termCoveragePolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(TC_POLICY)) {
  console.error(`✗ termCoveragePolicy 값 위반 "${TC_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (TC_POLICY !== "off") {
  const glossary = cfg.termGlossary || [];
  if (!glossary.length) {
    // 0건이 아니라 "안 봤음"이다 — 용어집이 비면 이 축은 아무것도 대조하지 않는다(SPEC-040 규범).
    console.log(`의미 커버리지(termCoveragePolicy=${TC_POLICY}): **용어집 미선언 — 판정하지 않는다**.`
      + ` termGlossary에 FR이 이름 대는 프로토콜·외부 시스템·제품명을 등록하면 "그 이름이 커버 파일에 없다"를 대조한다`
      + `(킷은 산문에서 고유명사를 자동 추출하지 않는다 — 오탐 폭풍이라 이미 거부된 길이다).`);
  } else {
    const units = [];
    for (const [key, text] of frText) {
      const files = [...(coverFiles.get(key) || [])].sort();
      if (!files.length) continue;                          // 미커버는 R1/R2의 몫
      const [specId, frId] = key.split("/");
      units.push({ specId, frId, text, coveringTexts: files.map((f) => coverFileText.get(f) || "") });
    }
    const tcFindings = termCoverageFindings(units, glossary);
    const judgedUnits = units.length;
    console.log(`의미 커버리지(termCoveragePolicy=${TC_POLICY}): 용어 ${glossary.length}종 × 커버된 FR ${judgedUnits}건 대조`
      + ` — 미실증 ${tcFindings.length}건`);
    const tcCap = Number(cfg.termCoverageListCap) || 12;
    for (const f of tcFindings.slice(0, tcCap)) {
      const msg = `[${f.specId}/${f.frId}] FR이 "${f.term}"을(를) 주장하는데 이 FR을 커버하는 어떤 파일에도 그 이름이 없다`
        + ` — 대상을 실제로 건드리는 검증을 추가하거나, 구현이 다른 이름을 쓴다면 termGlossary 동의어로 등록하라`;
      (TC_POLICY === "hard" || STRICT ? errors : warnings).push(msg);
    }
    if (tcFindings.length > tcCap) {
      (TC_POLICY === "hard" || STRICT ? errors : warnings).push(`의미 커버리지 미실증 … 외 ${tcFindings.length - tcCap}건 (termCoverageListCap 상향으로 확인)`);
    }
    if (!tcFindings.length) console.log("  ✓ 등록 용어를 주장한 FR은 모두 그 이름을 커버 파일에서 확인할 수 있다.");
  }
}

// R1d: 결정 입도(SPEC-044) — 소유는 파일 단위인데 동작을 정하는 결정은 파일 안에 있다.
// 실측 제보(2026-08-10): `process.env.BASE_URL || "https://api.example-vendor.com"` 한 줄이 배포
// 대상을 정하는데 어떤 FR도 그 대상을 인정하지 않았고, 소유·커버리지·spec-sync가 전부 초록이었다.
// 소유의 입도를 줄 단위로 낮추지 않는다 — 좁히는 것은 **결정의 종류**다: 폴백 기본값이 외부
// 대상(다른 시스템의 주소·계정·자격)이면 그건 구현 세부가 아니라 계약이고, 계약은 스펙이 안다.
// 소유 파일·소스 본문 캐시 — R1d와 R1e가 같은 파일을 두 번 읽지 않게 한다.
const fileTextCache = new Map();
const readCached = (rel) => {
  if (fileTextCache.has(rel)) return fileTextCache.get(rel);
  let t = null; try { t = readFileSync(join(ROOT, rel), "utf8"); } catch { /* 읽지 못한 파일은 없는 것으로 본다 */ }
  fileTextCache.set(rel, t);
  return t;
};

const XT_POLICY = String(cfg.externalTargetPolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(XT_POLICY)) {
  console.error(`✗ externalTargetPolicy 값 위반 "${XT_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (XT_POLICY !== "off") {
  const units = [];
  for (const u of ownershipUnits) {
    for (const rel of u.files) {
      const text = readCached(rel);
      if (text === null) continue;
      units.push({ path: rel, text, specId: u.specId, specText: u.specText });
    }
  }
  const xt = externalTargetFindings(units, cfg.localHostPatterns);
  console.log(`결정 입도(externalTargetPolicy=${XT_POLICY}): 소유 파일 ${units.length}건에서 env 폴백 기본값 검사 — 미공개 외부 대상 ${xt.length}건`);
  const xtCap = Number(cfg.externalTargetListCap) || 12;
  for (const f of xt.slice(0, xtCap)) {
    const msg = `[${f.specId}] ${f.path}: \`${f.env}\` 폴백 기본값 "${f.value}"(${f.kind})이 외부 대상인데 소유 스펙이 그 대상을 언급하지 않는다`
      + ` — 환경변수가 비면 여기로 간다는 사실은 계약이다. FR·Edge Cases 어디든 스펙 본문에 적어라(위치는 강제하지 않는다)`;
    (XT_POLICY === "hard" || STRICT ? errors : warnings).push(msg);
  }
  if (xt.length > xtCap) (XT_POLICY === "hard" || STRICT ? errors : warnings).push(`결정 입도 미공개 … 외 ${xt.length - xtCap}건 (externalTargetListCap 상향으로 확인)`);
  if (!xt.length) console.log("  ✓ 소유 파일의 env 폴백 기본값 중 스펙이 모르는 외부 대상은 없다(미소유 파일은 R4가 본다).");
}

// R1e: 지목 구현체 참조(SPEC-046) — **스펙이 이름으로 지목한 메커니즘은 실행 경로에 있어야 한다.**
// 실측 제보(사례 4): FR이 `extractDeployTickets()`를 메커니즘으로 지목했는데 표면은 그 함수를
// 부르지 않고 쉘로 같은 일을 다시 구현했다. 두 규칙이 갈라졌고 쉘 쪽에만 결함이 둘 있어 19건이
// 배포 범위에서 조용히 누락됐다. 커버 테스트는 **버그 있는 쉘 구현이 거기 있는지**를 단언했고,
// 지목된 함수는 테스트만 통과하는 고아 구현이었다. 게이트는 전부 초록이었다.
// 이름은 저자가 백틱으로 명시한 것이라 선언 없이도 오탐이 없다(SPEC-042가 거부한 자동 추출과 다르다).
const IR_POLICY = String(cfg.implReferencePolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(IR_POLICY)) {
  console.error(`✗ implReferencePolicy 값 위반 "${IR_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (IR_POLICY !== "off") {
  const PROSE = new RegExp(String(cfg.implReferenceProseRegex || DEFAULT_IMPL_PROSE_REGEX));
  const isTestName = (n) => isTestFile(String(n).split("/").pop(), cfg);
  const irUnits = [];
  for (const [key, text] of normText) {
    const names = namedImplementations(text, isTestName, cfg.implModuleExtensions);
    if (!names.length) continue;
    const [specId, frId] = key.split("/");
    irUnits.push({ specId, frId, names, key });
  }
  // 실행 경로 = 저장소의 비-테스트·비-산문 소스. **소유 경계를 넘는다** — 라이브러리는 다른
  // 스펙의 파일이 정당하게 소비하고, 소유 안에서만 찾으면 정상 모듈이 거짓 고아로 뜬다(킷 실측 3건).
  const sources = [];
  if (irUnits.length) {
    for (const rel of allRepoFiles) {
      if (isTestName(rel) || PROSE.test(rel)) continue;
      const text = readCached(rel);
      if (text !== null) sources.push({ path: rel, text });
    }
  }
  const irFindings = implReferenceFindings(irUnits, sources);
  // ② 검증 경로 — 지목 이름이 커버 파일에도 없으면 그 테스트는 FR의 주장이 아니라 현재 구현의
  //    형태를 단언하고 있을 개연성이 높다. 판정은 SPEC-042의 코어를 재사용한다(중복 구현 금지).
  const irCoverFindings = [];
  for (const u of irUnits) {
    const files = [...(coverFiles.get(u.key) || [])].sort();
    if (!files.length) continue;                       // 미커버는 R1/R2의 몫
    const unit = { specId: u.specId, frId: u.frId, text: normText.get(u.key), coveringTexts: files.map((f) => coverFileText.get(f) || "") };
    for (const f of termCoverageFindings([unit], u.names.map((n) => n.name))) irCoverFindings.push(f);
  }
  const irTotal = irUnits.reduce((n, u) => n + u.names.length, 0);
  console.log(`지목 구현체 참조(implReferencePolicy=${IR_POLICY}): FR ${irUnits.length}건이 백틱으로 지목한 구현체 ${irTotal}종`
    + ` × 소스 ${sources.length}건 — 미참조 ${irFindings.length}건 · 커버 미언급 ${irCoverFindings.length}건`);
  const irCap = Number(cfg.implReferenceListCap) || 12;
  const irBlock = IR_POLICY === "hard" || STRICT ? errors : warnings;
  for (const f of irFindings.slice(0, irCap)) {
    irBlock.push(f.refs === 0
      ? `[${f.specId}/${f.frId}] FR이 지목한 ${f.kind === "fn" ? "함수" : "모듈"} \`${f.name}\`이 저장소의 비-테스트 소스에 **아예 없다**`
        + ` — 스펙이 말하는 메커니즘과 실제 실행 경로가 다르다(이름이 바뀌었거나 다른 구현으로 대체됐다)`
      : `[${f.specId}/${f.frId}] FR이 지목한 ${f.kind === "fn" ? "함수" : "모듈"} \`${f.name}\`이 정의만 있고 참조되지 않는다(등장 ${f.refs}회 < 기준 ${f.bar})`
        + ` — **고아 구현**이다. 표면이 같은 일을 따로 구현했는지 확인하고, 그렇다면 지목된 쪽으로 통일하라(재구현은 규칙이 갈라진다)`);
  }
  if (irFindings.length > irCap) irBlock.push(`지목 구현체 미참조 … 외 ${irFindings.length - irCap}건 (implReferenceListCap 상향으로 확인)`);
  for (const f of irCoverFindings.slice(0, irCap)) {
    irBlock.push(`[${f.specId}/${f.frId}] FR이 지목한 \`${f.term}\`이 이 FR을 커버하는 어떤 파일에도 없다`
      + ` — 그 테스트는 FR의 주장이 아니라 **현재 구현의 형태**를 단언하고 있을 수 있다(그런 테스트는 회귀를 막지 않고 수정을 막는다)`);
  }
  if (irCoverFindings.length > irCap) irBlock.push(`커버 미언급 … 외 ${irCoverFindings.length - irCap}건 (implReferenceListCap 상향으로 확인)`);
  if (!irUnits.length) console.log("  · 백틱으로 구현체를 지목한 FR 0건 — 이 축은 대조할 이름이 없다(FR이 함수는 `name()`, 모듈은 `name.ext` 꼴로 지목하면 판정이 시작된다).");
  else if (!irFindings.length && !irCoverFindings.length) console.log("  ✓ 지목된 구현체는 모두 실행 경로에서 참조되고 커버 파일이 그 이름을 안다.");
}

// 3b. 검증 회계(SPEC-007): smokeManifest 로드·검증 + strictSpecs 검증.
//     manifest 미설정 && requireAccounting=false && strictSpecs=[] → 현행 동작(출력 동일).
const { entries: manifest, errors: manifestErrors } = loadManifest(cfg, specs);
errors.push(...manifestErrors);
const strictSpecs = new Set(cfg.strictSpecs || []);
for (const id of [...strictSpecs].sort()) {
  if (!specs.has(id)) errors.push(`strictSpecs에 존재하지 않는 spec "${id}" — 오타/삭제 확인(조용한 스킵 금지)`);
}
const accountingActive = manifest !== null || !!cfg.requireAccounting;
// SPEC-018 FR-005: Status: Planned 스펙 — 미커버 FR을 planned로 회계(R3 미검증 아님).
const plannedSpecs = new Set();
for (const f of specMdNames) {
  const id = f.match(SPEC_ID)?.[0]; if (!id) continue;
  if (parseStatus(readFileSync(join(SPEC_DIR, f), "utf8")) === "Planned") plannedSpecs.add(id);
}
const e2eOnly = new Set([...coverSeen].filter((k) => !runnableCovered.has(k)));
const acct = accountingActive ? classify(specs, covered, manifest, plannedSpecs, e2eOnly) : null;
// Planned↔커버리지 모순(SPEC-018 FR-007): Planned는 "안 지음" 선언인데 unit 커버 FR이 실재하면 모순 —
// Active→Planned 뒤집기로 strictSpecs·R3를 침묵시키는 "회계 침묵기" 경로를 hard 차단(감사 T2).
for (const spec of [...plannedSpecs].sort()) {
  const cov = covered.get(spec);
  if (cov && cov.size > 0) {
    errors.push(`Planned 모순 ${spec}: Status Planned인데 unit 커버 FR ${cov.size}개 — 구현이면 Status 승격, 폐기면 sdd-retire(Planned=의도적 미구현 선언, SPEC-018)`);
  }
}

// R2: coverage completeness.
//   - incremental (default): partial coverage WARNS (adopt FR by FR).
//   - strict / strictSpecs 등재: every FR MUST be unit-covered(smoke/deferred 대체 불가), else error.
for (const [spec, frs] of specs) {
  const cov = covered.get(spec) ?? new Set();
  const hard = STRICT || strictSpecs.has(spec);
  const label = STRICT ? "R2(strict)" : "R2(strictSpecs)";
  if (cov.size === 0) {
    const planned = plannedSpecs.has(spec);
    const msg = `${spec}: 0/${frs.size} FRs covered (${planned ? "planned — 의도적 미구현" : "not yet implemented"})`;
    if (hard && frs.size > 0 && !planned) errors.push(`${label} ${msg}`);
    else warnings.push(msg);
    continue;
  }
  // 정렬 필수(Python판 sdd_gates.py는 sorted — SPEC-006 패리티). 선언 순서로 두면 FR을 번호 순이
  // 아니게 선언한 스펙에서 양판 출력이 갈린다(소비 프로젝트 PM SPEC-004·SPEC-010 실측).
  const missing = [...frs].filter((fr) => !cov.has(fr)).sort();
  if (missing.length) {
    const msg = `${spec}: ${cov.size}/${frs.size} FRs covered — missing ${missing.join(", ")}`;
    if (hard) errors.push(`${label} ${msg}`);
    else warnings.push(msg);
  } else {
    warnings.push(`${spec}: ${cov.size}/${frs.size} FRs covered ✓`);
  }
}

// e2e-only 표면화: 태그는 있지만 로컬 스위트가 실행하지 않는 FR. e2e 실행 축(SPEC-021 확장,
// `e2eTestsPolicy`)이 꺼져 있으면 **아무도 이 FR들을 실행 검증하지 않는다** — 그 사실을 매 실행
// 드러낸다(감춰지면 "covered ✓"가 실행 green으로 오인된다).
if (acct && acct.counts.e2e > 0) {
  const axis = String(cfg.e2eTestsPolicy || "off");
  const list = [...acct.classes].filter(([, c]) => c === "e2e").map(([k]) => k).sort();
  if (axis === "off") {
    warnings.push(`⚠ e2e-only ${acct.counts.e2e}건 — e2e로만 커버돼 실행 검증하는 게이트가 없다(e2eTestsPolicy:off). commands.e2e 선언 후 정책을 켜거나, 실행 불가면 evidence로 회계하라: ${list.slice(0, 8).join(", ")}${list.length > 8 ? ` 외 ${list.length - 8}건` : ""}`);
  } else {
    warnings.push(`· e2e-only ${acct.counts.e2e}건 — e2e 실행 축(e2eTestsPolicy:${axis})이 판정한다`);
  }
}

// R3(requireAccounting): 모든 FR이 unit ∨ smoke ∨ deferred — "조용히 미검증" 제거.
if (cfg.requireAccounting) {
  for (const [spec, frs] of specs) {
    for (const fr of [...frs].sort()) {
      if (acct.classes.get(`${spec}/${fr}`) === "unaccounted") {
        errors.push(`R3 unaccounted ${spec}/${fr} — unit·smoke·deferred 어느 것도 아님(requireAccounting)`);
      }
    }
  }
}

// 4. Report.
const totalFR = [...specs.values()].reduce((n, s) => n + s.size, 0);
const totalCov = [...covered.values()].reduce((n, s) => n + s.size, 0);
const cfgTag = cfg.__path ? cfg.__path.replace(ROOT + "/", "") : "defaults(JS/TS)";
const acctTag = acct ? ` accounted(unit:${acct.counts.unit} e2e:${acct.counts.e2e} smoke:${acct.counts.smoke} deferred:${acct.counts.deferred} planned:${acct.counts.planned} unaccounted:${acct.counts.unaccounted})` : "";
// 스펙이 0개면 "커버 완료"가 아니라 "볼 스펙이 없었음"이다.
if (!specs.size) verdict(VERDICT_KINDS.INERT, "판정 대상 스펙 0건 — specDir에서 FR 선언을 찾지 못했다");
else judged(errors.length);
console.log(`FR coverage gate — specs:${specs.size} FRs:${totalFR} covered:${totalCov}${acctTag} mode:${STRICT ? "strict" : "incremental"} config:${cfgTag}`);
for (const w of warnings) console.log(`  · ${w}`);
if (errors.length) {
  console.error("\nFR coverage violations:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("FR coverage gate: OK");
