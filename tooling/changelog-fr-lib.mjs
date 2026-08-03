// tooling/changelog-fr-lib.mjs
// Change Log가 선언한 FR의 **실재** 대조 순수 코어 (SPEC-037).
//
// 실측 공백(소비 프로젝트 operations-dashboard SPEC-017): Change Log에 `**FR-018 신규: Jira 댓글
// 삭제** — DELETE /api/jira/comments`처럼 3개 행이 있고 코드도 정상 동작하는데, **FR-016/017/018의
// 본문이 Functional Requirements 절에 없었다**(FR-015 다음이 FR-019). 3개 surface의 동작 계약이
// 몇 달간 SSOT 밖에 있었고 어떤 게이트도 막지 못했다.
//
// 두 규칙이 각자 정당한 이유로 이걸 흘렸다:
//   ① check-spec-sync는 `FR / Edge Cases / Change Log` **택1**로 만족된다 — 순수 구현 버그가 FR을
//      건드리지 않는 것이 옳으므로 이 탈출구 자체는 설계다. 없앨 것이 아니라 **거짓 선언만** 잡는다.
//   ② 결번 advisory 문구가 "FR 폐기 잔분일 수 있음"이라, **폐기 흔적(정당)**과 **선언만 하고 본문을
//      안 쓴 것(결함)**이 같은 문장으로 나온다. 의미가 정반대인데 구분이 없어 로그에 섞여 흘러간다.
//
// 그래서 판정 소스를 **여기 하나**로 둔다 — 이 코어가 뽑은 선언 집합을 새 검사와 결번 advisory가
// 함께 소비한다(같은 사실을 두 게이트가 상반되게 말하지 않게).
// 순수 함수(IO 없음) — 파일 읽기는 소비 게이트. Python 미러(SPEC-006).

import { sectionBlock } from "./lifecycle-lib.mjs";

// 선언 어휘 — **프로젝트마다 다르다.** 킷은 `신설`, 제보 프로젝트는 `신규`를 쓴다.
// 어휘를 코드에 못 박으면 표현이 한 글자 다른 저장소에서 게이트가 통째로 inert가 된다
// (침묵은 근거가 아니다 — 문구가 안 맞아 0건인 것과 진짜 0건인 것이 구분되지 않는다).
export const DEFAULT_CHANGELOG_NEW_VERBS = ["신규", "신설", "추가", "도입"];
export const DEFAULT_CHANGELOG_REVISE_VERBS = ["개정", "변경", "수정"];
export const DEFAULT_CHANGELOG_RETIRE_VERBS = ["폐기", "삭제", "제거", "철회"];

const pad3 = (n) => String(n).padStart(3, "0");
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 기저 번호로 접기 — `FR-004b`는 004다(서픽스는 별개 ID지만 결번을 만들지 않는다, SPEC-014 동형).
const baseNum = (n) => parseInt(String(n), 10);

// Change Log **표 행**에서 선언성 FR 참조를 뽑는다.
//   text     : 스펙 전문
//   reqAlt   : 요구 접두어 alternation(config 파생 — 자체 정규식 금지, SPEC-001 FR-009)
//   idAlt    : spec-ID 접두어 alternation(타 스펙 참조 배제용)
//   verbs    : {neu:[], rev:[], ret:[]}
// 반환 { declared: Map(num -> {id, verb}), retired: Set(num) }
//   declared = 신규∨개정 선언(본문이 **있어야** 하는 것) / retired = 폐기 선언(없어도 정당)
export function changeLogFrRefs(text, reqAlt = "FR", idAlt = "SPEC", verbs = {}) {
  const neu = verbs.neu && verbs.neu.length ? verbs.neu : DEFAULT_CHANGELOG_NEW_VERBS;
  const rev = verbs.rev && verbs.rev.length ? verbs.rev : DEFAULT_CHANGELOG_REVISE_VERBS;
  const ret = verbs.ret && verbs.ret.length ? verbs.ret : DEFAULT_CHANGELOG_RETIRE_VERBS;
  const declared = new Map();
  const retired = new Set();

  const block = sectionBlock(String(text || ""), "Change Log");
  if (block === null) return { declared, retired };

  const declVerb = [...neu, ...rev].map(esc).join("|");
  const retVerb = ret.map(esc).join("|");
  // 타 스펙 FR 참조는 **내 FR이 아니다** — `SPEC-013/FR-003`·`SPEC-017 FR-004b`·`SPEC-017의 FR-018`.
  // 판정 전에 통째로 지운다(치환이 아니라 공백으로 — 남기면 뒤 토큰과 붙어 새 오탐을 만든다).
  const crossRe = new RegExp(`(?:${idAlt})-\\d{3}[a-z]?\\s*(?:\\/|의\\s*|\\s+)(?:${reqAlt})-\\d{3}[a-z]?`, "g");
  // `FR-016/017 신규` 처럼 번호가 이어 나열되는 형태를 한 참조로 묶는다.
  const refRe = new RegExp(
    `(?:${reqAlt})-(\\d{3})([a-z]?)((?:\\s*[\\/·,]\\s*\\d{3}[a-z]?)*)\\s*\\**\\s*(${declVerb}|${retVerb})`,
    "g",
  );

  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;                 // 표 행만 — 절 안의 주석·산문은 기록이 아니다
    const scrubbed = line.replace(/`[^`]*`/g, " ").replace(crossRe, " ");
    for (const m of scrubbed.matchAll(refRe)) {
      const nums = [baseNum(m[1]), ...(m[3] || "").split(/[\/·,]/).map((s) => s.trim())
        .filter(Boolean).map(baseNum)].filter((n) => Number.isFinite(n));
      const verb = m[4];
      const isRetire = ret.includes(verb);
      for (const n of nums) {
        if (isRetire) { retired.add(n); declared.delete(n); continue; }
        if (retired.has(n)) continue;                    // 폐기가 이미 선언됐으면 그 번호는 없어도 정당
        if (!declared.has(n)) declared.set(n, { id: `${String(reqAlt).split("|")[0]}-${pad3(n)}`, verb });
      }
    }
  }
  return { declared, retired };
}

// 최종 판정 — 선언된 번호가 FR 절에 실재하는가.
//   declared : changeLogFrRefs의 declared
//   frIds    : 그 스펙의 FR 선언 ID 배열(frDeclarations 결과 — 기존 파서 재사용)
// 반환 [{specId, id, verb}] — 번호 순(결정적).
export function changeLogFrFindings(specId, declared, frIds) {
  const present = new Set();
  for (const raw of frIds || []) {
    const m = /-(\d{3})[a-z]?$/.exec(String(raw).trim());
    if (m) present.add(baseNum(m[1]));
  }
  const out = [];
  for (const n of [...declared.keys()].sort((a, b) => a - b)) {
    if (present.has(n)) continue;
    out.push({ specId, id: declared.get(n).id, verb: declared.get(n).verb });
  }
  return out;
}
