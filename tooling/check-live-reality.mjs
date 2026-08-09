#!/usr/bin/env node
// ─── 라이브 대조 게이트 (SPEC-032) ──────────────────────────
// 저장소 **밖**의 진실(클라우드·클러스터 실물)을 보는 유일한 게이트. 인프라 무관 — 프로젝트가
// `liveRealityChecks`로 명령을 주입하고, 각 명령의 stdout 한 줄이 위반 항목 하나다.
//   terraform: plan no-op인가 / state에 없는 선언 모듈 / required_version ↔ state CLI 정합
//   kubernetes: 저장소 매니페스트 ↔ 라이브 오브젝트 내용 해시
//   ownership: 스펙이 소유를 주장하는 자원이 IaC state에 있는가(무소유 자원 0건)
// **실행 실패(exit≠0)는 언제나 skipped(reason)** — 자격증명 없는 환경에서 하드 실패 금지.
// off(기본)|advisory(경고 exit 0)|hard(위반 시 exit 1, skipped는 절대 실패 아님). Python 미러.

import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";
import { validateChecks, classifyResult, summarize } from "./live-reality-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = String(cfg.liveRealityPolicy ?? "off");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ liveRealityPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const CHECKS = cfg.liveRealityChecks || [];
if (POLICY === "off") {
  verdict(VERDICT_KINDS.OFF, "liveRealityPolicy");
  console.log("라이브 대조 게이트 — liveRealityPolicy:off (판정 안 함)");
  process.exit(0);
}
const cfgErrors = validateChecks(CHECKS);
if (cfgErrors.length) {
  console.error("✗ liveRealityChecks 설정 오류:");
  for (const e of cfgErrors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
const HARD = POLICY === "hard";
// 정책이 켜졌는데 검사가 하나도 없으면 침묵하지 않는다 — "hard 선언 + 무판정"은 거짓 안전(SPEC-002 FR-010 동형).
if (!CHECKS.length) {
  verdict(VERDICT_KINDS.INERT, "liveRealityChecks 비어 있음 — 저장소 밖 진실을 볼 명령이 없다");
  console.log(`라이브 대조 게이트(liveRealityPolicy=${POLICY}): 판정 불가(inert) — liveRealityChecks 비어 있음(저장소 밖 진실을 볼 명령이 주입되지 않음)`);
  if (HARD) {
    console.error("\n✗ liveRealityPolicy=hard인데 검사가 0건이다 — hard 선언 + 무판정은 거짓 안전이다. liveRealityChecks를 주입하거나 정책을 off로 명시하라(SPEC-032).");
    process.exit(1);
  }
  process.exit(0);
}

const TIMEOUT = Number(cfg.liveRealityTimeoutMs ?? 120000);
const results = CHECKS.map((c) => {
  const id = String(c.id), label = String(c.label || c.id), kind = String(c.kind || "custom");
  try {
    const stdout = execSync(String(c.command), {
      cwd: cfg.__root, encoding: "utf8", timeout: TIMEOUT, stdio: ["ignore", "pipe", "pipe"],
    });
    return classifyResult({ id, label, kind, exitCode: 0, stdout, stderr: "" });
  } catch (e) {
    // 타임아웃·자격증명 없음·바이너리 없음 — 전부 skipped(reason). 위반으로 승격하지 않는다.
    const stderr = (e && (e.stderr || e.message)) || "";
    return classifyResult({ id, label, kind, exitCode: e && e.status != null ? e.status : 1, stdout: "", stderr: String(stderr) });
  }
});

const sum = summarize(results);
// skipped는 "위반 없음"이 아니다 — 하나라도 있으면 이 게이트는 전수를 보지 못했다.
if (sum.skipped && !sum.violations) verdict(VERDICT_KINDS.SKIPPED, `검사 ${sum.skipped}건이 실행되지 못했다(자격증명·네트워크)`);
else judged(sum.violations);
console.log(`라이브 대조 게이트(liveRealityPolicy=${POLICY}): 검사 ${results.length}건 — clean ${sum.clean}·위반 ${sum.violations}(항목 ${sum.items})·skipped ${sum.skipped}`);
const tag = HARD ? "✗" : "⚠";
for (const r of results) {
  if (r.status === "skipped") {
    console.log(`  · [skipped] ${r.label} (${r.kind}) — ${r.reason}`);
  } else if (r.status === "violations") {
    console.log(`  ${tag} ${r.label} (${r.kind}) — ${r.items.length}건:`);
    for (const it of r.items) console.log(`      - ${it}`);
  } else {
    console.log(`  ✓ ${r.label} (${r.kind}) — 라이브와 일치`);
  }
}
if (sum.skipped) {
  console.log("  · skipped는 '위반 없음'이 아니라 '판정 못 함'이다 — 자격증명·네트워크가 있는 환경에서 다시 돌려라.");
}
if (sum.violations) {
  console.log("  · 해소 방향(회귀 금지): 라이브가 저장소보다 최신이면 저장소를 먼저 라이브에 맞춘 뒤(drift 흡수) 변경을 얹어라 — 낡은 저장소를 그대로 apply하면 라이브가 되돌아간다(APPLYING §라이브 우선 대조).");
  console.log("  · 대조 결과는 해당 인프라 스펙의 Change Log에 남긴다(무엇이 어긋났고 어느 방향으로 해소했는지).");
}
if (sum.violations && HARD) {
  console.error("\n✗ liveRealityPolicy=hard: 저장소 선언과 라이브 실물이 어긋났다 — 위 목록을 해소하라(skipped는 실패로 치지 않는다).");
  process.exit(1);
}
if (!sum.violations) console.log("라이브 대조 게이트: OK — 위반 0건.");
