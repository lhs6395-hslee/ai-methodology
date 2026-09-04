// tooling/__tests__/fr-locator.test.mjs — FR 로케이터 (SPEC-062)
// "지금 바꾸려는 이것은 어느 FR인가"를 결정적 근거로 좁힌다 — 통독을 조회로 바꾼다.
// @covers SPEC-062/FR-001
// @covers SPEC-062/FR-002
// @covers SPEC-062/FR-003
// @covers SPEC-062/FR-004
// @covers SPEC-062/FR-005
// @covers SPEC-062/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../sdd-config.mjs";
import { buildSectionMap } from "../spec-sync-lib.mjs";
import { frDeclLines, locateFrs, locateSpecsByKeyword, formatCandidate, coversScore, EVIDENCE_RANK } from "../fr-locator-lib.mjs";

const cfg = loadConfig("/nonexistent");
const HOOK = new URL("../check-pre-edit.mjs", import.meta.url).pathname;
const WHERE = new URL("../sdd-where.mjs", import.meta.url).pathname;

const SPEC = [
  "# Budget",
  "**Spec**: `SPEC-001`  **Status**: Active",
  "## Functional Requirements (EARS)",
  "- **FR-001** (event): WHEN a request hits **POST /api/budget** (S), THE SYSTEM SHALL create via `createBudget()`.",
  "- **FR-002** (event): WHEN approval is requested, THE SYSTEM SHALL route through `approveBudget()` in `budget-approval.ts`.",
  "- **FR-003** (state): WHILE reporting is on, THE SYSTEM SHALL aggregate monthly totals.",
  "- **FR-004** (unwanted): IF the ledger is locked, THEN THE SYSTEM SHALL refuse.",
  "## Ownership",
  "- **Entities**: budget",
  "- **Surfaces**: budget-approval.ts",
  "- **Files**: src/app/**",
  "## Edge Cases",
  "- 배포창 밖에서는 승인만 받고 반영은 미룬다.",
  "## Change Log",
  "| 2026-09-04 | 유령 entity 정리 | 과거 기록 |",
].join("\n");

const units = () => frDeclLines(SPEC, cfg.__frDeclRe, cfg.__reqAlt).map(({ frId, line }) => ({ specId: "SPEC-001", frId, line }));

// ── 순수 코어 ──

test("frDeclLines: FR 선언 라인만(ID + 본문) — Change Log의 FR 인용은 선언이 아니다", () => {
  const got = frDeclLines(SPEC, cfg.__frDeclRe, cfg.__reqAlt);
  assert.deepEqual(got.map((u) => u.frId), ["FR-001", "FR-002", "FR-003", "FR-004"]);
  assert.match(got[1].line, /approveBudget/);
});

// FR-001: 근거 4종은 결정적 대조뿐 — 유사도 추천 없음.
test("locateFrs: FR이 백틱으로 지목한 함수가 대상 파일에 있으면 named-fn, 모듈명이 basename이면 named-mod", () => {
  const got = locateFrs(units(), {
    path: "src/app/budget-approval.ts",
    pathText: "export function approveBudget(id) { return id; }\n",
  });
  assert.equal(got.length, 1, JSON.stringify(got));
  assert.equal(got[0].frId, "FR-002");
  const kinds = got[0].evidence.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["named-fn", "named-mod"]);
});

test("locateFrs: 굵은 키 앵커가 대상 경로에 대응하면 anchor 근거(파일형 키만)", () => {
  // `budget-approval.ts`는 Surfaces 키이자 FR-002의 백틱 지목이기도 하다 — 앵커 경로는
  // **굵은 키**만 본다: FR-001의 `POST /api/budget`은 파일형이 아니라 대응하지 않는다.
  const got = locateFrs([{ specId: "SPEC-001", frId: "FR-009", line: "- **FR-009** (event): THE SYSTEM SHALL use **budget-approval.ts** (S)." }], {
    path: "src/app/budget-approval.ts",
  });
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].evidence.map((e) => e.kind), ["anchor"]);
  const http = locateFrs([{ specId: "SPEC-001", frId: "FR-010", line: "- **FR-010** (event): THE SYSTEM SHALL serve **POST /api/budget** (S)." }], {
    path: "src/app/budget-approval.ts",
  });
  assert.deepEqual(http, []); // HTTP 표면 키는 파일 대응 대상이 아니다
});

// FR-002: 근거 0건은 후보가 아니다 — "못 좁혔다"를 소비처가 말할 수 있게.
test("locateFrs: 근거 0건인 FR은 후보에서 제외 — 무근거를 섞으면 조회의 의미가 사라진다", () => {
  const got = locateFrs(units(), { path: "src/app/unrelated.ts", pathText: "export const x = 1;\n" });
  assert.deepEqual(got, []);
});

// FR-003: 넓은 태깅은 약한 근거다.
test("coversScore: 태깅 폭으로 감쇠 — 좁게 태깅한 테스트가 강하다", () => {
  assert.equal(coversScore(1), EVIDENCE_RANK.covers);
  assert.ok(coversScore(6) < coversScore(2));
  assert.equal(coversScore(0), EVIDENCE_RANK.covers);   // 폭 미상은 감쇠하지 않는다
});

test("locateFrs: 테스트 1개가 전 FR을 태깅하면 covers가 감쇠되고, 추가 근거를 가진 FR이 1위", () => {
  const coversBy = new Map();
  for (const u of units()) coversBy.set(`SPEC-001/${u.frId}`, [{ file: "t/budget.test.mjs", breadth: 4 }]);
  const got = locateFrs(units(), {
    path: "src/app/budget-approval.ts",
    pathText: "export function approveBudget(id) { return id; }\n",
    coversBy,
  });
  assert.equal(got.length, 4);                            // 전부 covers 근거는 있다
  assert.equal(got[0].frId, "FR-002");                    // 그러나 1위는 지목 근거를 가진 FR
  assert.ok(got[0].score > got[1].score);
  assert.match(got[0].evidence.find((e) => e.kind === "covers").detail, /FR 4개 태깅/); // 폭을 근거에 적는다
});

// FR-004: 정본 언어(영어 FR) ↔ 작업 언어(한글) 간극 + 감사 절 분리.
test("locateSpecsByKeyword: 한글 키워드는 FR 라인이 아니라 절에서 잡히고, 감사 절 매치는 과거 기록으로 분리", () => {
  const specs = [{ specId: "SPEC-001", path: "sdd/specs/SPEC-001.md", text: SPEC }];
  const edge = locateSpecsByKeyword(specs, "배포창", { frDeclRe: cfg.__frDeclRe, reqAlt: cfg.__reqAlt, buildSectionMap });
  assert.equal(edge.length, 1);
  assert.equal(edge[0].frLineHits, 0);                    // 영어 FR 라인엔 없다
  assert.deepEqual(edge[0].sections, ["Edge Cases"]);     // 정본 절에서 잡힌다
  assert.deepEqual(edge[0].auditSections, []);
  assert.equal(edge[0].frTotal, 4);

  const past = locateSpecsByKeyword(specs, "유령 entity", { frDeclRe: cfg.__frDeclRe, reqAlt: cfg.__reqAlt, buildSectionMap });
  assert.deepEqual(past[0].sections, []);                 // 정본 절 매치 없음
  assert.deepEqual(past[0].auditSections, ["Change Log"]); // 과거 기록으로 분리
});

test("locateFrs: keyword 근거는 FR 선언 라인만 본다(Change Log 인용이 섞이지 않는다)", () => {
  const got = locateFrs(units(), { keyword: "approval" });
  assert.deepEqual(got.map((c) => c.frId), ["FR-002"]);
  assert.deepEqual(locateFrs(units(), { keyword: "유령 entity" }), []); // 감사 절 문구는 FR 라인이 아니다
});

test("formatCandidate: 근거 종류·상세를 한 줄에 담고 width로 자른다(소비처 표기 단일 소스)", () => {
  const [c] = locateFrs(units(), { path: "src/app/budget-approval.ts", pathText: "approveBudget()" });
  const line = formatCandidate(c, 40);
  assert.match(line, /^SPEC-001\/FR-002 — /);
  assert.match(line, /\[근거: named-fn\(approveBudget\)/);
  assert.ok(line.includes("…"), line);
  assert.ok(!formatCandidate(c, 0).includes("…"));
});

// ── 소비처 e2e ──

function fixture({ policy = "advisory", code = "export function approveBudget(id) { return id; }\n" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-frloc-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", scanDirs: ["src"], preEditSpecFirstPolicy: policy, surfaceFormat: "any",
  }));
  writeFileSync(join(root, "sdd/specs/SPEC-001-budget.md"), SPEC);
  writeFileSync(join(root, "src/app/budget-approval.ts"), code);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  git("add", "-A"); git("commit", "-qm", "init"); git("branch", "-M", "main");
  writeFileSync(join(root, "src/app/budget-approval.ts"), code + "// tweak\n"); // 코드만 만진 상태
  return root;
}
function run(script, root, args = []) {
  try { return { code: 0, out: execFileSync("node", [script, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// FR-005: 편집 시점에 후보가 이미 화면에 있다.
test("훅 e2e: 소유 스펙 미수정 경고에 FR 후보와 근거가 함께 나온다(FR 4건 → 후보 1건)", () => {
  const root = fixture();
  try {
    const r = run(HOOK, root, ["src/app/budget-approval.ts"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /소유 스펙 SPEC-001/);
    assert.match(r.out, /FR 후보 1건 \/ 그 스펙 FR 4건/);
    assert.match(r.out, /SPEC-001\/FR-002/);
    assert.match(r.out, /named-fn\(approveBudget\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("훅 e2e: 근거로 못 좁히면 0건임을 말하고 완전 조회 경로를 준다(거짓 확신 금지)", () => {
  const root = fixture({ code: "export const unrelated = 1;\n" });
  try {
    const r = run(HOOK, root, ["src/app/budget-approval.ts"]);
    // basename 지목(named-mod)·앵커는 여전히 걸리므로, 후보 0건 문구는 그 둘이 없을 때만 나온다.
    assert.match(r.out, /FR 후보 \d건 \/ 그 스펙 FR 4건|sdd-where\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FR-006: 조회기는 판정기가 아니다.
test("sdd-where e2e: 판정 아님(SKIPPED) + 후보 유무와 무관하게 exit 0", () => {
  const root = fixture();
  try {
    const hit = run(WHERE, root, ["src/app/budget-approval.ts"]);
    assert.equal(hit.code, 0, hit.out);
    assert.match(hit.out, /판정: SKIPPED — 조회 모드/);
    assert.match(hit.out, /SPEC-001\/FR-002/);

    const miss = run(WHERE, root, ["--keyword", "존재하지않는용어zzz"]);
    assert.equal(miss.code, 0, miss.out);                  // 못 찾아도 실패가 아니다
    assert.match(miss.out, /좁히지 못했다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-where e2e: --keyword 있어도 위치 인자가 버려지지 않는다(도그푸딩 실수확 회귀)", () => {
  const root = fixture();
  try {
    // `--keyword` 미지정 시 첫 인자를 조용히 버리던 인자 파싱 결함 — 첫 실행에서 바로 드러났다.
    const r = run(WHERE, root, ["src/app/budget-approval.ts"]);
    assert.match(r.out, /대상: src\/app\/budget-approval\.ts/);
    const both = run(WHERE, root, ["src/app/budget-approval.ts", "--keyword", "approval"]);
    assert.match(both.out, /대상: src\/app\/budget-approval\.ts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sdd-where e2e: --json은 후보·소유·스캔 규모를 기계 소비 형태로 낸다", () => {
  const root = fixture();
  try {
    const r = run(WHERE, root, ["src/app/budget-approval.ts", "--json"]);
    assert.equal(r.code, 0, r.out);
    const j = JSON.parse(r.out.split("\n").filter((l) => !l.startsWith("판정:")).join("\n"));
    assert.equal(j.target, "src/app/budget-approval.ts");
    assert.equal(j.owners[0].specId, "SPEC-001");
    assert.equal(j.scanned.frs, 4);
    assert.equal(j.candidates[0].frId, "FR-002");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
