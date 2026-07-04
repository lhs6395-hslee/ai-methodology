# REALITY CHECK — 검증된 동작 결과 (추측 아님)

> 이 문서의 모든 판정은 참조 프로젝트(operations-dashboard, Spec Kit 0.11.9 + claude 연동)에서 **실제 명령을 실행해** 확인한 결과다. 검증일: 2026-06-26. **언어 무관 어댑터는 Python 픽스처로 추가 검증(2026-06-29).** 태그: `[검증]`=실행함 · `[조건부]`=프로젝트마다 설치/배선 필요 · `[미동작]`=현재 안 됨.
>
> **범용성 정직 노트:** 게이트는 텍스트 파서라 언어에 묶이지 않으며 Python 픽스처에서 통과·차단 모두 실증했다(아래 매트릭스). 다만 **실제 Python/Go/Rust 프로덕션 레포 전체 파이프라인**(그 언어의 lint/typecheck/test가 CI green) 검증은 적용 프로젝트의 몫이다 — 어댑터(`sdd.config.json`)와 게이트 동작 자체는 검증됨, 각 언어의 `commands.*`가 그 레포에서 green인지는 JS 때와 동일하게 "그 프로젝트가 먼저 통과해야" 한다.

## 1. 한눈에 — "참조만 하면 바로 되는가?"

**아니오.** 이 키트는 **문서·템플릿·도구(소스)** 다. 참조한다고 명령이 저절로 돌지 않는다. 실제로 동작하려면 **프로젝트마다 Spec Kit/Superpowers 설치 + preset/tooling 배선**이 필요하다(→ `APPLYING.md`). "바로 되는" 것은 *올바르게 시작하는 방법*이지 *런타임*이 아니다.

## 2. 검증 매트릭스

| 항목 | 판정 | 증거 (실행 결과) |
|---|---|---|
| Spec Kit init (`.specify/`, ears-ops preset, claude 연동) | `[검증]` 동작 | v0.11.9.dev0, 11모듈 config, preset 파일 실재 |
| `node check-fr-coverage.mjs` (FR↔test 게이트, incremental) | `[검증]` **통과** | exit 0 — `specs:11 FRs:88 covered:2` |
| `node check-fr-coverage.mjs --strict` | `[검증]` **실패(설계대로)** | exit 1 — 미구현 spec은 strict에서 막힘 |
| `node check-ownership.mjs` (스펙 간 구조적 중복, → `DEDUP.md`) | `[검증]` **동작** (2026-06-29 픽스처 실행) | 같은 Entity 2 spec 소유 시 exit 1 + 충돌 출력, 중복 제거 후 exit 0, 미선언 spec은 warn(exit 0) |
| `node check-ownership.mjs --strict` | `[검증]` **실패(설계대로)** | exit 1 — Ownership 미선언 spec을 막음 |
| `npm test` (vitest, `@covers` 태깅) | `[검증]` **통과** | 8 tests passed (2 files) |
| `npx tsc --noEmit` (타입) | `[검증]` 통과 | exit 0 |
| **`npm run lint`** (참조 프로젝트) | `[참조앱 이슈]` | exit 1 — 4 errors는 **참조 프로젝트의 기존 앱 코드**(`set-state-in-effect` 등). **키트/방법론 결함 아님** |
| **CI `sdd-gates.yml`** 구조 | `[검증]` 정상 | 게이트 구조 정상(lint→tsc→test→check:fr). 참조 프로젝트는 위 앱-코드 lint로 red — 게이트가 *제대로* 막은 것 |
| Superpowers(TDD·완료전검증·리뷰) | `[조건부]` | 대상 IDE/에이전트에 스킬이 설치돼 있어야 동작 |
| EARS 강제 | `[조건부]` | Spec Kit **비공식**(Issue #1356) — preset로만. 업데이트 시 재정합 |
| converge 양방향 "자동" sync | `[미동작 오해]` | converge는 갭을 **task로 표면화만**. spec 작성은 별도(LLM)+승인(사람) |
| module>spec·cross-spec 중복검사 | `[검증]`/`[조건부]` | **구조적 중복**=`check-ownership.mjs` 게이트로 결정적 차단(검증됨, → `DEDUP.md`). **의미적 중복**(reworded)=`/analyze`(한 기능 내)+좁힌 리뷰로 보조(조건부) |
| **언어 무관 어댑터**(`sdd.config.json`) — Python 픽스처로 게이트 실행 | `[검증]` **동작**(2026-06-29) | Python 테스트(`#` 주석 @covers) FR↔test 통과(specs:1 FRs:2 covered:2), 커스텀 Ownership 키(Modules/Symbols/Artifacts) 유일성 OK |
| 언어 무관 — **위반 탐지도 비-JS에서 강제** | `[검증]` **차단(설계대로)** | 같은 Module 키 2 spec=exit 1, dangling `@covers`(없는 FR)=R1 exit 1. Python 픽스처 |
| config 없을 때 **JS/TS 하위호환** | `[검증]` 동작 | `config:defaults(JS/TS)`로 `.test.ts` 인식·Entities 기본키 — 기존 동작 그대로 |
| CI 언어 무관(`sdd-run.mjs`) — `commands.*` 실행/미설정 stage skip | `[검증]` 동작 | 설정 stage 실행·exit 전파, 미설정 stage는 건너뜀(exit 0) |
| **런타임 무관 — Python 게이트(`sdd_gates.py`, Node 불필요)** | `[검증]` **전 게이트 패리티**(2026-07-05) | Python 3.7에서 **Node판 전 게이트**(fr+PREFIX 거버넌스·ownership+정규화/형식검증·cohesion·completeness·consistency·adequacy·orphan·converge·specsync·run) 실행. 패리티 테스트(`sdd-gates-py.test.mjs`)가 같은 픽스처의 exit code·출력 동일성을 회귀로 강제. 요구 ID 문법(서픽스·`requirementIdPrefixes`)도 Node와 동일 파생 |
| **런타임 무관 — 셸 게이트(`sdd_gates.sh`, 언어 런타임 0)** | `[검증]` **동작·문법 정렬**(핵심 3커맨드, 2026-07-05) | `sh`+`grep`+`awk`+`jq`만으로 fr/ownership/run 실행. fr에 PREFIX 거버넌스 추가, 요구 ID 문법(레터 서픽스·`requirementIdPrefixes`)을 Node와 정렬 — `sdd-gates-sh.test.mjs`가 회귀로 강제. ownership 키 정규화/형식검증은 미포팅(정직한 델타 — SPEC-006). 과거 실증: Go 픽스처를 `go` 미설치로 게이트 통과(2026-06-29) |
| **런타임 무관 — Go 단일 정적 바이너리(`go-gate/`, 인터프리터 0)** | `[검증]` 빌드·정적·크로스컴파일(2026-06-29) / `[미확인]` **2026-07-05 문법 정렬분 실행 재검증** | Go 1.26으로 빌드, 당시 Node/Python/셸판과 동일 결과. `CGO_ENABLED=0` linux/amd64 = `statically linked`, 6종 크로스컴파일(~2.5MB). **2026-07-05 요구 ID 문법·PREFIX 거버넌스 정렬은 소스 계약 테스트(`runtime-contract.test.mjs`)로만 검증** — 로컬 Go 툴체인 부재로 빌드·실행 패리티 재검증은 CI(`sdd-gate-release.yml`) 과제. 릴리스: `sdd-gate-release.yml` |

## 3. 그래서 "안 되는 것" 정리 (사용자 지적대로)
1. **참조 프로젝트 CI가 red — 단, 키트 결함 아님** — `npm run lint` 4 errors는 *그 프로젝트의 기존 앱 코드*(`set-state-in-effect` 등) 문제다. 키트의 게이트는 정상 작동(막아야 할 걸 막음). 어느 프로젝트든 적용 시 **그 프로젝트 자신의 lint/tsc/test가 먼저 통과**해야 CI green — 프로젝트별 앱-코드 사정이지 방법론·키트의 한계가 아니다. (검증은 레퍼런스 구현에서 read-only로 실행했고, **키트는 그 프로젝트에 의존하지 않는다** — 검증된 도구만 복사해 옴.)
2. **strict FR 게이트는 의도적으로 실패한다** — 아직 테스트가 없는 spec(예: 11개 중 9개)이 막힌다. 정상이며, 구현이 진행되며 점차 해소. 그전까지 CI는 **incremental**(`check:fr`)만 돌린다.
3. **"참조만 하면 자동" 아님** — Spec Kit/Superpowers/preset/tests/CI는 **프로젝트마다 설치·배선**해야 한다.
4. **converge ≠ 자동 양방향 sync** — bottom-up(code→spec)은 converge가 갭만 띄우고, **LLM이 spec 작성 + 사람 승인**으로 마무리(자동 아님).

## 4. 무엇이 "진짜로" SSOT를 보장하나 (검증된 체인)
`FR-ID(스펙)` → `@covers` 태그(테스트) → `check-fr-coverage.mjs`(CI 게이트) → `vitest`(test↔code) → `tsc`. 이 체인은 **실행으로 통과 확인됨**(lint 제외). 이게 "스펙이 살아있는 SSOT"를 주장이 아니라 기계적 사실로 만든다. 단 **CI가 실제로 돌고 green이어야** 효력이 있다(참조 프로젝트는 자신의 앱-코드 lint로 red → 그 프로젝트에서 먼저 고쳐야 함; 키트 자체와는 무관).
