#!/bin/sh
# PostToolUse(Bash) hook — out-of-band 배포 감지(비차단, SPEC-035).
# stdin: {"tool_name":"Bash","tool_input":{"command":"kubectl apply -f k8s/x.yaml"}}
#
# 왜 PostToolUse인가: 이 궤도는 "배포가 커밋보다 먼저"라 commit-msg 훅만으로는 커밋을 미루는 동안
# 아무 신호가 없다. 배포 직후 상기시켜 spec Change Log를 **커밋 전에** 착지시킨다.
# node·스크립트가 없으면 조용히 건너뛴다(이식성 — 강제는 commit-msg·CI가 계속 담당).
INPUT=$(cat)
if command -v node >/dev/null 2>&1 && [ -f scripts/check-deploy-guard.mjs ]; then
  printf '%s' "$INPUT" | node scripts/check-deploy-guard.mjs 2>/dev/null || true
fi
exit 0
