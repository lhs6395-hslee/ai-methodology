// tooling/live-reality-lib.mjs
// 라이브 대조 판정 순수 코어 (SPEC-032) — "선언이 실제로 동작하는가" 축의 런타임 절반.
// 실측(소비 프로젝트 gsn-ai-pm): 게이트 8종이 전부 저장소 **안**만 본다. 그 결과
//   · terraform state 17일 정지(serial 50), 코드 required_version >= 1.15인데 state 작성 CLI 1.13.5
//   · 코드에 선언됐으나 state에 없는 모듈 6건(CLI out-of-band 생성, import 미실행)
//   · NAT Gateway가 state에도 없고 재생성 스케줄 DISABLED — 무소유 자원(사라지면 egress 상실)
//   · 라이브 ConfigMap 해시 ≠ 저장소 매니페스트 해시(라이브가 최신인데 저장소를 apply해 회귀)
// 이 전부가 "spec↔code 문서 정합" 게이트에 무증상이다. 인프라 스펙의 대상은 클라우드 실물인데
// 검증은 저장소 안에서만 하기 때문이다.
//
// 계약(인프라 무관): 프로젝트가 `liveRealityChecks`로 명령을 주입한다.
//   · stdout 한 줄 = 위반 항목 하나(비면 clean) — 목록 출력이 곧 판정 결과다
//   · exit 0 = 판정 수행 / exit ≠ 0 = **skipped(reason)** — 오프라인·자격증명 없음에서 하드 실패 금지
// 즉 "판정 못 함"과 "위반 없음"을 절대 섞지 않는다(조용한 green 금지). Python 미러(SPEC-006).

export const CHECK_KINDS = ["terraform", "kubernetes", "ownership", "custom"];

// checks config 무결성 — id 필수·유일, command 필수, kind는 알려진 값(미지정 시 custom).
// 반환: 에러 문자열 배열(빈 배열 = 정상). 순수.
export function validateChecks(checks) {
  const errors = [];
  const seen = new Set();
  (checks || []).forEach((c, i) => {
    const id = String((c && c.id) || "").trim();
    if (!id) { errors.push(`liveRealityChecks[${i}] — id 필요(빈 값 불가)`); return; }
    if (seen.has(id)) errors.push(`liveRealityChecks[${i}] — id "${id}" 중복(유일해야 함)`);
    seen.add(id);
    if (!String((c && c.command) || "").trim()) errors.push(`liveRealityChecks[${i}] "${id}" — command 필요(빈 값 불가)`);
    const kind = String((c && c.kind) || "custom").trim();
    if (!CHECK_KINDS.includes(kind)) errors.push(`liveRealityChecks[${i}] "${id}" — 알 수 없는 kind "${kind}"(${CHECK_KINDS.join("|")})`);
  });
  return errors;
}

// 명령 실행 결과 → 판정. 실행 실패(exit≠0)는 **언제나 skipped**이며 위반으로 승격하지 않는다
// (자격증명 없는 CI·로컬에서 인프라 게이트가 빌드를 깨면 안 된다는 제약).
//   raw: {id, label, kind, exitCode, stdout, stderr}
// 반환 {id, label, kind, status:"clean"|"violations"|"skipped", items:[], reason}
export function classifyResult(raw) {
  const id = String((raw && raw.id) || "");
  const label = String((raw && raw.label) || id);
  const kind = String((raw && raw.kind) || "custom");
  const code = Number(raw && raw.exitCode);
  if (code !== 0) {
    const why = String((raw && raw.stderr) || "").trim().split("\n").filter(Boolean).pop()
      || `명령이 exit ${Number.isFinite(code) ? code : "?"}로 종료`;
    return { id, label, kind, status: "skipped", items: [], reason: why };
  }
  const items = String((raw && raw.stdout) || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return { id, label, kind, status: items.length ? "violations" : "clean", items, reason: "" };
}

// 결과 집계 — 사람/게이트 공통. 순수.
export function summarize(results) {
  const out = { clean: 0, violations: 0, skipped: 0, items: 0 };
  for (const r of results || []) {
    if (r.status === "violations") { out.violations++; out.items += (r.items || []).length; }
    else if (r.status === "skipped") out.skipped++;
    else out.clean++;
  }
  return out;
}
