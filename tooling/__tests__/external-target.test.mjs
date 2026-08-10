// 결정 입도(SPEC-044) — 소유는 파일 단위인데 동작을 정하는 결정은 파일 안에 있다.
// 실측 제보(2026-08-10): 소유·커버리지·spec-sync 전부 초록인 파일 안의 env 폴백 한 줄이
// 배포 대상을 정하고 있었고, 어떤 FR도 그 대상을 인정하지 않았다.
// @covers SPEC-044/FR-001
// @covers SPEC-044/FR-002
// @covers SPEC-044/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { envFallbacks, externalTargetKind, specKnowsTarget, externalTargetFindings, stripFullLineComments } from "../external-target-lib.mjs";

test("세 언어의 env 폴백 관용구를 읽는다 — 표현식 폴백은 정적으로 알 수 없어 판정하지 않는다", () => {
  assert.deepEqual(envFallbacks(`const a = process.env.BASE_URL || "https://a.vendor.io";`),
    [{ env: "BASE_URL", value: "https://a.vendor.io" }]);
  assert.deepEqual(envFallbacks(`x = os.environ.get("API_HOST", "api.vendor.io")`),
    [{ env: "API_HOST", value: "api.vendor.io" }]);
  assert.deepEqual(envFallbacks("URL=${ENDPOINT:-https://b.vendor.io}"),
    [{ env: "ENDPOINT", value: "https://b.vendor.io" }]);
  assert.deepEqual(envFallbacks(`const a = process.env.BASE_URL || DEFAULT_URL;`), []);
});

test("외부 대상만 계약이다 — 로컬·자리표시자 기본값은 계약이 아니다", () => {
  assert.equal(externalTargetKind("https://api.vendor.io"), "url");
  assert.equal(externalTargetKind("api.vendor.io"), "endpoint");
  assert.equal(externalTargetKind("arn:aws:s3:::bucket"), "arn");
  assert.equal(externalTargetKind("123456789012"), "account");
  for (const local of ["http://localhost:3000", "http://127.0.0.1", "https://example.com", "svc.local", "https://host.docker.internal:8080"]) {
    assert.equal(externalTargetKind(local), null, `로컬 기본값이 외부 대상으로 잡혔다: ${local}`);
  }
  for (const notTarget of ["info", "1.2.3", "true", "/var/run/x.sock", "utf-8"]) {
    assert.equal(externalTargetKind(notTarget), null, `외부 대상이 아닌 값이 잡혔다: ${notTarget}`);
  }
});

test("스펙이 호스트만 알아도 인정한다 — URL 통째 복붙을 요구하면 스펙이 코드의 사본이 된다", () => {
  assert.equal(specKnowsTarget("배포 대상은 api.vendor.io 이다", "https://api.vendor.io/v2/run"), true);
  assert.equal(specKnowsTarget("배포 대상은 사내 게이트웨이다", "https://api.vendor.io/v2/run"), false);
});

test("실측 재현 — 소유 스펙이 대상을 모르면 표면화, 알면 통과", () => {
  const text = `const BASE_URL = process.env.BASE_URL || "https://api.vendor.io";\n`;
  const blind = externalTargetFindings([{ path: "e2e/config.ts", text, specId: "SPEC-013", specText: "# S\n브라우저 측정 스펙\n" }]);
  assert.deepEqual(blind, [{ path: "e2e/config.ts", specId: "SPEC-013", env: "BASE_URL", value: "https://api.vendor.io", kind: "url" }]);
  assert.deepEqual(externalTargetFindings([{ path: "e2e/config.ts", text, specId: "SPEC-013", specText: "# S\nBASE_URL 미설정 시 api.vendor.io로 간다\n" }]), []);
});

test("미소유 파일은 판정하지 않는다 — 미소유는 R4(spec-sync)의 사실이다", () => {
  assert.deepEqual(externalTargetFindings([{ path: "x.ts", text: `process.env.U || "https://a.vendor.io"`, specId: null, specText: "" }]), []);
});

test("주석 속 예시는 인용이지 결정이 아니다 — 킷에 처음 걸었을 때 자기 설명 주석이 잡혔다", () => {
  assert.deepEqual(envFallbacks(`// 예: process.env.BASE_URL || "https://api.vendor.io"\n`), []);
  assert.deepEqual(envFallbacks(`# 예: os.getenv("H", "api.vendor.io")\n`), []);
});

test("줄 안쪽의 //는 자르지 않는다 — 자르면 게이트가 정확히 봐야 할 자리에서 눈이 먼다", () => {
  assert.equal(stripFullLineComments(`const u = process.env.U || "https://a.vendor.io";`).includes("https://"), true);
  assert.deepEqual(envFallbacks(`  const u = process.env.U || "https://a.vendor.io";`),
    [{ env: "U", value: "https://a.vendor.io" }]);
});

test("같은 파일의 같은 폴백을 두 번 세지 않는다 — 건수가 부풀면 사람이 목록을 안 읽는다", () => {
  const text = `process.env.U || "https://a.vendor.io"\nprocess.env.U || "https://a.vendor.io"\n`;
  assert.equal(externalTargetFindings([{ path: "a.ts", text, specId: "S", specText: "" }]).length, 1);
});
