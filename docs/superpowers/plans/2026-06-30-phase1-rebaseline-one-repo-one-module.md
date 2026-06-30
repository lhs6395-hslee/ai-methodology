# Phase 1 — 1 레포 = 1 모듈 재기준화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방법론 문서를 "한 레포 다중 모듈" 가정에서 **1 레포 = 1 모듈 + 큰 프로그램 = MSA 합성**으로 재기준화한다(문서·템플릿만; MSA 계약 프로파일 자체는 Phase 2).

**Architecture:** 6개 방법론 문서 + 1개 템플릿의 모듈 관련 단언을 교정한다. 코드/게이트 로직은 건드리지 않는다. 검증은 (a) 모순 표현 grep = 0, (b) 기존 게이트 테스트 6/6 PASS 회귀 확인.

**Tech Stack:** Markdown 문서. 검증은 `grep` + `node --test`(Node v25.5.0).

## Global Constraints

- **이 키트는 현재 비-git 상태**(`.git` 제거됨). 따라서 각 태스크의 "Checkpoint"는 git commit이 아니라 **grep 검증 + diff 육안 확인**이다. (버전관리가 필요하면 실행 시작 전에 `git init` 여부를 사용자와 합의 — 본 계획은 비-git 전제로 실행 가능.)
- **방법론 설명서는 키트에 두고 참조**(레포 밖, fork 금지) — 메모리 [[sdd-portable-kit-config-driven]].
- **벤더 중립** 유지 — 상호작용은 "이벤트 로그/동기 호출" 같은 *의미*로, 제품명("Kafka") 금지. 메모리 [[prefer-vendor-neutral-cicd-language]].
- 정본 언어 = 한국어 문서(기존 스타일·terse·표 위주 유지).
- 게이트 테스트 실행 형식은 **글로브 필수**: `node --test tooling/__tests__/*.mjs` (Node 25.5는 디렉토리 형식 불가).
- **Phase 1 비목표(out of scope):** 계약 산출물·SYSTEM_MAP·계약 게이트·consumer 핀 — 전부 Phase 2.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `STRUCTURE.md` | 모듈>spec 구조 정의 | 큰 틀 블록 flip + 소유권 유일성 범위 명시 |
| `templates/MODULE_MAP.md` | 모듈 매니페스트 템플릿 | 다중 모듈 인덱스 → **단일 모듈 매니페스트**로 전면 재작성 |
| `STORAGE.md` | 저장 계약·레이아웃 | §1 레이아웃을 레포=모듈로, §4 요지 보강 |
| `APPLYING.md` | 설치 런북 | §2 "10여 모듈" → "단일 모듈 정의" |
| `METHODOLOGY.md` | 0~8 루프 | 루프 단위 = 1 레포=1 모듈 명시 한 줄 |
| `DEDUP.md` | 중복 차단 2계층 | 소유권 유일성 범위 = 레포(모듈) 1개 명시 |
| `README.md` | 키트 개요 | 템플릿 라벨 미세 갱신 |

각 태스크는 한 파일에 닫힌 변경이라 독립 검토 가능.

---

### Task 1: STRUCTURE.md — 모듈 모델 flip + 소유권 유일성 범위

**Files:**
- Modify: `STRUCTURE.md` (lines 3-6, 그리고 "강제(게이트)" 문단)

**Interfaces:**
- Produces: 방법론 전체가 참조하는 "1 레포 = 1 모듈" 정식 정의. 이후 태스크들이 이 문구에 정합.

- [ ] **Step 1: "큰 틀 = 모듈" 블록 교체**

`old_string` (정확히):
```markdown
## 큰 틀 = 모듈, 그 안에 spec
- **모듈** = 안정적 bounded context(제품당 보통 10여 개). 그 능력 영역의 SSOT 홈.
- **spec** = 모듈 안의 응집된 기능 단위. 각 spec = 그 기능의 **살아있는 기능명세서**.
- **과편화 금지** — 모듈을 너무 잘게 쪼개면 중복 리뷰가 폭발. `MODULE_MAP.md`로 인덱싱.
```
`new_string`:
```markdown
## 큰 틀 = 1 레포 = 1 모듈, 그 안에 spec
- **1 레포 = 1 모듈** (무조건). 레포 하나 = 안정적 bounded context 하나 = 그 능력 영역의 SSOT 홈. 모듈이 늘면 **레포가 는다**(한 레포에 여러 모듈을 넣지 않는다).
- **spec** = 그 모듈 안의 응집된 기능 단위. 각 spec = 그 기능의 **살아있는 기능명세서**. 한 모듈(레포)은 spec 다수를 가진다.
- **큰 프로그램 = 여러 모듈-레포의 MSA 합성** — 모듈 간은 공개 계약(API/이벤트)으로만 결합한다. 그 계약을 1급 SSOT로 강제하는 **MSA 계약 프로파일은 다중 모듈일 때 켜는 선택 계층**(Phase 2).
- **과편화 금지** — 한 모듈(레포) 안의 spec을 너무 잘게 쪼개면 중복 리뷰가 폭발. 그 모듈의 spec은 `MODULE_MAP.md`(단일 모듈 매니페스트)로 인덱싱.
```

- [ ] **Step 2: 소유권 유일성 범위 명시**

"강제(게이트)" 문단 `old_string` (정확히):
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 **키별 소유 spec이 1개인지** CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. (게이트는 Go 바이너리·셸·Python·Node 4판 동작 동일 — `principles.md` §10; CI는 provider 무관 — `ci-examples.md`.)
```
`new_string`:
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 **키별 소유 spec이 1개인지** CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. (게이트는 Go 바이너리·셸·Python·Node 4판 동작 동일 — `principles.md` §10; CI는 provider 무관 — `ci-examples.md`.) **유일성 범위 = 이 레포(=한 모듈)의 전 spec.** 모듈 간(레포 간) 키는 MSA 계약 경계로 분리되므로 dedup 대상이 아니다(1 레포=1 모듈).
```

- [ ] **Step 3: Checkpoint — 검증**

Run: `grep -nE "제품당|10여" STRUCTURE.md`
Expected: 출력 없음(0 hits).
Run: `grep -nc "1 레포 = 1 모듈" STRUCTURE.md`
Expected: `1` 이상.

---

### Task 2: templates/MODULE_MAP.md — 단일 모듈 매니페스트로 재작성

**Files:**
- Modify: `templates/MODULE_MAP.md` (전면 재작성)

**Interfaces:**
- Consumes: Task 1의 "단일 모듈 매니페스트" 명명.
- Produces: `sdd-init.sh`/`APPLYING.md`가 `sdd/MODULE_MAP.md`로 복사하는 템플릿. 공개 계약 포인터 행은 *선택*(단일 모듈이면 `—`); 외부 의존 핀 표는 Phase 2에서 추가.

- [ ] **Step 1: 파일 전체를 새 내용으로 교체**

Write `templates/MODULE_MAP.md` 전체:
```markdown
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

> "코드 경로"가 SSOT 3계층(spec/code/구조) 연결을 가시화한다(`STRUCTURE.md` §SSOT 3계층).

## 추가 규칙
- 한 모듈(레포) 안 spec 과편화 금지. 새 FR이 같은 모듈 기존 FR과 의미 중복이면 **새 spec 금지, 기존 spec 개정.**
- 상태 컬럼: `draft/active/deprecated/removed`. 제거는 코드·테스트 동시 삭제 후(`STRUCTURE.md` 수명주기).

## 제거 로그 (Removed)
| 날짜 | Spec | 사유 | 코드·테스트 삭제 PR |
|---|---|---|---|
| | | | |
> 삭제된 spec은 VCS 히스토리에 보존됨 — 표에 사유·날짜만 남기고 파일은 트리에서 제거.
```

- [ ] **Step 2: Checkpoint — 검증**

Run: `grep -nE "10여|마스터 인덱스|모듈>spec" templates/MODULE_MAP.md`
Expected: 출력 없음(0 hits).
Run: `grep -nc "1 레포 = 1 모듈" templates/MODULE_MAP.md`
Expected: `1` 이상.

---

### Task 3: STORAGE.md — 레포=모듈 레이아웃

**Files:**
- Modify: `STORAGE.md` (§1 heading line 13, §1 intro line 14, layout 주석 line 20, §4 요지 line 79)

- [ ] **Step 1: §1 heading 교체**

`old_string`: `## 1. 프로젝트 정식 레이아웃 — 한 레포, 두 구역(SDD + TDD)`
`new_string`: `## 1. 프로젝트 정식 레이아웃 — 1 레포 = 1 모듈, 두 구역(SDD + TDD)`

- [ ] **Step 2: §1 intro 문장에 모듈 단위 명시**

`old_string` (정확히):
```markdown
> 이 방법론은 **SDD(무엇을/왜) + TDD(어떻게)** 가 함께 도는 구조다. 둘은 **다른 디렉토리**에 살고 **FR-ID 추적 태그로만 연결**된다. ⚠ **코드·테스트를 `sdd/`에 넣지 말 것** — `sdd/`는 *문서·메타*만, 코드·테스트는 그 언어의 정상 소스 트리에.
```
`new_string`:
```markdown
> 이 방법론은 **SDD(무엇을/왜) + TDD(어떻게)** 가 함께 도는 구조다. 둘은 **다른 디렉토리**에 살고 **FR-ID 추적 태그로만 연결**된다. ⚠ **코드·테스트를 `sdd/`에 넣지 말 것** — `sdd/`는 *문서·메타*만, 코드·테스트는 그 언어의 정상 소스 트리에. **이 레포는 하나의 모듈(bounded context)을 구현한다** — 모듈이 더 필요하면 레포를 나눈다(MSA, `STRUCTURE.md`).
```

- [ ] **Step 3: 레이아웃 주석 교체**

`old_string`: `│  ├─ MODULE_MAP.md             # │  모듈>spec 레지스트리(소유권 인덱스)`
`new_string`: `│  ├─ MODULE_MAP.md             # │  이 레포 단일 모듈 매니페스트(정체성+spec 인덱스)`

- [ ] **Step 4: §4 요지에 1-레포-1-모듈 한 줄 추가**

`old_string` (정확히):
```markdown
> 요지: **SDD 구역(spec=무엇을/왜)과 TDD 구역(코드·테스트=어떻게)을 다른 디렉토리에 저장하고, `@covers` FR-ID 태그로 잇는다. 배선(config·게이트)이 그 사슬을 CI에서 강제한다.** "왜 이렇게 하나"(방법론 설명서)는 키트를 참조한다. 저장·연결의 단일 SSOT는 `sdd.config.json` 한 장.
```
`new_string`:
```markdown
> 요지: **SDD 구역(spec=무엇을/왜)과 TDD 구역(코드·테스트=어떻게)을 다른 디렉토리에 저장하고, `@covers` FR-ID 태그로 잇는다. 배선(config·게이트)이 그 사슬을 CI에서 강제한다.** "왜 이렇게 하나"(방법론 설명서)는 키트를 참조한다. 저장·연결의 단일 SSOT는 `sdd.config.json` 한 장. **단위는 1 레포 = 1 모듈 — 다중 모듈은 다중 레포 = MSA 합성.**
```

- [ ] **Step 5: Checkpoint — 검증**

Run: `grep -nE "모듈>spec|한 레포, 두 구역" STORAGE.md`
Expected: 출력 없음(0 hits).
Run: `grep -nc "1 레포 = 1 모듈" STORAGE.md`
Expected: `2` 이상(heading + 요지).

---

### Task 4: APPLYING.md §2 — 단일 모듈 정의

**Files:**
- Modify: `APPLYING.md` (§2 line 35)

- [ ] **Step 1: "10여 개 모듈" 문장 교체**

`old_string` (정확히):
```markdown
- `STRUCTURE.md`대로 모듈을 10여 개로 정의, `MODULE_MAP.md`에 등록. 도메인 placeholder를 실제 도메인으로 치환.
```
`new_string`:
```markdown
- `STRUCTURE.md`대로 **이 레포의 단일 모듈**(bounded context 하나)을 정의하고 `MODULE_MAP.md`(단일 모듈 매니페스트)에 등록. 도메인 placeholder를 실제 도메인으로 치환. 모듈이 더 필요하면 **레포를 나눈다**(MSA — 다중 모듈이면 Phase 2 계약 프로파일).
```

- [ ] **Step 2: Checkpoint — 검증**

Run: `grep -nE "10여" APPLYING.md`
Expected: 출력 없음(0 hits).

---

### Task 5: METHODOLOGY.md — 루프 단위 명시

**Files:**
- Modify: `METHODOLOGY.md` ("## 0~8 루프" 헤딩 직후)

- [ ] **Step 1: 루프 단위 한 줄 추가**

`old_string` (정확히):
```markdown
## 0~8 루프
| 단계 | 담당 | 행위 | 게이트 |
```
`new_string`:
```markdown
## 0~8 루프
> **단위 = 1 레포 = 1 모듈.** 이 루프는 한 모듈(레포) 안에서 돈다. 큰 프로그램은 여러 모듈-레포의 **MSA 합성**이며, 모듈 간 계약은 다중 모듈일 때 켜는 **MSA 계약 프로파일**이 강제한다(`STRUCTURE.md`).

| 단계 | 담당 | 행위 | 게이트 |
```

- [ ] **Step 2: Checkpoint — 검증**

Run: `grep -nc "단위 = 1 레포 = 1 모듈" METHODOLOGY.md`
Expected: `1`.

---

### Task 6: DEDUP.md — 소유권 유일성 범위

**Files:**
- Modify: `DEDUP.md` (§3 "강제(게이트)" 문단)

- [ ] **Step 1: 범위 명시 문장 추가**

`old_string` (정확히):
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 키별 소유 spec이 1개인지 CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제.
```
`new_string`:
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 키별 소유 spec이 1개인지 CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. **유일성 범위 = 이 레포(=한 모듈)의 전 spec** — 모듈 간(레포 간)은 MSA 계약 경계로 분리되어 dedup 대상이 아니다(`STRUCTURE.md` 1 레포=1 모듈).
```

- [ ] **Step 2: Checkpoint — 검증**

Run: `grep -nc "유일성 범위 = 이 레포" DEDUP.md`
Expected: `1`.

---

### Task 7: README.md 라벨 + 전체 정합 스윕 + 게이트 회귀

**Files:**
- Modify: `README.md` (line 26 템플릿 라벨)

- [ ] **Step 1: README 템플릿 라벨 갱신**

`old_string` (정확히):
```markdown
| `templates/` | `module-spec.md`(EARS 범용), `MODULE_MAP.md`, `constitution.md` | 템플릿 |
```
`new_string`:
```markdown
| `templates/` | `module-spec.md`(EARS 범용), `MODULE_MAP.md`(단일 모듈 매니페스트), `constitution.md` | 템플릿 |
```

- [ ] **Step 2: 전체 모순 표현 스윕**

Run: `grep -rnE "제품당|10여|모듈 마스터|모듈>spec" . --include="*.md" 2>/dev/null | grep -v "docs/superpowers/" | grep -v "/memory/"`
Expected: **출력 없음(0 hits).** 하나라도 나오면 그 파일을 1 레포=1 모듈 규칙으로 교정(이 계획의 편집 패턴을 따른다). 알려진 잔여 후보 없음(Task 1~6이 전부 처리).

- [ ] **Step 3: 게이트 테스트 회귀 (툴링 미손상 확인)**

Run: `node --test tooling/__tests__/*.mjs`
Expected: `tests 6` / `pass 6` / `fail 0`. (Phase 1은 `tooling/`을 건드리지 않으므로 반드시 그대로 PASS여야 한다.)

- [ ] **Step 4: Checkpoint — 정합 통독**

`STRUCTURE.md`·`STORAGE.md`·`METHODOLOGY.md`·`APPLYING.md`·`DEDUP.md`·`templates/MODULE_MAP.md`를 통독해 "1 레포=1 모듈"과 "MSA 합성(계약 프로파일=Phase 2)" 서술이 서로 모순 없이 일관하는지 육안 확인.

---

## Self-Review (작성자 점검)

**1. Spec coverage** — 설계 §4(Phase 1) 변경표의 6개 파일 전부 태스크로 매핑됨: STRUCTURE(T1)·MODULE_MAP템플릿(T2)·STORAGE(T3)·APPLYING(T4)·METHODOLOGY(T5)·DEDUP(T6). README는 보너스 정합(T7). 설계 §4의 "소유권 유일성 범위 한정"은 T1 Step2 + T6에 반영. ✓

**2. Placeholder scan** — 모든 편집 단계가 정확한 old/new 문자열 또는 전체 파일 본문을 포함. "적절히"·"TODO"·"비슷하게" 없음. ✓

**3. Type consistency** — 신규 용어 통일: "단일 모듈 매니페스트"(T1/T2/T3/T4/T7), "1 레포 = 1 모듈"(T1/T3/T5), "MSA 계약 프로파일 = Phase 2"(T1/T4/T5). 표기 흔들림 없음. ✓

**범위 메모:** MSA 계약 프로파일(계약 산출물·SYSTEM_MAP·계약 게이트·consumer 핀)은 **Phase 2 별도 계획**. 본 계획 완료 시 방법론은 단일 모듈 레포로 완결 동작.
