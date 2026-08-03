#!/bin/sh
# PreToolUse(Bash) hook — 배포 전제 조건 판정(SPEC-035 FR-006).
# stdin: {"tool_name":"Bash","tool_input":{"command":"terraform apply -var-file=x.tfvars"}}
#
# 왜 PreToolUse인가: 스펙 드리프트는 사후 상기가 맞지만(되돌릴 수 없는 것을 막는 척하지 않는다),
# **전제 조건은 배포 전에 알 수 있다** — 미커밋 트리·upstream 뒤처짐은 순수 git 조회다.
# 막을 수 있는 것을 사후로 미루면 그냥 늦는 것이고, 실측에서 사후 상기는 같은 세션의
# 두 번째 apply도 막지 못했다.
#
# ⚠ 종료 코드를 **삼키지 않는다**(PostToolUse 래퍼와 다른 점) — hard일 때 exit 2가 도구 실행을
# 막는 유일한 신호다. node·스크립트가 없으면 조용히 통과한다(이식성).
INPUT=$(cat)
if command -v node >/dev/null 2>&1 && [ -f scripts/check-deploy-precheck.mjs ]; then
  printf '%s' "$INPUT" | node scripts/check-deploy-precheck.mjs
  exit $?
fi
exit 0
