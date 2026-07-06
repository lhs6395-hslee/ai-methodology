// tooling/prefix-class-lib.mjs
// 접두어↔derivation 클래스 정합 순수 코어 (SPEC-012) — 스펙이 소유한(Files) 레포 실파일을
// derivationClassGlobs의 인프라 클래스(iac·ci)로 분류하고, 비-테스트 소유 파일이 **전적으로**
// 인프라 클래스인데 접두어가 INFRA-가 아니면 위반으로 판정한다.
// 임계는 비율이 아니라 전체성(totality) — 기능 SPEC-이 부수적 IaC/CI 파일을 함께 소유하는
// 정당 케이스(Infrastructure Prerequisites)는 비-인프라 소유 파일이 하나라도 있으면 자동
// 통과라 과잉발동이 없다(자의적 비율 임계 금지). 나머지 경계는 prefixClassExemptions
// (config 등록 + 빈 값 불가 사유 — prefixRationale·entityRegistry와 동형 패턴)로 선언한다.
// 실측 근거: 재도출이 iac/ci 소스에서 도출한 스펙을 SPEC- 접두어로 착지시켜도 PREFIX
// 게이트(등록·사유만 검사)가 통과 — STORAGE §2.2의 접두어 의미가 미강제 규범이었다.
// 설계: SPEC-012 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

// 접두어↔클래스 정합 대상인 인프라-계열 소스 클래스.
// ops-docs는 verification 절·검증 태그로 착지하므로 대상이 아니다.
export const INFRA_SOURCE_CLASSES = ["iac", "ci"];

// 인프라-계열 클래스 → 표준 접두어. iac=프로비저닝 자원(INFRA), ci=전달 자동화(CICD).
// 소유 실파일이 한 클래스에 전적이면 그 클래스의 접두어를 강제한다(readopt 착지 규칙).
export const CLASS_PREFIX = { iac: "INFRA", ci: "CICD" };

// 파일 → 인프라 클래스("iac"|"ci") 또는 null. classGlobs = {iac:[RegExp], ci:[RegExp]}.
export function classifyInfraFile(relPath, classGlobs) {
  for (const cls of INFRA_SOURCE_CLASSES) {
    if ((classGlobs[cls] || []).some((re) => re.test(relPath))) return cls;
  }
  return null;
}

// 스펙 1건 판정 — 순수(파일시스템 비의존). ownedFiles = 이 스펙 Files 글롭에 매치된
// 레포 실파일(비-테스트, 정렬됨). 반환: {kind, infra, other, expected?/prefix?} | null.
//   error: 소유 실파일이 전부 인프라-계열(∧ ≥1건)인데 접두어가 존재 클래스의 표준 접두어 밖.
//          expected = 존재 클래스들의 접두어 합집합(iac+ci 혼합이면 INFRA·CICD 둘 다 허용).
//   warn : 인프라-계열 접두어(INFRA/CICD)인데 자기 클래스(iac/ci) 검출 0건(레포 밖 실체 허용 — 과장 금지).
export function prefixClassFinding(prefix, ownedFiles, classGlobs) {
  const byClass = { iac: [], ci: [] };
  const infra = [], other = [];
  for (const f of ownedFiles) {
    const c = classifyInfraFile(f, classGlobs);
    if (c) { byClass[c].push(f); infra.push(f); } else other.push(f);
  }
  // TEST는 자기완결 도메인이라 자기 인프라(iac/ci) 소유를 면제(격리는 testInfraGlobs가 별도 강제 — SPEC-015).
  if (infra.length > 0 && other.length === 0 && prefix !== "TEST") {
    const expected = [...new Set(INFRA_SOURCE_CLASSES.filter((c) => byClass[c].length).map((c) => CLASS_PREFIX[c]))];
    if (!expected.includes(prefix)) return { kind: "error", infra, other, expected };
  }
  const ownClass = INFRA_SOURCE_CLASSES.find((c) => CLASS_PREFIX[c] === prefix);
  if (ownClass && byClass[ownClass].length === 0) return { kind: "warn", infra, other, prefix };
  return null;
}

// 면제 레지스트리 검증 — 실재하는 spec ID만, 사유는 빈 값 불가(조용한 스킵·무사유 면제 금지).
export function validateExemptions(exemptions, knownIds) {
  const errors = [];
  for (const id of Object.keys(exemptions || {}).sort()) {
    if (!knownIds.has(id)) errors.push(`prefixClassExemptions에 존재하지 않는 spec "${id}" — 오타/삭제 확인(조용한 스킵 금지)`);
    else if (!String(exemptions[id] ?? "").trim()) errors.push(`prefixClassExemptions["${id}"] — 사유 필요(빈 값 불가)`);
  }
  return errors;
}
