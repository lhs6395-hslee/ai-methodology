// @covers SPEC-004/FR-002
// ─── init-then-execute integration test ──────────────────────
// Finding 2: sdd-init이 설치한 파일만으로 gate가 실행 가능한지 검증.
// 이 테스트는 Finding 1 수정 전에는 ERR_MODULE_NOT_FOUND로 실패해야 하고,
// 수정 후에는 pass해야 한다.
//
// 핵심: pre-commit.test.mjs의 setupRepo와 달리 ownership-keys.mjs를
// 수동으로 복사하지 않는다 — sdd-init이 설치한 것만 사용한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runInit(root) {
  execFileSync(
    "sh",
    [join(process.cwd(), "tooling/sdd-init.sh"), "--gate=node"],
    { cwd: root, stdio: "ignore" }
  );
}

function writeMinimalSpec(root) {
  const specDir = join(root, "sdd/specs");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(
    join(specDir, "SPEC-001-sample.md"),
    [
      "# SPEC-001 Sample",
      "",
      "## Ownership",
      "- **Entities**: sample_entity",
      "- **Surfaces**: GET /api/sample",
      "- **Capabilities**: sample.read",
      "",
      "## Functional Requirements",
      "- FR-001: The system SHALL return sample data. [WHEN GET /api/sample is called]",
      "",
      "## Test Coverage",
      "- @covers SPEC-001/FR-001",
    ].join("\n")
  );
}

test("init-then-execute: sdd-init 후 check-ownership.mjs 실행 — ERR_MODULE_NOT_FOUND 없음", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-gate-"));
  try {
    runInit(root);
    writeMinimalSpec(root);

    const result = spawnSync("node", ["scripts/check-ownership.mjs"], {
      cwd: root,
      encoding: "utf8",
    });

    // 가장 중요한 검증: MODULE_NOT_FOUND 크래시가 없어야 한다
    const combined = (result.stdout || "") + (result.stderr || "");
    assert.ok(
      !combined.includes("ERR_MODULE_NOT_FOUND"),
      `check-ownership.mjs가 MODULE_NOT_FOUND로 크래시해선 안 됨.\n실제 stderr: ${result.stderr}`
    );
    assert.ok(
      !combined.includes("Cannot find module"),
      `check-ownership.mjs가 'Cannot find module'로 크래시해선 안 됨.\n실제 stderr: ${result.stderr}`
    );

    // 정상 실행 = exit code 0 또는 1(게이트 판정) — 2 이상이면 비정상
    assert.ok(
      result.status !== null && result.status < 2,
      `check-ownership.mjs가 비정상 종료(exit ${result.status}).\nstderr: ${result.stderr}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init-then-execute: sdd-init 후 check-spec-cohesion.mjs 실행 — ERR_MODULE_NOT_FOUND 없음", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-cohesion-"));
  try {
    runInit(root);
    writeMinimalSpec(root);

    const result = spawnSync("node", ["scripts/check-spec-cohesion.mjs"], {
      cwd: root,
      encoding: "utf8",
    });

    const combined = (result.stdout || "") + (result.stderr || "");
    assert.ok(
      !combined.includes("ERR_MODULE_NOT_FOUND"),
      `check-spec-cohesion.mjs가 MODULE_NOT_FOUND로 크래시해선 안 됨.\n실제 stderr: ${result.stderr}`
    );
    assert.ok(
      !combined.includes("Cannot find module"),
      `check-spec-cohesion.mjs가 'Cannot find module'로 크래시해선 안 됨.\n실제 stderr: ${result.stderr}`
    );
    assert.ok(
      result.status !== null && result.status < 2,
      `check-spec-cohesion.mjs가 비정상 종료(exit ${result.status}).\nstderr: ${result.stderr}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init-then-execute: sdd-init이 ownership-keys.mjs·check-spec-consistency.mjs를 설치", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-init-files-"));
  try {
    runInit(root);

    assert.ok(
      existsSync(join(root, "scripts/ownership-keys.mjs")),
      "ownership-keys.mjs가 scripts/에 설치되어야 함"
    );
    assert.ok(
      existsSync(join(root, "scripts/check-spec-consistency.mjs")),
      "check-spec-consistency.mjs가 scripts/에 설치되어야 함"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
