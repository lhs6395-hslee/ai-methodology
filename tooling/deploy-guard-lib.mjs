// tooling/deploy-guard-lib.mjs
// out-of-band 배포 감지 판정 순수 코어 (SPEC-035).
//
// 문제(실측 제보): infra 산출물(Grafana 대시보드 ConfigMap 등)을 워킹트리에서 고친 뒤 `kubectl apply`로
// 라이브에 즉시 반영하는 패턴에서, 스펙 갱신이 강제되지 않는다. `check-spec-sync`는 commit-msg 훅이라
// **커밋 시점**에만 발화하는데 이 패턴은 "배포가 커밋보다 먼저"라, 커밋을 미루는 동안 spec↔live
// 드리프트가 누적된다(실사례: INFRA-005 라이브→저장소 역방향 드리프트 흡수).
//
// 원칙: **라이브에 반영된 것은 커밋 전이라도 spec Change Log에 먼저 착지해야 한다.**
// 게이트 발화 지점을 커밋에서 **배포 행위**까지 앞당긴다.
//
// 비차단이다 — PostToolUse는 이미 실행된 뒤에 도는 훅이라 막을 것이 없고, 배포를 되돌리는 것은
// 게이트의 일이 아니다. 할 수 있는 일은 **즉시 상기시키고 세션에 부채로 남기는 것**이다.
// 순수 함수(IO 없음) — git 조회·파일 읽기는 소비 게이트.

// 기본 감지 패턴 — 상태를 바꾸는 선언적 배포 명령. 프로젝트가 outOfBandDeployCommands로 대체·확장한다.
// 조회 명령(get·describe·plan·diff·dry-run)은 대상이 아니다: 상태를 바꾸지 않으므로 드리프트를 만들지 않는다.
export const DEFAULT_DEPLOY_PATTERNS = [
  "kubectl\\s+(apply|replace|patch|create|delete)\\b",
  "kubectl\\s+rollout\\s+restart\\b",
  "helm\\s+(install|upgrade|uninstall)\\b",
  "terraform\\s+apply\\b",
  "aws\\s+\\S+\\s+(create|update|put|delete)\\S*\\b",
  "gcloud\\s+\\S+\\s+(create|update|deploy|delete)\\b",
  "az\\s+\\S+\\s+(create|update|delete)\\b",
];

// dry-run·plan은 상태를 바꾸지 않는다 — 감지에서 제외한다(오탐이 잦으면 훅이 꺼진다).
const DRY_RUN_RE = /--dry-run(=\S+)?|--server-dry-run|-o\s+yaml\s*$|--plan\b/;

// 명령에서 배포 여부와 소스 파일 인자를 뽑는다.
// 반환 {matched, tool, paths[]} — paths는 -f/--filename/-k/--kustomize 인자와 명시 파일 경로.
export function parseDeployCommand(command, patterns = DEFAULT_DEPLOY_PATTERNS) {
  const cmd = String(command || "");
  if (!cmd.trim()) return { matched: false, tool: "", paths: [] };
  if (DRY_RUN_RE.test(cmd)) return { matched: false, tool: "", paths: [] };
  let tool = "";
  for (const p of patterns) {
    const m = cmd.match(new RegExp(p));
    if (m) { tool = m[0].replace(/\s+/g, " ").trim(); break; }
  }
  if (!tool) return { matched: false, tool: "", paths: [] };

  const paths = [];
  for (const m of cmd.matchAll(/(?:^|\s)(?:-f|--filename|-k|--kustomize|--values|--var-file)[=\s]+("[^"]+"|'[^']+'|\S+)/g)) {
    const raw = m[1].replace(/^["']|["']$/g, "");
    if (raw && raw !== "-" && !/^https?:\/\//.test(raw)) paths.push(raw);
  }
  return { matched: true, tool, paths: [...new Set(paths)] };
}

// spec diff에 Change Log 행이 **추가**됐는가 — `+| 2026-… | … | … |` 형태의 추가 라인.
// 표 행 추가만 센다(산문 수정은 기록이 아니다). 열 3개 이상을 요구해 구분선·헤더를 배제한다.
export function changeLogAdded(diffText) {
  for (const line of String(diffText || "").split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1).trim();
    if (!body.startsWith("|")) continue;
    const cells = body.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 3 && cells.every((c) => c.length > 0) && !/^-+$/.test(cells[0])) return true;
  }
  return false;
}

// 선언적 산출물의 최소 기록 형식 — 무엇을·왜·실측 여부.
// 표 행이 {날짜 | 변경 | 근거}를 채웠는지(무엇·왜)와 실측 표기(`[검증: 경로]` 또는 `[미확인]`)를 본다.
// 형식만 본다 — 내용의 타당성은 리뷰 몫이다(smokeManifest·evidenceManifest와 같은 경계).
export function changeLogRowShape(diffText) {
  const rows = [];
  for (const line of String(diffText || "").split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1).trim();
    if (!body.startsWith("|")) continue;
    const cells = body.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0])) continue;
    rows.push({
      cells,
      hasWhat: cells[1].length > 0,
      hasWhy: cells[2].length > 0,
      hasEvidence: /\[검증\s*[:：]|\[미확인\]/.test(body),
    });
  }
  return rows;
}

// 최종 판정. 입력은 전부 소비 게이트가 조회해 넘긴다.
//   deployed: 배포 소스로 쓰인 경로들 / dirty: 워킹트리에서 미커밋인 경로 집합
//   ownerOf(path) -> specId|null / specTouched(specId) -> {changed, diff}
// 반환 findings[] — kind: unowned | spec-untouched | no-changelog | thin-record
export function deployGuardFindings(deployed, dirty, ownerOf, specTouched) {
  const findings = [];
  const seenSpec = new Set();
  for (const p of deployed || []) {
    if (!dirty.has(p)) continue; // 커밋된 것을 배포한 것은 정상 궤도
    const specId = ownerOf(p);
    if (!specId) { findings.push({ kind: "unowned", path: p }); continue; }
    if (seenSpec.has(specId)) continue;
    seenSpec.add(specId);
    const st = specTouched(specId) || { changed: false, diff: "" };
    if (!st.changed) { findings.push({ kind: "spec-untouched", path: p, specId }); continue; }
    if (!changeLogAdded(st.diff)) { findings.push({ kind: "no-changelog", path: p, specId }); continue; }
    const rows = changeLogRowShape(st.diff);
    const thin = rows.filter((r) => !r.hasWhat || !r.hasWhy || !r.hasEvidence);
    if (thin.length) findings.push({ kind: "thin-record", path: p, specId, rows: thin.length });
  }
  return findings;
}
