# SDD 재채택 (완전 재시작) — 이 파일 하나로 실행

> **한 줄 사용법 (clean machine · clone 불필요):** 대화창에 아래 한 줄. 에이전트는 이 파일을 raw로 읽고 순서대로, 추측 없이 실행한다.
> ```
> https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/main/prompts/readopt.md 읽고 그대로 수행해줘
> ```
> 위 URL의 정본 ref는 `main`(자기참조 — 특정 브랜치에서 받으면 그 ref를 이어 쓴다). 키트가 로컬에 있으면 `<KIT>/prompts/readopt.md 를 그대로 수행해줘`도 동일.
> **대상:** 이미 `sdd/` 산출물이 있는데(스펙·게이트가 낡거나 어긋남) 현 방법론으로 **처음부터 다시** 세울 때. **코드는 남기고 `sdd/` 산출물만 새로.** (소비 프로젝트 A/B 등.)

**정본 방법론:** https://github.com/lhs6395-hslee/ai-methodology
**REF(자기참조):** 이 파일을 raw URL로 받았다면 그 URL의 `<ref>` 세그먼트를 REF로, 로컬 키트로 실행 중이면 REF=`main`으로 간주한다(아래 raw base·`--branch`에 사용).

## 실행 순서
1. **안전망(필수).** `git add -A && git commit` 후 `git tag sdd-pre-readopt-<오늘날짜>`로 현재 상태를 스냅샷한다 — 진짜 손실 0, 언제든 태그로 복구. **구버전 훅이 이 스냅샷 커밋을 막으면 `--no-verify`로 통과시켜라** — readopt 대상은 정의상 "낡거나 어긋난" 레포라 자기 훅이 red일 수 있고, 이 커밋의 목적은 게이트 통과가 아니라 복구 지점 확보다(정당한 유일한 `--no-verify` 사용처).
2. **방법론 읽기(다운로드 불필요).** `REALITY_CHECK.md` → `STORAGE.md` → `APPLYING.md`를 정독한다 — 로컬 키트가 있으면 그 파일을, 없으면 이 파일과 **같은 raw base**(`https://raw.githubusercontent.com/lhs6395-hslee/ai-methodology/<ref>/`)에서 직접 읽는다. `[검증]/[추론]/[미확인]` 구분.
3. **강제 재배선 — tooling 확보 후 `sdd-init --force`.** 전체 clone 없이 tooling만 확보(partial + sparse) 후 최신 도구로 덮어쓴다:
   ```sh
   KIT="${SDD_KIT:-$HOME/Documents/claude/sdd}"           # 로컬 키트 캐시 위치(관례)
   REF="main"                          # readopt.md를 받은 ref (정본 main; 자기참조 — 브랜치에서 받으면 그 ref)
   if [ ! -f "$KIT/tooling/sdd-init.sh" ]; then           # 없을 때만: partial+sparse — 전체 clone 아님 (sh로 실행하므로 -f 검사)
     git clone --filter=blob:none --sparse --branch "$REF" \
       https://github.com/lhs6395-hslee/ai-methodology "$KIT"
     git -C "$KIT" sparse-checkout set tooling templates prompts
   fi
   cp sdd.config.json sdd.config.json.pre-readopt 2>/dev/null || true  # ← --force가 config 전체를 덮으므로 diff용 백업(필수)
   sh "$KIT/tooling/sdd-init.sh" --gate=node --force      # ← 대상 프로젝트 루트에서
   ```
4. **config 맞춤 + 새 knob 인스턴스화.** `sdd.config.json`을 이 프로젝트 언어로(프리셋: `tooling/sdd.config.presets.md`). 프리셋 필드표의 knob을 전부 검토해 **값이 프로젝트별인 것**(예: `trackerCloseout` 트래커·채널, `testInfraGlobs`, `objectStorageMarkers`)은 CLAUDE.md 관례/사용자 확인으로 인스턴스화한다(자동 추정 금지, 해당 없으면 기본 비활성값). 인프라(관리형 DB·스토리지·큐·클라우드 API 등 — 어느 CSP든) 의존이 있으면 **`commands.test`(로컬 안전)/`commands.smoke`(인프라) tier 분리 + probe 기반 skip 가드**를 인스턴스화한다. 능동적 판정(분류 → 사용자 확인 + 실제 접근 probe → 실패 시 자원·사유 명시)의 절차·가드 코드 원본은 `tooling/sdd.config.presets.md`의 "테스트 환경 tier" 섹션이 SSOT(여기 복붙 금지). **주의:** 3단계 `sdd-init --force`는 `sdd.config.json` **전체**를 덮어쓴다 — 잃는 건 tier 분리만이 아니라 프로젝트가 인스턴스화한 모든 knob(`prefixRationale`·`entityRegistry`·`capabilityVerbs`·`retiredIds`·`specSyncExemptGlobs`·`strictSpecs` 등)이다. 3단계에서 백업한 `sdd.config.json.pre-readopt`와 diff해 프로젝트 고유 값을 전부 재적용하라(특히 `retiredIds` 유실은 numbering 게이트를 즉시 red로 만든다 — SPEC-014 FR-001/004).
5. **구 산출물 정리 — 인간 절은 먼저 이월 목록으로.** 기존 `sdd/specs/*`를 걷어내기 **전에** 각 스펙의 인간 의도 절(User Story·Assumptions/Clarifications·Review Log·Dedup-Review·Change Log 근거)을 이월 목록으로 뽑아둔다(prior-intent 소스 — 사후 재생성 불가). 그다음 걷어낸다 — 코드는 그대로, 1단계 스냅샷 태그에 남아 있음.
6. **스펙 재도출 — 소스 클래스 9종 전부 읽는다(SPEC-009).** src만 읽는 재도출은 미완성이다. 정의된 소스 클래스와 산출물 매핑:
   | 클래스 | 읽을 것 | 착지 |
   |---|---|---|
   | `code` | scanDirs의 앱/툴 소스 | SPEC FR + Ownership |
   | `iac` | terraform/k8s/helm/Dockerfile/compose | **INFRA 스펙**(FR·Files 소유) |
   | `ci` | 워크플로우·Jenkinsfile·파이프라인 정의 | **CICD 스펙**(FR·Files 소유) + 검증 태그(build-evidence/smoke) |
   | `ops-docs` | runbook·운영 문서 | verification 절·검증 태그 |
   | `build-evidence` | 빌드/CI 실행 로그·아티팩트(레포 밖) | 검증 태그 본문이 좌표(빌드 #·URL)를 가리킴 |
   | `vcs-history` | git log·PR·커밋 메시지·Spec-Impact 트레일러 | Change Log 근거·마이그레이션 이력 |
   | `prior-traceability` | 기존 `@covers`/검증 태그 인벤토리 | **FR 키 보존이 기본** — 태그가 참조하는 키를 새 스펙이 그대로 쓴다 |
   | `prior-intent` | 5단계 이월 목록 | 새 스펙의 Story·Clarifications로 이월(버리면 사유 회계) |
   | `human-intent` | 기록 안 된 순수 의도 — **사후 재도출 불가** | 사용자 인터뷰로 Clarifications에 선제 캡처, 불가면 deferred 회계 |
   iac/ci 클래스가 매핑되거나 클라우드/인프라 의존(어느 CSP든)이 확인되면 **4단계의 `commands.test`/`commands.smoke` tier 분리를 소급 적용한다**(로컬 강제가 인프라 테스트를 돌리지 않도록 — 프리셋 "테스트 환경 tier").
   - **처음부터 방법론에 맞게(재도출도 born-conformant — 구문법 스펙을 새로 찍지 않는다):** 재도출은 백지에서 다시 쓰는 것이므로 구 스펙의 입도·명명을 답습하지 말고 현 문법대로 착지시킨다. **스펙 정체성 = entity**(1 spec = 1 aggregate root; 다른 aggregate는 `## Dependencies`의 `Name (relation-type)` 참조 — SPEC-017, "entity 없이 capability만 소유하는 기술 계층 스펙" 금지). **capability 귀속**(SPEC-024: `Capabilities`의 `entity.verb`에서 entity는 이 스펙이 소유·참조하는 스키마 식별자 그대로 — `budget` 류 도메인 약칭·유령 명사 금지) + **entity 실재**(SPEC-026: 소유 Entities는 구조 SSOT(스키마·마이그레이션·proto)에 실재하는 테이블/식별자여야 한다 — `wizard`·`project_list` 류 화면·흐름 개념을 entity로 등록하지 않고 Surface로, 그 verb는 실 entity의 FR로). **FR 키 앵커**(SPEC-023: FR 문장의 평문 **bold**는 키의 원천 단어만 — 필드명·파일경로·강조어는 백틱; 각 굵은 키에 카테고리 마커 — entity `(E)`·surface/route `(R)`·capability `(C)`, FR-005). 판단 항목(어느 entity가 root·유령 명사 처리)은 추정 말고 사용자에게 묻는다.
   읽은 결과를 `sdd/derivation.json`에 클래스별 mapped/none/deferred로 회계하고 `sdd.config.json`에 `derivationManifest`를 선언한다 — `derivation` 게이트가 미회계·"실재하는데 none"을 차단한다. spec은 `sdd/specs/`에만, PREFIX는 SPEC/INFRA/TEST/CICD(표준 4종), 1 spec=1 aggregate. **iac/ci→INFRA 착지는 fr 게이트가 강제한다(SPEC-012)** — 소유 실파일이 전적으로 iac/ci 클래스인 스펙이 SPEC- 접두어면 exit 1이므로, 재도출 시점에 접두어를 바로 착지시킨다(부수 소유 정당 케이스는 자동 통과, 예외는 `prefixClassExemptions` 사유 등록). **초안을 만들되 대량 생성·확정은 사용자 승인 후.**
   > **retrofit 스펙은 `Status: Reviewed`로 바로 작성한다(Draft 아님).** 기존 코드에서 재도출하는 스펙은 작성 시점에 이미 코드 대조 검토가 끝났으므로, Draft로 두면 spec-sync가 "그 스펙이 소유한 (이미 존재하던) 코드를 같은 changeset에서 건드리는 것"을 Draft 차단으로 막아 **매 스펙마다 Draft→커밋실패→Reviewed→재커밋**을 반복하게 된다(실측: SPEC-001~004 4회). Review Log에 한 줄(일시·수행자=코드 대조 검토·판정)을 채우고 `Status: Reviewed`로 작성하라 — Draft는 코드가 아직 없는 spec-first 신규 기능에만.
7. **결선 — 태깅은 보존·자동으로.** ① FR 키를 보존했으면 기존 `@covers`는 그대로 유효(R1이 검증). 재번호가 불가피했으면 마이그레이션 맵(old→new|null)을 만들어 `sdd-retag <map.json> --write`(또는 `sdd_gates.py retag`)로 기계 이행(SPEC-011) — 손 재태깅 금지. ② smoke 증거는 증거가 사는 파일(CI 정의·스크립트·runbook)에 검증 태그(`@verifies <SPEC-ID>/FR-NNN <method>: <evidence>`)로 남기고 `sdd-smoke-scan --write`로 매니페스트를 재생성(SPEC-010) — 손 연결 금지. ③ **다회 게이트-구동 수렴(정확성 우선 — 토큰보다 정합).** 게이트를 한 번 보고 끝내지 말고 **전 게이트를 돌려 위반이 0(선언된 리뷰 경계 advisory만 남을 때)까지 저술→게이트→수정을 반복**한다 — `check-fr-coverage`·`check-ownership`(+dedup·entity 등록·**capability 귀속** SPEC-024·관계 SPEC-017)·`check-spec-cohesion`(1 aggregate)·`check-spec-completeness`·`check-spec-consistency`(+**FR 키 앵커** SPEC-023)·`check-derivation`·`sdd-smoke-scan`. 전 게이트 green → 커밋(자기 훅 통과).

## 고정 규칙
- [`adopt.md`](adopt.md)의 고정 규칙과 동일.
- 사용자 승인 없이 스펙을 확정하거나, "코드에 맞춘다"며 스펙/코드를 덮어쓰지 않는다.
- **에이전트 무관 실행(Kiro·Codex 등):** 슬래시 명령·SessionStart는 Claude Code 편의 계층일 뿐 — 강제(게이트+git 훅)와 이 절차는 실행기 무관이다. 슬래시를 못 쓰면 되묻지 말고 같은 절차를 수동으로 밟는다. 상세·수동 첫-스펙 절차는 [`adopt.md`](adopt.md) §"에이전트 무관 실행".
