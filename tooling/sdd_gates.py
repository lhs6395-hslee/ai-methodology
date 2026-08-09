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

import hashlib
import json
import os
import re
import unicodedata
import subprocess
import sys

# ── 판정 타입(verdict-lib.mjs 패리티, SPEC-040) ────────────────────────────────
# 게이트는 "무엇을 했는지"를 산문이 아니라 **타입**으로 말한다. 이 미러가 없으면 Python 런타임
# 프로젝트의 스윕은 여전히 문자열로 추측하고, "off (판정 안 함)"을 초록으로 읽는다.
# 종류는 다섯 개뿐이다 — 늘리면 "이건 어디에 넣지"가 생기고 그 자리가 예외가 된다.
VERDICT_KINDS = ("JUDGED", "OFF", "INERT", "SKIPPED", "UNTYPED")
VERDICT_PREFIX = "판정:"
_VERDICT = None
_VERDICT_QUIET = False


def format_verdict(kind, detail=""):
    k = kind if kind in VERDICT_KINDS else "UNTYPED"
    d = str(detail or "").strip()
    return f"{VERDICT_PREFIX} {k} — {d}" if d else f"{VERDICT_PREFIX} {k}"


def verdict(kind, detail=""):
    global _VERDICT
    _VERDICT = (kind, detail)


def judged(violations=0):
    verdict("JUDGED", f"위반 {violations}건" if violations > 0 else "위반 0건")


def arm_verdict(quiet_when_silent=False):
    """모든 종료 경로에서 판정 줄 하나. sys.exit도 atexit를 탄다.

    os.write(1, …)를 쓰는 이유는 Node판과 같다 — print는 버퍼를 타서 종료 훅에서 유실될 수 있다."""
    global _VERDICT_QUIET
    _VERDICT_QUIET = bool(quiet_when_silent)
    import atexit

    def _emit():
        if _VERDICT is None and _VERDICT_QUIET:
            return
        kind, detail = _VERDICT if _VERDICT else (
            "UNTYPED", "게이트가 판정 종류를 선언하지 않았다(배선 누락 — verdict() 호출 없음)")
        try:
            sys.stdout.flush()
            os.write(1, (format_verdict(kind, detail) + "\n").encode("utf-8"))
        except Exception:
            pass

    atexit.register(_emit)


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
    "e2eFileRegex": [],
    "ownershipCategories": ["Entities", "Surfaces", "Capabilities"],
    "ownershipCategoryRoles": {},
    "assertionPatterns": [
        r"\b(expect|assert|assertEquals|assertThat|should)\b",
        r"\bt\.(Error|Fatal|Errorf|Fatalf)\b",
        r"\b(require|assert)\.",
    ],
    "surfaceGlobs": [],
    "maxKeysPerCategoryPerSpec": 4,
    "maxFRsPerSpec": 8,
    "maxAggregateRootsPerSpec": 1,
    "supportLayerSpecs": {},
    "changeLogFrRefPolicy": "advisory",
    "changeLogNewVerbs": None,
    "changeLogReviseVerbs": None,
    "changeLogRetireVerbs": None,
    "duplicateLogicPolicy": "advisory",
    "duplicateLiteralPatterns": None,
    "duplicateLiteralMinLength": 8,
    "duplicateLiteralFileRegex": None,
    "duplicateLogicAllow": {},
    "duplicateLogicIncludeTests": False,
    "duplicateLogicCommand": None,
    "duplicateLogicTimeoutMs": 120000,
    "duplicateLogicListCap": 12,
    # 검증 **실행** 회계(SPEC-041) — Node DEFAULTS 미러. 값이 갈라지면 런타임에 따라 판정이 달라진다.
    "verificationRunPolicy": "advisory",
    "verificationRunLedger": None,
    "verificationRunListCap": 12,
    "verificationRunTestAssets": None,
    "verificationRunEnvBound": {},
    "liveRealityCoveragePolicy": "advisory",
    "deployArtifactMarkers": None,
    "deployEvidencePatterns": None,
    "deployMarkers": None,
    "coversBacklinkPolicy": "advisory",
    "coversBacklinkListCap": 12,
    "hooksInstalledPolicy": "advisory",
    "syncHookRules": None,
    "syncHookDelegatedTo": "",
    "outOfBandDeployPolicy": "advisory",
    "outOfBandDeployCommands": None,
    "outOfBandDeployDebtFile": ".sdd/deploy-debt.jsonl",
    "deployPreconditionPolicy": "off",
    "deploySmokeCommand": None,
    "deploySmokeTimeoutMs": 60000,
    "scCoveragePolicy": "off",
    "verificationKinds": {},
    "evidenceManifest": None,
    "scCoverageListCap": 12,
    "e2eTestsPolicy": "off",
    "e2ePrecheck": None,
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
    "frAnchorMarkers": {"entity": "E", "surface": "S", "capability": "C"},
    "runTestsPolicy": "off",
    "schemaDriftManifest": None,
    "migrationStatePolicy": "advisory",
    "entitySchemaSources": [],
    "entitySchemaBackingPolicy": "off",
    "entitySchemaExemptEntities": {},
    "policyRatchetPolicy": "advisory",
    "policyRatchetExceptions": [],
    "enginesSources": [],
    "engineRealityPolicy": "off",
    "engineExemptKeys": {},
    "eventCatalogSources": [],
    "eventAttributionPolicy": "off",
    "eventExemptKeys": {},
    "executionEvidencePolicy": "off",
    "executionVerbs": [],
    "browserMarkers": [],
    "browserEvidencePatterns": [],
    "liveRealityChecks": [],
    "liveRealityPolicy": "off",
    "liveRealityTimeoutMs": 120000,
    "preEditSpecFirstPolicy": "advisory",
    "synonymPolicy": "off",
    "synonymRegistry": {},
    "synonymReviewLedger": {},
    "keyPrefixes": [],
    "entitySimilarityCommand": None,
    "entitySimilarityTimeoutMs": 120000,
    "ownershipRequiredPolicy": "advisory",
    "crossCategoryDedupPolicy": "advisory",
    "filesOverlapPolicy": "advisory",
}

CRUD = ["create", "read", "update", "delete", "list"]
STANDARD_PREFIXES = {"SPEC", "INFRA", "TEST", "CICD"}

# 정책 래칫(SPEC-027) — policy-ratchet-lib.mjs 미러. 강도 순위·대상 knob은 byte-parity.
POLICY_RANK = {"off": 0, "silent": 0, "advisory": 1, "warn": 1, "hard": 2, "error": 2}
# 자기포함: policyRatchetPolicy가 목록 선두 — 래칫 자신이 감시 밖이면 off 한 줄로 자폭(감사 A-2).
RATCHETED_POLICIES = [
    "policyRatchetPolicy",
    "specSyncUnownedPolicy", "draftBlockPolicy", "semanticDriftPolicy",
    "capabilityOwnershipPolicy", "frKeyAnchorPolicy", "runTestsPolicy",
    "migrationStatePolicy", "entitySchemaBackingPolicy",
    "symbolRealityPolicy",
    "ownershipRequiredPolicy",
    "crossCategoryDedupPolicy",
    "filesOverlapPolicy",
    "executionEvidencePolicy",
    "liveRealityPolicy",
    "engineRealityPolicy",
    "eventAttributionPolicy",
    "synonymPolicy",
    "e2eTestsPolicy",
    "scCoveragePolicy",
    "hooksInstalledPolicy",
    "outOfBandDeployPolicy",
    "deployPreconditionPolicy",
    "changeLogFrRefPolicy",
    "duplicateLogicPolicy",
    "coversBacklinkPolicy",
    "verificationRunPolicy",
    "liveRealityCoveragePolicy",
]

# 수치 임계도 강제 강도다 — **값을 올리는 것이 완화**다(policy-ratchet-lib.mjs RATCHETED_LIMITS 미러).
RATCHETED_LIMITS = [
    "maxFRsPerSpec",
    "maxKeysPerCategoryPerSpec",
    "maxAggregateRootsPerSpec",
]


def num_of(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None



def rank_of(v):
    return POLICY_RANK.get(str(v))


def effective_ratchet_policy(base_policy, cur_policy):
    """래칫 자신의 강도 — base 시점과 현재 중 강한 쪽(policy-ratchet-lib effectiveRatchetPolicy 미러).
    하향은 base가 심판(워킹트리 한 줄로 판정을 끄지 못한다), 상향은 즉시 반영."""
    b, c = rank_of(base_policy), rank_of(cur_policy)
    if b is None or c is None:
        return cur_policy
    return base_policy if b > c else cur_policy


def classify_ratchet(base_cfg, cur_cfg, exceptions=None):
    """base 대비 cur에서 강도가 낮아진 knob을 분류(policy-ratchet-lib.mjs classifyRatchet 미러).
    반환 (violations, allowed_downgrades) — 각 [{knob, from, to}]."""
    ex = set(exceptions or [])
    violations, allowed = [], []
    for knob in RATCHETED_POLICIES:
        if not base_cfg or knob not in base_cfg:
            continue
        frm = rank_of(base_cfg.get(knob))
        to = rank_of(cur_cfg.get(knob) if cur_cfg else None)
        if frm is None or to is None:
            continue
        if to < frm:
            rec = {"knob": knob, "from": base_cfg.get(knob), "to": cur_cfg.get(knob)}
            (allowed if knob in ex else violations).append(rec)
    for knob in RATCHETED_LIMITS:
        if not base_cfg or knob not in base_cfg:
            continue
        frm = num_of(base_cfg.get(knob))
        to = num_of(cur_cfg.get(knob) if cur_cfg else None)
        if frm is None or to is None:
            continue
        if to > frm:  # 자를 늘리는 것 = 완화
            rec = {"knob": knob, "from": base_cfg.get(knob), "to": cur_cfg.get(knob), "kind": "limit"}
            (allowed if knob in ex else violations).append(rec)
    return violations, allowed


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
    cfg["__e2eRegex"] = [re.compile(s) for s in (cfg.get("e2eFileRegex") or [])]
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
    # 카테고리 역할 파생값(SPEC-001 FR-010) — Node cfg.__roles 미러(판정 코어 공유 단일 소스).
    cfg["__roles"] = resolve_category_roles(cfg.get("ownershipCategories"), cfg.get("ownershipCategoryRoles"))
    return cfg


def resolve(cfg, rel):
    return os.path.join(cfg["__root"], *[p for p in str(rel).split("/") if p])


def rel_from_root(cfg, path):
    return path.replace(cfg["__root"] + os.sep, "")


def is_test_file(name, cfg):
    return any(rx.search(name) for rx in cfg["__testRegex"])


def is_e2e_file(name, cfg):
    return any(rx.search(name) for rx in cfg.get("__e2eRegex", []))


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

def is_placeholder(k):
    """플레이스홀더 판정 — ownership-keys.mjs isPlaceholder 미러.
    값 없음 표기(—·-)와 대괄호로만 둘러싼 자리표시([…]·[TBD]). `[id]/page.tsx`는 정당한 키."""
    t = str(k).strip()
    if not t or t in ("—", "-"):
        return True
    return bool(re.fullmatch(r"\[[^\]]*\]", t))


def split_keys(raw):
    """키 목록을 쉼표로 나눈다 — 괄호 안 쉼표는 구분자 아님(ownership-keys.mjs splitKeys 미러).
    실측 결함: `POST /api/x (SPEC-013), ui:y (SPEC-013, 셸)`가 쓰레기 토큰으로 쪼개졌다."""
    parts, buf, depth = [], "", 0
    for ch in str(raw):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append(buf)
            buf = ""
            continue
        buf += ch
    parts.append(buf)
    return [k.strip() for k in parts if k.strip() and not is_placeholder(k.strip())]


def body_before_ownership(text, heading="Ownership"):
    """Ownership 선언 **앞** 본문만 (ownership-keys.mjs bodyBeforeOwnership 패리티, SPEC-001).

    키가 자기 선언으로 근거를 얻는 것을 막는 공유 경계 — 소비처가 늘면 정본이 하나여야 한다."""
    h = re.search(rf"^##\s+{heading}\b", text or "", re.MULTILINE)
    return (text or "")[: h.start()] if h else (text or "")


def parse_section(text, heading, categories):
    """`## <heading>` 섹션을 카테고리별 키 배열로 — ownership-keys.mjs parseSection 미러.
    카테고리 불릿을 **전부** 수집하고(과거엔 첫 줄만 — 두 번째 불릿·줄바꿈 뒷부분 무음 소실),
    들여쓴 연속 줄을 이어붙이며, 괄호 인식 split을 쓴다."""
    m = re.search(rf"^##\s+{re.escape(heading)}\b", text, re.MULTILINE)
    out = {c: [] for c in categories}
    if not m:
        return out
    after = text[m.start():]
    body = after[after.index("\n") + 1:]
    nxt = re.search(r"^##\s", body, re.MULTILINE)
    block = body[: nxt.start()] if nxt else body
    for cat in categories:
        pat = rf"^[ \t]*-\s*\*\*{re.escape(cat)}\*\*\s*:\s*([\s\S]*?)(?=^[ \t]*-\s*\*\*|\n[ \t]*\n|\Z)"
        keys = []
        for mm in re.finditer(pat, block, re.IGNORECASE | re.MULTILINE):
            flat = re.sub(r"\s*\n[ \t]*", " ", mm.group(1)).strip()
            keys.extend(split_keys(flat))
        out[cat] = keys
    return out


def normalize_key(category, raw, cfg):
    # 유니코드 정규화(NFC) — NFC/NFD 두 표현이 다른 키로 갈리는 중복 누락 차단(Node 미러).
    s = unicodedata.normalize("NFC", str(raw)).strip()
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


def classify_accounting(specs, covered, entries, planned_specs=None, e2e_only=None):
    """FR별 분류(unit > e2e > smoke > deferred > planned > unaccounted) + 카운트.
    e2e_only: 커버 파일이 전부 e2e인 "SPEC/FR" 집합 — 로컬 스위트가 실행하지 않으므로 unit과 섞지 않는다."""
    planned_specs = planned_specs or set()
    e2e_only = e2e_only or set()
    classes = {}
    counts = {"unit": 0, "e2e": 0, "smoke": 0, "deferred": 0, "planned": 0, "unaccounted": 0}
    for spec, frs in specs.items():
        for fr in frs:
            key = f"{spec}/{fr}"
            cls = "unaccounted"
            if fr in covered.get(spec, set()):
                cls = "e2e" if key in e2e_only else "unit"
            elif entries is not None and key in entries:
                cls = "deferred" if entries[key]["method"] == "deferred" else "smoke"
            elif spec in planned_specs:
                cls = "planned"  # SPEC-018: Planned 스펙의 미커버 FR = 의도적 미구현
            classes[key] = cls
            counts[cls] += 1
    return classes, counts


# ── fr — FR↔test 추적 + PREFIX 거버넌스 (check-fr-coverage.mjs) ──

def group_numbers(ids):
    """순수 원형(spec-ID·FR 공용) — "접두어-3자리[소문자서픽스]" ID 집합을 접두어별로 묶는다
    (SPEC-014, numbering-lib.mjs groupNumbers 미러). 반환: 접두어 사전순 dict 리스트
    {prefix, nums(기저 번호 유일·정렬), dup_ids(완전 동일 ID 중복·정렬), min, missing(내부 결번)}.
    severity·문구는 호출자(도메인)가 정한다 — spec-ID의 001미시작은 hard지만 FR은 advisory."""
    by_prefix = {}
    for raw in ids or []:
        m = re.match(r"^([A-Z]+)-(\d{3})([a-z]?)$", str(raw).strip())
        if not m:
            continue
        pfx, num, sfx = m.group(1), m.group(2), m.group(3)
        g = by_prefix.setdefault(pfx, {"seen": set(), "dup": set(), "nums": []})
        full = f"{pfx}-{num}{sfx}"
        (g["dup"] if full in g["seen"] else g["seen"]).add(full)
        g["nums"].append(int(num))
    out = []
    for pfx in sorted(by_prefix):
        g = by_prefix[pfx]
        nums = sorted(set(g["nums"]))
        present = set(nums)
        missing = [n for n in range(nums[0], nums[-1] + 1) if n not in present] if nums else []
        out.append({"prefix": pfx, "nums": nums, "dup_ids": sorted(g["dup"]),
                    "min": nums[0] if nums else None, "missing": missing})
    return out


def numbering_issues(spec_ids, retired_ids=None):
    """접두어별 spec-ID 번호 무결성 (SPEC-014, numbering-lib.mjs 미러 — 바이트 동일).
    hard: 중복 / 001 미시작. advisory: 실제 최소~최대 내부 gap. (hard, advisory) 반환.
    retired_ids: 폐기 기록된 spec-ID — 그 번호의 gap은 정상 retirement gap이라 제외(SPEC-018 FR-006)."""
    retired = {str(s).strip() for s in (retired_ids or [])}
    hard, advisory = [], []
    for g in group_numbers(spec_ids):
        pfx = g["prefix"]
        for d in g["dup_ids"]:
            hard.append(f"{d} 번호 중복 — 같은 접두어·번호가 둘 이상(유일해야 함)")
        uniq = g["nums"]
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
        # retired에 기록된 번호는 정상 retirement gap이라 재보고하지 않음(SPEC-018 FR-006)
        missing = [n for n in g["missing"] if f"{pfx}-{n:03d}" not in retired]
        if missing:
            joined = ", ".join(f"{pfx}-{n:03d}" for n in missing)
            advisory.append(f"{pfx} 번호 중간 gap: {joined} — 제거·retag 잔분(정상일 수 있음)")
    return hard, advisory


# ─── Change Log ↔ FR 실재 대조 (SPEC-037) — changelog-fr-lib.mjs 미러 ───
DEFAULT_CHANGELOG_NEW_VERBS = ["신규", "신설", "추가", "도입"]
DEFAULT_CHANGELOG_REVISE_VERBS = ["개정", "변경", "수정"]
DEFAULT_CHANGELOG_RETIRE_VERBS = ["폐기", "삭제", "제거", "철회"]


def change_log_fr_refs(text, req_alt="FR", id_alt="SPEC", verbs=None):
    """Change Log 표 행의 **선언성** FR 참조를 뽑는다. 반환 (declared: dict[int]->(id,verb), retired: set[int]).
    declared = 신규∨개정(본문이 있어야 하는 것) / retired = 폐기(없어도 정당).
    타 스펙 참조(`SPEC-013/FR-003`·`SPEC-017 FR-004b`)는 내 FR이 아니므로 판정 전에 지운다."""
    verbs = verbs or {}
    neu = verbs.get("neu") or DEFAULT_CHANGELOG_NEW_VERBS
    rev = verbs.get("rev") or DEFAULT_CHANGELOG_REVISE_VERBS
    ret = verbs.get("ret") or DEFAULT_CHANGELOG_RETIRE_VERBS
    declared, retired = {}, set()
    block = section_block(str(text or ""), "Change Log")
    if block is None:
        return declared, retired
    decl_verb = "|".join(re.escape(v) for v in list(neu) + list(rev))
    ret_verb = "|".join(re.escape(v) for v in ret)
    cross_re = re.compile(rf"(?:{id_alt})-\d{{3}}[a-z]?\s*(?:/|의\s*|\s+)(?:{req_alt})-\d{{3}}[a-z]?")
    ref_re = re.compile(
        rf"(?:{req_alt})-(\d{{3}})([a-z]?)((?:\s*[/·,]\s*\d{{3}}[a-z]?)*)\s*\**\s*({decl_verb}|{ret_verb})")
    head = str(req_alt).split("|")[0]
    for raw in block.split("\n"):
        line = raw.strip()
        if not line.startswith("|"):
            continue
        scrubbed = cross_re.sub(" ", re.sub(r"`[^`]*`", " ", line))
        for m in ref_re.finditer(scrubbed):
            nums = [int(m.group(1))]
            for part in re.split(r"[/·,]", m.group(3) or ""):
                part = part.strip()
                if part:
                    nums.append(int(re.sub(r"[a-z]", "", part)))
            verb = m.group(4)
            is_retire = verb in ret
            for n in nums:
                if is_retire:
                    retired.add(n)
                    declared.pop(n, None)
                    continue
                if n in retired:
                    continue
                declared.setdefault(n, (f"{head}-{n:03d}", verb))
    return declared, retired


def change_log_fr_findings(spec_id, declared, fr_ids):
    """선언된 번호가 FR 절에 실재하는가. 반환 [(spec_id, id, verb)] — 번호 순(결정적)."""
    present = set()
    for raw in fr_ids or []:
        m = re.search(r"-(\d{3})[a-z]?$", str(raw).strip())
        if m:
            present.add(int(m.group(1)))
    return [(spec_id, declared[n][0], declared[n][1]) for n in sorted(declared) if n not in present]


# ─── @covers 양방향 결속 (SPEC-039) — covers-backlink-lib.mjs 미러 ───
def evidence_paths_of(line):
    """FR 선언 라인의 `[검증: a, b]` 경로 목록. `[미확인]`·서술형·코드 스팬은 []."""
    s2 = re.sub(r"`[^`]*`", " ", str(line or ""))
    m = re.search(r"\[검증\s*[:：]\s*([^\]]*)\]", s2)
    if not m:
        return []
    return [p.strip() for p in str(m.group(1) or "").split(",") if p.strip()]


# ── 검증 실행 회계 (verification-run-lib.mjs 패리티, SPEC-041) ──
# SPEC-031이 "선언된 증거가 실재하는가"까지 본다면 이 층은 "그것이 돌았는가"를 본다.
# 존재는 실행이 아니다 — 실측 제보에서 검증이 세 번 조용히 사라졌고 게이트는 전부 초록이었다.

def _utc_now_iso():
    """기록 시각(ISO8601 UTC) — 코어는 시계를 읽지 않고 기록기만 읽는다(순수성 경계)."""
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_run_line(raw):
    """원장 한 줄 → {asset,outcome,detail,at} | {malformed,raw,why} | None(빈 줄·주석).

    깨진 줄을 **버리지 않는다** — 버리면 '형식 틀림'이 '기록 안 함'과 같아진다."""
    line = str(raw or "").strip()
    if not line or line.startswith("#"):
        return None
    try:
        o = json.loads(line)
    except Exception:  # noqa: BLE001
        return {"malformed": True, "raw": line, "why": "JSON 아님"}
    if not isinstance(o, dict):
        return {"malformed": True, "raw": line, "why": "객체 아님"}
    asset = str(o.get("asset") or "").strip()
    outcome = str(o.get("outcome") or "").strip().upper()
    detail = str(o.get("detail") or "").strip()
    if not asset:
        return {"malformed": True, "raw": line, "why": "asset 없음"}
    if outcome not in VERDICT_KINDS:
        return {"malformed": True, "raw": line,
                "why": f'outcome "{o.get("outcome")}" — {"|".join(VERDICT_KINDS)} 중 하나'}
    # 포기는 허용하되 침묵은 금지 — 안 본 것을 기록하면서 사유를 안 적으면 기록이 아니다.
    if outcome != "JUDGED" and not detail:
        return {"malformed": True, "raw": line,
                "why": f"{outcome}에 detail(사유) 없음 — 포기는 허용하되 사유 없는 포기는 기록이 아니다"}
    return {"asset": asset, "outcome": outcome, "detail": detail, "at": str(o.get("at") or "").strip()}


def parse_run_ledger(text):
    entries, malformed = [], []
    for raw in str(text or "").split("\n"):
        p = parse_run_line(raw)
        if p is None:
            continue
        (malformed if p.get("malformed") else entries).append(p)
    return entries, malformed


def _run_covers(entry_asset, path, matcher):
    """매칭 폭은 SPEC-031의 증거 경로 인정 폭과 같다 — 정확·디렉토리·글롭."""
    a = entry_asset.rstrip("/")
    if a == path or path.startswith(a + "/"):
        return True
    if re.search(r"[*?\[\]]", entry_asset):
        try:
            return bool(matcher(entry_asset).search(path))
        except Exception:  # noqa: BLE001
            return False
    return False


def classify_runs(evidence_paths, entries, matcher, env_bound=None):
    """반환 (executed, debt, silent). 같은 자산에 여러 기록이면 **마지막이 유효**하다.

    env_bound: {glob: 사유} — "이 환경에서는 돌 수 없다"는 항구적 선언(config). 원장은 gitignore라
    체크아웃마다 사라지므로 그 사실을 담지 못한다. **면제가 아니다** — 실행됨으로 세지 않고
    사유 있는 부채로 계상하며, 실제 기록이 있으면 그쪽이 이긴다."""
    executed, debt, silent = [], [], []
    bounds = list((env_bound or {}).items())
    for path in evidence_paths:
        hit = None
        for e in entries:
            if _run_covers(e["asset"], path, matcher):
                hit = e
        if hit is None:
            bound = next((b for b in bounds
                          if _run_covers(b[0], path, matcher) and str(b[1] or "").strip()), None)
            if bound:
                debt.append((path, {"asset": bound[0], "outcome": "INERT",
                                    "detail": f"{str(bound[1]).strip()} (환경 결속 선언)", "at": ""}))
            else:
                silent.append(path)
        elif hit["outcome"] == "JUDGED":
            executed.append((path, hit))
        else:
            debt.append((path, hit))
    return executed, debt, silent


def verification_run_verdict(policy, silent, malformed):
    """차단하는 것은 침묵과 깨진 기록뿐 — 사유 있는 포기는 어떤 강도에서도 막지 않는다."""
    blocking = policy == "hard" and (len(silent) > 0 or len(malformed) > 0)
    return blocking, len(silent) + len(malformed)


def covers_backlink_findings(tags, evidence, declared, matcher):
    """태그와 FR 검증 목록의 상호 인정 판정. 반환 (findings, counts).
    kind: mismatch(위반) | unlabeled(표기 부채, 위반 아님). 실재하지 않는 FR은 R1의 몫이라 제외."""
    findings = []
    counts = {"matched": 0, "mismatch": 0, "unlabeled": 0}
    seen = set()
    for t in sorted(tags or [], key=lambda x: x["file"] + x["specId"] + x["frId"]):
        key = f"{t['specId']}/{t['frId']}"
        if declared is not None and key not in declared:
            continue
        dedup = f"{t['file']} {key}"
        if dedup in seen:
            continue
        seen.add(dedup)
        paths = (evidence or {}).get(key) or []
        if not paths:
            counts["unlabeled"] += 1
            findings.append({"file": t["file"], "specId": t["specId"], "frId": t["frId"],
                             "kind": "unlabeled", "evidence": []})
            continue
        hit = False
        for p in paths:
            base = p.rstrip("/")
            if p == t["file"] or matcher(p, t["file"]) or t["file"] == base or t["file"].startswith(base + "/"):
                hit = True
                break
        if hit:
            counts["matched"] += 1
            continue
        counts["mismatch"] += 1
        findings.append({"file": t["file"], "specId": t["specId"], "frId": t["frId"],
                         "kind": "mismatch", "evidence": paths})
    return findings, counts


def covers_backlink_verdict(policy, counts):
    pol = str(policy or "off")
    if pol == "off":
        return {"judged": False, "blocking": False}
    return {"judged": True, "blocking": pol == "hard" and (counts.get("mismatch") or 0) > 0}


def fr_numbering_issues(spec_id, fr_ids, declared_nums=None):
    """FR 번호(스펙별 001 연번) 무결성 (SPEC-014, numbering-lib.mjs frNumberingIssues 미러 — 바이트 동일).
    입력은 **한 스펙의** FR 선언 목록(중복 판정에 중복이 필요하므로 set이 아니라 list).
    식별자는 `<SPEC-ID>/FR-NNN`이고 스펙 ID가 이미 네임스페이스라 번호는 스펙 안에서만 유일하면 된다.
    hard: 같은 FR ID 중복(정당한 케이스 없음 — 정책 knob 없이 항상). advisory: 001 미시작·내부 결번."""
    hard, advisory = [], []
    for g in group_numbers(fr_ids):
        pfx = g["prefix"]
        for d in g["dup_ids"]:
            hard.append(f"{spec_id}/{d} FR 번호 중복 — 한 스펙 안에 같은 FR 번호가 둘 이상(스펙 내 유일 필수, SPEC-014). "
                        f"병합이 같은 번호를 양쪽에서 추가했으면 뒤 선언을 새 번호로 옮기고 sdd-retag로 @covers·smokeManifest를 함께 이행")
        if not g["nums"]:
            continue
        if g["min"] != 1:
            advisory.append(f"{spec_id}: {pfx} 번호가 001부터 시작하지 않음 — 최소 {pfx}-{g['min']:03d} "
                            f"(스펙별 001 연번 규칙, SPEC-014)")
        dn = declared_nums or set()
        declared_gap = [n for n in g["missing"] if n in dn]
        plain_gap = [n for n in g["missing"] if n not in dn]
        if declared_gap:
            joined = ", ".join(f"{pfx}-{n:03d}" for n in declared_gap)
            advisory.append(f"{spec_id}: {pfx} 번호 중간 결번: {joined} — **Change Log가 선언했으나 본문 없음**(폐기 잔분이 아니다, SPEC-037)")
        if plain_gap:
            joined = ", ".join(f"{pfx}-{n:03d}" for n in plain_gap)
            advisory.append(f"{spec_id}: {pfx} 번호 중간 결번: {joined} — FR 폐기 잔분일 수 있음(SPEC-018)")
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
    #    "선언"의 범위는 fr_declarations 단일 정의(SPEC-013) — FR 섹션 안 라인 시작(불릿 유무 무관).
    #    전문 스캔은 Change Log의 이관·흡수 이력을 선언으로 집계해 거짓 중복 hard를 냈다(PM 실측 12건).
    specs = {}     # SPEC-ID -> set(FR-ID)
    fr_decls = {}  # SPEC-ID -> [FR-ID,...] 선언 순서 그대로(중복 판정용 — set은 중복을 삼킨다)
    cl_refs = {}   # SPEC-ID -> (declared, retired) — SPEC-037 판정 소스(새 검사·결번 문구 공용)
    fr_evidence = {}   # "SPEC/FR" -> [검증 경로…] (SPEC-039 대조 축)
    cover_tags = []    # {file, specId, frId} — 양방향 결속 판정 입력
    for f in spec_names:
        if not (f.endswith(".md") and any(f.startswith(p + "-") for p in cfg["__prefixes"])):
            continue
        m = cfg["__specId"].search(f)
        if not m:
            continue
        text = read_text(os.path.join(spec_dir, f))
        lst = fr_declarations(text, cfg["__frDecl"], cfg["__reqAlt"])
        fr_decls[m.group(0)] = lst
        specs[m.group(0)] = set(lst)
        for line in text.split("\n"):
            t2 = line.strip()
            if t2.startswith("|"):
                continue
            fr2 = cfg["__frDecl"].search(t2)
            if not fr2:
                continue
            paths2 = evidence_paths_of(t2)
            if paths2:
                fr_evidence[f"{m.group(0)}/{fr2.group(1)}"] = paths2
        cl_refs[m.group(0)] = change_log_fr_refs(text, cfg["__reqAlt"], cfg["__idAlt"], {
            "neu": cfg.get("changeLogNewVerbs"), "rev": cfg.get("changeLogReviseVerbs"),
            "ret": cfg.get("changeLogRetireVerbs")})

    # 1b. FR 번호 무결성(SPEC-014 FR-005/006): 스펙별 001 연번 — 중복 hard, 001미시작·결번 advisory.
    #     FR 선언 파싱은 __frDecl 단일 문법(SPEC-001 FR-009)을 그대로 소비한다(자체 정규식 없음).
    fr_num_hard, fr_num_advisory = [], []
    cl_findings = []
    cl_policy = str(cfg.get("changeLogFrRefPolicy") or "advisory")
    if cl_policy not in ("off", "advisory", "hard"):
        print(f'✗ changeLogFrRefPolicy 값 위반 "{cl_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    for sid in sorted(fr_decls):
        declared, _retired = cl_refs.get(sid, ({}, set()))
        h, a = fr_numbering_issues(sid, fr_decls[sid], set() if cl_policy == "off" else set(declared))
        fr_num_hard.extend(h)
        fr_num_advisory.extend(a)
        if cl_policy != "off":
            cl_findings.extend(change_log_fr_findings(sid, declared, fr_decls[sid]))

    # 2. 테스트 파일의 @covers 수집.
    covered = {}
    cover_seen = set()
    runnable_covered = set()
    bad_refs = []
    for scan in cfg["scanDirs"]:
        for file in walk_tests(resolve(cfg, scan), cfg):
            text = read_text(file)
            for spec, fr in cfg["__covers"].findall(text):
                covered.setdefault(spec, set()).add(fr)
                key = f"{spec}/{fr}"
                cover_tags.append({"file": rel_from_root(cfg, file), "specId": spec, "frId": fr})
                cover_seen.add(key)
                if not is_e2e_file(file, cfg):
                    runnable_covered.add(key)
                if spec not in specs or fr not in specs[spec]:
                    bad_refs.append((file, spec, fr))

    errors, warnings = [], list(prefix_class_warnings)  # 0b의 advisory(미사용 면제·INFRA 검출 0건)
    # FR 번호 무결성(1b) 배선 — 중복은 정책 knob 없이 항상 hard, advisory는 --strict에서만 승격.
    errors.extend(fr_num_hard)
    for a in fr_num_advisory:
        (errors if strict else warnings).append(a)
    for sid, fid, verb in cl_findings:
        msg = (f"[{sid}] Change Log가 {fid} {verb}를 선언했으나 FR 절에 본문 없음 — "
               f'계약을 FR로 착지시키거나, 폐기라면 "{fid} 폐기"로 표기하라(changeLogFrRefPolicy={cl_policy})')
        (errors if (cl_policy == "hard" or strict) else warnings).append(msg)
    # 귀속 분리 — 판정 집합은 워킹트리 전역을 유지하되 커밋 밖 위반은 강도를 낮춘다(오귀속 차단 제거).
    commit_scope = None
    try:
        out2 = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=cfg["__root"],
                              capture_output=True, text=True, check=True).stdout
        staged2 = [x.strip() for x in out2.split("\n") if x.strip()]
        if staged2:
            commit_scope = set(staged2)
    except Exception:  # noqa: BLE001
        commit_scope = None
    for file, spec, fr in bad_refs:
        rel_file = rel_from_root(cfg, file)
        msg = f"R1 dangling @covers {spec}/{fr} in {rel_file} — no such FR in {spec}"
        if commit_scope is not None and rel_file not in commit_scope:
            warnings.append(f"{msg} · **이 커밋 범위 밖**이라 차단하지 않는다(남아 있다 — 그 파일을 커밋할 때 막힌다)")
        else:
            errors.append(msg)

    # R1b: @covers 양방향 결속(SPEC-039) — 실재는 동일성이 아니다.
    bl_policy = str(cfg.get("coversBacklinkPolicy") or "advisory")
    if bl_policy not in ("off", "advisory", "hard"):
        print(f'✗ coversBacklinkPolicy 값 위반 "{bl_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if bl_policy != "off":
        declared_keys = set()
        for sid2, frs2 in specs.items():
            for f2 in frs2:
                declared_keys.add(f"{sid2}/{f2}")

        def _bl_match(pattern, path):
            try:
                return compile_glob(pattern).search(path) is not None
            except Exception:  # noqa: BLE001
                return False

        bl_findings, bl_counts = covers_backlink_findings(cover_tags, fr_evidence, declared_keys, _bl_match)
        bl_v = covers_backlink_verdict(bl_policy, bl_counts)
        bl_cap = int(cfg.get("coversBacklinkListCap") or 12)
        uniq = bl_counts["matched"] + bl_counts["mismatch"] + bl_counts["unlabeled"]
        dedup2 = len(cover_tags) - uniq
        print(f"@covers 결속(coversBacklinkPolicy={bl_policy}): 태그 {len(cover_tags)}건 → 판정 {uniq}건"
              + (f"(같은 파일이 같은 FR을 재태깅한 {dedup2}건은 1건으로 셈)" if dedup2 > 0 else "")
              + f" — 일치 {bl_counts['matched']}·불일치 {bl_counts['mismatch']}·미표기 {bl_counts['unlabeled']}")
        mism = [f for f in bl_findings if f["kind"] == "mismatch"]
        for f in mism[:bl_cap]:
            msg2 = (f"[{f['specId']}/{f['frId']}] {f['file']} — FR의 검증 목록({', '.join(f['evidence'])})이 "
                    "이 파일을 인정하지 않는다: **번호 충돌 의심**(태그와 FR이 서로 다른 것을 말하고 있다)")
            (errors if bl_v["blocking"] else warnings).append(msg2)
        if len(mism) > bl_cap:
            (errors if bl_v["blocking"] else warnings).append(
                f"@covers 결속 불일치 … 외 {len(mism) - bl_cap}건 (coversBacklinkListCap 상향으로 확인)")
        if bl_counts["unlabeled"]:
            print(f"  · backlink 미표기 {bl_counts['unlabeled']}건(부채·비차단) — 해당 FR에 `[검증: <경로>]`가 "
                  "없어 대조할 축이 없다. 표기하면 그 FR은 이 검사의 보호를 받는다.")
        if not mism:
            print("  ✓ 결속 불일치 0건 — 태그와 FR이 서로를 인정한다(미표기는 위 별도 집계).")

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
    e2e_only = {k for k in cover_seen if k not in runnable_covered}
    acct_classes, acct_counts = (classify_accounting(specs, covered, manifest, planned_specs, e2e_only)
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

    if accounting_active and acct_counts["e2e"] > 0:
        axis = str(cfg.get("e2eTestsPolicy") or "off")
        lst = sorted(k for k, c in acct_classes.items() if c == "e2e")
        if axis == "off":
            more = f" 외 {len(lst) - 8}건" if len(lst) > 8 else ""
            warnings.append(f"⚠ e2e-only {acct_counts['e2e']}건 — e2e로만 커버돼 실행 검증하는 게이트가 없다(e2eTestsPolicy:off). "
                            f"commands.e2e 선언 후 정책을 켜거나, 실행 불가면 evidence로 회계하라: {', '.join(lst[:8])}{more}")
        else:
            warnings.append(f"· e2e-only {acct_counts['e2e']}건 — e2e 실행 축(e2eTestsPolicy:{axis})이 판정한다")

    total_fr = sum(len(s) for s in specs.values())
    total_cov = sum(len(s) for s in covered.values())
    mode = "strict" if strict else "incremental"
    acct_tag = (f" accounted(unit:{acct_counts['unit']} e2e:{acct_counts['e2e']} smoke:{acct_counts['smoke']}"
                f" deferred:{acct_counts['deferred']} planned:{acct_counts['planned']} unaccounted:{acct_counts['unaccounted']})"
                if accounting_active else "")
    if not specs:
        verdict("INERT", "판정 대상 스펙 0건 — specDir에서 FR 선언을 찾지 못했다")
    else:
        judged(len(errors))
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

def resolve_category_roles(categories, roles):
    """카테고리 → 역할 해석(SPEC-001 FR-010) — ownership-keys.mjs resolveCategoryRoles 미러.
    선언 우선(대소문자 무관 카테고리 매칭) → 미선언 역할만 이름 정규식 폴백(하위호환).
    반환 {"entity":..., "surface":..., "capability":...} (각 카테고리명 or None)."""
    cats = categories or []
    # engine·event(SPEC-030)는 선언 전용(이름 폴백 없음) — 옵트인이라 미선언 시 항상 inert.
    out = {"entity": None, "surface": None, "capability": None, "engine": None, "event": None}
    for cat, role in (roles or {}).items():
        r = str(role or "").strip().lower()
        if r not in out:
            continue  # 미지의 역할은 무시 — 오타가 판정을 뒤집지 않게
        match = next((c for c in cats if str(c).strip().lower() == str(cat).strip().lower()), None)
        if match and not out[r]:
            out[r] = match
    for role, pat in (("entity", "entit"), ("surface", "surface"), ("capability", "capabilit")):
        if not out[role]:
            out[role] = next((c for c in cats if re.search(pat, c, re.IGNORECASE)), None)
    return out


def capability_check_active(roles):
    """entity·capability류 카테고리가 둘 다 있을 때만 활성(SPEC-024, capability-ownership-lib 미러)."""
    return bool(roles and roles.get("entity") and roles.get("capability"))


def capability_inert_reasons(policy, roles):
    """정책이 off가 아닌데 판정이 성립하지 않는 사유(capability-ownership-lib capabilityInertReasons 미러).
    빈 목록 = 판정 성립 ∨ 명시적 off. 침묵 금지 — hard 선언 + 무판정은 거짓 안전(감사 A-1)."""
    if policy == "off":
        return []
    reasons = []
    if not (roles and roles.get("entity")):
        reasons.append("entity 역할 카테고리 미해석(ownershipCategoryRoles에 entity 선언 없음 + 이름 폴백 실패)")
    if not (roles and roles.get("capability")):
        reasons.append("capability 역할 카테고리 미해석(ownershipCategoryRoles에 capability 선언 없음 + 이름 폴백 실패)")
    return reasons


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


def schema_backing_active(policy, sources, roles):
    """정책 on + 스키마 소스 선언 + Entities류 카테고리 존재일 때만 활성(SPEC-026, schema-backing-lib 미러)."""
    return policy != "off" and isinstance(sources, list) and len(sources) > 0 \
        and bool(roles and roles.get("entity"))


def schema_backing_inert_reasons(policy, sources, roles):
    """정책이 off가 아닌데 판정이 성립하지 않는 사유(schema-backing-lib schemaBackingInertReasons 미러).
    빈 목록 = 판정 성립 ∨ off. 정책 전체의 inert도 FR-005(개별 면제)와 동형으로 표면화한다."""
    if policy == "off":
        return []
    reasons = []
    if not isinstance(sources, list) or len(sources) == 0:
        reasons.append("entitySchemaSources 비어 있음(구조 SSOT 어댑터 미선언 — 대조할 실재 집합이 없음)")
    if not (roles and roles.get("entity")):
        reasons.append("entity 역할 카테고리 미해석(ownershipCategoryRoles에 entity 선언 없음 + 이름 폴백 실패)")
    return reasons


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


def schema_backing_findings(owned_by_spec, schema_set, exempt_set, slug_by_spec=None):
    """소유 entity가 스키마 집합(∪ 면제 ∪ 모듈 문법)에 없으면 위반. 반환 [(spec_id, entity)] (선언 순).

    slug_by_spec: spec_id → 스펙 파일명 슬러그. 모듈 문법(SPEC-029 ①)이 선언된 레포에서
    쓴다 — 전역 집합이 아니라 **스펙별** 대조라야 슬러그 뒤바뀜을 잡는다. None이면 종전 동일.
    """
    findings = []
    for spec_id, entities in owned_by_spec or []:
        slug = (slug_by_spec or {}).get(spec_id)
        for raw in entities or []:
            ent = str(raw).strip().lower()
            if not ent or ent in ("—", "-"):
                continue
            if ent in schema_set:
                continue
            if exempt_set and ent in exempt_set:
                continue
            if slug and ent == slug:
                continue
            findings.append((spec_id, ent))
    return findings


# ─── Engines & Events (SPEC-030) — engine-event-lib.mjs 미러 ───
def role_active(policy, sources, role_cat):
    return policy != "off" and isinstance(sources, list) and len(sources) > 0 and bool(role_cat)


def role_inert_reasons(policy, sources, role_cat, sources_knob, role_name):
    if policy == "off":
        return []
    reasons = []
    if not isinstance(sources, list) or len(sources) == 0:
        reasons.append(f"{sources_knob} 비어 있음({role_name} SSOT 어댑터 미선언 — 대조할 실재 집합이 없음)")
    if not role_cat:
        reasons.append(f"{role_name} 역할 카테고리 미해석(ownershipCategoryRoles에 {role_name} 선언 없음 — engine/event는 선언 전용)")
    return reasons


def reality_findings(owned_by_spec, ssot_set, exempt_set):
    findings = []
    for spec_id, keys in owned_by_spec or []:
        for raw in keys or []:
            k = str(raw).strip().lower()
            if not k or k in ("—", "-"):
                continue
            if k in ssot_set:
                continue
            if exempt_set and k in exempt_set:
                continue
            findings.append((spec_id, k))
    return findings


def split_event_key(raw):
    s = str(raw).strip().lower()
    i = s.find(".")
    return (None, s) if i < 0 else (s[:i], s[i + 1:])


def event_attribution_findings(owned_events_by_spec, owned_entities_by_spec):
    findings = []
    for spec_id, keys in owned_events_by_spec or []:
        owned = set((owned_entities_by_spec or {}).get(spec_id) or [])
        for raw in keys or []:
            k = str(raw).strip().lower()
            if not k or k in ("—", "-"):
                continue
            entity, _ = split_event_key(k)
            if not entity or entity not in owned:
                findings.append((spec_id, k, entity))
    return findings


# ─── 동의어·형태 변이 (SPEC-033) — synonym-lib.mjs 미러 ───
_KEEP_SUFFIX = re.compile(r"(ss|us|is|os)$", re.I)


def singularize(word):
    w = str(word or "")
    if len(w) <= 3 or _KEEP_SUFFIX.search(w):
        return w
    if re.search(r"ies$", w, re.I):
        return re.sub(r"ies$", "y", w, flags=re.I)
    if re.search(r"(ches|shes|xes|zes|ses)$", w, re.I):
        return re.sub(r"es$", "", w, flags=re.I)
    if re.search(r"s$", w, re.I):
        return re.sub(r"s$", "", w, flags=re.I)
    return w


def canonical_form(key, prefixes=None):
    raw = str(key or "").strip()
    if not raw:
        return ""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", raw)
    tokens = [t.lower() for t in re.split(r"[\s._\-/]+", spaced) if t]
    pfx = set(str(p).lower() for p in (prefixes or []))
    body = [t for i, t in enumerate(tokens) if not (i == 0 and t in pfx)]
    kept = body if body else tokens
    return "_".join(singularize(t) for t in kept)


def lexical_collisions(owned, prefixes=None):
    by_canon = {}
    for o in owned or []:
        c = canonical_form(o["key"], prefixes)
        if not c:
            continue
        by_canon.setdefault(c, []).append(o)
    out = []
    for canonical in sorted(by_canon.keys()):
        members = by_canon[canonical]
        if len(set(str(m["key"]).strip().lower() for m in members)) > 1:
            out.append({"canonical": canonical, "members": members})
    return out


def entity_set_fingerprint(keys):
    norm = sorted(set(str(k).strip().lower() for k in (keys or [])))
    return {"count": len(norm), "hash": hashlib.sha1("\n".join(norm).encode("utf-8")).hexdigest()[:12]}


def parse_candidate_header(stdout):
    for line in str(stdout or "").split("\n"):
        m = re.match(r"^\s*#\s*entity-set:\s*(\d+)\s+([0-9a-fA-F]{6,40})\s*$", line)
        if m:
            return {"count": int(m.group(1)), "hash": m.group(2).lower()}
    return None


def candidate_freshness(declared, current):
    if not declared:
        return {"kind": "undeclared"}
    if declared["hash"] != current["hash"]:
        return {"kind": "stale", "declared": declared, "current": current}
    return None


def validate_synonym_registry(registry, owned_keys):
    errors, alias_owner = [], {}
    for canonical, entry in (registry or {}).items():
        c = str(canonical).strip().lower()
        aliases = (entry or {}).get("aliases") or []
        reason = str((entry or {}).get("reason") or "").strip()
        if not reason:
            errors.append(f'synonymRegistry["{canonical}"] — 통합 사유 필요(빈 값 불가: 왜 같은 개념인가)')
        if not isinstance(aliases, list) or not aliases:
            errors.append(f'synonymRegistry["{canonical}"] — aliases 최소 1개 필요')
        if owned_keys and c not in owned_keys:
            errors.append(f'synonymRegistry["{canonical}"] — 정본 키가 어느 스펙에도 소유되지 않음(실재하지 않는 정본 선언 금지)')
        for a in aliases:
            al = str(a).strip().lower()
            if al == c:
                errors.append(f'synonymRegistry["{canonical}"] — 별칭 "{a}"가 정본과 동일')
                continue
            if al in alias_owner and alias_owner[al] != c:
                errors.append(f'별칭 "{al}"가 두 정본에 걸림("{alias_owner[al]}" vs "{c}") — 모순 선언')
            alias_owner[al] = c
    return errors


def declared_synonym_findings(owned, registry):
    alias_map = {}
    for canonical, entry in (registry or {}).items():
        for a in (entry or {}).get("aliases") or []:
            alias_map[str(a).strip().lower()] = str(canonical).strip().lower()
    out = []
    for o in owned or []:
        k = str(o["key"]).strip().lower()
        if k in alias_map:
            out.append({"specId": o["specId"], "category": o["category"], "key": k, "canonical": alias_map[k]})
    return out


def parse_candidate_pairs(stdout):
    out, seen = [], set()
    for line in str(stdout or "").split("\n"):
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\t|\||,", t) if p.strip()]
        if len(parts) < 2:
            continue
        x, y = sorted([parts[0].lower(), parts[1].lower()])
        if x == y:
            continue
        key = f"{x}::{y}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"a": x, "b": y, "score": parts[2] if len(parts) > 2 else ""})
    return out


def classify_candidates(pairs, registry, ledger):
    same = set()
    for canonical, entry in (registry or {}).items():
        c = str(canonical).strip().lower()
        for a in (entry or {}).get("aliases") or []:
            same.add("::".join(sorted([c, str(a).strip().lower()])))
    rejected = set("::".join(sorted([p.strip().lower() for p in str(k).split("::")])) for k in (ledger or {}).keys())
    unresolved, by_reg, by_led = [], 0, 0
    for p in pairs or []:
        key = f"{p['a']}::{p['b']}"
        if key in same:
            by_reg += 1
        elif key in rejected:
            by_led += 1
        else:
            unresolved.append(p)
    return {"unresolved": unresolved, "resolvedByRegistry": by_reg, "resolvedByLedger": by_led}


def validate_ledger(ledger):
    errors = []
    for pair, reason in (ledger or {}).items():
        if "::" not in str(pair):
            errors.append(f'synonymReviewLedger["{pair}"] — 키 형식은 "keyA::keyB"')
        if not str(reason or "").strip():
            errors.append(f'synonymReviewLedger["{pair}"] — 기각 사유 필요(빈 값 불가: 왜 다른 개념인가)')
    return errors


# ─── 실행 증거 (SPEC-031) — evidence-lib.mjs 미러 ───
DEFAULT_EXECUTION_VERBS = [
    "렌더", "응답", "동작", "표시", "기동", "구동", "수신", "전송",
    "renders", "render", "responds", "respond", "displays", "display", "serves", "serve", "works",
]
DEFAULT_BROWSER_MARKERS = [
    "대시보드", "dashboard", "화면", "브라우저", "browser", "패널", "panel", "페이지", "page", "UI",
]
DEFAULT_BROWSER_EVIDENCE_PATTERNS = ["e2e", "playwright", "cypress", "puppeteer", "selenium", "browser"]

# 배포 등급 증거(evidence-lib.mjs 패리티) — "단위테스트 통과"와 "배포본에서 실제 실행됨"은 다른 사실이다.
# 실측(2026-08-10 qa에이전트): 아치 불일치·이미지 안 모듈 누락은 단위테스트 100% 통과해도 남는다.
DEFAULT_DEPLOY_EVIDENCE_PATTERNS = ["smoke", "e2e", "live", "deploy", "runbook", "canary", "staging"]
DEFAULT_DEPLOY_MARKERS = [
    "이미지", "컨테이너", "레지스트리", "배포", "파이프라인", "스테이지", "클러스터", "노드",
    "image", "container", "registry", "deploy", "pipeline", "stage", "cluster", "node", "helm",
]


def is_deploy_grade_evidence(path, patterns):
    p = str(path or "").lower()
    return any(str(x).lower() in p for x in (patterns if patterns else DEFAULT_DEPLOY_EVIDENCE_PATTERNS))


_ASCII_ONLY = re.compile(r"^[\x00-\x7F]+$")


def marker_hits(haystack, marker):
    """ASCII 마커는 **단어 경계**로만 맞춘다(evidence-lib.mjs markerHits 미러).
    부분일치는 page→TicketPackage, UI→REQUIRED 같은 대량 오탐을 낸다(실측 제보).
    한글 마커는 교착어라 경계가 성립하지 않고 실측 충돌도 없어 부분일치 유지."""
    m = str(marker or "").lower()
    if not m:
        return False
    s = str(haystack or "").lower()
    if not _ASCII_ONLY.match(m):
        return m in s
    return bool(re.search(r"(^|[^a-z0-9])" + re.escape(m) + r"([^a-z0-9]|$)", s))


def parse_evidence_tag(line):
    # 코드 스팬(`...`)은 인용이지 주장이 아니다(evidence-lib.mjs 미러).
    s = re.sub(r"`[^`]*`", " ", str(line or ""))
    if re.search(r"\[미확인\]", s):
        return {"kind": "unknown", "paths": []}
    m = re.search(r"\[검증\s*([:：])?\s*([^\]]*)\]", s)
    if not m:
        return None
    sep, body = m.group(1), (m.group(2) or "").strip()
    if sep:
        paths = [p.strip() for p in body.split(",") if p.strip()]
        return {"kind": "exec", "paths": paths} if paths else {"kind": "bare", "paths": []}
    if not body:
        return {"kind": "bare", "paths": []}
    return {"kind": "self", "paths": []}


def has_execution_verb(line, verbs):
    s = str(line or "").lower()
    vs = verbs if verbs else DEFAULT_EXECUTION_VERBS
    return any(str(v).lower() in s for v in vs)


def is_browser_grade_evidence(path, patterns):
    s = str(path or "").lower()
    ps = patterns if patterns else DEFAULT_BROWSER_EVIDENCE_PATTERNS
    return any(str(p).lower() in s for p in ps)


def evidence_findings(units, asset_exists, verbs=None, browser_markers=None, browser_patterns=None,
                      manifest_of=None, deploy_markers=None, deploy_patterns=None):
    vs = verbs if verbs else DEFAULT_EXECUTION_VERBS
    bpat = browser_patterns if browser_patterns else DEFAULT_BROWSER_EVIDENCE_PATTERNS
    bmark = browser_markers if browser_markers else DEFAULT_BROWSER_MARKERS
    dpat = deploy_patterns if deploy_patterns else DEFAULT_DEPLOY_EVIDENCE_PATTERNS
    dmark = deploy_markers if deploy_markers else DEFAULT_DEPLOY_MARKERS
    man_of = manifest_of if callable(manifest_of) else (lambda s, c: None)
    out = []
    for u in units or []:
        for c in u.get("claims") or []:
            tag = parse_evidence_tag(c["text"])
            # 본문 ↔ 매니페스트 대조(deferred는 `[미확인]`과 같은 말이라 모순 아님)
            man = man_of(u["specId"], c["id"])
            if man and str(man.get("method") or "") != "deferred":
                if tag and tag["kind"] == "unknown":
                    out.append((u["specId"], c["id"], c["kind"], "unknown-vs-manifest",
                                f"본문은 `[미확인]`인데 {man['source']}는 실측 증거를 주장한다({man.get('method')}) — "
                                "둘 중 하나가 낡았다: 증거가 진짜면 본문을 `[검증: <경로>]`로 올리고, 아니면 매니페스트 엔트리를 지우거나 deferred+사유로 내려라"))
                elif tag and tag["kind"] == "exec":
                    out.append((u["specId"], c["id"], c["kind"], "manifest-vs-tag",
                                f"본문에 실행 증거 `[검증: {', '.join(tag['paths'])}]`가 있는데 {man['source']}에도 엔트리가 있다({man.get('method')}) — "
                                "매니페스트는 **실행할 수 없는 검증**의 회계 수단이다. 이중 회계이거나 매니페스트가 낡았다"))
            if tag and tag["kind"] == "bare":
                out.append((u["specId"], c["id"], c["kind"], "bare-tag",
                            "경로 없는 `[검증]` — 실행 증거 자산 경로를 적어라(`[검증: tests/e2e/x.e2e.ts]`)"))
                continue
            if tag and tag["kind"] == "exec":
                for p in tag["paths"]:
                    if not asset_exists(p):
                        out.append((u["specId"], c["id"], c["kind"], "missing-asset", f"증거 자산 없음: {p}"))
                low = str(c["text"] or "").lower()
                if any(marker_hits(low, m) for m in bmark) and not any(is_browser_grade_evidence(p, bpat) for p in tag["paths"]):
                    out.append((u["specId"], c["id"], c["kind"], "browser-needs-ui-evidence",
                                f"UI/브라우저 대상인데 증거가 브라우저 등급 아님({', '.join(tag['paths'])}) — API 단독 검증은 변수 보간·렌더 단계 결함을 통과시킨다"))
                # 트리거는 **소유 + 주장** 둘 다다 — 마커만 걸면 배포를 *다루는* 스펙까지 잡힌다.
                if (u.get("ownsDeployArtifact")
                        and any(marker_hits(low, m) for m in dmark)
                        and not any(is_deploy_grade_evidence(p, dpat) for p in tag["paths"])):
                    out.append((u["specId"], c["id"], c["kind"], "deploy-needs-live-evidence",
                                f"배포 산출물 대상인데 증거가 배포 등급 아님({', '.join(tag['paths'])}) — 저장소 안 단위테스트는 배포본의 아치·이미지 내용·전제 자원에 닿지 않는다(smoke·e2e·live·runbook 등급 증거 또는 실행 원장 기록으로 올려라)"))
                continue
            if c["kind"] == "SC" and has_execution_verb(c["text"], vs):
                out.append((u["specId"], c["id"], c["kind"], "exec-verb-no-evidence",
                            "실행 동사를 주장하는데 실행 등급 증거(`[검증: <경로>]`)가 없다 — 자기신고는 실행 등급이 아니다"))
    return out


# ─── 라이브 대조 (SPEC-032) — live-reality-lib.mjs 미러 ───
CHECK_KINDS = ["terraform", "kubernetes", "ownership", "custom"]


# ── 라이브 대조 등록 축(live-reality-lib.mjs 패리티, SPEC-032 확장) ──
# 실측 제보(2026-08-10 qa에이전트): 배포 산출물 결함 8건을 **배포로 하나씩** 발견했다. R9 틀은
# 있었지만 검사 6건에 그 중 하나도 없었고, 새 산출물을 선언해도 대응 검사 없이 게이트가 통과했다.
# 등록은 순수 선언 대조라 오프라인에서도 판정된다 — 실행 축과 정책을 분리하는 이유다.
RECOMMENDED_DEPLOY_ARTIFACT_MARKERS = [
    "image", "container", "registry", "ecr", "gcr", "acr", "docker",
    "deployment", "statefulset", "daemonset", "cronjob", "k8s", "kubernetes", "helm",
    "lambda", "function", "service", "ingress", "pipeline", "stage", "workflow", "job",
]


def is_deploy_artifact(key, markers):
    k = str(key or "").lower()
    return any(str(m).lower() in k for m in (markers or []))


def _check_covers(check, key, matcher):
    """담당 선언(covers) 없는 검사는 아무것도 커버하지 않는다 — 그걸 커버로 세면
    '검사가 하나라도 있으면 통과'가 되고, 그게 제보가 지적한 상태다."""
    covers = check.get("covers") if isinstance(check, dict) else None
    if not isinstance(covers, list):
        return False
    k = str(key or "").strip().lower()
    for c in covers:
        pat = str(c or "").strip()
        if not pat:
            continue
        if pat.lower() == k:
            return True
        if re.search(r"[*?]", pat):
            try:
                if matcher(pat).search(str(key)):
                    return True
            except Exception:  # noqa: BLE001
                pass
    return False


def live_reality_coverage(declared, checks, markers, matcher):
    """반환 (covered, uncovered, scanned). declared: [(spec_id, key)]"""
    covered, uncovered, scanned = [], [], 0
    for spec_id, key in declared or []:
        if not is_deploy_artifact(key, markers):
            continue
        scanned += 1
        by = next((c for c in (checks or []) if _check_covers(c, key, matcher)), None)
        if by:
            covered.append((spec_id, key, str(by.get("id") or "")))
        else:
            uncovered.append((spec_id, key))
    return covered, uncovered, scanned


def live_reality_coverage_verdict(policy, uncovered):
    return policy == "hard" and len(uncovered) > 0, len(uncovered)


def validate_checks(checks):
    errors, seen = [], set()
    for i, c in enumerate(checks or []):
        cid = str((c or {}).get("id") or "").strip()
        if not cid:
            errors.append(f"liveRealityChecks[{i}] — id 필요(빈 값 불가)")
            continue
        if cid in seen:
            errors.append(f'liveRealityChecks[{i}] — id "{cid}" 중복(유일해야 함)')
        seen.add(cid)
        if not str((c or {}).get("command") or "").strip():
            errors.append(f'liveRealityChecks[{i}] "{cid}" — command 필요(빈 값 불가)')
        kind = str((c or {}).get("kind") or "custom").strip()
        if kind not in CHECK_KINDS:
            errors.append(f'liveRealityChecks[{i}] "{cid}" — 알 수 없는 kind "{kind}"({"|".join(CHECK_KINDS)})')
        if isinstance(c, dict) and c.get("covers") is not None and not isinstance(c.get("covers"), list):
            errors.append(f'liveRealityChecks[{i}] "{cid}" — covers는 배열이어야 한다(담당 산출물 키·글롭 목록)')
    return errors


def classify_result(raw):
    cid = str((raw or {}).get("id") or "")
    label = str((raw or {}).get("label") or cid)
    kind = str((raw or {}).get("kind") or "custom")
    code = (raw or {}).get("exitCode")
    if code != 0:
        lines = [l for l in str((raw or {}).get("stderr") or "").strip().split("\n") if l.strip()]
        why = lines[-1] if lines else f"명령이 exit {code if code is not None else '?'}로 종료"
        return {"id": cid, "label": label, "kind": kind, "status": "skipped", "items": [], "reason": why}
    items = [l.strip() for l in str((raw or {}).get("stdout") or "").split("\n") if l.strip()]
    return {"id": cid, "label": label, "kind": kind,
            "status": "violations" if items else "clean", "items": items, "reason": ""}


def summarize_live(results):
    out = {"clean": 0, "violations": 0, "skipped": 0, "items": 0}
    for r in results or []:
        if r["status"] == "violations":
            out["violations"] += 1
            out["items"] += len(r.get("items") or [])
        elif r["status"] == "skipped":
            out["skipped"] += 1
        else:
            out["clean"] += 1
    return out


# ─── 소유 키 실재 판정의 두 문법 (SPEC-029) — Node판 ownership-reality-lib.mjs 미러 ───
def spec_slug(filename):
    """`<PREFIX>-NNN[a]-<slug>.md` → `<slug>`(소문자). 접두어 없으면 확장자만 제거."""
    base = re.sub(r"^.*[/\\]", "", str(filename or ""))
    base = re.sub(r"\.md$", "", base, flags=re.I)
    m = re.match(r"^[A-Za-z]+-\d{3}[a-z]?-(.+)$", base)
    return (m.group(1) if m else base).strip().lower()


def spec_slug_source_declared(sources):
    return any(str((s or {}).get("kind", "")) == "spec-slug" for s in (sources or []))


def symbol_reality_active(policy, roots, roles):
    return policy != "off" and bool(roots) and bool((roles or {}).get("surface"))


def symbol_reality_inert_reasons(policy, roots, roles):
    if policy == "off":
        return []
    reasons = []
    if not roots:
        reasons.append("ownershipSourceRoots 비어 있음(소스 루트 미선언 — 대조할 실재 집합이 없음)")
    if not (roles or {}).get("surface"):
        reasons.append("surface 역할 카테고리 미해석(ownershipCategoryRoles에 surface 선언 없음 + 이름 폴백 실패)")
    return reasons


def is_file_like_surface(key):
    s = str(key or "").strip()
    if not s or s in ("—", "-"):
        return False
    if re.search(r"\s", s):
        return False
    if re.match(r"^[a-z]+:", s, flags=re.I):
        return False
    return not s.startswith("/")


def symbol_candidates(key):
    """심볼 키가 실재로 인정될 수 있는 후보 표기(결정적 변환만) — Node판 미러.

    점 표기 모듈 경로(`src.cli.x`)를 경로(`src/cli/x`)와 basename(`x`)으로도 본다.
    Python·Java의 표준 모듈 문법이라 휴리스틱이 아니다(실측: finops 오탐률 100% 원인).
    """
    k = str(key or "").strip().lower()
    if not k:
        return []
    out = [k]
    if "." in k and "/" not in k:
        out.append(k.replace(".", "/"))
    return out


def symbol_reality_findings(owned_by_spec, real_set):
    findings = []
    for spec_id, surfaces in owned_by_spec or []:
        for raw in surfaces or []:
            key = str(raw).strip().lower()
            if not key or key in ("—", "-"):
                continue
            if not any(c in real_set for c in symbol_candidates(key)):
                findings.append((spec_id, key))
    return findings


def cmd_ownership(cfg, strict):
    categories = cfg["ownershipCategories"]
    roles = cfg["__roles"]
    ent_cat = roles["entity"] or categories[0]
    # Capability 귀속(SPEC-024) — 스펙 경계는 entity 기준: capability x.verb는 entity x 소유 스펙만.
    cap_cat = roles["capability"]
    cap_policy = cfg.get("capabilityOwnershipPolicy") or "advisory"
    if cap_policy not in ("off", "advisory", "hard"):
        print(f'✗ capabilityOwnershipPolicy 값 위반 "{cap_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    cap_active = cap_policy != "off" and capability_check_active(roles)
    # 정책이 off가 아닌데 판정이 성립하지 않으면(inert) 사유를 반드시 출력 — hard면 차단(거짓 안전).
    cap_inert = capability_inert_reasons(cap_policy, roles)
    cap_findings = []  # (spec_id, capability, entity)

    # Entity 스키마 백킹(SPEC-026) — 소유 entity가 구조 SSOT에 실재하는지 대조(유령 entity 차단).
    sb_policy = cfg.get("entitySchemaBackingPolicy") or "off"
    if sb_policy not in ("off", "advisory", "hard"):
        print(f'✗ entitySchemaBackingPolicy 값 위반 "{sb_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    sb_sources = cfg.get("entitySchemaSources") or []
    sb_active = schema_backing_active(sb_policy, sb_sources, roles)
    sb_inert = schema_backing_inert_reasons(sb_policy, sb_sources, roles)
    sb_owned = []  # (spec_id, [raw...])
    sb_slugs = []  # (spec_id, slug) — 모듈 문법용(SPEC-029 ①)

    # 심볼 실재(SPEC-029 ②) — 선언된 소스 루트 아래 실재하는 파일/디렉토리 basename과 대조.
    sr_policy = str(cfg.get("symbolRealityPolicy", "off") or "off")
    if sr_policy not in ("off", "advisory", "hard"):
        print(f'✗ symbolRealityPolicy 값 위반 "{sr_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    sr_roots = cfg.get("ownershipSourceRoots") or []
    sr_active = symbol_reality_active(sr_policy, sr_roots, roles)
    sr_inert = symbol_reality_inert_reasons(sr_policy, sr_roots, roles)
    sur_cat = roles["surface"]
    sr_owned = []  # (spec_id, [raw...])

    # ownershipCategories에 Files 금지(SPEC-013, DEDUP.md §3) — 글롭이 dedup 키로 유입되면
    # 유일성·형식검증이 오판한다. 문서의 "금지"를 config 검증으로 기계 강제.
    cat_errors = ownership_categories_findings(categories)
    if cat_errors:
        print("✗ ownershipCategories 위반:", file=sys.stderr)
        for e in cat_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    # specSyncExemptGlobs 무결성(SPEC-013 FR-007) — 면제 목록이 강제 자체를 무력화하는 것을 막는다.
    # config 자기면제·전면 면제는 프로즈로만 금지돼 있었다(감사 A-4 실측). 위 카테고리 검증과 동형.
    exempt_errors = exempt_glob_findings(
        cfg.get("specSyncExemptGlobs"),
        rel_from_root(cfg, cfg["__path"]) if cfg.get("__path") else "sdd.config.json",
    )
    if exempt_errors:
        print("✗ specSyncExemptGlobs 위반:", file=sys.stderr)
        for e in exempt_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    # 구조 문법 잔여 3종(감사 후속 G1·G2·G3) — check-ownership.mjs 미러.
    orq_policy = str(cfg.get("ownershipRequiredPolicy") or "advisory")
    xcat_policy = str(cfg.get("crossCategoryDedupPolicy") or "advisory")
    fov_policy = str(cfg.get("filesOverlapPolicy") or "advisory")
    for name, val in (("ownershipRequiredPolicy", orq_policy), ("crossCategoryDedupPolicy", xcat_policy), ("filesOverlapPolicy", fov_policy)):
        if val not in ("off", "advisory", "hard"):
            print(f'✗ {name} 값 위반 "{val}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)', file=sys.stderr)
            sys.exit(1)
    files_by_spec = []  # (spec_id, [globs]) — G3 Files 겹침 판정용

    files = spec_md_files(cfg)

    owners = {c: {} for c in categories}
    missing, format_issues = [], []
    spec_deps = []  # (spec_id, [(name, type), ...]) — 관계 판정용(SPEC-017)
    rel_struct_count = rel_free_count = 0  # 관계 판정 발화량(침묵 표면화용)
    declared = 0
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        # G3: Files glob 수집(Ownership 선언 유무 무관). 인라인 주석 제거·쉼표 분리.
        fm = re.search(r"^\s*-\s*\*\*Files\*\*:\s*(.+)$", text, re.M)
        if fm:
            globs = [s.split("#")[0].strip() for s in fm.group(1).split(",")]
            globs = [g for g in globs if g]
            if globs:
                files_by_spec.append((spec_id, globs))
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
            sb_slugs.append((spec_id, spec_slug(file)))
        # 심볼 실재(SPEC-029 ②): 파일형 표면 키만 수집 — HTTP·이벤트·잡·경로는 대상 아님.
        if sr_active and sur_cat and own.get(sur_cat):
            file_like = [k for k in own[sur_cat] if is_file_like_surface(k)]
            if file_like:
                sr_owned.append((spec_id, file_like))
        # Dependencies 섹션은 참조일 뿐 dedup 대상이 아님(파싱만, 거짓양성 방지).
        # `Name (relation-type)` 항목만 구조화 관계로 뽑는다 — 레거시 자유참조는 관여 안 함.
        deps = parse_section(text, "Dependencies", categories)
        # ⚠ 관계 대상 이름은 소유자 색인과 **같은 정규화**를 거쳐야 한다(Node판 미러).
        # owners는 normalize_key로 채워지므로 원문 조회는 대소문자 차이만으로도 hard
        # missing-target 오차단을 낸다(실측: 소비 프로젝트의 `IacActionRun`).
        rel_parsed = [parse_relation_entry(raw) for raw in deps.get(ent_cat, [])]
        rel_entities = [(normalize_key(ent_cat, e["name"], cfg), e["type"]) for e in rel_parsed if e["type"]]
        if rel_entities:
            spec_deps.append((spec_id, rel_entities))
        # 관계 판정 발화량 — 전부 자유참조면 SPEC-017이 아무것도 보지 않는다(침묵 표면화).
        rel_struct_count += len(rel_entities)
        rel_free_count += len(rel_parsed) - len(rel_entities)

    conflicts = []
    for cat in categories:
        for key, specs in owners[cat].items():
            if len(specs) > 1:
                conflicts.append((cat, key, sorted(set(specs))))

    # G2: 카테고리 간 동일 정규화 키(check-ownership.mjs 미러).
    xcat_conflicts = []
    if xcat_policy != "off":
        by_key = {}  # key → {cat: set(spec)}
        for cat in categories:
            for key, specs in owners[cat].items():
                by_key.setdefault(key, {})[cat] = set(specs)
        for key in sorted(by_key.keys()):
            cat_map = by_key[key]
            if len(cat_map) > 1:
                cats = sorted(cat_map.keys())
                specs = sorted(set().union(*[cat_map[c] for c in cats]))
                xcat_conflicts.append((key, cats, specs))

    # G3: 두 스펙 Files glob이 같은 실파일 소유(check-ownership.mjs 미러).
    files_overlap = []
    if fov_policy != "off" and files_by_spec:
        ignore = set(cfg["ignoreDirs"])
        all_rel = []
        for dirpath, dirnames, filenames in os.walk(cfg["__root"]):
            dirnames[:] = sorted(d for d in dirnames if d not in ignore)
            rel_dir = os.path.relpath(dirpath, cfg["__root"])
            for name in sorted(filenames):
                all_rel.append(name if rel_dir == "." else f"{rel_dir}/{name}")
        file_to_specs = {}
        for spec_id, globs in files_by_spec:
            rxs = [compile_glob(g) for g in globs]
            for rel in all_rel:
                if any(rx.search(rel) for rx in rxs):
                    file_to_specs.setdefault(rel, set()).add(spec_id)
        for rel in sorted(file_to_specs.keys()):
            if len(file_to_specs[rel]) > 1:
                files_overlap.append((rel, sorted(file_to_specs[rel])))

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

    if not files:
        verdict("INERT", "판정 대상 스펙 0건 — specDir이 비었거나 읽지 못했다")
    else:
        judged(0)
    print(f"Ownership 게이트: spec {len(files)}개 중 {declared}개가 Ownership 선언.")
    if missing:
        tag = "✗" if (strict or orq_policy == "hard") else "⚠"
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
    # 선언된 정책이 아무것도 판정하지 않으면(inert) 사유 고지(SPEC-002 FR-010) — 침묵 금지.
    # hard는 ✗+차단, advisory는 플레인 `·` 고지(기본값 프로젝트의 하네스 flagged 판정 무오염).
    if cap_inert:
        tag = "✗" if cap_policy == "hard" else "·"
        print(f"{tag} Capability 귀속(capabilityOwnershipPolicy={cap_policy}): 판정 불가(inert) — {'; '.join(cap_inert)}")
    if sb_inert:
        tag = "✗" if sb_policy == "hard" else "·"
        print(f"{tag} Entity 스키마 백킹(entitySchemaBackingPolicy={sb_policy}): 판정 불가(inert) — {'; '.join(sb_inert)}")
    if cap_policy == "hard" and cap_inert:
        print("\n✗ capabilityOwnershipPolicy=hard인데 판정이 성립하지 않는다(위 사유) — hard 선언 + 무판정은 거짓 안전이다. ownershipCategories에 entity류·capability류 카테고리를 두어 판정을 성립시키거나, 이 프로젝트에 capability 개념이 없으면 정책을 off로 명시하라(SPEC-024).",
              file=sys.stderr)
        sys.exit(1)
    if sb_policy == "hard" and sb_inert:
        print("\n✗ entitySchemaBackingPolicy=hard인데 판정이 성립하지 않는다(위 사유) — hard 선언 + 무판정은 거짓 안전이다. entitySchemaSources에 구조 SSOT 어댑터를 선언하고 entity류 카테고리를 두어 판정을 성립시키거나, 스키마가 없는 프로젝트면 정책을 off로 명시하라(SPEC-026).",
              file=sys.stderr)
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
        # 모듈 문법(SPEC-029 ①) — 스펙별 슬러그 맵(전역 집합 아님).
        slug_by_spec = ({sid: slug for sid, slug in sb_slugs} if spec_slug_source_declared(sb_sources) else None)
        sb_findings = schema_backing_findings(sb_owned, extract_schema_entities(units), exempt_set, slug_by_spec)
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
    # ── 심볼 실재(SPEC-029 ②) — Node판과 출력 순서·문구 동일 ──
    if sr_inert:
        print(f'· 심볼 실재(symbolRealityPolicy={sr_policy}): 판정 불가(inert) — {" / ".join(sr_inert)}')
    sr_findings = []
    if sr_active:
        ignore_sr = set(cfg["ignoreDirs"])
        real_set = set()

        def _walk_sr(d, rel):
            # basename · 상대경로 · 확장자 없는 상대경로 세 형태를 담는다(Node판 미러).
            # 세 번째가 없으면 점 표기 모듈 경로가 어떤 설정으로도 매치하지 않는다.
            try:
                names = sorted(os.listdir(d))
            except OSError:
                return
            for n in names:
                r = f"{rel}/{n}" if rel else n
                real_set.add(n.lower())
                real_set.add(r.lower())
                real_set.add(re.sub(r"\.[^./]+$", "", r).lower())
                p = os.path.join(d, n)
                if os.path.isdir(p) and n not in ignore_sr:
                    _walk_sr(p, r)

        for root in sr_roots:
            _walk_sr(os.path.join(cfg["__root"], root), root)
        sr_findings = symbol_reality_findings(sr_owned, real_set)
    sr_hard = sr_policy == "hard" and len(sr_findings) > 0
    if sr_active and sr_findings:
        print(f"심볼 실재(symbolRealityPolicy={sr_policy}): 위반 {len(sr_findings)}건 — 소유 surface가 소스 루트에 실재하지 않음")
        for spec_id, symbol in sr_findings:
            tag = "✗" if sr_hard else "⚠"
            print(f'  {tag} [{spec_id}] Surfaces "{symbol}" — {"·".join(sr_roots)} 아래에 그 이름의 파일·디렉토리가 없음: 실제 파일이면 키를 실물 이름에 맞추고(또는 파일을 만들고), 다른 루트에 있으면 ownershipSourceRoots에 선언하라(SPEC-029)')
    if sr_hard:
        print("\n✗ symbolRealityPolicy=hard: 소유 surface(파일형 키)는 선언된 소스 루트 아래 실재해야 한다 — 면제 목록이 아니라 데이터 교정으로 닫아라(SPEC-029).",
              file=sys.stderr)
        sys.exit(1)
    if sr_policy == "hard" and sr_inert:
        print("\n✗ symbolRealityPolicy=hard인데 판정이 성립하지 않는다(위 사유) — hard 선언 + 무판정은 거짓 안전이다. ownershipSourceRoots를 선언하고 surface류 카테고리를 두어 판정을 성립시키거나, 정책을 off로 명시하라(SPEC-029).",
              file=sys.stderr)
        sys.exit(1)

    # 관계 판정이 한 번도 발화하지 않은 상태를 표면화(Node판 미러) — 침묵은 근거가 아니다.
    if rel_struct_count == 0 and rel_free_count > 0:
        print(f"· Entity 관계(SPEC-017): 판정 0건 — Dependencies 참조 {rel_free_count}건이 전부 자유참조(타입 없음)라 대상 실재 검증·순환 탐지가 발화하지 않았다. `이름 (relation-type)` 형식으로 적으면 판정 대상이 된다")
    for c in relation_cycles:
        print(f"⚠ 관계 순환 참조: {' → '.join(c)} — aggregate 간 참조는 한 방향이어야 한다(설계 검토)")
    if relation_errors:
        print(f"\n✗ Entity 관계(SPEC-017) 위반 {len(relation_errors)}건:", file=sys.stderr)
        for e in relation_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    # G2 리포트(카테고리 간 동일 키).
    xcat_hard = xcat_policy == "hard" and len(xcat_conflicts) > 0
    if xcat_conflicts:
        print(f"{'✗' if xcat_hard else '⚠'} 카테고리 간 동일 키(crossCategoryDedupPolicy={xcat_policy}) {len(xcat_conflicts)}건 — 같은 정규화 키가 여러 카테고리에 소유:")
        for key, cats, specs in xcat_conflicts:
            print(f'  {"✗" if xcat_hard else "⚠"} "{key}" ← {"+".join(cats)} ({", ".join(specs)}) → 한 카테고리로 통합하거나 키를 구분(같은 실체면 한 역할)')
    # G3 리포트(Files 겹침).
    fov_hard = fov_policy == "hard" and len(files_overlap) > 0
    if files_overlap:
        print(f"{'✗' if fov_hard else '⚠'} Files 겹침(filesOverlapPolicy={fov_policy}) {len(files_overlap)}건 — 한 실파일을 2+ 스펙이 소유:")
        for rel, specs in files_overlap:
            print(f'  {"✗" if fov_hard else "⚠"} {rel} ← {" + ".join(specs)} → Files glob을 좁혀 한 스펙만 소유하게')

    if conflicts:
        print(f"\n✗ 중복 소유(구조적 중복) {len(conflicts)}건:", file=sys.stderr)
        for cat, key, specs in conflicts:
            print(f'  [{cat}] "{key}" ← {" + ".join(specs)}  → 한 spec으로 통합/개정 필요', file=sys.stderr)
        sys.exit(1)

    orq_hard = orq_policy == "hard" and len(missing) > 0
    if orq_hard:
        print(f"\n✗ ownershipRequiredPolicy=hard: 모든 스펙이 Ownership을 선언해야 한다(미선언 {len(missing)}건: {', '.join(missing)}) — 미선언 스펙은 중복 검사의 사각이다.", file=sys.stderr)
    if xcat_hard:
        print("\n✗ crossCategoryDedupPolicy=hard: 카테고리 간 동일 키는 구조적 중복이다 — 위 항목 해소 필요.", file=sys.stderr)
    if fov_hard:
        print("\n✗ filesOverlapPolicy=hard: 한 실파일은 한 스펙만 소유해야 한다 — 위 Files 겹침 해소 필요.", file=sys.stderr)

    if strict and (missing or format_issues):
        if missing:
            print("\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.", file=sys.stderr)
        if format_issues:
            print("\n✗ --strict: 형식 위반이 있음 — 수정 필요.", file=sys.stderr)
        sys.exit(1)
    if orq_hard or xcat_hard or fov_hard:
        sys.exit(1)
    print(f"✓ 구조적 중복 없음 — 모든 {'/'.join(categories)} 키가 유일.")


# ── cohesion — 입도(under-fragmentation) (check-spec-cohesion.mjs) ──

def cmd_cohesion(cfg, strict):
    categories = cfg["ownershipCategories"]
    max_keys = cfg["maxKeysPerCategoryPerSpec"]
    max_frs = cfg["maxFRsPerSpec"]
    max_agg = cfg.get("maxAggregateRootsPerSpec", 1)
    roles = cfg["__roles"]
    ent_cat = roles["entity"] or categories[0]
    files = spec_md_files(cfg)

    violations = []  # (spec_id, kind, n, max)
    for file in files:
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        # 정의(**FR-NNN**)만 — Change Log/근거의 FR 인용 제외(SPEC-013 fr_declarations가 범위 판정).
        frs = len(set(fr_declarations(text, cfg["__frDecl"], cfg["__reqAlt"])))
        if frs > max_frs:
            violations.append((spec_id, "FR", frs, max_frs))
        if re.search(r"^##\s+Ownership", text, re.MULTILINE):
            own = parse_section(text, "Ownership", categories)
            if own.get(ent_cat) and len(own[ent_cat]) > max_agg:
                violations.append((spec_id, f"{ent_cat}(aggregate)", len(own[ent_cat]), max_agg))
            # 신규: aggregate root 최소 하한(owner #1 "entity 없이 묶임"). entity 역할이 선언됐는데
            # 키를 하나라도 소유하면서 그 칸이 비면 위반 — MAX의 거울. 역할 미정의면 건너뜀(하위호환).
            ent_role = roles["entity"]
            if ent_role:
                owns_any = any(own.get(c) for c in categories)
                if owns_any and not own.get(ent_role):
                    violations.append((spec_id, f"{ent_role}(min)", 0, 1))
            # capability 역할 카테고리는 entity별로 센다(SPEC-024 병합 강제와의 모순 해소 — 순수 완화).
            cap_cat = roles["capability"]
            for cat in categories:
                if cap_cat and cat == cap_cat:
                    by_ent = {}
                    for k in own[cat]:
                        e = str(k).split(".")[0].strip().lower()
                        by_ent[e] = by_ent.get(e, 0) + 1
                    top = None
                    for e, n in by_ent.items():
                        if top is None or n > top[1]:
                            top = (e, n)
                    if top and top[1] > max_keys:
                        violations.append((spec_id, f"{cat}(entity:{top[0]})", top[1], max_keys))
                elif len(own[cat]) > max_keys:
                    violations.append((spec_id, cat, len(own[cat]), max_keys))

    if not files:
        verdict("INERT", "판정 대상 스펙 0건 — specDir이 비었거나 읽지 못했다")
    else:
        judged(len(violations))
    print(f"Spec 입도(cohesion) 게이트: spec {len(files)}개 검사 (키>{max_keys}/카테고리, FR>{max_frs}).")
    if violations:
        tag = "✗" if strict else "⚠"
        print(f"{tag} 과대 spec(분할 권고) {len(violations)}건:")
        for spec_id, kind, n, mx in violations:
            if "(min)" in kind:
                print(f"  {tag} {spec_id}: aggregate root({kind.replace('(min)', '')}) 0개 — 스펙은 entity(aggregate root)를 최소 1개 소유해야 한다(entity 없이 Surface/Capability만 번들 금지). entity를 소유하거나, 남의 entity 능력이면 그 소유 스펙으로 이관(SPEC-024)")
            elif "aggregate" in kind:
                print(f"  {tag} {spec_id}: {kind} {n}개 > {mx} — 여러 aggregate 삼킴 의심 → root 1개만 남기고 나머지는 Dependencies의 `이름 (relation-type)`으로 이관(SPEC-017), 그래도 남으면 분할 검토")
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


def fr_lines_missing_shall(text, fr_decl_re, req_alt="FR"):
    """SHALL 토큰 없는 FR 선언 라인의 ID들(SPEC-013 FR-003, grammar-lib.mjs frLinesMissingShall 미러).

    라인 규율은 _is_fr_decl_line 단일 정의(불릿 유무 무관). 자체 `^\\s*-\\s*`(불릿 필수)를 쓰던 동안
    비불릿 스타일 선언은 SHALL 검사를 통째로 건너뛰었다 — 거짓 음성(실측 PM 173줄, 전부 SHALL을
    갖고 있어 발견이 늦었다). FR-008이 "라인 시작·불릿 옵션"을 규범으로 세운 뒤 선언 라인 정의가
    둘로 갈라져 있었고 좁은 쪽만 진짜 EARS 결함을 흘렸다. 넓은 쪽으로 통일 — advisory는 그대로.
    req_alt는 호출부가 반드시 넘긴다(기본값 "FR"이면 다중 접두어 사이트의 INFRA 선언이 무검사).
    """
    tok = re.compile(fr_decl_re.pattern)
    out = []
    for line in text.split("\n"):
        if not _is_fr_decl_line(line, req_alt):
            continue
        m = tok.search(line)  # 라인 시작이 보장되므로 첫 토큰이 선언
        if m and not re.search(r"\bSHALL\b", line):
            out.append(m.group(1))
    return out


def fr_declarations(text, fr_decl_re, req_alt="FR"):
    """FR "선언"의 범위 판정(SPEC-013 FR-008, grammar-lib.mjs frDeclarations 미러).

    선언 = ① `## Functional Requirements` 섹션 안 ② 라인 시작(`_is_fr_decl_line` 단일 정의 — 불릿
    유무 무관. 중복 정규식 금지: 사본이 좁게 드리프트하면 진짜 결함을 조용히 흘린다) ③ 그 라인의 첫 FR 토큰.
    전문 스캔은 Change Log 표 행의 bold FR 인용(`FR-011→**FR-037**`)을 선언으로 집계해 거짓
    "FR 번호 중복" hard를 냈다. 표 행은 `|`로 시작해 ②에서 탈락한다. 문법(fr_decl_re)은
    SPEC-001 FR-009 공유 자산이라 손대지 않는다 — 좁힌 것은 범위뿐.
    FR 섹션 부재 시 전문 폴백(선언 집합이 통째로 비어 dangling 폭발하는 것을 막는다).
    반환: 선언 순서 그대로의 리스트(중복 유지 — 중복 판정이 소비).
    """
    block = section_block(text, "Functional Requirements")
    scope = text if block is None else block
    tok = re.compile(fr_decl_re.pattern)
    out = []
    for line in scope.split("\n"):
        if not _is_fr_decl_line(line, req_alt):
            continue
        m = tok.search(line)
        if m:
            out.append(m.group(1))
    return out


def fr_decl_style_findings(text, fr_decl_re, req_alt="FR"):
    """FR 선언 문법의 스펙 내 일관성(SPEC-013 FR-009, grammar-lib.mjs frDeclStyleFindings 미러).

    한 스펙이 불릿(`- **FR-001**`)과 무불릿(`**FR-001**`)을 섞으면 advisory 1건. 탐지(FR-008)와
    SHALL(FR-003)은 의도적으로 불릿 유무 무관이라 기계는 혼용을 통과시킨다 — 남는 피해는 사람과
    임시 도구 쪽이다(실측 PM SPEC-004: 불릿 57 + 무불릿 112 공존으로 진짜 FR 번호 중복 1건이 한쪽
    문법 스캔의 거짓 음성으로 숨었다).
    판정 단위는 스펙 하나 — 저장소 전체 통일은 요구하지 않는다(템플릿 규범 문장은 토큰 형태를
    규정하고 불릿은 예시에만 나오므로 "불릿 필수"는 문서에 없는 새 의견이 된다). 한 파일 안의 혼용은
    대개 스펙 흡수·병합의 이음매로 생긴, 저술 의도가 아닌 잡음이다.
    범위는 FR-008과 같은 규율이되 **전문 폴백 없음** — 다른 절(Assumptions·Change Log)이 요구 ID를
    불릿으로 정당하게 인용하므로 폴백을 켜면 거짓 혼용이 난다. advisory 신호라 판정 유보가 안전하다.
    req_alt는 호출부가 반드시 넘긴다(FR-003·FR-008과 동형 함정).
    """
    block = section_block(text, "Functional Requirements")
    if block is None:
        return []
    tok = re.compile(fr_decl_re.pattern)
    bulleted, plain = [], []
    for line in block.split("\n"):
        if not _is_fr_decl_line(line, req_alt):
            continue
        m = tok.search(line)
        if not m:
            continue
        (bulleted if re.match(r"^\s*-", line) else plain).append(m.group(1))
    if not bulleted or not plain:
        return []
    return [
        f"FR 선언 문법 혼용 — 불릿 {len(bulleted)}건(예 {bulleted[0]})과 무불릿 {len(plain)}건"
        f"(예 {plain[0]})이 한 스펙에 공존: 한쪽으로 통일하라(게이트의 선언 탐지는 불릿 유무 무관이라"
        f" 통과하지만, 한쪽 문법만 보는 grep·리뷰가 반대쪽을 놓친다)"
    ]


def dedup_review_dangling_ids(text, spec_id_re, known_ids):
    block = section_block(text, "Dedup-Review")
    if block is None:
        return []
    seen = {m.group(0) for m in re.finditer(spec_id_re.pattern, block)}
    return sorted(i for i in seen if i not in known_ids)


def ownership_categories_findings(categories):
    return [f'ownershipCategories에 "{c}" 금지 — Files는 spec-sync 소유선언 전용(dedup 키 아님, DEDUP.md §3)'
            for c in (categories or []) if str(c).strip().lower() == "files"]


def exempt_glob_findings(globs, config_rel="sdd.config.json"):
    """specSyncExemptGlobs 무결성(SPEC-013 FR-007) — grammar-lib.mjs exemptGlobFindings 미러.
    금지 2종: ①config 파일 자신을 매치하는 글롭(표기 무관, 실제 매치로 판정) ②전면 면제(**·**/*).
    게이트 코드 디렉토리(scripts/**)는 의도적 제외(감사 M-14 — 하네스 소유 처방 부재)."""
    findings = []
    for raw in (globs or []):
        g = str(raw).strip()
        if not g:
            continue
        if g in ("**", "**/*"):
            findings.append(f'specSyncExemptGlobs "{g}" — 전면 면제 금지: 모든 경로를 면제하면 unowned closed-world와 spec-first 동반 요구가 공허해진다(생성물·락파일처럼 좁은 범위로 선언하라)')
            continue
        try:
            rx = compile_glob(g)
        except Exception:
            continue
        if rx.match(config_rel):
            findings.append(f'specSyncExemptGlobs "{g}" — config 파일({config_rel}) 면제 금지: config는 강제의 통제면이라 변경에 스펙 동반(영속 흔적)을 강제해야 한다 — 소유 스펙 Files에 편입하라(감사 T1)')
    return findings


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
        # __reqAlt를 반드시 넘긴다 — 생략하면 기본값 "FR"이 걸려 다중 접두어 사이트의 INFRA 선언이 무검사.
        for fr in fr_lines_missing_shall(text, cfg["__frDecl"], cfg["__reqAlt"]):
            findings.append((spec_id, f"{fr} 선언 라인에 SHALL 없음 — EARS 5패턴 공통 필수 토큰(다중행 서술이면 선언 라인에 SHALL 포함)"))
        # FR 선언 문법의 스펙 내 일관성(SPEC-013 FR-009) — 한 스펙 안에서 불릿/무불릿 혼용만 신호.
        # 저장소 전체 통일은 요구하지 않는다(템플릿 규범은 토큰 형태까지 — 불릿은 예시).
        for m in fr_decl_style_findings(text, cfg["__frDecl"], cfg["__reqAlt"]):
            findings.append((spec_id, m))

    # 1 레포 = 1 모듈(SPEC-013, STRUCTURE.md): Module 값이 갈라지면 레포 분할 신호.
    if len(module_values) > 1:
        names = sorted(module_values.keys())
        findings.append(("(전 스펙)", f"Module 값 {len(names)}개({', '.join(names)}) — 1 레포 = 1 모듈(STRUCTURE.md): 모듈이 더 필요하면 레포를 나눈다"))

    if not files:
        verdict("INERT", "판정 대상 스펙 0건 — specDir이 비었거나 읽지 못했다")
    else:
        judged(len(findings))
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


def _bare_key(raw):
    """Ownership·Dependencies 항목에서 키 본체만 — Node판 bareKey 미러.

    ① 백틱으로 시작하면 첫 백틱 스팬 내용이 키(사유 안 괄호·백틱 중첩에 안전).
    ② 아니면 첫 " (" 앞까지가 키. 둘 다 아니면(산문) 손대지 않는다.
    ⚠ 오탐만 줄이는 것이 아니다 — 가려져 있던 진짜 마커 위반이 드러난다(실측 PM 9→17).
    """
    s = str(raw if raw is not None else "").strip()
    m = re.match(r"^`([^`]+)`", s)
    if m:
        return m.group(1).strip().lower()
    return re.split(r"\s+\(", s)[0].strip().lower()


def _build_key_kind_map(own_sections, dep_sections, roles=None):
    """키 → 종류(entity/surface/capability) 맵 — 마커 대조용. 관계 서픽스 제거, 첫 등장 우선.
    세 종류 카테고리가 하나도 없으면(킷 Modules 등) 빈 맵(inert)."""
    by_role = None
    if roles and (roles.get("entity") or roles.get("surface") or roles.get("capability")):
        by_role = {str(c).strip().lower(): k for k, c in
                   (("entity", roles.get("entity")), ("surface", roles.get("surface")),
                    ("capability", roles.get("capability"))) if c}

    def kind_of(cat):
        if by_role is not None:
            return by_role.get(str(cat).strip().lower())
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
                k = _bare_key(raw)
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
            # entity 키는 백틱이 정본 표기다(owner 결정 2026-07-28) — 백틱의 뜻이 "entity 키
            # 혹은 그 종속"으로 좁혀졌다. surface·capability는 여전히 볼드+마커만 정본.
            if kind == "entity":
                continue
            expected = str(markers[kind]).upper() if markers and markers.get(kind) else None
            if not expected:
                continue
            out.append((fr, tok, expected))
    return out


def _unanchored_owned_key_findings(fr_lines, owned_kind_map, markers, req_alt="FR"):
    """소유 entity/surface/capability 키가 FR에 굵게 앵커 안 됐으면 위반(SPEC-023 FR-007, (B)).
    owned_kind_map 비면 inert. 반환 [(key, kind, expected)]."""
    out = []
    if not owned_kind_map:
        return out
    anchored = set()
    for line in fr_lines or []:
        if not _is_fr_decl_line(line, req_alt):
            continue
        for tok, _ in _extract_anchors_with_markers(line, req_alt):
            anchored.add(tok)
    for key, kind in owned_kind_map.items():
        if key in anchored:
            continue
        expected = str(markers[kind]).upper() if markers and markers.get(kind) else None
        out.append((key, kind, expected))
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
    markers = cfg.get("frAnchorMarkers") or {"entity": "E", "surface": "S", "capability": "C"}
    files = spec_md_files(cfg, missing_fatal=False)
    findings = []
    anchor_matched = 0
    anchor_unmatched = []  # (spec_id, fr, token)
    marker_missing = []    # (spec_id, fr, token, expected) — 카테고리 마커 누락
    marker_wrong = []      # (spec_id, fr, token, expected, got) — 마커 불일치
    marker_backtick = []   # (spec_id, fr, token, expected) — 백틱에 든 선언 키(FR-006)
    marker_unanchored = [] # (spec_id, key, kind, expected) — 소유 키 앵커 강제(FR-007)
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
            # 카테고리 마커(SPEC-023 확장): 굵은 키마다 종류 표기 — entity (E)·surface (S)·capability (C).
            kind_map = _build_key_kind_map(own, deps, cfg["__roles"])
            miss, wr = _category_marker_findings(lines, kind_map, markers, cfg["__reqAlt"])
            marker_missing.extend((spec_id, fr, tok, exp) for fr, tok, exp in miss)
            marker_wrong.extend((spec_id, fr, tok, exp, got) for fr, tok, exp, got in wr)
            # 굵게 ⟺ 키 세 번째 방향(FR-006): 백틱에 든 선언 키는 앵커여야 함(리터럴 아님).
            for fr, tok, exp in _backtick_key_findings(lines, kind_map, markers, cfg["__reqAlt"]):
                marker_backtick.append((spec_id, fr, tok, exp))
            # 소유 키 앵커 강제(FR-007, (B)): 소유 entity/surface/capability 키는 FR에 굵게 앵커돼야 함.
            for key, kind, exp in _unanchored_owned_key_findings(lines, _build_key_kind_map(own, {}, cfg["__roles"]), markers, cfg["__reqAlt"]):
                marker_unanchored.append((spec_id, key, kind, exp))
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
    marker_count = len(marker_missing) + len(marker_wrong) + len(marker_backtick) + len(marker_unanchored)
    anchor_hard = anchor_policy == "hard" and (len(anchor_unmatched) > 0 or marker_count > 0)
    if anchor_policy != "off":
        tag = "✗" if anchor_hard else "⚠"
        print(f"키 앵커(frKeyAnchorPolicy={anchor_policy}): 매치 {anchor_matched} · 미매치 {len(anchor_unmatched)} · 카테고리 마커 위반 {marker_count}")
        for spec_id, fr, tok in anchor_unmatched:
            print(f'  {tag} [{spec_id}] {fr} bold "{tok}" — 소유·참조 키 아님: 수사적 강조면 백틱/평문으로, 키면 Ownership/Dependencies에 선언')
        # 카테고리 마커(SPEC-023 확장) — 굵은 키마다 종류 표기: entity (E)·surface (S)·capability (C).
        for spec_id, fr, tok, exp in marker_missing:
            print(f'  {tag} [{spec_id}] {fr} bold "{tok}" — 카테고리 마커 없음: **{tok}** ({exp})로 표기(굵은 키의 종류 명시)')
        for spec_id, fr, tok, exp, got in marker_wrong:
            print(f'  {tag} [{spec_id}] {fr} bold "{tok}" ({got}) — 마커 불일치: 이 키의 카테고리는 ({exp})')
        # 굵게 ⟺ 키(FR-006) — 백틱에 든 선언 키는 앵커여야 한다(리터럴 아님).
        for spec_id, fr, tok, exp in marker_backtick:
            print(f'  {tag} [{spec_id}] {fr} 백틱 "{tok}" — 선언 키는 백틱(리터럴)이 아니라 앵커: **{tok}** ({exp})로 표기')
        # 소유 키 앵커 강제(FR-007) — 소유 키는 FR에 굵게 앵커돼야 한다(산문·백틱에만 있으면 위반).
        for spec_id, key, kind, exp in marker_unanchored:
            print(f'  {tag} [{spec_id}] 소유 {kind} 키 "{key}" — 어느 FR에도 굵게 앵커되지 않음: 이 키를 세우는 FR에서 **{key}** ({exp})로 표기')
    judged(len(findings) + (1 if anchor_hard else 0))
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
    judged(len(offenders))
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
        verdict("INERT", "surfaceGlobs 미설정 — 표면으로 볼 파일 집합이 없다")
        print("Orphan-surface gate: surfaceGlobs 미설정 — no-op")
        return

    # ⚠ 카테고리 **이름**이 아니라 **역할**로 찾는다(SPEC-001 FR-010, check-orphan-surfaces.mjs 패리티).
    # `**Surfaces**:` 하드코딩은 카테고리를 `Symbols`로 부르는 저장소에서 선언 집합을 항상 비운다.
    surface_cat = (cfg.get("__roles") or {}).get("surface") or "Surfaces"
    declared = set()
    decl_re = re.compile(rf"-\s*\*\*{re.escape(surface_cat)}\*\*\s*:\s*([^\n]+)", re.IGNORECASE)
    for file in spec_md_files(cfg, missing_fatal=False):
        text = read_text(file)
        m = decl_re.search(text)
        if m:
            for k in m.group(1).split(","):
                v = k.strip().lower()
                if v and not v.startswith("[") and v != "—":
                    declared.add(v)

    # 소유 스펙을 갖지 않기로 **선언된** 파일은 고아가 아니다 — 선언 자리를 새로 만들지 않고
    # specSyncExemptGlobs를 재사용한다(같은 사실에 목록이 둘이면 두 게이트가 다른 답을 낸다).
    exempt = [compile_glob(g) for g in (cfg.get("specSyncExemptGlobs") or [])]
    orphans = []
    surfaces = 0
    exempted = 0
    for p in walk_files(cfg["__root"], cfg):
        rel = rel_from_root(cfg, p)
        if not any(rx.search(rel) for rx in globs):
            continue
        surfaces += 1
        nrel = rel.strip().lower()
        claimed = any(d == nrel or d in nrel or nrel in d for d in declared)
        if claimed:
            continue
        if any(rx.match(rel) for rx in exempt):
            exempted += 1
            continue
        orphans.append(rel)

    mode = "strict" if strict else "advisory"
    judged(len(orphans))
    ex_tag = f" · 선언된 예외 {exempted}건(specSyncExemptGlobs — 부채로 표면화)" if exempted else ""
    print(f"Orphan-surface gate — 역할:{surface_cat} surfaces:{surfaces} declared:{len(declared)} orphans:{len(orphans)}{ex_tag} mode:{mode}")
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
        verdict("SKIPPED", f"git diff({base}) 불가 — 비교 기준을 해석하지 못했다")
        print(f"· converge-drift: git diff({base}) 불가 — 건너뜀")
        return
    changed = [s.strip() for s in out.splitlines() if s.strip()]
    code_changed = [p for p in changed if any(_in_dir(p, d) for d in cfg["scanDirs"])]
    spec_changed = any(_in_dir(p, cfg["specDir"]) for p in changed)

    mode = "strict" if strict else "advisory"
    judged(len(code_changed) if (code_changed and not spec_changed) else 0)
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


def files_line_missing_paths(tokens, exists):
    """Files 리터럴 경로 실재(spec-sync-lib.mjs 패리티, SPEC-013).

    글롭은 대상에서 뺀다 — 오늘 0건 매치가 정당할 수 있다. 리터럴엔 그 정당성이 없다.
    exists: (relPath) -> bool 주입(파일 IO는 호출자가 한다)."""
    out = []
    for raw in tokens or []:
        t = str(raw or "").strip()
        if not t or t in ("—", "-"):
            continue
        if re.search(r"[*?{}]", t):
            continue
        if t.startswith("["):
            continue
        if not exists(t):
            out.append(t)
    return out


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

    # ②c 삭제 경로(SPEC-003 FR-010 개정) — 삭제는 "잘못 적힌 경로"도 "소유 없는 파일"도 아닌 세 번째 상태다.
    # 두 검사가 changeset을 추가·수정만으로 가정해 **소유 파일을 지우는 정답 경로가 아예 없었다**.
    deleted_paths = set()

    def collect_deleted(raw):
        for ln in lines(raw):
            m = re.match(r"^D\d*\t(.+)$", ln)
            if m:
                deleted_paths.add(m.group(1).strip())

    if branch_diff_ok:
        collect_deleted(_git(cfg, ["diff", "--name-status", "--find-renames", f"{base}...HEAD"]))
    if staged:
        collect_deleted(_git(cfg, ["diff", "--cached", "--name-status", "--find-renames"]))

    # ③ 스펙 로드(§5.1): HEAD ∪ index 합집합(삭제 가시화).
    spec_paths = set(
        p for p in lines(_git(cfg, ["ls-files", "--", cfg["specDir"]])) +
        lines(_git(cfg, ["ls-tree", "-r", "--name-only", "HEAD", "--", cfg["specDir"]]))
        if p.endswith(".md"))
    specs = []  # (id, path, [(glob, re)], deleted_in_index)
    warned_glob_spec = set()
    files_missing_hard = False  # Files 리터럴 경로 부재(staged=hard)
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

        # Files의 리터럴 경로 실재(SPEC-013) — 없는 경로는 아무 변경 파일과도 매치하지 않아
        # **소유가 조용히 사라진다**. 글롭 문법 위반과 같은 계열이라 같은 강도로 다룬다
        # (staged=✗ hard / range=⚠). 삭제 중 스펙은 제외(수명 종료 경로).
        if not (idx is None and head is not None):
            # 이번 changeset에서 **삭제 중인** 경로는 "잘못 적힌 것"이 아니라 "지우는 것"이다.
            missing_lit = [rel for rel in files_line_missing_paths(
                sorted(globs), lambda rel: os.path.exists(resolve(cfg, rel)))
                if rel not in deleted_paths]
            if missing_lit:
                print(f"{'✗' if staged else '⚠'} [{spec_id}] Files 리터럴 경로 부재 {' '.join(missing_lit)} — "
                      f"그 경로는 어떤 변경 파일과도 매치하지 않으므로 이 스펙의 소유가 조용히 사라진다"
                      f"(리네임됐으면 스펙을 실물 이름에 맞춰라)")
                if staged:
                    files_missing_hard = True

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
        # 삭제된 파일에 소유를 요구하는 것은 모순이다 — 선언은 이미(또는 동시에) 사라졌으므로
        # 정의상 매치될 수 없다. 삭제를 unowned로 세면 "지우는 커밋"이 영구히 막힌다(SPEC-003 FR-010 개정).
        if not owned and policy != "silent" and f not in deleted_paths:
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
    judged(len(violations) + (len(unowned) if unowned_hard else 0) + (len(drift_violations) if drift_hard else 0))
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
    # Files 리터럴 경로 부재도 같은 계열의 "소유가 조용히 풀림"이라 같은 강도로 차단한다.
    if files_missing_hard and not violations:
        print("\n✗ Files 리터럴 경로 부재: 존재하지 않는 경로는 어떤 변경 파일과도 매치하지 않는다 — 스펙을 실물 경로에 맞추거나(리네임 반영) 그 항목을 지워라.",
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
        verdict("INERT", "derivationManifest 미설정 — 파생 관계를 볼 매니페스트가 없다")
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

    judged(len(errors))
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
    """spec별 선언 FR 수집(fr 게이트와 동일 문법·동일 범위 파생 — SPEC-013 fr_declarations)."""
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
        specs[m.group(0)] = set(fr_declarations(text, cfg["__frDecl"], cfg["__reqAlt"]))
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
        verdict("INERT", "smoke 태그 0건 · 매니페스트 미설정 — 볼 대상이 없다")
        print(f"Smoke-scan — tags:0 keys:0 manifest:미설정 mode:{'write' if write else 'check'} config:{cfg_tag(cfg)}")
        verdict("INERT", "smoke 태그도 매니페스트도 없음 — 볼 대상이 없다")
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

    verdict("SKIPPED", "스캐너(판정 게이트 아님) — 매니페스트를 산출·대조한다")
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
        verdict("SKIPPED", "인자 없음 — 판정을 요청받지 못했다(usage)")
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
        judged(len(errors))
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
    verdict("SKIPPED", "리팩터 도구(판정 게이트 아님) — 키 치환을 산출한다")
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
        verdict("INERT", f"'{stage}' 명령 미설정 — 실행할 것이 없다")
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


E2E_ENUM = ("off", "advisory", "hard")


def e2e_run_verdict(policy, has_command, skipped="", exit_code=None):
    """e2e 실행 판정 순수 코어 (SPEC-021 확장, check-test-run.mjs e2eRunVerdict 미러 — 바이트 동일)."""
    if policy not in E2E_ENUM:
        return False, 1, f'✗ e2eTestsPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)'
    if policy == "off":
        return True, 0, "e2e 실행 축 — e2eTestsPolicy:off (판정 안 함; e2e로만 커버된 FR은 check-fr-coverage가 e2e 버킷으로 표면화한다)"
    hard = policy == "hard"
    if not has_command:
        return True, (1 if hard else 0), f"{'✗' if hard else '⚠'} e2e 실행 축 — e2eTestsPolicy:{policy}인데 commands.e2e 미선언 — 판정 대상이 없다(거짓 안전)"
    if skipped:
        extra = "; hard에서 미판정은 거짓 안전이라 실패로 센다" if hard else ""
        return True, (1 if hard else 0), f"{'✗' if hard else '·'} e2e 실행 축 — [skipped] {skipped} (판정 못 함이지 '통과'가 아니다{extra})"
    if exit_code == 0:
        return True, 0, f"e2e 실행 축 — commands.e2e green (e2eTestsPolicy:{policy})"
    return True, (1 if hard else 0), f"{'✗' if hard else '⚠'} e2e 실행 축 — commands.e2e 실패 (exit {exit_code}, e2eTestsPolicy:{policy})"


def cmd_testrun(cfg):
    """`commands.test`(로컬 안전 tier)를 실제 실행해 결과를 판정 (SPEC-021). 러너/언어 중립."""
    policy = cfg.get("runTestsPolicy") or "off"
    cmd = (cfg.get("commands") or {}).get("test")
    exit_code = None
    if policy in ("advisory", "hard") and cmd:
        # 러너 stdout을 부모 stderr로 보낸다(check-test-run.mjs 미러 — 감사 M-8): 이 게이트의
        # stdout은 판정 줄 하나가 정본이고, 러너 텍스트가 stdout에 섞이면 하네스가 게이트 stdout을
        # ⚠/✗로 스캔하다 green을 "확인 필요"로 읽는다. 리다이렉트라 실시간 출력은 그대로.
        exit_code = subprocess.run(cmd, shell=True, cwd=cfg["__root"], stdout=sys.stderr).returncode
    valid, code, line = test_run_verdict(policy, bool(cmd), exit_code)

    e2e_policy = str(cfg.get("e2eTestsPolicy") or "off")
    e2e_cmd = (cfg.get("commands") or {}).get("e2e")
    skipped, e2e_exit = "", None
    if e2e_policy in ("advisory", "hard") and e2e_cmd:
        probe = cfg.get("e2ePrecheck")
        if probe:
            try:
                r = subprocess.run(str(probe), shell=True, cwd=cfg["__root"], capture_output=True,
                                   text=True, encoding="utf-8",
                                   timeout=float(cfg.get("e2ePrecheckTimeoutMs") or 60000) / 1000.0)
                if r.returncode != 0:
                    lines = [l for l in (r.stderr or "").strip().split("\n") if l.strip()]
                    skipped = f"실행 전제 미충족(e2ePrecheck 실패) — {lines[-1] if lines else '사유 불명'}"
            except Exception as e:  # noqa: BLE001
                lines = [l for l in str(e).strip().split("\n") if l.strip()]
                skipped = f"실행 전제 미충족(e2ePrecheck 실패) — {lines[-1] if lines else '사유 불명'}"
        if not skipped:
            e2e_exit = subprocess.run(str(e2e_cmd), shell=True, cwd=cfg["__root"], stdout=sys.stderr).returncode
    e_valid, e_code, e_line = e2e_run_verdict(e2e_policy, bool(e2e_cmd), skipped, e2e_exit)
    # 이 게이트의 원래 결함이 정확히 여기였다 — 정책이 hard인데 명령이 없으면 아무것도 안 돌고
    # exit 0으로 끝났다(여러 라운드 거짓 green). 이제 그 상태는 INERT로 자백된다.
    if policy == "off":
        verdict("OFF", "runTestsPolicy")
    elif not cmd:
        verdict("INERT", "commands.test 미선언 — 돌릴 스위트가 없다")
    elif skipped:
        verdict("SKIPPED", f"e2e 전제 미충족 — {skipped}")
    else:
        judged((1 if code else 0) + (1 if e_code else 0))
    # 출력 순서: e2e 축 먼저, 스위트 판정 마지막 (check-test-run.mjs 미러 — 집계기가 마지막 줄을 요약으로 쓴다).
    print(e_line, file=(sys.stdout if (e_valid and e_code == 0) else sys.stderr))
    print(line, file=(sys.stdout if valid else sys.stderr))
    sys.exit(code or e_code)


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
        verdict("INERT", "schemaDriftManifest 미설정 — expected/deployed를 조회할 명령이 없다")
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
    # 조회가 실패했으면(ran=False) 본 것이 없다 — exit 0이어도 판정이 아니다.
    if not ran:
        verdict("SKIPPED", "expected/deployed 조회 실패 — 라이브 스키마를 읽지 못했다")
    elif policy == "off":
        verdict("OFF", "migrationStatePolicy")
    else:
        judged(1 if code else 0)
    print(line, file=(sys.stdout if valid else sys.stderr))
    sys.exit(code)


# ─── SC·NFR 검증 회계 (SPEC-034) — sc-coverage-lib.mjs 미러 ───
SC_DECL_RE = re.compile(r"^\s*[-*]\s+\*\*(SC|NFR)-(\d+)\*\*\s*(?:\([^)]*\))?\s*:")
_SC_TAG_RE = re.compile(r"\[검증\s*[:：]\s*([^\]]+)\]")
_SC_UNKNOWN_RE = re.compile(r"\[미확인\]")


def parse_sc_line(line):
    raw = str(line or "")
    m = SC_DECL_RE.match(raw)
    if not m:
        return None
    stripped = re.sub(r"`[^`]*`", " ", raw)
    tag = _SC_TAG_RE.search(stripped)
    return {"id": f"{m.group(1)}-{m.group(2)}", "kindOfId": m.group(1),
            "pointer": tag.group(1).strip() if tag else "",
            "unknown": bool(_SC_UNKNOWN_RE.search(stripped))}


def kind_of_pointer(pointer, kinds, matcher):
    p = str(pointer or "").strip()
    if not p:
        return ""
    for kind, globs in (kinds or {}).items():
        for g in globs or []:
            if matcher(g, p):
                return kind
    return "other"


def validate_evidence_manifest(manifest):
    entries, errors = {}, []
    for key, v in (manifest or {}).items():
        if not re.match(r"^[A-Za-z]+-\d+[A-Za-z]?/(SC|NFR)-\d+$", key):
            errors.append(f'evidenceManifest "{key}" — 키 형식은 "<SPEC-ID>/<SC-NNN|NFR-NNN>"')
            continue
        if not isinstance(v, dict):
            errors.append(f'evidenceManifest "{key}" — 객체여야 한다({{kind, evidence, reason}})')
            continue
        kind = str(v.get("kind") or "").strip()
        if not kind:
            errors.append(f'evidenceManifest "{key}" — kind 없음(빈 값 불가)')
            continue
        evidence = str(v.get("evidence") or "").strip()
        reason = str(v.get("reason") or "").strip()
        if kind == "deferred":
            if not reason:
                errors.append(f'evidenceManifest "{key}" — kind=deferred는 reason 필수(왜 아직 검증하지 않나)')
                continue
        elif not evidence:
            errors.append(f'evidenceManifest "{key}" — evidence 필수(실행 로그·대시보드 스냅샷 등 근거 경로; 존재만 강제, 질은 리뷰 몫)')
            continue
        entries[key] = {"kind": kind, "evidence": evidence, "reason": reason}
    return entries, errors


def classify_sc_coverage(items, manifest, kinds, matcher):
    classes = {}
    counts = {"verified": 0, "evidence": 0, "deferred": 0, "unaccounted": 0}
    for it in items or []:
        key = f'{it["specId"]}/{it["id"]}'
        cls, kind = "unaccounted", ""
        if it["pointer"]:
            cls = "verified"
            kind = kind_of_pointer(it["pointer"], kinds, matcher)
        elif manifest and key in manifest:
            e = manifest[key]
            kind = e["kind"]
            cls = "deferred" if e["kind"] == "deferred" else "evidence"
        elif it["unknown"]:
            cls, kind = "unaccounted", "미확인"
        classes[key] = {"cls": cls, "kind": kind}
        counts[cls] += 1
    return classes, counts


def cmd_sccoverage(cfg):
    policy = str(cfg.get("scCoveragePolicy") or "off")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ scCoveragePolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)', file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "scCoveragePolicy")
        print("SC·NFR 회계 게이트 — scCoveragePolicy:off (판정 안 함)")
        sys.exit(0)
    hard = policy == "hard"
    raw = cfg.get("evidenceManifest")
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(read_text(resolve(cfg, raw)))
        except Exception as e:  # noqa: BLE001
            print(f"✗ evidenceManifest 읽기 실패: {raw} — {e}", file=sys.stderr)
            sys.exit(1)
    entries, m_errors = validate_evidence_manifest(raw if isinstance(raw, dict) else {})
    if m_errors:
        print("✗ evidenceManifest 오류:", file=sys.stderr)
        for e in m_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    kinds = {k: [compile_glob(g) for g in (v or [])] for k, v in (cfg.get("verificationKinds") or {}).items()}
    def matcher(rx, p):
        return bool(rx.search(re.sub(r"^\./", "", str(p))))

    spec_dir = resolve(cfg, cfg["specDir"])
    try:
        names = sorted(os.listdir(spec_dir))
    except OSError:
        print(f"✗ spec 디렉토리 없음: {spec_dir}", file=sys.stderr)
        sys.exit(1)
    items = []
    for n in [x for x in names if x.endswith(".md")]:
        text = read_text(os.path.join(spec_dir, n))
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else n[:-3]
        for line in text.split("\n"):
            it = parse_sc_line(line)
            if it:
                it["specId"] = spec_id
                items.append(it)

    classes, counts = classify_sc_coverage(items, entries, kinds, matcher)
    by_kind = {}
    for v in classes.values():
        if v["kind"]:
            by_kind[v["kind"]] = by_kind.get(v["kind"], 0) + 1
    kind_tag = " ".join(f"{k}:{by_kind[k]}" for k in sorted(by_kind)) or "—"
    print(f"SC·NFR 회계 게이트(scCoveragePolicy={policy}): 항목 {len(items)}건 — "
          f"verified {counts['verified']}·evidence {counts['evidence']}·deferred {counts['deferred']}·미회계 {counts['unaccounted']} | 종류({kind_tag})")
    tag = "✗" if hard else "⚠"
    bad = sorted((k, v) for k, v in classes.items() if v["cls"] == "unaccounted")
    # 항목 0건은 "깨끗함"이 아니라 "볼 것이 없었음"이다 — SC 문법이 안 잡힌 상태와 구분되지 않는다.
    if not items:
        verdict("INERT", "SC·NFR 선언 라인이 0건 — 판정 대상을 찾지 못했다")
    else:
        judged(len(bad))
    cap = int(cfg.get("scCoverageListCap") or 12)
    for k, v in bad[:cap]:
        why = ("`[미확인]`은 정직한 자기신고지만 회계가 아니다 — evidenceManifest에 사유와 함께 착지시켜라"
               if v["kind"] == "미확인" else
               '`[검증: <경로>]`로 실행 가능한 검증을 지목하거나, 실행 불가면 evidenceManifest에 {kind, evidence} 또는 {kind:"deferred", reason}')
        print(f"  {tag} {k} — 검증 바인딩 없음: {why}")
    if len(bad) > cap:
        print(f"  {tag} … 외 {len(bad) - cap}건 (전체 목록은 scCoverageListCap 상향 또는 게이트 단독 실행으로 확인)")
    if not items:
        print("  · 판정 대상 없음 — SC·NFR 선언 라인(`- **SC-001**: …`)이 한 건도 없다")
        if hard:
            print("\n✗ scCoveragePolicy=hard인데 판정 대상이 없다(거짓 안전) — SC 문법을 확인하거나 정책을 off로.", file=sys.stderr)
            sys.exit(1)
    if bad and hard:
        print(f"\n✗ scCoveragePolicy=hard: SC·NFR {len(bad)}건에 검증 바인딩이 없다 — 성능·보안 목표가 검증 없이 통과하는 것이 이 게이트가 막는 것이다.", file=sys.stderr)
        sys.exit(1)
    if not bad and items:
        print("SC·NFR 회계 게이트: OK — 모든 SC·NFR이 검증·증거·유예 중 하나로 회계됨.")
    sys.exit(0)


USAGE = "usage: python sdd_gates.py <fr|ownership|cohesion|completeness|consistency|adequacy|orphan|converge|specsync|derivation|smokescan|retag|run|testrun|schemadrift|ratchet|engineevent|evidence|livereality|synonym|sccoverage|verifyrun> [...]"


def cmd_ratchet(cfg, base_arg):
    cur_policy = cfg.get("policyRatchetPolicy") or "advisory"
    if cur_policy not in ("off", "advisory", "hard"):
        print(f'✗ policyRatchetPolicy 값 위반 "{cur_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    base = base_arg or os.environ.get("SDD_DIFF_BASE") or cfg.get("specSyncBase") or "origin/main"

    def off_notice():
        verdict("OFF", "policyRatchetPolicy")
        print("정책 래칫 게이트 — policyRatchetPolicy:off (판정 안 함)")

    # base config를 off 단락보다 먼저 읽는다 — 래칫 자신의 강도도 base 시점 값으로 판정(감사 A-2).
    cfg_rel = (_git(cfg, ["ls-files", "--full-name", "--", "sdd.config.json"]) or "").strip().split("\n")[0]
    if not cfg_rel:
        cfg_rel = os.path.relpath(cfg["__path"], cfg["__root"]) if cfg.get("__path") else "sdd.config.json"
    base_raw = _git(cfg, ["show", f"{base}:{cfg_rel}"])
    if base_raw is None:
        if cur_policy == "off":
            off_notice()
            sys.exit(0)
        verdict("SKIPPED", f"base({base}) config 조회 불가 — 비교 대상이 없다(git 없음·최초 채택)")
        print(f"정책 래칫 게이트 — base({base}) config 조회 불가(git 없음·최초 채택) — 건너뜀")
        sys.exit(0)
    base_cfg = config_from_string(base_raw, cfg["__root"])
    if not base_cfg:
        if cur_policy == "off":
            off_notice()
            sys.exit(0)
        verdict("SKIPPED", f"base({base}) config 파싱 실패 — 비교 대상을 읽지 못했다")
        print(f"정책 래칫 게이트 — base({base}) config 파싱 실패 — 건너뜀")
        sys.exit(0)
    policy = effective_ratchet_policy(base_cfg.get("policyRatchetPolicy"), cur_policy)
    hard = policy == "hard"
    if policy != cur_policy:
        print(f"· 정책 래칫: policyRatchetPolicy {cur_policy}(현재)가 base({base})의 "
              f"{base_cfg.get('policyRatchetPolicy')}보다 약함 — base 시점 강도로 판정(자기약화 방지, SPEC-027)")
    if policy == "off":
        off_notice()
        sys.exit(0)
    violations, allowed = classify_ratchet(base_cfg, cfg, cfg.get("policyRatchetExceptions") or [])
    print(f"정책 래칫 게이트 — base:{base} mode:{policy} violations:{len(violations)} allowed-downgrades:{len(allowed)}")
    for d in allowed:
        print(f"  · [부채] {d['knob']}: {d['from']} → {d['to']} (policyRatchetExceptions로 허용된 하향 — 재승격 대상)")
    for v in violations:
        why = ("임계 완화 금지 — 캡 초과는 **분할 또는 병합**으로 해소하는 것이지 자를 늘려 재는 것이 아니다"
               if v.get("kind") == "limit" else "강도 하향 금지(단조 증가만)")
        print(f'  · {v["knob"]}: {v["from"]} → {v["to"]} — {why}. 정당한 재조정이면 policyRatchetExceptions에 "{v["knob"]}" 선언(부채로 표면화)')
    judged(len(violations))
    if violations:
        msg = "정책 래칫 위반 — 강제 강도를 낮췄다(정책 하향 ∨ 수치 임계 완화). 위반을 knob 조정으로 회피하지 말고 스펙을 편집해 해소하라(advisory는 경유지·hard가 종착지)."
        if hard:
            print(f"\n✗ {msg}", file=sys.stderr)
            sys.exit(1)
        print(f"\n⚠ {msg} (policyRatchetPolicy:advisory — 경고)")
        sys.exit(0)
    print("정책 래칫 게이트: OK — 강도 하향·임계 완화 없음.")
    sys.exit(0)


def _ee_ssot_set(cfg, sources):
    ignore = set(cfg["ignoreDirs"])
    all_files = []
    for dirpath, dirnames, filenames in os.walk(cfg["__root"]):
        dirnames[:] = sorted(d for d in dirnames if d not in ignore)
        rel_dir = os.path.relpath(dirpath, cfg["__root"])
        for name in sorted(filenames):
            all_files.append(name if rel_dir == "." else f"{rel_dir}/{name}")
    units = []
    for src in sources or []:
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
    return extract_schema_entities(units)


def _ee_exempt_set(mp, knob):
    errs = [k for k, reason in (mp or {}).items() if not str(reason or "").strip()]
    if errs:
        print(f"✗ {knob} 빈 사유: {', '.join(errs)} — 면제는 사유 필수(entityRegistry 동형)", file=sys.stderr)
        sys.exit(1)
    return set(str(k).strip().lower() for k in (mp or {}).keys())


def cmd_engineevent(cfg):
    categories = cfg["ownershipCategories"]
    roles = cfg["__roles"]
    eng_policy = cfg.get("engineRealityPolicy") or "off"
    ev_policy = cfg.get("eventAttributionPolicy") or "off"
    for name, val in (("engineRealityPolicy", eng_policy), ("eventAttributionPolicy", ev_policy)):
        if val not in ("off", "advisory", "hard"):
            print(f'✗ {name} 값 위반 "{val}" — off|advisory|hard 중 하나', file=sys.stderr)
            sys.exit(1)
    if eng_policy == "off" and ev_policy == "off":
        verdict("OFF", "engineRealityPolicy·eventAttributionPolicy")
        print("Engines/Events 게이트 — engineRealityPolicy·eventAttributionPolicy 모두 off (판정 안 함)")
        sys.exit(0)
    # 스펙별 소유 키 수집
    units = []
    for file in spec_md_files(cfg):
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        units.append((spec_id, parse_section(text, "Ownership", categories)))
    failed = False
    # 축이 둘이라 판정 종류도 축별로 갈린다 — 하나라도 실제로 봤으면 JUDGED, 둘 다 못 봤으면 INERT.
    viol_count = 0
    judged_axes = 0
    inert_axes = []

    if eng_policy != "off":
        eng_cat = roles["engine"]
        inert = role_inert_reasons(eng_policy, cfg.get("enginesSources"), eng_cat, "enginesSources", "engine")
        if inert:
            inert_axes.append(f"engine: {' · '.join(inert)}")
            print(f"Engine 실재(engineRealityPolicy={eng_policy}): 판정 불가 — {' · '.join(inert)}")
            if eng_policy == "hard":
                print("\n✗ engineRealityPolicy=hard인데 무판정(거짓 안전) — enginesSources·engine 역할을 선언하거나 정책을 off로.", file=sys.stderr)
                failed = True
        else:
            pat_errs = validate_schema_patterns(cfg.get("enginesSources"))
            if pat_errs:
                print(f"✗ enginesSources 잘못된 정규식: {', '.join(f'[{i}] {p}' for i, p in pat_errs)}", file=sys.stderr)
                sys.exit(1)
            ssot = _ee_ssot_set(cfg, cfg.get("enginesSources"))
            exempt = _ee_exempt_set(cfg.get("engineExemptKeys"), "engineExemptKeys")
            owned = [(sid, own.get(eng_cat) or []) for sid, own in units]
            f = reality_findings(owned, ssot, exempt)
            tag = "✗" if eng_policy == "hard" else "⚠"
            print(f"Engine 실재(engineRealityPolicy={eng_policy}): 위반 {len(f)}건 — 소유 engine이 코드-모듈 SSOT에 없음")
            for sid, key in f:
                print(f'  {tag} {sid}: engine "{key}" — enginesSources에 실재하지 않음(코드-모듈로 실재시키거나 데이터 교정; 순수 로직이 아니면 entity/surface로 재분류)')
            judged_axes += 1
            viol_count += len(f)
            if f and eng_policy == "hard":
                failed = True

    if ev_policy != "off":
        ev_cat = roles["event"]
        ent_cat = roles["entity"]
        inert = role_inert_reasons(ev_policy, cfg.get("eventCatalogSources"), ev_cat, "eventCatalogSources", "event")
        if inert:
            inert_axes.append(f"event: {' · '.join(inert)}")
            print(f"Event 귀속(eventAttributionPolicy={ev_policy}): 판정 불가 — {' · '.join(inert)}")
            if ev_policy == "hard":
                print("\n✗ eventAttributionPolicy=hard인데 무판정(거짓 안전) — eventCatalogSources·event 역할을 선언하거나 정책을 off로.", file=sys.stderr)
                failed = True
        else:
            pat_errs = validate_schema_patterns(cfg.get("eventCatalogSources"))
            if pat_errs:
                print(f"✗ eventCatalogSources 잘못된 정규식: {', '.join(f'[{i}] {p}' for i, p in pat_errs)}", file=sys.stderr)
                sys.exit(1)
            catalog = _ee_ssot_set(cfg, cfg.get("eventCatalogSources"))
            exempt = _ee_exempt_set(cfg.get("eventExemptKeys"), "eventExemptKeys")
            owned_events = [(sid, own.get(ev_cat) or []) for sid, own in units]
            owned_entities = {sid: [str(e).strip().lower() for e in ((own.get(ent_cat) or []) if ent_cat else [])] for sid, own in units}
            attr = event_attribution_findings(owned_events, owned_entities)
            real = reality_findings(owned_events, catalog, exempt)
            tag = "✗" if ev_policy == "hard" else "⚠"
            print(f"Event 귀속(eventAttributionPolicy={ev_policy}): 귀속 위반 {len(attr)}건, 카탈로그 실재 위반 {len(real)}건")
            for sid, key, entity in attr:
                print(f'  {tag} {sid}: event "{key}" — 발신 entity({entity or "없음"})를 이 스펙이 소유하지 않음. `entity.event-name` 형식으로 소유 entity에 귀속(capability 귀속 동형)')
            for sid, key in real:
                print(f'  {tag} {sid}: event "{key}" — eventCatalogSources에 실재하지 않음(이벤트 카탈로그에 등록하거나 데이터 교정)')
            judged_axes += 1
            viol_count += len(attr) + len(real)
            if (attr or real) and ev_policy == "hard":
                failed = True

    if not judged_axes:
        verdict("INERT", " / ".join(inert_axes) or "판정 가능한 축 없음")
    else:
        judged(viol_count)
    if failed:
        sys.exit(1)
    print("Engines/Events 게이트: OK.")
    sys.exit(0)


def cmd_evidence(cfg):
    policy = str(cfg.get("executionEvidencePolicy") or "off")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ executionEvidencePolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)', file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "executionEvidencePolicy")
        print("실행 증거 게이트 — executionEvidencePolicy:off (판정 안 함)")
        sys.exit(0)
    hard = policy == "hard"
    verbs = cfg.get("executionVerbs") or []
    bmark = cfg.get("browserMarkers") or []
    bpat = cfg.get("browserEvidencePatterns") or []
    # 레포 파일·디렉토리 집합(증거 자산 실재 판정).
    ignore = set(cfg["ignoreDirs"])
    files, dirs = set(), set()
    for dirpath, dirnames, filenames in os.walk(cfg["__root"]):
        dirnames[:] = sorted(d for d in dirnames if d not in ignore)
        rel_dir = os.path.relpath(dirpath, cfg["__root"])
        for d in dirnames:
            dirs.add(d if rel_dir == "." else f"{rel_dir}/{d}")
        for name in sorted(filenames):
            files.add(name if rel_dir == "." else f"{rel_dir}/{name}")

    def asset_exists(path):
        p2 = re.sub(r"^\./", "", str(path)).rstrip("/")
        if p2 in files or p2 in dirs:
            return True
        if re.search(r"[*?]", p2):
            rx = compile_glob(p2)
            return any(rx.search(f) for f in files)
        return False

    # 회계 매니페스트 조회 — 키와 method만 본다(무결성은 각자의 소유 게이트가 판정).
    def load_raw_manifest(value, label):
        raw = value
        if isinstance(raw, str) and raw.strip():
            try:
                raw = json.loads(read_text(resolve(cfg, raw)))
            except Exception:
                return {}
        out = {}
        if isinstance(raw, dict):
            for k, v in raw.items():
                method = str((v.get("method") if isinstance(v, dict) else None)
                             or (v.get("kind") if isinstance(v, dict) else None) or "").strip()
                out[k] = {"source": label, "method": method}
        return out

    smoke_man = load_raw_manifest(cfg.get("smokeManifest"), "smokeManifest")
    evid_man = load_raw_manifest(cfg.get("evidenceManifest"), "evidenceManifest")

    def manifest_of(spec_id, claim_id):
        src = evid_man if re.match(r"^(SC|NFR)-", claim_id) else smoke_man
        return src.get(f"{spec_id}/{claim_id}")

    # SC와 NFR을 한 정규식으로 — NFR은 실행 동사 규칙 대상이 아니고(SC 전용) 매니페스트
    # 대조만을 위해 수집한다. kind는 접두어에서 나온다.
    sc_re = re.compile(r"\*\*((?:SC|NFR)-\d{3}[a-z]?)\*\*")
    units = []
    for file in spec_md_files(cfg):
        text = read_text(file)
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        claims = []
        for line in text.split("\n"):
            t = line.strip()
            if t.startswith("|"):
                continue
            fr = cfg["__frDecl"].search(t)
            if fr:
                claims.append({"id": fr.group(1), "kind": "FR", "text": t})
                continue
            sc = sc_re.search(t)
            if sc:
                claims.append({"id": sc.group(1),
                               "kind": "NFR" if sc.group(1).startswith("N") else "SC", "text": t})
        # 이 스펙이 **배포 산출물을 소유**하는가 — 증거 등급 분리의 트리거 절반(SPEC-031 확장).
        # 마커만으로 걸면 배포를 *다루는* 스펙(가드 로직 등)까지 잡힌다. 소유가 대상성을 가른다.
        dep_markers = cfg.get("deployArtifactMarkers")
        dep_markers = dep_markers if isinstance(dep_markers, list) and dep_markers else None
        arti_cat = (cfg.get("__roles") or {}).get("artifact") or "Artifacts"
        owns_deploy = bool(dep_markers) and any(
            is_deploy_artifact(k, dep_markers)
            for k in (parse_section(text, "Ownership", [arti_cat]).get(arti_cat) or []))
        units.append({"specId": spec_id, "claims": claims, "ownsDeployArtifact": owns_deploy})

    findings = evidence_findings(units, asset_exists, verbs, bmark, bpat, manifest_of,
                                 cfg.get("deployMarkers"), cfg.get("deployEvidencePatterns"))
    claim_count = sum(len(u["claims"]) for u in units)
    judged(len(findings))
    print(f"실행 증거 게이트(executionEvidencePolicy={policy}): spec {len(units)}개·주장 {claim_count}건 검사 — 위반 {len(findings)}건")
    tag = "✗" if hard else "⚠"
    for spec_id, claim_id, _kind, finding, detail in findings:
        print(f"  {tag} [{spec_id}] {claim_id} ({finding}) — {detail}")
    if findings and hard:
        print("\n✗ executionEvidencePolicy=hard: `[검증]`은 실행 가능한 증거 경로를 지목해야 한다 — 산문 자기신고로 충족되지 않는다(실측: 게이트 전종 green인데 대시보드 패널 30여 개 사망).", file=sys.stderr)
        sys.exit(1)
    if not findings:
        print("실행 증거 게이트: OK — 모든 주장이 실행 증거를 지목하거나 자기신고로 명시됨.")
    sys.exit(0)


def cmd_livereality(cfg):
    policy = str(cfg.get("liveRealityPolicy") or "off")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ liveRealityPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)', file=sys.stderr)
        sys.exit(1)
    checks = cfg.get("liveRealityChecks") or []

    # ── 축 ①: 등록(오프라인) — 실행 축과 **정책도 분리**한다(check-live-reality.mjs 패리티).
    cov_policy = str(cfg.get("liveRealityCoveragePolicy") or "advisory")
    if cov_policy not in ("off", "advisory", "hard"):
        print(f'✗ liveRealityCoveragePolicy 값 위반 "{cov_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    cov_judged, cov_violations, cov_inert = False, 0, []
    if cov_policy != "off":
        markers = cfg.get("deployArtifactMarkers")
        markers = markers if isinstance(markers, list) and markers else None
        if not markers:
            cov_inert.append("deployArtifactMarkers 미선언 — 무엇이 배포 산출물인지 이 프로젝트의 어휘를 모른다"
                             f"(권장 목록: {'·'.join(RECOMMENDED_DEPLOY_ARTIFACT_MARKERS[:6])} … — presets 참조)")
        else:
            arti_cat = (cfg.get("__roles") or {}).get("artifact") or "Artifacts"
            declared = []
            for file in spec_md_files(cfg, missing_fatal=False):
                text = read_text(file)
                m = cfg["__specId"].search(text)
                spec_id = m.group(0) if m else os.path.basename(file)[:-3]
                for key in parse_section(text, "Ownership", [arti_cat]).get(arti_cat) or []:
                    k = str(key).strip()
                    if k and k not in ("—", "-") and not k.startswith("["):
                        declared.append((spec_id, k))
            if not declared:
                cov_inert.append(f"선언된 {arti_cat} 키 0건 — 대조할 배포 산출물이 없다")
            else:
                covered, uncovered, scanned = live_reality_coverage(declared, checks, markers, compile_glob)
                blocking, cov_violations = live_reality_coverage_verdict(cov_policy, uncovered)
                cov_judged = True
                ctag = "✗" if cov_policy == "hard" else "⚠"
                print(f"등록 축(liveRealityCoveragePolicy={cov_policy}): 배포 산출물 {scanned}건 — "
                      f"검사 등록됨 {len(covered)}·미검사 {len(uncovered)}")
                for spec_id, key in uncovered:
                    print(f"  {ctag} 미검사 산출물: [{spec_id}] {key} — 저장소 밖에 실재하는데 이 산출물을 보는 liveRealityChecks 항목이 없다(검사에 covers로 담당을 선언하라)")
                if blocking:
                    print(f"\n✗ liveRealityCoveragePolicy=hard: 배포 산출물 {len(uncovered)}건이 미검사다 — **틀이 있는 것과 그 틀이 이 산출물을 본다는 것은 다른 사실이다**(실측: 새 산출물 8개 결함을 배포로 하나씩 발견). 대응 검사를 등록하라(템플릿: sdd.config.presets.md §라이브 대조).",
                          file=sys.stderr)
                    judged(cov_violations)
                    sys.exit(1)

    # ── 축 ②: 실행(온라인) ──
    if policy == "off":
        if cov_judged:
            judged(cov_violations)
        else:
            verdict("OFF", f"liveRealityPolicy{f' · 등록 축 inert({cov_inert[0]})' if cov_inert else ''}")
        tail = f" · 등록 축 판정 불가: {' / '.join(cov_inert)}" if cov_inert else ""
        print(f"라이브 대조 게이트 — liveRealityPolicy:off (실행 축 판정 안 함){tail}")
        sys.exit(1 if (cov_judged and cov_violations and cov_policy == "hard") else 0)
    cfg_errors = validate_checks(checks)
    if cfg_errors:
        print("✗ liveRealityChecks 설정 오류:", file=sys.stderr)
        for e in cfg_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    hard = policy == "hard"
    if not checks:
        verdict("INERT", "liveRealityChecks 비어 있음 — 저장소 밖 진실을 볼 명령이 없다")
        print(f"라이브 대조 게이트(liveRealityPolicy={policy}): 판정 불가(inert) — liveRealityChecks 비어 있음(저장소 밖 진실을 볼 명령이 주입되지 않음)")
        if hard:
            print("\n✗ liveRealityPolicy=hard인데 검사가 0건이다 — hard 선언 + 무판정은 거짓 안전이다. liveRealityChecks를 주입하거나 정책을 off로 명시하라(SPEC-032).", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    timeout_s = float(cfg.get("liveRealityTimeoutMs") or 120000) / 1000.0
    results = []
    for c in checks:
        cid, label, kind = str(c["id"]), str(c.get("label") or c["id"]), str(c.get("kind") or "custom")
        try:
            r = subprocess.run(str(c["command"]), shell=True, cwd=cfg["__root"], capture_output=True,
                               text=True, encoding="utf-8", timeout=timeout_s)
            results.append(classify_result({"id": cid, "label": label, "kind": kind,
                                            "exitCode": r.returncode, "stdout": r.stdout, "stderr": r.stderr}))
        except Exception as e:  # noqa: BLE001 — 타임아웃·실행 실패 전부 skipped
            results.append(classify_result({"id": cid, "label": label, "kind": kind,
                                            "exitCode": 1, "stdout": "", "stderr": str(e)}))
    sm = summarize_live(results)
    # 축이 둘이라 판정 종류도 합산한다 — 등록 축이 판정했으면 이 게이트는 판정한 것이다.
    if sm["skipped"] and not sm["violations"] and not cov_judged:
        verdict("SKIPPED", f"검사 {sm['skipped']}건이 실행되지 못했다(자격증명·네트워크)")
    else:
        judged(sm["violations"] + cov_violations)
    print(f"라이브 대조 게이트(liveRealityPolicy={policy}): 검사 {len(results)}건 — clean {sm['clean']}·위반 {sm['violations']}(항목 {sm['items']})·skipped {sm['skipped']}")
    tag = "✗" if hard else "⚠"
    for r in results:
        if r["status"] == "skipped":
            print(f"  · [skipped] {r['label']} ({r['kind']}) — {r['reason']}")
        elif r["status"] == "violations":
            print(f"  {tag} {r['label']} ({r['kind']}) — {len(r['items'])}건:")
            for it in r["items"]:
                print(f"      - {it}")
        else:
            print(f"  ✓ {r['label']} ({r['kind']}) — 라이브와 일치")
    if sm["skipped"]:
        print("  · skipped는 '위반 없음'이 아니라 '판정 못 함'이다 — 자격증명·네트워크가 있는 환경에서 다시 돌려라.")
    if sm["violations"]:
        print("  · 해소 방향(회귀 금지): 라이브가 저장소보다 최신이면 저장소를 먼저 라이브에 맞춘 뒤(drift 흡수) 변경을 얹어라 — 낡은 저장소를 그대로 apply하면 라이브가 되돌아간다(APPLYING §라이브 우선 대조).")
        print("  · 대조 결과는 해당 인프라 스펙의 Change Log에 남긴다(무엇이 어긋났고 어느 방향으로 해소했는지).")
    if sm["violations"] and hard:
        print("\n✗ liveRealityPolicy=hard: 저장소 선언과 라이브 실물이 어긋났다 — 위 목록을 해소하라(skipped는 실패로 치지 않는다).", file=sys.stderr)
        sys.exit(1)
    if not sm["violations"]:
        print("라이브 대조 게이트: OK — 위반 0건.")
    sys.exit(0)


def cmd_synonym(cfg):
    policy = str(cfg.get("synonymPolicy") or "off")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ synonymPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)', file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "synonymPolicy")
        print("동의어 게이트 — synonymPolicy:off (판정 안 함)")
        sys.exit(0)
    hard = policy == "hard"
    categories = cfg["ownershipCategories"]
    ent_cat = cfg["__roles"]["entity"]
    prefixes = cfg.get("keyPrefixes") or []
    registry = cfg.get("synonymRegistry") or {}
    ledger = cfg.get("synonymReviewLedger") or {}
    sim_cmd = cfg.get("entitySimilarityCommand")

    owned = []
    if ent_cat:
        for file in spec_md_files(cfg):
            text = read_text(file)
            m = cfg["__specId"].search(text)
            spec_id = m.group(0) if m else os.path.basename(file)
            own = parse_section(text, "Ownership", categories)
            for raw in own.get(ent_cat) or []:
                owned.append({"specId": spec_id, "category": ent_cat, "key": normalize_key(ent_cat, raw, cfg)})
    else:
        verdict("INERT", "entity 역할 카테고리 미해석(ownershipCategoryRoles)")
        print(f"동의어 게이트(synonymPolicy={policy}): 판정 불가(inert) — entity 역할 카테고리 미해석(ownershipCategoryRoles)")
        if hard:
            print("\n✗ synonymPolicy=hard인데 판정 대상이 없다(거짓 안전) — entity 역할을 선언하거나 정책을 off로.", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    owned_keys = set(str(o["key"]).strip().lower() for o in owned)

    cfg_errors = validate_synonym_registry(registry, owned_keys) + validate_ledger(ledger)
    if cfg_errors:
        print("✗ 동의어 설정 오류:", file=sys.stderr)
        for e in cfg_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    collisions = lexical_collisions(owned, prefixes)
    declared = declared_synonym_findings(owned, registry)
    deterministic = len(collisions) + len(declared)

    cand = {"unresolved": [], "resolvedByRegistry": 0, "resolvedByLedger": 0}
    sim_skipped = ""
    fresh = None
    cur_fp = entity_set_fingerprint(list(owned_keys))
    if sim_cmd:
        try:
            r = subprocess.run(str(sim_cmd), shell=True, cwd=cfg["__root"], capture_output=True, text=True,
                               encoding="utf-8", timeout=float(cfg.get("entitySimilarityTimeoutMs") or 120000) / 1000.0)
            if r.returncode != 0:
                lines = [l for l in (r.stderr or "").strip().split("\n") if l.strip()]
                sim_skipped = lines[-1] if lines else "실행 실패"
            else:
                cand = classify_candidates(parse_candidate_pairs(r.stdout), registry, ledger)
                fresh = candidate_freshness(parse_candidate_header(r.stdout), cur_fp)
        except Exception as e:  # noqa: BLE001
            lines = [l for l in str(e).strip().split("\n") if l.strip()]
            sim_skipped = lines[-1] if lines else "실행 실패"

    # 유사 후보 층(③)이 돌지 못했으면 전수를 본 것이 아니다 — 결정적 층에 위반이 없어도 SKIPPED다.
    if sim_skipped and not collisions and not declared:
        verdict("SKIPPED", f"유사 후보 층 미실행 — {sim_skipped}")
    else:
        judged(len(collisions) + len(declared))
    tag = "✗" if hard else "⚠"
    print(f"동의어 게이트(synonymPolicy={policy}): entity {len(owned)}건 — 형태 충돌 {len(collisions)}·선언 별칭 {len(declared)}·미결 후보 {len(cand['unresolved'])}")
    for c in collisions:
        lst = " + ".join(f"{m['key']}({m['specId']})" for m in c["members"])
        print(f'  {tag} 형태 변이 충돌 "{c["canonical"]}" ← {lst} — 같은 실체면 정본 하나로 통일, 다르면 이름을 구분되게(단복수·접두어 차이는 같은 키다)')
    for d in declared:
        print(f'  {tag} [{d["specId"]}] "{d["key"]}" — synonymRegistry가 "{d["canonical"]}"의 별칭으로 선언한 이름이다: 정본으로 통일하라')
    if sim_skipped:
        print(f"  · [skipped] 유사 후보 탐지(entitySimilarityCommand) — {sim_skipped} (판정 못 함이지 '후보 없음'이 아니다)")
    for p in cand["unresolved"]:
        sc = f" (score {p['score']})" if p["score"] else ""
        print(f'  ⚠ 미결 후보: "{p["a"]}" ↔ "{p["b"]}"{sc} — 사람이 결정하라: 같으면 synonymRegistry에 정본·별칭+사유, 다르면 synonymReviewLedger["{p["a"]}::{p["b"]}"]에 기각 사유')
    if cand["resolvedByRegistry"] or cand["resolvedByLedger"]:
        print(f"  · 후보 중 이미 결정됨: 정본 통합 {cand['resolvedByRegistry']}건 · 기각 원장 {cand['resolvedByLedger']}건")
    if cand["unresolved"]:
        print("  · 미결 후보는 **차단하지 않는다**(확률적 판정에 차단력을 주지 않는다) — 다만 결정 전까지 매 실행 재부상한다(조용한 소실 없음).")
    if fresh and fresh["kind"] == "stale":
        print(f'  ⚠ 후보 목록이 낡았다 — 생성 당시 entity {fresh["declared"]["count"]}건({fresh["declared"]["hash"]}) → 현재 {cur_fp["count"]}건({cur_fp["hash"]}). 재생성하라: 그 사이 추가된 entity는 **아직 아무도 보지 않았다**(미결 후보 0이 \'다 봤다\'는 뜻이 아니다).')
    elif fresh and fresh["kind"] == "undeclared":
        print(f'  · 후보 목록 신선도 미선언 — 생성기 출력에 `# entity-set: {cur_fp["count"]} {cur_fp["hash"]}` 한 줄을 넣으면 낡음을 판정한다(없으면 낡아도 알 수 없다).')
    elif sim_cmd and not sim_skipped:
        print(f'  · 후보 목록 신선도: 최신 (entity-set {cur_fp["count"]} {cur_fp["hash"]})')

    if deterministic and hard:
        print("\n✗ synonymPolicy=hard: 형태 변이 충돌·선언된 별칭 사용은 구조적 중복이다 — 정본으로 통일하라(미결 후보는 차단 대상이 아니다).", file=sys.stderr)
        sys.exit(1)
    if not deterministic and not cand["unresolved"] and not sim_skipped:
        print("동의어 게이트: OK — 형태 충돌·선언 별칭·미결 후보 0건.")
    sys.exit(0)


# ── verifyrun — 검증 실행 회계 (check-verification-executed.mjs) ──

def cmd_verifyrun(cfg, record_args=None):
    policy = str(cfg.get("verificationRunPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ verificationRunPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    ledger_rel = cfg.get("verificationRunLedger")
    ledger_abs = resolve(cfg, ledger_rel) if ledger_rel else None

    # 기록 모드 — 러너·CI 스테이지·에이전트가 자기 결과를 남긴다.
    if record_args is not None:
        if len(record_args) < 2:
            verdict("SKIPPED", "인자 부족 — 판정을 요청받지 못했다(usage)")
            print("usage: sdd_gates.py verifyrun --record <asset> <JUDGED|OFF|INERT|SKIPPED> [사유...]",
                  file=sys.stderr)
            sys.exit(2)
        asset, outcome = record_args[0], record_args[1]
        detail = " ".join(record_args[2:]).strip()
        if not ledger_abs:
            verdict("INERT", "verificationRunLedger 미선언 — 기록할 원장이 없다")
            print("✗ verificationRunLedger가 선언되지 않아 기록할 곳이 없다 — sdd.config.json에 경로를 선언하라.",
                  file=sys.stderr)
            sys.exit(1)
        if outcome.upper() != "JUDGED" and not detail:
            judged(1)
            print(f"✗ {outcome} 기록에 사유가 없다 — 포기는 허용하되 **사유 없는 포기는 기록이 아니다**(SPEC-041).",
                  file=sys.stderr)
            sys.exit(1)
        os.makedirs(os.path.dirname(ledger_abs), exist_ok=True)
        row = json.dumps({"asset": asset, "outcome": outcome.upper(), "detail": detail,
                          "at": _utc_now_iso()}, ensure_ascii=False)
        with open(ledger_abs, "a", encoding="utf-8") as fh:
            fh.write(row + "\n")
        judged(0)
        print(f"검증 실행 기록 — {asset}: {outcome.upper()}{f' ({detail})' if detail else ''} → {ledger_rel}")
        sys.exit(0)

    if policy == "off":
        verdict("OFF", "verificationRunPolicy")
        print("검증 실행 회계 게이트 — verificationRunPolicy:off (판정 안 함)")
        sys.exit(0)
    hard = policy == "hard"

    if not ledger_abs:
        verdict("INERT", "verificationRunLedger 미선언 — 무엇이 실제로 돌았는지 볼 원장이 없다")
        print(f"검증 실행 회계 게이트(verificationRunPolicy={policy}): 판정 불가(inert) — verificationRunLedger 미선언(검증 절차가 결과를 기록할 곳이 없다)")
        if hard:
            print("\n✗ verificationRunPolicy=hard인데 원장이 없다 — hard 선언 + 무판정은 거짓 안전이다(SPEC-040). verificationRunLedger를 선언하고 러너·CI 스테이지가 --record로 남기게 하라.",
                  file=sys.stderr)
            sys.exit(1)
        sys.exit(0)

    declared = set()
    for file in spec_md_files(cfg, missing_fatal=False):
        for line in read_text(file).split("\n"):
            for p in evidence_paths_of(line):
                declared.add(p)
    paths = sorted(declared)
    if not paths:
        verdict("INERT", "선언된 실행 증거 경로 0건 — 대조할 축이 없다(SPEC-031 표기 부채)")
        print(f"검증 실행 회계 게이트(verificationRunPolicy={policy}): 판정 불가(inert) — 스펙에 `[검증: <경로>]` 표기가 0건이라 대조 대상이 없다")
        sys.exit(0)

    text = read_text(ledger_abs) if os.path.exists(ledger_abs) else ""
    entries, malformed = parse_run_ledger(text)
    # 환경 결속 선언(config, durable) — 사유 없는 항목은 무시한다(사유 없는 결속은 조용한 면제다).
    env_bound = cfg.get("verificationRunEnvBound")
    if not isinstance(env_bound, dict):
        env_bound = {}
    executed, debt, silent = classify_runs(paths, entries, compile_glob, env_bound)
    blocking, violations = verification_run_verdict(policy, silent, malformed)
    judged(violations)

    cap = int(cfg.get("verificationRunListCap") or 12)
    tag = "✗" if hard else "⚠"
    mal_tag = f"·깨진 기록 {len(malformed)}" if malformed else ""
    print(f"검증 실행 회계 게이트(verificationRunPolicy={policy}): 선언 증거 {len(paths)}건 — "
          f"실행됨 {len(executed)}·사유 있는 미실행 {len(debt)}·기록 없음 {len(silent)}{mal_tag} | 원장 {ledger_rel}")
    for path, e in debt[:cap]:
        print(f"  · [{e['outcome']}] {path} — {e['detail']}")
    if len(debt) > cap:
        print(f"  · … 외 {len(debt) - cap}건")
    for p in silent[:cap]:
        print(f"  {tag} 기록 없음: {p} — 이 자산이 돌았다는 기록이 원장에 없다(안 돈 것과 구분되지 않는다). 러너·CI 스테이지가 --record로 남기게 하라")
    if len(silent) > cap:
        print(f"  {tag} … 외 {len(silent) - cap}건")
    for m in malformed[:cap]:
        print(f"  {tag} 깨진 기록: {m['why']} — {m['raw'][:120]}")

    if blocking:
        print(f"\n✗ verificationRunPolicy=hard: 선언된 증거가 돌았다는 기록이 없다({len(silent)}건)"
              f"{f' · 깨진 기록 {len(malformed)}건' if malformed else ''} — **존재는 실행이 아니다**. "
              f"돌렸으면 기록하고, 못 돌렸으면 사유와 함께 남겨라(포기는 허용, 침묵은 금지).", file=sys.stderr)
        sys.exit(1)
    if not silent and not malformed:
        print(f"검증 실행 회계 게이트: OK — 침묵 0건(사유 있는 미실행 {len(debt)}건은 부채로 표면화 중)."
              if debt else "검증 실행 회계 게이트: OK — 선언된 증거가 모두 실행 기록을 갖는다.")


def main():
    args = sys.argv[1:]
    if not args:
        print(USAGE, file=sys.stderr)
        sys.exit(2)
    sub = args[0]
    strict = "--strict" in args
    # 판정 타입 방출(SPEC-040) — 어떤 종료 경로로 끝나든 한 줄. 선언 안 하면 UNTYPED로 자백된다.
    # Node판 게이트는 파일마다 armVerdict()를 부르지만 Python판은 단일 엔트리라 여기서 한 번이다.
    arm_verdict()
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
            verdict("SKIPPED", "인자 없음 — 판정을 요청받지 못했다(usage)")
            print("usage: python sdd_gates.py run <stage>", file=sys.stderr)
            sys.exit(2)
        cmd_run(cfg, args[1])
    elif sub == "testrun":
        cmd_testrun(cfg)
    elif sub == "schemadrift":
        cmd_schemadrift(cfg)
    elif sub == "ratchet":
        cmd_ratchet(cfg, positional[0] if positional else None)
    elif sub == "engineevent":
        cmd_engineevent(cfg)
    elif sub == "evidence":
        cmd_evidence(cfg)
    elif sub == "livereality":
        cmd_livereality(cfg)
    elif sub == "synonym":
        cmd_synonym(cfg)
    elif sub == "verifyrun":
        rec = None
        if "--record" in args:
            rec = args[args.index("--record") + 1:]
        cmd_verifyrun(cfg, rec)
    elif sub == "sccoverage":
        cmd_sccoverage(cfg)
    else:
        print(f"unknown subcommand: {sub}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
