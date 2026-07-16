#!/usr/bin/env node
// ─── spec-first 강제 게이트 (§5) ─────────────────────────────
// 소유(Files) 코드가 바뀌면 소유 스펙의 의미 있는 변경(FR/Edge Cases/Change Log)이
// 같은 changeset(브랜치=staged ∪ base...HEAD, §5.8)에 있어야 한다.
// 모드: --staged --message-file <p> = hard(exit 1, commit-msg 훅) / [base] = range advisory(exit 0).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadConfig } from "./sdd-config.mjs";
import { parseSection } from "./ownership-keys.mjs";
import { compileGlob, scanFilesLineIssues, stripInlineComment, hasMeaningfulSpecChange } from "./spec-sync-lib.mjs";
import { parseStatus } from "./lifecycle-lib.mjs";

const cfg = loadConfig();
const args = process.argv.slice(2);
const STAGED = args.includes("--staged");
const mi = args.indexOf("--message-file");
const MSG = mi >= 0 ? args[mi + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && (mi < 0 || i !== mi + 1)); // mi=-1일 때 args[0](base)이 mi+1=0으로 오배제되던 버그 수정
const BASE = positional[0] || process.env.SDD_DIFF_BASE || "origin/main";

// core.quotepath=off: 비ASCII 경로가 8진수 인용 문자열("\353…")로 나오면 glob 매칭이 조용히 깨진다(도그푸딩 발견).
const sh = (c) => execSync(c.replace(/^git /, "git -c core.quotepath=off "), { cwd: cfg.__root, encoding: "utf8" });
const shOk = (c) => { try { return sh(c); } catch { return null; } };
const lines = (s) => (s || "").split("\n").map((x) => x.trim()).filter(Boolean);

// ① 트레일러(§5.5): staged 모드에서만.
if (STAGED && MSG) {
  const msg = readFileSync(MSG, "utf8");
  const m = msg.match(/^Spec-Impact:\s*none\s*(.*)$/m);
  if (m) {
    if (!m[1].trim()) { console.error("✗ spec-sync: `Spec-Impact: none`은 사유 필수 (`Spec-Impact: none <사유>`)"); process.exit(1); }
    console.log(`spec-sync: Spec-Impact: none — 통과 (사유: ${m[1].trim()}) [트레일러가 커밋에 영속]`);
    process.exit(0);
  }
}

// ② 변경 파일 수집(§5.7): staged = cached ∪ base...HEAD / range = base...HEAD.
const branchDiffOk = shOk(`git rev-parse -q --verify ${BASE}`) !== null && shOk(`git diff --name-only ${BASE}...HEAD`) !== null;
const changed = new Set();
if (branchDiffOk) lines(shOk(`git diff --name-only ${BASE}...HEAD`)).forEach((f) => changed.add(f));
else console.log(`· spec-sync: base(${BASE}) 해석 불가 — ${STAGED ? "staged만 판정(경고)" : "판정 불가, 건너뜀"}`);
if (STAGED) lines(sh("git diff --cached --name-only")).forEach((f) => changed.add(f));
if (!STAGED && !branchDiffOk) process.exit(0);

// ③ 스펙 로드(§5.1): HEAD ∪ index 합집합(삭제 가시화).
const specPaths = new Set([
  ...lines(shOk(`git ls-files -- ${cfg.specDir}`) || ""),
  ...lines(shOk(`git ls-tree -r --name-only HEAD -- ${cfg.specDir}`) || ""),
].filter((p) => p.endsWith(".md")));
const specs = []; // {id, path, globs[], deletedInIndex}
const warnedGlobSpec = new Set(); // track warned spec ids to dedupe per-spec
for (const p of specPaths) {
  const idx = shOk(`git show :${p}`);
  const head = shOk(`git show HEAD:${p}`);
  const text = idx ?? head ?? "";
  const id = (text.match(cfg.__specIdRe) || [p])[0];
  const globs = new Set();
  for (const src of [idx, head]) {
    if (!src) continue;
    for (const raw of src.split("\n")) {
      if (/^-\s*\*\*Files\*\*\s*:/.test(raw)) {
        const issues = scanFilesLineIssues(raw);
        if (issues.length && !warnedGlobSpec.has(id)) {
          warnedGlobSpec.add(id);
          // staged(hard)에서는 위반(SPEC-013): 미지원 토큰은 매치 실패 = 소유가 조용히 풀린다(금지 문법).
          console.log(`${STAGED ? "✗" : "⚠"} [${id}] Files에 미지원 glob 문법 ${issues.join(" ")} — **·* 만 지원(§4.1), 해당 토큰은 매치되지 않을 수 있음`);
        }
      }
    }
    parseSection(src, "Ownership", ["Files"]).Files.map(stripInlineComment).filter(Boolean).forEach((g) => globs.add(g));
  }
  specs.push({ id, path: p, globs: [...globs].map((g) => ({ g, re: compileGlob(g) })), deletedInIndex: idx === null && head !== null, status: parseStatus(text) });
}

// ④ 판정: 변경 코드 파일 → 소유 스펙(AND, §6.1) → 의미 변경(두-이미지 합집합, §5.4·§5.8).
// 미소유 파일은 specSyncUnownedPolicy가 선언한 대로 — silent(현행)/warn/error(closed-world).
const POLICY = cfg.specSyncUnownedPolicy || "silent";
if (!["silent", "warn", "error"].includes(POLICY)) {
  console.error(`✗ specSyncUnownedPolicy 값 위반 "${POLICY}" — silent|warn|error 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
// Draft 소유 코드 차단(SPEC-008 FR-004)을 range 모드에서도 hard로 승격할지 — CI가 range 모드로
// MR diff를 검사하면 로컬 commit-msg 훅을 타지 않는 웹 UI 병합도 이 정책으로 막을 수 있다(SPEC-008 FR-007).
const DRAFT_POLICY = cfg.draftBlockPolicy || "advisory";
if (!["advisory", "hard"].includes(DRAFT_POLICY)) {
  console.error(`✗ draftBlockPolicy 값 위반 "${DRAFT_POLICY}" — advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const exempt = (cfg.specSyncExemptGlobs || []).map(compileGlob);
const specSet = new Set(specs.map((s) => s.path));
const violations = []; // {file, spec}
const unowned = [];    // 어떤 스펙 Files에도 매치 안 된 변경 파일(exempt 제외)
const memo = new Map(); // spec.path -> boolean(meaningful)
function meaningful(spec) {
  if (memo.has(spec.path)) return memo.get(spec.path);
  let ok = false;
  if (spec.deletedInIndex) { console.log(`⚠ [${spec.id}] 스펙 파일 삭제 — 의미 변경으로 인정(수명주기 리뷰 대상)`); ok = true; }
  if (!ok && STAGED) {
    const d = shOk(`git diff --cached -- ${spec.path}`);
    const post = shOk(`git show :${spec.path}`);
    if (d && post && hasMeaningfulSpecChange(post, d, cfg.__reqAlt)) ok = true;
  }
  if (!ok && branchDiffOk) {
    const d = shOk(`git diff ${BASE}...HEAD -- ${spec.path}`);
    const post = shOk(`git show HEAD:${spec.path}`);
    if (d && post && hasMeaningfulSpecChange(post, d, cfg.__reqAlt)) ok = true;
  }
  memo.set(spec.path, ok);
  return ok;
}
for (const f of changed) {
  if (specSet.has(f) || f.startsWith(cfg.specDir + "/")) continue;      // 스펙 자신은 코드 아님
  if (exempt.some((re) => re.test(f))) { console.log(`· exempt: ${f} (specSyncExemptGlobs — 영속 흔적 없음)`); continue; }
  let owned = false;
  for (const s of specs) {
    if (!s.globs.some(({ re }) => re.test(f))) continue;
    owned = true;
    // Draft 차단(SPEC-008): Draft 스펙의 소유 코드는 스펙 동반 여부와 무관하게 위반 —
    // 상태 순서 강제(리뷰 후 Reviewed 이상으로 승격이 정공법). 삭제 중 스펙은 제외(수명 종료 경로).
    if (s.status === "Draft" && !s.deletedInIndex) { violations.push({ file: f, spec: s.id, draft: true }); continue; }
    if (!meaningful(s)) violations.push({ file: f, spec: s.id });
  }
  if (!owned && POLICY !== "silent") unowned.push(f);
}

// ⑤ 리포트. unowned는 정책대로 — warn은 어디서든 advisory, error는 staged에서만 hard(range는 advisory).
const unownedHard = POLICY === "error" && STAGED && unowned.length > 0;
const mode = STAGED ? "staged(hard)" : `range(advisory, base:${BASE})`;
console.log(`spec-sync 게이트 — mode:${mode} changed:${changed.size} specs:${specs.length}`);
for (const f of unowned) {
  console.log(`  ${unownedHard ? "✗" : "⚠"} unowned: ${f} — 어떤 스펙의 Files에도 매치 안 됨(specSyncUnownedPolicy=${POLICY})`);
}
if (unownedHard && !violations.length) {
  console.error(`\n✗ unowned 파일(closed-world): 소유 스펙의 Files glob에 편입하거나, 의도적 예외면 specSyncExemptGlobs에 선언하라.`);
  process.exit(1);
}
// 미지원 glob 문법은 staged(hard)에서 차단(SPEC-013) — range는 advisory 유지(점진 도입 경로).
const globHard = STAGED && warnedGlobSpec.size > 0;
if (globHard && !violations.length) {
  console.error(`\n✗ Files glob 미지원 문법(§4.1): **·* 만 지원 — 해당 스펙의 Files 글롭을 지원 문법으로 정정하라(매치 실패 = 소유가 조용히 풀림).`);
  process.exit(1);
}
if (!violations.length) { console.log("spec-sync: OK — 소유 코드 변경에 스펙 동반됨(또는 대상 없음)."); process.exit(0); }
// draftBlockPolicy=hard: range 모드에서도 Draft 위반을 hard로 승격(SPEC-008 FR-007) — 웹 UI 병합이
// 로컬 commit-msg 훅을 안 타도 CI가 range 모드로 이 게이트를 돌리면 막을 수 있다.
const draftHard = !STAGED && DRAFT_POLICY === "hard" && violations.some((v) => v.draft);
for (const v of violations) console.log(v.draft
  ? `  ${STAGED || draftHard ? "✗" : "⚠"} ${v.file} → 소유 스펙 ${v.spec}이 Draft 상태 — Reviewed 이상 승격 전 코드 변경 금지`
  : `  ${STAGED ? "✗" : "⚠"} ${v.file} → 소유 스펙 ${v.spec}에 의미 있는 변경 없음(FR/Edge Cases/Change Log)`);
if (STAGED) {
  console.error(`\n✗ spec-first 위반: 소유 스펙을 같은 changeset에 갱신하라(스펙 Change Log에 항목 추가). Claude Code는 /speckit.fix.`);
  console.error(`  · 스펙을 이미 수정했다면 \`git add\`로 스테이징했는지 확인(§6.2).`);
  if (violations.some((v) => v.draft)) console.error(`  · Draft 스펙은 리뷰(/analyze·/checklist) 기록 후 Status를 Reviewed 이상으로 승격해야 코드 변경 가능(SPEC-008).`);
  if (unownedHard) console.error(`  · unowned 파일은 Files glob 편입 또는 specSyncExemptGlobs 선언으로 해소(closed-world).`);
  console.error(`  · 진짜 스펙 무관이면 커밋 메시지에 \`Spec-Impact: none <사유>\` 트레일러.`);
  process.exit(1);
}
if (draftHard) {
  console.error(`\n✗ draftBlockPolicy=hard: Draft 소유 코드 변경은 range 모드에서도 차단된다 — 리뷰(/analyze·/checklist) 후 Status를 Reviewed 이상으로 승격하라(SPEC-008).`);
  process.exit(1);
}
console.log("spec-sync: advisory — node scripts/sdd-sync.mjs로 정렬 검토(Claude Code: /sdd-sync·/speckit.fix).");
