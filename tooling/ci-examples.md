# 게이트 실행 — 어디서든 (CI/CD 도구 무관)

> **게이트는 그냥 CLI 명령이다.** 특정 CI/CD 도구도, git 호스트도 필요 없다. 로컬·git 훅·`make`·사내든 클라우드든 **어떤 CI/CD 도구**에서나 돌릴 수 있다. 어느 도구든 핵심은 같다 — *변경마다 두 게이트 명령을 한 스텝에서 실행하고, 0이 아니면 막는다.* 아래는 환경별로 거는 예시일 뿐.

## 게이트 명령 (런타임 4판 중 가진 쪽 — 핵심 3커맨드 동작·문법 동일)
| 런타임 | FR↔test | 소유권 중복 | 러너 |
|---|---|---|---|
| **Go 바이너리** | `sdd-gate fr` | `sdd-gate ownership` | `sdd-gate run <stage>` |
| 셸 | `sh sdd_gates.sh fr` | `sh sdd_gates.sh ownership` | `sh sdd_gates.sh run <stage>` |
| Python | `python sdd_gates.py fr` | `python sdd_gates.py ownership` | `python sdd_gates.py run <stage>` |
| Node | `node check-fr-coverage.mjs` | `node check-ownership.mjs` | `node sdd-run.mjs <stage>` |

4판 모두 같은 `sdd.config.json`을 읽고, `fr`은 PREFIX 거버넌스(미등록 접두어 exit 1)를 포함하며, spec/요구 ID 문법(`specIdPrefixes`·`requirementIdPrefixes` 파생, 레터 서픽스 포함)이 전 런타임 동일하다(런타임 간 문법 드리프트는 `runtime-contract.test.mjs`가 회귀로 차단). 단 **다음은 Node·Python 두 판만**(정직한 델타, SPEC-006): ownership 키 정규화·형식검증(normalizeKey/validateKey)·**entity 레지스트리(`entityRegistry`)**·**Files 카테고리 금지(SPEC-013)**, fr의 **검증 회계**(`strictSpecs`·`requireAccounting`·`smokeManifest`, SPEC-007)·**접두어↔클래스 정합**(`prefixClassExemptions`, SPEC-012), completeness의 **문법 규범**(Module 존재·단일성·SHALL·Dedup 참조 실재, SPEC-013), spec-sync의 **글롭 문법 staged 차단**(SPEC-013) — 셸/Go판 fr·ownership은 핵심 판정(커버리지·PREFIX 등록·사유·소문자 dedup)까지다.

보강 게이트(advisory)와 spec-first 게이트는 **Node·Python 두 판 완전 동봉**(같은 픽스처에 같은 판정 — 패리티 테스트로 강제):
| 게이트 | Node | Python |
|---|---|---|
| 테스트 적정성 | `node check-test-adequacy.mjs` | `python sdd_gates.py adequacy` |
| converge drift | `node check-converge-drift.mjs [base]` | `python sdd_gates.py converge [base]` |
| orphan surface | `node check-orphan-surfaces.mjs` | `python sdd_gates.py orphan` |
| spec 입도(cohesion) | `node check-spec-cohesion.mjs` | `python sdd_gates.py cohesion` |
| spec 완전성(SC·인수조건 + **수명주기 기록** — Status enum·Review Log·Dedup-Review, SPEC-008 + **문법 규범** — Module 존재·단일성·SHALL·Dedup 참조 실재, SPEC-013) | `node check-spec-completeness.mjs` | `python sdd_gates.py completeness` |
| spec 일관성 | `node check-spec-consistency.mjs` | `python sdd_gates.py consistency` |
| **spec-first(§5, hard — Draft 소유 차단·`specSyncUnownedPolicy` 포함)** | `node check-spec-sync.mjs --staged --message-file <p>` / `[base]` | `python sdd_gates.py specsync --staged --message-file <p>` / `[base]` |
| **재도출 소스 회계(SPEC-009 — 9클래스·검출 교차검사·미설정 no-op)** | `node check-derivation.mjs` | `python sdd_gates.py derivation` |
| **smoke 증거 자동 수집(SPEC-010 — 태그 수집·`--write` 재생성·드리프트 check)** | `node sdd-smoke-scan.mjs [--write]` | `python sdd_gates.py smokescan [--write]` |
| **추적 태그 마이그레이션(SPEC-011 — dry-run 기본·`--write` 적용)** | `node sdd-retag.mjs <map.json> [--write]` | `python sdd_gates.py retag <map.json> [--write]` |

셸/Go판은 핵심 3커맨드만 제공한다 — 보강 게이트가 필요한 비-Node 프로젝트는 Python판을 쓴다(둘 다 없는 환경이 실제 생기면 그때 승격 판단).

아래 예시는 `<GATE>` = 위 중 택1로 읽으면 된다.

---

## 1. 로컬 / Makefile (CI 없이도 충분)
```make
check:                 ## SDD 게이트 + 프로젝트 검증
	<GATE> run lint
	<GATE> run typecheck
	<GATE> run test
	<GATE> fr
	<GATE> ownership
```
`make check` 한 번. CI가 없어도 이걸 PR 전에 돌리면 SSOT가 유지된다.

## 2. git pre-push 훅 (provider 0 — git만)
`.git/hooks/pre-push` (또는 husky/pre-commit 프레임워크):
```sh
#!/bin/sh
<GATE> fr || exit 1
<GATE> ownership || exit 1
```
> 이것만으로도 "기계적 강제"가 성립한다 — CI 서비스가 전혀 없어도.

## 3. 어떤 CI/CD 도구든 (공통 형태)
대부분의 CI/CD 도구는 "셸 스텝 나열"이라 형태가 같다 — 한 잡(job)에서 아래 스텝을 실행하면 끝:
```yaml
# 도구 무관 의사(pseudo) 스텝 — 실제 키 이름만 그 도구 문법으로:
steps:
  - <GATE> run lint
  - <GATE> run typecheck
  - <GATE> run test
  - <GATE> fr
  - <GATE> ownership
```
- **파이프라인이 한 줄 스크립트면:** `<GATE> run lint && <GATE> run test && <GATE> fr && <GATE> ownership`
- **셸판을 쓰면** 러너 이미지에 `grep`/`awk`/`jq`만 있으면 됨(대개 기본). **Go 바이너리**면 이미지·도구 무관.
- 워크플로우 YAML 형식을 쓰는 도구용 **복붙 샘플**: `tooling/sdd-gates.yml`(게이트), `tooling/sdd-gate-release.yml`(Go 바이너리 빌드). 다른 도구는 위 스텝을 그 문법으로 옮기면 동일.

---

> **요지:** SSOT를 "주장"이 아닌 "기계적 사실"로 만드는 건 *게이트가 매 변경마다 자동 실행되어 red면 막는다*는 점이지, **특정 CI/CD 제품이 아니다**. 강제 지점(로컬 훅/사내 CI/클라우드 CI/CD)은 팀이 고르고, 명령은 동일하다. (`SSOT.md` §4, `REALITY_CHECK.md`)
