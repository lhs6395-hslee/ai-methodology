// tooling/spec-sync-lib.mjs
// check-spec-sync 순수 코어 — glob 컴파일 + diff 섹션 귀속. git 비의존(테스트 용이).
// 설계: docs/design/2026-07-02-spec-first-enforcement-design.md §4.1·§5.4

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

// `Ownership.Files`의 **리터럴 경로**(글롭 메타문자 없음)는 실재해야 한다 — 순수 코어.
//
// 왜: 존재하지 않는 경로는 어떤 변경 파일과도 매치하지 않으므로 **그 스펙의 소유가 조용히
// 사라진다.** spec-first 강제가 그 파일에 발화하지 않고 게이트 출력에 신호도 없다.
// 실측(소비 프로젝트 finops): SPEC-015가 `iac_action/audit_store.py`를 소유 선언했는데 실제
// 모듈은 `store.py`였다 — 리네임 후 스펙만 안 따라온 드리프트가 소유권 상실로 조용히 남았다.
// `symbolRealityPolicy`(SPEC-029)는 `Surfaces`의 파일형 키만 보므로 `Files`는 사각지대였다.
//
// 글롭(`*`·`?`·`{}` 포함)은 대상에서 뺀다 — 오늘 0건 매치가 정당할 수 있다(아직 안 만든
// 디렉토리). 리터럴 경로엔 그런 정당성이 없다: 지금 없으면 지금 틀린 것이다.
// exists: (relPath) => boolean 를 주입받는다(파일 IO는 소비 게이트가 한다).
export function filesLineMissingPaths(tokens, exists) {
  const out = [];
  for (const raw of tokens || []) {
    const t = String(raw || "").trim();
    if (!t || t === "—" || t === "-") continue;
    if (/[*?{}]/.test(t)) continue;              // 글롭·패턴은 실재 판정 대상 아님
    if (t.startsWith("[")) continue;             // placeholder 토큰
    if (!exists(t)) out.push(t);
  }
  return out;
}

// §4.1: 원시 `- **Files**:` 라인에서 미지원 문법 스캔 — parseSection이 `[` 토큰을
// placeholder로 조용히 버리기 전에 경고해야 하므로 반드시 원시 라인 기준.
export function scanFilesLineIssues(rawLine) {
  const value = rawLine.replace(/^.*?\*\*Files\*\*\s*:/, ""); // 값 부분만
  const issues = ["{", "?"].filter((ch) => value.includes(ch));
  // `[`: parseSection은 `[`로 **시작하는** 토큰만 placeholder로 버린다 → 그때만 경고.
  // 파일 라우팅 동적 세그먼트(.../[id]/**·.../[slug]/**)는 토큰 중간이라 안 버려지고
  // compileGlob이 `[`를 리터럴로 이스케이프해 정확히 매치한다(경고 불필요).
  if (value.split(",").some((tok) => tok.trim().startsWith("["))) issues.push("[");
  for (const tok of value.split(",")) {
    const t = tok.trim();
    // 합법 형태: `**/` 또는 토큰 끝 `**`. 그 외 위치의 `**`는 오해석 경고.
    const stripped = t.replace(/\*\*\//g, "").replace(/\*\*$/, "");
    if (stripped.includes("**")) { issues.push("**"); break; }
  }
  return issues;
}

// §4.1: parseSection 반환값의 trailing " # …" strip (공유 파서는 불변).
// `- **Files**: a, b, c` 한 줄에서 glob 토큰을 뽑는다 — **세 게이트가 같은 정규식을 각자 갖고 있었다**
// (deploy-guard·ownership·pre-edit). 구현 중복 게이트(SPEC-038)가 킷 자기적용에서 실수확한 첫 건이라,
// 규칙을 여기 하나로 모은다: Files 라인의 문법은 스펙 문법이고, 사이트마다 정규식을 두면 문법이
// 바뀔 때 한 곳만 고쳐지고 나머지는 조용히 뒤처진다(자체 정규식 금지 규칙과 같은 이유).
// 반환 [] — 라인이 없으면 빈 배열. 인라인 주석은 잘라낸다.
export function parseFilesLine(text) {
  const m = String(text || "").match(/^\s*-\s*\*\*Files\*\*:\s*(.+)$/m);
  if (!m) return [];
  return m[1].split(",").map((t) => stripInlineComment(t).trim()).filter(Boolean);
}

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
// reqAlt = 요구 ID 접두어 alternation("FR" 기본) — 순수 코어라 config를 직접 안 읽고
// 호출부(check-spec-sync)가 cfg.__reqAlt를 주입한다(전 사이트 동일 문법, requirementIdPrefixes 파생).
export function hasMeaningfulSpecChange(postImage, diffText, reqAlt = "FR") {
  // `+++`/`---` 헤더도 [+-]에 걸리지만 경로에 `**<REQ>-NNN[a]**` 볼드 리터럴이 올 수 없어 안전.
  const frLine = new RegExp(`^[+-].*\\*\\*(?:${reqAlt})-\\d{3}[a-z]?\\*\\*`, "m");
  if (frLine.test(diffText)) return true; // FR 라인 +/- (서픽스 FR-010a 포함)
  const sections = buildSectionMap(postImage);
  for (const { line, text } of addedLines(diffText)) {
    const sec = sectionAt(sections, line);
    if (!sec) continue;
    if ((isBullet(text) || isTableRow(text)) && /(edge cases|change log)/i.test(sec)) return true;
  }
  return false;
}
