// tooling/evidence-lib.mjs
// 실행 증거 등급 판정 순수 코어 (SPEC-031) — "선언이 실제로 동작하는가" 축.
// 실측(소비 프로젝트 gsn-ai-pm 가오픈 점검): 게이트 8종 전부 통과 상태에서 Grafana 패널 30여 개가
// 죽어 있었다. INFRA-005 FR-017~023이 대시보드를 규정하고 `[검증]` 태그가 붙어 있었지만, 렌더를
// 확인하는 **실행 코드가 0줄**이었다(태그가 산문 자기신고로 소비됨). 원인 2건(배열형 statistics로
// 쿼리 skip, `$alb_name` 보간 실패)은 파일만 읽는 게이트에 무증상이고, API 단독 검증으로도
// 통과한다(변수를 미리 치환해 질의하므로) — 브라우저가 실제 보내는 payload를 봐야 드러났다.
//
// 그래서 `[검증]`을 **증거 경로 필수**로 승격한다:
//   [검증: tests/e2e/foo.e2e.ts]  → 실행 등급(executable) — 자산이 실재해야 함
//   [검증]                        → 경로 없는 빈 주장(위반)
//   [검증 — 코드 실측] / [미확인]  → 자기신고 등급(유지하되 실행 등급이 아님)
// 판정 범위는 **FR 선언 라인과 SC 라인**뿐이다 — Change Log 산문의 `[검증]` 언급(이력 서술)은
// 주장이 아니므로 건드리지 않는다(킷 자신의 9개 언급이 전부 그 경우).
// 순수 함수(파일 IO 없음) — 자산 실재 판정은 소비 게이트가 주입한다. Python 미러(SPEC-006).

// 실행 동사 기본 어휘 — SC가 "렌더한다/응답한다" 류를 주장하면 실행 등급 증거를 요구한다.
// 프로젝트가 config `executionVerbs`로 교체 가능(도메인 어휘 확장).
// ⚠ 어휘는 부분일치라 흔한 합성어 오탐을 피해야 한다 — 예: "재생"은 "재생성(regenerate)"을 오탐해
// 기본에서 제외한다(킷 자기적용 시운전에서 SPEC-010 SC-001이 거짓양성으로 잡혀 실측 확인).
export const DEFAULT_EXECUTION_VERBS = [
  "렌더", "응답", "동작", "표시", "기동", "구동", "수신", "전송",
  "renders", "render", "responds", "respond", "displays", "display", "serves", "serve", "works",
];

// UI/브라우저 경로 마커 — 이 마커가 있으면 API 단독 증거를 실행 등급으로 인정하지 않는다(실측 교훈).
// 마커 매칭 — **ASCII 마커는 단어 경계로만** 맞춘다. 부분일치는 흔한 단어를 대량 오탐한다
// (실측 제보: `page`→`TicketPackage`, `UI`→`REQUIRED`(q-**ui**-red)·`pricing-guide`(g-**ui**-de).
// 순수 백엔드 스펙의 FR 7건 중 4건이 "UI 대상인데 증거가 브라우저 등급 아님"으로 표면화됐다).
// 한글 마커는 교착어라 단어 경계가 성립하지 않고 실측 충돌도 없으므로 부분일치를 유지한다 —
// 킷이 `재생`(→재생성 오탐)을 기본에서 뺀 것과 같은 판단이되, 여기선 삭제 대신 경계로 좁힌다
// (삭제하면 진짜 UI 주장을 놓친다).
const ASCII_ONLY = /^[\x00-\x7F]+$/;
export function markerHits(haystack, marker) {
  const m = String(marker || "").toLowerCase();
  if (!m) return false;
  const s = String(haystack || "").toLowerCase();
  if (!ASCII_ONLY.test(m)) return s.includes(m);
  const esc = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(s);
}

export const DEFAULT_BROWSER_MARKERS = [
  "대시보드", "dashboard", "화면", "브라우저", "browser", "패널", "panel", "페이지", "page", "UI",
];
// 브라우저 등급으로 인정할 증거 경로 패턴(정규식 소스) — e2e·playwright·cypress·browser 등.
export const DEFAULT_BROWSER_EVIDENCE_PATTERNS = [
  "e2e", "playwright", "cypress", "puppeteer", "selenium", "browser",
];

// 배포 등급 증거 — **"단위테스트가 통과했다"와 "배포본에서 실제로 돌았다"는 다른 사실이다**(제보 ④).
// 실측(2026-08-10 qa에이전트): 아치 불일치·이미지 안 모듈 누락은 단위테스트가 100% 통과해도
// 남는다. 그 둘이 깨지는 곳은 **배포된 이미지의 런타임**이고, 저장소 안 테스트는 거기 닿지 않는다.
export const DEFAULT_DEPLOY_EVIDENCE_PATTERNS = [
  "smoke", "e2e", "live", "deploy", "runbook", "canary", "staging",
];
// 주장이 배포 산출물 대상인지 — 브라우저 마커와 같은 방식(주장 라인에서만 찾는다).
export const DEFAULT_DEPLOY_MARKERS = [
  "이미지", "컨테이너", "레지스트리", "배포", "파이프라인", "스테이지", "클러스터", "노드",
  "image", "container", "registry", "deploy", "pipeline", "stage", "cluster", "node", "helm",
];

// 증거 경로가 배포 등급인가(패턴 부분일치).
export function isDeployGradeEvidence(path, patterns) {
  const s = String(path || "").toLowerCase();
  return (patterns && patterns.length ? patterns : DEFAULT_DEPLOY_EVIDENCE_PATTERNS)
    .some((p) => s.includes(String(p).toLowerCase()));
}

// 한 라인에서 검증 태그를 추출한다. 반환 null | {kind, paths[]}
//   kind: "exec"(경로 있음) | "bare"(경로 없는 [검증]) | "self"(자기신고 서술) | "unknown"([미확인])
// `[검증: a, b]`의 구분자는 `:` 또는 `：`(전각). `[검증 — …]`·`[검증 - …]`는 자기신고 서술.
export function parseEvidenceTag(line) {
  // 코드 스팬(`...`)은 **인용**이지 주장이 아니다 — 문법 자체를 설명하는 스펙(이 spec 등)이
  // 자기 문법을 적었다고 위반이 되면 안 된다(SPEC-023의 "코드 스팬은 앵커 아님"과 같은 규칙).
  const s = String(line || "").replace(/`[^`]*`/g, " ");
  if (/\[미확인\]/.test(s)) return { kind: "unknown", paths: [] };
  const m = s.match(/\[검증\s*([:：])?\s*([^\]]*)\]/);
  if (!m) return null;
  const sep = m[1];
  const body = String(m[2] || "").trim();
  if (sep) {
    const paths = body.split(",").map((p) => p.trim()).filter(Boolean);
    return paths.length ? { kind: "exec", paths } : { kind: "bare", paths: [] };
  }
  if (!body) return { kind: "bare", paths: [] };
  return { kind: "self", paths: [] }; // `[검증 — 코드 실측]` 류 서술
}

// 라인에 실행 동사가 있는가(대소문자 무시).
export function hasExecutionVerb(line, verbs) {
  const s = String(line || "").toLowerCase();
  return (verbs && verbs.length ? verbs : DEFAULT_EXECUTION_VERBS)
    .some((v) => s.includes(String(v).toLowerCase()));
}

// 증거 경로가 브라우저 등급인가(패턴 부분일치).
export function isBrowserGradeEvidence(path, patterns) {
  const s = String(path || "").toLowerCase();
  return (patterns && patterns.length ? patterns : DEFAULT_BROWSER_EVIDENCE_PATTERNS)
    .some((p) => s.includes(String(p).toLowerCase()));
}

// 스펙 단위 판정.
//   units: [{specId, claims:[{id, kind:"FR"|"SC", text}]}]
//   assetExists(path) → boolean (게이트 주입 — 글롭/실재 판정은 호출부 책임)
//   opts: {verbs, browserMarkers, browserPatterns}
// ⚠ 브라우저 마커는 **주장 라인 자체**에서만 찾는다 — 스펙 전문을 훑으면 무관한 언급(예: "웹 UI
// 병합")이 오탐을 낸다(킷 시운전에서 SPEC-020이 그렇게 걸려 실측 교정).
// opts.manifestOf(specId, claimId) → null | {source, method} — 회계 매니페스트 조회(선택 주입).
//   source: "smokeManifest"(FR) | "evidenceManifest"(SC·NFR) / method: 그 엔트리의 kind·method
// 본문과 매니페스트는 같은 주장에 대한 **두 개의 선언**이라 서로 모순될 수 있는데, 지금까지
// 아무도 그 둘을 대조하지 않았다(실측 제보: `[미확인]`인 FR이 매니페스트엔 실측 증거를 갖고 있었다).
// 게이트는 어느 쪽이 맞는지 모른다 — 모순을 지목하고 하나를 고치게 한다.
//
// 반환 [{specId, claimId, kind, finding, detail}] — 선언 순(결정적).
//   finding: "bare-tag" | "missing-asset" | "exec-verb-no-evidence" | "browser-needs-ui-evidence"
//          | "deploy-needs-live-evidence" | "unknown-vs-manifest" | "manifest-vs-tag"
export function evidenceFindings(units, assetExists, opts = {}) {
  const verbs = opts.verbs && opts.verbs.length ? opts.verbs : DEFAULT_EXECUTION_VERBS;
  const bpat = opts.browserPatterns && opts.browserPatterns.length ? opts.browserPatterns : DEFAULT_BROWSER_EVIDENCE_PATTERNS;
  const bmark = opts.browserMarkers && opts.browserMarkers.length ? opts.browserMarkers : DEFAULT_BROWSER_MARKERS;
  const dpat = opts.deployPatterns && opts.deployPatterns.length ? opts.deployPatterns : DEFAULT_DEPLOY_EVIDENCE_PATTERNS;
  const dmark = opts.deployMarkers && opts.deployMarkers.length ? opts.deployMarkers : DEFAULT_DEPLOY_MARKERS;
  const isDeployClaim = (t) => {
    const s = String(t || "").toLowerCase();
    return dmark.some((m) => markerHits(s, m));
  };
  const isBrowserClaim = (t) => {
    const s = String(t || "").toLowerCase();
    return bmark.some((m) => markerHits(s, m));
  };
  const manifestOf = typeof opts.manifestOf === "function" ? opts.manifestOf : () => null;
  const out = [];
  for (const u of units || []) {
    for (const c of u.claims || []) {
      const tag = parseEvidenceTag(c.text);
      // 본문 ↔ 매니페스트 대조. deferred 엔트리는 `[미확인]`과 같은 말이라 모순이 아니다.
      const man = manifestOf(u.specId, c.id);
      if (man && String(man.method || "") !== "deferred") {
        if (tag && tag.kind === "unknown") {
          out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "unknown-vs-manifest",
            detail: `본문은 \`[미확인]\`인데 ${man.source}는 실측 증거를 주장한다(${man.method}) — 둘 중 하나가 낡았다: 증거가 진짜면 본문을 \`[검증: <경로>]\`로 올리고, 아니면 매니페스트 엔트리를 지우거나 deferred+사유로 내려라` });
        } else if (tag && tag.kind === "exec") {
          out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "manifest-vs-tag",
            detail: `본문에 실행 증거 \`[검증: ${tag.paths.join(", ")}]\`가 있는데 ${man.source}에도 엔트리가 있다(${man.method}) — 매니페스트는 **실행할 수 없는 검증**의 회계 수단이다. 이중 회계이거나 매니페스트가 낡았다` });
        }
      }
      if (tag && tag.kind === "bare") {
        out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "bare-tag",
          detail: "경로 없는 `[검증]` — 실행 증거 자산 경로를 적어라(`[검증: tests/e2e/x.e2e.ts]`)" });
        continue;
      }
      if (tag && tag.kind === "exec") {
        for (const p of tag.paths) {
          if (!assetExists(p)) {
            out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "missing-asset",
              detail: `증거 자산 없음: ${p}` });
          }
        }
        // UI/브라우저 대상인데 증거가 브라우저 등급이 아니면 표면화(API 단독 검증 불인정 — 실측 교훈).
        if (isBrowserClaim(c.text) && !tag.paths.some((p) => isBrowserGradeEvidence(p, bpat))) {
          out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "browser-needs-ui-evidence",
            detail: `UI/브라우저 대상인데 증거가 브라우저 등급 아님(${tag.paths.join(", ")}) — API 단독 검증은 변수 보간·렌더 단계 결함을 통과시킨다` });
        }
        // 배포 산출물 대상인데 증거가 저장소 안 단위테스트뿐이면 표면화(제보 ④ — 등급 분리).
        // "단위테스트 통과"와 "배포본에서 실제 실행됨"을 같은 증거로 세면, 아치 불일치·이미지 안
        // 모듈 누락처럼 **런타임에서만 깨지는 결함**이 100% green 위에서 배포된다(실측 8건).
        // ⚠ 트리거는 **둘 다**여야 한다: 이 스펙이 배포 산출물을 소유하고(u.ownsDeployArtifact),
        // 그 주장이 배포 대상을 말할 때. 마커만으로 걸면 "배포 가드의 판정 로직"처럼 배포를
        // *다루는* 스펙까지 잡혀 31건이 쏟아진다(킷 시운전 실측) — 그런 스펙의 정답 증거는
        // 단위테스트가 맞다. 소유 없는 마커는 화제이지 대상이 아니다.
        if (u.ownsDeployArtifact && isDeployClaim(c.text) && !tag.paths.some((p) => isDeployGradeEvidence(p, dpat))) {
          out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "deploy-needs-live-evidence",
            detail: `배포 산출물 대상인데 증거가 배포 등급 아님(${tag.paths.join(", ")}) — 저장소 안 단위테스트는 배포본의 아치·이미지 내용·전제 자원에 닿지 않는다(smoke·e2e·live·runbook 등급 증거 또는 실행 원장 기록으로 올려라)` });
        }
        continue;
      }
      // 태그 없음·자기신고: SC가 실행 동사를 주장하면 실행 등급 증거를 요구.
      if (c.kind === "SC" && hasExecutionVerb(c.text, verbs)) {
        out.push({ specId: u.specId, claimId: c.id, kind: c.kind, finding: "exec-verb-no-evidence",
          detail: "실행 동사를 주장하는데 실행 등급 증거(`[검증: <경로>]`)가 없다 — 자기신고는 실행 등급이 아니다" });
      }
    }
  }
  return out;
}
