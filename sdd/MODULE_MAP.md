# MODULE MANIFEST — 이 레포의 단일 모듈 (SDD 키트 자기 정렬)

> **1 레포 = 1 모듈.** 이 파일은 이 레포가 구현하는 *하나의* 모듈 `sdd-tooling`을 선언한다 — 정체성·공개 계약 포인터·spec 인덱스. 새 기능은 여기서 **기존 spec 중복**을 먼저 확인한다(`STRUCTURE.md`). 이 키트는 자기 자신도 자기 궤도(spec→@covers→게이트→hook) 위에 올린다(자기 정렬/도그푸딩).

## 모듈 정체성
- **모듈 ID:** `sdd-tooling`
- **Bounded context(한 줄):** 언어/스택 무관 SDD 게이트 스위트 + spec-first 하네스 + 설치기(키트가 원본).
- **구조 SSOT:** `sdd.config.json`(저장·카테고리·접두어 정의) + `tooling/`(게이트 소스)

## 공개 계약 (MSA — 다중 모듈일 때만, 단일이면 —)
> 단일 모듈이라 외부 공개 Surface 없음.
| 공개 Surface | 계약 산출물 경로 | 소유 spec |
|---|---|---|
| — | — | — |

## Spec 인덱스 (이 모듈의 spec)
| Spec | 책임(한 줄) | 코드 경로 | 상태 |
|---|---|---|---|
| SPEC-001 | 소유권 키 파싱·정규화·검증 파이프라인 + config 어댑터 | `tooling/ownership-keys.mjs`, `tooling/sdd-config.mjs` | active |
| SPEC-002 | spec 품질 게이트군(fr-coverage·ownership·cohesion·completeness·consistency) + PREFIX 거버넌스 | `tooling/check-*.mjs` | active |
| SPEC-003 | spec-first 강제(spec-sync) — staged hard / range advisory + commit-msg 훅 | `tooling/check-spec-sync.mjs`, `tooling/spec-sync-lib.mjs` | active |
| SPEC-004 | 하네스(detect 집계) + 설치기(훅·settings·스킬 배선) | `tooling/sdd-sync.mjs`, `tooling/sdd-init.sh`, `tooling/harness/**` | active |
| SPEC-005 | 채택 수명주기 명령(start/readopt/update) — prompts/ 정본 절차 실행 + 승인 게이트·안전망 불변식 | `tooling/harness/sdd-{start,readopt,update}.SKILL.md` | active |
| SPEC-006 | 비-Node 런타임 복제 충실도(Python 전 게이트·셸/Go 핵심 3커맨드·preset 템플릿 앵커) | `tooling/sdd_gates.py`, `tooling/sdd_gates.sh`, `tooling/go-gate/main.go` | active |
| SPEC-007 | FR 검증 회계 — strictSpecs·requireAccounting·smokeManifest | `tooling/verification-accounting.mjs` | active |
| SPEC-008 | 스펙 수명주기 — Status enum·Draft 차단·리뷰 기록 존재 | `tooling/lifecycle-lib.mjs` | active |
| SPEC-009 | 재도출 소스 회계 — 소스 클래스 9종·derivationManifest·검출 교차검사·Change Log 근거 선제 캡처 | `tooling/check-derivation.mjs`, `tooling/derivation-lib.mjs` | active |
| SPEC-010 | smoke 증거 자동 수집 — 검증 태그 스캔·smokeManifest 재생성(--write)·드리프트 검사 | `tooling/sdd-smoke-scan.mjs` | active |
| SPEC-011 | 추적 태그 마이그레이션 — 재번호 맵(old→new\|null)의 기계 이행·경계 강제 | `tooling/sdd-retag.mjs` | active |
| SPEC-012 | 접두어↔derivation 클래스 정합 — 전체성 판정·prefixClassExemptions 거버넌스 | `tooling/prefix-class-lib.mjs` | active |
| SPEC-013 | 스펙 문법 규범 강제 — Module 존재·단일성, FR 라인 SHALL, Dedup 참조 실재, Files 카테고리 금지, 글롭 문법 staged 차단 | `tooling/grammar-lib.mjs` | active |
| SPEC-014 | 스펙 번호 매김 정합 — 접두어별 001부터·중복 금지 hard, 001..max 중간 gap advisory(`--strict` 승격) | `tooling/numbering-lib.mjs` | active |
| SPEC-015 | TEST 삭제가능 도메인(런타임+인프라) — TEST 인프라 소유 허용(prefix-class 면제)+`testInfraGlobs`로 제품 스펙 격리 | `tooling/test-domain-lib.mjs` | active |
| SPEC-016 | 오브젝트 스토리지 도입 결정 — `objectStorageMarkers` 감지·`## Object Storage Decision` 섹션(버킷·이전 라벨) completeness | `tooling/object-storage-lib.mjs` | active |
| SPEC-017 | Entity 관계 정합 — `Name (relation-type)` 구조화·대상 실재·소유 spec 해석 hard, aggregate 간 순환 참조 advisory | `tooling/relation-lib.mjs` | active |
| SPEC-018 | 명세 폐기 워크플로 — `sdd-retire`(dry-run/--write)·Planned 회계·retiredIds gap·inbound 참조 지목 | `tooling/sdd-retire.mjs`, `tooling/retire-lib.mjs` | active |
| SPEC-019 | semantic drift 승격 — 소유 파일 리네임 감지 시 FR 라인 변경 ∨ Spec-Impact 요구(`semanticDriftPolicy`) | `tooling/drift-lib.mjs` | active |
| SPEC-020 | cross-spec 변경 동인 — `Change-Driver` 트레일러(경로 스코프 `@glob` 포함) 참조 완화 | `tooling/cross-spec-lib.mjs` | active |
| SPEC-021 | 테스트 실행 게이트 — `runTestsPolicy`로 `commands.test` 실행·green 확인(sdd-sync R5·CI 배선) | `tooling/check-test-run.mjs` | active |
| SPEC-022 | 런타임 스키마 드리프트(R2′) — 코드 기대 ↔ 배포 DB 실측 diff, 배포 preflight | `tooling/check-schema-drift.mjs`, `tooling/schema-drift-lib.mjs` | active |
| CICD-001 | 킷 자신 CI 백스톱 — push/PR 스위트·게이트 + PR range spec-sync(서버측 병합 강제 지점) | `.github/workflows/sdd-gates.yml` | active |
| SPEC-023 | FR 키 앵커 — 평문 bold를 소유∪참조 키와 대조(`frKeyAnchorPolicy`, consistency 배선) | `tooling/key-anchor-lib.mjs` | active |

> "코드 경로"가 SSOT 3계층(spec/code/구조) 연결을 가시화한다(`STRUCTURE.md` §SSOT 3계층). 한 spec이 여러 기능을 욱여넣지 않도록 입도는 `check-spec-cohesion`이 advisory로 점검. SPEC-002는 5개 게이트를 한 응집 aggregate로 소유하므로 `maxKeysPerCategoryPerSpec`를 7로 조정했다(사유는 SPEC-002 Change Log).

## 추가 규칙
- 한 모듈(레포) 안 spec 과편화 금지 + **under-fragmentation 금지**(1 spec=1 응집 capability). 새 FR이 같은 모듈 기존 FR과 의미 중복이면 **새 spec 금지, 기존 spec 개정.**
- 상태 컬럼: `draft/active/deprecated/removed`. 제거는 코드·테스트 동시 삭제 후(`STRUCTURE.md` 수명주기).
- PREFIX 표준 = `SPEC/INFRA/TEST/CICD`만. 새 접두어는 `sdd.config.json`의 `specIdPrefixes`+`prefixRationale`에 사유와 함께 등록.

## 제거 로그 (Removed)
| 날짜 | Spec | 사유 | 코드·테스트 삭제 PR |
|---|---|---|---|
| | | | |
> 삭제된 spec은 VCS 히스토리에 보존됨 — 표에 사유·날짜만 남기고 파일은 트리에서 제거.
