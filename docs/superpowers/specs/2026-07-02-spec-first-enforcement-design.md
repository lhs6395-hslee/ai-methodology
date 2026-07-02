# 설계 — spec-first 강제 (Files 소유매핑 · check-spec-sync · /speckit.fix)

> Status: **Draft (검토 대기)** · Date: 2026-07-02
> 관련: [HARNESS.md](../../../HARNESS.md) R2 · [DEDUP.md](../../../DEDUP.md) · [STRUCTURE.md](../../../STRUCTURE.md) · `tooling/check-converge-drift.mjs`·`check-orphan-surfaces.mjs`·`ownership-keys.mjs` · `templates/constitution.md`·`module-spec.md`
> 트리거: 도그푸딩(소비 프로젝트)에서 pdf-parse ENOENT 버그를 고칠 때, 소유 스펙(SPEC-002)을 안 건드리고 `parse.ts`·`next.config.ts`만 수정해 커밋 — 기존 게이트(fr-coverage·ownership) 전부 통과.

## 0. 요약

코드가 바뀔 때 **소유 스펙도 같은 changeset에 바뀌었는지**를 강제하는 diff 기반 게이트를 추가한다. 핵심은 세 가지: **① `Files:` glob 필드**(파일→소유스펙 결정적 매핑) **② `check-spec-sync`**(엄격 판정: 소유 스펙의 FR/Edge Case/Change Log 섹션이 실제 변경돼야 통과, pre-commit hard) **③ `/speckit.fix`**(버그픽스도 스펙에 착지시키는 SDD 경로). "code-first는 hotfix로 정당하나 spec이 따라와야 한다 — 사후는 안 지켜지니 같은 커밋에 강제한다."

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

## 3. 결정 요약 (브레인스토밍 합의)

| # | 결정 | 선택 |
|---|---|---|
| 파일↔스펙 매핑 | 새 `Files:` glob 필드 (Surfaces와 분리, 정규화 면제) | vs Surfaces 확장(기각: 의미 혼탁·형식검증 충돌) |
| 강제 강도 | pre-commit **hard FAIL** + Files 선언 스펙만 + Spec-Impact/exempt 탈출구 + converge-drift 백업 | vs 전면 hard(도입 마찰) / advisory(사후 안 지켜짐) |
| 판정 세밀도 | **엄격** — 소유 스펙의 FR/Edge Case/Change Log 섹션이 실제 변경돼야 통과 | vs 느슨(파일 동반만 — 공백 touch 우회) |

## 4. 데이터 모델 — `Files:` 필드

```
## Ownership
- **Entities**: recommendation
- **Surfaces**: POST /api/recommend          # 런타임 진입점 (기존, 정규화·형식검증 대상)
- **Capabilities**: recommendation.create
- **Files**: src/lib/pdf/**, src/app/api/recommend/**   # ← 신규: 소유 코드 파일 glob
```

- `ownership-keys.mjs`의 `parseSection`이 `Files`도 파싱. **Files는 경로 glob이라 정규화/형식검증(METHOD·verb) 면제** — glob 문자열 그대로.
- **Files는 dedup(키 유일성) 대상 아님** — check-ownership의 3카테고리(Entities/Surfaces/Capabilities)는 그대로. Files는 `check-spec-sync` 전용 매핑 입력.
- glob 매칭: `minimatch` 스타일(`**`·`*`) — 의존 최소화 위해 간단한 자체 glob→정규식 변환(`**`→`.*`, `*`→`[^/]*`).

## 5. `check-spec-sync.mjs` — diff 기반 엄격 게이트

**Files:** `tooling/check-spec-sync.mjs` (신규)

```
1. 변경 파일 수집:
   - staged: git diff --cached --name-only
   - 또는 인자 커밋범위/파일목록 (CI용)
2. 전 스펙의 Ownership.Files glob 로드 (parseSection 재사용)
3. 변경된 각 코드 파일 → Files glob 매치 → 소유 스펙(들) 확정
4. 매치된 소유 스펙마다: 그 .md가 같은 diff에 있고,
   diff에 **의미 있는 섹션 변경**이 있는가:
     · FR-NNN 라인 +/− 변경, 또는
     · "## Change Log" 섹션 아래 새 "+- " 항목, 또는
     · "## Edge Cases" 섹션 아래 새 "+- " 항목
   없으면 → FAIL (hard, exit 1)
5. 탈출구(통과 + stderr 기록):
   · 커밋 메시지 트레일러 `Spec-Impact: none <사유>`
   · sdd.config.json exempt glob (테스트·생성물·락파일)
6. Files 어느 glob에도 안 맞는 코드 파일 → check-spec-sync는 침묵,
   check-converge-drift(전역 advisory)가 백업 그물
```

**엄격 판정 구현(결정적):** 소유 스펙 `.md`의 `git diff`를 **섹션 단위로 파싱** — `## <Section>` 헤더로 hunk를 구획하고, 대상 섹션(FR 본문·Change Log·Edge Cases) 아래 추가 라인(`+`)이 실제 항목(`+- ` 또는 `+**FR-`)인지 검출. 파일 존재·공백·주석만 변경은 불통과.

**실행 위치 = commit-msg 훅 (결정).** `check-spec-sync`는 `Spec-Impact:` 트레일러를 읽어야 하는데 **pre-commit은 커밋 메시지를 못 본다**(커밋 확정 전). 따라서 **commit-msg 훅**(인자 `$1` = 커밋 메시지 파일 경로)에서 실행한다 — 스테이징 diff는 `git diff --cached`로, 트레일러는 `$1`에서 읽는다. 기존 pre-commit(`check-fr-coverage`·`check-ownership`)은 그대로 두고, `check-spec-sync`만 commit-msg 훅에 배선한다. CI/수동 실행 시엔 커밋범위 인자 + `--message-file`로 같은 판정.

## 6. 3분류 + 예외

| 코드 변경 | 통과 조건 | 강제 |
|---|---|---|
| **기능/버그픽스** (Files 매치) | 소유 스펙의 FR/Edge Case/Change Log 실제 변경 동반 | pre-commit **hard** |
| **hotfix** (급함) | 위와 동일 (`/speckit.fix`로 Edge Case+Change Log 기록) — 또는 `Spec-Impact: none <사유>` | hard + 탈출구 |
| **스펙 무관** (테스트·락·생성물) | exempt glob | 통과 + 기록 |

`Spec-Impact: none <사유>`·exempt는 커밋에 남아 리뷰에 노출(정직한 탈출구, 은폐 아님).

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
- `templates/module-spec.md`: `## Ownership`에 `Files:` 필드 + `## Edge Cases`·`## Change Log` 섹션 **필수화**(픽스 착지 자리 보장). Change Log 항목 형식: `- YYYY-MM-DD: <무엇을·왜> (커밋/PR)`.

## 9. Files 완전성 규칙 (STRUCTURE / DEDUP)

- `STRUCTURE.md`·`DEDUP.md`에 명시: **Files glob은 소유 코드를 빠짐없이 덮어야 한다** — API route(`src/app/api/<f>/**`)뿐 아니라 그 기능의 라이브러리(`src/lib/<f>/**`)까지. 안 그러면 라이브러리 변경이 check-spec-sync 사각지대(pdf-parse의 근본 원인).
- 완전성 자체는 결정적 강제 어려움(무엇이 "이 기능의 코드 전부"인지 자연어) → **규칙·리뷰**로. `check-converge-drift`(전역)가 Files 사각지대의 백업 신호.

## 10. 키트 vs 소비 프로젝트 레이아웃 + sdd-init 배선

이 레포는 **키트**(원본). 작업은 키트 원본에, `sdd-init`가 소비 프로젝트로 전파:

| 키트 원본 | → sdd-init가 소비 프로젝트에 |
|---|---|
| `tooling/check-spec-sync.mjs` | `scripts/check-spec-sync.mjs` |
| `tooling/harness/speckit-fix.SKILL.md` | `.claude/skills/speckit-fix/SKILL.md` |
| `tooling/harness/commit-msg`(신규) | `.git/hooks/commit-msg` — `check-spec-sync` 실행(트레일러+diff) |
| `tooling/harness/pre-commit`(기존 유지) | `.git/hooks/pre-commit` — fr-coverage·ownership |
| `templates/module-spec.md`·`constitution.md`(갱신) | `sdd/templates/…` |

- `sdd-init`가 `package.json`에 `check:spec-sync`(+staged 변형) 추가(소비 프로젝트에 package.json 있으면).
- **`check-spec-sync`는 commit-msg 훅이 실행**(트레일러 접근 필요). pre-commit은 fr-coverage·ownership 유지 — 강제점이 둘로 나뉜다(pre-commit + commit-msg).

## 11. converge-drift 관계

폐기 안 함. **`check-spec-sync`(파일→소유스펙 정밀·hard)가 1차, `check-converge-drift`(전역 advisory)가 Files 미선언 코드의 백업 그물.** sdd-sync R2 gates에 check-spec-sync 추가(check-converge-drift·check-orphan-surfaces 옆).

## 12. 강제력 · 정직한 한계

- **hard(exit 1):** check-spec-sync(Files 선언 스펙, pre-commit). dedup·PREFIX(기존).
- **advisory:** converge-drift(전역 백업), Files 완전성(규칙).
- **못 하는 것(정직):** 스펙 변경의 *질*(가짜 항목), Files 완전성 자동판정 — 리뷰가 담당. 게이트는 "의미 있는 섹션이 변경됐는가"까지만.

## 13. 검증 계획 (TDD)

- `check-spec-sync`: Files 매치 코드 변경 + 소유 스펙 무변경 → FAIL / 스펙 Change Log 항목 동반 → PASS / 공백만 touch → FAIL(엄격) / Spec-Impact:none 트레일러 → PASS+기록 / exempt glob → PASS+기록 / Files 미선언 코드 → 침묵(converge-drift 소관).
- glob 매칭 단위 테스트(`**`·`*`·중첩).
- 섹션 파싱 단위 테스트(Change Log/Edge Cases/FR 변경 검출 vs 공백).
- `sdd-init` init-then-execute: 배선 후 실제 `scripts/check-spec-sync.mjs` 실행 crash 없음(final-review Critical 교훈 — fixture drift 방지).
- 회귀: 기존 게이트 스윕 전량 GREEN.

## 14. 마이그레이션 (소비 프로젝트 재-scaffold)

- 새 스크립트/스킬/훅 반영: `sdd-init` 재실행(settings.json·package.json·git훅 병합).
- 기존 스펙 보강: 각 스펙에 `Files:` glob + `## Edge Cases`·`## Change Log` 섹션 추가. Files 없는 스펙은 check-spec-sync 대상 아님(converge-drift advisory만) — 점진.
- CHANGELOG + 키트 버전 bump. 마이그레이션 노트 문서화.
