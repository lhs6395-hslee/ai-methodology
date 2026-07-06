// @covers SPEC-016/FR-001
// @covers SPEC-016/FR-002
// @covers SPEC-016/FR-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { objectStorageFindings } from "../object-storage-lib.mjs";

const MARKERS = ["S3", "오브젝트 스토리지", "object storage", "bucket", "버킷"];
const DECISION = "\n## Object Storage Decision\n- **Bucket**: 신규 전용 버킷\n- **Consolidation**: 제품 버킷 생성 시 이전\n";

test("마커 매치 + 결정 섹션 없음 → 경고 1건(섹션 필요)", () => {
  const r = objectStorageFindings("본문에 S3 버킷이 필요하다.\n## Foo\nx\n", MARKERS);
  assert.equal(r.length, 1);
  assert.match(r[0], /Object Storage Decision/);
});

test("마커 매치 + 섹션 + Bucket·Consolidation 라벨 → 통과([])", () => {
  const r = objectStorageFindings("S3 필요.\n" + DECISION, MARKERS);
  assert.deepEqual(r, []);
});

test("섹션은 있으나 Consolidation 라벨 결손 → 경고(누락 라벨 지목)", () => {
  const r = objectStorageFindings("object storage 씀.\n## Object Storage Decision\n- **Bucket**: 기존 네임스페이스\n", MARKERS);
  assert.equal(r.length, 1);
  assert.match(r[0], /Consolidation/);
  assert.doesNotMatch(r[0], /\bBucket 라벨\b/); // Bucket은 있음
});

test("마커 미매치 → 무관([])", () => {
  const r = objectStorageFindings("이 스펙은 순수 계산 로직만 다룬다.\n", MARKERS);
  assert.deepEqual(r, []);
});

test("markers=[] → 검사 비활성([])", () => {
  const r = objectStorageFindings("S3 버킷 잔뜩 쓴다. 섹션 없음.\n", []);
  assert.deepEqual(r, []);
});

test("마커 대소문자 무시 매치", () => {
  const r = objectStorageFindings("we use object STORAGE here.\n", MARKERS);
  assert.equal(r.length, 1);
});

test("감사 섹션(Change Log·Review Log·Dedup-Review)의 마커 언급은 트리거 안 함 — 게이트 자기 서술 회피", () => {
  const t = "본문은 순수 로직만 다룬다.\n## Review Log\n| 2026 | r | PASS |\n## Change Log\n| 2026 | S3 오브젝트 스토리지 결정 게이트 배선 | x |\n";
  assert.deepEqual(objectStorageFindings(t, MARKERS), []);
});
