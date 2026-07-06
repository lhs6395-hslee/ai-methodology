// tooling/__tests__/test-domain.test.mjs
// TEST 삭제가능 도메인(SPEC-015): TEST 스펙의 인프라 소유 허용(prefix-class 면제) +
// 테스트 인프라 격리(testInfraGlobs 매치 파일은 TEST 스펙 소유 강제).
// @covers SPEC-015/FR-001
// @covers SPEC-015/FR-002
// @covers SPEC-015/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { testInfraFinding } from "../test-domain-lib.mjs";
import { prefixClassFinding } from "../prefix-class-lib.mjs";
import { compileGlob } from "../spec-sync-lib.mjs";
import { DEFAULTS } from "../sdd-config.mjs";

const TIG = ["**/qa/**"].map(compileGlob);
const GLOBS = { iac: DEFAULTS.derivationClassGlobs.iac.map(compileGlob), ci: DEFAULTS.derivationClassGlobs.ci.map(compileGlob) };

test("testInfraFinding: 비-TEST 스펙이 testInfra 파일 소유 → 위반(예시 파일 지목)", () => {
  const f = testInfraFinding("INFRA", ["infra/qa/bucket.tf", "infra/prod/main.tf"], TIG);
  assert.ok(f);
  assert.match(f.files[0], /qa/);
});

test("testInfraFinding: TEST 스펙 소유는 정상(null)", () => {
  assert.equal(testInfraFinding("TEST", ["infra/qa/bucket.tf"], TIG), null);
});

test("testInfraFinding: testInfraGlobs 미매치 → null", () => {
  assert.equal(testInfraFinding("INFRA", ["infra/prod/main.tf"], TIG), null);
});

test("testInfraFinding: testInfraGlobs [] 이면 비활성(null)", () => {
  assert.equal(testInfraFinding("INFRA", ["infra/qa/x.tf"], []), null);
});

test("prefix-class: TEST는 iac/ci 전용 소유 허용 — error 아님(자기 인프라 소유)", () => {
  assert.equal(prefixClassFinding("TEST", ["infra/main.tf", ".github/workflows/ci.yml"], GLOBS), null);
});
