#!/usr/bin/env node
// ─── 배선 무결성 게이트 (SPEC-050, R18) ───
// 실측 제보: 소비 프로젝트가 `update.md` 2~3단계 diff를 "내용 다른 파일" 기준으로 훑어 공유 lib
// 27개를 빠뜨렸고, 그중 하나가 구판으로 남아 `check-spec-consistency.mjs`가 판정 대신 이것을 냈다:
//     SyntaxError: … does not provide an export named 'bodyBeforeOwnership'
//
// **부분 동기화**다. 게이트 코드는 최신이고 lib은 구판이다. 이 상태는 기존 어떤 축도 잡지 못했다 —
// SPEC-004의 전이 폐포 계약은 *파일이 배포되는가*를 보고, 이 결함은 *배포된 파일이 요구된 export를
// 갖는가*이므로 한 칸 더 안쪽이다. 그리고 결과는 **다른 게이트의 크래시**로 나타나므로, 고장 신호가
// 고장 지점과 다른 곳에서 뜬다.
//
// 이 축은 아무 게이트도 실행하지 않고 판정한다 — import 그래프는 정적으로 결정 가능하다.
// **정적으로 결정 가능한 것을 사람에게 맡기지 않는다.**
//
// 판정 시작점은 **이 게이트 자신의 디렉터리에 있는 모듈 전부**다. 킷에서는 `tooling/`, 소비
// 프로젝트에서는 `scripts/` — 설치 위치를 config로 물어보지 않는다(게이트는 자기가 어디 있는지
// 안다). 시작점이 0건이면 판정 입력이 없으므로 INERT를 선언한다(Python 런타임 전용 프로젝트가
// 여기 해당한다 — 0건을 "깨끗함"으로 읽지 않는다).
//
// importWiringPolicy: off | advisory(기본) | hard(킷 자신).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./sdd-config.mjs";
import {
  wiringFindings, formatWiringViolation, DEFAULT_WIRING_EXTENSIONS,
} from "./import-wiring-lib.mjs";

import { armVerdict, verdict, judged, isMainEntry, VERDICT_KINDS } from "./verdict-lib.mjs";

function main() {
  const cfg = loadConfig();
  const POLICY = String(cfg.importWiringPolicy ?? "advisory");
  if (!["off", "advisory", "hard"].includes(POLICY)) {
    console.error(`✗ importWiringPolicy 값 위반 "${POLICY}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)`);
    process.exit(1);
  }
  if (POLICY === "off") {
    verdict(VERDICT_KINDS.OFF, "importWiringPolicy");
    console.log("배선 무결성 게이트 — importWiringPolicy:off (판정 안 함)"); return;
  }

  const GATE_DIR = dirname(fileURLToPath(import.meta.url));
  const exts = (cfg.importWiringExtensions || DEFAULT_WIRING_EXTENSIONS).map((e) => `.${String(e).replace(/^\./, "")}`);
  const entries = readdirSync(GATE_DIR)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .sort();

  if (!entries.length) {
    verdict(VERDICT_KINDS.INERT, `모듈 0건 — ${exts.join("·")} 파일이 없다`);
    console.log(`[안 봄(판정 입력 없음)] 배선 무결성 게이트 — 이 디렉터리에 ${exts.join("·")} 모듈이 없다.`
      + " Python 런타임 전용 설치라면 정상이다(대조할 import 그래프가 없다) — **0건은 '깨끗함'이 아니라 '볼 것이 없음'이다**.");
    return;
  }

  // 파일 읽기·경로 해석 주입 — 순수 코어는 IO를 모른다(SPEC-006).
  const read = (key) => {
    const abs = join(GATE_DIR, key);
    if (!existsSync(abs)) return null;
    try { return { text: readFileSync(abs, "utf8") }; } catch { return null; }
  };
  // 키는 게이트 디렉터리 기준 상대 경로다 — `../` 로 밖을 가리켜도 같은 규칙으로 정규화된다.
  const resolveKey = (fromKey, specifier) =>
    resolvePath(dirname(join(GATE_DIR, fromKey)), specifier).slice(GATE_DIR.length + 1)
    || resolvePath(dirname(join(GATE_DIR, fromKey)), specifier);

  const { violations, unchecked, walked } = wiringFindings(entries, read, resolveKey);

  judged(POLICY === "hard" ? violations.length : 0);
  const missFile = violations.filter((v) => v.kind === "missing-file").length;
  const missExport = violations.filter((v) => v.kind === "missing-export").length;
  console.log(`배선 무결성 게이트(importWiringPolicy=${POLICY}): 모듈 ${entries.length}종 · 걸어본 ${walked}종`
    + ` — 파일 없음 ${missFile} · export 없음 ${missExport} · 확인 못 함 ${unchecked.length}`);

  // "확인 못 함"은 위반도 clean도 아니다 — 매 실행 표면화하고 차단하지 않는다.
  for (const u of unchecked.slice(0, 8)) {
    console.log(`  · [확인 못 함] ${u.key}: ${u.why} — 이 대상의 export 집합을 확정할 수 없어 **없다고 단정하지 않는다**`);
  }
  if (unchecked.length > 8) console.log(`  · [확인 못 함] … 외 ${unchecked.length - 8}건`);

  if (!violations.length) {
    console.log(`  ✓ 로컬 import 전부가 실재하는 파일의 실재하는 export를 가리킨다 — 부분 동기화 0건.`);
    return;
  }

  const lines = violations.map(formatWiringViolation);
  if (POLICY === "hard") {
    console.error(`\n✗ 배선이 깨졌다 ${violations.length}건 — 이 게이트들은 판정이 아니라 크래시를 낸다:`);
    for (const l of lines) console.error(`  ✗ ${l}`);
    console.error("\n→ 정본에서 해당 모듈을 다시 복사하라(`prompts/update.md` 2단계 — **게이트가 import하는 모듈까지 전이적으로** diff 대상이다).");
    process.exit(1);
  }
  for (const l of lines) console.log(`  ⚠ ${l}`);
  console.log("→ 해소는 정본 재복사 하나뿐이다(면제 경로 없음). 깨진 배선은 정책 강도와 무관하게 게이트를 죽인다.");
}

if (isMainEntry(import.meta.url)) { armVerdict(); main(); }
