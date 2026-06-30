# 저장 정의 — spec·방법론을 어디·어떻게 두나 (Storage Contract)

> 채택 프로젝트가 **무엇을 레포에 저장하고, 무엇을 키트에서 참조만 하는지**의 정식 계약. 스펙 위치·식별·게이트 배선이 여기서 결정된다. 배선 절차는 `APPLYING.md`, 구조 근거는 `STRUCTURE.md`, 무관성 원칙은 `principles.md` §10.

## 0. 두 구역
| 구역 | 위치 | 무엇 | 복사? |
|---|---|---|---|
| **키트 소스** | `~/Documents/claude/sdd` (레포 밖, 포터블) | 방법론 *설명서* + 템플릿 + 게이트 도구 마스터 | 프로젝트로 **통째 복사 안 함** |
| **프로젝트 설치물** | 채택 프로젝트 레포 안 | 그 프로젝트의 spec + config + 게이트 1판 + CI | 키트에서 **필요한 것만** |

> **방법론 설명서(METHODOLOGY/STRUCTURE/SSOT/DEDUP/principles 등)는 프로젝트에 복사하지 않는다** — 키트에 두고 참조. 프로젝트엔 *실행에 필요한 것*만 저장(사본을 두면 키트 갱신 시 드리프트).

## 1. 프로젝트 정식 레이아웃 — 한 레포, 두 구역(SDD + TDD)
> 이 방법론은 **SDD(무엇을/왜) + TDD(어떻게)** 가 함께 도는 구조다. 둘은 **다른 디렉토리**에 살고 **FR-ID 추적 태그로만 연결**된다. ⚠ **코드·테스트를 `sdd/`에 넣지 말 것** — `sdd/`는 *문서·메타*만, 코드·테스트는 그 언어의 정상 소스 트리에.
```
<project>/
├─ sdd.config.json              # ★ 두 구역을 잇는 단일 SSOT (§3): 어디 저장·어디 스캔
│
├─ sdd/                         # ┌─ SDD 구역 (문서·메타 = "무엇을/왜"). 실행 코드 아님.
│  ├─ MODULE_MAP.md             # │  모듈>spec 레지스트리(소유권 인덱스)
│  └─ specs/                    # │  spec = EARS FR + ## Ownership (1 spec = 1 파일)
│     ├─ SPEC-001.md            # │
│     └─ <PREFIX>-NNN.md        # │  다른 접두어는 config 등록 필수(§2.2)
├─ .specify/                    # │  Spec Kit init 산출물
│  ├─ memory/constitution.md    # │  횡단 불변식
│  └─ presets/ears-ops/…        # └─ EARS preset
│
├─ src/                         # ┌─ TDD 구역 (실행 코드·테스트 = "어떻게"). 언어 관례대로.
│  └─ …                         # │  production 코드 (spec에서 파생)
├─ tests/  (또는 언어별 위치)    # │  테스트 — 각 테스트가 @covers <PREFIX>-NNN/FR-NNN
│  └─ …                         # │  로 SDD 구역의 FR에 연결 (RED→GREEN)
│                               # └─ Go=_test.go 동거, Java=src/test/… 등 그 언어 관례
│
├─ scripts/                     # 게이트 런타임 1판만 택1:
│  └─ (sdd_gates.sh | sdd_gates.py | check-*.mjs+sdd-config.mjs+sdd-run.mjs | sdd-gate 바이너리)
└─ <CI/CD 설정>                 # 도구 무관 — ci-examples.md 형태 중 택1
```

**두 구역의 연결(이게 SDD+TDD의 핵심):**
```
sdd/specs/SPEC-001.md  ──(FR-001 선언)──►  tests/…  @covers SPEC-001/FR-001  ──►  src/… (구현)
        SDD                                    TDD (test↔code, Superpowers)
        └────────────  게이트가 이 사슬을 CI에서 강제(FR↔test↔code)  ────────────┘
```
- `sdd.config.json`의 `scanDirs`(예: `["src","tests"]`)가 **게이트에게 TDD 구역 위치를 알려준다.** 코드·테스트가 `sdd/`에 있으면 안 되는 이유: 언어 테스트러너(vitest/pytest/go test)가 못 찾고, spec(문서)과 코드(실행)가 뒤섞여 SSOT 경계가 무너진다.
- **흔한 실수(이 프로젝트에서 본 것):** spec뿐 아니라 코드/테스트까지 `sdd/`에 몰아넣음 → 위 사슬이 끊김. 교정: `sdd/`엔 specs·MODULE_MAP만 남기고, 코드·테스트는 `src/`·`tests/`로 옮긴 뒤 `scanDirs`를 맞춘다.

## 2. 스펙 저장 규칙 (명시적)
1. **1 스펙 = 1 파일** = `<specDir>/<PREFIX>-NNN.md` (기본 `sdd/specs/`).
2. **PREFIX는 반드시 `sdd.config.json`의 `specIdPrefixes`에 등록.** 기본 `["SPEC"]`. `FEAT`/`TEST`/`INFRA`를 쓰려면 **먼저 등록** — 안 하면 4판 게이트가 그 스펙을 **조용히 누락**(FR 추적에서 빠져 거짓 green). ← 가장 흔한 함정.
3. 본문 필수: `Module` 헤더 · **`**FR-NNN**`(EARS 5패턴)** · `## Ownership`(키 종류 = config의 `ownershipCategories`). 선택: SC·NFR·Infrastructure Prerequisites(인프라 의존 없으면 생략).
4. **추적 닻 = 언어중립 ID** `FR-NNN`. 테스트는 `@covers <PREFIX>-NNN/FR-NNN`(주석 스타일 자유 `//`·`#`·`--`)로 연결.
5. **정본 언어 = 영어**, 현지어본은 생성만(병행 편집 금지).
6. 폐기 = 통제 제거(spec+코드+테스트 같은 PR 원자 삭제, `MODULE_MAP`에 기록) — `STRUCTURE.md` 수명주기.

## 3. `sdd.config.json` = "이 프로젝트의 저장 방식" SSOT
한 파일이 저장·식별·게이트 배선 전부를 규정 → 언어·접두어가 달라도 코드 fork 불필요.
```json
{
  "specDir": "sdd/specs",                       // 스펙이 어디 저장되나
  "specIdPrefixes": ["SPEC"],                    // 어떤 접두어가 1급 스펙인가  ← §2.2 함정의 키
  "ownershipCategories": ["Entities","Surfaces","Capabilities"],
  "scanDirs": ["src","tests"],                   // @covers를 어디서 찾나
  "ignoreDirs": ["…"],                           // 순회 제외
  "testFileRegex": ["…"],                        // 무엇이 테스트 파일인가
  "commands": { "lint":"…","typecheck":"…","test":"…" }  // 게이트가 부를 언어별 명령
}
```
언어 프리셋: `tooling/sdd.config.presets.md`.

## 4. 저장 vs 참조 (한눈에)
| | 항목 |
|---|---|
| **레포에 저장 — SDD 구역** | `sdd/specs/*` · `sdd/MODULE_MAP.md` · `.specify/…/constitution.md` |
| **레포에 저장 — TDD 구역** | `src/*`(코드) · `tests/*`(테스트, `@covers`로 FR 연결) — 언어 관례 위치 |
| **레포에 저장 — 배선** | `sdd.config.json` · 게이트 1판(`scripts/`) · CI/CD 설정 |
| **키트에서 참조**(복사 X) | METHODOLOGY · STRUCTURE · SSOT · DEDUP · SPEC_REVIEW · principles · REALITY_CHECK · STORAGE |

> 요지: **SDD 구역(spec=무엇을/왜)과 TDD 구역(코드·테스트=어떻게)을 다른 디렉토리에 저장하고, `@covers` FR-ID 태그로 잇는다. 배선(config·게이트)이 그 사슬을 CI에서 강제한다.** "왜 이렇게 하나"(방법론 설명서)는 키트를 참조한다. 저장·연결의 단일 SSOT는 `sdd.config.json` 한 장.

## 5. 공통 큰 틀은 동일, 세부는 프로젝트가 채운다
> 모든 게 똑같아야 한다는 뜻이 아니다. **큰 틀(공통 골격) — `sdd/` 폴더 구조와 스펙이 사는 위치 — 이 어느 프로젝트나 같으면** 누가 봐도 "아, 이 방법론이구나" 하고 같은 자리에서 찾을 수 있다. 그 골격 안의 *내용*(스펙 몇 개·무슨 모듈·어떤 언어 설정)은 프로젝트마다 자유롭게 다르다.

| 공통 큰 틀 (모든 프로젝트 공유) | 프로젝트/언어별 세부 (자유) |
|---|---|
| `sdd.config.json`(루트) · `sdd/specs/` · `sdd/MODULE_MAP.md` · `sdd/templates/` | `scanDirs` (코드/테스트 위치) |
| 스펙 형식 `<PREFIX>-NNN-<slug>.md` · `**FR-NNN**`(EARS) · `## Ownership` | `testFileRegex` · `commands` |
| `@covers <PREFIX>-NNN/FR-NNN` 태그 형식 | `specIdPrefixes` · `ownershipCategories` |
| `scripts/`의 게이트(4판 중 1, 출력 동일) | 게이트 런타임 선택 |

**보장 방식 — 손 cp가 아니라 스캐폴더.** 수동 배선은 프로젝트마다 드리프트한다(실제: 게이트 fork·문서 복사·config 누락). 그래서 **결정적 스캐폴더**가 고정 레이아웃을 만든다:
```sh
# 대상 프로젝트 루트에서 한 번:
sh <KIT>/tooling/sdd-init.sh --gate=sh    # gate: go|sh|py|node (출력 동일)
```
- 항상 같은 것을 만든다: `sdd.config.json` · `sdd/specs/` · `sdd/MODULE_MAP.md` · `sdd/templates/spec-template.md` · `scripts/<게이트>` · `sdd/README.md`(키트 참조 포인터).
- **방법론 설명서는 복사하지 않는다**(§0) — 포인터만. 기존 파일은 보존(`--force`로 덮어씀).
- 검증: 서로 다른 두 프로젝트에 돌려 **공통 큰 틀(폴더 구조·스펙 위치)이 같게** 생성됨을 확인. 그 골격 안의 내용(스펙·모듈)과 `sdd.config.json` 값은 프로젝트가 채운다(`tooling/sdd.config.presets.md`).
