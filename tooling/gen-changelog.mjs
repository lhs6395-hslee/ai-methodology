#!/usr/bin/env node
// tooling/gen-changelog.mjs — git 이력 → change_log.html 생성 (결정적·재생성 가능).
// 사용: node tooling/gen-changelog.mjs  → 레포 루트에 change_log.html 기록.
// 킷의 진화(무엇이·언제 업데이트되는가)를 날짜별로 보여주는 로컬 문서(방법론.html 동류, 웹 배포 아님).
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = execSync("git log --date=short --no-merges --pretty=format:%ad%x09%h%x09%s", { cwd: root, encoding: "utf8" });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 커밋 타입 → 배지 클래스
const typeOf = (subj) => {
  const m = /^(\w+)(?:\([^)]*\))?:/.exec(subj);
  const t = (m && m[1]) || "misc";
  return ["feat", "fix", "docs", "refactor", "test", "chore"].includes(t) ? t : "misc";
};
// SPEC/INFRA/TEST/CICD-NNN·FR-NNN 강조
const emphasize = (s) => esc(s)
  .replace(/\b((?:SPEC|INFRA|TEST|CICD)-\d{3}(?:\/FR-\d{3}[a-z]?)?)\b/g, '<b class="id">$1</b>')
  .replace(/\bFR-\d{3}[a-z]?\b/g, (x) => `<b class="id">${x}</b>`);

const byDate = new Map();
for (const line of raw.split("\n").filter(Boolean)) {
  const [date, hash, subj] = line.split("\t");
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push({ hash, subj });
}
const dates = [...byDate.keys()].sort().reverse();
const generated = dates[0] || "";
const total = raw.split("\n").filter(Boolean).length;

const rows = dates.map((d) => {
  const items = byDate.get(d).map(({ hash, subj }) => {
    const t = typeOf(subj);
    return `      <li><span class="badge ${t}">${t}</span><code class="h">${esc(hash)}</code><span class="s">${emphasize(subj)}</span></li>`;
  }).join("\n");
  return `  <section class="day">\n    <h2>${d}</h2>\n    <ul>\n${items}\n    </ul>\n  </section>`;
}).join("\n");

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SDD 키트 변경 로그</title>
<style>
  :root {
    --bg:#fbfbfa; --fg:#1b1b19; --muted:#6b6b66; --line:#e7e6e2; --card:#fff;
    --feat:#1a7f4b; --fix:#b3541e; --docs:#3a63c0; --refactor:#7a48b8; --test:#0f8a8a; --chore:#6b6b66; --misc:#888; --id:#8a2be2;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16161a; --fg:#e9e9e6; --muted:#9a9a94; --line:#2a2a30; --card:#1d1d22;
      --feat:#4bd08a; --fix:#e0925a; --docs:#7fa0ec; --refactor:#b98fe0; --test:#5fd0d0; --chore:#9a9a94; --misc:#aaa; --id:#c79bff; }
  }
  :root[data-theme="dark"] { --bg:#16161a; --fg:#e9e9e6; --muted:#9a9a94; --line:#2a2a30; --card:#1d1d22;
    --feat:#4bd08a; --fix:#e0925a; --docs:#7fa0ec; --refactor:#b98fe0; --test:#5fd0d0; --chore:#9a9a94; --misc:#aaa; --id:#c79bff; }
  :root[data-theme="light"] { --bg:#fbfbfa; --fg:#1b1b19; --muted:#6b6b66; --line:#e7e6e2; --card:#fff;
    --feat:#1a7f4b; --fix:#b3541e; --docs:#3a63c0; --refactor:#7a48b8; --test:#0f8a8a; --chore:#6b6b66; --misc:#888; --id:#8a2be2; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans KR",sans-serif; }
  .wrap { max-width:860px; margin:0 auto; padding:40px 20px 80px; }
  header h1 { font-size:1.7rem; margin:0 0 6px; }
  header .sub { color:var(--muted); font-size:.92rem; margin:0 0 18px; }
  .legend { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 28px; padding-bottom:20px; border-bottom:1px solid var(--line); }
  .badge { display:inline-block; min-width:64px; text-align:center; padding:1px 8px; border-radius:999px; font-size:.72rem; font-weight:700;
    letter-spacing:.02em; color:#fff; text-transform:uppercase; }
  .badge.feat{background:var(--feat)} .badge.fix{background:var(--fix)} .badge.docs{background:var(--docs)}
  .badge.refactor{background:var(--refactor)} .badge.test{background:var(--test)} .badge.chore{background:var(--chore)} .badge.misc{background:var(--misc)}
  .day { margin:0 0 26px; }
  .day h2 { position:sticky; top:0; background:var(--bg); font-size:1.05rem; margin:0 0 10px; padding:6px 0;
    color:var(--fg); border-bottom:1px solid var(--line); }
  .day ul { list-style:none; margin:0; padding:0; }
  .day li { display:flex; align-items:baseline; gap:10px; padding:7px 10px; border-radius:8px; }
  .day li:hover { background:var(--card); }
  .day .h { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.8rem; color:var(--muted); flex:0 0 auto; }
  .day .s { flex:1 1 auto; }
  .id { color:var(--id); font-weight:600; }
  code.h { background:transparent; }
  footer { margin-top:40px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:.82rem; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>SDD 키트 변경 로그</h1>
    <p class="sub">portable SDD 방법론 킷 · 최종 갱신 <b>${generated}</b> · 총 ${total}개 변경 · git 이력에서 생성(<code>tooling/gen-changelog.mjs</code>)</p>
    <div class="legend">
      <span class="badge feat">feat</span><span class="badge fix">fix</span><span class="badge docs">docs</span>
      <span class="badge refactor">refactor</span><span class="badge test">test</span><span class="badge chore">chore</span>
    </div>
  </header>
${rows}
  <footer>
    이 문서는 <code>node tooling/gen-changelog.mjs</code>로 재생성한다(수기 편집 금지). 각 항목 = 한 커밋(merge 제외).
    방법론 정본은 <code>방법론.html</code>·<code>METHODOLOGY.md</code>, 진입은 <code>prompts/adopt.md</code>.
  </footer>
</div>
</body>
</html>
`;
writeFileSync(join(root, "change_log.html"), html);
console.log(`change_log.html 생성 — ${total}개 변경, ${dates.length}일, 최신 ${generated}`);
