// tooling/__tests__/grammar-hardening.test.mjs
// 스펙 문법 규범 강제(SPEC-013) — 순수 코어 + completeness/ownership/spec-sync 게이트 통합.
// @covers SPEC-013/FR-001
// @covers SPEC-013/FR-002
// @covers SPEC-013/FR-003
// @covers SPEC-013/FR-004
// @covers SPEC-013/FR-005
// @covers SPEC-013/FR-006
// @covers SPEC-013/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @covers SPEC-013/FR-009
import { parseModule, frLinesMissingShall, frDeclarations, frDeclStyleFindings, dedupReviewDanglingIds, ownershipCategoriesFindings, exemptGlobFindings } from "../grammar-lib.mjs";

const FR_DECL_SRC = "\\*\\*((?:FR)-\\d{3}[a-z]?)\\*\\*";
const SPEC_ID_RE = /(?:SPEC|INFRA|TEST)-\d{3}/;

// ── 순수 코어 ──

test("parseModule: 백틱·비백틱·부재", () => {
  assert.equal(parseModule("**Module**: `sdd-tooling`  **Spec**: `SPEC-001`"), "sdd-tooling");
  assert.equal(parseModule("**Module**: mymod\n"), "mymod");
  assert.equal(parseModule("# 제목뿐\n"), null);
});

test("frLinesMissingShall: SHALL 없는 FR 선언 라인만 지목", () => {
  const text = "- **FR-001** (event): WHEN x, THE SYSTEM SHALL y.\n- **FR-002** (event): does y without keyword.\n- **FR-003a** THE SYSTEM SHALL z.\n";
  assert.deepEqual(frLinesMissingShall(text, FR_DECL_SRC), ["FR-002"]);
});

// 거짓 음성 회귀: 라인 규율이 `^\s*-\s*`(불릿 **필수**)였을 때 비불릿 선언은 SHALL 검사를 통째로
// 건너뛰었다. FR-008의 isFrDeclLine(불릿 옵션)으로 통일 — 선언 라인 정의는 킷에 하나뿐이어야 한다.
test("frLinesMissingShall: 비불릿 선언 라인도 검사한다 (불릿 필수 시절의 거짓 음성)", () => {
  const text = "**FR-001** (event): WHEN x, THE SYSTEM SHALL y.\n"
    + "**FR-002** (event): does y without the keyword.\n"           // 비불릿·SHALL 없음 → 반드시 잡힌다
    + "  - **FR-003** (event): indented bullet, no keyword.\n"       // 들여쓴 불릿도 여전히 잡힌다
    + "산문 속 **FR-004** 인용은 선언이 아니다(라인 시작 아님).\n";  // 라인 시작 규율은 유지
  assert.deepEqual(frLinesMissingShall(text, FR_DECL_SRC), ["FR-002", "FR-003"]);
});

// 다중 접두어 함정: reqAlt를 넘기지 않으면 기본값 "FR"이 걸려 INFRA 선언이 라인 규율에서 탈락하고
// 검사가 조용히 사라진다(실측 finops 11줄). 호출부는 cfg.__reqAlt를 반드시 넘긴다.
test("frLinesMissingShall: reqAlt를 넘기면 다중 접두어(INFRA) 선언도 검사 — 기본값에 맡기면 무검사", () => {
  const src = "\\*\\*((?:FR|INFRA)-\\d{3}[a-z]?)\\*\\*";
  const text = "- **INFRA-001** (event): provisions the bucket without the keyword.\n"
    + "**INFRA-002** (event): non-bullet, also without the keyword.\n"
    + "- **FR-001** (event): THE SYSTEM SHALL x.\n";
  assert.deepEqual(frLinesMissingShall(text, src, "FR|INFRA"), ["INFRA-001", "INFRA-002"]);
  assert.deepEqual(frLinesMissingShall(text, src), []);  // reqAlt 생략 = INFRA가 통째로 빠지는 함정
});

// @covers SPEC-013/FR-008
test("frDeclarations: Change Log 표 행의 bold FR ID는 선언 아님 (PM SPEC-003 실측 오탐)", () => {
  const text = "## Functional Requirements (EARS)\n"
    + "**FR-037** (optional): WHERE x, THE SYSTEM SHALL render a badge.\n"
    + "\n## Change Log\n"
    + "| 2026-07-27 | SPEC-008 흡수 **완성** — FR-011→**FR-037**, FR-012→**FR-038** | 근거 |\n";
  assert.deepEqual(frDeclarations(text, FR_DECL_SRC), ["FR-037"]);
});

// @covers SPEC-013/FR-008
test("frDeclarations: FR 섹션 안 라인 시작 bold는 불릿 유무 무관하게 선언 (PM SPEC-004 실측 혼용)", () => {
  const text = "## Functional Requirements (EARS)\n"
    + "- **FR-057** (optional): WHERE a row matches, THE SYSTEM SHALL render a badge.\n"
    + "**FR-057** (event): WHEN a user accesses the page, THE SYSTEM SHALL fetch own rows.\n"
    + "  - **FR-058** (event): THE SYSTEM SHALL z.\n";
  assert.deepEqual(frDeclarations(text, FR_DECL_SRC), ["FR-057", "FR-057", "FR-058"]); // 순서·중복 유지
});

// @covers SPEC-013/FR-008
test("frDeclarations: 산문 중간 인용·같은 라인 뒤쪽 상호참조는 선언 아님 / FR 섹션 없으면 전문 폴백", () => {
  const scoped = "## Functional Requirements (EARS)\n"
    + "- **FR-001** (event): THE SYSTEM SHALL x — **FR-002**를 확장한다.\n"
    + "위 **FR-003**은 폐기되었다.\n"
    + "\n## Assumptions / Clarifications Retained\n- **FR-009** 관련 가정 보존\n";
  assert.deepEqual(frDeclarations(scoped, FR_DECL_SRC), ["FR-001"]); // 라인 첫 토큰만·다른 섹션 제외
  // FR 섹션 부재 → 전문 폴백(선언 집합이 통째로 비지 않게), 단 라인 시작 규율은 유지
  const noSection = "**Spec**: `SPEC-001`\n- **FR-001** (event): THE SYSTEM SHALL x.\n산문 속 **FR-002** 인용\n";
  assert.deepEqual(frDeclarations(noSection, FR_DECL_SRC), ["FR-001"]);
});

// @covers SPEC-013/FR-009
// 혼용 자체가 신호: 탐지(FR-008)·SHALL(FR-003)은 불릿 유무 무관이라 기계는 통과하지만, 한쪽 문법만
// 보는 grep·리뷰는 반대쪽을 통째로 놓친다(PM SPEC-004 실측: 진짜 번호 중복 FR-057 1건이 그렇게 숨었다).
test("frDeclStyleFindings: 한 스펙이 불릿·무불릿을 섞으면 1건 — 건수와 예시 ID를 지목", () => {
  const text = "## Functional Requirements (EARS)\n"
    + "- **FR-001** (event): THE SYSTEM SHALL x.\n"
    + "**FR-002** (event): THE SYSTEM SHALL y.\n"
    + "**FR-003** (event): THE SYSTEM SHALL z.\n";
  const f = frDeclStyleFindings(text, FR_DECL_SRC);
  assert.equal(f.length, 1);
  assert.match(f[0], /혼용/);
  assert.match(f[0], /불릿 1건\(예 FR-001\)/);
  assert.match(f[0], /무불릿 2건\(예 FR-002\)/);
});

// @covers SPEC-013/FR-009
test("frDeclStyleFindings: 한쪽 문법만이면 빈 배열 — 저장소 전체 통일을 강요하지 않는다", () => {
  const head = "## Functional Requirements (EARS)\n";
  const bulleted = head + "- **FR-001** (event): THE SYSTEM SHALL x.\n  - **FR-002** (event): THE SYSTEM SHALL y.\n";
  const plain = head + "**FR-001** (event): THE SYSTEM SHALL x.\n**FR-002** (event): THE SYSTEM SHALL y.\n";
  assert.deepEqual(frDeclStyleFindings(bulleted, FR_DECL_SRC), []);
  assert.deepEqual(frDeclStyleFindings(plain, FR_DECL_SRC), []);
  assert.deepEqual(frDeclStyleFindings(head, FR_DECL_SRC), []);  // 선언 0건도 혼용 아님
});

// @covers SPEC-013/FR-009
// 범위는 FR-008과 같은 규율(FR 섹션 안·라인 시작)이되 **폴백은 없다** — 다른 절은 요구 ID를 불릿으로
// 정당하게 인용하므로(Assumptions·Change Log) 전문 폴백을 켜면 그 인용이 "불릿 쪽"으로 집계돼 거짓
// 혼용이 난다. 판정 유보가 안전한 방향이다(advisory 신호일 뿐 커버리지 입력이 아니라서).
test("frDeclStyleFindings: 표 행·산문 인용은 무관 / FR 섹션 없으면 판정 유보(폴백 없음)", () => {
  const withNoise = "## Functional Requirements (EARS)\n"
    + "- **FR-001** (event): THE SYSTEM SHALL x.\n"
    + "산문 속 **FR-002** 인용은 선언이 아니다.\n"
    + "\n## Assumptions / Clarifications Retained\n- **FR-003** 관련 가정 보존\n"
    + "\n## Change Log\n| 2026-07-27 | 흡수 — FR-011→**FR-037** | 근거 |\n";
  assert.deepEqual(frDeclStyleFindings(withNoise, FR_DECL_SRC), []);
  // FR 섹션 부재: 전문 폴백을 하면 Assumptions의 불릿 인용과 무불릿 선언이 섞여 거짓 혼용이 된다
  const noSection = "**Spec**: `SPEC-001`\n**FR-001** (event): THE SYSTEM SHALL x.\n- **FR-002** 관련 가정\n";
  assert.deepEqual(frDeclStyleFindings(noSection, FR_DECL_SRC), []);
});

// @covers SPEC-013/FR-009
test("frDeclStyleFindings: reqAlt를 넘기면 다중 접두어 선언도 같은 라인 규율로 본다", () => {
  const src = "\\*\\*((?:FR|INFRA)-\\d{3}[a-z]?)\\*\\*";
  const text = "## Functional Requirements (EARS)\n"
    + "- **INFRA-001** (event): THE SYSTEM SHALL provision x.\n"
    + "**INFRA-002** (event): THE SYSTEM SHALL provision y.\n";
  assert.equal(frDeclStyleFindings(text, src, "FR|INFRA").length, 1);
  assert.deepEqual(frDeclStyleFindings(text, src), []);  // reqAlt 생략 = INFRA가 라인 규율에서 탈락
});

test("dedupReviewDanglingIds: 실재하지 않는 이웃 ID만 정렬 반환·섹션 없으면 빈 배열", () => {
  const text = "## Dedup-Review\n- 이웃 SPEC-001: 비중복\n- 이웃 SPEC-999(삭제됨)·INFRA-042 검토\n\n## Change Log\n";
  assert.deepEqual(dedupReviewDanglingIds(text, SPEC_ID_RE, new Set(["SPEC-001"])), ["INFRA-042", "SPEC-999"]);
  assert.deepEqual(dedupReviewDanglingIds("본문뿐", SPEC_ID_RE, new Set()), []);
});

test("ownershipCategoriesFindings: Files(대소문자 무관) 금지", () => {
  assert.equal(ownershipCategoriesFindings(["Entities", "Surfaces"]).length, 0);
  assert.match(ownershipCategoriesFindings(["Entities", "Files"])[0], /Files.*금지/);
  assert.equal(ownershipCategoriesFindings(["files"]).length, 1);
});

// ── completeness 게이트 통합 ──

function runGate(gate, files, config = {}, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-gram-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  try {
    const out = execFileSync("node", [join(process.cwd(), `tooling/${gate}`), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const FULL = (id, module, fr = "- **FR-001** THE SYSTEM SHALL x.") =>
  `# ${id}\n**Module**: \`${module}\`  **Spec**: \`${id}\`  **Status**: Draft\n${fr}\n- **SC-001**: 측정.\n\nAcceptance: Given x.\n\n## Ownership\n- **Entities**: thing${id.slice(-1)}\n`;

test("completeness: Module 헤더 없음 → warn, --strict → exit 1", () => {
  const spec = `# SPEC-001\n**Spec**: \`SPEC-001\`  **Status**: Draft\n- **FR-001** THE SYSTEM SHALL x.\n- **SC-001**: y.\n\nAcceptance: Given.\n`;
  const soft = runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec });
  assert.equal(soft.code, 0, soft.out);
  assert.match(soft.out, /Module 헤더 없음/);
  assert.equal(runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec }, {}, ["--strict"]).code, 1);
});

test("completeness: Module 값 불일치(1 레포=1 모듈) → warn + 값 나열", () => {
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": FULL("SPEC-001", "mod-a"),
    "sdd/specs/SPEC-002.md": FULL("SPEC-002", "mod-b"),
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 레포 = 1 모듈/);
  assert.match(r.out, /mod-a, mod-b/);
});

test("completeness: SHALL 없는 FR 라인 → warn(FR ID 지목)", () => {
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": FULL("SPEC-001", "m", "- **FR-001** THE SYSTEM SHALL x.\n- **FR-002** just does y."),
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /FR-002.*SHALL 없음/);
  assert.doesNotMatch(r.out, /FR-001.*SHALL 없음/);
});

test("completeness: Dedup-Review의 dangling 이웃 ID → warn", () => {
  const spec = FULL("SPEC-001", "m") + `\n## Dedup-Review\n- 2026-07-06 이웃 SPEC-777: 비중복\n`;
  const r = runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /존재하지 않는 스펙 "SPEC-777"/);
});

test("completeness: 정합 스펙(Module 단일·SHALL·실재 이웃)은 신규 warn 0", () => {
  const a = FULL("SPEC-001", "m") + `\n## Dedup-Review\n- 이웃 SPEC-002: 비중복\n`;
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": a, "sdd/specs/SPEC-002.md": FULL("SPEC-002", "m"),
  });
  assert.equal(r.code, 0, r.out);
  for (const re of [/Module 헤더 없음/, /1 레포 = 1 모듈/, /SHALL 없음/, /존재하지 않는 스펙/]) assert.doesNotMatch(r.out, re);
});

// FR 섹션 헤딩이 있는 픽스처 — 문법 혼용 판정은 섹션 안만 보므로(폴백 없음) FULL로는 발화하지 않는다.
const FRSEC = (id, module, fr) =>
  `# ${id}\n**Module**: \`${module}\`  **Spec**: \`${id}\`  **Status**: Draft\n\n`
  + `## Functional Requirements (EARS)\n${fr}\n\n## Success Criteria\n- **SC-001**: 측정.\n\n`
  + `Acceptance: Given x.\n\n## Ownership\n- **Entities**: thing${id.slice(-1)}\n`;

// @covers SPEC-013/FR-009
test("completeness: FR 선언 문법 혼용 → warn, --strict → exit 1", () => {
  const spec = FRSEC("SPEC-001", "m",
    "- **FR-001** (event): THE SYSTEM SHALL x.\n**FR-002** (event): THE SYSTEM SHALL y.");
  const soft = runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec });
  assert.equal(soft.code, 0, soft.out);
  assert.match(soft.out, /FR 선언 문법 혼용/);
  assert.equal(runGate("check-spec-completeness.mjs", { "sdd/specs/SPEC-001.md": spec }, {}, ["--strict"]).code, 1);
});

// @covers SPEC-013/FR-009
test("completeness: 문법이 한쪽으로 통일된 스펙은 혼용 warn 0 (스펙별 판정 — 저장소 통일 강요 없음)", () => {
  const r = runGate("check-spec-completeness.mjs", {
    "sdd/specs/SPEC-001.md": FRSEC("SPEC-001", "m", "- **FR-001** (event): THE SYSTEM SHALL x."),
    "sdd/specs/SPEC-002.md": FRSEC("SPEC-002", "m", "**FR-001** (event): THE SYSTEM SHALL y."),
  });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /문법 혼용/);
});

// ── ownership 게이트 통합(Files 카테고리 금지) ──

test("ownership: ownershipCategories에 Files → exit 1", () => {
  const r = runGate("check-ownership.mjs",
    { "sdd/specs/SPEC-001.md": FULL("SPEC-001", "m") },
    { ownershipCategories: ["Entities", "Files"] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Files.*금지/);
});

// ── ownership 게이트 통합(면제 목록 무결성, FR-007) — Files 금지와 동형 배선 ──

test("ownership: specSyncExemptGlobs가 config 자신을 면제 → exit 1", () => {
  const spec = { "sdd/specs/SPEC-001.md": FULL("SPEC-001", "m") };
  for (const g of ["sdd.config.json", "*.json", "**/*.json"]) {
    const r = runGate("check-ownership.mjs", spec, { specSyncExemptGlobs: ["docs/**", g] });
    assert.equal(r.code, 1, `${g}: ${r.out}`);
    assert.match(r.out, /config 파일.*면제 금지/);
  }
});

test("ownership: 전면 면제(**) → exit 1 / 정상 면제만이면 통과", () => {
  const spec = { "sdd/specs/SPEC-001.md": FULL("SPEC-001", "m") };
  const bad = runGate("check-ownership.mjs", spec, { specSyncExemptGlobs: ["**"] });
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /전면 면제 금지/);
  // 교착 방지: 위험 항목을 지운 상태(=수정 커밋 시점)는 통과해야 한다.
  const ok = runGate("check-ownership.mjs", spec, { specSyncExemptGlobs: ["docs/**", "*.md"] });
  assert.equal(ok.code, 0, ok.out);
  assert.doesNotMatch(ok.out, /specSyncExemptGlobs 위반/);
});

// ── spec-sync staged: 미지원 glob 문법 hard ──

function repo() {
  const root = mkdtempSync(join(tmpdir(), "sdd-gram-ss-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  for (const f of ["check-spec-sync.mjs", "verdict-lib.mjs", "spec-sync-lib.mjs", "ownership-keys.mjs", "sdd-config.mjs", "lifecycle-lib.mjs", "grammar-lib.mjs", "key-anchor-lib.mjs", "drift-lib.mjs", "cross-spec-lib.mjs"])
    cpSync(join(process.cwd(), "tooling", f), join(root, "scripts", f));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  return { root, g };
}
const SS_SPEC = (files) => `# SPEC-001\n**Spec**: \`SPEC-001\`\n\n### Edge Cases\n- 기존\n\n**FR-001** THE SYSTEM SHALL x.\n\n## Ownership\n- **Files**: ${files}\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n| 2026-07-01 | 초안 | r |\n`;

function runSync(root, args) {
  try {
    const out = execFileSync("node", [join(root, "scripts/check-spec-sync.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("spec-sync: 미지원 glob 문법(?)은 staged=exit 1 / range=advisory 유지", () => {
  const { root, g } = repo();
  try {
    writeFileSync(join(root, "sdd/specs/SPEC-001.md"), SS_SPEC("src/lib/?.ts"));
    writeFileSync(join(root, "src/other.txt"), "x\n");
    g("add", "-A"); g("commit", "-qm", "base");
    writeFileSync(join(root, "src/other.txt"), "y\n");
    g("add", "-A");
    writeFileSync(join(root, "msg"), "chore: touch\n");
    const staged = runSync(root, ["--staged", "--message-file", "msg"]);
    assert.equal(staged.code, 1, staged.out);
    assert.match(staged.out, /미지원 glob 문법/);
    g("commit", "-qm", "c"); g("branch", "-m", "main");
    const range = runSync(root, ["HEAD~1"]);
    assert.equal(range.code, 0, range.out);
    assert.match(range.out, /미지원 glob 문법/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── specSyncExemptGlobs 무결성(FR-007) — 프로즈 금지의 게이트 승격(감사 A-4) ──

test("exemptGlobFindings: config 파일을 매치하는 글롭 금지(직접·와일드카드·전면)", () => {
  // 실측(finops): `sdd.config.json`이 exempt에 등재돼 config 변경이 무흔적 통과 — 모든 우회로의 문
  const direct = exemptGlobFindings(["sdd.config.json"]);
  assert.equal(direct.length, 1);
  assert.match(direct[0], /config 파일/);
  assert.equal(exemptGlobFindings(["*.json"]).length, 1);          // 와일드카드로 우회 불가
  assert.equal(exemptGlobFindings(["**/*.json"]).length, 1);
  assert.equal(exemptGlobFindings(["sdd*"]).length, 1);
  // 서브디렉토리 config(루트 상대경로 주입)
  assert.equal(exemptGlobFindings(["sub/sdd.config.json"], "sub/sdd.config.json").length, 1);
  assert.deepEqual(exemptGlobFindings(["sdd.config.json"], "sub/sdd.config.json"), []); // 다른 파일은 무관
});

test("exemptGlobFindings: 전면 면제(**·**/*)는 별도 사유로 금지", () => {
  for (const g of ["**", "**/*"]) {
    const f = exemptGlobFindings([g]);
    assert.equal(f.length, 1, g);
    assert.match(f[0], /전면 면제/);
  }
  // 한 목록에 둘 다 있으면 2건(선언 순)
  assert.equal(exemptGlobFindings(["**", "sdd.config.json"]).length, 2);
});

test("exemptGlobFindings: 정상 면제(생성물·문서·락파일)는 위반 아님 + 잘못된 값 무해", () => {
  assert.deepEqual(exemptGlobFindings([
    "docs/**", "*.md", "src/lib/pdf/generated/**", "pnpm-lock.yaml", "tooling/*.yml"]), []);
  assert.deepEqual(exemptGlobFindings([]), []);
  assert.deepEqual(exemptGlobFindings(null), []);
  assert.deepEqual(exemptGlobFindings(["  "]), []); // 빈 문자열은 건너뜀
});
