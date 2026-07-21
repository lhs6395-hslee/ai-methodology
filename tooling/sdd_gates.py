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
#   python sdd_gates.py derivation                 # 재도출 소스 회계(SPEC-009)
#   python sdd_gates.py smokescan [--write]        # smoke 증거 자동 수집(SPEC-010)
#   python sdd_gates.py retag <map.json> [--write] # 추적 태그 마이그레이션(SPEC-011)
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
    "specIdPrefixes": ["SPEC", "INFRA", "TEST", "CICD"],
    "prefixRationale": {},
    "prefixClassExemptions": {},
    "objectStorageMarkers": ["S3", "오브젝트 스토리지", "object storage", "bucket", "버킷", "blob storage", "GCS", "Cloud Storage"],
    "testInfraGlobs": [],
    "trackerCloseout": {},
    "requirementIdPrefixes": ["FR"],
    "strictSpecs": [],
    "requireAccounting": False,
    "smokeManifest": None,
    "smokeScanDirs": None,
    "derivationManifest": None,
    "derivationClassGlobs": {
        "iac": ["**/*.tf", "**/*.tfvars", "**/*.hcl",
                "k8s/**", "helm/**", "manifests/**", "**/kustomization.yaml", "**/kustomization.yml",
                "**/Dockerfile*", "**/.dockerignore", "**/docker-compose*", "**/compose.yml", "**/compose.yaml"],
        "ci": [".github/workflows/**", ".github/actions/**", ".gitlab-ci.yml", ".gitlab/ci/**",
               "**/Jenkinsfile*", ".circleci/**", "azure-pipelines*", "bitbucket-pipelines.yml",
               ".buildkite/**", "**/cloudbuild.yaml", "**/cloudbuild.yml", ".travis.yml", ".drone.yml"],
        "ops-docs": ["runbook*", "RUNBOOK*", "docs/runbook*", "docs/runbooks/**",
                     "docs/ops/**", "docs/operations/**", "ops/**"],
    },
    "specSyncUnownedPolicy": "silent",
    "specSyncBase": None,
    "draftBlockPolicy": "advisory",
    "entityRegistry": {},
    "relationTypes": [],
    "capabilityVerbs": [],
    "surfacePathParam": "{name}",
    "surfaceFormat": "http",
    "commands": {},
    "retiredIds": [],
    "semanticDriftPolicy": "advisory",
    "capabilityOwnershipPolicy": "advisory",
    "frKeyAnchorPolicy": "off",
    "frAnchorMarkers": {"entity": "E", "surface": "R", "capability": "C"},
    "runTestsPolicy": "off",
    "schemaDriftManifest": None,
    "migrationStatePolicy": "advisory",
    "entitySchemaSources": [],
    "entitySchemaBackingPolicy": "off",
    "entitySchemaExemptEntities": {},
}

CRUD = ["create", "read", "update", "delete", "list"]
STANDARD_PREFIXES = {"SPEC", "INFRA", "TEST", "CICD"}


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
    return _build_config(user, path, os.path.dirname(path) if path else os.getcwd())


def config_from_string(raw, root):
    """config JSON 문자열에서 동일 파생 규칙으로 구성 — specsync staged 판정을 HEAD 시점
    config로 내릴 때(자기약화 커밋 방지, SPEC-003 — sdd-config.mjs configFromString 미러).
    파싱 실패는 None(호출부가 폴백)."""
    try:
        return _build_config(json.loads(raw), None, root)
    except Exception:  # noqa: BLE001
        return None


def _build_config(user, path, root):
    cfg = {**DEFAULTS, **user}
    cfg["commands"] = {**DEFAULTS["commands"], **user.get("commands", {})}
    cfg["__path"] = path
    cfg["__root"] = root
    cfg["__testRegex"] = [re.compile(s) for s in cfg["testFileRegex"]]
    # spec ID 접두어 파생값(게이트 공통). ["SPEC","TEST"] → "SPEC|TEST"
    alt = _alt(cfg.get("specIdPrefixes"), DEFAULTS["specIdPrefixes"])
    cfg["__prefixes"] = cfg.get("specIdPrefixes") or DEFAULTS["specIdPrefixes"]
    cfg["__idAlt"] = alt
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


def classify_accounting(specs, covered, entries, planned_specs=None):
    """FR별 분류(unit > smoke > deferred > planned > unaccounted) + 카운트."""
    planned_specs = planned_specs or set()
    classes = {}
    counts = {"unit": 0, "smoke": 0, "deferred": 0, "planned": 0, "unaccounted": 0}
    for spec, frs in specs.items():
        for fr in frs:
            key = f"{spec}/{fr}"
            cls = "unaccounted"
            if fr in covered.get(spec, set()):
                cls = "unit"  # unit이 manifest보다 우선
            elif entries is not None and key in entries:
                cls = "deferred" if entries[key]["method"] == "deferred" else "smoke"
            elif spec in planned_specs:
                cls = "planned"  # SPEC-018: Planned 스펙의 미커버 FR = 의도적 미구현
            classes[key] = cls
            counts[cls] += 1
    return classes, counts


# ── fr — FR↔test 추적 + PREFIX 거버넌스 (check-fr-coverage.mjs) ──

def numbering_issues(spec_ids, retired_ids=None):
    """접두어별 spec-ID 번호 무결성 (SPEC-014, numbering-lib.mjs 미러 — 바이트 동일).
    hard: 중복 / 001 미시작. advisory: 실제 최소~최대 내부 gap. (hard, advisory) 반환.
    retired_ids: 폐기 기록된 spec-ID — 그 번호의 gap은 정상 retirement gap이라 제외(SPEC-018 FR-006)."""
    retired = {str(s).strip() for s in (retired_ids or [])}
    by_prefix = {}
    for sid in spec_ids or []:
        m = re.match(r"^([A-Z]+)-(\d{3})$", sid)
        if not m:
            continue
        by_prefix.setdefault(m.group(1), []).append(int(m.group(2)))
    hard, advisory = [], []
    for pfx in sorted(by_prefix):
        seen, dups = set(), set()
        for n in by_prefix[pfx]:
            (dups if n in seen else seen).add(n)
        for d in sorted(dups):
            hard.append(f"{pfx}-{d:03d} 번호 중복 — 같은 접두어·번호가 둘 이상(유일해야 함)")
        uniq = sorted(seen)
        if not uniq:
            continue
        # 폐기 ID 재사용(hard, SPEC-014 FR-004): 무신호 재사용 차단 — numbering-lib.mjs 미러(감사 M3).
        for n in uniq:
            if f"{pfx}-{n:03d}" in retired:
                hard.append(f"{pfx}-{n:03d} 폐기 ID 재사용 — retiredIds에 기록된 번호가 실재(과거 참조 앨리어싱). "
                            f"새 번호를 쓰거나, 의도적 재사용이면 retiredIds에서 제거")
        # 001 미시작 — 선행 번호가 전부 retiredIds면 정상 retirement gap(SPEC-014 FR-001 개정, 감사 M4).
        if uniq[0] != 1:
            leading_retired = all(f"{pfx}-{n:03d}" in retired for n in range(1, uniq[0]))
            if not leading_retired:
                hard.append(f"{pfx} 번호가 001부터 시작하지 않음 — 최소 {pfx}-{uniq[0]:03d} "
                            f"(접두어별 001 순차 규칙, SPEC-014). 재번호는 sdd-retag, 선행 번호가 폐기분이면 retiredIds에 기록")
        present, mx = set(uniq), uniq[-1]
        # retired에 기록된 번호는 정상 retirement gap이라 재보고하지 않음(SPEC-018 FR-006)
        missing = [n for n in range(uniq[0], mx + 1) if n not in present and f"{pfx}-{n:03d}" not in retired]
        if missing:
            joined = ", ".join(f"{pfx}-{n:03d}" for n in missing)
            advisory.append(f"{pfx} 번호 중간 gap: {joined} — 제거·retag 잔분(정상일 수 있음)")
    return hard, advisory


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
                f'미등록 접두어 "{pfx}" ({f}) — 표준 SPEC/INFRA/TEST/CICD. 임의 생성 금지, '
                f"필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가")
        elif pfx not in STANDARD_PREFIXES and not str(rationale.get(pfx, "")).strip():
            prefix_errors.append(f'표준 밖 접두어 "{pfx}" — prefixRationale["{pfx}"]에 도입 사유 필요(빈 값 불가)')
    # 0b. 접두어↔클래스 정합(SPEC-012): 소유(Files) 비-테스트 실파일이 **전적으로** iac/ci
    #     클래스인 스펙은 INFRA- 접두어여야 한다 — STORAGE §2.2의 접두어 의미(readopt 착지
    #     규칙 iac/ci→INFRA)를 기계 강제. 비-인프라 소유 파일이 하나라도 있으면 통과.
    exemptions = cfg.get("prefixClassExemptions") or {}
    spec_md_names = sorted(f for f in spec_names if f.endswith(".md") and re.match(r"^[A-Z]+-\d{3}", f))
    known_ids = set()
    for f in spec_md_names:
        m = cfg["__specId"].search(f)
        if m:
            known_ids.add(m.group(0))
    prefix_errors.extend(validate_prefix_class_exemptions(exemptions, known_ids))
    user_globs = cfg.get("derivationClassGlobs") or {}
    class_globs = {cls: [compile_glob(g) for g in (user_globs.get(cls) or DEFAULTS["derivationClassGlobs"][cls])]
                   for cls in INFRA_SOURCE_CLASSES}
    all_repo_files = walk_all_rel(root, cfg)
    test_infra_globs = [compile_glob(g) for g in (cfg.get("testInfraGlobs") or [])]  # SPEC-015
    prefix_class_warnings = []
    for f in spec_md_names:
        m = cfg["__specId"].search(f)
        if not m:
            continue  # 미등록 접두어는 위 0단계가 이미 에러 처리
        sid = m.group(0)
        pfx = re.match(r"^([A-Z]+)-", f).group(1)
        text = read_text(os.path.join(spec_dir, f))
        globs = [compile_glob(g) for g in
                 (strip_inline_comment(x) for x in parse_section(text, "Ownership", ["Files"])["Files"]) if g]
        owned = sorted(p for p in all_repo_files
                       if not is_test_file(os.path.basename(p), cfg) and any(rx.search(p) for rx in globs)) if globs else []
        finding = prefix_class_finding(pfx, owned, class_globs)
        exempted = bool(str(exemptions.get(sid) or "").strip())
        if finding and finding[0] == "error":
            if not exempted:
                infra = finding[1]
                prefix_errors.append(
                    f'접두어↔클래스 부정합 "{sid}" — 소유 실파일 {len(infra)}건 전부 인프라-계열(예: {infra[0]}) '
                    f'→ {"/".join(finding[3])}- 접두어여야 함(STORAGE §2.2: iac→INFRA·ci→CICD). 부수 소유가 정당하면 prefixClassExemptions["{sid}"]에 사유 등록')
            continue
        if exempted:
            prefix_class_warnings.append(f'prefixClassExemptions["{sid}"]: 현재 접두어↔클래스 위반 아님 — 선등록이 아니면 정리 대상')
        if finding and finding[0] == "warn":
            prefix_class_warnings.append(f"{sid}: {finding[3]}- 접두어인데 소유 Files의 해당 클래스({'iac' if finding[3] == 'INFRA' else 'ci'}) 검출 0건 — 레포 밖 실체(evidence로 확인) 또는 접두어 재검토")
        # 테스트 인프라 격리(SPEC-015): testInfraGlobs 매치 파일은 TEST 스펙만 소유.
        ti = test_infra_finding(pfx, owned, test_infra_globs)
        if ti:
            prefix_errors.append(f'테스트 인프라 격리 위반 "{sid}" — testInfraGlobs 매치 파일(예: {ti["files"][0]})은 TEST 스펙이 소유해야 함(제품 스펙 소유 금지, SPEC-015)')
    # 0c. 접두어별 spec-ID 번호 무결성(SPEC-014): 중복·001미시작 hard, 내부 gap advisory(--strict 승격).
    n_hard, n_advisory = numbering_issues(known_ids, cfg.get("retiredIds"))
    prefix_errors.extend(n_hard)
    for a in n_advisory:
        (prefix_errors if strict else prefix_class_warnings).append(a)
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

    errors, warnings = [], list(prefix_class_warnings)  # 0b의 advisory(미사용 면제·INFRA 검출 0건)
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
    planned_specs = set()
    for f in spec_names:
        m = cfg["__specId"].search(f)
        if m and f.endswith(".md") and parse_status(read_text(os.path.join(spec_dir, f))) == "Planned":
            planned_specs.add(m.group(0))
    acct_classes, acct_counts = (classify_accounting(specs, covered, manifest, planned_specs)
                                 if accounting_active else (None, None))
    # Planned↔커버리지 모순(SPEC-018 FR-007): Planned는 "안 지음" 선언인데 unit 커버 FR이 실재하면 모순 —
    # Active→Planned 뒤집기로 strictSpecs·R3를 침묵시키는 "회계 침묵기" 경로를 hard 차단(감사 T2).
    for spec in sorted(planned_specs):
        cov = covered.get(spec)
        if cov:
            errors.append(f"Planned 모순 {spec}: Status Planned인데 unit 커버 FR {len(cov)}개 — "
                          f"구현이면 Status 승격, 폐기면 sdd-retire(Planned=의도적 미구현 선언, SPEC-018)")

    for spec, frs in specs.items():
        cov = covered.get(spec, set())
        hard = strict or spec in strict_specs
        label = "R2(strict)" if strict else "R2(strictSpecs)"
        if not cov:
            planned = spec in planned_specs
            msg = f"{spec}: 0/{len(frs)} FRs covered ({'planned — 의도적 미구현' if planned else 'not yet implemented'})"
            if hard and frs and not planned:
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
                f" deferred:{acct_counts['deferred']} planned:{acct_counts['planned']} unaccounted:{acct_counts['unaccounted']})"
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

def capability_check_active(categories):
    """entity·capability류 카테고리가 둘 다 있을 때만 활성(SPEC-024, capability-ownership-lib 미러)."""
    return any(re.search("entit", c, re.IGNORECASE) for c in categories or []) \
        and any(re.search("capabilit", c, re.IGNORECASE) for c in categories or [])


def capability_ownership_findings(owned_entities, owned_capabilities):
    """capability x.verb의 entity 조각이 소유 entity 집합에 없으면 위반(SPEC-024).
    점 없는 capability는 validate_key 담당(이중 보고 금지). 반환 [(capability, entity)]."""
    owned = {str(k).strip().lower() for k in owned_entities or []}
    findings = []
    for raw in owned_capabilities or []:
        cap = str(raw).strip().lower()
        dot = cap.find(".")
        if dot <= 0:
            continue
        entity = cap[:dot]
        if entity not in owned:
            findings.append((cap, entity))
    return findings


def schema_backing_active(policy, sources, categories):
    """정책 on + 스키마 소스 선언 + Entities류 카테고리 존재일 때만 활성(SPEC-026, schema-backing-lib 미러)."""
    return policy != "off" and isinstance(sources, list) and len(sources) > 0 \
        and any(re.search("entit", c, re.IGNORECASE) for c in categories or [])


def validate_schema_patterns(sources):
    """소스별 패턴의 정규식 유효성 검사 — 잘못된 정규식은 (index, pattern)로 수집(크래시 대신 보고).
    엔진별 예외 메시지는 담지 않는다(Node↔Python 패리티)."""
    errors = []
    for index, src in enumerate(sources or []):
        for p in (src or {}).get("patterns") or []:
            try:
                re.compile(p)
            except re.error:
                errors.append((index, str(p)))
    return errors


def extract_schema_entities(units):
    """구조 SSOT 텍스트에서 실재 entity 식별자 추출 — units:[{text, patterns:[정규식]}], 캡처1=식별자.
    잘못된 정규식은 건너뛴다(크래시 방지 — 유효성은 validate_schema_patterns가 별도 보고)."""
    out = set()
    for unit in units or []:
        text = unit.get("text") or ""
        for p in unit.get("patterns") or []:
            try:
                rx = re.compile(p)
            except re.error:
                continue
            for m in rx.finditer(text):
                ident = str(m.group(1) or "").strip().lower()
                if ident:
                    out.add(ident)
    return out


def schema_backing_findings(owned_by_spec, schema_set, exempt_set):
    """소유 entity가 스키마 집합(∪ 면제)에 없으면 위반. 반환 [(spec_id, entity)] (선언 순)."""
    findings = []
    for spec_id, entities in owned_by_spec or []:
        for raw in entities or []:
            ent = str(raw).strip().lower()
            if not ent or ent in ("—", "-"):
                continue
            if ent not in schema_set and not (exempt_set and ent in exempt_set):
                findings.append((spec_id, ent))
    return findings


def cmd_ownership(cfg, strict):
    categories = cfg["ownershipCategories"]
    ent_cat = next((c for c in categories if re.search("entit", c, re.IGNORECASE)), categories[0])
    # Capability 귀속(SPEC-024) — 스펙 경계는 entity 기준: capability x.verb는 entity x 소유 스펙만.
    cap_cat = next((c for c in categories if re.search("capabilit", c, re.IGNORECASE)), None)
    cap_policy = cfg.get("capabilityOwnershipPolicy") or "advisory"
    if cap_policy not in ("off", "advisory", "hard"):
        print(f'✗ capabilityOwnershipPolicy 값 위반 "{cap_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    cap_active = cap_policy != "off" and capability_check_active(categories)
    cap_findings = []  # (spec_id, capability, entity)

    # Entity 스키마 백킹(SPEC-026) — 소유 entity가 구조 SSOT에 실재하는지 대조(유령 entity 차단).
    sb_policy = cfg.get("entitySchemaBackingPolicy") or "off"
    if sb_policy not in ("off", "advisory", "hard"):
        print(f'✗ entitySchemaBackingPolicy 값 위반 "{sb_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    sb_sources = cfg.get("entitySchemaSources") or []
    sb_active = schema_backing_active(sb_policy, sb_sources, categories)
    sb_owned = []  # (spec_id, [raw...])

    # ownershipCategories에 Files 금지(SPEC-013, DEDUP.md §3) — 글롭이 dedup 키로 유입되면
    # 유일성·형식검증이 오판한다. 문서의 "금지"를 config 검증으로 기계 강제.
    cat_errors = ownership_categories_findings(categories)
    if cat_errors:
        print("✗ ownershipCategories 위반:", file=sys.stderr)
        for e in cat_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    files = spec_md_files(cfg)

    owners = {c: {} for c in categories}
    missing, format_issues = [], []
    spec_deps = []  # (spec_id, [(name, type), ...]) — 관계 판정용(SPEC-017)
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
        # Capability 귀속(SPEC-024): entity 0개+capability 소유(기술 계층 스펙)·남의 entity 위 capability.
        if cap_active and cap_cat:
            for cap, entity in capability_ownership_findings(own.get(ent_cat), own.get(cap_cat)):
                cap_findings.append((spec_id, cap, entity))
        # Entity 스키마 백킹(SPEC-026): 소유 entity 수집 — 아래에서 구조 SSOT 실재 집합과 대조.
        if sb_active and own.get(ent_cat):
            sb_owned.append((spec_id, own[ent_cat]))
        # Dependencies 섹션은 참조일 뿐 dedup 대상이 아님(파싱만, 거짓양성 방지).
        # `Name (relation-type)` 항목만 구조화 관계로 뽑는다 — 레거시 자유참조는 관여 안 함.
        deps = parse_section(text, "Dependencies", categories)
        rel_entities = [parse_relation_entry(raw) for raw in deps.get(ent_cat, [])]
        rel_entities = [(e["name"], e["type"]) for e in rel_entities if e["type"]]
        if rel_entities:
            spec_deps.append((spec_id, rel_entities))

    conflicts = []
    for cat in categories:
        for key, specs in owners[cat].items():
            if len(specs) > 1:
                conflicts.append((cat, key, sorted(set(specs))))

    # entity 레지스트리(SPEC-002 FR-009, P3): PREFIX 거버넌스와 동일 패턴 — 등록 = config 변경 = 리뷰 관문.
    # 비어 있으면 비활성(현행). 채워지면 aggregate-root 카테고리의 소유 키는 등록된 것만, 사유는 빈 값 불가.
    registry = cfg.get("entityRegistry") or {}
    entity_errors, registry_warns = [], []
    if registry:
        reg = {normalize_key(ent_cat, k, cfg): str(registry[k] or "").strip() for k in registry}
        for key, rationale in reg.items():
            if not rationale:
                entity_errors.append(f'entityRegistry["{key}"] — 도입 사유 필요(빈 값 불가)')
        for key, spec_ids in owners[ent_cat].items():
            if key not in reg:
                uniq = sorted(set(spec_ids), key=spec_ids.index)
                entity_errors.append(f'미등록 entity "{key}" ({" + ".join(uniq)}) — entityRegistry에 사유와 함께 등록 필요(임의 신설 금지)')
        for key in reg:
            if key not in owners[ent_cat]:
                registry_warns.append(f'entityRegistry의 "{key}"를 소유한 spec 없음 — 선등록이 아니면 정리 대상')

    # Entity 관계(SPEC-017): 대상 실재·소유 spec 해석 = hard, 순환 참조 = advisory.
    # relationTypes가 비어있으면 어휘 무제한(capabilityVerbs 동형) — 형식(kebab 토큰)만 이미 강제.
    relation_types = cfg.get("relationTypes") or []
    relation_errors = []
    for spec_id, entities in spec_deps:
        for _, rel_type in entities:
            bad = relation_type_finding(rel_type, relation_types)
            if bad:
                relation_errors.append(f"[{spec_id}] {bad}")
    entity_owner_index = {key: spec_ids[0] for key, spec_ids in owners[ent_cat].items()}
    relation_edges, relation_missing = resolve_relations(spec_deps, entity_owner_index)
    for spec_id, entity, rel_type in relation_missing:
        relation_errors.append(f'[{spec_id}] 관계 대상 Entity "{entity}" ({rel_type}) — 어느 spec의 Ownership에도 없음(오타·삭제 확인)')
    relation_cycles = find_cycles(relation_edges)

    print(f"Ownership 게이트: spec {len(files)}개 중 {declared}개가 Ownership 선언.")
    if missing:
        tag = "✗" if strict else "⚠"
        print(f"{tag} Ownership 블록 없음({len(missing)}): {', '.join(missing)}")
    if format_issues:
        tag = "✗" if strict else "⚠"
        for spec_id, bad in format_issues:
            print(f"{tag} [{spec_id}] {bad}")
    for w in registry_warns:
        print(f"⚠ {w}")
    if entity_errors:
        print(f"\n✗ ENTITY 레지스트리 위반 {len(entity_errors)}건:", file=sys.stderr)
        for e in entity_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    # Capability 귀속 리포트(SPEC-024) — 스펙 경계는 entity 기준.
    cap_hard = cap_policy == "hard" and len(cap_findings) > 0
    if cap_active and cap_findings:
        print(f"Capability 귀속(capabilityOwnershipPolicy={cap_policy}): 위반 {len(cap_findings)}건 — capability는 그 entity를 소유한 스펙에 귀속")
        for spec_id, cap, entity in cap_findings:
            tag = "✗" if cap_hard else "⚠"
            print(f'  {tag} [{spec_id}] Capabilities "{cap}" — entity "{entity}"를 이 스펙이 소유하지 않음: 그 entity 소유 스펙으로 이관(verb가 달라도 같은 스펙에 FR 신설), 이 스펙이 그 aggregate면 Entities에 소유 선언')
    if cap_hard:
        print("\n✗ capabilityOwnershipPolicy=hard: entity 없는 capability 소유(기술 계층 스펙) 금지 — 위 능력을 소유 aggregate 스펙으로 이관하라(SPEC-024).",
              file=sys.stderr)
        sys.exit(1)

    # Entity 스키마 백킹 리포트(SPEC-026) — 소유 entity가 구조 SSOT(스키마)에 실재하는가.
    sb_errors, sb_findings, sb_exempt_used = [], [], []
    if sb_active:
        exempt = cfg.get("entitySchemaExemptEntities") or {}
        exempt_set = set()
        for k, v in exempt.items():
            if not str(v or "").strip():
                sb_errors.append(f'entitySchemaExemptEntities["{k}"] — 면제 사유 필요(빈 값 불가)')
            key = str(k).strip().lower()
            if key:
                exempt_set.add(key)
        # 잘못된 정규식은 크래시 대신 명확히 보고(엔진별 메시지 미포함 — 패리티).
        for idx, pat in validate_schema_patterns(sb_sources):
            sb_errors.append(f'entitySchemaSources[{idx}].patterns "{pat}" — 잘못된 정규식(문법 오류): 이 knob의 추출 패턴을 확인하라')
        # 구조 SSOT 파일 수집(루트 1회 순회, ignoreDirs 제외) 후 소스별 글롭 매치·패턴 추출.
        ignore = set(cfg["ignoreDirs"])
        all_files = []
        for dirpath, dirnames, filenames in os.walk(cfg["__root"]):
            dirnames[:] = sorted(d for d in dirnames if d not in ignore)
            rel_dir = os.path.relpath(dirpath, cfg["__root"])
            for name in sorted(filenames):
                all_files.append(name if rel_dir == "." else f"{rel_dir}/{name}")
        units = []
        for src in sb_sources:
            globs = [compile_glob(g) for g in (src.get("globs") or [])]
            patterns = src.get("patterns") or []
            if not globs or not patterns:
                continue
            for rel in all_files:
                if not any(rx.search(rel) for rx in globs):
                    continue
                try:
                    with open(os.path.join(cfg["__root"], rel), encoding="utf-8") as fh:
                        units.append({"text": fh.read(), "patterns": patterns})
                except OSError:
                    pass
        sb_findings = schema_backing_findings(sb_owned, extract_schema_entities(units), exempt_set)
        sb_exempt_used = sorted(e for e in exempt_set if e in owners[ent_cat])
    sb_hard = sb_policy == "hard" and len(sb_findings) > 0
    if sb_active and sb_findings:
        print(f"Entity 스키마 백킹(entitySchemaBackingPolicy={sb_policy}): 위반 {len(sb_findings)}건 — 소유 entity가 구조 SSOT에 없음(유령 entity 의심)")
        for spec_id, entity in sb_findings:
            tag = "✗" if sb_hard else "⚠"
            print(f'  {tag} [{spec_id}] Entities "{entity}" — 구조 SSOT(스키마)에 실재하지 않음: 실제 테이블이면 스키마에 존재해야 하고, UI/흐름 개념이면 Surface로 강등하고 capability를 실 entity로 재키(SPEC-026)')
    # 면제는 조용히 '완료'가 되지 않게 항상 표면화(부채·리뷰 대상). 대량 면제는 개념 단위 분할 신호.
    if sb_active and sb_exempt_used:
        print(f'Entity 스키마 백킹: 스키마 대조 면제 {len(sb_exempt_used)}건(부채·리뷰 대상 — UI/흐름 개념은 Surface 강등+실 entity 재키, 인프라/proto는 해당 구조 SSOT를 entitySchemaSources에 추가; 면제는 스키마 밖 실 외부 aggregate에만): {", ".join(sb_exempt_used)}')
    if sb_errors:
        print(f"\n✗ entitySchemaExemptEntities 위반 {len(sb_errors)}건:", file=sys.stderr)
        for e in sb_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    if sb_hard:
        print("\n✗ entitySchemaBackingPolicy=hard: 소유 entity는 구조 SSOT에 실재해야 한다 — 유령 entity(지어낸 개념)에 capability를 얹지 말고 실 entity로 재구성하라(SPEC-026).",
              file=sys.stderr)
        sys.exit(1)
    for c in relation_cycles:
        print(f"⚠ 관계 순환 참조: {' → '.join(c)} — aggregate 간 참조는 한 방향이어야 한다(설계 검토)")
    if relation_errors:
        print(f"\n✗ Entity 관계(SPEC-017) 위반 {len(relation_errors)}건:", file=sys.stderr)
        for e in relation_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
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
        frs = len(set(cfg["__frDecl"].findall(text)))  # 정의(**FR-NNN**)만 — Change Log/근거의 FR 인용 제외
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

STATUS_ENUM = ["Planned", "Draft", "Reviewed", "Approved", "Active", "Deprecated", "Removed"]
_REVIEWED_PLUS = {"Reviewed", "Approved", "Active"}
LIFECYCLE_ENUM = ["removable", "permanent"]  # lifecycle-lib.mjs 미러(SPEC-008)


def parse_status(text):
    m = re.search(r"\*\*Status\*\*\s*:\s*([A-Za-z]+)", text)
    return m.group(1) if m else None


def parse_lifecycle(text):
    m = re.search(r"\*\*Lifecycle\*\*\s*:\s*([A-Za-z]+)", text)
    return m.group(1) if m else None


def is_reviewed_plus(status):
    return status in _REVIEWED_PLUS


# 소유 코드 변경을 이끌 수 있는 상태(SPEC-008 FR-008) — lifecycle-lib.mjs canLeadCode 미러.
# 화이트리스트: Draft만이 아니라 Planned(리뷰 전)·enum 밖 값(Wip 등)도 코드를 못 이끈다.
# None(레거시 — Status 미선언)은 통과(점진 도입 유지).
_CODE_LEADING = {"Reviewed", "Approved", "Active", "Deprecated", "Removed"}


def can_lead_code(status):
    return status is None or status in _CODE_LEADING


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


# ── 재도출 소스 회계 (derivation-lib.mjs 패리티, SPEC-009) ──

SOURCE_CLASSES = [
    "code", "iac", "ci", "ops-docs", "build-evidence",
    "vcs-history", "prior-traceability", "prior-intent", "human-intent",
]
DERIVATION_STATUS = ["mapped", "none", "deferred"]
GLOB_DETECTABLE = ["iac", "ci", "ops-docs"]


def validate_derivation_manifest(data):
    """D1(클래스·status 문법·전 클래스 회계) · D2(evidence/reason 존재)."""
    errors = []
    known = set(SOURCE_CLASSES)
    for key in data.keys():
        if key not in known:
            errors.append(f'D1 미정의 소스 클래스 "{key}" — 고정 enum 외 값 금지(정의되지 않은 예외 금지)')
    for cls in SOURCE_CLASSES:
        if cls not in data:
            errors.append(f'D1 미회계 소스 클래스 "{cls}" — mapped|none|deferred 중 하나로 선언 필요(조용한 미인제스트 금지)')
            continue
        v = data[cls]
        status = str((v or {}).get("status") or "").strip() if isinstance(v, dict) else ""
        if status not in DERIVATION_STATUS:
            errors.append(f'D1 "{cls}": status는 mapped|none|deferred 중 하나여야 함')
            continue
        if status == "mapped":
            if not str(v.get("evidence") or "").strip():
                errors.append(f'D2 "{cls}": mapped는 evidence 필수(빈 값 불가 — 존재만 강제, 질은 리뷰 몫)')
        elif not str(v.get("reason") or "").strip():
            errors.append(f'D2 "{cls}": {status}는 reason 필수(빈 값 불가)')
    return errors


def change_log_rationale_findings(text):
    """선제 캡처(SPEC-009 FR-006) — 실제 날짜(YYYY-MM-DD) 행의 근거 칸이 빈 값이면 그 날짜."""
    block = section_block(text, "Change Log")
    if block is None:
        return []
    missing = []
    for line in block.split("\n"):
        if not re.match(r"^\s*\|", line):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 3:
            continue
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", cells[0]):
            continue
        if not cells[2]:
            missing.append(cells[0])
    return missing


# ── 접두어↔클래스 정합 (prefix-class-lib.mjs 패리티, SPEC-012) ──

INFRA_SOURCE_CLASSES = ["iac", "ci"]  # 접두어↔클래스 정합 대상 인프라-계열 소스 클래스
CLASS_PREFIX = {"iac": "INFRA", "ci": "CICD"}  # iac=프로비저닝 자원, ci=전달 자동화


def classify_infra_file(rel_path, class_globs):
    for cls in INFRA_SOURCE_CLASSES:
        if any(rx.search(rel_path) for rx in class_globs.get(cls, [])):
            return cls
    return None


def prefix_class_finding(prefix, owned_files, class_globs):
    """전체성 임계 — 소유 실파일 전부가 한 인프라 클래스면 그 클래스 접두어 강제(iac→INFRA·ci→CICD).
    prefix-class-lib.mjs 미러(바이트 동일). 반환 (kind, infra, other, expected|prefix) | None."""
    by_class = {"iac": [], "ci": []}
    infra, other = [], []
    for f in owned_files:
        c = classify_infra_file(f, class_globs)
        if c:
            by_class[c].append(f); infra.append(f)
        else:
            other.append(f)
    if infra and not other and prefix != "TEST":  # TEST는 자기 인프라 소유 면제(격리는 test_infra_finding — SPEC-015)
        expected = []
        for c in INFRA_SOURCE_CLASSES:
            if by_class[c] and CLASS_PREFIX[c] not in expected:
                expected.append(CLASS_PREFIX[c])
        if prefix not in expected:
            return ("error", infra, other, expected)
    own_class = next((c for c in INFRA_SOURCE_CLASSES if CLASS_PREFIX[c] == prefix), None)
    if own_class and not by_class[own_class]:
        return ("warn", infra, other, prefix)
    return None


def test_infra_finding(prefix, owned_files, test_infra_globs):
    """테스트 인프라 격리 (test-domain-lib.mjs 미러, SPEC-015). testInfraGlobs 매치 파일을
    비-TEST 스펙이 소유하면 위반. prefix=TEST면 항상 None(정당 소유자). [] 이면 비활성."""
    if not test_infra_globs or prefix == "TEST":
        return None
    files = [f for f in owned_files if any(rx.search(f) for rx in test_infra_globs)]
    return {"files": files} if files else None


def validate_prefix_class_exemptions(exemptions, known_ids):
    errors = []
    for sid in sorted((exemptions or {}).keys()):
        if sid not in known_ids:
            errors.append(f'prefixClassExemptions에 존재하지 않는 spec "{sid}" — 오타/삭제 확인(조용한 스킵 금지)')
        elif not str(exemptions[sid] or "").strip():
            errors.append(f'prefixClassExemptions["{sid}"] — 사유 필요(빈 값 불가)')
    return errors


# ── 스펙 문법 규범 (grammar-lib.mjs 패리티, SPEC-013) ──


def parse_module(text):
    m = re.search(r"\*\*Module\*\*\s*:\s*`?([^`\n]+?)`?\s*(?:\*\*|$)", text, re.MULTILINE)
    val = m.group(1).strip() if m else ""
    return val or None


def fr_lines_missing_shall(text, fr_decl_re):
    line_re = re.compile(r"^\s*-\s*" + fr_decl_re.pattern)
    out = []
    for line in text.split("\n"):
        m = line_re.match(line)
        if m and not re.search(r"\bSHALL\b", line):
            out.append(m.group(1))
    return out


def dedup_review_dangling_ids(text, spec_id_re, known_ids):
    block = section_block(text, "Dedup-Review")
    if block is None:
        return []
    seen = {m.group(0) for m in re.finditer(spec_id_re.pattern, block)}
    return sorted(i for i in seen if i not in known_ids)


def ownership_categories_findings(categories):
    return [f'ownershipCategories에 "{c}" 금지 — Files는 spec-sync 소유선언 전용(dedup 키 아님, DEDUP.md §3)'
            for c in (categories or []) if str(c).strip().lower() == "files"]


def walk_all_rel(root_dir, cfg, rel_base=""):
    """레포 상대경로 전 파일 순회(ignoreDirs 제외, 이름 정렬 인라인 재귀 — Node walkAll 순서 미러)."""
    ignore = set(cfg["ignoreDirs"])
    acc = []
    try:
        entries = sorted(os.listdir(root_dir))
    except OSError:
        return acc
    for name in entries:
        p = os.path.join(root_dir, name)
        r = f"{rel_base}/{name}" if rel_base else name
        if os.path.isdir(p):
            if name in ignore:
                continue
            acc.extend(walk_all_rel(p, cfg, r))
        elif os.path.exists(p):
            acc.append(r)
    return acc


def read_text_lossy(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


# ── completeness — SC·인수조건·수명주기 기록 존재 (check-spec-completeness.mjs) ──

def _section_body(text, heading):
    m = re.search(rf"^#{{1,6}}\s*{re.escape(heading)}\s*$", text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"^#{1,6}\s", rest, re.MULTILINE)
    return rest if not nxt else rest[:nxt.start()]


def _before_audit_trail(text):
    m = re.search(r"^#{1,6}\s*(Review Log|Dedup-Review|Change Log)\s*$", text, re.IGNORECASE | re.MULTILINE)
    return text[:m.start()] if m else text


def object_storage_findings(text, markers):
    """오브젝트 스토리지 결정 검사 (object-storage-lib.mjs 미러 — 바이트 동일, SPEC-016).
    감사 트레일(Review Log/Dedup-Review/Change Log)의 마커 언급은 스캔 제외(자기 서술 오탐 방지)."""
    if not markers:
        return []
    scan = _before_audit_trail(text)
    if not any(re.search(re.escape(m), scan, re.IGNORECASE) for m in markers):
        return []
    section = _section_body(text, "Object Storage Decision")
    if section is None:
        return ["오브젝트 스토리지(S3 등) 마커 매치 — '## Object Storage Decision' 섹션 없음(버킷 선택·이전 기준 기록 필요, SPEC-016)"]
    missing = [lbl for lbl in ("Bucket", "Consolidation") if not re.search(re.escape(lbl), section, re.IGNORECASE)]
    if missing:
        return [f"Object Storage Decision 섹션에 필수 라벨 없음: {', '.join(missing)} (버킷 선택·이전 기준, SPEC-016)"]
    return []


# ── entity 관계(SPEC-017): Dependencies.Entities의 "Name (relation-type)" 구조화 표기 ──
# `EntityName (relation-type)` 괄호 표기만 구조화 관계로 파싱한다. relation-type은 소문자
# kebab 1토큰만 인정 — 공백·쉼표·대문자가 든 기존 서술 괄호("(deprecated, 검토 필요)")와
# 우연히 겹치지 않게 방어. 괄호 없는 항목은 레거시 자유참조로 그대로 통과(하위호환).
_RELATION_TYPE_RE = re.compile(r"^[a-z][a-z0-9-]*$")


def parse_relation_entry(raw):
    """relation-lib.mjs 미러 — 바이트 동일 판정, SPEC-017."""
    s = str(raw).strip()
    m = re.match(r"^(.+?)\s*\(([^()]+)\)\s*$", s)
    if m and _RELATION_TYPE_RE.match(m.group(2).strip()):
        return {"name": m.group(1).strip(), "type": m.group(2).strip()}
    return {"name": s, "type": None}


def relation_type_finding(rel_type, allowed_types):
    if not rel_type:
        return None
    if not allowed_types:
        return None
    if rel_type not in allowed_types:
        return f'미등록 관계 종류 "{rel_type}" — relationTypes에 등록 필요(임의 신설 금지)'
    return None


def resolve_relations(spec_deps, entity_owner_index):
    """구조화 관계(type 있음)만 해석 — 대상 미실재는 missing(hard 대상)."""
    edges, missing = [], []
    for spec_id, entities in spec_deps:
        for name, rel_type in entities:
            if not rel_type:
                continue
            owner = entity_owner_index.get(name)
            if not owner:
                missing.append((spec_id, name, rel_type))
                continue
            edges.append((spec_id, owner, rel_type, name))
    return edges, missing


def find_cycles(edges):
    """spec 간 참조 그래프 순환 탐지(DFS 3색 마킹) — edges: [(from,to,type,entity), ...]."""
    graph = {}
    for frm, to, *_ in edges:
        graph.setdefault(frm, []).append(to)
    GRAY, BLACK = 1, 2
    color, stack, cycles = {}, [], []

    def dfs(node):
        color[node] = GRAY
        stack.append(node)
        for nxt in graph.get(node, []):
            if color.get(nxt) == GRAY:
                idx = stack.index(nxt)
                cycles.append(stack[idx:] + [nxt])
            elif color.get(nxt) != BLACK:
                dfs(nxt)
        stack.pop()
        color[node] = BLACK

    for node in sorted(graph.keys()):
        if color.get(node) != BLACK:
            dfs(node)
    return cycles


def cmd_completeness(cfg, strict):
    files = spec_md_files(cfg)
    texts = []
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        texts.append((text, m.group(0) if m else os.path.basename(file)))
    known_ids = {sid for _, sid in texts}  # Dedup-Review 이웃 ID 실재 판정용
    module_values = {}  # Module 값 -> [spec_id] (1 레포 = 1 모듈 판정용)
    findings = []
    enum = "|".join(STATUS_ENUM)
    for text, spec_id in texts:
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
        # Lifecycle 필드(SPEC-008): 선택 — 있으면 removable|permanent enum 검증(없으면 무관).
        lc = parse_lifecycle(text)
        if lc is not None and lc not in LIFECYCLE_ENUM:
            findings.append((spec_id, f'미정의 Lifecycle "{lc}" — {"|".join(LIFECYCLE_ENUM)} 외 값 금지'))
        # Module 헤더(SPEC-013): STORAGE §2.3 "본문 필수" — 존재 검사 + 값 수집(단일성은 루프 뒤).
        mod = parse_module(text)
        if mod is None:
            findings.append((spec_id, "Module 헤더 없음 — 이 스펙이 속한 모듈 선언 필수(STORAGE §2.3)"))
        else:
            module_values.setdefault(mod, []).append(spec_id)
        # 선제 캡처(SPEC-009) — 실기록 Change Log 행의 근거 칸은 빈 값 불가(변경 의도는 저술 시점에만 남는다).
        for d in change_log_rationale_findings(text):
            findings.append((spec_id, f"Change Log {d} 행의 근거 칸이 빈 값 — 변경 의도는 저술 시점에만 캡처 가능(선제 캡처)"))
        # Dedup-Review 이웃 ID 실재(SPEC-013) — 기록 형식 검사의 연장(오타·삭제 잔재 표면화; 내용의 질은 리뷰 몫).
        for i in dedup_review_dangling_ids(text, cfg["__specId"], known_ids):
            findings.append((spec_id, f'Dedup-Review가 존재하지 않는 스펙 "{i}" 참조 — 오타/삭제 잔재(삭제된 이웃은 "이웃 없음(삭제됨)"으로 갱신)'))
        # 오브젝트 스토리지 결정(SPEC-016): 마커 매치 스펙은 Object Storage Decision(Bucket·Consolidation) 필수.
        for m in object_storage_findings(text, cfg.get("objectStorageMarkers") or []):
            findings.append((spec_id, m))
        if not set(cfg["__frToken"].findall(text)):
            continue  # FR 없는 spec은 면제(순수 인프라 등)
        if not set(re.findall(r"\bSC-\d{3}\b", text)):
            findings.append((spec_id, "SC(측정형 성공 기준) 없음"))
        if not (re.search(r"\b(Given|Acceptance)\b", text, re.IGNORECASE) or re.search(r"수용\s*기준", text)):
            findings.append((spec_id, "인수조건(Given-When-Then) 없음"))
        # EARS 기계 신호(SPEC-013): FR 선언 라인은 SHALL 포함 — 어휘 질·측정가능성은 리뷰 몫.
        for fr in fr_lines_missing_shall(text, cfg["__frDecl"]):
            findings.append((spec_id, f"{fr} 선언 라인에 SHALL 없음 — EARS 5패턴 공통 필수 토큰(다중행 서술이면 선언 라인에 SHALL 포함)"))

    # 1 레포 = 1 모듈(SPEC-013, STRUCTURE.md): Module 값이 갈라지면 레포 분할 신호.
    if len(module_values) > 1:
        names = sorted(module_values.keys())
        findings.append(("(전 스펙)", f"Module 값 {len(names)}개({', '.join(names)}) — 1 레포 = 1 모듈(STRUCTURE.md): 모듈이 더 필요하면 레포를 나눈다"))

    print(f"Spec 완전성 게이트: spec {len(files)}개 검사 (FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록, Change Log 실기록 행은 근거 필요).")
    if findings:
        tag = "✗" if strict else "⚠"
        print(f"{tag} 완전성 미흡 {len(findings)}건:")
        for spec_id, miss in findings:
            print(f"  {tag} {spec_id}: {miss}")
        if strict:
            print("\n✗ --strict: FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록, Change Log 실기록 행은 근거 필요.", file=sys.stderr)
            sys.exit(1)
        return
    print("✓ 완전성 구비 — SC·인수조건·수명주기·근거 기록 모두 충족.")


# ── consistency — 선언 키의 본문 근거 (check-spec-consistency.mjs) ──

_STOP_TOKENS = {"post", "get", "put", "delete", "patch", "api", "event", "job"}


def _key_tokens(key):
    return [t for t in re.findall(r"[a-z][a-z0-9_]+", key.lower()) if t not in _STOP_TOKENS]


def _strip_code_spans(line):
    """`...` 코드 스팬 제거 — 리터럴 인용은 강조가 아니다(key-anchor-lib.mjs 미러, SPEC-023)."""
    return re.sub(r"`[^`]*`", "", str(line))


def _extract_code_spans(line):
    """코드 스팬(백틱) 내용 추출 — 선언 키가 백틱에 있으면 앵커 승격 대상(SPEC-023 FR-006)."""
    return [m.group(1).strip() for m in re.finditer(r"`([^`]+)`", str(line))]


def _is_fr_decl_line(line, req_alt="FR"):
    return re.match(rf"^\s*-?\s*\*\*(?:{req_alt})-\d{{3}}[a-z]?\*\*", line) is not None


def _extract_anchors_with_markers(line, req_alt="FR"):
    """평문 bold 토큰 + 뒤 "(X)" 카테고리 마커 — 굵은 키의 종류 표기(SPEC-023 확장). [(token, marker or None)]."""
    id_re = re.compile(rf"^(?:{req_alt})-\d{{3}}[a-z]?$")
    out = []
    for m in re.finditer(r"\*\*([^*]+?)\*\*(?:\s*\(([A-Za-z])\))?", _strip_code_spans(line)):
        tok = m.group(1).strip()
        if not tok or id_re.match(tok):
            continue
        out.append((tok.lower(), m.group(2).upper() if m.group(2) else None))
    return out


def _extract_anchors(line, req_alt="FR"):
    """FR 선언 라인의 평문 bold 토큰(코드 스팬 제거 후, FR-ID 제외) — 정규화(트림·소문자)."""
    return [tok for tok, _ in _extract_anchors_with_markers(line, req_alt)]


def _build_key_kind_map(own_sections, dep_sections):
    """키 → 종류(entity/surface/capability) 맵 — 마커 대조용. 관계 서픽스 제거, 첫 등장 우선.
    세 종류 카테고리가 하나도 없으면(킷 Modules 등) 빈 맵(inert)."""
    def kind_of(cat):
        if re.search(r"entit", cat, re.IGNORECASE):
            return "entity"
        if re.search(r"surface", cat, re.IGNORECASE):
            return "surface"
        if re.search(r"capabilit", cat, re.IGNORECASE):
            return "capability"
        return None
    km = {}
    for sec in (own_sections, dep_sections):
        for cat, lst in (sec or {}).items():
            kind = kind_of(cat)
            if not kind:
                continue
            for raw in lst or []:
                k = re.sub(r"\s*\([a-z][a-z0-9-]*\)\s*$", "", str(raw)).strip().lower()
                if k and k not in ("—", "-") and k not in km:
                    km[k] = kind
    return km


def _category_marker_findings(fr_lines, key_kind_map, markers, req_alt="FR"):
    """(missing, wrong) — 굵은 키마다 그 카테고리 마커(E/R/C) 대조. 키 아니면 스킵. key_kind_map 비면 inert.
    missing:[(fr,token,expected)], wrong:[(fr,token,expected,got)]."""
    fr_id = re.compile(rf"\*\*((?:{req_alt})-\d{{3}}[a-z]?)\*\*")
    missing, wrong = [], []
    if not key_kind_map:
        return missing, wrong
    for line in fr_lines or []:
        if not _is_fr_decl_line(line, req_alt):
            continue
        m = fr_id.search(line)
        fr = m.group(1) if m else "?"
        seen = set()
        for tok, marker in _extract_anchors_with_markers(line, req_alt):
            if tok in seen:
                continue
            seen.add(tok)
            kind = key_kind_map.get(tok)
            if not kind:
                continue
            expected = str(markers[kind]).upper() if markers and markers.get(kind) else None
            if not expected:
                continue
            if not marker:
                missing.append((fr, tok, expected))
            elif marker != expected:
                wrong.append((fr, tok, expected, marker))
    return missing, wrong


def _backtick_key_findings(fr_lines, key_kind_map, markers, req_alt="FR"):
    """백틱에 든 선언 키 → 앵커 승격 대상(SPEC-023 FR-006, "굵게 ⟺ 키"). key_kind_map 비면 inert.
    반환 [(fr, token, expected)]."""
    fr_id = re.compile(rf"\*\*((?:{req_alt})-\d{{3}}[a-z]?)\*\*")
    out = []
    if not key_kind_map:
        return out
    for line in fr_lines or []:
        if not _is_fr_decl_line(line, req_alt):
            continue
        m = fr_id.search(line)
        fr = m.group(1) if m else "?"
        seen = set()
        for span in _extract_code_spans(line):
            tok = span.strip().lower()
            if tok in seen:
                continue
            seen.add(tok)
            kind = key_kind_map.get(tok)
            if not kind:
                continue
            expected = str(markers[kind]).upper() if markers and markers.get(kind) else None
            if not expected:
                continue
            out.append((fr, tok, expected))
    return out


def _build_key_set(own_sections, dep_sections):
    """Ownership ∪ Dependencies 전 카테고리(Files 제외) 정규화 키 + 관계 서픽스 제거(SPEC-017)."""
    keys = set()
    for sec in (own_sections, dep_sections):
        for cat, lst in (sec or {}).items():
            if cat.lower() == "files":
                continue
            for raw in lst or []:
                k = re.sub(r"\s*\([a-z][a-z0-9-]*\)\s*$", "", str(raw)).strip().lower()
                if k and k not in ("—", "-"):
                    keys.add(k)
    return keys


def _anchor_findings(fr_lines, key_set, req_alt="FR"):
    """(matched, unmatched) — 각 원소 (fr, token). 라인 순·라인 내 등장 순(결정적)."""
    fr_id = re.compile(rf"\*\*((?:{req_alt})-\d{{3}}[a-z]?)\*\*")
    matched, unmatched = [], []
    for line in fr_lines or []:
        if not _is_fr_decl_line(line, req_alt):
            continue
        m = fr_id.search(line)
        fr = m.group(1) if m else "?"
        seen = set()
        for tok in _extract_anchors(line, req_alt):
            if tok in seen:
                continue
            seen.add(tok)
            (matched if tok in key_set else unmatched).append((fr, tok))
    return matched, unmatched


def cmd_consistency(cfg, strict):
    categories = cfg["ownershipCategories"]
    # FR 키 앵커(SPEC-023) — off(기본)|advisory|hard.
    anchor_policy = cfg.get("frKeyAnchorPolicy") or "off"
    if anchor_policy not in ("off", "advisory", "hard"):
        print(f'✗ frKeyAnchorPolicy 값 위반 "{anchor_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    markers = cfg.get("frAnchorMarkers") or {"entity": "E", "surface": "R", "capability": "C"}
    files = spec_md_files(cfg, missing_fatal=False)
    findings = []
    anchor_matched = 0
    anchor_unmatched = []  # (spec_id, fr, token)
    marker_missing = []    # (spec_id, fr, token, expected) — 카테고리 마커 누락
    marker_wrong = []      # (spec_id, fr, token, expected, got) — 마커 불일치
    marker_backtick = []   # (spec_id, fr, token, expected) — 백틱에 든 선언 키(FR-006)
    for file in sorted(files):
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        own = parse_section(text, "Ownership", categories)
        # FR 키 앵커 대조(SPEC-023) — 정책이 켜진 경우만(off면 판정·출력 무변).
        if anchor_policy != "off":
            deps = parse_section(text, "Dependencies", categories)
            lines = text.split("\n")
            key_set = _build_key_set(own, deps)
            mt, un = _anchor_findings(lines, key_set, cfg["__reqAlt"])
            anchor_matched += len(mt)
            anchor_unmatched.extend((spec_id, fr, tok) for fr, tok in un)
            # 카테고리 마커(SPEC-023 확장): 굵은 키마다 종류 표기 — entity (E)·surface (R)·capability (C).
            kind_map = _build_key_kind_map(own, deps)
            miss, wr = _category_marker_findings(lines, kind_map, markers, cfg["__reqAlt"])
            marker_missing.extend((spec_id, fr, tok, exp) for fr, tok, exp in miss)
            marker_wrong.extend((spec_id, fr, tok, exp, got) for fr, tok, exp, got in wr)
            # 굵게 ⟺ 키 세 번째 방향(FR-006): 백틱에 든 선언 키는 앵커여야 함(리터럴 아님).
            for fr, tok, exp in _backtick_key_findings(lines, kind_map, markers, cfg["__reqAlt"]):
                marker_backtick.append((spec_id, fr, tok, exp))
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
    # FR 키 앵커 리포트(SPEC-023) — bold는 키 앵커 전용: 미매치 = 수사적 강조 또는 미선언 키.
    marker_count = len(marker_missing) + len(marker_wrong) + len(marker_backtick)
    anchor_hard = anchor_policy == "hard" and (len(anchor_unmatched) > 0 or marker_count > 0)
    if anchor_policy != "off":
        tag = "✗" if anchor_hard else "⚠"
        print(f"키 앵커(frKeyAnchorPolicy={anchor_policy}): 매치 {anchor_matched} · 미매치 {len(anchor_unmatched)} · 카테고리 마커 위반 {marker_count}")
        for spec_id, fr, tok in anchor_unmatched:
            print(f'  {tag} [{spec_id}] {fr} bold "{tok}" — 소유·참조 키 아님: 수사적 강조면 백틱/평문으로, 키면 Ownership/Dependencies에 선언')
        # 카테고리 마커(SPEC-023 확장) — 굵은 키마다 종류 표기: entity (E)·surface (R)·capability (C).
        for spec_id, fr, tok, exp in marker_missing:
            print(f'  {tag} [{spec_id}] {fr} bold "{tok}" — 카테고리 마커 없음: **{tok}** ({exp})로 표기(굵은 키의 종류 명시)')
        for spec_id, fr, tok, exp, got in marker_wrong:
            print(f'  {tag} [{spec_id}] {fr} bold "{tok}" ({got}) — 마커 불일치: 이 키의 카테고리는 ({exp})')
        # 굵게 ⟺ 키(FR-006) — 백틱에 든 선언 키는 앵커여야 한다(리터럴 아님).
        for spec_id, fr, tok, exp in marker_backtick:
            print(f'  {tag} [{spec_id}] {fr} 백틱 "{tok}" — 선언 키는 백틱(리터럴)이 아니라 앵커: **{tok}** ({exp})로 표기')
    if findings and strict:
        print("\n✗ --strict: 근거 없는 키.", file=sys.stderr)
        sys.exit(1)
    if anchor_hard:
        print("\n✗ frKeyAnchorPolicy=hard: FR 선언 라인의 bold는 키 앵커 전용이며 각 키는 카테고리 마커(E/R/C) 필수 — 위 토큰을 정리하라(SPEC-023).", file=sys.stderr)
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
    # core.quotepath=off: 비ASCII 경로가 8진수 인용 문자열로 나오면 glob 매칭이 조용히 깨진다(도그푸딩 발견).
    try:
        r = subprocess.run(["git", "-c", "core.quotepath=off"] + args, cwd=cfg["__root"], capture_output=True,
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


DRIFT_POLICY_ENUM = ("off", "advisory", "hard")


def escalations(triggered, satisfied, has_spec_impact, policy):
    """semantic drift 승격 판정 순수 코어 (SPEC-019, drift-lib.mjs 미러 — 바이트 동일).
    트리거 집합·충족 집합 → 위반 집합. (violations[정렬], hard, policy_error) 반환."""
    if policy not in DRIFT_POLICY_ENUM:
        return [], False, f'semanticDriftPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)'
    if policy == "off":
        return [], False, None
    if has_spec_impact:
        return [], False, None
    sat = set(satisfied or [])
    violations = sorted(set(triggered or []) - sat)
    return violations, policy == "hard", None


def parse_drivers(msg, id_alt):
    """`Change-Driver: <SPEC-ID> [@<glob>[,<glob>]] <사유>` 트레일러 파싱 (SPEC-020, cross-spec-lib.mjs 미러).
    사유 빈 항목은 버림. [(id, globs|None, reason)] 반환 — globs=None은 무스코프(전 파일, 레거시)."""
    rx = re.compile(rf"^Change-Driver:[ \t]*((?:{id_alt})-\d{{3}})[ \t]+(?:@(\S+)[ \t]+)?(.+)$", re.MULTILINE)
    out = []
    for m in rx.finditer(msg or ""):
        if not m.group(3).strip():
            continue
        globs = [g.strip() for g in m.group(2).split(",") if g.strip()] if m.group(2) else None
        out.append((m.group(1), globs, m.group(3).strip()))
    return out


def relaxing_drivers(owner, file, entries, match_glob):
    """파일 file에 대해 소유 스펙 owner를 완화하는 동인 id들(정렬) — 자기 자신 아닌 의미변경 동인 중,
    무스코프이거나 스코프 글롭이 file에 매치하는 것만(SPEC-020 FR-005, cross-spec-lib.mjs 미러)."""
    ids = set()
    for did, globs, _reason in entries or []:
        if did == owner:
            continue
        if globs and not any(match_glob(g, file) for g in globs):
            continue
        ids.add(did)
    return sorted(ids)


def cross_spec_relaxed(owner, meaningful_drivers):
    """(하위호환) 소유 스펙 owner의 요구가 참조 완화되는가 — 자기 자신 아닌 의미변경 동인이 하나라도 있으면 True."""
    return any(d != owner for d in set(meaningful_drivers or []))


def cmd_specsync(cfg, staged, msg_file, base):
    def lines(s):
        return [x.strip() for x in (s or "").split("\n") if x.strip()]

    # ⓪ staged 판정은 HEAD 시점 config로(SPEC-003 FR-011 — check-spec-sync.mjs 미러):
    # 이 커밋이 config를 바꾸는 중이면 약화 "전"(HEAD) config가 이 커밋을 심판한다(자기약화 방지).
    # config 불변 커밋이면 두 판이 같아 동작·출력 무변(하위호환). HEAD에 config 없으면(최초 채택) 현행.
    if staged:
        prefix = (_git(cfg, ["rev-parse", "--show-prefix"]) or "").strip()
        cfg_rel = f"{prefix}sdd.config.json"
        head_raw = _git(cfg, ["show", f"HEAD:{cfg_rel}"])
        cur_raw = _git(cfg, ["show", f":{cfg_rel}"])
        if cur_raw is None and cfg.get("__path"):
            try:
                cur_raw = read_text(cfg["__path"])
            except OSError:
                cur_raw = None
        if head_raw is not None and cur_raw is not None and head_raw != cur_raw:
            head_cfg = config_from_string(head_raw, cfg["__root"])
            if head_cfg:
                cfg = head_cfg
                print("· spec-sync: sdd.config.json 변경 감지 — HEAD 시점 config로 판정(자기약화 커밋 방지, SPEC-003)")
    # base 우선순위: CLI positional > SDD_DIFF_BASE(env) > specSyncBase(config) > origin/main.
    if base is None:
        base = os.environ.get("SDD_DIFF_BASE") or cfg.get("specSyncBase") or "origin/main"

    # ① 트레일러(§5.5): staged에서만 — 사유 필수 검증·파싱만 하고, 면제는 판정 루프에서 적용(감사 T3:
    # 전면 단락 금지). 면제 = 동반 요구 + 상태 차단(문서화된 탈출구). 글롭 문법·unowned는 면제 대상 아님.
    spec_impact = None
    if staged and msg_file:
        m = re.search(r"^Spec-Impact:\s*none\s*(.*)$", read_text(msg_file), re.MULTILINE)
        if m:
            if not m.group(1).strip():
                print("✗ spec-sync: `Spec-Impact: none`은 사유 필수 (`Spec-Impact: none <사유>`)", file=sys.stderr)
                sys.exit(1)
            spec_impact = m.group(1).strip()

    # ② 변경 파일 수집(§5.7): staged = cached ∪ base...HEAD / range = base...HEAD.
    branch_diff_ok = _git(cfg, ["rev-parse", "-q", "--verify", base]) is not None \
        and _git(cfg, ["diff", "--name-only", f"{base}...HEAD"]) is not None
    changed = set()
    if branch_diff_ok:
        changed.update(lines(_git(cfg, ["diff", "--name-only", f"{base}...HEAD"])))
    else:
        print(f"· spec-sync: base({base}) 해석 불가 — {'staged만 판정(경고). 멀티커밋 브랜치(스펙 선커밋→코드 후커밋)는 오차단될 수 있음 — sdd.config.json specSyncBase 또는 SDD_DIFF_BASE로 base 지정' if staged else '판정 불가, 건너뜀'}")
    if staged:
        changed.update(lines(_git(cfg, ["diff", "--cached", "--name-only"])))
    if not staged and not branch_diff_ok:
        sys.exit(0)

    # ②b 리네임 수집(SPEC-019): 소유 파일 리네임은 semantic drift 승격 트리거.
    renamed = set()

    def collect_renames(raw):
        for ln in lines(raw):
            m = re.match(r"^R\d*\t(.+)\t(.+)$", ln)
            if m:
                renamed.add(m.group(2).strip())
    if branch_diff_ok:
        collect_renames(_git(cfg, ["diff", "--name-status", "--find-renames", f"{base}...HEAD"]))
    if staged:
        collect_renames(_git(cfg, ["diff", "--cached", "--name-status", "--find-renames"]))

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
                        # staged(hard)에서는 위반(SPEC-013): 미지원 토큰은 매치 실패 = 소유가 조용히 풀린다(금지 문법).
                        print(f"{'✗' if staged else '⚠'} [{spec_id}] Files에 미지원 glob 문법 {' '.join(issues)} — "
                              f"**·* 만 지원(§4.1), 해당 토큰은 매치되지 않을 수 있음")
            for g in parse_section(src, "Ownership", ["Files"])["Files"]:
                g = strip_inline_comment(g)
                if g:
                    globs.add(g)
        specs.append((spec_id, p, [(g, compile_glob(g)) for g in sorted(globs)],
                      idx is None and head is not None, parse_status(text)))

    # ④ 판정: 변경 코드 파일 → 소유 스펙(AND, §6.1) → 의미 변경(두-이미지 합집합, §5.4·§5.8).
    # 미소유 파일은 specSyncUnownedPolicy가 선언한 대로 — silent(현행)/warn/error(closed-world).
    policy = cfg.get("specSyncUnownedPolicy") or "silent"
    if policy not in ("silent", "warn", "error"):
        print(f'✗ specSyncUnownedPolicy 값 위반 "{policy}" — silent|warn|error 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    # Draft 소유 코드 차단(SPEC-008 FR-004)을 range 모드에서도 hard로 승격할지(SPEC-008 FR-007) —
    # CI가 range 모드로 MR diff를 검사하면 로컬 commit-msg 훅을 안 타는 웹 UI 병합도 막을 수 있다.
    draft_policy = cfg.get("draftBlockPolicy") or "advisory"
    if draft_policy not in ("advisory", "hard"):
        print(f'✗ draftBlockPolicy 값 위반 "{draft_policy}" — advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    exempt = [compile_glob(g) for g in (cfg.get("specSyncExemptGlobs") or [])]
    spec_set = set(p for _, p, _, _, _ in specs)
    violations = []
    unowned = []  # 어떤 스펙 Files에도 매치 안 된 변경 파일(exempt 제외)
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

    # cross-spec 변경 동인(SPEC-020): Change-Driver 트레일러가 지목한 "의미변경 동인"이면 소유 요구를 참조 완화.
    # 경로 스코프(@glob, FR-005): 스코프 선언 동인은 매치 파일만 완화(무스코프 전역 팬아웃을 귀속으로).
    drivers = parse_drivers(read_text(msg_file), cfg["__idAlt"]) if (staged and msg_file) else []
    _spec_by_id = {s[0]: s for s in specs}
    meaningful_ids = set()
    for did in {d[0] for d in drivers}:
        s = _spec_by_id.get(did)
        if s and meaningful(s[0], s[1], s[3]):
            meaningful_ids.add(did)
    meaningful_entries = [d for d in drivers if d[0] in meaningful_ids]
    _glob_cache = {}

    def match_glob(g, file):
        if g not in _glob_cache:
            _glob_cache[g] = compile_glob(g)
        return bool(_glob_cache[g].match(file))
    for f in sorted(changed):
        if f in spec_set or f.startswith(cfg["specDir"] + "/"):
            continue  # 스펙 자신은 코드 아님
        if any(rx.match(f) for rx in exempt):
            print(f"· exempt: {f} (specSyncExemptGlobs — 영속 흔적 없음)")
            continue
        owned = False
        for spec_id, path, globs, deleted, status in specs:
            if not any(rx.match(f) for _, rx in globs):
                continue
            owned = True
            # 트레일러 면제(§5.5): 동반 요구·상태 차단만 — unowned·글롭 문법은 아래에서 그대로 강제.
            if spec_impact:
                continue
            # 상태 차단(SPEC-008 FR-008): Reviewed 미만(Draft·Planned·enum 밖) 스펙의 소유 코드는
            # 스펙 동반 여부와 무관하게 위반 — 상태 화이트리스트(Draft 문자열 등가 검사가 Planned·
            # 비enum 상태를 흘려보내던 결함 봉합). Status 미선언(레거시)은 통과(점진 도입).
            if status and not can_lead_code(status) and not deleted:
                violations.append((f, spec_id, True, status))
                continue
            if not meaningful(spec_id, path, deleted):
                ids = relaxing_drivers(spec_id, f, meaningful_entries, match_glob)
                if ids:
                    print(f"· cross-spec: {f} → 소유 {spec_id} 변경 동인 {', '.join(ids)}(Change-Driver 선언, 참조 완화)")
                else:
                    violations.append((f, spec_id, False, None))
        if not owned and policy != "silent":
            unowned.append(f)

    # ④b semantic drift 승격(SPEC-019): 리네임된 소유 파일의 스펙은 FR 라인 변경 ∨ Spec-Impact 필요.
    drift_policy = cfg.get("semanticDriftPolicy") or "advisory"

    def fr_line_changed(path):
        rx = re.compile(rf"^[+-].*\*\*(?:{cfg['__reqAlt']})-\d{{3}}[a-z]?\*\*", re.MULTILINE)
        ds = []
        if staged:
            ds.append(_git(cfg, ["diff", "--cached", "--", path]))
        if branch_diff_ok:
            ds.append(_git(cfg, ["diff", f"{base}...HEAD", "--", path]))
        return any(d and rx.search(d) for d in ds)
    triggered = set()
    for nf in renamed:
        if nf in spec_set or nf.startswith(cfg["specDir"] + "/"):
            continue
        if any(rx.match(nf) for rx in exempt):
            continue
        for spec_id, path, globs, deleted, status in specs:
            if any(rx.match(nf) for _, rx in globs):
                triggered.add(spec_id)
    spec_by_id = {s[0]: s for s in specs}
    satisfied = set(sid for sid in triggered
                    if spec_by_id.get(sid) and fr_line_changed(spec_by_id[sid][1]))
    has_spec_impact = False
    if staged and msg_file:
        has_spec_impact = re.search(r"^Spec-Impact:", read_text(msg_file), re.MULTILINE) is not None
    drift_violations, drift_hard_flag, drift_policy_error = escalations(
        triggered, satisfied, has_spec_impact, drift_policy)
    if drift_policy_error:
        print(f"✗ {drift_policy_error}", file=sys.stderr)
        sys.exit(1)
    drift_hard = drift_hard_flag and len(drift_violations) > 0

    # ⑤ 리포트. unowned는 정책대로 — warn은 어디서든 advisory, error는 staged에서만 hard(range는 advisory).
    unowned_hard = policy == "error" and staged and len(unowned) > 0
    mode = "staged(hard)" if staged else f"range(advisory, base:{base})"
    print(f"spec-sync 게이트 — mode:{mode} changed:{len(changed)} specs:{len(specs)}")
    for f in unowned:
        print(f"  {'✗' if unowned_hard else '⚠'} unowned: {f} — 어떤 스펙의 Files에도 매치 안 됨(specSyncUnownedPolicy={policy})")
    if unowned_hard and not violations:
        print("\n✗ unowned 파일(closed-world): 소유 스펙의 Files glob에 편입하거나, 의도적 예외면 specSyncExemptGlobs에 선언하라.",
              file=sys.stderr)
        sys.exit(1)
    # 미지원 glob 문법은 staged(hard)에서 차단(SPEC-013) — range는 advisory 유지(점진 도입 경로).
    glob_hard = staged and len(warned_glob_spec) > 0
    if glob_hard and not violations:
        print("\n✗ Files glob 미지원 문법(§4.1): **·* 만 지원 — 해당 스펙의 Files 글롭을 지원 문법으로 정정하라(매치 실패 = 소유가 조용히 풀림).",
              file=sys.stderr)
        sys.exit(1)
    # semantic drift 승격 리포트(SPEC-019) — 리네임 트리거 스펙에 FR라인/Spec-Impact 부재.
    for sid in drift_violations:
        print(f"  {'✗' if drift_hard else '⚠'} [{sid}] 소유 파일 리네임 — FR 선언 라인 변경 또는 Spec-Impact 사유 필요(semantic drift 승격, policy={drift_policy})")
    if not violations and not drift_hard:
        if spec_impact:
            print(f"spec-sync: Spec-Impact: none — 통과 (사유: {spec_impact}) [트레일러가 커밋에 영속 — 글롭 문법·unowned 정책은 면제 대상 아님]")
        else:
            print("spec-sync: OK (semantic drift advisory — 위 리네임 스펙 본문 재검토 권장)."
                  if drift_violations else
                  "spec-sync: OK — 소유 코드 변경에 스펙 동반됨(또는 대상 없음).")
        sys.exit(0)
    # draftBlockPolicy=hard: range 모드에서도 Draft 위반을 hard로 승격(SPEC-008 FR-007) — 웹 UI 병합이
    # 로컬 commit-msg 훅을 안 타도 CI가 range 모드로 이 게이트를 돌리면 막을 수 있다.
    draft_hard = (not staged) and draft_policy == "hard" and any(d for _, _, d, _ in violations)
    for f, spec_id, draft, status in violations:
        tag = "✗" if (staged or (draft and draft_hard)) else "⚠"
        if draft:
            print(f"  {tag} {f} → 소유 스펙 {spec_id}이 {status} 상태 — Reviewed 이상 승격 전 코드 변경 금지")
        else:
            print(f"  {tag} {f} → 소유 스펙 {spec_id}에 의미 있는 변경 없음(FR/Edge Cases/Change Log)")
    if violations and staged:
        print("\n✗ spec-first 위반: 소유 스펙을 같은 changeset에 갱신하라(스펙 Change Log에 항목 추가). Claude Code는 /speckit.fix.", file=sys.stderr)
        print("  · 스펙을 이미 수정했다면 `git add`로 스테이징했는지 확인(§6.2).", file=sys.stderr)
        if any(d for _, _, d, _ in violations):
            print("  · Reviewed 미만 상태(Draft·Planned·enum 밖)의 스펙은 리뷰(/analyze·/checklist) 기록 후 Status를 Reviewed 이상으로 승격해야 코드 변경 가능(SPEC-008).", file=sys.stderr)
        if unowned_hard:
            print("  · unowned 파일은 Files glob 편입 또는 specSyncExemptGlobs 선언으로 해소(closed-world).", file=sys.stderr)
        print("  · 진짜 스펙 무관이면 커밋 메시지에 `Spec-Impact: none <사유>` 트레일러.", file=sys.stderr)
        sys.exit(1)
    if drift_hard:
        print(f"\n✗ semantic drift(SPEC-019): 리네임된 소유 파일의 스펙 본문을 재검토하고 FR 선언 라인 변경 또는 `Spec-Impact: <사유>` 트레일러를 남겨라 — {', '.join(drift_violations)}.",
              file=sys.stderr)
        sys.exit(1)
    if draft_hard:
        print("\n✗ draftBlockPolicy=hard: Draft 소유 코드 변경은 range 모드에서도 차단된다 — 리뷰(/analyze·/checklist) 후 Status를 Reviewed 이상으로 승격하라(SPEC-008).",
              file=sys.stderr)
        sys.exit(1)
    print("spec-sync: advisory — node scripts/sdd-sync.mjs로 정렬 검토(Claude Code: /sdd-sync·/speckit.fix).")


# ── derivation — 재도출 소스 회계 (check-derivation.mjs 패리티, SPEC-009) ──

def cmd_derivation(cfg):
    if not cfg.get("derivationManifest"):
        print("Derivation 게이트: derivationManifest 미설정 — no-op")
        return
    rel = str(cfg["derivationManifest"])
    try:
        raw = read_text(resolve(cfg, rel))
    except OSError:
        print(f"✗ D0 derivationManifest 파일 없음: {rel}", file=sys.stderr)
        sys.exit(1)
    try:
        data = json.loads(raw)
    except ValueError as e:
        print(f"✗ D0 derivationManifest JSON 파싱 실패: {rel} — {e}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(data, dict):
        print(f"✗ D0 derivationManifest 최상위는 객체여야 함: {rel}", file=sys.stderr)
        sys.exit(1)

    errors = validate_derivation_manifest(data)
    warnings = []

    # 클래스 글롭: DEFAULTS ⊕ 사용자 config(클래스 단위 교체). 미정의 클래스 키는 D1.
    user_globs = cfg.get("derivationClassGlobs") or {}
    for key in user_globs.keys():
        if key not in GLOB_DETECTABLE:
            errors.append(f'D1 derivationClassGlobs 미정의 클래스 "{key}" — {"|".join(GLOB_DETECTABLE)}만 글롭 검출 대상')
    class_globs = {}
    for cls in GLOB_DETECTABLE:
        globs = user_globs.get(cls) or DEFAULTS["derivationClassGlobs"].get(cls) or []
        class_globs[cls] = [compile_glob(g) for g in globs]

    all_files = walk_all_rel(cfg["__root"], cfg)
    detected = {}
    for cls in GLOB_DETECTABLE:
        hits = [f for f in all_files if any(rx.match(f) for rx in class_globs[cls])]
        detected[cls] = (len(hits), hits[0] if hits else None)
    # code: scanDirs에 파일이 하나라도 실재하는가.
    hits = []
    for d in cfg["scanDirs"]:
        for f in walk_all_rel(resolve(cfg, d), cfg, d):
            hits.append(f)
            break
        if hits:
            break
    detected["code"] = (len(hits), hits[0] if hits else None)
    # prior-traceability: scanDirs 테스트 파일의 @covers 태그 실재.
    count, example = 0, None
    for d in cfg["scanDirs"]:
        for f in walk_all_rel(resolve(cfg, d), cfg, d):
            if not is_test_file(os.path.basename(f), cfg):
                continue
            text = read_text_lossy(os.path.join(cfg["__root"], f))
            if cfg["__covers"].search(text):
                count += 1
                if example is None:
                    example = f
    detected["prior-traceability"] = (count, example)

    # D3 교차검사: 검출됐는데 none 선언 = 에러 / mapped 선언인데 검출 0 = 경고(레포 밖 실체 허용).
    counts = {"mapped": 0, "none": 0, "deferred": 0}
    accounted = 0
    for cls in SOURCE_CLASSES:
        v = data.get(cls)
        status = str((v or {}).get("status") or "").strip() if isinstance(v, dict) else ""
        if status not in DERIVATION_STATUS:
            continue
        accounted += 1
        counts[status] += 1
        det = detected.get(cls)
        if det is None:
            continue  # 검출 불가 클래스 — 존재 회계만
        n, example = det
        if status == "none" and n > 0:
            errors.append(f"D3 {cls}: none 선언인데 검출 {n}건(예: {example}) — 스캔 누락(조용한 미인제스트) 금지")
        elif status == "mapped" and n == 0:
            warnings.append(f"{cls}: mapped 선언이나 레포 내 검출 0건 — 레포 밖 실체(evidence로 확인) 또는 정리 대상")

    print(f"Derivation 게이트 — classes:{len(SOURCE_CLASSES)} accounted:{accounted} "
          f"(mapped:{counts['mapped']} none:{counts['none']} deferred:{counts['deferred']}) config:{cfg_tag(cfg)}")
    for w in warnings:
        print(f"  ⚠ {w}")
    if errors:
        print("\nDerivation violations:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    print("Derivation 게이트: OK — 전 소스 클래스 회계됨.")


# ── smokescan — smoke 증거 자동 수집 (sdd-smoke-scan.mjs 패리티, SPEC-010) ──

_VTAG = "@veri" + "fies"  # 자기 소스가 스캔에 걸리지 않게 분절


def _collect_specs(cfg):
    """spec별 선언 FR 수집(fr 게이트와 동일 문법 파생)."""
    spec_dir = resolve(cfg, cfg["specDir"])
    specs = {}
    try:
        names = sorted(os.listdir(spec_dir))
    except OSError:
        return specs
    for f in names:
        if not f.endswith(".md"):
            continue
        m = cfg["__specId"].search(f)
        if not m:
            continue
        text = read_text(os.path.join(spec_dir, f))
        specs[m.group(0)] = set(cfg["__frDecl"].findall(text))
    return specs


def _json_same(a, b):
    return json.dumps(a, ensure_ascii=False, separators=(",", ":")) == \
        json.dumps(b, ensure_ascii=False, separators=(",", ":"))


def cmd_smokescan(cfg, write):
    specs = _collect_specs(cfg)
    scan_dirs = list(dict.fromkeys(cfg.get("smokeScanDirs") or cfg["scanDirs"]))
    manifest_rel = str(cfg["smokeManifest"]) if cfg.get("smokeManifest") else None
    tag_re = re.compile(rf"{_VTAG}\s+((?:{_alt(cfg.get('specIdPrefixes'), DEFAULTS['specIdPrefixes'])})-\d{{3}})/"
                        rf"((?:{cfg['__reqAlt']})-\d{{3}}[a-z]?)\b([^\n]*)")
    rest_re = re.compile(r"^\s+([A-Za-z0-9_-]+)\s*:\s*(\S.*)$")

    errors = []
    by_key = {}
    tag_count = 0
    for d in scan_dirs:
        for f in walk_all_rel(resolve(cfg, d), cfg, d):
            if manifest_rel and f == manifest_rel:
                continue  # 매니페스트 자신은 소스 아님
            try:
                text = read_text_lossy(os.path.join(cfg["__root"], f))
            except OSError:
                continue
            for m in tag_re.finditer(text):
                tag_count += 1
                spec, fr, rest = m.group(1), m.group(2), m.group(3)
                key = f"{spec}/{fr}"
                if spec not in specs or fr not in specs[spec]:
                    errors.append(f"V1 dangling {_VTAG} {key} in {f} — no such FR in {spec}")
                    continue
                r = rest_re.match(rest)
                if not r:
                    errors.append(f'V0 태그 형식 위반 in {f} — "{_VTAG} {key} <method>: <evidence>" 형식이어야 함(빈 값 불가)')
                    continue
                method, body = r.group(1), r.group(2)
                by_key.setdefault(key, {}).setdefault(method, []).append((f, body.strip()))

    # 태그 → 엔트리 (결정적: 경로·본문 정렬 후 " · " 결합, 파일 경로가 provenance).
    tag_entries = {}
    for key in sorted(by_key.keys()):
        methods = by_key[key]
        if len(methods) > 1:
            errors.append(f'V3 "{key}": method 충돌({" vs ".join(sorted(methods.keys()))}) — 한 FR의 태그 method는 하나여야 함')
            continue
        method, sites = next(iter(methods.items()))
        joined = " · ".join(sorted(f"{path} — {text}" for path, text in sites))
        tag_entries[key] = {"method": method, "reason": joined} if method == "deferred" \
            else {"method": method, "evidence": joined}

    if not manifest_rel:
        if tag_count > 0:
            print(f"✗ {_VTAG} 태그 {tag_count}건 발견인데 smokeManifest 미설정 — sdd.config.json에 매니페스트 경로 선언 필요",
                  file=sys.stderr)
            sys.exit(1)
        print(f"Smoke-scan — tags:0 keys:0 manifest:미설정 mode:{'write' if write else 'check'} config:{cfg_tag(cfg)}")
        print("Smoke-scan: no-op — 태그도 매니페스트도 없음.")
        sys.exit(0)
    manifest = {}
    manifest_missing = False
    try:
        raw_m = read_text(resolve(cfg, manifest_rel))
        try:
            manifest = json.loads(raw_m)
        except ValueError as e:
            print(f"✗ M0 smokeManifest JSON 파싱 실패: {manifest_rel} — {e}", file=sys.stderr)
            sys.exit(1)
        if not isinstance(manifest, dict):
            print(f"✗ M0 smokeManifest 최상위는 객체여야 함: {manifest_rel}", file=sys.stderr)
            sys.exit(1)
    except OSError:
        manifest_missing = True
    if manifest_missing and not write:
        if tag_entries:
            errors.append(f"S1 매니페스트 파일 없음({manifest_rel})인데 태그 파생 엔트리 {len(tag_entries)}건 — --write로 생성")
        manifest = {}

    print(f"Smoke-scan — tags:{tag_count} keys:{len(tag_entries)} manifest:{0 if manifest_missing else len(manifest)} "
          f"mode:{'write' if write else 'check'} config:{cfg_tag(cfg)}")

    if errors:
        print("\nSmoke-scan violations:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    if write:
        next_manifest = {}
        added = updated = kept = 0
        for key in sorted(set(list(manifest.keys()) + list(tag_entries.keys()))):
            if key in tag_entries:
                entry = tag_entries[key]
                if key not in manifest:
                    added += 1
                elif not _json_same(manifest[key], entry):
                    updated += 1
                else:
                    kept += 1
                next_manifest[key] = entry
            else:
                next_manifest[key] = manifest[key]
                kept += 1
        with open(resolve(cfg, manifest_rel), "w", encoding="utf-8") as f:
            f.write(json.dumps(next_manifest, ensure_ascii=False, indent=2) + "\n")
        print(f"Smoke-scan: {manifest_rel} 재생성 — added:{added} updated:{updated} kept:{kept}")
        sys.exit(0)

    drift = []
    for key in tag_entries:
        if key not in manifest:
            drift.append(f'S1 "{key}": manifest에 없음(태그 파생 엔트리 누락) — --write로 재생성')
        elif not _json_same(manifest[key], tag_entries[key]):
            drift.append(f'S1 "{key}": 값 불일치(태그 ↔ manifest) — --write로 재생성')
    if drift:
        print("\nSmoke-scan violations:", file=sys.stderr)
        for e in drift:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    print(f"Smoke-scan: OK — 태그 파생 엔트리 {len(tag_entries)}건이 매니페스트와 일치(수동 엔트리 {len(manifest) - len(tag_entries)}건 보존).")


# ── retag — 추적 태그 마이그레이션 (sdd-retag.mjs 패리티, SPEC-011) ──

_CTAG = "@cov" + "ers"  # 자기 소스가 fr 게이트 스캔에 걸리지 않게 분절


def cmd_retag(cfg, map_path, write):
    if not map_path:
        print("usage: sdd-retag <map.json> [--write]", file=sys.stderr)
        sys.exit(2)
    try:
        mapping = json.loads(read_text(map_path))
    except (OSError, ValueError) as e:
        print(f"✗ T0 맵 로드 실패: {map_path} — {e}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(mapping, dict):
        print(f"✗ T0 맵 최상위는 객체여야 함: {map_path}", file=sys.stderr)
        sys.exit(1)
    alt = _alt(cfg.get("specIdPrefixes"), DEFAULTS["specIdPrefixes"])
    key_re = re.compile(rf"^((?:{alt})-\d{{3}})/((?:{cfg['__reqAlt']})-\d{{3}}[a-z]?)$")
    errors = []
    specs = _collect_specs(cfg)
    for old_key, new_key in mapping.items():
        if not key_re.match(old_key):
            errors.append(f'T1 맵 키 형식 위반 "{old_key}" — "SPEC-NNN/FR-NNN" 형식이어야 함')
        if new_key is None:
            continue  # 폐기 선언 — 수동 제거 대상으로 보고
        if not isinstance(new_key, str) or not key_re.match(new_key):
            errors.append(f'T1 맵 값 형식 위반 "{old_key}" → {json.dumps(new_key, ensure_ascii=False)} — "SPEC-NNN/FR-NNN" 또는 null(폐기)')
            continue
        m = key_re.match(new_key)
        if m.group(1) not in specs or m.group(2) not in specs[m.group(1)]:
            errors.append(f'T2 dangling 대상 "{old_key}" → "{new_key}" — no such FR(현재 spec에 실재해야 함)')

    if errors:
        print(f"Retag — map:{len(mapping)}키 mode:{'write' if write else 'dry-run'} config:{cfg_tag(cfg)}")
        print("\nRetag violations:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    dirs = list(dict.fromkeys(list(cfg["scanDirs"]) + list(cfg.get("smokeScanDirs") or [])))
    manifest_rel = str(cfg["smokeManifest"]) if cfg.get("smokeManifest") else None
    plans = []      # (path, line, tag, old, new)
    removals = []   # (path, line, tag, old)
    seen = {k: 0 for k in mapping}
    files = []
    for d in dirs:
        files.extend(walk_all_rel(resolve(cfg, d), cfg, d))
    for f in sorted(set(files)):
        if manifest_rel and f == manifest_rel:
            continue  # 매니페스트 키는 아래에서 별도 처리
        try:
            text = read_text_lossy(os.path.join(cfg["__root"], f))
        except OSError:
            continue
        for i, line in enumerate(text.split("\n")):
            for tag in (_CTAG, _VTAG):
                for old_key, new_key in mapping.items():
                    if not re.search(rf"{re.escape(tag)}\s+{re.escape(old_key)}(?![a-z0-9])", line):
                        continue
                    seen[old_key] += 1
                    if new_key is None:
                        removals.append((f, i + 1, tag, old_key))
                    else:
                        plans.append((f, i + 1, tag, old_key, new_key))
    manifest_plans = []
    manifest = None
    if manifest_rel:
        try:
            manifest = json.loads(read_text(resolve(cfg, manifest_rel)))
        except (OSError, ValueError):
            manifest = None
        if isinstance(manifest, dict):
            for old_key, new_key in mapping.items():
                if old_key not in manifest:
                    continue
                seen[old_key] += 1
                manifest_plans.append((old_key, new_key))
        else:
            manifest = None

    rewrites = len(plans) + sum(1 for _, nk in manifest_plans if nk is not None)
    manual = len(removals) + sum(1 for _, nk in manifest_plans if nk is None)
    print(f"Retag — map:{len(mapping)}키 rewrites:{rewrites} manual-removal:{manual} "
          f"mode:{'write' if write else 'dry-run'} config:{cfg_tag(cfg)}")
    for path, line, tag, old_key, new_key in plans:
        print(f"  · {path}:{line} {tag} {old_key} → {new_key}")
    for old_key, new_key in manifest_plans:
        if new_key is None:
            print(f"  · {manifest_rel} 키 {old_key} → (폐기 — 수동 제거 대상)")
        else:
            print(f"  · {manifest_rel} 키 {old_key} → {new_key}")
    for path, line, tag, old_key in removals:
        print(f"  · {path}:{line} {tag} {old_key} → (폐기 — 수동 제거 대상, 잔존 시 fr 게이트 R1이 차단)")
    for old_key, n in seen.items():
        if n == 0:
            print(f'  ⚠ "{old_key}": 참조 0건 — 이미 이행됐거나 오타')

    if not write:
        print("Retag: dry-run — 적용하려면 --write.")
        sys.exit(0)

    by_file = {}
    for path, line, tag, old_key, new_key in plans:
        by_file.setdefault(path, []).append((tag, old_key, new_key))
    for f, ps in by_file.items():
        path = os.path.join(cfg["__root"], f)
        text = read_text_lossy(path)
        for tag, old_key, new_key in ps:
            text = re.sub(rf"({re.escape(tag)}\s+){re.escape(old_key)}(?![a-z0-9])",
                          lambda m, nk=new_key: m.group(1) + nk, text)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    renames = [(o, n) for o, n in manifest_plans if n is not None]
    if manifest is not None and renames:
        rename = dict(renames)
        next_manifest = {}
        for key in sorted(manifest.keys(), key=lambda k: rename.get(k, k)):
            next_manifest[rename.get(key, key)] = manifest[key]
        with open(resolve(cfg, manifest_rel), "w", encoding="utf-8") as fh:
            fh.write(json.dumps(next_manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Retag: 적용 완료 — 파일 {len(by_file)}개 치환, manifest 키 {len(renames)}건 rename.")


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


RUN_TESTS_ENUM = ("off", "advisory", "hard")


def test_run_verdict(policy, has_command, exit_code):
    """테스트 실행 판정 순수 코어 (SPEC-021, check-test-run.mjs 미러 — 바이트 동일).
    정책 × 명령유무 × exit code → (valid, exit, line)."""
    if policy not in RUN_TESTS_ENUM:
        return False, 1, f'✗ runTestsPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)'
    if policy == "off":
        return True, 0, "테스트 실행 게이트 — runTestsPolicy:off (실행 안 함; 완료 주장 전 commands.test 수동 실행 권장 — 커버리지 회계 ≠ 실행 결과)"
    hard = policy == "hard"
    if not has_command:
        return True, (1 if hard else 0), f"{'✗' if hard else '⚠'} 테스트 실행 게이트 — runTestsPolicy:{policy}인데 commands.test 미선언 — 실행으로 검증 불가(커버리지 회계 ≠ 실행 결과)"
    if exit_code == 0:
        return True, 0, f"테스트 실행 게이트 — commands.test green (runTestsPolicy:{policy})"
    return True, (1 if hard else 0), f"{'✗' if hard else '⚠'} 테스트 실행 게이트 — commands.test 실패 (exit {exit_code}, runTestsPolicy:{policy})"


def cmd_testrun(cfg):
    """`commands.test`(로컬 안전 tier)를 실제 실행해 결과를 판정 (SPEC-021). 러너/언어 중립."""
    policy = cfg.get("runTestsPolicy") or "off"
    cmd = (cfg.get("commands") or {}).get("test")
    exit_code = None
    if policy in ("advisory", "hard") and cmd:
        exit_code = subprocess.run(cmd, shell=True, cwd=cfg["__root"]).returncode
    valid, code, line = test_run_verdict(policy, bool(cmd), exit_code)
    print(line, file=(sys.stdout if valid else sys.stderr))
    sys.exit(code)


MIGRATION_ENUM = ("advisory", "hard")


def schema_drift_verdict(expected, deployed, ran, policy):
    """런타임 스키마 드리프트 판정 (SPEC-022, schema-drift-lib.mjs 미러 — 바이트 동일).
    (코드 기대 vs 배포 실측) 식별자 집합 diff. (valid, exit, drift, line) 반환."""
    if policy not in MIGRATION_ENUM:
        return False, 1, [], f'✗ migrationStatePolicy 값 위반 "{policy}" — advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)'
    hard = policy == "hard"
    if not ran:
        return True, (1 if hard else 0), [], f"{'✗' if hard else '⚠'} 런타임 스키마 드리프트 게이트 — expected/deployed 스키마 조회 실패, 드리프트 판정 불가(조용한 통과 금지 — migrationStatePolicy:{policy})"
    dep = set(deployed or [])
    drift = sorted(set(expected or []) - dep)
    if not drift:
        return True, 0, [], f"런타임 스키마 드리프트 게이트 — 배포 스키마가 코드 기대와 일치(드리프트 없음, migrationStatePolicy:{policy})"
    return True, (1 if hard else 0), drift, f"{'✗' if hard else '⚠'} 런타임 스키마 드리프트 — 코드 기대엔 있으나 배포에 없음: {', '.join(drift)} (migrationStatePolicy:{policy})"


def cmd_schemadrift(cfg):
    """프로젝트가 선언한 expected/deployed 조회 명령을 실행해 스키마 드리프트를 판정 (SPEC-022). DB/ORM 중립."""
    m = cfg.get("schemaDriftManifest")
    if not m or not m.get("expected") or not m.get("deployed"):
        print("런타임 스키마 드리프트 게이트 — schemaDriftManifest 미설정(비활성; DB 스키마 SSOT 프로젝트는 배포 preflight에 expected/deployed 조회 명령 설정 권장)")
        sys.exit(0)
    policy = cfg.get("migrationStatePolicy") or "advisory"
    expected, deployed, ran = [], [], True
    if policy in MIGRATION_ENUM:
        def run_lines(cmd):
            out = subprocess.run(cmd, shell=True, cwd=cfg["__root"], capture_output=True, text=True)
            if out.returncode != 0:
                raise RuntimeError("query failed")
            return [x.strip() for x in out.stdout.split("\n") if x.strip()]
        try:
            expected = run_lines(m["expected"])
            deployed = run_lines(m["deployed"])
        except Exception:  # noqa: BLE001
            ran = False
    valid, code, _drift, line = schema_drift_verdict(expected, deployed, ran, policy)
    print(line, file=(sys.stdout if valid else sys.stderr))
    sys.exit(code)


USAGE = "usage: python sdd_gates.py <fr|ownership|cohesion|completeness|consistency|adequacy|orphan|converge|specsync|derivation|smokescan|retag|run|testrun|schemadrift> [...]"


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
        # base=None이면 cmd_specsync가 env > config specSyncBase > origin/main 순으로 해석(SPEC-003 FR-006).
        cmd_specsync(cfg, staged, msg_file, positional[0] if positional else None)
    elif sub == "derivation":
        cmd_derivation(cfg)
    elif sub == "smokescan":
        cmd_smokescan(cfg, "--write" in args)
    elif sub == "retag":
        cmd_retag(cfg, positional[0] if positional else None, "--write" in args)
    elif sub == "run":
        if len(args) < 2:
            print("usage: python sdd_gates.py run <stage>", file=sys.stderr)
            sys.exit(2)
        cmd_run(cfg, args[1])
    elif sub == "testrun":
        cmd_testrun(cfg)
    elif sub == "schemadrift":
        cmd_schemadrift(cfg)
    else:
        print(f"unknown subcommand: {sub}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
