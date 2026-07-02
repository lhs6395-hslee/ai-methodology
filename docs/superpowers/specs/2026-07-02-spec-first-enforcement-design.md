# 설계 — spec-first 강제 (Files 소유매핑 · check-spec-sync · /speckit.fix)

> Status: **Draft (검토 대기, R1 반영)** · Date: 2026-07-02
> 관련: [HARNESS.md](../../../HARNESS.md) R2 · [DEDUP.md](../../../DEDUP.md) · [STRUCTURE.md](../../../STRUCTURE.md) · `tooling/check-converge-drift.mjs`·`check-orphan-surfaces.mjs`·`ownership-keys.mjs` · `templates/constitution.md`·`module-spec.md`
> 트리거: 도그푸딩(소비 프로젝트)에서 pdf-parse ENOENT 버그를 고칠 때, 소유 스펙(SPEC-002)을 안 건드리고 `parse.ts`·`next.config.ts`만 수정해 커밋 — 기존 게이트(fr-coverage·ownership) 전부 통과.

## 0. 요약

코드가 바뀔 때 **소유 스펙도 같은 changeset에 바뀌었는지**를 강제하는 diff 기반 게이트를 추가한다. 핵심은 세 가지: **① `Files:` glob 필드**(파일→소유스펙 결정적 매핑) **② `check-spec-sync`**(엄격 판정: 소유 스펙의 FR/Edge Case/Change Log 섹션이 실제 변경돼야 통과 — changeset=브랜치(§5.8), commit-msg 훅 hard + range 모드) **③ `/speckit.fix`**(버그픽스도 스펙에 착지시키는 SDD 경로). "code-first는 hotfix로 정당하나 spec이 따라와야 한다 — 사후는 안 지켜지니 같은 커밋에 강제한다."

## 1. 문제 — 기존 게이트가 못 잡는 이음매

- `check-fr-coverage`(FR↔test 커버리지)·`check-ownership`(키 유일성)은 **전체 스캔**이라, 코드만 바뀐 커밋을 통과시킨다.
- `check-converge-drift`가 "코드 변경인데 spec 무변경"을 diff로 잡지만 **전역**이라, 어느 코드가 어느 스펙 소유인지 몰라(파일→스펙 매핑 부재) 정밀 강제가 안 되고 advisory다.
- `check-orphan-surfaces`는 config `surfaceGlobs`(파일 정규식)↔`Ownership.Surfaces`(route 문자열)를 **부분일치**로 대조 — 전역·느슨.
- **HARNESS R2(code→spec)의 후반부(사후 spec 갱신)가 실전에서 증발.** "나중에 converge"는 급한 순간 진다(pdf-parse가 실증).
- 근본: `Ownership.Surfaces`는 route 문자열이라 라이브러리(`src/lib/pdf/*`)가 소유 경계 밖 → 라이브러리 변경이 어느 스펙에도 안 묶임.

## 2. 목표 / 비목표

**목표**
- 코드 변경 커밋에 **소유 스펙의 의미 있는 변경**을 커밋 시점에 강제(사후 아님).
- 파일→소유스펙 **결정적** 매핑.
- 버그픽스에 SDD 경로 부여(스펙 착지 자리 보장).
- hotfix·스펙무관 변경에 **정직한 탈출구**.

**비목표 (정직)**
- 스펙 변경의 **질** 강제 — "가짜 Change Log 항목"은 자연어라 게이트가 못 막는다(리뷰가 잡음). 게이트는 "의미 있는 섹션이 *변경됐는가*"까지만.
- Files 미선언 기존 스펙 즉시 전면 강제 — 점진 도입(선언된 스펙만 hard, 나머지 converge-drift advisory).
- 코드 자동→스펙 생성 — 사람 intent + `/speckit.fix`.
- **비-Node 런타임 즉시 포팅** — `check-spec-sync`는 Node판 먼저(§10.1, 기존 강화 게이트들과 동일 선례 — ROADMAP "비-Node 프로젝트가 필요할 때 포팅").

## 3. 결정 요약 (브레인스토밍 + R1 리뷰 합의)

| # | 결정 | 선택 |
|---|---|---|
| 파일↔스펙 매핑 | 새 `Files:` glob 필드 (Surfaces와 분리, 정규화 면제) | vs Surfaces 확장(기각: 의미 혼탁·형식검증 충돌) |
| 강제 강도 | commit-msg 훅 **hard FAIL** + Files 선언 스펙만 + Spec-Impact/exempt 탈출구 + converge-drift 백업 | vs 전면 hard(도입 마찰) / advisory(사후 안 지켜짐) |
| 판정 세밀도 | **엄격** — 소유 스펙의 FR/Edge Case/Change Log 섹션이 실제 변경돼야 통과 | vs 느슨(파일 동반만 — 공백 touch 우회) |
| glob 문법 | **`**`·`*`만 지원**, 콤마·`#`·중괄호 금지 (§4.1) | vs minimatch 전체(자체 구현과 불일치 위험) |
| Change Log 검출 | 불릿(`+- `)과 표 행(`+\| `) **둘 다 인정** (§5.4) | vs 한 형식 강제(기존 템플릿=표라 마이그레이션 강요) |
| 다중 소유 | **AND** — 소유 스펙 전부 변경 요구 (§6.1) | vs OR(가장 쉬운 스펙 touch 루프홀) |
| merge/amend | merge commit은 **감지 후 skip+기록** (§5.6) | vs merge-base diff(복잡·오탐) |
| 두 운영 모드 | staged(hard, commit-msg) + range(advisory, sdd-sync/CI) 명시 분리 (§5.7) | vs 단일 모드(sdd-sync 배선 시 무의미 판정) |
| **changeset 의미** | **브랜치 단위** — 스테이징 ∪ `base...HEAD`에서 스펙 변경 인정 (§5.8) | vs 커밋 단위(top-down 정상 흐름 — spec 커밋 후 구현 커밋들 — 을 전부 FAIL시킴) |
| 소유권 스냅샷 | **HEAD ∪ index 합집합** (§5.1) | vs index만(스펙 삭제+코드 변경이 조용히 통과하는 구멍) |

## 4. 데이터 모델 — `Files:` 필드

```
## Ownership
- **Entities**: recommendation
- **Surfaces**: POST /api/recommend
- **Capabilities**: recommendation.create
- **Files**: src/lib/pdf/**, src/app/api/recommend/**
```

- `ownership-keys.mjs`의 `parseSection`으로 파싱하되, **호출자가 categories 인자로 `["Files"]`를 명시**해 읽는다. **`Files`를 config `ownershipCategories`에 추가하지 않는다** — 추가하면 dedup(check-ownership)·cohesion 키 카운트에 잘못 유입되고 `validateKey`가 glob을 형식위반으로 오판한다. Files는 `check-spec-sync` 전용 매핑 입력이며 dedup(키 유일성) 대상이 아니다.
- **정규화/형식검증(METHOD·verb) 면제** — 경로 glob 문자열 그대로.

### 4.1 glob 문법 (지원 부분집합 명시)

- **지원: `**`(0개 이상 경로 세그먼트), `*`(세그먼트 내 0+문자)만.** `{a,b}` 중괄호·`?`·`[...]`·`!(...)`은 **미지원** — 콤마 구분 파서(`parseSection`이 `,`로 split)와 충돌하고 자체 glob 구현 범위를 넘는다.
- **Files 값에 `,`(구분자 외)·`#`(인라인 주석) 금지.** 파서는 방어적으로 각 항목의 trailing `#…`를 strip한다(주석 유입이 glob을 조용히 무효화하는 사고 방지).
- 매칭 규칙: **anchored(`^…$`) 정규식 변환**(`**`→`(?:[^/]+/)*[^/]+` 스타일로 "그 디렉토리 자신"은 불포함, `a/**`는 `a/x`·`a/x/y` 매치·`a`는 비매치), **POSIX 슬래시·대소문자 구분**(`git diff --name-only`는 항상 forward slash를 출력).
- 형식 위반(중괄호 등 미지원 문법 발견) 시 check-spec-sync가 **명시 경고**(조용한 비매치 금지).

## 5. `check-spec-sync.mjs` — diff 기반 엄격 게이트

**Files:** `tooling/check-spec-sync.mjs` (신규)

### 5.1 판정 파이프라인

```
1. 변경 파일 수집 (모드별 — §5.7)
2. 스펙 Ownership 로드 — **HEAD와 index(staged) 양쪽에서 parseSection(text,
   "Ownership", ["Files"])로 읽어 합집합**. (index만 보면 "스펙 삭제+코드 변경"
   커밋에서 소유권이 사라져 조용히 통과하는 구멍 — HEAD판이 삭제를 가시화.)
3. 변경된 각 파일 → Files glob 매치(§4.1) → 소유 스펙(들) 확정
4. 매치된 소유 스펙 각각에 대해(AND — §6.1): **changeset(§5.8) 안에서**
   의미 있는 섹션 변경(§5.4)이 있어야 통과. 하나라도 없으면 FAIL(exit 1, staged 모드).
5. 탈출구(§5.5): Spec-Impact 트레일러 / exempt glob.
6. Files 어느 glob에도 안 맞는 파일 → 침묵. check-converge-drift(전역 advisory)가 백업.
```

### 5.4 엄격 판정 — 섹션 귀속 알고리즘 (결정적, 명시)

소유 스펙 `.md`의 diff에서 "의미 있는 변경"을 다음으로 판정한다:

1. **스펙 파일의 new-file 전체 내용**(post-image)을 읽어 `## ` 헤더 기준 **라인번호→섹션 맵**을 만든다. **post-image 출처 명시**: staged 모드 = **index판**(`git show :<path>` — 작업트리가 아님, unstaged 편집이 섞이면 §6.2 판정이 깨짐) / range·브랜치 diff = 해당 범위 head판(`git show <head>:<path>`). (hunk 컨텍스트만으로 섹션을 추정하지 않는다 — 컨텍스트 없는 소형 hunk·섹션 경계 편집의 오귀속 방지.)
2. diff의 각 추가 라인(`+`)을 hunk 헤더(`@@ -a,b +c,d @@`)의 new-file 라인번호로 환산해 섹션에 귀속.
3. 다음 중 하나면 통과:
   - **FR 본문 변경**: `**FR-NNN**` 라인의 추가/삭제,
   - **`## Change Log`** 아래 새 항목: `+- `(불릿) **또는** `+|`(표 행, 단 구분선 `|---|` 제외) — 기존 템플릿(표)과 신규 권장(불릿) 모두 인정,
   - **`## Edge Cases`** 아래 새 항목: 동일 규칙.
4. 파일 동반만·공백·주석만 변경 → 불통과(우회 차단).

스펙 파일 **삭제**는 "의미 있는 변경"으로 인정하되 **눈에 띄게 기록**(폐기는 STRUCTURE 수명주기 — spec+코드+테스트 원자 삭제 — 가 별도 규율; §5.1의 HEAD∪index 로드 덕에 삭제 커밋에서도 소유권이 보여 조용한 우회가 아니라 시끄러운 통과가 된다). 스펙 파일 **순수 rename**(내용 무변경)은 의미 있는 변경이 **아니다** — 소유 코드도 같이 바뀌면 Change Log 항목 필요(엄격 유지). 소유 코드 파일의 **rename/delete**도 변경으로 취급(소유 스펙 갱신 요구 — Files glob 자체를 고치는 변경이 그 스펙 변경에 포함되므로 자연 해소).

### 5.5 탈출구 — 감사 흔적의 실체 (정직)

- **`Spec-Impact: none <사유>` 트레일러** — 커밋 메시지에 남는 **영속 감사 흔적**(`git log --grep`으로 조회 가능, 리뷰 노출). 이것이 감사 경로의 실체다. **사유는 비어 있으면 안 된다** — `Spec-Impact: none`만 있고 사유가 없으면 FAIL("사유 필수", prefixRationale과 동일 패턴). ~~stderr 기록~~은 커밋 시점 터미널에만 보이고 영속되지 않으므로 감사 주장에서 제외(참고 출력일 뿐).
- **exempt glob**(config `specSyncExemptGlobs`, 기본 `[]`) — 통과하되 **영속 흔적은 없다**(정직하게 인정). exempt 목록 자체가 config로 리뷰되는 것이 통제선. 예시: 생성물·락파일이 Files glob에 과포함될 때.

### 5.6 훅 배선·우회 경계 (정직)

- **실행 위치 = commit-msg 훅** (인자 `$1`=커밋 메시지 파일). pre-commit은 커밋 메시지를 못 본다. 스테이징 diff는 commit-msg 시점에도 `git diff --cached`로 정확히 조회됨(검증됨).
- **merge commit**: commit-msg가 실행되지만 staged diff가 일반 커밋과 다르므로 — `git rev-parse -q --verify MERGE_HEAD`(또는 `$1`이 MERGE_MSG)로 감지 시 **skip + 기록**. 브랜치 위 개별 커밋 강제 + pre-push `sdd-sync`(range 모드)가 머지 경로의 백스톱.
- **`--amend`**: 훅이 재실행된다(이미 커밋된 내용에 재검사 — 의도된 동작이나 놀랄 수 있어 문서화).
- **`--no-verify`**: 두 훅 모두 skip — 기계로 못 막는 정직한 한계. 팀 규율 + range 모드(CI/pre-push)가 잔여 그물.

### 5.7 두 운영 모드 (명시 분리)

| 모드 | 호출 | diff 소스 | 트레일러 | 강제 |
|---|---|---|---|---|
| **staged** (1차 강제점) | commit-msg 훅: `check-spec-sync.mjs --staged --message-file $1` | `git diff --cached` | `$1`에서 읽음 | **hard exit 1** |
| **range** (백스톱/집계) | 인자 없음(기본) 또는 `<base>`: `check-spec-sync.mjs [base]` | `git diff base...HEAD` (기본 `origin/main`, converge-drift와 동일 규약) | 없음(요구 안 함) | advisory(⚠ 출력, exit 0) |

- **sdd-sync R2에는 range 모드가 배선**된다 — sdd-sync는 게이트를 인자 없이 실행하므로(§11) 기본값이 range 모드여야 무의미한 빈-staged 판정을 피한다. staged 모드는 commit-msg 훅 전용.

### 5.8 changeset = 브랜치 (staged 모드의 통과 범위 — 핵심 결정)

**"동일 changeset"의 단위는 커밋이 아니라 브랜치다.** staged 모드의 통과 조건:

> 소유 스펙의 의미 있는 변경(§5.4)이 **스테이징 diff ∪ `base...HEAD`**(base 기본 `origin/main`, converge-drift와 동일 규약) 어딘가에 존재하면 통과.

**왜 커밋 단위가 아닌가:** 커밋 단위로 강제하면 **정통 top-down 흐름이 깨진다** — spec-first 정상 작업은 spec 커밋(A) 후 구현 커밋(B·C·D…)인데, B·C·D는 소유 코드를 바꾸면서 스펙은 그 커밋엔 없으므로 전부 FAIL. 방법론의 1차 워크플로를 게이트가 막는 자기모순. 브랜치 단위면: top-down(spec이 브랜치 안에 이미 변경됨)은 자연 통과, **pdf-parse류(브랜치 전체에 스펙 무변경인 hotfix)는 여전히 정확히 잡힌다.**

**정직한 경계:** ① 브랜치가 아주 길면 "옛날 스펙 변경 한 번"이 이후 코드 변경을 다 커버 — 브랜치=하나의 changeset이라는 정의상 수용(작은 브랜치 권장은 일반 위생). ② main 직커밋 워크플로에서 spec 커밋을 **push한 뒤** 코드 커밋을 만들면 base(origin/main)가 전진해 spec 변경이 범위 밖 → FAIL → 트레일러 또는 Change Log 항목으로 해소(문서화). ③ base 원격 미존재(초기 레포)·detached 등은 base 해석 불가 시 **staged diff만으로 판정 + 경고**.

## 6. 3분류 + 예외 + 경계 사례

| 코드 변경 | 통과 조건 | 강제 |
|---|---|---|
| **기능/버그픽스** (Files 매치) | 소유 스펙의 FR/Edge Case/Change Log 실제 변경 동반 | commit-msg **hard** |
| **hotfix** (급함) | 위와 동일 (`/speckit.fix`로 Edge Case+Change Log 기록) — 또는 `Spec-Impact: none <사유>` | hard + 탈출구 |
| **스펙 무관** (생성물·락파일 등 Files 과포함분) | exempt glob | 통과 (영속 흔적 없음 — §5.5) |

### 6.1 다중 소유 = AND

한 파일이 여러 스펙의 Files glob에 매치되면 **모든 소유 스펙**이 의미 있는 변경을 동반해야 한다(OR는 "가장 쉬운 스펙 touch" 루프홀). 공유 유틸이 N개 스펙 편집을 강요하는 부담은 §9의 "과광역 glob 경고"로 예방 — 공유 코드는 별도 스펙(또는 미소유→converge-drift 소관)으로 두는 것을 권장.

### 6.2 partial staging = 의도된 FAIL

코드는 staged, 스펙은 편집했지만 unstaged(그리고 브랜치 히스토리에도 스펙 변경 없음, §5.8) → **FAIL이 맞다**(changeset에 스펙이 실려야 함). 흔한 함정이므로 FAIL 메시지에 힌트 포함: *"스펙을 수정했다면 `git add`로 스테이징했는지 확인"*.

### 6.3 트리거 케이스 완결 판정 (pdf-parse 사례에 정직)

- `parse.ts` — SPEC-002가 `Files: src/lib/pdf/**`를 선언하면 **잡힌다**(마이그레이션 §14 의존).
- `next.config.ts` — 프로젝트 루트 config는 기능 스펙 소유가 아님 → **check-spec-sync 침묵, converge-drift advisory만**. 이를 잡으려면 **INFRA 스펙이 config 파일을 소유**하는 관행을 권장(`INFRA-001`에 `Files: next.config.ts, …`) — §9에 규칙화. 채택 안 하면 이 절반은 advisory 그물뿐임을 명시(과장 금지).

## 7. `/speckit.fix` 스킬 (버그픽스 SDD 경로)

**Files:** `tooling/harness/speckit-fix.SKILL.md` (신규 원본), `sdd-init` 배선.

```
1. 재현 실패 테스트 작성 (Superpowers TDD RED)
2. 스펙 영향 판정:
   · 있음 → 소유 스펙 FR 개정/추가
   · 없음(순수 impl 버그) → 소유 스펙의 ## Edge Cases + ## Change Log에 항목
   (어느 쪽이든 스펙을 반드시 건드린다 = check-spec-sync 통과의 정공법)
3. GREEN 코드
4. 게이트: check-fr-coverage · check-ownership · check-spec-sync 통과
5. 사람 승인 후 머지
```

METHODOLOGY 0~8 루프 설명에 "버그픽스는 `/speckit.fix`" 명시(기능 전용 루프의 빈틈 메움).

## 8. Constitution + 템플릿

- `templates/constitution.md` 원칙 I(Spec=SSOT)에 명문화:
  > **owned Files의 코드 변경은 동일 changeset에 스펙 변경(FR·Edge Case·Change Log)을 동반한다. 순수 기계적/버그픽스 변경도 Edge Case+Change Log 항목을 남긴다. `check-spec-sync` 게이트로 강제한다.**
- `templates/module-spec.md`: `## Ownership`에 `Files:` 필드 + `## Edge Cases` 섹션 신설 + 기존 `## Change Log`(표 형식) 유지 **필수화**. 항목 형식: 표 행 `| YYYY-MM-DD | <무엇> | <왜/커밋> |` — 게이트는 표 행·불릿 모두 인정(§5.4)하므로 기존 소비 프로젝트 스펙과 호환.

## 9. Files 완전성 규칙 (STRUCTURE / DEDUP)

- **Files glob은 소유 코드를 빠짐없이 덮어야 한다** — API route(`src/app/api/<f>/**`)뿐 아니라 그 기능의 라이브러리(`src/lib/<f>/**`)까지(pdf-parse의 근본 원인).
- **INFRA 스펙이 프로젝트 config 파일을 소유하는 관행 권장**(`next.config.ts`·`tsconfig` 등) — §6.3의 사각지대를 opt-in으로 닫는다.
- **과광역 glob 경고**: 여러 스펙 Files가 겹치면 AND 강제(§6.1)로 편집 부담 폭증 — 겹침 최소화 권장. 완전성·겹침 자체는 자연어 판단이라 **규칙·리뷰**로(게이트 강제 안 함, 정직).

## 10. 키트 vs 소비 프로젝트 레이아웃 + sdd-init 배선

이 레포는 **키트**(원본). 작업은 키트 원본에, `sdd-init`가 소비 프로젝트로 전파:

| 키트 원본 | → sdd-init가 소비 프로젝트에 |
|---|---|
| `tooling/check-spec-sync.mjs` | `scripts/check-spec-sync.mjs` |
| `tooling/harness/commit-msg`(신규) | `.git/hooks/commit-msg` — staged 모드 실행 |
| `tooling/harness/speckit-fix.SKILL.md` | `.claude/skills/speckit-fix/SKILL.md` |
| `tooling/harness/pre-commit`(기존 유지) | `.git/hooks/pre-commit` — fr-coverage·ownership |
| `templates/module-spec.md`·`constitution.md`(갱신) | `sdd/templates/…` |

- `sdd-init`가 `package.json`에 `check:spec-sync`(+staged 변형) 추가(소비 프로젝트에 package.json 있으면).
- **두 훅의 트리거 표면이 다름을 명시**: pre-commit은 고정 경로 프리픽스(`sdd/specs/|src/|lib/|app/|tests/`)로 발동하는 거친 트리거, commit-msg의 spec-sync는 **Files glob 매치 자체**가 트리거(경로 프리픽스 불요, 어디에 있든 Files가 선언하면 대상). 서로 다른 감지 방식이며 의도된 분리다.

### 10.1 런타임 커버리지 (정직 공개)

- `check-spec-sync`는 **Node판 먼저** — 기존 강화 게이트(cohesion·consistency 등)와 동일 선례(ROADMAP "비-Node 프로젝트가 필요할 때 포팅").
- commit-msg 훅 자체는 `node scripts/check-spec-sync.mjs …` 한 줄이라 **선택한 게이트 런타임과 무관하게 Node만 있으면 동작**. `sdd-init --gate=sh|py|go`에서는: Node가 감지되면 훅 배선 + 안내, 없으면 **명시 경고**("spec-sync는 Node 필요 — 미적용, ROADMAP 포팅 참조")를 출력한다. **조용한 부재 금지.**

## 11. converge-drift 관계 · sdd-sync 배선

- 폐기 안 함. **check-spec-sync(staged, 파일→소유스펙 정밀·hard)가 1차, check-converge-drift(전역 advisory)가 Files 미선언 코드의 백업 그물.**
- sdd-sync R2 gates에 **check-spec-sync의 range 모드**(인자 없음 기본값, §5.7)를 추가 — sdd-sync는 게이트를 인자 없이 실행하므로 기본 모드가 range여야 정합(staged 모드를 배선하면 빈 diff에 무의미 판정).

## 12. 강제력 · 정직한 한계

- **hard(exit 1):** check-spec-sync staged 모드(Files 선언 스펙, commit-msg 훅). dedup·PREFIX(기존).
- **advisory:** check-spec-sync range 모드(sdd-sync/CI), converge-drift(전역 백업), Files 완전성·겹침(규칙).
- **못 막는 것(정직):** ① 스펙 변경의 *질*(가짜 항목) — 리뷰 담당. ② `--no-verify` — 훅 전면 우회. ③ **merge commit** — skip(§5.6), 브랜치 커밋 강제+range 백스톱으로 보완. ④ exempt glob 통과의 무흔적(§5.5). ⑤ 비-Node 환경(§10.1) — 명시 경고로만.

## 13. 검증 계획 (TDD)

- **glob 단위**: `**`·`*` 변환·anchoring(`a/**`가 `a` 비매치)·POSIX/대소문자·미지원 문법(중괄호) 경고·인라인 `#` strip.
- **섹션 귀속 단위**: 라인번호→섹션 맵 정확성 — 컨텍스트 없는 소형 hunk, 섹션 첫 줄 추가, 경계 편집.
- **판정 통합(staged)**: Files 매치+스펙 무변경(브랜치 포함)→FAIL / Change Log **표 행** 추가→PASS / Change Log **불릿** 추가→PASS / Edge Cases 항목→PASS / FR 라인 변경→PASS / 공백·주석만→FAIL / 다중 소유 한쪽만 변경→FAIL(AND) / partial staging(스펙 unstaged·브랜치에도 없음)→FAIL+힌트.
- **changeset=브랜치(§5.8)**: spec 커밋(N-1) 후 코드만 staged(N)→**PASS**(top-down 흐름 보존) / 브랜치 전체 스펙 무변경 hotfix→FAIL / base 해석 불가→staged만+경고.
- **소유권 스냅샷(§5.1)**: 스펙 삭제+소유 코드 변경 한 커밋→HEAD판 소유권으로 감지, 삭제=의미 변경으로 **시끄럽게 통과**(조용한 우회 아님) / 순수 rename→의미 변경 아님.
- **탈출구**: `Spec-Impact: none <사유>` 트레일러→PASS / **사유 없는 `Spec-Impact: none`→FAIL** / exempt glob→PASS / Files 미선언 코드→침묵.
- **모드**: 인자 없음→range(origin/main 기본, advisory exit 0) / `--staged --message-file`→hard.
- **훅 경계**: merge commit(MERGE_HEAD) skip / `--amend` 재실행 동작 문서화 검증.
- **sdd-init**: init-then-execute — 배선 후 실제 `scripts/check-spec-sync.mjs` 실행 crash 없음(final-review Critical 교훈) + 비-Node 게이트 선택 시 경고 출력.
- 회귀: 기존 게이트 스윕 전량 GREEN + **Files 라인이 dedup·cohesion 키 카운트에 안 섞임**(ownershipCategories 미등록 확인 테스트).

## 14. 마이그레이션 (소비 프로젝트 재-scaffold)

- 새 스크립트/스킬/훅 반영: `sdd-init` 재실행(settings.json·package.json·git훅 병합).
- 기존 스펙 보강: 각 스펙에 `Files:` glob + `## Edge Cases` 섹션 추가(`## Change Log`는 기존 표 유지 가능 — §5.4가 표·불릿 모두 인정). Files 없는 스펙은 check-spec-sync 대상 아님(converge-drift advisory만) — 점진.
- (권장) INFRA 스펙에 프로젝트 config 파일 소유 등록(§6.3·§9).
- config: `specSyncExemptGlobs`(기본 `[]`) 필요 시 설정.
- CHANGELOG + 키트 버전 bump. 마이그레이션 노트 문서화.
