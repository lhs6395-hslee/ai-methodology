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
  go)   say "  → Go 바이너리는 빌드/다운로드: cd $KIT/tooling/go-gate && CGO_ENABLED=0 go build -o \"$T/scripts/sdd-gate\" ."
        say "  ⚠ spec-sync는 Node 필요 — --gate=node 또는 node 설치 후 재실행(ROADMAP 포팅 참조)" ;;
  sh)   copy "$KIT/tooling/sdd_gates.sh" "$T/scripts/sdd_gates.sh"
        say "  ⚠ spec-sync는 Node 필요 — --gate=node 또는 node 설치 후 재실행(ROADMAP 포팅 참조)" ;;
  py)   copy "$KIT/tooling/sdd_gates.py" "$T/scripts/sdd_gates.py"
        # Python판은 spec-first(specsync) 포함 Node 전 게이트 패리티(SPEC-006) — 훅도 배선.
        if [ -d "$T/.git" ]; then
          printf '#!/bin/sh\npython3 scripts/sdd_gates.py fr && python3 scripts/sdd_gates.py ownership\n' > "$T/.git/hooks/pre-commit"
          # merge commit은 skip(§5.6) — harness/commit-msg와 동일 의미론.
          printf '#!/bin/sh\ngit rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && exit 0\npython3 scripts/sdd_gates.py specsync --staged --message-file "$1"\n' > "$T/.git/hooks/commit-msg"
          chmod +x "$T/.git/hooks/pre-commit" "$T/.git/hooks/commit-msg"
          say "  → git pre-commit·commit-msg 훅 연결됨(Python 게이트 — spec-first 포함)"
        fi ;;
  node) for f in sdd-config.mjs check-fr-coverage.mjs check-ownership.mjs sdd-run.mjs \
                 check-converge-drift.mjs check-orphan-surfaces.mjs check-test-adequacy.mjs check-spec-cohesion.mjs check-spec-completeness.mjs \
                 ownership-keys.mjs check-spec-consistency.mjs check-spec-sync.mjs spec-sync-lib.mjs \
                 verification-accounting.mjs lifecycle-lib.mjs \
                 derivation-lib.mjs check-derivation.mjs sdd-smoke-scan.mjs sdd-retag.mjs \
                 prefix-class-lib.mjs grammar-lib.mjs numbering-lib.mjs object-storage-lib.mjs test-domain-lib.mjs relation-lib.mjs drift-lib.mjs; do
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

  # ── hook 세트 배선: 채택 순간 = 상시 강제 궤도 ─────────────────
  copy "$KIT/tooling/harness/sdd-session-context.sh" "$T/scripts/sdd-session-context.sh"
  copy "$KIT/tooling/harness/sdd-edit-check.sh"       "$T/scripts/sdd-edit-check.sh"
  copy "$KIT/tooling/harness/pre-commit"              "$T/scripts/sdd-pre-commit.sh"
  chmod +x "$T/scripts/sdd-session-context.sh" "$T/scripts/sdd-edit-check.sh" "$T/scripts/sdd-pre-commit.sh"

  # git pre-commit 훅 연결 (.git 있을 때만)
  if [ -d "$T/.git" ]; then
    printf '#!/bin/sh\nsh scripts/sdd-pre-commit.sh\n' > "$T/.git/hooks/pre-commit"
    chmod +x "$T/.git/hooks/pre-commit"
    say "  → git pre-commit 훅 연결됨"
  fi

  # commit-msg 훅 + speckit-fix 스킬
  copy "$KIT/tooling/harness/commit-msg" "$T/scripts/sdd-commit-msg.sh"
  mkdir -p "$T/.claude/skills/speckit-fix"
  copy "$KIT/tooling/harness/speckit-fix.SKILL.md" "$T/.claude/skills/speckit-fix/SKILL.md"
  if [ -d "$T/.git" ]; then
    printf '#!/bin/sh\nsh scripts/sdd-commit-msg.sh "$1"\n' > "$T/.git/hooks/commit-msg"
    chmod +x "$T/.git/hooks/commit-msg"
    say "  → git commit-msg 훅 연결됨"
  fi

  # 채택 수명주기 스킬 (start·readopt·update) — 최초 채택/재채택/평상시 동기화 진입점.
  # prompts/의 정본 절차를 일관되게 실행하는 설치형 슬래시 명령(SPEC-005). SSOT는 prompts/.
  for sk in sdd-start sdd-readopt sdd-update; do
    mkdir -p "$T/.claude/skills/$sk"
    copy "$KIT/tooling/harness/$sk.SKILL.md" "$T/.claude/skills/$sk/SKILL.md"
  done
  say "  → 수명주기 스킬 설치: /sdd-start · /sdd-readopt · /sdd-update"

  # package.json 있으면 check:spec-sync 스크립트 병합(node로 — jq 불요, 기존 보존)
  if [ -f "$T/package.json" ]; then
    node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));p.scripts=p.scripts||{};p.scripts["check:spec-sync"]=p.scripts["check:spec-sync"]||"node scripts/check-spec-sync.mjs";fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+"\n");' "$T/package.json"
    say "  → package.json check:spec-sync 스크립트 추가"
  fi

  # .claude/settings.json 병합 — 기존 hooks 보존; jq 있으면 merge, 없으면 신규 생성
  mkdir -p "$T/.claude"
  SETTINGS="$T/.claude/settings.json"
  NEW_HOOKS='{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"sh scripts/sdd-session-context.sh"}]}],"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"sh scripts/sdd-edit-check.sh"}]}]}}'
  if [ -f "$SETTINGS" ]; then
    if command -v jq >/dev/null 2>&1; then
      # jq merge — 기존 SDD hook 항목 제거 후 신규 추가(idempotency 보장)
      # select로 sdd-session-context / sdd-edit-check 포함 엔트리를 걷어낸 뒤 concat
      tmp=$(mktemp)
      jq -s '
        .[0] as $old | .[1] as $new |
        ($old * $new) |
        .hooks.SessionStart = (
          [ ($old.hooks.SessionStart // [])[] | select((.hooks[0].command // "") | test("sdd-session-context") | not) ]
          + ($new.hooks.SessionStart // [])
        ) |
        .hooks.PreToolUse = (
          [ ($old.hooks.PreToolUse // [])[] | select((.hooks[0].command // "") | test("sdd-edit-check") | not) ]
          + ($new.hooks.PreToolUse // [])
        )
      ' "$SETTINGS" - <<_JQ > "$tmp" && mv "$tmp" "$SETTINGS"
$NEW_HOOKS
_JQ
      say "  → .claude/settings.json hooks 병합 완료"
    else
      say "  ⚠ jq 미설치 — 기존 .claude/settings.json 보존(hook 배선 스킵). jq 설치 후 재실행 권장."
      # 기존 파일 보존 — 절대 덮어쓰지 않음
    fi
  else
    printf '%s\n' "$NEW_HOOKS" > "$SETTINGS"
    say "  → .claude/settings.json 생성(hooks 배선)"
  fi
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
