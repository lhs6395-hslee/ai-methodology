# 설계 — 방법론 강제 hook 세트 (채택 시 자동 배선 · 상시 강제 궤도)

> Status: **Draft (검토 대기)** · Date: 2026-07-01
> 관련: [HARNESS.md](../../../HARNESS.md) · [METHODOLOGY.md](../../../METHODOLOGY.md) · [tooling/sdd-init.sh](../../../tooling/sdd-init.sh) · 자매 설계 [2026-06-30-ownership-key-derivation-design.md](2026-06-30-ownership-key-derivation-design.md)
> 전제: 하네스(Gap 3)가 규칙표·게이트·pre-push·`/sdd-sync`를 갖췄다. 이 설계는 그 트리거를 **채택 순간 + 세션/편집 시점**으로 앞당겨 "채택=상시 강제 궤도"를 닫는다.

## 0. 요약

방법론이 **문서로만** 있으면 채택했어도 Claude(사람도)가 벗어난다. 채택(`sdd-init`) 순간 **hook 세트**를 `.claude/settings.json` + git hooks에 자동 배선하고, 그게 레포에 커밋되어 **이후 모든 세션·모든 커밋이 방법론 궤도(spec→code→test→sync)를 강제**받게 한다. 두 레이어: **Claude Code hook(상기)** + **git hook(hard 차단)**.

## 1. 문제 — "문서 존재 ≠ 준수" (실증)

대상 프로젝트(이미 이 키트로 sync됨, 방법론 문서 완비)에서 관측된 이탈:

| 이탈 | 방법론이 말하는 것 | 실제 |
|---|---|---|
| 스펙 위치 | `sdd/specs/` | `docs/superpowers/specs/`(superpowers 기본 경로) |
| PREFIX | 표준만, 임의 생성 금지 | `FEAT-002`를 지어냄 |
| 진입 1단계 | MODULE_MAP 대조 → 겹치면 개정 | 대조 건너뛰고 새 스펙(개정이 정답이었음) |

**근본 원인:** superpowers 스킬이 세션 진입 시 자동 발동해 *자기 기본 경로*(brainstorming→`docs/superpowers/specs/`→writing-plans)로 끌고 간다. 프로젝트 고유 방법론(Spec Kit 흐름·`sdd/specs/`·PREFIX 규칙)은 *읽어야 아는 문서*라, 세션 컨텍스트에 강제로 안 올라오면 스킬 기본값이 이긴다. **모델 지능 문제가 아니다** — opus여도 컨텍스트에 없으면 모른다. 문서·포인터로는 못 막는다 → **행동을 가로채는 강제**가 필요.

## 2. 목표 / 비목표

**목표**
- 채택 순간부터 **상시 강제 궤도** — 이탈 시 되돌림.
- 세션 진입 시 방법론 **자동 주입**(안 읽을 수 없게).
- 코드 편집 시점 **체크리스트 강제**.
- 커밋/푸시 시점 **기계 차단**.
- 한 번 배선하면 **모든 세션·팀원에 영구 적용**(레포 커밋).

**비목표 (정직)**
- hook으로 100% 물리 강제 — 주입(상기)은 soft다. hard 차단은 git hook.
- Claude Code 외 에이전트 완전 커버 — git hook만 에이전트중립 백스톱.
- 정확한 hook 스키마 단정 — 구현 시 Claude Code 문서로 확정(REALITY_CHECK 원칙).

## 3. hook 세트 → 궤도 각 지점 강제

```
채택 (sdd-init) ──▶ .claude/settings.json + git hooks 배선 (레포 커밋 → 영구)
   │
   ▼
┌──────────────── 상시 강제 궤도 ────────────────┐
│ ① 진입          [SessionStart] 방법론·궤도·      │
│                 MODULE_MAP·PREFIX 주입           │
│ ② 코드 개발     [PreToolUse] 편집 체크리스트     │
│ ③ 검증          [git pre-commit] @covers·        │
│                 ownership·PREFIX 차단            │
│ ④ sync          [git pre-push] sdd-sync drift    │
│                 └── 이탈 → 되돌림 ──┘            │
└─────────────────────────────────────────────────┘
```

| hook | 궤도 지점 | 동작 | 레이어 · 강도 |
|---|---|---|---|
| **SessionStart** | 진입 | 방법론 요약·궤도·진입 규칙(MODULE_MAP 대조·`sdd/specs/` 위치·PREFIX 표준)을 컨텍스트 주입 | Claude Code · 상기 |
| **PreToolUse**(`Write`/`Edit` on `scanDirs`) | 코드 개발 | 새 파일 생성/세션 첫 `src` 편집 시 체크리스트(스펙부터·대응 FR·PREFIX·@covers) 주입 | Claude Code · 상기 |
| **git pre-commit** (신규) | 검증 | 변경 코드에 대응 `@covers`/FR 없음·ownership 위반·PREFIX 화이트리스트 위반 = 차단 | 에이전트중립 · **hard** |
| **git pre-push** (기존) | sync | `sdd-sync` drift 일괄 점검 | 에이전트중립 |

## 4. 두 레이어 — 강도가 다르다 (정직)

- **Claude Code hook (SessionStart·PreToolUse) = 상기.** "Claude가 방법론을 *못 잊게*" 만든다. §1의 "안 읽어서 샘"을 직접 막는다. 단 (a) Claude Code 실행기에서만, (b) 컨텍스트 주입이지 물리 차단은 아니다(있으면 훨씬 잘 따르지만).
- **git hook (pre-commit·pre-push) = hard 차단.** 누가·무슨 도구로 코딩하든 커밋/푸시에서 물리 차단. 언어·에이전트 무관 **백스톱**.
- **계단**: 상기(Claude Code)로 새는 걸 줄이고, 차단(git)으로 못 넘어가게. 완전 편집 차단은 hotfix까지 막아 비현실적이라, 상기+차단으로 나눈다.

## 5. 각 hook 동작 상세

- **SessionStart** — 방법론 1페이지 요약(궤도 그림 + 진입 규칙 + PREFIX 표준 + `sdd/specs/` 위치 + "superpowers 기본 경로 대신 Spec Kit 흐름")을 세션 컨텍스트로 주입. 세션당 1회라 가볍다.
- **PreToolUse**(`Write`/`Edit`, matcher = `scanDirs` 경로) — 새 코드 파일 생성 또는 세션 첫 `src` 편집 시에만 체크리스트 주입(매 편집마다 = 소음, 억제): ①MODULE_MAP 대조했나 ②대응 FR 있나(없으면 spec부터) ③PREFIX 표준인가 ④@covers 계획.
- **git pre-commit** (신규) — 스테이징된 코드 변경에 대응 `@covers`/FR가 없거나 ownership·PREFIX 위반이면 차단. (편집 상기가 놓친 것의 hard 백스톱. `--no-verify` 우회는 로그에 남아 리뷰 노출.)
- **git pre-push** (기존) — `sdd-sync`로 drift 일괄 점검(현행 유지).

## 6. 채택 자동 배선 (`sdd-init`)

- `sdd-init`가 다음을 배선한다:
  - `.claude/settings.json` → `SessionStart`·`PreToolUse` hook (기존 파일 있으면 **병합**, 덮어쓰지 않음).
  - git `pre-commit`(신규)·`pre-push`(기존) 훅.
  - hook 스크립트는 `scripts/`에 config 구동으로 배치(`sdd-session-context.*`, `sdd-pretooluse-check.*` 등) — 게이트처럼 4-런타임 대응 가능하나 hook 자체는 Claude Code 실행기.
- `.claude/settings.json`은 **레포에 커밋** → 클론·모든 세션·팀원에 적용 = 사용자가 말한 **"계속 이 방법론 기반으로 작업"**의 실현.
- **opt-out**: hook을 원치 않으면 제거 가능(문서화). 강제하되 탈출구는 명시(투명).

## 7. HARNESS.md와의 관계

- **계약(규칙표 R1~R4)은 중립 유지.** hook 세트는 Claude Code **실행기의 트리거 확장** — 기존 트리거(커밋/푸시/요청)에 **세션 시작·코드 편집**을 더한다.
- HARNESS.md에 트리거 표를 확장(세션·편집 행 추가). 다른 에이전트는 자기 실행기로 같은 궤도를 건다.

## 8. "채택 = 상시 강제 궤도" 원칙 명시

- [METHODOLOGY.md](../../../METHODOLOGY.md) 최상단(또는 `constitution.md`)에 원칙 선언:
  > **이 방법론을 채택한 프로젝트는 채택 순간부터 `spec→code→test→sync` 궤도를 상시 강제받는다. 이탈(문서 없는 코드, 임의 PREFIX, 미대조 스펙)은 hook·게이트가 감지해 궤도로 되돌린다. 방법론은 읽는 문서가 아니라 벗어날 수 없는 궤도다.**
- 이 hook 세트가 그 원칙의 **실행 장치**임을 명시.

## 9. 정직한 한계

- **주입(상기) ≠ 물리 차단.** Claude가 무시 가능하나 컨텍스트에 있으면 훨씬 준수. hard는 git hook.
- **Claude Code hook은 그 에이전트에서만.** 사람 손편집·타 에이전트는 git hook만 걸린다.
- **hook 남발 = 소음·성능.** 최소 세트만(SessionStart 세션당 1회, PreToolUse 새 파일·첫 편집만).
- **정확한 `settings.json` hook 스키마·필드는 구현 시 Claude Code 문서로 확정** — 기억으로 단정 안 함(REALITY_CHECK).

## 10. 설치 · 하위호환

- `sdd-init`에 hook 배선 단계 추가. 기존 pre-push 유지.
- `.claude/settings.json` 기존 있으면 **병합**(사용자 hook 보존).
- config 없는/opt-out 프로젝트는 기존 동작 유지.

## 10.5 사용법 문서 (how-to — 궤도 운영법)

설계만 있고 사용법이 없으면 또 이탈한다. 채택자·팀이 궤도를 실제로 도는 법을 **함께 기재**한다:

- **[APPLYING.md](../../../APPLYING.md)** (런북 확장): 채택(`sdd-init`) → 배선 확인 → **궤도 한 바퀴 운영법** — ① 세션 시작 시 뜨는 방법론 요약을 어떻게 읽나 ② 새 기능 절차(MODULE_MAP 대조 → `sdd/specs/`에 spec, PREFIX 표준 → TDD) ③ 편집 시 체크리스트 대응 ④ 커밋/푸시 차단 시 해소법 ⑤ **이탈 시 되돌리는 법**(`/sdd-sync`·게이트 실패 읽는 법).
- **`방법론.html`** (시각): "채택 후 궤도 한 바퀴" 워크스루 추가(기존 하네스 실전 워크스루를 채택~일상까지 확장) — hook·게이트가 언제·무엇을 띄우는지 단계별 + **출력 예시**.
- **[README.md](../../../README.md)·설치물 `sdd/README.md`**: 사용법 포인터.

각 hook·게이트의 **실제 출력 예시**(무엇이 보이고 어떻게 대응하나)를 포함해 "읽고 바로 따라 하는" 수준으로 쓴다.

## 11. 검증 계획

- `sdd-init` 후 `.claude/settings.json`에 hook 배선·git 훅 설치 확인.
- SessionStart 주입 텍스트에 진입 규칙·PREFIX·`sdd/specs/`·궤도 포함 확인.
- PreToolUse가 `src` 신규 `Write`에 체크리스트 주입(다른 경로엔 침묵) 확인.
- pre-commit이 `@covers` 없는 코드 변경·PREFIX 위반 차단(픽스처) 확인.
- 기존 게이트·pre-push 회귀 GREEN.
- **사용법 문서**: APPLYING.md·`방법론.html`에 궤도 운영법 존재, 기재된 hook·게이트 출력 예시가 실제 출력과 일치(추측 아닌 실측).

## 12. 자매 설계와의 관계

- **Ownership 결정성**([2026-06-30](2026-06-30-ownership-key-derivation-design.md)) = 궤도가 다루는 *대상*(무엇이 spec·키인가)을 결정적으로.
- **이 hook 세트** = 그 궤도를 *벗어나지 못하게*.
- **궤도 원칙 명시**(§8) = 둘의 *왜*를 방법론에 선언.
- 셋이 "채택=상시 강제 궤도" 하나로 닫힌다.
