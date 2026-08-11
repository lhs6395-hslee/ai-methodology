# Feature Specification: Multi-Runtime Gate Parity

**Module**: `sdd-tooling`  **Spec**: `SPEC-006`  **Created**: 2026-07-05  **Status**: Active
**Input**: 비-Node 런타임(Python `sdd_gates.py`·셸 `sdd_gates.sh`·Go `go-gate`)과 preset 템플릿이 Node 정본과 같은 문법·같은 판정으로 동작하도록 강제한다 — 런타임 간·경로 간 동작 차이는 "조용히 빠지는" 클래스를 만들므로 그 자체를 게이트 대상으로 삼는다.

---

## User Scenarios & Testing

### User Story 1 — 어떤 런타임을 골라도 같은 판정 (P1)
채택 프로젝트는 자기 스택에 맞춰 게이트 런타임을 하나 고른다(Node/Python/셸/Go). 어느 쪽을 골라도 같은 `sdd.config.json`으로 같은 판정이 나와야 한다. Python판 `sdd_gates.py`는 Node 게이트 스위트 전체(fr·ownership·cohesion·completeness·consistency·adequacy·orphan·converge·specsync·run)와 동작 패리티를 가진다. 셸판 `sdd_gates.sh`·Go판 `go-gate`는 핵심 3커맨드(fr·ownership·run)를 같은 ID 문법·같은 기본값으로 제공한다.
- **Independent Test**: `sdd-gates-py.test.mjs`가 같은 픽스처를 Node·Python 양쪽에 넣어 exit code와 출력 동일성을 검증. `sdd-gates-sh.test.mjs`가 셸판의 문법 동일성을 검증.
- **Acceptance (GWT)**: 1. **Given** the same fixture repo, **When** the Node gate and the Python gate evaluate it, **Then** both produce identical exit codes and identical report output.

### User Story 2 — 문법은 config 한 곳에서 파생 (P1)
spec ID 접두어(`specIdPrefixes`)와 요구 ID 접두어(`requirementIdPrefixes`)는 config에서 한 번 선언되고, 모든 런타임의 모든 파싱 사이트(선언 추출·집계·면제·`@covers`·spec-sync 라인 판정)가 그 파생 문법을 쓴다. 사이트 하나가 하드코딩으로 남으면 절단 태그·조용한 누락이 재발한다(도그푸딩 회귀의 뿌리).
- **Independent Test**: `check-req-prefix.test.mjs`(Node 사이트)·`sdd-gates-py.test.mjs`(Python)·`sdd-gates-sh.test.mjs`(셸)·`runtime-contract.test.mjs`(Go 소스 계약·DEFAULTS 정렬)가 사이트 누락을 회귀로 잡는다.
- **Acceptance (GWT)**: 1. **Given** a config with an extended requirement prefix, **When** any runtime parses a declaration or tag using that prefix, **Then** it is recognized identically at every parsing site.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- 요구 ID의 레터 서픽스는 소문자 1자만 — 2자 서픽스나 서픽스+숫자 등 비문법 토큰은 어느 런타임에서도 부분(절단) 캡처 없이 통째로 불인정한다.
- 셸판은 ERE에 워드 경계가 없어 "과포집 후 정확형 필터" 2단계로 경계를 재현한다(비문법 태그의 절단 캡처 금지).
- 런타임별 DEFAULTS(specIdPrefixes 등)가 Node와 다르면 config 없는 프로젝트에서 판정이 갈라진다 — 기본값 자체도 패리티 대상이다.
- preset 경로(`.specify` ears-preset)로 작성된 spec이 정식 템플릿의 게이트 파싱 앵커를 결여하면 spec-first 강제에서 조용히 빠진다 — 템플릿 간 앵커 패리티도 게이트 대상이다.
- **경로를 git에게 물을 때 인용을 끄지 않으면 판정이 양방향으로 틀린다** — `git diff --name-only`는 비ASCII 경로를 8진수 문자열로 인용해서 낸다. 그 문자열은 어떤 소유 글롭·문서 목록과도 매치하지 않으므로 **소유 귀속이 조용히 사라지고**(위반→통과) 동시에 **자기 갱신을 놓친 것으로 오판한다**(통과→위반). 실측: 소개 문서 게이트가 자기 문서를 고친 커밋을 "문서 그대로"라고 차단했다.
- **인용 계약의 열거기는 프로세스 기동만 본다** — 래퍼 호출부는 기동이 아니고 오류 문구 속 `git diff(...)`는 산문이다. 첫 판이 산문 2줄과 래퍼 호출 3줄을 위반으로 잡았고, 오탐이 잦은 게이트는 꺼진다.
- **선언되지 않은 대응은 대조되지 않는다** — 어느 게이트가 어느 서브커맨드에 대응하는지가 어디에도 없으면 미러 누락은 **사람이 손으로 대조할 때만** 발견된다. 실측: 그 대조를 기계화한 첫 실행이 즉시 2건을 냈다(R12·R13이 여러 라운드 동안 Node 전용이었고 Python 프로젝트에서 그 두 축은 아무도 보지 않는 상태였다).
- **양판 대상이 아닌 항목은 사유를 적는다** — 빈 값은 "판정 게이트가 아니다"와 "잊었다"를 구분하지 못하고, 구분되지 않는 빈칸은 항상 후자를 숨긴다.
- **선언은 양방향으로 본다** — 스윕에서 사라진 게이트가 선언에 남아 있으면 그 줄은 죽은 선언이고, 죽은 줄이 쌓이면 선언 전체를 아무도 믿지 않는다.

- **재검토 조건은 방아쇠를 빠뜨릴 수 있다** — "Python 미러 없음(의도)" 결정의 조건은 "스윕 규칙으로 승격되면" 하나였는데, 실제로 터진 것은 **차단 강도 획득**이었다. 조건을 적을 때 상상한 경로만 적으면 다른 경로로 온 위험은 조건을 통과한다 — 위험이 실현되면 조건 자체를 고친다(결정을 몰래 뒤집는 것이 아니라 **조건을 갱신하고 그 처방을 이행한다**).
- **미러에는 호출부가 있어야 한다** — 원래 결정의 근거가 "미러가 있어도 호출부가 없다"였다. 훅 쉘이 런타임을 고르지 않으면 복제한 판정은 **죽은 코드**이고, 죽은 코드는 커버리지 숫자만 올린다.
---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (ubiquitous): THE **sdd_gates.py** (S) runtime SHALL provide behavior parity with the full Node gate suite — coverage with prefix governance, ownership with key normalization and format validation, cohesion, completeness, consistency, adequacy, orphan surfaces, converge drift, spec-sync, and the stage runner — reading the same `sdd.config.json`. — capability: **runtime-parity.mirror** (C).
- **FR-002** (event): WHEN any runtime parses requirement IDs at any site (declaration, aggregation, exemption, covers tag, spec-sync line judgment), THE SYSTEM SHALL derive the grammar from `requirementIdPrefixes` (three digits plus an optional single lowercase-letter suffix, boundary enforced) so that no site keeps a hardcoded prefix.
- **FR-003** (event): WHEN the same fixture is evaluated by the Node gate and the Python gate, THE **runtime-parity** (E) contract SHALL require an identical exit code and identical report output.
- **FR-004** (ubiquitous): THE **sdd_gates.sh** (S) and **go-gate** (S) runtimes SHALL keep their core commands (coverage with prefix governance, ownership, runner) on the same ID grammar and the same defaults as the Node canonical DEFAULTS.
- **FR-005** (unwanted): IF the ears-preset spec template omits any gate-parsed anchor present in the canonical module-spec template (an ownership category line including Files, the Dependencies section, Edge Cases, or Change Log), THEN THE SYSTEM SHALL fail the template-parity test so preset-path specs are never silently exempt from spec-first enforcement.
- **FR-006** (event): WHEN any runtime spawns git to read repository paths, THE SYSTEM SHALL disable git's path quoting so that a non-ASCII path is never returned as an escaped literal, and the runtime source contract SHALL enumerate every git process spawn across every runtime source to prove that no call site is missing, because a norm recorded only in prose left eight sites unnormalized.
- **FR-007** (unwanted): IF a gate registered in the sweep does not declare which runtime subcommand mirrors it, or declares one that the dispatch does not implement, or is excluded from mirroring without a stated reason, THEN the runtime source contract SHALL fail naming that gate, because an undeclared correspondence is never compared and a blank exclusion cannot be told apart from a forgotten one.

### Key Entities
- **runtime edition** — one of the four gate implementations (Node canonical, Python, shell, Go) sharing one config and one grammar.
- **parsing site** — any code location that recognizes a spec ID or requirement ID; the unit at which grammar drift causes silent loss.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: runtime-parity
- **Symbols**: sdd_gates.py, sdd_gates.sh, go-gate
- **Artifacts**: —
- **Capabilities**: runtime-parity.mirror
- **Files**: tooling/sdd_gates.py, tooling/sdd_gates.sh, tooling/go-gate/main.go, tooling/ears-preset/templates/spec-template.md, tooling/__tests__/sdd-gates-py.test.mjs, tooling/__tests__/sdd-gates-sh.test.mjs, tooling/__tests__/runtime-contract.test.mjs, tooling/__tests__/template-parity.test.mjs

## Dependencies (참조 — dedup 제외)
> 판정 알고리즘의 정본은 Node판이 소유한다 — 이 spec은 그 동작의 "복제 충실도"만 소유.
- **Modules**: key-pipeline (references), spec-quality-gates (references), spec-sync (references)

---

## Success Criteria (측정형)
- **SC-001**: 같은 픽스처에 대한 Node↔Python 게이트 판정 불일치 0건(패리티 테스트 green). [검증: tooling/__tests__/sdd-gates-py.test.mjs, tooling/__tests__/sdd-gates-sh.test.mjs, tooling/__tests__/runtime-contract.test.mjs]
- **SC-002**: 하드코딩 요구 접두어가 남은 파싱 사이트 0곳(전 런타임 회귀 테스트가 검출). [검증: tooling/__tests__/sdd-gates-py.test.mjs, tooling/__tests__/sdd-gates-sh.test.mjs, tooling/__tests__/runtime-contract.test.mjs]
- **SC-003**: 경로 인용을 끄지 않은 git 기동 0곳 — 두 런타임 소스를 전수 열거해 검산한다(도입 시 8곳 검출). [검증: tooling/__tests__/runtime-contract.test.mjs]
- **SC-004**: 스윕 등재 게이트 전부가 런타임 서브커맨드 대응을 선언하고 그 서브커맨드가 디스패치에 실재한다 — 미선언·미구현·사유 없는 제외 각 0건(도입 시 미구현 2건 검출: R12 훅 배선·R13 구현 중복). [검증: tooling/__tests__/runtime-contract.test.mjs]

## Non-Functional Requirements
- **NFR-001**: Python판은 표준 라이브러리만 사용(3.7+), 셸판은 POSIX `sh`+`grep`+`awk`+`jq`만 사용 — 추가 의존 도입 금지. [검증: tooling/__tests__/sdd-gates-py.test.mjs, tooling/__tests__/sdd-gates-sh.test.mjs, tooling/__tests__/runtime-contract.test.mjs]

## Assumptions / Clarifications Retained
- Go판은 로컬 툴체인이 없어도 소스 계약 테스트로 문법 회귀를 잡는다 — 실행 패리티 재검증은 Go 툴체인이 있는 CI에서 수행(REALITY_CHECK.md 갱신 대상).
- 셸/Go판의 ownership 키 정규화·형식검증(normalizeKey/validateKey)은 미포팅 상태다 — 소비 트리거 성립 시 승격(문서에 델타 명시, 조용한 패리티 주장 금지).

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-05 | 세션 리뷰(수명주기 도입 — 패리티 테스트 포함 전 테스트 green 확인) | PASS |

## Dedup-Review
- 2026-07-05 이웃 SPEC-001·SPEC-002·SPEC-003(판정 정본 소유 spec들): 비중복 — 이 spec은 복제 충실도만 소유.
- 2026-07-05 이웃 SPEC-007(verification-accounting)·SPEC-008(spec-lifecycle): 비중복 — 회계·수명주기 판정의 Python 미러 충실도만 이 spec 범위.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 진단 가드의 Python 미러(`parse_diagnosis_map`·`validate_diagnosis_map`·`is_spec_read`·`judge_command`·`format_guidance` + `cmd_diagnosisguard`) + DEFAULTS 4키 + `arm_verdict`의 훅 계층 좁힘 조건, 패리티 **훅·스윕 2모드**(8 시나리오 × 명령 4종) | SPEC-053은 exit 2를 내는 판정 게이트라 양판 필수다. 두 모드를 함께 대조한 이유: 훅 모드만 맞추면 스윕 판정이 갈라지고, 스윕만 맞추면 소비처의 실제 차단이 갈라진다. 미러 작성 중 **판정 줄 방출이 갈렸다** — Python은 단일 엔트리라 `arm_verdict()`를 무조건 부르는데 Node는 게이트별로 부르므로, 훅 계층 침묵을 같은 조건(`--hook`)으로 맞춰야 바이트 동일이 성립했다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | 명세 모순 감사의 Python 미러(`line_directives`·`predicate_tokens`·`collect_directives`·`doc_frequency`·`spec_conflicts`·`format_conflict` + `cmd_specconflict`) + DEFAULTS 6키, 패리티 10시나리오 | SPEC-052는 exit 1을 내는 판정 게이트라 양판 필수다. 미러 작성 중 헬퍼 이름 3건이 Node판과 달라(`resolve_from_root`→`resolve`, `is_fr_decl_line`→`_is_fr_decl_line`, `__specIdRe`→`__specId`) 즉시 크래시했다 — 양판이 같은 이름을 쓰지 않는다는 사실이 미러 작업의 상시 함정이고, 그래서 패리티 테스트가 **출력 대조**로 고정한다(이름이 달라도 답은 같아야 한다) [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | 면제 래칫의 Python 미러(`exemption_knobs`·`exemption_entries`·`exemption_findings`·`classify_exemption_ratchet` + `cmd_ratchet` 배선) + DEFAULTS 2키 | 래칫은 exit 1을 내는 판정 게이트라 양판 필수다. 한쪽에만 있으면 Python 사이트에서 면제가 다시 조용히 자란다 — 이 축이 막으려는 것이 정확히 그 상태다. 킷 config로 양판 출력 바이트 동일 확인 [검증: tooling/__tests__/policy-ratchet.test.mjs] |
| 2026-08-10 | 에이전트 배선 축의 Python 미러(`parse_agent_hook_decl`·`wired_hooks`·`missing_matcher_tokens`·`command_names_script`·`agent_wiring_findings`·`build_hook_settings`·`merge_hook_settings`·`cmd_agentwiring`) + DEFAULTS 4키 + 패리티 스위트 9시나리오 × **판정·생성 2모드** | SPEC-051은 exit 1을 내는 판정 게이트라 양판 필수다. 생성 모드까지 대조하는 이유: 설치기가 어느 런타임에서 돌든 **같은 배선**이 나와야 하고, 갈라지면 한쪽 런타임 프로젝트만 조용히 미배선된다 — 이 라운드가 고친 결함이 정확히 그 계열이다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | 배선 무결성 축의 Python 미러(`local_imports`·`module_exports`·`wiring_findings`·`cmd_importwiring`) + DEFAULTS 2키 + 패리티 스위트 8시나리오(export 없음·파일 없음·확인 못 함·통과·advisory·off·inert·값 위반) | SPEC-050은 exit 1을 내는 **판정** 게이트라 양판 필수다 — 한쪽 런타임에만 있는 축은 축이 아니다. 이 게이트는 **자기 디렉터리**를 판정 대상으로 삼으므로 패리티 픽스처가 두 런타임을 같은 `scripts/`에 나란히 깔고 그 안에 구판 lib을 심는다(정본 디렉터리를 보게 하면 두 판이 똑같이 "킷은 깨끗하다"를 내어 대조가 아무것도 증명하지 않는다). 픽스처 복사 목록은 폐포에서 계산한다 — 손 목록이 이번에도 `ownership-keys.mjs`를 빠뜨려 이 라운드가 고치는 드리프트를 재연했다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 실행 관측 회계 코어 6종 + `verifyrun` 회계 축·`--record-branch` 기록 모드, 자산 파서의 종류 판별 반영 | 판정 게이트는 양판 필수. ⚠ 이 라운드에서도 Python 치환이 이스케이프 때문에 조용히 안 먹은 자리가 있었고 패리티 테스트가 잡았다(`prose` 정규식) — 미러는 눈으로 확인하지 않고 테스트로 확인한다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 감시자 코어 3종 + `cmd_watchdog`, 패리티 테스트 8시나리오. **파서 예외 문구를 판정 문장에서 제거**(양판 공통) | 판정 게이트는 양판 필수. ⚠ 패리티 테스트가 실제 결함을 잡았다: JSON 파싱 실패 메시지에 파서 예외를 넣었더니 Node(`Unexpected token`)와 Python(`Expecting value: line 1 column 1`)이 갈렸다 — 같은 사실을 두 판이 다르게 말하는 것은 이 spec의 불변 위반이다. 예외 문구를 빼고 사실만 말하도록 고쳤다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 순차 프로세스 SSOT 코어 6종 + `cmd_processssot` + 하드코딩 제거 knob 4종 반영, 패리티 테스트 8시나리오 | 판정 게이트는 양판 필수. 미선언 inert·SSOT 부재·빠진 단계·조각 보유·저장소 미선언/미소유·통과·config 문법·off 각 갈래를 바이트 동일로 고정. ⚠ 이 라운드에서 Python 치환이 이스케이프 때문에 **조용히 안 먹은** 사례가 있었고 패리티 테스트가 그것을 잡았다 — 미러는 눈으로 확인하지 않고 테스트로 확인한다 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 증거 등급 method 인정(`DEFAULT_BROWSER_GRADE_METHODS`·`DEFAULT_DEPLOY_GRADE_METHODS` + `evidence_findings` 인자 2종) | 판정 게이트는 양판 필수. evidence·ownership·sccoverage 세 게이트 출력이 바이트 동일함을 확인 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 지목 구현체 참조 코어(`named_implementations`·`reference_count`·`impl_reference_findings`·`REFERENCE_BAR`) + `fr` 게이트 R1e 배선, 패리티 테스트 6시나리오 | 판정 게이트는 양판 필수 — 한쪽에만 있으면 Python 사이트에서 R1e가 조용히 사라진다. 고아·전무·통과·커버 미언급·hard 차단·off 각 갈래를 바이트 동일로 고정 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 소개 문서 동기 코어(`rule_ids_of`·`missing_rule_ids`·`cited_counts`·`count_mismatches`·`companion_missing`) + `cmd_introdoc` + `is_spec_md_name` 정본화, 패리티 테스트 7시나리오 | 판정 게이트는 양판 필수 — 한쪽에만 있으면 Python 사이트에서 R15가 조용히 사라진다. 미선언 inert·규칙 누락(hard/advisory)·인용 불일치·미지원 키·문서 부재·규칙표 부재·off 각 갈래를 바이트 동일로 고정 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-08-10 | Python 미러 — 의미 커버리지·결정 입도·근거 적용범위 코어 3종 + `change_log_dated_rows` 정본화 + `fr`·`completeness` 게이트 배선, 패리티 테스트 2종(시나리오 10개) | 판정 게이트는 양판 필수(SPEC-006 불변) — 한쪽에만 있으면 Python 사이트에서 그 축이 조용히 사라진다. 실측 선례: 리터럴 실재 축이 Node 전용이라 SPEC-013 SC-001이 거짓 충족돼 있었다. 용어집 미선언·미실증·동의어 해소·미공개 외부 대상·hard 승격·범위 표기 각 갈래를 바이트 동일로 고정 [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
| 2026-07-05 | 초안 — Python 전 게이트 패리티·requirementIdPrefixes 전 사이트 일반화·셸/Go 문법 정렬·preset 템플릿 앵커 패리티 | 진단 A-1/A-2/B-1/B-2: 런타임 간·경로 간 문법 불일치가 "조용히 빠지는" 클래스를 만듦 — 문법화(정의되지 않은 예외 제거) |
| 2026-07-05 | Python fr 게이트에 검증 회계(strictSpecs·requireAccounting·smokeManifest) 미러 + DEFAULTS 5키 정렬 + 회계 바이트 패리티 테스트 | SPEC-007 신설 동반 — 셸/Go fr에는 회계 계층 없음(핵심 3커맨드 계약 밖, 정직한 델타) |
| 2026-07-05 | Python completeness·specsync에 수명주기(Status·리뷰 기록·Draft 차단) 미러 + 바이트 패리티 테스트 + 템플릿 수명주기 앵커(Review Log·Dedup-Review·Status enum) 패리티 편입 | SPEC-008 신설 동반 — preset 경로 스펙이 수명주기 문법을 결여한 채 조용히 빠지는 것 방지 |
| 2026-07-05 | Python specsync에 `specSyncUnownedPolicy` 미러(silent/warn/error + 미정의 값 거부) + 패리티 테스트 | SPEC-003 FR-010 신설 동반(P2) |
| 2026-07-05 | Python `_git`에 `core.quotepath=off` 미러 | SPEC-003 quotepath 수정 동반 — 비ASCII 경로 판정 패리티 |
| 2026-07-05 | Python ownership에 `entityRegistry` 미러 + 바이트 패리티 테스트 | SPEC-002 FR-009 신설 동반(P3a) |
| 2026-07-05 | Python에 derivation·smokescan·retag 3커맨드 미러 + completeness 근거(선제 캡처) 검사 미러 + DEFAULTS 3키 정렬 + 출력·산출물 바이트 패리티 테스트 | SPEC-009~011 신설 동반 — 셸/Go fr·ownership에는 없음(핵심 3커맨드 계약 밖, 정직한 델타 — ci-examples 매트릭스 명시) |
| 2026-07-06 | Python에 접두어↔클래스 정합(fr 0b)·Files 카테고리 금지(ownership)·문법 규범(completeness)·글롭 staged 차단(specsync) 미러 + DEFAULTS `prefixClassExemptions` 정렬 + 바이트 패리티 테스트 4종 | SPEC-012·SPEC-013 신설 동반 — 셸/Go fr·ownership에는 없음(핵심 3커맨드 계약 밖, 정직한 델타 — ci-examples 매트릭스 명시) |
| 2026-07-06 | Python DEFAULTS의 `derivationClassGlobs` 기본값 보정 동기(iac 동반 파일·ci 구성요소 편입) — 값·순서 동일(runtime-contract ①이 강제) | SPEC-001 기본값 보정 동반 — 기본값 자체도 패리티 대상 |
| 2026-07-06 | Python에 `numbering_issues` 미러(fr 0c 배선) + 바이트 패리티 테스트 1종(INFRA-011 Node↔Python) | SPEC-014 신설 동반 — 번호 게이트도 런타임 중립 필수(셸/Go fr에는 없음 — 핵심 3커맨드 계약 밖, 정직한 델타) |
| 2026-07-06 | Python에 `object_storage_findings` 미러(completeness 배선) + DEFAULTS `objectStorageMarkers` 정렬 + 바이트 패리티 테스트 1종 | SPEC-016 신설 동반 — 오브젝트 스토리지 결정 게이트도 런타임 중립 필수(Node↔Python 동일 출력) |
| 2026-07-09 | Python specsync에 `draftBlockPolicy`(advisory\|hard) 미러 + DEFAULTS 정렬 + 패리티 테스트 1종 | SPEC-008 FR-007 신설 동반 — range 모드 Draft-block 승격도 런타임 중립 필수 |
| 2026-07-09 | Python ownership에 Entity 관계 검사(`parse_relation_entry`·`relation_type_finding`·`resolve_relations`·`find_cycles`) 미러 + DEFAULTS `relationTypes` 정렬 + 패리티 테스트 2종 | SPEC-017 신설 동반 — 관계 실재·순환 판정도 런타임 중립 필수 |
| 2026-07-06 | Python `object_storage_findings`에 감사 트레일 제외(`_before_audit_trail`) 동기 | SPEC-016 자기 서술 오탐 수정의 Node·Python 패리티 유지 |
| 2026-07-06 | Python STANDARD_PREFIXES·DEFAULTS.specIdPrefixes에 `CICD` + `prefix_class_finding`를 `CLASS_PREFIX{iac:INFRA,ci:CICD}`로 일반화(에러/warn 메시지 바이트 동일) + 패리티 테스트 1종(ci 전용 INFRA→CICD) | CICD 표준 접두어 신설 동반 — 접두어 거버넌스·prefix-class도 런타임 중립 필수 |
| 2026-07-06 | Python에 `parse_lifecycle`·`LIFECYCLE_ENUM` + completeness Lifecycle enum 검증 미러 + 패리티 테스트 1종 | SPEC-008 FR-006 동반 — Lifecycle 필드도 런타임 중립(Node↔Python 동일 출력) |
| 2026-07-06 | Python에 `test_infra_finding` + prefix_class TEST 면제 + fr 배선 미러 + 패리티 테스트 1종 | SPEC-015 신설 동반 — 테스트 인프라 격리·TEST 소유 허용도 런타임 중립 |
| 2026-07-06 | Python DEFAULTS에 `trackerCloseout {}` 동기 | 완료 루프 close-out knob의 DEFAULTS 런타임 패리티(runtime-contract 강제) — 게이트 소비는 없으나 기본값 자체가 패리티 대상 |
| 2026-07-15 | ears-preset 템플릿을 정식 `module-spec.md`와 바이트 재동기화(Lifecycle·FR 서픽스·relationTypes 안내 주석 3종) | doc-coverage 반영으로 정식 템플릿에 주석 추가 → FR-005 template-parity 유지 위해 preset 사본도 동일 갱신(게이트 동작 무변경) |
| 2026-07-15 | 셸(`sdd_gates.sh`)·Go(`go-gate/main.go`) `specIdPrefixes` 기본값·표준 접두어 집합·에러 문자열을 `SPEC/INFRA/TEST/CICD` 4종으로 통일 + `runtime-contract.test.mjs` 소스 계약 기대치를 4종으로 갱신 | CICD 절반 롤아웃 봉합 — Node·Python은 4종인데 셸/Go 기본값이 3종이라 config 없는 CICD 스펙이 런타임에 따라 통과/차단 갈리던 패리티 결함(감사 P1) 실증 후 정정(셸 CICD-001 통과 확인) |
| 2026-07-15 | Python(`sdd_gates.py`) PREFIX 위반 에러 문자열도 `표준 SPEC/INFRA/TEST/CICD`로 — 4판 에러 문자열 바이트 동일 완결 | 위 통일의 잔재 1곳(Python 에러 메시지만 3종) 정정 — Node·셸·Go와 바이트 동일 |
| 2026-07-15 | Python `cmd_cohesion` FR 카운터를 `__frToken` → `__frDecl`로 미러(Node cohesion 오탐 수정 동반) | cohesion FR 인용 오집계 수정의 런타임 패리티 — Node·Python 동일 판정 유지 |
| 2026-07-15 | Python STATUS_ENUM에 Planned·`classify_accounting`에 planned_specs·`cmd_fr` planned 수집·리포트 planned 세그먼트 미러(SPEC-018 FR-005 동반) | Planned 회계 런타임 패리티 — Node↔Python 회계 리포트 바이트 동일(`planned:N`) 확인 |
| 2026-07-16 | `numbering_issues`에 `retired_ids` 인자·DEFAULTS `retiredIds`·호출부 미러(SPEC-018 FR-006 동반) | numbering retirement-gap 런타임 패리티 — Node↔Python fr 리포트 바이트 동일 확인 |
| 2026-07-16 | Python spec-sync 메시지를 중립-우선 문구로 미러(SPEC-003 동반) — `node scripts/sdd-sync.mjs`/Change Log 안내, Claude 슬래시는 괄호 | 강제 메시지의 Node↔Python 바이트 동일 유지 — 중립화도 두 판이 함께 움직여야 패리티 불변 |
| 2026-07-16 | Python에 `escalations`·`semanticDriftPolicy` DEFAULTS·리네임 수집·drift 배선 미러(SPEC-019 동반) — spec-sync drift 출력 Node↔Python 바이트 동일(패리티 테스트 green) | semantic drift 런타임 패리티 — 리네임 승격 판정·리포트가 두 런타임에서 동일 |
| 2026-07-16 | Python에 `parse_drivers`·`cross_spec_relaxed`·`__idAlt` cfg·cross-spec 배선 미러(SPEC-020 동반) — spec-sync cross-spec 출력 Node↔Python 바이트 동일 | cross-spec 런타임 패리티 — Change-Driver 파싱·참조 완화가 두 런타임에서 동일 |
| 2026-07-16 | Python에 `test_run_verdict`·`cmd_testrun`·`testrun` 서브커맨드·`runTestsPolicy` DEFAULTS 미러(SPEC-021 동반) + 패리티 테스트 1종 — testrun 출력 Node↔Python 바이트 동일 | 테스트 실행 게이트 런타임 패리티 — FinOps가 Python 게이트로 도니 실행-결과 확인도 두 런타임 동일 |
| 2026-07-16 | Python에 `schema_drift_verdict`·`cmd_schemadrift`·`schemadrift` 서브커맨드·DEFAULTS 미러(SPEC-022 동반) + 패리티 테스트 1종 — schemadrift 출력 Node↔Python 바이트 동일 | R2′ 스키마 드리프트 게이트 런타임 패리티 — 배포 preflight가 두 런타임에서 동일 |
| 2026-07-16 | `ears-preset/templates/spec-template.md`를 `templates/module-spec.md`와 재동기(retrofit→Reviewed 안내 주석 반영, template-parity 유지) | retrofit 안내 추가(도그푸딩)가 두 템플릿 사본에 동일하게 들어가야 파리티 테스트 green |
| 2026-07-16 | 감사 6차 Python 미러 일괄 — config_from_string(HEAD-config 판정)·can_lead_code(상태 화이트리스트)·트레일러 스코프 축소·parse_drivers @glob·relaxing_drivers·specSyncBase 체인·numbering 재사용/001-면제·Planned 모순, Node판과 동일 동작(패리티 테스트 green) | SPEC-003/008/014/018/020 감사 봉합 동반 — 전 게이트 패리티 유지(SPEC-006 소유는 복제 충실도) |
| 2026-07-17 | Python 미러 — `_strip_code_spans`·`_extract_anchors`·`_build_key_set`·`_anchor_findings` + cmd_consistency 배선 + DEFAULTS frKeyAnchorPolicy, Node와 출력 바이트 동일(패리티 테스트) | SPEC-023 동반 — 전 게이트 패리티 유지 |
| 2026-07-20 | Python 미러 — `capability_check_active`·`capability_ownership_findings` + cmd_ownership 배선 + DEFAULTS capabilityOwnershipPolicy, Node와 출력 바이트 동일(패리티 테스트) | SPEC-024 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — `schema_backing_active`·`extract_schema_entities`·`schema_backing_findings` + cmd_ownership 배선(글롭 수집·추출·면제 검증) + `_extract_anchors_with_markers`·`_build_entity_key_set`·`_entity_marker_findings` + cmd_consistency (E) 마커 배선 + DEFAULTS 3종, Node와 출력 바이트 동일(패리티 확인) | SPEC-026·023 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — `validate_schema_patterns` + `extract_schema_entities` 크래시 방지(re.error skip) + cmd_ownership 배선, 잘못된 정규식 에러 문구 Node와 바이트 동일(엔진 메시지 미포함) | SPEC-026 하드닝 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — cmd_ownership 면제 부채 표면화(sb_exempt_used) 배선, Node와 출력 바이트 동일 | SPEC-026 FR-005 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — `_build_key_kind_map`·`_category_marker_findings` + `_extract_anchors_with_markers` 마커 글자 캡처 + cmd_consistency 카테고리 마커 배선 + DEFAULTS `frAnchorMarkers`, Node와 출력 바이트 동일 | SPEC-023 FR-005 일반화 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — `_extract_code_spans`·`_backtick_key_findings` + cmd_consistency FR-006 배선, Node와 출력 바이트 동일 | SPEC-023 FR-006 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — `_unanchored_owned_key_findings` + cmd_consistency FR-007 배선, Node와 출력 바이트 동일 | SPEC-023 FR-007 동반 — 전 게이트 패리티 유지 |
| 2026-07-21 | Python 미러 — `POLICY_RANK`·`RATCHETED_POLICIES`·`classify_ratchet`·`cmd_ratchet` + DEFAULTS에 `policyRatchetPolicy`/`policyRatchetExceptions`, `ratchet` 서브커맨드. Node `check-policy-ratchet.mjs`와 출력·exit 바이트 동일 | SPEC-027 동반 — 정책 래칫 게이트의 양판 패리티 유지 |
| 2026-07-27 | Python 미러 — `frAnchorMarkers` DEFAULTS·cmd_consistency fallback의 surface 글자 `"R"`→`"S"`, Node와 출력 바이트 동일 | SPEC-023 Change Log 동반 — 마커 기본값 변경의 양판 패리티 유지 |
| 2026-07-27 | Python 미러 — `RATCHETED_POLICIES` 자기포함(`policyRatchetPolicy` 선두) + `effective_ratchet_policy` + `cmd_ratchet`이 base config를 off 단락보다 먼저 조회(자기약화 고지 포함), Node와 출력·exit 바이트 동일 | SPEC-027 FR-007 동반 — 양판 패리티 유지(감사 이슈 #21 A-2) |
| 2026-07-27 | Python 미러 — `capability_inert_reasons`·`schema_backing_inert_reasons` + cmd_ownership의 inert 고지·hard 차단 배선, Node와 출력·exit 바이트 동일 | SPEC-024 FR-005·SPEC-026 FR-006·SPEC-002 FR-010 동반 — 양판 패리티 유지(감사 이슈 #21 A-1/A-3) |
| 2026-07-27 | Python 미러 — `exempt_glob_findings` + cmd_ownership 배선, Node와 출력·exit 바이트 동일 | SPEC-013 FR-007 동반 — 전 게이트 패리티 유지 |
| 2026-07-27 | Python 미러 — `resolve_category_roles` + `cfg["__roles"]` 파생, capability/스키마백킹/키종류맵 호출부 역할 기반 전환. Node와 출력 바이트 동일 | SPEC-001 FR-010 동반 — 전 게이트 패리티 유지 |
| 2026-07-27 | FR-001·003·004 주어를 `THE SYSTEM`에서 실제 런타임/계약으로 교체 — **sdd_gates.py**·**sdd_gates.sh**·**go-gate**·aggregate **runtime-parity** FR 앵커 | SPEC-023 FR-007(소유 키 앵커) 자기적용: SPEC-001 FR-010의 `ownershipCategoryRoles` 선언으로 규칙이 킷 자신에게 발화(감사 #21) — 소유 키 4건이 FR 선언 라인에 흔적이 없던 것을 명시(판정 범위·패리티 요구는 불변) |
| 2026-07-27 | preset spec-template 재동기(정식 templates/module-spec.md와 바이트 동일) — FR 번호 규범 주석 반영 | FR-005(템플릿 패리티) 동반: 규범 주석이 preset 경로에만 없으면 preset으로 쓴 스펙이 규범을 못 본다 |
| 2026-07-27 | Python 미러 — `group_numbers`(순수 원형)·`fr_numbering_issues` + cmd_fr 1b 배선, Node와 출력·exit 바이트 동일 | SPEC-014 FR-005/006 동반 — 전 게이트 패리티 유지 |
| 2026-07-27 | Python 미러 — `parse_section` 전 불릿·연속 줄, `split_keys`·`is_placeholder` 신설, `normalize_key` NFC(`unicodedata`). Node와 출력 바이트 동일 | SPEC-001 FR-001/003 개정 동반 — dedup 입력 신뢰성 봉합의 양판 패리티 |
| 2026-07-28 | Python 미러 — `fr_declarations` 신설(FR 섹션 안 라인 시작 선언 범위) + `cmd_fr`·`cmd_cohesion`·`_collect_specs` 3소비처 배선. 패리티 결함 1건 봉합: R2 missing 목록이 Python만 정렬돼 Node와 갈렸다(Node에 정렬 추가) | SPEC-013 FR-008 동반. 정렬 결함은 킷 스펙이 전부 번호 순 선언이라 자기적용에서 0건 발현, 소비 프로젝트 PM(SPEC-004·SPEC-010 두 줄)에서만 실측 — 양판 바이트 동일을 4코퍼스(킷·PM·PM 수정전·finops) × default/`--strict`로 재확인 |
| 2026-07-28 | Python 미러 — `fr_lines_missing_shall`의 라인 규율을 `_is_fr_decl_line`(불릿 옵션)으로 통일 + `req_alt` 인자 신설, `cmd_completeness` 호출부에 `cfg["__reqAlt"]` 주입. 양판 바이트 동일(픽스처 + 킷 실제 29스펙 전수 diff 0). 완전성 게이트 런타임 패리티 회귀 테스트 1건 신설(비불릿·다중 접두어 한 픽스처) | SPEC-013 FR-003 동반. 두 런타임이 **똑같이** 비불릿 선언을 건너뛰던 거짓 음성이라 패리티 검사로는 잡히지 않았다 — 양판이 나란히 틀리면 패리티 green이 정확성의 증거가 아니라는 사례(정렬 결함이 한쪽만 틀려 잡혔던 것과 대조) |
| 2026-07-28 | Python 미러 구조 정렬 — `fr_declarations`의 인라인 `decl_line` 정규식을 `_is_fr_decl_line(line, req_alt)` 호출로 치환(바이트 동일 패턴의 마지막 Python 사본 제거). 438 테스트 green, completeness·fr·cohesion 3게이트 Node↔Python stdout 바이트 동일 | Node `frDeclarations`는 이미 `isFrDeclLine`을 재사용 중이라 양판 구조 비대칭이었다 — 동작 변화 없는 드리프트 위험 봉합. 같은 라인 문법의 사본 둘이 갈려 진짜 결함을 흘린 전례가 SPEC-013 FR-003(c6bc432)이므로 사본을 남기지 않는다 |
| 2026-07-28 | Python 미러 — `cmd_testrun`이 러너 stdout을 부모 stderr로 리다이렉트(`stdout=sys.stderr`), 판정 줄만 stdout. 실측 대조: 러너가 `⚠`를 내도 Node·Python 양판 stdout이 판정 한 줄로 바이트 동일 | SPEC-021 FR-002 동반(감사 #21 M-8) — 게이트 stdout이 판정의 정본이라는 하네스 계약을 양판 모두 지켜야 한다. 한쪽만 고치면 `--gate=py` 프로젝트에서 green이 계속 ⚠로 읽힌다 |
| 2026-07-28 | Python 포트에 두 문법 미러 — `spec_slug`·`spec_slug_source_declared`·`symbol_reality_*`·`is_file_like_surface` 추가, `schema_backing_findings`에 `slug_by_spec` 파라미터, `cmd_ownership`에 심볼 실재 판정 배선 | SPEC-029 도입에 따른 패리티 유지(SPEC-006 계약). 검증: `check-ownership` stdout·stderr·exit 바이트 동일 |
| 2026-07-28 | Python 포트 `_backtick_key_findings`에 entity 제외 미러 | SPEC-023 FR-006 축소에 따른 패리티 유지(SPEC-006 계약). consistency stdout 바이트 동일 확인 |
| 2026-07-28 | Python 포트에 관계 침묵 표면화 + cohesion 처방 문구 미러 | 패리티 유지(SPEC-006 계약) — ownership·cohesion stdout 바이트 동일 확인 |
| 2026-07-28 | Python 포트 `cmd_ownership`의 관계 이름에 `normalize_key` 미러 | 패리티 유지(SPEC-006 계약) — ownership stdout 바이트 동일 확인 |
| 2026-07-28 | Python 포트에 `symbol_candidates` 신설 + 실재 집합 3형태 미러 | 패리티 유지(SPEC-006 계약) — ownership stdout 바이트 동일 확인 |
| 2026-07-28 | Python 포트 `_bare_key` 신설 + `_build_key_kind_map` 배선 | SPEC-023 키 추출 교정의 패리티 유지 — consistency stdout 바이트 동일 확인 |
| 2026-07-29 | Python 미러 — `role_active`·`role_inert_reasons`·`reality_findings`·`split_event_key`·`event_attribution_findings` + `cmd_engineevent` + `engineevent` 서브커맨드 + DEFAULTS 6종 + `resolve_category_roles`에 engine/event. Node `check-engine-event.mjs`와 출력·exit 바이트 동일 | SPEC-030 동반 — Engines/Events 게이트 양판 패리티 유지 |
| 2026-07-29 | Python `cmd_ownership` 미러 — 구조 문법 3종(G1 ownershipRequired·G2 crossCategoryDedup·G3 filesOverlap) + DEFAULTS 3종. Node `check-ownership.mjs`와 출력·exit 바이트 동일 | SPEC-002 FR-011 동반 — 구조 문법 게이트 양판 패리티 유지 |
| 2026-07-30 | Python 미러 — `parse_evidence_tag`·`has_execution_verb`·`is_browser_grade_evidence`·`evidence_findings`+`cmd_evidence`(SPEC-031), `validate_checks`·`classify_result`·`summarize_live`+`cmd_livereality`(SPEC-032), DEFAULTS 8종, `evidence`·`livereality` 서브커맨드. Node 게이트와 출력·exit 바이트 동일 | SPEC-031·032 동반 — 새 축도 양판 패리티 유지(킷 hard·픽스처 위반/skipped 3분기 확인) |
| 2026-07-30 | Python 미러 — `singularize`·`canonical_form`·`lexical_collisions`·`validate_synonym_registry`·`declared_synonym_findings`·`parse_candidate_pairs`·`classify_candidates`·`validate_ledger` + `cmd_synonym` + `synonym` 서브커맨드 + DEFAULTS 6종. Node와 출력·exit 바이트 동일 | SPEC-033 동반 — 새 포획층도 양판 패리티 유지(확률적 비차단 계약 포함) |
| 2026-08-02 | Python DEFAULTS 미러 — `hooksInstalledPolicy`·`syncHookRules`·`syncHookDelegatedTo`·`outOfBandDeploy*`·`scCoverage*`·`e2e*` | Node DEFAULTS와 키·값 동일 회귀(패리티 테스트가 강제). 훅 검사·배포 가드는 훅 편의 계층이라 Node 전용(check-pre-edit 선례)이고, **판정 게이트**인 sc-coverage는 양판 바이트 동일 |
| 2026-08-02 | Python 미러 — `marker_hits`(ASCII 단어 경계 마커 대조)와 `SC_DECL_RE` 분류 접미 허용 | Node의 실측 교정 3건 중 판정 게이트에 해당하는 evidence·sc-coverage를 양판 바이트 동일로 유지(deploy-guard는 훅 편의 계층이라 Node 전용) |
| 2026-08-02 | Python 미러 — `evidence_findings`에 `manifest_of` 대조 인자 + SC·NFR 통합 수집 + DEFAULTS 2종(`supportLayerSpecs`·`outOfBandDeployDebtFile`) | SPEC-031 FR-007 동반. cohesion 등록부·배포 부채는 Node 전용 계층(각각 게이트 스크립트·훅 편의)이라 DEFAULTS 키만 미러한다 |
| 2026-08-02 | Python 미러 — `change_log_fr_refs`·`change_log_fr_findings` + `fr_numbering_issues(declared_nums)` 분기 + `cmd_fr` 배선 + DEFAULTS 4종 | SPEC-037 동반. 판정 게이트라 양판 바이트 동일이 필수 — 실측 사례 픽스처에서 Node↔Python 출력·exit 일치 확인 |
| 2026-08-02 | Python DEFAULTS·RATCHETED_POLICIES 미러 — `deployPreconditionPolicy`·`deploySmokeCommand`·`deploySmokeTimeoutMs` 추가 + 래칫 목록 21→24 동일화 | SPEC-035 FR-006·FR-007, SPEC-027 동반. 전제 조건·스모크 게이트는 훅 편의 계층이라 Node 전용이지만(check-pre-edit 선례), **래칫 목록은 판정 데이터**라 어긋나면 런타임에 따라 하향이 통과한다 — 목록 동일성을 패리티 테스트가 강제 |
| 2026-08-03 | Python 미러 없음(의도) — 배포 전제·승인·스모크 게이트는 훅 편의 계층이라 Node 전용(check-pre-edit 선례). DEFAULTS 키만 미러 | SPEC-035 FR-008 동반 판단 기록. **판정 게이트는 양판 필수**지만 이 셋은 PreToolUse/PostToolUse 훅에서만 발화하고 sdd-sync 규칙표에도 없다 — Python 런타임 프로젝트는 훅을 셸로 배선하므로 미러가 있어도 호출부가 없다. 재검토 조건: 이 축이 sdd-sync 규칙(R번호)으로 승격되면, **또는 차단 강도를 갖게 되면** 그때 양판으로 복제한다(2026-08-10 보강 — 조건이 방아쇠를 하나만 적어 두었고, 실제로 터진 것은 적히지 않은 쪽이었다: `check-pre-edit`이 스윕 승격 없이 차단 강도를 얻었다. **차단할 수 있는 층이 한 런타임에만 있으면 다른 런타임은 hard를 켜고도 보호가 0이다**) |
| 2026-08-03 | Python DEFAULTS 미러 8종(`duplicateLogic*`·`duplicateLiteral*`) + `RATCHETED_POLICIES` 24→25 동일화 | SPEC-038 동반. 판정 코어는 Node 전용이다(R13은 스윕 규칙이지만 게이트 자체가 파일 순회 + 어댑터 실행이고, Python 프로젝트는 `duplicateLiteralPatterns`를 Python 문법으로 바꿔 같은 Node 게이트를 쓴다 — 언어 무관은 config로 달성된다). 래칫 목록은 판정 데이터라 양판 동일이 필수 |
| 2026-08-04 | Python 미러 — `evidence_paths_of`·`covers_backlink_findings`·`covers_backlink_verdict` + `cmd_fr`의 R1b 배선·귀속 분리 + DEFAULTS 2종 + `RATCHETED_POLICIES` 25→26 | SPEC-039 동반. **판정 게이트라 양판 바이트 동일이 필수**다 — 실측 픽스처(FR이 다른 테스트를 검증으로 선언한 상태에서 무관한 테스트가 같은 번호를 태깅)에서 Node↔Python 출력·exit 일치 확인 |
| 2026-08-04 | Python 미러 — `cmd_specsync`에 삭제 경로 수집(`collect_deleted`) + unowned·리터럴 부재 양쪽 제외, **그리고 누락돼 있던 `files_line_missing_paths` 축 자체를 이식** | SPEC-003 FR-010 개정 동반. 미러 작업 중 발견한 선재 결함: Files 리터럴 실재 검사(SPEC-013)가 Node판에만 있어 **Python 런타임 프로젝트는 같은 위반을 조용히 통과**시켰다(동반 요구가 충족되면 exit 0 — 실측 픽스처로 `node exit=1` / `py exit=0` 확인). 판정 게이트의 한쪽만 있는 축은 축이 아니다 — 이식 후 두 픽스처(리터럴 부재 차단 / 삭제 동반 통과)에서 Node↔Python 출력·exit 바이트 동일 |
| 2026-08-09 | Python 미러 — 판정 타입 코어(`VERDICT_KINDS`·`format_verdict`·`verdict`·`judged`·`arm_verdict`) + `main()`의 단일 arm + `cmd_*` 21종 배선 | SPEC-040 동반. **판정 게이트라 양판 바이트 동일이 필수**다 — 한쪽 런타임만 타입을 내면 Python 프로젝트의 스윕은 여전히 문자열로 추측하고 "off (판정 안 함)"을 초록으로 읽는다. Node판은 파일마다 `armVerdict()`를 부르지만 Python판은 단일 엔트리라 `main()`에서 한 번이다(구조 차이, 계약 동일). 방출은 양판 모두 **동기 쓰기**(`writeSync(1)`/`os.write(1)`) — `print`·`console.log`는 버퍼를 타서 종료 훅에서 유실될 수 있고, 유실은 곧 미판정 오분류다. 패리티 테스트 54종 green으로 21개 명령의 판정 줄이 Node와 바이트 동일함을 확인 |
| 2026-08-09 | Python 미러 — 검증 실행 회계 코어(`parse_run_line`·`parse_run_ledger`·`classify_runs`·`verification_run_verdict`) + `cmd_verifyrun`(판정 + `--record`) + `body_before_ownership` + DEFAULTS 4종 + 래칫 목록 확장 + `cmd_orphan`의 역할 해석·예외 재사용 | SPEC-041·SPEC-001·SPEC-003 동반. **판정 게이트라 양판 바이트 동일이 필수**다 — 원장 미선언(INERT)·침묵 차단(hard)·기록 후 통과 세 갈래에서 Node↔Python 출력·exit 일치 확인. 원장 어휘가 런타임마다 다르면 "안 봤다"가 두 뜻을 갖는다 |
| 2026-08-09 | Python 미러 — `classify_runs`에 `env_bound` 인자 + DEFAULTS `verificationRunEnvBound` | SPEC-041 동반. 환경 결속 선언이 한쪽 런타임에만 있으면 같은 저장소가 Node에선 통과하고 Python에선 차단된다. 원장 미선언·침묵 차단·기록 후 통과·환경 결속 네 갈래에서 바이트 동일 확인 |
| 2026-08-09 | Python 미러 — 등록 축 코어(`is_deploy_artifact`·`live_reality_coverage`·`live_reality_coverage_verdict`) + `cmd_livereality` 2축 배선 + 증거 등급(`is_deploy_grade_evidence`·`ownsDeployArtifact` 트리거) + DEFAULTS 4종 + 래칫 목록 | SPEC-032·031 동반. 등록 축은 자격증명 없이 도는 **판정** 축이라 양판 필수다 — 한쪽에만 있으면 Python 런타임 프로젝트는 새 배포 산출물을 선언해도 아무 경고를 못 받는다. 미검사 산출물 지목·마커 미선언 inert·skipped 사유 네 갈래에서 바이트 동일 확인 |
| 2026-08-10 | 3분류 반환 계약 Python 미러 — `CHECK_KINDS`·`tri`·`tri_guard`·`check_outcome`·`merge_outcomes`·`outcome_summary` + 존재 판정기 주입 코어 4종(`files_line_missing_paths`·`missing_gates`·`agent_wiring_findings`·`validate_diagnosis_map`)과 `evidence_findings`의 3상태 전환 + 게이트 4종의 확인-못-함 출력 | 판정 게이트는 양판 필수다. Node만 고치면 Python 런타임 프로젝트에서는 읽기 실패가 여전히 "부재"=위반으로 흐른다 |
| 2026-08-10 | FR-006·SC-003 신설 — **경로 인용 계약**: 두 런타임의 git 기동 전수에 `core.quotepath=off`를 요구하고 소스 열거 테스트로 검산한다(`runtime-contract.test.mjs` ④). 미정규화 8곳 수정 — `check-fr-coverage`·`check-intro-doc`·`check-pre-edit`·`check-deploy-guard`·`check-deploy-debt`·`check-deploy-precheck`·`check-hooks-installed`·`gen-changelog` + Python 2곳 | 도그푸딩 실측: `git diff --cached --name-only`가 비ASCII 경로를 8진수로 **인용해서** 내는 탓에 **소개 문서 게이트가 자기 문서를 고친 커밋을 "문서 그대로"라고 차단했다.** 판정이 양방향으로 틀린다 — 소유 귀속은 조용히 사라지고(위반→통과) 자기 갱신은 오판된다(통과→위반). 두 게이트는 이미 정규화하고 있었고 여덟 곳이 빠져 있었다: **규범으로만 적힌 계약은 반드시 새어나간다.** 열거기를 프로세스 기동으로 좁힌 이유: 첫 판이 오류 문구 속 산문 2줄과 래퍼 호출 3줄을 잡았고 오탐이 잦은 게이트는 꺼진다. `isMainEntry`의 퍼센트 인코딩 결함과 같은 계열이다 — **경로를 문자열로 가정하면 비ASCII 저장소에서 게이트가 눈을 감는다** [검증: tooling/__tests__/runtime-contract.test.mjs] |
| 2026-08-10 | Python 미러 — `sweep_invocation`·`sweep_blocking`·`sweep_gate_files`·`gates_outside_ci` + `ci_wiring` 반환 확장(`labelOnly`·`blocking`) + 감시자 게이트의 신규 위반 4종 출력 | 판정 게이트는 양판 필수다. Node만 고치면 Python 런타임 프로젝트의 감시자 축은 **여전히 자기 파일명에 속는다** |
| 2026-08-10 | FR-007·SC-004 신설 — **양판 대응 선언**(`PY_SUBCOMMAND`) + 소스 열거 검산(`runtime-contract.test.mjs` ⑤). 그리고 그 검산이 지목한 누락 2종을 미러링: **R12 훅 배선**(`cmd_hooksinstalled` + `parse_hook_entries`·`hook_findings`·`HOOK_FINDING_TEXT`)과 **R13 구현 중복**(`cmd_duplicatelogic` + `extract_literals`·`duplicate_literal_findings`·`stale_allow_entries`·`parse_duplicate_candidates`), 각 패리티 테스트 동반 | 이 스펙은 판정 게이트에 양판을 요구하는데 **어느 게이트가 어느 서브커맨드에 대응하는지는 어디에도 적혀 있지 않았다** — 그래서 미러 누락이 사람이 손으로 대조할 때만 발견됐고, 실제로 그렇게 발견됐다. 대조를 기계화한 첫 실행이 **즉시 2건**을 냈다: R12·R13이 여러 라운드 동안 Node 전용이었고, Python 런타임 프로젝트에서 그 두 축은 **아무도 보지 않는 상태**였다 — 그 `0건`은 진짜 0건과 구분되지 않는다. **규범으로만 적힌 의무는 반드시 새어나간다**(같은 날 CI 게이트 손목록·설치기 복사 목록·픽스처 목록이 같은 방식으로 실패했다). 제외 항목에 사유를 요구한 이유: 빈 값은 "판정 게이트가 아니다"와 "잊었다"를 구분하지 못한다 [검증: tooling/__tests__/runtime-contract.test.mjs] |
| 2026-08-10 | 완료 신호 게이트 양판 패리티(9 시나리오) + `PY_SUBCOMMAND` 대응 선언 | 새 판정 게이트는 양판 대응을 **선언과 함께** 착지한다 — FR-007의 검산이 미선언을 즉시 지목하므로 이번엔 누락이 불가능했다(이전 두 축은 그 검산이 없어서 여러 라운드를 Node 전용으로 갔다) |
| 2026-08-10 | 훅 목록 후보 해석에 킷 전용 `harness/self/hooks.list`를 최우선으로 추가(양판) | 목록 해석은 판정 입력의 선택이므로 두 런타임이 같은 순서를 봐야 한다 — 한쪽만 고치면 같은 저장소에서 두 판이 다른 목록을 읽는다 |
| 2026-08-10 | Python 미러 — `category_role_provenance`·`ROLE_NAME_PATTERNS` + 소유·입도 게이트의 추측 자백 출력 + 래칫 목록에 `preEditSpecFirstPolicy` | 추측 자백은 판정 출력의 일부이므로 두 런타임이 같은 문장을 내야 한다. 한쪽만 고치면 같은 저장소에서 한 런타임은 추측을 알리고 다른 하나는 침묵한다 |
| 2026-08-10 | **재검토 조건 보강 + 그 처방 이행** — 조건에 "차단 강도를 갖게 되면"을 추가하고, `check-pre-edit`을 양판으로 복제(`cmd_preedit` — 경고·차단 exit 2·미소유 침묵·변경 집합 미해석 침묵·off·enum 밖 + 코드 경로 질의 모드, 8 시나리오 바이트 패리티). 훅 쉘이 **런타임을 고른다**(node 게이트 → 없으면 python3 `preedit`) | 2026-08-03 결정의 조건은 "스윕 규칙으로 승격되면" 하나였는데 **실제로 터진 방아쇠는 차단 강도**였다(2026-08-10, SPEC-003 FR-001) — 조건을 적을 때 상상한 경로만 적으면 다른 경로로 온 위험은 조건을 통과한다. 차단할 수 있는 층이 한 런타임에만 있으면 다른 런타임 프로젝트는 `hard`를 켜고도 보호가 0이다: **hard 선언 + 무판정 = 거짓 안전.** 결정을 몰래 뒤집지 않고 **조건을 갱신하고 그 처방을 이행했다.** 그리고 원래 결정의 근거("미러가 있어도 호출부가 없다")도 함께 해소했다 — 호출부 없는 미러는 죽은 코드이고 커버리지 숫자만 올린다. ⚠ SPEC-035의 배포 게이트 3종은 여전히 **비차단 훅 헬퍼**이므로 그 Node 전용 결정은 그대로 둔다(방아쇠가 터지지 않았다) [검증: tooling/__tests__/sdd-gates-py.test.mjs] |
