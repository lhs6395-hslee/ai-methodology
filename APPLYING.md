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
- `STRUCTURE.md`대로 **이 레포의 단일 모듈**(bounded context 하나)을 정의하고 `MODULE_MAP.md`(단일 모듈 매니페스트)에 등록. 도메인 placeholder를 실제 도메인으로 치환. 모듈이 더 필요하면 **레포를 나눈다**(MSA — 다중 모듈이면 Phase 2 계약 프로파일).

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

## 3b. (선택) 하네스 — 인터랙티브 spec↔code sync
`--gate=node`로 init하면 `scripts/sdd-sync.mjs`·`/sdd-sync` 스킬·`scripts/sdd-pre-push.sh`가 설치된다(계약: 키트 `HARNESS.md`). spec/코드 변경 후 또는 수시로 `/sdd-sync`로 R1~R4(spec→code·code→spec·dedup+입도·상시 sync)를 사람 확인 게이트로 정렬한다. push마다 점검하려면: `ln -sf ../../scripts/sdd-pre-push.sh .git/hooks/pre-push`(기본 비차단, `SDD_SYNC_BLOCK=1`로 차단).

## 4. 루프 가동
`METHODOLOGY.md` 0~8단계. 신규=`/specify`→`/clarify`→`/plan`→`/tasks`→`/analyze`→Superpowers TDD→머지→`/converge`. 코드 우선 hotfix=`/converge`로 갭 표면화→`/specify`(update)로 LLM이 spec 갱신→사람 승인.

## 5. 채택 순서 (점진)
incremental FR 게이트로 시작 → spec별 테스트가 갖춰지면 strict로 승격. 모든 spec이 strict 통과하면 SSOT가 완전히 기계 보장됨.

---

## 채택 후 궤도 한 바퀴 (운영법)

> 채택(`sdd-init`) 완료 후 일상 개발에서 hook·게이트가 실제로 어떻게 돌아가는지 — 단계별 + 실측 출력.

### ① 세션 시작 — SessionStart hook

프로젝트 디렉토리에서 Claude Code 세션을 열면 `SessionStart` hook이 방법론 요약·궤도·진입 규칙을 컨텍스트에 주입한다(세션당 1회). 아래가 실제 출력(툴링 `sdd-session-context.sh` 실측):

```
[SDD 방법론 — 이 프로젝트는 채택된 강제 궤도 위에서 돈다]
궤도: spec → code → test → sync (이탈은 hook·게이트가 되돌림)
진입 규칙(새 기능/수정 시 반드시):
  1) MODULE_MAP.md 대조 — 기존 spec과 겹치면 그 spec 개정, 아니면 새 spec
  2) spec 위치 = sdd/specs/ (docs/superpowers/specs/ 아님)
  3) PREFIX 표준 = SPEC / INFRA / TEST 만 (FEAT 등 임의 생성 금지)
  4) FR은 EARS, 테스트는 @covers <PREFIX>-NNN/FR-NNN
  5) 코드 전에 spec부터 — superpowers 기본 흐름 대신 이 프로젝트 규약
게이트: check-fr-coverage·check-ownership·check-spec-cohesion·check-spec-consistency
동기화: /sdd-sync (drift 점검), pre-push 훅
```

**왜:** superpowers 스킬이 기본 경로(`docs/superpowers/specs/`)로 이끌고, FEAT 같은 임의 PREFIX를 만드는 이탈이 실제로 반복됐다. hook이 컨텍스트에 명시해야 모델이 프로젝트 규약을 따른다.

### ② 새 기능 — MODULE_MAP 대조 → spec → TDD

1. `sdd/MODULE_MAP.md`를 열고 기존 spec과 겹치는지 확인 — 겹치면 **그 spec 개정**(새 spec 금지), 안 겹치면 신규.
2. spec 위치: **`sdd/specs/PREFIX-NNN.md`** (PREFIX는 `SPEC`/`INFRA`/`TEST` 중 하나).
3. FR은 EARS 패턴으로(`WHEN … THE SYSTEM SHALL …`), 키 형식 규칙:
   - **Entity** → 스키마 식별자 그대로 + `trim().toLowerCase()` (`pjt_projects` — 단복수 임의변환 금지).
   - **Surface** → `<METHOD uppercase> <path lowercase>`, path param `{name}` 표준형(`POST /api/recommend/{id}`).
   - **Capability** → `entity.verb` (점 1개, 소문자, verb는 허용집합 — CRUD 기본 + config `capabilityVerbs`).
4. `## Ownership` 절 선언 후 TDD(테스트 먼저 → RED → GREEN → `@covers`).

**1 spec = 1 aggregate 경계 규칙:** 한 spec은 한 aggregate root(독립 생성·삭제되는 핵심 Entity)만 소유한다. 다른 aggregate는 `## Dependencies`로 참조. 새 FR이 *어느 aggregate를 변경하는가*로 소속 spec을 결정한다.

### ③ 코드 편집 — PreToolUse 체크리스트

`src/lib/app` 경로에 `Write`/`Edit` 도구가 쓰일 **때마다** `PreToolUse` hook이 체크리스트를 주입한다(비차단). 실측 출력(`sdd-edit-check.sh` 실행):

```
[SDD 편집 체크 — 코드 건드리기 전 확인]
  □ MODULE_MAP 대조했나 (기존 spec 개정 vs 새 spec)
  □ 이 변경에 대응하는 FR 있나 — 없으면 sdd/specs/에 spec부터
  □ PREFIX 표준(SPEC/INFRA/TEST)인가
  □ 테스트에 @covers <PREFIX>-NNN/FR-NNN 계획했나
```

### ④ 커밋 — pre-commit 차단

`git commit` 시 pre-commit 훅이 스테이징된 코드에 대응 FR·ownership·PREFIX를 검사한다.

**PREFIX 위반(미등록 접두어) — exit 1 차단 실측:**
```
✗ PREFIX 위반:
  ✗ 미등록 접두어 "FEAT" (FEAT-001.md) — 표준 SPEC/INFRA/TEST. 임의 생성 금지, 필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가
```

**ownership 중복 — exit 1 차단 실측:**
```
Ownership 게이트: spec 3개 중 3개가 Ownership 선언.
✗ 중복 소유(구조적 중복) 3건:
  [Entities] "recommendation" ← SPEC-001 + SPEC-002  → 한 spec으로 통합/개정 필요
  [Surfaces] "POST /api/recommend/{id}" ← SPEC-001 + SPEC-002  → 한 spec으로 통합/개정 필요
  [Capabilities] "recommendation.create" ← SPEC-001 + SPEC-002  → 한 spec으로 통합/개정 필요
```

**FR coverage 경고 — pre-commit은 incremental(경고, 비차단) 실측:**
```
FR coverage gate — specs:1 FRs:2 covered:1 mode:incremental config:sdd.config.json
⚠ SPEC-001: 1/2 FRs covered — missing FR-002 (incremental: warn only)
```
> pre-commit은 `--strict` 없이 실행 → partial coverage는 경고만(비차단). **PREFIX 위반·ownership 중복만 pre-commit에서 hard-block.** FR 완전 적용(`--strict`)은 CI 또는 `node scripts/check-fr-coverage.mjs --strict` 수동 실행 시.

**해소법:** 메시지가 가리키는 spec/키를 고치고 재커밋. PREFIX 위반이면 `sdd.config.json`의 `specIdPrefixes`에 등록(표준 밖이면 `prefixRationale`에 사유 필수). ownership 중복이면 한 spec으로 통합. FR 누락이면 테스트에 `@covers` 추가.

### ⑤ 푸시 — pre-push sdd-sync drift 점검

`git push` 시 pre-push 훅이 `sdd-sync`로 drift를 일괄 점검한다. drift가 있으면 안내(기본 비차단):

```
SDD sync 리포트 — detector 일괄 실행 (HARNESS.md 규칙표)

● R1 spec→code: ✓ clean
● R2 code→spec: ⚠ 확인 필요
    [check-converge-drift.mjs] · 코드 1건 변경인데 스펙 무변경
● R3 dedup+입도+완전성+일관성: ✓ clean

요약: 확인 필요 — R2 code→spec → '/sdd-sync'로 의사결정
↑ spec↔code drift 가능 — '/sdd-sync'로 정렬 검토. (push는 계속됨)
```

**해소:** `/sdd-sync` 실행 → 하네스가 의사결정을 안내(spec 개정/무시/새 spec).

### ⑥ 이탈 대응 — 게이트 실패 메시지대로

| 게이트 메시지 | 해소 |
|---|---|
| `✗ PREFIX 위반 — 미등록 접두어 "FEAT"` | `specIdPrefixes`에 등록 + 표준 밖이면 `prefixRationale`에 사유 |
| `✗ 중복 소유 — SPEC-001 + SPEC-002` | 두 spec 중 하나로 ownership 이전, 나머지에서 제거 |
| `✗ missing FR-002` | 테스트에 `// @covers SPEC-001/FR-002` 추가 |
| `⚠ code→spec drift` | `/sdd-sync` → spec 개정 또는 의도적 무시 선택 |
| `⚠ 미등록 verb "recommend"` | `sdd.config.json` `capabilityVerbs`에 `"recommend"` 추가 |
