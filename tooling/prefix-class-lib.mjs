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

// readopt 절차(prompts/readopt.md 6단계)상 INFRA 스펙으로 착지하는 소스 클래스.
// ops-docs는 verification 절·검증 태그로 착지하므로 대상이 아니다.
export const INFRA_SOURCE_CLASSES = ["iac", "ci"];

// 파일 → 인프라 클래스("iac"|"ci") 또는 null. classGlobs = {iac:[RegExp], ci:[RegExp]}.
export function classifyInfraFile(relPath, classGlobs) {
  for (const cls of INFRA_SOURCE_CLASSES) {
    if ((classGlobs[cls] || []).some((re) => re.test(relPath))) return cls;
  }
  return null;
}

// 스펙 1건 판정 — 순수(파일시스템 비의존). ownedFiles = 이 스펙 Files 글롭에 매치된
// 레포 실파일(비-테스트, 정렬됨). 반환: {kind:"error"|"warn", infra, other} | null.
//   error: 접두어 ≠ INFRA 인데 소유 실파일 전부가 iac/ci 클래스(∧ ≥1건).
//   warn : 접두어 = INFRA 인데 iac/ci 클래스 검출 0건(레포 밖 인프라 실체는 선언 가능 — 과장 금지).
export function prefixClassFinding(prefix, ownedFiles, classGlobs) {
  const infra = [], other = [];
  for (const f of ownedFiles) (classifyInfraFile(f, classGlobs) ? infra : other).push(f);
  if (prefix !== "INFRA" && infra.length > 0 && other.length === 0) return { kind: "error", infra, other };
  if (prefix === "INFRA" && infra.length === 0) return { kind: "warn", infra, other };
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
