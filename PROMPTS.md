# 붙여넣기 프롬프트 (어느 IDE/에이전트든)

## 한 줄 실행 (시작 · 재채택 · 업데이트) → raw URL (clone 불필요)
이 3종은 절차를 [`prompts/`](prompts/) 파일에 두고 **raw URL 한 줄로 실행**한다(방법론 읽기·`sdd-init`·고정 규칙까지 파일이 자체 포함 — 절차 원본은 여기 한 곳, SSOT). 키트가 로컬에 없어도 됨:

| 상황 | 대화창에 붙여넣는 한 줄 (raw URL) |
|---|---|
| **시작** (새/SDD 없던 프로젝트) | `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/adopt.md 읽고 그대로 수행해줘` → [adopt.md](prompts/adopt.md) |
| **재채택** (이미 sdd/ 있음 — 소비 프로젝트 A/B) | `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/readopt.md 읽고 그대로 수행해줘` → [readopt.md](prompts/readopt.md) |
| **업데이트** (방법론 고도화 후) | `https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/update.md 읽고 그대로 수행해줘` → [update.md](prompts/update.md) |

> **ref:** 위 URL의 정본 ref는 `main`. 각 파일은 자신을 받은 ref를 이어 써서 main/브랜치 어느 raw든 동일 동작(자기참조). 두 계층: **작성·검토**는 GitHub 문서 직접 읽기로 다운로드 없이, **강제**(훅·게이트)만 partial+sparse로 tooling 확보 후 `sdd-init` 1회(~25파일, 전체 clone 아님). 키트가 로컬에 있으면 경로로도 동일: `~/Documents/claude/sdd/prompts/adopt.md 를 그대로 수행해줘`.

> **설치형 슬래시 명령:** `sdd-init` 배선 후에는 같은 3종이 `/sdd-start`·`/sdd-readopt`·`/sdd-update`로 설치되어(`.claude/skills/`) 프로젝트 안에서 바로 부를 수 있다(인자 `[<project-path>] [<methodology-url>]`, 없으면 현재 디렉토리·정본). 절차 원본은 위 `prompts/`이고 스킬이 이를 실행한다 — 계약: `SPEC-005`.

아래 A/B/C는 위 3종에 안 들어가는 **다른 시나리오**의 붙여넣기 프롬프트다.

## A. 이 키트로 새 프로젝트에 SDD 셋업
> 보통은 위 표의 `prompts/adopt.md` raw URL 한 줄이면 된다. 아래는 방법론 문서를 스스로 훑게 하고 싶을 때의 확장 프롬프트다. 키트가 로컬에 없으면 raw base(`https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/`)에서 읽는다(clone 불필요).
```
방법론 https://github.com/lhs6395-hslee/ai-methodology 를 기준으로 이 프로젝트에 SDD를 셋업해줘.
(키트가 로컬에 있으면 그걸, 없으면 위 레포의 raw로 읽어라 — 다운로드 불필요.)
먼저 REALITY_CHECK.md → STORAGE.md → APPLYING.md → STRUCTURE.md → DEDUP.md → METHODOLOGY.md 순서로 읽어
(STORAGE.md=spec·방법론 저장 정의/레이아웃, DEDUP.md=스펙 간 중복 2계층 게이트, 누락 금지).
추측 금지: "된다"고 하기 전에 실제로 실행/확인해 증거를 대고 [검증]/[추론]/[미확인]로 구분해.
이 프로젝트 도메인으로 placeholder를 치환하되, 방법론(Spec Kit+EARS+Superpowers,
module>spec, 작성=LLM/승인=사람, FR↔test 게이트)은 그대로. 지금은 APPLYING.md의
설치·배선(0~3단계)까지만, 스펙 대량 생성은 내 승인 후에.
```

## B. 진행 중 프로젝트 이어가기
```
이 프로젝트는 방법론 https://github.com/lhs6395-hslee/ai-methodology 로 SDD 진행 중이야.
새로 분석하지 말고 그 방법론(로컬 키트 있으면 그것, 없으면 레포 raw)과 이 레포의 sdd/ 를 읽어 이어가. 작업 원칙(전부정독·
병렬저비용티어·실패시완료까지재시도·작성LLM/승인사람·도메인범용·언어/모델/인프라무관)을 지켜.
CI 게이트(commands.lint/typecheck/test/check:fr/check:ownership)가 green인지 먼저 확인하고,
red면 원인을 실행으로 찾아 고친 뒤 진행해. (게이트는 sdd.config.json 어댑터로 구동.)
```

## C. 코드 우선 변경(hotfix) 후 spec 동기화
> 일상 버그픽스는 `/speckit.fix`(RED 재현 → spec 선착지 → GREEN → 게이트)가 정경로. 아래는 spec 없이 코드가 이미 벌어진 **드리프트 복구**용.
```
hotfix로 코드가 spec보다 앞섰어. /speckit.converge로 갭을 task로 표면화하고,
/speckit.specify(update)로 네가 spec(FR)을 갱신해 초안을 만들어. /speckit.analyze로
기존 FR과 중복·정합을 검사해. 그다음 "정본화(bless) vs 되돌리기(revert)"는 내가 승인할게.
승인 없이 spec을 코드에 맞춰 자동으로 덮어쓰지 마.
```

> **업데이트**(방법론 고도화 후 최신화)는 위 표의 [`prompts/update.md`](prompts/update.md) 참조 — "이 방법론 업데이트해줘" 한 줄.
