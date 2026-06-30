# 스펙 리뷰 체크리스트 (코드리뷰하듯 spec 리뷰)

| 점검 항목 | 무엇을 잡나 | 게이트 | 자동/수동 |
|---|---|---|---|
| **빈 공란** | `[NEEDS CLARIFICATION]` 미해소 | `/speckit.clarify`(찾아 질문→반영) + `/analyze`(마커 플래그) | 반자동 |
| **중복(한 기능 내)** | 같은 요구가 spec/plan/tasks에 중복 | `/speckit.analyze` | 자동 |
| **중복(spec 간) — 구조적** | 두 spec이 같은 Entity/Surface/Capability 소유 | **`check-ownership.mjs` 게이트(소유권 유일성)** | ★자동(CI) |
| **중복(spec 간) — 의미적** | 키는 다른데 의도 같음(reworded) | 같은 Entity 이웃 spec과 좁힌 LLM diff + (선택)임베딩 유사도 | 반자동 |
| **과대 spec(입도)** | 한 spec에 여러 기능 욱여넣음(under-fragmentation) — 키/FR 과다 | **`check-spec-cohesion.mjs` 게이트(dedup의 거울상, advisory)** | ★자동(CI) |
| **불완전 spec** | FR 있는데 SC·인수조건 없음 | **`check-spec-completeness.mjs`(존재만, advisory)** · 충족·측정가능성=`/checklist` | ★자동(CI) |
| **모순/충돌** | FR끼리 상충 | `/analyze` | 자동 |
| **커버리지 누락** | 수용기준인데 task/test 없음, FR인데 컴포넌트 없음 | `/analyze` | 자동 |
| **모호어·검증불가** | should/적절히, 측정불가 SC, 2동작 | EARS 작성규칙 + `/checklist` | 반자동 |
| **추적성 끊김** | FR↔plan↔task↔test 끊김 | `/analyze` + **FR-ID 태깅 + check-fr-coverage.mjs** | 자동(CI) |
| **원칙 위반** | constitution 위배 | `/speckit.constitution` | 반자동 |

**요약:** 빈공란=`/clarify`, 한 기능 내 중복·모순·누락=`/analyze`, 체크리스트=`/checklist`, FR↔test=CI 게이트. **spec 간 중복**은 — **구조적**(같은 소유 키)=소유권 게이트로 **강제**, **의미적**(reworded)=좁힌 LLM 리뷰로 보조. (LLM은 누락을 내므로 결정적 게이트가 1차. 상세: `DEDUP.md` / `STRUCTURE.md` 소유권 유일성 규칙.)

> 표기 규약: 위 `check-*.mjs`는 Node 파일명일 뿐 — 게이트는 Go 바이너리·셸·Python·Node 4판 동작 동일(`principles.md` §10), 소유 키 종류는 `sdd.config.json`의 `ownershipCategories`(웹 기본=Entity/Surface/Capability, 비-웹은 교체).
