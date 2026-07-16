# Entity Relations — Design

## 문제

`STRUCTURE.md` §3.1 원칙은 "1 spec = 1 aggregate(핵심 Entity)"이지만, 실사용에서는 spec이 여러 Entity를 안고 있는 경우가 흔하다(소비 프로젝트 B의 SPEC-005가 aggregate root 7개로 cohesion 게이트 상한을 넘긴 실측 사례). 그런 과대 spec을 나중에 aggregate별로 쪼갤 때, 쪼개진 Entity들 사이의 관계(예: `InvestigationRun`이 `InvestigationFinding`을 여러 개 가짐)를 표현할 방법이 필요하다.

지금 `## Dependencies` 절의 `Entities:` 라인은 "다른 spec이 소유한 Entity를 참조한다"는 걸 적을 수 있지만 완전한 자유 텍스트다 — 게이트가 그 값의 존재·소유 spec 일치·순환 여부를 전혀 검사하지 않는다(`tooling/check-ownership.mjs`가 `_deps`라는 이름으로 파싱은 하되 명시적으로 버림).

## 요구사항 (사용자 확인 완료)

1. 관계를 **구조화**해서 적는다 — 자유 텍스트가 아니라 "어떤 Entity를, 어떤 관계로" 참조하는지 기계가 읽을 수 있게.
2. 게이트가 검사할 것: **(a)** 참조 대상 Entity의 실재 + 소유 spec 자동 해석, **(b)** aggregate 간 순환 참조 탐지. (사용자가 고른 세 항목 중 "관계 종류·소유 spec 상호 일관성"은 (a)와 기계적으로 동일한 검사라 하나로 합쳤다 — 대상이 실재하고 소유 spec이 해석되면 그게 곧 일관성 확인이다.)
3. 문법은 **기존 `Dependencies.Entities` 줄을 확장** — 새 절을 만들지 않는다.
4. 관계 종류(relation-type) 어휘는 **config에서 등록하는 자유 어휘** — `capabilityVerbs`와 동형 패턴. 빈 목록이면 어휘 제한 없음(문자열 형식만 검사).
5. 기본 심각도: **실재·소유 spec 해석 = hard**, **순환 참조 = advisory**.

## 문법

```
## Dependencies (참조 — dedup 제외)
- **Entities**: investigation_finding (has-many), plan_provider_call (references)
```

- `EntityName (relation-type)` — 괄호 있으면 **구조화된 관계**로 파싱되어 검사 대상이 됨.
- `EntityName`만 있으면(괄호 없음) 지금과 동일한 **레거시 자유 참조** — 아무 검사도 안 함(하위호환, opt-in은 문법 자체로).
- `relation-type` 토큰 문법은 `[a-z][a-z0-9-]*`(소문자 kebab 1토큰)로 제한 — `(deprecated, 검토 필요)`처럼 공백·쉼표·대문자가 든 기존의 우연한 괄호 서술과 겹치지 않게 방어(오검출 방지).

## 검증 로직 (순수 함수 — `relation-lib.mjs` / Python 미러)

- `parseRelationEntry(raw)` → `{name, type}` (type은 없으면 null)
- `relationTypeFinding(type, allowedTypes)` → allowedTypes가 비어있지 않은데 type이 그 안에 없으면 에러 메시지
- `resolveRelations(specDeps, entityOwnerIndex)` → 구조화된 관계만 골라 `{edges, missing}`. `missing`은 대상 Entity가 어느 spec의 Ownership에도 없는 경우(= 실재·소유 spec 해석 실패, hard).
- `findCycles(edges)` → spec 간 참조 그래프에서 순환 탐지(DFS, 3색 마킹). 반환된 각 순환은 advisory로 출력.

## 배선

`tooling/check-ownership.mjs`(SPEC-002 소유)가 이미 전 spec의 Ownership을 한 패스로 모으고 있으므로, 그 결과(entity→소유 spec 인덱스)를 재사용해 두 번째 패스에서 관계를 검증한다. 새 판정 코어(`relation-lib.mjs`)는 SPEC-002/012/015/016과 같은 패턴으로 **신설 SPEC-017**이 소유하고, `check-ownership.mjs` 본체는 호출만 한다. Python(`sdd_gates.py`)에 동일 로직을 미러(SPEC-006 패리티).

새 config: `relationTypes: []`(기본 — 어휘 제한 없음, `capabilityVerbs`와 동형).

## 대안 검토

- **새 `## Relations` 절 신설**: 표현력은 더 크지만(카디널리티·양방향 등) 사용자가 "기존 Dependencies 확장"을 명시적으로 골랐고, YAGNI상 지금 필요한 건 "이름+타입"뿐이라 보류.
- **전용 게이트 파일 신설**: `check-ownership.mjs`가 이미 만들어 둔 entity→spec 인덱스를 다시 구축해야 해서 중복 비용이 검증 코어 분리 이득보다 큼 — 판정 코어만 분리하고 배선은 기존 파일에 남긴다(SPEC-012/015/016과 동일 패턴).

## 영향 범위

- `tooling/relation-lib.mjs`(신규) + `tooling/__tests__/relation.test.mjs`(신규)
- `tooling/check-ownership.mjs` 배선 추가
- `tooling/sdd_gates.py` Python 미러 + `tooling/__tests__/sdd-gates-py.test.mjs` 패리티 테스트
- `tooling/sdd-config.mjs` DEFAULTS에 `relationTypes: []`
- 신설 `sdd/specs/SPEC-017-entity-relations.md`, `SPEC-001`(DEFAULTS Change Log)·`SPEC-002`(배선 Change Log)·`SPEC-006`(패리티 Change Log) 개정
- `tooling/ears-preset/templates/spec-template.md`의 Dependencies 절 주석에 새 문법 안내 추가
- `STORAGE.md`·`tooling/sdd.config.presets.md` config 표에 `relationTypes` 행 추가
- `방법론.html`에 이 기능 설명 추가(사용자 요청)
