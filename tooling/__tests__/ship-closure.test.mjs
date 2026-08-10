// 배포 목록의 **전이 폐포** 계약 — sdd-init.sh가 게이트를 복사하면서 그 게이트가 import하는
// 모듈을 빠뜨리면, 소비 프로젝트는 게이트가 아니라 `ERR_MODULE_NOT_FOUND`를 받는다.
//
// 이 결함은 이 킷에서 **세 번 재발했다**(verdict-lib·verification-run-lib·term-coverage-lib).
// 세 번 다 "다음엔 목록도 같이 고치자"는 규범으로 끝났고, 세 번 다 그 규범이 안 지켜졌다.
// 규범으로 두 번 이상 실패한 것은 기계가 잡는다 — 손으로 유지하는 목록은 언젠가 드리프트한다.
// @covers SPEC-004/FR-005
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TOOLING = new URL("..", import.meta.url).pathname;
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
