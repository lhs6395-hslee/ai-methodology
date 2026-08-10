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
  echo "[SDD 편집 체크] 검사 못 함 — $( command -v node >/dev/null 2>&1 || echo 'node 없음'; [ -f "$GATE" ] || echo '게이트 없음' ). 통과가 아니다."
  exit 0
fi

# spec-first를 **편집 시점**으로 앞당긴다(SPEC-003 FR-012) — 소유 스펙이 이 브랜치에서 미수정이면
# 경고. commit-msg 훅만 있으면 코드를 다 쓴 뒤에야 순서 위반이 드러난다(실측: 마찰 0 → 자각 없음).
node "$GATE" "$FP" 2>/dev/null

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
exit 0
