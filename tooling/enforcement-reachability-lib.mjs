// tooling/enforcement-reachability-lib.mjs
// 선언↔강제지점 결합 판정 순수 코어 (SPEC-061, 이슈 #21 D-1).
// 강도 knob이 hard여도, 그 판정이 실제로 발화할 강제 지점(CI 정의)이 없으면 선언은 프로즈다.
// 실측(소비 프로젝트 finops): git 리모트가 GitLab인데 CI 정의는 `.github/workflows/*.yml`
// 하나뿐 — GitHub Actions는 GitLab에서 애초에 실행되지 않는다. `draftBlockPolicy: hard`(range
// 모드 전용 승격, SPEC-008 FR-007)도 `policyRatchetPolicy`도 이 CI에서 발화 횟수가 0이었는데
// 로컬 게이트·config 어디에도 그 사실을 아는 코드가 없었다. 판정은 두 축이다 — 이 lib은 git
// 원격 URL·CI 파일 존재만 보는 순수 함수이고, 파일 IO·git 실행은 소비 게이트가 한다.
// 설계: Python판 sdd_gates.py가 동일 동작을 미러(SPEC-006 패리티).

// 알려진 "네이티브 CI"만 host↔CI 결합 판정 대상이다 — Jenkins·CircleCI 등은 어느 host에도
// 웹훅으로 붙을 수 있어(자체 호스팅) 그 존재/부재가 host와의 불일치 근거가 되지 않는다.
// derivationClassGlobs.ci(SPEC-009)와 굳이 안 합친 이유: 그 축은 "CI 파일이 존재하는가"(증거
// 회계)만 보고, 이 축은 "**어느 provider**의 CI인가"(host 결합)를 봐야 해서 provider별로
// 갈라야 한다 — 합치면 provider 식별력을 잃는다(R13 근접이지만 판정 축이 다르다).
export const NATIVE_CI_GLOBS = {
  github: [".github/workflows/**"],
  gitlab: [".gitlab-ci.yml", ".gitlab/ci/**"],
  bitbucket: ["bitbucket-pipelines.yml"],
  azure: ["azure-pipelines*"],
};

// git remote URL(ssh/https 어느 형식이든)에서 호스트를 식별한다. 모르는 호스트·파싱 불가면 null
// (자체 호스팅 GitLab/GitHub Enterprise는 이름으로 짐작하지 않는다 — 추측의 성공은 침묵할 수 없다
// 원칙과 같은 이유로, 여기선 침묵 대신 "판정 밖"으로 명시한다).
export function detectGitHost(remoteUrl) {
  const s = String(remoteUrl || "");
  if (/(^|[@./])github\.com([:/]|$)/.test(s)) return "github";
  if (/(^|[@./])gitlab\.com([:/]|$)/.test(s)) return "gitlab";
  if (/(^|[@./])bitbucket\.org([:/]|$)/.test(s)) return "bitbucket";
  if (/(^|[@./])dev\.azure\.com([:/]|$)/.test(s) || /visualstudio\.com([:/]|$)/.test(s)) return "azure";
  return null;
}

// host가 알려진(known) provider인데 그 provider의 네이티브 CI 파일이 하나도 없고, **다른**
// provider의 CI 파일은 있으면 — 그 CI 정의는 이 리포에서 실행될 수 없다(실측 그대로).
// host가 null(모르는 호스트·리모트 없음)이면 판정하지 않는다(false positive보다 침묵이 낫다 —
// 자체 호스팅 GitLab 등은 이름 패턴으로 추측할 근거가 없다).
// presentProviders: 이 리포에 실제로 존재하는 provider 키 배열(예: ["github"]).
export function hostCiMismatchFinding(host, presentProviders) {
  if (!host || !(host in NATIVE_CI_GLOBS)) return null;
  const present = new Set(presentProviders || []);
  if (present.has(host)) return null; // 호스트 자신의 CI가 있으면 정합
  const others = [...present].filter((p) => p !== host);
  if (!others.length) return null; // CI 정의가 아예 없으면 이 축이 아니라 "CI 없음" — 별도 관심사
  return { host, present: others };
}

// range 전용으로만 효력이 있는 knob(SPEC-008 FR-007: draftBlockPolicy)이 hard인데, 발견된 CI
// 정의 어디에도 spec-sync 호출 흔적이 없으면 — 그 승격은 이 리포의 어떤 강제 지점에서도 발화하지
// 않는다(로컬 git 훅은 range 모드를 안 돈다 — pre-push는 staged 판정, range는 CI diff 전용).
// ciTextConcat: 발견된 모든 CI 파일 내용을 이어붙인 문자열(빈 문자열 = CI 정의 자체가 없음).
export function rangeEnforcementFinding(draftBlockPolicy, ciTextConcat) {
  if (draftBlockPolicy !== "hard") return null;
  const text = String(ciTextConcat || "");
  if (/check-spec-sync|sdd-sync/.test(text)) return null;
  return { knob: "draftBlockPolicy", value: "hard" };
}
