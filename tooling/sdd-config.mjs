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
  // cohesion: 한 spec이 소유 가능한 aggregate root(Entity 키) 최대 수. 기본 1(1 spec = 1 aggregate).
  // aggregate 루트 + 그 자식 표들을 한 spec이 함께 소유하는 모델이면 상향(자식은 별도 root 아님).
  maxAggregateRootsPerSpec: 1,
  // check-spec-sync 예외 glob(§5.5) — Files glob이 과포함한 생성물·락파일 등.
  // 통과하되 영속 흔적 없음(정직) — 목록 자체가 config 리뷰 대상.
  specSyncExemptGlobs: [],
  // spec 파일·ID·@covers 태그에서 인정할 ID 접두어들(언어중립 추적 닻).
  // 기본 = ["SPEC","INFRA","TEST"](§5.1 표준 3종). 파일명·SPEC_ID·COVERS 정규식이
  // 모두 이 목록에서 파생되어, 접두어 추가가 코드 fork 없이 config로 표현된다.
  specIdPrefixes: ["SPEC", "INFRA", "TEST"],
  // 표준 밖 접두어 → 도입 사유(빈 값이면 게이트 exit 1)
  prefixRationale: {},
  // 요구 ID 접두어들(FR 라인·@covers·FR 집계가 인정할 접두어). 기본 ["FR"].
  // 확장 예: ["FR","NFR"] — FR 선언·@covers·집계 정규식이 전부 여기서 파생되어,
  // 도메인 요구 접두어 추가가 코드 fork 없이 config로 표현된다(specIdPrefixes의 거울).
  requirementIdPrefixes: ["FR"],
  // 전역 --strict의 점진 도입 브리지: 나열된 spec ID만 R2를 strict로(모든 FR unit 커버 필수,
  // smoke/deferred 대체 불가). 존재하지 않는 spec ID는 에러(조용한 오타 금지).
  strictSpecs: [],
  // true면 R3: 모든 FR이 unit-covered ∨ smoke-verified ∨ deferred여야 한다("조용히 미검증" 제거).
  requireAccounting: false,
  // FR 검증 회계 매니페스트(JSON 파일 경로, 루트 기준). 미설정(null) = 현행 동작.
  // 형식: { "SPEC-NNN/FR-NNN": {method, evidence} | {method:"deferred", reason} }.
  // 게이트는 dangling 키·빈 evidence·빈 reason을 에러 처리 — 사유 "존재만" 강제(질은 리뷰 몫).
  smokeManifest: null,
  // @verifies 태그(smoke 증거)를 스캔할 디렉토리들. null = scanDirs 재사용.
  // CI 정의·스크립트·runbook 등 테스트 밖 파일의 검증 증거를 수집할 때 확장(SPEC-010).
  smokeScanDirs: null,
  // 재도출 소스 회계 매니페스트(JSON 파일 경로, 루트 기준). 미설정(null) = 게이트 no-op.
  // 형식: { "<소스클래스>": {status:"mapped",evidence} | {status:"none"|"deferred",reason} }.
  // 클래스 enum·검증 규칙은 derivation-lib.mjs(SPEC-009) — 전 클래스 회계 강제.
  derivationManifest: null,
  // 검출 가능 소스 클래스의 탐지 글롭(클래스 단위 교체 — 병합 아님). **·* 만 지원(§4.1).
  // code(scanDirs)·prior-traceability(@covers)는 글롭이 아니라 스캔으로 검출.
  derivationClassGlobs: {
    iac: ["**/*.tf", "**/*.tfvars", "k8s/**", "helm/**", "manifests/**",
      "Dockerfile*", "**/Dockerfile*", "docker-compose*", "compose.yml", "compose.yaml"],
    ci: [".github/workflows/**", ".gitlab-ci.yml", "Jenkinsfile*", "**/Jenkinsfile*",
      ".circleci/**", "azure-pipelines*", "bitbucket-pipelines.yml", ".buildkite/**"],
    "ops-docs": ["runbook*", "RUNBOOK*", "docs/runbook*", "docs/runbooks/**",
      "docs/ops/**", "docs/operations/**", "ops/**"],
  },
  // check-spec-sync: 어떤 스펙 Files에도 매치되지 않는 변경 파일의 정책.
  // "silent"(기본 = 현행 침묵 통과) | "warn"(advisory) | "error"(staged에서 차단 = closed-world).
  // 의도적 예외는 specSyncExemptGlobs로 선언(조합 탈출).
  specSyncUnownedPolicy: "silent",
  // entity(=aggregate-root 카테고리) 레지스트리: { "<정규화 키>": "<도입 사유>" }.
  // 비어 있으면 비활성(현행). 채워지면 Ownership의 entity 키는 등록된 것만 허용되고
  // 사유가 빈 등록은 에러 — PREFIX 거버넌스(specIdPrefixes+prefixRationale)와 동일 패턴.
  entityRegistry: {},
  // CRUD 기본에 더할 도메인 verb
  capabilityVerbs: [],
  // Surface path param 표준 표기
  surfacePathParam: "{name}",
  // Surface 키 형식: "http"(기본 — "<METHOD> <path>" / "event:" / "job:") | "path"(파일경로 표면)
  // | "any"(형식검증 안함). 파일 라우팅 프레임워크(Next.js 등)나 비-HTTP 자원(Dockerfile·IaC)을
  // Surface로 모델링하는 프로젝트는 "path". normalizeKey/validateKey가 이 값으로 분기.
  surfaceFormat: "http",
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
  const alt = (cfg.specIdPrefixes && cfg.specIdPrefixes.length ? cfg.specIdPrefixes : DEFAULTS.specIdPrefixes)
    .map((p) => String(p).replace(/[^A-Za-z0-9_]/g, "")) // 정규식 안전
    .join("|");
  cfg.__idAlt = alt;
  cfg.__specIdRe = new RegExp(`(?:${alt})-\\d{3}`);                 // 본문/파일명에서 ID 추출
  // 요구 ID 접두어 파생값 — 전 파싱 사이트(coverage 선언·cohesion/completeness 집계·
  // spec-sync FR 라인·@covers)가 이 한 곳에서 파생된 문법을 공유한다(사이트 간 불일치 금지).
  const reqAlt = (cfg.requirementIdPrefixes && cfg.requirementIdPrefixes.length ? cfg.requirementIdPrefixes : DEFAULTS.requirementIdPrefixes)
    .map((p) => String(p).replace(/[^A-Za-z0-9_]/g, ""))
    .join("|");
  cfg.__reqAlt = reqAlt;
  cfg.__frDeclRe = new RegExp(`\\*\\*((?:${reqAlt})-\\d{3}[a-z]?)\\*\\*`, "g"); // spec 본문의 **FR-NNN[a]** 선언
  cfg.__frTokenRe = new RegExp(`\\b(?:${reqAlt})-\\d{3}[a-z]?\\b`, "g");        // 집계/면제용 토큰
  cfg.__coversRe = new RegExp(`@covers\\s+((?:${alt})-\\d{3})\\/((?:${reqAlt})-\\d{3}[a-z]?)\\b`, "g"); // 서픽스는 소문자 1자(FR-003a) — \b로 2자(FR-003ab) 절단 캡처 금지

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
