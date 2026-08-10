// 근거 적용범위(SPEC-043) — 관측은 그 관측이 이루어진 범위까지만 참이다.
// 실측 제보(2026-08-10): 리눅스 1대(X 서버 없음)에서 한 번 관측한 사실이 `DISPLAY ||
// WAYLAND_DISPLAY` 보편 규칙으로 승격됐다. 근거 칸이 비지 않았으니 모든 게이트가 초록이었다.
// @covers SPEC-043/FR-001
// @covers SPEC-043/FR-002
// @covers SPEC-043/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceScopeFindings, scopeDeclared, claimsObservation, namedEnvironments } from "../evidence-scope-lib.mjs";

const spec = (rows) => `# S\n\n## Change Log\n\n| 날짜 | 변경 | 근거 |\n| --- | --- | --- |\n${rows.join("\n")}\n`;

test("환경을 지목한 관측인데 범위 표기가 없으면 표면화한다 — 실측 재현", () => {
  const f = evidenceScopeFindings(spec([
    "| 2026-08-10 | 헤드리스 판정 규칙 도입 | 리눅스에서 실측: DISPLAY 없음 |",
  ]));
  assert.equal(f.length, 1);
  assert.equal(f[0].date, "2026-08-10");
  assert.deepEqual(f[0].environments, ["리눅스"]);
});

test("범위를 밝히면 통과한다 — 해소는 표기이지 정책 하향이 아니다", () => {
  assert.deepEqual(evidenceScopeFindings(spec([
    "| 2026-08-10 | 헤드리스 판정 | 리눅스에서 실측. 범위: X 없는 리눅스 CI 러너 한정, macOS·WSLg 미검증 |",
  ])), []);
});

test("환경을 지목하지 않은 관측은 대상이 아니다 — 방아쇠를 관측만으로 두면 킷에서 77건이 쏟아진다", () => {
  assert.deepEqual(evidenceScopeFindings(spec([
    "| 2026-08-10 | dedup 입력 보정 | 소비 프로젝트 PM 실측: 소유 76건이 조용히 무효화 |",
  ])), []);
});

test("근거 칸이 비면 이 축은 판정하지 않는다 — 공백은 SPEC-009 FR-006의 사실이다(중복 고발 금지)", () => {
  assert.deepEqual(evidenceScopeFindings(spec(["| 2026-08-10 | 무언가 | |"])), []);
});

test("플레이스홀더·헤더 행은 대상이 아니다 — changeLogRationaleFindings와 같은 행 선별", () => {
  assert.deepEqual(evidenceScopeFindings(spec([
    "| [YYYY-MM-DD] | 템플릿 | 리눅스 실측 |",
  ])), []);
});

test("Change Log 절이 없으면 판정하지 않는다", () => {
  assert.deepEqual(evidenceScopeFindings("# S\n\n## Functional Requirements\n"), []);
});

test("라벨만 있고 내용이 비면 표기가 아니다 — 라벨은 약속이지 이행이 아니다", () => {
  assert.equal(scopeDeclared("리눅스 실측. 범위:", ["범위"]), false);
  assert.equal(scopeDeclared("리눅스 실측. 범위: CI 러너", ["범위"]), true);
});

test("마커·라벨·환경 목록은 프로젝트가 갈아끼운다 — 면제가 아니라 어휘 교체다", () => {
  assert.equal(claimsObservation("we ran a benchmark", ["benchmark"]), true);
  assert.equal(claimsObservation("we ran a benchmark", ["실측"]), false);
  // 단어 경계 — `benchmarked`는 `benchmark`의 매치가 아니다(markerHits 계약 승계).
  assert.equal(claimsObservation("we benchmarked it", ["benchmark"]), false);
  assert.deepEqual(namedEnvironments("ran on ubuntu and alpine", ["ubuntu", "alpine", "wsl"]), ["ubuntu", "alpine"]);
  assert.deepEqual(evidenceScopeFindings(
    spec(["| 2026-08-10 | x | measured on ubuntu |"]),
    ["measured"], ["scope"], ["ubuntu"],
  ).map((f) => f.environments), [["ubuntu"]]);
});
