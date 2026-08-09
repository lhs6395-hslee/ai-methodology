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
# sdd-managed-hook — 이 마커로 check-hooks-installed가 '킷 훅인가'를 판정한다(남의 훅 점유 감지).
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
node tooling/check-fr-coverage.mjs || exit 1   # incremental(미커버 warn), PREFIX·번호·Planned모순 exit 1
node tooling/check-ownership.mjs   || exit 1   # exit 1 = 중복소유(dedup)·관계 실재·entityRegistry·정책 enum (+귀속/백킹이 hard일 때); 키 형식·블록 부재는 ⚠ warn(--strict 미사용)
node tooling/check-deploy-debt.mjs || exit 1   # outOfBandDeployPolicy=hard일 때만 발화 — 미기록 배포 부채가 남아 있으면 커밋 차단(그 외엔 즉시 exit 0)
# 검증 실행 기록(SPEC-041) — 로컬 pre-commit이 스위트를 돌리지는 않지만(runTestsPolicy는 pre-push),
# CI가 남긴 원장이 로컬에 없으면 R14가 전 자산을 "기록 없음"으로 센다. 로컬 스윕의 판정 입력을
# 만들기 위해 pre-push에서 스위트가 green이면 그때 기록한다(아래 pre-push 참조).
# change_log.html 자동 갱신 — 방법론이 커밋(=push)될 때마다 변경 로그가 따라오게(사람이 말 안 해도).
# git 이력에서 재생성(직전 커밋까지 반영; 자기 커밋 항목은 다음 커밋에 등장 — 자동 changelog의 본질적 1-커밋 지연).
if [ -f tooling/gen-changelog.mjs ]; then
  node tooling/gen-changelog.mjs >/dev/null 2>&1 && git add docs/change_log.html 2>/dev/null || true
fi
HOOK
# pre-merge-commit(M5) — 무충돌 병합도 같은 품질 게이트(두 브랜치의 번호 중복·ownership 충돌을 병합 시점 차단).
cp .git/hooks/pre-commit .git/hooks/pre-merge-commit

# commit-msg — spec-first 강제(소유 tooling 변경에 스펙 동반). merge는 skip.
cat > .git/hooks/commit-msg <<'HOOK'
#!/bin/sh
# sdd-managed-hook
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && { echo "self commit-msg: merge skip" >&2; exit 0; }
node tooling/check-spec-sync.mjs --staged --message-file "$1"
HOOK

# pre-push — 상시 sync 집계(advisory).
cat > .git/hooks/pre-push <<'HOOK'
#!/bin/sh
# sdd-managed-hook
DIR=$(git rev-parse --show-toplevel) || exit 1
cd "$DIR"
# --hook: config의 syncHookRules로 무거운 규칙을 선언적으로 위임(위임처는 syncHookDelegatedTo).
# --budget: 안전망 — 초과분은 조용히 통과가 아니라 "미판정"으로 표면화된다.
# 훅이 몇 초를 넘기면 사람이 --no-verify로 우회하고, 그 순간 훅 전체가 무의미해진다.
node tooling/sdd-sync.mjs --hook --budget "${SDD_SYNC_BUDGET_MS:-15000}" || true
HOOK

chmod +x .git/hooks/pre-commit .git/hooks/pre-merge-commit .git/hooks/commit-msg .git/hooks/pre-push

# 자기검증 — 선언 집합(hooks.list)을 실제로 다 깔았는지 설치기 스스로 확인한다.
# 개별 파일 하드코딩만 있으면 훅을 추가해도 설치기가 뒤처져 "설치 안 됐는데 아무도 모르는" 상태가 된다.
LIST=tooling/harness/hooks.list
MISSING=""
if [ -f "$LIST" ]; then
  while IFS= read -r line; do
    name=$(printf '%s' "$line" | sed 's/#.*//' | tr -d '[:space:]')
    [ -z "$name" ] && continue
    if [ ! -x ".git/hooks/$name" ]; then MISSING="$MISSING $name"; fi
  done < "$LIST"
fi
if [ -n "$MISSING" ]; then
  echo "✗ self-hooks: 선언됐지만 설치되지 않은 훅 —$MISSING (설치기와 hooks.list가 어긋났다)" >&2
  exit 1
fi
echo "sdd self-hooks 설치 완료 — pre-commit·pre-merge-commit(품질)·commit-msg(spec-first)·pre-push(sync), tooling/ 직접 호출."
echo "  자기검증 통과: hooks.list 선언 집합 전체가 설치·실행 가능."
