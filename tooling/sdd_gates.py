#!/usr/bin/env python3
# ─── SDD gates (Python 런타임판 — Node 불필요) ────────────────
# Node판(check-fr-coverage.mjs·check-ownership.mjs·sdd-run.mjs)과 **동일 동작**.
# 같은 sdd.config.json을 읽는다. 의존성 0(표준 라이브러리만).
#
# 왜 존재하나: 게이트는 ~150줄 텍스트 파서일 뿐인데, 그걸 돌리려고 Python-only
# 프로젝트에 Node를 강요하면 "런타임을 특정"하는 셈이다. 그래서 가장 흔한 두
# 런타임(Node·Python)으로 동봉한다 — 프로젝트가 이미 가진 쪽을 쓰면 된다.
# (그 외 생태계도 보통 Python/Node 중 하나는 있고, 알고리즘은 DEDUP.md/§4에 명세.)
#
# Usage:
#   python sdd_gates.py fr [--strict]          # FR↔test 추적 게이트
#   python sdd_gates.py ownership [--strict]    # 스펙 간 구조적 중복 게이트
#   python sdd_gates.py run <stage>             # commands.<stage> 실행(언어무관 CI)

import json
import os
import re
import subprocess
import sys

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
    # spec 파일·ID·@covers에서 인정할 ID 접두어(언어중립 추적 닻). 기본 ["SPEC"].
    # 확장 예: ["SPEC","TEST","INFRA"] — 파일명·SPEC_ID·COVERS 정규식이 여기서 파생.
    "specIdPrefixes": ["SPEC"],
    "commands": {},
}


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
    prefixes = cfg.get("specIdPrefixes") or ["SPEC"]
    alt = "|".join(re.sub(r"[^A-Za-z0-9_]", "", p) for p in prefixes)
    cfg["__prefixes"] = prefixes
    cfg["__specId"] = re.compile(rf"(?:{alt})-\d{{3}}")
    cfg["__covers"] = re.compile(rf"@covers\s+((?:{alt})-\d{{3}})/(FR-\d{{3}})")
    return cfg


def resolve(cfg, rel):
    return os.path.join(cfg["__root"], *[p for p in str(rel).split("/") if p])


def is_test_file(name, cfg):
    return any(rx.search(name) for rx in cfg["__testRegex"])


def walk_tests(root, cfg):
    ignore = set(cfg["ignoreDirs"])
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ignore]
        for name in filenames:
            if is_test_file(name, cfg):
                yield os.path.join(dirpath, name)


FR_DECL = re.compile(r"\*\*(FR-\d{3})\*\*")  # FR만 — 접두어 무관
# SPEC_ID/COVERS는 cfg["__specId"]/cfg["__covers"](specIdPrefixes에서 파생)를 쓴다.


def cmd_fr(cfg, strict):
    spec_dir = resolve(cfg, cfg["specDir"])
    root = cfg["__root"]

    specs = {}  # SPEC-ID -> set(FR-ID)
    try:
        spec_files = os.listdir(spec_dir)
    except FileNotFoundError:
        spec_files = []
    prefixes = cfg["__prefixes"]
    for f in spec_files:
        if not (f.endswith(".md") and any(f.startswith(p + "-") for p in prefixes)):
            continue
        m = cfg["__specId"].search(f)
        if not m:
            continue
        text = open(os.path.join(spec_dir, f), encoding="utf-8").read()
        specs[m.group(0)] = set(FR_DECL.findall(text))

    covered = {}  # SPEC-ID -> set(FR-ID)
    bad_refs = []
    for scan in cfg["scanDirs"]:
        for file in walk_tests(resolve(cfg, scan), cfg):
            text = open(file, encoding="utf-8").read()
            for spec, fr in cfg["__covers"].findall(text):
                covered.setdefault(spec, set()).add(fr)
                if spec not in specs or fr not in specs[spec]:
                    bad_refs.append((file, spec, fr))

    errors, warnings = [], []
    for file, spec, fr in bad_refs:
        rel = file.replace(root + os.sep, "")
        errors.append(f"R1 dangling @covers {spec}/{fr} in {rel} — no such FR in {spec}")

    for spec, frs in specs.items():
        cov = covered.get(spec, set())
        if not cov:
            msg = f"{spec}: 0/{len(frs)} FRs covered (not yet implemented)"
            if strict and frs:
                errors.append(f"R2(strict) {msg}")
            else:
                warnings.append(msg)
            continue
        missing = sorted(fr for fr in frs if fr not in cov)
        if missing:
            msg = f"{spec}: {len(cov)}/{len(frs)} FRs covered — missing {', '.join(missing)}"
            (errors if strict else warnings).append(
                f"R2(strict) {msg}" if strict else msg)
        else:
            warnings.append(f"{spec}: {len(cov)}/{len(frs)} FRs covered ✓")

    total_fr = sum(len(s) for s in specs.values())
    total_cov = sum(len(s) for s in covered.values())
    cfg_tag = cfg["__path"].replace(root + os.sep, "") if cfg["__path"] else "defaults(JS/TS)"
    mode = "strict" if strict else "incremental"
    print(f"FR coverage gate — specs:{len(specs)} FRs:{total_fr} covered:{total_cov} mode:{mode} config:{cfg_tag}")
    for w in warnings:
        print(f"  · {w}")
    if errors:
        print("\nFR coverage violations:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        sys.exit(1)
    print("FR coverage gate: OK")


def norm(s):
    return re.sub(r"\s+", " ", s.strip()).lower()


def parse_ownership(text, categories):
    m = re.search(r"^##\s+Ownership", text, re.MULTILINE)
    if not m:
        return None
    body = text[m.start():]
    body = body[body.index("\n") + 1:]
    nxt = re.search(r"^##\s", body, re.MULTILINE)
    block = body[: nxt.start()] if nxt else body
    out = {}
    for cat in categories:
        line = re.search(rf"-\s*\*\*{cat}\*\*\s*:\s*([^\n]+)", block, re.IGNORECASE)
        if line:
            keys = [norm(k) for k in line.group(1).split(",")]
            out[cat] = [k for k in keys if k and k != "—" and k != "[…]" and not k.startswith("[")]
        else:
            out[cat] = []
    return out


def cmd_ownership(cfg, strict):
    spec_dir = resolve(cfg, cfg["specDir"])
    categories = cfg["ownershipCategories"]
    try:
        names = os.listdir(spec_dir)
    except FileNotFoundError:
        print(f"✗ spec 디렉토리를 찾을 수 없음: {spec_dir}", file=sys.stderr)
        sys.exit(1)
    files = [os.path.join(spec_dir, n) for n in names if n.endswith(".md")]

    owners = {c: {} for c in categories}
    missing = []
    declared = 0
    for file in files:
        text = open(file, encoding="utf-8").read()
        m = cfg["__specId"].search(text)
        spec_id = m.group(0) if m else os.path.basename(file)
        own = parse_ownership(text, categories)
        if own is None:
            missing.append(spec_id)
            continue
        declared += 1
        for cat in categories:
            for key in own[cat]:
                owners[cat].setdefault(key, []).append(spec_id)

    conflicts = []
    for cat in categories:
        for key, specs in owners[cat].items():
            if len(specs) > 1:
                conflicts.append((cat, key, sorted(set(specs))))

    print(f"Ownership 게이트: spec {len(files)}개 중 {declared}개가 Ownership 선언.")
    if missing:
        tag = "✗" if strict else "⚠"
        print(f"{tag} Ownership 블록 없음({len(missing)}): {', '.join(missing)}")
    if conflicts:
        print(f"\n✗ 중복 소유(구조적 중복) {len(conflicts)}건:", file=sys.stderr)
        for cat, key, specs in conflicts:
            print(f'  [{cat}] "{key}" ← {" + ".join(specs)}  → 한 spec으로 통합/개정 필요', file=sys.stderr)
        sys.exit(1)
    if strict and missing:
        print("\n✗ --strict: 모든 spec이 Ownership을 선언해야 함.", file=sys.stderr)
        sys.exit(1)
    print(f"✓ 구조적 중복 없음 — 모든 {'/'.join(categories)} 키가 유일.")


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


def main():
    args = sys.argv[1:]
    if not args:
        print("usage: python sdd_gates.py <fr|ownership|run> [...]", file=sys.stderr)
        sys.exit(2)
    sub = args[0]
    strict = "--strict" in args
    cfg = load_config()
    if sub == "fr":
        cmd_fr(cfg, strict)
    elif sub == "ownership":
        cmd_ownership(cfg, strict)
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
