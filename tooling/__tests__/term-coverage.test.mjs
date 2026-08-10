// 의미 커버리지(SPEC-042) — @covers 태그가 있다는 사실과 그 테스트가 FR이 이름 댄 대상을
// 건드린다는 사실은 다르다. 실측 제보(2026-08-10): FR이 "Claude in Chrome(MCP)"를 주장했는데
// 커버 테스트는 선택자가 문자열 "chrome"을 돌려주는지만 봤고, R1·R1b·R2가 전부 초록이었다.
// @covers SPEC-042/FR-001
// @covers SPEC-042/FR-002
// @covers SPEC-042/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimedTerms, termCoverageFindings } from "../term-coverage-lib.mjs";

const GLOSSARY = ["MCP", "Claude in Chrome", { term: "Playwright", synonyms: ["chromium-driver"] }];

test("FR이 주장한 등록 용어를 뽑는다 — 주장하지 않은 용어는 뽑지 않는다", () => {
  assert.deepEqual(
    claimedTerms("THE SYSTEM SHALL choose Claude in Chrome (MCP) as the measure driver", GLOSSARY),
    ["MCP", "Claude in Chrome"],
  );
  assert.deepEqual(claimedTerms("THE SYSTEM SHALL write a JSONL ledger line", GLOSSARY), []);
});

test("실측 재현 — 커버 테스트가 레이블 값만 확인하면 미실증으로 표면화된다", () => {
  const findings = termCoverageFindings([{
    specId: "SPEC-013", frId: "FR-019",
    text: "**FR-019**: THE SYSTEM SHALL choose Claude in Chrome (MCP) as the measure driver",
    coveringTexts: [`expect(d).toMatchObject({ driver: "chrome", headless: false });\nexpect(runner).toContain("pickMeasureDriver");`],
  }], GLOSSARY);
  assert.deepEqual(findings, [
    { specId: "SPEC-013", frId: "FR-019", term: "MCP" },
    { specId: "SPEC-013", frId: "FR-019", term: "Claude in Chrome" },
  ]);
});

test("커버 파일 하나라도 그 이름을 담으면 실증으로 본다 — 이 축은 존재만 본다(질은 리뷰의 몫)", () => {
  const findings = termCoverageFindings([{
    specId: "SPEC-013", frId: "FR-019",
    text: "**FR-019**: THE SYSTEM SHALL speak MCP to the browser",
    coveringTexts: ["irrelevant helper\n", "const client = await mcp.connect(endpoint);\n"],
  }], GLOSSARY);
  assert.deepEqual(findings, []);
});

test("경계가 없으면 실증이 아니다 — connectMCP 같은 합성 식별자는 이름을 댄 것이 아니다", () => {
  assert.deepEqual(termCoverageFindings([{
    specId: "SPEC-013", frId: "FR-019", text: "**FR-019**: SHALL speak MCP",
    coveringTexts: ["const client = await connectMCP(endpoint);\n"],
  }], ["MCP"]), [{ specId: "SPEC-013", frId: "FR-019", term: "MCP" }]);
});

test("동의어 등록이 파라프레이즈를 해소한다 — 오탐은 규범이 아니라 선언으로 닫는다", () => {
  const unit = {
    specId: "SPEC-001", frId: "FR-001",
    text: "**FR-001**: THE SYSTEM SHALL drive the browser with Playwright",
    coveringTexts: [`import { launch } from "chromium-driver";\n`],
  };
  assert.deepEqual(termCoverageFindings([unit], GLOSSARY), []);
  assert.deepEqual(termCoverageFindings([unit], ["Playwright"]),
    [{ specId: "SPEC-001", frId: "FR-001", term: "Playwright" }]);
});

test("커버 파일이 없으면 판정하지 않는다 — 미커버는 R1/R2의 사실이지 이 축의 사실이 아니다", () => {
  assert.deepEqual(termCoverageFindings([{
    specId: "SPEC-013", frId: "FR-019", text: "SHALL use MCP", coveringTexts: [],
  }], GLOSSARY), []);
});

test("용어집이 비면 어떤 것도 판정하지 않는다 — 자동 추출은 하지 않는다(오탐 폭풍)", () => {
  assert.deepEqual(termCoverageFindings([{
    specId: "S", frId: "F", text: "SHALL use MCP", coveringTexts: ["nothing"],
  }], []), []);
});

test("ASCII 용어는 단어 경계로만 맞는다 — 부분일치는 대량 오탐이었다(markerHits 계약 승계)", () => {
  // "MCP"가 "MCPLike"·"XMCP"에 부분일치하면 실증으로 오인된다.
  const findings = termCoverageFindings([{
    specId: "S", frId: "F", text: "SHALL speak MCP",
    coveringTexts: ["const x = new MCPLikeThing();\n"],
  }], ["MCP"]);
  assert.deepEqual(findings, [{ specId: "S", frId: "F", term: "MCP" }]);
});
