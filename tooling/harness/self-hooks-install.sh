#!/bin/sh
# 키트 자기 훅 배선 (self-hosting) — 이 레포는 방법론 키트의 *원본*이라
# 소비 프로젝트처럼 scripts/로 복사하지 않고 tooling/의 게이트를 **직접 호출**한다.
# (소비 프로젝트: sdd-init가 scripts/ + .claude/settings.json으로 배선. 여기: 원본 직접.)
# 훅 디렉토리는 비추적이므로 이 추적 스크립트를 한 번 실행해 배선한다(경로는 git이 준다 —
# worktree에서 `.git`은 파일이라 문자열 가정이 통째로 실패한다).
#   sh tooling/harness/self-hooks-install.sh
# 훅 본문은 **파일**이다(`self/`) — 이전 판은 설치기 안 heredoc이 정본이라 대조할 원본이 없었고,
# 그래서 R12의 신선도 축이 킷 자신에게는 영구히 "미판정"이었다(자기 축을 자기가 도그푸딩하지 못한 자리).
# 파일로 빼면 hooks.list가 원본 경로를 선언할 수 있고, 낡은 사본이 즉시 `stale`로 잡힌다.
SELF=$(cd "$(dirname "$0")" && pwd)
set -e
ROOT=$(git rev-parse --show-toplevel) || { echo "self-hooks: git 저장소 아님" >&2; exit 1; }
cd "$ROOT"
# 훅 디렉토리는 **git에게 묻는다** — `.git/hooks`를 문자열로 가정하지 않는다.
# 실측 제보(2026-08-10): worktree에서 `.git`은 **파일**이라 `mkdir -p .git/hooks`가 실패하고
# 훅이 통째로 안 깔린다. `--git-dir`도 답이 아니다(워크트리 전용 디렉토리에는 hooks가 없다).
# `rev-parse --git-path hooks`가 worktree와 `core.hooksPath`를 한 번에 해결한다.
HOOKS=$(git rev-parse --git-path hooks) || { echo "self-hooks: 훅 경로 해석 실패" >&2; exit 1; }
mkdir -p "$HOOKS"

# pre-commit — spec 품질 게이트(FR↔test·dedup). 경로 필터 없음(감사 P3 — 게이트는 레포 상태
# 전역 스캔이라 매 커밋 실행이 옳다) + change_log.html 자동 재생성(킷 전용).
cp "$SELF"/self/pre-commit "$HOOKS"/pre-commit
# pre-merge-commit(M5) — 무충돌 병합도 같은 품질 게이트(두 브랜치의 번호 중복·ownership 충돌을 병합 시점 차단).
cp "$HOOKS"/pre-commit "$HOOKS"/pre-merge-commit

# commit-msg — spec-first 강제(소유 tooling 변경에 스펙 동반). merge는 skip.
cp "$SELF"/self/commit-msg "$HOOKS"/commit-msg

# pre-push — 상시 sync 집계(advisory).
cp "$SELF"/self/pre-push "$HOOKS"/pre-push

chmod +x "$HOOKS"/pre-commit "$HOOKS"/pre-merge-commit "$HOOKS"/commit-msg "$HOOKS"/pre-push

# 자기검증 — 선언 집합(hooks.list)을 실제로 다 깔았는지 설치기 스스로 확인한다.
# 개별 파일 하드코딩만 있으면 훅을 추가해도 설치기가 뒤처져 "설치 안 됐는데 아무도 모르는" 상태가 된다.
LIST=tooling/harness/hooks.list
MISSING=""
if [ -f "$LIST" ]; then
  while IFS= read -r line; do
    name=$(printf '%s' "$line" | sed 's/#.*//' | tr -d '[:space:]')
    [ -z "$name" ] && continue
    if [ ! -x "$HOOKS/$name" ]; then MISSING="$MISSING $name"; fi
  done < "$LIST"
fi
if [ -n "$MISSING" ]; then
  echo "✗ self-hooks: 선언됐지만 설치되지 않은 훅 —$MISSING (설치기와 hooks.list가 어긋났다)" >&2
  exit 1
fi
echo "sdd self-hooks 설치 완료 — pre-commit·pre-merge-commit(품질)·commit-msg(spec-first)·pre-push(sync), tooling/ 직접 호출."
echo "  자기검증 통과: hooks.list 선언 집합 전체가 설치·실행 가능 — $HOOKS"
