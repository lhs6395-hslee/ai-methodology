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

// ── 등록 축(오프라인) ────────────────────────────────────────────────────────
// 실측 제보(2026-08-10, qa에이전트 도입): 배포 산출물 8개 결함을 **배포로 하나씩** 발견했다 —
// ECR 리포 없음 · 경로 가드 · base==HEAD · 크로스계정 ECR API · buildx 캐시 드라이버 ·
// 아치 불일치(arm64 노드에 amd64 이미지) · 리포 정책 부재 · 이미지에 의존 모듈 누락.
// 전부 저장소 **밖** 사실이고 전부 로컬 게이트를 green으로 통과했다. R9라는 틀은 있었지만
// 검사 항목 6건에 이 중 하나도 없었고, **새 산출물을 선언해도 대응 검사를 등록하지 않으면
// 게이트가 통과**했다 — 틀이 있는 것과 그 틀이 이 산출물을 본다는 것은 다른 사실이다.
//
// 이 축이 실행 축과 갈라져야 하는 이유: 실행은 자격증명·네트워크가 필요해 로컬에서 흔히
// skipped이고 훅에서 위임된다. 등록은 순수 선언 대조라 오프라인에서도 판정된다. 한 축에
// 묶여 있으면 자격증명이 없는 순간 등록 누락까지 함께 안 보인다 — 그게 제보의 구조다.

// 배포 산출물 식별 **권장** 마커 — Artifact 키에 이 토큰이 있으면 "저장소 밖에 실재하는 것"으로 본다.
// ⚠ 이것은 **기본값이 아니라 붙여넣을 목록**이다. 조용한 기본값으로 쓰면 프로젝트 어휘와 어긋난
// 순간 0건이 나오고 그 0은 진짜 0과 구분되지 않는다(SPEC-040 ②가 언어 편향에서 배운 것). 그래서
// `deployArtifactMarkers` 미선언은 게이트가 INERT로 자백하고, 저자는 이 목록을 복사해 시작한다.
export const RECOMMENDED_DEPLOY_ARTIFACT_MARKERS = [
  "image", "container", "registry", "ecr", "gcr", "acr", "docker",
  "deployment", "statefulset", "daemonset", "cronjob", "k8s", "kubernetes", "helm",
  "lambda", "function", "service", "ingress", "pipeline", "stage", "workflow", "job",
];

// 키가 배포 산출물인가 — 소문자 부분 문자열 매치(경계 없음: qa-runner-image도 잡아야 한다).
export function isDeployArtifact(key, markers) {
  const k = String(key || "").toLowerCase();
  return (markers || []).some((m) => k.includes(String(m).toLowerCase()));
}

// 검사가 이 키를 담당하는가. covers는 키 또는 글롭 목록이며, 미선언 검사는 아무것도 담당하지
// 않는다 — 담당 선언 없는 검사를 커버로 세면 "검사가 하나라도 있으면 통과"가 되고, 그건 제보가
// 지적한 바로 그 상태다(틀은 있는데 이 산출물은 아무도 안 본다).
function checkCovers(check, key, matcher) {
  const covers = Array.isArray(check && check.covers) ? check.covers : [];
  const k = String(key || "").trim().toLowerCase();
  return covers.some((c) => {
    const pat = String(c || "").trim();
    if (!pat) return false;
    if (pat.toLowerCase() === k) return true;
    if (GLOBBY.test(pat)) { try { return matcher(pat).test(String(key)); } catch { return false; } }
    return false;
  });
}
const GLOBBY = /[*?]/;

// 선언된 배포 산출물 × 등록된 검사 → 미검사 산출물 목록.
//   declared: [{specId, key}] — 스펙별 Artifacts 키(호출자가 수집)
//   반환 {covered:[{specId,key,by}], uncovered:[{specId,key}], scanned:<배포 산출물 총수>}
export function liveRealityCoverage(declared, checks, markers, matcher) {
  const covered = [], uncovered = [];
  let scanned = 0;
  for (const d of declared || []) {
    if (!isDeployArtifact(d.key, markers)) continue;
    scanned += 1;
    const by = (checks || []).find((c) => checkCovers(c, d.key, matcher));
    if (by) covered.push({ ...d, by: String(by.id || "") });
    else uncovered.push(d);
  }
  return { covered, uncovered, scanned };
}

// 등록 축 강도 처분 — 미검사 산출물만 위반이다(실행 실패는 실행 축의 몫이고 여기선 세지 않는다).
export function liveRealityCoverageVerdict(policy, uncovered) {
  return { blocking: policy === "hard" && uncovered.length > 0, violations: uncovered.length };
}

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
    if (c && c.covers !== undefined && !Array.isArray(c.covers)) {
      errors.push(`liveRealityChecks[${i}] "${id}" — covers는 배열이어야 한다(담당 산출물 키·글롭 목록)`);
    }
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
