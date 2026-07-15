// @covers SPEC-002/FR-003
// @covers SPEC-002/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-spec-cohesion.mjs", import.meta.url).pathname;

function fixture(cfg, files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-coh-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify(cfg));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const CFG = { specDir: "sdd/specs", maxKeysPerCategoryPerSpec: 4, maxFRsPerSpec: 8 };

test("응집된 spec(키·FR 기준 내) → 통과", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n**FR-002** b\n## Ownership\n- **Capabilities**: a.create, a.update\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /분할 권고 없음/);
});

test("FR 과다(>8) → advisory(exit 0), strict 실패", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture(CFG, { "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /SPEC-001/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("카테고리 키 과다(Capabilities 5>4) → advisory(exit 0), strict 실패", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Capabilities**: a.c, a.d, a.e, a.f, a.g\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /Capabilities/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("Ownership Entities 2개+ = aggregate 다수 분할 신호(advisory)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-coh-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  writeFileSync(join(root, "sdd", "specs", "SPEC-001.md"),
    "# SPEC-001\n## Ownership\n- **Entities**: recommendation, invoice\n");
  let out;
  try {
    out = execFileSync("node", [new URL("../check-spec-cohesion.mjs", import.meta.url).pathname],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
    assert.equal(e.status, 0, `expected exit 0 (advisory), got ${e.status}\n${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // must mention aggregate AND split review — not just "분할 권고 없음" (quiet pass)
  assert.match(out, /aggregate.*분할|분할.*aggregate|aggregate|여러.aggregate|aggregate.다수/i);
  // must have a violation line mentioning Entities and aggregate signal
  assert.match(out, /Entities.*aggregate|aggregate.*Entities/i);
});

test("FR 카운트가 레터 서픽스 FR(FR-008a)을 집계 — 9개>8 과다 advisory·strict 실패", () => {
  const frs = Array.from({ length: 8 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture(CFG, { "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n**FR-008a** y\n` });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /SPEC-001/); // 과다 신호에 spec이 지목돼야 함(조용한 미집계 금지)
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("maxAggregateRootsPerSpec 상향 → aggregate 다수 신호 억제(루트+자식표 소유 모델)", () => {
  const dir = fixture({ specDir: "sdd/specs", maxAggregateRootsPerSpec: 10, maxKeysPerCategoryPerSpec: 10 }, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Entities**: root, child_a, child_b, child_c\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /aggregate/i); // 임계 상향 시 aggregate 경고 없음
  assert.match(r.out, /분할 권고 없음/);
});

test("Change Log의 FR 인용은 FR 수 카운트에서 제외 — 정의(**FR-NNN**)만 집계(오탐 회귀)", () => {
  // 본문 정의 3개 + Change Log가 FR-004~FR-012 인용(9개). 평문 토큰 카운트면 12>8 오탐,
  // 정의(**FR**)만 세면 3 → 분할 권고 없음. (SPEC-013 "15>11" 오탐과 동종)
  const cl = Array.from({ length: 9 }, (_, i) => `| 2026-07-15 | FR-${String(i + 4).padStart(3, "0")} 관련 수정 | c |`).join("\n");
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n**FR-002** b\n**FR-003** c\n\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n" + cl + "\n",
  });
  const warn = run(dir);
  assert.match(warn.out, /분할 권고 없음/, warn.out);        // 정의 3개뿐 → 오탐 없어야
  assert.equal(run(dir, ["--strict"]).code, 0, "인용 카운트로 FR 과다 오탐(strict exit 1)");
});
