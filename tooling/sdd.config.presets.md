# sdd.config.json 언어 프리셋 (어떤 언어든)

> `sdd.config.json` **한 장**만 바꾸면 게이트와 CI가 그 언어/스택에 맞게 동작한다. 게이트 자체는 텍스트 파서라 코드는 손대지 않는다. 아래에서 프로젝트 언어 블록을 골라 복사해 루트에 두면 끝.
>
> **게이트 런타임(4판):** 사실상 모든 언어를 커버하는 권장 배포물은 **Go 단일 정적 바이너리**(`go-gate/`, `CGO_ENABLED=0`) — 소비자는 Go조차 없이 `./sdd-gate fr|ownership|run <stage>`. 빌드 없이 즉시 돌릴 땐 **`sh sdd_gates.sh …`**(POSIX 셸, `sh`+`grep`+`awk`+`jq`). 핵심 3커맨드·ID 문법은 4판 동일하고, **보강게이트·spec-first까지의 전 게이트는 Node·Python 두 판**(패리티 테스트 강제 — 매트릭스: `ci-examples.md`). 특정 런타임을 강요하지 않는다.
>
> `@covers` 태그는 **주석 스타일과 무관**(`// @covers …`·`# @covers …`·`-- @covers …` 모두 인식). 바꿔야 하는 건 `testFileRegex`·`scanDirs`·`commands`뿐이다.

## JavaScript / TypeScript (기본값)
```json
{
  "scanDirs": ["src", "tests"],
  "testFileRegex": ["\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs)$"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "npm ci", "lint": "npm run lint", "typecheck": "npx tsc --noEmit", "test": "npm test" }
}
```

## Python
> Python-only 프로젝트는 **Node 없이** `python scripts/sdd_gates.py <게이트>`로 돌린다 — fr·ownership·run뿐 아니라 cohesion·completeness·consistency·adequacy·orphan·converge·specsync까지 **Node판 전 게이트 패리티**(표준 라이브러리만, 3.7+).
```json
{
  "scanDirs": ["src", "tests"],
  "testFileRegex": ["(^|/)test_.*\\.py$", "_test\\.py$", "_spec\\.py$"],
  "ignoreDirs": ["__pycache__", ".venv", "venv", ".git", "build", "dist", ".mypy_cache", ".pytest_cache"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "pip install -r requirements.txt", "lint": "ruff check .", "typecheck": "mypy .", "test": "pytest -q" }
}
```

## Go
```json
{
  "scanDirs": ["."],
  "testFileRegex": ["_test\\.go$"],
  "ignoreDirs": ["vendor", ".git", "bin"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "go mod download", "lint": "go vet ./...", "typecheck": "go build ./...", "test": "go test ./..." }
}
```

## Rust
> 러스트는 테스트가 소스 파일 안에 인라인(`#[cfg(test)]`)인 경우가 많아 `.rs` 전체를 스캔하고 `@covers`를 거기 단다.
```json
{
  "scanDirs": ["src", "tests"],
  "testFileRegex": ["\\.rs$"],
  "ignoreDirs": ["target", ".git"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "cargo fetch", "lint": "cargo clippy -- -D warnings", "typecheck": "cargo check", "test": "cargo test" }
}
```

## Java / Kotlin (Gradle·Maven)
```json
{
  "scanDirs": ["src/test", "src/main"],
  "testFileRegex": ["Test\\.(java|kt)$", "Tests\\.(java|kt)$", "IT\\.(java|kt)$", "Spec\\.kt$"],
  "ignoreDirs": [".gradle", "build", "target", ".git", "bin", "obj"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "./gradlew dependencies", "lint": "./gradlew checkstyleMain", "typecheck": "./gradlew compileJava", "test": "./gradlew test" }
}
```

## Ruby
```json
{
  "scanDirs": ["app", "lib", "spec", "test"],
  "testFileRegex": ["_spec\\.rb$", "_test\\.rb$"],
  "ignoreDirs": ["vendor", ".git", "tmp", "coverage"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "bundle install", "lint": "bundle exec rubocop", "test": "bundle exec rspec" }
}
```

## C# / .NET
```json
{
  "scanDirs": ["src", "tests"],
  "testFileRegex": ["Tests?\\.cs$", "Spec\\.cs$"],
  "ignoreDirs": ["bin", "obj", ".git", "packages"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "setup": "dotnet restore", "typecheck": "dotnet build --no-restore", "test": "dotnet test" }
}
```

## 테스트 환경 tier — `commands.test`(로컬 안전) vs `commands.smoke`(인프라) — CSP 무관
> 로컬엔 인프라 자격증명·네트워크 접근이 없을 수 있다. **로컬 강제(git 훅·TDD)가 인프라 테스트를 실행하지 않도록** 테스트 명령을 두 tier로 나눈다(METHODOLOGY "검증은 환경으로 계층화된다" — 능동적 가능성 판정). `sdd-run`은 임의 stage를 실행하므로 코드 변경 없이 `smoke` stage가 돈다.
> - `commands.test` = **로컬 안전**(유닛+목)만. 로컬·pre-commit·TDD가 이것만 본다.
> - `commands.smoke` = **인프라**(관리형 DB·오브젝트 스토리지·큐·클라우드 API·사설 네트워크 자원 — 어느 CSP든). 자격증명·도달성 있는 곳(개발서버·CI)에서만 `sdd-run smoke`.
> - **로컬 가능성은 가정 말고 판정(사용자 확인 + 실제 probe):** 공개 엔드포인트+자격증명(오브젝트 스토리지·서버리스·모니터링 API 등)은 로컬에 권한 있으면 가능 → 가드가 probe(인증/연결 시도)로 분기. 사설·네트워크 격리(VPC·사설 서브넷 내 DB·캐시, 온프렘 내부)는 로컬 도달 불가 → 개발서버·CI 전용. **probe 실패 시 자원·사유를 skip 메시지·회계에 명시**(조용한 통과 금지).

test/smoke 분리 예(Python — 도구·CSP만 갈아끼우면 동일):
```json
{ "commands": {
  "test":  "python3 -m unittest discover -s tests -p 'test_*_unit.py'",
  "smoke": "SDD_SMOKE=1 python3 -m unittest discover -s tests/smoke"
} }
```
probe 기반 skip 가드(로컬에서 **실패가 아니라 사유 포함 skip**):
```python
import os, unittest
# 사설·격리 자원(예: VPC 내 관리형 DB) — 환경 플래그로, 로컬은 항상 skip:
@unittest.skipUnless(os.getenv("SDD_SMOKE"), "infra test — 개발서버/CI에서만(로컬 도달 불가)")
class TestPrivateDbMigration(unittest.TestCase): ...

# 공개 엔드포인트 자원 — 실제 접근 probe로 분기(권한/도달 실패 시 사유 포함 skip):
def _reachable():
    try:
        client.ping()   # CSP/SDK 무관 최소 시도: 스토리지 head / DB SELECT 1 / API describe
        return True, ""
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"   # 권한 없음·도달 불가 등 실제 사유
_ok, _why = _reachable()
@unittest.skipUnless(_ok, f"인프라 접근 불가 → 개발서버/CI 검증. 사유: {_why}")
class TestObjectStore(unittest.TestCase): ...
```
JS/TS는 `commands.smoke`에 `SDD_SMOKE=1 vitest run --project smoke`, 테스트는 probe 결과로 `describe.skipIf(!reachable)(…)`.
> CI·개발서버는 `sdd-run test` + `sdd-run smoke` 둘 다, 로컬·pre-commit은 `test`만. 인프라 FR은 smoke 증거(`@verifies`→`smokeManifest`) 또는 deferred(사유 명시)로 회계된다(로컬 unit 강제 없음).

## 인프라 전용 레포 (IaC — CSP 무관: AWS / GCP / Azure / 온프렘)
> 앱 코드가 없고 IaC만 있는 경우. `@covers`를 정책 테스트(OPA/conftest·terratest 등)에 달고, **로컬 안전**(fmt·validate·conftest — 자격증명 불요)은 `commands.test`, **그 환경의 live drift 검증**(자격증명 필요)은 `commands.smoke`에 넣는다(`SSOT.md` §5b). 아래는 Terraform 예시 — IaC 도구·클라우드만 갈아끼우면 동일하게 동작한다.
```json
{
  "scanDirs": ["modules", "tests", "policy"],
  "testFileRegex": ["_test\\.go$", "\\.rego$", "\\.tftest\\.hcl$"],
  "ignoreDirs": [".terraform", ".git"],
  "ownershipCategories": ["Resources", "Surfaces", "Capabilities"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "lint": "terraform fmt -check && tflint", "typecheck": "terraform validate", "test": "conftest test .", "smoke": "terraform plan -detailed-exitcode" }
}
```
> **commands.smoke(드리프트 검증) CSP/도구별 대안** — 환경에 맞게 바꾼다:
> - **IaC 도구:** Terraform `plan -detailed-exitcode` · Pulumi `pulumi preview --expect-no-changes` · AWS CDK `cdk diff` · Crossplane/Config Connector 상태.
> - **AWS:** `aws cloudformation detect-stack-drift` / `aws <svc> describe-*`.
> - **GCP:** `gcloud <svc> describe` / `gcloud asset`.
> - **Azure:** `az deployment group what-if` / `az <svc> show`.
> - **Kubernetes(어느 CSP/온프렘이든):** `kubectl diff -f ...` / ArgoCD·Flux sync 상태.
> - **온프렘/VM:** Ansible `--check`(드리프트), 구성관리 dry-run.
> `ownershipCategories`의 `Resources`는 RDB·NoSQL·버킷·큐·함수 등 **어떤 리소스 종류든** 소유 키로 쓴다(특정 DB/CSP 가정 없음).

---

## 필드 의미 (요약)
| 필드 | 무엇 | 기본값 |
|---|---|---|
| `specDir` | spec(.md) 디렉토리 | `sdd/specs` |
| `scanDirs` | `@covers` 태그를 찾을 루트들 | `["src","tests"]` |
| `ignoreDirs` | 순회 제외 폴더명 | 언어별 빌드/의존 폴더 다수 |
| `testFileRegex` | 테스트 **파일명** 매칭 정규식(소스 문자열) 배열 | JS/TS |
| `ownershipCategories` | 구조적 중복 키 종류 | `Entities/Surfaces/Capabilities` |
| `ownershipCategoryRoles` | 카테고리 → 역할 매핑(SPEC-001 FR-010) — `{"<카테고리>": "entity"\|"surface"\|"capability"}`. 판정 코어(entity 실재·capability 귀속·키 앵커·Ownership 맵)는 **역할**로 동작하는데, 비면 카테고리 **이름**을 정규식으로 추측한다(`/entit/i`·`/surface/i`·`/capabilit/i`). 즉 `Modules`·`Datasets`처럼 이름이 다른 카테고리를 쓰면 추측이 실패해 **그 가드들이 조용히 inert**가 된다 — 웹 기본값(`Entities/Surfaces/Capabilities`)이 아니면 반드시 선언하라. 킷 자신은 `{Modules:"entity", Symbols:"surface"}` | `{}`(=이름 추측) |
| `capabilityVerbs` | Capability 키 `<entity>.<verb>`(정본 형식 — SPEC-024·DEDUP §정규화)의 verb 어휘를 CRUD 기본(create/read/update/delete/**list**)에 더할 도메인 동사(SPEC-001). 배열(레거시)뿐 아니라 `{동사:사유}` 객체(entityRegistry와 동형 — 빈 사유는 항상 에러)도 받는다. 어휘는 비어 있어도 항상 닫혀 있다(CRUD ∪ `capabilityVerbs`) — 미등록 verb는 `validateKey`가 형식 위반으로 지목하되 **기본 ⚠ warn·exit 0**이고, 전용 knob `capabilityVerbPolicy`가 `hard`면 전역 `--strict` 없이도 exit 1(권장 종착지) | `[]` |
| `capabilityVerbPolicy` | 미등록 capability verb의 강도 — 전역 `--strict`와 독립(`off`\|`advisory`\|`hard`). 등록된 도메인 verb 개수를 매 실행 표면화 | `"advisory"` |
| `surfaceFormat` | Surface 키 형식(SPEC-001) — `"http"`(`<METHOD> <path>`·`event:`·`job:`)·`"path"`(Next.js 등 파일 라우팅·IaC의 파일경로 표면)·`"any"`(형식검증 생략). normalizeKey/validateKey가 이 값으로 분기 | `"http"` |
| `surfacePathParam` | Surface path param 표준 표기(SPEC-001) — 키 정규화 시 경로 파라미터를 이 토큰으로 환원해 비교(`/users/{name}` 형태) | `"{name}"` |
| `maxKeysPerCategoryPerSpec` | spec 입도(cohesion) 임계 — 한 spec이 한 카테고리에서 이 수를 초과 소유하면 under-fragmentation 신호로 분할 권고(advisory, check-ownership dedup의 거울상) | `4` |
| `maxFRsPerSpec` | spec 입도(cohesion) 임계 — 한 spec의 FR 수가 이를 초과하면 여러 기능 욱여넣기 신호로 분할 권고(advisory)  **래칫 감시 대상**(SPEC-027) — 값을 올리는 것은 완화라 차단된다: 캡 초과는 분할·병합으로 해소한다 | `8` |
| `maxAggregateRootsPerSpec` | cohesion: 한 spec이 소유 가능한 aggregate root(Entity 키) 최대 수(SPEC-002). 기본 1(1 spec=1 aggregate) — 루트+자식 표를 함께 소유하는 모델이면 상향 | `1` |
| `supportLayerSpecs` | aggregate를 **가질 수 없는** 계층(공유 설정·빌드 배선)의 등록부 — `{ "<SPEC-ID>": "<사유>" }`. cohesion의 `entity(min)` **하나만** 면제하고 FR·키 캡은 그대로다. 없으면 교착이 생긴다: entity 0개 → `entity(min)`이 막음 → 새 스펙도 같은 이유로 막혀 **분할 불가** → 남은 출구가 캡 상향(완화, 래칫 차단)뿐. 사유 필수·낡은 등록 에러·entity 소유 스펙 등록 에러이며, 목록은 clean일 때도 부채로 출력된다 | `{}` |
| `changeLogFrRefPolicy` · `changeLogNewVerbs` · `changeLogReviseVerbs` · `changeLogRetireVerbs` | Change Log가 선언한 FR의 **실재** 대조(SPEC-037) — `FR-018 신규`라고 적었으면 그 FR이 본문에 있어야 한다. 실측 공백: 선언만 있고 본문이 없어 3개 surface의 계약이 몇 달간 SSOT 밖에 있었다(`check-spec-sync`는 FR/Edge Cases/Change Log **택1**로 만족되고 — 그 탈출구는 설계다 — 결번 advisory는 "폐기 잔분일 수 있음"이라 결함을 정당한 흔적과 같은 문장으로 말했다). 잡는 것은 **거짓 선언 하나**이고 기존 탈출구는 그대로다. 선언 어휘는 프로젝트마다 다르므로(킷 `신설`, 다른 곳 `신규`) knob으로 교체 — 어휘가 안 맞으면 게이트가 통째로 inert가 되고 그 0건은 진짜 0건과 구분되지 않는다. **권장 종착지 = `hard`**(도입 시 부채가 있으면 advisory 경유) | `"advisory"` · `null`×3 |
| `duplicateLogicPolicy` · `duplicateLogicAllow` · `duplicateLiteralPatterns` · `duplicateLiteralMinLength` · `duplicateLiteralFileRegex` · `duplicateLogicIncludeTests` · `duplicateLogicCommand` · `duplicateLogicTimeoutMs` | **구현 중복**(SPEC-038, R13) — dedup의 거울 밖이다: dedup은 *선언 단위*(같은 파일·키를 두 스펙이 주장), 이쪽은 *구현 단위*(같은 규칙을 두 코드가 실현). ①**결정적 층** = 동일 규칙 리터럴이 2곳 이상(같은 파일 안의 반복도 센다) → 강도대로 차단. ②**확률적 층** = `duplicateLogicCommand`로 주입한 도구(jscpd·similarity-ts)의 후보 → **어떤 강도에서도 비차단**(AST 파서를 킷이 번들하면 의존성 0·언어 무관을 잃으므로 위임한다). 오탐 억제 3겹이 기본: 대상 확장자 제한 · 문자열 리터럴 선제 제거 · `/*`·`//` 배제, 그리고 테스트 파일 제외 + 길이 하한. 정당한 중복은 `duplicateLogicAllow`에 **사유 필수**로 등록하고 낡은 면제는 상시 표면화. 실측 계기: 병렬 서브에이전트가 같은 규칙을 세 갈래로 만들었고 게이트 4종 전부 green이었다 — 유발 조건은 병렬 실행의 **정상 경로**다(규범은 principles §5b). **권장 종착지 = `hard`** | `"advisory"` · `{}` · `null` · `8` · `null` · `false` · `null` · `120000` |
| `coversBacklinkPolicy` · `coversBacklinkListCap` | **`@covers` 양방향 결속**(SPEC-039, R1b) — 기존 R1(dangling)은 **단방향**이다: 태그가 가리키는 FR이 실재하는지만 본다. **실재는 동일성이 아니다** — 실측: 태그가 없는 FR을 가리켜 R1이 잡았는데 **다른 세션이 무관한 기능**을 그 번호로 착지시킨 순간 위반이 사라지고 회계가 "unit으로 커버됨"을 보고했다. 대조 축은 FR 쪽 `[검증: <경로>]` 관습을 그대로 쓴다(새 문법 없음). 정확 일치·글롭·디렉토리 지목을 모두 인정하고, **FR에 `[검증]`이 아예 없으면 위반이 아니라 미표기 부채**로 따로 센다 — 섞으면 도입 첫날 소음이 본 신호를 덮고 사람이 정책을 끈다(킷 자기적용 미표기 283건). **권장 종착지 = `hard`**(표기 정리 후) | `"advisory"` · `12` |
| `assertionPatterns` | 테스트 "단언" 토큰 정규식 배열(test-adequacy 게이트, SPEC-002) — 매치 0인 테스트 파일은 no-assert advisory(--strict hard). 언어 무관 폭넓은 기본 | 단언 토큰 3종(expect·assert·should·require·t.Error…) |
| `surfaceGlobs` | orphan-surface 게이트가 "표면 파일"로 볼 경로 정규식 배열(SPEC-003) — 채우면 어떤 스펙 `## Ownership Surfaces`에도 안 걸린 표면 파일을 orphan으로 검출(advisory·--strict hard). `[]`면 게이트 비활성 | `[]` |
| `specIdPrefixes` | spec 파일·ID·`@covers`에서 인정할 ID 접두어(표준 4종 = SPEC 제품·INFRA 자원·CICD 전달·TEST 테스트). 표준 밖 접두어는 `prefixRationale` 사유 필수(미등록은 fr 게이트가 exit 1) | `["SPEC","INFRA","TEST","CICD"]` |
| `prefixClassExemptions` | 접두어↔클래스 정합(SPEC-012) 면제 — `{"<SPEC-ID>":"<사유>"}`. 소유 실파일이 전적으로 한 인프라 클래스(iac→INFRA·ci→CICD)인데 그 접두어가 아니면 fr 게이트가 exit 1인데, 정당한 예외를 사유와 함께 선언(빈 사유·미존재 ID는 에러, 미사용 면제는 warn) | `{}` |
| `requirementIdPrefixes` | 요구 ID 접두어 — FR 선언·`@covers`·집계·spec-sync 판정의 문법이 전부 여기서 파생(레터 서픽스 1자 포함). 확장 예: `["FR","NFR"]` | `["FR"]` |
| `strictSpecs` | 전역 `--strict`의 점진 브리지 — 등재 spec만 R2 하드(모든 FR unit 커버 필수, smoke 대체 불가). 미존재 ID는 에러 | `[]` |
| `requireAccounting` | R3: 모든 FR이 unit ∨ smoke ∨ deferred로 회계돼야 함("조용히 미검증" 제거) | `false` |
| `smokeManifest` | 회계 매니페스트 JSON 경로 — `"SPEC-NNN/FR-NNN": {method,evidence}` 또는 `{method:"deferred",reason}`. dangling·빈 값은 fr 게이트가 exit 1(사유 존재만 강제) | `null` |
| `smokeScanDirs` | 검증 태그(smoke 증거)를 스캔할 루트들 — CI 정의·스크립트·runbook이 scanDirs 밖이면 확장(SPEC-010). 미설정이면 `scanDirs` 재사용 | `null` |
| `derivationManifest` | 재도출 소스 회계 매니페스트 JSON 경로 — 소스 9클래스가 전부 `{status: mapped\|none\|deferred, evidence\|reason}`으로 회계돼야 함. 실재하는데 none 선언은 derivation 게이트가 exit 1(SPEC-009). brownfield readopt에 켜기 | `null` |
| `derivationClassGlobs` | 검출 가능 클래스(iac·ci·ops-docs)의 탐지 글롭(클래스 단위 교체). terraform/k8s/CI 정의가 표준 경로 밖이면 조정 | 내장 기본 — 정의 파일 + **동반·보조 파일**까지: iac = tf/tfvars/hcl·k8s/helm/manifests/kustomization·Dockerfile/.dockerignore/compose, ci = workflows/actions·gitlab-ci·Jenkinsfile·circleci·azure·bitbucket·buildkite·cloudbuild·travis·drone |
| `specSyncUnownedPolicy` | 어느 스펙 `Files`에도 미매치인 변경 파일 정책 — `silent`(현행)·`warn`·`error`(staged 차단=closed-world). 예외는 `specSyncExemptGlobs`로 선언. **소비 프로젝트 권장 시작값: `warn`**(안정 후 `error`) | `"silent"` |
| `specSyncExemptGlobs` | `specSyncUnownedPolicy` 예외 glob(SPEC-003) — `Files` glob이 과포함한 생성물·락파일 등. 통과하되 영속 흔적 없음(목록 자체가 config 리뷰 대상). **`sdd.config.json` 자신은 넣지 말 것** — config는 강제의 통제면이라 스펙 소유(예: config 어댑터 스펙 Files 편입)로 변경 흔적을 강제한다(감사 T1; spec-sync는 staged 판정을 HEAD 시점 config로 내려 자기약화 커밋을 방지). **`"scripts/**"`는 채택 시 넣을 것(권장)** — `sdd-init.sh`가 복사한 킷 소유 게이트 사본이라 이 프로젝트 스펙이 소유할 대상이 아니다(이슈 #21 M-14; 안 넣으면 `/sdd-update` 재실행마다 unowned 경고가 반복돼 진짜 소유 포기 신호를 가린다) | `[]` |
| `capabilityOwnershipPolicy` | Capability 귀속(SPEC-024) — capability `x.verb`는 entity `x`를 **소유한** 스펙만 선언 가능(스펙 경계=entity 기준; entity 0개+capability 소유=기술 계층 스펙 위반). entity·capability 카테고리가 둘 다 있을 때만 판정. `off`·`advisory`(기본)·`hard` | `"advisory"` |
| `frKeyAnchorPolicy` | FR 키 앵커(SPEC-023) — FR 선언 라인의 평문 bold를 그 스펙의 Ownership∪Dependencies 키와 대조(bold=키 앵커 전용, 코드 스팬은 리터럴). **각 굵은 키는 카테고리 마커 필수: entity `(E)`·surface `(S)`·capability `(C)`**(FR-005; 글자는 `frAnchorMarkers`). `off`(판정 안 함)·`advisory`(경고)·`hard`(exit 1). **권장 종착지 = `hard`**; `off`/`advisory`는 마이그레이션 중 임시 상태 — 기존 수사적 bold·마커 누락을 `/sdd-migrate`로 정리한 뒤 `hard`로 승격(update가 백로그 0에서 승격 권장) | `"off"` |
| (서식 규범) | **백틱 = entity 키 혹은 그 종속**(컬럼·필드·enum 값). **볼드+마커 = 앵커**. surface·capability 키를 백틱에 두면 FR-006 위반이고, entity 키는 반대로 백틱이 정본이다(2026-07-28 owner 결정). 즉 서식이 키의 종류를 말한다 — 데이터 모델인지 앵커인지. CLI 플래그·정책 enum 값·태그 문법(`--strict`·`advisory`·`@covers`)은 키가 아니므로 백틱을 그대로 쓴다. ⚠ 경로·config 노브를 이탤릭으로 분리하는 안은 **검토 후 보류**(근거: `METHODOLOGY.md` §서식 — 실측상 목표 도달 불가 + 글롭 `*` 충돌 + 경로 모노스페이스 손실) | knob 아님(규범) |
| `frAnchorMarkers` | FR 굵은 키의 카테고리 마커 글자(SPEC-023 FR-005) — `{entity, surface, capability}` → 각 종류의 1글자. 기본 `{entity:"E", surface:"S", capability:"C"}` — 글자는 카테고리 이름(Entities/Surfaces/Capabilities)의 머리글자. 프로젝트가 조정 가능(예: Surfaces를 라우트 전용으로 쓰면 `{surface:"R"}`) | `{entity:"E",surface:"S",capability:"C"}` |
| `entitySchemaBackingPolicy` | Entity 스키마 백킹(SPEC-026) — 소유 `Entities`가 구조 SSOT(스키마)에 실재하는 식별자인지 대조(지어낸 개념 entity로 capability 귀속을 우회하는 것 차단). `off`(기본)·`advisory`·`hard`. **`entitySchemaSources`가 비면 inert**(대조할 스키마가 없음) — 아래 소스 어댑터 동반 필수. entity 카테고리 있을 때만 판정. **권장 종착지 = `hard`** | `"off"` |
| `entitySchemaSources` | 위 판정의 구조 SSOT 어댑터(인프라 무관) — `[{globs:[...], patterns:["정규식"]}]`. 각 패턴의 **캡처그룹 1**이 실재 entity 식별자. **모듈 문법(SPEC-029 ①)**: 항목을 `{kind:"spec-slug"}`로 두면 entity 실재의 근거가 **그 스펙 파일명의 슬러그**가 된다(`1 spec = 1 모듈` 레포용 — entity가 DB 테이블이 아니라 코드 모듈인 경우). 전역 집합이 아니라 **스펙별** 대조라서 두 스펙이 슬러그를 서로 바꿔 가져도 위반이다(키 유일성만으론 뒤바뀜을 못 잡는다). 글롭 소스와 배타가 아니라 함께 선언 가능. 스키마 종류별 예: Drizzle `[{globs:["src/db/schema.ts"],patterns:["pgTable\\(\"([a-zA-Z0-9_]+)\""]}]` · Prisma `[{globs:["prisma/schema.prisma"],patterns:["model\\s+([A-Za-z0-9_]+)"]}]` · SQL 마이그레이션 `[{globs:["migrations/**/*.sql"],patterns:["CREATE TABLE (?:IF NOT EXISTS )?\"?([a-z0-9_]+)"]}]` · proto `[{globs:["**/*.proto"],patterns:["message\\s+([A-Za-z0-9_]+)"]}]` | `[]` |
| `ownershipSourceRoots` | 심볼 문법(SPEC-029 ②)의 소스 루트 — surface 역할 키가 실재해야 하는 디렉토리들. 이 루트들 **아래**(재귀) 파일 또는 디렉토리 이름과 basename 매치한다(디렉토리도 표면일 수 있다 — `go-gate` 실측). 파일형이 아닌 표면(`POST /api/x`·`event:`·`job:`·`/path`)은 자동 제외되므로 HTTP 표면 레포에 오발동하지 않는다. 비면 `symbolRealityPolicy`가 inert | `[]` |
| `symbolRealityPolicy` | 위 심볼 문법의 강도 — 선언된 surface 키가 소스 루트에 실재하는지 **정방향** 판정(`off` 기본·`advisory`·`hard`). `check-orphan-surfaces`는 **역방향**(코드→선언)만 보므로 "선언된 표면이 실제로 있는가"는 이 knob 없이는 아무도 판정하지 않는다(감사 M-2). 불일치는 면제 목록이 아니라 **데이터 교정**으로 닫는다(예외 목록 없음). `hard` + 소스 루트 미선언은 거짓 안전이라 exit 1 | `"off"` |
| `entitySchemaExemptEntities` | 스키마엔 없지만 정당한 aggregate(외부 API 자원·이벤트 스트림 등) 면제 — `{"<entity>":"<사유>"}`. 빈 사유는 ownership 게이트 exit 1(entityRegistry 동형). **대량 우회 수단 아님(실측 악용):** UI/흐름 개념(`wizard`·`project_list`·`dashboard`·`detail`)은 면제 말고 **Surface 강등+capability 재키**(migrate/readopt), 인프라·proto entity는 면제 말고 **그 구조 SSOT를 위 `entitySchemaSources`에 추가**. 면제는 이 둘 다 아닌 실 외부 aggregate에만. 게이트가 사용 중 면제를 **매 실행 부채로 표면화**(hard에서도) — 수십 건 면제 위 hard는 거짓 완료 | `{}` |
| `specSyncBase` | check-spec-sync changeset base ref(SPEC-003 FR-006) — 기본 브랜치가 `master`/`trunk`거나 리모트명이 다르면 선언. base 미해석 시 staged-only로 저하되어 멀티커밋 브랜치(스펙 선커밋→코드 후커밋)가 오차단된다. 우선순위: CLI positional > `SDD_DIFF_BASE` > 이 값 > `origin/main` | `null` |
| `prefixRationale` | 표준 밖 접두어(FEAT 등)의 도입 사유 레지스트리(SPEC-002) — `{"<PREFIX>":"<사유>"}`. `specIdPrefixes`에 표준 4종(SPEC/INFRA/TEST/CICD) 밖을 넣으면 여기 사유 필수(빈 값이면 fr 게이트 exit 1) | `{}` |
| `draftBlockPolicy` | Draft 소유 코드 변경(FR-004) 위반을 range 모드에서도 hard로 승격 — `advisory`(현행, range는 exit 0)·`hard`(range도 exit 1, SPEC-008 FR-007). **로컬 `commit-msg` 훅은 GitHub/GitLab의 웹 UI(서버측) 병합엔 절대 실행되지 않는다** — CI가 `<GATE> specsync [base]`를 MR 파이프라인에 걸고 이 값을 `hard`로 두면, 로컬 훅이 안 타는 병합 경로도 막을 수 있다(도그푸딩 발견: CICD-001이 Draft인데 Jenkinsfile이 웹 UI 병합으로 새어나간 사례) | `"advisory"` |
| `semanticDriftPolicy` | 소유 파일 리네임 감지 시 spec-sync 요구를 "FR 선언 라인 변경 ∨ `Spec-Impact`"로 승격 — `off`·`advisory`(기본, 경고)·`hard`(exit 1). 옛 의미 방치(리네임인데 본문 불변)를 리뷰로 라우팅(SPEC-019) | `"advisory"` |
| `retiredIds` | 폐기된 spec-ID 목록(예: `["CICD-005"]`) — 그 번호의 내부 gap을 numbering 게이트가 사고성 결번이 아닌 정상 retirement gap으로 취급. `sdd-retire`가 남기는 gap 근거(SPEC-018 FR-006) | `[]` |
| `ownershipRequiredPolicy` | 소유 선언 필수(SPEC-002 G1) — `## Ownership`에 키가 **0건**인 스펙은 dedup·실재·귀속 어느 게이트에도 걸리지 않는 사각지대다(미선언 1개 = 보장에 뚫린 구멍). `off`·`advisory`·`hard`. **권장 종착지 = `hard`** | `"advisory"` |
| `crossCategoryDedupPolicy` | 카테고리 **교차** 중복(SPEC-002 G2) — 같은 키가 Entities와 Surfaces에 동시에 있으면, 카테고리를 옮겨 유일성 판정을 우회하는 길이 열린다. `off`·`advisory`·`hard`. **권장 종착지 = `hard`** | `"advisory"` |
| `filesOverlapPolicy` | Files 글롭 **겹침**(SPEC-002 G3) — 두 스펙의 `Files` 글롭이 같은 실파일을 덮으면 소유가 사실상 겹친 것(spec-sync가 어느 쪽을 요구할지도 모호해진다). 저장소를 걸어 실제 매치로 판정. `off`·`advisory`·`hard`. **권장 종착지 = `hard`** | `"advisory"` |
| `executionEvidencePolicy` | 실행 증거 등급(SPEC-031) — FR·SC의 `[검증]` 태그가 **실행 가능한 경로**를 지목하는지 판정(맨 태그 금지·경로 실재·실행동사 주장에 증거 요구·UI 주장에 UI 증거 요구). 증거가 없으면 `[미확인]`으로 정직하게 표기하면 통과한다(차단 대상은 "증거 없는 자기신고"). `off`·`advisory`·`hard`. **권장 종착지 = `hard`** | `"off"` |
| `liveRealityPolicy` · `liveRealityChecks` | 라이브 대조(SPEC-032) — 저장소 **밖** 진실(클라우드·클러스터 실물)과 선언의 diff. 어댑터 주입형(`{kind:"terraform"\|"kubernetes"\|"ownership"\|"custom", command}`) — stdout 한 줄 = 위반 하나. **명령이 비-0으로 죽으면 위반이 아니라 `skipped(사유)`**(자격증명 없는 로컬·오프라인에서 하드 실패 금지). 체크가 비면 inert | `"off"` · `[]` |
| `liveRealityCoveragePolicy` · `deployArtifactMarkers` · `liveRealityChecks[].covers` | **등록 축**(SPEC-032 확장) — 스펙이 배포 산출물을 선언하면 그것을 보는 검사가 **등록돼 있는지**를 본다. 실행 축과 정책이 분리된 이유: 실행은 자격증명이 필요해 흔히 off·skipped인데 등록은 순수 선언 대조라 오프라인에서도 판정된다 — 한 정책에 묶으면 실행을 끄는 순간 등록도 꺼지고, 그게 실측 제보의 구조다(새 산출물 8개 결함을 **배포로 하나씩** 발견, R9 틀은 있었지만 검사 6건에 그 중 하나도 없었음). `deployArtifactMarkers`는 **조용한 기본값을 두지 않는다** — 미선언이면 inert로 자백한다(권장 목록은 아래 §라이브 대조 템플릿). `off`·`advisory`(기본)·`hard`. **권장 종착지 = `hard`** | `"advisory"` · `null` · `[]` |
| `hooksInstalledPolicy` | 훅 배선 실재(SPEC-036) — 선언된 훅(`hooks.list`)이 `.git/hooks`에 **설치·실행 가능·킷 훅**인가. 게이트 파일이 다 있어도 훅이 없으면 한 번도 발동하지 않는데, 종전 확인은 게이트의 inert만 보고 훅의 inert는 안 봐서 그 상태가 green으로 읽혔다(실측 제보). `off`·`advisory`(기본)·`hard`. **권장 종착지 = `hard`**(배선 완료 후 승격) | `"advisory"` |
| `syncHookRules` · `syncHookDelegatedTo` | pre-push 훅(`sdd-sync --hook`)에서 판정할 규칙 집합과 **나머지를 누가 대신 판정하는지**. 미선언이면 전체 실행(하위호환). 선언하면 목록 밖 규칙은 "위임"으로 출력되고 flagged가 아니다 — 담당자를 안 적으면 **에러**(조용한 생략 금지). ⚠ 실측: 스윕 30.3초 중 R5(스위트 실행)가 29.8초라 매 push가 멈춰 `--no-verify` 우회가 습관이 됐다. 우회를 유발하는 강제는 강제가 아니다 | `null` · `""` |
| `SDD_SYNC_BUDGET_MS`(env) · `--budget` | 훅 경로 시간 예산(기본 15000). 초과분은 **미판정**으로 flagged된다(위임과 다르다 — 예산 초과는 사고, 위임은 선언) | `15000`(훅) |
| `scCoveragePolicy` | SC·NFR 검증 회계(SPEC-034) — 성공기준·비기능 목표를 검증 바인딩에 묶는다. FR만 회계하던 사각을 닫는 축이다: 각 SC·NFR은 `[검증: <경로>]`를 갖거나 `evidenceManifest`에 증거·유예로 회계돼야 한다. `[미확인]`만 적은 것은 **회계가 아니다**(정직하지만 "아무도 안 봤음"과 구분되지 않는다). `off`·`advisory`·`hard`. **권장 종착지 = `hard`**(마이그레이션 초기엔 미회계가 수십~수백 건이라 advisory 경유 — 킷 자신도 101건에서 시작해 hard까지 갔다). 결속은 **추측 금지**: SC 문장이 스스로 지목한 테스트 → 도그푸딩이면 킷에 게이트를 돌리는 CI → 그 외엔 그 스펙이 Ownership.Files로 소유한 테스트. 그럴듯한 경로를 붙이는 순간 이 게이트가 막으려던 자기신고가 된다 | `"off"` |
| `verificationKinds` | 위 바인딩의 **경로 → 검증 종류** 유도 글롭 — `{ unit:["**/*.test.*"], e2e:["**/*.e2e.*"], load:["tests/load/**"], pentest:["tests/security/**"] }`. 종류를 사람이 손으로 적게 하면 그 자체가 또 하나의 자기신고라, 산출물이 **어디 사는지**로 기계가 분류한다. 비면 전부 `other`(회계는 성립) | `{}` |
| `evidenceManifest` | CI에서 못 도는 검증(라이브 클러스터·WAF·관리형 DB)의 증거 회계 — `smokeManifest` 동형. 경로 문자열 또는 객체: `{ "<SPEC>/<SC-001>": {kind, evidence} }` 또는 `{kind:"deferred", reason}`. **사유 없는 유예는 판정 전 에러**(미검증을 문서 형태로 세탁 금지) | `null` |
| `scCoverageListCap` | 미회계 목록 출력 상한 — 총량은 헤더가 말하고 초과분은 "외 N건"으로 명시(감춤 아님) | `12` |
| `outOfBandDeployPolicy` · `outOfBandDeployCommands` · `outOfBandDeployDebtFile` | out-of-band 배포 가드(SPEC-035) — 배포가 커밋보다 먼저인 궤도에서 spec-first 발화 지점을 **배포 행위**까지 앞당긴다. `off`·`advisory`·`hard`. 배포 시점은 어느 강도에서도 비차단이다(PostToolUse는 이미 실행된 뒤에 돈다 — 되돌릴 수 없는 것을 막는 척하지 않는다). `hard`의 실체는 **부채 적재**: 미기록 배포가 `outOfBandDeployDebtFile`(JSONL, 로컬·gitignore)에 쌓이고 pre-commit의 `check-deploy-debt`가 **커밋을 막는다**. 갚는 방법은 하나 — 소유 스펙 Change Log에 행을 추가하면 자동 해소된다(파일을 지우는 것은 갚는 것이 아니다). **권장 종착지 = `hard`** | `"advisory"` · `null` · `".sdd/deploy-debt.jsonl"` |
| `deployPreconditionPolicy` | 배포 **전제 조건**(SPEC-035 FR-006·FR-008·FR-009) — 위와 **다른 질문**을 묻는다: 그쪽은 "이 배포가 스펙에 반영됐나"(사후), 이쪽은 **"이 배포가 재현 가능한 리비전에서 나오는가"**(사전). 미커밋 트리·upstream 뒤처짐은 순수 git 조회라 배포 **전에** 판정되고 오탐이 거의 없다 — 그래서 유일하게 **PreToolUse에서 실제로 차단**하는 배포 축이다(hard=exit 2). upstream 없음은 hard에서도 차단하지 않고 미판정으로 표기한다(모르는 것을 위반으로 세면 오탐이고, 오탐은 훅을 꺼지게 한다). 기본 off — 사전 차단이라 도입 즉시 켜면 미커밋 배포 궤도의 팀이 첫날 멈춘다. **권장 종착지 = `hard`**(advisory 경유) 판정 5종: 미커밋 트리·upstream 뒤처짐(재현 가능성) + **저장된 plan 없는 `-auto-approve`**(승인 우회 — 승인한 것 = 적용되는 것) + **동의 없는 파괴적 명령**(destroy·delete·uninstall → `SDD_DESTROY_OK=1` 매 실행 선언) + **계획 범위 격리**(아래 `deployScopeCommand`). 뒤 셋은 명령 문자열/프로젝트 명령 출력만 보므로 git 없이도 판정된다 | `"off"` |
| `deploySmokeCommand` · `deploySmokeTimeoutMs` | 배포 직후 **서비스 생존** 확인(SPEC-035 FR-007). 정본 §7 "판정 없이 exit 0"의 배포판 사촌 — **배포 명령이 성공해도 서비스는 죽을 수 있다**(실측: apply 성공 · CI 초록 · 전 요청 403). **미선언 자체가 부채로 계상된다**: 아무도 확인하지 않은 것과 확인해서 살아 있는 것이 같은 침묵으로 보이면 안 된다. 비-0은 skip이 아니라 **실패**다(테스트·`e2ePrecheck`와 같은 반전 규약). 스모크 부채는 스펙 편집으로 갚아지지 않고 — `smoke-undeclared`는 선언으로, `smoke-dead`는 스모크가 다시 통과해야 해소된다 | `null` · `60000` |
| `deployScopeCommand` | **계획 범위 격리**(SPEC-035 FR-009) — 이 명령이 계산한 변경이 이 changeset 범위 밖이면(stdout 한 줄 = 범위 밖 항목 하나, `liveRealityChecks`와 같은 계약) hard에서 차단한다. 실측 제보: `terraform plan`에 의도한 SNS 리소스 11건 삭제 외 무관한 변경 6건이 섞여 나왔다 — 커밋된 IaC와 라이브 인프라가 이미 어긋나 있었다. **인프라 도구를 모른다** — "범위 밖인지" 계산(plan 파싱·git diff 대조·모듈 매핑)은 전적으로 이 명령의 몫이다(워크드 예시는 아래 §배포 전제조건 템플릿). **미선언은 부채가 아니다**(`deploySmokeCommand`와 다른 규약) — 모듈 개념이 없는 배포(`kubectl apply -f single.yaml`)를 부당하게 벌주지 않는다. 동의는 `SDD_ALLOW_DRIFT=1`(파괴 동의 `SDD_DESTROY_OK`와 별개 변수 — 흔적이 섞이면 사후에 어느 쪽이었는지 구분 못 한다) | `null` |
| `e2eFileRegex` | e2e 테스트 파일 정규식(`testFileRegex`의 **부분집합**) — 선언하면 e2e로만 커버된 FR이 `unit`(=실행 검증됨)이 아니라 `e2e` 버킷으로 분리 집계된다. ⚠ 실측 결함: 회계가 e2e를 unit으로 세는 동안 실행 게이트는 e2e를 돌리지 않아 FR 58건이 거짓 green이었다 | `[]` |
| `e2eTestsPolicy` · `commands.e2e` · `e2ePrecheck` | e2e 실행 축(SPEC-021 확장) — 선언하면 `commands.e2e`를 실제로 돌려 판정한다. `e2ePrecheck`(선택)는 **실행 전제 프로브**로, 실패하면 `skipped(사유)`이고 통과 후 비-0은 진짜 실패다(테스트에서 비-0은 skip이 아니라 실패이므로 live-reality와 달리 프로브로 가른다). **`hard` + skipped = 실패**(판정 못 했는데 통과는 거짓 안전). 앱 기동 전제라 pre-commit이 아니라 pre-push·CI에 배선한다 | `"off"` · — · `null` |
| `synonymPolicy` | 의미적 중복 3층(SPEC-033, entity 역할 한정) — ①정규화 후 **형태 변이** 충돌(`order`/`orders`/`pjt_order`)·②`synonymRegistry`가 선언한 **별칭 사용**은 결정적이라 이 강도대로 차단하고, ③유사 후보는 **어떤 강도에서도 차단하지 않는다**(확률적 오탐이 빌드를 깨면 사람이 그 층을 떼어낸다). `off`·`advisory`·`hard`. **권장 종착지 = `hard`** | `"off"` |
| `keyPrefixes` | 위 ①의 정규화에서 **벗겨낼 접두어** — 선언된 것만 제거한다(임의 병합 금지). 비면 접두어 제거를 하지 않는다. 토큰이 전부 접두어면 원형 유지 | `[]` |
| `synonymRegistry` | ②의 선언 — `{ "<정본 키>": { aliases: ["<별칭>"], reason: "왜 같은 개념인가" } }`. **사유 필수**(빈 값 불가)이고, 정본이 어느 스펙에도 소유되지 않음·한 별칭이 두 정본에 걸림·별칭 0개는 **판정 전** 에러 | `{}` |
| `synonymReviewLedger` | ③에서 사람이 "다르다"고 결정한 쌍의 **기각 원장** — `{ "<키A>::<키B>": "왜 다른 실체인가" }`(키는 사전순 정렬). **사유 필수.** 미결 후보는 정본 통합(registry)이나 여기 둘 중 하나로 착지해야만 목록에서 빠진다(조용한 소실 없음) | `{}` |
| `entitySimilarityCommand` · `entitySimilarityTimeoutMs` | ③ 후보 생성기 — stdout **한 줄 = 후보 쌍 하나**(탭·파이프·콤마 구분, 3번째 칸은 선택적 점수)면 무엇이든 된다. **기본 경로는 설치가 필요 없다**: 세션 LLM이 `docs/examples/entity-pairs.mjs`의 전수 열거를 판정해 파일로 남기고 `"cat sdd/similarity-candidates.tsv"`를 꽂는다. 출력 첫머리에 `# entity-set: <건수> <해시>`를 넣으면 entity 집합이 바뀔 때 "후보 목록이 낡음"이 뜬다(비차단). 실행 실패는 `skipped(사유)` | `null` · `120000` |
| `policyRatchetPolicy` | 정책 강도 **단조 증가** 강제(SPEC-027) — 커밋이 감시 대상 knob의 강도를 낮추면(`hard`→`advisory`→`off`) 위반. `off`·`advisory`·`hard`. 감시 대상은 강도 enum knob 화이트리스트(`frKeyAnchorPolicy`·`capabilityOwnershipPolicy`·`entitySchemaBackingPolicy`·`specSyncUnownedPolicy`·`draftBlockPolicy`·`semanticDriftPolicy`·`runTestsPolicy`·`migrationStatePolicy`, **그리고 자기 자신**). ⚠ 래칫은 **강도만** 본다 — 강도를 유지한 채 면제 목록·소스 어댑터를 비워 판정을 inert로 만드는 우회는 감시 밖이다(그쪽은 각 게이트의 부채 표면화가 담당) | `"off"` |
| `runTestsPolicy` | `commands.test`(로컬 안전 tier)를 **실제 실행**해 green을 확인하는 게이트(`check-test-run`, SPEC-021) — `off`(기본, 실행 안 함)·`advisory`(실패 경고)·`hard`(실패 exit 1). **커버리지 태그 회계 ≠ 실행 결과**를 닫는다. 실행이 느려 pre-commit 아닌 완료 시점·CI·pre-push에서. env-gated 테스트가 부재 시 사유 포함 skip이면 결과가 error 0으로 명확 | `"off"` |
| `schemaDriftManifest` | 런타임 스키마 드리프트(R2′ code↔deployed-DB, `check-schema-drift`, SPEC-022) — `{expected, deployed}` 두 조회 명령(코드 기대 스키마 / 배포 DB 실측; DB·ORM 중립 주입, 각 줄당 `table.column`)·`null`이면 비활성. **배포 파이프라인 preflight(migrate 직전)에 건다** — spec↔code green이 배포 안전을 보장 못 하는 사각지대(예: 42703 column does not exist)를 봉합 | `null` |
| `migrationStatePolicy` | 위 드리프트 발견 시 강도 — `advisory`(경고)·`hard`(배포 차단 exit 1). 조회 실패도 조용히 통과 안 함(판정 불가 표면화) | `"advisory"` |
| `entityRegistry` | entity(aggregate-root 카테고리) 등록제 — `{"<entity>":"<도입 사유>"}`. 채우면 미등록 entity 소유·빈 사유는 ownership 게이트가 exit 1(PREFIX 거버넌스 동형). 비면 비활성 | `{}` |
| `relationTypes` | `Dependencies.Entities`의 `EntityName (relation-type)` 구조화 관계 어휘(`capabilityVerbs` 동형) — 채우면 미등록 relation-type은 ownership 게이트가 exit 1. 비면(기본) 어휘 무제한(형식 kebab 토큰만 강제). 관계의 대상 실재·소유 spec 해석은 항상 hard, 순환 참조는 항상 advisory(SPEC-017) | `[]` |
| `objectStorageMarkers` | 오브젝트 스토리지 감지 마커(SPEC-016) — 스펙 본문이 매치하면 completeness가 `## Object Storage Decision`(Bucket·Consolidation) 존재를 advisory로 요구. `[]`면 비활성 | 멀티클라우드 기본 목록 |
| `testInfraGlobs` | 테스트/QA 인프라 네임스페이스 마커(SPEC-015) — 매치 파일은 TEST 스펙만 소유(제품 스펙 소유 시 fr 게이트 exit 1). `[]`면 비활성 | `[]` |
| `trackerCloseout` | 완료 루프 꼬리(원점 트래커 close-out) 인스턴스화 — `{tracker,devDoneState,confirmState,reportChannel}`. 트래커 유래 작업의 verify/merge 후 dev-done→보고→confirm(2인 책임분리). 스킬·사람이 소비(게이트 아님), 트래커·채널은 하드코딩 금지. `{}`면 비활성 | `{}` |
| `commands.{setup,lint,typecheck,test}` | CI가 `sdd-run.mjs`로 실행할 언어별 명령. 미설정 stage는 건너뜀(예: JS=`npm test`, Python=`pytest -q`) | `{}`(미설정) |
| `commands.smoke` | 인프라 테스트(자격증명 필요) 명령 — 개발서버·CI 전용, `sdd-run smoke`로 실행(로컬·pre-commit은 안 봄) | `null` |

> **모델 무관:** 이 config에는 어떤 LLM/에이전트 가정도 없다. 게이트는 모델과 독립적으로 CI에서 강제된다.
> **컴포넌트 무관:** DB(RDB·NoSQL)·캐시(Redis…)·브로커/스트림(Kafka…)·검색·스토리지 등 **어떤 미들웨어 제품도 config·게이트·spec에 박지 않는다.** spec은 *역량/요구*만 적고(예: "이벤트 로그 필요") 제품 선택은 프로젝트 몫이다(`principles.md` §10, `SSOT.md` §5b).
> **런타임 무관:** 게이트 4판 동봉 — **Go 정적 바이너리(`go-gate/`)가 사실상 모든 언어 커버**(인터프리터 0, 네이티브 Windows 포함), 셸판은 빌드 없이 즉시 실행, Python판은 Node 전 게이트 패리티, Node판이 정본. 전부 같은 config — 커버 매트릭스·검증 상태는 `ci-examples.md`·`REALITY_CHECK.md`.

---

## 라이브 대조 템플릿 (SPEC-032 — 프로젝트마다 재발명 금지)

실측 제보(2026-08-10): qa에이전트 도입에서 배포 산출물 결함 8건을 **배포로 하나씩** 발견했다 —
ECR 리포 없음 · 경로 가드 · base==HEAD · 크로스계정 ECR API · buildx 캐시 드라이버 ·
**아치 불일치(arm64 노드에 amd64 이미지)** · 리포 정책 부재 · **이미지에 의존 모듈 누락**.
전부 저장소 밖 사실이고 전부 로컬 게이트를 green으로 통과했다. 아래는 그 8건이 다시 나오지
않게 하는 최소 집합이다 — 붙여넣고 명령만 프로젝트 도구에 맞춰라.

**계약 복습(중요):** stdout **한 줄 = 위반 하나**(비면 clean), **exit ≠ 0 = `skipped(사유)`**.
자격증명 없는 로컬에서 하드 실패하면 안 되므로, 조회 자체가 불가하면 비-0으로 죽는 것이 옳다.
그리고 `covers`에 **담당 산출물**을 반드시 적는다 — 안 적으면 등록 축이 "아무도 안 보는 산출물"로 센다.

**권장 `deployArtifactMarkers`(복사해 시작):**
`["image","container","registry","ecr","gcr","acr","docker","deployment","statefulset","daemonset","cronjob","k8s","kubernetes","helm","lambda","function","service","ingress","pipeline","stage","workflow","job"]`
— 프로젝트 어휘에 맞게 **줄이거나 늘려라**. 이 목록이 프로젝트와 어긋나면 0건이 나오는데,
그 0은 진짜 0과 구분되지 않는다(SPEC-040 ②).

### ① 이미지 플랫폼 ↔ 대상 노드 아키텍처
```json
{
  "id": "image-arch-matches-node",
  "kind": "custom",
  "label": "이미지 플랫폼이 대상 노드 아키텍처와 일치하는가",
  "covers": ["*-image", "*-runner"],
  "command": "IMG=$(kubectl get job/qa-agent -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null) || exit 3; NODE=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null) || exit 3; IMGARCH=$(crane config \"$IMG\" 2>/dev/null | jq -r .architecture) || exit 3; [ \"$IMGARCH\" = \"$NODE\" ] || echo \"아치 불일치: 이미지 $IMGARCH ≠ 노드 $NODE ($IMG)\""
}
```
> 실측 그대로다 — arm64 노드에 amd64 이미지를 밀어 넣어도 빌드·푸시·매니페스트가 전부 통과한다.
> 깨지는 곳은 런타임이고, 그때는 이미 배포된 뒤다.

### ② 레지스트리 계정 ↔ 빌드 주체 · 리포지토리 정책 실재
```json
{
  "id": "registry-account-and-policy",
  "kind": "custom",
  "label": "이미지가 참조하는 레지스트리 계정이 빌드 주체와 맞고 리포 정책이 있는가",
  "covers": ["*-image", "ecr/*"],
  "command": "ACC=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || exit 3; REG=$(echo \"$IMAGE_URI\" | cut -d. -f1); [ \"$REG\" = \"$ACC\" ] || echo \"크로스계정 참조: 이미지 계정 $REG ≠ 빌드 계정 $ACC\"; aws ecr get-repository-policy --repository-name \"$ECR_REPO\" >/dev/null 2>&1 || echo \"리포지토리 정책 없음: $ECR_REPO (다른 계정에서 pull 불가)\""
}
```
> 리포지토리가 **없는 것**과 정책이 **없는 것**은 다른 실패다. 전자는 push에서, 후자는 pull에서 죽는다.

### ③ 엔트리포인트 dry-run — 이미지 안에 실제로 들어 있는가
```json
{
  "id": "entrypoint-dry-run",
  "kind": "custom",
  "label": "컨테이너가 import·실행하는 파일이 이미지 안에 실재하는가",
  "covers": ["*-image"],
  "command": "docker run --rm --entrypoint sh \"$IMAGE_URI\" -c 'python -c \"import app.main\" 2>&1' >/tmp/e 2>&1 || { grep -q 'ModuleNotFoundError\\|No such file' /tmp/e && echo \"이미지에 의존 모듈·파일 누락: $(tail -1 /tmp/e)\" || exit 3; }"
}
```
> **빌드 성공은 실행 가능성이 아니다.** COPY 경로 하나가 어긋나도 이미지는 정상적으로 만들어진다.
> 이 검사가 없으면 그 사실을 배포 후 런타임 로그에서 배운다.

### ④ 파이프라인 스테이지의 전제 자원
```json
{
  "id": "stage-prereqs",
  "kind": "custom",
  "label": "스테이지가 참조하는 이미지 태그·시크릿·SA 권한이 실재하는가",
  "covers": ["*-job", "*-stage", "*-workflow"],
  "command": "aws ecr describe-images --repository-name \"$ECR_REPO\" --image-ids imageTag=\"$TAG\" >/dev/null 2>&1 || echo \"참조 태그 없음: $ECR_REPO:$TAG (스테이지가 뜨지 못한다)\"; kubectl get secret \"$SECRET\" >/dev/null 2>&1 || echo \"시크릿 없음: $SECRET\"; kubectl auth can-i create jobs --as=system:serviceaccount:\"$NS\":\"$SA\" >/dev/null 2>&1 || echo \"SA 권한 부족: $SA\""
}
```
> ⚠ 이 검사는 **스테이지 자신이 먼저 하는 것이 더 낫다**(SPEC-041 ③). 스테이지가 자기 전제를
> 검사해 `--record <asset> INERT "<사유>"`를 남기면, 안 뜬 사실이 초록에 묻히지 않는다.
> 여기 R9 검사는 그 배선이 아직 없는 동안의 백스톱이다.

## 배포 전제조건 템플릿 — 계획 범위 격리 (SPEC-035 FR-009 — 프로젝트마다 재발명 금지)

실측 제보(2026-08-22): SNS 알림 기능을 애플리케이션·Terraform 양쪽에서 걷어내는 작업 중
`terraform plan`을 실행했더니, 의도한 SNS 리소스 11건 삭제 외에 무관한 변경 6건(bastion
재생성·CloudFront·EKS access entry·Lambda 4개·Secrets Manager 2건)이 같은 plan에 섞여
나왔다. 건드린 파일(`modules/sns/**`)과 무관했다 — git에 커밋된 코드와 실제 라이브 인프라가
이미 어긋나 있었고, 무관한 작업을 apply하는 순간 그 드리프트가 함께 묻어 나올 뻔했다.

이건 애플리케이션 층에서 `check-spec-sync`가 강제하는 것과 **같은 원칙의 인프라 버전**이다 —
동기화가 필요한 두 축은 ①코드↔스펙(commit-msg에서 강제) ②인프라↔IaC(배포 시점에서 강제)다.
①은 이 킷이 도입 때부터 다뤘고, ②는 이 FR-009로 닫는다.

**계약 복습:** stdout **한 줄 = 범위 밖 리소스 하나**(비면 clean), **exit ≠ 0 = 미판정**(위반
아님 — 자격증명 없는 로컬에서 하드 실패 금지, `liveRealityChecks`와 같은 계약). 인프라 도구를
킷이 모르므로 plan 파싱·git diff 대조·모듈 매핑은 전부 이 명령 안에서 프로젝트가 한다.

### ⑤ terraform plan ↔ changeset 범위 대조
```json
{
  "deployScopeCommand": "scripts/tf-scope-check.sh"
}
```
`scripts/tf-scope-check.sh`(스켈레톤 — 프로젝트 도구에 맞춰 채운다):
```sh
#!/bin/sh
# 1) 이 changeset이 건드린 모듈 집합 — 마지막 apply 지점 이후 diff(git tag·타임스탬프 등
#    "마지막 적용 지점"을 어떻게 기록하는지는 이 스크립트의 몫이다. 킷은 관여하지 않는다).
CHANGED_MODULES=$(git diff --name-only "$(git describe --tags --match 'tf-applied-*' --abbrev=0 2>/dev/null || echo HEAD~20)"..HEAD -- '*.tf' \
  | sed -E 's#^(modules/[^/]+)/.*#\1#' | sort -u)
# 2) plan이 실제로 건드리는 모듈 — terraform plan -json을 리소스 주소로 축약한다.
PLANNED_MODULES=$(terraform plan -json 2>/dev/null \
  | jq -r 'select(.type=="resource_drift" or .type=="planned_change") | .change.resource.addr // empty' \
  | sed -E 's#^(module\.[^.]+)\..*#\1#' | sed 's#^module\.##' | sort -u)
# 3) 범위 밖 = planned - changed. 한 줄 = 위반 하나.
comm -23 <(printf '%s\n' "$PLANNED_MODULES") <(printf '%s\n' "$CHANGED_MODULES")
```
> `terraform plan -json`은 credentials·backend 접근이 필요하다 — 실패하면 비-0으로 죽어야
> `deployScopeVerdict`가 **미판정**으로 분류한다(위반 0건으로 세면 거짓 안전). "마지막 적용
> 지점"을 git tag로 남기는 관례(제보 프로젝트가 실측 검증한 방식)를 함께 쓰면 매 apply 성공
> 시 `git tag tf-applied-$(date +%s) && git push --tags`로 갱신한다 — 이 지점의 계산 방법은
> `deployScopeCommand`의 구현 디테일이라 킷이 규정하지 않는다.
