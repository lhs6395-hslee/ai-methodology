<!-- SDD:BEGIN — 이 블록은 sdd-init이 관리한다. 이 프로젝트 고유 내용은 마커 밖에 적어라. -->
# SDD 방법론 — 에이전트 컨텍스트 (상시 로드)

이 프로젝트는 채택된 SDD 강제 궤도 위에서 돈다. 어떤 에이전트(Claude Code·Kiro·Codex·기타)로 작업하든 아래를 따른다. (Claude Code는 SessionStart 훅이 같은 내용을 주입하지만, 이 문서는 **실행기 무관**하게 그 컨텍스트를 보장한다.)

**궤도:** spec → code → test → sync (이탈은 git 훅·게이트가 되돌린다)

**진입 규칙 (새 기능/수정 시 반드시):**
1. `sdd/MODULE_MAP.md` 대조 — 기존 spec과 겹치면 그 spec 개정, 아니면 새 spec
2. spec 위치 = `sdd/specs/` · 설계 문서(승인 전) = `docs/design/`
3. PREFIX 표준 = SPEC / INFRA / TEST / CICD (FEAT 등 임의 생성 금지 — 필요하면 사용자 승인 후 `specIdPrefixes` 등록)
4. FR은 EARS(SHALL 필수), 테스트는 `@covers <PREFIX>-NNN/FR-NNN`
5. 코드 전에 spec부터 — 작성=LLM, 승인=사람. 1 spec = 1 aggregate
6. 소유 코드 변경엔 같은 changeset에 소유 spec 변경 동반(순수 hotfix만 `Spec-Impact: none <사유>` 트레일러)

**강제는 실행기 무관:** git 훅(commit-msg·pre-commit)과 게이트(`check-fr-coverage`·`check-ownership`·`check-spec-sync`·`check-synonym` 등 R1~R10)가 **누가 커밋하든** 발화한다. 게이트 직접 실행 = `node scripts/<gate>.mjs` (또는 `python3 scripts/sdd_gates.py <gate>`).

**슬래시 없이 진행하라(Kiro·Codex 등):** 슬래시 명령(`/sdd-*`·`/speckit.*`)은 Claude Code 편의 래퍼일 뿐이다. 슬래시를 못 쓰는 환경에서 **"슬래시를 못 쓰는데 어쩌죠?"라고 되묻지 말고, 같은 절차를 그대로 수동으로 밟는다:**
- 최초 채택 / 재채택 / 평상시 sync = `prompts/{adopt,readopt,update}.md` 절차 그대로
- **완화를 선택지로 내밀지 않는다.** 게이트 위반의 해소안을 제시할 때 강도 하향(`hard→advisory`)·수치 임계 상향(`maxFRsPerSpec` 등)·면제 목록 추가를 **권장안으로 올리지 않는다** — 그건 위반을 없앤 게 아니라 자를 바꿔 잰 것이다. 정당한 해소는 **분할·병합·스펙 편집**이고, 진짜 재조정이 필요하면 `policyRatchetExceptions`로 부채를 표면화한다(래칫이 강도·임계 양쪽을 감시하므로 조용한 완화는 어차피 exit 1이다).
- **해소안 제시 규칙:** 확인된 결함(취약점·위반·드리프트)의 선택지를 낼 때 **부분 수정·이월을 권장으로 올리지 않는다.** 기본 권장 = 확인된 것 전부, 크기는 **배치**로 쪼갠다(순서 ≠ 범위). 이월은 무엇을·왜·언제까지·누가 수용했는지를 적을 때만 선택지다.
- **지운 것의 이유는 세 자리로:** 본문(FR·SC·Ownership)=지금 무엇인가 / Change Log=언제 무엇을 왜 바꿨나 / `## Assumptions`=**왜 그 대안이 아닌가**(기각 대안·재검토 조건). 옛 구성을 지울 땐 `sdd-retire`를 쓰고(번호 재사용 차단), 기각 이유를 Assumptions에 남긴다 — 없으면 같은 제안이 몇 달 뒤 다시 올라온다.
- **배포하면 그 자리에서 적는다:** `kubectl apply`·`helm upgrade` 등으로 라이브에 반영했다면 **커밋 전에** 소유 스펙 Change Log에 한 행(날짜·무엇을·왜 + `[검증: 경로]`/`[미확인]`)을 남긴다. 배포가 커밋보다 먼저인 궤도에서는 그때 안 적으면 기록이 영영 안 남는다.
- **비기능 작업 라우팅:** 부하·성능·보안/침투·가용성 작업은 기능 스펙에 욱여넣지 말고 **비기능 TEST 스펙**으로 간다(없으면 생성 — STORAGE.md §비기능 TEST 스펙 아키타입). 산출물 경로(`tests/load/**`·`tests/security/**`)를 그 스펙 Surfaces로 선언해야 커밋 시 소유가 강제된다.
- **이름 짓기:** 새 entity는 이미 있는 것의 다른 이름이 아닌지 본다 — `order`/`orders`/`pjt_order`는 정규화하면 같은 키라 게이트가 막는다(SPEC-033). 같은 개념을 두 이름으로 부르고 있으면 정본을 하나 정해 `synonymRegistry`에 사유와 함께 선언한다.
- 첫 스펙 / 신규 스펙 = `templates/module-spec.md` 복사 → `sdd/specs/SPEC-NNN-<slug>.md` → FR(EARS)·Ownership·SC·Review Log 채움 → 셀프리뷰(`SPEC_REVIEW.md`) → 게이트 green → 사용자 승인
- drift 점검 = `node scripts/sdd-sync.mjs`

**정본:** 방법론 = `METHODOLOGY.md`·`STRUCTURE.md`·`HARNESS.md`, 진입 = `prompts/adopt.md`. (전체는 SDD 키트를 참조 — 이 문서는 요약이다.)
<!-- SDD:END -->
