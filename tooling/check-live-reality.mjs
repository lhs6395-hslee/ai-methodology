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
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import {
  validateChecks, classifyResult, summarize,
  liveRealityCoverage, liveRealityCoverageVerdict, RECOMMENDED_DEPLOY_ARTIFACT_MARKERS,
} from "./live-reality-lib.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSection } from "./ownership-keys.mjs";
import { compileGlob } from "./spec-sync-lib.mjs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";
armVerdict();  // 모든 종료 경로에서 판정 타입 한 줄(SPEC-040) — 선언 안 하면 UNTYPED로 자백된다

const cfg = loadConfig();
const POLICY = String(cfg.liveRealityPolicy ?? "off");
if (!["off", "advisory", "hard"].includes(POLICY)) {
  console.error(`✗ liveRealityPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
const CHECKS = cfg.liveRealityChecks || [];

// ── 축 ①: 등록(오프라인) ────────────────────────────────────────────────────
// 실행 축과 **정책도 분리**한다 — 실행은 자격증명이 필요해 흔히 off·skipped인데, 등록은
// 순수 선언 대조라 언제나 판정할 수 있다. 한 정책에 묶으면 실행을 끄는 순간 등록도 꺼진다.
const COV_POLICY = String(cfg.liveRealityCoveragePolicy ?? "advisory");
if (!["off", "advisory", "hard"].includes(COV_POLICY)) {
  console.error(`✗ liveRealityCoveragePolicy 값 위반 "${COV_POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
  process.exit(1);
}
let covJudged = false, covViolations = 0;
const covInert = [];
if (COV_POLICY !== "off") {
  const MARKERS = Array.isArray(cfg.deployArtifactMarkers) && cfg.deployArtifactMarkers.length
    ? cfg.deployArtifactMarkers : null;
  if (!MARKERS) {
    covInert.push("deployArtifactMarkers 미선언 — 무엇이 배포 산출물인지 이 프로젝트의 어휘를 모른다"
      + `(권장 목록: ${RECOMMENDED_DEPLOY_ARTIFACT_MARKERS.slice(0, 6).join("·")} … — presets 참조)`);
  } else {
    const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
    const ARTI_CAT = (cfg.__roles && cfg.__roles.artifact) || "Artifacts";
    const declared = [];
    let names = [];
    try { names = readdirSync(SPEC_DIR).sort().filter((n) => n.endsWith(".md")); } catch { /* 아래 inert */ }
    for (const n of names) {
      const text = readFileSync(join(SPEC_DIR, n), "utf8");
      const specId = (text.match(cfg.__specIdRe) || [n.replace(/\.md$/, "")])[0];
      for (const key of parseSection(text, "Ownership", [ARTI_CAT])[ARTI_CAT] || []) {
        const k = String(key).trim();
        if (k && k !== "—" && k !== "-" && !k.startsWith("[")) declared.push({ specId, key: k });
      }
    }
    if (!declared.length) {
      covInert.push(`선언된 ${ARTI_CAT} 키 0건 — 대조할 배포 산출물이 없다`);
    } else {
      const cov = liveRealityCoverage(declared, CHECKS, MARKERS, compileGlob);
      const cv = liveRealityCoverageVerdict(COV_POLICY, cov.uncovered);
      covJudged = true; covViolations = cv.violations;
      const ctag = COV_POLICY === "hard" ? "✗" : "⚠";
      console.log(`등록 축(liveRealityCoveragePolicy=${COV_POLICY}): 배포 산출물 ${cov.scanned}건 — 검사 등록됨 ${cov.covered.length}·미검사 ${cov.uncovered.length}`);
      for (const u of cov.uncovered) {
        console.log(`  ${ctag} 미검사 산출물: [${u.specId}] ${u.key} — 저장소 밖에 실재하는데 이 산출물을 보는 liveRealityChecks 항목이 없다(검사에 covers로 담당을 선언하라)`);
      }
      if (cv.blocking) {
        console.error(`\n✗ liveRealityCoveragePolicy=hard: 배포 산출물 ${cov.uncovered.length}건이 미검사다 — **틀이 있는 것과 그 틀이 이 산출물을 본다는 것은 다른 사실이다**(실측: 새 산출물 8개 결함을 배포로 하나씩 발견). 대응 검사를 등록하라(템플릿: sdd.config.presets.md §라이브 대조).`);
        judged(covViolations);
        process.exit(1);
      }
    }
  }
}

// ── 축 ②: 실행(온라인) ──────────────────────────────────────────────────────
if (POLICY === "off") {
  // 등록 축이 판정했으면 게이트 전체는 "판정함"이다 — 실행이 꺼졌다고 아무것도 안 본 게 아니다.
  if (covJudged) judged(covViolations);
  else verdict(VERDICT_KINDS.OFF, `liveRealityPolicy${covInert.length ? ` · 등록 축 inert(${covInert[0]})` : ""}`);
  console.log(`라이브 대조 게이트 — liveRealityPolicy:off (실행 축 판정 안 함)${covInert.length ? ` · 등록 축 판정 불가: ${covInert.join(" / ")}` : ""}`);
  process.exit(covJudged && covViolations && COV_POLICY === "hard" ? 1 : 0);
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
    // ⚠ **실제 stderr만** 넘긴다. 예외 메시지(`Command failed: <명령 전문>`)로 대체하면 Python판과
    // 사유가 갈리고(Python은 stderr만 본다), 게다가 명령 전문이 사유 자리에 실려 읽히지 않는다.
    // 코어는 stderr가 비면 `명령이 exit N로 종료`로 떨어지므로 양판이 같은 문장을 낸다.
    const stderr = (e && e.stderr) || "";
    return classifyResult({ id, label, kind, exitCode: e && e.status != null ? e.status : 1, stdout: "", stderr: String(stderr) });
  }
});

const sum = summarize(results);
// 축이 둘이라 판정 종류도 합산한다(check-engine-event 동형) — **등록 축이 판정했으면 이 게이트는
// 판정한 것이다.** 실행이 자격증명 부재로 전부 skipped여도 "아무것도 안 봤다"가 아니다:
// 미검사 산출물이 있는지는 오프라인에서 이미 단정했다. 이 합산이 없으면 자격증명 없는 환경에서
// 등록 축의 판정이 실행 축의 skipped에 삼켜진다 — 제보가 지적한 구조가 그대로 재생산된다.
if (sum.skipped && !sum.violations && !covJudged) {
  verdict(VERDICT_KINDS.SKIPPED, `검사 ${sum.skipped}건이 실행되지 못했다(자격증명·네트워크)`);
} else {
  judged(sum.violations + covViolations);
}
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
