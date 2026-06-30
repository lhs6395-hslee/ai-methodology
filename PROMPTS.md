# 붙여넣기 프롬프트 (어느 IDE/에이전트든)

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
```
hotfix로 코드가 spec보다 앞섰어. /speckit.converge로 갭을 task로 표면화하고,
/speckit.specify(update)로 네가 spec(FR)을 갱신해 초안을 만들어. /speckit.analyze로
기존 FR과 중복·정합을 검사해. 그다음 "정본화(bless) vs 되돌리기(revert)"는 내가 승인할게.
승인 없이 spec을 코드에 맞춰 자동으로 덮어쓰지 마.
```
