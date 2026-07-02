# 붙여넣기 프롬프트 (어느 IDE/에이전트든)

## A0. 레포 URL만으로 진입 (다른 머신 / 새 프로젝트 — 권장 시작점)
> "이 방법론 기반으로 개발할거야"를 URL만 주고 시작할 때. 강제 궤도(hook·게이트)는 **sdd-init 이후부터 기계적으로** 걸리므로, 그 전 구간은 아래처럼 명령형으로 좁혀야 이탈(임의 PREFIX·스펙 위치 발명)이 안 생긴다.
```
이 프로젝트는 https://github.com/lhs6395-hslee/ai-methodology 의 SDD 방법론을 따른다. 아래를 순서대로, 추측 없이 실행해.
1) 키트 준비(프로젝트 밖에 참조용으로만 — 이 레포 안으로 복사/fork 금지):
   로컬에 키트가 이미 있으면 git pull로 최신화, 없으면 git clone https://github.com/lhs6395-hslee/ai-methodology ~/ai-methodology
2) 키트의 REALITY_CHECK.md → STORAGE.md → APPLYING.md 정독. "된다"는 실제 실행 증거로만 — [검증]/[추론]/[미확인] 구분.
3) 이 프로젝트 루트에서: sh <키트경로>/tooling/sdd-init.sh --gate=node
   → sdd/ 레이아웃·게이트·git 훅(pre-commit·commit-msg)·SessionStart/PreToolUse·스킬(/sdd-sync·/speckit.fix)이 배선된다.
4) 세션 재시작(SessionStart hook이 방법론을 주입) 후 게이트 green을 실행으로 확인.
고정 규칙(발명 금지): spec 위치는 sdd/specs/ 만, PREFIX는 SPEC/INFRA/TEST 만(새 PREFIX는 사유와 함께 내 승인 필요),
1 spec = 1 aggregate, 소유 코드 변경엔 같은 changeset에 spec 동반(순수 hotfix만 커밋 트레일러 Spec-Impact: none <사유>).
지금은 설치·배선까지만 하고, 스펙 대량 생성은 내 승인 후에.
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
