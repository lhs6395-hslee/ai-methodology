// tooling/__tests__/deploy-window.test.mjs — 배포 시간창 판정 (SPEC-060)
// @covers SPEC-060/FR-001
// @covers SPEC-060/FR-002
// @covers SPEC-060/FR-003
// @covers SPEC-060/FR-004
// @covers SPEC-060/FR-005
// @covers SPEC-060/FR-006
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployWindowVerdict, parsePrePushRefs, targetsDeployBranch } from "../deploy-window-lib.mjs";

// FR-014: 킷 정본 pre-push 템플릿은 존재-확인 후에만 배포 시간창 게이트를 부른다 — 마법사를 안
// 쓴 프로젝트엔 scripts/check-deploy-window.mjs가 없어 이 분기가 완전히 무해(no-op)해야 한다.
test("pre-push 정본 템플릿: check-deploy-window.mjs 존재-확인 후에만 호출하고, 같은 stdin을 재사용한다", () => {
  const body = readFileSync(new URL("../harness/pre-push", import.meta.url).pathname, "utf8");
  assert.match(body, /\[ -f scripts\/check-deploy-window\.mjs \]/);
  assert.match(body, /node scripts\/check-deploy-window\.mjs --hook < "\$SDD_PP_STDIN"/);
});

// 기준 시각: 2026-08-24(월) 10:00 UTC. KST(UTC+9)로는 19:00, PST(서머타임 UTC-7)로는 03:00.
const MON_10_UTC = Date.parse("2026-08-24T10:00:00.000Z");

test("deployWindowVerdict: 미선언·설정 오류·타임존은 Intl로 계산(고정 오프셋 아님)", () => {
  assert.equal(deployWindowVerdict({ enabled: false }, MON_10_UTC).status, "no-window");
  assert.equal(deployWindowVerdict({}, MON_10_UTC).status, "no-window");

  const bad = deployWindowVerdict({ enabled: true, start: "9am", end: "17:00", timezone: "UTC" }, MON_10_UTC);
  assert.equal(bad.status, "misconfigured");

  // KST 19:00은 09:00~18:00 창 밖 — 서울 기준으로 이미 저녁이다.
  const kst = deployWindowVerdict({ enabled: true, start: "09:00", end: "18:00", timezone: "Asia/Seoul" }, MON_10_UTC);
  assert.equal(kst.status, "out-of-window");

  // 같은 순간, UTC 자체는 09:00~18:00 창 안(10:00 UTC).
  const utc = deployWindowVerdict({ enabled: true, start: "09:00", end: "18:00", timezone: "UTC" }, MON_10_UTC);
  assert.equal(utc.status, "in-window");
});

test("deployWindowVerdict: 요일 제한 · 자정을 넘는 창(wrap) · 트레일러 예외", () => {
  // 월요일만 허용 + UTC 09:00~18:00 — 기준 시각은 월요일 10:00 UTC라 허용.
  const mondayOnly = deployWindowVerdict({ enabled: true, days: ["Mon"], start: "09:00", end: "18:00", timezone: "UTC" }, MON_10_UTC);
  assert.equal(mondayOnly.status, "in-window");
  const tuesdayOnly = deployWindowVerdict({ enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC" }, MON_10_UTC);
  assert.equal(tuesdayOnly.status, "out-of-window");

  // 22:00~06:00(자정을 넘는 창) — 10:00 UTC는 이 창 밖이어야 한다.
  const overnight = deployWindowVerdict({ enabled: true, start: "22:00", end: "06:00", timezone: "UTC" }, MON_10_UTC);
  assert.equal(overnight.status, "out-of-window");
  // 03:00 UTC(자정 넘는 구간 안)는 허용.
  const overnightIn = deployWindowVerdict({ enabled: true, start: "22:00", end: "06:00", timezone: "UTC" }, Date.parse("2026-08-24T03:00:00.000Z"));
  assert.equal(overnightIn.status, "in-window");

  // 창 밖인데 트레일러가 커밋 메시지에 있으면 overridden.
  const win = { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC", overrideTrailer: "Deploy-Window-Override" };
  const blocked = deployWindowVerdict(win, MON_10_UTC, "fix: x\n\nDeploy-Window-Override: 운영 승인 받음");
  assert.equal(blocked.status, "overridden");
  assert.match(blocked.detail, /Deploy-Window-Override/);
  // 트레일러 없이는 여전히 차단.
  assert.equal(deployWindowVerdict(win, MON_10_UTC, "fix: x").status, "out-of-window");
});

test("parsePrePushRefs·targetsDeployBranch: 로컬 브랜치명이 아니라 실제 push 대상 remoteRef로 판정", () => {
  const stdin = [
    "refs/heads/feature/x deadbeef refs/heads/main cafebabe",
    "refs/heads/main deadbeef refs/heads/staging cafebabe", // 로컬은 main인데 실제로는 staging으로 push
  ].join("\n") + "\n";
  const refs = parsePrePushRefs(stdin);
  assert.equal(refs.length, 2);
  assert.equal(targetsDeployBranch(refs, "main"), true); // 1번째 줄이 main을 향한다
  assert.equal(targetsDeployBranch([refs[1]], "main"), false); // 로컬명이 main이어도 remoteRef가 staging이면 아니다

  // 브랜치 삭제(localOid가 전부 0)는 배포 트리거가 아니다.
  const del = parsePrePushRefs("refs/heads/main 0000000000000000000000000000000000000000 refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  assert.equal(targetsDeployBranch(del, "main"), false);

  // 원격에 아직 없는 신규 브랜치 최초 push(remoteOid가 전부 0)는 정상 대상이다 — 삭제와 반대 의미.
  const firstPush = parsePrePushRefs("refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef refs/heads/main 0000000000000000000000000000000000000000");
  assert.equal(targetsDeployBranch(firstPush, "main"), true);

  // 형식이 3필드 이하이거나 빈 줄은 조용히 무시한다(파싱 실패로 판정을 죽이지 않는다).
  assert.deepEqual(parsePrePushRefs("garbage line\n\n"), []);
});

// ── 게이트 e2e ─────────────────────────────────────────────────────────────
const GATE = new URL("../check-deploy-window.mjs", import.meta.url).pathname;

function fixture(cfg = {}, pipeline = null) {
  const root = mkdtempSync(join(tmpdir(), "sdd-deploywin-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  mkdirSync(join(root, "sdd/specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  if (pipeline) writeFileSync(join(root, "sdd.pipeline.config.json"), JSON.stringify(pipeline));
  return root;
}
function commit(root, message) {
  writeFileSync(join(root, "x.txt"), String(Date.now() + Math.random()));
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}
// 벽시계에 기대지 않는다 — 실측 위험: OUT_OF_WINDOW가 days:["Tue"]뿐이라, 주입 없이 실제
// Date.now()를 쓰면 테스트 스위트가 실제 화요일 09:00~18:00 UTC에 돈 그 순간만 "창 안"으로
// 뒤집혀 flaky해진다. SDD_DEPLOY_WINDOW_NOW_MS로 고정 시각(수요일)을 주입해 결정적으로 만든다.
const FIXED_WEDNESDAY_UTC = String(Date.parse("2026-08-26T10:00:00.000Z"));
function runHook(root, stdin, nowMs = FIXED_WEDNESDAY_UTC) {
  const env = { ...process.env, SDD_DEPLOY_WINDOW_NOW_MS: nowMs };
  try { return { code: 0, out: execFileSync("node", [GATE, "--hook"], { cwd: root, encoding: "utf8", input: stdin, stdio: ["pipe", "pipe", "pipe"], env }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

const OUT_OF_WINDOW = { enabled: true, days: ["Tue"], start: "09:00", end: "18:00", timezone: "UTC", overrideTrailer: "Deploy-Window-Override" };
const PIPELINE = (window) => ({ deployBranch: "main", promotions: [{ from: "main", to: "prod", deployWindow: window }] });

test("게이트 e2e: sdd.pipeline.config.json 미선언·배포 브랜치 아님·창 안이면 침묵", () => {
  const noPipeline = fixture({ deployWindowPolicy: "hard" });
  const oid = commit(noPipeline, "init");
  try {
    const r = runHook(noPipeline, `refs/heads/main ${oid} refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
    assert.equal(r.code, 0); assert.equal(r.out.trim(), "");
  } finally { rmSync(noPipeline, { recursive: true, force: true }); }

  const root = fixture({ deployWindowPolicy: "hard" }, PIPELINE(OUT_OF_WINDOW));
  const oid2 = commit(root, "init");
  try {
    // 배포 브랜치가 아닌 다른 브랜치로 push — 침묵.
    const other = runHook(root, `refs/heads/feature/x ${oid2} refs/heads/feature/x deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
    assert.equal(other.code, 0); assert.equal(other.out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 e2e: 창 밖이면 hard에서 push 차단 · advisory는 경고만 · 트레일러로 예외", () => {
  const hard = fixture({ deployWindowPolicy: "hard" }, PIPELINE(OUT_OF_WINDOW));
  const oid = commit(hard, "deploy: ship it");
  try {
    const r = runHook(hard, `refs/heads/main ${oid} refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /창 밖/);
    assert.match(r.out, /Deploy-Window-Override/);
  } finally { rmSync(hard, { recursive: true, force: true }); }

  const advisory = fixture({ deployWindowPolicy: "advisory" }, PIPELINE(OUT_OF_WINDOW));
  const oid2 = commit(advisory, "deploy: ship it");
  try {
    const r = runHook(advisory, `refs/heads/main ${oid2} refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /advisory — 막지 않는다/);
  } finally { rmSync(advisory, { recursive: true, force: true }); }

  const overridden = fixture({ deployWindowPolicy: "hard" }, PIPELINE(OUT_OF_WINDOW));
  const oid3 = commit(overridden, "deploy: ship it\n\nDeploy-Window-Override: 운영 승인 받음");
  try {
    const r = runHook(overridden, `refs/heads/main ${oid3} refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(overridden, { recursive: true, force: true }); }
});

test("게이트 e2e: deployWindowPolicy off는 파이프라인 설정이 있어도 완전히 침묵한다", () => {
  const root = fixture({ deployWindowPolicy: "off" }, PIPELINE(OUT_OF_WINDOW));
  const oid = commit(root, "deploy: x");
  try {
    const r = runHook(root, `refs/heads/main ${oid} refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
    assert.equal(r.code, 0); assert.equal(r.out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트 e2e: SDD_DEPLOY_WINDOW_NOW_MS 주입이 실제 벽시계를 대체한다(결정성 회귀 확인)", () => {
  // 같은 창(월~금 09:00~18:00 UTC)에 대해, 주입 시각만 바꿔 안/밖 둘 다 재현한다 — 이 테스트가
  // 실행되는 실제 시각과 무관하게 항상 같은 결과가 나와야 주입이 실제로 먹힌다는 증거다.
  const weekdayWindow = { enabled: true, days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start: "09:00", end: "18:00", timezone: "UTC" };
  const root = fixture({ deployWindowPolicy: "hard" }, PIPELINE(weekdayWindow));
  const oid = commit(root, "deploy: x");
  try {
    const inWindow = String(Date.parse("2026-08-26T10:00:00.000Z"));   // 수요일 10:00 UTC — 창 안
    const outWindow = String(Date.parse("2026-08-29T10:00:00.000Z"));  // 토요일 — 요일 밖
    const stdin = `refs/heads/main ${oid} refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`;
    assert.equal(runHook(root, stdin, inWindow).code, 0);
    assert.equal(runHook(root, stdin, outWindow).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
