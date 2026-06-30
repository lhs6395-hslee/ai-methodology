# 방법론 — Spec Kit + EARS + Superpowers (범용)

## 3축 역할
| 축 | 도구 | 담당 |
|---|---|---|
| 골격 | **GitHub Spec Kit** | `specify→plan→tasks` + 리뷰 게이트(`/analyze·/checklist·/clarify·/constitution`). "스펙의 옳음" |
| 요구사항 | **EARS** | FR을 5패턴 정형 요구로(아래). "한 요구=한 동작=검증가능" |
| 구현·검증 | **Superpowers** | TDD(RED→GREEN)·완료전검증·코드리뷰. "코드의 옳음". `/implement` 미사용 |

왜 OpenSpec 아닌 Spec Kit: **에이전트 비종속(30+) + 리뷰 게이트 내장 + Superpowers 결합**(코드검증 레이어). "sync가 더 좋아서"가 아님(그 축이면 OpenSpec이 유리). → `SSOT.md`.

## 4번째 기둥 — 범용성(Portability): 6축 무관
> 3축이 *무엇을 하는가*라면, 범용성은 *어디서나 같게 동작한다*는 보장이다. **방법론의 어떤 부분도 특정 언어·런타임·모델·미들웨어·클라우드·CI에 박히지 않는다.** 강제 게이트는 모두 실행으로 검증됨(`REALITY_CHECK.md`). 단일 기준점: `principles.md` §10.

| 축 | 무관 보장 | 어떻게 (메커니즘) |
|---|---|---|
| **언어** | Python·Go·Rust·Java·… 무엇이든 | `sdd.config.json` 어댑터 1장(`testFileRegex`·`scanDirs`·`commands`·`ownershipCategories`·`specIdPrefixes`). 프리셋: `tooling/sdd.config.presets.md`. `@covers` 주석 스타일 무관(`//`·`#`·`--`) |
| **런타임(게이트 실행)** | 인터프리터 강요 없음 | 게이트 4판 동작 동일 — **Go 단일 정적 바이너리**(만능, 인터프리터 0)·셸(`sh+grep+awk+jq`)·Python·Node. 가진 쪽 사용 |
| **모델/에이전트** | 어떤 LLM이든 | 방법론에 벤더 가정 0. Spec Kit 30+ 에이전트 비종속, 게이트는 모델 독립적으로 강제. 슬래시명령은 편의, 핵심 규율은 어떤 에이전트로도 수행 가능 |
| **DB/미들웨어** | RDB·NoSQL·Redis·Kafka·검색·스토리지… | spec은 *역량/요구*만 적고 *제품* 금지("이벤트 로그 필요" O / "Kafka" X). 구조 SSOT 위치만 다름(`STRUCTURE.md`) |
| **CSP** | AWS·GCP·Azure·온프렘 | drift 검증 *원리* 동일, *명령*만 환경 것(`SSOT.md` §5b) |
| **CI/CD 도구** | 특정 CI/CD 도구 불필요 | 게이트는 CLI — 로컬·git훅·`make`·어떤 CI/CD 도구든. 샘플·도구별 동일 명령: `tooling/ci-examples.md`. **Spec Kit(spec 작성) ≠ CI/CD 도구(게이트 실행)** |

**한 규칙으로 압축:** *무엇을/왜*(spec·FR)만 방법론이 규정하고, *무엇으로*(언어·DB·클라우드·CI 제품)는 전부 프로젝트 결정으로 남긴다. 새 언어·새 스택이 와도 게이트를 새로 짜지 않고 `sdd.config.json`만 맞춘다.

## EARS 5패턴
| 패턴 | 틀 |
|---|---|
| Ubiquitous | `THE SYSTEM SHALL <응답>.` |
| Event | `WHEN <트리거>, THE SYSTEM SHALL <응답>.` |
| State | `WHILE <상태>, THE SYSTEM SHALL <응답>.` |
| Unwanted | `IF <비정상>, THEN THE SYSTEM SHALL <응답>.` |
| Optional | `WHERE <옵션 포함 시>, THE SYSTEM SHALL <응답>.` |
| Complex | `WHILE <상태>, WHEN <트리거>, THE SYSTEM SHALL …` |
금지: should/가능하면/적절히, 한 문장 2동작(and), 측정불가. 모르는 값 → `[NEEDS CLARIFICATION: …]`(창작 금지). 섹션: Story=서술 · 수용기준=GWT · **FR=EARS** · SC=측정형 숫자.

## 0~8 루프
> **단위 = 1 레포 = 1 모듈.** 이 루프는 한 모듈(레포) 안에서 돈다. 큰 프로그램은 여러 모듈-레포의 **MSA 합성**이며, 모듈 간 계약은 다중 모듈일 때 켜는 **MSA 계약 프로파일**이 강제한다(`STRUCTURE.md`).

| 단계 | 담당 | 행위 | 게이트 |
|---|---|---|---|
| 0 프리셋 | 👤1회 | EARS 형식을 Spec Kit preset에 고정 | preset이 EARS 템플릿 반환 |
| 1 specify | 👤→🤖 | `/speckit.specify` 자연어→spec | FR이 EARS 준수+빈칸 명시 |
| 2 clarify | 🔀 | `/speckit.clarify` 빈칸 해소 | 핵심 빈칸 해소/보류 |
| 3 plan | 👤→🤖 | `/speckit.plan` | FR↔컴포넌트 매핑 |
| 4 tasks | 👤→🤖 | `/speckit.tasks` 2~5분 TDD 분해 | 수용기준이 ≥1 task |
| 5 일관성 | 🤖 | `/speckit.analyze`+`/checklist` | 누락·모순·중복 0 |
| 6 구현·검증 | 🤖+👤 | Superpowers TDD→완료전검증→리뷰 | 전 테스트 GREEN+리뷰 |
| 7 머지 | 👤 | PR 리뷰·머지 | 사람 승인 |
| 8 converge | 🔀 | `/speckit.converge` 드리프트→task | 동기화 |

## spec ⇄ code 동기화 — 정확판
converge는 **갭을 task로 표면화만** 한다(spec 자동 재작성 ✗). 양방향 다 **작성=LLM, 승인=사람**:
- **top-down(spec→code):** 사람이 spec 작성 → `/converge`가 미구현 갭을 task로 → implement.
- **bottom-up(code→spec, hotfix 후):** `/converge`가 갭을 task로 → **사람이 'intent 한 줄'(이 hotfix가 무슨 기능·왜)을 입력** → **`/specify`(update)로 LLM이 `코드 diff + intent`로 spec 작성**(코드만 보고 추측 X → top-down과 동일 입력 품질) → `/analyze` 중복·정합 검사 → **사람은 "정본화(bless) vs 되돌리기(revert)" 승인만.**
- 하지 말 것: 사람 승인 없이 코드→spec 자동 덮어쓰기(=spec이 코드의 거울로 전락, drift 탐지 무의미).

## 출처·확증
이 문서의 핵심 주장(converge=갭을 task로 추가만/자동 재작성 X, specify=생성+갱신, EARS 비공식·#1356, EARS 5패턴 Rolls-Royce IEEE RE'09, OpenSpec specs/changes, Superpowers TDD·완료전검증)은 공식 출처로 확증됨 → `SOURCES.md`. 보강: EARS 저자=Mavin·Wilkinson·Harwood·Novak(공저), Superpowers 창작자=Jesse Vincent(obra)·Anthropic 공식 마켓(2026-01).
