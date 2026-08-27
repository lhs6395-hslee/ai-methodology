// tooling/__tests__/enforcement-reachability.test.mjs — 선언↔강제지점 결합 (SPEC-061)
// 강도 knob이 hard여도 그 판정이 실제로 발화할 CI 정의가 없으면 선언은 프로즈다.
// @covers SPEC-061/FR-001
// @covers SPEC-061/FR-002
// @covers SPEC-061/FR-003
// @covers SPEC-061/FR-004
// @covers SPEC-061/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGitHost, hostCiMismatchFinding, rangeEnforcementFinding, NATIVE_CI_GLOBS } from "../enforcement-reachability-lib.mjs";

// ── 순수 코어 ──

test("detectGitHost: ssh·https 어느 형식이든 알려진 호스트를 식별", () => {
  assert.equal(detectGitHost("git@github.com:org/repo.git"), "github");
  assert.equal(detectGitHost("https://github.com/org/repo.git"), "github");
  assert.equal(detectGitHost("git@gitlab.com:org/repo.git"), "gitlab");
  assert.equal(detectGitHost("https://gitlab.com/org/repo.git"), "gitlab");
  assert.equal(detectGitHost("git@bitbucket.org:org/repo.git"), "bitbucket");
  assert.equal(detectGitHost("https://dev.azure.com/org/proj/_git/repo"), "azure");
});

test("detectGitHost: 모르는 호스트·리모트 없음은 null(추측하지 않는다)", () => {
  assert.equal(detectGitHost("git@git.internal.corp:org/repo.git"), null);
  assert.equal(detectGitHost(null), null);
  assert.equal(detectGitHost(""), null);
});

test("hostCiMismatchFinding: host가 알려졌는데 그 provider CI가 없고 다른 provider만 있으면 위반", () => {
  const f = hostCiMismatchFinding("gitlab", ["github"]);
  assert.deepEqual(f, { host: "gitlab", present: ["github"] });
});

test("hostCiMismatchFinding: host의 CI가 있으면 통과(다른 provider가 섞여 있어도 무관)", () => {
  assert.equal(hostCiMismatchFinding("gitlab", ["gitlab", "github"]), null);
});

test("hostCiMismatchFinding: CI 정의가 아예 없으면 이 축의 판정 대상이 아니다(별도 관심사)", () => {
  assert.equal(hostCiMismatchFinding("gitlab", []), null);
});

test("hostCiMismatchFinding: 모르는 호스트(null)는 판정하지 않는다 — false positive보다 침묵", () => {
  assert.equal(hostCiMismatchFinding(null, ["github"]), null);
});

test("rangeEnforcementFinding: draftBlockPolicy=hard인데 CI 텍스트에 spec-sync 흔적이 없으면 위반", () => {
  const f = rangeEnforcementFinding("hard", "steps:\n  - run: npm test\n");
  assert.deepEqual(f, { knob: "draftBlockPolicy", value: "hard" });
});

test("rangeEnforcementFinding: check-spec-sync 또는 sdd-sync 언급이 있으면 통과", () => {
  assert.equal(rangeEnforcementFinding("hard", "node scripts/check-spec-sync.mjs $BASE"), null);
  assert.equal(rangeEnforcementFinding("hard", "node scripts/sdd-sync.mjs"), null);
});

test("rangeEnforcementFinding: advisory(기본)면 CI 흔적 유무와 무관하게 판정하지 않는다", () => {
  assert.equal(rangeEnforcementFinding("advisory", ""), null);
});

test("NATIVE_CI_GLOBS: 4개 host-결합 provider만 선언(Jenkins·CircleCI는 자체호스팅이라 결합 판정 밖)", () => {
  assert.deepEqual(Object.keys(NATIVE_CI_GLOBS).sort(), ["azure", "bitbucket", "github", "gitlab"]);
});

// ── 게이트 e2e (실 git repo) ──

const GATE = new URL("../check-enforcement-reachability.mjs", import.meta.url).pathname;

function repo(cfg, files, remote) {
  const root = mkdtempSync(join(tmpdir(), "sdd-enf-"));
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  for (const [rel, body] of Object.entries(files || {})) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const g = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  if (remote) g("remote", "add", "origin", remote);
  g("add", "-A"); g("commit", "-qm", "base");
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: 기본값 off → 판정 안 함(하위호환)", () => {
  const root = repo({}, {}, "git@github.com:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /판정 안 함/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: GitLab 리모트 + GitHub Actions 전용 CI(실측 시나리오, 이슈 #21 D-1) → hard에서 exit 1", () => {
  const root = repo(
    { enforcementReachabilityPolicy: "hard" },
    { ".github/workflows/ci.yml": "name: CI\non: [push]\njobs:\n  gates:\n    steps:\n      - run: node scripts/check-fr-coverage.mjs\n" },
    "git@gitlab.com:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /git 리모트는 gitlab인데.*github의 CI만 있다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 같은 시나리오가 advisory면 ⚠ exit 0", () => {
  const root = repo(
    { enforcementReachabilityPolicy: "advisory" },
    { ".github/workflows/ci.yml": "name: CI\non: [push]\n" },
    "git@gitlab.com:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠ git 리모트는 gitlab/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 호스트에 맞는 CI + spec-sync 호출 있으면 통과(hard여도 exit 0)", () => {
  const root = repo(
    { enforcementReachabilityPolicy: "hard", draftBlockPolicy: "hard" },
    { ".gitlab-ci.yml": "gates:\n  script:\n    - node scripts/check-spec-sync.mjs $BASE\n" },
    "git@gitlab.com:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: draftBlockPolicy=hard인데 CI가 spec-sync를 안 부르면 host 일치해도 exit 1", () => {
  const root = repo(
    { enforcementReachabilityPolicy: "hard", draftBlockPolicy: "hard" },
    { ".gitlab-ci.yml": "gates:\n  script:\n    - npm test\n" },
    "git@gitlab.com:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /draftBlockPolicy=hard인데.*호출 흔적이 없다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 모르는 호스트(자체 호스팅)면 host↔CI 불일치를 판정하지 않는다(false positive 방지)", () => {
  const root = repo(
    { enforcementReachabilityPolicy: "hard" },
    { ".github/workflows/ci.yml": "name: CI\n" },
    "git@git.internal.corp:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /불일치/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 리모트 없음 → host 판정은 건너뛰되 range 판정은 독립적으로 여전히 발화", () => {
  const root = repo({ enforcementReachabilityPolicy: "hard", draftBlockPolicy: "hard" }, {}, null);
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /리모트 호스트:미해석/);
    assert.match(r.out, /draftBlockPolicy=hard/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 값 위반 정책은 exit 1", () => {
  const root = repo({ enforcementReachabilityPolicy: "bogus" }, {}, "git@github.com:org/repo.git");
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /enforcementReachabilityPolicy 값 위반/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
