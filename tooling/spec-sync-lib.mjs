// tooling/spec-sync-lib.mjs
// check-spec-sync 순수 코어 — glob 컴파일 + diff 섹션 귀속. git 비의존(테스트 용이).
// 설계: docs/superpowers/specs/2026-07-02-spec-first-enforcement-design.md §4.1·§5.4

// §4.1 지원 부분집합: **(0+ 경로 세그먼트)·*(세그먼트 내). anchored, POSIX, 대소문자 구분.
export function compileGlob(glob) {
  let re = "";
  for (let i = 0; i < glob.length; ) {
    if (glob.startsWith("**/", i)) { re += "(?:[^/]+/)*"; i += 3; }
    else if (glob.slice(i) === "**") { re += "(?:[^/]+/)*[^/]+"; i = glob.length; }
    else if (glob[i] === "*") { re += "[^/]*"; i += 1; }
    else { re += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&"); i += 1; }
  }
  return new RegExp(`^${re}$`);
}

// §4.1: 원시 `- **Files**:` 라인에서 미지원 문법 스캔 — parseSection이 `[` 토큰을
// placeholder로 조용히 버리기 전에 경고해야 하므로 반드시 원시 라인 기준.
export function scanFilesLineIssues(rawLine) {
  return ["{", "?", "["].filter((ch) => rawLine.includes(ch));
}

// §4.1: parseSection 반환값의 trailing " # …" strip (공유 파서는 불변).
export function stripInlineComment(value) {
  return value.replace(/\s+#.*$/, "").trim();
}

// §5.4 step 1: 레벨 무관(#{2,3}) 헤더의 "이름" 기준 라인번호→섹션 맵.
export function buildSectionMap(postImage) {
  const sections = [];
  postImage.split("\n").forEach((l, i) => {
    const m = l.match(/^#{2,3}\s+(.+?)\s*$/);
    if (m) sections.push({ name: m[1], start: i + 1 }); // 1-based
  });
  return sections;
}

function sectionAt(sections, lineNo) {
  let cur = null;
  for (const s of sections) { if (s.start <= lineNo) cur = s.name; else break; }
  return cur;
}

// §5.4 step 2: unified diff에서 추가 라인의 new-file 라인번호 추출.
export function addedLines(diffText) {
  const out = [];
  let ln = 0;
  for (const l of diffText.split("\n")) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { ln = parseInt(h[1], 10); continue; }
    if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("\\")) continue;
    if (l.startsWith("+")) { out.push({ line: ln, text: l.slice(1) }); ln++; }
    else if (!l.startsWith("-")) ln++; // context
  }
  return out;
}

const isBullet = (t) => /^\s*-\s+\S/.test(t);
const isTableRow = (t) => /^\s*\|/.test(t) && !/^\s*\|[\s:|-]+\|?\s*$/.test(t); // 구분선 제외

// §5.4 step 3: 의미 있는 변경 판정 (post-image + 그 이미지 기준 diff 한 슬라이스).
export function hasMeaningfulSpecChange(postImage, diffText) {
  if (/^[+-].*\*\*FR-\d{3}\*\*/m.test(diffText)) return true; // FR 라인 +/- (패턴 기반)
  const sections = buildSectionMap(postImage);
  for (const { line, text } of addedLines(diffText)) {
    const sec = sectionAt(sections, line);
    if (!sec) continue;
    if ((isBullet(text) || isTableRow(text)) && /(edge cases|change log)/i.test(sec)) return true;
  }
  return false;
}
