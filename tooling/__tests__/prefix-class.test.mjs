// tooling/__tests__/prefix-class.test.mjs
// 접두어↔derivation 클래스 정합(SPEC-012) — 순수 코어 + fr 게이트 통합.
// @covers SPEC-012/FR-001
// @covers SPEC-012/FR-002
// @covers SPEC-012/FR-003
// @covers SPEC-012/FR-004
// @covers SPEC-012/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyInfraFile, prefixClassFinding, validateExemptions, INFRA_SOURCE_CLASSES } from "../prefix-class-lib.mjs";
import { compileGlob } from "../spec-sync-lib.mjs";
import { DEFAULTS } from "../sdd-config.mjs";

const GLOBS = Object.fromEntries(INFRA_SOURCE_CLASSES.map((c) => [c, DEFAULTS.derivationClassGlobs[c].map(compileGlob)]));

// ── 순수 코어 ──

test("classifyInfraFile: 기본 글롭으로 iac/ci/기타 분류", () => {
  assert.equal(classifyInfraFile("infra/main.tf", GLOBS), "iac");
  assert.equal(classifyInfraFile("Dockerfile", GLOBS), "iac");
  assert.equal(classifyInfraFile(".github/workflows/ci.yml", GLOBS), "ci");
  assert.equal(classifyInfraFile("src/app.mjs", GLOBS), null);
});

test("prefixClassFinding: 전적으로 iac/ci + 비INFRA 접두어 = error", () => {
  const f = prefixClassFinding("SPEC", ["infra/main.tf", ".github/workflows/ci.yml"], GLOBS);
  assert.equal(f?.kind, "error");
  assert.equal(f.infra.length, 2);
});

test("prefixClassFinding: 비-인프라 파일 1개라도 있으면 통과(전체성 임계 — 부수 소유 정당)", () => {
  assert.equal(prefixClassFinding("SPEC", ["infra/main.tf", "src/app.mjs"], GLOBS), null);
});

test("prefixClassFinding: INFRA 접두어 정합 = null / 인프라 검출 0 = warn", () => {
  assert.equal(prefixClassFinding("INFRA", ["infra/main.tf"], GLOBS), null);
  assert.equal(prefixClassFinding("INFRA", ["src/app.mjs"], GLOBS)?.kind, "warn");
  assert.equal(prefixClassFinding("INFRA", [], GLOBS)?.kind, "warn");
  assert.equal(prefixClassFinding("SPEC", [], GLOBS), null);
});

test("validateExemptions: dangling ID·빈 사유 = 에러", () => {
  const known = new Set(["SPEC-001"]);
  assert.equal(validateExemptions({ "SPEC-001": "부수 IaC 소유 정당" }, known).length, 0);
  assert.match(validateExemptions({ "SPEC-999": "x" }, known)[0], /존재하지 않는 spec/);
  assert.match(validateExemptions({ "SPEC-001": " " }, known)[0], /빈 값 불가/);
});

// ── fr 게이트 통합 ──

function run(files, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdd-pfxcls-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", scanDirs: ["src"], ...config }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  try {
    const out = execFileSync("node", [join(process.cwd(), "tooling/check-fr-coverage.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const IAC_SPEC = (id, files) =>
  `# ${id}\n**Spec**: \`${id}\`\n- **FR-001** THE SYSTEM SHALL provision x.\n\n## Ownership\n- **Files**: ${files}\n`;

test("fr: iac 전용 소유 스펙이 SPEC- 접두어 → exit 1(부정합) + 예시 파일 지목", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": IAC_SPEC("SPEC-001", "infra/**"),
    "infra/main.tf": "resource {}\n",
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /접두어↔클래스 부정합 "SPEC-001"/);
  assert.match(r.out, /infra\/main\.tf/);
});

test("fr: 같은 소유가 INFRA- 접두어면 통과", () => {
  const r = run({
    "sdd/specs/INFRA-001.md": IAC_SPEC("INFRA-001", "infra/**"),
    "infra/main.tf": "resource {}\n",
  });
  assert.equal(r.code, 0, r.out);
});

test("fr: 기능 SPEC-이 코드+부수 IaC를 함께 소유 → 통과(과잉발동 없음)", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": IAC_SPEC("SPEC-001", "src/app.mjs, Dockerfile"),
    "src/app.mjs": "export const v = 1;\n",
    "Dockerfile": "FROM node\n",
  });
  assert.equal(r.code, 0, r.out);
});

test("fr: 소유 파일이 테스트뿐이면 분류 대상 아님(비-테스트만 판정)", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": IAC_SPEC("SPEC-001", "src/**"),
    "src/a.test.mjs": "// @covers SPEC-001/FR-001\ntest('x', () => {});\n",
  });
  assert.equal(r.code, 0, r.out);
});

test("fr: prefixClassExemptions 사유 등록 → 부정합 면제 / 빈 사유·dangling ID → exit 1", () => {
  const files = { "sdd/specs/SPEC-001.md": IAC_SPEC("SPEC-001", "infra/**"), "infra/main.tf": "x\n" };
  assert.equal(run(files, { prefixClassExemptions: { "SPEC-001": "일시 이관 중 — 다음 재도출에서 INFRA 분리" } }).code, 0);
  const empty = run(files, { prefixClassExemptions: { "SPEC-001": "" } });
  assert.equal(empty.code, 1);
  assert.match(empty.out, /빈 값 불가/);
  const dangling = run(files, { prefixClassExemptions: { "SPEC-001": "사유", "SPEC-999": "사유" } });
  assert.equal(dangling.code, 1);
  assert.match(dangling.out, /존재하지 않는 spec "SPEC-999"/);
});

test("fr: 미사용 면제·INFRA 인프라 검출 0건은 warn(비차단)", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": IAC_SPEC("SPEC-001", "src/app.mjs"),
    "sdd/specs/INFRA-001.md": IAC_SPEC("INFRA-001", "src/other.mjs"),
    "src/app.mjs": "1\n", "src/other.mjs": "2\n",
  }, { prefixClassExemptions: { "SPEC-001": "선등록" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /정리 대상/);
  assert.match(r.out, /INFRA-001: INFRA- 접두어인데/);
});

test("fr: derivationClassGlobs 클래스 단위 교체가 분류에 반영(SPEC-009 단일 소스)", () => {
  const r = run({
    "sdd/specs/SPEC-001.md": IAC_SPEC("SPEC-001", "deploy/**"),
    "deploy/stack.custom": "x\n",
  }, { derivationClassGlobs: { iac: ["deploy/**"] } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /접두어↔클래스 부정합 "SPEC-001"/);
});

// ── 분류 기본값 보정: 인프라/CI 동반·보조 파일도 인프라 클래스(회귀 고정) ──

test("classifyInfraFile: 동반·보조 파일 분류 — .dockerignore/kustomization/*.hcl=iac, actions/cloudbuild/travis=ci", () => {
  for (const f of [".dockerignore", "app/.dockerignore", "deploy/kustomization.yaml",
    ".terraform.lock.hcl", "packer/build.hcl", "deploy/docker-compose.prod.yml", "deploy/compose.yaml"])
    assert.equal(classifyInfraFile(f, GLOBS), "iac", f);
  for (const f of [".github/actions/setup/action.yml", ".gitlab/ci/build.yml",
    "cloudbuild.yaml", "svc/cloudbuild.yml", ".travis.yml", ".drone.yml"])
    assert.equal(classifyInfraFile(f, GLOBS), "ci", f);
  for (const f of [".gitignore", "src/app.hcl.md", "Makefile"])
    assert.equal(classifyInfraFile(f, GLOBS), null, f);
});

test("fr: Jenkinsfile+.github+Dockerfile+.dockerignore만 소유한 SPEC- → 전적으로 인프라 = exit 1 (B안 예측 고정)", () => {
  const r = run({
    "sdd/specs/SPEC-013.md": IAC_SPEC("SPEC-013", "Jenkinsfile, .github/**, Dockerfile, .dockerignore"),
    "Jenkinsfile": "pipeline {}\n",
    ".github/workflows/ci.yml": "on: push\n",
    "Dockerfile": "FROM node\n",
    ".dockerignore": "node_modules\n",
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /접두어↔클래스 부정합 "SPEC-013" — 소유 실파일 4건 전부 iac\/ci 클래스/);
});
