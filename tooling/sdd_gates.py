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
import time
from datetime import datetime, timezone

# ── 판정 3분류 반환 계약(check-outcome-lib.mjs 패리티, SPEC-054) ───────────────
# SPEC-040은 **게이트**가 스윕에 내는 판정 종류이고, 이것은 **코어**가 게이트에 돌려주는 형태다.
# 040의 선언은 코어 반환값의 **해석**이므로, 코어에 "못 봤다"의 통로가 없으면 게이트는 그 사실을
# 알 방법이 없고 빈 findings를 clean으로 읽는다 — 판정이 사라지는 자리는 코어와 게이트의 경계다.
# 실측: 낡은 훅 사본이 green으로 보고돼 강제 정책이 한 번도 발화하지 않았고, 반대 방향으로는
# 존재 판정기 주입 코어에서 읽기 실패가 `False`로 붕괴해 "부재"=위반이라는 거짓 판정이 가능했다.
CHECK_KINDS = {"CLEAN": "clean", "UNCHECKED": "could-not-check", "VIOLATION": "violation"}
TRI_YES, TRI_NO, TRI_UNKNOWN = "yes", "no", "unknown"


def tri(value):
    """bool | TRI → TRI 정규화. None은 **UNKNOWN**이다(모르는 것을 없다고 하지 않는다)."""
    if value is True or value == TRI_YES:
        return TRI_YES
    if value is False or value == TRI_NO:
        return TRI_NO
    return TRI_UNKNOWN


def tri_guard(fn):
    """던지는 판정기를 3상태로 감싼다 — 예외를 False로 삼키던 자리가 이 결함의 발생 지점이다."""
    def wrapped(*args):
        try:
            return tri(fn(*args))
        except Exception:
            return TRI_UNKNOWN
    return wrapped


def check_outcome(violations=None, unchecked=None):
    """코어 반환값을 계약 형태로 정규화한다 — 위반이 UNCHECKED를 **가리지 않는다**."""
    v = list(violations or [])
    u = list(unchecked or [])
    kind = CHECK_KINDS["VIOLATION"] if v else (CHECK_KINDS["UNCHECKED"] if u else CHECK_KINDS["CLEAN"])
    return {"kind": kind, "violations": v, "unchecked": u}


def merge_outcomes(*outcomes):
    v, u = [], []
    for o in outcomes:
        if not o:
            continue
        v.extend(list(o.get("violations") or []))
        u.extend(list(o.get("unchecked") or []))
    return check_outcome(v, u)


def outcome_summary(outcome, subject="판정"):
    """게이트가 사람에게 낼 한 줄 — **못 본 것을 초록에 합산하지 않는다.**"""
    o = outcome or check_outcome()
    if o["kind"] == CHECK_KINDS["VIOLATION"]:
        tail = f" · 확인 못 함 {len(o['unchecked'])}건(통과 아님)" if o["unchecked"] else ""
        return f"{subject}: 위반 {len(o['violations'])}건{tail}"
    if o["kind"] == CHECK_KINDS["UNCHECKED"]:
        return f"{subject}: 위반 0건 · **확인 못 함 {len(o['unchecked'])}건** — 통과가 아니다"
    return f"{subject}: 위반 0건 · 확인 못 함 0건"


# ── 게이트 실패 원장(gate-failure-lib.mjs 패리티, SPEC-057) ───────────────────
# 실측 제보: 에이전트가 하루에 같은 실수를 세 번 했다. 게이트는 매번 잡았지만 "이게 오늘
# 세 번째"라는 정보가 어디에도 없었다 — 감시자가 아니라 **기억**이 없다.
DEFAULT_GATE_FAILURE_LEDGER = ".sdd/gate-failures.jsonl"
DEFAULT_ESCALATION_THRESHOLD = 3


def parse_ledger(raw):
    """반환 {"records", "unreadable"} — 깨진 줄은 조용히 버리지 않는다."""
    records, unreadable = [], 0
    for line in str(raw or "").split("\n"):
        t = line.strip()
        if not t:
            continue
        try:
            r = json.loads(t)
            if isinstance(r, dict):
                records.append(r)
            else:
                unreadable += 1
        except Exception:
            unreadable += 1
    return {"records": records, "unreadable": unreadable}


def make_failure_record(fields):
    meta = fields.get("meta") or {}
    return {
        "gate": str(fields.get("gate") or "unknown"),
        "kind": str(fields.get("kind") or ""),
        "detail": str(fields.get("detail") or ""),
        "exitCode": fields.get("exitCode") if isinstance(fields.get("exitCode"), int) else None,
        "class": str(meta["class"]) if meta.get("class") else None,
        "target": str(meta["target"]) if meta.get("target") else None,
        "ts": fields.get("ts"),
        "sessionId": fields.get("sessionId") or "unknown",
    }


def class_counts(records):
    """class 없는 레코드는 집계하지 않는다 — 선언 없는 실패는 가시성이지 강제가 아니다."""
    groups = {}
    for r in (records or []):
        if not r or not r.get("class"):
            continue
        key = (str(r.get("gate") or ""), str(r["class"]))
        if key not in groups:
            groups[key] = {"gate": key[0], "class": key[1], "count": 0, "targets": [], "lastTs": None}
        g = groups[key]
        g["count"] += 1
        if r.get("target") and r["target"] not in g["targets"]:
            g["targets"].append(r["target"])
        if r.get("ts") and (not g["lastTs"] or r["ts"] > g["lastTs"]):
            g["lastTs"] = r["ts"]
    return sorted(groups.values(), key=lambda g: (-g["count"], g["gate"], g["class"]))


GATE_FAILURE_GUARD_FINDING_TEXT = {
    "incomplete": "gate·class·guard 3필드가 모두 있어야 한다",
    "no-reason": "사유(note)가 없다 — 왜 이 클래스가 해소됐다고 보는지 없으면 무언의 면제다",
    "stale": "가드로 지목한 파일이 실재하지 않는다 — 선언만으로 믿지 않는다",
}


def guard_findings(guards, exists=None):
    out = []
    for i, g in enumerate(guards or []):
        at = f'{g.get("gate")}/{g.get("class")}' if g and g.get("gate") and g.get("class") else f"#{i + 1}"
        if not g or not g.get("gate") or not g.get("class") or not g.get("guard"):
            out.append({"kind": "incomplete", "at": at})
            continue
        if not str(g.get("note") or "").strip():
            out.append({"kind": "no-reason", "at": at})
            continue
        if callable(exists) and not exists(g["guard"]):
            out.append({"kind": "stale", "at": at, "guard": g["guard"]})
    return out


def _guard_key(g):
    return (g["gate"], g["class"])


def escalation_findings(counts, guards, threshold=DEFAULT_ESCALATION_THRESHOLD):
    guarded = {_guard_key(g) for g in (guards or []) if g and g.get("gate") and g.get("class")}
    return [c for c in (counts or []) if c["count"] >= threshold and (c["gate"], c["class"]) not in guarded]


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


def verdict(kind, detail="", meta=None):
    """meta — {"class", "target"} 선택적 구조화 메타(SPEC-057). **선언이지 추측이 아니다**:
    게이트가 스스로 넘기지 않으면 실패는 원장에 남아도(gate·kind·detail) 에스컬레이션 집계에는
    들어가지 않는다. 문자열을 정규식·키워드로 분류하는 것은 이 방법론이 금지하는 추측이다."""
    global _VERDICT
    _VERDICT = (kind, detail, meta)


def judged(violations=0):
    verdict("JUDGED", f"위반 {violations}건" if violations > 0 else "위반 0건")


_EXIT_CODE = None
_CURRENT_SUB = None


def _capture_exit_code(code):
    global _EXIT_CODE
    _EXIT_CODE = code if isinstance(code, int) else (0 if code is None else 1)


def _gate_name():
    """Python은 단일 파일이라 서브커맨드 없이는 모든 판정이 파일명 하나로 뭉개진다 — 서브커맨드를
    붙여 Node판의 게이트별 파일명(check-fr-placement.mjs 등)과 같은 층위로 맞춘다."""
    base = "sdd_gates.py"
    try:
        base = os.path.basename(sys.argv[0] or base) or base
    except Exception:
        pass
    return f"{base}:{_CURRENT_SUB}" if _CURRENT_SUB else base


def _resolve_ledger_path():
    """verdict-lib.mjs와 같은 이유로 config를 다시 빌드하지 않는다 — 원장 경로 오버라이드
    키만 가볍게 본다(전체 load_config()는 각 게이트가 자기 main에서 이미 한 번 했다)."""
    cfg_path = find_config(os.getcwd())
    root = os.path.dirname(cfg_path) if cfg_path else os.getcwd()
    rel = DEFAULT_GATE_FAILURE_LEDGER
    if cfg_path:
        try:
            with open(cfg_path, encoding="utf-8") as fh:
                raw = json.load(fh)
            if isinstance(raw, dict) and isinstance(raw.get("gateFailureLedger"), str) and raw["gateFailureLedger"].strip():
                rel = raw["gateFailureLedger"].strip()
        except Exception:
            pass
    return os.path.join(root, *rel.split("/"))


def _append_gate_failure(kind, detail, meta, code):
    path = _resolve_ledger_path()
    record = make_failure_record({
        "gate": _gate_name(), "kind": kind, "detail": detail, "exitCode": code, "meta": meta,
        "ts": datetime.now(timezone.utc).isoformat(),
        "sessionId": os.environ.get("SDD_SESSION_ID") or "unknown",
    })
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def arm_verdict(quiet_when_silent=False):
    """모든 종료 경로에서 판정 줄 하나. sys.exit도 atexit를 탄다.

    os.write(1, …)를 쓰는 이유는 Node판과 같다 — print는 버퍼를 타서 종료 훅에서 유실될 수 있다.
    실패 원장(SPEC-057) append도 여기 한 곳에서 한다 — atexit는 exit code를 받지 못하므로
    `_capture_exit_code`(파일 하단의 진입점 래퍼)가 먼저 `_EXIT_CODE`를 채워 둔다."""
    global _VERDICT_QUIET
    _VERDICT_QUIET = bool(quiet_when_silent)
    import atexit

    def _emit():
        if _VERDICT is None and _VERDICT_QUIET:
            return
        kind, detail, meta = _VERDICT if _VERDICT else (
            "UNTYPED", "게이트가 판정 종류를 선언하지 않았다(배선 누락 — verdict() 호출 없음)", None)
        try:
            sys.stdout.flush()
            os.write(1, (format_verdict(kind, detail) + "\n").encode("utf-8"))
        except Exception:
            pass
        if _EXIT_CODE not in (None, 0):
            try:
                _append_gate_failure(kind, detail, meta, _EXIT_CODE)
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
    "blockingBranches": {},
    "watchdogPolicy": "advisory",
    "watchdogReceipt": None,
    "watchdogCiGlobs": None,
    # 배선 무결성(SPEC-050) — 게이트가 애초에 로드되는가. 부분 동기화(게이트 최신·lib 구판)는
    # 배포 폐포 계약으로도 안 잡힌다: 그건 파일 실재, 이건 export 실재다.
    "importWiringPolicy": "advisory",
    "importWiringExtensions": None,
    # 에이전트 배선 실재(SPEC-051) — 감시자가 에이전트를 보는가.
    "agentWiringPolicy": "advisory",
    "agentSettingsFile": None,
    "agentHookDecl": None,
    "agentScriptDir": None,
    # 면제 등록부·면제 knob 목록(SPEC-027 확장) — 미등록 면제는 위반, 개수는 래칫된다.
    "exemptionRegistry": {},
    "exemptionKnobs": None,
    # 명세 자기모순 감사(SPEC-052) — 감사의 결정적 절반.
    "specConflictPolicy": "advisory",
    "specConflictMinTokens": None,
    "specConflictMaxDocFreq": None,
    "specConflictStopwords": None,
    "specConflictNegationMarkers": None,
    "specConflictClauseBreaks": None,
    # 진단 진입점 명세 강제 열람(SPEC-053) — 조회는 커밋을 남기지 않으므로 도구 호출 직전에 발동.
    "diagnosisGuardPolicy": "advisory",
    "completionSignalPolicy": "advisory",
    # FR 배치(SPEC-056) — FR 정의는 `## Functional Requirements` 섹션 안에 있어야 한다.
    "frPlacementPolicy": "advisory",
    # 게이트 실패 에스컬레이션(SPEC-057) — 원장에서 같은 (게이트,클래스)가 임계치를 넘겼는데
    # 전용 가드가 없으면 말한다. 목적은 벌이 아니라 기억이다.
    "gateFailureEscalationPolicy": "advisory",
    "gateFailureEscalationThreshold": 3,
    "gateFailureLedger": None,
    "gateFailureGuards": [],
    # 위험 행동 승인(SPEC-058) — 되돌리기 어려운 행동은 독립 서브에이전트 검증 마커 없이
    # 지나가지 않는다. 마커는 행동 페이로드 해시에 결속된다.
    "riskyActionPolicy": "advisory",
    "riskyActionPatterns": [],
    "riskyActionApprovalTtlSeconds": 900,
    "riskyActionLedger": None,
    "diagnosisSpecMap": [],
    "diagnosisSpecReadPatterns": None,
    "diagnosisGuideSections": None,
    "sweepInvocationMarkers": None,
    "syncRulesFile": None,
    "implModuleExtensions": None,
    "localHostPatterns": None,
    "processDocRegex": None,
    "processes": {},
    "processSsotPolicy": "advisory",
    "processSsotListCap": 12,
    "processFragmentMinStages": 2,
    "statefulStageMarkers": None,
    "browserGradeMethods": None,
    "deployGradeMethods": None,
    "implReferencePolicy": "advisory",
    "implReferenceListCap": 12,
    "implReferenceProseRegex": None,
    "introDocs": [],
    "introDocRuleSource": "HARNESS.md",
    "introDocPolicy": "advisory",
    "termGlossary": [],
    "termCoveragePolicy": "advisory",
    "termCoverageListCap": 12,
    "externalTargetPolicy": "advisory",
    "externalTargetListCap": 12,
    "evidenceScopePolicy": "advisory",
    "observationMarkers": None,
    "evidenceScopeLabels": None,
    "environmentMarkers": None,
    "hooksInstalledPolicy": "advisory",
    "syncHookRules": None,
    "syncHookDelegatedTo": "",
    "outOfBandDeployPolicy": "advisory",
    "outOfBandDeployCommands": None,
    "outOfBandDeployDebtFile": ".sdd/deploy-debt.jsonl",
    "deployPreconditionPolicy": "off",
    "deploySmokeCommand": None,
    "deploySmokeTimeoutMs": 60000,
    "deployScopeCommand": None,
    "pipelineConfigFile": None,
    "deployWindowPolicy": "off",
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
    "specSyncUnownedPolicy",
    "draftBlockPolicy",
    "semanticDriftPolicy",
    "capabilityOwnershipPolicy",
    "frKeyAnchorPolicy",
    "runTestsPolicy",
    "migrationStatePolicy",
    "entitySchemaBackingPolicy",
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
    "termCoveragePolicy",
    "externalTargetPolicy",
    "evidenceScopePolicy",
    "introDocPolicy",
    "implReferencePolicy",
    "processSsotPolicy",
    "watchdogPolicy",
    "importWiringPolicy",
    "agentWiringPolicy",
    "specConflictPolicy",
    "diagnosisGuardPolicy",
    "completionSignalPolicy",
    "liveRealityCoveragePolicy",
    "preEditSpecFirstPolicy",
    "frPlacementPolicy",
    "gateFailureEscalationPolicy",
    "riskyActionPolicy",
    "deployWindowPolicy",
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
    # 종류가 다른 기록은 깨진 기록이 아니다 — 분기 발화 기록(SPEC-049)은 조용히 건너뛴다.
    if not asset and str(o.get("branch") or "").strip():
        return None
    if not asset:
        return {"malformed": True, "raw": line, "why": "asset·branch 둘 다 없음 — 무엇에 대한 기록인지 알 수 없다"}
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
    spec_md_names = sorted(f for f in spec_names if is_spec_md_name(f))
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
    ownership_units = []  # {specId, specText, files} — 결정 입도 판정 입력(SPEC-044)
    for f in spec_md_names:
        m = cfg["__specId"].search(f)
        if not m:
            continue  # 미등록 접두어는 위 0단계가 이미 에러 처리
        sid = m.group(0)
        pfx = re.match(r"^([A-Z]+)-", f).group(1)
        text = read_text(os.path.join(spec_dir, f))
        globs = [compile_glob(g) for g in
                 (strip_inline_comment(x) for x in parse_section(text, "Ownership", ["Files"])["Files"]) if g]
        matched_files = sorted(p for p in all_repo_files if any(rx.search(p) for rx in globs)) if globs else []
        owned = [p for p in matched_files if not is_test_file(os.path.basename(p), cfg)]
        # 결정 입도 축(SPEC-044)은 테스트도 본다 — 실측 사례의 BASE_URL 폴백은 e2e 설정에 있었다.
        if matched_files:
            ownership_units.append({"specId": sid, "specText": text, "files": matched_files})
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
    fr_text = {}       # "SPEC/FR" -> FR 선언 라인 원문 (SPEC-042 의미 커버리지 입력)
    norm_text = {}     # "SPEC/<FR|NFR|SC>" -> 규범 선언 라인 원문 (SPEC-046 지목 구현체 입력)
    norm_decl = re.compile(rf"^\s*-?\s*\*\*((?:{cfg['__reqAlt']}|NFR|SC)-\d{{3}}[a-z]?)\*\*")
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
            fr_text.setdefault(f"{m.group(0)}/{fr2.group(1)}", t2)
        # 규범 선언 라인 전체(FR + NFR + SC) — 지목 구현체 참조 축(SPEC-046)의 입력.
        # fr_text와 분리한다: fr_text는 SPEC-042가 FR만 보도록 정한 집합이다.
        for line in text.split("\n"):
            t3 = line.strip()
            if t3.startswith("|"):
                continue
            m3 = norm_decl.search(t3)
            if not m3:
                continue
            norm_text.setdefault(f"{m.group(0)}/{m3.group(1)}", t3)
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
    cover_files = {}      # "SPEC/FR" -> [파일 경로] — 의미 커버리지 입력(SPEC-042)
    cover_file_text = {}  # 파일 경로 -> 본문(태그가 있는 파일만 보관)
    for scan in cfg["scanDirs"]:
        for file in walk_tests(resolve(cfg, scan), cfg):
            text = read_text(file)
            for spec, fr in cfg["__covers"].findall(text):
                covered.setdefault(spec, set()).add(fr)
                key = f"{spec}/{fr}"
                cover_tags.append({"file": rel_from_root(cfg, file), "specId": spec, "frId": fr})
                cover_seen.add(key)
                if file not in cover_files.setdefault(key, []):
                    cover_files[key].append(file)
                cover_file_text.setdefault(file, text)
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
        # core.quotepath=off — 인용된 8진수 경로는 어떤 소유 글롭과도 매치하지 않아 귀속이 조용히 사라진다.
        out2 = subprocess.run(["git", "-c", "core.quotepath=off", "diff", "--cached", "--name-only"], cwd=cfg["__root"],
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

    # R1c: 의미 커버리지(SPEC-042) — @covers는 "인용했다"이지 "시험했다"가 아니다.
    tc_policy = str(cfg.get("termCoveragePolicy") or "advisory")
    if tc_policy not in ("off", "advisory", "hard"):
        print(f'✗ termCoveragePolicy 값 위반 "{tc_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if tc_policy != "off":
        glossary = cfg.get("termGlossary") or []
        if not glossary:
            print(f"의미 커버리지(termCoveragePolicy={tc_policy}): **용어집 미선언 — 판정하지 않는다**."
                  " termGlossary에 FR이 이름 대는 프로토콜·외부 시스템·제품명을 등록하면"
                  ' "그 이름이 커버 파일에 없다"를 대조한다(킷은 산문에서 고유명사를 자동 추출하지 않는다'
                  " — 오탐 폭풍이라 이미 거부된 길이다).")
        else:
            units = []
            for key, t3 in fr_text.items():
                files3 = sorted(cover_files.get(key) or [])
                if not files3:
                    continue
                sid3, frid3 = key.split("/")
                units.append({"specId": sid3, "frId": frid3, "text": t3,
                              "coveringTexts": [cover_file_text.get(x, "") for x in files3]})
            tc_findings = term_coverage_findings(units, glossary)
            print(f"의미 커버리지(termCoveragePolicy={tc_policy}): 용어 {len(glossary)}종 × 커버된 FR {len(units)}건 대조"
                  f" — 미실증 {len(tc_findings)}건")
            tc_cap = int(cfg.get("termCoverageListCap") or 12)
            tc_block = tc_policy == "hard" or strict
            for f in tc_findings[:tc_cap]:
                (errors if tc_block else warnings).append(
                    f"[{f['specId']}/{f['frId']}] FR이 \"{f['term']}\"을(를) 주장하는데 이 FR을 커버하는 어떤 파일에도 "
                    "그 이름이 없다 — 대상을 실제로 건드리는 검증을 추가하거나, 구현이 다른 이름을 쓴다면 "
                    "termGlossary 동의어로 등록하라")
            if len(tc_findings) > tc_cap:
                (errors if tc_block else warnings).append(
                    f"의미 커버리지 미실증 … 외 {len(tc_findings) - tc_cap}건 (termCoverageListCap 상향으로 확인)")
            if not tc_findings:
                print("  ✓ 등록 용어를 주장한 FR은 모두 그 이름을 커버 파일에서 확인할 수 있다.")

    # R1d: 결정 입도(SPEC-044) — 소유는 파일 단위인데 동작을 정하는 결정은 파일 안에 있다.
    xt_policy = str(cfg.get("externalTargetPolicy") or "advisory")
    if xt_policy not in ("off", "advisory", "hard"):
        print(f'✗ externalTargetPolicy 값 위반 "{xt_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if xt_policy != "off":
        xt_units = []
        for u in ownership_units:
            for rel in u["files"]:
                try:
                    body = read_text(os.path.join(root, rel))
                except OSError:
                    continue
                xt_units.append({"path": rel, "text": body, "specId": u["specId"], "specText": u["specText"]})
        xt = external_target_findings(xt_units, cfg.get("localHostPatterns"))
        print(f"결정 입도(externalTargetPolicy={xt_policy}): 소유 파일 {len(xt_units)}건에서 env 폴백 기본값 검사"
              f" — 미공개 외부 대상 {len(xt)}건")
        xt_cap = int(cfg.get("externalTargetListCap") or 12)
        xt_block = xt_policy == "hard" or strict
        for f in xt[:xt_cap]:
            (errors if xt_block else warnings).append(
                f"[{f['specId']}] {f['path']}: `{f['env']}` 폴백 기본값 \"{f['value']}\"({f['kind']})이 외부 대상인데 "
                "소유 스펙이 그 대상을 언급하지 않는다 — 환경변수가 비면 여기로 간다는 사실은 계약이다. "
                "FR·Edge Cases 어디든 스펙 본문에 적어라(위치는 강제하지 않는다)")
        if len(xt) > xt_cap:
            (errors if xt_block else warnings).append(
                f"결정 입도 미공개 … 외 {len(xt) - xt_cap}건 (externalTargetListCap 상향으로 확인)")
        if not xt:
            print("  ✓ 소유 파일의 env 폴백 기본값 중 스펙이 모르는 외부 대상은 없다(미소유 파일은 R4가 본다).")

    # R1e: 지목 구현체 참조(SPEC-046) — 스펙이 이름으로 지목한 메커니즘은 실행 경로에 있어야 한다.
    ir_policy = str(cfg.get("implReferencePolicy") or "advisory")
    if ir_policy not in ("off", "advisory", "hard"):
        print(f'✗ implReferencePolicy 값 위반 "{ir_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if ir_policy != "off":
        prose = re.compile(str(cfg.get("implReferenceProseRegex") or DEFAULT_IMPL_PROSE_REGEX))

        def _is_test_name(n):
            return is_test_file(os.path.basename(str(n)), cfg)

        ir_units = []
        for key, t4 in norm_text.items():
            names = named_implementations(t4, _is_test_name, cfg.get("implModuleExtensions"))
            if not names:
                continue
            sid4, frid4 = key.split("/")
            ir_units.append({"specId": sid4, "frId": frid4, "names": names, "key": key})
        sources = []
        if ir_units:
            for rel in all_repo_files:
                if _is_test_name(rel) or prose.search(rel):
                    continue
                try:
                    sources.append({"path": rel, "text": read_text(os.path.join(root, rel))})
                except OSError:
                    continue
        ir_findings = impl_reference_findings(ir_units, sources)
        ir_cover = []
        for u in ir_units:
            files4 = sorted(cover_files.get(u["key"]) or [])
            if not files4:
                continue
            unit = {"specId": u["specId"], "frId": u["frId"], "text": norm_text.get(u["key"]),
                    "coveringTexts": [cover_file_text.get(x, "") for x in files4]}
            ir_cover.extend(term_coverage_findings([unit], [n["name"] for n in u["names"]]))
        ir_total = sum(len(u["names"]) for u in ir_units)
        print(f"지목 구현체 참조(implReferencePolicy={ir_policy}): FR {len(ir_units)}건이 백틱으로 지목한 구현체 {ir_total}종"
              f" × 소스 {len(sources)}건 — 미참조 {len(ir_findings)}건 · 커버 미언급 {len(ir_cover)}건")
        ir_cap = int(cfg.get("implReferenceListCap") or 12)
        ir_block = errors if (ir_policy == "hard" or strict) else warnings
        for f in ir_findings[:ir_cap]:
            noun = "함수" if f["kind"] == "fn" else "모듈"
            if f["refs"] == 0:
                ir_block.append(f'[{f["specId"]}/{f["frId"]}] FR이 지목한 {noun} `{f["name"]}`이 저장소의 비-테스트 소스에 **아예 없다**'
                                " — 스펙이 말하는 메커니즘과 실제 실행 경로가 다르다(이름이 바뀌었거나 다른 구현으로 대체됐다)")
            else:
                ir_block.append(f'[{f["specId"]}/{f["frId"]}] FR이 지목한 {noun} `{f["name"]}`이 정의만 있고 참조되지 않는다(등장 {f["refs"]}회 < 기준 {f["bar"]})'
                                " — **고아 구현**이다. 표면이 같은 일을 따로 구현했는지 확인하고, 그렇다면 지목된 쪽으로 통일하라(재구현은 규칙이 갈라진다)")
        if len(ir_findings) > ir_cap:
            ir_block.append(f"지목 구현체 미참조 … 외 {len(ir_findings) - ir_cap}건 (implReferenceListCap 상향으로 확인)")
        for f in ir_cover[:ir_cap]:
            ir_block.append(f'[{f["specId"]}/{f["frId"]}] FR이 지목한 `{f["term"]}`이 이 FR을 커버하는 어떤 파일에도 없다'
                            " — 그 테스트는 FR의 주장이 아니라 **현재 구현의 형태**를 단언하고 있을 수 있다(그런 테스트는 회귀를 막지 않고 수정을 막는다)")
        if len(ir_cover) > ir_cap:
            ir_block.append(f"커버 미언급 … 외 {len(ir_cover) - ir_cap}건 (implReferenceListCap 상향으로 확인)")
        if not ir_units:
            print("  · 백틱으로 구현체를 지목한 FR 0건 — 이 축은 대조할 이름이 없다(FR이 함수는 `name()`, 모듈은 `name.ext` 꼴로 지목하면 판정이 시작된다).")
        elif not ir_findings and not ir_cover:
            print("  ✓ 지목된 구현체는 모두 실행 경로에서 참조되고 커버 파일이 그 이름을 안다.")

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

# 이름 정규식 폴백의 **단일 정본**(ownership-keys.mjs ROLE_NAME_PATTERNS 미러).
ROLE_NAME_PATTERNS = {"entity": "entit", "surface": "surface", "capability": "capabilit"}


def category_role_provenance(categories, roles):
    """역할이 **어디서 왔는가** — declared | inferred | unresolved.

    이름 폴백은 **성공했을 때 조용하다**: 실패하면 사유가 남지만 성공하면 판정이 추측 위에서
    진행되고 아무도 모른다. 카테고리를 개명하면 조준 대상이 바뀌는데 운영자는 통보받지 못한다.
    **추측이 금지인 방법론에서 추측의 성공은 침묵할 수 없다.**"""
    cats = categories or []
    declared_for = {}
    for cat, role in (roles or {}).items():
        r = str(role or "").strip().lower()
        match = next((c for c in cats if str(c).strip().lower() == str(cat).strip().lower()), None)
        if match and r not in declared_for:
            declared_for[r] = match
    out = {}
    for role, pat in ROLE_NAME_PATTERNS.items():
        if declared_for.get(role):
            out[role] = "declared"
        elif next((c for c in cats if re.search(pat, c, re.IGNORECASE)), None):
            out[role] = "inferred"
        else:
            out[role] = "unresolved"
    return out


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
    for role, pat in ROLE_NAME_PATTERNS.items():
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
DEFAULT_BROWSER_GRADE_METHODS = ["browser_smoke", "browser", "e2e", "ui_smoke"]
DEFAULT_DEPLOY_GRADE_METHODS = ["deployment", "deploy_smoke", "canary", "smoke"]

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
                      manifest_of=None, deploy_markers=None, deploy_patterns=None,
                      browser_grade_methods=None, deploy_grade_methods=None):
    vs = verbs if verbs else DEFAULT_EXECUTION_VERBS
    bpat = browser_patterns if browser_patterns else DEFAULT_BROWSER_EVIDENCE_PATTERNS
    bmark = browser_markers if browser_markers else DEFAULT_BROWSER_MARKERS
    dpat = deploy_patterns if deploy_patterns else DEFAULT_DEPLOY_EVIDENCE_PATTERNS
    dmark = deploy_markers if deploy_markers else DEFAULT_DEPLOY_MARKERS
    bgm = browser_grade_methods if browser_grade_methods else DEFAULT_BROWSER_GRADE_METHODS
    dgm = deploy_grade_methods if deploy_grade_methods else DEFAULT_DEPLOY_GRADE_METHODS
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
                    # 3분류 계약(SPEC-054) — 자산 실재를 **확인하지 못한** 것을 "없음"으로 말하면 거짓
                    # 위반이다(권한·I/O 오류). 반대로 통과로 흘리면 증거 없는 주장이 초록이 된다.
                    st = tri(asset_exists(p))
                    if st == TRI_NO:
                        out.append((u["specId"], c["id"], c["kind"], "missing-asset", f"증거 자산 없음: {p}"))
                    elif st == TRI_UNKNOWN:
                        out.append((u["specId"], c["id"], c["kind"], "asset-unchecked",
                                    f"증거 자산 실재를 확인하지 못했다: {p} — 통과가 아니다"))
                low = str(c["text"] or "").lower()
                # 등급은 **경로 또는 매니페스트 method** 둘 중 하나로 성립한다(evidence-lib.mjs 미러).
                if (any(marker_hits(low, m) for m in bmark)
                        and not any(is_browser_grade_evidence(p, bpat) for p in tag["paths"])
                        and not (man and str(man.get("method") or "") in bgm)):
                    out.append((u["specId"], c["id"], c["kind"], "browser-needs-ui-evidence",
                                f"UI/브라우저 대상인데 증거가 브라우저 등급 아님({', '.join(tag['paths'])}) — API 단독 검증은 변수 보간·렌더 단계 결함을 통과시킨다"))
                # 트리거는 **소유 + 주장** 둘 다다 — 마커만 걸면 배포를 *다루는* 스펙까지 잡힌다.
                if (u.get("ownsDeployArtifact")
                        and any(marker_hits(low, m) for m in dmark)
                        and not any(is_deploy_grade_evidence(p, dpat) for p in tag["paths"])
                        and not (man and str(man.get("method") or "") in dgm)):
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
    # **추측이 금지인 방법론에서 추측의 성공은 침묵할 수 없다**(check-ownership.mjs 미러).
    prov = category_role_provenance(cfg.get("ownershipCategories"), cfg.get("ownershipCategoryRoles"))
    inferred = [k for k, v in prov.items() if v == "inferred"]
    if inferred:
        print(f'  · 역할 {len(inferred)}종을 **이름으로 추론했다**({", ".join(inferred)}) — 선언이 아니다.'
              " 카테고리를 개명하면 판정 조준이 조용히 바뀐다. `ownershipCategoryRoles`로 선언하면 추측이 사라진다.")
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
    if not roles["entity"] and categories:
        print(f'· entity 역할을 해석하지 못해 **첫 카테고리 "{categories[0]}"로 추측했다** — 선언도 이름 폴백도 없었다.'
              " 순서가 의미를 갖는다는 근거는 없다: `ownershipCategoryRoles`로 entity를 선언하라(추측 위의 입도 판정은 조용히 틀린다).")
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


# ── 지목 구현체 참조 코어 (SPEC-046, impl-reference-lib.mjs 미러) ───────────
_FN_SPAN = re.compile(r"^([A-Za-z_$][A-Za-z0-9_$]*)\([^)]*\)$")
DEFAULT_IMPL_MODULE_EXTENSIONS = [
    "mjs", "cjs", "js", "jsx", "ts", "tsx", "py", "go", "rs", "rb", "java", "kt", "sh", "bash", "tf", "php", "cs", "swift",
]
DEFAULT_IMPL_PROSE_REGEX = r"\.(md|markdown|html|rst|adoc|txt|jsonl|lock)$"


def _mod_span_re(exts):
    lst = exts if exts else DEFAULT_IMPL_MODULE_EXTENSIONS
    alt = "|".join(re.escape(str(e).lstrip(".")) for e in lst)
    return re.compile(r"^([A-Za-z_$][A-Za-z0-9_.$-]*\.(?:" + alt + r"))$")
REFERENCE_BAR = {"fn": 2, "mod": 1}


def named_implementations(fr_text, is_test_name=None, module_extensions=None):
    """FR 선언 라인의 백틱 스팬에서 구현체 이름만 뽑는다(함수 호출형·모듈 파일명)."""
    mod_span = _mod_span_re(module_extensions)
    out, seen = [], set()
    for m in re.finditer(r"`([^`]+)`", str(fr_text or "")):
        span = m.group(1).strip()
        fn = _FN_SPAN.match(span)
        mod = mod_span.match(span)
        name = kind = None
        if fn:
            name, kind = fn.group(1), "fn"
        elif mod and not (is_test_name(mod.group(1)) if is_test_name else False):
            name, kind = mod.group(1), "mod"
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "kind": kind, "span": span})
    return out


def reference_count(text, name):
    """식별자 경계 매칭 — 대소문자를 구분한다(식별자는 대소문자가 의미를 가진다)."""
    return len(re.findall(r"(?:^|[^A-Za-z0-9_$])" + re.escape(str(name)) + r"(?:[^A-Za-z0-9_$]|$)", str(text or "")))


def impl_reference_findings(units, sources):
    """units: [{specId, frId, names}], sources: [{path, text}] — 기준 미달만 반환."""
    out = []
    for u in units or []:
        for n in u.get("names") or []:
            name, kind = n["name"], n["kind"]
            bar = REFERENCE_BAR.get(kind, 1)
            refs, sites = 0, []
            for src in sources or []:
                path = src["path"]
                if kind == "mod" and (path == name or str(path).endswith("/" + name)):
                    continue
                c = reference_count(src["text"], name)
                if c:
                    refs += c
                    sites.append(path)
            if refs < bar:
                out.append({"specId": u["specId"], "frId": u["frId"], "name": name,
                            "kind": kind, "refs": refs, "bar": bar, "sites": sites})
    return out


# ── 실행 관측 회계 코어 (SPEC-049, branch-observation-lib.mjs 미러) ─────────
BRANCH_OUTCOMES = ["FIRED", "PASSED", "SKIPPED"]


def parse_branch_line(raw):
    line = str(raw or "").strip()
    if not line:
        return None
    try:
        o = json.loads(line)
    except Exception:  # noqa: BLE001
        return {"broken": True, "raw": line}
    if not isinstance(o, dict):
        return {"broken": True, "raw": line}
    branch = str(o.get("branch") or "").strip()
    if not branch:
        return None                       # 분기 기록이 아니다(자산 기록일 수 있다)
    outcome = str(o.get("outcome") or "").strip()
    detail = str(o.get("detail") or "").strip()
    if outcome not in BRANCH_OUTCOMES:
        return {"broken": True, "raw": line, "branch": branch}
    return {"branch": branch, "outcome": outcome, "detail": detail}


def parse_branch_ledger(text):
    entries, broken = [], []
    for line in str(text or "").split("\n"):
        p = parse_branch_line(line)
        if not p:
            continue
        if p.get("broken"):
            broken.append(p)
        else:
            entries.append(p)
    return entries, broken


def classify_branches(declared, entries):
    by_key = {}
    for e in entries or []:
        by_key.setdefault(e["branch"], []).append(e)
    out = []
    for key in sorted((declared or {}).keys()):
        recs = by_key.get(key) or []
        fired = len([r for r in recs if r["outcome"] == "FIRED"])
        details = list(dict.fromkeys(r["detail"] for r in recs))
        if not recs:
            cls = "unobserved"
        elif not fired:
            cls = "never-fired"
        elif len(recs) >= 2 and len(details) == 1:
            cls = "monotone"
        else:
            cls = "observed"
        out.append({"key": key, "reason": str(declared.get(key) or ""), "records": len(recs),
                    "fired": fired, "details": len(details), "cls": cls})
    return out


def undeclared_branches(declared, entries):
    known = set((declared or {}).keys())
    return sorted({e["branch"] for e in (entries or [])} - known)


def validate_branch_declarations(declared):
    return [f'blockingBranches["{k}"] — 사유 필수(이 분기가 무엇을 막는가; 빈 값은 무언의 선언이다)'
            for k, v in (declared or {}).items() if not str(v or "").strip()]


def format_branch_line(branch, outcome, detail="", at=""):
    o = {"branch": str(branch), "outcome": str(outcome)}
    if detail:
        o["detail"] = str(detail)
    if at:
        o["at"] = str(at)
    return json.dumps(o, ensure_ascii=False)


def is_spec_md_name(name):
    """spec 파일명 판정 정본 — `<PREFIX>-NNN….md` (sdd-config.mjs isSpecMdName 미러).
    이 판단이 여러 곳에 흩어지면 한 게이트는 세고 다른 게이트는 안 세는 스펙이 생긴다."""
    n = str(name or "")
    return n.endswith(".md") and re.match(r"^[A-Z]+-\d{3}", n) is not None


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


# ── 의미 커버리지 코어 (SPEC-042, term-coverage-lib.mjs 미러) ──────────────
def _term_forms(entry):
    if isinstance(entry, dict):
        return [x for x in [entry.get("term")] + list(entry.get("synonyms") or []) if x]
    return [entry] if entry else []


def _display_term(entry):
    return entry.get("term") if isinstance(entry, dict) else entry


def claimed_terms(fr_text, glossary):
    out = []
    for entry in glossary or []:
        if any(marker_hits(fr_text, f) for f in _term_forms(entry)):
            out.append(_display_term(entry))
    return out


def term_coverage_findings(units, glossary):
    """units: [{specId, frId, text, coveringTexts:[...]}] — FR이 주장했는데 모든 커버 파일에 없는 용어."""
    out = []
    if not glossary:
        return out
    for u in units or []:
        covering = (u or {}).get("coveringTexts") or []
        if not covering:
            continue
        for entry in glossary:
            forms = _term_forms(entry)
            if not any(marker_hits(u["text"], f) for f in forms):
                continue
            if any(any(marker_hits(ct, f) for f in forms) for ct in covering):
                continue
            out.append({"specId": u["specId"], "frId": u["frId"], "term": _display_term(entry)})
    return out


# ── 결정 입도 코어 (SPEC-044, external-target-lib.mjs 미러) ────────────────
_FALLBACK_RES = [
    re.compile(r"""process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["'`]([^"'`]+)["'`]\s*\])\s*(?:\|\||\?\?)\s*["'`]([^"'`]+)["'`]"""),
    re.compile(r"""os\.(?:environ\.get|getenv)\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)"""),
    re.compile(r"""\$\{([A-Za-z_][A-Za-z0-9_]*)\s*:?-\s*([^}"'\s]+)\}"""),
]
_FULL_LINE_COMMENT = re.compile(r"^\s*(//|#|--|\*|<!--)")


def strip_full_line_comments(text):
    """전체가 주석인 줄만 걷어낸다 — 줄 안쪽의 //는 자르지 않는다(https://를 못 보게 된다)."""
    return "\n".join("" if _FULL_LINE_COMMENT.match(l) else l for l in str(text or "").split("\n"))


def env_fallbacks(text):
    out = []
    s = strip_full_line_comments(text)
    for rex in _FALLBACK_RES:
        for m in rex.finditer(s):
            groups = [g for g in m.groups() if g is not None]
            if len(groups) < 2:
                continue
            out.append({"env": groups[0], "value": groups[-1]})
    return out


DEFAULT_LOCAL_HOST_PATTERNS = [
    "localhost", r"127\.0\.0\.1", r"0\.0\.0\.0", r"\[::1\]", r"host\.docker\.internal",
    r"example\.com", r"example\.org", r".*\.example", r".*\.local", r".*\.test", r".*\.invalid",
]


def _local_hosts_re(pats):
    lst = pats if pats else DEFAULT_LOCAL_HOST_PATTERNS
    return re.compile("^(" + "|".join(lst) + ")$", re.I)


_LOCAL_HOSTS = _local_hosts_re(None)
_URL_HOST = re.compile(r"^[a-z][a-z0-9+.-]*://([^/?#\s:]+)", re.I)
_FQDN = re.compile(r"^(?!\d+(\.\d+)*$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?$", re.I)


def external_target_kind(value, local_host_patterns=None):
    local = _local_hosts_re(local_host_patterns) if local_host_patterns else _LOCAL_HOSTS
    v = str(value or "").strip()
    if not v:
        return None
    m = _URL_HOST.match(v)
    if m:
        return None if local.match(m.group(1)) else "url"
    if re.match(r"^arn:[a-z-]+:", v, re.I):
        return "arn"
    if re.match(r"^\d{12}$", v):
        return "account"
    if _FQDN.match(v):
        return None if local.match(re.sub(r":\d+$", "", v)) else "endpoint"
    return None


def spec_knows_target(spec_text, value):
    s = str(spec_text or "").lower()
    v = str(value or "").strip().lower()
    if not v:
        return False
    if v in s:
        return True
    m = re.match(r"^[a-z][a-z0-9+.-]*://([^/?#\s]+)", v, re.I)
    host = re.sub(r":\d+$", "", m.group(1)) if m else ""
    return bool(host) and host in s


def external_target_findings(units, local_host_patterns=None):
    """units: [{path, text, specId, specText}] — 미소유(specId 없음)는 판정하지 않는다."""
    out = []
    for u in units or []:
        if not u or not u.get("specId"):
            continue
        seen = set()
        for fb in env_fallbacks(u.get("text")):
            kind = external_target_kind(fb["value"], local_host_patterns)
            if not kind:
                continue
            key = f"{fb['env']} {fb['value']}"
            if key in seen:
                continue
            seen.add(key)
            if spec_knows_target(u.get("specText"), fb["value"]):
                continue
            out.append({"path": u["path"], "specId": u["specId"], "env": fb["env"],
                        "value": fb["value"], "kind": kind})
    return out


# ── 근거 적용범위 코어 (SPEC-043, evidence-scope-lib.mjs 미러) ─────────────
DEFAULT_OBSERVATION_MARKERS = [
    "실측", "관측", "재현", "측정", "실험", "확인함",
    "observed", "measured", "reproduced", "benchmark",
]
DEFAULT_SCOPE_LABELS = ["범위", "관측범위", "관측 범위", "환경", "scope", "observed on"]
DEFAULT_ENVIRONMENT_MARKERS = [
    "리눅스", "linux", "macos", "맥os", "windows", "윈도우", "wsl", "x11", "wayland",
    "도커", "docker", "컨테이너", "container", "우분투", "ubuntu", "alpine",
    "arm64", "amd64", "x86", "런타임 환경",
]


def scope_declared(text, labels):
    s = str(text or "")
    for label in (labels or DEFAULT_SCOPE_LABELS):
        if re.search(re.escape(str(label)) + r"\s*[:：]\s*\S", s, re.I):
            return True
    return False


def claims_observation(text, markers):
    return any(marker_hits(text, m) for m in (markers or DEFAULT_OBSERVATION_MARKERS))


def named_environments(text, env_markers):
    return [m for m in (env_markers or DEFAULT_ENVIRONMENT_MARKERS) if marker_hits(text, m)]


def evidence_scope_findings(text, markers=None, labels=None, env_markers=None):
    out = []
    for date, cells in change_log_dated_rows(text):
        rationale = cells[2]
        if not rationale:
            continue
        if not claims_observation(rationale, markers):
            continue
        envs = named_environments(rationale, env_markers)
        if not envs:
            continue
        if scope_declared(rationale, labels):
            continue
        out.append({"date": date, "rationale": rationale, "environments": envs})
    return out


def change_log_dated_rows(text):
    """Change Log의 실기록 행 선별 정본 — 이 판단은 한 곳에만 있어야 한다(derivation-lib.mjs 미러)."""
    block = section_block(text, "Change Log")
    if block is None:
        return []
    rows = []
    for line in block.split("\n"):
        if not re.match(r"^\s*\|", line):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 3:
            continue
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", cells[0]):
            continue
        rows.append((cells[0], cells))
    return rows


def change_log_rationale_findings(text):
    """선제 캡처(SPEC-009 FR-006) — 실제 날짜 행의 근거 칸이 빈 값이면 그 날짜."""
    return [d for d, cells in change_log_dated_rows(text) if not cells[2]]


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
    hard_idx = set()    # hard 승급 축의 항목 색인 — --strict 없이도 막는다(정책 승급이 실효를 가져야 한다)
    scope_policy = str(cfg.get("evidenceScopePolicy") or "advisory")
    if scope_policy not in ("off", "advisory", "hard"):
        print(f'✗ evidenceScopePolicy 값 위반 "{scope_policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
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
        # 근거 적용범위(SPEC-043) — 관측은 그 관측이 이루어진 범위까지만 참이다.
        if scope_policy != "off":
            for f in evidence_scope_findings(text, cfg.get("observationMarkers"),
                                             cfg.get("evidenceScopeLabels"), cfg.get("environmentMarkers")):
                item = (spec_id, f"Change Log {f['date']} 행: 근거가 특정 환경({'·'.join(f['environments'])})에서의 "
                                 "관측을 주장하는데 **관측 범위 표기가 없다** — `범위: <이 결론이 참인 범위>`를 근거 칸에 "
                                 "덧붙여라(1대에서 본 것을 보편 규칙으로 올렸는지 되짚을 축이 생긴다)")
                findings.append(item)
                if scope_policy == "hard":
                    hard_idx.add(len(findings) - 1)
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
        for i, (spec_id, miss) in enumerate(findings):
            print(f"  {'✗' if strict or i in hard_idx else '⚠'} {spec_id}: {miss}")
        if strict:
            print("\n✗ --strict: FR 있는 spec은 SC·인수조건, Reviewed 이상은 리뷰 기록, Change Log 실기록 행은 근거 필요.", file=sys.stderr)
            sys.exit(1)
        if hard_idx:
            print(f"\n✗ hard 승급 축 위반 {len(hard_idx)}건 — 해당 정책이 hard이므로 --strict 없이도 막는다.", file=sys.stderr)
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
    exists: (relPath) -> bool|TRI 주입(파일 IO는 호출자가 한다).
    반환 {"missing": [...], "unchecked": [...]} — 확인 못 한 것은 부재가 아니다(SPEC-054)."""
    out, unchecked = [], []
    for raw in tokens or []:
        t = str(raw or "").strip()
        if not t or t in ("—", "-"):
            continue
        if re.search(r"[*?{}]", t):
            continue
        if t.startswith("["):
            continue
        # 3분류 계약(SPEC-054) — 실재를 **확인 못 한** 경로는 "부재"가 아니다(권한·I/O).
        st = tri(exists(t))
        if st == TRI_NO:
            out.append(t)
        elif st == TRI_UNKNOWN:
            unchecked.append(t)
    return {"missing": out, "unchecked": unchecked}


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
            paths = files_line_missing_paths(
                sorted(globs), lambda rel: os.path.exists(resolve(cfg, rel)))
            missing_lit = [rel for rel in paths["missing"] if rel not in deleted_paths]
            # 3분류(SPEC-054) — 실재를 확인 못 한 경로는 "부재"가 아니다(권한·I/O). 차단하지 않고 표면화.
            for rel in [r for r in paths["unchecked"] if r not in deleted_paths]:
                print(f"· [{spec_id}] Files 경로 실재를 확인하지 못했다 {rel} — 통과가 아니다(부재로 단정하지 않는다)")
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


USAGE = "usage: python sdd_gates.py <fr|ownership|cohesion|completeness|consistency|adequacy|orphan|converge|specsync|derivation|smokescan|retag|run|testrun|schemadrift|ratchet|engineevent|evidence|livereality|synonym|sccoverage|verifyrun|introdoc|processssot|watchdog> [...]"


# ── 면제 래칫 (SPEC-027 확장) — Node판 policy-ratchet-lib.mjs 미러 ─────────────
# 면제는 "지금 green을 만들기 위해" 추가되고 아무도 걷어내지 않는다. 강도·임계 래칫이 knob을
# 지키는 동안 **면제 목록이 게이트를 무력화하는 우회로**였다(실측 제보).
EXEMPTION_KINDS = ["boundary", "debt"]
_EXEMPTION_KNOB_RE = re.compile(r"(Exempt|Exception)")
RATCHET_EXCEPTION_KNOB = "policyRatchetExceptions"


def exemption_knobs(cfg, declared=None):
    if isinstance(declared, list) and declared:
        return sorted(declared)
    return sorted(k for k in (cfg or {}) if _EXEMPTION_KNOB_RE.search(k))


def exemption_entries(value):
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, dict):
        return list(value.keys())
    return []


def exemption_findings(cfg, registry, declared_knobs=None):
    findings = []
    reg = registry if isinstance(registry, dict) else {}
    for knob in exemption_knobs(cfg, declared_knobs):
        entries = exemption_entries((cfg or {}).get(knob))
        per = reg.get(knob) if isinstance(reg.get(knob), dict) else {}
        for entry in entries:
            rec = per.get(entry)
            if not isinstance(rec, dict):
                findings.append({"kind": "unregistered", "knob": knob, "entry": entry})
                continue
            k = str(rec.get("kind") or "")
            if k not in EXEMPTION_KINDS:
                findings.append({"kind": "bad-kind", "knob": knob, "entry": entry, "got": k})
                continue
            need = ["reason", "clearBy", "due", "acceptor"] if k == "debt" else ["reason", "whyPermanent"]
            for f in need:
                if not str(rec.get(f) or "").strip():
                    findings.append({"kind": "missing-field", "knob": knob, "entry": entry, "field": f, "exKind": k})
        for entry in per.keys():
            if entry not in entries:
                findings.append({"kind": "stale-record", "knob": knob, "entry": entry})
    return findings


def classify_exemption_ratchet(base_cfg, cur_cfg, declared_knobs=None, exceptions=None):
    ex = set(exceptions or [])
    grown, allowed_growth = [], []
    knobs = set(exemption_knobs(base_cfg or {}, declared_knobs)) | set(exemption_knobs(cur_cfg or {}, declared_knobs))
    for knob in sorted(knobs):
        # 예외 선언 자체는 개수 래칫에서 뺀다 — 교착의 해소는 캡을 푸는 것이 아니라 출구를 만드는
        # 것이다. 대신 그 항목도 debt 4필드를 요구받고 매 실행 부채로 표면화된다.
        if knob == RATCHET_EXCEPTION_KNOB:
            continue
        if not base_cfg or knob not in base_cfg:
            continue
        frm = len(exemption_entries(base_cfg[knob]))
        to = len(exemption_entries((cur_cfg or {}).get(knob)))
        if to > frm:
            rec = {"knob": knob, "from": frm, "to": to}
            (allowed_growth if knob in ex else grown).append(rec)
    return {"grown": grown, "allowedGrowth": allowed_growth}


EXEMPTION_FINDING_TEXT = {
    "unregistered": "면제가 **사유·분류 없이** 존재한다 — `exemptionRegistry`에 등록하라(넷이 없는 면제는 이월이 아니라 방치다)",
    "bad-kind": "면제 종류가 boundary|debt 중 하나가 아니다 — boundary(구조적·영구) / debt(임시 부채)로 분류하라",
    "missing-field": "면제 레코드에 필수 필드가 없다",
    "stale-record": "등록부에만 남은 레코드 — 면제는 걷어냈는데 기록이 남았다(등록부 부패의 시작)",
}


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
    ex_knobs = exemption_knobs(cfg, cfg.get("exemptionKnobs"))
    ex_total = sum(len(exemption_entries(cfg.get(k))) for k in ex_knobs)
    ex_findings = exemption_findings(cfg, cfg.get("exemptionRegistry"), cfg.get("exemptionKnobs"))
    ex_ratchet = classify_exemption_ratchet(base_cfg, cfg, cfg.get("exemptionKnobs"), cfg.get("policyRatchetExceptions") or [])
    grown, allowed_growth = ex_ratchet["grown"], ex_ratchet["allowedGrowth"]
    ex_blocking = [f for f in ex_findings if f["kind"] != "stale-record"]

    print(f"면제 래칫: knob {len(ex_knobs)}종 · 면제 {ex_total}건 — 미등록·형식 위반 {len(ex_blocking)} · 증가 {len(grown)}")
    for g in allowed_growth:
        print(f'  · [부채] {g["knob"]}: 면제 {g["from"]} → {g["to"]} (policyRatchetExceptions로 허용된 증가 — 걷어낼 대상)')
    for g in grown:
        print(f'  · {g["knob"]}: 면제가 {g["from"]} → {g["to"]}건으로 **늘었다** — 래칫은 줄어드는 방향만 허용한다.'
              " 정당한 신규 면제가 필요하면 다른 면제를 걷어내거나 policyRatchetExceptions에 그 knob을 선언하라(부채로 표면화된다)")
    for f in ex_findings[:20]:
        tail = f' — `{f["field"]}` 없음({f["exKind"]})' if f["kind"] == "missing-field" else ""
        mark = "·" if f["kind"] == "stale-record" else " "
        print(f'  {mark} {f["knob"]}[{f["entry"]}]: {EXEMPTION_FINDING_TEXT[f["kind"]]}{tail}')
    if len(ex_findings) > 20:
        print(f"   … 외 {len(ex_findings) - 20}건")

    total_violations = len(violations) + len(ex_blocking) + len(grown)
    judged(total_violations)
    if total_violations:
        parts = []
        if violations:
            parts.append("강제 강도를 낮췄다(정책 하향 ∨ 수치 임계 완화)")
        if ex_blocking:
            parts.append("면제가 사유·분류 없이 존재한다(넷이 없는 면제는 이월이 아니라 방치다)")
        if grown:
            parts.append("면제 개수가 늘었다(래칫은 줄어드는 방향만 허용)")
        msg = ("정책 래칫 위반 — " + " / ".join(parts)
               + ". 위반을 knob 조정이나 면제 추가로 회피하지 말고 스펙을 편집해 해소하라(advisory는 경유지·hard가 종착지).")
        if hard:
            print(f"\n✗ {msg}", file=sys.stderr)
            sys.exit(1)
        print(f"\n⚠ {msg} (policyRatchetPolicy:advisory — 경고)")
        sys.exit(0)
    print(f"정책 래칫 게이트: OK — 강도 하향·임계 완화 없음, 면제 {ex_total}건 전부 분류·사유 등록됨.")
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

    allf = evidence_findings(units, asset_exists, verbs, bmark, bpat, manifest_of,
                             cfg.get("deployMarkers"), cfg.get("deployEvidencePatterns"),
                             cfg.get("browserGradeMethods"), cfg.get("deployGradeMethods"))
    # 3분류 계약(SPEC-054) — **확인 못 함은 차단하지 않고 초록에도 합산하지 않는다.**
    findings = [f for f in allf if f[3] != "asset-unchecked"]
    unchecked = [f for f in allf if f[3] == "asset-unchecked"]
    claim_count = sum(len(u["claims"]) for u in units)
    judged(len(findings))
    unchecked_tail = f" · 확인 못 함 {len(unchecked)}건(통과 아님)" if unchecked else ""
    print(f"실행 증거 게이트(executionEvidencePolicy={policy}): spec {len(units)}개·주장 {claim_count}건 검사 — 위반 {len(findings)}건{unchecked_tail}")
    tag = "✗" if hard else "⚠"
    for spec_id, claim_id, _kind, finding, detail in findings:
        print(f"  {tag} [{spec_id}] {claim_id} ({finding}) — {detail}")
    for spec_id, claim_id, _kind, finding, detail in unchecked:
        print(f"  · [{spec_id}] {claim_id} ({finding}) — {detail}")
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

def cmd_verifyrun(cfg, record_args=None, branch_args=None):
    policy = str(cfg.get("verificationRunPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ verificationRunPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    ledger_rel = cfg.get("verificationRunLedger")
    ledger_abs = resolve(cfg, ledger_rel) if ledger_rel else None

    # 기록 모드 — 러너·CI 스테이지·에이전트가 자기 결과를 남긴다.
    # 분기 발화 기록(SPEC-049) — 차단 분기가 돌았다는 사실은 그 분기만 안다.
    if branch_args is not None:
        if len(branch_args) < 2:
            verdict("SKIPPED", "인자 부족 — 판정을 요청받지 못했다(usage)")
            print(f"usage: sdd_gates.py verifyrun --record-branch <키> <{'|'.join(BRANCH_OUTCOMES)}> [사유...]",
                  file=sys.stderr)
            sys.exit(2)
        branch, boutcome = branch_args[0], branch_args[1].upper()
        bdetail = " ".join(branch_args[2:]).strip()
        if boutcome not in BRANCH_OUTCOMES:
            verdict("JUDGED", "위반 1건")
            print(f'✗ 알 수 없는 분기 결과 "{branch_args[1]}" — {"|".join(BRANCH_OUTCOMES)} 중 하나(문법화, 정의되지 않은 값 금지)',
                  file=sys.stderr)
            sys.exit(1)
        if not ledger_rel:
            verdict("INERT", "verificationRunLedger 미선언 — 기록할 원장이 없다")
            print("✗ verificationRunLedger가 선언되지 않아 기록할 곳이 없다 — sdd.config.json에 경로를 선언하라.", file=sys.stderr)
            sys.exit(1)
        os.makedirs(os.path.dirname(ledger_abs), exist_ok=True)
        with open(ledger_abs, "a", encoding="utf8") as fh:
            fh.write(format_branch_line(branch, boutcome, bdetail, _utc_now_iso()) + "\n")
        judged(0)
        print(f"분기 발화 기록 — {branch}: {boutcome}{f' ({bdetail})' if bdetail else ''} → {ledger_rel}")
        sys.exit(0)

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

    # ── 실행 관측 회계(SPEC-049) — 차단 분기가 필드에서 발화한 적이 있는가.
    # 어떤 강도에서도 차단하지 않는다(원장은 세션 상태다) — 매 실행 부채로 표면화한다.
    raw_decl = cfg.get("blockingBranches")
    declared = raw_decl if isinstance(raw_decl, dict) else {}
    for e in validate_branch_declarations(declared):
        print(f"  ⚠ {e}")
    if not declared:
        print("실행 관측 회계(SPEC-049): **blockingBranches 미선언 — 판정하지 않는다**."
              ' 차단 분기(전이 금지·마감 금지 같은 거부 경로)를 `{ "<키>": "<무엇을 막는가>" }`로 선언하고'
              " 그 분기가 `--record-branch <키> FIRED|PASSED|SKIPPED [사유]`로 남기게 하면,"
              " **발화 0회인 차단 분기를 미검증으로 회계**한다(정적 검사로는 원리상 잡히지 않는 층이다).")
    else:
        br_entries, br_broken = parse_branch_ledger(text)
        rows = classify_branches(declared, br_entries)
        tally = {"observed": 0, "unobserved": 0, "never-fired": 0, "monotone": 0}
        for r in rows:
            tally[r["cls"]] += 1
        print(f"실행 관측 회계(SPEC-049): 차단 분기 {len(rows)}종 — 관측됨 {tally['observed']}"
              f" · 미관측 {tally['unobserved']} · **발화 0회 {tally['never-fired']}** · 단조 {tally['monotone']}")
        for r in rows:
            if r["cls"] == "observed":
                continue
            if r["cls"] == "unobserved":
                why = "기록이 0건이다 — 이 분기가 `--record-branch`를 부르도록 배선하라(배선 없이는 관측이 없다)"
            elif r["cls"] == "never-fired":
                why = ("기록은 있는데 **FIRED가 0회다** — 차단 경로가 한 번도 돌지 않았다. 제보의 결함이 정확히 이 모양이었다"
                       "(명세·구현·단위테스트가 정상인데 두 기록이 만날 저장소가 없어 비교가 단 한 번도 수행되지 않았다)")
            else:
                why = (f"기록 {r['records']}회가 **모두 같은 사유다** — 값이 한 번도 달라진 적이 없다면 배선이 죽었을 개연성이 높다"
                       '("대조 생략"이 몇 달간 그대로였던 자리다)')
            suffix = f" / 선언된 목적: {r['reason']}" if r["reason"] else ""
            print(f"  ⚠ [{r['key']}] {why}{suffix}")
        for b in undeclared_branches(declared, br_entries)[:cap]:
            print(f"  ⚠ 선언되지 않은 분기 키로 기록됨: {b} — 낡은 러너이거나 오타다(조용히 버리면 그 기록은 없는 것과 같다)")
        for b in br_broken[:cap]:
            print(f"  ⚠ 깨진 분기 기록: {b['raw'][:120]}")
        if not tally["unobserved"] and not tally["never-fired"] and not tally["monotone"]:
            print("  ✓ 선언된 차단 분기 전부가 발화 기록을 갖고 결과가 한 종류에 고정돼 있지 않다.")

    if blocking:
        print(f"\n✗ verificationRunPolicy=hard: 선언된 증거가 돌았다는 기록이 없다({len(silent)}건)"
              f"{f' · 깨진 기록 {len(malformed)}건' if malformed else ''} — **존재는 실행이 아니다**. "
              f"돌렸으면 기록하고, 못 돌렸으면 사유와 함께 남겨라(포기는 허용, 침묵은 금지).", file=sys.stderr)
        sys.exit(1)
    if not silent and not malformed:
        print(f"검증 실행 회계 게이트: OK — 침묵 0건(사유 있는 미실행 {len(debt)}건은 부채로 표면화 중)."
              if debt else "검증 실행 회계 게이트: OK — 선언된 증거가 모두 실행 기록을 갖는다.")


# ── 소개 문서 동기 (SPEC-045, intro-doc-lib.mjs + check-intro-doc.mjs 미러) ──
def rule_ids_of(text):
    """규칙표 행에서만 규칙 ID를 뽑는다 — 산문 언급은 규칙 선언이 아니다."""
    out = []
    for line in str(text or "").split("\n"):
        m = re.match(r"^\s*\|\s*\*{0,2}(R\d+)\b", line)
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def missing_rule_ids(rule_ids, doc_texts):
    texts = doc_texts or []
    out = []
    for rid in rule_ids or []:
        rex = re.compile(r"(^|[^A-Za-z0-9])" + rid + r"([^0-9]|$)")
        if not any(rex.search(str(t or "")) for t in texts):
            out.append(rid)
    return out


def cited_counts(text):
    return [{"key": m.group(1), "cited": int(m.group(2).replace(",", ""))}
            for m in re.finditer(r'data-sdd-count\s*=\s*"([a-z-]+)"\s*>\s*([0-9,]+)', str(text or ""))]


def count_mismatches(cites, actuals):
    out = []
    for c in cites or []:
        if c["key"] not in (actuals or {}):
            out.append({"key": c["key"], "cited": c["cited"], "actual": None})
        elif actuals[c["key"]] != c["cited"]:
            out.append({"key": c["key"], "cited": c["cited"], "actual": actuals[c["key"]]})
    return out


def companion_missing(changed, rule_source, intro_docs):
    if changed is None:
        return False
    if rule_source not in changed:
        return False
    return not any(d in changed for d in (intro_docs or []))


def _intro_actual_counts(cfg, root, rule_ids):
    out = {"rules": len(rule_ids)}
    sync = os.path.join(root, "tooling", "sdd-sync.mjs")
    if os.path.exists(sync):
        src = read_text(sync)
        i = src.find("const RULES = [")
        if i >= 0:
            blk = src[i:src.find("\n];", i)]
            out["gates"] = len(set(re.findall(r'"((?:check|gen)-[a-z-]+\.mjs)"', blk)))
    try:
        out["specs"] = len([f for f in os.listdir(resolve(cfg, cfg["specDir"])) if is_spec_md_name(f)])
    except OSError:
        pass
    return out


def cmd_introdoc(cfg):
    root = cfg["__root"]
    policy = str(cfg.get("introDocPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ introDocPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "introDocPolicy")
        print("소개 문서 게이트 — introDocPolicy:off (판정 안 함)")
        return
    docs = [d for d in (cfg.get("introDocs") or []) if d]
    rule_source = str(cfg.get("introDocRuleSource") or "HARNESS.md")
    if not docs:
        verdict("INERT", "introDocs 미선언 — 대조할 소개 문서가 없다")
        print("소개 문서 게이트 — **introDocs 미선언: 판정하지 않는다**."
              " 방법론을 설명하는 문서(HTML·MD)를 선언하면 ①규칙표의 규칙 ID가 그 문서에 다 있는지"
              " ②문서가 `data-sdd-count`로 올린 숫자가 실제와 맞는지 ③규칙표를 고친 커밋에 그 문서가 함께 있는지를 본다.")
        return
    missing_docs = [d for d in docs if not os.path.exists(os.path.join(root, d))]
    if missing_docs:
        judged(len(missing_docs))
        print(f"소개 문서 게이트(introDocPolicy={policy}): 문서 {len(docs)}건 선언")
        for d in missing_docs:
            print(f"  ✗ 선언된 소개 문서 없음: {d} — 경로 오타이거나 삭제됨(조용한 스킵 금지)", file=sys.stderr)
        sys.exit(1)
    src_path = os.path.join(root, rule_source)
    if not os.path.exists(src_path):
        verdict("INERT", f"규칙표 소스 없음 — {rule_source}")
        print(f"소개 문서 게이트 — 규칙표 소스 `{rule_source}`가 없어 대조할 축이 없다(introDocRuleSource로 지정).")
        return
    doc_texts = [read_text(os.path.join(root, d)) for d in docs]
    rule_ids = rule_ids_of(read_text(src_path))
    errors, warnings = [], []

    def block(msg):
        (errors if policy == "hard" else warnings).append(msg)

    for rid in missing_rule_ids(rule_ids, doc_texts):
        block(f"규칙 {rid}가 소개 문서 어디에도 없다 — 규칙표({rule_source})는 이 규칙을 선언하는데 설명 문서는 모른다."
              f" 새로 배우는 사람은 이 문서로 방법론을 만난다: {' 또는 '.join(docs)}에 {rid}를 설명하라")

    actuals = _intro_actual_counts(cfg, root, rule_ids)
    cited_total = 0
    for i, text in enumerate(doc_texts):
        cites = cited_counts(text)
        cited_total += len(cites)
        for m in count_mismatches(cites, actuals):
            if m["actual"] is None:
                block(f'{docs[i]}: 미지원 인용 키 "{m["key"]}" — 지원 키는 {"·".join(actuals.keys())}.'
                      ' 오타난 키는 검산되지 않는다(조용히 "확인됨"으로 읽히는 자리)')
            else:
                block(f'{docs[i]}: 인용 수치 "{m["key"]}"가 {m["cited"]}인데 실제는 {m["actual"]}'
                      " — 문서가 낡았다(숫자는 가장 먼저 낡고 가장 늦게 들킨다)")

    changed = None
    try:
        # core.quotepath=off — 인용된 8진수 경로는 소개 문서 목록과 매치하지 않아 **자기 갱신을
        # 놓친 것으로 오판**한다(도그푸딩: 이 게이트가 자기 문서를 고친 커밋을 차단했다).
        out = subprocess.run(["git", "-c", "core.quotepath=off", "diff", "--cached", "--name-only"], cwd=root,
                             capture_output=True, text=True, check=True).stdout
        staged = [x.strip() for x in out.split("\n") if x.strip()]
        if staged:
            changed = set(staged)
    except Exception:  # noqa: BLE001
        pass
    if companion_missing(changed, rule_source, docs):
        block(f"규칙표({rule_source})가 이 changeset에서 바뀌었는데 소개 문서는 그대로다"
              f" — 규칙이 바뀌면 그 규칙을 설명하는 문서도 같은 커밋에서 바뀌어야 한다({' 또는 '.join(docs)})")

    judged(len(errors))
    print(f"소개 문서 게이트(introDocPolicy={policy}): 문서 {len(docs)}건 · 규칙 {len(rule_ids)}종 대조 · 인용 수치 {cited_total}건 검산"
          + (" · 동반 갱신 판정함" if changed else " · 동반 갱신은 판정 안 함(스테이징 집합 없음)"))
    for w in warnings:
        print(f"  ⚠ {w}")
    if errors:
        print(f"\n✗ 소개 문서가 도구보다 늦었다 {len(errors)}건:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    if not warnings:
        print("  ✓ 규칙 ID 누락 0건 · 인용 수치 불일치 0건 — 설명이 도구를 따라잡고 있다.")


# ── 순차 프로세스 SSOT 코어 (SPEC-047, process-ssot-lib.mjs 미러) ──────────
DEFAULT_PROCESS_DOC_REGEX = r"\.(md|markdown|html|rst|adoc|txt)$"

DEFAULT_STATEFUL_STAGE_MARKERS = [
    "교차검증", "교차 검증", "대조", "비교", "합의", "일치", "집계", "취합",
    "cross-check", "crosscheck", "cross check", "reconcile", "compare", "agree", "aggregate",
]


def stage_of(entry):
    if isinstance(entry, str):
        return {"name": entry, "state": ""}
    e = entry or {}
    return {"name": str(e.get("name") or ""), "state": str(e.get("state") or "").strip()}


def stages_of(proc):
    return [s for s in (stage_of(x) for x in ((proc or {}).get("stages") or [])) if s["name"]]


def validate_processes(processes):
    errors = []
    for name, proc in (processes or {}).items():
        if not isinstance(proc, dict):
            errors.append(f'processes["{name}"] — 객체여야 한다({{ ssot, stages }})')
            continue
        if not str(proc.get("ssot") or "").strip():
            errors.append(f'processes["{name}"].ssot — 전 구간을 담는 문서 경로 필수(빈 값은 소유자 없음과 같다)')
        if len(stages_of(proc)) < 2:
            errors.append(f'processes["{name}"].stages — 2단계 이상 선언 필수(1단계는 사슬이 아니다)')
    return errors


def ssot_missing_stages(ssot_text, stages):
    s = str(ssot_text or "")
    return [st["name"] for st in (stages or []) if st["name"] not in s]


def fragment_findings(docs, stages, ssot_path, min_stages=2):
    names = [st["name"] for st in (stages or [])]
    out = []
    for d in docs or []:
        if not d or d["path"] == ssot_path:
            continue
        text = str(d.get("text") or "")
        held = [n for n in names if n in text]
        if len(held) < min_stages:
            continue
        if ssot_path in text:
            continue
        out.append({"path": d["path"], "stages": held})
    return out


def stateless_stage_findings(stages, markers=None):
    lst = markers if markers else DEFAULT_STATEFUL_STAGE_MARKERS
    return [st["name"] for st in (stages or [])
            if not st["state"] and any(str(m).lower() in st["name"].lower() for m in lst)]


def unowned_state_findings(stages, is_owned=None):
    own = is_owned if callable(is_owned) else (lambda p: True)
    return [{"stage": st["name"], "state": st["state"]}
            for st in (stages or []) if st["state"] and not own(st["state"])]


def cmd_processssot(cfg):
    root = cfg["__root"]
    policy = str(cfg.get("processSsotPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ processSsotPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "processSsotPolicy")
        print("순차 프로세스 게이트 — processSsotPolicy:off (판정 안 함)")
        return
    raw = cfg.get("processes")
    processes = raw if isinstance(raw, dict) else {}
    names = sorted(processes.keys())
    if not names:
        verdict("INERT", "processes 미선언 — 판정할 순차 사슬이 없다")
        print("순차 프로세스 게이트 — **processes 미선언: 판정하지 않는다**."
              " 여러 스펙에 걸친 순차 사슬(배포 close-out·승인 흐름 등)이 있으면 `processes`에"
              " `{ ssot: <전 구간 문서>, stages: [<단계>…] }`로 선언하라. 그러면 ①전 구간이 그 문서 하나에 있는지"
              " ②조각을 든 다른 문서가 그 문서를 참조하는지 ③비교·합의 단계가 기록이 만날 저장소를 선언하고"
              " 그 저장소가 소유되는지를 본다.")
        return
    cfg_errors = validate_processes(processes)
    if cfg_errors:
        judged(len(cfg_errors))
        print(f"순차 프로세스 게이트(processSsotPolicy={policy}): 프로세스 {len(names)}종 선언")
        for e in cfg_errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)

    spec_dir = resolve(cfg, cfg["specDir"])
    try:
        spec_names = sorted(f for f in os.listdir(spec_dir) if is_spec_md_name(f))
    except OSError:
        spec_names = []
    owned_globs, spec_texts = [], []
    for n in spec_names:
        text = read_text(os.path.join(spec_dir, n))
        spec_texts.append({"path": f"{cfg['specDir']}/{n}", "text": text})
        for g in parse_section(text, "Ownership", ["Files"])["Files"]:
            g2 = strip_inline_comment(g)
            if g2:
                owned_globs.append(compile_glob(g2))

    def is_owned(p):
        return any(rx.search(str(p)) for rx in owned_globs)

    prose = re.compile(str(cfg.get("processDocRegex") or DEFAULT_PROCESS_DOC_REGEX))
    docs = list(spec_texts)
    seen = {d["path"] for d in docs}
    for rel in walk_all_rel(root, cfg):
        if not prose.search(rel) or rel in seen:
            continue
        try:
            docs.append({"path": rel, "text": read_text(os.path.join(root, rel))})
        except OSError:
            continue

    errors, warnings = [], []

    def block(msg):
        (errors if policy == "hard" else warnings).append(msg)

    cap = int(cfg.get("processSsotListCap") or 12)
    min_stages = int(cfg.get("processFragmentMinStages") or 2)
    stage_total = state_total = 0
    for name in names:
        proc = processes[name]
        stages = stages_of(proc)
        ssot_path = str(proc["ssot"]).strip()
        stage_total += len(stages)
        state_total += len([s for s in stages if s["state"]])
        ssot_abs = os.path.join(root, ssot_path)
        if not os.path.exists(ssot_abs):
            block(f'프로세스 "{name}": SSOT 문서가 없다 — {ssot_path}. 선언했는데 없는 문서는 소유자가 없는 것과 같다')
            continue
        ssot_text = read_text(ssot_abs)
        miss = ssot_missing_stages(ssot_text, stages)
        if miss:
            block(f'프로세스 "{name}": SSOT({ssot_path})가 전 구간을 담지 않는다 — 빠진 단계 {len(miss)}건: {" · ".join(miss)}.'
                  " 어느 문서를 읽어도 사슬의 일부만 보이면 세션마다 flow를 재구성하고 매번 다른 곳이 빠진다")
        frags = fragment_findings(docs, stages, ssot_path, min_stages)
        for f in frags[:cap]:
            more = " …" if len(f["stages"]) > 3 else ""
            block(f'프로세스 "{name}": {f["path"]}가 단계 {len(f["stages"])}건({" · ".join(f["stages"][:3])}{more})을 담았는데'
                  f' SSOT({ssot_path})를 참조하지 않는다 — 조각을 든 문서는 전체를 가리켜야 한다(참조는 경로를 적으면 성립한다)')
        if len(frags) > cap:
            block(f'프로세스 "{name}": 조각 보유 문서 … 외 {len(frags) - cap}건 (processSsotListCap 상향으로 확인)')
        for st in stateless_stage_findings(stages, cfg.get("statefulStageMarkers")):
            block(f'프로세스 "{name}": 단계 "{st}"는 실행 사이의 비교·합의를 요구하는데 **기록이 만날 저장소를 선언하지 않았다**'
                  ' — 비교는 두 기록이 같은 자리에서 만나야 성립한다. 저장소가 없으면 그 비교는 "상대 기록 없음 → 통과"로 조용히 무행동이 된다'
                  "(실측: 로컬은 작업 디렉터리, 클러스터 Job은 볼륨 없는 파드의 /tmp였다). stages 항목을 { name, state: <경로> }로 선언하라")
        for u in unowned_state_findings(stages, is_owned):
            block(f'프로세스 "{name}": 단계 "{u["stage"]}"의 저장소 "{u["state"]}"를 **어느 스펙도 소유하지 않는다**'
                  " — 인프라 산출물인데 스펙 밖에 있으면 그쪽 리뷰에서도 빠진다(실측: 저장소 요구가 어느 FR에도 없고 코드 주석에만 있었다)."
                  " 어느 스펙의 Ownership Files에 편입하라")

    judged(len(errors))
    print(f"순차 프로세스 게이트(processSsotPolicy={policy}): 프로세스 {len(names)}종 · 단계 {stage_total}건"
          f" · 저장소 선언 {state_total}건 · 문서 {len(docs)}건 대조({prose.pattern})")
    for w in warnings:
        print(f"  ⚠ {w}")
    if errors:
        print(f"\n✗ 순차 사슬이 흩어져 있다 {len(errors)}건:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    if not warnings:
        print("  ✓ 전 구간이 SSOT에 있고 조각 보유 문서가 그것을 가리키며, 비교 단계의 저장소는 선언·소유됐다.")


# ── 감시자 실재 코어 (SPEC-048, watchdog-lib.mjs 미러) ─────────────────────
DEFAULT_SWEEP_INVOCATION_MARKERS = ["sdd-sync", "sdd_gates.py", "sdd-run", "sdd-gates"]
DEFAULT_WATCHDOG_RECEIPT = "sdd/adoption.json"
DEFAULT_WATCHDOG_CI_GLOBS = [".github/workflows/**", ".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml", ".circleci/**"]


def parse_receipt(raw):
    errors = []
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except Exception:  # noqa: BLE001
            # 파서 예외 문구는 런타임마다 다르다 — 판정 문장에 넣으면 바이트 동일이 깨진다.
            return None, ["채택 영수증이 JSON으로 파싱되지 않는다 — 형식이 깨졌거나 빈 파일이다"]
    if not isinstance(data, dict):
        return None, ["채택 영수증은 객체여야 한다({ kitCommit, installedAt, gate, gates, hooks })"]

    def arr(v):
        return [str(x) for x in v if str(x)] if isinstance(v, list) else []

    receipt = {
        "kitCommit": str(data.get("kitCommit") or "").strip(),
        "installedAt": str(data.get("installedAt") or "").strip(),
        "gate": str(data.get("gate") or "").strip(),
        "gates": arr(data.get("gates")),
        "hooks": arr(data.get("hooks")),
    }
    if not receipt["installedAt"]:
        errors.append("채택 영수증에 installedAt이 없다 — 언제 채택했는지가 갱신 판단의 유일한 근거다")
    if not receipt["gates"]:
        errors.append("채택 영수증에 gates가 없다 — 무엇이 깔렸는지 모르면 사라진 것도 모른다")
    return receipt, errors


def missing_gates(receipt, exists=None):
    """반환 {"gone": [...], "unchecked": [...]} — 실재를 확인 못 한 게이트는 "지워졌다"가 아니다(SPEC-054)."""
    has = exists if callable(exists) else (lambda g: True)
    gone, unchecked = [], []
    for g in ((receipt or {}).get("gates") or []):
        st = tri(has(g))
        if st == TRI_NO:
            gone.append(g)
        elif st == TRI_UNKNOWN:
            unchecked.append(g)
    return {"gone": gone, "unchecked": unchecked}


# **마커가 라벨·데이터 경로에 걸리는 것을 호출로 읽지 않는다**(watchdog-lib.mjs 미러).
# 킷 실측: 워크플로 파일명이 `sdd-gates.yml`이고 `name: sdd-gates`가 있어서 마커가 자기 이름에
# 매치했고, `--record ".github/workflows/sdd-gates.yml"` 인자 경로에도 매치했다. CI는 스윕을 한 번도
# 부르지 않았는데 이 게이트는 여러 달 "배선돼 있다"를 보고했다 — 감시자가 자기 파일명에 속았다.
_INVOCATION_LEAD = r"(?:/|\./|node\s+|python3?\s+|sh\s+|bash\s+|make\s+|npx\s+|(?:npm|pnpm|yarn)\s+run\s+)"
_INVOCATION_TAIL = r"(?:\.(?:mjs|cjs|js|py|sh|bash))?(?![\w.-])"
_LABEL_LINE = re.compile(r"^\s*(?:name|id|title|description|displayName|stage|job)\s*:")
_COMMENT_LINE = re.compile(r"^\s*(?:#|//)")
_STRICT_FLAG = re.compile(r"--strict\b")


def _invocation_re(marker):
    return re.compile(_INVOCATION_LEAD + re.escape(str(marker)) + _INVOCATION_TAIL)


def sweep_invocation(text, markers=None):
    """반환 {"invoked":bool, "labelOnly":bool} — 아예 없는 것과 라벨에만 있는 것은 다른 사실이다."""
    lst = markers if markers else DEFAULT_SWEEP_INVOCATION_MARKERS
    label_only = False
    for raw in str(text or "").split("\n"):
        for m in lst:
            marker = str(m)
            if marker not in raw:
                continue
            if _COMMENT_LINE.search(raw):
                continue
            if _invocation_re(marker).search(raw):
                return {"invoked": True, "labelOnly": False}
            if _LABEL_LINE.search(raw):
                label_only = True
    return {"invoked": False, "labelOnly": label_only}


def sweep_blocking(text, markers=None):
    """`--strict` 없는 스윕은 advisory에서 exit 0이다 — 통과만 하는 채널은 채널이 아니라 로그다."""
    lst = markers if markers else DEFAULT_SWEEP_INVOCATION_MARKERS
    for raw in str(text or "").split("\n"):
        if _COMMENT_LINE.search(raw):
            continue
        if not any(_invocation_re(m).search(raw) for m in lst):
            continue
        if _STRICT_FLAG.search(raw):
            return True
    return False


DEFAULT_SWEEP_SOURCE_CANDIDATES = ["tooling/sdd-sync.mjs", "scripts/sdd-sync.mjs", "sdd-sync.mjs"]
_SWEEP_GATE_ENTRY = re.compile(r"\"((?:check|gen)-[a-z-]+\.mjs)\"")


def sweep_gate_files(sync_source):
    """스윕 규칙표에 등재된 게이트 집합. 못 찾으면 None — **0종이 아니다.**"""
    src = str(sync_source or "")
    i = src.find("const RULES = [")
    if i < 0:
        return None
    end = src.find("\n];", i)
    blk = src[i:] if end < 0 else src[i:end]
    out = []
    for m in _SWEEP_GATE_ENTRY.finditer(blk):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


def gates_outside_ci(sweep_gates, ci_texts, markers=None):
    """CI가 스윕을 부르지 않고 손으로 열거하면, 빠진 게이트는 어떤 우회 불가 층에도 없다."""
    texts = [str(t or "") for t in (ci_texts or [])]
    if any(sweep_invocation(t, markers)["invoked"] for t in texts):
        return []
    joined = "\n".join(texts)
    return [str(g) for g in (sweep_gates or []) if g and str(g) not in joined]


def ci_wiring(ci_files, markers=None):
    wired, label_only = [], []
    blocking = False
    for f in (ci_files or []):
        text = str(f.get("text") or "")
        hit = sweep_invocation(text, markers)
        if hit["invoked"]:
            wired.append(f["path"])
            if sweep_blocking(text, markers):
                blocking = True
        elif hit["labelOnly"]:
            label_only.append(f["path"])
    return {"wired": wired, "labelOnly": label_only, "blocking": blocking, "files": len(ci_files or [])}


# ── 배선 무결성 (SPEC-050, R18) — Node판 import-wiring-lib.mjs 미러 ──────────
# 실측 제보: update 절차의 diff가 공유 lib을 빠뜨려 게이트는 최신·lib은 구판인 **부분 동기화**가
# 됐고, 소비처는 판정이 아니라 `SyntaxError: … does not provide an export named …`를 받았다.
# 파일이 없는 것도 아니어서 배포 폐포 계약(SPEC-004)으로도 안 잡힌다 — 그건 파일 실재, 이건
# export 실재다. 판정 게이트이므로 양판 필수(SPEC-006).
DEFAULT_WIRING_EXTENSIONS = ["mjs", "js"]
_LOCAL_SPEC = re.compile(r"^\.\.?/")
# 문장 경계 — `^`로 앵커하면 `const x = 1; export { x };`를 놓치고, 놓친 export는 "없다"로
# 읽혀 오탐(있는 export를 없다고 차단)이 된다.
_AT = r"(?:^|[;}]\s*)"
# 별칭 구분자·네임스페이스 절 — import·export 양쪽에서 쓰이므로 한 곳에 둔다(Node판과 같은 구조).
_ALIAS_SPLIT = r"\s+as\s+"
_NAMESPACE_CLAUSE = r"\*\s+as\s+[\w$]+"


def local_imports(text):
    out = []
    src = strip_full_line_comments(text)
    for m in re.finditer(r"\bimport\s+([\s\S]*?)\s+from\s*[\"']([^\"']+)[\"']", src):
        spec = m.group(2)
        if not _LOCAL_SPEC.match(spec):
            continue
        clause = m.group(1)
        names = []
        brace = re.search(r"\{([\s\S]*?)\}", clause)
        if brace:
            for raw in brace.group(1).split(","):
                t = raw.strip()
                if t:
                    names.append(re.split(_ALIAS_SPLIT, t)[0].strip())
        namespace = bool(re.search(_NAMESPACE_CLAUSE, clause))
        lead = re.sub(_NAMESPACE_CLAUSE, "", re.sub(r"\{[\s\S]*?\}", "", clause, count=1)).replace(",", "").strip()
        out.append({"specifier": spec, "names": names, "namespace": namespace, "hasDefault": bool(lead)})
    for m in re.finditer(r"\bimport\s*[\"']([^\"']+)[\"']", src):
        if _LOCAL_SPEC.match(m.group(1)):
            out.append({"specifier": m.group(1), "names": [], "namespace": False, "hasDefault": False})
    return out


def module_exports(text):
    src = strip_full_line_comments(text)
    names, star_from, unmodeled = set(), [], []
    for m in re.finditer(_AT + r"export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)", src, re.M):
        names.add(m.group(1))
    for m in re.finditer(_AT + r"export\s+class\s+([\w$]+)", src, re.M):
        names.add(m.group(1))
    for m in re.finditer(_AT + r"export\s+(?:const|let|var)\s+([\w$]+)", src, re.M):
        names.add(m.group(1))
    for m in re.finditer(_AT + r"export\s*\{([\s\S]*?)\}", src, re.M):
        for raw in m.group(1).split(","):
            t = raw.strip()
            if not t:
                continue
            parts = re.split(_ALIAS_SPLIT, t)
            names.add((parts[1] if len(parts) > 1 else parts[0]).strip())
    for m in re.finditer(_AT + r"export\s+\*\s*(?:as\s+([\w$]+)\s*)?from\s*[\"']([^\"']+)[\"']", src, re.M):
        if m.group(1):
            names.add(m.group(1))
        elif _LOCAL_SPEC.match(m.group(2)):
            star_from.append(m.group(2))
        else:
            unmodeled.append('export * from "%s"' % m.group(2))
    if re.search(_AT + r"export\s+default\b", src, re.M):
        names.add("default")
    for m in re.finditer(_AT + r"export\s+(?:const|let|var)\s*[\[{]", src, re.M):
        unmodeled.append(m.group(0).strip())
    return {"names": names, "starFrom": star_from, "unmodeled": unmodeled}


def wiring_findings(entries, read, resolve):
    violations, unchecked = [], []
    visited, exports_of = set(), {}

    def resolve_exports(key, seen=None):
        if key in exports_of:
            return exports_of[key]
        seen = seen or set()
        if key in seen:
            return {"names": set(), "unresolved": []}
        seen.add(key)
        src = read(key)
        if src is None:
            return None
        ex = module_exports(src)
        names = set(ex["names"])
        unresolved = list(ex["unmodeled"])
        for spec in ex["starFrom"]:
            child = resolve_exports(resolve(key, spec), seen)
            if child is None:
                unresolved.append('export * from "%s" — 대상 파일 없음' % spec)
                continue
            names |= child["names"]
            unresolved.extend(child["unresolved"])
        val = {"names": names, "unresolved": unresolved}
        exports_of[key] = val
        return val

    stack = list(entries or [])
    while stack:
        key = stack.pop()
        if key in visited:
            continue
        visited.add(key)
        src = read(key)
        if src is None:
            continue
        for imp in local_imports(src):
            target = resolve(key, imp["specifier"])
            tex = resolve_exports(target)
            if tex is None:
                violations.append({"kind": "missing-file", "from": key, "specifier": imp["specifier"], "name": ""})
                continue
            stack.append(target)
            if tex["unresolved"]:
                for why in tex["unresolved"]:
                    unchecked.append({"key": target, "why": why})
                continue
            wanted = list(imp["names"]) + (["default"] if imp["hasDefault"] else [])
            for n in wanted:
                if n not in tex["names"]:
                    violations.append({"kind": "missing-export", "from": key, "specifier": imp["specifier"], "name": n})
    seen_v, dedup_v = set(), []
    for v in violations:
        k = "%s %s %s %s" % (v["kind"], v["from"], v["specifier"], v["name"])
        if k not in seen_v:
            seen_v.add(k)
            dedup_v.append(v)
    seen_u, dedup_u = set(), []
    for u in unchecked:
        k = "%s %s" % (u["key"], u["why"])
        if k not in seen_u:
            seen_u.add(k)
            dedup_u.append(u)
    order = {"missing-file": 0, "missing-export": 1}
    dedup_v.sort(key=lambda v: (order[v["kind"]], v["from"], v["specifier"], v["name"]))
    dedup_u.sort(key=lambda u: (u["key"], u["why"]))
    return {"violations": dedup_v, "unchecked": dedup_u, "walked": len(visited)}


def format_wiring_violation(v):
    if v["kind"] == "missing-file":
        return ("%s → `%s` 파일이 없다 — 복사 목록 누락(소비처는 게이트 대신 ERR_MODULE_NOT_FOUND를 받는다)"
                % (v["from"], v["specifier"]))
    return ("%s → `%s`에 export `%s`가 없다 — **부분 동기화**(게이트는 최신, lib은 구판). 정본에서 `%s`를 다시 복사하라"
            % (v["from"], v["specifier"], v["name"], re.sub(r"^\./", "", v["specifier"])))


# ── 에이전트 배선 실재 (SPEC-051, R19) — Node판 agent-wiring-lib.mjs 미러 ─────
# 오너 실측: "감시게이트/감시에이전트가 SDD로 수행하는지 혼자 날뛰지 않는지 보게 해야 하는데
# 그게 동작을 하지 않아." R17은 CI·영수증(커밋 이후 채널)을 보고, 이 축은 에이전트가 도구를 쓰는
# **순간** 발동하는 훅의 배선을 본다. 킷 자신에 `.claude/`가 없었는데도 R17은 초록이었다.
NO_MATCHER = "-"
DEFAULT_AGENT_SETTINGS_FILE = ".claude/settings.json"
DEFAULT_AGENT_HOOK_DECL = "scripts/agent-hooks.list"
DEFAULT_AGENT_SCRIPT_DIR = "scripts"


def parse_agent_hook_decl(text):
    out = []
    for raw in str(text or "").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 3:
            continue
        ev, mt, sc = parts[0], parts[1], parts[2]
        out.append({"event": ev, "matcher": "" if mt == NO_MATCHER else mt, "script": sc})
    return out


def wired_hooks(settings):
    out = []
    hooks = settings.get("hooks") if isinstance(settings, dict) else None
    if not isinstance(hooks, dict):
        return out
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            continue
        for g in groups:
            if not isinstance(g, dict):
                continue
            matcher = str(g.get("matcher") or "")
            hl = g.get("hooks")
            for h in hl if isinstance(hl, list) else []:
                if not isinstance(h, dict):
                    continue
                out.append({"event": event, "matcher": matcher, "command": str(h.get("command") or "")})
    return out


def missing_matcher_tokens(declared, wired):
    want = [t.strip() for t in str(declared or "").split("|") if t.strip()]
    if not want:
        return []
    have = set(t.strip() for t in str(wired or "").split("|") if t.strip())
    return [t for t in want if t not in have]


def command_names_script(command, script):
    if not command or not script:
        return False
    return re.search(r'(^|[\s/"\'])' + re.escape(script) + r'([\s"\']|$)', str(command)) is not None


def agent_wiring_findings(decls, settings, script_exists):
    missing, narrowed, script_missing, unchecked = [], [], [], []
    settings_missing = not settings
    wired = wired_hooks(settings) if settings else []
    for d in decls or []:
        hits = [w for w in wired if w["event"] == d["event"] and command_names_script(w["command"], d["script"])]
        if not hits:
            missing.append(d)
            continue
        gaps = [missing_matcher_tokens(d["matcher"], h["matcher"]) for h in hits]
        best = gaps[0]
        for g in gaps:
            if len(g) < len(best):
                best = g
        if best:
            nd = dict(d)
            nd["missingTools"] = best
            narrowed.append(nd)
        # 3분류 계약(SPEC-054) — 스크립트 실재를 확인 못 한 것을 부재로 보고하면 거짓 위반이다.
        st = tri(script_exists(d["script"]) if callable(script_exists) else None)
        if st == TRI_NO:
            script_missing.append(d)
        elif st == TRI_UNKNOWN:
            unchecked.append({"script": d["script"], "why": "스크립트 실재를 확인하지 못했다"})
    return {"settingsMissing": settings_missing, "missing": missing,
            "narrowed": narrowed, "scriptMissing": script_missing, "unchecked": unchecked}


def build_hook_settings(decls, command_for):
    order, groups = [], {}
    for d in decls or []:
        key = (d["event"], d["matcher"])
        if key not in groups:
            order.append(key)
            groups[key] = []
        groups[key].append({"type": "command", "command": command_for(d["script"])})
    hooks, ev_order = {}, []
    for key in order:
        ev, mt = key
        if ev not in hooks:
            hooks[ev] = []
            ev_order.append(ev)
        entry = {"hooks": groups[key]}
        if mt:
            entry["matcher"] = mt
        hooks[ev].append(entry)
    return {"hooks": hooks}


def merge_hook_settings(existing, decls, command_for):
    base = existing if isinstance(existing, dict) else {}
    fresh = build_hook_settings(decls, command_for)
    def is_ours(command):
        return any(command_names_script(command, d["script"]) for d in decls or [])
    merged = dict(base)
    merged["hooks"] = dict(base.get("hooks") if isinstance(base.get("hooks"), dict) else {})
    for event, groups in fresh["hooks"].items():
        prev = merged["hooks"].get(event)
        prev = prev if isinstance(prev, list) else []
        kept = []
        for g in prev:
            hl = g.get("hooks") if isinstance(g, dict) else None
            cmds = [str(h.get("command") or "") for h in (hl if isinstance(hl, list) else []) if isinstance(h, dict)]
            if not cmds or not all(is_ours(c) for c in cmds):
                kept.append(g)
        merged["hooks"][event] = kept + groups
    return merged


# ── 명세 자기모순 감사 (SPEC-052, R20) — Node판 spec-conflict-lib.mjs 미러 ─────
# 오너 지시: "명세가 충돌되는 것도 없도록 — spec 1은 A를 해라, spec 2는 A를 하지 말아라.
# 애초에 이런 구멍도 없어야 한다." 같은 대상에 SHALL과 SHALL NOT이 공존하면 급할 때 에이전트는
# 자기가 먼저 본 쪽을 따른다(실측: 오너가 여러 세션에 걸쳐 금지한 경로가 재발했다).
DEFAULT_NEGATION_MARKERS = ["NOT", "NEVER"]
DEFAULT_CLAUSE_BREAKS = [";", "WHERE", "WHEN", "WHILE", "IF", "THEN", " so that "]
DEFAULT_CONFLICT_STOPWORDS = [
    "a", "an", "the", "its", "their", "that", "this", "those", "these", "of", "to", "for", "in", "on", "at", "by",
    "with", "and", "or", "not", "be", "is", "are", "as", "so", "it", "they", "them", "from", "into", "than",
    "then", "when", "if", "while", "where", "only", "rather",
]
DEFAULT_CONFLICT_MIN_TOKENS = 2
DEFAULT_CONFLICT_MAX_DOC_FREQ = 3


def line_directives(line, negation_markers=None, clause_breaks=None):
    negs = "|".join(re.escape(m) for m in (negation_markers or DEFAULT_NEGATION_MARKERS))
    src = str(line or "")
    marks = [(m.start(), len(m.group(0)), bool(m.group(1)))
             for m in re.finditer(r"\bSHALL(\s+(?:%s))?\b" % negs, src)]
    breaks = clause_breaks or DEFAULT_CLAUSE_BREAKS
    brk = "|".join((r"\b%s\b" % re.escape(b)) if re.fullmatch(r"[A-Z]+", b) else re.escape(b) for b in breaks)
    out = []
    for i, (at, ln, neg) in enumerate(marks):
        frm = at + ln
        to = marks[i + 1][0] if i + 1 < len(marks) else len(src)
        out.append({"neg": neg, "predicate": re.split(brk, src[frm:to])[0]})
    return out


def predicate_tokens(predicate, stopwords=None):
    stop = set(str(w).lower() for w in (stopwords or DEFAULT_CONFLICT_STOPWORDS))
    t = str(predicate or "").lower().replace("`", "").replace("**", "")
    t = re.sub(r"[^\w\s-]", " ", t, flags=re.UNICODE)
    out = set()
    for w in t.split():
        w = re.sub(r"'s$", "", w)
        w = re.sub(r"s$", "", w)
        if w and w not in stop:
            out.add(w)
    return out


def collect_directives(specs, is_decl_line, opts=None):
    opts = opts or {}
    min_tokens = opts.get("minTokens") or DEFAULT_CONFLICT_MIN_TOKENS
    out = []
    for sp in specs or []:
        for line in str(sp.get("text") or "").split("\n"):
            if not is_decl_line(line):
                continue
            for d in line_directives(line, opts.get("negationMarkers"), opts.get("clauseBreaks")):
                toks = predicate_tokens(d["predicate"], opts.get("stopwords"))
                if len(toks) < min_tokens:
                    continue
                out.append({"specId": sp["id"], "file": sp.get("file"), "neg": d["neg"],
                            "predicate": d["predicate"].strip(), "tokens": toks})
    return out


def doc_frequency(directives):
    df = {}
    for d in directives or []:
        for t in d["tokens"]:
            df.setdefault(t, set()).add(d["specId"])
    return df


def spec_conflicts(directives, opts=None):
    opts = opts or {}
    max_df = opts.get("maxDocFreq") or DEFAULT_CONFLICT_MAX_DOC_FREQ
    df = doc_frequency(directives)
    lst = directives or []
    conflicts, same_spec = [], []
    for i in range(len(lst)):
        for j in range(i + 1, len(lst)):
            a, b = lst[i], lst[j]
            if a["neg"] == b["neg"]:
                continue
            if not (a["tokens"] <= b["tokens"] or b["tokens"] <= a["tokens"]):
                continue
            shared = a["tokens"] if len(a["tokens"]) <= len(b["tokens"]) else b["tokens"]
            if not any(len(df.get(t, set())) <= max_df for t in shared):
                continue
            pair = {"positive": b if a["neg"] else a, "negative": a if a["neg"] else b,
                    "shared": sorted(shared)}
            (same_spec if a["specId"] == b["specId"] else conflicts).append(pair)
    return {"conflicts": conflicts, "sameSpec": same_spec, "directives": len(lst)}


def format_conflict(pair):
    p, n = pair["positive"], pair["negative"]
    return [
        f'{p["specId"]} {"SHALL NOT" if p["neg"] else "SHALL"} {p["predicate"]}',
        f'{n["specId"]} {"SHALL NOT" if n["neg"] else "SHALL"} {n["predicate"]}',
        f'공유 대상: {" · ".join(pair["shared"])} — 어느 쪽이 정본인지 결정해 한쪽을 고쳐라(게이트는 정하지 않는다)',
    ]


# ── 진단 진입점 명세 강제 열람 (SPEC-053, R21) — Node판 diagnosis-guard-lib.mjs 미러 ──
# 실측: 에이전트가 명세에 답이 있는데 읽지 않고 실측으로 다시 찾았고 결론까지 틀렸다.
# "읽었는가"는 정적으로 판정되지 않고 **조회는 커밋도 파일 변경도 남기지 않는다** —
# 커밋 게이트로는 원리상 볼 수 없는 층이라 도구 호출 직전에 발동한다.
GUARD_MODES = ["surface", "deny"]
DEFAULT_SPEC_READ_PATTERNS = [
    r"\b(grep|rg|cat|head|tail|less|sed|awk|find|ls)\b[^|;]*\bsdd/specs?\b",
    r"\b(grep|rg|cat|head|tail|less|sed|awk)\b[^|;]*\b(SPEC|INFRA|TEST|CICD)-\d",
]
DEFAULT_GUIDE_SECTIONS = ["Edge Cases", "Change Log", "Assumptions"]

GUARD_FINDING_TEXT = {
    "no-match": "명령 패턴이 없다 — 무엇에 발화할지 모르는 선언은 아무것도 막지 않는다",
    "bad-regex": "명령 패턴이 정규식으로 컴파일되지 않는다 — 이 규칙은 **조용히 무발화**다",
    "no-spec": "답이 있는 스펙을 지목하지 않았다 — 읽으라고 할 대상이 없다",
    "missing-spec": "지목한 스펙이 실재하지 않는다 — 읽으라는 곳이 없으면 안내가 거짓이 된다",
    "bad-mode": "강도가 surface|deny 중 하나가 아니다",
    "no-why": "사유가 없다 — 왜 이 조회가 아닌지 모르면 사람은 규칙을 우회한다",
    "spec-unchecked": "지목한 스펙의 실재를 **확인하지 못했다** — 통과가 아니다(검사 못 함과 통과는 다른 사실이다)",
    "deny-without-instead": "금지인데 **대신 볼 곳**이 없다 — 막기만 하면 사람은 아무도 모르는 우회로를 찾는다",
}


def parse_diagnosis_map(value):
    out = []
    for raw in (value if isinstance(value, list) else []):
        if not isinstance(raw, dict):
            continue
        inst = raw.get("instead")
        out.append({
            "match": str(raw.get("match") or ""),
            "spec": str(raw.get("spec") or ""),
            "mode": str(raw.get("mode") or "surface"),
            "why": str(raw.get("why") or ""),
            "instead": [str(x) for x in inst] if isinstance(inst, list) else [],
        })
    return out


def validate_diagnosis_map(entries, spec_exists):
    findings = []
    for i, e in enumerate(entries or []):
        at = e["match"] or f"#{i + 1}"
        if not e["match"]:
            findings.append({"kind": "no-match", "at": at})
            continue
        try:
            re.compile(e["match"])
        except re.error:
            findings.append({"kind": "bad-regex", "at": at})
            continue
        if not e["spec"]:
            findings.append({"kind": "no-spec", "at": at})
        elif callable(spec_exists):
            # 3분류 계약(SPEC-054) — 스펙 실재를 확인 못 한 것을 "없다"로 말하면 거짓 위반이다.
            st = tri(spec_exists(e["spec"]))
            if st == TRI_NO:
                findings.append({"kind": "missing-spec", "at": at, "spec": e["spec"]})
            elif st == TRI_UNKNOWN:
                findings.append({"kind": "spec-unchecked", "at": at, "spec": e["spec"]})
        if e["mode"] not in GUARD_MODES:
            findings.append({"kind": "bad-mode", "at": at, "got": e["mode"]})
        if not e["why"].strip():
            findings.append({"kind": "no-why", "at": at})
        if e["mode"] == "deny" and not e["instead"]:
            findings.append({"kind": "deny-without-instead", "at": at})
    return findings


def is_spec_read(command, patterns=None):
    for p in (patterns or DEFAULT_SPEC_READ_PATTERNS):
        try:
            if re.search(p, str(command or ""), re.I):
                return True
        except re.error:
            continue
    return False


def judge_command(command, entries, spec_read_patterns=None):
    cmd = str(command or "")
    if not cmd.strip():
        return {"verdict": "allow", "entry": None, "specRead": False}
    if is_spec_read(cmd, spec_read_patterns):
        return {"verdict": "allow", "entry": None, "specRead": True}
    hit = None
    for e in entries or []:
        if not e["match"] or e["mode"] not in GUARD_MODES:
            continue
        try:
            rx = re.compile(e["match"], re.I)
        except re.error:
            continue
        if not rx.search(cmd):
            continue
        if e["mode"] == "deny":
            return {"verdict": "deny", "entry": e, "specRead": False}
        if hit is None:
            hit = e
    return {"verdict": "surface", "entry": hit, "specRead": False} if hit else {"verdict": "allow", "entry": None, "specRead": False}


def format_guidance(entry, sections=None):
    secs = " · ".join(sections or DEFAULT_GUIDE_SECTIONS)
    lines = [
        (f'✗ 이 조회는 금지돼 있다 — 조회하지 말고 {entry["spec"]}를 읽어라.'
         if entry["mode"] == "deny"
         else f'· 이 조회의 답이 이미 명세에 있을 수 있다 — {entry["spec"]}를 먼저 보라.'),
        f'  왜: {entry["why"]}',
        f'  어디: {entry["spec"]} 의 {secs}(결정 이력이 사는 절)',
    ]
    if entry["instead"]:
        lines.append(f'  대신 볼 곳: {" · ".join(entry["instead"])}')
    return lines


def cmd_diagnosisguard(cfg, argv):
    policy = str(cfg.get("diagnosisGuardPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ diagnosisGuardPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    hook = "--hook" in argv
    rest = [a for a in argv if a != "--hook"]
    command = " ".join(rest)
    if not command and hook:
        # ⚠ stdin은 훅 모드에서만 읽는다 — 데이터 없는 파이프에서 블록되면 판정이 통째로 사라진다.
        try:
            raw = sys.stdin.read()
        except Exception:
            raw = ""
        if raw.strip():
            try:
                o = json.loads(raw)
                command = str((o.get("tool_input") or {}).get("command") or o.get("command") or "")
            except Exception:
                command = raw.strip()
    entries = parse_diagnosis_map(cfg.get("diagnosisSpecMap"))
    sections = cfg.get("diagnosisGuideSections") or DEFAULT_GUIDE_SECTIONS

    if policy == "off":
        if hook:
            sys.exit(0)
        verdict("OFF", "diagnosisGuardPolicy")
        print("진단 가드 게이트 — diagnosisGuardPolicy:off (판정 안 함)")
        return

    if hook or command:
        if not entries:
            sys.exit(0)
        r = judge_command(command, entries, cfg.get("diagnosisSpecReadPatterns"))
        if r["verdict"] == "allow":
            sys.exit(0)
        lines = format_guidance(r["entry"], sections)
        if r["verdict"] == "deny" and policy == "hard":
            for l in lines:
                print(l, file=sys.stderr)
            print("  (이 조회가 정말 필요하면 그 스펙을 고쳐 금지를 걷어내라 — 우회가 아니라 명세 편집이다)",
                  file=sys.stderr)
            sys.exit(2)
        for l in lines:
            print(l)
        sys.exit(0)

    if not entries:
        verdict("INERT", "diagnosisSpecMap 미선언 — 무엇에 발화할지 모른다")
        print("[안 봄(판정 입력 없음)] 진단 가드 게이트 — `diagnosisSpecMap` 미선언: **판정하지 않는다**."
              " 조사 전에 읽어야 할 명세가 있으면 `{ match: <명령 정규식>, spec: <그 답이 있는 스펙>, mode: surface|deny, why, instead }`로 선언하라."
              " 조회는 커밋도 파일 변경도 남기지 않으므로 **커밋 게이트로는 원리상 볼 수 없는 층**이다.")
        return
    spec_dir = resolve(cfg, cfg["specDir"])
    try:
        spec_names = os.listdir(spec_dir)
    except OSError:
        spec_names = []

    def spec_exists(ref):
        r = str(ref)
        if os.path.exists(os.path.join(cfg["__root"], *r.split("/"))):
            return True
        return any(r in n for n in spec_names)

    allf = validate_diagnosis_map(entries, spec_exists)
    # 3분류 계약(SPEC-054) — **확인 못 함은 차단하지 않는다.** 권한·I/O 사정으로 못 본 것을
    # 위반이라 부르면 오탐이 쌓이고, 오탐이 잦은 게이트는 꺼진다. 그러나 초록에도 합산하지 않는다.
    findings = [x for x in allf if x["kind"] != "spec-unchecked"]
    unchecked = [x for x in allf if x["kind"] == "spec-unchecked"]
    judged(len(findings) if policy == "hard" else 0)
    deny = sum(1 for e in entries if e["mode"] == "deny")
    unchecked_tail = f" · 확인 못 함 {len(unchecked)}(통과 아님)" if unchecked else ""
    print(f"진단 가드 게이트(diagnosisGuardPolicy={policy}): 규칙 {len(entries)}종"
          f" (금지 {deny} · 노출 {len(entries) - deny}) — 선언 위반 {len(findings)}"
          f"{unchecked_tail}")
    tag = "✗" if policy == "hard" else "⚠"
    for f in findings:
        extra = f' ({f["spec"]})' if f.get("spec") else (f' ({f["got"]})' if f.get("got") else "")
        line = f'  {tag} [{f["at"]}] {GUARD_FINDING_TEXT[f["kind"]]}{extra}'
        print(line, file=sys.stderr) if policy == "hard" else print(line)
    for f in unchecked:
        print(f'  · [{f["at"]}] {GUARD_FINDING_TEXT[f["kind"]]} ({f["spec"]})')
    if findings and policy == "hard":
        print("\n✗ 진단 가드 선언이 깨졌다 — 이 축의 자기결함은 **조용한 무발화**다:"
              " 잘못된 선언은 아무것도 막지 않고 아무것도 알리지 않는다.", file=sys.stderr)
        sys.exit(1)
    if not findings:
        print(f"  ✓ 규칙 {len(entries)}종이 모두 실재하는 스펙을 지목하고 사유·대안을 갖는다.")
        print("  · 이 층은 **도구 호출 직전**에 발동한다 — 조회는 커밋도 파일 변경도 남기지 않으므로"
              " 커밋 게이트로는 원리상 볼 수 없다. 배선 실재는 R19(에이전트 배선)가 판정한다.")


def cmd_specconflict(cfg):
    policy = str(cfg.get("specConflictPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ specConflictPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "specConflictPolicy")
        print("명세 모순 감사 게이트 — specConflictPolicy:off (판정 안 함)")
        return
    spec_dir = resolve(cfg, cfg["specDir"])
    try:
        names = sorted(n for n in os.listdir(spec_dir) if n.endswith(".md"))
    except OSError:
        names = []
    if not names:
        verdict("INERT", "스펙 0건 — 대조할 코퍼스가 없다")
        print("[안 봄(판정 입력 없음)] 명세 모순 감사 게이트 — 스펙이 0건이다"
              " — **0건은 '깨끗함'이 아니라 '볼 것이 없음'이다**.")
        return
    specs = []
    for n in names:
        try:
            text = read_text(os.path.join(spec_dir, n))
        except OSError:
            continue
        m = cfg["__specId"].search(text)
        specs.append({"id": m.group(0) if m else n[:-3], "file": f'{cfg["specDir"]}/{n}', "text": text})
    req_alt = cfg.get("__reqAlt") or "FR"
    opts = {
        "minTokens": cfg.get("specConflictMinTokens"),
        "maxDocFreq": cfg.get("specConflictMaxDocFreq"),
        "stopwords": cfg.get("specConflictStopwords"),
        "negationMarkers": cfg.get("specConflictNegationMarkers"),
        "clauseBreaks": cfg.get("specConflictClauseBreaks"),
    }
    directives = collect_directives(specs, lambda l: _is_fr_decl_line(l, req_alt), opts)
    if not directives:
        verdict("INERT", "SHALL 지시 0건 — EARS 문법이 없어 극성을 판정할 수 없다")
        print(f"[안 봄(판정 입력 없음)] 명세 모순 감사 게이트 — 스펙 {len(specs)}건에서 SHALL 지시를 찾지 못했다."
              " 이 축은 EARS 극성(SHALL ↔ SHALL NOT)으로 판정하므로 그 문법이 없으면 **판정하지 않는다**"
              "(어휘가 다르면 `specConflictNegationMarkers`를 갈아끼워라 — 면제가 아니라 어휘 교체다).")
        return
    res = spec_conflicts(directives, opts)
    conflicts, same_spec = res["conflicts"], res["sameSpec"]
    total = len(conflicts) + len(same_spec)
    judged(total if policy == "hard" else 0)
    print(f"명세 모순 감사 게이트(specConflictPolicy={policy}): 스펙 {len(specs)}건 · 지시 {len(directives)}건 대조"
          f" — 교차 스펙 모순 {len(conflicts)} · 한 스펙 내 모순 {len(same_spec)}")
    tag = "✗" if policy == "hard" else "⚠"
    if total:
        if policy == "hard":
            print(f"\n✗ 명세가 스스로와 모순이다 {total}건 — 급할 때 에이전트는 자기가 먼저 본 쪽을 따른다:",
                  file=sys.stderr)
        def emit(line):
            print(line, file=sys.stderr) if policy == "hard" else print(line)
        for label, pairs in (("한 스펙 내", same_spec), ("교차 스펙", conflicts)):
            for pr in pairs:
                a, b, why = format_conflict(pr)
                emit(f"  {tag} [{label}] {a}")
                emit(f'     {" " * 11}{b}')
                emit(f"     → {why}")
        if policy == "hard":
            print("\n→ 해소는 **어느 지시가 정본인지 결정해 한쪽을 고치는 것**뿐이다(면제 경로 없음)."
                  " 실측: 명세 안에 반대 방향 지시가 공존한 탓에 소유자가 여러 세션에 걸쳐 금지한 경로가 재발했다.",
                  file=sys.stderr)
            sys.exit(1)
        return
    print("  ✓ 상반된 지시 0건 — 같은 대상에 SHALL과 SHALL NOT이 공존하지 않는다.")
    print("  · 이 축은 감사의 **결정적 절반**이다 — \"같은 기능에 1은 A, 2는 B\" 같은 의미 충돌은"
          " 확률적 판정이라 차단력을 주지 않는다(그 층은 쌍을 전수 열거해 사람·LLM이 판정한다).")


def cmd_agentwiring(cfg):
    root = cfg["__root"]
    policy = str(cfg.get("agentWiringPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ agentWiringPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "agentWiringPolicy")
        print("에이전트 배선 게이트 — agentWiringPolicy:off (판정 안 함)")
        return
    def absp(rel):
        return os.path.join(root, *str(rel).split("/"))
    decl_rel = str(cfg.get("agentHookDecl") or DEFAULT_AGENT_HOOK_DECL)
    decl_path = absp(decl_rel)
    if not os.path.exists(decl_path):
        verdict("INERT", f"훅 선언 파일 없음 — {decl_rel}")
        print(f"[안 봄(판정 입력 없음)] 에이전트 배선 게이트 — 훅 선언 파일이 없다({decl_rel})."
              " 이 파일이 설치기와 게이트의 **단일 선언**이다 — 없으면 무엇이 배선돼야 하는지 알 수 없다."
              " `sh scripts/sdd-init.sh`가 깔거나 킷 `tooling/harness/agent-hooks.list`를 복사하라.")
        return
    decls = parse_agent_hook_decl(read_text(decl_path))
    if not decls:
        verdict("INERT", "선언된 에이전트 훅 0건")
        print(f"[안 봄(판정 입력 없음)] 에이전트 배선 게이트 — {decl_rel}에 선언된 훅이 0건이다"
              " — **0건은 '깨끗함'이 아니라 '볼 것이 없음'이다**.")
        return
    settings_rel = str(cfg.get("agentSettingsFile") or DEFAULT_AGENT_SETTINGS_FILE)
    settings_path = absp(settings_rel)
    settings, parse_error = None, ""
    if os.path.exists(settings_path):
        try:
            settings = json.loads(read_text(settings_path))
        except Exception:
            parse_error = "설정 파일을 JSON으로 읽지 못했다"
    script_dir = str(cfg.get("agentScriptDir") or DEFAULT_AGENT_SCRIPT_DIR)

    if "--emit-settings" in sys.argv:
        merged = merge_hook_settings(settings, decls, lambda s: f"sh {script_dir}/{s}")
        verdict("SKIPPED", "생성 모드(판정 아님) — 병합된 설정을 산출한다. 판정은 무인자 실행")
        sys.stdout.write(json.dumps(merged, ensure_ascii=False, indent=2) + "\n")
        return

    def script_exists(name):
        p = absp(f"{script_dir}/{name}")
        return os.path.exists(p) and os.access(p, os.R_OK)

    f = agent_wiring_findings(decls, settings, script_exists)
    errors, warnings = [], []

    def block(msg):
        (errors if policy == "hard" else warnings).append(msg)

    if parse_error:
        block(f"{settings_rel}: {parse_error} — 에이전트가 이 파일을 읽지 못하면 훅이 하나도 발동하지 않는다")
    elif f["settingsMissing"]:
        block(f"에이전트 설정 파일이 없다 — {settings_rel}. 선언된 훅 {len(decls)}종이 **한 번도 발동한 적이 없다**는 뜻이다."
              " git 훅은 커밋 시점에 이미 작성된 코드를 보므로, 에이전트가 스펙 없이 코드를 쓰는 **그 순간**을 보는 층은 이것뿐이다."
              " `sh scripts/sdd-init.sh`가 이 파일을 만든다(기존 hooks는 보존·병합)")
    for d in f["missing"]:
        mt = f'({d["matcher"]})' if d["matcher"] else ""
        block(f'{d["event"]}{mt}에 `{d["script"]}`가 배선되지 않았다'
              " — 그 이벤트에서 이 훅은 발동하지 않는다(선언만 있고 배선이 없으면 감시자는 없는 것과 같다)")
    for d in f["narrowed"]:
        block(f'{d["event"]}의 `{d["script"]}` 매처가 좁다 — 도구 {"·".join(d["missingTools"])}에서 발동하지 않는다'
              f'(선언: {d["matcher"]}). 넓히는 것은 정상이지만 좁히면 그 도구가 감시 밖으로 나간다')
    for d in f["scriptMissing"]:
        block(f'`{d["script"]}`가 배선돼 있는데 {script_dir}/에 실재하지 않거나 읽을 수 없다'
              " — 에이전트는 그 훅을 조용히 건너뛴다(존재는 실행이 아니다)")

    judged(len(errors))
    wired_count = len(decls) - len(f["missing"])
    unchecked_tail = f' · 확인 못 함 {len(f["unchecked"])}(통과 아님)' if f["unchecked"] else ""
    print(f'에이전트 배선 게이트(agentWiringPolicy={policy}): 선언 {len(decls)}종 · 배선 {wired_count}종'
          f' · 매처 좁음 {len(f["narrowed"])} · 스크립트 부재 {len(f["scriptMissing"])} | 설정 {settings_rel}'
          f'{unchecked_tail}')
    for w in warnings:
        print(f"  ⚠ {w}")
    # 3분류 계약(SPEC-054) — 차단하지 않지만 **초록에도 합산하지 않는다**(조용한 0건 금지).
    for u in f["unchecked"]:
        print(f'  · `{u["script"]}` — {u["why"]}(통과가 아니다: 부재로 단정하지 않는다)')
    if errors:
        print(f"\n✗ 감시 에이전트가 배선되지 않았다 {len(errors)}건:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        print("\n→ `sh scripts/sdd-init.sh`(기존 hooks 보존 병합). 배선 실패는 조용히 넘어가지 않는다 — 설치기가 건수를 세고 0이면 실패로 말한다.",
              file=sys.stderr)
        sys.exit(1)
    if not warnings:
        print(f"  ✓ 선언된 에이전트 훅 {len(decls)}종이 모두 배선돼 있고 지목된 스크립트가 실재한다 — 감시자가 에이전트를 본다.")


# ── 편집 시점 spec-first (SPEC-003 FR-001 확장) — Node판 check-pre-edit.mjs 미러 ──────
# 이 축은 2026-08-03에 "훅 편의 계층이라 Node 전용" 결정을 받았고, 재검토 조건은 "sdd-sync 규칙으로
# 승격되면"이었다. 그런데 2026-08-10에 **차단 강도**를 갖게 됐다 — 조건이 예상하지 못한 방아쇠다.
# 차단할 수 있는 층이 한 런타임에만 있으면 다른 런타임 프로젝트는 `hard`를 켜고도 보호가 0이다:
# **hard 선언 + 무판정 = 거짓 안전.** 그래서 조건을 고치고(SPEC-006) 그 처방대로 복제했다.
# 원래 결정의 근거("미러가 있어도 호출부가 없다")도 함께 해소한다 — 훅 쉘이 런타임을 골라 부른다.
def cmd_preedit(cfg, positional, args):
    policy = str(cfg.get("preEditSpecFirstPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ preEditSpecFirstPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    target = positional[0] if positional else None
    if not target:
        return
    if policy == "off":
        return
    hard = policy == "hard"
    root = cfg["__root"]

    # 코드 경로 질의 — 판정이 아니다. config `scanDirs`가 정본이다(하드코딩 경로는 다른 프로젝트에서 눈을 감는다).
    if "--is-code-path" in args:
        relq = str(target).lstrip("./")
        dirs = [str(d).lstrip("./").rstrip("/") for d in (cfg.get("scanDirs") or [])]
        hit = any(d and (relq == d or relq.startswith(d + "/") or ("/" + d + "/") in relq) for d in dirs)
        verdict("SKIPPED", "경로 질의 모드(판정 아님) — 코드 경로 여부만 답한다")
        sys.exit(0 if hit else 1)

    rel = str(target).lstrip("./")
    if rel.startswith(root + "/"):
        rel = rel[len(root) + 1:]

    spec_dir = resolve(cfg, cfg.get("specDir"))
    try:
        names = sorted(n for n in os.listdir(spec_dir) if n.endswith(".md"))
    except OSError:
        return
    owners = []
    for n in names:
        try:
            with open(os.path.join(spec_dir, n), encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        # Files glob 파싱은 이 런타임의 기존 사이트와 **같은 식**을 쓴다(다른 식을 쓰면 두 판의
        # 소유 판정이 갈라지고, 그 차이는 패리티 테스트가 잡는다).
        globs = [compile_glob(g) for g in
                 (strip_inline_comment(x) for x in parse_section(text, "Ownership", ["Files"])["Files"]) if g]
        if not globs:
            continue
        if any(rx.search(rel) for rx in globs):
            m = cfg["__specId"].search(text)
            owners.append({"specId": m.group(0) if m else n, "file": f'{cfg.get("specDir")}/{n}'})
    if not owners:
        return                                    # 미소유 경로 — 침묵(오탐 금지)

    base = os.environ.get("SDD_DIFF_BASE") or cfg.get("specSyncBase") or "origin/main"
    touched = set()
    for a in (["diff", "--name-only"], ["diff", "--cached", "--name-only"],
              ["diff", "--name-only", f"{base}...HEAD"]):
        out = _git(cfg, a)
        if out:
            touched.update(x.strip() for x in out.split("\n") if x.strip())
    if not touched:
        return                                    # 변경 집합 미해석 — 판정 못 하는 자리는 막지 않는다

    stale = [o for o in owners if o["file"] not in touched]
    if not stale:
        return

    judged(len(stale))
    stream = sys.stderr if hard else sys.stdout
    print(f'[SDD spec-first — 편집 전 순서 {"차단" if hard else "확인"}] {rel}', file=stream)
    for o in stale:
        print(f'  {"✗" if hard else "⚠"} 소유 스펙 {o["specId"]}({o["file"]})이 이 브랜치에서 아직 미수정 — 코드보다 명세가 먼저다', file=stream)
        print(f'     어디: {o["file"]} 의 {" · ".join(DEFAULT_GUIDE_SECTIONS)}(결정 이력이 사는 절)', file=stream)
    tail = "" if hard else "(커밋 시점엔 commit-msg 훅이 hard로 막는다)"
    print(f"  → 먼저 그 스펙의 FR/Edge Cases/Change Log를 갱신하고 편집하라{tail}.", file=stream)
    if hard:
        print("  · 이 차단을 걷어내는 길은 **명세 편집**이다 — 우회가 아니라 결정의 갱신이다"
              "(정말 스펙 무관이면 커밋 메시지에 `Spec-Impact: none <사유>`로 사유를 남긴다).", file=stream)
        sys.exit(2)


# ── FR 배치 (SPEC-056, R23) — Node판 fr-placement-lib.mjs + check-fr-placement.mjs 미러 ──────
# 실측 제보: 에이전트가 하루에 같은 실수를 세 번 했다 — FR 정의를 FR 섹션 밖에 썼다. grammar-lib의
# fr_declarations는 FR 섹션 **안**만 스캔하므로 밖에 있는 FR은 "정의 없음"으로 사라지고, 그 사라짐이
# dangling @covers라는 다른 축의 결함으로 재등장한다. 이 축은 사라짐의 원인 자리를 직접 잡는다.
FR_PLACEMENT_FAILURE_CLASS = "fr-outside-section"
FR_SECTION_HEADING = "Functional Requirements"
_H2 = re.compile(r"^##\s+(.+?)\s*$")


def section_spans(text):
    """문서의 모든 H2 섹션을 라인 범위로 나눈다 — 전수 열거(section_block과 다른 능력)."""
    lines = str(text or "").split("\n")
    heads = []
    for i, ln in enumerate(lines):
        m = _H2.match(ln)
        if m:
            heads.append((i, m.group(1).strip()))
    if not heads:
        return [{"name": None, "startLine": 0, "endLine": len(lines)}]
    spans = []
    if heads[0][0] > 0:
        spans.append({"name": None, "startLine": 0, "endLine": heads[0][0]})
    for i, (line, name) in enumerate(heads):
        start = line + 1
        end = heads[i + 1][0] if i + 1 < len(heads) else len(lines)
        spans.append({"name": name, "startLine": start, "endLine": end})
    return spans


def _is_fr_section_name(name, heading):
    return name is not None and re.match(rf"^{heading}\b", name) is not None


def fr_placement_findings(text, fr_decl_re, req_alt="FR", heading=FR_SECTION_HEADING):
    """반환 findings[]: {frId, section, line(1-based)}. FR 섹션이 없는 문서는 exempt(빈 리스트)."""
    spans = section_spans(text)
    if not any(_is_fr_section_name(s["name"], heading) for s in spans):
        return []
    lines = str(text or "").split("\n")
    src = fr_decl_re.pattern if hasattr(fr_decl_re, "pattern") else str(fr_decl_re)
    rex = re.compile(src)
    out = []
    for span in spans:
        if _is_fr_section_name(span["name"], heading):
            continue
        for i in range(span["startLine"], span["endLine"]):
            line = lines[i]
            if not _is_fr_decl_line(line, req_alt):
                continue
            m = rex.search(line)
            if not m:
                continue
            out.append({"frId": m.group(1), "section": span["name"] or "(첫 헤딩 이전)", "line": i + 1})
    return out


def fix_fr_placement(text, fr_decl_re, req_alt="FR", heading=FR_SECTION_HEADING):
    """--fix — FR 정의 블록을 FR 섹션 끝으로 옮긴다. 흡수 범위는 인접한 `>` 줄까지만
    (실측: 더 넓게 흡수하자 빈 줄 건너뛴 남의 `>` 줄이 함께 딸려갔다)."""
    original = str(text or "")
    findings = fr_placement_findings(original, fr_decl_re, req_alt, heading)
    if not findings:
        return {"text": original, "moved": []}
    lines = original.split("\n")
    spans = section_spans(original)
    fr_span = next((s for s in spans if _is_fr_section_name(s["name"], heading)), None)
    if not fr_span:
        return {"text": original, "moved": []}

    blocks = []
    for f in findings:
        start = f["line"] - 1
        end = start + 1
        while end < len(lines) and re.match(r"^\s*>", lines[end]):
            end += 1
        blocks.append({"start": start, "end": end, "frId": f["frId"], "from": f["section"]})
    blocks.sort(key=lambda b: b["start"])

    kept = []
    cursor = 0
    for b in blocks:
        kept.extend(lines[cursor:b["start"]])
        cursor = b["end"]
    kept.extend(lines[cursor:])

    removed_before = sum((b["end"] - b["start"]) for b in blocks if b["start"] < fr_span["endLine"])
    insert_at = fr_span["endLine"] - removed_before
    insertion = [ln for b in blocks for ln in lines[b["start"]:b["end"]]]
    final_lines = kept[:insert_at] + insertion + kept[insert_at:]

    return {
        "text": "\n".join(final_lines),
        "moved": [{"frId": b["frId"], "from": b["from"], "toSection": heading} for b in blocks],
    }


def cmd_gateescalation(cfg):
    policy = str(cfg.get("gateFailureEscalationPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ gateFailureEscalationPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "gateFailureEscalationPolicy")
        print("게이트 실패 에스컬레이션 — gateFailureEscalationPolicy:off (판정 안 함)")
        return
    hard = policy == "hard"
    root = cfg["__root"]
    rel = str(cfg.get("gateFailureLedger") or DEFAULT_GATE_FAILURE_LEDGER)
    abs_path = os.path.join(root, *rel.split("/"))

    raw = None
    try:
        with open(abs_path, encoding="utf-8") as fh:
            raw = fh.read()
    except OSError:
        pass
    if raw is None:
        verdict("INERT", f"원장이 없다 — {rel}. 게이트가 아직 차단한 적이 없거나 이 작업본이 새로 만들어졌다")
        print(f"게이트 실패 에스컬레이션 — 원장 없음({rel}, 판정 안 함).")
        return

    guards = cfg.get("gateFailureGuards")
    guards = guards if isinstance(guards, list) else []
    g_errors = guard_findings(guards, lambda g: os.path.exists(os.path.join(root, *str(g).split("/"))))
    if g_errors:
        verdict("JUDGED", f"가드 선언 오류 {len(g_errors)}건")
        print("✗ gateFailureGuards 선언 오류:", file=sys.stderr)
        for e in g_errors:
            extra = f': {e["guard"]}' if e.get("guard") else ""
            print(f'  ✗ [{e["at"]}] {GATE_FAILURE_GUARD_FINDING_TEXT[e["kind"]]}{extra}', file=sys.stderr)
        sys.exit(1)

    parsed = parse_ledger(raw)
    records, unreadable = parsed["records"], parsed["unreadable"]
    threshold = int(cfg.get("gateFailureEscalationThreshold") or 0) or DEFAULT_ESCALATION_THRESHOLD
    counts = class_counts(records)
    findings = escalation_findings(counts, guards, threshold)

    judged(len(findings))
    classed = sum(c["count"] for c in counts)
    unreadable_tail = f" · 확인 못 함(파싱 실패) {unreadable}건" if unreadable else ""
    print(f"게이트 실패 에스컬레이션(gateFailureEscalationPolicy={policy}): 원장 {len(records)}건(클래스 선언 {classed}건)"
          f" — 임계치 {threshold} 초과 미가드 {len(findings)}건{unreadable_tail}")
    tag = "✗" if hard else "⚠"
    for f in findings:
        targets = ", ".join(f["targets"][:3]) + (" …" if len(f["targets"]) > 3 else "")
        print(f'  {tag} [{f["gate"]}] "{f["class"]}" 클래스가 {f["count"]}회 반복됐다(대상: {targets or "—"}) — 전용 가드가 없다.')
        print(f'     → gateFailureGuards에 {{ gate: "{f["gate"]}", class: "{f["class"]}", guard: "<새 게이트 파일>", note: "<왜 해소되는가>" }}를'
              " 추가하거나, 그 전에 전용 가드를 실제로 만들어라(선언만으로는 다음 실행에서 다시 잡힌다 — 가드 파일 실재를 대조한다).")
    if findings and hard:
        print("\n✗ gateFailureEscalationPolicy=hard: 반복된 실패 클래스가 있는데 전용 가드가 없다 — 같은 실수를 다시 겪었다.",
              file=sys.stderr)
        sys.exit(1)
    if not findings:
        print("게이트 실패 에스컬레이션: OK — 임계치를 넘긴 미가드 클래스가 없다.")


def cmd_frplacement(cfg, args):
    policy = str(cfg.get("frPlacementPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ frPlacementPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "frPlacementPolicy")
        print("FR 배치 게이트 — frPlacementPolicy:off (판정 안 함)")
        return
    hard = policy == "hard"
    fix = "--fix" in args
    spec_dir = resolve(cfg, cfg.get("specDir"))
    try:
        names = sorted(n for n in os.listdir(spec_dir) if n.endswith(".md"))
    except OSError:
        names = []
    if not names:
        verdict("INERT", "스펙 파일 0개 — 판정 대상이 없다")
        print("FR 배치 게이트 — 스펙 파일 0개(판정 안 함)")
        return

    if fix:
        fixed_count = 0
        for n in names:
            abs_path = os.path.join(spec_dir, n)
            try:
                with open(abs_path, encoding="utf-8") as fh:
                    text = fh.read()
            except OSError:
                continue
            res = fix_fr_placement(text, cfg["__frDecl"], cfg["__reqAlt"])
            if not res["moved"]:
                continue
            with open(abs_path, "w", encoding="utf-8") as fh:
                fh.write(res["text"])
            m = cfg["__specId"].search(text)
            spec_id = m.group(0) if m else n
            for mv in res["moved"]:
                print(f'  ↻ [{spec_id}] {mv["frId"]}: {mv["from"]} → {mv["toSection"]} 섹션 끝으로 이동')
            fixed_count += len(res["moved"])
        verdict("SKIPPED", "--fix 모드(판정이 아니라 교정)")
        print(f"FR 배치 게이트: --fix 완료 — {fixed_count}건 이동.")
        return

    report = []
    for n in names:
        abs_path = os.path.join(spec_dir, n)
        try:
            with open(abs_path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        findings = fr_placement_findings(text, cfg["__frDecl"], cfg["__reqAlt"])
        if not findings:
            continue
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else n
        for f in findings:
            report.append({"specId": spec_id, "file": f'{cfg.get("specDir")}/{n}', **f})

    meta = {"class": FR_PLACEMENT_FAILURE_CLASS, "target": report[0]["file"]} if report else None
    verdict("JUDGED", f"위반 {len(report)}건" if report else "위반 0건", meta)
    print(f"FR 배치 게이트(frPlacementPolicy={policy}): 스펙 {len(names)}개 검사 — {FR_SECTION_HEADING} 섹션 밖 FR {len(report)}건")
    tag = "✗" if hard else "⚠"
    for r in report:
        print(f'  {tag} [{r["specId"]}] {r["frId"]}가 "{r["section"]}" 섹션에 있다({r["file"]}:{r["line"]}) — {FR_SECTION_HEADING} 섹션 안에 있어야 한다')
    if report:
        print("  → node scripts/check-fr-placement.mjs --fix 로 옮긴다(훅은 자동 교정하지 않는다 — 사람이 명시적으로 실행한다).")
    if report and hard:
        print('\n✗ frPlacementPolicy=hard: FR 정의가 섹션 밖에 있으면 다른 게이트가 "정의 없음(dangling @covers)"으로'
              " 뒤늦게 본다 — 원인 자리에서 막는다.", file=sys.stderr)
        sys.exit(1)
    if not report:
        print(f"FR 배치 게이트: OK — 모든 FR 정의가 {FR_SECTION_HEADING} 섹션 안에 있다.")


# ── 위험 행동 승인 (SPEC-058, R25) — Node판 action-approval-lib.mjs 미러 ──────────
# 실측 제보(2026-08-14): 커밋 이전, 대화 안에서 위험 행동(트래커 종결 전이 등)이 독립 검증 없이
# 진행됐다. 승인 마커는 행동 페이로드 해시에 결속되고, 게이트는 마커의 존재·해시 일치·신선도만
# 결정론적으로 본다 — 서브에이전트 호출은 차단당한 실행기 자신이 한다(게이트는 스스로 안 부른다).
DEFAULT_ACTION_APPROVAL_LEDGER = ".sdd/action-approvals.jsonl"
DEFAULT_APPROVAL_TTL_SECONDS = 900

ACTION_APPROVAL_GUARD_FINDING_TEXT = {
    "no-matcher": "match·tool이 둘 다 없다 — 무엇에 발화할지 모르는 선언은 아무것도 막지 않는다",
    "ambiguous-matcher": "match·tool이 둘 다 있다 — 한 항목은 Bash 명령용(match)이거나 도구명용(tool) 중 하나만 갖는다",
    "bad-regex": "명령 패턴(match)이 정규식으로 컴파일되지 않는다 — 이 규칙은 **조용히 무발화**다",
    "bad-tool": "도구명 패턴(tool)이 정규식으로 컴파일되지 않는다 — 이 규칙은 **조용히 무발화**다",
    "no-class": "class가 없다 — 에스컬레이션 집계(SPEC-057)가 이 선언을 인식할 키가 없다",
    "no-verify-against": "verifyAgainst가 없다 — 서브에이전트가 무엇과 대조해야 하는지 모른다",
    "no-why": "사유가 없다 — 왜 이 행동에 승인이 필요한지 모르면 사람은 규칙을 우회한다",
}


def hash_action(command):
    return hashlib.sha256(str(command or "").strip().encode("utf-8")).hexdigest()


def _sort_keys_deep(v):
    if isinstance(v, list):
        return [_sort_keys_deep(x) for x in v]
    if isinstance(v, dict):
        return {k: _sort_keys_deep(v[k]) for k in sorted(v.keys())}
    return v


# Node판 JSON.stringify({tool, input: sortKeysDeep(toolInput)})와 바이트 동일해야 한다(해시 대상).
# ensure_ascii=False·구분자 무공백이 그 동일성의 핵심 — 기본값은 둘 다 Node 출력과 갈린다.
def canonical_tool_payload(tool_name, tool_input):
    payload = {"tool": str(tool_name or ""), "input": _sort_keys_deep(tool_input or {})}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def tool_call_from_hook_input(argv, read_stdin):
    def get_flag(flag):
        if flag in argv:
            i = argv.index(flag)
            if i + 1 < len(argv):
                return argv[i + 1]
        return None
    flag_command = get_flag("--command")
    if flag_command is not None:
        return {"toolName": "Bash", "command": flag_command, "toolInput": {"command": flag_command}}
    try:
        raw = read_stdin()
    except Exception:
        return {"toolName": "", "command": "", "toolInput": None}
    if not raw.strip():
        return {"toolName": "", "command": "", "toolInput": None}
    try:
        j = json.loads(raw)
        tool_name = str(j.get("tool_name") or "")
        tool_input = j.get("tool_input") or {}
        return {"toolName": tool_name, "command": str(tool_input.get("command") or ""), "toolInput": tool_input}
    except Exception:
        return {"toolName": "", "command": "", "toolInput": None}


def parse_risky_action_patterns(value):
    out = []
    for raw in (value if isinstance(value, list) else []):
        if not isinstance(raw, dict):
            continue
        out.append({
            "match": str(raw.get("match") or ""),
            "tool": str(raw.get("tool") or ""),
            "class": str(raw.get("class") or ""),
            "verifyAgainst": str(raw.get("verifyAgainst") or ""),
            "why": str(raw.get("why") or ""),
        })
    return out


def validate_risky_action_patterns(entries):
    findings = []
    for i, e in enumerate(entries or []):
        at = e["class"] or e["match"] or e.get("tool") or f"#{i + 1}"
        has_match = bool(e["match"])
        has_tool = bool(e.get("tool"))
        if not has_match and not has_tool:
            findings.append({"kind": "no-matcher", "at": at})
            continue
        if has_match and has_tool:
            findings.append({"kind": "ambiguous-matcher", "at": at})
            continue
        if has_match:
            try:
                re.compile(e["match"])
            except re.error:
                findings.append({"kind": "bad-regex", "at": at})
                continue
        if has_tool:
            try:
                re.compile(e["tool"])
            except re.error:
                findings.append({"kind": "bad-tool", "at": at})
                continue
        if not e["class"].strip():
            findings.append({"kind": "no-class", "at": at})
        if not e["verifyAgainst"].strip():
            findings.append({"kind": "no-verify-against", "at": at})
        if not e["why"].strip():
            findings.append({"kind": "no-why", "at": at})
    return findings


def match_risky_action(call, entries):
    tool_name = str((call or {}).get("toolName") or "")
    command = str((call or {}).get("command") or "")
    for e in entries or []:
        if e.get("tool"):
            if not tool_name:
                continue
            try:
                if re.search(e["tool"], tool_name, re.IGNORECASE):
                    return e
            except re.error:
                continue
            continue
        if e.get("match"):
            if not command.strip():
                continue
            try:
                if re.search(e["match"], command, re.IGNORECASE):
                    return e
            except re.error:
                continue
    return None


def make_approval_record(fields):
    return {
        "hash": str(fields.get("hash") or ""),
        "class": str(fields.get("class") or ""),
        "note": str(fields.get("note") or ""),
        "ts": fields.get("ts"),
        "sessionId": fields.get("sessionId") or "unknown",
    }


def find_approval(hash_, records, ttl_seconds=DEFAULT_APPROVAL_TTL_SECONDS, now_ms=None):
    if now_ms is None:
        return None
    best = None
    for r in records or []:
        if not r or r.get("hash") != hash_ or not r.get("ts"):
            continue
        try:
            ts_ms = datetime.fromisoformat(r["ts"].replace("Z", "+00:00")).timestamp() * 1000
        except Exception:
            continue
        age_ms = now_ms - ts_ms
        if age_ms < 0 or age_ms > ttl_seconds * 1000:
            continue
        if not best or r["ts"] > best["ts"]:
            best = r
    return best


def cmd_riskyaction(cfg, argv):
    policy = str(cfg.get("riskyActionPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ riskyActionPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    hook = "--hook" in argv
    record = "--record" in argv
    entries = parse_risky_action_patterns(cfg.get("riskyActionPatterns"))

    if policy == "off":
        if hook:
            sys.exit(0)
        verdict("OFF", "riskyActionPolicy")
        print("위험 행동 승인 게이트 — riskyActionPolicy:off (판정 안 함)")
        return

    def get_flag(flag):
        if flag in argv:
            i = argv.index(flag)
            if i + 1 < len(argv):
                return argv[i + 1]
        return None

    root = cfg["__root"]
    ledger_rel = str(cfg.get("riskyActionLedger") or DEFAULT_ACTION_APPROVAL_LEDGER)
    ledger_path = os.path.join(root, *ledger_rel.split("/"))

    if record:
        command = get_flag("--command")
        cls = get_flag("--class")
        note = get_flag("--note")
        if not command or not cls or not note:
            print("✗ --record는 --command·--class·--note가 모두 필요하다(승인 근거를 지어내지 않는다).",
                  file=sys.stderr)
            sys.exit(1)
        h = hash_action(command)
        rec = make_approval_record({
            "hash": h, "class": cls, "note": note,
            "ts": datetime.now(timezone.utc).isoformat(), "sessionId": os.environ.get("SDD_SESSION_ID") or "unknown",
        })
        os.makedirs(os.path.dirname(ledger_path) or ".", exist_ok=True)
        with open(ledger_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        verdict("SKIPPED", "--record 모드(판정이 아니라 승인 기록)")
        print(f'위험 행동 승인 게이트: 승인 기록됨 — class="{cls}" hash={h[:12]}… (유효기간은 riskyActionApprovalTtlSeconds)')
        return

    if hook:
        if not entries:
            sys.exit(0)
        # 정본은 Node판 toolCallFromHookInput(action-approval-lib) — `--command <값>` 아니면 stdin.
        call = tool_call_from_hook_input(argv, lambda: sys.stdin.read())
        tool_name, command, tool_input = call["toolName"], call["command"], call["toolInput"]
        entry = match_risky_action({"toolName": tool_name, "command": command}, entries)
        if not entry:
            sys.exit(0)

        # Bash(match)는 명령 문자열을 그대로 해시한다(하위호환). 그 외 도구(tool)는 명령 문자열이
        # 없으므로 {tool, input}의 정준 페이로드를 해시한다 — --record --command에 그대로 넘길 문자열.
        payload = canonical_tool_payload(tool_name, tool_input) if entry.get("tool") else command
        h = hash_action(payload)
        ttl = int(cfg.get("riskyActionApprovalTtlSeconds") or 0) or DEFAULT_APPROVAL_TTL_SECONDS
        raw = None
        try:
            with open(ledger_path, encoding="utf-8") as fh:
                raw = fh.read()
        except OSError:
            pass
        records = parse_ledger(raw)["records"] if raw is not None else []
        approval = find_approval(h, records, ttl, time.time() * 1000)
        if approval:
            sys.exit(0)

        verdict("JUDGED", "위반 1건", {"class": entry["class"], "target": h})
        print(f'[SDD 위험 행동] 클래스 "{entry["class"]}" — 독립 검증 없이는 진행할 수 없다(riskyActionPolicy={policy}).')
        print(f'  왜: {entry["why"]}')
        print(f'  확인 방법: {entry["verifyAgainst"]}')
        print("  → 별도 컨텍스트의 서브에이전트를 만들어 위 내용을 실제로 대조 확인시켜라(이 게이트는 그 호출을 스스로 하지 않는다).")
        if entry.get("tool"):
            print(f"  → 확인되면(도구 호출 — 아래 행동 페이로드를 정확히 그대로 붙여넣는다): node scripts/check-risky-action.mjs --record --command '{payload}' --class \"{entry['class']}\" --note \"<확인 근거>\"")
        else:
            print(f'  → 확인되면: node scripts/check-risky-action.mjs --record --command "<이 행동의 원문 명령 그대로>" --class "{entry["class"]}" --note "<확인 근거>"')
        print(f"  → 그 다음 이 행동을 재시도하라(승인 유효기간 {ttl}초, 행동 문자열이 정확히 같아야 한다).")
        if policy == "hard":
            print("\n✗ riskyActionPolicy=hard: 승인 마커 없이 위험 행동을 차단한다.", file=sys.stderr)
            sys.exit(2)
        print("  · advisory — 차단하지 않는다. hard로 승격하면 이 행동은 여기서 멈춘다.")
        return

    if not entries:
        verdict("INERT", "riskyActionPatterns 미선언 — 무엇에 발화할지 모른다")
        print("위험 행동 승인 게이트 — `riskyActionPatterns` 미선언: **판정하지 않는다**."
              " 되돌리기 어려운 행동(트래커 상태 전이·배포·파괴적 DB 조작 등)이 있으면"
              " Bash는 `{ match: <명령 정규식>, class, verifyAgainst, why }`, 그 외 도구 호출은"
              " `{ tool: <도구명 정규식>, class, verifyAgainst, why }`로 선언하라(둘 중 하나만).")
        return
    findings = validate_risky_action_patterns(entries)
    judged(len(findings))
    print(f"위험 행동 승인 게이트(riskyActionPolicy={policy}): 패턴 {len(entries)}종 선언 — 선언 위반 {len(findings)}")
    tag = "✗" if policy == "hard" else "⚠"
    for f in findings:
        stream = sys.stderr if policy == "hard" else sys.stdout
        print(f'  {tag} [{f["at"]}] {ACTION_APPROVAL_GUARD_FINDING_TEXT[f["kind"]]}', file=stream)
    if findings and policy == "hard":
        print("\n✗ 위험 행동 패턴 선언이 깨졌다 — 이 축의 자기결함은 **조용한 무발화**다.", file=sys.stderr)
        sys.exit(1)
    if not findings:
        print(f"  ✓ 패턴 {len(entries)}종이 모두 class·verifyAgainst·사유를 갖는다.")
        print("  · 이 층은 **도구 호출 직전**에 발동한다 — 실시간 대화는 커밋도 파일 변경도 남기지 않으므로"
              " 커밋 게이트로는 원리상 볼 수 없다. 배선 실재는 R19(에이전트 배선)가 판정한다.")


# ── 완료 판정 신호 강도 (SPEC-055, R22) — Node판 completion-signal-lib.mjs 미러 ──────
# 실측 제보: 배포 완료를 **파생 신호로 판정했다.** 파이프라인 로그에 성공 줄이 있고 CI가 초록이어서
# 완료로 보고했는데 migrate Job이 실패해 배포 스테이지가 스킵된 상태였다.
# **로그와 상태는 대상이 아니라 대상에 대한 이야기다.**
SIGNAL_KINDS = ["target-state", "derived", "self-report"]
COMPLETION_MIN_SIGNAL = "target-state"


def signal_rank(kind):
    try:
        i = SIGNAL_KINDS.index(str(kind or ""))
    except ValueError:
        return -1
    return len(SIGNAL_KINDS) - i


def parse_signal(value):
    """값이 없으면 **추정하지 않는다** — 추정한 기본값은 조용히 정답이 된다."""
    s = str("" if value is None else value).strip()
    return s if s else None


def completion_findings(claims, min_signal=COMPLETION_MIN_SIGNAL):
    """반환 findings[] — kind: no-signal | bad-signal | weak-signal."""
    need = signal_rank(min_signal)
    findings = []
    for c in (claims or []):
        cid = str((c or {}).get("id") or "").strip() or "(무명)"
        if not (c or {}).get("assertsCompletion"):
            continue
        sig = parse_signal((c or {}).get("signal"))
        if not sig:
            findings.append({"kind": "no-signal", "id": cid})
            continue
        if sig not in SIGNAL_KINDS:
            findings.append({"kind": "bad-signal", "id": cid, "got": sig})
            continue
        if signal_rank(sig) < need:
            findings.append({"kind": "weak-signal", "id": cid, "got": sig})
    return findings


SIGNAL_FINDING_TEXT = {
    "no-signal": "완료를 주장하는데 **무엇을 관측했는지 선언이 없다** — `signal`을 적어라"
                 f"({' | '.join(SIGNAL_KINDS)}). 기본값을 두지 않는 이유: 추정한 기본값은 조용히 정답이 된다",
    "bad-signal": f"신호 종류가 열거 밖이다({' | '.join(SIGNAL_KINDS)}) — 오타는 **조용한 무발화**가 된다",
    "weak-signal": "**파생 신호만으로 완료를 주장한다** — 로그·CI 상태·저널은 대상이 아니라 대상에 대한"
                   " 이야기다. 실측: 파이프라인 로그에 성공 줄이 있고 CI가 초록이어서 배포 완료로 보고했는데"
                   " migrate Job이 실패해 배포 스테이지가 스킵된 상태였다. 대상 상태를 직접 조회하는 검사를 하나 더해라",
}

SIGNAL_KIND_TEXT = {
    "target-state": "대상을 직접 조회한다(클러스터·DB·엔드포인트의 지금 상태)",
    "derived": "대상에 대한 이야기를 읽는다(로그·CI 상태·저널·리포트)",
    "self-report": "사람·에이전트의 진술",
}


def cmd_completionsignal(cfg):
    policy = str(cfg.get("completionSignalPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ completionSignalPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "completionSignalPolicy")
        print("완료 신호 게이트 — completionSignalPolicy:off (판정 안 함)")
        return
    hard = policy == "hard"
    checks = cfg.get("liveRealityChecks")
    checks = checks if isinstance(checks, list) else []
    claims = [{"id": str((c or {}).get("id") or ""),
               "assertsCompletion": bool((c or {}).get("assertsCompletion")),
               "signal": (c or {}).get("signal")} for c in checks]
    asserting = [c for c in claims if c["assertsCompletion"]]

    if not asserting:
        # **판정 입력이 없는 것을 clean으로 말하지 않는다**(SPEC-040 INERT).
        verdict("INERT", "완료를 주장하는 검사 0건 — liveRealityChecks 항목에 assertsCompletion을 선언하면 판정한다")
        print(f"[안 봄(판정 입력 없음)] 완료 신호 게이트 — 완료를 주장하는 검사가 선언되지 않았다(검사 {len(checks)}건 중 0건).")
        kinds = " · ".join(f"{k}({SIGNAL_KIND_TEXT[k]})" for k in SIGNAL_KINDS)
        print('  · "됐는가"를 말하는 검사에 `assertsCompletion: true`와 `signal`을 붙이면'
              f" 그 판정이 **대상 상태를 봤는지** 대조한다 — {kinds}")
        return

    findings = completion_findings(asserting, COMPLETION_MIN_SIGNAL)
    judged(len(findings))
    print(f"완료 신호 게이트(completionSignalPolicy={policy}): 완료 주장 {len(asserting)}건 검사"
          f" (하한 {COMPLETION_MIN_SIGNAL}) — 위반 {len(findings)}건")
    tag = "✗" if hard else "⚠"
    for f in findings:
        got = f' (선언: {f["got"]})' if f.get("got") else ""
        print(f'  {tag} [{f["id"]}]{got} {SIGNAL_FINDING_TEXT[f["kind"]]}')
    if findings and hard:
        print(f"\n✗ completionSignalPolicy=hard: 완료 판정이 대상 상태를 관측하지 않는다 {len(findings)}건.", file=sys.stderr)
        print("  · 해소는 신호 종류를 고쳐 적는 것이 아니라 **대상을 조회하는 검사를 더하는 것**이다"
              "(선언을 target-state로 바꾸면서 명령이 그대로면 그 선언은 거짓이 된다).", file=sys.stderr)
        sys.exit(1)
    if not findings:
        print(f"완료 신호 게이트: OK — 완료를 주장하는 {len(asserting)}건이 모두 대상 상태를 관측한다고 선언한다.")
        print("  · 이 축은 **선언**을 판정한다 — 그 명령이 정말 대상을 조회하는지는 정적으로 결정되지 않는다"
              "(추측으로 판정하면 오탐이 쌓이고, 오탐이 잦은 게이트는 꺼진다).")


# ── 구현 중복 (SPEC-038, R13) — Node판 duplicate-logic-lib.mjs + check-duplicate-logic.mjs 미러 ──
# 판정 게이트는 양판 필수다(SPEC-006). 이 축이 Node에만 있던 동안 Python 런타임 프로젝트는
# 구현 중복을 아무도 보지 않는 상태였고, 그 0건은 진짜 0건과 구분되지 않았다.
# 대응 선언(`PY_SUBCOMMAND`)을 기계화한 첫 실행이 이 누락을 즉시 지목했다.
DEFAULT_DUPLICATE_LITERAL_PATTERNS = [
    r"(?<![\w$)\]])/((?:[^/\\\n\[]|\\.|\[(?:[^\]\\]|\\.)*\])+)/[gimsuyd]*",
]
DEFAULT_DUPLICATE_MIN_LENGTH = 8
DEFAULT_DUPLICATE_FILE_REGEX = [r"\.(?:m|c)?[jt]sx?$"]

_DUP_COMMENT_LINE = re.compile(r"^\s*(?://|#|\*)")
_DUP_STRINGS = re.compile(r"\"[^\"\n]*\"|'[^'\n]*'|`[^`\n]*`")
_DUP_TRAILING = re.compile(r"(^|[\s;{}(),])//.*$")


def extract_literals(text, patterns=None, min_length=DEFAULT_DUPLICATE_MIN_LENGTH):
    """텍스트 → [{literal, line}]. 주석·문자열을 먼저 지운다(파서 없이 오탐을 줄이는 핵심)."""
    pats = patterns if patterns else DEFAULT_DUPLICATE_LITERAL_PATTERNS
    out = []
    for i, raw in enumerate(str(text or "").split("\n")):
        if _DUP_COMMENT_LINE.search(raw):
            continue
        line = _DUP_STRINGS.sub('""', raw)
        line = _DUP_TRAILING.sub(r"\1", line)
        for pat in pats:
            try:
                rex = re.compile(pat)
            except re.error:
                continue
            for m in rex.finditer(line):
                lit = m.group(1) if m.lastindex else None
                if not lit or len(lit) < min_length:
                    continue
                if lit.startswith("*") or lit.startswith("/"):
                    continue
                out.append({"literal": lit, "line": i + 1})
    return out


def duplicate_literal_findings(files, allow=None):
    """반환 {findings, errors}. **같은 파일 안의 반복도 센다**(실측 사고가 그 형태였다)."""
    allow = allow or {}
    errors = []
    for lit, reason in allow.items():
        if not str(reason or "").strip():
            errors.append(f'duplicateLogicAllow "{lit}" — 사유 필수(왜 이 중복이 정당한가; 빈 값은 무언의 면제다)')
    bucket = {}
    for f in (files or []):
        for l in (f.get("literals") or []):
            bucket.setdefault(l["literal"], []).append({"path": f["path"], "line": l["line"]})
    findings = []
    for lit in sorted(bucket):
        sites = bucket[lit]
        if len(sites) < 2 or lit in allow:
            continue
        findings.append({"literal": lit, "sites": sites, "files": len({s["path"] for s in sites})})
    return {"findings": findings, "errors": errors}


def stale_allow_entries(files, allow=None):
    """더 이상 중복이 아닌 면제 — 등록부는 최신일 때만 등록부다."""
    allow = allow or {}
    seen = {}
    for f in (files or []):
        for l in (f.get("literals") or []):
            seen[l["literal"]] = seen.get(l["literal"], 0) + 1
    return sorted(lit for lit in allow if seen.get(lit, 0) < 2)


def parse_duplicate_candidates(stdout):
    """확률적 층 어댑터 stdout — `<경로>:<라인>\t<경로>:<라인>\t<설명>`."""
    out = []
    for raw in str(stdout or "").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        cells = [c.strip() for c in line.split("\t") if c.strip()]
        if len(cells) < 2:
            continue
        out.append({"a": cells[0], "b": cells[1], "note": " ".join(cells[2:])})
    return out


def cmd_duplicatelogic(cfg):
    policy = str(cfg.get("duplicateLogicPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ duplicateLogicPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "duplicateLogicPolicy")
        print("구현 중복 게이트 — duplicateLogicPolicy:off (판정 안 함)")
        return
    hard = policy == "hard"
    pats = cfg.get("duplicateLiteralPatterns") or DEFAULT_DUPLICATE_LITERAL_PATTERNS
    min_len = int(cfg.get("duplicateLiteralMinLength") or 0) or DEFAULT_DUPLICATE_MIN_LENGTH
    cap = int(cfg.get("duplicateLogicListCap") or 0) or 12
    ignore = set(cfg.get("ignoreDirs") or [])
    test_res = [re.compile(r) for r in (cfg.get("testFileRegex") or [])]
    # ⚠ 킷 기본값은 **킷의 언어**(JS/TS)다 — 그 사실이 소비 프로젝트에서 조용한 0건이 된다.
    declared = bool(cfg.get("duplicateLiteralFileRegex"))
    file_res = [re.compile(r) for r in (cfg.get("duplicateLiteralFileRegex") or DEFAULT_DUPLICATE_FILE_REGEX)]

    files, matched, skipped_ext = [], 0, {}
    for d in (cfg.get("scanDirs") or []):
        base = resolve(cfg, d)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(n for n in dirnames if n not in ignore)
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                r = os.path.relpath(full, cfg["__root"]).replace(os.sep, "/")
                if not any(rex.search(r) for rex in file_res):
                    ext = os.path.splitext(name)[1]
                    if ext:
                        skipped_ext[ext] = skipped_ext.get(ext, 0) + 1
                    continue
                if not cfg.get("duplicateLogicIncludeTests") and any(rex.search(r) for rex in test_res):
                    continue
                matched += 1
                try:
                    with open(full, encoding="utf-8") as fh:
                        text = fh.read()
                except OSError:
                    continue
                lits = extract_literals(text, pats, min_len)
                if lits:
                    files.append({"path": r, "literals": lits})
    files.sort(key=lambda f: f["path"])

    allow = cfg.get("duplicateLogicAllow")
    allow = allow if isinstance(allow, dict) else {}
    res = duplicate_literal_findings(files, allow)
    if res["errors"]:
        print("✗ duplicateLogicAllow 오류:", file=sys.stderr)
        for e in res["errors"]:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    findings = res["findings"]

    # ② 확률적 층 — 주입 어댑터. 비-0 = skipped(사유). "판정 못 함"과 "중복 없음"을 섞지 않는다.
    cand = {"status": "off", "items": [], "reason": ""}
    cmd = str(cfg.get("duplicateLogicCommand") or "").strip()
    if cmd:
        try:
            r = subprocess.run(cmd, shell=True, cwd=cfg["__root"], capture_output=True, text=True,
                               timeout=(int(cfg.get("duplicateLogicTimeoutMs") or 120000) / 1000.0))
            if r.returncode == 0:
                cand = {"status": "ran", "items": parse_duplicate_candidates(r.stdout), "reason": ""}
            else:
                why = [x for x in str(r.stderr or "").strip().split("\n") if x]
                cand = {"status": "skipped", "items": [], "reason": why[-1] if why else f"exit {r.returncode}"}
        except Exception as exc:
            why = [x for x in str(exc).strip().split("\n") if x]
            cand = {"status": "skipped", "items": [], "reason": why[-1] if why else "실행 실패"}

    lit_count = sum(len(f["literals"]) for f in files)
    skipped_list = [f"{e}×{n}" for e, n in sorted(skipped_ext.items(), key=lambda kv: (-kv[1], kv[0]))]
    if not matched:
        verdict("INERT", "판정 대상 파일 0개 — duplicateLiteralFileRegex가 이 프로젝트의 소스와 맞지 않는다")
    elif not declared and skipped_list:
        verdict("INERT", f"언어 미선언 — 킷 기본(JS/TS) 패턴으로 {matched}개만 봤고 {' '.join(skipped_list)}는 보지 않았다"
                         " · duplicateLiteralPatterns·duplicateLiteralFileRegex를 이 프로젝트 언어로 함께 선언하라")
    else:
        judged(len(findings))
    extra = f" · 면제 {len(allow)}건" if allow else ""
    print(f"구현 중복 게이트(duplicateLogicPolicy={policy}): 파일 {len(files)}개·리터럴 {lit_count}건(하한 {min_len}자) — 중복 {len(findings)}건{extra}")

    tag = "✗" if hard else "⚠"
    for f in findings[:cap]:
        where = " · ".join(f'{s["path"]}:{s["line"]}' for s in f["sites"])
        print(f'  {tag} 같은 규칙이 {len(f["sites"])}곳에 있다 — /{f["literal"]}/ → {where}')
    if len(findings) > cap:
        print(f"  {tag} … 외 {len(findings) - cap}건 (전체는 duplicateLogicListCap 상향 또는 게이트 단독 실행)")

    # 면제는 clean일 때도 보인다 — 조용한 '완료'가 되지 않게.
    if allow:
        print(f'· 정당한 중복으로 면제 {len(allow)}건(부채·리뷰 대상): {", ".join("/" + l + "/" for l in allow)}')
        stale = stale_allow_entries(files, allow)
        if stale:
            print(f'  ⚠ 낡은 면제 {len(stale)}건 — 더 이상 중복이 아니다(지워라): {", ".join("/" + l + "/" for l in stale)}')

    # 확률적 층 — 비차단. 상태를 반드시 한 줄로 말한다(침묵은 근거가 아니다).
    if cand["status"] == "off":
        print("· 확률적 층: duplicateLogicCommand 미선언 — 구조 중복(같은 본문·다른 이름)은 판정하지 않았다(미판정, 위반 없음이 아니다)")
    elif cand["status"] == "skipped":
        print(f'· 확률적 층: skipped — {cand["reason"]}(도구 실패를 \'중복 없음\'으로 읽지 않는다)')
    elif not cand["items"]:
        print("· 확률적 층: 후보 0건")
    else:
        print(f'· 확률적 층 후보 {len(cand["items"])}건(비차단 — 확률적 판정에는 차단력을 주지 않는다):')
        for c in cand["items"][:cap]:
            note = f' — {c["note"]}' if c["note"] else ""
            print(f'    ⚠ {c["a"]} ↔ {c["b"]}{note}')

    if findings and hard:
        print("\n✗ duplicateLogicPolicy=hard: 같은 규칙이 두 곳에 구현돼 있다 — 하나로 통합하고 나머지는 그것을 호출하라.", file=sys.stderr)
        print("  · 정말 무관한 중복이면 duplicateLogicAllow에 **사유와 함께** 등록하라(면제는 부채로 매 실행 표면화된다).", file=sys.stderr)
        print("  · 실측 계기: 병렬 작업자들이 격리 지시를 성실히 따르며 각자 헬퍼를 만들어 같은 규칙이 세 갈래로 갈렸다 — 게이트 4종 전부 green이었다.", file=sys.stderr)
        sys.exit(1)
    if not findings:
        print("구현 중복 게이트: OK — 결정적 층에서 중복 리터럴 0건.")


# ── 훅 배선 실재 (SPEC-036, R12) — Node판 hooks-install-lib.mjs + check-hooks-installed.mjs 미러 ──
# 판정 게이트는 양판 필수다(SPEC-006). 이 축이 Node에만 있던 동안 Python 런타임 프로젝트는
# **훅 배선을 아무도 보지 않는 상태**였고, 그 0건은 진짜 0건과 구분되지 않았다.
SDD_HOOK_MARKER = "sdd-managed-hook"


def parse_hook_entries(text):
    """hooks.list 한 줄 → {name, source}. `source`는 미선언이면 None."""
    out = []
    for raw in str(text or "").split("\n"):
        line = raw.split("#")[0].strip()
        if not line:
            continue
        parts = line.split()
        name = parts[0]
        source = parts[1] if len(parts) > 1 else None
        if any(e["name"] == name for e in out):
            continue
        out.append({"name": name, "source": source})
    return out


def parse_hook_list(text):
    return [e["name"] for e in parse_hook_entries(text)]


def hook_findings(expected, installed):
    """반환 findings[] — kind: missing | not-executable | foreign | stale | source-unreadable.

    `source`의 세 상태를 **구분한다**: 키 없음(미선언, 판정 안 함) / None(읽기 실패,
    확인 못 함) / 문자열(대조). 셋을 합치면 이 축이 다시 거짓 green을 만든다."""
    findings = []
    for name in (expected or []):
        h = (installed or {}).get(name)
        if not h or not h.get("exists"):
            findings.append({"kind": "missing", "name": name})
            continue
        if not h.get("executable"):
            findings.append({"kind": "not-executable", "name": name})
            continue
        if SDD_HOOK_MARKER not in str(h.get("content") or ""):
            findings.append({"kind": "foreign", "name": name})
            continue
        if "source" not in h:
            continue
        if h["source"] is None:
            findings.append({"kind": "source-unreadable", "name": name})
            continue
        if str(h["content"]) != str(h["source"]):
            findings.append({"kind": "stale", "name": name})
    return findings


HOOK_FINDING_TEXT = {
    "missing": "설치되지 않았다 — 이 훅이 부르기로 된 게이트는 한 번도 발동하지 않는다",
    "not-executable": "실행 권한이 없다 — git이 조용히 건너뛴다",
    "foreign": "킷 훅이 아니다(마커 없음) — 남의 훅이 그 이름을 점유했고 결과는 미설치와 같다",
    "stale": "설치본이 원본과 다르다(**낡은 사본**) — 원본에 배선된 게이트 호출이 이 사본에는 없을 수 있다."
             " 미설치와 동급이다: 실측 제보에서 누락된 5행이 게이트 호출 블록 전체였고, hard 정책이 한 번도 발동하지 못했다",
    "source-unreadable": "원본을 읽지 못해 신선도를 **확인하지 못했다** — 통과가 아니다(검사 못 함과 통과는 다른 사실이다)",
}

_INSTALL_HINT = " 설치: sh scripts/sdd-hooks-install.sh (킷: sh tooling/harness/self-hooks-install.sh)"


def cmd_hooksinstalled(cfg):
    policy = str(cfg.get("hooksInstalledPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ hooksInstalledPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "hooksInstalledPolicy")
        print("훅 배선 게이트 — hooksInstalledPolicy:off (판정 안 함)")
        return
    hard = policy == "hard"
    root = cfg["__root"]

    # **git은 훅을 복제하지 않는다** — 갓 체크아웃한 작업본에 훅이 없는 것은 미채택의 증거가 아니다.
    # CI에서 거짓 위반을 내면 hard 프로젝트 빌드가 깨지고, 그 다음은 정해져 있다 — 사람이 게이트를 끈다.
    # 강제가 사라지지도 않는다: CI에서 채택의 관측 가능한 대리물은 채택 영수증이고 R17이 판정한다.
    for key in (cfg.get("hooksInstalledSkipEnv") or ["CI"]):
        val = str(os.environ.get(str(key)) or "").strip()
        if val and val != "false":
            verdict("SKIPPED", f"{key} 환경 — git은 훅을 복제하지 않으므로 갓 체크아웃한 작업본에서 훅 설치는 관측되지 않는다")
            print(f"훅 배선 게이트 — {key} 환경이라 **판정하지 않았다(통과가 아니다)**."
                  " git은 훅을 복제하지 않으므로 체크아웃 직후에 훅이 없는 것은 미채택의 증거가 아니다."
                  " 이 축은 **로컬 채택 축**이고, CI에서 채택의 관측 가능한 대리물은 채택 영수증이다 — R17(감시자 실재)이 그것을 판정한다.")
            return

    here = os.path.dirname(os.path.abspath(__file__))
    list_path = None
    for cand in [os.path.join(root, "tooling", "harness", "self", "hooks.list"),
                 os.path.join(root, "scripts", "hooks.list"),
                 os.path.join(root, "tooling", "harness", "hooks.list"),
                 os.path.join(here, "harness", "hooks.list")]:
        if os.path.exists(cand):
            list_path = cand
            break
    if not list_path:
        verdict("INERT", "hooks.list 없음 — 어떤 훅이 있어야 하는지 선언이 없다")
        print("훅 배선 게이트 — hooks.list 없음(판정 대상 미선언, no-op)")
        return
    with open(list_path, encoding="utf-8") as fh:
        entries = parse_hook_entries(fh.read())
    expected = [e["name"] for e in entries]
    source_of = {e["name"]: e["source"] for e in entries}

    if _git(cfg, ["rev-parse", "--git-dir"]) is None:
        verdict("INERT", "git 저장소 아님 — 훅이 설치될 자리가 없다")
        print("훅 배선 게이트 — git 저장소 아님(no-op)")
        return
    # 훅 디렉토리는 **git에게 묻는다** — `--git-dir` + `core.hooksPath`를 손으로 합치면
    # 워크트리에서 훅 없는 전용 디렉토리를 얻어 "미설치"라는 거짓 판정이 된다(SPEC-036 실측).
    hooks_path = _git(cfg, ["rev-parse", "--git-path", "hooks"])
    if hooks_path is None or not hooks_path.strip():
        verdict("INERT", "훅 경로를 git에게서 얻지 못했다 — 판정할 자리를 모른다")
        print("훅 배선 게이트 — `git rev-parse --git-path hooks` 실패(판정 안 함)")
        return
    hooks_path = hooks_path.strip()
    hooks_dir = hooks_path if os.path.isabs(hooks_path) else os.path.join(root, hooks_path)

    try:
        present = os.listdir(hooks_dir)
    except OSError:
        present = []
    installed = {}
    for name in expected:
        pth = os.path.join(hooks_dir, name)
        exists = name in present and os.path.exists(pth)
        executable, content = False, ""
        if exists:
            executable = os.access(pth, os.X_OK)
            try:
                with open(pth, encoding="utf-8") as fh:
                    content = fh.read()
            except OSError:
                content = ""
        rec = {"exists": exists, "executable": executable, "content": content}
        src = source_of.get(name)
        if src:
            sp = src if os.path.isabs(src) else os.path.join(root, *str(src).split("/"))
            try:
                with open(sp, encoding="utf-8") as fh:
                    rec["source"] = fh.read()
            except OSError:
                rec["source"] = None      # 읽기 실패 — 코어가 "확인 못 함"으로 계상한다
        installed[name] = rec

    findings = hook_findings(expected, installed)
    rel = hooks_dir.replace(root + "/", "")
    judged(len(findings))
    print(f"훅 배선 게이트(hooksInstalledPolicy={policy}): 선언 {len(expected)}종 · 설치 {len(expected) - len(findings)}종 — {rel}")
    tag = "✗" if hard else "⚠"
    for f in findings:
        hint = _INSTALL_HINT if f["kind"] in ("missing", "stale") else ""
        print(f'  {tag} {f["name"]}: {HOOK_FINDING_TEXT[f["kind"]]}{hint}')
    # 신선도를 판정하지 **않은** 훅을 매 실행 밝힌다 — 안 본 것을 조용히 초록에 합산하지 않는다.
    flagged = {f["name"] for f in findings}
    unjudged = [n for n in expected if not source_of.get(n) and n not in flagged]
    if unjudged:
        print(f'  · 신선도 미판정 {len(unjudged)}종({", ".join(unjudged)}) — hooks.list에 원본 경로가 선언되지 않았다.'
              " 존재·실행권한·킷 마커는 판정했고 **내용 신선도는 보지 않았다**(낡은 사본은 미설치와 동급이다 — 원본 경로를 선언하면 대조한다).")
    if findings and hard:
        print(f"\n✗ hooksInstalledPolicy=hard: 훅 {len(findings)}종이 배선되지 않았다 — 게이트 스크립트가 있어도 발동하지 않으므로 이 상태의 green은 거짓이다.",
              file=sys.stderr)
        sys.exit(1)
    if not findings:
        fresh = len(expected) - len(unjudged)
        extra = f" (그중 {fresh}종은 원본과 내용 일치까지 확인)" if fresh else ""
        print(f"훅 배선 게이트: OK — 선언된 훅이 모두 설치·실행 가능하며 킷 훅이다{extra}.")


def cmd_importwiring(cfg):
    policy = str(cfg.get("importWiringPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ importWiringPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "importWiringPolicy")
        print("배선 무결성 게이트 — importWiringPolicy:off (판정 안 함)")
        return
    gate_dir = os.path.dirname(os.path.abspath(__file__))
    exts = ["." + str(e).lstrip(".") for e in (cfg.get("importWiringExtensions") or DEFAULT_WIRING_EXTENSIONS)]
    try:
        entries = sorted(f for f in os.listdir(gate_dir) if any(f.endswith(e) for e in exts))
    except OSError:
        entries = []
    if not entries:
        verdict("INERT", "모듈 0건 — %s 파일이 없다" % "·".join(exts))
        print("[안 봄(판정 입력 없음)] 배선 무결성 게이트 — 이 디렉터리에 %s 모듈이 없다."
              " Python 런타임 전용 설치라면 정상이다(대조할 import 그래프가 없다) —"
              " **0건은 '깨끗함'이 아니라 '볼 것이 없음'이다**." % "·".join(exts))
        return

    def read(key):
        try:
            return read_text(os.path.join(gate_dir, key))
        except OSError:
            return None

    def resolve(from_key, spec):
        base = os.path.dirname(os.path.join(gate_dir, from_key))
        return os.path.relpath(os.path.normpath(os.path.join(base, spec)), gate_dir)

    res = wiring_findings(entries, read, resolve)
    violations, unchecked = res["violations"], res["unchecked"]
    judged(len(violations) if policy == "hard" else 0)
    miss_file = sum(1 for v in violations if v["kind"] == "missing-file")
    miss_export = sum(1 for v in violations if v["kind"] == "missing-export")
    print(f'배선 무결성 게이트(importWiringPolicy={policy}): 모듈 {len(entries)}종 · 걸어본 {res["walked"]}종'
          f" — 파일 없음 {miss_file} · export 없음 {miss_export} · 확인 못 함 {len(unchecked)}")
    for u in unchecked[:8]:
        print(f'  · [확인 못 함] {u["key"]}: {u["why"]} — 이 대상의 export 집합을 확정할 수 없어 **없다고 단정하지 않는다**')
    if len(unchecked) > 8:
        print(f"  · [확인 못 함] … 외 {len(unchecked) - 8}건")
    if not violations:
        print("  ✓ 로컬 import 전부가 실재하는 파일의 실재하는 export를 가리킨다 — 부분 동기화 0건.")
        return
    lines = [format_wiring_violation(v) for v in violations]
    if policy == "hard":
        print(f"\n✗ 배선이 깨졌다 {len(violations)}건 — 이 게이트들은 판정이 아니라 크래시를 낸다:", file=sys.stderr)
        for l in lines:
            print(f"  ✗ {l}", file=sys.stderr)
        print("\n→ 정본에서 해당 모듈을 다시 복사하라(`prompts/update.md` 2단계 — **게이트가 import하는 모듈까지 전이적으로** diff 대상이다).",
              file=sys.stderr)
        sys.exit(1)
    for l in lines:
        print(f"  ⚠ {l}")
    print("→ 해소는 정본 재복사 하나뿐이다(면제 경로 없음). 깨진 배선은 정책 강도와 무관하게 게이트를 죽인다.")


def cmd_watchdog(cfg):
    root = cfg["__root"]
    policy = str(cfg.get("watchdogPolicy") or "advisory")
    if policy not in ("off", "advisory", "hard"):
        print(f'✗ watchdogPolicy 값 위반 "{policy}" — off|advisory|hard 중 하나(문법화, 정의되지 않은 값 금지)',
              file=sys.stderr)
        sys.exit(1)
    if policy == "off":
        verdict("OFF", "watchdogPolicy")
        print("감시자 게이트 — watchdogPolicy:off (판정 안 함)")
        return
    rel = str(cfg.get("watchdogReceipt") or DEFAULT_WATCHDOG_RECEIPT)
    abs_path = os.path.join(root, *rel.split("/"))
    errors, warnings = [], []

    def block(msg):
        (errors if policy == "hard" else warnings).append(msg)

    ci_globs = [compile_glob(g) for g in (cfg.get("watchdogCiGlobs") or DEFAULT_WATCHDOG_CI_GLOBS)]
    ci_files = []
    for p in walk_all_rel(root, cfg):
        if not any(rx.search(p) for rx in ci_globs):
            continue
        try:
            ci_files.append({"path": p, "text": read_text(os.path.join(root, p))})
        except OSError:
            continue
    ci = ci_wiring(ci_files, cfg.get("sweepInvocationMarkers"))
    if not ci["wired"]:
        block(f'CI에 스윕이 배선되지 않았다(CI 파일 {ci["files"]}건 검사) — **우회 불가한 감시 채널이 없다**.'
              " 로컬 훅은 --no-verify로 우회되고 웹 UI 머지는 훅을 타지 않으며, 게이트 파일은 지워도 아무 일도 일어나지 않는다."
              " 커밋한 사람이 끌 수 없는 것은 서버측 CI뿐이다 — 스윕을 도는 워크플로를 추가하라(sdd-init.sh가 템플릿을 깐다)")
    # **라벨에만 있는 마커는 배선이 아니면서 배선처럼 보인다** — 이 축이 겪은 거짓 초록의 본체다.
    for pth in ci["labelOnly"]:
        block(f"{pth}: 스윕 마커가 **라벨에만** 있다(`name:`·`title:` 등) — 호출이 아니다."
              " 실측: 킷 자신의 워크플로가 `sdd-gates.yml`이고 안에 `name: sdd-gates`가 있어서 이 게이트가"
              ' **자기 파일명에 매치해** 여러 달 "배선돼 있다"고 보고했고, 그 사이 스윕 등재 게이트 9종이'
              " 어떤 우회 불가 층에도 없었다(이 게이트 자신 포함). 그 줄을 실제 호출로 바꿔라")
    # 호출이 있어도 **비-0을 낼 수 없으면** 그것은 채널이 아니라 로그다.
    if ci["wired"] and not ci["blocking"]:
        block(f'CI의 스윕 호출에 `--strict`가 없다({" · ".join(ci["wired"])}) — advisory 발견에서 exit 0으로 끝난다.'
              " **보고하고 통과하는 채널은 채널이 아니라 로그다** — 우회 불가한 자리에서 통과만 하면 우회할 필요도 없다")
    # 스윕 규칙표를 못 찾으면 이 판정은 **하지 않는다**(0종으로 세면 "전부 덮였다"는 거짓 초록이다).
    sync_abs = None
    for rel_c in ([cfg.get("syncRulesFile")] if cfg.get("syncRulesFile") else []) + DEFAULT_SWEEP_SOURCE_CANDIDATES:
        cand = os.path.join(root, *str(rel_c).split("/"))
        if os.path.exists(cand):
            sync_abs = cand
            break
    sweep_gates = None
    if sync_abs:
        try:
            with open(sync_abs, encoding="utf-8") as fh:
                sweep_gates = sweep_gate_files(fh.read())
        except OSError:
            sweep_gates = None
    outside = gates_outside_ci(sweep_gates, [f["text"] for f in ci_files],
                               cfg.get("sweepInvocationMarkers")) if sweep_gates else []
    if not sweep_gates:
        print("· 스윕 규칙표를 찾지 못해 **강제 층 커버리지를 판정하지 않았다** — 통과가 아니다"
              "(`syncRulesFile`로 경로를 선언하면 판정한다)")
    if outside:
        more = " …" if len(outside) > 8 else ""
        block(f'스윕 등재 게이트 {len(outside)}종이 어떤 우회 불가 층에도 없다: {", ".join(outside[:8])}'
              f"{more} — CI가 스윕을 부르지 않고 게이트를 손으로 열거하기 때문이다."
              " 그 게이트들은 **사람이 손으로 스윕을 칠 때만** 돈다. 손목록을 스윕 호출 한 줄로 바꿔라"
              "(목록은 적는 것이 아니라 계산하는 것이다 — 설치기 복사 목록·테스트 픽스처 목록이 이미 같은 드리프트를 냈다)")

    receipt = None
    if not os.path.exists(abs_path):
        block(f'채택 영수증이 없다 — {rel}. "채택했다"는 말이 자기신고로만 존재하면 무엇이 깔렸는지·언제 깔렸는지'
              " 아무도 모르고, 지워진 감시자도 지워진 사실을 알리지 않는다. `sh scripts/sdd-init.sh`가 영수증을 남긴다"
              "(⚠ 영수증은 **커밋한다** — 실행 원장과 달리 이것은 세션 상태가 아니라 채택 선언이다)")
    else:
        receipt, errs = parse_receipt(read_text(abs_path))
        for e in errs:
            block(f"{rel}: {e}")
        if receipt:
            mg = missing_gates(receipt, lambda g: os.path.exists(os.path.join(root, *str(g).split("/"))))
            gone = mg["gone"]
            # 3분류(SPEC-054) — 실재를 확인 못 한 게이트는 "지워졌다"가 아니다(차단하지 않고 표면화).
            for g in mg["unchecked"]:
                warnings.append(f"{g} 실재를 확인하지 못했다 — 통과가 아니다(권한·I/O 오류일 수 있다)")
            if gone:
                more = " …" if len(gone) > 6 else ""
                block(f'영수증이 선언한 게이트 {len(gone)}건이 지금 없다: {", ".join(gone[:6])}{more}'
                      " — 감시자가 지워졌는데 아무도 알리지 않았다(지워진 강제는 강제가 아니다)")

    judged(len(errors))
    if receipt:
        stamp = f'채택 {receipt["installedAt"] or "(시점 미기록)"}'
        if receipt["kitCommit"]:
            stamp += f' · 킷 {receipt["kitCommit"][:10]}'
        stamp += f' · 게이트 {len(receipt["gates"])}종'
        if receipt["gate"]:
            stamp += f' · 런타임 {receipt["gate"]}'
    else:
        stamp = "영수증 없음"
    tail = f' ({", ".join(ci["wired"][:3])})' if ci["wired"] else ""
    print(f'감시자 게이트(watchdogPolicy={policy}): {stamp} · CI 배선 {len(ci["wired"])}/{ci["files"]}건{tail}')
    if receipt:
        print("  · 킷 최신화는 prompts/update.md 절차로 한다 — 위 채택 시점이 오래됐다면 그것이 신호다(게이트는 상류를 모른다).")
    for w in warnings:
        print(f"  ⚠ {w}")
    if errors:
        print(f"\n✗ 감시자가 실재하지 않는다 {len(errors)}건:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    if not warnings:
        print("  ✓ 우회 불가한 채널(CI)에 스윕이 배선돼 있고 채택 영수증이 실재한다.")


def main():
    args = sys.argv[1:]
    if not args:
        print(USAGE, file=sys.stderr)
        sys.exit(2)
    sub = args[0]
    strict = "--strict" in args
    # 실패 원장의 gate 식별자에 쓴다 — Python은 단일 파일이라 서브커맨드 없이는 모든 판정이
    # "sdd_gates.py"로 뭉개져 (gate,class) 에스컬레이션이 Node판만큼 구체적이지 못하다.
    global _CURRENT_SUB
    _CURRENT_SUB = sub
    # 판정 타입 방출(SPEC-040) — 어떤 종료 경로로 끝나든 한 줄. 선언 안 하면 UNTYPED로 자백된다.
    # Node판 게이트는 파일마다 armVerdict()를 부르지만 Python판은 단일 엔트리라 여기서 한 번이다.
    # ⚠ **훅 편의 계층은 예외가 아니라 좁힌 계약이다**(SPEC-040): PreToolUse처럼 매 명령에 붙어
    # 도는 계층은 발동 조건이 아니면 아무것도 출력하지 않는 것이 계약이고, 여기에 판정 줄을
    # 강제하면 모든 Bash 명령마다 한 줄이 붙어 소음이 된다 — 소음이 되는 순간 사람이 훅을 끈다.
    # 그래서 Node판의 `armVerdict({quietWhenSilent:true})`와 같은 조건으로만 침묵을 허용한다.
    HOOK_LAYER_SUBS = ("diagnosisguard", "preedit", "riskyaction")
    # preedit은 발동 조건이 아니면 **침묵이 계약**이다(Node판 armVerdict({quietWhenSilent:true}) 미러).
    arm_verdict(quiet_when_silent=(sub == "preedit" or (sub in HOOK_LAYER_SUBS and "--hook" in args)))
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
        brec = None
        if "--record-branch" in args:
            brec = args[args.index("--record-branch") + 1:]
        cmd_verifyrun(cfg, rec, brec)
    elif sub == "sccoverage":
        cmd_sccoverage(cfg)
    elif sub == "introdoc":
        cmd_introdoc(cfg)
    elif sub == "processssot":
        cmd_processssot(cfg)
    elif sub == "watchdog":
        cmd_watchdog(cfg)
    elif sub == "preedit":
        cmd_preedit(cfg, positional, args)
    elif sub == "frplacement":
        cmd_frplacement(cfg, positional + args)
    elif sub == "gateescalation":
        cmd_gateescalation(cfg)
    elif sub == "riskyaction":
        cmd_riskyaction(cfg, args)
    elif sub == "completionsignal":
        cmd_completionsignal(cfg)
    elif sub == "duplicatelogic":
        cmd_duplicatelogic(cfg)
    elif sub == "hooksinstalled":
        cmd_hooksinstalled(cfg)
    elif sub == "importwiring":
        cmd_importwiring(cfg)
    elif sub == "agentwiring":
        cmd_agentwiring(cfg)
    elif sub == "specconflict":
        cmd_specconflict(cfg)
    elif sub == "diagnosisguard":
        cmd_diagnosisguard(cfg, positional + (["--hook"] if "--hook" in args else []))
    else:
        print(f"unknown subcommand: {sub}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    # 실패 원장(SPEC-057) — atexit 콜백은 종료 코드를 받지 못하므로, 이 래퍼가 SystemExit을
    # 가로채 `_EXIT_CODE`를 채운 뒤 그대로 다시 던진다. Node판 `process.on("exit", code => …)`와
    # 구조가 다르지만 효과는 같다: 어떤 cmd_*도 건드리지 않고 모든 게이트가 자동으로 참여한다.
    try:
        main()
    except SystemExit as e:
        _capture_exit_code(e.code)
        raise
    _capture_exit_code(0)
