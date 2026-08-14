#!/bin/sh
# PreToolUse hook — **되돌리기 어려운 행동은 독립 검증 마커 없이 지나가지 않는다**(SPEC-058).
# stdin: {"tool_name":"Bash","tool_input":{"command":"..."}}
#
# 이 층이 필요한 이유: 트래커 상태 전이·배포·파괴적 DB 조작 같은 사고는 **커밋 이전**, 대화 안에서
# 끝난다 — 기존 커밋 게이트는 원리상 관여할 지점이 없다. 유일하게 결정적인 지점이 도구 호출
# 직전이다. 이 게이트는 서브에이전트를 스스로 부르지 않는다 — 차단 메시지가 "확인 후 --record로
# 마커를 남겨라"를 지시할 뿐이고, 실제 호출은 차단당한 실행기가 자기 도구로 한다.
# exit 0 = 통과 / exit 2 = 승인 없는 위험 행동 차단(PreToolUse 규약: 비-0이 도구 실행을 막는다).
INPUT=$(cat)
GATE=scripts/check-risky-action.mjs
[ -f "$GATE" ] || GATE=tooling/check-risky-action.mjs   # 킷 자기적용 경로

# node·게이트가 없으면 **조용히 통과시키지 않는다** — "검사 못 함"과 "통과"는 다른 사실이다.
if ! command -v node >/dev/null 2>&1 || [ ! -f "$GATE" ]; then
  echo "[SDD 위험 행동 승인] 검사 못 함 — $( command -v node >/dev/null 2>&1 || echo 'node 없음'; [ -f "$GATE" ] || echo '게이트 없음' ). 통과가 아니다."
  exit 0
fi
printf '%s' "$INPUT" | node "$GATE" --hook
exit $?
