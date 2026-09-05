const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const Endpoint = require("../src/owner-os-endpoint-core");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const appSource = read("app.js");

const CHANNELS = ["crm:owner-os-settings-load", "crm:owner-os-settings-save", "crm:owner-os-report-send"];

test("대표OS 채널이 정책에 등록돼 있다", () => {
  // 등록 안 된 채널은 secureCanonicalHandle 이 UNCLASSIFIED_IPC 로 막는다.
  for (const channel of CHANNELS) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), `${channel} 미등록`);
  }
  assert.equal(MutationPolicy.classification("crm:owner-os-settings-load"), "control");
  // 설정 저장과 전송은 밖으로 나가는 행위라 mutation 이어야 한다.
  assert.equal(MutationPolicy.classification("crm:owner-os-settings-save"), "mutation");
  assert.equal(MutationPolicy.classification("crm:owner-os-report-send"), "mutation");
});

test("마케팅 전용 계정은 대표OS 설정도 전송도 못 한다", () => {
  // 매출·원가·이익률이 담기는 자료다.
  const marketingOnly = { accessRole: "member", marketingRole: "marketing" };
  for (const channel of ["crm:owner-os-settings-save", "crm:owner-os-report-send"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, marketingOnly),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      `${channel} 이 막히지 않는다`,
    );
  }
  // main.js 안에도 같은 방어가 한 번 더 있다.
  const sender = mainSource.slice(
    mainSource.indexOf("async function sendOwnerOsReport"),
    mainSource.indexOf("async function sendOwnerOsReport") + 2400,
  );
  assert.match(sender, /isMarketingOnlySession\(\)/u);
});

test("세 채널이 main 과 preload 양쪽에 있다", () => {
  for (const channel of CHANNELS) {
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), `main.js 에 ${channel} 없음`);
    assert.ok(preloadSource.includes(`"${channel}"`), `preload.js 에 ${channel} 없음`);
  }
});

test("비밀키는 이 PC 의 보안 저장소로 잠가서 둔다", () => {
  const block = mainSource.slice(
    mainSource.indexOf("function ownerOsSettingsFile"),
    mainSource.indexOf("async function sendOwnerOsReport"),
  );
  assert.ok(block.length > 0);
  // 견적 공급자 정보와 같은 방식이어야 한다.
  assert.match(block, /encodeProtectedJson\(safeStorage/u);
  assert.match(block, /decodeProtectedJson\(safeStorage/u);
  assert.match(block, /mode: 0o600/u, "다른 사용자가 읽지 못하게 한다");
  assert.match(block, /PROTECTED_DATA_REQUIRED/u, "암호화 안 된 파일은 열지 않는다");
  // 저장은 관리자만.
  assert.match(block, /user\.role !== "admin"/u);
});

test("비밀키가 화면 쪽으로 건너가지 않는다", () => {
  // 렌더러로 넘기는 순간 개발자도구와 렌더러 메모리에 남는다.
  const loader = mainSource.slice(
    mainSource.indexOf("async function loadOwnerOsSettings"),
    mainSource.indexOf("async function saveOwnerOsSettings"),
  );
  assert.match(loader, /toPublicView/u, "공개용 모양으로만 내보낸다");
  assert.equal(/return .*readOwnerOsSettings\(\)\s*;/u.test(loader), false, "원본을 그대로 돌려주지 않는다");

  // 공개용 모양에 키가 없다는 것은 코어 쪽에서 보장한다.
  const view = Endpoint.toPublicView({
    endpoint: "https://bring-os.example.com/api/ingest/field-report",
    secret: "s3cret-key-abcdefgh",
    companyId: "bring",
  });
  assert.equal(JSON.stringify(view).includes("s3cret-key-abcdefgh"), false);

  // 렌더러 코드가 비밀키를 스스로 들고 있지 않아야 한다.
  assert.doesNotMatch(appSource, /x-bring-report-key/u);
  assert.doesNotMatch(preloadSource, /x-bring-report-key/u);
});

test("연결 실패 문구에 비밀키를 넣지 않는다", () => {
  const sender = mainSource.slice(
    mainSource.indexOf("async function sendOwnerOsReport"),
    mainSource.indexOf("async function sendOwnerOsReport") + 2400,
  );
  // 전송 실패 catch 안에서 원본 error 를 그대로 던지면 요청 정보가 섞여 나갈 수 있다.
  // fetch 호출 자체는 헤더를 써야 하므로, catch 블록만 떼어 확인한다.
  const catchStart = sender.indexOf("} catch (error) {");
  const catchBlock = sender.slice(catchStart, sender.indexOf("}", sender.indexOf("throw Object.assign", catchStart)));
  assert.ok(catchStart > 0, "전송 실패를 잡는 catch 가 있어야 한다");
  assert.match(catchBlock, /대표OS 에 연결하지 못했습니다/u);
  assert.doesNotMatch(catchBlock, /request|settings|secret|error\.message/u, "잡은 오류나 요청 내용을 그대로 내보내지 않는다");
});

test("설정 파일은 CRM 자료 파일과 같은 곳에 둔다", () => {
  assert.match(mainSource, /function ownerOsSettingsFile\(\)[\s\S]{0,160}bring-crm-owner-os\.json/u);
});

// --- 설정 화면 ---

test("설정 화면이 대표OS 연결 칸을 보여준다", () => {
  assert.match(appSource, /function ownerOsCard\(\)/u);
  assert.match(appSource, /\$\{ownerOsCard\(\)\}/u, "설정 화면에 실제로 붙어 있어야 한다");
  assert.match(appSource, /id="ownerOsForm"/u);
  assert.match(appSource, /data-action="owner-os-send"/u);
  // 관리자만.
  const card = appSource.slice(appSource.indexOf("function ownerOsCard"), appSource.indexOf("function renderSettings"));
  assert.match(card, /canAdministerSecurity\(\)/u);
  // 미리보기 주소 함정을 화면에서 미리 알려 준다.
  assert.match(card, /미리보기/u);
});

test("비밀키를 비워 저장해도 기존 연결이 끊기지 않는다", () => {
  const start = appSource.indexOf('form.id === "ownerOsForm"');
  const handler = appSource.slice(start, start + 2000);
  assert.ok(handler.length > 0);
  // 빈 값으로 덮어써서 연결이 끊기면 안 된다.
  assert.match(handler, /비밀키를 바꾸려면 새 값을 입력/u);
  assert.doesNotMatch(handler, /secret: ""/u);
});

test("화면은 비밀키를 저장해 두지 않는다", () => {
  const stateLine = appSource.slice(appSource.indexOf("let ownerOsState ="), appSource.indexOf("async function loadOwnerOsSettingsView"));
  assert.doesNotMatch(stateLine, /secret/u, "상태에 비밀키를 들고 있으면 안 된다");
  // 저장 응답도 공개용 모양(configured/secretHint)만 들어온다.
  assert.match(appSource, /ownerOsState\.view = await api\.saveOwnerOsSettings/u);
});

test("총평은 화면이 지어내지 않는다", () => {
  const sender = appSource.slice(
    appSource.indexOf('action === "owner-os-send"'),
    appSource.indexOf('} else if (action === "restore")'),
  );
  assert.ok(sender.length > 0);
  // qualitative 를 임의 문장으로 채워 보내면 확인 안 된 말이 대표 평가에 들어간다.
  assert.doesNotMatch(sender, /summary:\s*["'`]/u);
  assert.match(sender, /확인 전 초안/u, "왜 비우는지 코드에 남겨 둔다");
});
