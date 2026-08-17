// 명세 자기모순 감사 (SPEC-052, R20) — **명세 코퍼스가 스스로와 정합한가.**
//
// 오너 지시: "명세가 충돌되는 것도 없도록 방법론이 잘 구성되어야 한다 — spec 1은 A를 해라,
// spec 2는 A를 하지 말아라. 애초에 이런 구멍도 없어야 한다."
// 실측: 에이전트가 명세에 이미 답이 있는데 읽지 않고 실측으로 다시 찾았고 결론까지 틀렸다.
// 명세 안에 반대 방향 지시가 공존한 탓에 오너가 여러 세션에 걸쳐 금지한 경로가 재발했다.
// @covers SPEC-052/FR-001
// @covers SPEC-052/FR-002
// @covers SPEC-052/FR-003
// @covers SPEC-052/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lineDirectives, predicateTokens, collectDirectives, docFrequency, specConflicts, formatConflict,
  DEFAULT_MIN_TOKENS, DEFAULT_MAX_DOC_FREQ,
} from "../spec-conflict-lib.mjs";
import { localImports } from "../import-wiring-lib.mjs";

const decl = (l) => /\*\*(FR|NFR)-\d/.test(l);
const corpus = (map) => Object.entries(map).map(([id, text]) => ({ id, file: `${id}.md`, text }));

// ── 지시 추출 ────────────────────────────────────────────────────────────────
test("한 줄의 여러 지시를 각각 뽑는다 — `SHALL X … and SHALL NOT Y`는 두 지시다", () => {
  const d = lineDirectives("THE SYSTEM SHALL report it and SHALL NOT block the push.");
  assert.equal(d.length, 2);
  assert.equal(d[0].neg, false);
  assert.equal(d[1].neg, true);
});

test("SHALL NEVER도 부정이다", () => {
  assert.equal(lineDirectives("THE SYSTEM SHALL NEVER delete the ledger.")[0].neg, true);
});

// 실측 오탐: 술어가 뒤 절(`; WHERE the command exit…`)까지 삼켜 무관한 지시가 겹쳤다.
test("술어는 절 경계에서 끊는다 — 뒤 절은 다른 지시의 문맥이다", () => {
  const d = lineDirectives("THE SYSTEM SHALL block on those candidates; WHERE the command exits non-zero, it stops.");
  assert.equal(d.length, 1);
  assert.doesNotMatch(d[0].predicate, /exit/);
});

test("내용 토큰만 남기고 거칠게 단수화한다 — `spec's`·`specs` → `spec`", () => {
  assert.deepEqual([...predicateTokens("relax the owning spec's requirements")].sort(),
    ["owning", "relax", "requirement", "spec"]);
});

// ── 판정: 양성 대조 ──────────────────────────────────────────────────────────
// 제보의 형태 그대로 — 한쪽은 쓰라 하고 다른 쪽은 쓰지 말라 한다.
test("교차 스펙 상반 지시를 잡는다 — 제보의 ArgoCD 형태", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL use ArgoCD for deployment synchronisation.",
    "SPEC-901": "- **FR-001** IF a deploy is requested, THEN THE SYSTEM SHALL NOT use ArgoCD for deployment synchronisation.",
  }), decl);
  const r = specConflicts(ds);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.sameSpec.length, 0);
  assert.equal(r.conflicts[0].positive.specId, "SPEC-900");
  assert.equal(r.conflicts[0].negative.specId, "SPEC-901");
});

// 고정 길이 술어 머리 비교에는 **짧은 술어를 통째로 건너뛰는 회수 구멍**이 있었다.
test("짧은 술어도 잡는다 — 포함 관계이므로 `use ArgoCD`가 긴 쪽과 맞물린다", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL use ArgoCD for deployment synchronisation.",
    "SPEC-903": "- **FR-001** THE SYSTEM SHALL NOT use ArgoCD.",
  }), decl);
  assert.equal(specConflicts(ds).conflicts.length, 1);
});

test("한 스펙 내 모순은 따로 회계한다 — 해소 방법이 다르다", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL use ArgoCD for sync.\n- **FR-002** THE SYSTEM SHALL NOT use ArgoCD for sync.",
  }), decl);
  const r = specConflicts(ds);
  assert.equal(r.sameSpec.length, 1);
  assert.equal(r.conflicts.length, 0);
});

// ── 판정: 오탐 억제 ──────────────────────────────────────────────────────────
test("다른 목적어는 모순이 아니다 — `block the commit` vs `block the push`", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL block the commit and SHALL NOT block the push.",
  }), decl);
  assert.deepEqual(specConflicts(ds).sameSpec, []);
});

test("같은 방향 지시는 모순이 아니다", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL use ArgoCD for sync.",
    "SPEC-901": "- **FR-001** THE SYSTEM SHALL use ArgoCD for sync.",
  }), decl);
  assert.deepEqual(specConflicts(ds).conflicts, []);
});

// 실측 오탐: `report it as a violation`이 여러 스펙에 흔한 술어라 주어가 달라도 겹쳤다.
// 어휘 목록을 박지 않고 **말뭉치 희귀도**로 가른다 — 목록이 아니라 통계라 자기교정적이다.
test("흔한 술어끼리의 겹침은 후보가 아니다 — 희귀 토큰이 없으면 주어가 다를 개연성이 높다", () => {
  const many = {};
  for (let i = 0; i < 6; i++) many[`SPEC-${900 + i}`] = `- **FR-001** THE SYSTEM SHALL report a violation.`;
  many["SPEC-950"] = "- **FR-001** THE SYSTEM SHALL NOT report a violation.";
  const ds = collectDirectives(corpus(many), decl);
  // report·violation이 7개 스펙에 등장 → maxDocFreq(3) 초과 → 구별력 없음
  assert.deepEqual(specConflicts(ds).conflicts, []);
  // 희귀 기준을 넉넉히 풀면 같은 쌍이 후보로 올라온다(판정이 통계에 달려 있음을 고정)
  assert.ok(specConflicts(ds, { maxDocFreq: 99 }).conflicts.length > 0);
});

test("1토큰 술어는 판정 대상이 아니다 — 겹침이 신호가 되지 못한다", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL report.",
    "SPEC-901": "- **FR-001** THE SYSTEM SHALL NOT report.",
  }), decl);
  assert.equal(ds.length, 0);
  assert.equal(DEFAULT_MIN_TOKENS, 2);
  assert.equal(DEFAULT_MAX_DOC_FREQ, 3);
});

test("문서빈도는 스펙 단위로 센다 — 한 스펙이 여러 번 써도 1이다", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL use ArgoCD now.\n- **FR-002** THE SYSTEM SHALL use ArgoCD later.",
  }), decl);
  assert.equal(docFrequency(ds).get("argocd").size, 1);
});

// ── 게이트가 정본을 고르지 않는다 ────────────────────────────────────────────
test("게이트는 어느 쪽이 정본인지 정하지 않는다 — 추정이 다음 모순의 씨앗이 된다", () => {
  const ds = collectDirectives(corpus({
    "SPEC-900": "- **FR-001** THE SYSTEM SHALL use ArgoCD for sync.",
    "SPEC-901": "- **FR-001** THE SYSTEM SHALL NOT use ArgoCD for sync.",
  }), decl);
  const lines = formatConflict(specConflicts(ds).conflicts[0]);
  assert.equal(lines.length, 3);
  assert.match(lines[2], /어느 쪽이 정본인지 결정/);
  assert.match(lines[2], /게이트는 정하지 않는다/);
});

// ── 킷 자기적용 ──────────────────────────────────────────────────────────────
test("킷 코퍼스에 상반된 지시가 없다(도그푸딩) — 도입 전 오탐 0을 측정한 그 코퍼스다", () => {
  const dir = fileURLToPath(new URL("../../sdd/specs", import.meta.url));
  const specs = readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => ({
    id: n.replace(/\.md$/, ""), file: n, text: readFileSync(join(dir, n), "utf8"),
  }));
  const ds = collectDirectives(specs, decl);
  assert.ok(ds.length > 300, `지시가 너무 적다(${ds.length}) — 추출이 깨졌을 수 있다`);
  const r = specConflicts(ds);
  assert.deepEqual([...r.sameSpec, ...r.conflicts].map(formatConflict), []);
});

// ── 게이트: 차단을 증명한다(카나리아 계약 — SPEC-048) ─────────────────────────
function fixture(policy, specs) {
  const root = mkdtempSync(join(tmpdir(), "sdd-conflict-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", specConflictPolicy: policy }));
  const seen = new Set(); const stack = ["check-spec-conflict.mjs"];
  const TOOLING = fileURLToPath(new URL("..", import.meta.url));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let t; try { t = readFileSync(join(TOOLING, f), "utf8"); } catch { continue; }
    for (const imp of localImports(t)) stack.push(imp.specifier.replace(/^\.\//, ""));
  }
  for (const f of seen) cpSync(join(TOOLING, f), join(root, "scripts", f));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", `${name}.md`), body);
  return root;
}
const run = (root) => {
  try { return { code: 0, out: execFileSync("node", [join(root, "scripts", "check-spec-conflict.mjs")], { cwd: root, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
};
const CONFLICT = {
  "SPEC-900": "**Spec**: `SPEC-900`\n## Functional Requirements\n- **FR-001** THE SYSTEM SHALL use ArgoCD for deployment synchronisation.\n",
  "SPEC-901": "**Spec**: `SPEC-901`\n## Functional Requirements\n- **FR-001** THE SYSTEM SHALL NOT use ArgoCD for deployment synchronisation.\n",
};

test("게이트가 명세 모순을 hard에서 **실제로 막는다** — 통과 경로만 관측된 게이트는 미검증이다", () => {
  const r = run(fixture("hard", CONFLICT));
  assert.equal(r.code, 1, `막지 않았다:\n${r.out}`);
  assert.match(r.out, /ArgoCD/);
  assert.match(r.out, /판정: JUDGED/);
});

test("advisory는 막지 않고 표면화한다", () => {
  const r = run(fixture("advisory", CONFLICT));
  assert.equal(r.code, 0);
  assert.match(r.out, /ArgoCD/);
});

test("off는 판정하지 않는다고 선언한다 — clean이 아니다(SPEC-040)", () => {
  assert.match(run(fixture("off", CONFLICT)).out, /판정: OFF/);
});

test("SHALL 지시가 0건이면 INERT다 — EARS 문법이 없는 코퍼스의 0건은 '깨끗함'이 아니다", () => {
  const r = run(fixture("hard", { "SPEC-900": "**Spec**: `SPEC-900`\n## Functional Requirements\n- **FR-001** 이 시스템은 항목을 만든다.\n" }));
  assert.match(r.out, /판정: INERT/);
  assert.match(r.out, /어휘 교체다/);
});

test("스펙 0건도 INERT다", () => {
  assert.match(run(fixture("hard", {})).out, /판정: INERT/);
});
