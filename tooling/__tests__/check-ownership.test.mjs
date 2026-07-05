// tooling/__tests__/check-ownership.test.mjs
// @covers SPEC-002/FR-002
// @covers SPEC-002/FR-007
// @covers SPEC-002/FR-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(specs, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-own-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({
    specDir: "sdd/specs", capabilityVerbs: ["recommend"],
  }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Dependencies의 키는 dedup 대상이 아니다(거짓양성 해소)", () => {
  // A naive impl that fed ## Dependencies into the dedup map would see SPEC-001
  // "owning" staff (via its Dependencies) AND SPEC-002 owning it → false conflict (exit 1).
  // Correct impl excludes Dependencies → only SPEC-002 owns staff → exit 0.
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n## Dependencies\n- **Entities**: staff\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: staff\n"; // staff를 소유 → A는 참조라 충돌 아님
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 0, r.out);
});

test("같은 Ownership 키를 2 spec이 소유하면 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Entities**: recommendation\n";
  const B = "# SPEC-002\n## Ownership\n- **Entities**: Recommendation\n"; // 정규화 후 같은 키
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /recommendation/);
});

test("미등록 verb는 --strict에서 exit 1", () => {
  const A = "# SPEC-001\n## Ownership\n- **Capabilities**: staff.suggest\n";
  assert.equal(run({ "SPEC-001.md": A }).code, 0);            // 기본 warn
  assert.equal(run({ "SPEC-001.md": A }, ["--strict"]).code, 1); // strict 차단
});

test("Surface 정규화 후 충돌: 다른 param 문법·메서드 케이스가 같은 키로 수렴", () => {
  const A = "# SPEC-001\n## Ownership\n- **Surfaces**: POST /api/items/:id\n";
  const B = "# SPEC-002\n## Ownership\n- **Surfaces**: post /api/items/{id}/\n"; // normalizes to same key
  const r = run({ "SPEC-001.md": A, "SPEC-002.md": B });
  assert.equal(r.code, 1, r.out);
});

// ── P3(a): entityRegistry — @covers 태그는 파일 헤더 ──

function runWithConfig(specs, config, args = []) {
  const root = mkdtempSync(join(tmpdir(), "sdd-own-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...config }));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(root, "sdd", "specs", name), body);
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-ownership.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("entityRegistry: 미등록 entity 소유 → exit 1 / 등록·사유 구비 → 통과(정규화 비교)", () => {
  const A = "# SPEC-001\nrecommendation 얘기.\n## Ownership\n- **Entities**: Recommendation\n"; // 대문자 → 정규화 후 비교
  const unregistered = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: { staff: "직원 aggregate" } });
  assert.equal(unregistered.code, 1, unregistered.out);
  assert.match(unregistered.out, /미등록 entity "recommendation" \(SPEC-001\)/);
  const ok = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: { recommendation: "추천 aggregate — 후보 산출의 SSOT" } });
  assert.equal(ok.code, 0, ok.out);
});

test("entityRegistry: 빈 사유 → exit 1 / 소유 spec 없는 등록 키 → ⚠ warn만 / 빈 레지스트리 → 비활성", () => {
  const A = "# SPEC-001\nrecommendation 얘기.\n## Ownership\n- **Entities**: recommendation\n";
  const emptyRationale = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: { recommendation: " " } });
  assert.equal(emptyRationale.code, 1, emptyRationale.out);
  assert.match(emptyRationale.out, /도입 사유 필요\(빈 값 불가\)/);
  const stale = runWithConfig({ "SPEC-001.md": A },
    { entityRegistry: { recommendation: "추천", ghost: "선등록" } });
  assert.equal(stale.code, 0, stale.out);
  assert.match(stale.out, /⚠ entityRegistry의 "ghost"를 소유한 spec 없음/);
  const off = runWithConfig({ "SPEC-001.md": A }, { entityRegistry: {} });
  assert.equal(off.code, 0, off.out);
  assert.doesNotMatch(off.out, /레지스트리/);
});
