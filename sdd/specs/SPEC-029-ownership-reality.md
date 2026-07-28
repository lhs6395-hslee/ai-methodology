# SPEC-029: ownership-reality

**Module**: `sdd-tooling`  **Spec**: `SPEC-029`  **Status**: Active

**Input**: 소유 키의 **실재 판정**이 정규식 어댑터에 위임돼 있었다. entity 실재(SPEC-026)는 `entitySchemaSources`가, surface 실재는 — 아무도 판정하지 않았다. 어댑터는 프로젝트가 자유롭게 쓰는 신뢰 경계라 느슨하게 쓰면 판정이 조용히 퇴화한다(실측 우회 4경로: 임포트문을 스키마 선언으로 셈 · 주석 처리된 DDL 채택 · 스펙 자기참조 · 소스를 비워 inert화). surface 쪽은 `check-orphan-surfaces`가 **역방향**(코드→선언)만 보므로 "선언된 표면이 실제로 존재하는가"는 정방향 판정 자체가 없었다(감사 M-2, ROADMAP 보류 `surfaceSources`). owner 요구는 넷이다 — 하드 강제 · **문법으로 표현** · 예외 최소(목표 0) · 사람이 읽을 수 있게.

**Decision**: 어댑터를 **문법**으로 보강한다. 두 문법은 저장소 사실에 직접 대응해 어댑터로 흉내 낼 수 없다.

- **① 모듈 문법** — entity 역할 키는 그 스펙 **파일명의 슬러그**여야 한다(`1 spec = 1 모듈` 레포). `entitySchemaSources`에 `{kind:"spec-slug"}`를 선언하면 활성. 스키마가 정본인 레포는 기존 글롭·패턴 소스를 쓰고, 모듈이 정본인 레포는 이 문법을 쓴다 — **배타가 아니라 소스 종류로 공존**한다(정책은 `entitySchemaBackingPolicy` 하나 그대로).
- **② 심볼 문법** — surface 역할 키는 선언된 **소스 루트 아래 실재하는 파일 또는 디렉토리**여야 한다(basename 매치, 재귀). `ownershipSourceRoots` + `symbolRealityPolicy`로 제어.

예외 목록을 두지 않는다. 불일치는 면제 등록이 아니라 **데이터 교정**으로 닫는다 — 파일명을 키에 맞추거나, 키를 실물 이름에 맞추거나, 소스 루트를 선언한다.

## Functional Requirements (EARS)

- **FR-001** (event): WHEN `entitySchemaSources`에 `{kind:"spec-slug"}`가 선언되면, THE **ownership-reality** (E) judgment in **ownership-reality-lib.mjs** (S) SHALL treat each spec's filename slug as a reality witness for that spec's own entity keys, comparing per spec rather than against a global set, so that two specs swapping each other's slugs is a violation even though key uniqueness holds.
- **FR-002** (event): WHEN a spec filename matches `<PREFIX>-NNN[a]-<slug>.md`, **ownership-reality-lib.mjs** (S) SHALL derive the slug as the remainder after the numbered prefix, lowercased and trimmed; WHERE the filename carries no numbered prefix, THE SYSTEM SHALL use the basename without extension.
- **FR-003** (state): WHILE `symbolRealityPolicy` is not `off`, **check-ownership.mjs** (S) SHALL report each owned file-like surface key that names no file or directory under any declared `ownershipSourceRoots` entry, naming the spec, the key, and the roots searched — advisory prints a warning and exits zero, `hard` exits non-zero.
- **FR-004** (unwanted): IF a surface key is not file-like — it contains whitespace (`POST /api/x`), carries a scheme prefix (`event:`·`job:`), or starts with `/` — THEN **ownership-reality-lib.mjs** (S) SHALL exclude it from the symbol grammar, so that HTTP-surface repositories are never mis-flagged.
- **FR-005** (event): WHEN `symbolRealityPolicy` is `hard` but the judgment cannot be established — `ownershipSourceRoots` empty or the surface role category unresolved — **check-ownership.mjs** (S) SHALL print the inert reasons and exit non-zero, because a `hard` declaration that asserts nothing is false safety.
- **FR-006** (event): WHEN the ownership map is generated, **gen-ownership-map.mjs** (S) SHALL fill each surface key's reality cell from the same symbol-grammar findings the gate uses, distinguishing forward per-key judgment from the reverse-only orphan gate and from `미판정`.
- **FR-007** (unwanted): IF `symbolRealityPolicy` holds a value outside `off|advisory|hard`, THEN **check-ownership.mjs** (S) SHALL exit non-zero naming the offending value, matching the enum discipline of every other strength knob.

## Success Criteria (측정형)

- **SC-001**: 킷 자기적용에서 모듈 문법 29/29 · 심볼 문법 52/52 성립, **예외 0**.
- **SC-002**: `sdd/OWNERSHIP_MAP.md`의 실재 칸 `미판정` 수가 0(도입 전 79).
- **SC-003**: 키를 실재하지 않는 이름으로 바꾸면 두 문법 각각 exit 1 — 침묵하지 않는다.
- **SC-004**: `symbolRealityPolicy: off`(기본)인 레포의 게이트 출력·exit는 도입 전과 바이트 동일.

## Ownership (중복 방지 — 강제됨)
> 이 spec이 유일하게 소유하는 키(카테고리 = Modules/Symbols/Artifacts).
- **Modules**: ownership-reality
- **Symbols**: ownership-reality-lib.mjs
- **Artifacts**: —
- **Files**: tooling/ownership-reality-lib.mjs, tooling/__tests__/ownership-reality.test.mjs

## Dependencies
- **Modules**: entity-schema-backing (references), key-pipeline (references), ownership-map (references), spec-quality-gates (references)
- **Symbols**: check-ownership.mjs, gen-ownership-map.mjs

## Non-Functional Requirements
- **NFR-001** (portability): 판정 코어는 순수(문자열·집합)이며 파일 IO는 소비 게이트가 한다 — 언어·인프라 무관.
- **NFR-002** (compatibility): 두 문법은 옵트인이다. 미선언 사이트의 출력은 바이트 불변(SC-004).

## Assumptions / Clarifications Retained
- 디렉토리를 심볼로 인정한다 — `go-gate`처럼 디렉토리 자체가 표면인 경우가 실재한다(킷 실측).
- basename 매치이므로 같은 이름이 여러 디렉토리에 있어도 실재로 인정한다. 키의 유일성은 dedup(SPEC-002)이 이미 별도로 강제하므로 중복 판정을 여기서 다시 하지 않는다.
- 모듈 문법은 `1 spec = 1 모듈` 레포의 규범이다. 한 스펙이 여러 모듈을 소유하는 레포에는 맞지 않으며, 그 경우는 cohesion(`maxAggregateRootsPerSpec`)이 이미 분할을 권고한다.

## Review Log
| 일시 | 수행자 | 판정 |
|---|---|---|
| 2026-07-28 | 이홍섭 (소유자) | PASS — "방법론에 입각해서 하드하게" 지시에 따라 어댑터 위임을 문법으로 보강. 실측(29/29·52/52·예외 0) 확인 후 hard 채택 승인 |

## Dedup-Review
- SPEC-026(entity-schema-backing): 비중복 — 정책·면제·어댑터는 SPEC-026 소유, 이 spec은 **문법 코어**만 소유하고 SPEC-026의 판정에 소스 종류 하나를 더한다.
- SPEC-003(spec-sync): 비중복 — `check-orphan-surfaces`의 역방향 판정은 SPEC-003 소유, 이 spec은 정방향만.
- SPEC-028(ownership-map): 비중복 — 맵 생성·표 형식은 SPEC-028 소유, 이 spec은 그 맵이 소비하는 판정을 제공.

Acceptance: Given 킷 자신의 스펙 29개, When `check-ownership.mjs`를 `entitySchemaSources: [{kind:"spec-slug"}]`·`ownershipSourceRoots: ["tooling","prompts"]`·두 정책 `hard`로 실행하면, Then 위반 0건으로 exit 0이고, 임의의 모듈 키 또는 심볼 키를 실재하지 않는 이름으로 바꾸면 각각 exit 1로 그 키를 지목한다.

## Change Log
| 날짜 | 변경 | 근거 |
|---|---|---|
| 2026-07-28 | 신설 — 모듈 문법·심볼 문법 + `ownershipSourceRoots`·`symbolRealityPolicy`. 킷 자기적용 hard 채택(실측 29/29·52/52·예외 0), 맵 실재 미판정 79→0 | owner: "방법론에 입각해서 하드하게 보고 업데이트 / 문법이어야하는거애 / 예외조건은 최소로해야해". 어댑터 위임의 실측 우회 4경로 + surface 정방향 판정 부재(감사 M-2)를 문법으로 닫는다. 데이터 교정 4건(스펙 파일명 2건 rename, 소스 루트 선언, 디렉토리 인정)으로 예외 0 달성 |
