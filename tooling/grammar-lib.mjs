// tooling/grammar-lib.mjs
// 스펙 문법 규범 순수 코어 (SPEC-013) — 문서(STORAGE·STRUCTURE·METHODOLOGY·DEDUP)에 규범으로
// 선언됐지만 게이트가 없던 항목의 결정적 판정을 문법화한다:
//   · Module 헤더 존재(STORAGE §2.3 "본문 필수") + 값 단일성(STRUCTURE.md 1 레포 = 1 모듈)
//   · FR 선언 라인의 SHALL 토큰(EARS 5패턴 공통 필수 — METHODOLOGY EARS 규칙의 기계 신호).
//     라인 규율은 frDeclarations와 같은 `isFrDeclLine`(불릿 옵션) — 선언 라인 정의는 킷에 하나뿐
//   · FR "선언"의 범위(frDeclarations) — FR 섹션 안 라인 시작만. 산문·Change Log의 FR 인용 제외
//   · Dedup-Review 기록이 참조한 이웃 스펙 ID의 실재(DEDUP.md "존재·형식" 검사의 연장)
//   · ownershipCategories의 Files 금지(DEDUP.md §3 명시 금지 — 글롭이 dedup 키로 유입 방지)
// completeness·ownership 게이트가 소비. 질(EARS 어휘·측정가능성·판정 내용)은 리뷰 몫 —
// 존재·실재·고정 enum 등 기계 신호만 판정한다(과장 금지).
// 설계: SPEC-013 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

import { sectionBlock } from "./lifecycle-lib.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { isFrDeclLine } from "./key-anchor-lib.mjs";

// 스펙 헤더의 `**Module**: <name>` 파싱(백틱 유무 무관). 없으면 null.
export function parseModule(text) {
  const m = text.match(/\*\*Module\*\*\s*:\s*`?([^`\n]+?)`?\s*(?:\*\*|$)/m);
  return m && m[1].trim() ? m[1].trim() : null;
}

// FR 선언 라인(`- **FR-NNN**` / `**FR-NNN**` — 불릿 유무 무관) 중 SHALL 토큰이 없는 라인의 FR ID들.
// EARS 5패턴(ubiquitous/event/state/unwanted/optional) 모두 "THE SYSTEM SHALL"을 포함한다.
// 라인 규율은 `isFrDeclLine` 단일 정의를 쓴다(SPEC-013 FR-003). 자체 `^\s*-\s*`(불릿 **필수**)를
// 갖고 있던 동안 비불릿 스타일 선언은 SHALL 검사를 통째로 건너뛰었다 — 거짓 **음성**(실측: 소비
// 프로젝트 PM에 비불릿 선언 173줄, 마침 전부 SHALL을 갖고 있어 발견이 늦었다). FR-008이 "선언 =
// 라인 시작, 불릿 옵션"을 규범으로 세운 뒤 킷 안에 선언 라인 정의가 둘로 갈라졌고, 좁은 쪽만
// 진짜 EARS 결함을 조용히 흘렸다. 넓은 쪽으로 통일한다 — 판정 내용(advisory)은 그대로.
// frDeclSource = cfg.__frDeclRe.source (requirementIdPrefixes 파생 — 전 사이트 동일 문법).
// reqAlt = cfg.__reqAlt. **호출부는 반드시 넘긴다** — 기본값 "FR"에 맡기면 다중 접두어 사이트에서
// `**INFRA-001**` 선언이 라인 규율에서 탈락해 검사가 사라진다(실측 finops 11줄: 좁은 거짓 음성을
// 더 큰 거짓 음성으로 바꾸는 함정). 기본값은 접두어를 커스터마이즈하지 않은 사이트·테스트 편의용.
// 라인 단위 판정(다중행 서술이면 선언 라인에 SHALL이 오도록) — advisory 신호.
export function frLinesMissingShall(text, frDeclSource, reqAlt = "FR") {
  const idRe = new RegExp(frDeclSource);
  const out = [];
  for (const line of text.split("\n")) {
    if (!isFrDeclLine(line, reqAlt)) continue;   // 라인 시작 규율은 여기 단일 정의(중복 정규식 금지)
    const m = line.match(idRe);                  // isFrDeclLine이 라인 시작을 보장 → 첫 토큰이 선언
    if (m && !/\bSHALL\b/.test(line)) out.push(m[1]);
  }
  return out;
}

// FR "선언"의 범위 판정(SPEC-013 FR-008) — 문법(`cfg.__frDeclRe`)이 아니라 **어디를 스캔하는가**를
// 좁힌다. 문서 전문에서 bold FR 토큰을 긁으면 산문 참조가 선언으로 집계돼, 이관·흡수 이력을 적은
// Change Log 표 행(`| 2026-07-27 | … **FR-037** … |`)이 거짓 "FR 번호 중복" hard를 낸다(실측:
// 소비 프로젝트 PM SPEC-003 8건·SPEC-004 4건). 정규식은 SPEC-001 FR-009의 공유 문법이라 손대면
// cohesion·completeness·spec-sync·retag 전부에 파급되므로 **범위**만 좁히는 것이 옳다.
// 선언 = ① `## Functional Requirements` 섹션 안이고 ② 라인 시작(`isFrDeclLine` — 불릿 유무 무관.
// 실측: 소비 프로젝트가 `- **FR-057**`과 `**FR-057**` 두 스타일을 섞어 쓰므로 "불릿만"으로 좁히면
// 진짜 중복을 놓친다) ③ 그 라인의 **첫** FR 토큰(같은 라인 뒤쪽의 bold 상호참조는 선언이 아님).
// 표 행은 `|`로 시작해 ②에서 자연히 탈락한다 — Change Log가 FR ID를 굵게 참조하는 정당한 저술이
// 게이트에 막히지 않는다. FR 섹션이 없으면 전문으로 폴백(라인 규율은 유지 — 다른 섹션 명칭을 쓰는
// 사이트에서 선언 집합이 통째로 비어 dangling 폭발하는 것을 막는다).
// 반환: 선언 순서 그대로의 FR-ID 배열(중복 유지 — 중복 판정이 소비. Set은 중복을 삼킨다).
// frDeclRe: cfg.__frDeclRe(정규식 객체 또는 source 문자열). 순수 함수.
export function frDeclarations(text, frDeclRe, reqAlt = "FR") {
  const block = sectionBlock(String(text), "Functional Requirements");
  const scope = block === null ? String(text) : block;
  const re = new RegExp(frDeclRe && frDeclRe.source ? frDeclRe.source : String(frDeclRe));
  const out = [];
  for (const line of scope.split("\n")) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    const m = line.match(re);
    if (m) out.push(m[1]);
  }
  return out;
}

// FR 선언 문법의 **스펙 내 일관성**(SPEC-013 FR-009) — 한 스펙이 불릿(`- **FR-001**`)과
// 무불릿(`**FR-001**`)을 섞어 쓰면 advisory로 표면화한다. 탐지(FR-008)와 SHALL 판정(FR-003)은
// 의도적으로 불릿 유무 무관이라(소비 프로젝트가 실제로 섞어 쓰므로 좁히면 거짓 음성) 기계는 혼용을
// 그냥 통과시킨다 — 남는 피해는 **사람과 임시 도구** 쪽이다: 한쪽 문법만 보는 grep이 반대쪽을 통째로
// 놓친다(실측 PM SPEC-004: 불릿 57 + 무불릿 112가 공존해 진짜 FR 번호 중복 1건이 한쪽 문법 스캔의
// 거짓 음성으로 일주일 넘게 숨었다 — 킷 dup 게이트가 잡기 전까지).
// 판정 단위는 **스펙 하나**다. 저장소 전체를 한 문법으로 통일하라고 요구하지 않는다 — 템플릿의 규범
// 문장은 토큰 형태(`**FR-NNN** (패턴): 문장`)를 규정하고 불릿은 예시에만 나오므로, "불릿 필수"는
// 문서에 없는 새 의견이 된다(SPEC-013은 문서에 있는 규범만 게이트화한다). 반면 한 파일 안의 혼용은
// 실제로 사고를 낸, 저술 의도가 아닌 잡음이다 — 대개 스펙 흡수·병합의 이음매로 생긴다.
// 범위는 FR-008과 같은 규율(FR 섹션 안·라인 시작·라인의 첫 토큰)이되 **전문 폴백은 없다**:
// Assumptions·Change Log 같은 다른 절은 요구 ID를 불릿으로 정당하게 인용하므로, 폴백을 켜면 그
// 인용이 "불릿 쪽"으로 집계돼 거짓 혼용이 난다. 여기선 판정 유보가 안전한 방향이다(advisory 신호일
// 뿐 커버리지 입력이 아니라서 — 집합이 비면 dangling이 폭발하는 FR-008과 상황이 다르다).
// reqAlt는 호출부가 반드시 넘긴다(FR-003·FR-008과 동형 함정 — 생략하면 다중 접두어 사이트의
// `**INFRA-001**` 선언이 라인 규율에서 탈락해 판정이 조용히 사라진다). 순수 함수.
export function frDeclStyleFindings(text, frDeclRe, reqAlt = "FR") {
  const block = sectionBlock(String(text), "Functional Requirements");
  if (block === null) return [];
  const re = new RegExp(frDeclRe && frDeclRe.source ? frDeclRe.source : String(frDeclRe));
  const bulleted = [], plain = [];
  for (const line of block.split("\n")) {
    if (!isFrDeclLine(line, reqAlt)) continue;
    const m = line.match(re);                     // isFrDeclLine이 라인 시작을 보장 → 첫 토큰이 선언
    if (!m) continue;
    (/^\s*-/.test(line) ? bulleted : plain).push(m[1]);
  }
  if (!bulleted.length || !plain.length) return [];
  return [`FR 선언 문법 혼용 — 불릿 ${bulleted.length}건(예 ${bulleted[0]})과 무불릿 ${plain.length}건(예 ${plain[0]})이 한 스펙에 공존: 한쪽으로 통일하라(게이트의 선언 탐지는 불릿 유무 무관이라 통과하지만, 한쪽 문법만 보는 grep·리뷰가 반대쪽을 놓친다)`];
}

// Dedup-Review 섹션이 언급한 스펙 ID 중 실재하지 않는 것(오타·삭제 잔재) — 정렬 반환.
// 삭제된 이웃의 이력은 "이웃 없음(삭제됨)" 등 ID 없는 서술로 갱신한다(이력 자체는 보존).
export function dedupReviewDanglingIds(text, specIdRe, knownIds) {
  const block = sectionBlock(text, "Dedup-Review");
  if (block === null) return [];
  const seen = new Set();
  for (const m of block.matchAll(new RegExp(specIdRe.source, "g"))) seen.add(m[0]);
  return [...seen].filter((id) => !knownIds.has(id)).sort();
}

// ownershipCategories에 Files 금지(DEDUP.md §3) — Files는 spec-sync 소유선언 전용 필드로
// dedup 키가 아니며, 카테고리로 들어오면 glob 문자열이 키 유일성·형식검증에 유입돼 오판한다.
export function ownershipCategoriesFindings(categories) {
  return (categories || [])
    .filter((c) => String(c).trim().toLowerCase() === "files")
    .map((c) => `ownershipCategories에 "${c}" 금지 — Files는 spec-sync 소유선언 전용(dedup 키 아님, DEDUP.md §3)`);
}

// specSyncExemptGlobs 무결성 — 면제 목록은 강제의 통제면이므로 강제를 통째로 무력화하는 항목을
// 담을 수 없다. `sdd.config.presets.md`·`METHODOLOGY.md`가 **프로즈로** 금지("`sdd.config.json`
// 자신은 넣지 말 것 — 감사 T1")하던 것을 게이트로 승격한다(ownershipCategories Files 금지와 동형).
// 금지 2종:
//   ① config 파일 자신을 매치하는 글롭(직접·`*.json`·`**/*` 등 어떤 표기든 — 실제 매치로 판정).
//      등재되면 config 변경이 스펙 동반 없이 무흔적 통과해 다른 모든 우회로(정책 하향·면제 확대·
//      상한 상향)가 영속 흔적 0으로 실행된다(감사 A-4 실측: 소비 프로젝트가 실제로 등재).
//   ② 전면 면제(`**`·`**/*`) — unowned closed-world(SPEC-003 FR-010)와 spec-first 동반 요구가
//      한 줄로 공허해진다.
// 게이트 코드 디렉토리(`scripts/**`)는 **의도적으로 제외** — 설치된 하네스의 소유 처방이 방법론에
// 없어(감사 M-14: error면 /sdd-update 자체가 커밋 불가, exempt면 게이트 코드가 무흔적 구역) 금지가
// 처방 없는 강요가 된다. M-14 해결(하네스 소유 규범 신설) 시 이 목록에 추가 검토.
// configRel: repo 루트 기준 config 상대경로(호출부가 주입 — 서브디렉토리 채택 지원). 순수 함수.
export function exemptGlobFindings(globs, configRel = "sdd.config.json") {
  const findings = [];
  for (const raw of globs || []) {
    const g = String(raw).trim();
    if (!g) continue;
    if (g === "**" || g === "**/*") {
      findings.push(`specSyncExemptGlobs "${g}" — 전면 면제 금지: 모든 경로를 면제하면 unowned closed-world와 spec-first 동반 요구가 공허해진다(생성물·락파일처럼 좁은 범위로 선언하라)`);
      continue;
    }
    let re;
    try { re = compileGlob(g); } catch { continue; }
    if (re.test(configRel)) {
      findings.push(`specSyncExemptGlobs "${g}" — config 파일(${configRel}) 면제 금지: config는 강제의 통제면이라 변경에 스펙 동반(영속 흔적)을 강제해야 한다 — 소유 스펙 Files에 편입하라(감사 T1)`);
    }
  }
  return findings;
}
