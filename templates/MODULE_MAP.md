# MODULE MAP — 모듈 마스터 인덱스 (범용 템플릿)

> 모듈>spec 레지스트리. 새 기능은 여기서 **소속 모듈 + 기존 spec 중복**을 먼저 확인한다(`STRUCTURE.md`). cross-spec 중복 리뷰의 1차 도구.

## 모듈 목록
| 모듈(ID) | Spec | 책임(한 줄) | 코드 경로 | 구조 SSOT | 상태 |
|---|---|---|---|---|---|
| `<module-a>` | SPEC-001 | […] | `<코드 경로>` | `<migration/스키마/proto/IaC — 없으면 —>` | draft |
| `<module-b>` | SPEC-002 | […] | `<코드 경로>` | `<—>` | draft |

> 컬럼 "코드 경로 / 구조 SSOT"가 SSOT 3계층(spec/code/구조) 연결을 가시화한다(`STRUCTURE.md` §SSOT 3계층). 구조 SSOT는 프로젝트마다 다름(RDB앱=migration, API=스키마/proto, IaC=terraform/k8s, 순수 라이브러리=없음 `—`).

## 의존관계
- `<module-b>` → `<module-a>` (예: 인증 → 모든 모듈)

## 추가 규칙
- 모듈은 안정적 bounded context로 ~10여 개. 과편화 금지.
- 새 FR이 같은 모듈 기존 FR과 의미 중복이면 **새 spec 금지, 기존 spec 개정.**
- 상태 컬럼: `draft/active/deprecated/removed`. 제거는 코드·테스트 동시 삭제 후(`STRUCTURE.md` 수명주기).

## 제거 로그 (Removed)
| 날짜 | Spec/모듈 | 사유 | 코드·테스트 삭제 PR |
|---|---|---|---|
| | | | |
> 삭제된 spec은 git 히스토리에 보존됨 — 표에 사유·날짜만 남기고 파일은 트리에서 제거.
