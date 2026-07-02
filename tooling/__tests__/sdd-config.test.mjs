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
