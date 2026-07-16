# 설계: 명세 폐기·재sync + semantic drift 검출 (2026-07-15)

> 도그푸딩(소비 프로젝트 B) 요청. 핵심 원칙: **명세는 코드 현실의 미러다 — 누적(Change Log)이 아니라 정리·삭제·재sync를 1급 시민으로.** `deferred`(할 건데 아직)와 `retired`(안 할 것·필요 없어짐)를 **분리**하되 deferred를 폐지하지 않는다.

## 문제 (실측)
1. **폐기 경로 부재** — 필요 없어진 SPEC/FR을 지우는 1급 워크플로가 없다. 누적 Change Log로만 봉합됨. 유령 명세(CICD-001 0/10)·번호 gap(SPEC-011 잔분)이 리포트 노이즈로 상시 출력.
2. **semantic drift 미검출** — 코드의 이름/목적/소유가 바뀌어도 FR 본문이 옛 의미를 유지하면 게이트 통과(Change Log 한 줄로 충족). 예: IAM 역할 plan→action broker 리네임+목적변경인데 본문 plan-only 유지해도 무통과.
3. **공유 surface 소유 마찰** — 한 스펙 소유 파일을 다른 스펙 기능 때문에 수정하면, 실제 동인과 무관한 소유 스펙에 억지 Change Log 강제 → 추적 왜곡.
4. **만성 unowned 경고** — 서버·테스트가 어느 Files에도 안 잡혀 `specSyncUnownedPolicy=warn` 상시 노이즈.
5. **cohesion 오탐** — Change Log의 FR 인용이 정의로 오집계. **[해결됨 — 2026-07-15 `__frDecl` 통일]**

## 기계 vs 리뷰 경계 (정직 — 과장 금지)
- **기계화 가능:** 폐기 커맨드+재sync · 리네임/소유 diff 트리거로 요구 강화 · cross-spec 동인 참조 · Planned/Retired 상태 · cohesion 카운트.
- **리뷰 경계(게이트 불가):** "FR 본문이 코드 *의미*와 일치하나" = NLP 판정. 트리거는 기계가, 의미 확인은 **강제된 리뷰 체크포인트**로 라우팅한다(METHODOLOGY 리뷰 경계표에 행 선언).

---

## A. 명세 폐기/은퇴 워크플로 — SPEC-018 후보 `spec-retirement`

**상태 모델 (Status enum과 직교하는 의미 구분):**
- 현행 Status: `Draft → Reviewed → Approved → Active → Deprecated → Removed` (수명주기 *진행*).
- 신규 구분 필요:
  - **`Planned`** — 아직 구현 안 됨(0-coverage가 정상, 노이즈 아님). Status enum에 추가 또는 `Lifecycle: planned`.
  - **`Retired`** — 필요 없어져 폐기(회계에서 제거, 이력만 git). `deferred`와 다름: deferred는 회계에 남아 "잊지 마"라고 외치고, Retired는 회계에서 사라진다.

**커맨드 `sdd-retire <SPEC-ID | SPEC-ID/FR-NNN> [--write]`:**
1. dry-run 기본(계획 보고), `--write` 적용, **all-or-nothing**(retag 패턴).
2. 대상 삭제(또는 `Status: Removed`/`Retired` 전이) + **자동 재sync**:
   - 그 FR을 `@covers`하던 테스트 → dangling 보고(R1 그물이 잔존 차단; 삭제는 사람이 원자적 PR로).
   - `smokeManifest`의 해당 키 제거.
   - 번호 gap 재계산 — **폐기가 남긴 gap은 "정상"으로 표시**(사고성 gap과 구분).
3. `MODULE_MAP`·Change Log에 제거 기록.

**게이트 규범(D와 한 묶음):** 0-coverage FR이 `Planned ∨ deferred ∨ Retired` 어느 것도 아니면 → 그때만 "미검증" 신호(현행은 무차별 warn). 번호 gap이 폐기 유래면 advisory 메시지에 "retirement gap(정상)" 명시.

**owner 방침 반영:** 불필요 FR = **delete**(미룸 아님). deferred는 "할 건데 아직"에만 쓴다.

---

## B. semantic drift 검출 — SPEC-019 후보 `semantic-drift`

**기계 트리거(가능):** 소유 파일의 git diff에서 **리네임·소유 변경**을 감지하면 spec-sync 요구를 **"아무 Change Log 한 줄" → "FR 라인 변경 or `Spec-Impact: <사유>`"** 로 승격.
- 리네임 감지: `git diff --find-renames`(R 상태) + 심볼/식별자 치환 휴리스틱(삭제 심볼 + 추가 심볼 짝).
- 소유 변경: 파일이 다른 스펙 Files로 이동하거나 Ownership 키가 바뀌면 트리거.

**리뷰 경계(불가):** "FR 본문이 새 코드 *의미*를 서술하나"는 게이트가 못 판정 → 트리거 발동 시 **본문 갱신 또는 Spec-Impact 사유를 강제**하고, 의미 정합은 리뷰 체크포인트(METHODOLOGY 표 신규 행)로.

**주의:** 과장 금지 — 게이트는 "리네임/소유가 바뀌었으니 본문을 다시 봐라"까지만. "제대로 고쳤나"는 사람.

---

## C. 공유 surface 변경 동인 추적 — SPEC-003 확장 or SPEC-020

**문법:** 커밋 트레일러 `Change-Driver: <SPEC-ID> <사유>` (기존 `Spec-Impact: none` 동형).
- 소유 스펙이 아닌 **변경 동인 스펙**을 기록.
- 선언 시 소유 스펙의 Change Log 요구를 **참조 행**으로 완화(억지 의미 서술 불요).

**경계 재고 신호:** 한 파일이 여러 스펙 때문에 만성 변경 → **Files 경계가 잘못 그어진 것**일 수 있음. 게이트가 임계 초과 시 "이 공유 surface를 별도 spec으로 분리 검토" advisory(억지 기계화보다 경계 재설계 유도).

---

## D. 유령·미구현 명세 규범 (A와 통합)
- `Planned` 상태 = 0-coverage 정상(리포트 노이즈 승격).
- `Retired` 상태 = 회계 제외.
- **만성 unowned(#4)는 신규 코드 아님** — `specSyncExemptGlobs`(이미 존재)로 "의도적 미소유"를 선언하거나 소유시키는 **사용법 규범**. 서버·테스트 하네스처럼 정당한 미소유는 exempt, 진짜 drift는 신호로 남긴다. → 문서 규범 + 채택 가이드.

---

## 제약 (불변)
- **Node + Python 패리티**(SPEC-006) — 모든 신규 게이트·카운터.
- `requirementIdPrefixes`(도메인 접두어) 유지.
- `sdd-sync.mjs` `fileURLToPath` **[해결됨]** — 킷 자체 수정으로 소비자 델타 소멸.

## 스펙 분해 제안 (우선순위)
1. **[완료]** E cohesion 카운터 + sdd-sync 경로 (quick-win, 2026-07-15).
2. **SPEC-018 `spec-retirement`** (P1) — Planned/Retired 상태 + `sdd-retire` 재sync + 번호 gap 의미 구분 + 0-coverage 규범(D 통합). owner 통증 1·직접 해소.
3. **SPEC-019 `semantic-drift`** (P1) — 리네임/소유 diff 트리거 → spec-sync 요구 승격 + 리뷰 경계 선언. owner 통증 2 해소.
4. **SPEC-020 or SPEC-003 확장 `cross-spec-change`** (P2) — `Change-Driver` 트레일러 + 마찰 완화 + 경계 재고 advisory. owner 통증 3 해소.
5. **문서 규범(D/#4)** — unowned 정책 사용 가이드(exempt vs own), deferred vs retired 구분 명문화(METHODOLOGY·STRUCTURE).

각 스펙은 게이트 TDD + Node/Python 패리티 + 셀프 도그푸딩. 리뷰 경계는 그때그때 METHODOLOGY 표에 행으로 선언.

## 열린 결정 (사용자 확인 필요)
- **Planned/Retired를 Status enum에 넣나, Lifecycle 필드에 넣나?** — Status는 "진행 단계", Lifecycle은 "삭제 가능성". `Retired`는 Status(Removed와 인접)가, `Planned`는 Status(Draft 이전 "예정")가 자연스러움. 단 Removed와 Retired 중복 우려 → 하나로 통합할지.
- **B의 리네임 감지 강도** — `--find-renames`만(파일 리네임)인가, 심볼 치환 휴리스틱까지인가(오탐 위험 ↑). 보수적으로 파일/소유 이동부터.
- **C를 SPEC-003 확장으로 흡수 vs 신규 SPEC-020** — spec-sync가 이미 트레일러(`Spec-Impact`)를 소유하니 확장이 응집적. 단 FR 수 cap(현재 10) 근접.
