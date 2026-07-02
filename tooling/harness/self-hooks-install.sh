#!/bin/sh
# 키트 자기 훅 배선 (self-hosting) — 이 레포는 방법론 키트의 *원본*이라
# 소비 프로젝트처럼 scripts/로 복사하지 않고 tooling/의 게이트를 **직접 호출**한다.
# (소비 프로젝트: sdd-init가 scripts/ + .claude/settings.json으로 배선. 여기: 원본 직접.)
# .git/hooks는 비추적이므로 이 추적 스크립트를 한 번 실행해 배선한다.
#   sh tooling/harness/self-hooks-install.sh
set -e
ROOT=$(git rev-parse --show-toplevel) || { echo "self-hooks: git 저장소 아님" >&2; exit 1; }
cd "$ROOT"
mkdir -p .git/hooks

# pre-commit — spec 품질 게이트(FR↔test·dedup). tooling/ 또는 spec 변경 시.
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
STAGED=$(git diff --cached --name-only)
if printf '%s' "$STAGED" | grep -qE '(^|/)(sdd/specs/|tooling/)'; then
  node tooling/check-fr-coverage.mjs || exit 1   # incremental(미커버 warn), PREFIX 위반 exit 1
  node tooling/check-ownership.mjs   || exit 1   # dedup·정규화·형식
fi
HOOK

# commit-msg — spec-first 강제(소유 tooling 변경에 스펙 동반). merge는 skip.
cat > .git/hooks/commit-msg <<'HOOK'
#!/bin/sh
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && { echo "self commit-msg: merge skip" >&2; exit 0; }
node tooling/check-spec-sync.mjs --staged --message-file "$1"
HOOK

# pre-push — 상시 sync 집계(advisory).
cat > .git/hooks/pre-push <<'HOOK'
#!/bin/sh
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
node tooling/sdd-sync.mjs || true
HOOK

chmod +x .git/hooks/pre-commit .git/hooks/commit-msg .git/hooks/pre-push
echo "sdd self-hooks 설치 완료 — pre-commit(품질)·commit-msg(spec-first)·pre-push(sync), tooling/ 직접 호출."
