#!/bin/sh
# ─── sdd-init — 정식 레이아웃 결정적 스캐폴딩 ──────────────────
# 어느 프로젝트에서 돌리든 **동일한 sdd/ 구조 + 동일한 스펙 저장 위치**를 만든다.
# 손 cp 나열은 프로젝트마다 드리프트하므로(게이트 fork·문서 복사·config 누락 사례),
# 이 한 명령으로 "고정 레이아웃"을 보장한다. 언어별로 달라지는 건 sdd.config.json의
# *값*뿐(scanDirs/testFileRegex/commands/specIdPrefixes) — 폴더·파일은 항상 같다.
#
# Usage:  sh <KIT>/tooling/sdd-init.sh [--gate go|sh|py|node] [--force]
#   현재 디렉토리($PWD)를 대상 프로젝트 루트로 본다. 기존 파일은 보존(--force로 덮어씀).
set -eu

GATE=sh; FORCE=0
for a in "$@"; do
  case "$a" in
    --gate=*) GATE=${a#*=} ;;
    --force)  FORCE=1 ;;
    *) echo "unknown arg: $a (usage: --gate=go|sh|py|node [--force])" >&2; exit 2 ;;
  esac
done

SELF=$(cd "$(dirname "$0")" && pwd)
KIT=$(cd "$SELF/.." && pwd)
T="$PWD"
[ "$T" = "$KIT" ] && { echo "✗ 키트 안에서 실행 금지 — 대상 프로젝트 루트에서 실행." >&2; exit 1; }

say(){ printf '%s\n' "$1"; }
copy(){ # $1=src $2=dst : 없을 때만(또는 --force)
  if [ -e "$2" ] && [ "$FORCE" -eq 0 ]; then say "· 유지(이미 있음): ${2#"$T"/}"
  else mkdir -p "$(dirname "$2")"; cp "$1" "$2"; say "+ ${2#"$T"/}"; fi
}

say "SDD 정식 레이아웃 스캐폴딩 → $T   (gate=$GATE)"

# ── 1. 고정 레이아웃 (모든 프로젝트 동일) ────────────────────
mkdir -p "$T/sdd/specs" "$T/sdd/templates" "$T/scripts"
copy "$KIT/tooling/sdd.config.json"  "$T/sdd.config.json"
copy "$KIT/templates/MODULE_MAP.md"  "$T/sdd/MODULE_MAP.md"
copy "$KIT/templates/module-spec.md" "$T/sdd/templates/spec-template.md"

# ── 2. 게이트 런타임 (택1, 출력 동일) ────────────────────────
case "$GATE" in
  go)   say "  → Go 바이너리는 빌드/다운로드: cd $KIT/tooling/go-gate && CGO_ENABLED=0 go build -o \"$T/scripts/sdd-gate\" ." ;;
  sh)   copy "$KIT/tooling/sdd_gates.sh" "$T/scripts/sdd_gates.sh" ;;
  py)   copy "$KIT/tooling/sdd_gates.py" "$T/scripts/sdd_gates.py" ;;
  node) for f in sdd-config.mjs check-fr-coverage.mjs check-ownership.mjs sdd-run.mjs \
                 check-converge-drift.mjs check-orphan-surfaces.mjs check-test-adequacy.mjs check-spec-cohesion.mjs check-spec-completeness.mjs; do
          copy "$KIT/tooling/$f" "$T/scripts/$f"; done ;;
  *) echo "✗ --gate 는 go|sh|py|node" >&2; exit 2 ;;
esac

# ── 2b. 하네스 (선택) — 인터랙티브 spec↔code sync (Claude Code 1차) ──
# 하네스 detector는 Node 게이트를 쓰므로 --gate=node 일 때만 설치.
if [ "$GATE" = "node" ]; then
  copy "$KIT/tooling/sdd-sync.mjs"               "$T/scripts/sdd-sync.mjs"
  copy "$KIT/tooling/harness/sdd-sync.SKILL.md"  "$T/.claude/skills/sdd-sync/SKILL.md"
  copy "$KIT/tooling/harness/pre-push"           "$T/scripts/sdd-pre-push.sh"
  say "  → 하네스 훅 설치(선택): ln -sf ../../scripts/sdd-pre-push.sh .git/hooks/pre-push"
  say "  → 계약: $KIT/HARNESS.md  · 스킬: /sdd-sync"
fi

# ── 3. 방법론 설명서는 복사 안 함 — 키트 참조(드리프트 방지). 포인터만. ──
PTR="$T/sdd/README.md"
if [ ! -e "$PTR" ] || [ "$FORCE" -eq 1 ]; then
  {
    echo "# SDD (이 프로젝트)"
    echo "- 방법론 설명서는 **키트를 참조**(복사 금지): $KIT"
    echo "  (STORAGE.md=저장정의 · METHODOLOGY.md · STRUCTURE.md · DEDUP.md · principles.md)"
    echo "- 저장 SSOT: ../sdd.config.json   · 스펙: sdd/specs/<PREFIX>-NNN-*.md"
    echo "- 새 접두어(FEAT/TEST/INFRA…)는 sdd.config.json의 specIdPrefixes에 **반드시 등록**."
  } > "$PTR"
  say "+ sdd/README.md (키트 참조 포인터)"
fi

say ""
say "완료. 고정 레이아웃 생성됨. 다음:"
say "  1) sdd.config.json 언어 맞춤 → $KIT/tooling/sdd.config.presets.md"
say "     (scanDirs·testFileRegex·commands·specIdPrefixes·ownershipCategories — 값만)"
say "  2) Spec Kit init + constitution → $KIT/APPLYING.md §1"
say "  3) 첫 스펙: sdd/specs/SPEC-001-<slug>.md (템플릿: sdd/templates/spec-template.md)"
