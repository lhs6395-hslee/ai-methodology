#!/usr/bin/env node
// ─── 선언↔강제지점 결합 게이트 (SPEC-061, 이슈 #21 D-1) ───────────────────────
// 강도 knob이 hard여도, 그 판정이 실제로 발화할 강제 지점(CI 정의)이 이 리포에 없으면
// 선언은 프로즈다. 두 축을 본다:
//   ① host↔CI 결합 — git 리모트가 알려진 provider(github/gitlab/bitbucket/azure)인데
//      그 provider의 네이티브 CI 정의가 없고 **다른** provider의 CI 정의만 있으면, 그 CI는
//      이 리포에서 실행되지 않는다(실측: GitLab 리모트 + GitHub Actions 전용 워크플로).
//   ② range 전용 승격의 CI 호출 — `draftBlockPolicy: hard`(SPEC-008 FR-007, range 모드
//      전용 승격)가 선언됐는데 발견된 CI 정의 어디에도 spec-sync 호출 흔적이 없으면, 로컬
//      git 훅(pre-push는 staged 판정만)도 CI도 그 승격을 발화시키지 않는다.
// off(기본, 미판정) | advisory(경고) | hard(exit 1). git 원격이 없거나 모르는 호스트면 ①은
// 판정 밖(false positive보다 침묵이 낫다) — ②는 host 무관하게 독립 판정된다.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadConfig, resolveFromRoot, walkFiles } from "./sdd-config.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";
import { detectGitHost, hostCiMismatchFinding, rangeEnforcementFinding, NATIVE_CI_GLOBS } from "./enforcement-reachability-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = cfg.enforcementReachabilityPolicy || "off";
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ enforcementReachabilityPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "enforcementReachabilityPolicy");
  console.log("선언↔강제지점 결합 게이트 — enforcementReachabilityPolicy:off (판정 안 함)");
  process.exit(0);
}

const ROOT = cfg.__root;
const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const remoteUrl = sh("git remote get-url origin");
const host = detectGitHost(remoteUrl);

// 발견된 provider별 CI 파일 목록 — 순회는 정본(walkFiles) 위에서, 표현만 이 게이트가.
const IGNORE = new Set(cfg.ignoreDirs);
const allFiles = walkFiles(ROOT, IGNORE);
const filesByProvider = {};
for (const [provider, globs] of Object.entries(NATIVE_CI_GLOBS)) {
  const res = globs.map(compileGlob);
  filesByProvider[provider] = allFiles.filter((f) => res.some((re) => re.test(f)));
}
const presentProviders = Object.keys(filesByProvider).filter((p) => filesByProvider[p].length);

const findings = [];

const mismatch = hostCiMismatchFinding(host, presentProviders);
if (mismatch) {
  findings.push({ kind: "host-ci-mismatch", detail: mismatch });
}

// 발견된 모든 provider CI 파일 내용을 이어붙여 spec-sync 호출 흔적을 찾는다(어느 provider든
// 무관 — 이 판정은 "CI가 이 리포에서 도는가"가 아니라 "도는 CI 중 하나라도 spec-sync를
// 부르는가"다. host 불일치와는 독립 — host가 안 맞아도 다른 CI가 우연히 맞게 배선될 수 있다).
const ciText = Object.values(filesByProvider).flat()
  .map((f) => { try { return readFileSync(resolveFromRoot(cfg, f), "utf8"); } catch { return ""; } })
  .join("\n");
const rangeFinding = rangeEnforcementFinding(cfg.draftBlockPolicy || "advisory", ciText);
if (rangeFinding) findings.push({ kind: "range-unreachable", detail: rangeFinding });

const HARD = POLICY === "hard" && findings.length > 0;
judged(findings.length);
console.log(`선언↔강제지점 결합 게이트(enforcementReachabilityPolicy=${POLICY}) — 리모트 호스트:${host || "미해석"} CI provider:${presentProviders.length ? presentProviders.join(",") : "없음"}`);
for (const f of findings) {
  const tag = HARD ? "✗" : "⚠";
  if (f.kind === "host-ci-mismatch") {
    console.log(`  ${tag} git 리모트는 ${f.detail.host}인데 그 provider의 네이티브 CI 정의가 없고 ${f.detail.present.join(",")}의 CI만 있다 — 그 CI는 이 리포에서 실행되지 않는다(host↔CI 불일치)`);
  } else if (f.kind === "range-unreachable") {
    console.log(`  ${tag} ${f.detail.knob}=${f.detail.value}인데 발견된 CI 정의 어디에도 check-spec-sync/sdd-sync 호출 흔적이 없다 — range 전용 승격(SPEC-008 FR-007)이 이 리포의 어떤 강제 지점에서도 발화하지 않는다`);
  }
}
if (HARD) {
  console.error("\n✗ enforcementReachabilityPolicy=hard: 강도 선언과 실제 강제 지점이 어긋난다 — CI를 실제 호스트에 맞게 정의하거나, spec-sync 호출을 그 CI에 배선하거나, 지금 이 리포에서 발화하지 않는 강도라면 정직하게 내려라(SPEC-061).");
  process.exit(1);
}
console.log("선언↔강제지점 결합 게이트: OK — 강도 선언이 발화할 강제 지점이 확인된다(또는 판정 대상 없음).");
