// 배포 목록의 **전이 폐포** 계약 — sdd-init.sh가 게이트를 복사하면서 그 게이트가 import하는
// 모듈을 빠뜨리면, 소비 프로젝트는 게이트가 아니라 `ERR_MODULE_NOT_FOUND`를 받는다.
//
// 이 결함은 이 킷에서 **세 번 재발했다**(verdict-lib·verification-run-lib·term-coverage-lib).
// 세 번 다 "다음엔 목록도 같이 고치자"는 규범으로 끝났고, 세 번 다 그 규범이 안 지켜졌다.
// 규범으로 두 번 이상 실패한 것은 기계가 잡는다 — 손으로 유지하는 목록은 언젠가 드리프트한다.
// @covers SPEC-004/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLING = fileURLToPath(new URL("..", import.meta.url));
const INIT = readFileSync(join(TOOLING, "sdd-init.sh"), "utf8");

// sdd-init.sh의 node 분기 복사 목록 — 소스에서 뽑는다(손으로 복제하면 그 복제가 다음 드리프트다).
function shippedFiles() {
  const start = INIT.indexOf("node) for f in ");
  assert.notEqual(start, -1, "sdd-init.sh의 node 복사 목록을 찾지 못했다(형식이 바뀌었으면 이 테스트도 같이 고쳐라)");
  const block = INIT.slice(start, INIT.indexOf("; do", start));
  return new Set(block.match(/[\w-]+\.mjs/g) || []);
}

// 로컬 상대 import의 전이 폐포.
function closureOf(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    const p = join(TOOLING, f);
    if (!existsSync(p)) continue;
    seen.add(f);
    for (const m of readFileSync(p, "utf8").matchAll(/from\s+["']\.\/([\w-]+\.mjs)["']/g)) stack.push(m[1]);
  }
  return seen;
}

test("sdd-init.sh가 배포하는 모든 스크립트의 import 폐포도 배포된다 — 세 번 재발한 결함", () => {
  const shipped = shippedFiles();
  const missing = [...closureOf(shipped)].filter((f) => !shipped.has(f)).sort();
  assert.deepEqual(missing, [], `배포 목록에서 빠진 전이 의존:\n  ${missing.join("\n  ")}\n`
    + "→ sdd-init.sh의 node 복사 목록에 추가하라(빠지면 소비 프로젝트는 게이트 대신 ERR_MODULE_NOT_FOUND를 받는다)");
});

test("스윕 규칙표에 등재된 게이트는 전부 배포 목록에 있다 — 안 배포된 게이트는 소비처에서 존재하지 않는다", () => {
  const src = readFileSync(join(TOOLING, "sdd-sync.mjs"), "utf8");
  const block = src.slice(src.indexOf("const RULES = ["), src.indexOf("\n];", src.indexOf("const RULES = [")));
  const gates = [...new Set([...block.matchAll(/"((?:check|gen)-[a-z-]+\.mjs)"/g)].map((m) => m[1]))];
  const shipped = shippedFiles();
  const missing = gates.filter((g) => !shipped.has(g)).sort();
  assert.deepEqual(missing, [], `규칙표에 있는데 배포 안 되는 게이트: ${missing.join(", ")}`);
});

// ── 게이트 카나리아 계약(SPEC-048, 제보 조건 4) ─────────────────────────────
// 제보의 논거: "결정적이라 신뢰할 수 있다"는 절반만 맞다 — **결정적인 것과 옳은 것은 다르다.**
// 틀린 게이트는 틀린 답을 결정적으로 재현하고, 그 고장은 실패가 아니라 **통과**로 나타나므로
// 일반 테스트로 드러나지 않는다(실측: 게이트가 19건을 흘리면서 green이었다).
// 그래서 스윕에 등재된 게이트는 **자기 차단 능력을 증명하는 테스트**를 가져야 한다.
// 이 계약은 정적으로 결정 가능하므로 실행이나 에이전트에 맡기지 않는다(제보 조건 1).
// @covers SPEC-048/FR-004
test("스윕 등재 게이트는 전부 차단을 증명하는 테스트를 갖는다 — 결정적인 것과 옳은 것은 다르다", () => {
  const src = readFileSync(join(TOOLING, "sdd-sync.mjs"), "utf8");
  const block = src.slice(src.indexOf("const RULES = ["), src.indexOf("\n];", src.indexOf("const RULES = [")));
  const gates = [...new Set([...block.matchAll(/"((?:check|gen)-[a-z-]+\.mjs)"/g)].map((m) => m[1]))];
  const dir = join(TOOLING, "__tests__");
  const texts = readdirSync(dir).filter((f) => f.endsWith(".test.mjs"))
    .map((f) => ({ f, t: readFileSync(join(dir, f), "utf8") }));
  // 차단 단언의 형태 — 비-0 종료·예외·거부. 어느 형태든 "막았다"를 단언하면 된다.
  const BLOCKING = /code,\s*[1-9]|status\s*===?\s*[1-9]|exit\s*[1-9]|assert\.throws|toThrow|rejects/;
  // **차단했다는 것과 옳은 이유로 차단했다는 것은 다른 사실이다.** 비-0 종료만 단언하면 게이트가
  // 엉뚱한 이유로 죽어도(정책 enum 위반·크래시·경로 오류) 테스트는 초록이고, 심어둔 위반은
  // 놓친 채로 남는다 — 이 계열 결함은 실패가 아니라 **통과**로 나타난다는 제보의 논거 그대로다.
  // 그래서 차단을 단언하는 파일은 **게이트 출력도 대조해야** 한다(무엇을 찾았는지 고정).
  // 측정(2026-08-10): 도입 시점 27/27이 이미 충족 — 이 계약은 그 상태를 **되돌아가지 못하게** 못박는다.
  const REASON = /assert\.match\(\s*\w*\.?(?:out|stdout|stderr|output)/;
  const missing = [];
  for (const g of gates) {
    const base = g.replace(/\.mjs$/, "");
    const rel = texts.filter((x) => x.t.includes(g) || x.t.includes(base));
    if (!rel.length) { missing.push(`${g}: 이 게이트를 다루는 테스트가 없다`); continue; }
    const blocking = rel.filter((x) => BLOCKING.test(x.t));
    if (!blocking.length) { missing.push(`${g}: 차단(비-0 종료·예외) 단언이 없다 — 통과 경로만 관측됐다`); continue; }
    if (!blocking.some((x) => REASON.test(x.t))) {
      missing.push(`${g}: 차단은 단언하는데 **출력을 대조하지 않는다** — 엉뚱한 이유로 죽어도 초록이다`);
    }
  }
  assert.deepEqual(missing, [], `차단 능력이 증명되지 않은 게이트:\n  ${missing.join("\n  ")}\n`
    + "→ 심어둔 위반으로 그 게이트가 **실제로 막는지** 단언하는 테스트를 추가하라."
    + " 통과 경로만 관측된 게이트는 clean이 아니라 미검증이다.");
});
