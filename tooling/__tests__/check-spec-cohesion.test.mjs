// @covers SPEC-002/FR-003
// @covers SPEC-002/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GATE = fileURLToPath(new URL("../check-spec-cohesion.mjs", import.meta.url));

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
      "**Spec**: `SPEC-001`\n**FR-001** a\n**FR-002** b\n## Ownership\n- **Entities**: a\n- **Capabilities**: a.create, a.update\n",
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
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Entities**: a\n- **Capabilities**: a.c, a.d, a.e, a.f, a.g\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /Capabilities/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("entity 역할 선언 + 키 소유하나 aggregate root 0개(Surface/Capability만 번들) → advisory, strict 실패 (owner #1)", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Surfaces**: GET /a\n- **Capabilities**: a.create\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /aggregate root.*0개|entity.*최소 1개/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("capability 캡은 entity별 — 다-entity 총합>4라도 entity별 ≤4면 통과(SPEC-024 모순 해소)", () => {
  // a: 3 verbs, b: 2 verbs (총 5 > 4). entity별 최대 3 ≤ 4 → Capabilities 분할 신호 없음.
  const dir = fixture({ specDir: "sdd/specs", maxKeysPerCategoryPerSpec: 4, maxAggregateRootsPerSpec: 2 }, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Entities**: a, b\n- **Capabilities**: a.create, a.read, a.update, b.create, b.read\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /Capabilities/); // 총 5개지만 entity별 캡이라 분할 권고 없음
  // 한 entity가 5 verbs면 여전히 flag(entity별 초과)
  const dir2 = fixture({ specDir: "sdd/specs", maxKeysPerCategoryPerSpec: 4 }, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Entities**: a\n- **Capabilities**: a.create, a.read, a.update, a.delete, a.list\n",
  });
  const r2 = run(dir2);
  assert.match(r2.out, /entity:a/);
  assert.equal(run(dir2, ["--strict"]).code, 1);
});

test("entity 역할 미선언(순수 lib 카테고리) → aggregate root 하한 inert(하위호환)", () => {
  const dir = fixture(
    { specDir: "sdd/specs", ownershipCategories: ["Widgets", "Gadgets"] },
    { "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Widgets**: w1\n" });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /분할 권고 없음/); // entity 역할 없음 → 하한 미발화
});

test("Ownership Entities 2개+ = aggregate 다수 분할 신호(advisory)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-coh-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
  writeFileSync(join(root, "sdd", "specs", "SPEC-001.md"),
    "# SPEC-001\n## Ownership\n- **Entities**: recommendation, invoice\n");
  let out;
  try {
    out = execFileSync("node", [fileURLToPath(new URL("../check-spec-cohesion.mjs", import.meta.url))],
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

// ── 지원 계층 등록부(교착 해소) ──
// 실측 제보: entity 0개 계층이 FR 캡을 넘겼을 때 분할하려 해도 새 스펙이 `entity(min)`에 걸려
// **분할 자체가 불가능**했고, 남은 출구가 캡 상향(=완화, 래칫이 차단)뿐인 교착이 생겼다.
// 여기서 푸는 것은 `entity(min)` 하나뿐 — 캡을 풀면 교착이 아니라 규범이 사라진다.
const ENTLESS = "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Surfaces**: config/build.json\n";

test("지원 계층: 미등록 entity-less는 (min) 위반 / 등록하면 면제되고 사유와 함께 항상 표면화", () => {
  const plain = run(fixture(CFG, { "sdd/specs/SPEC-001.md": ENTLESS }));
  assert.match(plain.out, /aggregate root\(Entities\) 0개/);
  assert.match(plain.out, /supportLayerSpecs에 \*\*사유와 함께\*\* 등록/); // 처방에 경로가 보여야 한다

  const reg = run(fixture({ ...CFG, supportLayerSpecs: { "SPEC-001": "공유 빌드 설정 — 도메인 entity가 없다" } },
    { "sdd/specs/SPEC-001.md": ENTLESS }));
  assert.equal(reg.code, 0);
  assert.match(reg.out, /지원 계층 스펙 1건/);
  assert.match(reg.out, /SPEC-001\(공유 빌드 설정 — 도메인 entity가 없다\)/); // clean일 때도 부채로 보인다
  assert.match(reg.out, /분할 권고 없음/);
});

test("지원 계층: 등록해도 FR·키 캡은 그대로 — 면제는 (min) 하나뿐(캡을 풀면 규범이 사라진다)", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture({ ...CFG, supportLayerSpecs: { "SPEC-001": "공유 설정" } },
    { "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n## Ownership\n- **Surfaces**: config/build.json\n` });
  assert.match(run(dir).out, /FR 9개 > 8/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("지원 계층 등록부 무결성: 빈 사유·없는 스펙·entity 소유 스펙 등록은 판정 전 exit 1", () => {
  const noReason = run(fixture({ ...CFG, supportLayerSpecs: { "SPEC-001": "  " } }, { "sdd/specs/SPEC-001.md": ENTLESS }));
  assert.equal(noReason.code, 1);
  assert.match(noReason.out, /사유 필수/);

  const stale = run(fixture({ ...CFG, supportLayerSpecs: { "SPEC-999": "낡음" } }, { "sdd/specs/SPEC-001.md": ENTLESS }));
  assert.equal(stale.code, 1);
  assert.match(stale.out, /그런 스펙이 없다/);

  const hasEnt = run(fixture({ ...CFG, supportLayerSpecs: { "SPEC-001": "필요 없는 면제" } },
    { "sdd/specs/SPEC-001.md": "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Entities**: a\n" }));
  assert.equal(hasEnt.code, 1);
  assert.match(hasEnt.out, /aggregate 있음/);
});
