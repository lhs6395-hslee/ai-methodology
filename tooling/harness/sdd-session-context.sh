#!/bin/sh
# SessionStart hook — 세션 진입 시 방법론 궤도·진입규칙을 컨텍스트에 주입.
# 설계: docs/design/2026-07-01-methodology-enforcement-hooks-design.md §5
# (JSON 주입이 필요하면 이 텍스트를 additionalContext로 감싼다.)
cat <<'EOF'
[SDD 방법론 — 이 프로젝트는 채택된 강제 궤도 위에서 돈다]
궤도: spec → code → test → sync (이탈은 hook·게이트가 되돌림)
진입 규칙(새 기능/수정 시 반드시):
  1) MODULE_MAP.md 대조 — 기존 spec과 겹치면 그 spec 개정, 아니면 새 spec
  2) spec 위치 = sdd/specs/ (docs/superpowers/specs/ 아님)
  2b) 설계 문서(pre-spec, 승인 전) 위치 = docs/design/ (docs/superpowers/specs/ 아님, STORAGE §2.7)
  3) PREFIX 표준 = SPEC / INFRA / TEST / CICD 만 (FEAT 등 임의 생성 금지)
  4) FR은 EARS, 테스트는 @covers <PREFIX>-NNN/FR-NNN
  5) 진입 순서는 작업 유형에 따라 갈린다(superpowers 기본 흐름 대신 이 프로젝트 규약):
     - 신규 기능(없던 capability/FR): spec에 FR(EARS) 먼저 확정 → 코드 → 테스트
     - 버그 수정(기존 동작이 명세와 다름): 재현 실패 테스트로 RED 먼저 확인 → GREEN → 스펙 갱신(/speckit.fix)
     - 공통: 스펙·코드는 같은 changeset — 디스크에 뭘 먼저 썼는지는 게이트가 안 묻는다
게이트(품질): check-fr-coverage(+검증회계·접두어↔클래스)·check-ownership(+entity 레지스트리·Files 카테고리 금지)·check-spec-cohesion·check-spec-completeness(SC·수명주기·근거·문법 규범)·check-spec-consistency
게이트(보강·spec-first): check-test-adequacy·check-converge-drift·check-orphan-surfaces·check-spec-sync(commit-msg hard — Draft 차단·unowned 정책·글롭 문법)
게이트(재도출·증거): check-derivation(소스 9클래스 회계)·sdd-smoke-scan(검증 태그↔smokeManifest 드리프트)
동기화: /sdd-sync (drift 점검), pre-push 훅
EOF
