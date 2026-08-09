#!/usr/bin/env node
// ─── 런타임 스키마 드리프트 게이트 (SPEC-022) — R2'(code↔deployed-runtime) ─────
// spec↔code(R1·R2)가 전부 green이어도 "코드가 기대하는 스키마"와 "배포된 DB 스키마"가
// 벌어지면 배포 후 500(예: PostgreSQL 42703 column does not exist)이 난다 — 어떤 기존 게이트도 못 잡는 축.
// 이 게이트는 프로젝트가 선언한 두 명령을 실행해 (코드 기대 vs 배포 실측) 스키마 집합을 diff한다.
// DB/ORM 중립 — 킷은 DB에 직접 연결하지 않고 프로젝트의 조회 명령만 실행(commands.test와 동형).
// 로컬 훅이 아니라 **배포 파이프라인 preflight**(migrate 직전)에 거는 게 핵심 — 배포 시점에만 배포 DB 조회 가능.
// 설계: SPEC-022 (Python판 sdd_gates.py schemadrift가 동일 동작을 미러 — SPEC-006 패리티).
import { execSync } from "node:child_process";
import { loadConfig } from "./sdd-config.mjs";
import { schemaDriftVerdict, MIGRATION_ENUM } from "./schema-drift-lib.mjs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

import { armVerdict, verdict, judged, VERDICT_KINDS } from "./verdict-lib.mjs";

export { schemaDriftVerdict, MIGRATION_ENUM };

// 명령 stdout을 스키마 식별자 배열로 — 줄 단위 trim, 빈 줄 제거.
function runLines(cmd, root) {
  const out = execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split("\n").map((x) => x.trim()).filter(Boolean);
}


// 이 파일이 직접 실행된 엔트리인가 — 경로 표현 차이(퍼센트 인코딩·심볼릭 링크)에 강건한 판정.
function isMainEntry(metaUrl) {
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]); }
  catch { return false; }
}

// 엔트리 판정은 realpath 비교다 — `file://${argv[1]}` 문자열 비교는 (a) 경로에 비-ASCII가 있으면
// import.meta.url이 퍼센트 인코딩돼 불일치하고 (b) macOS /var↔/private/var 심볼릭 링크에서도
// 갈린다. 그러면 main 블록이 **조용히 실행되지 않아** 게이트가 아무 판정도 없이 exit 0 —
// 실측: 한글 경로 소비 프로젝트에서 `runTestsPolicy: hard`가 여러 라운드 동안 거짓 green이었다
// (게이트가 한 줄도 출력하지 않는데 sdd-sync는 clean으로 읽음). 킷은 sdd-sync.mjs(ab5eb1a)에서
// 이미 fileURLToPath로 옮겼는데 이 파일들에 원본 비교가 남아 있었다.
if (isMainEntry(import.meta.url)) {
  // ⚠ arm은 **엔트리일 때만**이다 — 이 모듈을 import만 한 프로세스(테스트 러너 등)에서
  // 종료 훅이 fd 1에 쓰면 그 프로세스의 stdout 프로토콜을 깨뜨린다(실측: node --test IPC 손상).
  armVerdict();
  const cfg = loadConfig();
  const m = cfg.schemaDriftManifest; // null | {expected, deployed}
  if (!m || !m.expected || !m.deployed) {
    verdict(VERDICT_KINDS.INERT, "schemaDriftManifest 미설정 — expected/deployed를 조회할 명령이 없다");
    console.log("런타임 스키마 드리프트 게이트 — schemaDriftManifest 미설정(비활성; DB 스키마 SSOT 프로젝트는 배포 preflight에 expected/deployed 조회 명령 설정 권장)");
    process.exit(0);
  }
  const policy = cfg.migrationStatePolicy || "advisory";
  let expected = [], deployed = [], ran = true;
  if (MIGRATION_ENUM.includes(policy)) {
    try { expected = runLines(m.expected, cfg.__root); deployed = runLines(m.deployed, cfg.__root); }
    catch { ran = false; }
  }
  const v = schemaDriftVerdict(expected, deployed, ran, policy);
  // 조회가 실패했으면(ran=false) 본 것이 없다 — exit 0이어도 판정이 아니다.
  if (!ran) verdict(VERDICT_KINDS.SKIPPED, "expected/deployed 조회 실패 — 라이브 스키마를 읽지 못했다");
  else if (policy === "off") verdict(VERDICT_KINDS.OFF, "migrationStatePolicy");
  else judged(v.exit ? 1 : 0);
  (v.valid ? console.log : console.error)(v.line);
  process.exit(v.exit);
}
