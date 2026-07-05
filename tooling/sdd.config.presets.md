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
| `specIdPrefixes` | spec 파일·ID·`@covers`에서 인정할 ID 접두어. 표준 밖 접두어는 `prefixRationale` 사유 필수(미등록은 fr 게이트가 exit 1) | `["SPEC","INFRA","TEST"]` |
| `requirementIdPrefixes` | 요구 ID 접두어 — FR 선언·`@covers`·집계·spec-sync 판정의 문법이 전부 여기서 파생(레터 서픽스 1자 포함). 확장 예: `["FR","NFR"]` | `["FR"]` |
| `strictSpecs` | 전역 `--strict`의 점진 브리지 — 등재 spec만 R2 하드(모든 FR unit 커버 필수, smoke 대체 불가). 미존재 ID는 에러 | `[]` |
| `requireAccounting` | R3: 모든 FR이 unit ∨ smoke ∨ deferred로 회계돼야 함("조용히 미검증" 제거) | `false` |
| `smokeManifest` | 회계 매니페스트 JSON 경로 — `"SPEC-NNN/FR-NNN": {method,evidence}` 또는 `{method:"deferred",reason}`. dangling·빈 값은 fr 게이트가 exit 1(사유 존재만 강제) | `null` |
| `specSyncUnownedPolicy` | 어느 스펙 `Files`에도 미매치인 변경 파일 정책 — `silent`(현행)·`warn`·`error`(staged 차단=closed-world). 예외는 `specSyncExemptGlobs`로 선언. **소비 프로젝트 권장 시작값: `warn`**(안정 후 `error`) | `"silent"` |
| `entityRegistry` | entity(aggregate-root 카테고리) 등록제 — `{"<entity>":"<도입 사유>"}`. 채우면 미등록 entity 소유·빈 사유는 ownership 게이트가 exit 1(PREFIX 거버넌스 동형). 비면 비활성 | `{}` |
| `commands.{setup,lint,typecheck,test}` | CI가 `sdd-run.mjs`로 실행할 언어별 명령. 미설정 stage는 건너뜀 | npm |

> **모델 무관:** 이 config에는 어떤 LLM/에이전트 가정도 없다. 게이트는 모델과 독립적으로 CI에서 강제된다.
> **컴포넌트 무관:** DB(RDB·NoSQL)·캐시(Redis…)·브로커/스트림(Kafka…)·검색·스토리지 등 **어떤 미들웨어 제품도 config·게이트·spec에 박지 않는다.** spec은 *역량/요구*만 적고(예: "이벤트 로그 필요") 제품 선택은 프로젝트 몫이다(`principles.md` §10, `SSOT.md` §5b).
> **런타임 무관:** 게이트 4판 동봉 — **Go 정적 바이너리(`go-gate/`)가 사실상 모든 언어 커버**(인터프리터 0, 네이티브 Windows 포함), 셸판은 빌드 없이 즉시 실행, Python판은 Node 전 게이트 패리티, Node판이 정본. 전부 같은 config — 커버 매트릭스·검증 상태는 `ci-examples.md`·`REALITY_CHECK.md`.
