#!/usr/bin/env node
// ─── SDD adapter config loader (언어/스택/모델 무관) ───────────
// 게이트(check-fr-coverage·check-ownership)와 러너(sdd-run)를 특정 언어에
// 묶지 않게 하는 단일 어댑터 계층. 프로젝트 루트의 `sdd.config.json`을 읽고,
// 빠진 필드는 DEFAULTS로 채운다. **config 파일이 없으면 기존 JS/TS 동작과
// 동일**(하위호환). config 한 장만 바꾸면 Python·Go·Rust·Java·… 어디서든 동작.
//
// 이 로더는 텍스트 파서일 뿐이라 런타임은 Node만 필요하다 — 대상 프로젝트가
// 무슨 언어든 게이트는 spec(.md)과 테스트 파일의 텍스트만 읽는다.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export const DEFAULTS = {
  // spec(.md)들이 있는 디렉토리(루트 기준 상대경로).
  specDir: "sdd/specs",
  // @covers 태그를 찾을 소스/테스트 루트들.
  scanDirs: ["src", "tests"],
  // 순회 중 건너뛸 디렉토리명(언어별 빌드/의존 폴더 폭넓게 포함).
  ignoreDirs: [
    "node_modules", ".next", "coverage", "dist", "build", "out",
    "target", "vendor", "__pycache__", ".venv", "venv", ".git",
    ".idea", ".gradle", "bin", "obj", "Pods", ".dart_tool",
  ],
  // 테스트 "파일명"에 매칭할 정규식 소스 배열. 기본 = JS/TS.
  // 다른 언어 프리셋은 tooling/sdd.config.presets.md 참고.
  //   Python: ["(^|/)test_.*\\.py$", "_test\\.py$", "_spec\\.py$"]
  //   Go:     ["_test\\.go$"]      Rust: ["\\.rs$"](테스트가 소스에 인라인)
  //   Java:   ["Test\\.java$", "Tests\\.java$", "IT\\.java$"]
  //   Ruby:   ["_spec\\.rb$", "_test\\.rb$"]
  testFileRegex: ["\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs)$"],
  // Ownership(구조적 중복) 키 종류. 기본 = 웹/CRUD. 비-웹 대안 예:
  //   라이브러리/CLI: ["Modules", "Symbols", "Artifacts"]
  //   데이터파이프라인: ["Datasets", "Jobs", "Sinks"]
  ownershipCategories: ["Entities", "Surfaces", "Capabilities"],
  // 테스트 "단언" 토큰 정규식(test-adequacy 게이트용). 언어 무관 폭넓은 기본값.
  assertionPatterns: [
    "\\b(expect|assert|assertEquals|assertThat|should)\\b",
    "\\bt\\.(Error|Fatal|Errorf|Fatalf)\\b",
    "\\b(require|assert)\\.",
  ],
  // orphan-surface 게이트가 "표면 파일"로 볼 경로 정규식. 기본 [] = 게이트 비활성.
  // 예(Next.js): ["src/app/.*/route\\.ts$", "src/app/.*/page\\.tsx$"]
  surfaceGlobs: [],
  // spec 입도(cohesion) 게이트 임계 — check-ownership(dedup)의 거울상.
  // 한 spec이 카테고리별 키를 maxKeysPerCategoryPerSpec개 초과 소유하거나
  // FR을 maxFRsPerSpec개 초과 포함하면 under-fragmentation(여러 기능 욱여넣기)
  // 신호 → 분할 권고(advisory). 카테고리명 무관(ownershipCategories 따름).
  maxKeysPerCategoryPerSpec: 4,
  maxFRsPerSpec: 8,
  // spec 파일·ID·@covers 태그에서 인정할 ID 접두어들(언어중립 추적 닻).
  // 기본 = ["SPEC","INFRA","TEST"](§5.1 표준 3종). 파일명·SPEC_ID·COVERS 정규식이
  // 모두 이 목록에서 파생되어, 접두어 추가가 코드 fork 없이 config로 표현된다.
  specIdPrefixes: ["SPEC", "INFRA", "TEST"],
  // 표준 밖 접두어 → 도입 사유(빈 값이면 게이트 exit 1)
  prefixRationale: {},
  // CRUD 기본에 더할 도메인 verb
  capabilityVerbs: [],
  // Surface path param 표준 표기
  surfacePathParam: "{name}",
  // 언어별 셸 명령(sdd-run.mjs가 실행). 미설정 stage는 건너뜀.
  //   { "setup": "...", "lint": "...", "typecheck": "...", "test": "..." }
  commands: {},
};

// 루트 탐색: cwd에서 위로 올라가며 sdd.config.json을 찾는다.
export function findConfig(start = process.cwd()) {
  let dir = start;
  for (;;) {
    const p = join(dir, "sdd.config.json");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(start = process.cwd()) {
  const path = findConfig(start);
  let user = {};
  if (path) {
    try {
      user = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      console.error(`✗ sdd.config.json 파싱 실패: ${path}\n  ${e.message}`);
      process.exit(1);
    }
  }
  const cfg = {
    ...DEFAULTS,
    ...user,
    commands: { ...DEFAULTS.commands, ...(user.commands || {}) },
  };
  // 메타: 게이트들이 공통으로 쓰는 파생값.
  cfg.__path = path;
  cfg.__root = path ? dirname(path) : start; // 모든 상대경로의 기준
  cfg.__testRegex = cfg.testFileRegex.map((s) => new RegExp(s));
  // spec ID 접두어 파생값(게이트 공통). 예: ["SPEC","TEST","INFRA"] → "SPEC|TEST|INFRA"
  const alt = (cfg.specIdPrefixes && cfg.specIdPrefixes.length ? cfg.specIdPrefixes : ["SPEC"])
    .map((p) => String(p).replace(/[^A-Za-z0-9_]/g, "")) // 정규식 안전
    .join("|");
  cfg.__idAlt = alt;
  cfg.__specIdRe = new RegExp(`(?:${alt})-\\d{3}`);                 // 본문/파일명에서 ID 추출
  cfg.__coversRe = new RegExp(`@covers\\s+((?:${alt})-\\d{3})\\/(FR-\\d{3})`, "g");

  // Verb 파생값
  const CRUD = ["create", "read", "update", "delete", "list"];
  cfg.__crudVerbs = CRUD;
  cfg.__allVerbs = new Set(
    [...CRUD, ...(cfg.capabilityVerbs || [])].map((v) => String(v).trim().toLowerCase())
  );

  return cfg;
}

// 루트 기준 상대경로("a/b")를 절대경로로.
export function resolveFromRoot(cfg, rel) {
  return join(cfg.__root, ...String(rel).split("/").filter(Boolean));
}

// 파일명이 테스트 파일인가(config의 testFileRegex 기준).
export function isTestFile(name, cfg) {
  return cfg.__testRegex.some((re) => re.test(name));
}
