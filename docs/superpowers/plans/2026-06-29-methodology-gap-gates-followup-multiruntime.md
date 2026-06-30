# 후속: 보강 게이트 3종 다중 런타임 포팅 (범위 메모)

본 계획(2026-06-29-methodology-gap-gates.md)은 보강 게이트 3종(test-adequacy·converge-drift·orphan-surface)을 **Node 레퍼런스 + advisory(warn, exit 0)** 로만 추가했다. 셸/Python/Go판으로 포팅해 기존 게이트(fr·ownership)와 동일한 **4판 패리티**를 달성하는 것은 **별도 계획**으로 분리한다.

현재 단계는 Node 레퍼런스 + advisory로 **가치 검증 우선** — 가시화로 효용을 확인한 뒤 strict 승격/다중 런타임 포팅을 진행한다.

## 검증 결과 (이 계획 실행 시점)
- 새 게이트 테스트: `node --test tooling/__tests__/*.mjs` → 6/6 PASS (3개 게이트 × 2 케이스). (Node 20–22는 디렉토리 형식 `tooling/__tests__/`도 가능하나 Node 25.5는 글로브 필요.)
- 기존 게이트(check-fr-coverage·check-ownership) 회귀 없음: 새 config 키(assertionPatterns·surfaceGlobs)는 DEFAULTS에 하위호환 추가되어 기존 게이트 동작 불변.
