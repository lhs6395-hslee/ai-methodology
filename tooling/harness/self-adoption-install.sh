#!/bin/sh
# 킷 자기적용 채택 영수증 재생성 (SPEC-048) — 이 레포는 킷의 *원본*이라 소비 프로젝트처럼
# scripts/로 복사하지 않고 tooling/을 직접 스캔한다(self-hooks-install.sh와 같은 이유).
#   sh tooling/harness/self-adoption-install.sh
#
# 실측(2026-08-14): sdd/adoption.json이 kitCommit 37dba3c(2026-08-10)에 멈춰 있었고
# 그 사이 추가된 게이트(check-fr-placement.mjs·check-gate-escalation.mjs·check-risky-action.mjs)가
# 선언에 없었다. R17(check-watchdog)은 "선언된 게이트가 실재하는가"만 보고 "지금 있는 모든
# 게이트가 선언에 있는가"는 안 봐서 이 뒤처짐을 못 잡는다 — 그래서 R17은 계속 초록이었다.
# 소비 프로젝트는 sdd-init.sh 재실행이 이 파일을 자동 갱신하지만, 이 레포엔 scripts/가 없어
# 그 경로를 못 탄다. 이 스크립트가 그 자리를 메운다 — 새 게이트를 추가하면 이것도 같이 돌린다.
set -e
ROOT=$(git rev-parse --show-toplevel) || { echo "self-adoption: git 저장소 아님" >&2; exit 1; }
cd "$ROOT"
RECEIPT="sdd/adoption.json"
KITCOMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
HOOKS=$(git rev-parse --git-path hooks 2>/dev/null || echo ".git/hooks")
{
  echo "{"
  echo "  \"_\": \"SDD 채택 영수증(SPEC-048) — 킷 자기적용판. 소비 프로젝트에서는 sdd-init.sh가 이 파일을 쓴다. **커밋한다**: 세션 상태가 아니라 채택 선언이다. 갱신: sh tooling/harness/self-adoption-install.sh\","
  echo "  \"kitCommit\": \"$KITCOMMIT\","
  echo "  \"installedAt\": \"$NOW\","
  echo "  \"gate\": \"node\","
  echo "  \"gates\": ["
  ( ls tooling | grep -E '^(check|gen)-.*\.mjs$' | sed 's|^|    "tooling/|; s|$|",|' | sed '$ s|,$||' )
  echo "  ],"
  echo "  \"hooks\": ["
  ( ls "$HOOKS" 2>/dev/null | grep -vE '\.sample$' | sed 's|^|    "|; s|$|",|' | sed '$ s|,$||' )
  echo "  ],"
  echo "  \"agentHooks\": ["
  ( grep -vE '^[[:space:]]*(#|$)' tooling/harness/agent-hooks.list 2>/dev/null \
      | awk '{printf "    \"%s %s %s\",\n", $1, $2, $3}' | sed '$ s|,$||' )
  echo "  ],"
  echo "  \"agentSettings\": \"$( [ -f .claude/settings.json ] && echo ".claude/settings.json" || echo "" )\""
  echo "}"
} > "$RECEIPT"
echo "sdd self-adoption 갱신 완료 — $RECEIPT ($(grep -c '"tooling/' "$RECEIPT")종 게이트, kitCommit=${KITCOMMIT:-?})"
