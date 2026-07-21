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
  specIdPrefixes: ["SPEC", "INFRA", "TEST", "CICD"],
  // 표준 밖 접두어 → 도입 사유(빈 값이면 게이트 exit 1)
  prefixRationale: {},
  // 접두어↔클래스 면제 레지스트리: { "<SPEC-ID>": "<사유>" }(SPEC-012). 소유 실파일이
  // 전적으로 iac/ci 클래스인데 INFRA-가 아닌 스펙을 사유와 함께 면제. 빈 사유·존재하지
  // 않는 ID는 에러 — prefixRationale·entityRegistry와 동형 패턴(등록 = config 리뷰 관문).
  prefixClassExemptions: {},
  // 오브젝트 스토리지 감지 마커(SPEC-016). 스펙 본문이 하나라도 매치하면 completeness가
  // Object Storage Decision 섹션(Bucket·Consolidation)을 요구(advisory·--strict hard).
  // []로 두면 검사 비활성(포터블 하위호환). 멀티클라우드 기본값(대소문자 무시 매치).
  objectStorageMarkers: ["S3", "오브젝트 스토리지", "object storage", "bucket", "버킷", "blob storage", "GCS", "Cloud Storage"],
  // 테스트/QA 인프라 네임스페이스 마커(SPEC-015). 매치 파일은 TEST 스펙만 소유(제품 스펙이 소유하면
  // exit 1 — 테스트 인프라 격리). []이면 비활성(하위호환). 예: ["**/qa/**", "**/test-infra/**"].
  testInfraGlobs: [],
  // 완료 루프의 꼬리 — 원점 트래커 close-out(METHODOLOGY 루프·speckit-fix 스킬이 소비, 게이트 아님).
  // 작업이 tracked issue에서 유래했으면 verify/merge 후: ①트래커 dev-done ②이해관계자 완료 보고
  // ③리포터 confirm(2인 책임분리 — dev는 confirm 미접촉). {}이면 비활성. 값은 프로젝트가 인스턴스화:
  //   { tracker, devDoneState, confirmState, reportChannel } — 트래커 정체·보고 채널은 하드코딩 금지.
  trackerCloseout: {},
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
  // 분류 원칙: iac = 인프라 도구의 정의 파일 + 그 동반 파일(.dockerignore·*.hcl 락 등),
  // ci = 파이프라인 정의 + 그 구성요소(.github/actions 등). `**/X`는 루트 X도 매치(§4.1).
  derivationClassGlobs: {
    iac: ["**/*.tf", "**/*.tfvars", "**/*.hcl",
      "k8s/**", "helm/**", "manifests/**", "**/kustomization.yaml", "**/kustomization.yml",
      "**/Dockerfile*", "**/.dockerignore", "**/docker-compose*", "**/compose.yml", "**/compose.yaml"],
    ci: [".github/workflows/**", ".github/actions/**", ".gitlab-ci.yml", ".gitlab/ci/**",
      "**/Jenkinsfile*", ".circleci/**", "azure-pipelines*", "bitbucket-pipelines.yml",
      ".buildkite/**", "**/cloudbuild.yaml", "**/cloudbuild.yml", ".travis.yml", ".drone.yml"],
    "ops-docs": ["runbook*", "RUNBOOK*", "docs/runbook*", "docs/runbooks/**",
      "docs/ops/**", "docs/operations/**", "ops/**"],
  },
  // check-spec-sync: 어떤 스펙 Files에도 매치되지 않는 변경 파일의 정책.
  // "silent"(기본 = 현행 침묵 통과) | "warn"(advisory) | "error"(staged에서 차단 = closed-world).
  // 의도적 예외는 specSyncExemptGlobs로 선언(조합 탈출).
  specSyncUnownedPolicy: "silent",
  // check-spec-sync의 changeset base ref(§5.7 "브랜치=staged ∪ base...HEAD"의 base).
  // null(기본) = origin/main. 기본 브랜치가 master/trunk거나 리모트명이 다르면 여기 선언 —
  // base 미해석 시 staged-only로 저하되어 멀티커밋 브랜치(스펙 선커밋→코드 후커밋)가 오차단된다.
  // 우선순위: CLI positional > SDD_DIFF_BASE(env) > specSyncBase(config) > "origin/main".
  specSyncBase: null,
  // check-spec-sync: Draft 소유 코드 변경(SPEC-008 FR-004) 위반을 range 모드에서도 hard로
  // 승격할지 — "advisory"(기본=현행, range는 exit 0) | "hard"(range도 exit 1). CI가 range
  // 모드로 MR diff를 검사하면 로컬 commit-msg 훅을 안 타는 웹 UI 병합도 이 정책으로 막을 수
  // 있다(SPEC-008 FR-007 — 로컬 훅 전용 강제의 사각지대 봉합, 도그푸딩 발견).
  draftBlockPolicy: "advisory",
  // entity(=aggregate-root 카테고리) 레지스트리: { "<정규화 키>": "<도입 사유>" }.
  // 비어 있으면 비활성(현행). 채워지면 Ownership의 entity 키는 등록된 것만 허용되고
  // 사유가 빈 등록은 에러 — PREFIX 거버넌스(specIdPrefixes+prefixRationale)와 동일 패턴.
  entityRegistry: {},
  // Dependencies.Entities의 "EntityName (relation-type)" 구조화 표기에서 relation-type
  // 어휘 — capabilityVerbs와 동형. 비어 있으면(기본) 어휘 무제한(형식만 kebab 1토큰 강제).
  // 채우면 미등록 type은 ownership 게이트가 exit 1(SPEC-017).
  relationTypes: [],
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
  // 폐기된 spec-ID 목록(예: ["CICD-005"]) — 그 번호의 내부 gap을 numbering 게이트가
  // 사고성 결번이 아닌 정상 retirement gap으로 취급(SPEC-018 FR-006). sdd-retire가 남기는 gap 근거.
  retiredIds: [],
  // semantic drift 승격(SPEC-019): 소유 파일 리네임 감지 시 spec-sync 요구를
  // "Change Log 한 줄" → "FR 선언 라인 변경 ∨ Spec-Impact"로 승격. off|advisory(기본)|hard.
  semanticDriftPolicy: "advisory",
  // Capability 귀속(SPEC-024): 스펙 경계는 entity 기준 — capability `x.verb`는 entity `x`를
  // 소유한 스펙만 선언 가능(verb가 달라도 같은 스펙에 FR 신설, 참조 entity는 Dependencies 관계로).
  // entity 없이 capability만 소유한 기술 계층 스펙(엔진/헬퍼)이 태어나는 것을 차단.
  // off|advisory(기본 — entity·capability 카테고리가 둘 다 있을 때만 판정)|hard(위반 exit 1).
  capabilityOwnershipPolicy: "advisory",
  // FR 키 앵커(SPEC-023): FR 선언 라인의 평문 bold를 소유∪참조 키와 대조 — bold를 수사적
  // 강조가 아닌 "키 앵커" 전용으로 예약(FR→키 도출의 원천 단어 가시화, consistency의 역방향 짝).
  // off(기본, 판정 안 함)|advisory(미매치 경고)|hard(미매치 exit 1). 코드 스팬(`...`)은 앵커 아님.
  frKeyAnchorPolicy: "off",
  // 테스트 스위트 실제 실행 게이트(SPEC-021): check-test-run이 commands.test를 돌려 green을 확인.
  // 커버리지 회계 ≠ 실행 결과. off(기본, 실행 안 함)|advisory(실패 경고)|hard(실패 exit 1).
  runTestsPolicy: "off",
  // 런타임 스키마 드리프트(SPEC-022, R2' code↔deployed-DB): 코드 기대 스키마 ↔ 배포 DB 실측 diff.
  // {expected, deployed} 두 조회 명령(DB/ORM 중립 주입) 또는 null(비활성, 기본). 배포 preflight용.
  schemaDriftManifest: null,
  migrationStatePolicy: "advisory", // 드리프트 발견 시 강도: advisory(경고)|hard(exit 1).
  // Entity 스키마 백킹(SPEC-026): Ownership.Entities의 소유 entity가 구조 SSOT(DB 스키마·
  // 마이그레이션·proto 등)에 실재하는 식별자인지 대조 — 지어낸 개념 entity(UI 흐름·화면:
  // wizard·project_list 류)에 capability를 얹어 capability 귀속(SPEC-024)을 우회하는 것을 차단.
  // 인프라 무관: 스키마 위치·추출은 어댑터로 주입 — [{globs:[...], patterns:["정규식(캡처1=식별자)"]}].
  // 비어 있으면 비활성(현행·킷). off(기본)|advisory(경고)|hard(exit 1). entity 카테고리 있을 때만 판정.
  entitySchemaSources: [],
  entitySchemaBackingPolicy: "off",
  // 스키마에 없지만 정당한 aggregate(외부 API 자원·이벤트 스트림 등) 면제: { "<entity>": "<사유>" }.
  // 빈 사유는 에러(entityRegistry 동형). 남용 방지 — 면제는 리뷰 관문.
  entitySchemaExemptEntities: {},
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
  return buildConfig(user, path, path ? dirname(path) : start);
}

// config JSON "문자열"에서 동일 파생 규칙으로 구성 — check-spec-sync가 staged 판정을
// HEAD 시점 config로 내릴 때 사용(자기약화 커밋 방지: 이 커밋이 약화한 config가 아니라
// 약화 "전" config가 이 커밋을 심판한다, SPEC-003). 파싱 실패는 null(호출부가 폴백).
export function configFromString(raw, root) {
  try {
    return buildConfig(JSON.parse(raw), null, root);
  } catch {
    return null;
  }
}

function buildConfig(user, path, root) {
  const cfg = {
    ...DEFAULTS,
    ...user,
    commands: { ...DEFAULTS.commands, ...(user.commands || {}) },
  };
  // 메타: 게이트들이 공통으로 쓰는 파생값.
  cfg.__path = path;
  cfg.__root = root; // 모든 상대경로의 기준
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
