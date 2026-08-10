# Feature Specification: External Target (소유는 파일 단위인데 결정은 파일 안에 있다)

**Module**: `sdd-tooling`  **Spec**: `SPEC-044`  **Created**: 2026-08-10  **Status**: Active
**Input**: 소비 프로젝트 실측 제보(2026-08-10) — 소유·커버리지·spec-sync가 전부 초록인 파일 안에 환경변수 폴백 한 줄이 있었고, 그 한 줄이 "환경변수가 없으면 **이 외부 시스템**을 친다"는 결정을 담고 있었다. 어떤 요구도 그 대상을 인정하지 않았다. 소유 게이트는 파일이 스펙에 붙어 있는지만 보고 파일 **안**을 보지 않으므로, 배포 대상이 조용히 바뀌어도 모든 축이 초록을 유지한다. 제보의 물음: 소유의 입도가 파일이면 파일 안의 결정은 누가 보는가.

---

## User Scenarios & Testing

### User Story 1 — 외부 대상은 구현 세부가 아니라 계약이다 (P1)
환경변수 폴백 기본값이 다른 시스템의 주소·계정·자격이면 그것은 "이 시스템이 저 시스템을 친다"는 계약이다. 계약은 스펙이 안다 — 소유 스펙 본문이 그 대상을 언급해야 한다.
- **Independent Test**: `external-target.test.mjs`가 순수 코어(세 언어 관용구·외부 대상 판별·로컬 제외·호스트 인정·주석 인용 제외·중복 제거)를 단독 검증. [검증: tooling/__tests__/external-target.test.mjs]
- **Acceptance (GWT)**: 1. **Given** an owned file whose environment fallback default is an external address, **When** the owning spec does not mention that target, **Then** the gate surfaces it.

### User Story 2 — 소유의 입도를 줄 단위로 낮추지 않는다 (P1)
모든 상수에 요구를 붙이면 스펙이 코드의 사본이 되고, 그 순간 아무도 스펙을 읽지 않는다. 좁히는 것은 입도가 아니라 **결정의 종류**다: 외부 대상만 본다.
- **Independent Test**: 같은 테스트가 로컬·자리표시자·비대상 값(로그 레벨·버전·소켓 경로)이 걸리지 않음을 검증. [검증: tooling/__tests__/external-target.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a fallback default that is a local host or a non-target literal, **When** the gate runs, **Then** it is not reported.

### User Story 3 — 언급 위치는 강제하지 않는다 (P2)
대상이 요구절에 있든 Edge Cases에 있든 Story에 있든 스펙은 그 대상을 안다. 위치를 강제하면 문서 구조 싸움이 되고 본 신호가 묻힌다. 호스트만 적어도 인정한다 — 전체 URL 복붙을 요구하면 스펙이 코드의 사본이 된다.
- **Independent Test**: 같은 테스트가 호스트만 언급한 스펙에서 통과하는 것을 검증. [검증: tooling/__tests__/external-target.test.mjs]
- **Acceptance (GWT)**: 1. **Given** a spec that names only the host of the target, **When** the gate runs, **Then** the target is treated as disclosed.

### Edge Cases
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
- **미소유 파일은 판정하지 않는다** — 미소유는 spec-sync(R4)의 사실이다.
- **주석 속 예시는 인용이지 결정이 아니다** — 전체가 주석인 줄만 걷어낸다. 킷에 이 축을 처음 걸었을 때 판정 코어 자신의 설명 주석에 적힌 예시 URL이 위반으로 잡혔다.
- **줄 안쪽의 `//`는 절대 자르지 않는다** — `"https://host"`의 `//`를 자르면 게이트가 정확히 봐야 할 자리에서 눈이 먼다.
- **표현식 폴백은 판정하지 않는다** — 다른 변수·함수 호출로 폴백하면 대상을 정적으로 알 수 없다. 모르는 것을 위반으로 말하지 않는다.
- **같은 파일의 같은 폴백은 한 번만 센다** — 건수가 부풀면 사람이 목록을 안 읽는다.
- **환경변수가 실제로 주입되는지는 보지 않는다** — 그건 라이브 대조(SPEC-032)의 축이다.
- 테스트 파일도 대상이다 — 실측 사례의 폴백은 e2e 설정에 있었다. 그래서 이 spec의 픽스처가 쓰는 가짜 외부 대상 `a.vendor.io`·`b.vendor.io`·`api.vendor.io`도 이 축에 걸린다. 해소는 면제 목록이 아니라 **여기 적는 것**이다 — 픽스처라도 "이 저장소가 이 호스트 문자열을 담고 있다"는 사실은 참이고, 스펙이 그 사실을 알면 나중에 진짜 대상이 섞여 들어와도 이 줄과 대조된다(면제였다면 조용히 통과했을 자리다).
- 기본 `advisory`. `hard`는 기존 미공개가 0으로 수렴한 뒤가 종착지다.

---

## Functional Requirements (EARS)
> 정본은 영어. 요구 ID 예시는 게이트가 팬텀 FR로 집계하므로 본문에 리터럴로 적지 않는다(SPEC-002 규칙).

- **FR-001** (event): WHEN an owned file declares an environment-variable fallback with a quoted literal default, the **external-target** (E) core in **external-target-lib.mjs** (S) SHALL classify that literal as a url, arn, account, endpoint, or not an external target, treating local and placeholder hosts as not external and ignoring lines that are entirely comments. — capability: **external-target.disclose** (C).
- **FR-002** (unwanted): IF the default is an external target and the owning spec's text contains neither the literal nor its host, THEN **check-fr-coverage.mjs** (S) SHALL report it as undisclosed, warning under advisory and exiting non-zero under hard.
- **FR-003** (state): WHILE a file has no owning spec, THE SYSTEM SHALL make no judgement about it on this axis; WHERE the fallback default is an expression rather than a quoted literal, THE SYSTEM SHALL make no judgement rather than guessing the target.

### Key Entities
- **external-target** — another system this one addresses by default when its environment says nothing, as distinct from an ordinary constant, so that a silently changed deployment target cannot stay green.

---

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts/Capabilities).
- **Modules**: external-target
- **Symbols**: external-target-lib.mjs
- **Artifacts**: —
- **Capabilities**: external-target.disclose
- **Files**: tooling/external-target-lib.mjs, tooling/__tests__/external-target.test.mjs

## Dependencies (참조 — dedup 제외)
> 소유 해석은 SPEC-003, 라이브 대조는 SPEC-032, 판정 종류는 SPEC-040, Python 복제는 SPEC-006 소유.
- **Modules**: spec-sync (references), live-reality (references), gate-verdict (references)
- **Symbols**: check-fr-coverage.mjs

---

## Success Criteria (측정형)
- **SC-001**: `external-target.test.mjs` 전 케이스 green — 세 언어 관용구·표현식 무판정·외부/로컬/비대상 판별·호스트 인정·실측 재현·미소유 무판정·주석 인용 제외·줄 안쪽 보존·중복 제거. [검증: tooling/__tests__/external-target.test.mjs]
- **SC-002**: 판정 출력이 Node↔Python 바이트 동일하다. [검증: tooling/__tests__/sdd-gates-py.test.mjs]
- **SC-003**: 킷 자기적용에서 미공개 외부 대상 0건이며, 그 0건이 "안 봤음"이 아니라 검사한 소유 파일 수와 함께 출력된다. [검증: tooling/__tests__/external-target.test.mjs]

## Non-Functional Requirements
- **NFR-001**: 판정 코어는 문자열·정규식 대조만의 순수 함수이고 파일 읽기·소유 해석은 소비 게이트가 주입하므로, 저장소 없이 코어를 단독 테스트할 수 있다. [검증: tooling/__tests__/external-target.test.mjs]

## Assumptions / Clarifications Retained
- 그 주소가 **옳은지**는 판정하지 않는다 — 스펙이 대상을 알기만 하면 그 다음은 리뷰의 몫이다(존재는 기계, 질은 리뷰).
- **기각한 대안:** 소유의 입도를 심볼·줄 단위로 낮추는 방식. 모든 상수에 요구를 붙이면 스펙이 코드의 사본이 되고 아무도 읽지 않는다 — SPEC-033이 이미 거부한 방향이다. 재검토 조건: 없음.
- **기각한 대안:** 언급 위치를 요구절로 못박는 방식. 문서 구조 싸움이 되고 본 신호가 묻힌다. 재검토 조건: 없음.
- **기각한 대안:** 전체 URL 문자열의 스펙 내 일치를 요구하는 방식. 경로·쿼리까지 복붙해야 하고 그건 사본이다. 호스트 일치로 충분하다. 재검토 조건: 없음.
- **기각한 대안:** 소스 전반의 하드코딩 URL을 전부 잡는 방식. 폴백이 아닌 URL은 문서 링크·예시·정규식 등으로 대량 오탐을 낸다. 폴백 관용구로 좁히면 "환경이 말하지 않으면 여기로 간다"는 결정만 남는다. 재검토 조건: 폴백이 아닌 경로로 대상이 바뀐 실측이 나오면 마커를 넓힌다.

## Review Log
<!-- Reviewed 승격 조건: /analyze·/checklist 수준 검토 결과 기록(일시·수행자·판정) — completeness 게이트가 존재를 검사 -->
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-08-10 | 셀프리뷰(순수 코어 TDD 8종·킷 자기적용 실측) + 소비 프로젝트 개선 요청(파일 안의 결정을 아무도 안 봄) → Active | FR-001~003 unit 커버. 킷 자기적용: 소유 파일 152건 검사, 미공개 0건(첫 실행에서 판정 코어 자신의 주석 예시가 잡혀 인용 제외 규칙을 추가) |

## Dedup-Review
<!-- 이웃 스펙과의 의미적 중복 검토 기록 — 게이트는 존재·형식만 검사(판정은 사람/LLM) -->
- 2026-08-10 이웃 SPEC-003(spec-sync): 비중복 — 003은 파일이 **어느 스펙에 속하는가**, 044는 그 파일 **안의 결정을 스펙이 아는가**다. 044는 003이 만든 소유 관계를 입력으로 쓴다.
- 2026-08-10 이웃 SPEC-032(live-reality): 비중복 — 032는 선언된 것이 **실환경에 있는가**(등록·실행), 044는 **선언되지 않은 대상이 코드에 있는가**다. 방향이 반대다.
- 2026-08-10 이웃 SPEC-035(deploy-guard): 비중복 — 035는 배포 행위의 전제·승인, 044는 배포 대상의 공개다.
- 2026-08-10 이웃 SPEC-042(term-coverage): 비중복 — 042는 스펙이 이름 댄 것이 코드에 있는가, 044는 코드가 이름 댄 것을 스펙이 아는가다. 같은 대조의 두 방향이고, 두 방향 모두 필요하다는 것이 제보의 요지다.

## Change Log
<!-- 필수(비우지 말 것): 버그픽스가 착지하는 자리 — check-spec-sync가 새 항목을 요구한다 -->
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-08-10 | 초안 — `externalTargetPolicy`(off\|advisory\|hard, 기본 advisory) + `externalTargetListCap` + `external-target-lib`(폴백 추출·외부 대상 판별·공개 판정) + `check-fr-coverage` R1d 배선 | 소비 프로젝트 제보: 소유·커버리지·spec-sync 전부 초록인 파일 안의 env 폴백 한 줄이 배포 대상을 정하고 있었고 어떤 요구도 그 대상을 인정하지 않았다. 소유 입도를 낮추면 스펙이 코드의 사본이 되므로 **결정의 종류**로 좁혔다 — 폴백 기본값이 외부 대상이면 그건 계약이다. 킷 자기적용 첫 실행에서 판정 코어 자신의 설명 주석에 적힌 예시 URL이 잡혀, 전체가 주석인 줄만 걷어내는 규칙을 추가했다(줄 안쪽 `//`를 자르면 `https://`를 못 본다) [검증: tooling/__tests__/external-target.test.mjs] |
