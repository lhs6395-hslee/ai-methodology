// tooling/__tests__/deploy-guard.test.mjs — out-of-band 배포 가드 (SPEC-035)
// 실측 제보: infra 산출물을 워킹트리에서 고쳐 `kubectl apply`로 라이브에 즉시 반영하는 궤도에서는
// 배포가 커밋보다 먼저다. check-spec-sync는 commit-msg 훅이라 커밋을 미루는 동안 아무 신호가 없고
// spec↔live 드리프트가 누적된다(INFRA-005 역방향 흡수 사례). 발화 지점을 배포 행위까지 앞당긴다.
// @covers SPEC-035/FR-001
// @covers SPEC-035/FR-002
// @covers SPEC-035/FR-003
// @covers SPEC-035/FR-004
// @covers SPEC-035/FR-005
// @covers SPEC-035/FR-006
// @covers SPEC-035/FR-007
// @covers SPEC-035/FR-008
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DEPLOY_PATTERNS, parseDeployCommand, changeLogAdded, changeLogRowShape, deployGuardFindings,
  debtLine, parseDebt, settleDebt,
  deployPreconditionFindings, deployPreconditionVerdict, deploySmokeVerdict,
  deployApprovalFindings, hasSavedPlanArg,
} from "../deploy-guard-lib.mjs";

const GATE = new URL("../check-deploy-guard.mjs", import.meta.url).pathname;
const DEBT_GATE = new URL("../check-deploy-debt.mjs", import.meta.url).pathname;
const PRE_GATE = new URL("../check-deploy-precheck.mjs", import.meta.url).pathname;

test("parseDeployCommand: 상태 변경 명령만 감지, dry-run·조회는 제외, 소스 경로 추출", () => {
  const a = parseDeployCommand("kubectl apply -f k8s/dashboard.yaml");
  assert.equal(a.matched, true); assert.deepEqual(a.paths, ["k8s/dashboard.yaml"]);
  assert.deepEqual(parseDeployCommand("helm upgrade app ./chart --values env/prod.yaml").paths, ["env/prod.yaml"]);
  assert.equal(parseDeployCommand("kubectl get pods").matched, false);      // 조회
  assert.equal(parseDeployCommand("terraform plan").matched, false);        // 계획
  assert.equal(parseDeployCommand("kubectl apply -f x.yaml --dry-run=client").matched, false);
  assert.equal(parseDeployCommand("kubectl apply -f https://ex/x.yaml").paths.length, 0); // 원격은 소스 아님
  // 실측 제보: Terraform 공식 문법은 **단일 대시**(`-var-file=`)라 이중 대시만 인식하면 경로가
  // 하나도 안 잡히고, 경로가 없으면 소비 게이트가 조기 종료해 판정 자체가 성립하지 않았다
  // (terraform이 주 배포 수단인 프로젝트에서 이 게이트는 사실상 kubectl·helm 전용).
  assert.deepEqual(parseDeployCommand("terraform apply -var-file=stages/dev/x.tfvars").paths,
    ["stages/dev/x.tfvars"]);
  assert.deepEqual(parseDeployCommand("terraform apply -var-file stages/prod.tfvars -backend-config=be.hcl").paths,
    ["stages/prod.tfvars", "be.hcl"]);
  assert.equal(parseDeployCommand("terraform plan -var-file=x.tfvars").matched, false); // plan은 여전히 제외
  assert.ok(DEFAULT_DEPLOY_PATTERNS.length > 0);
});

test("changeLogAdded / changeLogRowShape: 추가된 표 행만 세고, 무엇·왜·실측을 본다", () => {
  assert.equal(changeLogAdded("+| 2026-08-02 | 패널 추가 | 요청 |\n"), true);
  assert.equal(changeLogAdded("+본문만 고쳤다\n"), false);
  assert.equal(changeLogAdded("+|---|---|---|\n"), false);          // 구분선은 기록이 아니다
  assert.equal(changeLogAdded("+++ b/spec.md\n"), false);            // diff 헤더
  const rows = changeLogRowShape("+| 2026-08-02 | 패널 추가 | 요청 [검증: docs/e/a.png] |\n+| 2026-08-02 | x | y |\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hasEvidence, true);
  assert.equal(rows[1].hasEvidence, false);
});

test("deployGuardFindings: 커밋된 소스는 침묵 / 미소유·스펙미수정·기록없음·형식미달을 구분", () => {
  const dirty = new Set(["k8s/a.yaml", "k8s/b.yaml", "k8s/c.yaml", "k8s/d.yaml"]);
  const owner = { "k8s/a.yaml": null, "k8s/b.yaml": "INFRA-001", "k8s/c.yaml": "INFRA-002", "k8s/d.yaml": "INFRA-003" };
  const touched = {
    "INFRA-001": { changed: false, diff: "" },
    "INFRA-002": { changed: true, diff: "+산문만 고침\n" },
    "INFRA-003": { changed: true, diff: "+| 2026-08-02 | x | y |\n" },
  };
  const f = deployGuardFindings(["k8s/a.yaml", "k8s/b.yaml", "k8s/c.yaml", "k8s/d.yaml", "k8s/committed.yaml"],
    dirty, (p) => owner[p], (s) => touched[s]);
  assert.deepEqual(f.map((x) => x.kind), ["unowned", "spec-untouched", "no-changelog", "thin-record"]);
  // 커밋된 소스는 정상 궤도라 findings에 없다
  assert.ok(!f.some((x) => x.path === "k8s/committed.yaml"));
});

test("게이트 e2e: 미커밋 소스 배포 → 경고하되 **항상 exit 0**(이미 실행된 뒤이므로 차단 불가)", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-dg-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "k8s"), { recursive: true });
  const sh = (c) => execFileSync("sh", ["-c", c], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    // 스모크를 선언해 둔다 — 미선언 자체가 발화 사유이므로(FR-007), 그러면 "깨끗하면 침묵"을 못 본다
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", deploySmokeCommand: "sh -c 'exit 0'" }));
    writeFileSync(join(root, "sdd/specs/INFRA-001.md"),
      "**Spec**: `INFRA-001`\n## Ownership\n- **Files**: k8s/**\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n");
    writeFileSync(join(root, "k8s/x.yaml"), "apiVersion: v1\n");
    sh("git init -q . && git add -A && git -c user.name=t -c user.email=t@t commit -qm base");
    writeFileSync(join(root, "k8s/x.yaml"), "apiVersion: v1\ndata: {a: b}\n");

    const r = execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"],
      { cwd: root, encoding: "utf8" });
    assert.match(r, /out-of-band 배포 감지/);
    assert.match(r, /소유 INFRA-001 미수정/);
    assert.match(r, /advisory — 이 경고는 차단하지 않고 어디에도 남지 않는다/);

    // 커밋하면 정상 궤도 — 침묵
    sh("git add -A && git -c user.name=t -c user.email=t@t commit -qm deploy");
    const q = execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: root, encoding: "utf8" });
    assert.equal(q.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 세션 부채(hard 정책의 실체) ──
// 실측 제보: advisory와 hard가 출력도 동작도 같았다 — 승격해도 달라지는 것이 없으면 그 정책은
// 승격 대상이 아니라 장식이다. 배포 시점은 막을 수 없지만 **아직 오지 않은 커밋**은 막을 수 있다.

test("parseDebt / settleDebt: 깨진 줄은 보존, 소유 스펙 Change Log 착지분만 해소", () => {
  const text = [
    debtLine("2026-08-02", "kubectl apply", { kind: "spec-untouched", path: "k8s/a.yaml", specId: "INFRA-001" }),
    debtLine("2026-08-02", "helm upgrade", { kind: "no-changelog", path: "chart/values.yaml", specId: "INFRA-002" }),
    debtLine("2026-08-02", "kubectl apply", { kind: "unowned", path: "k8s/z.yaml" }),
    "{깨진 줄",
  ].join("\n");
  const { open, malformed } = parseDebt(text);
  assert.equal(open.length, 3);
  assert.deepEqual(malformed, ["{깨진 줄"]);   // 파싱 실패로 부채를 지우면 그게 세탁이다
  const { settled, remaining } = settleDebt(open, (d) => d.specId === "INFRA-001");
  assert.deepEqual(settled.map((d) => d.specId), ["INFRA-001"]);
  assert.deepEqual(remaining.map((d) => d.path), ["chart/values.yaml", "k8s/z.yaml"]);
  // 소유 없는 부채는 해소 판정 대상이 아니다 — 소유가 생겨야 갚힌다
  assert.equal(settleDebt(open, (d) => !!d.specId).remaining.length, 1);
});

function debtFixture(policy) {
  const root = mkdtempSync(join(tmpdir(), "sdd-debt-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  mkdirSync(join(root, "k8s"), { recursive: true });
  const sh = (c) => execFileSync("sh", ["-c", c], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", outOfBandDeployPolicy: policy, deploySmokeCommand: "sh -c 'exit 0'" }));
  writeFileSync(join(root, "sdd/specs/INFRA-001.md"),
    "**Spec**: `INFRA-001`\n## Ownership\n- **Files**: k8s/**\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n");
  writeFileSync(join(root, "k8s/x.yaml"), "apiVersion: v1\n");
  sh("git init -q . && git add -A && git -c user.name=t -c user.email=t@t commit -qm base");
  writeFileSync(join(root, "k8s/x.yaml"), "apiVersion: v1\ndata: {a: b}\n");
  return { root, sh };
}
const runDebt = (root) => {
  try { return { code: 0, out: execFileSync("node", [DEBT_GATE], { cwd: root, encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
};

test("게이트 e2e: advisory는 아무것도 남기지 않고 / hard는 부채를 적재해 다음 커밋을 막는다", () => {
  const adv = debtFixture("advisory");
  try {
    execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: adv.root, encoding: "utf8" });
    assert.equal(existsSync(join(adv.root, ".sdd/deploy-debt.jsonl")), false); // advisory = 스크롤과 함께 죽는다
    assert.equal(runDebt(adv.root).code, 0);                                    // 부채 게이트는 hard 아니면 침묵
  } finally { rmSync(adv.root, { recursive: true, force: true }); }

  const h = debtFixture("hard");
  try {
    const w = execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: h.root, encoding: "utf8" });
    assert.match(w, /세션 부채로 적재했다/);
    const debt = readFileSync(join(h.root, ".sdd/deploy-debt.jsonl"), "utf8");
    assert.match(debt, /"specId":"INFRA-001"/);
    // 배포 자체는 여전히 비차단이다(PostToolUse는 이미 실행된 뒤에 돈다)
    const blocked = runDebt(h.root);
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /잔여 1건/);
    assert.match(blocked.out, /부채 파일을 손으로 지우는 것은 갚는 것이 아니다/);
  } finally { rmSync(h.root, { recursive: true, force: true }); }
});

test("게이트 e2e: 소유 스펙 Change Log 행이 스테이징되면 부채는 그 자리에서 자동 해소", () => {
  const h = debtFixture("hard");
  try {
    execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: h.root, encoding: "utf8" });
    assert.equal(runDebt(h.root).code, 1);
    const spec = join(h.root, "sdd/specs/INFRA-001.md");
    writeFileSync(spec, readFileSync(spec, "utf8") + "| 2026-08-02 | ConfigMap data 반영 | 대시보드 쿼리 교정 [검증: k8s/x.yaml] |\n");
    h.sh("git add -A");
    const r = runDebt(h.root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /해소 1건/);
    assert.match(r.out, /미기록 배포 부채 없음/);
    assert.equal(readFileSync(join(h.root, ".sdd/deploy-debt.jsonl"), "utf8").trim(), ""); // 해소분만 제거
  } finally { rmSync(h.root, { recursive: true, force: true }); }
});

// ── 배포 전제 조건 (FR-006) ──
// 실측 제보: 가드가 `terraform apply`를 정확히 감지하고도 막지 못했다 — 감지 후 묻는 것이
// "스펙에 반영됐나" 하나뿐이었다. 물었어야 하는 것: **"재현 가능한 리비전에서 나오는가."**
// 그리고 사후 상기는 같은 세션의 **두 번째 apply**도 막지 못했다.

test("deployPreconditionFindings: 미커밋·뒤처짐은 위반 / upstream 없음은 미판정(위반 아님)", () => {
  const clean = deployPreconditionFindings({ dirty: [], behind: 0, upstream: "origin/main", branch: "main" }, []);
  assert.deepEqual(clean, []);

  const dirtySrc = deployPreconditionFindings(
    { dirty: ["stages/dev/x.tfvars"], behind: 0, upstream: "origin/main", branch: "main" }, ["stages/dev/x.tfvars"]);
  assert.deepEqual(dirtySrc.map((f) => f.kind), ["dirty-tree"]);
  assert.match(dirtySrc[0].detail, /어떤 커밋으로도 재현되지 않는다/);

  // 배포 소스는 깨끗한데 트리가 더러운 경우도 재현되지 않는다(주변 모듈·변수 파일)
  const dirtyTree = deployPreconditionFindings(
    { dirty: ["other.tf"], behind: 0, upstream: "origin/main", branch: "main" }, ["a.tfvars"]);
  assert.match(dirtyTree[0].detail, /주변 모듈·변수 파일/);

  assert.deepEqual(
    deployPreconditionFindings({ dirty: [], behind: 3, upstream: "origin/main", branch: "main" }, []).map((f) => f.kind),
    ["behind-upstream"]);
  // 판정 못 함과 위반 없음을 섞지 않는다
  const noUp = deployPreconditionFindings({ dirty: [], behind: null, upstream: null, branch: "wip" }, []);
  assert.deepEqual(noUp.map((f) => f.kind), ["no-upstream"]);
  assert.match(noUp[0].detail, /미판정/);
});

test("deployPreconditionVerdict: hard만 차단하고, 미판정은 hard에서도 차단하지 않는다", () => {
  const viol = deployPreconditionFindings({ dirty: ["a"], behind: 0, upstream: "o/m", branch: "m" }, []);
  assert.equal(deployPreconditionVerdict("off", viol).judged, false);
  assert.equal(deployPreconditionVerdict("advisory", viol).blocking, false);
  assert.equal(deployPreconditionVerdict("hard", viol).blocking, true);
  // 알 수 없는 것을 위반으로 세면 오탐이고, 오탐이 잦은 사전 차단은 훅을 꺼지게 만든다
  const unknown = deployPreconditionFindings({ dirty: [], behind: null, upstream: null, branch: "wip" }, []);
  const v = deployPreconditionVerdict("hard", unknown);
  assert.equal(v.blocking, false);
  assert.equal(v.unknowns.length, 1);
});

test("게이트 e2e(전제): 깨끗하면 침묵 · advisory는 통과 · hard는 exit 2로 배포를 막는다", () => {
  const h = debtFixture("advisory");   // 워킹트리에 미커밋 k8s/x.yaml이 남아 있는 픽스처
  try {
    const cfgPath = join(h.root, "sdd.config.json");
    const run = (pol) => {
      writeFileSync(cfgPath, JSON.stringify({ specDir: "sdd/specs", deployPreconditionPolicy: pol }));
      try { return { code: 0, out: execFileSync("node", [PRE_GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: h.root, encoding: "utf8" }) }; }
      catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
    };
    assert.equal(run("off").out.trim(), "");                    // off = 판정 안 함

    const adv = run("advisory");
    assert.equal(adv.code, 0);
    assert.match(adv.out, /배포 소스가 미커밋이다/);
    assert.match(adv.out, /advisory — 차단하지 않는다/);

    const hard = run("hard");
    assert.equal(hard.code, 2, "PreToolUse 규약 — 비-0이 도구 실행을 막는다");
    assert.match(hard.out, /배포 전제 조건 미충족/);
    assert.match(hard.out, /advisory로 내리지 말고/);           // 완화를 처방으로 내밀지 않는다

    // 커밋하면 dirty 위반은 사라진다. 이 픽스처엔 upstream이 없어 뒤처짐은 **미판정**으로 남는데,
    // 그것은 hard에서도 차단하지 않는다(모르는 것을 위반으로 세면 오탐이고, 오탐은 훅을 꺼지게 한다).
    h.sh("git add -A && git -c user.name=t -c user.email=t@t commit -qm deploy");
    const after = run("hard");
    assert.equal(after.code, 0);
    assert.doesNotMatch(after.out, /미커밋/);
    assert.match(after.out, /판정하지 못한 것.*'통과'와 같지 않다/);

    // upstream이 있고 최신이면 완전히 침묵한다 — 조용할 자격이 있는 상태
    h.sh("git init -q --bare ../up.git 2>/dev/null || true; git remote add origin ../up.git 2>/dev/null || true; git push -q -u origin HEAD 2>/dev/null || true");
    const clean = run("hard");
    if (/upstream/.test(clean.out)) return;   // 원격 배선 불가 환경이면 위 판정으로 충분
    assert.equal(clean.out.trim(), "", clean.out);
  } finally { rmSync(h.root, { recursive: true, force: true }); }
});

// ── 배포판 거짓 안전 (FR-007) ──
// 정본 §7은 "게이트가 판정 없이 exit 0"을 다루는데, 배포엔 사촌이 있다:
// **배포 명령이 성공해도 서비스는 죽을 수 있다**(실측: apply 성공 · CI 초록 · 전 요청 403).

test("deploySmokeVerdict: 미선언은 부채 · 통과는 alive · 비-0은 skip이 아니라 dead", () => {
  assert.equal(deploySmokeVerdict("", null).status, "undeclared");
  assert.match(deploySmokeVerdict(null, null).detail, /배포 성공이 서비스 생존을 뜻하지 않는데/);
  assert.equal(deploySmokeVerdict("curl -f https://x/health", () => ({ exitCode: 0 })).status, "alive");
  const dead = deploySmokeVerdict("curl -f https://x/health", () => ({ exitCode: 22, stderr: "HTTP 403" }));
  assert.equal(dead.status, "dead");
  assert.match(dead.detail, /HTTP 403/);
  assert.match(dead.detail, /명령의 성공은 서비스의 생존이 아니다/);
  // 실행 자체가 던져도 dead다 — 확인 못 한 것을 살아있음으로 세지 않는다
  assert.equal(deploySmokeVerdict("x", () => { throw new Error("spawn fail"); }).status, "dead");
});

test("게이트 e2e(스모크): 미선언은 경로 없는 배포에서도 발화 · 죽으면 부채로 적재되고 살아나면 해소", () => {
  const h = debtFixture("hard");
  const cfgPath = join(h.root, "sdd.config.json");
  const setCfg = (extra) => writeFileSync(cfgPath, JSON.stringify({
    specDir: "sdd/specs", outOfBandDeployPolicy: "hard", ...extra,
  }));
  try {
    // 경로 인자가 없는 배포(rollout restart) — 예전엔 조기 종료로 축 전체가 삼켜졌다
    setCfg({});
    const noPath = execFileSync("node", [GATE, "--command", "kubectl rollout restart deploy/api"], { cwd: h.root, encoding: "utf8" });
    assert.match(noPath, /deploySmokeCommand` 미선언/);

    // 스모크가 죽으면 부채로 적재되고 커밋이 막힌다
    setCfg({ deploySmokeCommand: "sh -c 'exit 22'" });
    const dead = execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: h.root, encoding: "utf8" });
    assert.match(dead, /배포는 성공했는데 스모크가 실패했다/);
    const blocked = runDebt(h.root);
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /smoke-dead/);

    // 스펙 편집으로는 갚아지지 않는다 — 서비스가 살아나야 해소된다
    setCfg({ deploySmokeCommand: "sh -c 'exit 0'" });
    const ok = runDebt(h.root);
    assert.match(ok.out, /스모크를 재실행했다 — 통과/);
    assert.match(ok.out, /스모크 계약 충족 — 해소/);
  } finally { rmSync(h.root, { recursive: true, force: true }); }
});

// ── 승인 우회·파괴적 변경 (FR-008) ──
// 실측 사고(2026-08-03, 프로덕션 전면 403 두 번): terraform이 코드에 없는 CloudFront 커스텀 헤더를
// "관리 대상 외 잔여물"로 보고 삭제했고 앱 proxy는 그 헤더가 없으면 전 요청을 403으로 막는다.
// `terraform apply` exit 0, 로그에 실패 없음, 사이트만 죽었다.
// **그 삭제는 plan에 있었다 — 아무도 보지 않았을 뿐이다.**

test("파괴적 명령이 감지 목록에 있다 — `terraform destroy`가 아예 안 잡히던 것이 결함이었다", () => {
  assert.equal(parseDeployCommand("terraform destroy").matched, true);
  assert.equal(parseDeployCommand("terraform destroy -auto-approve").tool, "terraform destroy");
  assert.equal(parseDeployCommand("terraform plan -destroy").matched, false); // plan은 여전히 제외
});

test("hasSavedPlanArg: 저장된 plan을 적용하면 승인한 것 = 적용되는 것", () => {
  assert.equal(hasSavedPlanArg("terraform apply tfplan"), true);
  assert.equal(hasSavedPlanArg("terraform apply -auto-approve out/plan.bin"), true);
  assert.equal(hasSavedPlanArg("terraform apply -auto-approve"), false);
  assert.equal(hasSavedPlanArg("terraform apply -var-file=x.tfvars -auto-approve"), false); // key=value는 plan 아님
  assert.equal(hasSavedPlanArg("kubectl apply -f x.yaml"), false);
});

test("deployApprovalFindings: 승인 없는 적용과 파괴적 명령 · 저장된 plan·명시 동의는 통과", () => {
  assert.deepEqual(deployApprovalFindings("terraform apply -auto-approve").map((f) => f.kind), ["unapproved-apply"]);
  // 저장된 plan을 적용하는 auto-approve는 정당하다(CI가 이 형태다)
  assert.deepEqual(deployApprovalFindings("terraform apply -auto-approve tfplan"), []);
  assert.deepEqual(deployApprovalFindings("terraform apply -var-file=x.tfvars").map((f) => f.kind), []);
  // 삭제는 갱신과 같은 강도로 다뤄지면 안 된다
  assert.deepEqual(deployApprovalFindings("kubectl delete -f k8s/x.yaml").map((f) => f.kind), ["destructive"]);
  assert.deepEqual(deployApprovalFindings("helm uninstall app").map((f) => f.kind), ["destructive"]);
  assert.deepEqual(deployApprovalFindings("terraform destroy -auto-approve").map((f) => f.kind),
    ["unapproved-apply", "destructive"]);
  // 명시 동의는 우회가 아니라 선언이다 — 위반이 아니되 흔적으로 남는다
  const ok = deployApprovalFindings("terraform destroy", { destroyOk: true });
  assert.deepEqual(ok.map((f) => f.kind), ["destructive-consented"]);
  assert.equal(deployPreconditionVerdict("hard", ok).blocking, false);
  assert.equal(deployPreconditionVerdict("hard", ok).unknowns.length, 1);
});

test("게이트 e2e(승인): git이 없어도 승인·파괴 축은 판정된다 · 동의는 매 실행 선언", () => {
  const root = mkdtempSync(join(tmpdir(), "sdd-appr-"));   // git 저장소 아님
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  try {
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", deployPreconditionPolicy: "hard" }));
    const run = (cmd, env) => {
      try { return { code: 0, out: execFileSync("node", [PRE_GATE, "--command", cmd], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } }) }; }
      catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
    };
    // git 조회가 불가능해도 명령 문자열 판정은 성립한다 — 조기 종료가 이 축을 삼키면 안 된다
    const unapproved = run("terraform apply -auto-approve");
    assert.equal(unapproved.code, 2);
    assert.match(unapproved.out, /적용되는 diff를 아무도 보지 않는다/);

    const destroy = run("terraform destroy -auto-approve");
    assert.equal(destroy.code, 2);
    assert.match(destroy.out, /파괴적 명령이다/);
    assert.match(destroy.out, /SDD_DESTROY_OK=1/);

    // 동의하면 차단하지 않되 흔적은 남는다
    const consented = run("terraform destroy tfplan", { SDD_DESTROY_OK: "1" });
    assert.equal(consented.code, 0);
    assert.match(consented.out, /명시 동의됨/);

    // 저장된 plan + 동의 없는 일반 apply는 조용하다(오탐 금지)
    assert.equal(run("terraform apply tfplan").out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
