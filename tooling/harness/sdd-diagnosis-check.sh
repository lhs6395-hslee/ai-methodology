#!/bin/sh
# PreToolUse hook — **조사 전에 명세를 보게 한다**(SPEC-053).
# stdin: {"tool_name":"Bash","tool_input":{"command":"..."}}
#
# 이 층이 필요한 이유: "조사 전에 명세를 읽었는가"는 정적으로 판정되지 않고, **조회는 커밋도
# 파일 변경도 남기지 않는다** — 커밋 시점 게이트는 원리상 이 행동을 볼 수 없다. 유일하게
# 결정적인 지점이 도구 호출 직전이다.
# exit 0 = 통과·노출 / exit 2 = 금지된 조회 차단(PreToolUse 규약: 비-0이 도구 실행을 막는다).
INPUT=$(cat)
GATE=scripts/check-diagnosis-guard.mjs
[ -f "$GATE" ] || GATE=tooling/check-diagnosis-guard.mjs   # 킷 자기적용 경로

# node·게이트가 없으면 **조용히 통과시키지 않는다** — "검사 못 함"과 "통과"는 다른 사실이다.
if ! command -v node >/dev/null 2>&1 || [ ! -f "$GATE" ]; then
  echo "[SDD 진단 가드] 검사 못 함 — $( command -v node >/dev/null 2>&1 || echo 'node 없음'; [ -f "$GATE" ] || echo '게이트 없음' ). 통과가 아니다."
  exit 0
fi
printf '%s' "$INPUT" | node "$GATE" --hook
exit $?
