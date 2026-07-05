#!/usr/bin/env python3
# ─── SDD gates (Python 런타임판 — Node 불필요) ────────────────
# Node판 게이트 전체(check-fr-coverage·check-ownership·check-spec-cohesion·
# check-spec-completeness·check-spec-consistency·check-test-adequacy·
# check-orphan-surfaces·check-converge-drift·check-spec-sync·sdd-run)와 **동일 동작**.
# 같은 sdd.config.json을 읽는다. 의존성 0(표준 라이브러리만, Python 3.7+).
#
# 왜 존재하나: 게이트는 텍스트 파서일 뿐인데, 그걸 돌리려고 Python-only
# 프로젝트에 Node를 강요하면 "런타임을 특정"하는 셈이다. 그래서 가장 흔한 두
# 런타임(Node·Python)으로 동봉한다 — 프로젝트가 이미 가진 쪽을 쓰면 된다.
# 런타임 간 동작 차이는 "조용히 빠지는" 클래스를 만들므로 금지 —
# 패리티는 tooling/__tests__/sdd-gates-py.test.mjs가 회귀로 잡는다.
#
# Usage:
#   python sdd_gates.py fr [--strict]            # FR↔test 추적 + PREFIX 거버넌스
#   python sdd_gates.py ownership [--strict]      # 스펙 간 구조적 중복(dedup) + 키 정규화/형식
#   python sdd_gates.py cohesion [--strict]       # 입도(under-fragmentation)
#   python sdd_gates.py completeness [--strict]   # FR 있는 spec의 SC·인수조건 존재
#   python sdd_gates.py consistency [--strict]    # 선언 키의 본문 근거
#   python sdd_gates.py adequacy [--strict]       # @covers 파일의 단언 존재
#   python sdd_gates.py orphan [--strict]         # 스펙 없는 표면 파일(역방향 커버리지)
#   python sdd_gates.py converge [base] [--strict]# 코드만 변경·스펙 무변경 드리프트
#   python sdd_gates.py specsync [base] [--staged --message-file <p>]  # spec-first 강제(§5)
#   python sdd_gates.py run <stage>               # commands.<stage> 실행(언어무관 CI)

import json
import os
import re
import subprocess
import sys

# Node판 sdd-config.mjs DEFAULTS의 미러 — 값이 다르면 런타임 간 동작이 갈라진다.
DEFAULTS = {
    "specDir": "sdd/specs",
    "scanDirs": ["src", "tests"],
    "ignoreDirs": [
        "node_modules", ".next", "coverage", "dist", "build", "out",
        "target", "vendor", "__pycache__", ".venv", "venv", ".git",
        ".idea", ".gradle", "bin", "obj", "Pods", ".dart_tool",
    ],
    "testFileRegex": [r"\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$"],
    "ownershipCategories": ["Entities", "Surfaces", "Capabilities"],
    "assertionPatterns": [
        r"\b(expect|assert|assertEquals|assertThat|should)\b",
        r"\bt\.(Error|Fatal|Errorf|Fatalf)\b",
        r"\b(require|assert)\.",
    ],
    "surfaceGlobs": [],
    "maxKeysPerCategoryPerSpec": 4,
    "maxFRsPerSpec": 8,
    "maxAggregateRootsPerSpec": 1,
    "specSyncExemptGlobs": [],
    "specIdPrefixes": ["SPEC", "INFRA", "TEST"],
    "prefixRationale": {},
    "requirementIdPrefixes": ["FR"],
    "strictSpecs": [],
    "requireAccounting": False,
    "smokeManifest": None,
    "specSyncUnownedPolicy": "silent",
    "entityRegistry": {},
    "capabilityVerbs": [],
    "surfacePathParam": "{name}",
    "surfaceFormat": "http",
    "commands": {},
}

CRUD = ["create", "read", "update", "delete", "list"]
STANDARD_PREFIXES = {"SPEC", "INFRA", "TEST"}


def find_config(start):
    d = start
    while True:
        p = os.path.join(d, "sdd.config.json")
        if os.path.exists(p):
            return p
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def _alt(values, fallback):
    vals = values or fallback
    return "|".join(re.sub(r"[^A-Za-z0-9_]", "", str(p)) for p in vals)


def load_config():
    path = find_config(os.getcwd())
    user = {}
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                user = json.load(f)
        except Exception as e:  # noqa: BLE001
            print(f"✗ sdd.config.json 파싱 실패: {path}\n  {e}", file=sys.stderr)
            sys.exit(1)
    cfg = {**DEFAULTS, **user}
    cfg["commands"] = {**DEFAULTS["commands"], **user.get("commands", {})}
    cfg["__path"] = path
    cfg["__root"] = os.path.dirname(path) if path else os.getcwd()
    cfg["__testRegex"] = [re.compile(s) for s in cfg["testFileRegex"]]
    # spec ID 접두어 파생값(게이트 공통). ["SPEC","TEST"] → "SPEC|TEST"
    alt = _alt(cfg.get("specIdPrefixes"), DEFAULTS["specIdPrefixes"])
    cfg["__prefixes"] = cfg.get("specIdPrefixes") or DEFAULTS["specIdPrefixes"]
    cfg["__specId"] = re.compile(rf"(?:{alt})-\d{{3}}")
    # 요구 ID 접두어 파생값 — 전 파싱 사이트(선언·집계·면제·@covers·spec-sync FR 라인)가
    # 이 한 곳의 문법을 공유한다(Node sdd-config.mjs와 동일 파생).
    req_alt = _alt(cfg.get("requirementIdPrefixes"), DEFAULTS["requirementIdPrefixes"])
    cfg["__reqAlt"] = req_alt
    cfg["__frDecl"] = re.compile(rf"\*\*((?:{req_alt})-\d{{3}}[a-z]?)\*\*")
    cfg["__frToken"] = re.compile(rf"\b(?:{req_alt})-\d{{3}}[a-z]?\b")
    # 서픽스는 소문자 1자(FR-003a) — \b로 2자(FR-003ab) 절단 캡처 금지
    cfg["__covers"] = re.compile(rf"@covers\s+((?:{alt})-\d{{3}})/((?:{req_alt})-\d{{3}}[a-z]?)\b")
    cfg["__allVerbs"] = set(v.strip().lower() for v in CRUD + list(cfg.get("capabilityVerbs") or []))
    return cfg


def resolve(cfg, rel):
    return os.path.join(cfg["__root"], *[p for p in str(rel).split("/") if p])


def rel_from_root(cfg, path):
    return path.replace(cfg["__root"] + os.sep, "")


def is_test_file(name, cfg):
    return any(rx.search(name) for rx in cfg["__testRegex"])


def walk_files(root, cfg):
    ignore = set(cfg["ignoreDirs"])
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in ignore)  # 순회 순서 결정성
        for name in sorted(filenames):
            yield os.path.join(dirpath, name)


def walk_tests(root, cfg):
    for p in walk_files(root, cfg):
        if is_test_file(os.path.basename(p), cfg):
            yield p


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def spec_md_files(cfg, missing_fatal=True):
    spec_dir = resolve(cfg, cfg["specDir"])
    try:
        names = sorted(os.listdir(spec_dir))
    except FileNotFoundError:
        if missing_fatal:
            print(f"✗ spec 디렉토리를 찾을 수 없음: {spec_dir}", file=sys.stderr)
            sys.exit(1)
        return []
    return [os.path.join(spec_dir, n) for n in names if n.endswith(".md")]


def cfg_tag(cfg):
    return rel_from_root(cfg, cfg["__path"]) if cfg["__path"] else "defaults(JS/TS)"


# ── 키 파이프라인 (ownership-keys.mjs 패리티) ─────────────────

def parse_section(text, heading, categories):
    """`## <heading>` 섹션을 카테고리별 키 배열로. 헤더 다음~다음 ## 전까지."""
    m = re.search(rf"^##\s+{heading}\b", text, re.MULTILINE)
    out = {c: [] for c in categories}
    if not m:
        return out
    after = text[m.start():]
    body = after[after.index("\n") + 1:]
    nxt = re.search(r"^##\s", body, re.MULTILINE)
    block = body[: nxt.start()] if nxt else body
    for cat in categories:
        line = re.search(rf"-\s*\*\*{re.escape(cat)}\*\*\s*:\s*([^\n]+)", block, re.IGNORECASE)
        if line:
            keys = [k.strip() for k in line.group(1).split(",")]
            out[cat] = [k for k in keys if k and k != "—" and k != "[…]" and not k.startswith("[")]
        else:
            out[cat] = []
    return out


def normalize_key(category, raw, cfg):
    s = str(raw).strip()
    if category == "Surfaces":
        style = cfg.get("surfaceFormat") or "http"
        if style != "http":
            # 파일경로/자유형 Surface — 소문자 + trailing slash 제거(HTTP METHOD 파싱 안함).
            return re.sub(r"/+$", "", s.lower()) or s.lower()
        m = re.match(r"^(\S+)\s+(.+)$", s)
        if not m:
            return s.lower()
        method = m.group(1).upper()
        spp = cfg["surfacePathParam"]
        param_repl = spp.replace("name", r"\1") if "name" in spp else r"{\1}"
        path = re.sub(r"[:{<]([a-z0-9_-]+)[>}]?", param_repl, m.group(2).lower())
        path = re.sub(r"/+$", "", path) or "/"
        return f"{method} {path}"
    # Entity·Capability = 소문자 + 내부 공백 정리
    return re.sub(r"\s+", " ", s.lower())


def validate_key(category, key, cfg):
    if category == "Capabilities":
        parts = key.split(".")
        if len(parts) != 2:
            return f'Capability는 entity.verb 형식(점 1개)이어야 함: "{key}"'
        if parts[1] not in cfg["__allVerbs"]:
            return f'미등록 verb "{parts[1]}" — capabilityVerbs에 등록 필요: "{key}"'
        return None
    if category == "Surfaces":
        style = cfg.get("surfaceFormat") or "http"
        if style == "any":
            return None
        if style == "path":
            return None if re.match(r"^[\w.\-/\[\]@*]+$", key) \
                else f'Surface(path)는 공백 없는 파일경로 형식이어야 함: "{key}"'
        if not re.match(r"^[A-Z]+ \S", key) and not re.match(r"^(event|job):", key):
            return f'Surface는 "<METHOD> <path>" 또는 "event:/job:" 형식이어야 함: "{key}"'
        return None
    return None  # Entity는 형식 제약 없음(스키마 식별자 그대로)


# ── 검증 회계 (verification-accounting.mjs 패리티, SPEC-007) ──

def load_manifest(cfg, specs):
    """smokeManifest 로드+검증. 미설정 → (None, []). 반환: (entries, errors)."""
    if not cfg.get("smokeManifest"):
        return None, []
    rel = str(cfg["smokeManifest"])
    path = resolve(cfg, rel)
    try:
        raw = read_text(path)
    except OSError:
        return None, [f"M0 smokeManifest 파일 없음: {rel}"]
    try:
        data = json.loads(raw)
    except ValueError as e:
        return None, [f"M0 smokeManifest JSON 파싱 실패: {rel} — {e}"]
    if not isinstance(data, dict):
        return None, [f"M0 smokeManifest 최상위는 객체여야 함: {rel}"]

    alt = _alt(cfg.get("specIdPrefixes"), DEFAULTS["specIdPrefixes"])
    key_re = re.compile(rf"^((?:{alt})-\d{{3}})/((?:{cfg['__reqAlt']})-\d{{3}}[a-z]?)$")
    errors = []
    entries = {}
    for key in data.keys():
        m = key_re.match(key)
        if not m:
            errors.append(f'M1 manifest 키 형식 위반 "{key}" — "SPEC-NNN/FR-NNN" 형식이어야 함')
            continue
        spec, fr = m.group(1), m.group(2)
        if spec not in specs or fr not in specs[spec]:
            errors.append(f'M1 dangling manifest 키 "{key}" — no such FR')
            continue
        v = data[key]
        method = str((v or {}).get("method") or "").strip() if isinstance(v, dict) else ""
        if not method:
            errors.append(f'M2 "{key}": method 없음(빈 값 불가)')
            continue
        if method == "deferred":
            if not str(v.get("reason") or "").strip():
                errors.append(f'M2 "{key}": method=deferred는 reason 필수(빈 값 불가)')
                continue
        elif not str(v.get("evidence") or "").strip():
            errors.append(f'M2 "{key}": evidence 필수(빈 값 불가 — 존재만 강제, 질은 리뷰 몫)')
            continue
        entries[key] = {"method": method}
    return entries, errors


def classify_accounting(specs, covered, entries):
    """FR별 분류(unit > smoke > deferred > unaccounted) + 카운트."""
    classes = {}
    counts = {"unit": 0, "smoke": 0, "deferred": 0, "unaccounted": 0}
    for spec, frs in specs.items():
        for fr in frs:
            key = f"{spec}/{fr}"
            cls = "unaccounted"
            if fr in covered.get(spec, set()):
                cls = "unit"  # unit이 manifest보다 우선
            elif entries is not None and key in entries:
                cls = "deferred" if entries[key]["method"] == "deferred" else "smoke"
            classes[key] = cls
            counts[cls] += 1
    return classes, counts


# ── fr — FR↔test 추적 + PREFIX 거버넌스 (check-fr-coverage.mjs) ──

def cmd_fr(cfg, strict):
    root = cfg["__root"]
    spec_dir = resolve(cfg, cfg["specDir"])
    try:
        spec_names = sorted(os.listdir(spec_dir))
    except FileNotFoundError:
        spec_names = []

    # 0. PREFIX 화이트리스트 사전 검사 — 미등록 접두어는 조용히 건너뛰지 않고 exit 1.
    allowed = set(cfg["__prefixes"])
    rationale = cfg.get("prefixRationale") or {}
    prefix_errors = []
    for f in spec_names:
        m = re.match(r"^([A-Z]+)-\d{3}", f)
        if not f.endswith(".md") or not m:
            continue
        pfx = m.group(1)
        if pfx not in allowed:
            prefix_errors.append(
                f'미등록 접두어 "{pfx}" ({f}) — 표준 SPEC/INFRA/TEST. 임의 생성 금지, '
                f"필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가")
        elif pfx not in STANDARD_PREFIXES and not str(rationale.get(pfx, "")).strip():
            prefix_errors.append(f'표준 밖 접두어 "{pfx}" — prefixRationale["{pfx}"]에 도입 사유 필요(빈 값 불가)')
    if prefix_errors:
        print("✗ PREFIX 위반:", file=sys.stderr)
        for e in prefix_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    # 1. spec별 선언 FR 수집.
    specs = {}  # SPEC-ID -> set(FR-ID)
    for f in spec_names:
        if not (f.endswith(".md") and any(f.startswith(p + "-") for p in cfg["__prefixes"])):
            continue
        m = cfg["__specId"].search(f)
        if not m:
            continue
        text = read_text(os.path.join(spec_dir, f))
        specs[m.group(0)] = set(cfg["__frDecl"].findall(text))

    # 2. 테스트 파일의 @covers 수집.
    covered = {}
    bad_refs = []
    for scan in cfg["scanDirs"]:
        for file in walk_tests(resolve(cfg, scan), cfg):
            text = read_text(file)
            for spec, fr in cfg["__covers"].findall(text):
                covered.setdefault(spec, set()).add(fr)
                if spec not in specs or fr not in specs[spec]:
                    bad_refs.append((file, spec, fr))

    errors, warnings = [], []
    for file, spec, fr in bad_refs:
        errors.append(f"R1 dangling @covers {spec}/{fr} in {rel_from_root(cfg, file)} — no such FR in {spec}")

    # 3b. 검증 회계(SPEC-007): smokeManifest 로드·검증 + strictSpecs 검증.
    #     manifest 미설정 && requireAccounting=false && strictSpecs=[] → 현행 동작(출력 동일).
    manifest, manifest_errors = load_manifest(cfg, specs)
    errors.extend(manifest_errors)
    strict_specs = set(cfg.get("strictSpecs") or [])
    for sid in sorted(strict_specs):
        if sid not in specs:
            errors.append(f'strictSpecs에 존재하지 않는 spec "{sid}" — 오타/삭제 확인(조용한 스킵 금지)')
    accounting_active = manifest is not None or bool(cfg.get("requireAccounting"))
    acct_classes, acct_counts = (classify_accounting(specs, covered, manifest)
                                 if accounting_active else (None, None))

    for spec, frs in specs.items():
        cov = covered.get(spec, set())
        hard = strict or spec in strict_specs
        label = "R2(strict)" if strict else "R2(strictSpecs)"
        if not cov:
            msg = f"{spec}: 0/{len(frs)} FRs covered (not yet implemented)"
            if hard and frs:
                errors.append(f"{label} {msg}")
            else:
                warnings.append(msg)
            continue
        missing = sorted(fr for fr in frs if fr not in cov)
        if missing:
            msg = f"{spec}: {len(cov)}/{len(frs)} FRs covered — missing {', '.join(missing)}"
            (errors if hard else warnings).append(f"{label} {msg}" if hard else msg)
        else:
            warnings.append(f"{spec}: {len(cov)}/{len(frs)} FRs covered ✓")

    # R3(requireAccounting): 모든 FR이 unit ∨ smoke ∨ deferred — "조용히 미검증" 제거.
    if cfg.get("requireAccounting"):
        for spec, frs in specs.items():
            for fr in sorted(frs):
                if acct_classes.get(f"{spec}/{fr}") == "unaccounted":
                    errors.append(f"R3 unaccounted {spec}/{fr} — unit·smoke·deferred 어느 것도 아님(requireAccounting)")

    total_fr = sum(len(s) for s in specs.values())
    total_cov = sum(len(s) for s in covered.values())
    mode = "strict" if strict else "incremental"
    acct_tag = (f" accounted(unit:{acct_counts['unit']} smoke:{acct_counts['smoke']}"
                f" deferred:{acct_counts['deferred']} unaccounted:{acct_counts['unaccounted']})"
                if accounting_active else "")
    print(f"FR coverage gate — specs:{len(specs)} FRs:{total_fr} covered:{total_cov}{acct_tag} mode:{mode} config:{cfg_tag(cfg)}")
    for w in warnings:
        print(f"  · {w}")
    if errors:
        print("\nFR coverage violations:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    print("FR coverage gate: OK")


# ── ownership — 구조적 중복 dedup + 정규화·형식검증 (check-ownership.mjs) ──

def cmd_ownership(cfg, strict):
    categories = cfg["ownershipCategories"]
    files = spec_md_files(cfg)

    owners = {c: {} for c in categories}
    missing, format_issues = [], []
    declared = 0
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        own = parse_section(text, "Ownership", categories)
        if not any(own[c] for c in categories):
            missing.append(spec_id)
            continue
        declared += 1
        for cat in categories:
            for raw in own[cat]:
                key = normalize_key(cat, raw, cfg)
                bad = validate_key(cat, key, cfg)
                if bad:
                    format_issues.append((spec_id, bad))
                owners[cat].setdefault(key, []).append(spec_id)
        # Dependencies 섹션은 참조일 뿐 dedup 대상이 아님(파싱만, 거짓양성 방지).

    conflicts = []
    for cat in categories:
        for key, specs in owners[cat].items():
            if len(specs) > 1:
                conflicts.append((cat, key, sorted(set(specs))))

    print(f"Ownership 게이트: spec {len(files)}개 중 {declared}개가 Ownership 선언.")
    if missing:
        tag = "✗" if strict else "⚠"
        print(f"{tag} Ownership 블록 없음({len(missing)}): {', '.join(missing)}")
    if format_issues:
        tag = "✗" if strict else "⚠"
        for spec_id, bad in format_issues:
            print(f"{tag} [{spec_id}] {bad}")
    if conflicts:
        print(f"\n✗ 중복 소유(구조적 중복) {len(conflicts)}건:", file=sys.stderr)
        for cat, key, specs in conflicts:
            print(f'  [{cat}] "{key}" ← {" + ".join(specs)}  → 한 spec으로 통합/개정 필요', file=sys.stderr)
        sys.exit(1)
    if strict and (missing or format_issues):
        if missing:
            print("\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.", file=sys.stderr)
        if format_issues:
            print("\n✗ --strict: 형식 위반이 있음 — 수정 필요.", file=sys.stderr)
        sys.exit(1)
    print(f"✓ 구조적 중복 없음 — 모든 {'/'.join(categories)} 키가 유일.")


# ── cohesion — 입도(under-fragmentation) (check-spec-cohesion.mjs) ──

def cmd_cohesion(cfg, strict):
    categories = cfg["ownershipCategories"]
    max_keys = cfg["maxKeysPerCategoryPerSpec"]
    max_frs = cfg["maxFRsPerSpec"]
    max_agg = cfg.get("maxAggregateRootsPerSpec", 1)
    ent_cat = next((c for c in categories if re.search("entit", c, re.IGNORECASE)), categories[0])
    files = spec_md_files(cfg)

    violations = []  # (spec_id, kind, n, max)
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        frs = len(set(cfg["__frToken"].findall(text)))
        if frs > max_frs:
            violations.append((spec_id, "FR", frs, max_frs))
        if re.search(r"^##\s+Ownership", text, re.MULTILINE):
            own = parse_section(text, "Ownership", categories)
            if own.get(ent_cat) and len(own[ent_cat]) > max_agg:
                violations.append((spec_id, f"{ent_cat}(aggregate)", len(own[ent_cat]), max_agg))
            for cat in categories:
                if len(own[cat]) > max_keys:
                    violations.append((spec_id, cat, len(own[cat]), max_keys))

    print(f"Spec 입도(cohesion) 게이트: spec {len(files)}개 검사 (키>{max_keys}/카테고리, FR>{max_frs}).")
    if violations:
        tag = "✗" if strict else "⚠"
        print(f"{tag} 과대 spec(분할 권고) {len(violations)}건:")
        for spec_id, kind, n, mx in violations:
            if "aggregate" in kind:
                print(f"  {tag} {spec_id}: {kind} {n}개 > {mx} — 여러 aggregate 삼킴 의심 → capability별 분할 검토")
            else:
                print(f"  {tag} {spec_id}: {kind} {n}개 > {mx} → capability별 분할 검토")
        if strict:
            print("\n✗ --strict: 과대 spec은 분할 필요.", file=sys.stderr)
            sys.exit(1)
        return
    print("✓ 모든 spec이 입도 기준 내 — 분할 권고 없음.")


# ── 수명주기 (lifecycle-lib.mjs 패리티, SPEC-008) ──

STATUS_ENUM = ["Draft", "Reviewed", "Approved", "Active", "Deprecated", "Removed"]
_REVIEWED_PLUS = {"Reviewed", "Approved", "Active"}


def parse_status(text):
    m = re.search(r"\*\*Status\*\*\s*:\s*([A-Za-z]+)", text)
    return m.group(1) if m else None


def is_reviewed_plus(status):
    return status in _REVIEWED_PLUS


def section_block(text, heading):
    m = re.search(rf"^##\s+{heading}\b", text, re.MULTILINE)
    if not m:
        return None
    after = text[m.start():]
    body = after[after.index("\n") + 1:]
    nxt = re.search(r"^##\s", body, re.MULTILINE)
    return body[: nxt.start()] if nxt else body


def has_review_log_entry(text):
    block = section_block(text, "Review Log")
    return block is not None and re.search(r"\d{4}-\d{2}-\d{2}", block) is not None


def has_dedup_review(text, spec_id_re):
    block = section_block(text, "Dedup-Review")
    if block is None:
        return False
    return spec_id_re.search(block) is not None or "이웃 없음" in block


# ── completeness — SC·인수조건·수명주기 기록 존재 (check-spec-completeness.mjs) ──

def cmd_completeness(cfg, strict):
    files = spec_md_files(cfg)
    findings = []
    enum = "|".join(STATUS_ENUM)
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        # 수명주기(SPEC-008) — FR 유무와 무관하게 전 spec 대상. Status 없는 레거시는 warn(점진 도입).
        status = parse_status(text)
        if status is None:
            findings.append((spec_id, f"Status 헤더(수명주기 상태) 없음 — {enum} 중 선언"))
        elif status not in STATUS_ENUM:
            findings.append((spec_id, f'미정의 Status "{status}" — {enum} 외 값 금지'))
        elif is_reviewed_plus(status):
            if not has_review_log_entry(text):
                findings.append((spec_id, f"Status {status}인데 Review Log 기록(일시·수행자·판정) 없음 — Reviewed 전이는 /analyze·/checklist 결과 기록 필수"))
            if not has_dedup_review(text, cfg["__specId"]):
                findings.append((spec_id, f'Status {status}인데 Dedup-Review 기록(검토한 이웃 스펙 ID+판정 또는 "이웃 없음") 없음'))
        if not set(cfg["__frToken"].findall(text)):
            continue  # FR 없는 spec은 면제(순수 인프라 등)
        if not set(re.findall(r"\bSC-\d{3}\b", text)):
            findings.append((spec_id, "SC(측정형 성공 기준) 없음"))
        if not (re.search(r"\b(Given|Acceptance)\b", text, re.IGNORECASE) or re.search(r"수용\s*기준", text)):
            findings.append((spec_id, "인수조건(Given-When-Then) 없음"))

    print(f"Spec 완전성 게이트: spec {len(files)}개 검사 (FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록 필요).")
    if findings:
        tag = "✗" if strict else "⚠"
        print(f"{tag} 완전성 미흡 {len(findings)}건:")
        for spec_id, miss in findings:
            print(f"  {tag} {spec_id}: {miss}")
        if strict:
            print("\n✗ --strict: FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록 필요.", file=sys.stderr)
            sys.exit(1)
        return
    print("✓ 완전성 구비 — SC·인수조건·수명주기 기록 모두 충족.")


# ── consistency — 선언 키의 본문 근거 (check-spec-consistency.mjs) ──

_STOP_TOKENS = {"post", "get", "put", "delete", "patch", "api", "event", "job"}


def _key_tokens(key):
    return [t for t in re.findall(r"[a-z][a-z0-9_]+", key.lower()) if t not in _STOP_TOKENS]


def cmd_consistency(cfg, strict):
    categories = cfg["ownershipCategories"]
    files = spec_md_files(cfg, missing_fatal=False)
    findings = []
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        own = parse_section(text, "Ownership", categories)
        h = re.search(r"^##\s+Ownership\b", text, re.MULTILINE)
        # ## Ownership 이전 본문만 근거 — 키가 자기 선언 줄로 근거되는 것을 방지.
        body = text[: h.start()] if h else text
        hay = body.lower()
        for cat in categories:
            for key in own[cat]:
                toks = _key_tokens(key)
                if toks and not any(t in hay for t in toks):
                    findings.append((spec_id, cat, key))

    print(f"Spec 일관성(advisory): spec {len(files)}개 검사 — 근거 없는 키 {len(findings)}건.")
    for spec_id, cat, key in findings:
        print(f'  ⚠ [{spec_id}] {cat} "{key}": 본문에 근거 토큰 없음 → FR과 정렬 확인')
    if findings and strict:
        print("\n✗ --strict: 근거 없는 키.", file=sys.stderr)
        sys.exit(1)
    print("일관성: advisory 경고(비차단)" if findings else "일관성: OK — 모든 키에 본문 근거.")


# ── adequacy — @covers 파일의 단언 존재 (check-test-adequacy.mjs) ──

def cmd_adequacy(cfg, strict):
    asserts = [re.compile(s) for s in cfg["assertionPatterns"]]
    offenders = []
    with_covers = 0
    for scan in cfg["scanDirs"]:
        for f in walk_tests(resolve(cfg, scan), cfg):
            text = read_text(f)
            if "@covers" not in text:
                continue
            with_covers += 1
            if not any(rx.search(text) for rx in asserts):
                offenders.append(rel_from_root(cfg, f))

    mode = "strict" if strict else "advisory"
    print(f"Test adequacy gate — @covers files:{with_covers} no-assertion:{len(offenders)} mode:{mode} config:{cfg_tag(cfg)}")
    for o in offenders:
        print(f"  · {o}: @covers 있으나 단언 없음(빈 껍데기 의심)")
    if offenders and strict:
        print("\n✗ test adequacy 위반(strict): 위 파일에 단언 추가 또는 @covers 제거", file=sys.stderr)
        sys.exit(1)
    print("Test adequacy gate: OK")


# ── orphan — 스펙 없는 표면 파일 (check-orphan-surfaces.mjs) ──

def cmd_orphan(cfg, strict):
    globs = [re.compile(s) for s in (cfg.get("surfaceGlobs") or [])]
    if not globs:
        print("Orphan-surface gate: surfaceGlobs 미설정 — no-op")
        return

    declared = set()
    for file in spec_md_files(cfg, missing_fatal=False):
        text = read_text(file)
        m = re.search(r"-\s*\*\*Surfaces\*\*\s*:\s*([^\n]+)", text, re.IGNORECASE)
        if m:
            for k in m.group(1).split(","):
                v = k.strip().lower()
                if v and not v.startswith("[") and v != "—":
                    declared.add(v)

    orphans = []
    surfaces = 0
    for p in walk_files(cfg["__root"], cfg):
        rel = rel_from_root(cfg, p)
        if not any(rx.search(rel) for rx in globs):
            continue
        surfaces += 1
        nrel = rel.strip().lower()
        claimed = any(d == nrel or d in nrel or nrel in d for d in declared)
        if not claimed:
            orphans.append(rel)

    mode = "strict" if strict else "advisory"
    print(f"Orphan-surface gate — surfaces:{surfaces} declared:{len(declared)} orphans:{len(orphans)} mode:{mode}")
    for o in orphans:
        print(f"  · {o}: 어떤 스펙 Ownership(Surfaces)에도 없음 → 스펙 누락 의심")
    if orphans and strict:
        print("\n✗ orphan-surface(strict): 표면을 소유하는 스펙 작성 또는 Ownership 등록", file=sys.stderr)
        sys.exit(1)
    print("Orphan-surface gate: OK")


# ── converge — 코드만 변경·스펙 무변경 드리프트 (check-converge-drift.mjs) ──

def _git(cfg, args):
    try:
        r = subprocess.run(["git"] + args, cwd=cfg["__root"], capture_output=True,
                           text=True, encoding="utf-8")
    except FileNotFoundError:
        return None
    return r.stdout if r.returncode == 0 else None


def _in_dir(p, d):
    d = d.rstrip("/")
    return p == d or p.startswith(d + "/")


def cmd_converge(cfg, strict, base):
    out = _git(cfg, ["diff", "--name-only", f"{base}...HEAD"])
    if out is None:
        print(f"· converge-drift: git diff({base}) 불가 — 건너뜀")
        return
    changed = [s.strip() for s in out.splitlines() if s.strip()]
    code_changed = [p for p in changed if any(_in_dir(p, d) for d in cfg["scanDirs"])]
    spec_changed = any(_in_dir(p, cfg["specDir"]) for p in changed)

    mode = "strict" if strict else "advisory"
    print(f"Converge-drift gate — base:{base} changed:{len(changed)} code:{len(code_changed)} "
          f"spec-changed:{str(spec_changed).lower()} mode:{mode}")
    if code_changed and not spec_changed:
        print(f"  · 코드 {len(code_changed)}건 변경인데 스펙 무변경 — /converge 로 갭 표면화 후 spec 갱신 검토")
        for p in code_changed[:10]:
            print(f"    - {p}")
        if strict:
            print("\n✗ converge-drift(strict): 스펙 동반 변경 또는 의도적 면제 필요", file=sys.stderr)
            sys.exit(1)
    print("Converge-drift gate: OK")


# ── specsync — spec-first 강제 §5 (check-spec-sync.mjs + spec-sync-lib.mjs) ──

def compile_glob(glob):
    """§4.1 지원 부분집합: **(0+ 경로 세그먼트)·*(세그먼트 내). anchored, 대소문자 구분."""
    out = ""
    i = 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out += "(?:[^/]+/)*"
            i += 3
        elif glob[i:] == "**":
            out += "(?:[^/]+/)*[^/]+"
            i = len(glob)
        elif glob[i] == "*":
            out += "[^/]*"
            i += 1
        else:
            out += re.sub(r"[.+?^${}()|\[\]\\]", lambda m: "\\" + m.group(0), glob[i])
            i += 1
    return re.compile(f"^{out}$")


def scan_files_line_issues(raw_line):
    """§4.1: 원시 `- **Files**:` 라인의 미지원 glob 문법 스캔(경고용)."""
    value = re.sub(r"^.*?\*\*Files\*\*\s*:", "", raw_line)
    issues = [ch for ch in ["{", "?"] if ch in value]
    if any(tok.strip().startswith("[") for tok in value.split(",")):
        issues.append("[")
    for tok in value.split(","):
        stripped = re.sub(r"\*\*$", "", tok.strip().replace("**/", ""))
        if "**" in stripped:
            issues.append("**")
            break
    return issues


def strip_inline_comment(value):
    return re.sub(r"\s+#.*$", "", value).strip()


def build_section_map(post_image):
    sections = []
    for i, l in enumerate(post_image.split("\n")):
        m = re.match(r"^#{2,3}\s+(.+?)\s*$", l)
        if m:
            sections.append((m.group(1), i + 1))  # 1-based
    return sections


def _section_at(sections, line_no):
    cur = None
    for name, start in sections:
        if start <= line_no:
            cur = name
        else:
            break
    return cur


def added_lines(diff_text):
    out = []
    ln = 0
    for l in diff_text.split("\n"):
        h = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", l)
        if h:
            ln = int(h.group(1))
            continue
        if l.startswith("+++") or l.startswith("---") or l.startswith("\\"):
            continue
        if l.startswith("+"):
            out.append((ln, l[1:]))
            ln += 1
        elif not l.startswith("-"):
            ln += 1  # context
    return out


def has_meaningful_spec_change(post_image, diff_text, req_alt="FR"):
    """§5.4 step 3 — FR 라인 +/-, Edge Cases·Change Log 항목 추가를 의미 변경으로 인정."""
    if re.search(rf"^[+-].*\*\*(?:{req_alt})-\d{{3}}[a-z]?\*\*", diff_text, re.MULTILINE):
        return True
    sections = build_section_map(post_image)
    for line, text in added_lines(diff_text):
        sec = _section_at(sections, line)
        if not sec:
            continue
        is_bullet = re.match(r"^\s*-\s+\S", text)
        is_table_row = re.match(r"^\s*\|", text) and not re.match(r"^\s*\|[\s:|-]+\|?\s*$", text)
        if (is_bullet or is_table_row) and re.search(r"(edge cases|change log)", sec, re.IGNORECASE):
            return True
    return False


def cmd_specsync(cfg, staged, msg_file, base):
    def lines(s):
        return [x.strip() for x in (s or "").split("\n") if x.strip()]

    # ① 트레일러(§5.5): staged 모드에서만.
    if staged and msg_file:
        msg = read_text(msg_file)
        m = re.search(r"^Spec-Impact:\s*none\s*(.*)$", msg, re.MULTILINE)
        if m:
            if not m.group(1).strip():
                print("✗ spec-sync: `Spec-Impact: none`은 사유 필수 (`Spec-Impact: none <사유>`)", file=sys.stderr)
                sys.exit(1)
            print(f"spec-sync: Spec-Impact: none — 통과 (사유: {m.group(1).strip()}) [트레일러가 커밋에 영속]")
            sys.exit(0)

    # ② 변경 파일 수집(§5.7): staged = cached ∪ base...HEAD / range = base...HEAD.
    branch_diff_ok = _git(cfg, ["rev-parse", "-q", "--verify", base]) is not None \
        and _git(cfg, ["diff", "--name-only", f"{base}...HEAD"]) is not None
    changed = set()
    if branch_diff_ok:
        changed.update(lines(_git(cfg, ["diff", "--name-only", f"{base}...HEAD"])))
    else:
        print(f"· spec-sync: base({base}) 해석 불가 — {'staged만 판정(경고)' if staged else '판정 불가, 건너뜀'}")
    if staged:
        changed.update(lines(_git(cfg, ["diff", "--cached", "--name-only"])))
    if not staged and not branch_diff_ok:
        sys.exit(0)

    # ③ 스펙 로드(§5.1): HEAD ∪ index 합집합(삭제 가시화).
    spec_paths = set(
        p for p in lines(_git(cfg, ["ls-files", "--", cfg["specDir"]])) +
        lines(_git(cfg, ["ls-tree", "-r", "--name-only", "HEAD", "--", cfg["specDir"]]))
        if p.endswith(".md"))
    specs = []  # (id, path, [(glob, re)], deleted_in_index)
    warned_glob_spec = set()
    for p in sorted(spec_paths):
        idx = _git(cfg, ["show", f":{p}"])
        head = _git(cfg, ["show", f"HEAD:{p}"])
        text = idx if idx is not None else (head or "")
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else p
        globs = set()
        for src in (idx, head):
            if not src:
                continue
            for raw in src.split("\n"):
                if re.match(r"^-\s*\*\*Files\*\*\s*:", raw):
                    issues = scan_files_line_issues(raw)
                    if issues and spec_id not in warned_glob_spec:
                        warned_glob_spec.add(spec_id)
                        print(f"⚠ [{spec_id}] Files에 미지원 glob 문법 {' '.join(issues)} — "
                              f"**·* 만 지원(§4.1), 해당 토큰은 매치되지 않을 수 있음")
            for g in parse_section(src, "Ownership", ["Files"])["Files"]:
                g = strip_inline_comment(g)
                if g:
                    globs.add(g)
        specs.append((spec_id, p, [(g, compile_glob(g)) for g in sorted(globs)],
                      idx is None and head is not None, parse_status(text)))

    # ④ 판정: 변경 코드 파일 → 소유 스펙(AND, §6.1) → 의미 변경(두-이미지 합집합, §5.4·§5.8).
    exempt = [compile_glob(g) for g in (cfg.get("specSyncExemptGlobs") or [])]
    spec_set = set(p for _, p, _, _, _ in specs)
    violations = []
    memo = {}

    def meaningful(spec_id, path, deleted):
        if path in memo:
            return memo[path]
        ok = False
        if deleted:
            print(f"⚠ [{spec_id}] 스펙 파일 삭제 — 의미 변경으로 인정(수명주기 리뷰 대상)")
            ok = True
        if not ok and staged:
            d = _git(cfg, ["diff", "--cached", "--", path])
            post = _git(cfg, ["show", f":{path}"])
            if d and post and has_meaningful_spec_change(post, d, cfg["__reqAlt"]):
                ok = True
        if not ok and branch_diff_ok:
            d = _git(cfg, ["diff", f"{base}...HEAD", "--", path])
            post = _git(cfg, ["show", f"HEAD:{path}"])
            if d and post and has_meaningful_spec_change(post, d, cfg["__reqAlt"]):
                ok = True
        memo[path] = ok
        return ok

    for f in sorted(changed):
        if f in spec_set or f.startswith(cfg["specDir"] + "/"):
            continue  # 스펙 자신은 코드 아님
        if any(rx.match(f) for rx in exempt):
            print(f"· exempt: {f} (specSyncExemptGlobs — 영속 흔적 없음)")
            continue
        for spec_id, path, globs, deleted, status in specs:
            if not any(rx.match(f) for _, rx in globs):
                continue
            # Draft 차단(SPEC-008): Draft 스펙의 소유 코드는 스펙 동반 여부와 무관하게 위반 —
            # 상태 순서 강제(리뷰 후 Reviewed 이상으로 승격이 정공법). 삭제 중 스펙은 제외(수명 종료 경로).
            if status == "Draft" and not deleted:
                violations.append((f, spec_id, True))
                continue
            if not meaningful(spec_id, path, deleted):
                violations.append((f, spec_id, False))

    # ⑤ 리포트.
    mode = "staged(hard)" if staged else f"range(advisory, base:{base})"
    print(f"spec-sync 게이트 — mode:{mode} changed:{len(changed)} specs:{len(specs)}")
    if not violations:
        print("spec-sync: OK — 소유 코드 변경에 스펙 동반됨(또는 대상 없음).")
        sys.exit(0)
    for f, spec_id, draft in violations:
        tag = "✗" if staged else "⚠"
        if draft:
            print(f"  {tag} {f} → 소유 스펙 {spec_id}이 Draft 상태 — Reviewed 이상 승격 전 코드 변경 금지")
        else:
            print(f"  {tag} {f} → 소유 스펙 {spec_id}에 의미 있는 변경 없음(FR/Edge Cases/Change Log)")
    if staged:
        print("\n✗ spec-first 위반: 소유 스펙을 같은 changeset에 갱신하라 — /speckit.fix 사용.", file=sys.stderr)
        print("  · 스펙을 이미 수정했다면 `git add`로 스테이징했는지 확인(§6.2).", file=sys.stderr)
        if any(d for _, _, d in violations):
            print("  · Draft 스펙은 리뷰(/analyze·/checklist) 기록 후 Status를 Reviewed 이상으로 승격해야 코드 변경 가능(SPEC-008).", file=sys.stderr)
        print("  · 진짜 스펙 무관이면 커밋 메시지에 `Spec-Impact: none <사유>` 트레일러.", file=sys.stderr)
        sys.exit(1)
    print("spec-sync: advisory — '/sdd-sync' 또는 /speckit.fix로 정렬 검토.")


# ── run — commands.<stage> 실행 ──────────────────────────────

def cmd_run(cfg, stage):
    cmd = cfg["commands"].get(stage)
    if not cmd:
        print(f"· sdd-run: '{stage}' 명령 미설정 — 건너뜀")
        return
    print(f"▶ sdd-run {stage}: {cmd}")
    r = subprocess.run(cmd, shell=True, cwd=cfg["__root"])
    if r.returncode != 0:
        print(f"✗ sdd-run {stage} 실패 (exit {r.returncode})", file=sys.stderr)
        sys.exit(r.returncode)


USAGE = "usage: python sdd_gates.py <fr|ownership|cohesion|completeness|consistency|adequacy|orphan|converge|specsync|run> [...]"


def main():
    args = sys.argv[1:]
    if not args:
        print(USAGE, file=sys.stderr)
        sys.exit(2)
    sub = args[0]
    strict = "--strict" in args
    cfg = load_config()
    positional = []
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--message-file":
            i += 2
            continue
        if not a.startswith("--"):
            positional.append(a)
        i += 1
    base_default = os.environ.get("SDD_DIFF_BASE", "origin/main")

    if sub == "fr":
        cmd_fr(cfg, strict)
    elif sub == "ownership":
        cmd_ownership(cfg, strict)
    elif sub == "cohesion":
        cmd_cohesion(cfg, strict)
    elif sub == "completeness":
        cmd_completeness(cfg, strict)
    elif sub == "consistency":
        cmd_consistency(cfg, strict)
    elif sub == "adequacy":
        cmd_adequacy(cfg, strict)
    elif sub == "orphan":
        cmd_orphan(cfg, strict)
    elif sub == "converge":
        cmd_converge(cfg, strict, positional[0] if positional else base_default)
    elif sub == "specsync":
        staged = "--staged" in args
        msg_file = None
        if "--message-file" in args:
            mi = args.index("--message-file")
            msg_file = args[mi + 1] if mi + 1 < len(args) else None
        cmd_specsync(cfg, staged, msg_file, positional[0] if positional else base_default)
    elif sub == "run":
        if len(args) < 2:
            print("usage: python sdd_gates.py run <stage>", file=sys.stderr)
            sys.exit(2)
        cmd_run(cfg, args[1])
    else:
        print(f"unknown subcommand: {sub}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
