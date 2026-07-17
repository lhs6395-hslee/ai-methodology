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

# pre-commit — spec 품질 게이트(FR↔test·dedup). 경로 필터 없음(감사 P3 — 게이트는 레포 상태
# 전역 스캔이라 매 커밋 실행이 옳다) + change_log.html 자동 재생성(킷 전용).
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
node tooling/check-fr-coverage.mjs || exit 1   # incremental(미커버 warn), PREFIX·번호·Planned모순 exit 1
node tooling/check-ownership.mjs   || exit 1   # dedup·정규화·형식·관계 실재
# change_log.html 자동 갱신 — 방법론이 커밋(=push)될 때마다 변경 로그가 따라오게(사람이 말 안 해도).
# git 이력에서 재생성(직전 커밋까지 반영; 자기 커밋 항목은 다음 커밋에 등장 — 자동 changelog의 본질적 1-커밋 지연).
if [ -f tooling/gen-changelog.mjs ]; then
  node tooling/gen-changelog.mjs >/dev/null 2>&1 && git add change_log.html 2>/dev/null || true
fi
HOOK
# pre-merge-commit(M5) — 무충돌 병합도 같은 품질 게이트(두 브랜치의 번호 중복·ownership 충돌을 병합 시점 차단).
cp .git/hooks/pre-commit .git/hooks/pre-merge-commit

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

chmod +x .git/hooks/pre-commit .git/hooks/pre-merge-commit .git/hooks/commit-msg .git/hooks/pre-push
echo "sdd self-hooks 설치 완료 — pre-commit·pre-merge-commit(품질)·commit-msg(spec-first)·pre-push(sync), tooling/ 직접 호출."
