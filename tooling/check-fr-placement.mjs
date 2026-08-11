#!/usr/bin/env node
// ─── FR 배치 게이트 (SPEC-056, R23) ───
// 실측 제보(2026-08-11, gsn-ai-pm-management-tool): 에이전트가 하루에 같은 실수를 세 번 했다 —
// FR 정의를 `## Functional Requirements` 섹션 밖에 썼다. 파일은 멀쩡히 읽히고 스펙 문서로도
// 그럴싸해 보여서, 어긋남은 **다른 게이트가 커버리지를 셀 때** dangling @covers로 뒤늦게
// 드러났다 — 사람이 그 자리에서 알아차릴 수 없는 부류다. 이 게이트는 원인 자리를 직접 잡아
// FR 번호·있던 섹션·줄 번호를 함께 말한다.
//
// **훅은 자동 교정하지 않는다** — 파일을 말없이 바꾸면 사람이 커밋한 내용과 저장소 내용이
// 갈린다. 잡아서 `--fix` 명령을 알려주는 데까지가 훅의 몫이다(사람이 명시적으로 실행한다).
//
// commit-msg 체인에서 spec-sync **뒤**에 둔다 — 스펙이 동반됐는지 먼저 보고 그 안에서 배치를
// 본다. 순서를 바꾸면 스펙 없는 커밋에도 배치 오류를 먼저 말해 사람이 엉뚱한 곳을 고친다.
//
// frPlacementPolicy: off | advisory(기본) | hard.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveFromRoot } from "./sdd-config.mjs";
import { frPlacementFindings, fixFrPlacement, FR_SECTION_HEADING } from "./fr-placement-lib.mjs";
import { armVerdict, verdict, VERDICT_KINDS, isMainEntry } from "./verdict-lib.mjs";

// 이 클래스 식별자는 SPEC-057(게이트 실패 원장)의 에스컬레이션 집계 키다 — 실측 사고 그 자체가
// "선언되지 않은 클래스는 세지 않는다"는 계약의 첫 소비자다.
export const FAILURE_CLASS = "fr-outside-section";

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.frPlacementPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ frPlacementPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "frPlacementPolicy");
    console.log("FR 배치 게이트 — frPlacementPolicy:off (판정 안 함)"); return;
  }
  const HARD = POLICY === "hard";
  const FIX = process.argv.includes("--fix");
  const SPEC_DIR = resolveFromRoot(cfg, cfg.specDir);
  let names = [];
  try { names = readdirSync(SPEC_DIR).sort().filter((n) => /\.md$/.test(n)); } catch { /* 스펙 디렉터리 없음 */ }
  if (!names.length) {
    verdict(VERDICT_KINDS.INERT, "스펙 파일 0개 — 판정 대상이 없다");
    console.log("FR 배치 게이트 — 스펙 파일 0개(판정 안 함)"); return;
  }

  if (FIX) {
    let fixedCount = 0;
    for (const n of names) {
      const abs = join(SPEC_DIR, n);
      let text; try { text = readFileSync(abs, "utf8"); } catch { continue; }
      const { text: fixedText, moved } = fixFrPlacement(text, cfg.__frDeclRe, cfg.__reqAlt);
      if (!moved.length) continue;
      writeFileSync(abs, fixedText);
      const specId = (text.match(cfg.__specIdRe) || [n])[0];
      for (const m of moved) console.log(`  ↻ [${specId}] ${m.frId}: ${m.from} → ${m.toSection} 섹션 끝으로 이동`);
      fixedCount += moved.length;
    }
    verdict(VERDICT_KINDS.SKIPPED, "--fix 모드(판정이 아니라 교정)");
    console.log(`FR 배치 게이트: --fix 완료 — ${fixedCount}건 이동.`);
    return;
  }

  const report = [];
  for (const n of names) {
    const abs = join(SPEC_DIR, n);
    let text; try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const findings = frPlacementFindings(text, cfg.__frDeclRe, cfg.__reqAlt);
    if (!findings.length) continue;
    const specId = (text.match(cfg.__specIdRe) || [n])[0];
    for (const f of findings) report.push({ specId, file: `${cfg.specDir}/${n}`, ...f });
  }

  // meta.class·target — SPEC-057 원장의 에스컬레이션 집계 키. 이 축이 실측 사고의 첫 소비자다:
  // 같은 클래스가 오늘 세 번째로 나면 그 사실이 원장에 남는다(가시성이지 벌이 아니다). clean일
  // 때도 클래스를 붙이는 이유: 원장은 **차단한 실행만** 적으므로(exit≠0) clean 경로에서 이
  // 메타는 쓰이지 않지만, 코드를 두 갈래로 쪼개 "차단할 때만 class를 안다"는 상태를 만들지 않는다.
  const meta = report.length ? { class: FAILURE_CLASS, target: report[0].file } : undefined;
  verdict(VERDICT_KINDS.JUDGED, report.length > 0 ? `위반 ${report.length}건` : "위반 0건", meta);
  console.log(`FR 배치 게이트(frPlacementPolicy=${POLICY}): 스펙 ${names.length}개 검사 — ${FR_SECTION_HEADING} 섹션 밖 FR ${report.length}건`);
  const tag = HARD ? "✗" : "⚠";
  for (const r of report) {
    console.log(`  ${tag} [${r.specId}] ${r.frId}가 "${r.section}" 섹션에 있다(${r.file}:${r.line}) — ${FR_SECTION_HEADING} 섹션 안에 있어야 한다`);
  }
  if (report.length) {
    console.log("  → node scripts/check-fr-placement.mjs --fix 로 옮긴다(훅은 자동 교정하지 않는다 — 사람이 명시적으로 실행한다).");
  }
  if (report.length && HARD) {
    console.error(`\n✗ frPlacementPolicy=hard: FR 정의가 섹션 밖에 있으면 다른 게이트가 "정의 없음(dangling @covers)"으로`
      + " 뒤늦게 본다 — 원인 자리에서 막는다.");
    process.exit(1);
  }
  if (!report.length) console.log(`FR 배치 게이트: OK — 모든 FR 정의가 ${FR_SECTION_HEADING} 섹션 안에 있다.`);
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
