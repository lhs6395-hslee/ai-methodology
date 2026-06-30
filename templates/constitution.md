# [PROJECT] Constitution (범용 템플릿)

> 모든 spec·code를 지배하는 횡단 불변식(cross-cutting invariants). 개별 spec은 이것을 **재서술하지 않고 참조**한다. Operative language: **English**(`SSOT.md` §6). Domain: **[프로젝트 도메인]** — (필요 시) "이 프로젝트는 X가 아니다" 명시.
> Spec Kit `/speckit.constitution`으로 생성·갱신하면 `/analyze`가 spec·plan·tasks의 준수를 점검한다.

## Core Principles

### I. Spec = 요구 SSOT, 테스트 = 자물쇠 (NON-NEGOTIABLE)
각 기능 모듈은 살아있는 spec("무엇을/왜")을 소유한다. spec은 **실행 가능한 테스트 스위트가 강제할 때만** 신뢰된다. 따라서 모든 FR은 **언어중립 ID(`FR-001`)** 를 갖고, 모든 FR은 `@covers <SPEC-ID>/FR-NNN` 로 태깅된 테스트 ≥1개를 가진다(주석 스타일은 언어 자유 — `//`·`#`·`--` 모두 인식). Spec Kit은 스캐폴더이지 강제자가 아니다 — **CI 드리프트 게이트가 강제자**다. (게이트는 `sdd.config.json` 어댑터로 언어·모델·인프라 무관하게 동작.)

### II. Test-First (NON-NEGOTIABLE)
TDD 필수: 실패 테스트(RED) → 최소 구현(GREEN) → 완료 선언 전 검증. 테스트가 CI에서 통과하지 않으면 어떤 기능도 "완료"가 아니다.

### III. 작성=LLM, 승인=사람 (NON-NEGOTIABLE)
spec 작성·갱신(top-down·bottom-up 모두)은 LLM이, 정본화(bless/revert)는 사람이. 사람 승인 없는 코드→spec 자동 덮어쓰기 금지(spec이 코드 거울로 전락).

### IV~. [프로젝트별 도메인 불변식]
[예: 단일 계산 공식 / 단위 규약 / 제외 규칙 등 — 그 프로젝트에서 절대 깨지면 안 되는 도메인 규칙을 여기 NON-NEGOTIABLE로 박는다. 개별 spec은 이를 참조만.]

## Quality Gates
- `spec ↔ plan ↔ tasks`: Spec Kit `/speckit.analyze` + `/speckit.checklist`.
- `FR ↔ test`: FR-ID 태그 + CI 체크(모든 FR이 ≥1 테스트에 매핑; 태그 없는 테스트 변경은 리뷰).
- `test ↔ code`: TDD(RED→GREEN) + verification-before-completion(Superpowers).
- EARS preset은 **Spec Kit 비공식 커스터마이즈**(Issue #1356) — Spec Kit 업그레이드마다 재정합.

## Technology Constraints
- [스택/프레임워크 제약]. UI 언어(예: 한국어)는 **spec operative 언어와 별개**.
- **인프라 전환 시(예: DB 교체):** spec + 테스트를 **현 인프라에서 먼저 확립**한 뒤, 테스트가 green을 유지한 채 인프라를 교체한다(테스트가 안전망).

## Governance
이 헌법은 임시 관행에 우선한다. 개정은 아래 날짜 항목 + 근거 필요. PR은 Core Principles와 Quality Gates 준수를 검증한다. **SC 수치 목표는 베이스라인 측정 전까지 잠정** — 확정(ratify) 전 외부 인용 금지.

**Version**: 1.0.0 | **Ratified**: [YYYY-MM-DD] | **Last Amended**: [YYYY-MM-DD]
