# 게이트 실행 — 어디서든 (CI/CD 도구 무관)

> **게이트는 그냥 CLI 명령이다.** 특정 CI/CD 도구도, git 호스트도 필요 없다. 로컬·git 훅·`make`·사내든 클라우드든 **어떤 CI/CD 도구**에서나 돌릴 수 있다. 어느 도구든 핵심은 같다 — *변경마다 두 게이트 명령을 한 스텝에서 실행하고, 0이 아니면 막는다.* 아래는 환경별로 거는 예시일 뿐.

## 게이트 명령 (런타임 4판 중 가진 쪽 — 동작 동일)
| 런타임 | FR↔test | 소유권 중복 | 러너 |
|---|---|---|---|
| **Go 바이너리** | `sdd-gate fr` | `sdd-gate ownership` | `sdd-gate run <stage>` |
| 셸 | `sh sdd_gates.sh fr` | `sh sdd_gates.sh ownership` | `sh sdd_gates.sh run <stage>` |
| Python | `python sdd_gates.py fr` | `python sdd_gates.py ownership` | `python sdd_gates.py run <stage>` |
| Node | `node check-fr-coverage.mjs` | `node check-ownership.mjs` | `node sdd-run.mjs <stage>` |

보강 게이트 3종(advisory — Node 우선, 나머지 런타임 포팅 예정):
| 게이트 | Node | 기타 런타임 |
|---|---|---|
| 테스트 적정성 | `node check-test-adequacy.mjs` | (포팅 예정) |
| converge drift | `node check-converge-drift.mjs [base]` | (포팅 예정) |
| orphan surface | `node check-orphan-surfaces.mjs` | (포팅 예정) |
| spec 입도(cohesion) | `node check-spec-cohesion.mjs` | (포팅 예정) |
| spec 완전성 | `node check-spec-completeness.mjs` | (포팅 예정) |

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
