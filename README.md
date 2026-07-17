# SDD 포터블 키트 (범용)

> 📐 **시각 설명서:** [`방법론.html`](방법론.html) — 방법론 전체를 다이어그램으로 설명; 결정성 게이트(키 도출·PREFIX·1 spec=1 aggregate)·강제 hook 세트·채택 후 궤도 운영법 포함. 브라우저로 직접 열어 본다(웹 배포용 진입점 아님 — 그래서 `index.html`이 아니라 `방법론.html`).

어떤 AI vibe-coding 프로젝트에든 **이 폴더만 참조하면** SDD(Spec-Driven Development)를 같은 방식으로 시작·유지할 수 있도록 정리한 재사용 키트다. 도메인 무관 — 모든 예시는 일반 placeholder(`THE SYSTEM SHALL …`, `<MODULE>`)다.

> ⚠️ **먼저 읽을 것: [`REALITY_CHECK.md`](REALITY_CHECK.md).** 이 키트의 어떤 부분이 "참조만 하면 바로 되는지" vs "프로젝트마다 설치/배선해야 되는지" vs "현재 깨져 있는지"를 **실제 실행으로 검증한 결과**가 들어 있다. (추측 아님)

## 왜 이 방식인가 (한 줄)
> **바이브 코딩(feature 단위)은 빠르지만 미완성이 "돼 보임" 뒤에 숨는다.** 이 키트는 작업 단위를 **FR(요구 하나하나)**로 내리고 **검증을 회계(unit·smoke·deferred)·추적(spec↔code↔test)으로 강제**해 그 미완성을 드러낸다. 단점(오버헤드·유지비)의 보완, 그리고 *언제 바이브 / 언제 이 방식*까지 → [`METHODOLOGY.md`](METHODOLOGY.md) §"왜 이 방식으로 왔나" · 시각판 [`방법론.html`](방법론.html).

## 채택 방법론 (한 줄)
> **Spec Kit 골격 + 요구사항(FR)만 EARS + 구현·검증은 Superpowers.** module > spec 계층, spec = 살아있는 기능명세서(SSOT), 작성은 LLM·승인은 사람.
>
> ✅ **구현 완료 — "채택 = 상시 강제 궤도":**
> - **결정성 게이트**: Ownership 키 도출 결정 절차·PREFIX 표준 SPEC/INFRA/TEST/CICD·1 spec=1 aggregate·조용한 누락 제거
> - **강제 hook 세트**: SessionStart 방법론 주입·PreToolUse 편집 체크리스트·pre-commit hard 차단 — `sdd-init` 자동 배선; pre-push drift 점검은 `ln -sf`로 선택 연결
> - **spec-first 강제**: `Files` glob 소유매핑·`check-spec-sync` commit-msg hard + range advisory·`/speckit.fix`·Edge Cases/Change Log 필수화
> - **스펙 수명주기**: Status enum·Draft 소유 코드 차단·Reviewed 이상 Review Log/Dedup-Review 기록 — SPEC-008
> - **검증 회계**: `requireAccounting`·`smokeManifest`·`strictSpecs` — 모든 FR이 unit/smoke/deferred/planned로 회계, SPEC-007
> - **미소유 파일 정책**: `specSyncUnownedPolicy`
> - **entity 등록제**: `entityRegistry`
> - **재도출 소스 회계**: `derivationManifest` 9클래스·실재↔선언 교차검사 — SPEC-009
> - **smoke 증거 자동 수집**: `@verifies` 태그 → `smoke-scan --write` 재생성·check 드리프트 차단 — SPEC-010
> - **추적 태그 마이그레이션**: `retag` — 재번호 맵 기계 이행, SPEC-011
> - **선제 캡처**: Change Log 실기록 행의 근거 존재 검사
> - **접두어↔클래스 정합**: iac/ci 전용 소유 스펙은 INFRA- 강제·`prefixClassExemptions` — SPEC-012
> - **스펙 문법 규범**: Module 존재·단일성=1레포 1모듈·FR 라인 SHALL·Dedup 참조 실재·Files 카테고리 금지·글롭 문법 staged 차단 — SPEC-013
> - **리뷰 경계 선언**: 게이트가 판정하지 않는 의미 항목의 명시 표 — `METHODOLOGY.md`, 정의되지 않은 예외 0
>
> 채택 후 궤도 한 바퀴 운영법은 [`APPLYING.md`](APPLYING.md) §"채택 후 궤도 한 바퀴" + [`방법론.html`](방법론.html) 참조. → [`ROADMAP.md`](ROADMAP.md)
>
> 🔁 **키트는 자기 자신의 첫 소비자다(self-hosting):** 이 레포의 게이트 스위트(`tooling/`)도 자기 방법론 궤도 위에 있다 — [`sdd/specs/`](sdd/specs/)의 스펙 전부(SPEC-001~·CICD-001)가 tooling 전체(게이트·lib)와 `sdd.config.json`·CI 워크플로를 소유하고, 테스트는 `@covers`로 FR에 묶이며(전 FR이 unit 또는 smoke-manifest로 회계됨 — `requireAccounting` 상시 on), 자기 git 훅(`tooling/harness/self-hooks-install.sh`)이 tooling 변경을 상시 강제한다. 스펙 없는 소유 파일 커밋은 commit-msg에서, **어느 스펙도 소유하지 않는 신규 파일도 closed-world(`specSyncUnownedPolicy: error`)로** 막히고, 로컬 훅을 우회한 커밋은 **자체 CI**(`.github/workflows/sdd-gates.yml`, CICD-001 — 스위트+게이트, PR엔 range spec-sync·`draftBlockPolicy: hard`)가 서버측에서 잡는다.

> **어떤 언어·어떤 모델·어떤 인프라든** 같은 규율로 동작한다. 언어/스택 차이는 `sdd.config.json` 어댑터 한 장으로만 표현(프리셋: `tooling/sdd.config.presets.md`), 방법론·게이트엔 특정 LLM·벤더 가정이 없다. **특정 CI/CD 도구도 불필요** — 게이트는 CLI라 로컬·git훅·어떤 CI/CD 도구에서든 돈다(`ci-examples.md`). *Spec Kit(spec 작성)과 CI/CD 도구(게이트 실행)는 별개*다. (→ `principles.md` §10)

## 구성
| 파일 | 내용 | 성격 |
|---|---|---|
| [`REALITY_CHECK.md`](REALITY_CHECK.md) | **검증된 동작/조건부/미동작 매트릭스** (실행 증거) | ★ 먼저 |
| [`SOURCES.md`](SOURCES.md) | **방법론 주장 외부 확증 기록** (공식문서/블로그 + 정정) | ★ 근거 |
| [`METHODOLOGY.md`](METHODOLOGY.md) | 3축·0~8루프·converge 정확판·LLM작성/사람승인 | 문서 |
| [`STORAGE.md`](STORAGE.md) | **저장 정의** — spec·방법론을 어디·어떻게 두나(프로젝트 레이아웃, 저장 vs 참조, config=SSOT) | ★ 저장 |
| [`STRUCTURE.md`](STRUCTURE.md) | module>spec·명세서vs델타·dedup·SSOT 3계층 | 문서 |
| [`SSOT.md`](SSOT.md) | Spec Kit만으로 약한 이유 + 무엇으로 메우나 | 결정기록 |
| [`DEDUP.md`](DEDUP.md) | **스펙 간 중복 2계층(구조적 게이트+의미적 리뷰)·소유권 유일성·근거** | ★ 중복 |
| [`SPEC_REVIEW.md`](SPEC_REVIEW.md) | spec 리뷰 체크리스트(중복·빈공란·모순·누락·추적성)·게이트 매핑 | 문서 |
| [`APPLYING.md`](APPLYING.md) | **새 프로젝트에 적용하는 설치·배선 절차** + **채택 후 궤도 한 바퀴 운영법**(hook·게이트 실측 출력 포함) | 런북 |
| [`PROMPTS.md`](PROMPTS.md) | 어느 IDE든 붙여넣는 시작/이어가기 프롬프트 | 프롬프트 |
| [`principles.md`](principles.md) | 작업 원칙(전부정독·병렬=저비용티어·실패재시도·LLM작성/사람승인·언어/모델/인프라/CI 무관 §10) | 규칙 |
| [`HARNESS.md`](HARNESS.md) | **인터랙티브 spec↔code sync 계약**(규칙표 R1~R4·실행기 `/sdd-sync`·pre-push 훅) + **강제 hook 세트**(SessionStart·PreToolUse·pre-commit·pre-push, `sdd-init` 배선) + **spec-first**(`check-spec-sync`·commit-msg hard·`/speckit.fix` — Files glob 소유매핑, changeset=브랜치, Spec-Impact 트레일러) | ★ 하네스 |
| [`ROADMAP.md`](ROADMAP.md) | **완료 / 보류 항목**(보류는 "필요 증명 시 착수" — YAGNI) | 로드맵 |
| `templates/` | `module-spec.md`(EARS 범용), `MODULE_MAP.md`(단일 모듈 매니페스트), `constitution.md` | 템플릿 |
| `tooling/` | **`sdd-init.sh`**(정식 레이아웃 결정적 스캐폴더 — 모든 프로젝트 동일 보장)·**`sdd.config.json`**(언어 어댑터)·**`sdd.config.presets.md`**(Python/Go/Rust/Java/… 프리셋). 게이트 **4판 동봉**(핵심 3커맨드·ID 문법 동일, **Node·Python은 전 게이트 패리티** — 매트릭스: `ci-examples.md`): **`go-gate/`(Go→단일 정적 바이너리, 인터프리터 0 — 사실상 모든 언어 커버, 권장)** + `sdd-gate-release.yml`(전 플랫폼 빌드), `sdd_gates.sh`(POSIX 셸, 빌드 불필요), `sdd_gates.py`(Python), Node판 `*.mjs`. 모두 같은 config 구동. `vitest.config.ts`(JS만), **`ci-examples.md`**(게이트를 로컬·git훅·어떤 CI/CD 도구에서든 거는 예시 — 도구 무관), `sdd-gates.yml`(CI/CD 워크플로우 샘플 하나), `ears-preset/` | 이식 도구 |

## 이 방법론 쓰는 법 (시작 · 재채택 · 업데이트)

정본은 **GitHub 레포**([github.com/lhs6395-hslee/ai-methodology](https://github.com/lhs6395-hslee/ai-methodology))다. 쓰는 데엔 두 계층이 있고, "다운로드 없이 되냐"의 답이 계층마다 다르다:

- **① 작성·검토 계층 — 다운로드 불필요.** 에이전트에게 "이 방법론(위 URL)을 따라"라고 하면, 에이전트가 GitHub에서 `METHODOLOGY`·`STRUCTURE`·`STORAGE`·`APPLYING`·템플릿을 **직접 읽어** 그 규율대로 스펙을 작성/검토한다. 문서만으로 시작 가능(레포 public, raw 읽기 됨).
- **② 강제 계층 — 파일 배선 필요(`sdd-init` 1회).** "스펙 없는 커밋 차단" 같은 *기계적 강제*는 git 훅·게이트가 **로컬에 실제 파일로** 있어야 돈다(git은 원격 파일을 훅으로 실행 못 함). 이때 필요한 건 레포 전체(clone 시 526KB)가 아니라 런타임 폐포 **약 30개 파일**뿐 — `sdd-init`가 프로젝트의 `scripts/`·`sdd/`·`.claude/`·`.git/hooks/`에 심는다.

> **clean machine(키트 로컬에 없음)에서도 clone 없이 시작된다:** 진입은 **GitHub raw URL**(아래 표) — 에이전트가 `prompts/adopt.md`를 raw로 읽어 실행하고, ②의 강제 tooling은 그 절차가 **partial+sparse**로만 확보한다(전체 526KB clone 아님). 키트가 이미 로컬(`~/Documents/claude/sdd`)에 있으면 그 경로로도 동일하게 되지만 **필수는 아니다**. 어느 경우든 **프로젝트마다 clone하지 않는다**(레포 밖·fork 금지·참조만). 프로젝트에 남는 건 위 ②의 약 30개 파일뿐.

### 한 줄로 쓰기 — GitHub raw URL 하나로 실행 (clone 불필요)
각 상황의 **전체 절차는 [`prompts/`](prompts/)에 파일로** 있다(SSOT — 절차 원본은 여기 한 곳). **진입 = 그 파일의 raw URL 한 줄** — 키트가 로컬에 없어도(clean machine) 에이전트가 raw로 읽고 순서대로 수행한다(강제 tooling은 그 절차가 partial+sparse로 확보, 전체 clone 아님):

| 상황 | 대화창에 붙여넣는 한 줄 (raw URL) |
|---|---|
| **시작** — SDD 처음인 새 프로젝트 | `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/adopt.md 읽고 그대로 수행해줘` |
| **재채택** — 이미 `sdd/` 있음(소비 프로젝트 A/B 등) | `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/readopt.md 읽고 그대로 수행해줘` |
| **업데이트** — 내가 방법론을 고도화한 뒤 | `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/update.md 읽고 그대로 수행해줘` |

> **ref:** 위 URL의 정본 ref는 `main`이다. 각 파일은 방법론 읽기·`sdd-init`·고정 규칙까지 자체 포함하며, 자신을 받은 ref를 이어 사용하므로 특정 브랜치의 raw로 fetch하면 그 브랜치 기준으로 동일하게 동작한다(자기참조).
>
> 키트가 이미 로컬에 있으면 raw URL 대신 경로로도 동일: `~/Documents/claude/sdd/prompts/adopt.md 를 그대로 수행해줘`.

### 설치형 슬래시 명령 (`sdd-init` 후 프로젝트 안에서)
`sdd-init` 배선을 마친 프로젝트에는 위 3종이 **슬래시 명령**으로도 설치된다(`.claude/skills/`). 위 한 줄과 **동일한 `prompts/` 절차(SSOT)를 실행**하고, 인자로 대상/URL을 받는다:

| 명령 | 상황 | 정본 절차 |
|---|---|---|
| `/sdd-start [<project-path>] [<methodology-url>]` | 최초 채택 | [`prompts/adopt.md`](prompts/adopt.md) |
| `/sdd-readopt [<project-path>] [<methodology-url>]` | 완전 재채택 | [`prompts/readopt.md`](prompts/readopt.md) |
| `/sdd-update [<project-path>] [<methodology-url>]` | 평상시 sync | [`prompts/update.md`](prompts/update.md) |

인자 없으면 현재 디렉토리·정본 저장소를 기본값으로 쓴다. 절차 원본은 `prompts/`(SSOT)에 한 곳, 스킬은 이를 참조·실행한다(중복 저장 안 함). 스킬 계약은 [`sdd/specs/SPEC-005-adoption-lifecycle.md`](sdd/specs/SPEC-005-adoption-lifecycle.md).

### 경량 부트스트랩 (전체 clone 없이 URL로 시작)
위 raw URL 한 줄이면 에이전트가 이 부트스트랩을 알아서 수행한다. 수동으로 실행 폐포만 받으려면(526KB 전체 clone 불필요) partial + sparse clone 1회:
```sh
KIT="${SDD_KIT:-$HOME/Documents/claude/sdd}"; REF="main"   # 정본 ref (자기참조: 브랜치에서 받으면 그 ref)
git clone --filter=blob:none --sparse --branch "$REF" https://github.com/lhs6395-hslee/ai-methodology "$KIT"
git -C "$KIT" sparse-checkout set tooling templates prompts
```
cone 모드라 **루트 파일 전부**(`STORAGE.md`·`APPLYING.md`·`REALITY_CHECK.md`… 방법론 설명서)와 `tooling/`·`templates/`·`prompts/`를 받고, 큰 하위폴더(`.superpowers/` 리뷰 diff ~864K·`docs/`·`sdd/`)는 워킹트리에서 제외한다. `--filter=blob:none`는 나머지 이력 블롭을 지연 로드(필요 시에만 fetch). 이후 대상 프로젝트 루트에서 `sh "$KIT/tooling/sdd-init.sh" --gate=node` 또는 `/sdd-start`.

설치·배선·채택 후 궤도 운영 상세는 [`APPLYING.md`](APPLYING.md), 다른 시나리오(진행 중 이어가기·hotfix converge)의 붙여넣기 프롬프트는 [`PROMPTS.md`](PROMPTS.md).
