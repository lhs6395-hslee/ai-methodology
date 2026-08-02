#!/usr/bin/env node
// SPEC-033 ③층 — 후보 판정용 쌍 열거기(의존성 0, 네트워크 0).
//
// LLM에게 "34개 중 비슷한 거 찾아봐"라고 던지면 눈에 띄는 몇 개만 집고 가운데를
// 흘린다. 그건 모델 능력이 아니라 루프 구조의 문제라서, 열거는 기계가 하고 LLM은
// 쌍 하나씩만 판정하게 만든다 — 그러면 커버리지가 결정적으로 보장된다.
//
//   node docs/examples/entity-pairs.mjs            # anchor별 전수 열거
//   node docs/examples/entity-pairs.mjs --desc     # 설명문까지(판정용)
//
// 판정 결과는 계약대로 적는다 — 한 줄 = 한 쌍, 탭 구분, 3번째 칸은 선택적 확신도:
//   sdd/similarity-candidates.tsv
//   "entitySimilarityCommand": "cat sdd/similarity-candidates.tsv"
import { readFileSync } from "node:fs";

const cfgPath = process.argv.find((a) => a.endsWith(".json")) || "sdd.config.json";
const withDesc = process.argv.includes("--desc");
const reg = JSON.parse(readFileSync(cfgPath, "utf8")).entityRegistry || {};
const keys = Object.keys(reg).sort();
if (!keys.length) { console.error("entityRegistry가 비어 있다 — 판정할 대상이 없다"); process.exit(1); }

let n = 0;
const lines = [];
for (let i = 0; i < keys.length; i++) {
  const rest = keys.slice(i + 1);
  if (!rest.length) break;
  lines.push(`\n■ ${keys[i]}${withDesc ? ` — ${reg[keys[i]]}` : ""}  (쌍 ${rest.length})`);
  for (const b of rest) lines.push(`  ${++n}. ${keys[i]} ↔ ${b}${withDesc ? `\n       ${reg[b]}` : ""}`);
}
console.log(`entity ${keys.length}건 · 전 쌍 ${n}건 — i<j 전수 열거(빠짐 없음)`);
console.log(lines.join("\n"));
