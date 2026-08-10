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
import { resolveCategoryRoles } from "./ownership-keys.mjs";

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
  // e2e(브라우저·기동 앱 필요) 테스트 파일 정규식 — testFileRegex의 **부분집합**을 지목한다.
  // 왜 따로 세나(실측 결함, 소비 프로젝트 PM): testFileRegex가 `\.e2e\.ts$`를 포함하면 e2e의
  // @covers가 커버리지 회계에서 **unit(=실행 검증됨)** 버킷에 들어간다. 그런데 commands.test는
  // vitest만 돌려 e2e를 실행하지 않으므로, e2e 57개가 전부 로그인 단계에서 죽어 있어도 R5는
  // 계속 green이고 FR 58건이 "검증됨"으로 집계됐다. 실행하지 않는 것을 검증됐다고 세면 거짓
  // 안전이다. 이 정규식을 선언하면 e2e로만 커버된 FR이 `e2e` 버킷으로 분리 집계된다.
  e2eFileRegex: [],
  // Ownership(구조적 중복) 키 종류. 기본 = 웹/CRUD. 비-웹 대안 예:
  //   라이브러리/CLI: ["Modules", "Symbols", "Artifacts"]
  //   데이터파이프라인: ["Datasets", "Jobs", "Sinks"]
  ownershipCategories: ["Entities", "Surfaces", "Capabilities"],
  // 카테고리 → 역할 선언(SPEC-001 FR-010). 방법론 판정 다수가 "어느 카테고리가 aggregate root인가
  // (entity)·표면인가(surface)·능력인가(capability)"에 걸려 있는데, 그동안 카테고리 **이름**을
  // 정규식(/entit/·/surface/·/capabilit/)으로 추측했다. 그래서 (a) 이름을 바꾸면 판정이 조용히
  // inert가 되고(감사 A-1), (b) 킷 자신처럼 Modules/Symbols를 쓰는 프로젝트는 규칙 전체를 자기에게
  // 적용할 수 없었다(도그푸딩 공백). 여기서 **선언**하면 이름과 무관하게 역할이 확정된다.
  //   예(킷): { "Modules": "entity", "Symbols": "surface" }
  //   예(파이프라인): { "Datasets": "entity", "Sinks": "surface" }
  // 미선언 카테고리는 역할 없음(판정 대상 밖). 이 맵이 비면 기존 이름 정규식으로 폴백(하위호환).
  ownershipCategoryRoles: {},
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
  // 지원 계층 스펙 등록부 — `{ "<SPEC-ID>": "<사유>" }`. 사유 빈 값 금지.
  // aggregate(entity)를 가질 수 없는 계층(공유 설정·빌드 배선·순수 도구 계층)이 실재한다.
  // 그동안 이들은 교착이었다: entity 0개면 cohesion의 `entity(min)`가 막고, 그래서 **분할이
  // 불가능**해지고, 남은 출구가 `maxFRsPerSpec` 상향(=완화, 래칫이 차단)뿐이었다.
  // 이 등록부는 **캡을 풀지 않는다** — 오직 `entity(min)`만 면제해 분할을 가능하게 한다.
  // 잡동사니 서랍이 되지 않도록: (a) 등록 스펙이 entity를 소유하면 등록이 모순이라 에러,
  // (b) 없는 스펙 ID 등록은 낡은 등록부라 에러, (c) 등록 목록은 clean일 때도 **항상 표면화**한다
  // (schema-backing 면제와 같은 경계 — 면제는 조용히 '완료'가 되지 않는다).
  supportLayerSpecs: {},
  // Change Log ↔ FR 실재 대조(SPEC-037). off|advisory(기본)|hard.
  // 실측 공백: Change Log가 "FR-018 신규"라고 선언했는데 FR 절에 본문이 없어도 아무도 안 막았다
  // (check-spec-sync는 FR/Edge Cases/Change Log **택1**로 만족되고 — 그 탈출구 자체는 설계다 —
  // 결번 advisory는 "폐기 잔분일 수 있음"이라 결함을 정당한 흔적과 같은 문장으로 말했다).
  // 기본 advisory: hard로 두면 레거시 스펙이 많은 저장소가 첫 동기화에서 전부 멈춘다.
  changeLogFrRefPolicy: "advisory",
  // 선언 어휘 — **프로젝트마다 다르다**(킷은 `신설`, 제보 프로젝트는 `신규`). 어휘를 못 박으면
  // 표현이 한 글자 다른 저장소에서 게이트가 통째로 inert가 된다. 미선언이면 킷 기본 어휘.
  changeLogNewVerbs: null,
  changeLogReviseVerbs: null,
  changeLogRetireVerbs: null,
  // 구현 중복 판정(SPEC-038) — dedup이 못 보는 축. off|advisory(기본)|hard.
  // 실측 제보: 병렬 서브에이전트가 같은 규칙을 세 갈래로 구현했고(같은 파일에 이름만 다른 export
  // 두 개 포함) 게이트 4종이 전부 green이었다. dedup은 **선언 단위**(같은 파일을 두 스펙이
  // 주장하는가)만 보므로 *구현 중복*은 사각이었다. 유발 조건(격리 지시 + 동시 upstream + 각자
  // 성실한 헬퍼 생성)은 병렬 실행을 권장하는 방법론에서 예외가 아니라 **정상 경로**다.
  duplicateLogicPolicy: "advisory",
  // ① 결정적 층 — 리터럴 추출 패턴(캡처그룹 1 = 비교 본문). 기본은 JS/TS 정규식 리터럴.
  // 언어별 교체 예: Python `re\.compile\(r?["']([^"']+)["']\)` · Go 백틱 리터럴.
  duplicateLiteralPatterns: null,
  // 사소한 정규식은 정당하게 반복된다(`\s+`·`,`) — 길이 하한으로 가른다.
  duplicateLiteralMinLength: 8,
  // 판정 대상 파일 — 기본 패턴이 JS/TS 정규식 문법이므로 그 계열만. 언어를 바꾸면 함께 바꾼다.
  duplicateLiteralFileRegex: null,
  // 정당한 중복의 면제 등록부 — `{ "<리터럴 본문>": "<사유>" }`. 사유 빈 값 금지.
  // 낡은 면제(더 이상 중복 아님)는 매 실행 표면화한다 — 등록부는 최신일 때만 등록부다.
  duplicateLogicAllow: {},
  // 테스트 파일은 기본 제외 — 단언이 같은 문자열을 대량 반복하는 것은 중복이 아니다(오탐의 주 원인).
  duplicateLogicIncludeTests: false,
  // ② 확률적 층 — 프로젝트가 주입하는 중복 탐지 도구(jscpd·similarity-ts 등). **비차단**.
  // AST 해시를 킷이 직접 하지 않는 이유: TS 파서를 번들하면 의존성 0과 언어 무관을 동시에 잃는다.
  // 계약: stdout 한 줄 = `<경로>:<라인>\t<경로>:<라인>\t<설명>`. 비-0 종료 = skipped(사유).
  duplicateLogicCommand: null,
  duplicateLogicTimeoutMs: 120000,
  // 중복 목록 출력 상한(총량은 헤더가 말한다 — 감춤이 아니라 지면 절약).
  duplicateLogicListCap: 12,
  // `@covers` 양방향 결속(SPEC-039) — off|advisory(기본)|hard.
  // 기존 R1(dangling)은 **단방향**이다: 태그가 가리키는 FR이 실재하는지만 본다. 실재는 동일성이
  // 아니다 — 실측 제보: 태그가 없는 FR-085를 가리켜 R1이 잡았는데, **다른 세션이 무관한 기능**을
  // FR-085로 착지시킨 순간 위반이 사라지고 초록이 됐다. 태그는 returnTo 테스트를, FR-085는
  // 메일주소 필드를 말하는데 회계는 "unit으로 커버됨"이라고 보고한다. 번호가 겹치면 통과한다.
  // 대조 축은 FR 쪽 `[검증: <경로>]` 관습을 그대로 쓴다(새 문법 없음).
  // 검증 **실행** 회계(SPEC-041) — 선언된 증거가 실재하는가(SPEC-031)의 다음 질문: 그것이 돌았는가.
  // 실측 제보: 중도 포기·대상 0건 exit 0·전제 자원 부재로 미실행 — 셋 다 초록으로 읽혔다.
  // off|advisory(기본)|hard. 차단하는 것은 **침묵과 깨진 기록**뿐이고 사유 있는 포기는 막지 않는다.
  verificationRunPolicy: "advisory",
  // 실행 원장(JSONL) 경로. null이면 판정 입력이 없으므로 게이트가 INERT를 선언한다(SPEC-040).
  // 러너·CI 스테이지·에이전트가 `--record <asset> <outcome> [사유]`로 append한다.
  verificationRunLedger: null,
  verificationRunListCap: 12,
  // `commands.test`가 **무엇을 커버하는가** — 러너만 아는 사실이라 프로젝트가 선언한다.
  // 선언하면 check-test-run이 자기 실행 결과를 원장에 남긴다: green→JUDGED, 명령 미선언→INERT,
  // 전제 미충족→SKIPPED(사유). 제보 ②("대상 0건으로 exit 0 — 성공과 무행동이 동형")가 닫히는 자리다.
  // null이면 기록하지 않는다(원치 않는 프로젝트에 결합 0).
  verificationRunTestAssets: null,
  // 환경 결속 — { <glob>: <사유> }. "이 체크아웃에서는 이 자산이 돌 수 없다"는 **항구적** 사실을
  // config에 둔다(원장은 gitignore라 체크아웃마다 사라진다). 실행됨으로 세지 않고 사유 있는 부채로
  // 계상하므로 면제가 아니다 — 침묵을 사유 있는 미실행으로 바꿀 뿐이고, 실제 기록이 있으면 그쪽이 이긴다.
  verificationRunEnvBound: {},
  // ── 라이브 대조 등록 축(SPEC-032 확장) ─────────────────────────────────────
  // 실행 축(liveRealityPolicy)과 **정책을 분리**한다: 실행은 자격증명이 필요해 흔히 off·skipped인데
  // 등록은 순수 선언 대조라 오프라인에서도 판정된다. 한 정책에 묶으면 실행을 끄는 순간 등록도 꺼지고,
  // 그러면 새 배포 산출물을 선언해도 아무 검사가 없다는 사실이 보이지 않는다(실측 제보 8건).
  liveRealityCoveragePolicy: "advisory",
  // 무엇이 "배포 산출물"인가 — **조용한 기본값을 두지 않는다**(SPEC-040 ②). 미선언이면 게이트가
  // inert로 자백한다. 권장 목록은 sdd.config.presets.md §라이브 대조 템플릿에서 복사한다.
  // ⚠ 이 선언 하나를 SPEC-032(등록 축)와 SPEC-031(증거 등급)이 **함께** 쓴다 — 같은 사실에
  // 목록이 둘이면 한쪽만 갱신돼 두 게이트가 다른 답을 낸다.
  deployArtifactMarkers: null,
  // 배포 등급 증거로 인정할 경로 패턴 — "단위테스트 통과"와 "배포본에서 실제 실행됨"은 다른 사실이다.
  deployEvidencePatterns: null,
  // 주장이 배포 대상을 말하는지 판정할 마커(주장 라인에서만 탐색 — 브라우저 마커 동형).
  deployMarkers: null,
  coversBacklinkPolicy: "advisory",
  // 목록 출력 상한(총량은 헤더가 말한다 — 감춤이 아니라 지면 절약).
  coversBacklinkListCap: 12,
  // 의미 커버리지(SPEC-042) — FR이 이름 댄 대상이 커버 파일에 문자 그대로 있는가.
  // 용어집은 **프로젝트가 선언**한다(빈 배열 = 이 축은 판정하지 않는다고 매 실행 밝힌다).
  // 항목은 "용어" 또는 {term, synonyms:[…]} — 파라프레이즈는 동의어 등록으로 해소한다.
  termGlossary: [],
  termCoveragePolicy: "advisory",
  termCoverageListCap: 12,
  // 실행 관측 회계(SPEC-049) — **차단 분기가 필드에서 발화한 적이 있는가.**
  // 정적 검사로는 원리상 잡히지 않는 층이다: 실측 제보에서 명세·구현·단위테스트가 모두 정상인데
  // 두 기록이 만날 저장소가 없어 비교가 **단 한 번도 수행되지 않았고**, 증거는 매 실행 로그의
  // 같은 한 줄("대조 생략")이었다 — 그 값이 몇 달간 달라지지 않은 사실을 읽는 장치가 없었다.
  //   blockingBranches: { "<키>": "<이 분기가 무엇을 막는가>" }  (사유 필수)
  // 분기가 `--record-branch <키> FIRED|PASSED|SKIPPED [사유]`로 남기고, 발화 0회는 미검증으로
  // 회계한다. 미선언이면 판정하지 않는다. ⚠ 어떤 강도에서도 차단하지 않는다(원장은 세션 상태다).
  blockingBranches: {},
  // 감시자 실재(SPEC-048) — **각 프로젝트가 방법론을 무시한다**(오너 실측)의 답.
  // 무시는 순환 때문에 안 잡힌다(무시하면 게이트를 안 돌리고, 그러면 고발 기회가 없다).
  // 순환을 끊는 것은 **우회 불가한 채널**뿐이고 그건 서버측 CI다 — 로컬 훅은 --no-verify로
  // 우회되고 웹 UI 머지는 훅을 타지 않는다. 그래서 이 축은 CI 배선을 항상 본다.
  watchdogPolicy: "advisory",
  // 채택 영수증 경로. null이면 킷 기본(`sdd/adoption.json`).
  // ⚠ `.sdd/`에 두지 않는다 — 그쪽은 gitignore라 채택 선언이 체크아웃마다 사라진다.
  watchdogReceipt: null,
  watchdogCiGlobs: null,

  // 배선 무결성(SPEC-050) — **게이트가 애초에 로드되는가.** 실측 제보: update 절차의 diff가
  // 공유 lib 27개를 빠뜨려 게이트는 최신·lib은 구판인 **부분 동기화**가 됐고, 소비처는 판정이
  // 아니라 `SyntaxError: … does not provide an export named …`를 받았다. 파일이 없는 것도
  // 아니어서 배포 폐포 계약(SPEC-004)으로도 안 잡힌다 — 그건 파일 실재, 이건 export 실재다.
  importWiringPolicy: "advisory",
  // 판정 대상 확장자. null이면 킷 기본(`["mjs","js"]`) — 코드에 고정하면 목록 밖 설치에서
  // 판정이 통째로 사라지고 그 0건이 진짜 0건과 구분되지 않는다(SPEC-038 계열).
  importWiringExtensions: null,

  // 에이전트 배선 실재(SPEC-051) — **감시자가 에이전트를 실제로 보는가.**
  // R17은 CI·영수증(커밋 이후 채널)을 보고, 이 축은 에이전트가 도구를 쓰는 **순간**에 발동하는
  // 훅의 배선을 본다. 실측: 킷 자신에 `.claude/`가 없어 이 층이 통째로 비어 있었는데 R17은
  // 초록이었다 — 감시자가 있다와 감시자가 에이전트를 본다는 다른 사실이다.
  agentWiringPolicy: "advisory",
  // 에이전트 설정 파일·훅 단일 선언·스크립트 디렉터리. null이면 킷 기본
  // (`.claude/settings.json` · `scripts/agent-hooks.list` · `scripts`).
  agentSettingsFile: null,
  agentHookDecl: null,
  agentScriptDir: null,
  sweepInvocationMarkers: null,
  // ── 하드코딩 지양(오너 규범) — 어휘·확장자·경로는 게이트에 박지 않고 config로 교체 가능하게 둔다.
  // 전부 null 기본(= 킷 기본값)이고, 게이트는 자기가 무엇을 썼는지 출력에 밝힌다.
  // 스윕 규칙표 파일 — 킷은 `tooling/`, sdd-init.sh 배포 사이트는 `scripts/`. 고정하면 소비
  // 사이트에서 게이트 종수 인용이 조용히 미지원 키가 된다(실측: 이식성 결함).
  syncRulesFile: null,
  // 지목 구현체로 인정할 모듈 확장자 / 실행 경로에서 제외할 산문 정규식(SPEC-046).
  implModuleExtensions: null,
  // 외부 대상이 아닌 로컬·자리표시자 호스트 패턴(SPEC-044) — 사내 개발 도메인을 추가할 자리.
  localHostPatterns: null,
  // 사슬의 조각을 담을 수 있는 문서 종류(SPEC-047).
  processDocRegex: null,
  // 순차 프로세스 SSOT(SPEC-047) — 여러 스펙에 걸친 사슬은 한 문서가 전 구간을 소유한다.
  //   processes: { "<이름>": { ssot: "<전 구간 문서>", stages: ["단계", {name, state}, …] } }
  // 미선언이면 INERT(결합 0) — 순차 사슬이 없는 프로젝트에 사슬을 요구하면 거짓 요구다.
  processes: {},
  processSsotPolicy: "advisory",
  processSsotListCap: 12,
  // 단계를 몇 개 담으면 "조각 보유"로 볼지 — 1이면 사슬을 언급만 해도 걸려 오탐이 폭주한다.
  processFragmentMinStages: 2,
  // 실행 사이 비교·합의를 요구하는 단계 마커. null이면 킷 기본(어휘가 다르면 교체).
  statefulStageMarkers: null,
  // 증거 등급을 증언하는 매니페스트 method 값(SPEC-031 확장). null이면 킷 기본.
  // 경로 판정의 **대안이 아니라 보완**이다 — 안 받으면 프로젝트가 등급을 얻으려고 증거 파일을
  // 물리적으로 쪼개야 한다(실측 제보). method가 자기신고여도 무방한 이유: 태그↔매니페스트
  // 드리프트를 sdd-smoke-scan(SPEC-010)이 대조하므로 **다른 축이 검산하는 선언**이다.
  browserGradeMethods: null,
  deployGradeMethods: null,
  // 지목 구현체 참조(SPEC-046) — FR이 백틱으로 지목한 함수·모듈이 실행 경로에서 참조되는가.
  implReferencePolicy: "advisory",
  implReferenceListCap: 12,
  // 실행 경로에서 제외할 산문·잠금 파일(정규식 소스). 문서의 언급은 실행이 아니다.
  implReferenceProseRegex: null,
  // 소개 문서 동기(SPEC-045) — 설명이 도구보다 늦으면 그 설명은 거짓이 된다.
  // introDocs 미선언이면 INERT(판정 안 함). 킷 자신은 hard로 쓴다.
  introDocs: [],
  introDocRuleSource: "HARNESS.md",
  introDocPolicy: "advisory",
  // 결정 입도(SPEC-044) — env 폴백 기본값이 외부 대상이면 소유 스펙이 그것을 알아야 한다.
  externalTargetPolicy: "advisory",
  externalTargetListCap: 12,
  // 근거 적용범위(SPEC-043) — 특정 환경을 지목한 관측 근거는 그 결론이 참인 범위를 밝힌다.
  evidenceScopePolicy: "advisory",
  // null = 킷 기본 마커. 프로젝트 어휘가 다르면 선언으로 대체한다(면제가 아니라 어휘 교체).
  observationMarkers: null,
  evidenceScopeLabels: null,
  environmentMarkers: null,
  // e2e 실행 축(SPEC-021 확장) — commands.e2e를 실제로 돌려 판정한다.
  // check-live-reality(SPEC-032)와 같은 계약: "판정 못 함"과 "위반 없음"을 섞지 않는다. 단
  // 반전 주의 — 테스트에서 비-0은 **실패**지 skip이 아니다. 그래서 실행 가능 여부는 별도
  // 프로브(e2ePrecheck)로 판정한다: 프로브 실패 = skipped(사유), 프로브 통과 후 비-0 = 실패.
  // SC·NFR 검증 회계(SPEC-034) — FR만 회계하던 사각을 닫는다. off|advisory|hard.
  // out-of-band 배포 가드(SPEC-035) — 배포가 커밋보다 먼저인 궤도에서 spec-first 발화 지점을
  // 커밋에서 **배포 행위**까지 앞당긴다. PostToolUse라 항상 비차단(이미 실행된 뒤에 돈다).
  // off|advisory. 감지 패턴은 deploy-guard-lib의 기본값을 쓰거나 아래로 대체한다.
  // pre-push 훅(`sdd-sync --hook`)에서 판정할 규칙 집합. 미선언 = 전체 실행(하위호환).
  // 선언하면 목록 밖 규칙은 **위임**으로 표시되고 flagged가 아니다 — 대신 syncHookDelegatedTo로
  // 누가 대신 판정하는지 반드시 밝혀야 한다(담당자 없는 생략은 조용한 미판정이라 에러).
  // 실측 근거: 스윕 30.3초 중 R5(스위트 실행) 29.8초 — 30초 훅은 --no-verify로 우회되고
  // 그 순간 훅 전체가 무의미해진다. 우회를 유발하는 강제는 강제가 아니다.
  // 훅 배선 실재(SPEC-004 FR-012) — .git/hooks에 킷 훅이 설치·실행 가능한가. off|advisory|hard.
  hooksInstalledPolicy: "advisory",
  syncHookRules: null,
  syncHookDelegatedTo: "",
  outOfBandDeployPolicy: "advisory",
  outOfBandDeployCommands: null,
  // hard일 때 미기록 배포가 착지하는 **세션 부채 파일**(JSONL). 터미널 스크롤은 죽지만 파일은 남는다.
  // advisory와 hard가 출력만 같고 아무것도 달라지지 않으면 승격이 무의미하다(실측 제보) — hard는
  // 여기에 적재하고, pre-commit의 `check-deploy-debt`가 **커밋을 막는다**. 배포 자체는 여전히
  // 비차단이다(PostToolUse는 이미 실행된 뒤에 돈다 — 되돌릴 수 없는 것을 막는 척하지 않는다).
  // 로컬 세션 기억 장치라 커밋 대상이 아니다(sdd-init가 .gitignore에 넣는다).
  outOfBandDeployDebtFile: ".sdd/deploy-debt.jsonl",
  // 배포 **전제 조건**(SPEC-035 FR-006) — off|advisory|hard. `outOfBandDeployPolicy`와 다른 축이다:
  // 그쪽은 "이 배포가 스펙에 반영됐나"(사후 상기), 이쪽은 **"이 배포가 재현 가능한 리비전에서
  // 나오는가"**(사전 차단). 실측 제보: 가드가 `terraform apply`를 정확히 감지하고도 막지 못했다 —
  // 물은 것이 스펙 반영 여부뿐이었고, 사후 상기는 같은 세션의 **두 번째 apply**도 막지 못했다.
  // 판정은 순수 git 조회(미커밋 트리·upstream 뒤처짐)라 오탐이 거의 없고 배포 **전에** 가능하다.
  // hard면 PreToolUse에서 실제로 차단한다(막을 수 있는 것을 사후로 미루면 그냥 늦는 것이다).
  deployPreconditionPolicy: "off",
  // 배포 직후 서비스 생존 확인 명령(SPEC-035 FR-007). **미선언 자체가 부채로 계상된다** —
  // 배포 명령의 성공은 서비스의 생존이 아니다(실측: apply 성공·CI 초록·전 요청 403).
  // 비-0은 skip이 아니라 **실패**다(테스트·e2ePrecheck와 같은 반전 규약).
  deploySmokeCommand: null,
  deploySmokeTimeoutMs: 60000,
  scCoveragePolicy: "off",
  // `[검증: 경로]`의 경로 → 검증 종류 유도(글롭). 사람이 종류를 손으로 적으면 또 하나의
  // 자기신고가 되므로, 산출물이 어디 사는지로 기계가 분류한다. 비면 전부 "other"(회계는 됨).
  // 예: { unit:["**/*.test.*"], e2e:["**/*.e2e.*"], load:["tests/load/**"], pentest:["tests/security/**"] }
  verificationKinds: {},
  // CI에서 못 도는 검증(라이브 클러스터·WAF·관리형 DB)의 증거 회계 — smokeManifest 동형.
  // 경로 문자열(파일) 또는 객체. { "<SPEC>/<SC-001>": {kind, evidence} | {kind:"deferred", reason} }
  evidenceManifest: null,
  // 미회계 목록 출력 상한(총량은 헤더가 말한다 — 감춤이 아니라 지면 절약).
  scCoverageListCap: 12,
  e2eTestsPolicy: "off",
  // 실행 전제 프로브(선택) — 앱 기동·자격·도달성 확인용 명령. 비-0이면 skipped(사유).
  // 미선언이면 프로브 없이 바로 실행한다(비-0 = 실패로 판정).
  e2ePrecheck: null,
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
  // FR 키 앵커의 카테고리 마커(SPEC-023) — 굵은 키마다 종류를 표기: entity `(E)`·surface
  // `(S)`·capability `(C)`. frKeyAnchorPolicy가 켜지면 각 bold 키 앵커가 이 마커를 달았는지 대조.
  // 글자는 카테고리 이름의 머리글자(Entities/Surfaces/Capabilities) — 프로젝트가 바꿀 수 있다.
  frAnchorMarkers: { entity: "E", surface: "S", capability: "C" },
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
  // 정책 래칫(SPEC-027): 강제 정책 knob의 강도를 낮추는 것(off<advisory<hard 역행)을 차단 —
  // hard에서 위반이 대량으로 떠도 knob을 내려 빨간불을 끄는 escape를 봉쇄(단조 증가만 허용).
  // base ref(specSyncBase||origin/main) 대비 하향 감지. off|advisory(기본, 경고)|hard(exit 1).
  policyRatchetPolicy: "advisory",
  // 래칫 예외 — 정당한 하향(진짜 롤백 등)에 한해 knob 이름을 선언(loud override). 선언된 하향은
  // 차단되지 않되 "부채"로 항상 표면화된다(남용 방지 — entitySchemaExemptEntities 동형).
  policyRatchetExceptions: [],
  // 스키마에 없지만 정당한 aggregate(외부 API 자원·이벤트 스트림 등) 면제: { "<entity>": "<사유>" }.
  // 빈 사유는 에러(entityRegistry 동형). 남용 방지 — 면제는 리뷰 관문.
  entitySchemaExemptEntities: {},
  // Engines & Events 카테고리(SPEC-030) — 감사(#21) 전수성 구멍 봉합. 둘 다 옵트인(ownershipCategoryRoles로
  // 카테고리에 "engine"/"event" 역할 선언 — 이름 폴백 없음). 미선언·소스 빈값이면 inert(하위호환).
  // engine: 코드-모듈 SSOT(함수·클래스) 실재 대조 — [{globs, patterns:["정규식(캡처1=식별자)"]}].
  enginesSources: [],
  engineRealityPolicy: "off",               // off(기본)|advisory|hard. engine 역할 카테고리 있을 때만.
  engineExemptKeys: {},                     // { "<engine키>": "<사유>" } 빈 사유 에러(entityRegistry 동형).
  // event: 발신 entity 귀속(`entity.event-name`) + 이벤트 카탈로그 SSOT 실재 대조.
  eventCatalogSources: [],
  eventAttributionPolicy: "off",            // off(기본)|advisory|hard. event 역할 카테고리 있을 때만.
  eventExemptKeys: {},                      // 카탈로그 실재 면제(귀속 면제는 아님) — 빈 사유 에러.
  // 구조 문법 잔여 3종(감사 후속) — 결정적 중복차단의 남은 구멍. 기본 advisory(신규 채택 소급 범람
  // 방지), 깨끗해지면 hard 승격(킷 자신은 hard). 순수 신규 검출이라 위반 추가만 한다.
  // 실행 증거(SPEC-031) — "선언이 실제로 동작하는가" 축. `[검증]`을 실행 가능한 증거 경로로 강제:
  // `[검증: tests/e2e/x.e2e.ts]`(실행 등급, 자산 실재 필수) vs `[검증]`(경로 없는 빈 주장 = 위반).
  // SC가 실행 동사(렌더/응답/동작…)를 주장하면 실행 등급 증거를 요구한다. FR·SC 라인만 판정.
  executionEvidencePolicy: "off",           // off(기본)|advisory|hard.
  executionVerbs: [],                       // 빈 값이면 기본 어휘(evidence-lib DEFAULT_EXECUTION_VERBS).
  browserMarkers: [],                       // UI/브라우저 대상 탐지 마커(빈 값=기본). API 단독 증거 불인정 판정용.
  browserEvidencePatterns: [],              // 브라우저 등급 증거 경로 패턴(빈 값=기본: e2e·playwright·cypress…).
  // 라이브 대조(SPEC-032) — 저장소 밖 진실(클라우드·클러스터 실물)을 보는 유일한 게이트.
  // 인프라 무관: 프로젝트가 명령을 주입하고 **stdout 한 줄 = 위반 항목 하나**(비면 clean).
  // 실행 실패(exit≠0)는 언제나 skipped(reason) — 자격증명 없는 환경에서 하드 실패 금지.
  //   [{ id, label, kind: "terraform"|"kubernetes"|"ownership"|"custom", command }]
  liveRealityChecks: [],
  liveRealityPolicy: "off",                 // off(기본)|advisory|hard. hard여도 skipped는 실패 아님.
  liveRealityTimeoutMs: 120000,             // 검사 명령 타임아웃(초과 시 skipped).
  // pre-edit spec-first(SPEC-003 FR-012) — 소유 surface 편집 직전 소유 스펙 미수정을 경고(비차단).
  // commit-msg 훅만 있으면 사후 검사라 순서 위반이 커밋 시점까지 무마찰로 진행된다. off|advisory(기본).
  preEditSpecFirstPolicy: "advisory",
  // 동의어·형태 변이(SPEC-033) — 의미적 중복의 결정적 포획층. dedup은 키 문자열 유일성만 본다.
  //   ① 형태 변이(order/orders/pjt_order): 정규화 후 충돌 — 결정적
  //   ② 선언 동의어: synonymRegistry { "<정본>": {aliases:[...], reason:"..."} } — 사유 필수
  //   ③ 유사 후보: entitySimilarityCommand로 외부 툴(SBERT·LLM·WordNet) 주입 — **언제나 advisory**
  // LLM/임베딩은 후보만 낸다. 미결 후보는 registry(같음) 또는 synonymReviewLedger(다름+사유)로
  // 착지시켜야 사라지며, 확률적 판정에는 어떤 강도에서도 차단력을 주지 않는다(오탐 = 방법론 오류).
  synonymPolicy: "off",                     // off(기본)|advisory|hard. hard는 ①②만 차단.
  synonymRegistry: {},                      // 정본↔별칭 선언(사유 필수·모순 금지·정본 실재 필수)
  synonymReviewLedger: {},                  // { "keyA::keyB": "기각 사유" } — 다르다고 판정한 기록
  keyPrefixes: [],                          // 프로젝트 접두어(예: ["pjt"]) — 비면 접두어 제거 안 함
  entitySimilarityCommand: null,            // 후보 생성기(stdout 한 줄 = "keyA<TAB>keyB[<TAB>score]")
  entitySimilarityTimeoutMs: 120000,
  ownershipRequiredPolicy: "advisory",      // 모든 스펙 Ownership 선언 강제(미선언=dedup 사각). off|advisory|hard.
  crossCategoryDedupPolicy: "advisory",     // 같은 정규화 키가 2+ 카테고리에 소유(카테고리 간 중복). off|advisory|hard.
  filesOverlapPolicy: "advisory",           // 2+ 스펙 Files glob이 같은 실파일 소유(실코드 중복). off|advisory|hard.
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
  cfg.__e2eRegex = (cfg.e2eFileRegex || []).map((s) => new RegExp(s));
  // 접두어 목록 → 정규식 대안 문자열. spec ID와 요구 ID가 **같은 규칙**을 쓰므로 한 곳에 둔다
  // (R13 실측: 두 사이트에 같은 정규식 안전화가 복제돼 있었다 — 한쪽만 고치면 문법이 갈라진다).
  const altOf = (list, fallback) => (list && list.length ? list : fallback)
    .map((p) => String(p).replace(/[^A-Za-z0-9_]/g, "")) // 정규식 안전
    .join("|");
  // spec ID 접두어 파생값(게이트 공통). 예: ["SPEC","TEST","INFRA"] → "SPEC|TEST|INFRA"
  const alt = altOf(cfg.specIdPrefixes, DEFAULTS.specIdPrefixes);
  cfg.__idAlt = alt;
  cfg.__specIdRe = new RegExp(`(?:${alt})-\\d{3}`);                 // 본문/파일명에서 ID 추출
  // 요구 ID 접두어 파생값 — 전 파싱 사이트(coverage 선언·cohesion/completeness 집계·
  // spec-sync FR 라인·@covers)가 이 한 곳에서 파생된 문법을 공유한다(사이트 간 불일치 금지).
  const reqAlt = altOf(cfg.requirementIdPrefixes, DEFAULTS.requirementIdPrefixes);
  cfg.__reqAlt = reqAlt;
  cfg.__frDeclRe = new RegExp(`\\*\\*((?:${reqAlt})-\\d{3}[a-z]?)\\*\\*`, "g"); // spec 본문의 **FR-NNN[a]** 선언
  cfg.__frTokenRe = new RegExp(`\\b(?:${reqAlt})-\\d{3}[a-z]?\\b`, "g");        // 집계/면제용 토큰
  cfg.__coversRe = new RegExp(`@covers\\s+((?:${alt})-\\d{3})\\/((?:${reqAlt})-\\d{3}[a-z]?)\\b`, "g"); // 서픽스는 소문자 1자(FR-003a) — \b로 2자(FR-003ab) 절단 캡처 금지

  // 카테고리 역할 파생값(SPEC-001 FR-010) — 판정 코어·게이트가 공유하는 단일 소스.
  cfg.__roles = resolveCategoryRoles(cfg.ownershipCategories, cfg.ownershipCategoryRoles);

  // Verb 파생값
  const CRUD = ["create", "read", "update", "delete", "list"];
  cfg.__crudVerbs = CRUD;
  cfg.__allVerbs = new Set(
    [...CRUD, ...(cfg.capabilityVerbs || [])].map((v) => String(v).trim().toLowerCase())
  );

  return cfg;
}

// 루트 기준 상대경로("a/b")를 절대경로로.
// ── 파일 순회·스펙 목록의 정본 ────────────────────────────────────────────────
// R13 확률적 층(구조 중복)이 실측으로 잡은 복제: `walkAll`이 4개 게이트에, `walk`이 4개에,
// `specFiles`가 3개에 **본문 동일**로 복붙돼 있었다. 리터럴 층은 정규식만 보므로 이 계열을
// 못 본다 — 같은 규칙을 다른 이름의 함수가 구현한 것이기 때문이다.
// ⚠ Python판(sdd_gates.py)은 처음부터 `walk_files`·`spec_md_files` 공유 함수를 갖고 있었다.
// 즉 이것은 런타임 간 **구조 비대칭**이기도 했다 — 한쪽만 고치면 순회 규칙이 갈라진다.
import { readdirSync, statSync } from "node:fs";
import { join as joinPath } from "node:path";

// 디렉토리 전수 순회 → 루트 상대 경로 배열. ignore 디렉토리는 이름으로 가른다.
export function walkFiles(absDir, ignore, relBase = "", acc = []) {
  let entries;
  try { entries = readdirSync(absDir).sort(); } catch { return acc; }
  for (const name of entries) {
    const p = joinPath(absDir, name);
    const r = relBase ? `${relBase}/${name}` : name;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (ignore.has(name)) continue;
      walkFiles(p, ignore, r, acc);
    } else acc.push(r);
  }
  return acc;
}

// 스펙 디렉토리의 `.md` 절대 경로 목록. onMissing 미전달 시 빈 배열(호출자가 처분을 정한다).
// spec 파일명 판정 정본 — `<PREFIX>-NNN…​.md`. 이 판단이 여러 곳에 흩어지면(실측: R13이 즉시
// 잡았다) 한 게이트는 세고 다른 게이트는 안 세는 스펙이 생기고, 그 차이가 곧 조용한 사각이다.
export function isSpecMdName(name) {
  return /\.md$/.test(String(name || "")) && /^[A-Z]+-\d{3}/.test(String(name || ""));
}

export function specMdFiles(specDirAbs, onMissing = null) {
  let names;
  try { names = readdirSync(specDirAbs); } catch {
    if (onMissing) onMissing(specDirAbs);
    return [];
  }
  return names.filter((n) => /\.md$/.test(n)).sort().map((n) => joinPath(specDirAbs, n));
}

export function resolveFromRoot(cfg, rel) {
  return join(cfg.__root, ...String(rel).split("/").filter(Boolean));
}

// 파일명이 테스트 파일인가(config의 testFileRegex 기준).
export function isTestFile(name, cfg) {
  return cfg.__testRegex.some((re) => re.test(name));
}

// 파일명이 e2e 테스트인가(e2eFileRegex 기준 — testFileRegex의 부분집합으로 선언한다).
// 비선언(빈 배열)이면 언제나 false = 기존 동작 유지(하위호환: e2e 축은 옵트인).
export function isE2eFile(name, cfg) {
  return (cfg.__e2eRegex || []).some((re) => re.test(name));
}
