// tooling/test-domain-lib.mjs
// TEST 삭제가능 도메인의 인프라 격리 순수 코어 (SPEC-015).
// 테스트/QA 인프라는 네임스페이스 마커(testInfraGlobs, 예: **/qa/**)로 구분하고, 그 파일은
// TEST 스펙만 소유하게 강제한다 — 제품 INFRA/CICD/SPEC 스펙에 테스트 인프라가 새면 위반.
// TEST가 자기 인프라(iac/ci)를 소유하는 것 자체는 prefix-class에서 면제된다(TEST는 자기완결
// 도메인). 격리는 여기서, 소유 허용은 prefix-class-lib에서 — 두 규칙이 짝을 이룬다.
// 설계: SPEC-015 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

// 스펙 1건 판정 — 순수(파일시스템 비의존). testInfraGlobs = [RegExp]. []이면 비활성.
// 반환: {files:[위반 파일]} | null. prefix가 TEST면 항상 null(테스트 인프라의 정당 소유자).
export function testInfraFinding(prefix, ownedFiles, testInfraGlobs) {
  if (!testInfraGlobs || !testInfraGlobs.length || prefix === "TEST") return null;
  const files = ownedFiles.filter((f) => testInfraGlobs.some((re) => re.test(f)));
  return files.length ? { files } : null;
}
