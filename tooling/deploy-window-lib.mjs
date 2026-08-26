// tooling/deploy-window-lib.mjs
// 배포 시간창 순수 판정 (SPEC-060) — 소비 프로젝트의 CI/CD가 push 시점에 발화하는 파이프라인을
// 쓸 때, "지금 이 시각이 배포가 허용된 창 안인가"를 판정한다. 실측 근거: 손으로 짠 파이프라인이
// 고정 UTC 오프셋으로 창을 계산해 DST(서머타임) 있는 타임존에서 조용히 한 시간씩 어긋났다 —
// `Intl.DateTimeFormat`으로 대상 타임존의 **지금 로컬 시각**을 직접 얻어야 이 함정을 피한다.
//
// 판정 코어는 순수 함수다 — "지금"은 소비 게이트가 주입한다(findApproval의 nowMs 패턴과 동일,
// 코어가 시각을 스스로 재지 않는다).

// HH:MM 문자열 → 그날 자정부터의 분(0~1439). 형식이 아니면 null(호출자가 설정 오류로 취급).
function minutesOf(hhmm) {
  const m = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// nowMs(UTC epoch) → { weekday, minutesOfDay } — window.timezone 기준 **로컬** 시각.
// 고정 오프셋을 손으로 더/빼지 않는다 — Intl이 DST를 스스로 안다.
function localParts(nowMs, timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const weekday = String(parts.weekday || "").slice(0, 3);
  // hour12:false에서도 자정을 "24"로 낼 수 있는 로케일이 있다 — 0으로 정규화.
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { weekday, minutesOfDay: hour * 60 + minute };
}

// window: { enabled, days?: ["Mon",...](비면 전 요일), start: "HH:MM", end: "HH:MM",
//           timezone, overrideTrailer? } — start > end면 자정을 넘는 창(예: 22:00~06:00)으로 본다.
// commitMessage: 트레일러 검색 대상(선언적 예외 — 매 실행 커밋에 적어야 흔적이 남는다).
// 반환 {status, detail} — status: no-window | in-window | out-of-window | overridden | misconfigured
export function deployWindowVerdict(window, nowMs, commitMessage) {
  const w = window || {};
  if (!w.enabled) return { status: "no-window", detail: "" };

  const overrideName = String(w.overrideTrailer || "").trim();
  if (overrideName) {
    const re = new RegExp(`^${overrideName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m");
    if (re.test(String(commitMessage || ""))) {
      return { status: "overridden", detail: `\`${overrideName}\` 트레일러로 명시 예외됨 — 배포 시간창을 건너뛴다` };
    }
  }

  const startM = minutesOf(w.start);
  const endM = minutesOf(w.end);
  if (startM == null || endM == null) {
    return { status: "misconfigured", detail: `배포 시간창 설정이 깨졌다 — start/end가 HH:MM 형식이 아니다(start=${w.start}, end=${w.end})` };
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return { status: "misconfigured", detail: "현재 시각이 주입되지 않았다 — 판정할 수 없다" };
  }

  const { weekday, minutesOfDay } = localParts(nowMs, w.timezone || "UTC");
  const days = Array.isArray(w.days) && w.days.length ? w.days.map(String) : WEEKDAYS;
  const dayOk = days.includes(weekday);

  const wraps = startM > endM; // 자정을 넘는 창(예: 22:00~06:00)
  const timeOk = wraps ? (minutesOfDay >= startM || minutesOfDay < endM) : (minutesOfDay >= startM && minutesOfDay < endM);

  if (dayOk && timeOk) {
    return { status: "in-window", detail: `배포 허용 창 안(${weekday} ${w.start}~${w.end} ${w.timezone || "UTC"})` };
  }
  return {
    status: "out-of-window",
    detail: `배포 허용 창 밖이다(지금 ${weekday} — 창: ${days.join("/")} ${w.start}~${w.end} ${w.timezone || "UTC"})`
      + (overrideName ? ` — 의도한 것이면 커밋 메시지에 \`${overrideName}: <사유>\`를 추가해 재실행하라` : ""),
  };
}

// git pre-push 프로토콜(stdin, 줄마다 `<local ref> <local sha1> <remote ref> <remote sha1>`)을
// 파싱한다. **로컬 브랜치 이름을 판정 근거로 쓰지 않는다** — 실측 함정: 로컬 브랜치가 우연히
// 배포 브랜치와 같은 이름인데 실제로는 다른 원격 브랜치로 push하는 경우, 로컬 이름만 보면
// 오탐(또는 미탐)이 난다. 판정은 항상 `remoteRef`로 한다.
export function parsePrePushRefs(stdin) {
  const out = [];
  for (const line of String(stdin || "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const [localRef, localOid, remoteRef, remoteOid] = parts;
    out.push({ localRef, localOid, remoteRef, remoteOid });
  }
  return out;
}

// 이번 push가 배포 브랜치(remoteRef 기준)를 향하는가 — git pre-push 프로토콜에서 **localOid가
// 전부 0**이면 로컬 ref가 없다는 뜻(원격 브랜치 삭제 push)이라 대상에서 뺀다. remoteOid가 전부
// 0인 것은 반대로 "원격에 아직 없다"(신규 브랜치 최초 push)는 뜻이라 정상 대상이다 — 이 둘을
// 헷갈리면 최초 배포 push가 조용히 판정에서 빠진다.
export function targetsDeployBranch(refs, deployBranch) {
  const target = `refs/heads/${String(deployBranch || "").replace(/^refs\/heads\//, "")}`;
  const ZERO = /^0+$/;
  return (refs || []).some((r) => r.remoteRef === target && !ZERO.test(r.localOid || ""));
}
