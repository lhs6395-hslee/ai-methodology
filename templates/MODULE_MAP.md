# MODULE MANIFEST — 이 레포의 단일 모듈 (범용 템플릿)

> **1 레포 = 1 모듈.** 이 파일은 이 레포가 구현하는 *하나의* 모듈을 선언한다 — 정체성·공개 계약 포인터·그 모듈이 가진 spec 인덱스. 새 기능은 여기서 **기존 spec 중복**을 먼저 확인한다(`STRUCTURE.md`). 모듈이 더 필요하면 **레포를 나눈다**(MSA).

## 모듈 정체성
- **모듈 ID:** `<module-id>`
- **Bounded context(한 줄):** […이 모듈이 책임지는 능력 영역…]
- **구조 SSOT:** `<migration/스키마/proto/IaC — 없으면 —>`

## 공개 계약 (MSA — 다중 모듈일 때만, 단일이면 —)
> 이 모듈이 외부 모듈에 노출하는 인터페이스. 계약 산출물(OpenAPI/proto/이벤트 스키마)은 소스 트리에 두고, 그 모듈 spec의 `## Ownership > Surface`가 소유한다. 상세 강제는 Phase 2(MSA 계약 프로파일).
| 공개 Surface | 계약 산출물 경로 | 소유 spec |
|---|---|---|
| `<POST /api/... 또는 이벤트명 — 없으면 —>` | `<api/openapi.yaml 등 — 없으면 —>` | `<SPEC-NNN — 없으면 —>` |

## Spec 인덱스 (이 모듈의 spec)
| Spec | 책임(한 줄) | 코드 경로 | 상태 |
|---|---|---|---|
| SPEC-001 | […] | `<코드 경로>` | draft |
| SPEC-002 | […] | `<코드 경로>` | draft |

> "코드 경로"가 SSOT 3계층(spec/code/구조) 연결을 가시화한다(`STRUCTURE.md` §SSOT 3계층). 한 spec이 여러 기능을 욱여넣지 않도록 입도는 `check-spec-cohesion`이 advisory로 점검.

## 추가 규칙
- 한 모듈(레포) 안 spec 과편화 금지 + **under-fragmentation 금지**(1 spec=1 응집 capability). 새 FR이 같은 모듈 기존 FR과 의미 중복이면 **새 spec 금지, 기존 spec 개정.**
- 상태 컬럼: `draft/active/deprecated/removed`. 제거는 코드·테스트 동시 삭제 후(`STRUCTURE.md` 수명주기).

## 제거 로그 (Removed)
| 날짜 | Spec | 사유 | 코드·테스트 삭제 PR |
|---|---|---|---|
| | | | |
> 삭제된 spec은 VCS 히스토리에 보존됨 — 표에 사유·날짜만 남기고 파일은 트리에서 제거.
