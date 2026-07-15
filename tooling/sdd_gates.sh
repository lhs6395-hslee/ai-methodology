#!/bin/sh
# ─── SDD gates (POSIX 셸판 — 언어 런타임 0) ───────────────────
# Node도 Python도 필요 없다. 필요한 것은 어떤 유닉스/CI에도 있는 것뿐:
#   sh · grep · awk · sort  (POSIX 필수) + jq (JSON 파싱용 단일 도구, 언어중립)
# 빌드도 필요 없다 — 이 스크립트 자체가 이식 가능한 소스다.
# Node판(*.mjs)·Python판(sdd_gates.py)과 같은 sdd.config.json을 읽고 동작 동일.
#
# 왜: 게이트를 Node/Python 스크립트로만 주면 Go·C·Rust 프로젝트가 그 인터프리터를
# 깔아야 한다(= 런타임 특정). 셸+grep은 사실상 모든 환경에 이미 있어, 어떤 언어
# 프로젝트든 추가 언어 런타임 없이 게이트를 돌릴 수 있다.
#
# Usage:
#   sh sdd_gates.sh fr [--strict]
#   sh sdd_gates.sh ownership [--strict]
#   sh sdd_gates.sh run <stage>
set -eu

SUB="${1:-}"
STRICT=0
for a in "$@"; do [ "$a" = "--strict" ] && STRICT=1; done

# ── config 탐색(상위로) ──────────────────────────────────────
CFG=""
d="$PWD"
while :; do
  if [ -f "$d/sdd.config.json" ]; then CFG="$d/sdd.config.json"; break; fi
  p=$(dirname "$d"); [ "$p" = "$d" ] && break; d="$p"
done
if [ -n "$CFG" ]; then ROOT=$(dirname "$CFG"); else ROOT="$PWD"; fi

have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1
if [ -n "$CFG" ] && [ "$have_jq" -eq 0 ]; then
  echo "✗ sdd.config.json 이 있으나 jq가 없음 — jq 설치 또는 Node/Python판 사용" >&2
  exit 1
fi

# config 문자열 1개(없으면 기본값)
cfg_str() { # $1=key $2=default
  if [ -n "$CFG" ]; then jq -r --arg d "$2" ".$1 // \$d" "$CFG"; else printf '%s\n' "$2"; fi
}
# config 배열(newline 구분). 비었으면 아무것도 출력 안 함 → 호출부가 기본값 보강
cfg_arr() { # $1=key
  if [ -n "$CFG" ]; then jq -r ".$1[]? // empty" "$CFG"; fi
}
arr_or_default() { # stdin=array output ; $@=default tokens
  out=$(cat); if [ -n "$out" ]; then printf '%s\n' "$out"; else for x in "$@"; do printf '%s\n' "$x"; done; fi
}

SPEC_DIR_REL=$(cfg_str specDir "sdd/specs")
SPEC_DIR="$ROOT/$SPEC_DIR_REL"
SCAN_DIRS=$(cfg_arr scanDirs | arr_or_default src tests)
IGNORE=$(cfg_arr ignoreDirs | arr_or_default node_modules .next coverage dist build out target vendor __pycache__ .venv venv .git .idea .gradle bin obj Pods .dart_tool)
TESTRX=$(cfg_arr testFileRegex | arr_or_default '\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$')
CATS=$(cfg_arr ownershipCategories | arr_or_default Entities Surfaces Capabilities)
PREFIXES=$(cfg_arr specIdPrefixes | arr_or_default SPEC INFRA TEST CICD)
# spec ID 접두어 → ERE alt. 예: SPEC\nTEST → "SPEC|TEST"
PREFALT=$(printf '%s' "$PREFIXES" | awk 'NR>1{printf "|"}{printf "%s",$0}')
# 요구 ID 접두어(requirementIdPrefixes, 기본 FR) → ERE alt. FR 문법은 전 런타임 공통:
# <접두어>-3자리+선택적 소문자 서픽스 1자(FR-003a). 2자 서픽스는 통째 불인정(절단 캡처 금지).
REQPREFIXES=$(cfg_arr requirementIdPrefixes | arr_or_default FR)
REQALT=$(printf '%s' "$REQPREFIXES" | awk 'NR>1{printf "|"}{printf "%s",$0}')

# ignore 디렉토리 → 경로 필터용 ERE: /(a|b|c)/
ignore_ere() { printf '%s' "$IGNORE" | awk 'NR>1{printf "|"}{printf "%s",$0}' ; }
# testFileRegex → 합친 ERE (basename 대상)
test_ere() { printf '%s' "$TESTRX" | awk 'NR>1{printf "|"}{printf "%s",$0}' ; }

list_test_files() {
  ire="(^|/)($(ignore_ere))(/)"
  tre="$(test_ere)"
  for sd in $SCAN_DIRS; do
    [ -d "$ROOT/$sd" ] || continue
    find "$ROOT/$sd" -type f 2>/dev/null | grep -Ev "$ire" | while IFS= read -r f; do
      b=${f##*/}
      printf '%s\n' "$b" | grep -Eq "$tre" && printf '%s\n' "$f"
    done
  done
}

cfg_tag() { if [ -n "$CFG" ]; then printf '%s' "${CFG#$ROOT/}"; else printf 'defaults(JS/TS)'; fi; }

# ── FR ↔ test 게이트 ─────────────────────────────────────────
gate_fr() {
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  : > "$TMP/declared"; : > "$TMP/specset"; : > "$TMP/covered"; : > "$TMP/pfxerr"

  # 0. PREFIX 화이트리스트 사전 검사 — 미등록 접두어는 조용히 건너뛰지 않고 exit 1(Node판 패리티).
  if [ -d "$SPEC_DIR" ]; then
    for f in "$SPEC_DIR"/*.md; do
      [ -e "$f" ] || continue
      b=${f##*/}
      pfx=$(printf '%s' "$b" | grep -oE '^[A-Z]+-[0-9]{3}' | grep -oE '^[A-Z]+' || true)
      [ -n "$pfx" ] || continue
      if ! printf '%s\n' "$PREFIXES" | grep -qx "$pfx"; then
        printf '미등록 접두어 "%s" (%s) — 표준 SPEC/INFRA/TEST/CICD. 임의 생성 금지, 필요하면 specIdPrefixes+prefixRationale에 사유와 함께 추가\n' "$pfx" "$b" >> "$TMP/pfxerr"
      else
        case "$pfx" in
          SPEC|INFRA|TEST|CICD) ;;
          *)
            rat=""
            [ -n "$CFG" ] && rat=$(jq -r ".prefixRationale.\"$pfx\" // empty" "$CFG")
            if [ -z "$(printf '%s' "$rat" | tr -d '[:space:]')" ]; then
              printf '표준 밖 접두어 "%s" — prefixRationale["%s"]에 도입 사유 필요(빈 값 불가)\n' "$pfx" "$pfx" >> "$TMP/pfxerr"
            fi ;;
        esac
      fi
    done
  fi
  if [ -s "$TMP/pfxerr" ]; then
    echo "✗ PREFIX 위반:" >&2
    sed 's/^/  ✗ /' "$TMP/pfxerr" >&2
    exit 1
  fi

  if [ -d "$SPEC_DIR" ]; then
    for f in "$SPEC_DIR"/*.md; do
      [ -e "$f" ] || continue
      b=${f##*/}
      printf '%s\n' "$b" | grep -Eq "^(${PREFALT})-[0-9]{3}" || continue
      sid=$(printf '%s' "$b" | grep -oE "(${PREFALT})-[0-9]{3}" | head -1 || true)
      [ -n "$sid" ] || continue
      printf '%s\n' "$sid" >> "$TMP/specset"
      # FR 선언: **<REQ>-NNN[a]** — 닫는 **가 경계를 강제(2자 서픽스는 통째 불인정)
      grep -oE "\*\*(${REQALT})-[0-9]{3}[a-z]?\*\*" "$f" 2>/dev/null | grep -oE "(${REQALT})-[0-9]{3}[a-z]?" | sort -u | while IFS= read -r fr; do
        printf '%s %s\n' "$sid" "$fr" >> "$TMP/declared"
      done
    done
  fi

  list_test_files | while IFS= read -r tf; do
    # 과포집(뒤 워드문자 포함) 후 정확형만 통과 — FR-003ab·FR-003a1 같은 비문법 태그의 절단 캡처 금지
    grep -oE "@covers (${PREFALT})-[0-9]{3}/(${REQALT})-[0-9]{3}[a-zA-Z0-9_]*" "$tf" 2>/dev/null | while IFS= read -r m; do
      printf '%s' "$m" | grep -Eq "/(${REQALT})-[0-9]{3}[a-z]?$" || continue
      pair=${m#@covers }
      spec=${pair%/*}; fr=${pair#*/}
      printf '%s %s %s\n' "$spec" "$fr" "$tf" >> "$TMP/covered"
    done
  done

  STRICT="$STRICT" ROOT="$ROOT" CFGTAG="$(cfg_tag)" awk '
    FILENAME==ARGV[1] { decl[$1" "$2]=1; if(!($1 in specfr)) specfr[$1]=0; declset[$1]=1; next }
    FILENAME==ARGV[2] { spec[$1]=1; if(!($1 in covcount)) covcount[$1]=0; next }
    FILENAME==ARGV[3] {
      key=$1" "$2;
      if(!(key in covseen)){covseen[key]=1; covlist[$1]=covlist[$1]" "$2}
      cfile[$1" "$2]=$3
      if(!(key in decl)) dangling[$1" "$2]=$3
      next
    }
    END{
      strict=(ENVIRON["STRICT"]=="1"); root=ENVIRON["ROOT"];
      # declared FR count per spec
      for(k in decl){split(k,a," "); dcount[a[1]]++ }
      # covered FR count per spec (unique)
      for(k in covseen){split(k,a," "); if(a[1] in dcount || 1){ } }
      ne=0; nw=0;
      # R1 dangling
      for(k in dangling){ split(k,a," "); rel=dangling[k]; sub(root"/","",rel);
        errors[ne++]="R1 dangling @covers "a[1]"/"a[2]" in "rel" — no such FR in "a[1] }
      # iterate specs (from specset)
      for(s in spec){
        # covered set for s
        cov=0; for(k in covseen){split(k,a," "); if(a[1]==s) cov++ }
        tot=dcount[s]+0;
        if(cov==0){ msg=s": 0/"tot" FRs covered (not yet implemented)";
          if(strict && tot>0) errors[ne++]="R2(strict) "msg; else warns[nw++]=msg; continue }
        # missing
        miss=""; mc=0;
        for(k in decl){split(k,a," "); if(a[1]==s){ if(!((s" "a[2]) in covseen)){ miss=miss (miss==""?"":", ") a[2]; mc++ } }}
        if(mc>0){ msg=s": "cov"/"tot" FRs covered — missing "miss;
          if(strict) errors[ne++]="R2(strict) "msg; else warns[nw++]=msg }
        else warns[nw++]=s": "cov"/"tot" FRs covered ✓"
      }
      # totals
      tfr=0; for(s in dcount) tfr+=dcount[s]; nspec=0; for(s in spec) nspec++;
      tcov=0; for(k in covseen) tcov++;
      mode=(strict?"strict":"incremental");
      printf "FR coverage gate — specs:%d FRs:%d covered:%d mode:%s config:%s\n", nspec, tfr, tcov, mode, ENVIRON["CFGTAG"];
      for(i=0;i<nw;i++) print "  · " warns[i];
      if(ne>0){ print "\nFR coverage violations:" > "/dev/stderr";
        for(i=0;i<ne;i++) print "  ✗ " errors[i] > "/dev/stderr"; exit 1 }
      print "FR coverage gate: OK";
    }
  ' "$TMP/declared" "$TMP/specset" "$TMP/covered"
}

# ── 소유권(구조적 중복) 게이트 ───────────────────────────────
gate_ownership() {
  [ -d "$SPEC_DIR" ] || { echo "✗ spec 디렉토리를 찾을 수 없음: $SPEC_DIR" >&2; exit 1; }
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  : > "$TMP/keys"      # CAT\tkey\tSPEC
  : > "$TMP/missing"
  total=0; declared=0

  for f in "$SPEC_DIR"/*.md; do
    [ -e "$f" ] || continue
    total=$((total+1))
    sid=$(grep -oE "(${PREFALT})-[0-9]{3}" "$f" 2>/dev/null | head -1 || true)
    [ -n "$sid" ] || sid=${f##*/}
    # Ownership 블록 유무
    if ! grep -qE '^##[[:space:]]+Ownership' "$f"; then
      printf '%s\n' "$sid" >> "$TMP/missing"; continue
    fi
    declared=$((declared+1))
    # 블록 추출 + 카테고리별 키 파싱 (awk)
    printf '%s\n' "$CATS" | while IFS= read -r cat; do
      [ -n "$cat" ] || continue
      awk -v cat="$cat" -v sid="$sid" '
        BEGIN{inblk=0}
        /^##[[:space:]]+Ownership/{inblk=1; next}
        inblk && /^##[[:space:]]/{inblk=0}
        inblk{
          # 줄: - **Cat**: a, b, c
          line=tolower($0); lc=tolower(cat)
          if(match(line, "-[[:space:]]*\\*\\*"lc"\\*\\*[[:space:]]*:[[:space:]]*")){
            val=substr($0, RSTART+RLENGTH)
            n=split(val, parts, ",")
            for(i=1;i<=n;i++){
              k=parts[i]; gsub(/^[[:space:]]+|[[:space:]]+$/,"",k); k=tolower(k); gsub(/[[:space:]]+/," ",k)
              if(k=="" || k=="—" || k=="[…]" || substr(k,1,1)=="[") continue
              print cat "\t" k "\t" sid
            }
          }
        }
      ' "$f" >> "$TMP/keys"
    done
  done

  echo "Ownership 게이트: spec ${total}개 중 ${declared}개가 Ownership 선언."
  if [ -s "$TMP/missing" ]; then
    mc=$(wc -l < "$TMP/missing" | tr -d ' ')
    mlist=$(paste -sd, "$TMP/missing" 2>/dev/null || tr '\n' ',' < "$TMP/missing")
    if [ "$STRICT" -eq 1 ]; then printf '✗ Ownership 블록 없음(%s): %s\n' "$mc" "$mlist"; else printf '⚠ Ownership 블록 없음(%s): %s\n' "$mc" "$mlist"; fi
  fi

  # 충돌: 같은 CAT+key를 가진 distinct SPEC ≥2
  conflicts=$(awk -F'\t' '
    { key=$1 SUBSEP $2; if(!((key SUBSEP $3) in seen)){seen[key SUBSEP $3]=1; cnt[key]++; specs[key]=specs[key] (specs[key]==""?"":" + ") $3; cat[key]=$1; nm[key]=$2} }
    END{ for(k in cnt) if(cnt[k]>1) print cat[k] "\t" nm[k] "\t" specs[k] }
  ' "$TMP/keys")

  if [ -n "$conflicts" ]; then
    n=$(printf '%s\n' "$conflicts" | grep -c . || true)
    printf '\n✗ 중복 소유(구조적 중복) %s건:\n' "$n" >&2
    printf '%s\n' "$conflicts" | while IFS="$(printf '\t')" read -r c k s; do
      printf '  [%s] "%s" ← %s  → 한 spec으로 통합/개정 필요\n' "$c" "$k" "$s" >&2
    done
    exit 1
  fi
  if [ "$STRICT" -eq 1 ] && [ -s "$TMP/missing" ]; then
    echo "" >&2; echo "✗ --strict: 모든 spec이 Ownership을 선언해야 함." >&2; exit 1
  fi
  catsline=$(printf '%s' "$CATS" | awk 'NR>1{printf "/"}{printf "%s",$0}')
  printf '✓ 구조적 중복 없음 — 모든 %s 키가 유일.\n' "$catsline"
}

# ── 러너 ─────────────────────────────────────────────────────
gate_run() {
  stage="${2:-}"; [ -n "$stage" ] || { echo "usage: sh sdd_gates.sh run <stage>" >&2; exit 2; }
  cmd=""; [ -n "$CFG" ] && cmd=$(jq -r ".commands.\"$stage\" // empty" "$CFG")
  if [ -z "$cmd" ]; then echo "· sdd-run: '$stage' 명령 미설정 — 건너뜀"; exit 0; fi
  echo "▶ sdd-run $stage: $cmd"
  ( cd "$ROOT" && sh -c "$cmd" ) || { rc=$?; echo "✗ sdd-run $stage 실패 (exit $rc)" >&2; exit "$rc"; }
}

case "$SUB" in
  fr) gate_fr ;;
  ownership) gate_ownership ;;
  run) gate_run "$@" ;;
  *) echo "usage: sh sdd_gates.sh <fr|ownership|run> [...]" >&2; exit 2 ;;
esac
