// tooling/numbering-lib.mjs
// 번호 무결성 순수 코어 — 두 층위를 한 aggregate로 소유한다 (SPEC-014).
//   ① spec-ID 번호(접두어별 001 순차): numberingIssues
//        hard    : 중복 (prefix,num) / 최소 번호 ≠ 001(전역 잔번·잘못된 시작) / 폐기 ID 재사용
//        advisory: 실제 최소~최대 사이 내부 결번(제거·retag가 정당히 남기는 gap)
//   ② FR 번호(스펙별 001 연번): frNumberingIssues
//        hard    : 한 스펙 안의 같은 FR ID 중복(정당한 케이스가 없음 — 정책 knob 없이 항상 hard)
//        advisory: 001 미시작 / 내부 결번(폐기 흔적일 수 있음 — SPEC-018)
// 둘은 "접두어 + 3자리 번호[+레터 서픽스]" 집합 판정이라 순수 원형(groupNumbers)을 공유하고
// severity·문구만 도메인별로 분리한다 — spec-ID의 001미시작은 hard지만 FR은 advisory여서
// 판정층까지 합치면 정책이 뒤섞인다(재사용 근거·분리 근거 모두 여기).
// 판정은 id 문자열 파싱·정수 비교만 — 파일시스템·본문 비의존, 출력은 접두어·번호 순 정렬(결정성).
// 실측 근거: (spec-ID) 소비 프로젝트 A는 접두어별 순차, 소비 프로젝트 B는 재도출 후 retag로 전역 잔번
// (INFRA-011/013)을 남겨 두 프로젝트가 다른 번호 체계로 갈라짐. (FR) 소비 프로젝트 C는 두 브랜치가
// 같은 스펙에 동시 추가해 FR-023~026이 각 2회 중복됐는데 **어떤 게이트에도 걸리지 않았다**.
// 설계: SPEC-014 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

const pad3 = (n) => String(n).padStart(3, "0");
const ID_RE = /^([A-Z]+)-(\d{3})([a-z]?)$/; // 레터 서픽스(FR-003a)는 별개 ID·기저 번호는 003

// 순수 원형(spec-ID·FR 공용): ID 집합을 접두어별로 묶어
//   dupIds : 완전 동일 ID가 둘 이상 나타난 것(정렬)
//   nums   : 기저 번호의 유일·정렬 집합 (FR-003a는 3으로 접힘 — 서픽스는 결번을 만들지 않는다)
//   min    : 최소 번호(빈 그룹이면 null)
//   missing: 최소~최대 사이 내부 결번(폐기 필터링 같은 정책은 호출자 몫)
// 반환은 접두어 사전순 정렬 배열 — 입력 순서 무관·결정적.
export function groupNumbers(ids) {
  const byPrefix = new Map(); // prefix -> {seen:Set(fullId), dup:Set(fullId), nums:[num,...]}
  for (const raw of ids || []) {
    const m = ID_RE.exec(String(raw).trim());
    if (!m) continue; // 미등록/비정형 id는 상위 문법 검사(PREFIX 화이트리스트·FR 문법)가 이미 처리
    const [, pfx, num, sfx] = m;
    if (!byPrefix.has(pfx)) byPrefix.set(pfx, { seen: new Set(), dup: new Set(), nums: [] });
    const g = byPrefix.get(pfx);
    const full = `${pfx}-${num}${sfx}`;
    if (g.seen.has(full)) g.dup.add(full); else g.seen.add(full);
    g.nums.push(parseInt(num, 10));
  }
  const out = [];
  for (const pfx of [...byPrefix.keys()].sort()) {
    const g = byPrefix.get(pfx);
    const nums = [...new Set(g.nums)].sort((a, b) => a - b);
    const missing = [];
    if (nums.length) {
      const present = new Set(nums);
      for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!present.has(n)) missing.push(n);
    }
    out.push({ prefix: pfx, nums, dupIds: [...g.dup].sort(), min: nums.length ? nums[0] : null, missing });
  }
  return out;
}

// spec-ID 번호(접두어별 001 순차) — 반환 {hard:[msg], advisory:[msg]}.
// retiredIds: 폐기 기록된 spec-ID 집합(config `retiredIds`) — 그 ID의 내부 gap은
//   사고성 결번이 아니라 정상 retirement gap이므로 advisory에서 제외(SPEC-018 FR-006).
export function numberingIssues(specIds, retiredIds = []) {
  const retired = new Set((retiredIds || []).map((s) => String(s).trim()));
  const hard = [], advisory = [];
  for (const g of groupNumbers(specIds)) {
    const pfx = g.prefix;
    // 중복
    for (const d of g.dupIds) {
      hard.push(`${d} 번호 중복 — 같은 접두어·번호가 둘 이상(유일해야 함)`);
    }
    const uniq = g.nums;
    if (uniq.length === 0) continue;
    // 폐기 ID 재사용(hard, SPEC-014 FR-004): retiredIds에 기록된 번호가 실재하면 과거 참조
    // (@verifies·Change Log·vcs-history)가 의미 다른 새 스펙으로 앨리어싱된다 — 무신호 재사용 차단(감사 M3).
    for (const n of uniq) {
      if (retired.has(`${pfx}-${pad3(n)}`)) {
        hard.push(`${pfx}-${pad3(n)} 폐기 ID 재사용 — retiredIds에 기록된 번호가 실재(과거 참조 앨리어싱). 새 번호를 쓰거나, 의도적 재사용이면 retiredIds에서 제거`);
      }
    }
    // 001 미시작 (전역 잔번·잘못된 시작) — 단, 선행 번호(001..min-1)가 전부 retiredIds에 기록돼
    // 있으면 정상 retirement gap이라 hard 아님(SPEC-014 FR-001 개정: 최소번호 스펙 폐기가
    // 접두어 전체 재번호를 강요하던 모순 해소 — SPEC-018 FR-006과 정합, 감사 M4).
    if (uniq[0] !== 1) {
      let leadingRetired = true;
      for (let n = 1; n < uniq[0]; n++) if (!retired.has(`${pfx}-${pad3(n)}`)) { leadingRetired = false; break; }
      if (!leadingRetired) {
        hard.push(`${pfx} 번호가 001부터 시작하지 않음 — 최소 ${pfx}-${pad3(uniq[0])} (접두어별 001 순차 규칙, SPEC-014). 재번호는 sdd-retag, 선행 번호가 폐기분이면 retiredIds에 기록`);
      }
    }
    // 내부 gap (실제 최소~최대) — 001 미시작분은 gap으로 재보고하지 않음
    // retiredIds에 기록된 번호는 정상 retirement gap이라 재보고하지 않음(SPEC-018 FR-006)
    const missing = g.missing.filter((n) => !retired.has(`${pfx}-${pad3(n)}`));
    if (missing.length) {
      advisory.push(`${pfx} 번호 중간 gap: ${missing.map(pad3).map((s) => `${pfx}-${s}`).join(", ")} — 제거·retag 잔분(정상일 수 있음)`);
    }
  }
  return { hard, advisory };
}

// FR 번호(스펙별 001 연번) — 반환 {hard:[msg], advisory:[msg]}.
// 입력은 **한 스펙의** FR 선언 목록(중복 판정에 순서·중복이 필요하므로 Set이 아니라 배열).
// 식별자는 `<SPEC-ID>/FR-NNN`이고 앞의 스펙 ID가 이미 네임스페이스라 번호는 스펙 안에서만
// 유일하면 된다 — 그래서 판정은 스펙 단위로 독립이고, 스펙 A의 FR-001과 B의 FR-001은 중복이 아니다.
// 중복은 정당한 케이스가 없어 정책 knob 없이 항상 hard(spec-ID 중복과 동형).
// declaredNums: Change Log가 **신규·개정으로 선언한** 기저 번호 집합(SPEC-037 changeLogFrRefs).
// 결번 문구가 여기서 갈린다 — 그동안 "FR 폐기 잔분일 수 있음" 한 문장이 의미가 정반대인 두 상태를
// 덮었다: 폐기 흔적(정당)과 "신규라 선언했는데 본문을 안 씀"(결함). 매 실행 로그에 섞여 흘러가
// 실측 사례에서 3개 FR이 몇 달간 SSOT 밖에 있었다. 판정 소스는 SPEC-037 코어 하나다.
export function frNumberingIssues(specId, frIds, declaredNums = new Set()) {
  const hard = [], advisory = [];
  for (const g of groupNumbers(frIds)) {
    for (const d of g.dupIds) {
      hard.push(`${specId}/${d} FR 번호 중복 — 한 스펙 안에 같은 FR 번호가 둘 이상(스펙 내 유일 필수, SPEC-014). 병합이 같은 번호를 양쪽에서 추가했으면 뒤 선언을 새 번호로 옮기고 sdd-retag로 @covers·smokeManifest를 함께 이행`);
    }
    if (g.nums.length === 0) continue;
    if (g.min !== 1) {
      advisory.push(`${specId}: ${g.prefix} 번호가 001부터 시작하지 않음 — 최소 ${g.prefix}-${pad3(g.min)} (스펙별 001 연번 규칙, SPEC-014)`);
    }
    const declaredGap = g.missing.filter((n) => declaredNums.has(n));
    const plainGap = g.missing.filter((n) => !declaredNums.has(n));
    if (declaredGap.length) {
      advisory.push(`${specId}: ${g.prefix} 번호 중간 결번: ${declaredGap.map((n) => `${g.prefix}-${pad3(n)}`).join(", ")} — **Change Log가 선언했으나 본문 없음**(폐기 잔분이 아니다, SPEC-037)`);
    }
    if (plainGap.length) {
      advisory.push(`${specId}: ${g.prefix} 번호 중간 결번: ${plainGap.map((n) => `${g.prefix}-${pad3(n)}`).join(", ")} — FR 폐기 잔분일 수 있음(SPEC-018)`);
    }
  }
  return { hard, advisory };
}
