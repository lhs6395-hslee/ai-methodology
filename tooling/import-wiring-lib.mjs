// tooling/import-wiring-lib.mjs
// 배선 무결성 순수 코어 (SPEC-050) — **설치된 게이트가 애초에 로드될 수 있는가.**
//
// 실측 제보(2026-08-10, 소비 프로젝트 자기적용): `update.md` 2~3단계의 diff를 "내용 다른 파일"
// 기준으로 훑었더니 **공유 lib 27개가 누락**됐고, 그중 `ownership-keys.mjs`를 빠뜨린 결과
// `check-spec-consistency.mjs`가 판정이 아니라 이것을 냈다:
//     SyntaxError: The requested module './ownership-keys.mjs'
//                  does not provide an export named 'bodyBeforeOwnership'
// 게이트 코드는 최신이고 lib은 구판이었다 — **부분 동기화**다. 파일이 없는 것도 아니어서
// 복사 목록 검사(SPEC-004 전이 폐포 계약)로도 잡히지 않는다: 그 계약은 *파일이 배포되는가*를
// 보고, 이 결함은 *배포된 파일이 요구된 export를 갖는가*다. 한 칸 더 안쪽이다.
//
// 이 축이 필요한 이유는 결함의 **표면 형태**에 있다. 크래시한 게이트는 스윕에서 `UNTYPED`로
// 계상되므로 침묵은 아니다(SPEC-040이 이미 막았다). 그런데 UNTYPED는 "판정 종류를 선언하지
// 않았다"는 사실만 말하고, 원인이 *부분 동기화*라는 것은 말하지 못한다 — 사람이 스택을 읽어야
// 한다. **정적으로 결정 가능한 것을 사람에게 맡기지 않는다**: import 그래프의 무결성은 아무
// 게이트를 실행하지 않고도 판정된다.
//
// 세 결과를 각각 다른 사실로 낸다 — "확인 못 함"을 "통과"로 접으면 이 축의 존재 이유가 사라진다:
//   · **파일 없음**    — 복사 목록 누락. 소비처는 `ERR_MODULE_NOT_FOUND`를 받는다.
//   · **export 없음**  — 부분 동기화. 제보의 결함이 이것이다. 소비처는 `SyntaxError`를 받는다.
//   · **확인 못 함**   — 파서가 모델하지 않는 export 형태(비-로컬 `export * from` 등).
//                       위반이 아니고 clean도 아니다. 매 실행 표면화되고 차단하지 않는다.
//
// 파서 오탐은 이 축의 사망 원인이다("오탐이 잦은 게이트는 꺼진다"). 그래서 킷 전체를 교정
// 집합으로 재고 도입했다 — **명명 import 456건 대조, 오탐 0건·미모델 구문 0건**. 모델하지 못한
// 구문을 만나면 위반이라 부르지 않고 위 세 번째 갈래로 자백한다.
//
// 순수 함수(IO 없음) — 파일 읽기·경로 열거는 소비 게이트가 주입한다. Python 미러(SPEC-006).

// 주석 제거는 킷의 것을 **재사용한다**(SPEC-044) — 새로 구현하면 R13이 잡는 중복이고, 규칙이
// 두 곳에 생기면 한쪽만 고쳐진다. 실측: 이 축을 처음 돌렸을 때 유일한 발견이 **이 파일 68행의
// 주석**(`import "./x.mjs"` 예시)이었다 — "주석 속 예시는 인용이지 결정이 아니다"가 여기서도 참이다.
import { stripFullLineComments } from "./external-target-lib.mjs";

// 판정 대상 확장자의 킷 기본값. `null` config는 "킷 기본을 쓴다"는 **선언**이다(SPEC-038 계열) —
// 게이트가 확장자를 코드에 고정하면 목록 밖 프로젝트에서 판정이 통째로 사라지고, 그 0건이
// 진짜 0건과 구분되지 않는다.
export const DEFAULT_WIRING_EXTENSIONS = Object.freeze(["mjs", "js"]);

// 로컬(상대 경로) import만이 이 축의 대상이다 — 패키지 import는 설치 관리자의 일이고,
// 부분 동기화로 깨지는 것은 **저장소 안에서 서로를 가리키는** 모듈들이다.
const LOCAL_SPEC = /^\.\.?\//;

// `a as b` 별칭 구분자와 네임스페이스 절 — import·export 양쪽에서 쓰이므로 한 곳에 둔다
// (R13이 이 파일 안의 중복 2건을 잡았다 — 같은 규칙이 두 곳에 있으면 한쪽만 고쳐진다).
const ALIAS_SPLIT = /\s+as\s+/;
const NAMESPACE_CLAUSE = /\*\s+as\s+[\w$]+/;

// ── import 절 파싱 ────────────────────────────────────────────────────────────
// 반환 [{ specifier, names, namespace, hasDefault }].
//   names: 명명 import(`{ a, b as c }` → ["a","b"] — **원본 이름**을 대조해야 한다)
//   namespace: `* as ns` (이름을 알 수 없어 파일 실재만 대조)
//   hasDefault: 기본 import(대상의 `export default` 유무로 대조)
export function localImports(text) {
  const out = [];
  const src = stripFullLineComments(text);
  // `import <절> from "<경로>"` — 절에 줄바꿈이 들어갈 수 있으므로 dotall.
  for (const m of src.matchAll(/\bimport\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
    const specifier = m[2];
    if (!LOCAL_SPEC.test(specifier)) continue;
    const clause = m[1];
    const names = [];
    const brace = clause.match(/\{([\s\S]*?)\}/);
    if (brace) {
      for (const raw of brace[1].split(",")) {
        const t = raw.trim();
        if (!t) continue;
        // `a as b` → 대상에 있어야 하는 것은 `a`다. `b`는 이 파일 안의 지역명이다.
        names.push(t.split(ALIAS_SPLIT)[0].trim());
      }
    }
    const namespace = NAMESPACE_CLAUSE.test(clause);
    // 기본 import — 중괄호·네임스페이스를 걷어낸 나머지에 식별자가 남으면 그것이다.
    const lead = clause.replace(/\{[\s\S]*?\}/, "").replace(NAMESPACE_CLAUSE, "").replace(/,/g, "").trim();
    out.push({ specifier, names, namespace, hasDefault: Boolean(lead) });
  }
  // 부작용 import(`import "./x.mjs"`) — 이름은 없지만 파일 실재는 대조 대상이다.
  for (const m of src.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    if (!LOCAL_SPEC.test(m[1])) continue;
    out.push({ specifier: m[1], names: [], namespace: false, hasDefault: false });
  }
  return out;
}

// ── export 집합 파싱 ──────────────────────────────────────────────────────────
// 반환 { names:Set, starFrom:[specifier], unmodeled:[구문] }.
//   starFrom: `export * from "<로컬>"` — 호출부가 따라가 합집합을 만든다.
//   unmodeled: 파서가 export 이름을 확정할 수 없는 형태. 있으면 그 대상은 **확인 못 함**이다.
export function moduleExports(text) {
  // 여기서도 주석을 걷는다 — 주석 속 `export function foo`가 유령 export로 잡히면 그것은
  // **거짓 음성**(없는 export를 있다고 읽어 위반을 놓친다)이고, 그쪽이 오탐보다 나쁘다.
  const src = stripFullLineComments(text);
  const names = new Set();
  const starFrom = [];
  const unmodeled = [];
  // ⚠ `^export`로 **앵커하지 않는다.** 앵커하면 `const x = 1; export { x };` 같은 문장 중간
  // 선언을 놓치고, 놓친 export는 "없다"로 읽혀 **오탐**(있는 export를 없다고 차단)이 된다.
  // 대신 문장 경계(`;`·`}`·줄머리)를 요구해 `myexport`·`reexport` 같은 식별자와는 갈린다.
  const AT = "(?:^|[;}]\\s*)";
  for (const m of src.matchAll(new RegExp(`${AT}export\\s+(?:async\\s+)?function\\s*\\*?\\s*([\\w$]+)`, "gm"))) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(`${AT}export\\s+class\\s+([\\w$]+)`, "gm"))) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(`${AT}export\\s+(?:const|let|var)\\s+([\\w$]+)`, "gm"))) names.add(m[1]);
  // `export { a, b as c }` / `export { a } from "./x"` — 밖으로 나가는 이름은 별칭 쪽이다.
  for (const m of src.matchAll(new RegExp(`${AT}export\\s*\\{([\\s\\S]*?)\\}`, "gm"))) {
    for (const raw of m[1].split(",")) {
      const t = raw.trim();
      if (!t) continue;
      const parts = t.split(ALIAS_SPLIT);
      names.add((parts[1] || parts[0]).trim());
    }
  }
  for (const m of src.matchAll(new RegExp(`${AT}export\\s+\\*\\s*(?:as\\s+([\\w$]+)\\s*)?from\\s*["\']([^"\']+)["\']`, "gm"))) {
    if (m[1]) names.add(m[1]);                  // `export * as ns from …` — 이름 하나로 확정된다
    else if (LOCAL_SPEC.test(m[2])) starFrom.push(m[2]);
    else unmodeled.push(`export * from "${m[2]}"`); // 비-로컬 재수출 — 집합을 알 수 없다
  }
  if (new RegExp(`${AT}export\\s+default\\b`, "m").test(src)) names.add("default");
  // 구조분해 export — 이름이 패턴 안에 있어 신뢰할 만하게 뽑을 수 없다. 자백한다.
  for (const m of src.matchAll(new RegExp(`${AT}export\\s+(?:const|let|var)\\s*[[{]`, "gm"))) unmodeled.push(m[0].trim());
  return { names, starFrom, unmodeled };
}

// ── 판정 ──────────────────────────────────────────────────────────────────────
// entries: 판정 시작점(설치된 모듈 키 목록).
// read(key) → { text } | null  — 없으면 null. resolve(fromKey, specifier) → key.
// 둘 다 주입이다(IO·경로 규칙은 소비 게이트의 몫 — 이 코어는 순수하다).
//
// 전이적으로 걷는다: 게이트가 직접 import하지 않는 깊은 lib이 구판이어도 같은 결함이다.
export function wiringFindings(entries, read, resolve) {
  const violations = [];      // { kind:"missing-file"|"missing-export", from, specifier, name }
  const unchecked = [];       // { key, why }
  const visited = new Set();
  const exportsOf = new Map();

  // 대상의 export 집합(로컬 `export * from` 합집합 포함). 순환은 방문 집합으로 끊는다.
  const resolveExports = (key, seen = new Set()) => {
    if (exportsOf.has(key)) return exportsOf.get(key);
    if (seen.has(key)) return { names: new Set(), unresolved: [] };
    seen.add(key);
    const src = read(key);
    if (!src) return null;
    const ex = moduleExports(src.text);
    const names = new Set(ex.names);
    const unresolved = [...ex.unmodeled];
    for (const spec of ex.starFrom) {
      const child = resolveExports(resolve(key, spec), seen);
      if (!child) { unresolved.push(`export * from "${spec}" — 대상 파일 없음`); continue; }
      for (const n of child.names) names.add(n);
      unresolved.push(...child.unresolved);
    }
    const val = { names, unresolved };
    exportsOf.set(key, val);
    return val;
  };

  const stack = [...(entries || [])];
  while (stack.length) {
    const key = stack.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    const src = read(key);
    if (!src) continue;                       // 시작점이 없으면 열거기의 문제다(여기서 판정 안 함)
    for (const imp of localImports(src.text)) {
      const target = resolve(key, imp.specifier);
      const tex = resolveExports(target);
      if (!tex) {
        violations.push({ kind: "missing-file", from: key, specifier: imp.specifier, name: "" });
        continue;
      }
      stack.push(target);
      if (tex.unresolved.length) {
        // 이 대상은 export 집합을 확정할 수 없다 — **없다고 단정하지 않는다**(오탐 금지).
        for (const why of tex.unresolved) unchecked.push({ key: target, why });
        continue;
      }
      const wanted = [...imp.names];
      if (imp.hasDefault) wanted.push("default");
      for (const n of wanted) {
        if (!tex.names.has(n)) {
          violations.push({ kind: "missing-export", from: key, specifier: imp.specifier, name: n });
        }
      }
    }
  }
  // 같은 사실이 여러 경로로 중복 적재될 수 있다 — 한 사실은 한 줄이다.
  const seenV = new Set();
  const dedupV = violations.filter((v) => {
    const k = `${v.kind} ${v.from} ${v.specifier} ${v.name}`;
    if (seenV.has(k)) return false;
    seenV.add(k);
    return true;
  });
  const seenU = new Set();
  const dedupU = unchecked.filter((u) => {
    const k = `${u.key} ${u.why}`;
    if (seenU.has(k)) return false;
    seenU.add(k);
    return true;
  });
  const order = { "missing-file": 0, "missing-export": 1 };
  dedupV.sort((a, b) => (order[a.kind] - order[b.kind])
    || a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier) || a.name.localeCompare(b.name));
  dedupU.sort((a, b) => a.key.localeCompare(b.key) || a.why.localeCompare(b.why));
  return { violations: dedupV, unchecked: dedupU, walked: visited.size };
}

// import 폐포 — 진입점들에서 도달 가능한 로컬 모듈의 전체 집합(진입점 포함).
// readText(key) → 문자열 | null(못 읽으면 null). 순수하다(IO 주입).
//
// **왜 코어에 있어야 하는가**: 이 폐포는 킷 안에서 최소 세 곳이 필요하다 — 설치기 복사 목록,
// 테스트 픽스처 복사 목록, R18의 열거기. 손으로 적은 목록은 반드시 드리프트한다. 실측: 픽스처
// 복사 목록 6곳이 각자 손목록을 들고 있었고, 새 모듈 하나가 추가되자 5곳이 동시에
// ERR_MODULE_NOT_FOUND로 죽었다 — 소비 프로젝트가 제보한 "부분 동기화 crash"와 같은 결함이
// 킷 자신의 픽스처에서 재연된 것이다. 목록은 적는 것이 아니라 **계산하는 것**이다.
export function importClosure(entries, readText) {
  const seen = new Set();
  const stack = [...(entries || [])];
  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    let text = null;
    try { text = readText(key); } catch { text = null; }
    if (text == null) continue;                 // 못 읽은 것은 걷지 않는다(부재로 단정하지 않는다)
    for (const imp of localImports(text)) stack.push(imp.specifier.replace(/^\.\//, ""));
  }
  return [...seen];
}

// 사람이 읽는 한 줄. 원인과 **해소 방법**을 같이 낸다 — 이 결함의 해소는 언제나 "그 파일을
// 정본에서 다시 복사"이므로, 게이트가 그 문장을 대신 말해주면 사람이 스택을 읽지 않아도 된다.
export function formatWiringViolation(v) {
  if (v.kind === "missing-file") {
    return `${v.from} → \`${v.specifier}\` 파일이 없다 — 복사 목록 누락(소비처는 게이트 대신 ERR_MODULE_NOT_FOUND를 받는다)`;
  }
  return `${v.from} → \`${v.specifier}\`에 export \`${v.name}\`가 없다 — **부분 동기화**(게이트는 최신, lib은 구판). 정본에서 \`${v.specifier.replace(/^\.\//, "")}\`를 다시 복사하라`;
}
