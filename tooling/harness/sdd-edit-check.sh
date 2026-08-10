#!/bin/sh
# PreToolUse hook — 코드 편집 직전 방법론 체크리스트 상기(비차단).
# stdin: {"tool_name":"Write","tool_input":{"file_path":"..."}}
#
# ⚠ 이 훅은 **에이전트가 SDD로 수행하는지 보는 층**이다(SPEC-051). git 훅은 커밋 시점에 이미
# 작성된 코드를 보므로, "지금 스펙 없이 코드를 쓰고 있다"를 그 자리에서 말할 수 있는 곳은 여기뿐이다.
INPUT=$(cat)
# file_path 추출(jq 없이 grep — 의존 최소화)
FP=$(printf '%s' "$INPUT" | grep -o '[{,][[:space:]]*"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$FP" ] || exit 0

GATE=scripts/check-pre-edit.mjs
[ -f "$GATE" ] || GATE=tooling/check-pre-edit.mjs   # 킷 자기적용 경로

# node·게이트가 없으면 **조용히 통과시키지 않는다** — "검사 못 함"과 "통과"는 다른 사실이다.
# 이전 판은 `|| true`로 삼켰고, 그 침묵이 이 층의 결함을 오래 가렸다(SPEC-051).
if ! command -v node >/dev/null 2>&1 || [ ! -f "$GATE" ]; then
  WHY=$( command -v node >/dev/null 2>&1 || echo 'node 없음'; [ -f "$GATE" ] || echo '게이트 없음' )
  echo "[SDD 편집 체크] 검사 못 함 — $WHY. 통과가 아니다."
  # ⚠ **hard 선언 + 무판정 = 거짓 안전**이다(킷의 규범). 정책이 차단으로 선언돼 있는데 판정할
  # 런타임이 없으면 그 프로젝트는 "편집 시점 강제가 켜져 있다"고 믿으면서 실제로는 아무 보호가 없다.
  # 막지는 않는다(런타임 부재로 편집을 막으면 작업이 통째로 멈춘다) — 대신 **매 발동 자백한다.**
  if grep -q '"preEditSpecFirstPolicy"[[:space:]]*:[[:space:]]*"hard"' sdd.config.json 2>/dev/null; then
    echo "  ✗ preEditSpecFirstPolicy=hard인데 판정할 런타임이 없다 — 이 상태의 '강제'는 선언뿐이다(거짓 안전)."
    echo "    → node를 설치하거나 정책을 advisory로 내려 **선언과 실제를 일치시켜라**(둘이 어긋난 채로 두는 것이 최악이다)."
  fi
  exit 0
fi

# spec-first를 **편집 시점**으로 앞당긴다(SPEC-003 FR-012) — 소유 스펙이 이 브랜치에서 미수정이면
# 경고. commit-msg 훅만 있으면 코드를 다 쓴 뒤에야 순서 위반이 드러난다(실측: 마찰 0 → 자각 없음).
# ⚠ 종료코드를 **삼키지 않는다.** 이전 판은 `2>/dev/null`로 stderr를 버리고 무조건 통과시켰다 —
# 그래서 정책이 `hard`여도 편집이 막히지 않았고, 강도 사다리의 종착지가 도달 불가였다.
# 비-0은 그대로 전파한다(PreToolUse 규약: 비-0이 도구 호출을 막는다).
node "$GATE" "$FP" || EDIT_BLOCK=$?

# 코드 경로 여부는 **config의 scanDirs가 정본이다.** 이전 판은 `case src/|lib/|app/`으로
# 하드코딩했고 주석은 "sdd-init가 조정한다"고 적혀 있었지만 설치기는 그대로 복사만 했다 —
# 실측: 킷의 scanDirs는 `tooling`이라 이 체크리스트가 한 번도 발화할 수 없었다(SPEC-051).
if node "$GATE" --is-code-path "$FP" >/dev/null 2>&1; then
  cat <<'EOF'
[SDD 편집 체크 — 코드 건드리기 전 확인]
  □ MODULE_MAP 대조했나 (기존 spec 개정 vs 새 spec)
  □ 이 변경에 대응하는 FR 있나 — 없으면 sdd/specs/에 spec부터
  □ PREFIX 표준(SPEC/INFRA/TEST/CICD)인가
  □ 테스트에 @covers <PREFIX>-NNN/FR-NNN 계획했나
EOF
fi
# 차단은 체크리스트를 **보여준 뒤** 발효한다 — 막으면서 무엇을 하라는지 안 주면 우회로를 찾는다.
exit "${EDIT_BLOCK:-0}"
