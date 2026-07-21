# SDD 방법론 업데이트 (GitHub 정본 → 이 프로젝트) — 이 파일 하나로 실행

> **한 줄 사용법 (clean machine · clone 불필요):** 대화창에 아래 한 줄(또는 그냥 "이 방법론 업데이트해줘").
> ```
> https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/update.md 읽고 그대로 수행해줘
> ```
> 위 URL의 정본 ref는 `main`(자기참조 — 특정 브랜치에서 받으면 그 ref를 이어 쓴다). 키트가 로컬에 있으면 `<KIT>/prompts/update.md 를 수행해줘`도 동일.
> **대상:** 이미 채택된 프로젝트. **방법론 도구(게이트·훅·템플릿) 최신화 + 고도화로 생긴 새 config knob·규범을 이 프로젝트에 인스턴스화. 스펙·작업물은 불변.** — 방법론이 무엇이 바뀌든 이 한 줄로 프로젝트가 따라잡는다(자동 전파).

**정본:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw URL로 받았다면 그 URL의 `<ref>` 세그먼트를 REF로, 로컬 키트로 실행 중이면 REF=`main`으로 간주한다(아래 `--branch`/pull에 사용).

## 실행 순서
1. **키트 최신화(전체 clone 없이).** 로컬 키트가 있으면 `git -C "$KIT" pull` 로 최신화하고, 없으면 partial+sparse로 확보한다(뒤처졌으면 알린다):
   ```sh
   KIT="${SDD_KIT:-$HOME/Documents/claude/sdd}"           # 로컬 키트 캐시 위치(관례)
   REF="main"                          # update.md를 받은 ref (정본 main; 자기참조 — 브랜치에서 받으면 그 ref)
   if [ -d "$KIT/.git" ]; then
     git -C "$KIT" fetch origin "$REF" && git -C "$KIT" pull --ff-only origin "$REF"
   else                                                    # partial+sparse — 전체 clone 아님
     git clone --filter=blob:none --sparse --branch "$REF" \
       https://github.com/lhs6395-hslee/ai-methodology "$KIT"
     git -C "$KIT" sparse-checkout set tooling templates prompts
   fi
   ```
2. **diff.** 이 프로젝트에 설치된 것(`scripts/`의 `*.mjs` 게이트 · `.git/hooks` · `.claude/skills` · `sdd/templates`)을 키트(`$KIT/tooling`·`$KIT/templates`)와 비교한다.
3. **승인 후 반영.** 바뀐 파일만 목록으로 보여주고, **사용자 승인을 받은 뒤에만** 반영한다 — 자동 덮어쓰기 금지. (`sdd-init`를 `--force` 없이 재실행하면 신규만 추가되고 기존은 보존. 게이트 코드 갱신은 diff 확인 후 명시적으로 복사.)
4. **새 config knob·규범 인스턴스화 (고도화 자동 전파 — 이 단계가 빠지면 도구만 새롭고 방법론 고도화는 프로젝트에 도달하지 않는다).**
   - **새 knob 탐지:** 키트 DEFAULTS(`$KIT/tooling/sdd-config.mjs` + `$KIT/tooling/sdd.config.presets.md` 필드표)와 이 프로젝트 `sdd.config.json`을 비교해, 프로젝트에 **없는 새 knob**을 목적과 함께 나열한다.
   - **인스턴스화 판정 (knob별):**
     - *값이 프로젝트별인 knob*(예: `trackerCloseout`의 트래커·보고 채널) → **자동 추정 금지.** 먼저 이 프로젝트 `CLAUDE.md`/관례에 선언돼 있으면 그 값으로 채우고, 없으면 **사용자에게 물어** 인스턴스화한다. 해당 없으면 기본 비활성값(`{}`·`[]`)으로 두고 사유를 남긴다.
     - *마이그레이션을 표면화하는 advisory knob*(`frKeyAnchorPolicy`·`capabilityOwnershipPolicy`·`entitySchemaBackingPolicy` 등 — 새 스펙 문법의 위반을 5단계에서 드러내는 knob) → 기본이 `off`거나 미설정이면 **`off`로 두지 말고 `advisory`로 켠다**(사용자 확인). ⚠ 꺼두면 5단계 백로그가 영원히 비어 마이그레이션이 표면화되지 않는다("기본값 충분"으로 판단하는 함정 — `frKeyAnchorPolicy`·`entitySchemaBackingPolicy` 기본이 정확히 `off`다). `hard` 승격은 백로그 정리 후.
       - ⚠ **`entitySchemaBackingPolicy`는 스키마 어댑터 동반 필수(SPEC-026):** 이 knob만 켜고 `entitySchemaSources`(구조 SSOT 위치+추출 패턴, 프리셋 참조)를 비워두면 판정이 inert다 — 이 프로젝트의 스키마 위치(Drizzle `schema.ts`·Prisma·SQL 마이그레이션·proto 등)를 CLAUDE.md 관례 또는 사용자에게 물어 `entitySchemaSources`로 인스턴스화한 뒤 `advisory`로 켠다. 이게 있어야 유령 entity(`wizard`·`project_list` 류 — capability 귀속을 지어낸 entity로 우회한 것)가 백로그로 드러난다.
       - ⚠ **`entitySchemaExemptEntities`로 백로그를 대량 면제하지 말 것(실측 악용):** 스윕이 유령 entity를 내면 **면제가 아니라 원인별로 해소**한다 — (a) UI/흐름 개념(`wizard`·`project_list`·`dashboard`·`detail`, FR이 실 테이블을 조작)은 **Surface 강등 + capability 재키**(migrate/readopt), (b) 인프라·proto entity(`vpc`·`eks` 등)는 그 구조 SSOT(terraform·`.proto`)를 **`entitySchemaSources`에 소스로 추가**해 스키마 백킹, (c) 면제는 이 둘 다 아닌 "스키마 밖 실 외부 aggregate"에만 소수. 면제는 게이트가 매 실행 부채로 표면화하므로 조용한 '완료'가 되지 않는다. **대량 면제(수십 건)는 entity를 개념 단위로 쪼갠 신호 → readopt 대상**이지 면제 대상이 아니다.
     - *기본값으로 충분한 knob* → 그대로 둔다(하위호환).
   - **새 규범 반영:** 이번 최신화로 들어온 새 규범(예: 완료 루프 close-out — `speckit-fix` 스킬 단계·`METHODOLOGY.md`)이 프로젝트 관례(`CLAUDE.md`) 기입을 요구하면 사용자 확인 후 반영한다.
   - 원칙: 이 단계는 **어떤 미래 knob에도** 동작하도록 generic이다 — 특정 knob명을 하드코딩하지 않고 "DEFAULTS엔 있는데 프로젝트에 없는 것"을 기준으로 판단한다.
5. **새 스펙 문법 마이그레이션 백로그 (스펙은 승인 전 안 건드림 — 이 단계가 빠지면 새 문법이 도구로만 도착하고 기존 스펙엔 영원히 미적용된다).**
   - **⚠ 이 단계는 이번 라운드 도구 diff 여부와 무관하게 항상 실행한다.** 새 스펙 문법은 **이전** update 라운드에 이미 도착했을 수 있다(도구는 최신인데 기존 스펙은 구문법 그대로 — diff가 없어도 마이그레이션 대상은 남아 있다). **"도구 변경 없음 = 할 일 없음"으로 종료하는 것은 오류다**(실측 결함: 소비 프로젝트 update가 diff 0을 보고 게이트 스윕 없이 "이미 최신"으로 끝냄 — 백로그가 영원히 표면화되지 않음). diff가 0이어도 반드시 아래 게이트 스윕을 돌린다.
   - **왜:** 고도화가 **스펙 본문 문법**을 확장하면(예: SPEC-017 Entity 관계 — 복수 `Ownership.Entities` → aggregate root 1개 + `## Dependencies`의 `EntityName (relation-type)`; SPEC-023 키 앵커 — FR bold를 키 앵커로; SPEC-024 capability 귀속 — entity 없는 capability 스펙 금지), 도구·knob는 위 1~4로 오지만 **기존 스펙은 불변 규칙 때문에 자동 재구성되지 않는다**(실측: 소비 프로젝트가 update 후에도 스펙마다 entity 복수 소유 그대로).
   - **탐지(기계):** 반영 후 게이트를 일괄 실행(`node scripts/sdd-sync.mjs` 또는 개별 게이트)해 **새 문법 유래 advisory**를 수집한다 — cohesion의 "aggregate 삼킴 의심"(Entities > `maxAggregateRootsPerSpec`), ownership의 관계 미구조화(괄호 없는 자유참조)·**capability 귀속 위반**(entity 없는 capability 스펙·남의 entity 위 capability — SPEC-024, 해소=능력을 entity 소유 스펙으로 이관)·**entity 스키마 백킹 위반**(소유 entity가 구조 SSOT에 없는 유령 entity — SPEC-026, `entitySchemaBackingPolicy` advisory + `entitySchemaSources` 설정 시; 해소=실 테이블이면 스키마 존재/면제, UI 개념이면 Surface 강등+실 entity 재키), consistency의 키 앵커 미매치·**카테고리 마커 위반**(굵은 키에 종류 마커 누락·불일치 — entity `(E)`·surface `(R)`·capability `(C)`, SPEC-023 FR-005, `frKeyAnchorPolicy` advisory) 등. **전제:** 4단계에서 마이그레이션 표면화 knob(`frKeyAnchorPolicy` 등)을 `advisory`로 켰어야 이 스윕이 백로그를 낸다 — 아직 `off`면 이 단계에서 켜고 다시 돌린다. 스윕이 0건이면 그때 "마이그레이션 대상 없음"으로 보고한다(게이트를 실제로 돌린 근거와 함께).
   - **제시(사람 승인 관문):** 수집 결과를 **스펙별 마이그레이션 백로그**로 사용자에게 제시한다 — "SPEC-005: Entities 7개 → root 1(`orders`) + 6개는 Dependencies 관계로" 식. 절차 정본: 킷 `APPLYING.md` §마이그레이션 노트("복수 Entity → aggregate root + 관계").
   - **수행(같은 실행에서 이어 편집):** 표면화 직후, 아래 실행 경로대로 **이 세션에서 migrate/readopt 절차를 이어 수행해 승인된 항목을 실제로 편집한다**(작성=LLM·확정=사람 — 편집은 스펙별 승인 경유). "표면화까지가 범위"로 끝내지 않는다. 사용자가 특정 항목을 미승인하면 그 항목만 advisory로 남아 다음 라운드에 재표면화(조용한 소실 없음).
   - **면제 부채도 백로그다 (사용자는 정상/비정상을 못 가린다 — update가 판정·유도한다):** 게이트가 `entitySchemaExemptEntities` 면제를 부채로 표면화하면(SPEC-026 FR-005), 그걸 "게이트 green이니 괜찮음"으로 넘기지 마라. **면제가 대량(수십 건)이거나 목록에 UI/흐름 이름(`wizard`·`project_list`·`dashboard`·`detail` 등)이 있으면, 이는 이전 라운드가 유령 entity를 재구성 대신 면제로 덮은 "papered-over" 상태다 — 정상이 아니다.** 사용자에게 "게이트는 green이지만 이건 완료가 아니라 지난 라운드의 우회입니다"라고 **명확히 판정**해 알리고 전면 재수정 경로로 **유도**한다.
     - **선택지 제시 규칙(중요 — 중립 나열 금지):** 사용자에게 물을 때 **권장안은 `/sdd-readopt`(UI/흐름 면제가 있거나 대량이면)이고 이를 첫 번째·"(권장)" 표시로 제시**한다. 국소가 정말 소수면 `/sdd-migrate`가 차선. **"현행 유지(면제로 충분)"를 UI/흐름 개념 면제의 유효한 선택지로 내세우지 마라** — 그건 방법론이 명시적으로 거부하는 papered-over다(선택지로 올리더라도 "권장 아님·papered-over"로 명시). "현행 유지"가 정당한 것은 오직 **실 외부 aggregate 면제**(외부 API 자원 등)뿐이다. "면제라 통과했으니 done"이라고 보고하는 것은 금지(실측 오류: update 11회차가 40건 일괄 면제 후 '완료' 선언; 12회차는 '현행 유지'를 1번 선택지로 내세움 — 둘 다 papered-over 유도).
   - **실행 경로(중요) — 표면화에서 멈추지 말고 같은 실행에서 이어 편집한다:** 백로그가 있으면 "목록만 내고 '/sdd-migrate 실행할까요?'로 대기"하지 마라 — 그건 합의 위반이다(owner 반복 확정: **"update해도 스펙 바꾸기로 했잖아"**). 규모를 판정해 **곧바로 실행기(migrate/readopt) 절차를 이 세션에서 이어 수행하고, 스펙을 실제로 편집한다**. 사람 승인 관문은 **각 스펙 편집**에 걸리지("이 변경을 확정?"), "migrate를 시작할까?"에 거는 게 아니다. 즉 **update 한 줄 = (편집 승인하며) 스펙이 바뀜**으로 끝나야 한다. 규모로 경로가 갈린다(백로그에는 위 면제 부채도 포함):
     - *증분(대다수)* → 이어서 `prompts/migrate.md` 절차를 수행. 스펙별 국소 위반(약칭 개명·수사적 bold 강등·마커/앵커 정리·한 스펙의 aggregate 분리)을 **스펙별 사람 승인 경유 원자 커밋**으로 실제 소진(빈 목록으로 끝내지 않는다).
     - *전면 재수정* → `/sdd-readopt`(정본 `prompts/readopt.md`). 백로그가 **구조적·전반적**이면(예: 다수 스펙이 entity 입도부터 어긋남 — "엔진/wizard" 류 기술계층 스펙이 즐비, capability 귀속 위반이 스펙 경계 자체의 오류에서 나옴, **또는 대량 면제 부채 — 이전 라운드가 유령 entity 수십 건을 면제로 덮은 상태**, 구 문법으로 통째 작성돼 스펙별 국소 편집으로는 수렴이 안 됨) 증분 migrate로 스펙을 짜깁기하지 말고 **백지 재도출(readopt)** 을 권장한다 — 코드는 보존한 채 `sdd/` 산출물만 현 문법으로 처음부터 다시 세운다(안전망 태그 → 인간 절 이월 → 9종 소스 재도출 → 다회 수렴). "국소 편집 반복 vs 전면 재저술" 판단은 사용자에게 규모 근거와 함께 제시하고 결정을 맡긴다(추정 확정 금지).
6. **정책 강도 승격 권장 (graduation — advisory는 종착점이 아니라 경유지).**
   - **원칙:** 강제 knob의 목표 상태는 **strict(`hard`/`error`)**다. `off`·`advisory`·`warn`은 **마이그레이션 중 임시 상태**이지 영구 안착지가 아니다 — advisory에 방치하면 위반이 계속 "미채택 권장"으로 재등장할 뿐 강제되지 않는다. 그래서 update는 knob을 낮은 강도에 두는 것을 권하지 않고, **깨끗해지면 `hard`로 올리는 것을 권장**한다.
   - **판정(기계·generic):** 강도가 계단인 knob(`frKeyAnchorPolicy`·`capabilityOwnershipPolicy`·`entitySchemaBackingPolicy`·`draftBlockPolicy`·`semanticDriftPolicy`·`runTestsPolicy`·`migrationStatePolicy` → `hard`; `specSyncUnownedPolicy` → `error`; `requireAccounting`/`strictSpecs` → 전수)마다: 그 knob의 백로그(5단계 스윕 결과)가 **0건이면 `hard`(strict)로 승격을 권장**하고 사용자 승인 시 config에 반영한다. 백로그가 남아 있으면 "정리(migrate) 후 hard"를 목표로 제시한다 — 이때도 권장 종착지는 advisory가 아니라 hard다.
   - **면제로 위장된 '백로그 0' 경계(SPEC-026):** `entitySchemaBackingPolicy`의 백로그가 0이어도 그게 **대량 `entitySchemaExemptEntities` 면제로 만든 0**이면 hard 승격은 '완료'가 아니다 — 게이트가 면제를 부채로 표면화하므로, 승격 전 면제 목록을 검토해 UI/흐름은 Surface(migrate/readopt)·인프라/proto는 소스 추가로 실제 해소하고, 남는 면제가 "실 외부 aggregate 소수"일 때만 hard가 참 종착지다. 수십 건 면제 위에 올린 hard는 거짓 완료(실측).
   - **⚠ 새 체크가 기존 `hard` knob을 소급 범람시킬 때(전이 — "미적용/revert"는 권장 아님):** 이번 최신화가 이미 `hard`인 knob에 **새 규칙**(예: FR-007 소유 키 앵커 강제)을 얹어 그 프로젝트가 예전에 hard로 올렸던 것이 **갑자기 대량 위반으로 깨지는** 경우가 있다. 이때 **도구를 안 받거나(revert) 되돌리는 것을 권장으로 내세우지 마라** — 그건 방법론이 거부하는 회피(papered-over)이고, 고도화가 프로젝트에 도달하지 못한다. 올바른 전이는 graduation 사다리 그대로다: (1) 새 도구는 **반드시 반영**하고, (2) 범람하는 knob을 **임시로 `advisory`로 내려**(전이 상태 — 기존에 hard로 지키던 것도 잠시 advisory, 이미 clean한 규칙은 손실 없음) 128건 백로그를 표면화한 뒤, (3) `/sdd-migrate`(또는 규모가 크면 `/sdd-readopt`)로 **0까지 정리**하고, (4) **다시 `hard`로 재승격**한다. 즉 선택지는 "미적용 vs hard로 깨짐"의 이분법이 아니라 "**적용 + 임시 advisory 전이 + 마이그레이션 + 재hard**" 단일 경로다. "지금은 미적용(권장)" 같은 제시는 금지 — 권장은 언제나 적용·전이·강제다.
   - **강제 지점 동반:** `draftBlockPolicy: hard` 등 서버측 병합까지 막는 knob은 CI(range 모드 spec-sync)가 걸려 있어야 실효 — 없으면 `ci-examples.md`/`sdd-gates.yml`로 함께 안내.
   - **미승격 시:** 사용자가 hard 승격을 미루면 그 사유를 남기고(다음 update에서 다시 권장), 조용히 advisory로 방치하지 않는다.
7. **확인.** 반영 후 게이트를 돌려 green 확인하고, 무엇이 바뀌었는지(도구·knob·규범·마이그레이션 백로그·**강도 승격 권장/반영**) 요약한다.

## 불변 규칙
- update는 백로그를 표면화한 뒤 **같은 세션에서 migrate/readopt 실행기 절차로 이어 스펙을 편집한다** — "표면화만 하고 별도 작업으로 미룸"이 아니다(owner 합의: **update 한 줄이 승인 경유 스펙 변경으로 끝난다**; 표면화에서 멈추면 "돌려도 그대로"가 반복될 뿐). 불변식은 **"각 스펙 편집은 사람 승인 경유"(작성=LLM·확정=사람)** 이지 "스펙 편집 금지"가 아니다 — 승인 없는 자동 덮어쓰기·빅뱅 재작성만 금지(편집은 스펙별 원자 커밋·Change Log 동반).
- 기존 config 값은 보존한다 — 새 knob만 추가/인스턴스화(기존 값 덮어쓰기 금지).
- 자동 덮어쓰기 금지, 사람 승인 필수. 값이 프로젝트별인 knob은 추정하지 말고 CLAUDE.md 관례 또는 사용자에게 확인.
- **강도 knob의 권장 종착지는 `hard`(strict)다** — advisory/off/warn은 마이그레이션 중 임시 상태. update는 낮은 강도 유지를 권하지 않고, 백로그가 깨끗해지면 hard 승격을 권장한다(승격 자체는 사람 승인). "advisory로 두는 게 권장"이 아니다.
