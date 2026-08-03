// tooling/__tests__/duplicate-logic.test.mjs — 구현 중복 (SPEC-038)
// 실측 제보(operations-dashboard 2026-08-03): 병렬 서브에이전트가 같은 별칭 제거 규칙을 세 갈래로
// 만들었고(`stripNameAlias`·`stripAlias`가 **같은 파일에** 공존 + 인라인 3곳) ownership·cohesion·
// fr·consistency 전부 green이었다. dedup은 **선언 단위**만 봐서 *구현 중복*이 사각이었다.
// @covers SPEC-038/FR-001
// @covers SPEC-038/FR-002
// @covers SPEC-038/FR-003
// @covers SPEC-038/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractLiterals, duplicateLiteralFindings, staleAllowEntries, parseDuplicateCandidates,
  DEFAULT_DUPLICATE_MIN_LENGTH,
} from "../duplicate-logic-lib.mjs";

const GATE = new URL("../check-duplicate-logic.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("extractLiterals: 정규식 본문만 · 하한 미달·주석·문자열 안 슬래시는 제외", () => {
  const lits = extractLiterals('const a = s.replace(/\\s*\\(.*\\)$/, "").trim();').map((l) => l.literal);
  assert.deepEqual(lits, ["\\s*\\(.*\\)$"]);
  // 사소한 정규식은 어휘다 — 정당하게 반복된다
  assert.deepEqual(extractLiterals("x.split(/\\s+/)"), []);
  // 주석 라인은 구현이 아니다
  assert.deepEqual(extractLiterals("// 형식은 /\\s*\\(.*\\)$/ 이다"), []);
  // 블록 주석 시작 `/*`은 정규식이 아니다
  assert.deepEqual(extractLiterals("const x = 1; /* 설명이 길게 이어진다 */"), []);
  // **문자열을 먼저 지운다** — 실측: 따옴표 사이 슬래시가 정규식으로 오추출됐다
  assert.deepEqual(extractLiterals('const t = cond ? p.replace(/^x/, "") : "defaults(JS/TS) 설명";')
    .map((l) => l.literal), []);
  assert.equal(DEFAULT_DUPLICATE_MIN_LENGTH, 8);
});

test("duplicateLiteralFindings: 2곳 이상만 · **같은 파일 안의 반복도 센다**(실측 사고 1의 형태)", () => {
  const body = 'export function stripNameAlias(s){return s.replace(/\\s*\\(.*\\)$/,"").trim()}\n'
    + 'export function stripAlias(s){return s.replace(/\\s*\\(.*\\)$/,"").trim()}';
  const files = [
    { path: "src/components/display-name.ts", literals: extractLiterals(body) },
    { path: "lib/jira/close.ts", literals: extractLiterals('const n = x.replace(/\\s*\\(.*\\)$/, "");') },
    { path: "src/only-once.ts", literals: extractLiterals("const u = v.match(/^unique-pattern-here$/);") },
  ];
  const { findings, errors } = duplicateLiteralFindings(files);
  assert.deepEqual(errors, []);
  assert.equal(findings.length, 1, "1곳뿐인 리터럴은 신호가 아니다");
  assert.equal(findings[0].sites.length, 3);
  assert.equal(findings[0].files, 2);   // 같은 파일 2회 + 다른 파일 1회
});

test("duplicateLogicAllow: 사유 필수 · 면제는 findings에서 빠진다 · 낡은 면제는 표면화", () => {
  const files = [
    { path: "a.ts", literals: [{ literal: "\\s*\\(.*\\)$", line: 1 }] },
    { path: "b.ts", literals: [{ literal: "\\s*\\(.*\\)$", line: 2 }] },
  ];
  assert.equal(duplicateLiteralFindings(files, { "\\s*\\(.*\\)$": "정당한 사유" }).findings.length, 0);
  const bad = duplicateLiteralFindings(files, { "\\s*\\(.*\\)$": "  " });
  assert.ok(bad.errors.some((e) => /사유 필수/.test(e)));
  // 등록부는 최신일 때만 등록부다 — 더 이상 중복이 아닌 면제는 지워야 한다
  assert.deepEqual(staleAllowEntries(files, { "\\s*\\(.*\\)$": "r", "gone-pattern": "r" }), ["gone-pattern"]);
});

test("parseDuplicateCandidates: 어댑터 stdout 한 줄 = 후보 하나 · 주석·불완전 줄은 무시", () => {
  const out = "# jscpd\nsrc/a.ts:10\tsrc/b.ts:20\t동일 본문 12줄\nsrc/c.ts:1\n\nsrc/d.ts:3\tsrc/e.ts:4\n";
  const items = parseDuplicateCandidates(out);
  assert.equal(items.length, 2);
  assert.equal(items[0].note, "동일 본문 12줄");
  assert.equal(items[1].note, "");
});

// ── 게이트 e2e ──

function fixture(cfg, files) {
  const root = mkdtempSync(join(tmpdir(), "sdd-dup-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...cfg }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// 실측 재현 — 이 형태가 잡히지 않으면 층이 좁은 것이다.
const REAL = {
  "src/components/display-name.ts":
    'export function stripNameAlias(s){return s.replace(/\\s*\\(.*\\)$/,"").trim()}\n'
    + 'export function stripAlias(s){return s.replace(/\\s*\\(.*\\)$/,"").trim()}\n',
  "src/lib/jira/close.ts": 'export const n = (x) => x.replace(/\\s*\\(.*\\)$/, "").trim();\n',
  "src/lib/x.test.ts": 'expect(y).toBe(z.replace(/\\s*\\(.*\\)$/, ""));\n',   // 테스트는 기본 제외
};

test("게이트 e2e(실측 역검증): off → 판정 안 함 / advisory ⚠ exit 0 / hard ✗ exit 1", () => {
  const off = fixture({ duplicateLogicPolicy: "off" }, REAL);
  const adv = fixture({}, REAL);                                  // 기본 advisory
  const hard = fixture({ duplicateLogicPolicy: "hard" }, REAL);
  const bad = fixture({ duplicateLogicPolicy: "warn" }, REAL);     // enum 밖
  try {
    assert.match(run(off).out, /off \(판정 안 함\)/);

    const a = run(adv);
    assert.equal(a.code, 0);
    assert.match(a.out, /같은 규칙이 3곳에 있다/);                  // 같은 파일 2회 + 다른 파일 1회
    assert.match(a.out, /display-name\.ts:1 · .*display-name\.ts:2/);
    assert.doesNotMatch(a.out, /x\.test\.ts/);                     // 테스트 파일은 제외(오탐의 주 원인)

    const h = run(hard);
    assert.equal(h.code, 1);
    assert.match(h.out, /하나로 통합하고 나머지는 그것을 호출하라/);
    assert.match(h.out, /게이트 4종 전부 green이었다/);             // 실측 계기를 처방에 붙인다

    assert.equal(run(bad).code, 1);
    assert.match(run(bad).out, /duplicateLogicPolicy 값 위반/);
  } finally { for (const r of [off, adv, hard, bad]) rmSync(r, { recursive: true, force: true }); }
});

test("게이트 e2e: 확률적 층은 상태를 반드시 말한다 — 미선언·skipped를 '중복 없음'으로 읽지 않는다", () => {
  const clean = { "src/a.ts": "export const x = 1;\n" };
  const none = fixture({}, clean);
  const skipped = fixture({ duplicateLogicCommand: "sh -c 'exit 3'" }, clean);
  const ran = fixture({ duplicateLogicCommand: "printf 'src/a.ts:1\\tsrc/b.ts:2\\t같은 본문\\n'" }, clean);
  try {
    assert.match(run(none).out, /미선언 — 구조 중복.*미판정, 위반 없음이 아니다/);
    assert.match(run(skipped).out, /skipped —.*'중복 없음'으로 읽지 않는다/);
    const r = run(ran);
    assert.equal(r.code, 0, "확률적 층은 어떤 강도에서도 차단하지 않는다");
    assert.match(r.out, /후보 1건\(비차단/);
    assert.match(r.out, /src\/a\.ts:1 ↔ src\/b\.ts:2 — 같은 본문/);
  } finally { for (const x of [none, skipped, ran]) rmSync(x, { recursive: true, force: true }); }
});

test("게이트 e2e: 확률적 층이 후보를 내도 hard에서 차단하지 않는다(결정적 층만 차단)", () => {
  const root = fixture({
    duplicateLogicPolicy: "hard",
    duplicateLogicCommand: "printf 'src/a.ts:1\\tsrc/b.ts:2\\n'",
  }, { "src/a.ts": "export const x = 1;\n" });
  try {
    const r = run(root);
    assert.equal(r.code, 0, "확률적 오탐이 빌드를 깨면 사람이 그 층을 떼어낸다");
    assert.match(r.out, /결정적 층에서 중복 리터럴 0건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
