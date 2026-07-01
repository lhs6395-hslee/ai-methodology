import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../sdd-config.mjs";

test("config: 새 필드 기본값", () => {
  const cfg = loadConfig("/nonexistent"); // config 파일 없음 → DEFAULTS
  assert.deepEqual(cfg.specIdPrefixes, ["SPEC", "INFRA", "TEST"]);
  assert.deepEqual(cfg.prefixRationale, {});
  assert.deepEqual(cfg.capabilityVerbs, []);
  assert.equal(cfg.surfacePathParam, "{name}");
});

test("config: verb 파생값(crud + 도메인)", () => {
  const cfg = loadConfig("/nonexistent");
  assert.ok(cfg.__allVerbs.has("create"));
  assert.ok(cfg.__allVerbs.has("list"));
  assert.equal(cfg.__allVerbs.has("recommend"), false);
});
