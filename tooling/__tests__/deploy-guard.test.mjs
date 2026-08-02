// tooling/__tests__/deploy-guard.test.mjs — out-of-band 배포 가드 (SPEC-035)
// 실측 제보: infra 산출물을 워킹트리에서 고쳐 `kubectl apply`로 라이브에 즉시 반영하는 궤도에서는
// 배포가 커밋보다 먼저다. check-spec-sync는 commit-msg 훅이라 커밋을 미루는 동안 아무 신호가 없고
// spec↔live 드리프트가 누적된다(INFRA-005 역방향 흡수 사례). 발화 지점을 배포 행위까지 앞당긴다.
// @covers SPEC-035/FR-001
// @covers SPEC-035/FR-002
// @covers SPEC-035/FR-003
// @covers SPEC-035/FR-004
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DEPLOY_PATTERNS, parseDeployCommand, changeLogAdded, changeLogRowShape, deployGuardFindings,
} from "../deploy-guard-lib.mjs";

const GATE = new URL("../check-deploy-guard.mjs", import.meta.url).pathname;

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
    writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs" }));
    writeFileSync(join(root, "sdd/specs/INFRA-001.md"),
      "**Spec**: `INFRA-001`\n## Ownership\n- **Files**: k8s/**\n## Change Log\n| 날짜 | 변경 | 근거 |\n|---|---|---|\n");
    writeFileSync(join(root, "k8s/x.yaml"), "apiVersion: v1\n");
    sh("git init -q . && git add -A && git -c user.name=t -c user.email=t@t commit -qm base");
    writeFileSync(join(root, "k8s/x.yaml"), "apiVersion: v1\ndata: {a: b}\n");

    const r = execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"],
      { cwd: root, encoding: "utf8" });
    assert.match(r, /out-of-band 배포 감지/);
    assert.match(r, /소유 INFRA-001 미수정/);
    assert.match(r, /차단하지 않는다/);

    // 커밋하면 정상 궤도 — 침묵
    sh("git add -A && git -c user.name=t -c user.email=t@t commit -qm deploy");
    const q = execFileSync("node", [GATE, "--command", "kubectl apply -f k8s/x.yaml"], { cwd: root, encoding: "utf8" });
    assert.equal(q.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
