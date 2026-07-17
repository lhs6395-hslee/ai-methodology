// ─── SPEC-018: 명세 폐기 계획 순수 코어 ──────────────────────────
// 파일 부작용 없음 — 계획 산출·텍스트 변환만. 커맨드(sdd-retire.mjs)가 IO를 감싼다.
// "누적이 아니라 정리·삭제": 필요 없어진 SPEC/FR을 지우고 참조(@covers·매니페스트·번호)를 재sync.

// target: "SPEC-001" | "SPEC-001/FR-003" → {specId, frId|null}
export function parseTarget(target) {
  const m = String(target || "").trim().match(/^([A-Z]+-\d{3})(?:\/((?:FR)-\d{3}[a-z]?))?$/);
  if (!m) return null;
  return { specId: m[1], frId: m[2] || null };
}

// FR-008(감사 P1): 폐기 대상 스펙을 가리키는 inbound 참조 수집(스펙 전체 폐기 시).
// 폐기 후 남으면 — 구조화 관계는 check-ownership hard(exit 1), Dedup-Review 언급은 dangling
// advisory — 삭제 커밋이 자기 게이트에 막힌다. 계획이 미리 지목해 같은 PR에서 갱신하게 한다.
//   specTexts: Map<specId, text>(전 코퍼스) · ownedKeys: 폐기 스펙의 aggregate-root 카테고리 소유
//   키 집합(소문자 정규화) · parseDeps(text): [{name,type}] — 커맨드가 relation 파서를 주입
//   (이 코어는 문법 비의존) · dedupBlock(text): Dedup-Review 섹션 본문|null.
export function inboundReferences(targetSpecId, ownedKeys, specTexts, parseDeps, dedupBlock) {
  const refs = [];
  const owned = new Set([...ownedKeys].map((k) => String(k).trim().toLowerCase()));
  for (const [sid, text] of specTexts) {
    if (sid === targetSpecId) continue;
    for (const { name, type } of parseDeps(text) || []) {
      if (type && owned.has(String(name).trim().toLowerCase())) {
        refs.push({ spec: sid, kind: "relation", detail: `${name} (${type})` });
      }
    }
    const block = dedupBlock(text);
    if (block && block.includes(targetSpecId)) refs.push({ spec: sid, kind: "dedup-review", detail: targetSpecId });
  }
  return refs.sort((a, b) =>
    a.spec.localeCompare(b.spec) || a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail));
}

// 폐기 계획 산출(FR-001·003·004). ctx는 커맨드가 코퍼스에서 뽑아 넘긴다:
//   frsBySpec: Map<specId, Set<frId>>  · specText: Map<specId, string>
//   coversIndex: [{file, spec, fr}]    · manifestKeys: [string "SPEC/FR"]  · deferredKeys: [string]
//   inboundRefs: inboundReferences() 결과(스펙 전체 폐기 시 — FR 단위 폐기엔 무관)
export function planRetirement(target, ctx) {
  const t = parseTarget(target);
  if (!t) return { ok: false, reason: `대상 형식 오류: "${target}" (SPEC-NNN 또는 SPEC-NNN/FR-NNN)` };
  if (!ctx.frsBySpec.has(t.specId)) return { ok: false, reason: `대상 없음(어느 스펙도 소유 안 함): ${t.specId}` };
  const frs = ctx.frsBySpec.get(t.specId);
  if (t.frId && !frs.has(t.frId)) return { ok: false, reason: `대상 없음: ${t.specId}/${t.frId} (스펙에 해당 FR 정의 없음)` };

  const removedKeys = new Set(
    (t.frId ? [t.frId] : [...frs]).map((fr) => `${t.specId}/${fr}`)
  );
  const match = (k) => removedKeys.has(k);

  return {
    ok: true,
    target: t,
    removals: t.frId ? [{ specId: t.specId, frId: t.frId }] : [{ specId: t.specId, whole: true }],
    danglingCovers: (ctx.coversIndex || []).filter((c) => match(`${c.spec}/${c.fr}`)),
    manifestKeys: (ctx.manifestKeys || []).filter(match),
    deferredKeys: (ctx.deferredKeys || []).filter(match),
    numberingGap: t.frId ? null : t.specId, // SPEC 폐기 시 그 번호가 gap(FR-006이 retiredIds로 정상 처리)
    inboundRefs: t.frId ? [] : (ctx.inboundRefs || []), // FR-008: 같은 PR에서 갱신할 참조 스펙
  };
}

// FR-002 적용 변환(순수) — 스펙 본문에서 `**FR-NNN** …` 선언 라인을 제거.
export function removeFrFromSpecText(text, frId) {
  const re = new RegExp(`^\\s*-?\\s*\\*\\*${frId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\*\\*.*(?:\\r?\\n|$)`, "m");
  return text.replace(re, "");
}

// FR-002 적용 변환(순수) — 매니페스트에서 폐기 키 제거(부작용 없이 새 객체).
export function pruneManifest(manifest, removedKeys) {
  const drop = new Set(removedKeys);
  const out = {};
  for (const [k, v] of Object.entries(manifest || {})) if (!drop.has(k)) out[k] = v;
  return out;
}
