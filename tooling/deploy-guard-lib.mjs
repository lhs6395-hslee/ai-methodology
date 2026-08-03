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
  "terraform\\s+destroy\\b",
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

  // 옵션은 **단일 대시도 받는다** — Terraform 공식 문법이 `-var-file=`(단일)이라 이중 대시만
  // 인식하면 terraform 배포에서 경로가 하나도 안 잡히고, 경로가 없으면 소비 게이트가 조기 종료해
  // 판정 자체가 성립하지 않는다(실측 제보: terraform이 주 배포 수단이면 이 게이트는 사실상
  // kubectl·helm 전용이었다).
  const paths = [];
  for (const m of cmd.matchAll(/(?:^|\s)--?(?:f|filename|k|kustomize|values|var-file|backend-config)[=\s]+("[^"]+"|'[^']+'|\S+)/g)) {
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

// ── 배포 전제 조건 — "이 배포가 재현 가능한 리비전에서 나오는가" ──
// 실측 제보: 킷 가드가 `terraform apply`를 정확히 감지하고도 막지 못했다. 감지 후 묻는 것이
// **"스펙에 반영됐나"** 하나뿐이었기 때문이다. 물었어야 하는 것은 하나 더 있다 —
// **"이 배포가 재현 가능한 리비전에서 나오는가."** 커밋되지 않은 트리에서 나간 배포는 어떤
// 커밋으로도 재현되지 않고, upstream보다 뒤진 트리에서 나간 배포는 남의 변경을 조용히 되돌린다.
//
// 이 판정은 **사전 가능**하다(순수 git 조회, 오탐 거의 없음) — 그래서 발화 지점이 PostToolUse가
// 아니라 PreToolUse다. 스펙 드리프트는 사후 상기가 맞지만(되돌릴 수 없는 것을 막는 척하지 않는다),
// 전제 조건은 배포 **전에** 알 수 있으므로 사후 상기로 미루면 그냥 늦는 것이다.
// 실측: 사후 상기는 같은 세션의 **두 번째 apply**를 막지 못했다.
//
// gitFacts: {dirty:[경로], behind:number|null, upstream:string|null, branch:string}
// 반환 [{kind, detail}] — kind: dirty-tree | behind-upstream | no-upstream(판정 불가, 위반 아님)
export function deployPreconditionFindings(gitFacts, deployedPaths = []) {
  const f = gitFacts || {};
  const out = [];
  const dirty = f.dirty || [];
  if (dirty.length) {
    // 배포 소스가 특정됐으면 그것만, 아니면 트리 전체 — 소스가 깨끗해도 트리가 더러우면
    // terraform이 읽는 주변 모듈·tfvars가 미커밋일 수 있어 여전히 재현되지 않는다.
    const owned = (deployedPaths || []).filter((p) => dirty.includes(p));
    out.push({
      kind: "dirty-tree",
      detail: owned.length
        ? `배포 소스가 미커밋이다(${owned.slice(0, 3).join(", ")}${owned.length > 3 ? ` 외 ${owned.length - 3}건` : ""}) — 이 배포는 **어떤 커밋으로도 재현되지 않는다**`
        : `워킹트리에 미커밋 변경 ${dirty.length}건 — 배포 소스가 깨끗해도 주변 모듈·변수 파일이 미커밋이면 같은 결과가 재현되지 않는다`,
    });
  }
  if (f.upstream === null || f.upstream === undefined || f.upstream === "") {
    // 판정 못 함과 위반 없음을 섞지 않는다(SPEC-032 동형) — upstream이 없으면 behind를 알 수 없다.
    out.push({ kind: "no-upstream", detail: `현재 브랜치(${f.branch || "?"})에 upstream이 없어 뒤처짐을 판정할 수 없다 — 위반 없음이 아니라 **미판정**이다` });
  } else if (Number(f.behind) > 0) {
    out.push({ kind: "behind-upstream", detail: `${f.upstream}보다 ${f.behind}커밋 뒤처져 있다 — 남의 변경을 되돌리는 배포가 된다(pull 후 재배포)` });
  }
  return out;
}

// ── 승인 우회와 파괴적 변경 — "적용되는 것이 사람이 승인한 것과 같은가" ──
// 실측 사고(2026-08-03, 프로덕션 전면 403 두 번): terraform이 **코드에 없는** CloudFront 커스텀
// 헤더를 "관리 대상 외 잔여물"로 보고 삭제했고, 앱 proxy는 그 헤더가 없으면 전 요청을 403으로
// 막는다. `terraform apply`는 exit 0, 로그에 실패 없음, 사이트만 죽었다.
//
// 그 삭제는 **plan에 있었다.** 아무도 보지 않았을 뿐이다. 그래서 두 가지를 사전에 본다:
//   ⓐ 승인 우회 — `-auto-approve`인데 **저장된 plan 파일이 없다**. 대화형 승인이 diff를 보는
//      유일한 지점인데 그것을 건너뛰면 "승인한 것"이라는 개념 자체가 없다. 반대로 저장된 plan을
//      적용하는 `-auto-approve`는 정당하다(승인한 것 = 적용되는 것) — CI가 이 형태다.
//   ⓑ 파괴적 명령 — destroy·delete·uninstall. 감지 목록에 있어도 **다른 명령과 같은 강도로**
//      다뤄지면 삭제가 갱신과 구분되지 않는다. 명시적 동의(`SDD_DESTROY_OK=1`)를 요구한다.
//
// 순수 함수 — 명령 문자열과 주입된 환경만 본다(plan 내용 파싱은 하지 않는다: 그건 terraform의
// 일이고, 여기서 흉내내면 도구별 포맷을 킷이 떠안는다).
const AUTO_APPROVE_RE = /(?:^|\s)--?auto-approve\b|(?:^|\s)--force\b/;
const DESTRUCTIVE_RE = /terraform\s+destroy\b|kubectl\s+delete\b|helm\s+uninstall\b|(?:aws|gcloud|az)\s+\S+\s+delete\S*\b/;

// `terraform apply <plan>` 의 저장된 plan 파일(위치 인자) 추정 — 플래그도 `key=value`도 아닌 토큰.
// 있으면 "승인한 계획을 적용하는 것"이라 auto-approve가 정당해진다.
export function hasSavedPlanArg(command) {
  const m = String(command || "").match(/terraform\s+apply\b(.*)$/);
  if (!m) return false;
  for (const raw of m[1].split(/\s+/)) {
    const t = raw.trim().replace(/^["']|["']$/g, "");
    if (!t || t.startsWith("-") || t.includes("=")) continue;
    return true;
  }
  return false;
}

// 반환 [{kind, detail}] — kind: unapproved-apply | destructive | destructive-consented(위반 아님, 흔적)
export function deployApprovalFindings(command, opts = {}) {
  const cmd = String(command || "");
  const out = [];
  if (AUTO_APPROVE_RE.test(cmd) && !hasSavedPlanArg(cmd)) {
    out.push({
      kind: "unapproved-apply",
      detail: "승인 없이 적용한다(`-auto-approve`인데 저장된 plan 파일이 없다) — **적용되는 diff를 아무도 보지 않는다**. 실측 사고: plan에 있던 커스텀 헤더 삭제가 그대로 나가 프로덕션이 전면 403이 됐다. `terraform plan -out=<파일>` 후 그 파일을 적용하라(승인한 것 = 적용되는 것)",
    });
  }
  if (DESTRUCTIVE_RE.test(cmd)) {
    // 명시적 동의는 **우회가 아니라 선언**이다 — 매 실행마다 사람이 다시 적어야 하고 흔적이 남는다.
    if (opts.destroyOk) {
      out.push({ kind: "destructive-consented", detail: "파괴적 명령이지만 `SDD_DESTROY_OK=1`로 명시 동의됨 — 삭제 대상을 확인했다는 선언으로 기록한다" });
    } else {
      out.push({
        kind: "destructive",
        detail: "파괴적 명령이다(destroy·delete·uninstall) — 삭제는 갱신과 같은 강도로 다뤄지면 안 된다. 무엇이 지워지는지 확인한 뒤 `SDD_DESTROY_OK=1`을 붙여 다시 실행하라",
      });
    }
  }
  return out;
}

// 전제 조건 판정 결과 → 강도별 처분. blocking은 hard일 때 **위반이 있을 때만** 참이다.
// no-upstream(미판정)은 hard에서도 차단하지 않는다 — 알 수 없는 것을 위반으로 세면 오탐이고,
// 오탐이 잦은 사전 차단은 사람이 훅을 꺼버린다(우회를 유발하는 강제는 강제가 아니다).
export function deployPreconditionVerdict(policy, findings) {
  const pol = String(policy || "off");
  if (pol === "off") return { judged: false, blocking: false, violations: [], unknowns: [] };
  const INFO = new Set(["no-upstream", "destructive-consented"]);
  const violations = (findings || []).filter((f) => !INFO.has(f.kind));
  const unknowns = (findings || []).filter((f) => INFO.has(f.kind));
  return { judged: true, blocking: pol === "hard" && violations.length > 0, violations, unknowns };
}

// ── 배포판 거짓 안전 — "명령이 성공했다"와 "서비스가 살아 있다"는 다른 사실 ──
// 정본 §7은 "게이트가 판정 없이 exit 0"을 다루는데, 배포에는 사촌이 있다:
// **배포 명령이 성공해도 서비스는 죽을 수 있다.** 실측: apply 성공 · CI 초록 · 전 요청 403.
// 그래서 배포 계약에 `deploySmokeCommand`를 넣고, **미선언 자체를 부채로 계상**한다 —
// "아무도 확인하지 않았다"와 "확인했고 살아 있다"가 같은 침묵으로 보이면 안 된다.
//
// 반전 주의: 테스트·스모크에서 비-0은 skip이 아니라 **실패**다(어댑터 일반 규약의 예외 —
// e2ePrecheck와 같은 판단). 그래서 실행 실패는 skipped가 아니라 위반으로 분류한다.
// 반환 {status, detail} — status: undeclared | alive | dead | error
export function deploySmokeVerdict(command, run) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return { status: "undeclared", detail: "`deploySmokeCommand` 미선언 — 배포 성공이 서비스 생존을 뜻하지 않는데(실측: apply 성공·CI 초록·전 요청 403) 아무도 확인하지 않았다. 이 침묵은 '살아 있음'과 구분되지 않는다" };
  }
  let r;
  try { r = run(cmd); } catch (e) { r = { exitCode: 1, stderr: String((e && e.message) || e) }; }
  if (r && r.exitCode === 0) return { status: "alive", detail: `스모크 통과 — \`${cmd}\`` };
  const why = String((r && r.stderr) || "").trim().split("\n").filter(Boolean).pop() || `exit ${r && r.exitCode}`;
  return { status: "dead", detail: `**배포는 성공했는데 스모크가 실패했다** — \`${cmd}\` → ${why}. 명령의 성공은 서비스의 생존이 아니다` };
}

// ── 세션 부채(JSONL) — hard 정책의 실체 ──
// advisory와 hard가 출력만 같으면 승격이 이름뿐이다(실측 제보: 둘이 구분 불가능했다).
// hard는 미기록 배포를 부채 파일에 적재하고, pre-commit이 그 부채가 남아 있으면 커밋을 막는다.
// 배포 시점은 여전히 비차단이다 — 막을 수 있는 유일한 지점은 아직 오지 않은 커밋이다.

// 부채 한 줄 = 하나의 finding. date는 호출부가 주입한다(순수 유지 — 시계는 IO다).
export function debtLine(date, tool, finding) {
  return JSON.stringify({
    date: String(date || ""), tool: String(tool || ""),
    kind: finding.kind, path: finding.path, specId: finding.specId || "",
  });
}

// JSONL 파싱 — 깨진 줄은 **버리지 않고** 보존한다(부채를 파싱 실패로 지우면 그게 세탁이다).
export function parseDebt(text) {
  const open = [];
  const malformed = [];
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o = null;
    try { o = JSON.parse(s); } catch { /* below */ }
    if (o && typeof o === "object" && !Array.isArray(o) && o.path) open.push({ ...o, raw: s });
    else malformed.push(s);
  }
  return { open, malformed };
}

// 부채 해소 판정 — 부채 종류마다 "갚는다"의 뜻이 다르므로 판정은 게이트가 주입한다.
//   isSettled(debt) -> boolean
// 갚는 길이 **없는** 부채를 만들면 그건 강제가 아니라 벽돌이다(우회를 유발하는 강제는 강제가
// 아니다) — 그래서 종류별로 실제로 도달 가능한 해소 조건이 있어야 한다:
//   spec-untouched·no-changelog·thin-record → 소유 스펙 Change Log 행이 이번 커밋에 착지
//   smoke-undeclared                        → `deploySmokeCommand`가 선언됨(계약 공백이 닫힘)
//   smoke-dead                              → 지금 스모크가 통과함(서비스가 살아남)
//   unowned                                 → 소유 스펙이 생겨 그 경로를 Files로 덮음
export function settleDebt(open, isSettled) {
  const settled = [];
  const remaining = [];
  for (const d of open || []) {
    let ok = false;
    try { ok = !!isSettled(d); } catch { ok = false; }   // 판정 실패는 해소가 아니다
    (ok ? settled : remaining).push(d);
  }
  return { settled, remaining };
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
