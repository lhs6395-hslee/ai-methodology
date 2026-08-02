# Ownership 분류 감사 — Entities/Surfaces/Capabilities (Fable5 6차원 + opus 관계/도그푸딩, 종합 opus·low)

**판정:** 현 3분류(Entities/Surfaces/Capabilities)는 북극성("스펙 간 기능 중복을 예외 없이 방지")에 도달하지 못한다 — 부족하다. 세 축 중 실재·귀속 강제를 받는 것은 Entities(스키마 백킹)와 Capabilities(entity.verb 귀속)뿐이고 Surfaces는 형식검증조차 선택적인 무검증 수납칸이다. 결정적으로 (1) 두 강제 게이트의 '활성' 자체가 카테고리 의미가 아니라 config 문자열 이름의 정규식(/entit/i·/capabilit/i)과 entitySchemaSources 존재에 걸려 있어 policy=hard를 유지한 채 카테고리 개명·소스 비우기 한 줄로 무음 비활성되며(mece-2, entityless-3, oc-2, ex-2, ex-9), (2) 최종 방어선인 SPEC-027 래칫이 자기 자신과 활성 전제조건·면제 목록·임계값을 감시하지 않아(ex-1, ex-2, ex-8, entityless-4) 이 우회들이 전부 '위반 0건'으로 통과하고, (3) SPEC-026이 유령 entity의 공식 해소책으로 처방하는 'Surface 강등'이 위반을 정확히 이 무검증 칸으로 이송해 방법론이 스스로 권하는 경로가 곧 우회로가 된다(oc-1, mece-1, mece-5, semantic-dup-4). 게다가 dedup 유일성이 '카테고리 내부' 한정이라 같은 실개념이 Capability와 job:Surface로 이중 소유돼도, 파라미터명·인라인 주석·단복수 변형으로 표기만 어긋나도 무검출이다(mece-4, semantic-dup-1·2·3). 귀속 강제는 capability 축에만 존재하고 Surface·FR 산문에는 없어 entity 0개 스펙이 라우트·이벤트만 번들하거나(entityless-1), entity 1개가 무관 기능의 면허가 되거나(entityless-5), 참조 entity 위에서 FR이 동작하는(gran-1) '기능 묶임'이 최강 설정에서도 뚫린다. 그리고 순수 엔진/정책/값객체/교차-aggregate 리포트는 세 축 어디에도 담을 칸이 없어(mece-3, oc-5, gran-5) 저자가 유령 entity 날조·대량 면제·Surface 개명을 강요당한다 — 킷 자신은 이를 Modules/Symbols/Artifacts로 피하면서 소비 프로젝트에는 그 처방을 주지 않는다. 결론: 3분류로는 부족하며, (a) 활성·래칫·면제·기본값의 강제 구멍을 닫고 (b) 무검증 축(Surfaces·Files)에 실재·귀속·유일성 게이트를 얹고 (c) 엔진/이벤트를 담을 백킹 강제형 새 카테고리를 도입해야 '예외 없음'에 근접한다.

**한 줄:** 기능 중복은 예외 없이 막히지 않는다 — 가장 약한 지점은 Surfaces가 무검증 수납칸이면서 유령 entity의 공식 강등 종착지라는 점, 그리고 hard 게이트의 활성 여부가 config 이름 한 줄·래칫 밖 knob에 걸려 있어 policy=hard인 채로 조용히 꺼진다는 점이다.

> **해소 상태 (2026-08-02 기준 — 이 보고서는 2026-07 시점 기록이고, 아래는 이후 반영 결과다).**
> 이 문서는 **감사 시점의 판정을 그대로 보존**한다(고쳐 쓰지 않는다). 무엇이 닫혔는지는 여기서 본다.
>
> | 감사 지적 | 반영 | 상태 |
> |---|---|---|
> | 판정이 카테고리 **이름**(정규식)에 걸려 개명 한 줄로 무력화 | `ownershipCategoryRoles` 역할 선언 + `resolveCategoryRoles`(SPEC-001 FR-010) | ✅ |
> | 순수 로직·비동기 신호를 담을 칸 없음 → 유령 entity·`job:` 우회 | **Engines·Events** 역할 신설(SPEC-030, 옵트인) | ✅ |
> | Surfaces가 무검증 수납칸(정방향 실재 판정 부재) | 심볼 실재 문법(SPEC-029) — orphan 역방향과 짝 | ✅ |
> | entity 없는 소유 번들(경계 없는 잡화점) | aggregate root **최소 하한**(SPEC-002) | ✅ |
> | capability 캡이 full-CRUD를 거짓 분할 신호로 읽음 | 캡을 **entity별**로 카운트(SPEC-002) | ✅ |
> | 소유 선언 없는 스펙·카테고리 교차 중복·Files 글롭 겹침 | G1·G2·G3 게이트(`ownershipRequiredPolicy`·`crossCategoryDedupPolicy`·`filesOverlapPolicy`) | ✅ |
> | 강도 knob 하향으로 위반을 회피 | 정책 래칫(자기포함, SPEC-027) | ✅ |
> | **semantic-dup 6건** — `order`/`orders`·`user`/`member`가 dedup을 통과 | 동의어 3층(SPEC-033): ①형태 변이·②선언 동의어는 결정적 차단, ③유사 후보는 **비차단** + 후보 목록 신선도 | ✅ 부분 — 재서술된 중복은 여전히 사람 몫(재현율 측정 불가) |
> | 소유자 제안: `user.student` 같은 **깊이 모델**로 FR 주어를 잡자 | **미채택** — 단일 점(dot) capability 문법·첫 점 귀속·리터럴 스키마 백킹과 충돌하고, 다부모 개념을 표현하지 못해 예외를 늘린다. 다부모는 relation 참조로 표현한다(SPEC-017) | ❌ 기각(사유 기록) |
>
> 상세·시각 설명: [`ownership-key.html`](ownership-key.html) · 비전문가용 [`ownership-key-easy.html`](ownership-key-easy.html) · 정본 산문 `DEDUP.md` §3.5·§4

## 새 카테고리 제안

### Engines (또는 Derivations/Values) — 코드-모듈 SSOT로 백킹되는 비-aggregate 순수 로직
- 담는 것: 순수 계산 라이브러리·정책(pricing rules)·값객체(money·address)·파생 산출 로직처럼 상태 aggregate도 외부 표면도 entity.verb 능력도 아니지만 스펙이 정당하게 '소유'해야 하는 대상. 킷 자신의 Modules/Symbols/Artifacts에 대응하는 소비 프로젝트 문법.
- 왜 기존 칸 불가: 현재 이런 대상은 E/S/C 어디에도 칸이 없어(mece-3, oc-5, gran-5) 저자가 무관 entity 욱여넣기·유령 entity 날조+entitySchemaExemptEntities 면제·job:Surface 개명 중 하나를 강요받고, 실측 40건 일괄 면제가 그 결과다. Files만 선언하면 '블록 없음' strict exit 1.
- 상호배타 유지: Entities는 DB 스키마 SSOT에 리터럴로 실재해야 하고(테이블), Engines는 코드-모듈 SSOT(enginesSources 글롭)에 실재해야 한다 — 백킹 대상이 다르므로 상호배타. 형식은 module-path 문법(테이블 식별자 아님)으로 강제해 entity와 표기 충돌 방지. Engines 키에는 capability(engine.verb)를 붙일 수 없게 하여(순수 로직은 능력 소유자가 아님) capability 귀속 축과도 분리. 무검증 자유문자열 칸이 되지 않도록 반드시 코드-실재 대조 게이트를 동반한다.

### Events — 비동기 신호·배치 job을 담는 백킹 강제형 전용 카테고리
- 담는 것: event:order-created, job:budget-aggregate 같은 도메인 이벤트/배치 작업. 발신 aggregate에 귀속되고 이벤트 카탈로그(코드/AsyncAPI 등) SSOT에 실재해야 한다.
- 왜 기존 칸 불가: 현재 event:/job:은 Surface 접두어로만 존재해 이름이 완전 자유문자열이고 어떤 실재·귀속 검사도 안 받는다(mece-1). 그 결과 budget-engine형 기술계층 스펙이 능력을 job:표면으로 개명해 all-hard를 통과하고(mece-1), 같은 이벤트가 표기 변형으로 중복 소유되며(semantic-dup-5), 같은 실개념이 Capability와 job:Surface로 이중 소유돼도 dedup 카테고리 내부 한정으로 무검출된다(mece-4).
- 상호배타 유지: Surfaces=동기 외부 표면(HTTP 라우트/화면)만으로 좁혀 job:/event:를 Surfaces에서 제거 → Surface 형식을 http 표면으로 엄격화. Events는 'aggregate.event' 형식으로 발신 entity에 귀속 강제(SPEC-024와 동형)하여 entity 없는 이벤트 소유를 차단하고, 이벤트 카탈로그 실재 대조로 유령을 막는다. 이로써 '한 배치 집계'가 Capability냐 Surface냐 하는 재량(mece-4)이 사라지고 정본 표기가 하나로 고정된다.

## 구조 테마 (severity 순)

- **[critical] Surfaces가 무검증 종착지 + 유령의 공식 강등 경로 — 실재·귀속 게이트가 없는 카테고리로 위반이 이송된다** — Surfaces에는 스키마 백킹(SPEC-026)·capability 귀속(SPEC-024) 어느 대조도 없고 선언 키의 실재를 보는 게이트도 없다(orphan-surfaces는 역방향+기본 no-op). 그런데 SPEC-026이 유령 entity의 공식 해소책으로 'Surface 강등'을 처방하므로, 과분류가 차단이 아니라 검증 사각 칸으로의 이송으로 끝난다. job:/event: 접두어는 이름이 완전 자유문자열이라 budget-engine형 기술계층 스펙이 능력만 job:표면으로 개명해 all-hard를 통과하고, 면제 부채 advisory(FR-005)조차 사라진다. _(ids: oc-1, mece-1, mece-5, semantic-dup-4, entityless-1)_

- **[critical] 게이트 활성이 카테고리 '의미'가 아니라 config 문자열(이름 정규식·소스 존재)에 걸려 있어 policy=hard인 채 무음 비활성** — capabilityCheckActive=/entit/i&&/capabilit/i, schemaBackingActive=/entit/i&&sources.length>0. ownershipCategories는 자유 문자열이고 검증은 'Files' 금지 하나뿐이며 정규화(normalizeKey)는 'Surfaces'/'Capabilities' 리터럴에 하드코딩돼 있다. 카테고리를 Aggregates/Actions로 개명하거나 entitySchemaSources를 []로 비우면 두 기함 게이트가 policy 값 hard 그대로 통째로 죽고, 비활성에 대한 출력 신호가 0줄이다. 킷 자신의 IaC 프리셋(Resources/Surfaces/Capabilities)도 이미 이 구조로 출하 중이다. _(ids: mece-2, entityless-3, oc-2, ex-2, ex-9)_

- **[critical] escape 봉쇄의 최종 방어선(SPEC-027 래칫)이 자기 자신·활성 전제·면제·임계값을 감시하지 않는 반사성 결함** — RATCHETED_POLICIES는 강도 knob 8종 '값'만 본다. policyRatchetPolicy 자신이 목록 밖이라 한 커밋으로 래칫+9종을 동시에 끌 수 있고, entitySchemaSources·ownershipCategories·면제목록·임계값 변경은 knob 값 불변이라 위반 0건으로 통과한다. 게다가 게이트가 working-tree config로 자기 활성을 판정하고 base 미해석 시 무조건 skip, advisory 기본이라 한 번 병합된 하향이 다음 기준선이 된다. 면제는 사유·상한·흔적이 없어(specSyncExemptGlobs·policyRatchetExceptions·entitySchemaExemptEntities) hard 아래서도 임의 규모 우회가 가능 — 실측 40건 일괄 면제가 킷 자신에 기록됨. _(ids: ex-1, ex-2, ex-3, ex-5, ex-7, ex-8, entityless-4)_

- **[critical] 귀속 강제가 capability 축에만 존재 — Surface·FR 산문·참조 entity 경로로 '기능 묶임'이 무검출(owner 원 제기의 핵심)** — SPEC-024는 own[CAP_CAT]만 순회하고 Surfaces·FR 본문·Dependencies 참조는 대조하지 않는다. 스펙이 entity 최소 1개를 소유해야 한다는 불변식이 어디에도 없어 Surface-only 번들 스펙이 진공 통과하고, entity 1개가 무관 라우트·웹훅의 면허가 되며, 참조 entity를 FR 굵은 앵커의 주어로 써서 남의 도메인 기능을 흡수해도 SPEC-023·024가 전부 통과한다. 참조 entity는 dedup 제외+의미 미판정이라 같은 실체의 N중 모순 재해석도 침묵. _(ids: entityless-1, entityless-5, gran-1, gran-2, semantic-dup-4)_

- **[high] dedup 유일성이 '카테고리 내부' 한정 + 정규화 결함 — 같은 실개념의 이중 소유가 표기 편차만으로 통과** — FR-002가 유일성을 'within one ownership category'로 명시 한정해 budget.aggregate(Capability)와 job:budget-aggregate(Surface)가 동시 소유돼도 무검출. 정규화는 파라미터 문법만 통합하고 이름은 보존(:id vs {projectId}), 인라인 # 주석을 키에 흡수(정본 예시가 그 표기 사용), 단복수·접두어 변형(order/orders/pjt_order)을 별개 키로 취급한다. 셸/Go판은 파라미터 정규화가 아예 없어 '4판 동일' 표방이 자기모순. _(ids: mece-4, semantic-dup-1, semantic-dup-2, semantic-dup-3, semantic-dup-5, semantic-dup-6)_

- **[high] 전수성 구멍 — entity·route·capability 어느 것도 아닌 정당한 소유 대상(순수 엔진/정책/값객체/교차-aggregate 리포트)의 칸이 없음** — E/S/C에서 순수 계산 라이브러리·정책·값객체·교차 리포트는 소유할 키 종류가 없다. Files만 선언하면 '블록 없음' strict exit 1이라 저자는 무관 entity에 욱여넣기·유령 entity 날조+면제·Surface 개명 중 하나를 강요받는다(owner 원 제기와 정확히 일치). 킷 자신은 Modules/Symbols/Artifacts로 이 구멍을 피하면서 소비 프로젝트 문법으로는 제공하지 않는다 — 실측 유령 40건 면제가 이 강요의 현장 증거. _(ids: mece-3, oc-5, gran-5)_

- **[high] 방법론 내부 규칙 충돌 — SPEC-024(병합 강제)와 cohesion 캡(분할 권고)이 정반대를 가리켜 흔한 aggregate가 태어나면서 위반** — SPEC-024는 entity x의 모든 verb를 한 스펙에 강제하는데 풀 CRUD=5>기본 캡 4라 준수하는 순간 cohesion이 --strict exit 1. 분할하면 SPEC-024 hard 위반(타 스펙 귀속·공동소유 dedup 충돌). 부모+자식 aggregate는 maxAggregateRootsPerSpec=1과도 3자 충돌. 유일한 규칙 내 해소가 래칫 밖 숫자 knob의 전역 상향(킷 자신 4→6→7)이라 한 스펙 위해 올리면 저장소 전역 다중-aggregate 삼킴 신호가 죽는다. _(ids: oc-3, oc-4, gran-4)_

- **[high] '예외 없음' 표방과 출고 자세의 간극 — 강도 knob 9종 중 hard 기본 0개** — capabilityOwnershipPolicy=advisory, entitySchemaBackingPolicy·frKeyAnchorPolicy=off, entityRegistry={}, cohesion=advisory 기본. 킷 CI·배포 템플릿 모두 --strict 없이 호출. 실측 사고 2건(budget-engine의 Entities 0 스펙, gsn-ai-pm wizard 유령·40건 면제)이 전부 이 약세 구간에서 발생. 점 없는 capability(budgetaggregate)로 개명하면 hard 귀속조차 회피 — '예외 없음'은 6~9개 knob 수동 승격 이후에만 근사되는 조건부 명제. _(ids: ex-4, ex-6, entityless-2, entityless-6)_

- **[low] 무검증 제4 축과 판 간 불일치 — Files 소유는 유일성 밖, 셸/Go판은 정규화 부재** — 실코드 파일은 spec-sync 강제의 근거로 실제 '소유'되지만 Files는 카테고리 편입 금지+dedup 명시 제외라 두 스펙이 같은 파일을 소유하거나 글롭 확장으로 침탈해도 신호 0건. 킷 자신처럼 Files가 유일한 실파일 매핑인 저장소에선 '전역 중복 없음' 주장이 실코드를 제외한 주장이 된다. _(ids: mece-7, semantic-dup-6)_

- **[high] [owner 계층-깊이 모델 판정] 현 capability 문법(점 1개)과 근본 비호환 + 다부모 DAG 표현 불가로 예외를 못 없앰** — user.student.verb는 점 2개로 하드 형식 위반이고, 귀속은 첫 점까지만 절단해 하위 entity를 오귀속하며, 스키마 백킹은 리터럴 대조라 유령 판정 — 세 코어(SPEC-001/024/026)를 전부 재작성해야 성립. 게다가 단일 점경로 트리는 다부모(student가 user이자 school 소속)를 표현 못 해 나머지 부모를 다시 relation으로 빼야 하므로 relation+깊이 이중 체계가 되어 예외가 오히려 늘고, 'FR 주어로 강제'는 앵커 게이트에 주어/문법 개념이 없어 기계 검증 불가. _(ids: gran-6, gran-7)_

## 권고 (강제 방향)

- **[large] 게이트 활성을 카테고리 '이름 정규식'에서 config가 선언하는 '의미 역할(role)'로 이전하고, 필수 역할 부재를 로드 시점 exit 1로 차단**
  - 형태: ownershipCategories를 {name, role} 스키마로 바꿔 role∈{aggregate, surface, capability, engine, event}를 명시. capabilityCheckActive/schemaBackingActive를 /entit/i·/capabilit/i 정규식 대신 role==='aggregate'·role==='capability' 존재로 판정. grammar 게이트에 '필수 역할(aggregate+capability) 누락 시 exit 1'을 추가하고, normalizeKey의 'Surfaces'/'Capabilities' 리터럴 하드코딩을 role 기반 디스패치로 교체 — 개명해도 정규화가 살아 있게. 비활성 시 반드시 stderr에 '검사 비활성화' 신호 출력.
  - 해소: mece-2, entityless-3, oc-2, ex-2, ex-9

- **[large] SPEC-027 래칫이 자기 자신·활성 전제조건·면제 목록·임계값을 감시하고, base 상대가 아닌 '역대 최고 강도' 대비 단조성을 강제**
  - 형태: RATCHETED_POLICIES에 policyRatchetPolicy(자기 보호)·ownershipCategories(role 축소 감지)·entitySchemaSources(빈 배열/축소)·specSyncExemptGlobs·entitySchemaExemptEntities·policyRatchetExceptions·maxKeysPerCategoryPerSpec·maxAggregateRootsPerSpec를 추가. 게이트를 working-tree가 아닌 HEAD 시점 config로 자기 활성 판정(spec-sync FR-011과 동형)하고, base 미해석 시 skip 대신 exit 1(fetch-depth 강제). 강도 기억을 origin/main이 아닌 저장소 최고 강도 스냅샷으로 저장해 병합된 하향이 새 기준선이 되는 것을 차단. CI에 check-policy-ratchet 스텝을 명시 배선.
  - 해소: ex-1, ex-2, ex-8, entityless-4, oc-3, oc-4

- **[large] Surfaces에 실재(spec→코드 전방) + 귀속(소유 entity 대조) 게이트를 신설하고, 모든 스펙에 'entity 최소 1개 소유' 하한 불변식을 강제**
  - 형태: check-orphan-surfaces를 스펙→실재 전방 검사로 확장(surfaceGlobs 필수화, 부분일치 includes() 폐기·정확 매치). Surface 키는 소유 entity(또는 Dependencies 참조 entity)에 앵커되도록 요구하고, FR 굵은 앵커의 주어가 '참조'가 아닌 '소유' 키여야 함을 SPEC-023에 추가. cohesion에 maxAggregateRootsPerSpec 하한(≥1) 불변식을 넣어 Surface-only·entity 0 번들 스펙을 exit 1. capability 축뿐 아니라 Surface·Event 축에도 SPEC-024형 entity 귀속을 적용.
  - 해소: oc-1, mece-1, mece-5, entityless-1, entityless-5, semantic-dup-4, gran-1

- **[medium] 모든 면제를 단일 규격으로 강제 — 사유 필수·개수/폭 상한·영속 흔적·임계 초과 시 fail(킷이 이미 아는 prefixClassExemptions 패턴을 전면 적용)**
  - 형태: specSyncExemptGlobs·policyRatchetExceptions를 bare 배열에서 {key, reason} 구조로 승격(prefix-class-lib.mjs:52-59와 동형: 빈 사유 에러·실재 검증). entitySchemaExemptEntities에 개수 상한과 glob 폭 제한을 두고, 면제 총량이 임계 초과 시 FR-005를 console.log 부채가 아닌 exit 1로 승격. 하향 커밋 자신이 예외를 선언하면 즉시 유효해지는 것을 막도록 예외는 이전 커밋에 선언돼 있어야 유효(HEAD-config 판정).
  - 해소: ex-3, ex-5, ex-7

- **[large] 카테고리 간 개념 동일성 브리지 + 정규화 완전화로 표기 편차·이중 소유를 dedup이 잡도록 강제**
  - 형태: FR-002 유일성을 'within one category'에서 '정규화 정본 키의 저장소 전역'으로 확장하고, budget.aggregate↔job:budget-aggregate를 같은 정본으로 접는 정규화 브리지 도입(Events 카테고리 신설로 애초에 표기를 하나로 고정하면 상당 부분 해소). normalizeKey에서 파라미터 이름을 위치 토큰({p1})으로 표준화(이름 편차 제거), parseSection에 stripInlineComment 적용(공유 경로까지 — docs/design 결정 번복), 등록된 동의어 verb를 정본 verb로 collapse. 셸/Go판에 동일 정규화를 이식하거나 미구현 판은 ownership dedup을 refuse.
  - 해소: mece-4, semantic-dup-1, semantic-dup-2, semantic-dup-3, semantic-dup-5, semantic-dup-6

- **[medium] 강도 knob 기본값을 hard로 뒤집고 check-ownership 기본 --strict·CI strict 배선 — advisory는 경유지, hard가 종착지**
  - 형태: DEFAULTS에서 capabilityOwnershipPolicy·entitySchemaBackingPolicy·frKeyAnchorPolicy·policyRatchetPolicy를 hard로, check-ownership 기본을 strict로 설정. 신규 채택 프로젝트는 래칫으로 승인된 다운그레이드 예외로만 일시 완화하고(사유+흔적), 그 예외 자체가 래칫 감시 대상. 점 없는 capability(budgetaggregate) 형식 위반을 --strict 여부와 무관하게 hard 귀속과 동급 exit 1로 승격해 표기 회피(entityless-2)를 차단.
  - 해소: ex-4, ex-6, entityless-2, entityless-6, oc-5

- **[medium] SPEC-024 병합 강제와 cohesion 분할 캡의 모순 해소 — capability 개수 캡을 '소유 entity당'으로 재정의해 풀 CRUD가 규칙 준수만으로 위반이 되지 않게**
  - 형태: cohesion의 maxKeysPerCategoryPerSpec을 Capabilities에 대해서는 '소유 entity 1개당 verb 수' 기준으로 바꿔, 한 aggregate의 create/read/update/delete/list/archive/restore가 분할 권고를 유발하지 않도록. 부모+자식 aggregate는 maxAggregateRootsPerSpec을 전역 상향하는 대신 'Dependencies 관계로 묶인 aggregate 클러스터'를 1스펙으로 허용하는 명시 규칙(SPEC-017 연동)으로 처리해 전역 신호 약화를 방지. 숫자 캡은 래칫 대상에 포함(위 권고2).
  - 해소: oc-3, oc-4, gran-4

- **[large] 새 카테고리 Engines·Events를 백킹 강제형으로 도입해 전수성 구멍을 메우되, 각각 코드-모듈/이벤트-카탈로그 SSOT 실재 대조를 필수 동반**
  - 형태: role='engine'(enginesSources 글롭 실재 대조, capability 소유 불가)와 role='event'(발신 entity 귀속 강제 + 이벤트 카탈로그 실재)를 코어에 추가. job:/event:를 Surfaces에서 제거하고 Events로 이관해 Surface를 동기 http 표면으로 엄격화. Files 축에도 겹침 검출(두 스펙이 동일 글롭/파일 소유 시 exit 1)과 SSOT 판정을 추가해 실코드 축의 '하나의 키=한 스펙' 보장을 복원. 새 카테고리가 무검증 자유문자열 칸이 되지 않도록 validateKey에 형식+실재 대조를 반드시 배선.
  - 해소: mece-3, oc-5, mece-1, semantic-dup-5, mece-7

- **[medium] [계층 깊이 모델] 기각 — entity 계층을 점 깊이(user.student)로 인코딩하는 대안은 채택하지 않고, 대신 위 게이트 강화로 relation 재량 문제를 직접 봉합**
  - 형태: 깊이 모델은 capability 점 1개 문법·첫 점 귀속·스키마 리터럴 백킹과 근본 비호환(세 코어 재작성 필요)이고 다부모 DAG를 표현 못 해 relation+깊이 이중 체계로 예외를 오히려 늘리므로 기각. relation의 '참조 개수·관련성 무제한' 재량 문제(gran-1·2)는 (a) FR 굵은 앵커 주어를 '소유' 키로 제한, (b) 참조 entity를 dedup·relation-type 교차 일관성 검사 대상에 포함, (c) 'owned vs referenced' 귀속을 entityRegistry로 저장소 전역 강제하는 게이트로 닫는다 — 깊이 표기가 아니라 귀속 강제 축의 확장으로.
  - 해소: gran-6, gran-7, gran-1, gran-2, gran-3

## 검증 통과 발견 41건 (차원·severity·claim)

- `mece-1` [critical/confirmed] (mece) job:/event: Surface 탈출구 — entity 없는 엔진 스펙이 Surfaces 칸으로 부활해 SPEC-024·026 hard를 동시 우회
  - claim: 배치 job·이벤트가 Capability와 Surface 두 카테고리에 모두 해석 가능한데 귀속(SPEC-024)·스키마 백킹(SPEC-026) 게이트는 Capabilities/Entities 키만 검사하므로, 금지된 '기술 계층 스펙'(entity 0 + 능력 소유)을 능력만 job: 표면으로 개명해 합법화할 수 있다.
  - 근거: tooling/ownership-keys.mjs:62 (validateKey가 `event:/job:` 형식을 Surface로 승인), tooling/check-ownership.mjs:115-122 (capability 귀속·스키마 백킹이 own[CAP_CAT]·own[ENT_CAT]만 순회 — Surfaces 무검사), DEDUP.md:39 ("이벤트=event:<name>, job=job:<name>" 공식 문법), SPEC-024 Input(budget-engine: Entities 0+capability 4가 '생성되면 안 되는 스펙')
  - 반례: 실측 재현(스크래치 픽스처, capabilityOwnershipPolicy=hard·entitySchemaBackingPolicy=hard·--strict): SPEC-002가 `Entities: —, Surfaces: job:budget-aggregate, job:report-generate, job:pjt-recompute` 소유 → exit 0 "구조적 중복 없음". 같은 능력을 `budget.aggregate`(Capability)로 쓰면 hard exit 1이 나는 바로 그 스펙이 표기만 바꿔 통과 — budget-engine 실패 모드의 완전 부활.

- `mece-2` [critical/confirmed] (mece) 카테고리 경계가 이름 정규식(/entit/i)에 달려 있음 — Entities를 Aggregates로 개명하면 hard 게이트 2종이 흔적 없이 전멸
  - claim: SPEC-024·026의 활성 판정이 카테고리의 의미가 아니라 config 문자열 이름의 부분매치(/entit/i, /capabilit/i)라서, 동일 의미의 카테고리를 다른 이름(Aggregates/Roots/도메인객체)으로 선언한 프로젝트는 '예외 없음' 규칙 2종이 정책값 hard 그대로인 채 조용히 비활성화된다 — ownershipCategories 어휘를 검증하는 게이트는 Files 금지(SPEC-013 FR-005)뿐이고 SPEC-027 래칫도 카테고리명 변경은 감시하지 않는다.
  - 근거: tooling/capability-ownership-lib.mjs:14-17 (capabilityCheckActive = /entit/i && /capabilit/i 이름 매치), tooling/schema-backing-lib.mjs:15-19 (schemaBackingActive 동일), tooling/check-ownership.mjs:46,49,55,65 (ENT_CAT=/entit/i 매치 || CATEGORIES[0] 폴백), tooling/grammar-lib.mjs의 ownershipCategoriesFindings는 Files만 금지
  - 반례: 실측 재현: ownershipCategories를 ["Aggregates","Surfaces","Capabilities"]로, 두 정책 hard + 스키마 소스 선언 + --strict 상태에서 스펙이 `Aggregates: wizard`(유령) + `Capabilities: pjt_projects.compute, budget.aggregate`(남의 entity) 소유 → exit 0. gsn-ai-pm 우회 사건과 budget-engine 위반의 합집합이 config 한 줄(카테고리 개명)로 무검출 통과.

- `mece-3` [high/confirmed] (mece) 전수성 구멍 — entity·route·capability 어느 것도 아닌 정당한 소유 대상(순수 엔진/라이브러리/정책/설정)의 칸이 소비 프로젝트에 없음
  - claim: E/S/C 카테고리에서 순수 계산 라이브러리·정책/설정·값 객체는 소유할 키 종류 자체가 없다 — Files만 선언한 Ownership 블록은 '블록 없음'으로 집계돼 strict exit 1이므로, 저자는 (a) 무관한 entity 스펙에 욱여넣기(owner의 원 제기 "entity가 없어도 같은 스펙에 묶임"), (b) 유령 entity 날조+면제, (c) job: Surface 개명(mece-1) 중 하나를 강요당한다. 킷 자신은 Modules/Symbols/Artifacts로 이 구멍을 피하지만 그 처방을 소비 프로젝트 문법으로 제공하지 않는다.
  - 근거: tooling/check-ownership.mjs:97-100 (hasAny가 CATEGORIES만 검사 — Files 제외), 287-291 (--strict 시 미선언 exit 1); 실측 부채: tooling/check-ownership.mjs:256-258 주석·SPEC-026 Edge Case(sdd/specs/SPEC-026-entity-schema-backing.md:20) "소비 프로젝트가 유령 40건(wizard·project_list·theme·vpc 등)을 일괄 면제하고 hard 승격 → 거짓 완료"
  - 반례: 실측 재현: E/S/C config에서 스펙이 `Entities: — / Surfaces: — / Capabilities: — / Files: src/lib/pricing/**`(순수 가격계산 라이브러리) → "⚠ Ownership 블록 없음", --strict exit 1. 통과하려면 유령 entity(SPEC-026이 차단)나 job: 표면(무검증)을 지어내야 함 — 40건 일괄 면제는 이 구멍의 현장 증거.

- `mece-4` [high/confirmed] (mece) dedup 유일성이 카테고리 내부 한정 — 같은 실개념을 두 스펙이 다른 카테고리 키로 이중 소유해도 무검출
  - claim: SPEC-002 FR-002는 'within one ownership category'만 유일성을 강제하므로, job/이벤트처럼 두 카테고리에 걸치는 개념(mece-1)은 스펙 A가 Capability로, 스펙 B가 Surface로 각각 소유해도 구조적 중복이 검출되지 않는다 — '하나의 키는 정확히 한 spec'(DEDUP.md §3) 보장이 카테고리 배정 재량 앞에서 무력화된다.
  - 근거: sdd/specs/SPEC-002-spec-quality-gates.md:33 (FR-002 "within one ownership category"), tooling/check-ownership.mjs:132-137 (conflicts 집계가 카테고리별 Map 내부만), DEDUP.md:20 ("하나의 키는 정확히 한 spec만 소유")
  - 반례: 실측 재현(fix1): SPEC-001이 `Capabilities: budget.aggregate`, SPEC-002가 `Surfaces: job:budget-aggregate` — 동일한 '예산 집계' 행위를 두 스펙이 소유한 채 hard+--strict exit 0 "구조적 중복 없음". 라우팅 결정트리('그 키를 이미 소유한 spec이 있나')가 카테고리 배정에 따라 다른 답을 내는 구조.

- `mece-5` [high/confirmed] (mece) Surfaces가 공인된 무검증 수납칸 — SPEC-026의 해소 경로 'Surface 강등'이 유령을 실재 검증 없는 카테고리로 라우팅
  - claim: Entities는 스키마 백킹, Capabilities는 귀속으로 실재가 강제되지만 Surfaces는 형식검증뿐이고(그마저 surfaceFormat any는 무검증, path는 아무 단어나 통과) 실재 대조 게이트(orphan-surfaces)는 역방향(코드→스펙) 전용에 기본 비활성 — 그런데 유령 entity의 공식 해소 지시가 바로 'Surface로 강등'이라 과분류가 차단이 아니라 칸 이동으로 끝난다.
  - 근거: tooling/ownership-keys.mjs:54-60 (any=null 무검증, path는 `^[\w.\-/\[\]@*]+$`로 단어 하나도 통과), tooling/check-ownership.mjs:253·260 ("UI/흐름 개념이면 Surface로 강등" 지시), tooling/check-orphan-surfaces.mjs:15 (surfaceGlobs 기본 [] = no-op, 스펙→실재 방향 검사 부재), tooling/sdd-config.mjs:44
  - 반례: 실측 재현: surfaceFormat:"any" + 두 정책 hard + --strict에서 스펙이 `Surfaces: wizard, project_list, pricing policy, theme, vpc`(gsn-ai-pm 유령 목록 그대로, 공백 포함 자유문자열) 소유 → exit 0. 40건 면제 부채를 지시대로 'Surface 강등'하면 부채 표면화(SPEC-026 FR-005)마저 사라져 완전한 무신호 상태가 된다.

- `mece-6` [medium/confirmed] (mece) Entity 문법(무제약·스키마 식별자 그대로)과 Capability 문법(점 1개·첫 점 귀속)의 충돌 — 점 포함 정당 entity는 능력을 가질 수 없음
  - claim: validateKey는 Entity에 형식 제약이 없고 DEDUP.md는 '스키마 식별자 그대로'를 명하지만, Capability는 점 정확히 1개를 요구하고 귀속 판정은 첫 점 앞을 entity로 자르므로, 스키마 한정 식별자(public.users)나 점 포함 테이블명을 가진 aggregate는 어떤 표기로도 capability를 선언할 수 없다 — 또한 이 케이스는 형식위반과 귀속위반이 이중 보고돼 SPEC-024 Edge Case의 '이중 보고 금지' 선언(점 없는 경우만 스킵)과 어긋난다.
  - 근거: tooling/ownership-keys.mjs:47-49 (점 1개 강제)·66 (Entity 무제약), tooling/capability-ownership-lib.mjs:28-31 (indexOf('.') 첫 점 슬라이스), DEDUP.md:38 ("스키마 식별자 그대로"), sdd/specs/SPEC-024-capability-ownership.md:18 (점 없는 경우만 스킵)
  - 반례: 실측 재현: 스키마에 `CREATE TABLE public.users`, 스펙이 `Entities: public.users` + `Capabilities: public.users.create` → "점 1개" 형식위반과 동시에 귀속 판정이 entity를 'public'으로 잘라 hard exit 1 이중 보고. `users.create`로 쓰면 소유 entity 'public.users'와 불일치로 역시 위반 — 정당한 aggregate가 Capability 카테고리에서 표현 불가.

- `mece-7` [low/confirmed] (mece) Files는 사실상 네 번째 소유 축인데 유일성 게이트 밖 — 두 스펙이 같은 실파일을 소유해도 무검출
  - claim: 실코드 파일은 방법론에서 실제로 '소유'되는 대상(spec-sync 강제의 근거)이지만 Files는 카테고리 편입이 금지되고(SPEC-013 FR-005) dedup 대상에서 명시 제외라, '하나의 키는 정확히 한 spec' 보장이 코드 파일 축에는 존재하지 않는다 — 겹치는 글롭은 검출 없이 AND 강제(모든 소유 스펙 동반 갱신)로만 드러나고, 킷 자신처럼 Files가 유일한 실파일 매핑인 저장소에서는 '저장소 전역 중복 없음' 주장이 실코드를 제외한 주장이 된다.
  - 근거: DEDUP.md:47 ("Files: 필드는 dedup 대상이 아니다"), tooling/check-spec-sync.mjs:155-176 (스펙별 글롭 매치 루프 — 중복 소유 충돌 검출 없음), tooling/check-ownership.mjs (Files 파싱 자체 없음), sdd/specs/SPEC-013-spec-grammar-hardening.md:38 (FR-005 Files 카테고리 금지)
  - 반례: 스펙 A `Files: src/lib/**`와 스펙 B `Files: src/lib/util.ts` — 어느 게이트도 겹침을 보고하지 않으며 util.ts 변경 시 두 스펙 모두 갱신 요구(어느 쪽이 SSOT인지 미정의). 반대로 A가 글롭을 넓혀 B의 파일을 삼켜도(소유권 침탈) 신호 0건 — 카테고리 키였다면 exit 1인 상황.

- `entityless-1` [critical/confirmed] (entityless-bundling) Surface-only 스펙은 hard+hard에서도 진공 통과 — entity 최소 소유 규칙이 어디에도 없음
  - claim: 방법론은 '1 spec = 1 aggregate root(실재 entity)'를 표방하지만, 스펙이 entity를 최소 1개 소유해야 한다는 검사가 없어 Entities·Capabilities를 비우고 Surfaces만 소유한 스펙은 모든 게이트를 통과한다 — SPEC-024는 소유 capability가 있어야, SPEC-026은 소유 entity가 있어야만 발화하는 내용 검사라 빈 집합에 진공 참이다.
  - 근거: tooling/check-ownership.mjs:115-122(캡 귀속은 own[CAP_CAT] 순회, 스키마 백킹 수집은 `own[ENT_CAT].length` 조건 — 둘 다 비면 무발화), tooling/schema-backing-lib.mjs:54-66(소유 entity만 순회), tooling/check-spec-cohesion.mjs:56-64(maxAggregateRootsPerSpec은 상한 `> MAX_AGG`만 — 하한 0 허용), sdd-config.mjs:51-53. Surface 귀속 규칙 부재는 sdd/specs 전체 grep으로 확인(SPEC-024는 Capabilities 전용). SPEC-026-entity-schema-backing.md:20,22의 처방 '(b) UI/흐름 개념이면 Surface로 강등'이 위반을 정확히 이 무검사 카테고리로 라우팅.
  - 반례: 실측(fixture fx1): capabilityOwnershipPolicy=hard + entitySchemaBackingPolicy=hard + entitySchemaSources 유효 선언 상태에서, 스펙 하나가 `Entities: —, Capabilities: —, Surfaces: GET /auth/login, POST /billing/invoice, GET /reports/export, POST /notifications/send`(무관 기능 4개 번들)를 소유 → check-ownership exit 0 + '✓ 구조적 중복 없음', check-spec-cohesion --strict도 exit 0(4개 = 기본 상한 이내). owner가 지적한 'entity 없이 같은 스펙에 묶이는 경우' 그 자체가 어떤 knob 조합으로도 잡히지 않는다.

- `entityless-2` [high/confirmed] (entityless-bundling) 점 없는 capability는 hard 귀속 판정을 스킵 — budget-engine 사례가 점 하나 빼면 부활
  - claim: capabilityOwnershipFindings는 점 없는 capability를 '형식 위반은 validateKey 담당'이라며 건너뛰지만(이중 보고 금지), validateKey의 형식 위반은 non-strict에서 warn일 뿐이고 킷 자신의 CI와 배포 템플릿 모두 check-ownership을 non-strict로 돌린다 — 두 검사의 강도 비대칭으로 hard 귀속 게이트가 점 없는 표기 앞에서 무력화된다.
  - 근거: tooling/capability-ownership-lib.mjs:28-29(`if (dot <= 0) continue`), tooling/ownership-keys.mjs:47-50(형식 위반 보고), tooling/check-ownership.mjs:181-184(formatIssues는 non-strict에서 ⚠)·287-291(--strict에서만 exit 1), .github/workflows/sdd-gates.yml:27(non-strict 실행), tooling/sdd-gates.yml:59-63(strict는 주석 처리된 '승격 예정'), SPEC-024-capability-ownership.md:18(스킵을 Edge Case로 공인).
  - 반례: 실측(fixture fx2): capabilityOwnershipPolicy=hard, 스펙이 `Entities: —, Capabilities: sendmail, rendertemplate` 소유 → 출력은 '⚠ Capability는 entity.verb 형식…' 경고 2건뿐, exit 0. SPEC-024가 죽이려고 태어난 'Entities 0개 + capability 소유 엔진 스펙'(budget-engine)이 verb에서 점만 제거하면 hard에서도 태어난다. 귀속 위반 지적을 받은 작성자가 `budget.aggregate`→`budgetaggregate`로 개명하는 한 줄 회피가 가능.

- `entityless-3` [high/confirmed] (entityless-bundling) ownershipCategories에서 entity류 카테고리 제거/개명 시 SPEC-024·026 동시 침묵 — 스펙이 공인한 우회로, 래칫 미감시
  - claim: capabilityCheckActive와 schemaBackingActive는 프로젝트 config의 카테고리명에 /entit/i·/capabilit/i 정규식 매치를 요구하므로, 소비 프로젝트가 Entities 카테고리를 빼거나 'Aggregates' 등으로 개명하면 두 게이트가 policy=hard인 채로 통째로 비활성화된다 — 이 침묵은 SPEC-024 FR-001·SPEC-026 FR-001이 명시적으로 요구하는 동작이라 게이트 버그도 아니고, 카테고리 검증은 'Files' 금지 하나뿐이며 SPEC-027 래칫도 ownershipCategories를 감시하지 않는다.
  - 근거: tooling/capability-ownership-lib.mjs:14-17, tooling/schema-backing-lib.mjs:15-19, tooling/grammar-lib.mjs:46-50(ownershipCategoriesFindings — 'files'만 금지), tooling/policy-ratchet-lib.mjs:12-21(RATCHETED_POLICIES에 ownershipCategories 없음), SPEC-024-capability-ownership.md:29(FR-001 '…categories lack an entity-like … category, THE SYSTEM SHALL perform no capability-ownership evaluation'), SPEC-026-entity-schema-backing.md:30(FR-001 동형). Python 미러 sdd_gates.py:594-597·619 동일. 추가: check-ownership.mjs:46 `ENT_CAT = …find(/entit/i) || CATEGORIES[0]` 폴백이 registry·관계 판정을 임의 첫 카테고리로 조용히 재타겟.
  - 반례: 실측(fixture fx3): `ownershipCategories: ["Surfaces","Capabilities"]` + capabilityOwnershipPolicy=hard + entitySchemaBackingPolicy=hard + 스키마 소스 선언 상태에서, 스펙 하나가 서로 다른 세 entity의 capability `pjt_projects.create, budget.update, wizard.delete`를 소유 → exit 0, 경고 0건. 비-웹 프로젝트 지원용 카테고리 자유도가 웹 프로젝트의 귀속·백킹 강제를 config 한 줄로 끄는 스위치가 되고, 이 커밋은 래칫 위반도 아니다.

- `entityless-4` [high/confirmed] (entityless-bundling) 래칫은 policy 문자열 8종만 감시 — entitySchemaSources 비우기로 hard 백킹을 inert화(유령 entity 부활)
  - claim: SPEC-027 래칫은 off<advisory<hard 하향만 차단하고 게이트의 활성화 전제조건(entitySchemaSources·entityRegistry·entitySchemaExemptEntities·ownershipCategories)은 감시하지 않으므로, entitySchemaBackingPolicy=hard를 유지한 채 entitySchemaSources를 []로 만들면(또는 glob 하나를 오타내면) 백킹 게이트가 조용히 inert가 되어 gsn-ai-pm형 유령 entity(wizard)가 다시 통과한다 — '빨간불을 끄는 escape 봉쇄'가 knob 이름 목록에만 걸려 있다.
  - 근거: tooling/policy-ratchet-lib.mjs:12-21(RATCHETED_POLICIES — entitySchemaSources 부재), tooling/schema-backing-lib.mjs:16-17(`sources.length > 0` 활성 조건), tooling/check-ownership.mjs:59-65, SPEC-026-entity-schema-backing.md:30(FR-001이 sources 빈 경우의 무평가를 공인). 면제 대량 등록(실측 40건)도 FR-005 advisory 부채 표면화뿐 차단 아님(check-ownership.mjs:259-261).
  - 반례: 실측(fixture fx4): capabilityOwnershipPolicy=hard + entitySchemaBackingPolicy=hard + policyRatchetPolicy=hard + `entitySchemaSources: []`, 스펙이 스키마에 없는 `Entities: wizard` + `Capabilities: wizard.create` 소유 → exit 0, 경고 0건. SPEC-026이 잡았어야 할 실측 우회 사례(pjt_projects.create→wizard.create 개명)가 policy를 한 칸도 안 내리고 sources 삭제만으로 재현되며, 래칫 게이트는 이 커밋을 위반 0건으로 판정한다.

- `entityless-5` [medium/confirmed] (entityless-bundling) entity 1개가 무관 기능 번들의 면허가 됨 — Surface·FR에는 entity 귀속 규칙이 없음
  - claim: SPEC-024는 Capabilities에만 귀속을 강제하고 Surfaces·FR에는 대응 규칙이 없어, 실재 entity 1개를 소유한 스펙이 그 entity와 무관한 라우트·웹훅·관리 화면을 상한(기본 4키/카테고리, 킷 자신은 7로 상향)까지 자유롭게 합승시켜도 모든 게이트(--strict 포함)가 green이다 — owner의 '무관한 기능이 한 스펙에 묶임'이 entity가 있어도 성립한다.
  - 근거: tooling/check-ownership.mjs:113-119(귀속 검사는 CAP_CAT 한정 — Surfaces 무검사), sdd/specs 전체에 Surface↔entity 귀속 규칙 부재(grep 확인), tooling/check-spec-cohesion.mjs:60-63(카테고리별 개수 상한만), /home/user/ai-methodology/sdd.config.json(maxKeysPerCategoryPerSpec: 7 — 킷 스스로 상한을 완화), SPEC-024-capability-ownership.md:61('교차-aggregate 기능은 주 변경 대상 aggregate 스펙에 귀속'은 리뷰 몫 — 기계 신호 없음).
  - 반례: 실측(fixture fx5): 스펙이 `Entities: users` + `Capabilities: users.create` + `Surfaces: POST /api/users, GET /admin/feature-flags, POST /webhooks/stripe`(feature-flag 관리·Stripe 웹훅은 users aggregate와 무관) 소유 → check-ownership hard+hard exit 0, check-spec-cohesion --strict exit 0. 의미적 무관성은 Dedup-Review(사람/LLM) 몫으로 남는데, 그 리뷰는 '같은 Entity 이웃 스펙'과만 좁혀 수행되므로(check-ownership.mjs:21 주석) entity가 다르거나 없는 합승은 리뷰 대상 선정에서도 빠진다.

- `entityless-6` [medium/confirmed] (entityless-bundling) 기본값 자세가 '예외 없음' 표방과 불일치 — 귀속 advisory·백킹 off로 출고
  - claim: entityless 번들을 겨냥한 두 규칙 모두 강제가 기본이 아니다: capabilityOwnershipPolicy 기본 advisory(경고 후 exit 0), entitySchemaBackingPolicy 기본 off, frKeyAnchorPolicy 기본 off, entityRegistry 기본 {}(비활성), cohesion 기본 advisory — 신규 채택 프로젝트가 budget-engine 사례를 그대로 재현해도 최대 경고이며, 방법론이 스스로 말하는 '예외가 없어야 한다'는 5개 knob의 수동 graduation 이후에만 근사된다. 실측 소비 프로젝트 두 곳(budget-engine의 Entities 0 스펙, gsn-ai-pm의 wizard 유령 entity·40건 일괄 면제)이 전부 이 간극에서 발생했다.
  - 근거: tooling/sdd-config.mjs:156(capabilityOwnershipPolicy: "advisory")·178(entitySchemaBackingPolicy: "off")·160(frKeyAnchorPolicy: "off")·130(entityRegistry: {}), tooling/check-ownership.mjs:194-204(advisory는 exit 0), SPEC-024-…md:22(기본 advisory 공인)·SPEC-026-…md:23(기본 off 공인), SPEC-024/026 Change Log(실측 사고 2건 모두 게이트 부재/약세 구간에서 발생), SPEC-027 Input(frKeyAnchorPolicy hard→advisory 하향을 '권장'으로 제시한 실측).
  - 반례: config 없이(또는 기본값으로) 채택한 프로젝트에서 `Entities: —, Capabilities: pjt_projects.compute, budget.aggregate` 스펙(SPEC-024가 명시한 원 사례 그대로) → check-ownership은 '⚠ 위반' 출력 후 exit 0으로 통과. 여기에 `budget.aggregate`의 verb 'aggregate'는 미등록 verb 형식 warn까지 겹치지만 non-strict CI에서는 역시 통과 — 방법론이 정본 사고 사례를 기본 설정에서 차단하지 못한다.

- `ex-1` [critical/confirmed] (exemption-audit) 정책 래칫의 자멸 스위치 — policyRatchetPolicy는 래칫 대상이 아니고, 게이트가 '현재' config로 자기 활성을 판정한다
  - claim: escape 봉쇄의 최종 방어선(SPEC-027)이 자기 자신을 보호하지 않아, 한 커밋으로 래칫과 강제 knob 8종 전부를 동시에 끌 수 있다.
  - 근거: tooling/policy-ratchet-lib.mjs:12-21 — RATCHETED_POLICIES 8종에 policyRatchetPolicy 부재. tooling/check-policy-ratchet.mjs:11-21 — const policy = cfg.policyRatchetPolicy(현재 working-tree config)로 off면 base 비교 전에 exit 0. 대조: check-spec-sync.mjs:27-43은 '자기약화 커밋은 HEAD 시점 config가 심판'(SPEC-003 FR-011) 보호를 갖는데 래칫 게이트엔 이 보호가 없다.
  - 반례: base(origin/main)가 policyRatchetPolicy:hard + frKeyAnchorPolicy:hard 등 8종 hard인 상태에서, 한 커밋으로 sdd.config.json에 {"policyRatchetPolicy":"off", 나머지 8종 "off"}를 쓰면 check-policy-ratchet은 '판정 안 함' exit 0 — 하향 9건이 단 한 줄의 위반 없이 통과. STRUCTURE.md가 강제한 'sdd.config.json 스펙 소유'는 Change Log 한 줄만 요구할 뿐 차단하지 않는다.

- `ex-2` [critical/confirmed] (exemption-audit) 래칫 사각지대 — 강도 knob 8종만 감시, 활성 전제조건·면제 목록·임계값은 무감시
  - claim: knob 값을 건드리지 않고 게이트의 활성 조건을 제거하는 우회가 래칫에 전혀 잡히지 않는다 — '둘 다 있을 때만' 류 조건부 활성이 그대로 하향 통로다.
  - 근거: tooling/schema-backing-lib.mjs:15-19 — schemaBackingActive는 sources.length>0 요구(policy는 hard 유지 가능). tooling/capability-ownership-lib.mjs:14-17 — capabilityCheckActive는 카테고리명 정규식(/entit/i·/capabilit/i) 매치 요구. policy-ratchet-lib.mjs:12-21 — entitySchemaSources·ownershipCategories·strictSpecs·requireAccounting·maxKeysPerCategoryPerSpec·specSyncExemptGlobs·entitySchemaExemptEntities·policyRatchetExceptions 전부 래칫 밖. 킷 자신도 sdd.config.json:43-44에서 cohesion 임계를 4→7, 8→10으로 상향(완화)했고 이는 어떤 게이트도 심판하지 않는다.
  - 반례: entitySchemaBackingPolicy:hard를 유지한 채 entitySchemaSources:[]로 비우는 커밋 → SB_ACTIVE=false로 SPEC-026 완전 비활성, 래칫은 knob 값 불변이라 green. 또는 ownershipCategories를 ["Entities","Surfaces","Actions"]로 개명 → capabilityCheckActive=false로 SPEC-024 hard가 무음 비활성 — 유령 entity·기술계층 스펙이 경고 0으로 통과.

- `ex-3` [critical/confirmed] (exemption-audit) entitySchemaExemptEntities — 실측으로 입증된 대량 우회(유령 40건 일괄 면제 후 hard 승격 = 거짓 완료), 봉합은 경고 한 줄
  - claim: 면제 사유는 '비어 있지만 않으면' 되는 자유 문자열이고 개수 상한·질 검증이 없어, hard 정책 아래서도 임의 규모의 유령 entity를 통과시킨다 — 봉합(FR-005)은 advisory 부채 라인 출력일 뿐 통과 자체는 그대로다.
  - 근거: sdd/specs/SPEC-026-entity-schema-backing.md:20·83 — '실측 실패: 소비 프로젝트가 유령 40건(wizard·project_list·theme·vpc 등)을 일괄 면제하고 hard 승격 → 거짓 완료'. tooling/check-ownership.mjs:211-217(빈 사유만 에러)·246(면제는 schemaSet 합집합으로 무조건 통과)·259-261(FR-005 = console.log 한 줄). 같은 패턴으로 entityRegistry도 SPEC-026 Input에 기록된 대로 가짜 entity 'wizard'를 사유와 함께 등록해 통과됐다(레지스트리+귀속 동시 우회).
  - 반례: gsn-ai-pm 실측 그대로: entitySchemaExemptEntities에 {"wizard":"외부 개념","project_list":"외부 개념",…40건}을 넣고 entitySchemaBackingPolicy:hard 승격 → 게이트 exit 0 + '면제 40건(부채)' 로그 한 줄. 감사·CI 어느 쪽도 이를 실패로 만들지 않으며, 방법론이 표방한 '유령 entity 차단'은 config 한 블록으로 무효화된다.

- `ex-4` [high/confirmed] (exemption-audit) 기본 자세(default posture) — 강도 knob 9종 중 hard 기본 0개, 분류 불변식 6개 중 기본 차단 2개
  - claim: '예외 없음'을 표방하는 방법론의 out-of-the-box 구성은 Ownership 분류 강제의 대부분이 off/advisory다 — owner가 제기한 'entity 없이 같은 스펙에 묶이는' 케이스(SPEC-024)조차 기본값에서는 경고다.
  - 근거: tooling/sdd-config.mjs DEFAULTS: frKeyAnchorPolicy:"off"(:160)·entitySchemaBackingPolicy:"off"+entitySchemaSources:[](:177-178)·capabilityOwnershipPolicy:"advisory"(:156)·policyRatchetPolicy:"advisory"(:182)·specSyncUnownedPolicy:"silent"(:116)·draftBlockPolicy:"advisory"(:126)·semanticDriftPolicy:"advisory"(:151)·runTestsPolicy:"off"(:167)·migrationStatePolicy:"advisory"+schemaDriftManifest:null(:170-171)·entityRegistry:{}(:130)·relationTypes:[](:134)·surfaceGlobs:[](:44)·testInfraGlobs:[](:73)·requireAccounting:false(:87)·strictSpecs:[](:85)·smokeManifest/derivationManifest:null(:91·98). 차단이 기본인 것은 check-ownership의 dedup 충돌(exit 1)과 SPEC-017 관계 실재·entityRegistry 위반(채워진 경우)뿐.
  - 반례: 신규 프로젝트가 킷 기본 config로 채택 → SPEC-024의 실측 원인 사례(budget-engine: Entities 0개+capability 4개 스펙)가 재발해도 advisory 경고 1줄에 빌드 green. FR 앵커(SPEC-023)·스키마 백킹(SPEC-026)은 아예 판정 자체가 안 돈다 — '예외 없음'은 knob 6~9개를 수동 승격한 뒤에만 참이 되는 조건부 명제.

- `ex-5` [high/confirmed] (exemption-audit) specSyncExemptGlobs — 무사유·무상한·무흔적 면제, 킷 스스로 규범 문서 전체를 closed-world 밖에 둠
  - claim: 다른 면제 레지스트리(entityRegistry·prefixClassExemptions·entitySchemaExemptEntities)와 달리 사유 필드가 없고 glob 폭 제한도 없어, 한 항목으로 임의 규모의 파일을 spec-first 강제 밖으로 뺄 수 있으며 통과 시 영속 흔적도 남지 않는다.
  - 근거: tooling/sdd-config.mjs:54-56 — 배열만, 사유 없음('통과하되 영속 흔적 없음'). tooling/check-spec-sync.mjs:157·190 — exempt 매치는 즉시 continue. 킷 자체 sdd.config.json:102-116 — "*.md"·docs/**·prompts/**·templates/** 면제로 METHODOLOGY.md·DEDUP.md·STRUCTURE.md·SSOT.md 등 방법론의 규범 정본 전체가 spec-sync 레이더 밖(규범 문구 변경에 스펙 동반 요구 0).
  - 반례: specSyncUnownedPolicy:"error"(closed-world)를 켠 프로젝트가 노이즈를 지우려 specSyncExemptGlobs에 "src/**"를 추가 → 전체 소스가 무사유로 면제되고 어떤 게이트도(래칫 포함) 이 목록의 성장을 심판하지 않는다. 킷 실측: DEDUP.md의 dedup 규칙 문구를 바꾸는 커밋이 스펙 변경 동반 없이 통과한다 — '규칙의 SSOT'가 자기 방법론의 강제 밖.

- `ex-6` [high/confirmed] (exemption-audit) 비-strict 기본 호출 — Ownership 블록 미선언 스펙과 형식 위반 키는 경고로 전 게이트 레이더를 이탈
  - claim: dedup·레지스트리·capability 귀속·스키마 백킹 전부가 '## Ownership을 선언한 스펙'에만 작동하는데, 미선언은 기본(비-strict)에서 warn이고 킷 자체 CI도 --strict 없이 호출한다 — DEDUP.md 스스로 '미선언 1개 = 보장에 뚫린 구멍'이라 인정한 구멍이 기본값이다.
  - 근거: tooling/check-ownership.mjs:100(미선언 continue — 이후 모든 판정 스킵)·177-183(warn)·287-291(--strict에서만 exit 1). .github/workflows/sdd-gates.yml:27 — node tooling/check-ownership.mjs (--strict 없음). tooling/sdd-gates.yml(배포 샘플) — strict 라인은 주석 처리. DEDUP.md:49 — '미선언 spec은 dedup 레이더 밖… 보장은 선언된 집합만큼만 완전하다'. 추가로 capability-ownership-lib.mjs:29 — 점 없는 capability는 dot<=0으로 SPEC-024 판정 스킵, validateKey 형식 위반도 비-strict warn.
  - 반례: 새 스펙이 ## Ownership 섹션 자체를 생략하고 남의 entity 위 기능을 서술 → dedup 충돌·귀속·스키마 백킹 판정 0건, CI green(warn 1줄). 또는 '- **Capabilities**: computebudget'(점 없음) 선언 → SPEC-024 스킵 + validateKey warn → exit 0: entity 귀속을 아예 표기 회피로 우회.

- `ex-7` [medium/confirmed] (exemption-audit) policyRatchetExceptions — 사유 없는 bare 목록, 하향과 같은 커밋에 선언 가능
  - claim: 'loud override'라 표방하지만 knob 이름 문자열 배열일 뿐 사유 강제가 없고(동형이라 주장하는 entitySchemaExemptEntities·prefixClassExemptions는 빈 사유 에러), 하향 커밋 자신이 예외를 함께 선언하면 그 커밋에서 즉시 유효하다.
  - 근거: tooling/sdd-config.mjs:183-185 — policyRatchetExceptions: [](사유 필드 없음). tooling/policy-ratchet-lib.mjs:32-43 — ex.has(knob)면 violations가 아닌 allowedDowngrades로 분류(검증은 이름 매치뿐). 대조: prefix-class-lib.mjs:52-59는 존재하는 spec ID + 빈 사유 불가를 검증.
  - 반례: 한 커밋으로 frKeyAnchorPolicy:hard→off + policyRatchetExceptions:["frKeyAnchorPolicy"] → policyRatchetPolicy:hard에서도 exit 0('부채' 로그 1줄). 예외 선언의 정당성(진짜 롤백인가)을 판정하는 주체가 기계에도 리뷰 관문에도 없다 — 사유 문자열조차 안 남는다.

- `ex-8` [medium/confirmed] (exemption-audit) 래칫 기억상실 — base-ref 상대 비교라 병합된 하향이 다음 기준선이 되고, base 미해석이면 무조건 skip
  - claim: 단조성은 '역대 최고 강도 대비'가 아니라 '이번 changeset의 origin/main 대비'라, advisory 기본(경고 exit 0)이나 CI 부재로 한 번 main에 착지한 하향은 영구히 합법화된다 — 게다가 킷 자체 CI에는 래칫 스텝이 아예 없어 유일한 배선이 --no-verify로 우회 가능한 로컬 pre-push(sdd-sync R6)뿐이다.
  - 근거: tooling/check-policy-ratchet.mjs:25(BASE=origin/main)·35-38(base 조회 불가 시 '건너뜀' exit 0 — shallow clone·리모트 부재에서 무음 통과)·60-61(advisory는 위반이 있어도 exit 0). .github/workflows/sdd-gates.yml:22-35 — check-policy-ratchet 스텝 부재(주석에 '로컬 훅은 --no-verify·웹 UI 병합으로 우회 가능'이라 스스로 인정하면서 래칫만 백스톱 밖). tooling/harness/pre-push:5 + sdd-sync.mjs:31.
  - 반례: 커밋 A: frKeyAnchorPolicy hard→advisory, policyRatchetPolicy 기본(advisory) → 경고만 뜨고 병합(CI에 래칫 없음). 커밋 B부터 base(origin/main)가 이미 advisory라 위반 0 — '하향 회피 봉쇄'가 딱 한 번의 경고 무시로 영구 소멸. fetch-depth 얕은 CI라면 그 경고조차 base 미해석 skip으로 안 뜬다.

- `ex-9` [medium/confirmed] (exemption-audit) normalizeKey/validateKey가 카테고리명 'Surfaces'/'Capabilities' 리터럴에 하드코딩 — 자유형 ownershipCategories와 불정합
  - claim: ownershipCategories는 임의 문자열을 허용하는데 정규화·형식검증은 정확 문자열 비교라, 카테고리를 개명하면(합법 config) 키 정규화가 무음 소실되어 dedup이 표기 편차 중복을 놓치고 verb·형식 검증도 사라진다.
  - 근거: tooling/ownership-keys.mjs:26(category === "Surfaces")·47(category === "Capabilities")·66(그 외 카테고리는 검증 없음 null). 대조: check-ownership.mjs:46-49는 /entit/i·/capabilit/i 정규식 매치로 느슨하게 찾는다 — 같은 config를 두 코드가 다른 규칙으로 해석.
  - 반례: ownershipCategories:["Entities","Routes","Capabilities"]로 개명(문서 어디에도 금지 없음 — 금지된 것은 Files뿐, SPEC-013) → 스펙 A '- **Routes**: GET /api/x/'와 스펙 B '- **Routes**: get /api/x'는 정규화 없이 서로 다른 키로 취급되어 dedup green — '하나의 키는 정확히 한 spec'(DEDUP.md §3) 보장이 대소문자·trailing slash 표기 차이로 뚫린다.

- `ex-10` [low/confirmed] (exemption-audit) 정당 판정 escape 3종 — prefixClassExemptions·Spec-Impact 트레일러·placeholder 필터는 (a) 좁은 불변식
  - claim: 전수 열거의 균형: 모든 escape가 구멍은 아니다 — 스코프가 스펙/커밋 단위로 좁고, 사유가 강제되며, 흔적이 영속하는 3종은 정당한 예외 통로로 판정한다(이들이 킷의 올바른 면제 설계 패턴이고, ex-5·ex-7은 이 패턴에서 이탈한 것이 문제).
  - 근거: tooling/prefix-class-lib.mjs:52-59 — prefixClassExemptions는 실재 spec ID + 빈 사유 불가(스펙 1건 스코프). tooling/check-spec-sync.mjs:51-57 — Spec-Impact: none은 사유 없으면 exit 1, 커밋 메시지에 영속, 감사 T3로 면제 범위를 동반요구·상태차단으로 축소(unowned·글롭 문법은 면제 불가). ownership-keys.mjs:17 — '—'·'[…]' placeholder 필터는 빈 카테고리 표기용.
  - 반례: 반례 아님(정당 판정 근거): prefixClassExemptions로 대량 우회하려면 스펙 ID를 하나씩 사유와 함께 등록해야 하고 존재하지 않는 ID는 에러 — glob 한 줄로 전체를 빼는 specSyncExemptGlobs(ex-5)·이름만 나열하는 policyRatchetExceptions(ex-7)와의 대비가, '사유 강제+좁은 스코프+영속 흔적'이라는 교정 방향 자체를 킷이 이미 알고 있으면서 일관 적용하지 않았음을 보여준다.

- `oc-1` [critical/confirmed] (over-classification) Surface 강등 = 무검증 종착지: 유령 개념·타-entity 능력이 Surfaces로 재분류되면 all-hard에서도 통과
  - claim: SPEC-026이 유령 entity의 공식 해소책으로 처방하는 'Surface 강등'(check-ownership.mjs:253, SPEC-026 Edge Case)의 종착지인 Surfaces 카테고리에는 백킹(SSOT 실재)·귀속(entity 소유) 검사가 전무해, 과분류가 차단되는 게 아니라 검증 사각 칸으로 이송될 뿐이다. capability 의미를 `job:`/`event:` Surface로 표기하면 SPEC-024 hard도 우회된다.
  - 근거: ownership-keys.mjs:62 (`/^(event|job):/` 형식이면 무조건 valid, surfaceFormat "any"면 line 55에서 전면 무검증); capability-ownership-lib.mjs:14-17·23-33 (판정 대상은 Capabilities 카테고리 키뿐); schema-backing-lib.mjs:15-19 (백킹은 Entities류만); check-orphan-surfaces.mjs:5·15 (역방향 전용 — surfaceGlobs 비면 no-op, 선언 Surface 키의 실재는 어떤 게이트도 검사 안 함; line 46의 includes() 부분일치로 유령 Surface가 무관 파일에 의해 '실재'로 읽히기까지 함); check-ownership.mjs:253·prompts/update.md:34 ('UI/흐름 개념이면 Surface로 강등' 공식 처방)
  - 반례: SPEC-024 실측 위반 사례(budget-engine: Entities 0 + `budget.aggregate`·`pjt_projects.compute` 소유)를 capabilityOwnershipPolicy=hard·entitySchemaBackingPolicy=hard 아래에서 그대로 부활시킬 수 있다: Capabilities를 비우고 `- **Surfaces**: job:budget-aggregate, job:project-compute, event:budget-updated`로 재키. validateKey 통과(job:/event: 허용), SPEC-024 비발동(capability 키 0개), SPEC-026 비발동(entity 키 0개), dedup 통과(키 유일), cohesion 통과(키≤4). gsn-ai-pm의 wizard·project_list·dashboard·detail 40건도 Entities에서 Surfaces로 옮기면 면제 부채 advisory(FR-005)조차 사라진 '깨끗한' green이 된다 — 방법론이 스스로 권하는 경로가 곧 우회로다.

- `oc-2` [high/confirmed] (over-classification) ownershipCategories 개명 한 줄로 SPEC-024·026이 무음 비활성 — 카테고리명 정규식 활성 판정 + 비래칫 knob
  - claim: capability 귀속·스키마 백킹의 활성 조건이 카테고리 '이름'의 정규식 매치(/entit/i·/capabilit/i)에 걸려 있는데, ownershipCategories는 자유 문자열 config이고(금지 검사는 'Files' 단 하나) 정책 래칫(SPEC-027)의 감시 대상도 아니라서, 정책 knob을 hard로 유지한 채 카테고리 개명만으로 두 게이트를 조용히 꺼서 entity 없는 스펙·유령 entity를 무제한 허용할 수 있다.
  - 근거: capability-ownership-lib.mjs:14-17 (`/entit/i && /capabilit/i`); schema-backing-lib.mjs:15-19 (`/entit/i`); grammar-lib.mjs:46-50 (ownershipCategories 검증은 'Files' 금지뿐); policy-ratchet-lib.mjs:12-21 (RATCHETED_POLICIES 8종에 ownershipCategories 없음 — capabilityOwnershipPolicy 값 자체는 hard 그대로라 하향 위반도 안 뜸); check-ownership.mjs:46·55·65 (ENT_CAT/CAP_ACTIVE/SB_ACTIVE 산출)
  - 반례: capabilityOwnershipPolicy=hard·entitySchemaBackingPolicy=hard로 위반 N건이 뜬 소비 프로젝트가 sdd.config.json의 ownershipCategories를 ["Entities","Surfaces","Capabilities"]→["Aggregates","Surfaces","Actions"]로 바꾸고 스펙의 라인 라벨만 일괄 치환하면: dedup·cohesion은 그대로 도는데 capabilityCheckActive=false·schemaBackingActive=false로 두 판정이 무음 소멸, 래칫 위반 0건, 어떤 게이트도 '검사가 비활성화됨'을 알리지 않는다. budget-engine류 기술 계층 스펙이 `Actions: budget.aggregate`로 합법 부활한다.

- `oc-3` [high/confirmed] (over-classification) SPEC-024(병합 강제)와 cohesion 캡(분할 권고)의 기본값 모순 — 풀 CRUD entity는 태어나면서 위반
  - claim: SPEC-024는 entity x의 모든 capability를 x 소유 스펙 한 곳에 강제(dedup이 co-ownership 차단)하는데, 기본 CRUD verb는 5종이고 maxKeysPerCategoryPerSpec 기본은 4라서 풀 CRUD aggregate 하나가 규칙을 다 지키는 순간 cohesion이 '분할 권고'를 내고 --strict에서 exit 1이 된다 — 두 게이트가 정반대 방향을 가리키고, 규칙 내 해소 경로(분할)는 SPEC-024 hard가 금지한다. 유일한 탈출구는 래칫이 감시하지 않는 숫자 knob의 전역 상향이며, 킷 자신이 이 경로로 4→6→7을 올린 실측이 있다.
  - 근거: sdd-config.mjs:49 (maxKeysPerCategoryPerSpec: 4)·:255 (CRUD 5종: create/read/update/delete/list); check-spec-cohesion.mjs:61-63 (카테고리별 키>MAX_KEYS 위반, :79-82 --strict exit 1); capability-ownership-lib.mjs:23-33 + check-ownership.mjs:132-137 (이관 불가 — 타 스펙 소유는 귀속 위반, entity 공동 소유는 dedup conflict); policy-ratchet-lib.mjs:12-21 (숫자 캡 3종 모두 비래칫); SPEC-002 Change Log 2026-07-02 행('maxKeysPerCategoryPerSpec 4→6 상향... cohesion warn 해소') + sdd.config.json:43 (현재 7)
  - 반례: 소비 프로젝트에서 entity `pjt_projects`가 create/read/update/delete/list 5개 capability를 가지면(가장 평범한 aggregate): SPEC-024 hard는 5개 전부를 pjt_projects 소유 스펙 한 장에 요구 → 그 스펙은 Capabilities 5 > 4로 cohesion 위반 → --strict CI에서 exit 1. '분할 검토' 권고를 따르면 SPEC-024 hard exit 1, 따르지 않으면 cohesion exit 1. 실무 해소는 항상 config 캡 상향이고 래칫·표면화가 없어, gsn-ai-pm처럼 wizard-스펙 4장의 capability를 재키·병합하는 마이그레이션(update.md:41-48) 직후 owning 스펙이 캡을 초과하면 캡을 올리는 것으로 끝난다 — cohesion 게이트는 물릴 때마다 무력화되는 장식이 된다.

- `oc-4` [high/confirmed] (over-classification) 자식 테이블 capability의 소유 강제(SPEC-024) vs maxAggregateRootsPerSpec=1·SPEC-017 '자식은 root 아님'의 3자 모순
  - claim: SPEC-024는 `child.verb`를 선언하려면 entity `child`를 Entities에 소유하라고 강제하지만, cohesion은 Entities 키 2개째부터 '여러 aggregate 삼킴'으로 위반 처리(기본 1)하고, SPEC-017/STRUCTURE는 자식 테이블을 별도 root로 승격(분할)하는 것도 원칙 위반으로 규정한다 — 부모+자식 aggregate라는 가장 흔한 모델이 세 규칙을 동시에 만족할 수 없고, 공식 해소책(캡 상향)은 스펙별이 아닌 전역이라 한 스펙을 위해 올리면 저장소 전체의 다중-aggregate 삼킴 신호가 죽는다.
  - 근거: capability-ownership-lib.mjs:23-33 (entity 조각이 '소유' 집합에 없으면 위반 — Dependencies 참조로는 해소 불가, SPEC-024 Edge Case line 20 명시); check-spec-cohesion.mjs:56-59 (own[ENT_CAT].length > MAX_AGG 위반, 기본 1) + sdd-config.mjs:51-53 (전역 knob); SPEC-002:22 Edge Case·:87 Change Log ('SPEC-004=project+9 자식표... 이 값을 상향' — 전역 상향이 공식 처방); SPEC-017:4 ('1 spec = 1 aggregate' 원칙, 자식 분할 시 관계 문법 필요); policy-ratchet-lib.mjs:12-21 (maxAggregateRootsPerSpec 비래칫)
  - 반례: 스펙 A가 `pjt_projects`(root)와 자식 `pjt_project_staff`를 갖고 capability `pjt_project_staff.assign`이 필요한 경우: (i) 자식을 소유 안 하면 SPEC-024 hard exit 1, (ii) Entities에 둘 다 선언하면 cohesion aggregate 위반(2>1, --strict exit 1), (iii) 자식을 별도 스펙으로 쪼개면 자식 테이블이 aggregate root로 과분류(SPEC-017 원칙 위반이지만 게이트는 이 방향을 못 잡음 — 오히려 통과), (iv) maxAggregateRootsPerSpec을 10으로 올리면(SPEC-002 실측: project+9 자식표) 그 순간부터 저장소의 모든 스펙이 root 10개까지 무경고 삼킬 수 있다. 네 경로 전부가 위반이거나 게이트 약화다.

- `oc-5` [medium/confirmed] (over-classification) 교차-aggregate 읽기 기능(리포트·검색·대시보드)의 억지 귀속 — '예외 없음' 선언이 임의 분류나 대량 면제로 귀결
  - claim: SPEC-024는 여러 테이블을 읽기만 하는 기능도 '주 변경/산출 대상 aggregate' 스펙에 귀속하라며 '별도 예외 없음'을 선언하지만, 아무 aggregate도 변경하지 않는 산출물(대시보드·집계 리포트)에는 그 기준이 미정의라서 소비자는 (a) 임의 entity에 억지 귀속(`pjt_projects.report` — verb 미등록이면 capabilityVerbs 확장으로 어휘까지 오염), (b) 유령 entity 창설 후 entitySchemaExemptEntities 면제, (c) Surface-only 스펙(oc-1)의 셋 중 하나를 강요받고, 실측에서 (b)가 40건 일괄 면제로 폭발했다.
  - 근거: SPEC-024:61 (Assumptions: '교차-aggregate 기능은 주 변경/산출 대상 aggregate의 스펙에 귀속... 별도 예외 없음' — 읽기 전용엔 '변경 대상'이 없어 기준 공백); check-ownership.mjs:256-260 주석 ('실측: 소비 프로젝트가 40건을 일괄 면제하고 hard 승격'); prompts/update.md:45 ('실측 오류: update 11회차가 40건 일괄 면제 후 완료 선언; 12회차는 현행 유지를 1번 선택지로'); ownership-keys.mjs:49-51 (capability는 entity.verb 점 1개 강제 — 교차 개념을 담을 문법 자체가 없음)
  - 반례: finops류 프로젝트의 '월간 비용 리포트'(cost_items·budgets·projects 3개 테이블을 읽어 파일 산출, 어떤 테이블도 변경 안 함): capability를 `cost_items.report`로 키면 cost_items 스펙에 리포트 FR이 억지 동거(과분류 — 리포트 로직 변경 시마다 cost_items 스펙 개정), `report.generate`로 키면 SPEC-026 hard에서 유령 entity로 차단되어 entitySchemaExemptEntities["report"] 면제 등록으로 흐른다 — gsn-ai-pm의 wizard·dashboard 40건 면제가 정확히 이 강요된 선택의 실측 결과이며, 방법론의 답('주 산출 대상')은 결정 절차가 아니라 사후 정당화만 가능한 자유 판단이다.

- `semantic-dup-1` [critical/confirmed] (semantic-dup) 파라미터명 편차로 동일 물리 라우트를 두 스펙이 중복 소유 — 구조적 게이트 자체가 뚫림
  - claim: Surface 정규화(normalizeKey)가 파라미터 '문법'(:id/<id>/{id})만 표준화하고 파라미터 '이름'은 보존하므로, 같은 라우트가 파라미터명만 다르면 서로 다른 키가 되어 dedup가 통과시킨다 — 의미적 중복이 아니라 방법론이 '무누락'이라 표방하는 구조적 중복의 누락이다.
  - 근거: tooling/ownership-keys.mjs:36-37 — paramRepl이 `{$1}`로 캡처된 원 파라미터명을 유지(`path.replace(/[:{<]([a-z0-9_-]+)[>}]?/g, paramRepl)`). SPEC-001 FR-002(sdd/specs/SPEC-001-key-pipeline.md:34)는 "rewrite :id/<id>/{id} params to the configured surfacePathParam {name} form"이라 표준형을 표방. DEDUP.md:13 "결정적·무누락" 주장.
  - 반례: SPEC-A `- **Surfaces**: GET /api/projects/:id`, SPEC-B `- **Surfaces**: GET /api/projects/{projectId}` → 정규화 결과 "GET /api/projects/{id}" vs "GET /api/projects/{projectid}"로 상이 → 픽스처 실행 실측: check-ownership.mjs --strict가 '✓ 구조적 중복 없음' exit 0. 동일한 물리 라우트 하나를 두 스펙이 각각 권위 소유.

- `semantic-dup-2` [high/confirmed] (semantic-dup) 인라인 # 주석이 entity 키에 흡수돼 문자 그대로 같은 키의 중복이 숨는다 — 킷 정본 예시가 그 표기를 쓴다
  - claim: parseSection이 콤마 분리 후 트림만 하므로 키 뒤 `# 주석`이 키의 일부가 되고, Entities는 형식 검증이 전무해(--strict 경고조차 없음) 주석 붙은 중복 키가 완전히 침묵 통과한다. 정작 DEDUP.md의 정본 Ownership 예시 블록 자체가 이 인라인 주석 표기를 사용해 사용자가 그대로 복사하도록 유도한다.
  - 근거: tooling/ownership-keys.mjs:15-18(콤마 분리+트림, # 필터 없음), :66(`return null; // Entity는 형식 제약 없음`). DEDUP.md:26-28 예시가 `- **Entities**: pjt_projects, pjt_project_staff       # 도메인 객체/테이블...` 표기 사용. templates/module-spec.md:71은 Files 필드에만 '인라인 주석 금지' 명시 — Entities/Surfaces/Capabilities에는 금지 없음.
  - 반례: SPEC-001 `- **Entities**: pjt_projects`, SPEC-002 `- **Entities**: pjt_projects   # 도메인 객체/테이블(스키마 식별자 그대로)` → 키 "pjt_projects" vs "pjt_projects # 도메인 객체/테이블(스키마 식별자 그대로)" → 픽스처 실측: --strict exit 0 '구조적 중복 없음'. 부수 효과로 주석 붙은 entity는 SPEC-024 capability 귀속 대조(trim+lowercase 집합 대조, capability-ownership-lib.mjs:24)에서도 어긋나 오탐/미탐을 낳는다.

- `semantic-dup-3` [high/confirmed] (semantic-dup) 단복수·접두어·구분자 변형 entity가 전 게이트 통과 + 의미적 리뷰 계층(같은 Entity 이웃)에서도 구조적으로 빠진다
  - claim: 정규화가 trim+lowercase뿐이라 order/orders/pjt_order/pjt-order는 전부 별개 키이고, 이를 어휘로 앵커할 두 장치(entityRegistry, entitySchemaBackingPolicy)가 모두 기본 비활성이다. 더 나쁜 것은 2계층 방어의 의미 계층이 '같은 Entity를 소유한 이웃 spec과 좁힌 리뷰'인데 이웃 판정이 정확 키 일치라서, 철자 변형 중복 스펙들은 서로 이웃이 아니게 되어 각자 '이웃 없음'을 정직하게 기록하고 completeness 게이트(존재·형식만 검사)를 통과한다 — 의미적 중복이 가장 잘 생기는 바로 그 지점에서 두 계층이 동시에 실명한다.
  - 근거: tooling/ownership-keys.mjs:42(entity 정규화 = lowercase+공백정리만), DEDUP.md:38("단복수 임의변환 금지(스키마가 진실)"), tooling/sdd-config.mjs:130(entityRegistry 기본 {} = 비활성)·:178(entitySchemaBackingPolicy 기본 "off"), DEDUP.md:57("같은 Entity 이웃 spec과만 LLM diff 리뷰"), tooling/check-spec-completeness.mjs:55-56(Dedup-Review 존재만 검사, '이웃 없음' 허용).
  - 반례: 3개 스펙이 각각 entity `order`/`orders`/`pjt_order` + capability `order.create`/`orders.create`/`pjt_order.register` 소유(같은 주문 aggregate의 철자 변형) → 픽스처 실측: --strict + capabilityOwnershipPolicy=hard에서 exit 0. 각 capability의 entity 조각이 자기 스펙 철자와 일치하므로 SPEC-024도 무위반. 셋 다 서로의 '같은 Entity 이웃'이 아니므로 Dedup-Review에 "이웃 없음" 기록으로 Reviewed 승격 가능.

- `semantic-dup-4` [high/confirmed] (semantic-dup) 카테고리 간(entity↔surface) 의미 결합 장치 전무 — surface-only 스펙이 hard 정책에서도 같은 실체를 쪼개 소유
  - claim: 한 실체의 카테고리 간 결합을 강제하는 장치는 entity↔capability(SPEC-024) 하나뿐이고 그마저 기본 advisory다. surface↔entity 매핑은 어떤 게이트에도 없어서, entity `order`를 SPEC-A가 소유하고 그 생성 라우트 `POST /api/orders`를 SPEC-B가 소유하는 개념 분할이 최강 설정(capabilityOwnershipPolicy=hard)에서도 통과한다 — capability를 선언하지 않은 surface-only 스펙은 SPEC-024 판정 루프에 아예 진입하지 않기 때문. owner가 제기한 'entity가 없어도 같은 스펙에 묶이는 경우'의 역상: entity 없는 스펙이 남의 entity 표면을 자유 소유한다.
  - 근거: tooling/check-ownership.mjs:115-119 — capability 귀속 판정이 own[CAP_CAT](소유 capability 목록)만 순회, Surfaces는 어떤 entity 대조도 없음. tooling/sdd-config.mjs:156(capabilityOwnershipPolicy 기본 "advisory" — 위반해도 exit 0). check-orphan-surfaces.mjs는 파일→스펙 존재만 보는 역커버리지(surfaceGlobs 기본 [] = 비활성)로 surface→entity 의미 결합과 무관.
  - 반례: SPEC-A: Entities order + Capabilities order.create / SPEC-B: Surfaces `POST /api/order`, `event:order-created`만 소유(Entities·Capabilities 없음) → 픽스처 실측: --strict + hard에서 exit 0. 주문 생성이라는 한 개념이 entity/capability 스펙과 route/event 스펙으로 이분 소유되어 '한 능력은 한 곳이 소유'(DEDUP.md:52 DDD bounded context 근거)가 카테고리 축에서 붕괴.

- `semantic-dup-5` [medium/confirmed] (semantic-dup) 동의어 verb·자유형 event 이름으로 같은 능력이 복수 키로 공존
  - claim: capabilityVerbs 등록제는 어휘 진입만 막을 뿐(등록=config 한 줄), 등록된 동의어 쌍(create/add/register)은 같은 entity 위에서 별개 키로 공존하며 dedup 무저촉이다. 기본 advisory에서는 entity 비소유 스펙의 `order.add`도 경고만 내고 통과한다. event/job surface는 `event:`/`job:` 접두어 뒤 형식이 완전 자유라 같은 이벤트가 표기 변형(점/하이픈/무구분)으로 중복 소유된다.
  - 근거: tooling/sdd-config.mjs:255-259(__allVerbs = CRUD+capabilityVerbs 합집합, 동의어 검사 없음)·:136(capabilityVerbs 등록에 사유 요구 없음 — entityRegistry와 달리 빈 배열에 문자열만 추가), tooling/ownership-keys.mjs:62(event:/job:은 접두어만 검사), DEDUP.md:40("임의 동의어 금지"라 표방하나 강제는 '미등록 verb 거부'뿐).
  - 반례: capabilityVerbs=["add","register"] 등록(사유 불요) 후 SPEC-A `order.create`, SPEC-B `order.register`(기본 advisory → 경고만, exit 0) 또는 같은 스펙 안 `order.create`+`order.add`(어느 정책에서도 무위반). event 실측: `event:Order.Created`/`event:order-created`/`event:ordercreated` 세 스펙 분산 소유가 --strict exit 0 통과(픽스처 확인).

- `semantic-dup-6` [medium/confirmed] (semantic-dup) 4판 패리티 균열 — 셸/Go판은 파라미터 정규화가 없어 Node판이 잡는 '문법 편차 동일 라우트'조차 통과
  - claim: DEDUP.md는 "dedup(키 유일성) 판정은 4판 동일"이라 하면서 정규화는 Node·Python판만 수행함을 같은 문장에서 인정한다 — 그러나 정규화가 다르면 키 공간이 달라 판정 결과도 다르다. 셸판은 lowercase+공백정리만 하므로 `GET /x/:id` vs `GET /x/{id}`(Node판에서는 동일 키로 충돌 검출)가 셸/Go판 게이트만 쓰는 저장소에서는 통과한다 — 어느 판을 쓰느냐에 따라 '중복 없음' 보장의 실질이 달라진다.
  - 근거: tooling/sdd_gates.sh:216-222(awk 파싱: trim+tolower+공백정리만, param 치환 없음) vs tooling/ownership-keys.mjs:36-38(param 문법 표준화). DEDUP.md:50 "dedup(키 유일성) 판정은 4판 동일하고, 키 정규화·형식검증(normalizeKey/validateKey)은 Node·Python판이 수행한다".
  - 반례: SPEC-A `GET /orders/:id`, SPEC-B `GET /orders/{id}` — Node/Python판: 둘 다 "GET /orders/{id}"로 정규화되어 중복 소유 exit 1. 같은 저장소를 sdd_gates.sh ownership으로 게이트하면 "get /orders/:id" vs "get /orders/{id}"로 상이 → 통과. CI가 셸/Go판만 배선한 소비 프로젝트는 Node판이 보장하는 최소한의 문법 통합조차 잃는다.

- `gran-1` [high/confirmed] (relations-and-granularity) relation은 참조 entity 개수·관련성을 무제한 허용 — FR이 남의 entity 위에서 동작하는 묶임 우회로
  - claim: SPEC-017 relation 판정은 대상 실재(hard)와 순환(advisory)만 볼 뿐, 몇 개를 어떤 관련성으로 끌어오는지 통제하지 않아 무관한 기능을 한 스펙에 묶는 우회로가 열려 있다. SPEC-024는 '소유 capability 키'만 막지 FR 산문이 참조 entity 위에서 동작하는 것은 못 막는다.
  - 근거: relation-lib.mjs:33-44 resolveRelations는 type 있는 항목마다 owner 존재만 확인해 edge/missing만 낸다(개수·관련성 게이트 없음). NFR-001(SPEC-017:64)은 '관계의 의미는 판정하지 않는다'고 명시. capability-ownership-lib.mjs:23-34는 own[ENT_CAT](소유 entity)만 대조하고 FR 본문은 보지 않는다. SPEC-023-fr-key-anchors FR-002는 bold 앵커를 'Ownership AND Dependencies keys'와 대조하므로, 참조 entity를 주어로 굵게 앵커한 FR도 통과한다.
  - 반례: spec-Y(entity=order 소유)가 Dependencies.Entities에 'customer (references)', 'inventory (references)', 'shipment (references)'를 넣고, FR-003에 '**customer** (E) 신용한도를 검증하고 **inventory** (E)를 차감한다'처럼 참조 entity를 굵은 앵커로 사용한다. capability로는 order.verb만 소유하므로 SPEC-024 위반 0건, SPEC-023 앵커도 Dependencies 키라 통과. 결과: order 스펙이 customer/inventory 도메인 기능을 흡수했는데 어느 게이트도 차단 못 함 — owner가 말한 'entity 없어도 같은 스펙에 묶이는 경우'가 그대로 재현.

- `gran-2` [high/confirmed] (relations-and-granularity) 참조 entity는 dedup 제외 + 의미 미판정 → 같은 실체의 N중 재해석을 아무도 못 잡음
  - claim: 같은 entity가 소유 스펙 1곳 + 참조 스펙 N곳에 반복 등장하는 것이 정상 설계인데, relation 참조는 구조적 dedup에서 제외되고 relation-type 일관성·의미 재정의도 검사되지 않아 같은 실체가 여러 스펙에서 서로 다르게 재해석돼도 게이트가 침묵한다.
  - 근거: check-ownership.mjs:124-129 Dependencies는 'do NOT add to owners(not a dedup target)'. SPEC-017:26 edge case가 '관계 해석은 dedup 통과 뒤 소유 인덱스만 쓴다'고 확정. relationTypeFinding(relation-lib.mjs:23-28)은 개별 토큰 어휘만 볼 뿐 같은 entity에 대한 참조들 사이 type 충돌(A는 has-many, B는 belongs-to)을 교차 검사하지 않는다. NFR-001로 의미 검증은 명시적 비목표.
  - 반례: entity user를 spec-A가 소유. spec-B는 'user (owns-many)', spec-C는 'user (belongs-to)', spec-D는 'user (references)'로 각각 참조하며 FR에서 user의 필드·상태기계를 서로 모순되게 서술한다. dedup은 소유 1건이라 통과, relation은 3곳 모두 owner(spec-A) 존재만 확인해 edge만 그림. 같은 user가 3개 스펙에서 재정의됐지만 위반 0건.

- `gran-3` [medium/confirmed] (relations-and-granularity) '소유 entity vs 참조 entity' 귀속이 저자 재량 — 게이트가 강제하지 않아 프로젝트 간 갈림
  - claim: 어떤 개념을 owned Entity로 선언할지 relation 참조로 둘지는 저자 재량이며, 게이트는 '먼저 소유 선언한 스펙이 이긴다'(dedup first-come)만 강제한다. 같은 개념이 프로젝트마다 owned/relation으로 갈려 과분류·중복을 낳는다.
  - 근거: validateKey(ownership-keys.mjs:66) Entity는 형식 제약 없음. 어느 스펙이 특정 entity를 소유해야 하는지 강제하는 규칙 부재 — entityOwnerIndex(check-ownership.mjs:168)는 specIds[0](선언 순 첫 소유자)를 그냥 채택. entityRegistry(sdd-config.mjs:130)도 '등록됐는가'만 볼 뿐 '어느 스펙이 소유하는가'는 무관.
  - 반례: gsn-ai-pm은 payment를 owned Entity로 스펙화하고, finops는 같은 payment를 'payment (references)'로 두고 자기 스펙에 FR을 얹는다. 두 프로젝트가 같은 실체를 서로 다른 축(owned vs relation)으로 모델링해도 각 저장소 내에선 모두 통과 — 방법론이 표방하는 '예외 없는 단일 분류'가 저자 재량으로 무너진다.

- `gran-4` [high/confirmed] (relations-and-granularity) cohesion의 'capability별 분할 권고'가 SPEC-024의 '한 entity의 verb는 같은 스펙'과 정면 충돌
  - claim: cohesion 게이트는 카테고리 키>4면 'capability별 분할 검토'를 권하지만, SPEC-024는 같은 entity의 verb는 verb가 달라도 반드시 같은 스펙이어야 한다고 강제한다. 풍부한 aggregate(create/read/update/delete/list/archive/restore=7개)는 두 규칙에 동시에 걸려 어느 쪽으로도 정합적으로 해소 불가.
  - 근거: check-spec-cohesion.mjs:62-63,75,77이 키>MAX_KEYS(기본 4, sdd-config.mjs:49)면 'capability별 분할 검토'를 출력. SPEC-024:20/capability-ownership-lib.mjs 주석 4-9는 'verb가 달라도 같은 entity면 같은 스펙'을 확정. 두 지침이 상호 배타적.
  - 반례: entity invoice가 7개 capability(invoice.create…invoice.restore)를 가진다. cohesion은 Capabilities 7>4로 '분할' 경고. 저자가 순순히 invoice.archive/restore를 새 스펙으로 떼면 SPEC-024 위반(invoice entity 미소유). SPEC-024를 지키려 한 스펙에 두면 cohesion이 계속 과대 경고. 어떤 선택도 clean green이 안 됨 → 방법론 내부 모순.

- `gran-5` [medium/confirmed] (relations-and-granularity) 'aggregate root 정확히 1개' 불변식이 기본 advisory — 다대다·값객체에서 예외 없이는 깨짐
  - claim: maxAggregateRootsPerSpec=1은 기본 advisory(‑‑strict에서만 hard)라 '1 spec=1 aggregate'는 실제로 강제되지 않으며, 다대다 조인 entity·공유 값객체는 이 모델에서 exemption 없이는 표현 불가.
  - 근거: check-spec-cohesion.mjs:57-59,71,79-83 — aggregate 초과는 STRICT일 때만 exit 1, 기본은 exit 0. schema-backing-lib.mjs:54-66은 소유 entity가 스키마에 리터럴로 실재해야 함 — 임베디드 값객체(테이블 아님)는 실패해 entitySchemaExemptEntities(sdd-config.mjs:186-188)로 도피해야 함. check-ownership.mjs:258 주석이 '소비 프로젝트가 40건을 일괄 면제'한 실측을 기록.
  - 반례: money·address 같은 공유 값객체에 capability(address.validate)를 얹으면 SPEC-024가 address entity 소유를 요구 → SPEC-026 schema-backing이 테이블 부재로 hard 실패 → entitySchemaExemptEntities에 등록해 우회. '예외 없음'을 표방하지만 값객체마다 면제 항목이 쌓인다. 다대다 enrollment(student×course)는 어느 aggregate에 귀속하는지 SPEC-024:61이 '리뷰 몫'으로 넘겨 기계 신호 공백.

- `gran-6` [high/confirmed] (relations-and-granularity) [owner 계층-깊이 대안] capability 키 문법이 점 정확히 1개를 강제 — user.student.verb는 하드 형식 위반
  - claim: owner가 제안한 'entity 계층을 점 깊이로 인코딩(user.student)'은 현 킷의 capability 키 문법과 근본적으로 비호환이다. capability는 점이 정확히 1개여야 하고 entity-segment는 첫 점까지만 절단하므로, 깊이 entity를 기계가 아예 파싱·귀속하지 못한다.
  - 근거: ownership-keys.mjs:48-50 — Capabilities는 key.split('.').length!==2면 'entity.verb 형식(점 1개)' 위반 반환. 즉 user.student.create는 parts.length=3 → 하드 형식 위반. capability-ownership-lib.mjs:28-31 — entity=cap.slice(0, indexOf('.'))로 첫 점만 취해, 설령 허용돼도 user.student.create의 entity는 'user'로 잡혀 하위 student는 귀속 검사에 불가시. schema-backing-lib.mjs:54-66은 소유 entity를 스키마 식별자와 리터럴 대조 → 'user.student'는 테이블명과 매치 불가.
  - 반례: 루트 user 아래 user.student를 두고 capability user.student.enroll을 선언하면: (1) validateKey가 점 2개로 즉시 exit 대상(형식 위반), (2) 우회로 verb를 없애도 SPEC-024는 entity를 'user'로 오귀속, (3) SPEC-026은 user.student를 스키마에서 못 찾아 유령 entity 판정. 세 코어(SPEC-001/024/026)를 전부 재작성해야 깊이 모델이 성립 — 현 킷에 '예외 없이' 얹을 수 없다.

- `gran-7` [medium/confirmed] (relations-and-granularity) [owner 계층-깊이 대안] 다부모 DAG·주어 앵커 기계강제 불가 → relation 대체는커녕 새 예외 생성
  - claim: 계층-깊이 모델은 단일 점경로가 트리만 표현하므로 다부모(학생이 user이자 school 소속)를 인코딩 못 해 새 예외를 만들고, 'user.student가 FR 주어로 잡히도록 강제'는 SPEC-023 앵커 게이트가 문장 주어/문법 개념이 없어 기계 검증 불가하다. 결국 relation의 '재량' 문제를 '예외 없는 단일 규칙'으로 대체하지 못한다.
  - 근거: key-anchor-lib(SPEC-023)의 판정은 bold 토큰이 '선언 키인가'(FR-003)·마커 일치(FR-005)만 — '주어인가'를 판정하는 코드 없음(SPEC-023 Assumptions:65 '의미 적정성은 리뷰 경계'). findCycles(relation-lib.mjs:47-73)가 순환을 advisory로만 신호하는 것은 현 모델이 이미 DAG를 부분 허용함을 보여줌 — 깊이 트리는 이 다부모 케이스를 표현조차 못 함.
  - 반례: student가 user(인증 주체)이자 school(소속)의 하위여야 하는 실도메인. 점경로는 user.student 또는 school.student 중 하나만 — 나머지 부모 관계는 다시 Dependencies relation으로 빼야 하므로, 깊이 모델을 도입해도 relation 메커니즘이 여전히 필요. '단일 규칙으로 예외 제거'가 목표였으나 다부모·교차경계에서 relation+깊이 이중 체계가 되어 예외가 오히려 늘어난다. 스펙 수 감소 효과(user.* 접기)는 단일부모 서브트리에 한정되고, 소비 프로젝트(gsn-ai-pm·finops, 본 저장소 부재로 직접 확인 불가)의 다부모 실체 비율만큼 상쇄된다.
