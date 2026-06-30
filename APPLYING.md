# 새 프로젝트에 적용 — 설치·배선 런북

> `REALITY_CHECK.md`가 밝힌 대로, 이 키트는 참조만으로 자동 동작하지 않는다. 아래를 프로젝트마다 배선해야 "되는" 상태가 된다.
> **무엇을 레포에 저장하고 무엇을 키트에서 참조만 하는지(레이아웃·저장 vs 참조)는 `STORAGE.md`가 정의한다 — 이 런북은 그걸 설치하는 절차다.**

## ★ 빠른 경로 (권장) — 한 명령으로 정식 레이아웃
```bash
cd <대상 프로젝트 루트>
sh <KIT>/tooling/sdd-init.sh --gate=sh        # gate: go|sh|py|node
```
→ `sdd/specs/`·`sdd/MODULE_MAP.md`·`sdd/templates/`·`sdd.config.json`·`scripts/<게이트>`가 **모든 프로젝트에서 동일하게** 생성된다(`STORAGE.md` §5). 그다음 **§3의 "언어 맞춤"** 으로 `sdd.config.json` 값만 조정하고, **§1**로 Spec Kit init(+constitution)만 추가하면 끝. 아래 0~5는 그 빠른 경로가 하는 일의 상세·수동 폴백이다.

## 0. 전제 도구
- `uv`/`uvx`(Spec Kit 실행) · 대상 IDE에 **Superpowers 스킬**(또는 동급 TDD/검증 규율, `[조건부]`).
- **게이트 런타임은 3단계에서 택1** — 추가 요구가 다름: Go 바이너리=**아무것도 불필요**(권장) / 셸판=`sh`+`grep`+`awk`+`jq`(유닉스 기본) / Python판=`python3` / Node판=`Node 20+`. 게이트는 텍스트 파서라 대상 프로젝트 언어와 무관.
- **언어/모델/인프라 무관:** 어떤 언어든 동일 절차. 언어별 차이는 3단계의 `sdd.config.json` 한 장으로만 표현(프리셋: `tooling/sdd.config.presets.md`).

## 1. Spec Kit init + EARS preset
```bash
uvx --from git+https://github.com/github/spec-kit.git specify init . --ai claude --here
mkdir -p .specify/presets/ears-ops/templates
cp <KIT>/tooling/ears-preset/preset.json        .specify/presets/ears-ops/
cp <KIT>/tooling/ears-preset/templates/spec-template.md .specify/presets/ears-ops/templates/
```
- `.specify/config.json`에 `specDir: sdd/specs`, `templateDir: sdd/templates`, `preset: ears-ops`, EARS `rules`, 프로젝트 도메인 규칙을 기입.
- **EARS는 비공식** → Spec Kit 업데이트 시 preset 재정합 책임자 지정.

## 2. 모듈/스펙 골격
```bash
mkdir -p sdd/specs sdd/templates
cp <KIT>/templates/module-spec.md  sdd/templates/spec-template.md
cp <KIT>/templates/MODULE_MAP.md   sdd/MODULE_MAP.md
cp <KIT>/templates/constitution.md .specify/memory/constitution.md
```
- `STRUCTURE.md`대로 모듈을 10여 개로 정의, `MODULE_MAP.md`에 등록. 도메인 placeholder를 실제 도메인으로 치환.

## 3. 검증 게이트 배선 (SSOT를 "실재"로) — 언어·런타임 무관
```bash
cp <KIT>/tooling/sdd.config.json       ./        # ← 어댑터 한 장(아래에서 언어 맞춤)

# 강제 지점(CI/CD)은 도구 무관 — 팀이 고른다. 게이트는 CLI라 어디서든 호출:
#  • 로컬/Makefile/git pre-push 훅/사내·클라우드 CI/CD 무엇이든 → <KIT>/tooling/ci-examples.md
#    (도구별로 "두 게이트 명령을 스텝에 넣는다"가 전부. 워크플로우 YAML 샘플도 그 문서에.)
#  (특정 CI/CD 도구·git 호스트 필수 아님. Spec Kit=spec 작성, CI/CD=게이트 실행 — 별개.)

# 게이트 런타임 — 하나만 선택(동작 동일·전부 검증):
#  (a) 사실상 모든 언어 커버, 권장: Go 단일 정적 바이너리 — 소비자는 Go 불필요
#      릴리스(sdd-gate-release.yml)에서 받은 자기 OS/arch 바이너리를 배치:
cp <받은>/sdd-gate-<os>-<arch>  scripts/sdd-gate && chmod +x scripts/sdd-gate
#      → scripts/sdd-gate fr | ownership | run <stage>   (인터프리터 0, Windows 포함)
#      (직접 빌드: cd <KIT>/tooling/go-gate && CGO_ENABLED=0 go build -o sdd-gate .)
#  (b) 빌드 없이 즉시: POSIX 셸판 한 파일 (필요: sh+grep+awk+jq)
cp <KIT>/tooling/sdd_gates.sh scripts/
#      → sh scripts/sdd_gates.sh fr | ownership | run <stage>
#  (c) Python 스택 편의(Node 0): cp <KIT>/tooling/sdd_gates.py scripts/
#  (d) JS/TS 스택 편의(Python 0): Node판 네 파일
cp <KIT>/tooling/sdd-config.mjs <KIT>/tooling/check-fr-coverage.mjs \
   <KIT>/tooling/check-ownership.mjs <KIT>/tooling/sdd-run.mjs scripts/
```
> **어떤 언어 런타임도 강요하지 않는다.** Go·C·Rust 등은 (a) 바이너리면 인터프리터 0으로 돈다(크로스컴파일·정적 검증됨). 배포 파이프라인 없이 즉시 돌릴 땐 (b) 셸판(실증: `go` 미설치로 Go 프로젝트 게이트 통과). 이미 Python/Node가 있으면 (c)/(d).
**언어 맞춤(핵심):** 루트의 `sdd.config.json`을 프로젝트 언어로 바꾼다 — `tooling/sdd.config.presets.md`에서 해당 언어 블록 복사(`testFileRegex`·`scanDirs`·`ignoreDirs`·`ownershipCategories`·`specIdPrefixes`·`commands`). JS/TS면 기본값 그대로.
- ⚠ **`specIdPrefixes`(기본 `["SPEC"]`):** `FEAT`/`TEST`/`INFRA` 등 새 spec 접두어를 쓰면 **반드시 여기 등록**(예: `["SPEC","TEST","INFRA","FEAT"]`). 안 하면 그 접두어 spec들이 FR 게이트에서 **조용히 누락**된다(실제 사례 있음 — 등록만이 유일한 차단책).
- `commands`에 그 언어의 `setup/lint/typecheck/test`를 넣는다(예: Python `pytest -q`, Go `go test ./...`). CI/CD는 `<게이트> run <stage>`로 그 명령을 실행하므로 **워크플로우 본체는 손대지 않는다**(도구별 예시: `ci-examples.md`). 미설정 stage는 건너뜀.
- JS/TS 프로젝트만 해당: `npm i -D vitest vite-tsconfig-paths @vitest/coverage-v8` + `cp <KIT>/tooling/vitest.config.ts ./`.

(선택) package.json scripts(JS 프로젝트 편의):
```json
"check:fr": "node scripts/check-fr-coverage.mjs",
"check:fr:strict": "node scripts/check-fr-coverage.mjs --strict",
"check:ownership": "node scripts/check-ownership.mjs",
"check:ownership:strict": "node scripts/check-ownership.mjs --strict"
```
- 테스트에 `@covers <SPEC-ID>/FR-NNN` 태그를 달아 FR↔test를 연결(주석 스타일 자유 — `//`·`#`·`--`).
- 각 spec에 `## Ownership`(config의 `ownershipCategories`와 같은 헤더)을 선언 → `check:ownership`이 **구조적 중복(같은 키 2 spec 소유)** 을 CI에서 차단(`STRUCTURE.md` 소유권 유일성 규칙).
- **CI가 green인지 확인** — config의 lint/typecheck/test가 기존 코드에서 통과하는지 먼저 점검(참조 프로젝트는 lint 4 errors로 red였음 → 적용 시 흔한 함정).

## 4. 루프 가동
`METHODOLOGY.md` 0~8단계. 신규=`/specify`→`/clarify`→`/plan`→`/tasks`→`/analyze`→Superpowers TDD→머지→`/converge`. 코드 우선 hotfix=`/converge`로 갭 표면화→`/specify`(update)로 LLM이 spec 갱신→사람 승인.

## 5. 채택 순서 (점진)
incremental FR 게이트로 시작 → spec별 테스트가 갖춰지면 strict로 승격. 모든 spec이 strict 통과하면 SSOT가 완전히 기계 보장됨.
