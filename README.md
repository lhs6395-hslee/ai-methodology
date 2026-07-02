# SDD 포터블 키트 (범용)

> 📐 **시각 설명서:** [`방법론.html`](방법론.html) — 방법론 전체를 다이어그램으로 설명; 결정성 게이트(키 도출·PREFIX·1 spec=1 aggregate)·강제 hook 세트·채택 후 궤도 운영법 포함. 브라우저로 직접 열어 본다(웹 배포용 진입점 아님 — 그래서 `index.html`이 아니라 `방법론.html`).

어떤 AI vibe-coding 프로젝트에든 **이 폴더만 참조하면** SDD(Spec-Driven Development)를 같은 방식으로 시작·유지할 수 있도록 정리한 재사용 키트다. 도메인 무관 — 모든 예시는 일반 placeholder(`THE SYSTEM SHALL …`, `<MODULE>`)다.

> ⚠️ **먼저 읽을 것: [`REALITY_CHECK.md`](REALITY_CHECK.md).** 이 키트의 어떤 부분이 "참조만 하면 바로 되는지" vs "프로젝트마다 설치/배선해야 되는지" vs "현재 깨져 있는지"를 **실제 실행으로 검증한 결과**가 들어 있다. (추측 아님)

## 채택 방법론 (한 줄)
> **Spec Kit 골격 + 요구사항(FR)만 EARS + 구현·검증은 Superpowers.** module > spec 계층, spec = 살아있는 기능명세서(SSOT), 작성은 LLM·승인은 사람.
>
> ✅ **구현 완료:** "채택 = 상시 강제 궤도" — **결정성 게이트**(Ownership 키 도출 결정 절차·PREFIX 표준 SPEC/INFRA/TEST·1 spec=1 aggregate·조용한 누락 제거) + **강제 hook 세트**(SessionStart 방법론 주입·PreToolUse 편집 체크리스트·pre-commit hard 차단 — `sdd-init` 자동 배선; pre-push drift 점검은 `ln -sf`로 선택 연결) + **spec-first 강제**(`Files` glob 소유매핑·`check-spec-sync` commit-msg hard + range advisory·`/speckit.fix`·Edge Cases/Change Log 필수화). 채택 후 궤도 한 바퀴 운영법은 [`APPLYING.md`](APPLYING.md) §"채택 후 궤도 한 바퀴" + [`방법론.html`](방법론.html) 참조. → [`ROADMAP.md`](ROADMAP.md)

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
| `tooling/` | **`sdd-init.sh`**(정식 레이아웃 결정적 스캐폴더 — 모든 프로젝트 동일 보장)·**`sdd.config.json`**(언어 어댑터)·**`sdd.config.presets.md`**(Python/Go/Rust/Java/… 프리셋). 게이트 **4판 동봉**(동작 동일·전부 검증): **`go-gate/`(Go→단일 정적 바이너리, 인터프리터 0 — 사실상 모든 언어 커버, 권장)** + `sdd-gate-release.yml`(전 플랫폼 빌드), `sdd_gates.sh`(POSIX 셸, 빌드 불필요), `sdd_gates.py`(Python), Node판 `*.mjs`. 모두 같은 config 구동. `vitest.config.ts`(JS만), **`ci-examples.md`**(게이트를 로컬·git훅·어떤 CI/CD 도구에서든 거는 예시 — 도구 무관), `sdd-gates.yml`(CI/CD 워크플로우 샘플 하나), `ears-preset/` | 이식 도구 |

## 쓰는 법 (요약)
1. `REALITY_CHECK.md`로 "되는 것/배선할 것"을 먼저 파악.
2. **`sh tooling/sdd-init.sh --gate=sh`** 를 대상 프로젝트 루트에서 실행 → **공통 큰 틀**(`sdd/` 폴더 구조·스펙 위치)이 어느 프로젝트나 같게 생성된다(`STORAGE.md` §5). 그 안의 스펙·모듈·`sdd.config.json` 값은 프로젝트가 채운다. (수동 절차·세부는 `APPLYING.md`.)
3. `STRUCTURE.md`대로 module>spec 구성, `templates/`로 spec 작성.
4. `SPEC_REVIEW.md`·`SSOT.md`·`DEDUP.md`의 게이트(`/analyze`, FR↔test, **스펙 간 중복(소유권)**, CI)로 SSOT를 "주장"이 아니라 "실재"로 유지.
