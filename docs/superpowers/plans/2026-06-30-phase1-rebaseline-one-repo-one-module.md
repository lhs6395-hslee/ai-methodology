# Phase 1 — 1 레포=1 모듈 재기준화 + Spec 입도(cohesion) 게이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방법론 문서를 **1 레포 = 1 모듈 + MSA 합성**으로 재기준화하고(Gap 1), 같은 패스에서 **spec 입도(cohesion)** 규칙·advisory 게이트를 더해 "spec 1개에 여러 기능 욱여넣기"를 차단한다(Gap 2).

**Architecture:** 6개 방법론 문서 + 1개 템플릿의 모듈 가정을 교정(Gap 1)하고, `check-ownership`(dedup)의 거울상인 `check-spec-cohesion` advisory 게이트(+config 기본값+테스트+CI 배선)를 추가(Gap 2). 검증 = (a) 모순 표현 grep = 0, (b) 게이트 테스트 전부 PASS(기존 6 + 신규 3 = 9).

**Tech Stack:** Markdown 문서 + Node ESM 게이트(`tooling/*.mjs`). 검증은 `grep` + `node --test`(Node v25.5.0).

## Global Constraints

- **이 키트는 이제 git 추적됨** — `origin` = https://github.com/lhs6395-hslee/ai-methodology, 기본 브랜치 `main`. 사용자 관례: **`main`에 바로 commit/push**(PR/브랜치 없이). → 각 태스크 끝에서 커밋/푸시 가능. (메모리 [[ai-methodology-repo]])
- **방법론 설명서는 키트에 두고 참조**(채택 프로젝트 레포 밖, fork 금지) — 메모리 [[sdd-portable-kit-config-driven]].
- **벤더 중립** 유지 — "이벤트 로그/동기 호출" 같은 의미로, 제품명("Kafka") 금지. 메모리 [[prefer-vendor-neutral-cicd-language]].
- 정본 문서 언어 = 한국어(기존 terse·표 위주 스타일 유지).
- **게이트 4-런타임 동작 동일 원칙**([principles.md §10](../../principles.md)) — 신규 게이트는 Node판으로 추가하고 Go/셸/Python 포팅은 기존 3종처럼 "(포팅 예정)"으로 표기(`tooling/ci-examples.md` 관례).
- 게이트 테스트 실행 형식은 **글로브 필수**: `node --test tooling/__tests__/*.mjs` (Node 25.5는 디렉토리 형식 불가).
- **Gap 2 게이트 신호(확정):** 카테고리별 소유 키 수 > `maxKeysPerCategoryPerSpec`(기본 4), FR 수 > `maxFRsPerSpec`(기본 8). 둘 다 advisory(warn), `--strict`로 exit 1. "독립 US 수"는 게이트 신호 제외(사람 가이드로만).
- **Phase 1 비목표(out of scope):** MSA 계약 산출물·SYSTEM_MAP·계약 게이트·consumer 핀(Phase 2). cohesion 게이트의 Go/셸/Python 포팅(후속).

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `STRUCTURE.md` | 모듈>spec 구조 | 큰 틀 flip + **입도 양방향(과편화/under-fragmentation) 규칙** + 소유권 유일성 범위 |
| `templates/MODULE_MAP.md` | 모듈 매니페스트 | 단일 모듈 매니페스트로 전면 재작성 |
| `STORAGE.md` | 저장 계약·레이아웃 | §1 레이아웃 레포=모듈, §4 요지 |
| `APPLYING.md` | 설치 런북 | §2 단일 모듈 정의 |
| `METHODOLOGY.md` | 0~8 루프 | 루프 단위 = 1 레포=1 모듈 |
| `DEDUP.md` | 중복 차단 2계층 | 소유권 유일성 범위 + **cohesion 거울상 포인터** |
| `SPEC_REVIEW.md` | spec 리뷰 체크리스트 | **과대 spec(입도) 점검 행 추가** |
| `tooling/sdd-config.mjs` | config 로더 DEFAULTS | `maxKeysPerCategoryPerSpec`·`maxFRsPerSpec` 기본값 추가 |
| `tooling/check-spec-cohesion.mjs` | 신규 게이트(under-fragmentation) | 신규 생성 |
| `tooling/__tests__/check-spec-cohesion.test.mjs` | 게이트 테스트 | 신규 생성(3 케이스) |
| `tooling/ci-examples.md` | CI 배선 표 | spec 입도 게이트 행 추가 |
| `README.md` | 키트 개요 | 템플릿 라벨 미세 갱신 |

---

### Task 1: STRUCTURE.md — 모듈 모델 flip + 입도 양방향 규칙 + 소유권 범위

**Files:** Modify `STRUCTURE.md`

**Interfaces:**
- Produces: 방법론 전체가 참조하는 "1 레포 = 1 모듈" 정의 + "1 spec = 1 응집 capability" 입도 규칙. 이후 태스크(SPEC_REVIEW·cohesion 게이트)가 이 문구에 정합.

- [ ] **Step 1: "큰 틀 = 모듈" 블록 교체 (Gap 1 + Gap 2 입도 규칙 동시)**

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
- **입도 — 양방향:** (a) 한 모듈(레포) 안 spec을 너무 잘게 쪼개면 중복 리뷰 폭발(과편화), (b) 반대로 **한 spec에 여러 기능을 욱여넣으면 추적·소유권이 무력화**(under-fragmentation). 기준은 **1 spec = 1 응집 capability 묶음** — 서로 다른 top-level Surface/Capability를 여럿 소유하거나 독립 user story 여러 개에 걸치면 **capability별로 분할**한다. 강제는 `check-spec-cohesion`(advisory, dedup의 거울상). 그 모듈의 spec은 `MODULE_MAP.md`(단일 모듈 매니페스트)로 인덱싱.
```

- [ ] **Step 2: 소유권 유일성 범위 명시**

`old_string` (정확히):
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 **키별 소유 spec이 1개인지** CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. (게이트는 Go 바이너리·셸·Python·Node 4판 동작 동일 — `principles.md` §10; CI는 provider 무관 — `ci-examples.md`.)
```
`new_string`:
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 **키별 소유 spec이 1개인지** CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. (게이트는 Go 바이너리·셸·Python·Node 4판 동작 동일 — `principles.md` §10; CI는 provider 무관 — `ci-examples.md`.) **유일성 범위 = 이 레포(=한 모듈)의 전 spec.** 모듈 간(레포 간) 키는 MSA 계약 경계로 분리되므로 dedup 대상이 아니다(1 레포=1 모듈). **거울상:** 한 spec이 키/FR을 과다 소유하면(under-fragmentation) `check-spec-cohesion` advisory 게이트가 분할을 권고한다.
```

- [ ] **Step 3: Checkpoint — 검증**

Run: `grep -nE "제품당|10여" STRUCTURE.md` → Expected: 출력 없음.
Run: `grep -nc "1 레포 = 1 모듈" STRUCTURE.md` → Expected: `1` 이상.
Run: `grep -nc "under-fragmentation" STRUCTURE.md` → Expected: `1` 이상.

---

### Task 2: templates/MODULE_MAP.md — 단일 모듈 매니페스트로 재작성

**Files:** Modify `templates/MODULE_MAP.md` (전면 재작성)

**Interfaces:**
- Consumes: Task 1의 "단일 모듈 매니페스트" 명명.
- Produces: `sdd-init.sh`/`APPLYING.md`가 `sdd/MODULE_MAP.md`로 복사하는 템플릿.

- [ ] **Step 1: 파일 전체 교체**

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

> "코드 경로"가 SSOT 3계층(spec/code/구조) 연결을 가시화한다(`STRUCTURE.md` §SSOT 3계층). 한 spec이 여러 기능을 욱여넣지 않도록 입도는 `check-spec-cohesion`이 advisory로 점검.

## 추가 규칙
- 한 모듈(레포) 안 spec 과편화 금지 + **under-fragmentation 금지**(1 spec=1 응집 capability). 새 FR이 같은 모듈 기존 FR과 의미 중복이면 **새 spec 금지, 기존 spec 개정.**
- 상태 컬럼: `draft/active/deprecated/removed`. 제거는 코드·테스트 동시 삭제 후(`STRUCTURE.md` 수명주기).

## 제거 로그 (Removed)
| 날짜 | Spec | 사유 | 코드·테스트 삭제 PR |
|---|---|---|---|
| | | | |
> 삭제된 spec은 VCS 히스토리에 보존됨 — 표에 사유·날짜만 남기고 파일은 트리에서 제거.
```

- [ ] **Step 2: Checkpoint — 검증**

Run: `grep -nE "10여|마스터 인덱스|모듈>spec" templates/MODULE_MAP.md` → Expected: 출력 없음.
Run: `grep -nc "1 레포 = 1 모듈" templates/MODULE_MAP.md` → Expected: `1` 이상.

---

### Task 3: STORAGE.md — 레포=모듈 레이아웃

**Files:** Modify `STORAGE.md`

- [ ] **Step 1: §1 heading 교체**

`old_string`: `## 1. 프로젝트 정식 레이아웃 — 한 레포, 두 구역(SDD + TDD)`
`new_string`: `## 1. 프로젝트 정식 레이아웃 — 1 레포 = 1 모듈, 두 구역(SDD + TDD)`

- [ ] **Step 2: §1 intro 문장 보강**

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

- [ ] **Step 4: §4 요지에 한 줄 추가**

`old_string` (정확히):
```markdown
> 요지: **SDD 구역(spec=무엇을/왜)과 TDD 구역(코드·테스트=어떻게)을 다른 디렉토리에 저장하고, `@covers` FR-ID 태그로 잇는다. 배선(config·게이트)이 그 사슬을 CI에서 강제한다.** "왜 이렇게 하나"(방법론 설명서)는 키트를 참조한다. 저장·연결의 단일 SSOT는 `sdd.config.json` 한 장.
```
`new_string`:
```markdown
> 요지: **SDD 구역(spec=무엇을/왜)과 TDD 구역(코드·테스트=어떻게)을 다른 디렉토리에 저장하고, `@covers` FR-ID 태그로 잇는다. 배선(config·게이트)이 그 사슬을 CI에서 강제한다.** "왜 이렇게 하나"(방법론 설명서)는 키트를 참조한다. 저장·연결의 단일 SSOT는 `sdd.config.json` 한 장. **단위는 1 레포 = 1 모듈 — 다중 모듈은 다중 레포 = MSA 합성.**
```

- [ ] **Step 5: Checkpoint**

Run: `grep -nE "모듈>spec|한 레포, 두 구역" STORAGE.md` → Expected: 출력 없음.
Run: `grep -nc "1 레포 = 1 모듈" STORAGE.md` → Expected: `2` 이상.

---

### Task 4: APPLYING.md §2 — 단일 모듈 정의

**Files:** Modify `APPLYING.md`

- [ ] **Step 1: "10여 개 모듈" 문장 교체**

`old_string` (정확히):
```markdown
- `STRUCTURE.md`대로 모듈을 10여 개로 정의, `MODULE_MAP.md`에 등록. 도메인 placeholder를 실제 도메인으로 치환.
```
`new_string`:
```markdown
- `STRUCTURE.md`대로 **이 레포의 단일 모듈**(bounded context 하나)을 정의하고 `MODULE_MAP.md`(단일 모듈 매니페스트)에 등록. 도메인 placeholder를 실제 도메인으로 치환. 모듈이 더 필요하면 **레포를 나눈다**(MSA — 다중 모듈이면 Phase 2 계약 프로파일).
```

- [ ] **Step 2: Checkpoint** — Run: `grep -nE "10여" APPLYING.md` → Expected: 출력 없음.

---

### Task 5: METHODOLOGY.md — 루프 단위 명시

**Files:** Modify `METHODOLOGY.md`

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

- [ ] **Step 2: Checkpoint** — Run: `grep -nc "단위 = 1 레포 = 1 모듈" METHODOLOGY.md` → Expected: `1`.

---

### Task 6: DEDUP.md — 소유권 유일성 범위 + cohesion 거울상

**Files:** Modify `DEDUP.md`

- [ ] **Step 1: 범위 + 거울상 문장 추가**

`old_string` (정확히):
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 키별 소유 spec이 1개인지 CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제.
```
`new_string`:
```markdown
**강제(게이트):** 소유권 게이트가 전 spec의 `## Ownership`을 파싱해 키별 소유 spec이 1개인지 CI에서 검증(중복 = exit 1). FR↔test 게이트의 형제. Ownership 미선언 spec은 warn(점진 도입), `--strict`로 완전 강제. **유일성 범위 = 이 레포(=한 모듈)의 전 spec** — 모듈 간(레포 간)은 MSA 계약 경계로 분리되어 dedup 대상이 아니다(`STRUCTURE.md` 1 레포=1 모듈). **거울상(`check-spec-cohesion`):** dedup이 "2 spec이 같은 키"(과편화)를 막는다면, cohesion 게이트는 "1 spec이 키/FR 과다"(under-fragmentation = 한 spec에 여러 기능 욱여넣기)를 advisory로 잡아 분할을 권고한다.
```

- [ ] **Step 2: Checkpoint** — Run: `grep -nc "유일성 범위 = 이 레포" DEDUP.md` → Expected: `1`. Run: `grep -nc "check-spec-cohesion" DEDUP.md` → Expected: `1` 이상.

---

### Task 7: SPEC_REVIEW.md — 입도 점검 행 추가

**Files:** Modify `SPEC_REVIEW.md`

- [ ] **Step 1: 체크리스트 표에 "과대 spec" 행 추가**

`old_string` (정확히):
```markdown
| **중복(spec 간) — 의미적** | 키는 다른데 의도 같음(reworded) | 같은 Entity 이웃 spec과 좁힌 LLM diff + (선택)임베딩 유사도 | 반자동 |
```
`new_string`:
```markdown
| **중복(spec 간) — 의미적** | 키는 다른데 의도 같음(reworded) | 같은 Entity 이웃 spec과 좁힌 LLM diff + (선택)임베딩 유사도 | 반자동 |
| **과대 spec(입도)** | 한 spec에 여러 기능 욱여넣음(under-fragmentation) — 키/FR 과다 | **`check-spec-cohesion.mjs` 게이트(dedup의 거울상, advisory)** | ★자동(CI) |
```

- [ ] **Step 2: Checkpoint** — Run: `grep -nc "과대 spec" SPEC_REVIEW.md` → Expected: `1`.

---

### Task 8: sdd-config.mjs — cohesion 임계 기본값

**Files:** Modify `tooling/sdd-config.mjs`

**Interfaces:**
- Produces: `cfg.maxKeysPerCategoryPerSpec`(기본 4), `cfg.maxFRsPerSpec`(기본 8). Task 9 게이트가 소비.

- [ ] **Step 1: DEFAULTS에 두 키 추가**

`old_string` (정확히):
```javascript
  // orphan-surface 게이트가 "표면 파일"로 볼 경로 정규식. 기본 [] = 게이트 비활성.
  // 예(Next.js): ["src/app/.*/route\\.ts$", "src/app/.*/page\\.tsx$"]
  surfaceGlobs: [],
```
`new_string`:
```javascript
  // orphan-surface 게이트가 "표면 파일"로 볼 경로 정규식. 기본 [] = 게이트 비활성.
  // 예(Next.js): ["src/app/.*/route\\.ts$", "src/app/.*/page\\.tsx$"]
  surfaceGlobs: [],
  // spec 입도(cohesion) 게이트 임계 — check-ownership(dedup)의 거울상.
  // 한 spec이 카테고리별 키를 maxKeysPerCategoryPerSpec개 초과 소유하거나
  // FR을 maxFRsPerSpec개 초과 포함하면 under-fragmentation(여러 기능 욱여넣기)
  // 신호 → 분할 권고(advisory). 카테고리명 무관(ownershipCategories 따름).
  maxKeysPerCategoryPerSpec: 4,
  maxFRsPerSpec: 8,
```

- [ ] **Step 2: Checkpoint** — Run: `node --check tooling/sdd-config.mjs && echo OK` → Expected: `OK`.

---

### Task 9: check-spec-cohesion.mjs 게이트 + 테스트 (TDD)

**Files:**
- Create: `tooling/check-spec-cohesion.mjs`
- Create test: `tooling/__tests__/check-spec-cohesion.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `resolveFromRoot` (`tooling/sdd-config.mjs`); `cfg.maxKeysPerCategoryPerSpec`, `cfg.maxFRsPerSpec`, `cfg.ownershipCategories`, `cfg.__specIdRe`.
- 동작: advisory(위반 시 warn + exit 0), `--strict`(위반 시 exit 1). 기존 강화 게이트 3종과 출력·플래그 규약 동일.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tooling/__tests__/check-spec-cohesion.test.mjs`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = new URL("../check-spec-cohesion.mjs", import.meta.url).pathname;

function fixture(cfg, files) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-coh-"));
  writeFileSync(join(dir, "sdd.config.json"), JSON.stringify(cfg));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
function run(dir, args = []) {
  try { return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: dir, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}
const CFG = { specDir: "sdd/specs", maxKeysPerCategoryPerSpec: 4, maxFRsPerSpec: 8 };

test("응집된 spec(키·FR 기준 내) → 통과", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n**FR-002** b\n## Ownership\n- **Capabilities**: a.create, a.update\n",
  });
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /분할 권고 없음/);
});

test("FR 과다(>8) → advisory(exit 0), strict 실패", () => {
  const frs = Array.from({ length: 9 }, (_, i) => `**FR-${String(i + 1).padStart(3, "0")}** x`).join("\n");
  const dir = fixture(CFG, { "sdd/specs/SPEC-001.md": `**Spec**: \`SPEC-001\`\n${frs}\n` });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /SPEC-001/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});

test("카테고리 키 과다(Capabilities 5>4) → advisory(exit 0), strict 실패", () => {
  const dir = fixture(CFG, {
    "sdd/specs/SPEC-001.md":
      "**Spec**: `SPEC-001`\n**FR-001** a\n## Ownership\n- **Capabilities**: a.c, a.d, a.e, a.f, a.g\n",
  });
  const warn = run(dir);
  assert.equal(warn.code, 0);
  assert.match(warn.out, /Capabilities/);
  assert.equal(run(dir, ["--strict"]).code, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tooling/__tests__/check-spec-cohesion.test.mjs`
Expected: FAIL — 게이트 파일이 아직 없어 `Cannot find module ...check-spec-cohesion.mjs`.

- [ ] **Step 3: 게이트 구현**

Create `tooling/check-spec-cohesion.mjs`:
```javascript
#!/usr/bin/env node
// ─── Spec cohesion 게이트 (under-fragmentation / cramming 차단) ───
// check-ownership(dedup)의 거울상: dedup은 "2 spec이 같은 키"(과편화/중복),
// 이 게이트는 "1 spec이 키/FR 과다"(under-fragmentation = 한 spec에 여러 기능
// 욱여넣기)를 잡는다. 한 spec = 한 응집 capability 묶음(STRUCTURE.md).
//
// 신호(advisory, --strict로 강제):
//   · 카테고리별 소유 키 수 > maxKeysPerCategoryPerSpec (기본 4)
//   · FR 수 > maxFRsPerSpec (기본 8)
// 둘 다 sdd.config.json에서 조정. Ownership 없는 spec은 키 신호 건너뜀(FR만).
// 키 종류는 ownershipCategories를 그대로 따른다(비-웹 카테고리도 동일 적용).
//
// Usage: node scripts/check-spec-cohesion.mjs [--strict]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";

const cfg = loadConfig();
const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
const STRICT = process.argv.includes("--strict");
const CATEGORIES = cfg.ownershipCategories;
const MAX_KEYS = cfg.maxKeysPerCategoryPerSpec;
const MAX_FRS = cfg.maxFRsPerSpec;
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function specFiles() {
  let names;
  try { names = readdirSync(SPEC_DIR); } catch {
    console.error(`✗ spec 디렉토리를 찾을 수 없음: ${SPEC_DIR}`);
    process.exit(1);
  }
  return names.filter((n) => /\.md$/.test(n)).map((n) => join(SPEC_DIR, n));
}

// `## Ownership` 섹션 → 카테고리별 키 목록 (check-ownership.mjs와 동일 파서).
function parseOwnership(text) {
  const start = text.search(/^##\s+Ownership/m);
  if (start === -1) return null;
  const after = text.slice(start);
  const body = after.slice(after.indexOf("\n") + 1);
  const nextSec = body.search(/^##\s/m);
  const block = nextSec === -1 ? body : body.slice(0, nextSec);
  const out = {};
  for (const cat of CATEGORIES) {
    const line = block.match(new RegExp(`-\\s*\\*\\*${cat}\\*\\*\\s*:\\s*([^\\n]+)`, "i"));
    out[cat] = line
      ? line[1].split(",").map(norm).filter((k) => k && k !== "—" && k !== "[…]" && !k.startsWith("["))
      : [];
  }
  return out;
}

// 고유 FR-ID 수.
function countFRs(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bFR-\d{3}\b/g)) ids.add(m[0]);
  return ids.size;
}

const files = specFiles();
const violations = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const specId = (text.match(cfg.__specIdRe) || [file.split("/").pop()])[0];
  const frs = countFRs(text);
  if (frs > MAX_FRS) violations.push({ specId, kind: "FR", n: frs, max: MAX_FRS });
  const own = parseOwnership(text);
  if (own) {
    for (const cat of CATEGORIES) {
      if (own[cat].length > MAX_KEYS)
        violations.push({ specId, kind: cat, n: own[cat].length, max: MAX_KEYS });
    }
  }
}

console.log(`Spec 입도(cohesion) 게이트: spec ${files.length}개 검사 (키>${MAX_KEYS}/카테고리, FR>${MAX_FRS}).`);

if (violations.length) {
  const tag = STRICT ? "✗" : "⚠";
  console.log(`${tag} 과대 spec(분할 권고) ${violations.length}건:`);
  for (const v of violations) {
    console.log(`  ${tag} ${v.specId}: ${v.kind} ${v.n}개 > ${v.max} → capability별 분할 검토`);
  }
  if (STRICT) {
    console.error(`\n✗ --strict: 과대 spec은 분할 필요.`);
    process.exit(1);
  }
  process.exit(0);
}

console.log(`✓ 모든 spec이 입도 기준 내 — 분할 권고 없음.`);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tooling/__tests__/check-spec-cohesion.test.mjs`
Expected: `tests 3` / `pass 3` / `fail 0`.

- [ ] **Step 5: Checkpoint** — Run: `node --check tooling/check-spec-cohesion.mjs && echo OK` → Expected: `OK`.

---

### Task 10: ci-examples.md — spec 입도 게이트 배선

**Files:** Modify `tooling/ci-examples.md`

- [ ] **Step 1: 강화 게이트 표에 행 추가**

`old_string` (정확히):
```markdown
| orphan surface | `node check-orphan-surfaces.mjs` | (포팅 예정) |
```
`new_string`:
```markdown
| orphan surface | `node check-orphan-surfaces.mjs` | (포팅 예정) |
| spec 입도(cohesion) | `node check-spec-cohesion.mjs` | (포팅 예정) |
```

- [ ] **Step 2: Checkpoint** — Run: `grep -nc "check-spec-cohesion" tooling/ci-examples.md` → Expected: `1`.

---

### Task 11: README 라벨 + 전체 정합 스윕 + 게이트 회귀

**Files:** Modify `README.md`

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
Expected: **출력 없음(0 hits).** 나오면 그 파일을 1 레포=1 모듈 규칙으로 교정.

- [ ] **Step 3: 게이트 테스트 전체 (기존 6 + 신규 3)**

Run: `node --test tooling/__tests__/*.mjs`
Expected: `tests 9` / `pass 9` / `fail 0`.

- [ ] **Step 4: Checkpoint — 정합 통독**

`STRUCTURE.md`·`STORAGE.md`·`METHODOLOGY.md`·`APPLYING.md`·`DEDUP.md`·`SPEC_REVIEW.md`·`templates/MODULE_MAP.md`를 통독해 "1 레포=1 모듈" + "1 spec=1 응집 capability(입도)" + "MSA 합성(계약 프로파일=Phase 2)"가 모순 없이 일관하는지 확인.

---

## Self-Review (작성자 점검)

**1. Spec coverage** — 설계 §4(Gap 1) 6개 파일 = T1~T6, §4b(Gap 2) = 규칙(T1 Step1 + T7) + 게이트(T8 config + T9 게이트/테스트 + T10 CI). README 정합 T11. ✓

**2. Placeholder scan** — 모든 단계가 정확한 old/new 문자열 또는 전체 파일/코드 본문 포함. 게이트·테스트 코드 완전 기재. ✓

**3. Type consistency** — 용어 통일: "단일 모듈 매니페스트", "1 레포 = 1 모듈", "under-fragmentation", `check-spec-cohesion`, config 키 `maxKeysPerCategoryPerSpec`/`maxFRsPerSpec`(T8 정의 ↔ T9 소비 일치), 게이트 출력 토큰 "분할 권고 없음"(T9 ↔ 테스트 assert 일치). ✓

**범위 메모:** MSA 계약 프로파일·cohesion 게이트의 Go/셸/Python 포팅은 후속. 본 계획 완료 시 방법론은 1 레포=1 모듈 + 입도 advisory 게이트로 완결 동작(Node판).
