// tooling/__tests__/spec-sync-lib.test.mjs
// @covers SPEC-003/FR-007
// @covers SPEC-003/FR-005
// @covers SPEC-003/FR-001
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileGlob, scanFilesLineIssues, stripInlineComment, hasMeaningfulSpecChange } from "../spec-sync-lib.mjs";

test("compileGlob: ** 는 0+ 세그먼트, anchored, prefix 경계 안전", () => {
  const re = compileGlob("src/lib/pdf/**");
  assert.ok(re.test("src/lib/pdf/a.ts"));
  assert.ok(re.test("src/lib/pdf/a/b.ts"));
  assert.equal(re.test("src/lib/pdfx/a.ts"), false); // prefix 경계
  assert.equal(re.test("src/lib/pdf"), false);       // 디렉토리 자신 비매치(§4.1)
});

test("compileGlob: * 는 세그먼트 내, 점 이스케이프", () => {
  const re = compileGlob("src/app/api/*/route.ts");
  assert.ok(re.test("src/app/api/recommend/route.ts"));
  assert.equal(re.test("src/app/api/a/b/route.ts"), false); // * 는 / 넘지 않음
  assert.equal(compileGlob("next.config.ts").test("next2config.ts"), false); // . 리터럴
});

test("compileGlob: 중간 **/ 는 0개 세그먼트 허용", () => {
  const re = compileGlob("a/**/b.ts");
  assert.ok(re.test("a/b.ts"));
  assert.ok(re.test("a/x/y/b.ts"));
});

test("scanFilesLineIssues: 미지원 문법 경고 목록", () => {
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/{a,b}/**"), ["{"]);
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/lib/**"), []);
});

test("scanFilesLineIssues: 파일 라우팅 동적 세그먼트([id])는 경고 없음, `[`로 시작하는 placeholder만 경고", () => {
  // .../[id]/** — 토큰 중간의 [id]는 parseSection이 안 버리고 compileGlob이 리터럴 매치 → 경고 없음
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/app/[id]/**"), []);
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/app/api/pjt/[id]/excel/**, app/[slug]/page.tsx"), []);
  // 토큰이 `[`로 시작 → parseSection이 placeholder로 버림 → 경고
  assert.deepEqual(scanFilesLineIssues("- **Files**: [NEEDS CLARIFICATION]"), ["["]);
});

test("scanFilesLineIssues: 불법 중간 ** 경고, 합법 **/·끝 ** 는 통과, 볼드마커 오탐 없음", () => {
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/a**b.ts"), ["**"]);
  assert.deepEqual(scanFilesLineIssues("- **Files**: src/**/x.ts, src/lib/**"), []);
});

test("stripInlineComment: trailing #… 제거", () => {
  assert.equal(stripInlineComment("next.config.ts # 인라인 주석"), "next.config.ts");
  assert.equal(stripInlineComment("src/lib/**"), "src/lib/**");
});

const POST = [
  "# SPEC-001", "", "## User Scenarios & Testing", "", "### Edge Cases",
  "- 기존 엣지", "", "## Functional Requirements", "**FR-001** THE SYSTEM SHALL x.",
  "", "## Change Log", "| 날짜 | 변경 | 근거 |", "|---|---|---|", "| 2026-07-02 | 초안 | |",
].join("\n");

test("hasMeaningfulSpecChange: H3 Edge Cases 불릿 추가 → true (레벨 무관 귀속)", () => {
  // POST의 6행("- 기존 엣지") 다음에 "+- 새 엣지"가 추가됐다고 가정한 diff
  const post = POST.replace("- 기존 엣지", "- 기존 엣지\n- 새 엣지");
  const diff = "@@ -6,1 +6,2 @@\n - 기존 엣지\n+- 새 엣지";
  assert.equal(hasMeaningfulSpecChange(post, diff), true);
});

test("hasMeaningfulSpecChange: Change Log 표 행 추가 → true, 구분선만 → false", () => {
  const post = POST + "\n| 2026-07-03 | 픽스 | c1 |";
  const rowDiff = "@@ -14,1 +14,2 @@\n | 2026-07-02 | 초안 | |\n+| 2026-07-03 | 픽스 | c1 |";
  assert.equal(hasMeaningfulSpecChange(post, rowDiff), true);
  const sepDiff = "@@ -13,1 +13,2 @@\n |---|---|---|\n+|---|---|---|";
  assert.equal(hasMeaningfulSpecChange(POST + "\n|---|---|---|", sepDiff), false);
});

test("hasMeaningfulSpecChange: FR 라인 추가/삭제 → true, 공백·주석만 → false", () => {
  assert.equal(hasMeaningfulSpecChange(POST, "@@ -9,0 +10,1 @@\n+**FR-002** THE SYSTEM SHALL y."), true);
  assert.equal(hasMeaningfulSpecChange(POST, "@@ -2,0 +3,1 @@\n+"), false);           // 공백
  assert.equal(hasMeaningfulSpecChange(POST, "@@ -2,0 +3,1 @@\n+<!-- 주석 -->"), false); // 항목 아님
});

test("hasMeaningfulSpecChange: 레터 서픽스 FR 라인(FR-001a) 추가 → true", () => {
  const post = POST.replace("**FR-001** THE SYSTEM SHALL x.", "**FR-001** THE SYSTEM SHALL x.\n**FR-001a** THE SYSTEM SHALL y.");
  const diff = "@@ -9,1 +9,2 @@\n **FR-001** THE SYSTEM SHALL x.\n+**FR-001a** THE SYSTEM SHALL y.";
  assert.equal(hasMeaningfulSpecChange(post, diff), true);
});

test("hasMeaningfulSpecChange: reqAlt 주입 시 커스텀 요구 접두어(NFR) 라인도 의미 변경", () => {
  const diff = "@@ -9,0 +10,1 @@\n+**NFR-002** THE SYSTEM SHALL y.";
  assert.equal(hasMeaningfulSpecChange(POST, diff), false);            // 기본(FR)에선 불인정
  assert.equal(hasMeaningfulSpecChange(POST, diff, "FR|NFR"), true);   // requirementIdPrefixes 파생 alt 주입
});
