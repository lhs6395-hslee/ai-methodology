// tooling/__tests__/changelog-fr.test.mjs — Change Log ↔ FR 실재 대조 (SPEC-037)
// 실측 공백(operations-dashboard SPEC-017): Change Log가 FR-016/017/018을 신규로 선언하고
// 코드도 도는데 **FR 절에 본문이 없었다**. 두 규칙이 각자 정당한 이유로 흘렸다 — spec-sync는
// FR/Edge Cases/Change Log **택1**로 만족되고(그 탈출구는 설계다), 결번 advisory는 "폐기 잔분일
// 수 있음"이라 결함을 정당한 흔적과 **같은 문장**으로 말했다.
// @covers SPEC-037/FR-001
// @covers SPEC-037/FR-002
// @covers SPEC-037/FR-003
// @covers SPEC-037/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changeLogFrRefs, changeLogFrFindings } from "../changelog-fr-lib.mjs";
import { frNumberingIssues } from "../numbering-lib.mjs";

const GATE = fileURLToPath(new URL("../check-fr-coverage.mjs", import.meta.url));
const refs = (t, verbs) => changeLogFrRefs(t, "FR", "SPEC|INFRA|TEST|CICD", verbs || {});
const TAG = "// @cov" + "ers ";   // 자기 게이트 스캔 중화(픽스처 태그가 킷 회계에 섞이면 dangling이 된다)
const cl = (...rows) => `## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n${rows.join("\n")}\n`;

// ── 순수 코어 ──

test("changeLogFrRefs: 선언성 참조만 — 신규·개정은 잡고, 단순 언급·타 스펙 참조는 아니다", () => {
  const r = refs(cl(
    "| 2026-07-31 | **FR-018 신규: Jira 댓글 삭제** — DELETE /api/jira/comments | 오작성 정정 |",
    "| 2026-07-30 | **FR-016/017 신규: 댓글 조회·작성 API** | 대시보드 요구 |",
    "| 2026-07-29 | **FR-017 개정: 본인 계정으로 작성** | 감사 추적 |",
    "| 2026-07-28 | FR-006 관련 문구 정리 | 단순 언급은 선언이 아니다 |",
    "| 2026-07-27 | SPEC-013/FR-003 대조 배선 | 타 스펙 참조 |",
    "| 2026-07-26 | Change-Driver: SPEC-017 FR-004b | 타 스펙 참조(공백 구분) |",
  ));
  assert.deepEqual([...r.declared.keys()].sort((a, b) => a - b), [16, 17, 18]);
  assert.equal(r.declared.get(18).verb, "신규");
  assert.equal(r.declared.get(17).verb, "신규");   // 먼저 나온 선언이 이긴다(신규 → 개정 순)
  assert.equal(r.retired.size, 0);
});

test("changeLogFrRefs: 폐기 선언은 declared가 아니라 retired — 본문이 없어도 정당하다", () => {
  const r = refs(cl("| 2026-08-01 | **FR-018 폐기** — 엔드포인트 제거 | 요구 철회 |"));
  assert.equal(r.declared.size, 0);
  assert.ok(r.retired.has(18));
  // 신규로 선언됐다가 나중에 폐기되면 남는 것은 폐기다(순서 무관 — 최종 상태가 정본)
  const both = refs(cl("| 2026-07-01 | **FR-018 신규** | x |", "| 2026-08-01 | **FR-018 폐기** | y |"));
  assert.equal(both.declared.size, 0);
  assert.ok(both.retired.has(18));
});

test("changeLogFrRefs: 표 행만 본다 · 코드 스팬은 인용 · 어휘는 프로젝트가 바꾼다", () => {
  // 절 안의 산문·주석은 기록이 아니다(표 행만 기록)
  assert.equal(refs("## Change Log\n<!-- FR-018 신규라고 적어도 표 행이 아니다 -->\n산문에 FR-019 신규.\n").declared.size, 0);
  // 문법 자체를 설명하는 스펙이 자기 예시로 위반이 되면 안 된다(SPEC-031·033 동형)
  assert.equal(refs(cl("| 2026-08-02 | 형식은 `FR-018 신규`처럼 적는다 | 문법 설명 |")).declared.size, 0);
  // 킷은 `신설`, 제보 프로젝트는 `신규` — 어휘를 못 박으면 표현이 한 글자 다른 저장소에서 inert
  assert.ok(refs(cl("| 2026-08-02 | **FR-007 신설**: x | y |")).declared.has(7));
  assert.equal(refs(cl("| 2026-08-02 | **FR-007 added**: x | y |")).declared.size, 0);
  assert.ok(refs(cl("| 2026-08-02 | **FR-007 added**: x | y |"), { neu: ["added"] }).declared.has(7));
});

test("changeLogFrFindings: 실재하면 통과 · 없으면 위반 · 서픽스는 기저 번호로 접힌다", () => {
  const declared = refs(cl(
    "| d | **FR-004 신규** | r |", "| d | **FR-018 신규** | r |",
  )).declared;
  assert.deepEqual(changeLogFrFindings("SPEC-017", declared, ["FR-004", "FR-018"]), []);
  // FR-004b만 있어도 기저 004는 실재한다(SPEC-014 접기 규칙 유지)
  assert.deepEqual(changeLogFrFindings("SPEC-017", declared, ["FR-004b", "FR-018"]), []);
  const bad = changeLogFrFindings("SPEC-017", declared, ["FR-004"]);
  assert.deepEqual(bad.map((f) => f.id), ["FR-018"]);
});

test("frNumberingIssues: 결번 문구가 선언 여부로 갈린다 — 폐기 흔적과 결함을 같은 말로 하지 않는다", () => {
  const plain = frNumberingIssues("SPEC-017", ["FR-001", "FR-003"]).advisory.join("\n");
  assert.match(plain, /FR 폐기 잔분일 수 있음/);
  const declaredGap = frNumberingIssues("SPEC-017", ["FR-001", "FR-003"], new Set([2])).advisory.join("\n");
  assert.match(declaredGap, /Change Log가 선언했으나 본문 없음/);
  assert.doesNotMatch(declaredGap, /폐기 잔분일 수 있음/);   // 결함을 정당한 흔적으로 말하지 않는다
  // 둘이 섞이면 각각 제 문장으로 나온다(한 줄로 뭉뚱그리면 다시 구분이 사라진다)
  const mixed = frNumberingIssues("SPEC-017", ["FR-001", "FR-005"], new Set([3])).advisory.join("\n");
  assert.match(mixed, /FR-003 — \*\*Change Log가 선언했으나 본문 없음/);
  assert.match(mixed, /FR-002, FR-004 — FR 폐기 잔분/);
});

// ── 게이트 e2e (실측 사례 역검증) ──

function fixture(cfg, specBody) {
  const root = mkdtempSync(join(tmpdir(), "sdd-clfr-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", scanDirs: ["src"],
    retiredIds: Array.from({ length: 16 }, (_, i) => `SPEC-${String(i + 1).padStart(3, "0")}`),
    ...cfg,
  }));
  writeFileSync(join(root, "sdd/specs/SPEC-017.md"), `**Spec**: \`SPEC-017\`\n${specBody}`);
  writeFileSync(join(root, "src/a.test.mjs"), `${TAG}SPEC-017/FR-015\n`);
  return root;
}
function run(root, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// 실측 재현 — 이 본문이 탐지되지 않으면 패턴이 좁은 것이다.
const REAL = [
  "## Functional Requirements (EARS)",
  "- **FR-015** (event): WHEN a sync request arrives, THE SYSTEM SHALL enqueue it.",
  "- **FR-019** (event): WHEN a webhook arrives, THE SYSTEM SHALL verify its signature.",
  "",
  cl(
    "| 2026-07-30 | **FR-016/017 신규: Jira 댓글 조회·작성 API** — GET/POST /api/jira/comments | 대시보드 요구 |",
    "| 2026-07-31 | **FR-017 개정: 본인 Jira 계정으로 댓글 작성** | 봇 계정이 감사 추적을 흐림 |",
    "| 2026-07-31 | **FR-018 신규: Jira 댓글 삭제** — DELETE /api/jira/comments | 오작성 정정 경로 부재 |",
    "| 2026-08-01 | SPEC-013/FR-003 참조 정리 | 타 스펙 참조 — 대상 아님 |",
  ),
].join("\n");

test("게이트 e2e(실측 역검증): FR-016/017/018 선언 + 본문 없음 → 3건 지목, 타 스펙 참조는 오탐 0", () => {
  const root = fixture({}, REAL);
  try {
    const r = run(root);
    assert.equal(r.code, 0, "advisory는 차단하지 않는다");
    for (const id of ["FR-016", "FR-017", "FR-018"]) {
      assert.match(r.out, new RegExp(`Change Log가 ${id} (?:신규|개정)를 선언했으나 FR 절에 본문 없음`), r.out);
    }
    assert.doesNotMatch(r.out, /FR-003 (?:신규|개정)를 선언/);        // SPEC-013/FR-003 오탐 없음
    assert.match(r.out, /Change Log가 선언했으나 본문 없음/);          // 결번 문구도 갈렸다
    assert.doesNotMatch(r.out, /FR-016, FR-017, FR-018 — FR 폐기 잔분/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 e2e: off는 판정 안 함 / hard는 exit 1 / 잘못된 정책 값은 즉시 exit 1", () => {
  const off = fixture({ changeLogFrRefPolicy: "off" }, REAL);
  const hard = fixture({ changeLogFrRefPolicy: "hard" }, REAL);
  const bad = fixture({ changeLogFrRefPolicy: "strict" }, REAL);
  try {
    const o = run(off);
    assert.equal(o.code, 0);
    assert.doesNotMatch(o.out, /Change Log가 FR-018/);
    assert.match(o.out, /FR-016, FR-017, FR-018 — FR 폐기 잔분/);   // off면 결번 문구도 원래대로

    const h = run(hard);
    assert.equal(h.code, 1);
    assert.match(h.out, /Change Log가 FR-018 신규를 선언했으나/);

    const b = run(bad);
    assert.equal(b.code, 1);
    assert.match(b.out, /changeLogFrRefPolicy 값 위반/);
  } finally { for (const r of [off, hard, bad]) rmSync(r, { recursive: true, force: true }); }
});

test("게이트 e2e: 본문이 있으면 통과 / 폐기 표기면 통과(정당한 흔적)", () => {
  const present = fixture({ changeLogFrRefPolicy: "hard" }, [
    "## Functional Requirements (EARS)",
    "- **FR-015** (event): WHEN x, THE SYSTEM SHALL y.",
    "- **FR-016** (event): WHEN a comment is fetched, THE SYSTEM SHALL return it.",
    "",
    cl("| 2026-07-30 | **FR-016 신규: 댓글 조회** | 요구 |"),
  ].join("\n"));
  const retired = fixture({ changeLogFrRefPolicy: "hard" }, [
    "## Functional Requirements (EARS)",
    "- **FR-015** (event): WHEN x, THE SYSTEM SHALL y.",
    "",
    cl("| 2026-08-01 | **FR-018 폐기** — 엔드포인트 제거 | 요구 철회 |"),
  ].join("\n"));
  try {
    assert.equal(run(present).code, 0, run(present).out);
    const r = run(retired);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /FR-018 .*선언했으나/);
  } finally { for (const x of [present, retired]) rmSync(x, { recursive: true, force: true }); }
});
