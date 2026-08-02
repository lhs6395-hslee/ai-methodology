// tooling/__tests__/synonym.test.mjs — 동의어·형태 변이 (SPEC-033)
// 의미적 중복의 결정적 포획층. 핵심 계약: **확률적 층(LLM·임베딩)은 어떤 강도에서도 차단 못 한다**
// — 오탐이 빌드를 깨면 그 실수가 곧 방법론의 오류가 된다(owner 제약). 그 계약을 회귀로 고정한다.
// @covers SPEC-033/FR-001
// @covers SPEC-033/FR-002
// @covers SPEC-033/FR-003
// @covers SPEC-033/FR-004
// @covers SPEC-033/FR-005
// @covers SPEC-033/FR-006
// @covers SPEC-033/FR-007
// @covers SPEC-033/FR-008
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  singularize, canonicalForm, lexicalCollisions, validateSynonymRegistry,
  declaredSynonymFindings, parseCandidatePairs, classifyCandidates, validateLedger,
  entitySetFingerprint, parseCandidateHeader, candidateFreshness,
} from "../synonym-lib.mjs";

const GATE = new URL("../check-synonym.mjs", import.meta.url).pathname;

// ── 순수 코어 ──

test("singularize: 보수적 — status·class·analysis는 건드리지 않는다(과잉 병합 금지)", () => {
  assert.equal(singularize("orders"), "order");
  assert.equal(singularize("policies"), "policy");
  assert.equal(singularize("boxes"), "box");
  assert.equal(singularize("status"), "status");   // us
  assert.equal(singularize("class"), "class");     // ss
  assert.equal(singularize("analysis"), "analysis"); // is
  assert.equal(singularize("os"), "os");           // 3글자 이하
});

test("canonicalForm: 케이스·구분자 토큰화 + 단수화, 접두어는 선언된 것만 제거", () => {
  assert.equal(canonicalForm("pjt_orders", ["pjt"]), "order");
  assert.equal(canonicalForm("orderItem"), "order_item");
  assert.equal(canonicalForm("order-items"), "order_item");
  assert.equal(canonicalForm("pjt_orders"), "pjt_order");     // 미선언 접두어는 보존
  assert.equal(canonicalForm("pjt", ["pjt"]), "pjt");         // 전부 접두어면 원형 유지
});

test("lexicalCollisions: 정규화 후 같은 정본형이면 충돌(다른 키가 2개 이상일 때만)", () => {
  const owned = [
    { specId: "SPEC-001", category: "Entities", key: "order" },
    { specId: "SPEC-002", category: "Entities", key: "pjt_orders" },
    { specId: "SPEC-003", category: "Entities", key: "invoice" },
  ];
  const c = lexicalCollisions(owned, ["pjt"]);
  assert.equal(c.length, 1);
  assert.equal(c[0].canonical, "order");
  assert.deepEqual(c[0].members.map((m) => m.key), ["order", "pjt_orders"]);
  // 같은 키를 같은 철자로 여러 스펙이 쓰면 이건 dedup(SPEC-002) 소관 — 여기선 충돌 아님
  assert.equal(lexicalCollisions([
    { specId: "A", category: "E", key: "order" }, { specId: "B", category: "E", key: "order" },
  ], []).length, 0);
});

test("validateSynonymRegistry: 사유·별칭·정본 실재·모순을 결정적으로 검사", () => {
  const owned = new Set(["user"]);
  assert.deepEqual(validateSynonymRegistry({ user: { aliases: ["member"], reason: "같은 사람 개념" } }, owned), []);
  const errs = validateSynonymRegistry({
    user: { aliases: ["member"], reason: "" },          // 사유 없음
    ghost: { aliases: ["x"], reason: "r" },             // 정본 미소유
    other: { aliases: [], reason: "r" },                // 별칭 0
  }, owned);
  assert.ok(errs.some((e) => /통합 사유 필요/.test(e)));
  assert.ok(errs.some((e) => /소유되지 않음/.test(e)));
  assert.ok(errs.some((e) => /aliases 최소 1개/.test(e)));
  // 한 별칭이 두 정본에 걸림 = 모순
  const contra = validateSynonymRegistry({
    user: { aliases: ["account"], reason: "r" }, org: { aliases: ["account"], reason: "r" },
  }, new Set(["user", "org"]));
  assert.ok(contra.some((e) => /두 정본에 걸림/.test(e)));
});

test("declaredSynonymFindings: 선언된 별칭을 소유하면 정본으로 통일 요구", () => {
  const f = declaredSynonymFindings(
    [{ specId: "SPEC-009", category: "Entities", key: "member" }],
    { user: { aliases: ["member"], reason: "r" } });
  assert.deepEqual(f, [{ specId: "SPEC-009", category: "Entities", key: "member", canonical: "user" }]);
});

test("parseCandidatePairs: 탭·파이프·콤마 구분, 정렬·중복 제거, 주석·자기쌍 무시", () => {
  const p = parseCandidatePairs("user\tmember\t0.9\nmember|user\n# comment\nx,x\nA,B");
  assert.deepEqual(p.map((q) => `${q.a}::${q.b}`), ["member::user", "a::b"]);
  assert.equal(p[0].score, "0.9");
});

test("classifyCandidates: registry·원장이 소진, 나머지만 미결", () => {
  const pairs = parseCandidatePairs("user\tmember\nuser\tstaff\nfoo\tbar");
  const r = classifyCandidates(pairs,
    { user: { aliases: ["member"], reason: "r" } },
    { "staff::user": "직원은 계정과 다른 실체" });
  assert.deepEqual(r.unresolved.map((p) => `${p.a}::${p.b}`), ["bar::foo"]);
  assert.equal(r.resolvedByRegistry, 1);
  assert.equal(r.resolvedByLedger, 1);
});

test("validateLedger: 기각도 사유 필수(조용한 묵살 금지)", () => {
  assert.deepEqual(validateLedger({ "a::b": "다른 실체" }), []);
  assert.ok(validateLedger({ "a::b": "  " }).some((e) => /기각 사유 필요/.test(e)));
  assert.ok(validateLedger({ ab: "r" }).some((e) => /키 형식/.test(e)));
});

// ── 게이트 e2e ──

function fixture(cfg, entities) {
  const root = mkdtempSync(join(tmpdir(), "sdd-syn-"));
  mkdirSync(join(root, "sdd", "specs"), { recursive: true });
  writeFileSync(join(root, "sdd.config.json"), JSON.stringify({ specDir: "sdd/specs", ...cfg }));
  entities.forEach((e, i) => {
    const id = `SPEC-${String(i + 1).padStart(3, "0")}`;
    writeFileSync(join(root, "sdd/specs", `${id}.md`), `**Spec**: \`${id}\`\n## Ownership\n- **Entities**: ${e}\n`);
  });
  return root;
}
function run(root) {
  try { return { code: 0, out: execFileSync("node", [GATE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

test("게이트: off → 판정 안 함 / 형태 충돌은 advisory ⚠ · hard ✗", () => {
  const off = run(fixture({}, ["order", "pjt_orders"]));
  assert.equal(off.code, 0); assert.match(off.out, /off \(판정 안 함\)/);
  const adv = run(fixture({ synonymPolicy: "advisory", keyPrefixes: ["pjt"] }, ["order", "pjt_orders"]));
  assert.equal(adv.code, 0); assert.match(adv.out, /형태 변이 충돌 "order"/);
  const hard = run(fixture({ synonymPolicy: "hard", keyPrefixes: ["pjt"] }, ["order", "pjt_orders"]));
  assert.equal(hard.code, 1); assert.match(hard.out, /형태 변이 충돌/);
});

// ★ 핵심 계약 회귀 — LLM/임베딩 오탐이 빌드를 깨지 못한다
test("게이트: 미결 후보만 있으면 hard여도 exit 0 — 확률적 층은 차단력이 없다(FR-006)", () => {
  const root = fixture({ synonymPolicy: "hard", entitySimilarityCommand: "printf 'user\\tstaff\\t0.91\\n'" },
    ["user", "staff"]);
  try {
    const r = run(root);
    assert.equal(r.code, 0, `확률적 후보가 차단하면 안 된다: ${r.out}`);
    assert.match(r.out, /미결 후보: "staff" ↔ "user"/);
    assert.match(r.out, /차단하지 않는다/);
    assert.match(r.out, /재부상/); // 조용한 소실 없음
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("게이트: 후보가 registry·원장으로 결정되면 소멸 / 사유 없으면 판정 전 exit 1", () => {
  const resolved = run(fixture({
    synonymPolicy: "hard", entitySimilarityCommand: "printf 'user\\tstaff\\n'",
    synonymReviewLedger: { "staff::user": "직원 레코드와 로그인 계정은 다른 실체" },
  }, ["user", "staff"]));
  assert.equal(resolved.code, 0);
  assert.match(resolved.out, /미결 후보 0/);            // 헤더 집계는 항상 찍힌다(판정했음의 증거)
  assert.doesNotMatch(resolved.out, /⚠ 미결 후보:/);    // 결정된 쌍은 지적 라인에서 소멸
  assert.match(resolved.out, /기각 원장 1건/);

  const badLedger = run(fixture({ synonymPolicy: "advisory", synonymReviewLedger: { "a::b": "" } }, ["user"]));
  assert.equal(badLedger.code, 1);
  assert.match(badLedger.out, /기각 사유 필요/);
});

test("신선도 코어: 집합 지문은 순서·중복·대소문자 무관, 헤더 파싱, 낡음 판정", () => {
  const a = entitySetFingerprint(["user", "order"]);
  assert.deepEqual(a, entitySetFingerprint(["ORDER", " user ", "order"])); // 정규화·중복 제거
  assert.equal(a.count, 2);
  assert.notEqual(a.hash, entitySetFingerprint(["user", "order", "invoice"]).hash);
  assert.deepEqual(parseCandidateHeader("# entity-set: 34 ABC123def456\nuser\tmember\n"),
    { count: 34, hash: "abc123def456" });
  assert.equal(parseCandidateHeader("user\tmember\n"), null);
  assert.equal(candidateFreshness({ count: 2, hash: a.hash }, a), null);            // 최신
  assert.equal(candidateFreshness(null, a).kind, "undeclared");
  const st = candidateFreshness({ count: 9, hash: "deadbeefcafe" }, a);
  assert.equal(st.kind, "stale");
  assert.equal(st.declared.count, 9);
});

// 낡음은 결정적 사실이지만 **차단하지 않는다** — 막으면 entity를 추가할 때마다 LLM 세션이
// 커밋의 선행 조건이 되고, 사람은 ③을 통째로 떼어낸다(회피 유발 = 설계 실패).
test("게이트: 후보 목록 신선도 — 미선언/낡음/최신 3분기, 어느 쪽도 hard에서 차단하지 않음", () => {
  const cand = (body) => {
    const root = fixture({ synonymPolicy: "hard", entitySimilarityCommand: "cat cands.tsv" }, ["user", "order"]);
    writeFileSync(join(root, "cands.tsv"), body);
    return run(root);
  };
  const undecl = cand("user\torder\n");
  assert.equal(undecl.code, 0);
  assert.match(undecl.out, /신선도 미선언/);
  assert.match(undecl.out, /# entity-set: 2 [0-9a-f]{12}/); // 붙여넣을 값을 알려준다

  const stale = cand("# entity-set: 9 deadbeefcafe\nuser\torder\n");
  assert.equal(stale.code, 0, `낡음이 차단하면 안 된다: ${stale.out}`);
  assert.match(stale.out, /후보 목록이 낡았다/);
  assert.match(stale.out, /아직 아무도 보지 않았다/);

  const hash = /entity-set: 2 ([0-9a-f]{12})/.exec(undecl.out)[1];
  const okRun = cand(`# entity-set: 2 ${hash}\nuser\torder\n`);
  assert.equal(okRun.code, 0);
  assert.match(okRun.out, /신선도: 최신/);
  assert.doesNotMatch(okRun.out, /낡았다|미선언/);
});

test("게이트: 후보 생성기 실행 실패 → skipped(사유), '후보 없음'으로 오독 금지", () => {
  const r = run(fixture({ synonymPolicy: "hard", entitySimilarityCommand: "sdd-no-such-embedder" }, ["user"]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\[skipped\] 유사 후보 탐지/);
  assert.match(r.out, /판정 못 함/);
});

test("게이트: entity 역할 미해석 → inert(hard면 거짓 안전 차단) / enum 밖 정책 → exit 1", () => {
  const inert = run(fixture({ synonymPolicy: "hard", ownershipCategories: ["Widgets"] }, ["w1"]));
  assert.equal(inert.code, 1); assert.match(inert.out, /판정 불가\(inert\)/);
  const bad = run(fixture({ synonymPolicy: "strict" }, ["user"]));
  assert.equal(bad.code, 1); assert.match(bad.out, /synonymPolicy 값 위반/);
});
