// tooling/derivation-lib.mjs
// 재도출(derivation) 소스 회계 순수 코어 — 소스 클래스 enum·매니페스트 엔트리 검증 +
// Change Log 근거(선제 캡처) 판정. check-derivation·check-spec-completeness가 소비.
// 원칙: 재도출 가능한 소스는 회계로 강제하고, 재도출 불가능한 것(순수 인간 의도)은
// 저술 시점 캡처를 문법으로 강제한다 — evidence/reason의 질은 기계가 못 본다(존재만).
// 설계: SPEC-009 (Python판 sdd_gates.py가 동일 동작을 미러 — SPEC-006 패리티).

import { sectionBlock } from "./lifecycle-lib.mjs";

// 소스 클래스 고정 enum — 재도출이 읽어야 하는 소스의 정의역(정의되지 않은 예외 금지).
export const SOURCE_CLASSES = [
  "code",               // 앱/툴 소스(scanDirs) — 기존 재도출 대상
  "iac",                // terraform/k8s/helm/Dockerfile/compose — INFRA 스펙의 소스
  "ci",                 // CI/CD 파이프라인 정의 — INFRA 스펙·smoke 증거의 소스
  "ops-docs",           // runbook·운영 문서 — verification 절·smoke 증거의 소스
  "build-evidence",     // 빌드/CI 실행 아티팩트·로그(레포 밖) — smoke evidence의 소스
  "vcs-history",        // git 이력·PR·커밋 메시지·트레일러 — Change Log 근거의 소스
  "prior-traceability", // 기존 @covers/@verifies 태그 인벤토리 — FR 키 보존의 입력
  "prior-intent",       // 기존 스펙·문서에 이미 기록된 인간 의도(Story·Clarifications·근거)
  "human-intent",       // 어디에도 기록 안 된 순수 의도 — 재도출 불가, 선제 캡처 대상
];

export const DERIVATION_STATUS = ["mapped", "none", "deferred"];

// 글롭(derivationClassGlobs) 교차검사 대상 클래스. code(scanDirs 파일)·
// prior-traceability(@covers 태그)는 글롭이 아니라 스캔으로 검출(게이트 본체 담당).
export const GLOB_DETECTABLE = ["iac", "ci", "ops-docs"];

// 매니페스트(파싱된 객체) 검증 — D1(클래스·status 문법·전 클래스 회계) · D2(evidence/reason 존재).
export function validateManifest(data) {
  const errors = [];
  const known = new Set(SOURCE_CLASSES);
  for (const key of Object.keys(data)) {
    if (!known.has(key)) errors.push(`D1 미정의 소스 클래스 "${key}" — 고정 enum 외 값 금지(정의되지 않은 예외 금지)`);
  }
  for (const cls of SOURCE_CLASSES) {
    if (!(cls in data)) {
      errors.push(`D1 미회계 소스 클래스 "${cls}" — mapped|none|deferred 중 하나로 선언 필요(조용한 미인제스트 금지)`);
      continue;
    }
    const v = data[cls];
    const status = v && typeof v === "object" && !Array.isArray(v) ? String(v.status ?? "").trim() : "";
    if (!DERIVATION_STATUS.includes(status)) {
      errors.push(`D1 "${cls}": status는 mapped|none|deferred 중 하나여야 함`);
      continue;
    }
    if (status === "mapped") {
      if (!String(v.evidence ?? "").trim()) errors.push(`D2 "${cls}": mapped는 evidence 필수(빈 값 불가 — 존재만 강제, 질은 리뷰 몫)`);
    } else if (!String(v.reason ?? "").trim()) {
      errors.push(`D2 "${cls}": ${status}는 reason 필수(빈 값 불가)`);
    }
  }
  return errors;
}

// Change Log 근거(선제 캡처, SPEC-009 FR-006) — 실제 날짜(YYYY-MM-DD) 행인데 근거 칸이
// 빈 값이면 그 날짜를 반환. 플레이스홀더([YYYY-MM-DD])·헤더·구분선 행은 대상 아님.
// 변경의 "왜"는 저술 시점에만 존재한다 — 사후 재도출 불가.
export function changeLogRationaleFindings(text) {
  const block = sectionBlock(text, "Change Log");
  if (block === null) return [];
  const missing = [];
  for (const line of block.split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    if (!cells[2]) missing.push(cells[0]);
  }
  return missing;
}
