// @covers SPEC-001/FR-006
// @covers SPEC-001/FR-007
// @covers SPEC-001/FR-009
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../sdd-config.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("config: 새 필드 기본값", () => {
  const cfg = loadConfig("/nonexistent"); // config 파일 없음 → DEFAULTS
  assert.deepEqual(cfg.specIdPrefixes, ["SPEC", "INFRA", "TEST", "CICD"]);
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

test("config: requirementIdPrefixes 기본 [FR] + 파생 정규식(__reqAlt/__frDeclRe/__frTokenRe)", () => {
  const cfg = loadConfig("/nonexistent");
  assert.deepEqual(cfg.requirementIdPrefixes, ["FR"]);
  assert.equal(cfg.__reqAlt, "FR");
  assert.equal([...("**FR-001a** x").matchAll(cfg.__frDeclRe)][0][1], "FR-001a");
  assert.equal([...("NFR-001 x").matchAll(cfg.__frDeclRe)].length, 0); // 미등록 접두어는 불인정
});

test("config: requirementIdPrefixes 확장 시 선언·@covers·토큰 전 파생값이 함께 인정", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdd-cfg-req-"));
  try {
    writeFileSync(join(dir, "sdd.config.json"), JSON.stringify({ requirementIdPrefixes: ["FR", "NFR"] }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.__reqAlt, "FR|NFR");
    assert.equal([...("**NFR-002** y").matchAll(cfg.__frDeclRe)][0][1], "NFR-002");
    const tag = "// @cov" + "ers SPEC-001/NFR-002a"; // 자기 게이트 스캔 중화
    const m = [...tag.matchAll(cfg.__coversRe)];
    assert.equal(m.length, 1);
    assert.equal(m[0][2], "NFR-002a"); // 서픽스 문법도 파생 접두어에 동일 적용
    assert.equal([...(tag + "b").matchAll(cfg.__coversRe)].length, 0); // 2자 서픽스 경계 강제 유지
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
