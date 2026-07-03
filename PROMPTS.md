# 붙여넣기 프롬프트 (어느 IDE/에이전트든)

## A0. 최초 채택 (새 프로젝트 / SDD 없던 프로젝트 — 권장 시작점)
> 두 계층: **작성·검토**는 GitHub 문서 직접 읽기로 다운로드 없이 되고, **강제**(훅·게이트)만 `sdd-init` 1회로 ~25파일을 심는다. sdd-init 이전 구간은 아래처럼 명령형으로 좁혀야 이탈(임의 PREFIX·스펙 위치 발명)이 안 생긴다.
```
이 프로젝트는 https://github.com/lhs6395-hslee/ai-methodology 의 SDD 방법론을 따른다. 추측 없이 순서대로 실행해:
1) 방법론 읽기(다운로드 불필요): 키트의 REALITY_CHECK.md → STORAGE.md → APPLYING.md 정독.
   (이 머신엔 ~/Documents/claude/sdd 로 이미 있음. 없으면 git clone https://github.com/lhs6395-hslee/ai-methodology ~/Documents/claude/sdd 1회.)
   "된다"는 실제 실행 증거로만 — [검증]/[추론]/[미확인] 구분.
2) 강제 배선(1회): 이 프로젝트 루트에서  sh ~/Documents/claude/sdd/tooling/sdd-init.sh --gate=node
   → sdd/ 레이아웃·게이트(~25파일)·git 훅(pre-commit·commit-msg)·SessionStart/PreToolUse·스킬(/sdd-sync·/speckit.fix)이 배선된다. (언어 무관 — node 런타임만 쓰고 언어차는 sdd.config.json으로.)
3) 세션 재시작(SessionStart hook이 방법론 주입) 후 게이트 green을 실행으로 확인.
고정 규칙(발명 금지): spec 위치는 sdd/specs/ 만, PREFIX는 SPEC/INFRA/TEST 만(새 PREFIX는 사유와 함께 내 승인 필요),
1 spec = 1 aggregate, 소유 코드 변경엔 같은 changeset에 spec 동반(순수 hotfix만 커밋 트레일러 Spec-Impact: none <사유>).
지금은 설치·배선까지만 하고, 스펙 대량 생성은 내 승인 후에.
```

## A0-R. 완전 재채택 (기존 sdd/가 있는 프로젝트를 clean 하게 다시 시작)
> 기존 SDD 산출물이 쌓였는데(스펙·게이트가 낡거나 어긋남) 현 방법론으로 처음부터 다시 세울 때. **코드는 남기고 sdd/ 산출물만 새로** — git 스냅샷으로 되돌릴 수 있게 한 뒤 진행한다.
```
이 프로젝트를 https://github.com/lhs6395-hslee/ai-methodology 방법론으로 처음부터 완전 재채택한다. 순서대로:
1) 안전망: git add -A && git commit 후  git tag sdd-pre-readopt-<오늘날짜>  로 현재 상태 스냅샷(진짜 손실 0).
2) 방법론 읽기: ~/Documents/claude/sdd (없으면 clone 1회)의 REALITY_CHECK→STORAGE→APPLYING 정독.
3) 강제 배선: 프로젝트 루트에서  sh ~/Documents/claude/sdd/tooling/sdd-init.sh --gate=node --force
4) 구 산출물 정리: 기존 sdd/specs/* 를 걷어낸다(코드는 그대로. 스냅샷 태그에 남아 있음).
5) 스펙 재도출: 현재 코드 실태를 읽어 EARS FR 스펙을 새로 도출해라(reverse-engineer). spec은 sdd/specs/ 에만,
   PREFIX는 SPEC/INFRA/TEST, 1 spec=1 aggregate, 작성=너/승인=나. 초안을 만들되 대량 생성·확정은 내 승인 후.
6) 결선: @covers 태깅 → 게이트 green → 커밋(자기 훅 통과).
고정 규칙은 A0과 동일. 승인 없이 스펙을 확정하거나 코드를 방법론에 맞춘다며 덮어쓰지 마.
```

## A. 이 키트로 새 프로젝트에 SDD 셋업
```
/Users/toule/Documents/claude/sdd 키트를 기준으로 이 프로젝트에 SDD를 셋업해줘.
먼저 REALITY_CHECK.md → STORAGE.md → APPLYING.md → STRUCTURE.md → DEDUP.md → METHODOLOGY.md 순서로 읽어
(STORAGE.md=spec·방법론 저장 정의/레이아웃, DEDUP.md=스펙 간 중복 2계층 게이트, 누락 금지).
추측 금지: "된다"고 하기 전에 실제로 실행/확인해 증거를 대고 [검증]/[추론]/[미확인]로 구분해.
이 프로젝트 도메인으로 placeholder를 치환하되, 방법론(Spec Kit+EARS+Superpowers,
module>spec, 작성=LLM/승인=사람, FR↔test 게이트)은 그대로. 지금은 APPLYING.md의
설치·배선(0~3단계)까지만, 스펙 대량 생성은 내 승인 후에.
```

## B. 진행 중 프로젝트 이어가기
```
이 프로젝트는 /Users/toule/Documents/claude/sdd 방법론으로 SDD 진행 중이야.
새로 분석하지 말고 그 키트와 이 레포의 sdd/ 를 읽어 이어가. 작업 원칙(전부정독·
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

## U. 방법론 업데이트 (GitHub 정본이 고도화된 뒤 이 프로젝트로 당겨오기)
> 내가 `ai-methodology` 레포에 방법론을 고도화한 뒤, 이 프로젝트의 도구(게이트·훅·템플릿)만 최신으로. **스펙·작업물은 불변**, 자동 덮어쓰기 금지.
```
https://github.com/lhs6395-hslee/ai-methodology 방법론을 최신으로 업데이트해줘.
1) 로컬 키트 ~/Documents/claude/sdd 를 git pull 로 origin/main 최신화(뒤처졌으면 알려줘).
2) 이 프로젝트에 설치된 것(scripts/의 *.mjs 게이트 · .git/hooks · .claude/skills · sdd/templates)을 키트와 diff.
3) 바뀐 파일만 목록으로 보여주고, 내 승인을 받은 뒤에만 반영 — 자동 덮어쓰기 금지.
   (sdd-init 를 --force 없이 재실행하면 신규만 추가되고 기존은 보존. 게이트 코드 갱신은 diff 확인 후 명시적으로 복사.)
4) 반영 후 게이트를 돌려 green 확인하고, 무엇이 바뀌었는지 요약해줘.
내 스펙·FR·작업물(sdd/specs/*)은 절대 건드리지 마 — 최신화 대상은 방법론 도구(게이트·훅·템플릿)뿐이다.
```
