// 판정 타입 계약(SPEC-040) — 게이트가 "무엇을 했는지"를 산문이 아니라 타입으로 말한다.
// 회귀의 핵심: **JUDGED만 초록의 자격을 갖는다.** off·inert·skipped·untyped는 전부 "안 봄"이다.
// @covers SPEC-040/FR-001
// @covers SPEC-040/FR-002
// @covers SPEC-040/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VERDICT_KINDS, formatVerdict, parseVerdict, stripVerdictLines, isJudged, KIND_LABEL,
} from "../verdict-lib.mjs";

// import 지정자로 쓰인다(64행) — 파일 경로가 아니라 file:// URL이어야 한다(Windows에서
// 절대경로 문자열을 지정자로 쓰면 ERR_UNSUPPORTED_ESM_URL_SCHEME로 죽는다). new URL(...)이
// 이미 file:// URL이므로 fileURLToPath로 fs 경로화하지 않고 .href를 그대로 쓴다.
const LIB = new URL("../verdict-lib.mjs", import.meta.url).href;

test("판정 종류는 다섯 개뿐 — 늘어나면 '이건 어디에 넣지'가 생기고 그 자리가 예외가 된다", () => {
  assert.deepEqual(Object.keys(VERDICT_KINDS).sort(),
    ["INERT", "JUDGED", "OFF", "SKIPPED", "UNTYPED"]);
});

test("초록의 자격은 JUDGED만 — 나머지 넷은 전부 '안 봄'이다", () => {
  assert.equal(isJudged("JUDGED"), true);
  for (const k of ["OFF", "INERT", "SKIPPED", "UNTYPED"]) {
    assert.equal(isJudged(k), false, `${k}가 초록으로 분류됐다`);
    assert.match(KIND_LABEL[k], /안 봄|미판정/);
  }
});

test("format↔parse 왕복 — 사유 있음·없음 양쪽", () => {
  assert.equal(formatVerdict("JUDGED", "위반 0건"), "판정: JUDGED — 위반 0건");
  assert.equal(formatVerdict("OFF", ""), "판정: OFF");
  const a = parseVerdict("앞줄\n판정: INERT — entitySchemaSources 미선언\n");
  assert.deepEqual({ kind: a.kind, detail: a.detail }, { kind: "INERT", detail: "entitySchemaSources 미선언" });
  const b = parseVerdict("판정: OFF");
  assert.deepEqual({ kind: b.kind, detail: b.detail }, { kind: "OFF", detail: "" });
});

test("판정 줄이 없으면 null — 호출자가 UNTYPED로 처리한다(빈 출력과 같은 계열)", () => {
  assert.equal(parseVerdict("게이트: OK — 전부 통과"), null);
  assert.equal(parseVerdict(""), null);
});

test("모르는 종류 토큰은 UNTYPED로 떨어진다 — 오타가 조용히 초록이 되지 않는다", () => {
  assert.equal(parseVerdict("판정: CLEAN — 다 좋음").kind, "UNTYPED");
  assert.equal(formatVerdict("GREEN", "x"), "판정: UNTYPED — x");
});

test("여러 줄이면 마지막이 유효 — 게이트가 진행 중에 갱신할 수 있다", () => {
  assert.equal(parseVerdict("판정: INERT — 준비 중\n판정: JUDGED — 위반 2건").detail, "위반 2건");
});

test("stripVerdictLines가 요약 자리를 되돌려준다 — 판정 줄이 lastLine을 빼앗지 않게", () => {
  const out = "게이트 — 결과 요약 줄\n판정: JUDGED — 위반 0건\n";
  assert.equal(stripVerdictLines(out).trim(), "게이트 — 결과 요약 줄");
});

// ── 방출기: 모든 종료 경로에서 정확히 한 줄 ──────────────────────────────────
function runSnippet(body) {
  const root = mkdtempSync(join(tmpdir(), "sdd-verdict-"));
  const f = join(root, "g.mjs");
  writeFileSync(f, `import { armVerdict, verdict, judged } from ${JSON.stringify(LIB)};\n${body}\n`);
  try {
    const out = execFileSync("node", [f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("verdict()를 부르지 않은 게이트는 UNTYPED를 자백한다 — 조용한 통과가 불가능하다", () => {
  const r = runSnippet(`armVerdict();\nconsole.log("게이트: OK");`);
  assert.equal(r.code, 0);
  assert.match(r.out, /판정: UNTYPED — .*배선 누락/);
});

test("process.exit(1)로 끝나도 판정 줄이 나온다 — 차단 경로가 미판정으로 오분류되지 않게", () => {
  const r = runSnippet(`armVerdict();\njudged(3);\nconsole.error("✗ 위반");\nprocess.exit(1);`);
  assert.equal(r.code, 1);
  assert.match(r.out, /판정: JUDGED — 위반 3건/);
});

test("파이프로 잡아도 유실되지 않는다 — writeSync(1) 계약(console.log이면 비동기라 샌다)", () => {
  // execFileSync는 파이프로 잡는다. 이 테스트가 통과한다는 것 자체가 동기 쓰기의 증거다.
  const r = runSnippet(`armVerdict();\nverdict("OFF", "liveRealityPolicy");\nprocess.exit(0);`);
  assert.equal(r.out.trimEnd().split("\n").pop(), "판정: OFF — liveRealityPolicy");
});

test("판정 줄은 종료 경로당 정확히 하나 — 중복 방출이 집계를 부풀리지 않는다", () => {
  const r = runSnippet(`armVerdict();\nverdict("INERT", "a");\nverdict("JUDGED", "위반 0건");`);
  assert.equal(r.out.split("\n").filter((l) => l.startsWith("판정:")).length, 1);
  assert.match(r.out, /판정: JUDGED/);
});
