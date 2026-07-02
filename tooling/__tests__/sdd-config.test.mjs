// @covers SPEC-001/FR-006
// @covers SPEC-001/FR-007
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../sdd-config.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("config: 새 필드 기본값", () => {
  const cfg = loadConfig("/nonexistent"); // config 파일 없음 → DEFAULTS
  assert.deepEqual(cfg.specIdPrefixes, ["SPEC", "INFRA", "TEST"]);
  assert.deepEqual(cfg.prefixRationale, {});
  assert.deepEqual(cfg.capabilityVerbs, []);
  assert.equal(cfg.surfacePathParam, "{name}");
});

test("config: specSyncExemptGlobs 기본 []", () => {
  const cfg = loadConfig("/nonexistent");
  assert.deepEqual(cfg.specSyncExemptGlobs, []);
});

test("config: verb 파생값(crud + 도메인)", () => {
  const cfg = loadConfig("/nonexistent");
  assert.ok(cfg.__allVerbs.has("create"));
  assert.ok(cfg.__allVerbs.has("list"));
  assert.equal(cfg.__allVerbs.has("recommend"), false);
});

test("config: 커스텀 capabilityVerbs가 __allVerbs에 소문자로 병합", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdd-cfg-"));
  try {
    writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ capabilityVerbs: ["Recommend"] }));
    const cfg = loadConfig(dir);
    assert.ok(cfg.__allVerbs.has("recommend"));   // lowercased
    assert.ok(cfg.__allVerbs.has("create"));       // crud still present
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config: __coversRe 레터 서픽스(FR-003a) 온전 캡처, 2자 서픽스는 불인정", () => {
  const cfg = loadConfig("/nonexistent");
  const tag = (fr) => "// @cov" + `ers SPEC-004/${fr}`; // 자기 게이트 스캔 중화
  const one = [...tag("FR-003a").matchAll(cfg.__coversRe)];
  assert.equal(one.length, 1);
  assert.equal(one[0][2], "FR-003a"); // FR-003 절단 오판 금지(도그푸딩 PM f36494a 회귀)
  const two = [...tag("FR-003ab").matchAll(cfg.__coversRe)];
  assert.equal(two.length, 0);        // 부분 캡처(FR-003a)도 금지 — 경계 강제
});
