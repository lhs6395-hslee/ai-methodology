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
warn(){ printf '%s\n' "$1" >&2; }   # 경고는 stderr — 조용한 스킵 금지
GITWARN=0                            # .git 부재로 훅 배선을 건너뛰면 1 (완료 안내에서 재요약)
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

# ── 1b. 훅 디렉토리 해석 — **git에게 묻는다**(문자열로 가정하지 않는다) ──────
# 실측 제보(2026-08-10): 이전 판은 `[ -d "$T/.git" ]`로 가드하고 `$T/.git/hooks`에 직접 썼다.
# **git worktree에서 `.git`은 파일이다** — 그래서 가드가 실패하고 훅 배선이 통째로 스킵됐다.
# 그 스킵이 best-effort 경고였기 때문에 도입 프로젝트는 commit-msg·pre-commit·pre-push가
# **한 번도 발동한 적이 없는 상태로 몇 달을 갔고**, 그날의 모든 커밋이 게이트를 우회했다.
# `rev-parse --git-path hooks`는 worktree(공통 디렉토리의 hooks)와 `core.hooksPath`를 한 번에
# 해결한다. 그리고 **설치 0건을 조용히 넘기지 않는다** — 아래 2e가 실측으로 확인하고 실패시킨다.
HOOKS_DIR=$(git -C "$T" rev-parse --git-path hooks 2>/dev/null || echo "")
case "$HOOKS_DIR" in
  "") ;;                                  # git 저장소가 아니다
  /*) ;;                                  # 절대경로 — 그대로 쓴다
  *)  HOOKS_DIR="$T/$HOOKS_DIR" ;;        # $T 기준 상대경로
esac
if [ -n "$HOOKS_DIR" ]; then
  mkdir -p "$HOOKS_DIR" 2>/dev/null || HOOKS_DIR=""
fi
if [ -n "$HOOKS_DIR" ]; then
  say "· 훅 디렉토리: $HOOKS_DIR (git rev-parse --git-path hooks — worktree·core.hooksPath 해결)"
fi

# ── 2. 게이트 런타임 (택1, 출력 동일) ────────────────────────
case "$GATE" in
  go)   say "  → Go 바이너리는 빌드/다운로드: cd $KIT/tooling/go-gate && CGO_ENABLED=0 go build -o \"$T/scripts/sdd-gate\" ."
        say "  ⚠ spec-sync는 Node 필요 — --gate=node 또는 node 설치 후 재실행(ROADMAP 포팅 참조)"
        # 감사 P3: go는 바이너리를 이 시점에 확보 못 해 훅을 못 건다 — "채택=상시 강제"가 꺼진
        # 상태임을 조용히 넘기지 않고 명시(경고는 stderr). 바이너리 배치 후 아래 한 줄로 수동 배선.
        warn "  ⚠ 강제 훅 미배선(go) — 바이너리 배치 후: printf '#!/bin/sh\\nscripts/sdd-gate fr && scripts/sdd-gate ownership\\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit (pre-merge-commit도 동일)"; GITWARN=1 ;;
  sh)   copy "$KIT/tooling/sdd_gates.sh" "$T/scripts/sdd_gates.sh"
        say "  ⚠ spec-sync는 Node 필요 — --gate=node 또는 node 설치 후 재실행(ROADMAP 포팅 참조)"
        # 감사 P3: 셸판도 fr·ownership 훅은 배선 가능 — 기본 경로(--gate=sh)가 "채택=상시 강제"
        # 주장과 어긋나게 훅 0개로 끝나던 결함 봉합. pre-merge-commit(M5): merge commit에도 동일
        # 게이트(번호 중복·ownership — 두 브랜치가 같은 번호를 집는 경쟁을 병합 시점에 차단).
        if [ -n "$HOOKS_DIR" ]; then
          printf '#!/bin/sh\n# sdd-managed-hook\nsh scripts/sdd_gates.sh fr && sh scripts/sdd_gates.sh ownership\n' > "$HOOKS_DIR/pre-commit"
          cp "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-merge-commit"
          chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-merge-commit"
          say "  → git pre-commit·pre-merge-commit 훅 연결됨(셸 게이트 — fr·ownership)"
        else
          warn "  ⚠ git 저장소 아님(또는 훅 경로 해석 실패) — pre-commit 훅 배선 스킵. \`git init\` 후 \`sdd-init.sh --gate=sh --force\` 재실행 필요(강제 궤도 미배선 상태)"; GITWARN=1
        fi ;;
  py)   copy "$KIT/tooling/sdd_gates.py" "$T/scripts/sdd_gates.py"
        # Python판은 spec-first(specsync) 포함 Node 전 게이트 패리티(SPEC-006) — 훅도 배선.
        if [ -n "$HOOKS_DIR" ]; then
          printf '#!/bin/sh\n# sdd-managed-hook\npython3 scripts/sdd_gates.py fr && python3 scripts/sdd_gates.py ownership\n' > "$HOOKS_DIR/pre-commit"
          # pre-merge-commit(M5): merge commit에도 fr·ownership — 병합 시점 번호 경쟁 차단.
          cp "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-merge-commit"
          # merge commit은 skip(§5.6) — harness/commit-msg와 동일 의미론.
          printf '#!/bin/sh\n# sdd-managed-hook\ngit rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && exit 0\npython3 scripts/sdd_gates.py specsync --staged --message-file "$1"\n' > "$HOOKS_DIR/commit-msg"
          chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-merge-commit" "$HOOKS_DIR/commit-msg"
          say "  → git pre-commit·pre-merge-commit·commit-msg 훅 연결됨(Python 게이트 — spec-first 포함)"
        else
          warn "  ⚠ git 저장소 아님(또는 훅 경로 해석 실패) — pre-commit/commit-msg 훅 배선 스킵. \`git init\` 후 \`sdd-init.sh --gate=py --force\` 재실행 필요(강제 궤도 미배선 상태)"; GITWARN=1
        fi ;;
  node) for f in sdd-config.mjs check-fr-coverage.mjs check-ownership.mjs sdd-run.mjs \
                 check-converge-drift.mjs check-orphan-surfaces.mjs check-test-adequacy.mjs check-spec-cohesion.mjs check-spec-completeness.mjs \
                 ownership-keys.mjs check-spec-consistency.mjs check-spec-sync.mjs spec-sync-lib.mjs \
                 verification-accounting.mjs lifecycle-lib.mjs \
                 derivation-lib.mjs check-derivation.mjs sdd-smoke-scan.mjs sdd-retag.mjs \
                 prefix-class-lib.mjs grammar-lib.mjs numbering-lib.mjs changelog-fr-lib.mjs covers-backlink-lib.mjs duplicate-logic-lib.mjs check-duplicate-logic.mjs key-anchor-lib.mjs capability-ownership-lib.mjs schema-backing-lib.mjs object-storage-lib.mjs term-coverage-lib.mjs external-target-lib.mjs evidence-scope-lib.mjs test-domain-lib.mjs relation-lib.mjs drift-lib.mjs cross-spec-lib.mjs check-test-run.mjs check-schema-drift.mjs schema-drift-lib.mjs sdd-retire.mjs retire-lib.mjs policy-ratchet-lib.mjs check-policy-ratchet.mjs \
                 verdict-lib.mjs verification-run-lib.mjs check-verification-executed.mjs gen-ownership-map.mjs ownership-reality-lib.mjs engine-event-lib.mjs check-engine-event.mjs evidence-lib.mjs check-evidence.mjs live-reality-lib.mjs check-live-reality.mjs check-pre-edit.mjs synonym-lib.mjs check-synonym.mjs sc-coverage-lib.mjs check-sc-coverage.mjs deploy-guard-lib.mjs check-deploy-guard.mjs check-deploy-debt.mjs check-deploy-precheck.mjs hooks-install-lib.mjs check-hooks-installed.mjs intro-doc-lib.mjs check-intro-doc.mjs impl-reference-lib.mjs process-ssot-lib.mjs check-process-ssot.mjs watchdog-lib.mjs check-watchdog.mjs branch-observation-lib.mjs; do
          copy "$KIT/tooling/$f" "$T/scripts/$f"; done ;;
  *) echo "✗ --gate 는 go|sh|py|node" >&2; exit 2 ;;
esac

# ── 2c. 에이전트 컨텍스트 주입 (Claude 외 — Kiro·Codex 등) ─────
# 방법론 상시 로드 문서를 비-Claude 에이전트용으로 배선한다(Claude는 SessionStart hook이 담당 — SPEC-004).
# 게이트 무관(순수 마크다운) — 어느 에이전트/무-에이전트에서도 같은 궤도를 보장.
copy "$KIT/tooling/harness/agent-context.md" "$T/.kiro/steering/sdd.md"   # Kiro steering(기본 always-include)
AG="$T/AGENTS.md"                                                          # Codex 등 상시 로드 규칙 파일
if [ ! -e "$AG" ]; then
  cp "$KIT/tooling/harness/agent-context.md" "$AG"; say "+ AGENTS.md (SDD 컨텍스트)"
elif grep -q 'SDD:BEGIN' "$AG" 2>/dev/null; then
  say "· 유지(이미 SDD 블록): AGENTS.md"                                   # idempotent — 재실행 중복 방지
else
  { printf '\n'; cat "$KIT/tooling/harness/agent-context.md"; } >> "$AG"; say "+ AGENTS.md에 SDD 컨텍스트 블록 추가(기존 내용 보존)"
fi

# ── 2b. 하네스 (선택) — 인터랙티브 spec↔code sync (Claude Code 1차) ──
# 하네스 detector는 Node 게이트를 쓰므로 --gate=node 일 때만 설치.
if [ "$GATE" = "node" ]; then
  copy "$KIT/tooling/sdd-sync.mjs"               "$T/scripts/sdd-sync.mjs"
  copy "$KIT/tooling/harness/sdd-sync.SKILL.md"  "$T/.claude/skills/sdd-sync/SKILL.md"
  copy "$KIT/tooling/harness/pre-push"           "$T/scripts/sdd-pre-push.sh"
  say "  → pre-push는 아래 훅 배선 단계에서 설치된다(선택 아님 — 미설치면 R4 sync가 한 번도 안 돈다)"
  say "  → 계약: $KIT/HARNESS.md  · 스킬: /sdd-sync"

  # ── hook 세트 배선: 채택 순간 = 상시 강제 궤도 ─────────────────
  copy "$KIT/tooling/harness/sdd-session-context.sh" "$T/scripts/sdd-session-context.sh"
  copy "$KIT/tooling/harness/sdd-edit-check.sh"       "$T/scripts/sdd-edit-check.sh"
  copy "$KIT/tooling/harness/sdd-deploy-check.sh"     "$T/scripts/sdd-deploy-check.sh"
  copy "$KIT/tooling/harness/sdd-deploy-precheck.sh"  "$T/scripts/sdd-deploy-precheck.sh"
  copy "$KIT/tooling/harness/hooks.list"              "$T/scripts/hooks.list"
  copy "$KIT/tooling/harness/pre-commit"              "$T/scripts/sdd-pre-commit.sh"
  # 배포 부채 파일은 **로컬 세션 기억 장치**다(SPEC-035) — 커밋 대상이 아니다.
  # 추적되면 부채가 팀 diff에 섞이고, 더 나쁘게는 "커밋해서 없앤다"가 갚는 방법이 된다.
  if [ -f "$T/.gitignore" ] && ! grep -qx '\.sdd/' "$T/.gitignore"; then
    printf '\n# SDD 로컬 세션 상태(배포 부채 등) — 커밋 대상 아님\n.sdd/\n' >> "$T/.gitignore"
    say "  → .gitignore에 .sdd/ 추가(배포 부채 파일)"
  fi
  chmod +x "$T/scripts/sdd-session-context.sh" "$T/scripts/sdd-edit-check.sh" "$T/scripts/sdd-deploy-check.sh" "$T/scripts/sdd-deploy-precheck.sh" "$T/scripts/sdd-pre-commit.sh"

  # git pre-commit + pre-merge-commit 훅 연결 (.git 있을 때만).
  # pre-merge-commit(M5): 무충돌 git merge는 pre-commit을 타지 않는다 — 두 브랜치가 각자 같은
  # 스펙 번호(SPEC-014 중복)나 같은 ownership 키를 들고 깨끗이 병합돼 main이 사후 red가 되던
  # 경쟁을 병합 시점에 차단(같은 게이트 재사용).
  if [ -n "$HOOKS_DIR" ]; then
    printf '#!/bin/sh\n# sdd-managed-hook\nsh scripts/sdd-pre-commit.sh\n' > "$HOOKS_DIR/pre-commit"
    cp "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-merge-commit"
    # pre-push는 선택이 아니다 — 미설치면 R4 sync가 한 번도 안 돈다(설치 안 된 것을 green으로 읽지 않기 위해
    # check-hooks-installed가 hooks.list 전체를 검사한다). 훅은 --hook·--budget으로 수 초 내 끝난다.
    printf '#!/bin/sh\n# sdd-managed-hook\nsh scripts/sdd-pre-push.sh\n' > "$HOOKS_DIR/pre-push"
    chmod +x "$HOOKS_DIR/pre-push"
    chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-merge-commit"
    say "  → git pre-commit·pre-merge-commit 훅 연결됨"
  else
    warn "  ⚠ git 저장소 아님(또는 훅 경로 해석 실패) — pre-commit 훅 배선 스킵. \`git init\` 후 \`sdd-init.sh --gate=node --force\` 재실행 필요"; GITWARN=1
  fi

  # commit-msg 훅 + speckit-fix 스킬
  copy "$KIT/tooling/harness/commit-msg" "$T/scripts/sdd-commit-msg.sh"
  mkdir -p "$T/.claude/skills/speckit-fix"
  copy "$KIT/tooling/harness/speckit-fix.SKILL.md" "$T/.claude/skills/speckit-fix/SKILL.md"
  if [ -n "$HOOKS_DIR" ]; then
    printf '#!/bin/sh\nsh scripts/sdd-commit-msg.sh "$1"\n' > "$HOOKS_DIR/commit-msg"
    chmod +x "$HOOKS_DIR/commit-msg"
    say "  → git commit-msg 훅 연결됨"
  else
    warn "  ⚠ git 저장소 아님(또는 훅 경로 해석 실패) — commit-msg(spec-first) 훅 배선 스킵. \`git init\` 후 \`sdd-init.sh --gate=node --force\` 재실행 필요"; GITWARN=1
  fi

  # 채택 수명주기 스킬 (start·readopt·update) — 최초 채택/재채택/평상시 동기화 진입점.
  # prompts/의 정본 절차를 일관되게 실행하는 설치형 슬래시 명령(SPEC-005). SSOT는 prompts/.
  for sk in sdd-start sdd-readopt sdd-update sdd-migrate; do
    mkdir -p "$T/.claude/skills/$sk"
    copy "$KIT/tooling/harness/$sk.SKILL.md" "$T/.claude/skills/$sk/SKILL.md"
  done
  say "  → 수명주기 스킬 설치: /sdd-start · /sdd-readopt · /sdd-update · /sdd-migrate"

  # package.json 있으면 check:spec-sync 스크립트 병합(node로 — jq 불요, 기존 보존)
  if [ -f "$T/package.json" ]; then
    node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));p.scripts=p.scripts||{};p.scripts["check:spec-sync"]=p.scripts["check:spec-sync"]||"node scripts/check-spec-sync.mjs";fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+"\n");' "$T/package.json"
    say "  → package.json check:spec-sync 스크립트 추가"
  fi

  # .claude/settings.json 병합 — 기존 hooks 보존; jq 있으면 merge, 없으면 신규 생성
  mkdir -p "$T/.claude"
  SETTINGS="$T/.claude/settings.json"
  NEW_HOOKS='{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"sh scripts/sdd-session-context.sh"}]}],"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"sh scripts/sdd-edit-check.sh"}]},{"matcher":"Bash","hooks":[{"type":"command","command":"sh scripts/sdd-deploy-precheck.sh"}]}],"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"sh scripts/sdd-deploy-check.sh"}]}]}}'
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
          [ ($old.hooks.PreToolUse // [])[] | select((.hooks[0].command // "") | test("sdd-edit-check|sdd-deploy-precheck") | not) ]
          + ($new.hooks.PreToolUse // [])
        ) |
        .hooks.PostToolUse = (
          [ ($old.hooks.PostToolUse // [])[] | select((.hooks[0].command // "") | test("sdd-deploy-check") | not) ]
          + ($new.hooks.PostToolUse // [])
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

# ── 2e. 배선 실측 — **설치 0건을 조용히 넘기지 않는다** ──────────────────
# best-effort 침묵이 워크트리 결함을 몇 달간 가렸다(실측 제보). 설치했다고 말한 뒤 실제로 그
# 자리에 실행 가능한 훅이 있는지 **세어서** 알린다. 0건이면 그것은 "채택했지만 강제는 꺼진"
# 상태이고, 그 사실은 경고가 아니라 **실패**로 말해야 한다 — 조용한 0건이 이 결함의 본체다.
if [ -n "$HOOKS_DIR" ]; then
  WIRED=0
  for h in pre-commit pre-merge-commit commit-msg pre-push; do
    if [ -x "$HOOKS_DIR/$h" ] && grep -q 'sdd-managed-hook\|sdd-pre-commit\|sdd-commit-msg\|sdd-pre-push\|sdd_gates\|sdd-gate' "$HOOKS_DIR/$h" 2>/dev/null; then
      WIRED=$((WIRED+1))
    fi
  done
  if [ "$WIRED" -eq 0 ]; then
    warn ""
    warn "✗ 훅 배선 0건 — 훅 디렉토리는 찾았는데($HOOKS_DIR) 킷 훅이 하나도 설치되지 않았다."
    warn "  이 상태의 green은 거짓이다: 게이트 스크립트가 다 있어도 아무것도 발동하지 않는다."
    warn "  파일 쓰기 권한·기존 훅 점유를 확인하고 재실행하라. (조용히 넘기지 않는 이유: best-effort"
    warn "   침묵이 워크트리 결함을 몇 달간 가렸다 — 그 사이 모든 커밋이 게이트를 우회했다.)"
    GITWARN=1
  else
    say "· 훅 배선 실측: 킷 훅 ${WIRED}종 설치·실행 가능 확인($HOOKS_DIR)"
  fi
fi

# ── 2d. 감시자 필수 생성 (SPEC-048) ─────────────────────────────
# 오너 실측: **각 프로젝트가 방법론을 무시한다.** 무시는 순환 때문에 안 잡힌다 — 무시하면
# 게이트를 안 돌리고, 그러면 게이트가 무시를 고발할 기회가 없다. 순환을 끊는 것은 우회 불가한
# 채널뿐이고 그건 서버측 CI다(로컬 훅은 --no-verify로 우회되고 웹 UI 머지는 훅을 안 탄다).
# 그래서 채택은 ①CI 워크플로 ②채택 영수증을 **반드시** 남긴다 — 선택 단계가 아니다.
CIDIR="$T/.github/workflows"
CIFILE="$CIDIR/sdd-gates.yml"
if [ -e "$CIFILE" ]; then
  say "· 유지(이미 있음): .github/workflows/sdd-gates.yml"
else
  mkdir -p "$CIDIR"
  # 러너 분기에 맞는 스윕 호출 — 게이트 런타임이 무엇이든 진입점은 하나다.
  case "$GATE" in
    py) SWEEP="python3 scripts/sdd_gates.py fr && python3 scripts/sdd_gates.py ownership" ;;
    *)  SWEEP="node scripts/sdd-sync.mjs --strict" ;;
  esac
  {
    echo "# SDD 강제 궤도 — **우회 불가한 채널**(SPEC-048 R17)."
    echo "# 로컬 훅은 --no-verify로 우회되고 웹 UI 머지는 훅을 아예 타지 않는다."
    echo "# 커밋한 사람이 끌 수 없는 것은 이 워크플로뿐이므로, 이것이 감시자의 본체다."
    echo "name: sdd-gates"
    echo "on: [push, pull_request]"
    echo "jobs:"
    echo "  gates:"
    echo "    runs-on: ubuntu-latest"
    echo "    steps:"
    echo "      - uses: actions/checkout@v4"
    echo "        with: { fetch-depth: 0 }   # spec-sync·래칫이 base와 비교한다"
    echo "      - uses: actions/setup-node@v4"
    echo "        with: { node-version: '20' }"
    echo "      - run: $SWEEP"
  } > "$CIFILE"
  say "+ .github/workflows/sdd-gates.yml (우회 불가한 감시 채널)"
fi

# 채택 영수증 — "채택했다"를 자기신고에서 기계가 읽는 사실로 바꾼다.
# ⚠ `.sdd/`에 두지 않는다: 그쪽은 gitignore라 채택 선언이 체크아웃마다 사라진다.
RECEIPT="$T/sdd/adoption.json"
KITCOMMIT=$(git -C "$KIT" rev-parse HEAD 2>/dev/null || echo "")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
{
  echo "{"
  echo "  \"_\": \"SDD 채택 영수증(SPEC-048) — 설치기가 남긴다. **커밋한다**: 세션 상태가 아니라 채택 선언이다.\","
  echo "  \"kitCommit\": \"$KITCOMMIT\","
  echo "  \"installedAt\": \"$NOW\","
  echo "  \"gate\": \"$GATE\","
  echo "  \"gates\": ["
  ( cd "$T" && ls scripts 2>/dev/null | grep -E '^(check|gen)-' | sed 's|^|    "scripts/|; s|$|",|' | sed '$ s|,$||' )
  echo "  ],"
  echo "  \"hooks\": ["
  ( cd "$T" && ls .git/hooks 2>/dev/null | grep -vE '\.sample$' | sed 's|^|    ".git/hooks/|; s|$|",|' | sed '$ s|,$||' )
  echo "  ]"
  echo "}"
} > "$RECEIPT"
say "+ sdd/adoption.json (채택 영수증 — 커밋하라)"

say ""
say "완료. 고정 레이아웃 생성됨. 다음:"
say "  1) sdd.config.json 언어 맞춤 → $KIT/tooling/sdd.config.presets.md"
say "     (scanDirs·testFileRegex·commands·specIdPrefixes·ownershipCategories — 값만)"
say "  2) Spec Kit init + constitution → $KIT/APPLYING.md §1"
say "  3) 첫 스펙: sdd/specs/SPEC-001-<slug>.md (템플릿: sdd/templates/spec-template.md)"
if [ "$GITWARN" -eq 1 ]; then
  warn ""
  warn "⚠ 중요 — git 훅이 배선되지 않았다(대상에 .git 없음). 강제 궤도(pre-commit·commit-msg)가 꺼진 상태다."
  warn "   해결: \`git init\` → \`sh $KIT/tooling/sdd-init.sh --gate=$GATE --force\` 재실행."
fi
