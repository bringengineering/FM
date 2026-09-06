"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const normalizeLineEndings = value => value.replace(/\r\n?/g, "\n");
const deploy = normalizeLineEndings(fs.readFileSync(path.join(root, ".github/workflows/crm-rules-deploy.yml"), "utf8"));
const ci = normalizeLineEndings(fs.readFileSync(path.join(root, ".github/workflows/crm-ci.yml"), "utf8"));
const executable = deploy.replace(/^\s*#.*$/gm, "");

test("규칙이 바뀌면 사람을 기다리지 않고 올라간다", () => {
  // 사람이 매번 해야 하는 절차는 언젠가 어긋난다. 실제로 한 번은 옛날
  // 커밋에서 올려서 배포는 성공했는데 새 화면이 전부 막혔다.
  assert.match(executable, /branches:\n\s+- codex\/bring-field-platform/u);
  assert.match(executable, /- "database\.rules\.json"/u);
  assert.match(executable, /- "firebase\.json"/u);
  // 되돌리는 길이 없으면 자동 배포는 도박이다.
  assert.match(executable, /workflow_dispatch:/u);
  assert.match(executable, /rules_ref:/u);
  assert.match(executable, /ref: \$\{\{ github\.event\.inputs\.rules_ref \|\| github\.sha \}\}/u);
});

test("검사를 통과한 규칙만 올라간다", () => {
  // 규칙은 권한의 경계다. 잘못 올리면 남의 급여가 보이거나 아무도
  // 로그인을 못 한다. 검사가 배포보다 먼저 있어야 한다.
  const testStep = executable.indexOf("Test the rules being deployed");
  const deployStep = executable.indexOf("Deploy database rules");
  assert.ok(testStep > 0, "규칙 검사 단계가 있어야 한다");
  assert.ok(deployStep > 0, "배포 단계가 있어야 한다");
  assert.ok(testStep < deployStep, "검사가 배포보다 먼저여야 한다");
  // 같은 작업 안에 있어야 한다. 작업이 갈리면 needs 없이도 돌아 버린다.
  const jobs = executable.slice(executable.indexOf("\njobs:\n"));
  assert.equal((jobs.match(/^  [a-z][a-z0-9-]*:$/gmu) || []).length, 1, "작업은 하나뿐이어야 한다");
  // 올릴 그 파일 그대로 검사한다 — CI 가 쓰는 명령과 같은 것.
  const command = "emulators:exec --only database,storage \"pnpm test:rules\"";
  assert.ok(executable.includes(command), "CI 와 같은 규칙 검사를 돌려야 한다");
  assert.ok(ci.includes(command), "CI 쪽 명령이 바뀌면 여기도 같이 바뀌어야 한다");
});

test("두 배포가 겹치지 않는다", () => {
  // 규칙은 한 벌뿐이다. 겹치면 나중 것이 먼저 것을 덮는데, 어느 것이
  // 나중인지는 순서가 아니라 끝난 시각이 정한다.
  assert.match(executable, /group: crm-firebase-rules/u);
  assert.match(executable, /cancel-in-progress: false/u);
});

test("열쇠는 임시 폴더에만 두고 지운다", () => {
  // 작업 폴더에 두면 다음 단계나 artifact 에 딸려 간다.
  assert.match(executable, /FIREBASE_SERVICE_ACCOUNT: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT \}\}/u);
  assert.match(executable, /\$RUNNER_TEMP\/firebase-service-account\.json/u);
  assert.match(executable, /umask 077/u);
  assert.match(executable, /trap 'rm -f "\$key"' EXIT/u);
  // 시크릿이 없으면 조용히 건너뛰지 않고 이유를 말하고 멈춘다. 조용히
  // 넘어가면 안 올라간 줄 모른 채 화면만 열린다.
  assert.match(executable, /::error::FIREBASE_SERVICE_ACCOUNT/u);
  assert.match(executable, /exit 1/u);
  // 저장소 토큰을 들고 다니지 않는다. 여기서 밀 것이 없다.
  assert.match(executable, /persist-credentials: false/u);
  assert.match(executable, /permissions:\n\s+contents: read/u);
});

test("진짜 프로젝트에만, 데이터베이스 규칙만 올린다", () => {
  // 검사는 demo 프로젝트, 배포는 bring-fm. 두 이름이 섞이면 검사가
  // 진짜 자료를 만지거나 배포가 아무 데도 안 간다.
  assert.match(executable, /--project demo-bring-fm emulators:exec/u);
  assert.match(executable, /--project bring-fm \\\n\s+deploy --only database --non-interactive/u);
  // 호스팅·함수·스토리지는 여기서 건드리지 않는다. 규칙만 올린다.
  assert.doesNotMatch(executable, /deploy --only hosting|deploy --only functions|--only storage\b(?![,"])/u);
});
