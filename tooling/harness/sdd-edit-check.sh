#!/bin/sh
# PreToolUse hook — src 코드 편집 직전 방법론 체크리스트 상기(비차단).
# stdin: {"tool_name":"Write","tool_input":{"file_path":"..."}}
INPUT=$(cat)
# file_path 추출(jq 없이 grep — 의존 최소화)
FP=$(printf '%s' "$INPUT" | grep -o '[{,][[:space:]]*"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

# spec-first를 **편집 시점**으로 앞당긴다(SPEC-003 FR-012) — 소유 스펙이 이 브랜치에서 미수정이면
# 경고. commit-msg 훅만 있으면 코드를 다 쓴 뒤에야 순서 위반이 드러난다(실측: 마찰 0 → 자각 없음).
# node·스크립트가 없으면 조용히 건너뛴다(이식성 — 아래 체크리스트는 그대로 동작).
if [ -n "$FP" ] && command -v node >/dev/null 2>&1 && [ -f scripts/check-pre-edit.mjs ]; then
  node scripts/check-pre-edit.mjs "$FP" 2>/dev/null || true
fi

case "$FP" in
  src/*|*/src/*|lib/*|*/lib/*|app/*|*/app/*)   # scanDirs 코드 경로(프로젝트 관례에 맞게 sdd-init가 조정)
    cat <<'EOF'
[SDD 편집 체크 — 코드 건드리기 전 확인]
  □ MODULE_MAP 대조했나 (기존 spec 개정 vs 새 spec)
  □ 이 변경에 대응하는 FR 있나 — 없으면 sdd/specs/에 spec부터
  □ PREFIX 표준(SPEC/INFRA/TEST/CICD)인가
  □ 테스트에 @covers <PREFIX>-NNN/FR-NNN 계획했나
EOF
    ;;
  *) : ;;  # 코드 아님 → 침묵
esac
exit 0
