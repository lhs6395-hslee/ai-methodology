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

## 테스트 환경 tier — `commands.test`(로컬 안전) vs `commands.smoke`(인프라)
> 로컬엔 AWS 자격증명이 없을 수 있다. **로컬 강제(git 훅·TDD)가 인프라 테스트를 실행하지 않도록** 테스트 명령을 두 tier로 나눈다(METHODOLOGY "검증은 환경으로 계층화된다"). `sdd-run`은 임의 stage를 실행하므로 코드 변경 없이 `smoke` stage가 돈다.
> - `commands.test` = **로컬 안전**(유닛+목)만. 로컬·pre-commit·TDD가 이것만 본다.
> - `commands.smoke` = **인프라**(AWS 등). 자격증명·도달성 있는 곳(개발서버·CI)에서만 `sdd-run smoke`.
> - **로컬 실행 가능성:** 공개 API(S3·DynamoDB·STS·CloudWatch·Cost Explorer)는 자격증명만 있으면 로컬 가능(가드가 자격증명 유무로 분기). VPC 전용(Aurora·프라이빗 RDS·ElastiCache)은 로컬 도달 불가 → 개발서버·CI 전용.

test/smoke 분리 예(Python):
```json
{ "commands": {
  "test":  "python3 -m unittest discover -s tests -p 'test_*_unit.py'",
  "smoke": "SDD_SMOKE=1 python3 -m unittest discover -s tests/smoke"
} }
```
skip 가드(인프라 테스트가 로컬에서 **실패가 아니라 skip** 되게):
```python
import os, unittest
# VPC 전용(Aurora 등) — 환경 플래그로, 로컬은 항상 skip:
@unittest.skipUnless(os.getenv("SDD_SMOKE"), "infra test — 개발서버/CI에서만")
class TestAuroraMigration(unittest.TestCase): ...
# 공개 API(S3 등) — 자격증명 유무로, 로컬에 creds 있으면 실행:
# @unittest.skipUnless(boto3.Session().get_credentials(), "no AWS creds")
```
JS/TS는 `commands.smoke`에 `SDD_SMOKE=1 vitest run --project smoke`, 테스트는 `describe.skipIf(!process.env.SDD_SMOKE)(…)`.
> CI·개발서버는 `sdd-run test` + `sdd-run smoke` 둘 다, 로컬·pre-commit은 `test`만. 인프라 FR은 smoke 증거(`@verifies`→`smokeManifest`) 또는 deferred로 회계된다(로컬 unit 강제 없음).

## 인프라 전용 레포 (IaC — CSP 무관: AWS / GCP / Azure / 온프렘)
> 앱 코드가 없고 IaC만 있는 경우. `@covers`를 정책 테스트(OPA/conftest·terratest 등)에 달고, `commands.test`에 **그 환경의 live drift 검증**을 넣는다(`SSOT.md` §5b). 아래는 Terraform 예시 — IaC 도구·클라우드만 갈아끼우면 동일하게 동작한다.
```json
{
  "scanDirs": ["modules", "tests", "policy"],
  "testFileRegex": ["_test\\.go$", "\\.rego$", "\\.tftest\\.hcl$"],
  "ignoreDirs": [".terraform", ".git"],
  "ownershipCategories": ["Resources", "Surfaces", "Capabilities"],
  "specSyncUnownedPolicy": "warn",
  "commands": { "lint": "terraform fmt -check && tflint", "typecheck": "terraform validate", "test": "conftest test . && terraform plan -detailed-exitcode" }
}
```
> **commands.test(드리프트 검증) CSP/도구별 대안** — 환경에 맞게 바꾼다:
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
| `draftBlockPolicy` | Draft 소유 코드 변경(FR-004) 위반을 range 모드에서도 hard로 승격 — `advisory`(현행, range는 exit 0)·`hard`(range도 exit 1, SPEC-008 FR-007). **로컬 `commit-msg` 훅은 GitHub/GitLab의 웹 UI(서버측) 병합엔 절대 실행되지 않는다** — CI가 `<GATE> specsync [base]`를 MR 파이프라인에 걸고 이 값을 `hard`로 두면, 로컬 훅이 안 타는 병합 경로도 막을 수 있다(도그푸딩 발견: CICD-001이 Draft인데 Jenkinsfile이 웹 UI 병합으로 새어나간 사례) | `"advisory"` |
| `entityRegistry` | entity(aggregate-root 카테고리) 등록제 — `{"<entity>":"<도입 사유>"}`. 채우면 미등록 entity 소유·빈 사유는 ownership 게이트가 exit 1(PREFIX 거버넌스 동형). 비면 비활성 | `{}` |
| `relationTypes` | `Dependencies.Entities`의 `EntityName (relation-type)` 구조화 관계 어휘(`capabilityVerbs` 동형) — 채우면 미등록 relation-type은 ownership 게이트가 exit 1. 비면(기본) 어휘 무제한(형식 kebab 토큰만 강제). 관계의 대상 실재·소유 spec 해석은 항상 hard, 순환 참조는 항상 advisory(SPEC-017) | `[]` |
| `objectStorageMarkers` | 오브젝트 스토리지 감지 마커(SPEC-016) — 스펙 본문이 매치하면 completeness가 `## Object Storage Decision`(Bucket·Consolidation) 존재를 advisory로 요구. `[]`면 비활성 | 멀티클라우드 기본 목록 |
| `testInfraGlobs` | 테스트/QA 인프라 네임스페이스 마커(SPEC-015) — 매치 파일은 TEST 스펙만 소유(제품 스펙 소유 시 fr 게이트 exit 1). `[]`면 비활성 | `[]` |
| `trackerCloseout` | 완료 루프 꼬리(원점 트래커 close-out) 인스턴스화 — `{tracker,devDoneState,confirmState,reportChannel}`. 트래커 유래 작업의 verify/merge 후 dev-done→보고→confirm(2인 책임분리). 스킬·사람이 소비(게이트 아님), 트래커·채널은 하드코딩 금지. `{}`면 비활성 | `{}` |
| `commands.{setup,lint,typecheck,test}` | CI가 `sdd-run.mjs`로 실행할 언어별 명령. 미설정 stage는 건너뜀 | npm |

> **모델 무관:** 이 config에는 어떤 LLM/에이전트 가정도 없다. 게이트는 모델과 독립적으로 CI에서 강제된다.
> **컴포넌트 무관:** DB(RDB·NoSQL)·캐시(Redis…)·브로커/스트림(Kafka…)·검색·스토리지 등 **어떤 미들웨어 제품도 config·게이트·spec에 박지 않는다.** spec은 *역량/요구*만 적고(예: "이벤트 로그 필요") 제품 선택은 프로젝트 몫이다(`principles.md` §10, `SSOT.md` §5b).
> **런타임 무관:** 게이트 4판 동봉 — **Go 정적 바이너리(`go-gate/`)가 사실상 모든 언어 커버**(인터프리터 0, 네이티브 Windows 포함), 셸판은 빌드 없이 즉시 실행, Python판은 Node 전 게이트 패리티, Node판이 정본. 전부 같은 config — 커버 매트릭스·검증 상태는 `ci-examples.md`·`REALITY_CHECK.md`.
