// tooling/evidence-scope-lib.mjs
// 근거의 적용범위 판정 순수 코어 (SPEC-043) — **관측은 그 관측이 이루어진 범위까지만 참이다.**
//
// 실측 제보(2026-08-10): 리눅스 1대(X 서버 없음)에서 한 번 관측한 사실이 보편 규칙
// (`DISPLAY || WAYLAND_DISPLAY`가 없으면 헤드리스)으로 그대로 승격됐다. macOS·WSLg·원격 X
// 전달 환경에서는 틀린 규칙인데, 근거 줄은 "실측"이라고만 적혀 있어 그 규칙이 **어디서**
// 참인지를 아무도 되짚을 수 없었다. 모든 게이트는 초록이었다 — 근거 칸이 비지 않았으니까
// (SPEC-009 FR-006은 근거의 **존재**만 본다).
//
// 방법론 차원의 답: 범위를 **EARS 문장에 강제하지 않는다**. FR 문법을 건드리면 이미 쓰인
// 수백 개 FR이 한꺼번에 문법 위반이 되고, 그 규모의 강제는 우회를 낳는다(HARNESS 불변:
// "우회를 유발하는 강제는 강제가 아니다"). 대신 **근거가 관측을 주장한 그 자리에서** 범위를
// 요구한다 — 주장한 쪽이 밝힌다.
//
// 방아쇠는 **두 조건의 곱**이다: ① 근거가 관측을 주장하고, ② 근거가 특정 환경을 지목한다.
// 관측 주장만으로 방아쇠를 당기면(킷 실측: 77건/26스펙) 대부분이 "소비 프로젝트 실측"·"감사
// 재현" 같은 환경 무관 근거라 매 실행 77줄이 쏟아진다 — 그러면 본 신호가 묻히고 사람이 정책을
// 끈다("오탐이 잦은 게이트는 꺼진다"). 환경을 지목한 관측만 보면 킷에서 2건이다. 그리고 그
// 2건이 정확히 위험한 모양이다: **특정 환경에서 본 것을 근거로 규칙을 쓴 자리.**
//
// 이 신호가 말하는 것: "이 근거는 특정 환경에서의 관측을 주장하는데, 그 결론이 참인 범위가
// 적혀 있지 않다." 말하지 않는 것: "그 규칙이 틀렸다" · "범위가 좁다". 범위가 적히면 그
// 다음은 리뷰의 몫이다(SPEC-031·039가 그은 경계 그대로 — 존재는 기계, 질은 리뷰).
//
// 순수 함수(IO 없음) — 스펙 본문 읽기는 소비 게이트. Python 미러(SPEC-006).

import { markerHits } from "./evidence-lib.mjs";
import { changeLogDatedRows } from "./derivation-lib.mjs";

// "이 근거는 관측에서 나왔다"는 주장의 마커. 여기 없는 근거는 대상이 아니다.
export const DEFAULT_OBSERVATION_MARKERS = [
  "실측", "관측", "재현", "측정", "실험", "확인함",
  "observed", "measured", "reproduced", "benchmark",
];
// 근거가 **특정 환경을 지목**했는지 — OS·아키텍처·런타임 격리처럼 "여기서 봤다"가 성립하는
// 이름만 담는다. `node`·`ci`·`local` 같은 흔한 낱말은 일부러 뺐다(어디에나 있어 방아쇠가
// 무의미해진다 — markerHits가 단어 경계로 좁혀도 빈도 자체가 신호를 죽인다).
export const DEFAULT_ENVIRONMENT_MARKERS = [
  "리눅스", "linux", "macos", "맥os", "windows", "윈도우", "wsl", "x11", "wayland",
  "도커", "docker", "컨테이너", "container", "우분투", "ubuntu", "alpine",
  "arm64", "amd64", "x86", "런타임 환경",
];
// 관측 범위를 밝히는 표기 — `범위: …` 꼴의 라벨. 라벨만 보고 내용의 질은 보지 않는다.
export const DEFAULT_SCOPE_LABELS = [
  "범위", "관측범위", "관측 범위", "환경", "scope", "observed on",
];

// `범위: …`처럼 **라벨과 내용이 함께** 있어야 선언으로 인정한다 — 라벨만 적고 비우는 것은
// 표기가 아니다(SPEC-009가 근거 칸 공백을 인정하지 않는 것과 같은 판단).
export function scopeDeclared(text, labels) {
  const s = String(text || "");
  for (const label of labels && labels.length ? labels : DEFAULT_SCOPE_LABELS) {
    const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}\\s*[:：]\\s*\\S`, "i");
    if (re.test(s)) return true;
  }
  return false;
}

export function claimsObservation(text, markers) {
  const list = markers && markers.length ? markers : DEFAULT_OBSERVATION_MARKERS;
  return list.some((m) => markerHits(text, m));
}

// 지목된 환경 이름들(표시용) — 사람이 "무엇 때문에 걸렸는지"를 즉시 알아야 고칠 수 있다.
export function namedEnvironments(text, envMarkers) {
  const list = envMarkers && envMarkers.length ? envMarkers : DEFAULT_ENVIRONMENT_MARKERS;
  return list.filter((m) => markerHits(text, m));
}

// Change Log 근거 셀 판정 — 반환 [{date, rationale, environments}](행 순서).
// 행 선별은 SPEC-009의 정본 `changeLogDatedRows`를 그대로 소비한다 — 복제했다가 R13 구현
// 중복으로 즉시 잡혔다: 두 축이 서로 다른 "행"을 보면 사람이 어느 쪽을 고쳐야 할지 모른다.
export function evidenceScopeFindings(text, markers, labels, envMarkers) {
  const out = [];
  for (const { date, cells } of changeLogDatedRows(text)) {
    const rationale = cells[2];
    if (!rationale) continue;                       // 공백은 SPEC-009 FR-006의 사실이다(중복 고발 금지)
    if (!claimsObservation(rationale, markers)) continue;
    const environments = namedEnvironments(rationale, envMarkers);
    if (!environments.length) continue;             // 환경을 지목하지 않은 관측은 이 축의 대상이 아니다
    if (scopeDeclared(rationale, labels)) continue;
    out.push({ date, rationale, environments });
  }
  return out;
}
