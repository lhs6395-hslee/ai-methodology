# Feature Specification: Ownership Key Pipeline & Config Adapter

**Module**: `sdd-tooling`  **Spec**: `SPEC-001`  **Created**: 2026-07-02  **Status**: Active
**Input**: 소유권 키의 결정적 파싱·정규화·형식검증과, 언어/스택 무관 config 어댑터를 하나의 파이프라인으로 제공한다.

---

## User Scenarios & Testing

### User Story 1 — 결정적 키 파이프라인 (P1)
게이트(ownership·cohesion·consistency·spec-sync)는 사람의 판단 대신 **결정적 함수**로 소유권 키를 다뤄야 한다. `ownership-keys.mjs`의 `parseSection`·`normalizeKey`·`validateKey`가 spec 텍스트에서 카테고리별 키를 뽑고, 카테고리별 규칙으로 정규화하고, 형식을 검증한다. 같은 입력이면 사람이든 LLM이든 같은 결과가 나온다.
- **Independent Test**: `ownership-keys.test.mjs`가 `## Ownership` 블록을 넣고 파싱 결과·정규화형·검증 사유가 표대로임을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a spec text with a `## Ownership` section, **When** `parseSection` runs for the configured categories, **Then** it returns one trimmed key array per category with placeholder(`[…]`)·dash tokens excluded.

### User Story 2 — config 한 장으로 언어 중립 (P1)
`sdd-config.mjs`의 `loadConfig`는 프로젝트 루트의 `sdd.config.json`을 읽고 빠진 필드를 `DEFAULTS`로 채운 뒤, 모든 게이트가 공유하는 파생값(`__root`·`__testRegex`·`__specIdRe`·`__coversRe`·`__allVerbs`)을 계산한다. config 파일이 없으면 JS/TS 기본과 동일하게 동작한다(하위호환).
- **Independent Test**: `sdd-config.test.mjs`가 부분 config를 주고 DEFAULTS 병합·파생 정규식·verb 집합을 단독 검증.
- **Acceptance (GWT)**: 1. **Given** a partial `sdd.config.json`, **When** `loadConfig` runs, **Then** unset fields fall back to DEFAULTS and `commands` is shallow-merged.

### Edge Cases
- `parseSection`으로 넘어온 값이 `—`, `[…]`, 또는 `[`로 시작하는 placeholder 토큰이면 키에서 제외한다(빈 카테고리 허용, 조용한 오탐 방지).
- `normalizeKey`의 Surface 경로에 매칭되는 `<METHOD> <path>` 형태가 없으면(공백 분리 실패) 전체를 소문자화한 fallback을 반환한다. `surfaceFormat: "path"|"any"`이면 애초에 METHOD 파싱을 생략하고 소문자 경로(trailing slash 제거)로 정규화한다(파일 라우팅·비-HTTP 자원용).
- `loadConfig`가 `sdd.config.json` JSON 파싱에 실패하면 stderr로 경로·사유를 출력하고 `process.exit(1)`한다(조용한 무시 금지).
- `validateKey`의 Capability는 점 1개(`entity.verb`)가 아니거나 verb가 `__allVerbs`(CRUD + 등록 verb)에 없으면 위반 사유 문자열을 돌려준다.
- `__coversRe`의 요구 ID 문법은 접두어(`requirementIdPrefixes` 파생, 기본 `FR`) + 3자리 + 선택적 소문자 서픽스 1자이며 경계까지 요구한다 — 2자 서픽스 토큰은 부분(절단) 캡처 없이 통째로 불인정(절단 오판 금지). (ID 예시를 리터럴로 안 쓰는 이유: 게이트가 예시 토큰을 이 spec의 FR로 집계하기 때문 — SPEC-003과 동일 규칙.)
- 카테고리 불릿은 **여러 줄·여러 개**일 수 있다 — 같은 카테고리를 두 불릿으로 적거나 목록을 줄바꿈으로 이어도 전부 한 집합으로 읽는다. (과거엔 첫 불릿의 첫 줄만 읽어 나머지가 dedup 대상에서 무음 소실했다 — 두 스펙이 같은 키를 소유해도 "구조적 중복 없음"이 나오던 결함.)
- 키 구분자 쉼표는 **괄호·대괄호 밖에 있을 때만** 구분자다 — `POST /api/x (SPEC-013), ui:y (SPEC-013, 셸)`는 두 키다(과거엔 세 조각으로 쪼개져 쓰레기 토큰이 앵커 keySet을 오염시켰다).
- 플레이스홀더는 **대괄호만으로 이뤄진 토큰**(`[…]`·`[TBD]`)과 `—`·`-`뿐이다 — `[level]/page.tsx`·`src/app/[id]/route.ts`처럼 대괄호 뒤에 실체가 이어지는 정당한 경로 키는 보존한다(과거엔 `[`로 시작하면 전부 폐기).
- 카테고리·헤딩 이름은 정규식에 보간하기 전 이스케이프한다 — `C++ Symbols`·`Jobs (async)` 류 이름에서 Node 판이 크래시하고 Python 판은 통과하던 미문서화 패리티 파괴를 봉합.
- 유니코드는 NFC로 접는다 — macOS(NFD 성향)와 Linux CI를 섞어 쓰거나 클립보드 경유로 붙여넣은 한글 키가 NFC/NFD로 갈리면 눈으로 같은 entity를 두 스펙이 소유해도 dedup이 충돌을 놓쳤다.
- 카테고리 역할은 **선언 우선·이름 폴백**이다 — `ownershipCategoryRoles`에 없는 역할만 기존 이름 정규식(`/entit/`·`/surface/`·`/capabilit/`)으로 추측한다. 그래서 기존 프로젝트는 무영향이고, 이름을 바꾼 프로젝트·비-웹 카테고리(킷 `Modules`/`Symbols`)는 선언으로 역할을 확정한다.
- 역할이 해석되지 않은 카테고리는 **역할 없음**이며 그 역할에 걸린 판정은 inert다 — 조용히 통과하지 않고 소비 게이트가 사유를 표면화한다(SPEC-024·SPEC-026 inert 고지와 같은 계열).
- 한 역할에는 카테고리 하나만 매핑된다(선언 순 첫 매치) — 두 카테고리에 같은 역할을 주면 뒤엣것은 무시한다. 미지의 역할 문자열은 무시(오타가 판정을 뒤집지 않게).
- 요구 ID 정규식 3종(`__frDeclRe`·`__frTokenRe`·`__coversRe`)은 전부 `requirementIdPrefixes` 한 곳에서 파생된다 — 게이트가 자체 요구 정규식을 하드코딩하면 사이트 간 문법 불일치(절단 태그·조용한 누락)가 재발한다.

---

## Functional Requirements (EARS)
> 정본은 영어. 각 FR은 구현된 동작을 서술한다(발명 금지).

- **FR-001** (event): WHEN `parseSection` receives a heading and category list, THE **ownership-keys.mjs** (S) parser SHALL slice the text from that `## <heading>` line to the next `## ` line and return one trimmed key array per category, collecting every bullet declared for that category (not only the first), joining each bullet's indented continuation lines, splitting on commas that sit outside parentheses and brackets, and excluding only placeholder tokens — empty, `—`, `-`, and tokens consisting solely of a bracketed span. — capability: **key-pipeline.parse** (C).
- **FR-002** (event): WHERE `surfaceFormat` is `http` (default), WHEN a Surfaces key is normalized, THE SYSTEM SHALL uppercase the METHOD, lowercase the path, rewrite `:id`/`<id>`/`{id}` params to the configured `surfacePathParam` `{name}` form, and strip the trailing slash; WHERE `surfaceFormat` is `path` or `any`, THE SYSTEM SHALL instead lowercase the key and strip the trailing slash without METHOD/param parsing (file-path surfaces).
- **FR-003** (event): WHEN any key is normalized, THE SYSTEM SHALL first apply Unicode NFC normalization so that canonically equivalent spellings collapse to one key, and WHERE the key is a non-Surfaces (Entity or Capability class) key THE SYSTEM SHALL additionally lowercase it and collapse internal whitespace to single spaces.
- **FR-004** (unwanted): IF a Capabilities key is not exactly `entity.verb` (one dot) or its verb is absent from the configured verb set, THEN THE SYSTEM SHALL return a violation reason string instead of null.
- **FR-005** (unwanted): WHERE `surfaceFormat` is `http` (default), IF a Surfaces key does not match `<METHOD> <path>` or the `event:`/`job:` form, THEN THE SYSTEM SHALL return a violation reason string; WHERE `surfaceFormat` is `path`, IF the key contains whitespace or non-path characters THEN it is a violation; WHERE `surfaceFormat` is `any`, no surface format is enforced.
- **FR-006** (ubiquitous): THE **sdd-config.mjs** (S) loader SHALL resolve the config by walking upward from the start directory for `sdd.config.json`, merge the parsed user object over `DEFAULTS`, and shallow-merge the `commands` map.
- **FR-007** (event): WHEN config is loaded, THE SYSTEM SHALL derive the shared regexes `__specIdRe` and `__coversRe` from `specIdPrefixes`, set `__root` to the config directory (or the start directory when no config file exists), and build `__allVerbs` from CRUD plus `capabilityVerbs`.
- **FR-008** (unwanted): IF `sdd.config.json` exists but fails to parse as JSON, THEN THE SYSTEM SHALL print the path and error to stderr and exit with a non-zero code.
- **FR-009** (event): WHEN config is loaded, THE SYSTEM SHALL derive the requirement-ID regexes — declaration (`__frDeclRe`), token (`__frTokenRe`), and covers (`__coversRe`) — from `requirementIdPrefixes` (default FR) with an optional single lowercase-letter suffix and boundary enforcement, as the single grammar shared by every parsing site.
- **FR-010** (event): WHEN config is loaded, THE **key-pipeline** (E) SHALL resolve each ownership category's role — entity, surface, capability — from the declared `ownershipCategoryRoles` map first and only then fall back to the legacy name patterns, exposing the result as one derived value (`__roles`) that every judgment core and gate consumes, so that a category's role never depends on guessing its name.

### Key Entities
- **config object** — the merged runtime config: `specDir`, `scanDirs`, `ignoreDirs`, `testFileRegex`, `ownershipCategories`, `specIdPrefixes`, plus derived `__root`/`__testRegex`/`__specIdRe`/`__coversRe`/`__allVerbs`.
- **ownership key** — a single normalized identifier owned by exactly one spec (Module / Symbol / Artifact token).

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키. 카테고리는 `sdd.config.json`의 `ownershipCategories`(Modules/Symbols/Artifacts)와 일치.
- **Modules**: key-pipeline
- **Symbols**: ownership-keys.mjs, sdd-config.mjs
- **Artifacts**: —
- **Capabilities**: key-pipeline.parse
- **Files**: tooling/ownership-keys.mjs, tooling/sdd-config.mjs, sdd.config.json, tooling/__tests__/ownership-keys.test.mjs, tooling/__tests__/sdd-config.test.mjs

## Dependencies (참조 — dedup 제외)
> 없음 — 이 spec이 파이프라인의 뿌리다(다른 spec들이 이것을 참조).

---

## Success Criteria (측정형)
- **SC-001**: `ownership-keys.test.mjs`·`sdd-config.test.mjs`의 모든 케이스가 통과하며(현재 green), 동일 입력에 대한 `parseSection`/`normalizeKey`/`validateKey` 결과가 100% 재현된다. [검증: tooling/__tests__/ownership-keys.test.mjs, tooling/__tests__/sdd-config.test.mjs]
- **SC-002**: config 파일이 없는 프로젝트에서 `loadConfig`가 `DEFAULTS`와 동일한 유효 config를 산출한다(하위호환 회귀 0건). [검증: tooling/__tests__/ownership-keys.test.mjs, tooling/__tests__/sdd-config.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 파이프라인은 순수 텍스트 파서로 Node 런타임만 요구하고 대상 프로젝트 언어에 비의존한다. [검증: tooling/__tests__/ownership-keys.test.mjs, tooling/__tests__/sdd-config.test.mjs]

## Assumptions / Clarifications Retained
- `ownershipCategories` 헤더 문자열은 config 값과 정확히 일치해야 게이트가 파싱한다(정규화 표기 규칙은 설계 §4 표를 따른다).

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 게이트 전종·전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-002(spec-quality-gates): 비중복 — 이 spec은 파싱·정규화·config 코어, SPEC-002는 그 소비 게이트.
- 2026-07-05 이웃 SPEC-007(verification-accounting): 비중복 — 회계 키 문법은 이 spec의 파생값을 소비만.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | config 표면에 `diagnosisGuardPolicy`(advisory 기본, 킷 hard)·`diagnosisSpecMap`·`diagnosisSpecReadPatterns`·`diagnosisGuideSections` 추가 + `entityRegistry`에 `diagnosis-guard` 등재 + 킷 진단 규칙 2종 선언, Node·Python DEFAULTS 동시 | SPEC-053 동반. 금지 목록을 게이트에 하드코딩하지 않은 이유: 프로젝트마다 금지 대상이 다르고, 하드코딩하면 킷이 **그 프로젝트의 결정**을 담게 된다(제보 프로젝트의 첫 사례가 그 형태였다). `diagnosisSpecReadPatterns`를 null 기본으로 뺀 이유: 명세를 읽는 명령은 모든 규칙을 이겨야 하는데 그 인정 범위가 프로젝트 레이아웃에 달려 있다 [검증: tooling/__tests__/diagnosis-guard.test.mjs] |
| 2026-08-10 | config 표면에 `specConflictPolicy`(advisory 기본, 킷 hard)와 판정 파라미터 5종(`specConflictMinTokens`·`specConflictMaxDocFreq`·`specConflictStopwords`·`specConflictNegationMarkers`·`specConflictClauseBreaks`, 전부 null=킷 기본) 추가 + `entityRegistry`에 `spec-conflict` 등재, Node·Python DEFAULTS 동시 | SPEC-052 동반. null 기본값이 담는 수치는 **도입 전 킷 코퍼스로 측정한 값**이다(지시 441건·오탐 0) — 이 축은 오탐이 나면 즉시 꺼지므로 파라미터를 추측으로 정하지 않았다. 어휘(부정 마커·기능어·절 경계)를 knob으로 뺀 이유는 EARS 정본이 영어라도 프로젝트가 다른 조수사를 쓸 수 있기 때문이고, **면제가 아니라 어휘 교체**다 [검증: tooling/__tests__/spec-conflict.test.mjs] |
| 2026-08-10 | config 표면에 `exemptionRegistry`(면제 항목별 분류·사유)·`exemptionKnobs`(null=이름 규약 자동 탐지) 추가, Node·Python DEFAULTS 동시 + 킷 자신의 면제 16건 등록 | SPEC-027 확장 동반. 면제 knob을 손 목록으로 두지 않은 이유는 강도 래칫의 실측 드리프트다 — `outOfBandDeployPolicy`·`changeLogFrRefPolicy`가 도입 시 목록에서 빠져 감시 밖이었다. 이름 규약(`Exempt`·`Exception`) 자동 탐지는 **새 면제 knob이 감시 밖에서 태어날 수 없게** 한다 [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-08-10 | config 표면에 `agentWiringPolicy`(advisory 기본, 킷 hard)·`agentSettingsFile`·`agentHookDecl`·`agentScriptDir`(전부 null=킷 기본) 추가 + `entityRegistry`에 `agent-wiring` 등재(사유 포함), Node·Python DEFAULTS 동시 | SPEC-051 동반. 경로를 코드에 고정하지 않는 이유는 이 라운드가 실측한 그대로다 — 편집 가드가 코드 경로를 하드코딩해 킷의 `scanDirs`(`tooling`)에서 **발화할 수 없었고** 그 0건이 진짜 0건과 구분되지 않았다. 킷은 `agentHookDecl`·`agentScriptDir`를 `tooling/harness`로 인스턴스화해 자기적용한다 [검증: tooling/__tests__/agent-wiring.test.mjs] |
| 2026-08-10 | config 표면에 `importWiringPolicy`(advisory 기본, 킷 hard)·`importWiringExtensions`(null=킷 기본) 추가 + `entityRegistry`에 `import-wiring` 등재(사유 포함), Node·Python DEFAULTS 동시 | SPEC-050 동반. 확장자를 코드에 고정하지 않는 이유는 이 킷의 반복된 실측이다 — 게이트가 어휘·확장자를 고정하면 목록 밖 프로젝트에서 판정이 통째로 사라지고 **그 0건이 진짜 0건과 구분되지 않는다**(SPEC-038·040 계열). entity는 임의 신설 금지 규범대로 사유와 함께 등록했고, capability verb는 새 어휘를 늘리지 않고 등록된 `resolve`를 썼다 [검증: tooling/__tests__/import-wiring.test.mjs] |
| 2026-08-10 | config 어댑터에 `blockingBranches` 추가(사유 필수 선언, SPEC-049) | 차단 분기가 무엇인지는 의미 판정이라 자동 발견하지 않는다(모든 early-return을 잡아 오탐이 폭주한다) — 선언은 책임지는 행위다. 미선언이면 판정하지 않는다 [검증: tooling/__tests__/verification-run.test.mjs] |
| 2026-08-10 | config 어댑터에 감시자 knob 4종 추가(`watchdogPolicy`·`watchdogReceipt`·`watchdogCiGlobs`·`sweepInvocationMarkers`) | SPEC-048 신설. 영수증 기본 경로는 `sdd/adoption.json` — `.sdd/`에 두지 않는다(gitignore라 채택 선언이 체크아웃마다 사라진다) [검증: tooling/__tests__/watchdog.test.mjs] |
| 2026-08-10 | config 어댑터에 순차 프로세스 knob 5종 + 하드코딩 제거 knob 4종 추가(`processes`·`processSsotPolicy`·`processSsotListCap`·`processFragmentMinStages`·`statefulStageMarkers` / `syncRulesFile`·`implModuleExtensions`·`localHostPatterns`·`processDocRegex`) | SPEC-047 신설 + 오너 규범(하드코딩 지양). 판정에 쓰이는 값은 전부 null 기본으로 두고 게이트가 자기가 쓴 값을 출력에 밝힌다 — 고정하면 목록 밖 프로젝트에서 판정이 조용히 사라진다 [검증: tooling/__tests__/process-ssot.test.mjs] |
| 2026-08-10 | config 어댑터에 증거 등급 method knob 2종(`browserGradeMethods`·`deployGradeMethods`) 추가 | SPEC-031 확장 — 등급을 경로만으로 판정하면 프로젝트가 증거 파일을 물리적으로 쪼개야 한다(실측 제보). null 기본이고 열거 밖 method는 등급을 주지 않는다 [검증: tooling/__tests__/evidence.test.mjs] |
| 2026-08-10 | config 어댑터에 지목 구현체 참조 knob 3종(`implReferencePolicy`·`implReferenceListCap`·`implReferenceProseRegex`) 추가 | SPEC-046 신설에 따른 기본값 등재. 산문 제외 정규식은 `null` 기본(킷 기본 = md·html·rst·txt·jsonl·lock) — 문서의 언급은 실행이 아니다 [검증: tooling/__tests__/impl-reference.test.mjs] |
| 2026-08-10 | config의 `specSyncExemptGlobs` 값 좁힘 반영(판정 로직은 SPEC-003 소유, 여기서는 config 파일 자체의 소유 귀속) | 소유 선언과 면제 선언이 같은 파일을 가리키면 소유가 거짓이 된다 — SPEC-045의 소개 문서 소유가 생기며 그 모순이 실재했고, 게이트가 지목했다. config는 판정의 입력이므로 값 변경도 스펙 동반 대상이다(SPEC-003의 config 자기보호와 같은 결) [검증: tooling/__tests__/spec-sync.test.mjs] |
| 2026-08-10 | config 어댑터에 소개 문서 동기 knob 3종(`introDocs`·`introDocRuleSource`·`introDocPolicy`) 추가 + **spec 파일명 판정 정본화**(`isSpecMdName`) | SPEC-045 신설에 따른 기본값 등재(`introDocs` 빈 배열 = 결합 0, 미선언이면 게이트가 inert를 선언한다). 파일명 판정은 두 게이트에 복제돼 있던 것을 R13이 잡았다 — 이 판단이 흩어지면 한 게이트는 세고 다른 게이트는 안 세는 스펙이 생기고, 그 차이가 곧 조용한 사각이다 [검증: tooling/__tests__/intro-doc.test.mjs] |
| 2026-08-10 | config 어댑터에 의미 커버리지·결정 입도·근거 적용범위 knob 9종 추가(`termGlossary`·`termCoveragePolicy`·`termCoverageListCap`·`externalTargetPolicy`·`externalTargetListCap`·`evidenceScopePolicy`·`observationMarkers`·`evidenceScopeLabels`·`environmentMarkers`) | SPEC-042·043·044 신설에 따른 기본값 등재 — 새 축의 어휘 목록은 전부 `null` 기본(킷 기본 마커)이고 프로젝트가 선언으로 교체한다. 면제가 아니라 어휘 교체다: 교체해도 축은 계속 판정한다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-07-02 | 초안(자기 정렬) | plan ④ |
| 2026-07-02 | `__coversRe` 레터 서픽스(소문자 1자) 지원 + 경계 강제 | 도그푸딩(소비 프로젝트 A): 정본 갱신이 프로젝트 커스터마이즈를 덮어 가짜 dangling 발생 — 기본 지원으로 흡수(/speckit.fix) |
| 2026-07-02 | `surfaceFormat`(http\|path\|any) config 추가 — FR-002/005 개정 + `normalizeKey`/`validateKey` 분기 + 테스트 | 도그푸딩(소비 프로젝트 A): Next.js 파일 라우팅·비-HTTP 자원(Dockerfile·IaC)을 Surface로 모델링 — HTTP 강제를 config로 완화 |
| 2026-07-05 | `requirementIdPrefixes` config + 요구 ID 정규식 3종 파생(FR-009) | 진단 B-2: 요구 접두어가 전 사이트에 하드코딩 — specIdPrefixes와 같은 config 파생으로 일반화(문법화, SPEC-006 연동) |
| 2026-07-05 | DEFAULTS에 회계·정책 키 5종 추가(`strictSpecs`·`requireAccounting`·`smokeManifest`·`specSyncUnownedPolicy`·`entityRegistry`) — 전부 비활성 기본값(하위호환) | 고도화 2차(B-3·P1~P3): 소비 게이트들의 새 문법은 config 어댑터 한 곳에서 선언(SPEC-007 등 연동, 런타임 DEFAULTS 패리티는 계약 테스트가 강제) |
| 2026-07-05 | DEFAULTS에 재도출·증거 스캔 키 3종 추가(`smokeScanDirs`·`derivationManifest`·`derivationClassGlobs`) — 전부 비활성 기본값(하위호환) | SPEC-009·SPEC-010 신설 동반 — 새 문법의 기본값도 config 어댑터 한 곳에서 선언(런타임 DEFAULTS 패리티는 계약 테스트가 강제) |
| 2026-07-06 | DEFAULTS에 `prefixClassExemptions` 추가 — 비활성 기본값(하위호환) | SPEC-012 신설 동반 — 접두어↔클래스 면제 레지스트리도 config 어댑터 한 곳에서 선언(런타임 DEFAULTS 패리티는 계약 테스트가 강제) |
| 2026-07-06 | `derivationClassGlobs` 기본값 보정 — 분류 원칙을 "정의 파일 + 동반·보조 파일"로: iac에 .dockerignore·kustomization·*.hcl·서브디렉토리 compose, ci에 .github/actions·.gitlab/ci·cloudbuild·travis·drone 편입(중복 루트 전용 항목은 `**/X`로 정리 — 루트 X 매치 동일) | B안: .dockerignore 등 인프라 동반 파일이 "other"로 새서 전체성 판정·D3 검출을 약화 — 접두어↔클래스 게이트(SPEC-012)와 재도출 회계(SPEC-009)의 분류 SSOT를 한 곳에서 보정 |
| 2026-07-06 | DEFAULTS에 `objectStorageMarkers`(멀티클라우드 기본 목록) 추가 | SPEC-016 신설 동반 — 오브젝트 스토리지 결정 게이트의 감지 마커를 config 어댑터가 파생·병합([]로 비활성) |
| 2026-07-06 | DEFAULTS.specIdPrefixes에 `CICD` 편입 → `["SPEC","INFRA","TEST","CICD"]` | CICD 표준 접두어 신설 — 파일명·SPEC_ID·@covers 정규식이 이 목록에서 파생되므로 CICD-NNN이 1급 수용됨 |
| 2026-07-06 | DEFAULTS에 `testInfraGlobs`(기본 []) 추가 | SPEC-015 신설 동반 — 테스트 인프라 네임스페이스 마커를 config 어댑터가 파생([]로 비활성) |
| 2026-07-06 | DEFAULTS에 `trackerCloseout`(기본 {}) 추가 | 완료 루프 close-out 규범 — 원점 트래커/보고 채널 인스턴스화 knob(게이트 아닌 스킬·사람 소비, {}로 비활성) |
| 2026-07-09 | DEFAULTS에 `draftBlockPolicy`(기본 "advisory") 추가 | SPEC-008 FR-007 신설 동반 — Draft-block을 range 모드에서도 hard로 승격하는 knob의 기본값을 config 어댑터가 선언(하위호환 유지) |
| 2026-07-09 | DEFAULTS에 `relationTypes`(기본 []) 추가 | SPEC-017 신설 동반 — Entity 관계 relation-type 어휘(capabilityVerbs 동형)의 기본값을 config 어댑터가 선언(빈 목록=무제한, 하위호환) |
| 2026-07-09 | `ownership-keys.mjs` 설계 근거 주석 경로 정정(`docs/superpowers/specs/` → `docs/design/`) | STORAGE §2.7 신설 동반 — 킷 자신의 설계 문서가 새 규약 위치로 이동, 참조 경로 동기(동작 변경 없음) |
| 2026-07-16 | config DEFAULTS에 `retiredIds: []` knob 추가(Node·Python) — 폐기 spec-ID 목록 | SPEC-018 FR-006 동반: numbering 게이트가 이 knob으로 retirement gap을 정상 취급(소비 게이트는 SPEC-014/002) |
| 2026-07-16 | config DEFAULTS에 `semanticDriftPolicy: "advisory"` knob 추가(Node·Python) — off\|advisory\|hard | SPEC-019 FR-005 동반: 리네임 기반 drift 승격 정책(소비 게이트는 SPEC-003, 판정 코어는 SPEC-019) |
| 2026-07-16 | config DEFAULTS에 `runTestsPolicy: "off"` knob 추가(Node·Python) — off\|advisory\|hard | SPEC-021 동반: 테스트 스위트 실제 실행 게이트 정책(판정·게이트는 SPEC-021) |
| 2026-07-16 | config DEFAULTS에 `schemaDriftManifest: null`·`migrationStatePolicy: "advisory"` knob 추가(Node·Python) | SPEC-022 동반: 런타임 스키마 드리프트(R2′) 게이트 정책(판정·게이트는 SPEC-022) |
| 2026-07-16 | `configFromString`(문자열→동일 파생 config) 신설 + DEFAULTS `specSyncBase: null` + 킷 자신 `sdd.config.json`을 이 스펙 Files로 소유 편입(exempt 해제) | 감사 T1: 게이트를 통제하는 config가 자기 자신을 게이트에서 면제(specSyncExemptGlobs 자기등재)하고 워킹트리 config로 판정돼, 한 줄 커밋으로 전 강제를 흔적 없이 무력화 가능하던 반사성 결함 — 소유 편입으로 config 변경에 스펙 동반(영속 흔적)을 강제 |
| 2026-07-17 | config DEFAULTS에 `frKeyAnchorPolicy: "off"` knob 추가(Node·Python) — off\|advisory\|hard | SPEC-023 동반: FR 키 앵커 정책(판정 코어는 SPEC-023, 게이트 배선은 SPEC-002) |
| 2026-07-20 | config DEFAULTS에 `capabilityOwnershipPolicy: "advisory"` knob 추가(Node·Python) — off\|advisory\|hard | SPEC-024 동반: capability 귀속 정책(판정 코어는 SPEC-024, 게이트 배선은 SPEC-002) |
| 2026-07-21 | entityRegistry에 `spec-migration`·`capability-ownership` 등록(킷 자신) | SPEC-025·024 동반: 신규 모듈 entity 어휘 등록(등록 관문) |
| 2026-07-21 | config DEFAULTS에 `entitySchemaSources`(인프라 무관 어댑터 `[{globs,patterns}]`)·`entitySchemaBackingPolicy: "off"`·`entitySchemaExemptEntities: {}` 추가(Node·Python) + entityRegistry에 `entity-schema-backing` 등록 | SPEC-026 동반: 유령 entity 차단 정책(판정 코어는 SPEC-026, 게이트 배선은 SPEC-002) |
| 2026-07-21 | config DEFAULTS에 `frAnchorMarkers`(`{entity:"E",surface:"R",capability:"C"}`) 추가(Node·Python) — FR 카테고리 마커 글자 매핑, 프로젝트 조정 가능 | SPEC-023 FR-005 일반화 동반: 굵은 키의 카테고리 마커(판정 코어는 SPEC-023, 배선은 SPEC-002) |
| 2026-07-21 | config DEFAULTS에 `policyRatchetPolicy`(off\|advisory\|hard, 기본 advisory) + `policyRatchetExceptions`([]) 추가(Node) | SPEC-027 동반: 강제 정책 강도 단조성(판정 코어·게이트는 SPEC-027) |
| 2026-07-27 | `frAnchorMarkers` 기본값의 surface 글자 `"R"`→`"S"`(Node·Python DEFAULTS + 게이트 fallback) | SPEC-023 Change Log 동반: 마커 글자를 카테고리 이름 머리글자(E/S/C)로 통일 — knob 자체는 불변이라 라우트 전용 프로젝트는 `{surface:"R"}` 오버라이드 가능 |
| 2026-07-27 | FR-010 신설 — 카테고리 역할 해석(`ownershipCategoryRoles` + `resolveCategoryRoles` → `cfg.__roles`). 판정 코어 3종(capability 귀속·스키마 백킹·키 종류 맵)과 게이트가 이 단일 소스를 소비, Node·Python 미러 | Ownership 감사 #21 근본 원인: 역할을 카테고리 **이름**으로 추측해 (a) 개명 시 판정이 조용히 inert(A-1) (b) 킷 자신(Modules/Symbols)이 규칙 9종을 자기에게 적용 불가(도그푸딩 공백). `ENT_CAT` 폴백이 3개 파일에 복붙(F8)돼 있던 것도 함께 제거 |
| 2026-07-27 | FR-001·FR-006 주어를 `THE SYSTEM`에서 실제 소유 심볼(**ownership-keys.mjs**·**sdd-config.mjs**)로 교체 — 소유 surface 키 2건 FR 앵커 | SPEC-023 FR-007(소유 키 앵커) 자기적용: FR-010의 `ownershipCategoryRoles` 선언으로 킷 자신에게 규칙이 발화 — 익명 주어라 소유 키가 FR 선언 라인에 흔적이 없던 것을 실제 행위자로 명시(동작 불변) |
| 2026-07-27 | `entityRegistry`의 `spec-id-numbering` 설명을 두 번호 층위(spec-ID·FR)로 갱신 | SPEC-014 FR-005/006 동반: 같은 aggregate가 FR 번호까지 소유하게 되어 config 사전의 entity 서술이 실체와 어긋나던 것을 정합 |
| 2026-07-27 | dedup 입력 신뢰성 5건 봉합 — `parseSection` 전 불릿·줄바꿈 이어붙이기, 괄호 인식 split(`splitKeys`), 플레이스홀더 정밀화(`isPlaceholder`), 카테고리명 정규식 이스케이프(`escapeRegExp`), `normalizeKey` NFC 정규화. FR-001·FR-003 개정 + Edge Cases 5건, Node·Python 바이트 패리티, 회귀 테스트 6건 | Ownership 감사 #21 C-2·C-3·M-13·M-3·유니코드: dedup은 킷의 **유일한 hard 게이트**인데 그 입력이 조용히 잘려, 두 스펙이 같은 키를 소유해도 "✓ 구조적 중복 없음"이 나왔다(실측 재현 5건). 중복성 판정의 신뢰가 근본에서 깨져 있던 자리 |
| 2026-07-27 | `entityRegistry`에 `ownership-map` 등록 | SPEC-028 동반: 신규 모듈 entity 어휘 등록(등록 관문 — 킷 자체 게이트가 누락을 hard로 지목) |
| 2026-07-28 | `ownershipSourceRoots`·`symbolRealityPolicy` 2종 knob 추가 선언 + `entitySchemaSources`에 `{kind:"spec-slug"}` 소스 종류 채택. 킷 자신을 두 문법 `hard`로 전환하고 `entityRegistry`에 `ownership-reality` 등록 | SPEC-029 신설 — 실재 판정을 어댑터 위임에서 문법으로. config가 판정의 SSOT라는 원칙대로 소스 루트·강도를 여기서 선언한다 |
| 2026-07-28 | `ownershipCategories`에 `Capabilities` 추가 + `ownershipCategoryRoles`에 capability 역할 선언 + `capabilityVerbs` 14종 등록(account adopt enforce gate generate install judge migrate mirror parse resolve retire run scan) | 킷의 마지막 미판정 가드가 capability였다 — 카테고리가 없어 SPEC-024 판정이 inert였다. owner 결정: 정책을 off로 명시하는 대신 카테고리를 도입해 킷이 그 가드를 자기에게도 적용한다 |
| 2026-07-29 | `resolveCategoryRoles`에 `engine`·`event` 역할 추가(선언 전용 — 이름 폴백 없음) + DEFAULTS에 `enginesSources`·`engineRealityPolicy`·`engineExemptKeys`·`eventCatalogSources`·`eventAttributionPolicy`·`eventExemptKeys` knob(Node) | SPEC-030 동반: 판정 코어·게이트는 SPEC-030 소유, 역할 해석·config knob은 이 spec(키 파이프라인) 소유. 옵트인이라 미선언 시 inert |
| 2026-07-29 | DEFAULTS에 `ownershipRequiredPolicy`·`crossCategoryDedupPolicy`·`filesOverlapPolicy` knob(Node, 기본 advisory) | SPEC-002 FR-011 동반: 구조 문법 잔여 3종 판정은 check-ownership(SPEC-002) 소유, config knob은 이 spec 소유 |
| 2026-07-30 | DEFAULTS에 `executionEvidencePolicy`·`executionVerbs`·`browserMarkers`·`browserEvidencePatterns`(SPEC-031) + `liveRealityChecks`·`liveRealityPolicy`·`liveRealityTimeoutMs`(SPEC-032) + `preEditSpecFirstPolicy`(SPEC-003 FR-001 확장) knob 추가(Node) | "선언이 실제로 동작하는가" 축 신설 동반 — 판정 코어·게이트는 각 소유 스펙, config knob은 이 spec 소유 |
| 2026-07-30 | DEFAULTS에 `synonymPolicy`·`synonymRegistry`·`synonymReviewLedger`·`keyPrefixes`·`entitySimilarityCommand`·`entitySimilarityTimeoutMs` knob 추가(Node) | SPEC-033 동반: 판정 코어·게이트는 SPEC-033 소유, config knob은 이 spec 소유 |
| 2026-08-02 | config knob 신설 — `hooksInstalledPolicy`·`syncHookRules`·`syncHookDelegatedTo`(훅 배선·훅 성능, SPEC-036/004) + `sdd/OWNERSHIP_MAP.md`를 생성물 예외에 편입 | 훅 미설치·pre-push 30초 제보 대응. 맵은 게이트가 재생성하는 산출물이라 `sdd/smoke-manifest.json`과 같은 클래스인데 예외 목록에서 빠져 있어, 맵 재생성마다 SPEC-028 Change Log를 요구했다(억지 동반요구) |
| 2026-08-02 | config knob 3종 추가 — `supportLayerSpecs`(SPEC-002 교착 출구)·`outOfBandDeployDebtFile`(SPEC-035 hard의 실체). Python DEFAULTS 미러 동반 | 소유 스펙의 판정 변경에 따른 knob 신설. 등록부형 knob은 사유 필수·상시 표면화 관례를 따른다(schema-backing 면제와 같은 경계) |
| 2026-08-02 | 킷 자기적용 config — `scCoveragePolicy: advisory → hard`, `verificationKinds`에 `ci` 추가, `evidenceManifest` 최초 선언(CICD-001 2건) | SPEC-034 백로그 소진 동반. `ci` 종류는 도그푸딩 SC가 지목하는 CI 실행을 unit과 구분해 세기 위한 것이다 — 같은 verified라도 무엇이 재현하는지가 다르다 |
| 2026-08-02 | config knob 4종 추가 — `changeLogFrRefPolicy`(off\|advisory\|hard, 기본 advisory) + `changeLogNewVerbs`·`changeLogReviseVerbs`·`changeLogRetireVerbs`. Python DEFAULTS 미러 동반 | SPEC-037 동반. 어휘를 knob으로 뺀 이유: 킷은 `신설`, 제보 프로젝트는 `신규`를 쓴다 — 코드에 못 박으면 표현이 한 글자 다른 저장소에서 게이트가 통째로 inert가 되고 그 0건은 진짜 0건과 구분되지 않는다 |
| 2026-08-02 | config knob 3종 추가 — `deployPreconditionPolicy`(off\|advisory\|hard, 기본 off) + `deploySmokeCommand`·`deploySmokeTimeoutMs`. Python DEFAULTS 미러 동반 | SPEC-035 FR-006·FR-007 동반. 전제 조건은 기본 off — 사전 **차단**이라 도입 즉시 켜면 미커밋 배포 궤도의 팀이 첫날 멈춘다(advisory 경유가 순서다) |
| 2026-08-03 | config knob 8종 추가 — `duplicateLogicPolicy`(off\|advisory\|hard, 기본 advisory) + `duplicateLogicAllow`·`duplicateLiteralPatterns`·`duplicateLiteralMinLength`·`duplicateLiteralFileRegex`·`duplicateLogicIncludeTests`·`duplicateLogicCommand`·`duplicateLogicTimeoutMs`. Python DEFAULTS 미러 동반 | SPEC-038 동반. 리터럴 패턴과 대상 확장자를 **쌍으로** knob에 둔 이유: 기본값이 JS/TS 정규식 문법이라 언어를 바꿀 때 하나만 바꾸면 게이트가 조용히 0건을 낸다(inert와 clean이 구분되지 않는다) |
| 2026-08-04 | config knob 2종 추가 — `coversBacklinkPolicy`(off\|advisory\|hard, 기본 advisory) + `coversBacklinkListCap`. Python DEFAULTS 미러 동반 | SPEC-039 동반. 기본 advisory인 이유: 도입 시점엔 대부분의 FR이 `[검증]`을 갖고 있지 않아(킷 자기적용 283건) hard면 첫 동기화에서 멈춘다 |
| 2026-08-09 | 공유 문법 2종 — `bodyBeforeOwnership`(Ownership 선언 앞 본문 경계) 신설 + 접두어→정규식 alt 파생을 `altOf` 하나로 통합. `verificationRun*` knob 4종 추가 | R13(구현 중복)이 실측으로 잡은 복제: ① Ownership 경계 정규식이 `check-spec-consistency`와 `gen-ownership-map`에 각각 있었다 — 두 판정이 "키가 자기 선언으로 근거를 얻는 것을 막는" **같은 경계**를 봐야 하는데 한쪽만 고치면 갈라진다. ② spec ID와 요구 ID의 정규식 안전화가 같은 함수 안에서 두 번 복제돼 있었다. 공유 문법의 정본은 이 스펙이 갖는다는 원칙(감사 F8과 같은 계열)을 두 건에 적용 [검증: tooling/__tests__/verdict-contract.test.mjs] |
| 2026-08-09 | 파일 순회·스펙 목록의 정본 신설 — `walkFiles`·`specMdFiles` | R13 **확률적 층**이 잡은 구조 중복: `walkAll`이 4개 게이트에, `walk`이 4개에, `specFiles`가 3개에 **본문 동일**로 복붙돼 있었다(리터럴 층은 정규식만 보므로 이 계열을 원리적으로 못 본다). ⚠ Python판은 처음부터 `walk_files`·`spec_md_files` 공유 함수를 갖고 있었으므로 이것은 런타임 간 **구조 비대칭**이기도 했다 — 한쪽만 고치면 순회 규칙이 갈라진다. 재배선 후 5개 게이트 출력이 바이트 동일함을 실측 확인(순수 리팩터) |
| 2026-08-09 | config knob 4종 추가 — `liveRealityCoveragePolicy`·`deployArtifactMarkers`·`deployEvidencePatterns`·`deployMarkers` | SPEC-032 등록 축·SPEC-031 증거 등급 동반. ⚠ `deployArtifactMarkers`는 **두 게이트가 공유하는 단일 선언**이다(등록 축의 "무엇이 배포 산출물인가"와 증거 등급의 "이 스펙이 배포 산출물을 소유하는가"는 같은 사실이다) — 같은 사실에 목록이 둘이면 한쪽만 갱신돼 두 게이트가 다른 답을 낸다. 그리고 조용한 기본값을 두지 않는다(SPEC-040 ②): 무엇이 배포 산출물인지는 프로젝트 어휘이므로 킷 기본값을 깔면 어긋난 순간 0건이 나오고 그 0은 진짜 0과 구분되지 않는다 — 미선언은 게이트가 inert로 자백한다 |
| 2026-08-10 | `check-outcome` entity 등록 — 판정 코어가 게이트에 돌려주는 **반환 형태**로서의 3분류(SPEC-054) | 게이트 층의 판정 종류(SPEC-040)와 **다른 층**이라 별 entity로 등록했다: 040의 선언은 코어 반환값의 **해석**이므로, 코어에 "못 봤다"의 통로가 없으면 게이트는 그 사실을 알 방법이 없고 빈 결과를 clean으로 읽는다 — **판정이 사라지는 자리는 코어와 게이트의 경계다.** 두 사실을 한 entity로 묶으면 그 경계가 이름을 잃고, 이름이 없는 경계는 다음 라운드에 다시 새어나간다 |
| 2026-08-10 | `capabilityVerbs`에 `audit`·`expose`·`classify` 등록 | 세 verb가 미등록이라 소유 게이트가 매 실행 ⚠로 표면화하고 있었다(SPEC-052·053·054의 capability). **표면화된 채로 남겨두면 그 경고가 배경 소음이 되고, 배경 소음이 된 경고는 다음 진짜 결함을 가린다** — 해소는 verb를 등록하는 것이지 검사를 좁히는 것이 아니다 |
| 2026-08-10 | `completionSignalPolicy` knob + `completion-signal` entity 등록 | 완료 판정이 **무엇을 관측했는가**는 증거 자산의 등급(SPEC-031)과 직교하는 층이다 — 브라우저 등급 자산이라도 그 실행 로그를 읽어 완료를 말하면 파생 신호다. 두 사실을 한 entity로 묶으면 그 조합(이 사고의 형태)이 표현되지 않는다 |
