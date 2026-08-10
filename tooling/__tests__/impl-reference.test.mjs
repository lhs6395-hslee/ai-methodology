// 지목 구현체 참조(SPEC-046) — 스펙이 이름으로 지목한 메커니즘은 실행 경로에 있어야 한다.
// 실측 제보(사례 4): FR이 `extractDeployTickets()`를 지목했는데 표면(Jenkinsfile)은 그 함수를
// 부르지 않고 쉘로 다시 구현했다. 규칙이 갈라져 19건이 배포 범위에서 조용히 누락됐고, 커버
// 테스트는 **버그 있는 쉘 구현이 거기 있는지**를 단언했다. 게이트는 전부 초록이었다.
// @covers SPEC-046/FR-001
// @covers SPEC-046/FR-002
// @covers SPEC-046/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { namedImplementations, implReferenceFindings, referenceCount, REFERENCE_BAR } from "../impl-reference-lib.mjs";

const isTest = (n) => /\.(test|spec)\.[a-z]+$/.test(n);

test("백틱 스팬에서 함수 호출형·모듈명만 뽑는다 — config 키·enum·플래그는 구현체가 아니다", () => {
  const fr = "**FR-042**: THE SYSTEM SHALL extract every `PJT-<번호>` via `extractDeployTickets()`"
    + " in `deploy-tickets.mjs`, honouring `--strict` and `hard`, per `sdd.config.json` and `maxFRsPerSpec`.";
  assert.deepEqual(namedImplementations(fr, isTest), [
    { name: "extractDeployTickets", kind: "fn", span: "extractDeployTickets()" },
    { name: "deploy-tickets.mjs", kind: "mod", span: "deploy-tickets.mjs" },
  ]);
});

test("이름 뒤 공백은 호출이 아니다 — 실측 오탐(`EntityName (relation-type)`)의 회귀", () => {
  assert.deepEqual(namedImplementations("**FR-001**: refers to `EntityName (relation-type)` only.", isTest), []);
});

test("테스트 파일명은 구현체가 아니라 검증 자산이다 — SPEC-031·041이 이미 본다", () => {
  assert.deepEqual(namedImplementations("**SC-001**: `foo.test.mjs` 전 케이스 green", isTest), []);
  assert.deepEqual(namedImplementations("**NFR-001**: 코어는 `foo-lib.mjs`에 있다", isTest),
    [{ name: "foo-lib.mjs", kind: "mod", span: "foo-lib.mjs" }]);
});

test("같은 이름을 두 번 지목해도 한 번만 센다 — 건수가 부풀면 사람이 목록을 안 읽는다", () => {
  const got = namedImplementations("**FR-001**: `f()` then `f()` again", isTest);
  assert.equal(got.length, 1);
});

test("실측 재현 — 표면이 쉘로 다시 구현했고 지목 함수는 고아다", () => {
  const units = [{ specId: "INFRA-004", frId: "FR-042", names: [{ name: "extractDeployTickets", kind: "fn" }] }];
  const sources = [
    // 정의는 있다(등장 1회) — 그러나 아무도 부르지 않는다.
    { path: "ci/lib/tickets.mjs", text: "export function extractDeployTickets(range) { /* … */ }\n" },
    // 표면은 같은 일을 쉘로 다시 구현했다(그리고 그 쪽에만 결함이 있었다).
    { path: "Jenkinsfile", text: `DEPLOY_TICKETS=$(git log --format=%B "$RANGE" | grep -oE 'PJT-[0-9]+' | awk '!seen[$0]++')\n` },
  ];
  assert.deepEqual(implReferenceFindings(units, sources), [
    { specId: "INFRA-004", frId: "FR-042", name: "extractDeployTickets", kind: "fn", refs: 1, bar: 2, sites: ["ci/lib/tickets.mjs"] },
  ]);
});

test("호출이 하나라도 있으면 통과한다 — 이 축은 참조의 존재만 본다(질은 리뷰)", () => {
  const units = [{ specId: "I", frId: "FR-042", names: [{ name: "extractDeployTickets", kind: "fn" }] }];
  const sources = [
    { path: "ci/lib/tickets.mjs", text: "export function extractDeployTickets(range) {}\n" },
    { path: "Jenkinsfile", text: "node -e 'extractDeployTickets(RANGE)'\n" },
  ];
  assert.deepEqual(implReferenceFindings(units, sources), []);
});

test("이름이 아예 없으면 refs 0 — 이름이 바뀌었거나 다른 구현으로 대체된 것이다", () => {
  const f = implReferenceFindings(
    [{ specId: "I", frId: "FR-001", names: [{ name: "gone", kind: "fn" }] }],
    [{ path: "a.mjs", text: "export function stillHere() {}\n" }]);
  assert.equal(f.length, 1);
  assert.equal(f[0].refs, 0);
});

test("모듈은 자기 파일의 언급을 참조로 세지 않는다 — 헤더 주석에 자기 이름을 적는 것은 흔하다", () => {
  const units = [{ specId: "I", frId: "NFR-001", names: [{ name: "drift-lib.mjs", kind: "mod" }] }];
  const self = { path: "tooling/drift-lib.mjs", text: "// tooling/drift-lib.mjs — 코어\nexport const x = 1;\n" };
  assert.equal(implReferenceFindings(units, [self]).length, 1, "자기 언급만으로 통과했다");
  const consumer = { path: "tooling/check-drift.mjs", text: `import { x } from "./drift-lib.mjs";\n` };
  assert.deepEqual(implReferenceFindings(units, [self, consumer]), []);
});

test("기준은 종류마다 다르다 — 함수는 정의+호출, 모듈은 자기 파일 외 1회", () => {
  assert.deepEqual(REFERENCE_BAR, { fn: 2, mod: 1 });
});

test("식별자는 대소문자를 구분하고 경계로 맞춘다 — 부분일치는 '참조된다'를 거짓으로 참으로 만든다", () => {
  assert.equal(referenceCount("extractDeployTicketsV2(x)", "extractDeployTickets"), 0);
  assert.equal(referenceCount("extractdeploytickets(x)", "extractDeployTickets"), 0);
  assert.equal(referenceCount("a = extractDeployTickets(x); extractDeployTickets(y)", "extractDeployTickets"), 2);
  assert.equal(referenceCount("obj.extractDeployTickets(x)", "extractDeployTickets"), 1, "멤버 호출도 참조다");
});
