const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const Core = require("../src/core");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");

const CHANNELS = [
  "crm:drive-status",
  "crm:drive-connect",
  "crm:drive-disconnect",
  "crm:building-document-pick",
  "crm:building-document-upload",
];

test("Drive 채널이 정책에 등록돼 있다", () => {
  for (const channel of CHANNELS) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), `${channel} 미등록`);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), `main.js 에 ${channel} 없음`);
    assert.ok(preloadSource.includes(`"${channel}"`), `preload.js 에 ${channel} 없음`);
  }
  assert.equal(MutationPolicy.classification("crm:drive-status"), "control");
  // 연결과 업로드는 밖으로 나가는 행위라 mutation 이어야 한다.
  assert.equal(MutationPolicy.classification("crm:drive-connect"), "mutation");
  assert.equal(MutationPolicy.classification("crm:building-document-upload"), "mutation");
});

test("마케팅 전용 계정은 서류를 올리지 못한다", () => {
  const marketingOnly = { accessRole: "member", marketingRole: "marketing" };
  for (const channel of ["crm:drive-connect", "crm:building-document-upload"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, marketingOnly),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      `${channel} 이 막히지 않는다`,
    );
  }
  // main.js 안에도 같은 방어가 한 번 더 있다.
  const uploader = mainSource.slice(
    mainSource.indexOf("async function uploadBuildingDocument"),
    mainSource.indexOf("async function uploadBuildingDocument") + 1200,
  );
  assert.match(uploader, /isMarketingOnlySession\(\)/u);
});

test("고르지 않은 파일은 올리지 않는다", () => {
  // 화면이 아무 경로나 보내 서버 파일을 읽게 하면 안 된다.
  const uploader = mainSource.slice(
    mainSource.indexOf("async function uploadBuildingDocument"),
    mainSource.indexOf("async function uploadBuildingDocument") + 1600,
  );
  assert.match(uploader, /pickedDocumentPaths\.has\(filePath\)/u);
  assert.match(uploader, /FILE_NOT_PICKED/u);
  const readIndex = uploader.indexOf("fs.readFile(filePath)");
  const guardIndex = uploader.indexOf("pickedDocumentPaths.has(filePath)");
  assert.ok(guardIndex >= 0 && guardIndex < readIndex, "검사가 파일 읽기보다 앞이어야 한다");
});

test("파일 내용은 화면 쪽으로 건너가지 않는다", () => {
  // 100MB 를 base64 로 바꾸면 133MB 문자열이 된다. 경로만 넘기고 읽기는 main 에서 한다.
  const picker = mainSource.slice(
    mainSource.indexOf("async function pickBuildingDocuments"),
    mainSource.indexOf("async function uploadBuildingDocument"),
  );
  assert.ok(picker.length > 0);
  assert.doesNotMatch(picker, /toString\("base64"\)|fileBody/u);
  assert.match(picker, /filePath,/u);
});

test("Drive 토큰은 디스크에 남기지 않는다", () => {
  // 왜 저장하지 않는지 적어 둔 머리말까지 포함해서 본다.
  const block = mainSource.slice(
    mainSource.indexOf("// --- 건물 문서함 Drive 연결"),
    mainSource.indexOf("async function pickBuildingDocuments"),
  );
  assert.ok(block.length > 0);
  // 한 시간이면 만료되는 값이라 저장할 이유가 없고, 저장 안 하면 샐 자리도 없다.
  assert.doesNotMatch(block, /encodeProtectedJson|writeFile|safeStorage/u);
  assert.match(block, /메모리에만 둔다/u);
});

test("화면 상태에 Drive 토큰을 들고 있지 않다", () => {
  const state = appSource.slice(
    appSource.indexOf("let driveState ="),
    appSource.indexOf("async function refreshDriveStatus"),
  );
  assert.ok(state.length > 0);
  assert.doesNotMatch(state, /token/iu);
  assert.doesNotMatch(appSource, /accessToken/u, "렌더러는 토큰을 만지지 않는다");
});

test("만료된 연결은 끊긴 것으로 본다", () => {
  const view = mainSource.slice(
    mainSource.indexOf("function driveSessionView"),
    mainSource.indexOf("async function connectDrive"),
  );
  assert.match(view, /Date\.parse\(driveSession\.expiresAt\) <= Date\.now\(\)/u);
  assert.match(view, /driveSession = null/u);
});

test("올리기와 문서함 연결이 한 번에 일어난다", () => {
  // 나눠 두면 올려놓고 연결을 빠뜨려서 문서함이 "없다" 고 말하게 된다.
  const flow = appSource.slice(
    appSource.indexOf("async function uploadBuildingDocuments"),
    appSource.indexOf("function askBuildingDocType"),
  );
  assert.ok(flow.length > 0);
  assert.match(flow, /api\.uploadBuildingDocument\(/u);
  assert.match(flow, /store\.buildingDocuments/u);
  assert.match(flow, /scheduleSave\(\)/u);
  const uploadIndex = flow.indexOf("api.uploadBuildingDocument(");
  const linkIndex = flow.indexOf("store.buildingDocuments");
  assert.ok(uploadIndex < linkIndex, "올린 다음 연결한다");
});

test("한 건이라도 실패하면 되돌린다", () => {
  const flow = appSource.slice(
    appSource.indexOf("async function uploadBuildingDocuments"),
    appSource.indexOf("function askBuildingDocType"),
  );
  // 반쯤 연결된 상태로 남으면 무엇이 올라갔는지 아무도 모른다.
  assert.match(flow, /store = cloneStore\(beforeStore\)/u);
});

test("이미 올라와 있던 파일은 세지 않고 따로 알린다", () => {
  const flow = appSource.slice(
    appSource.indexOf("async function uploadBuildingDocuments"),
    appSource.indexOf("function askBuildingDocType"),
  );
  assert.match(flow, /alreadyThere/u);
  assert.match(flow, /이미 올라와 있던/u);
});

test("문서함 폴더는 회사 설정에 저장된다", () => {
  const store = Core.blankSharedStore();
  assert.equal(typeof store.company.buildingDocsFolderId, "string");
  // 주소를 붙여넣어도 ID 만 저장한다.
  assert.match(appSource, /BuildingDocs\.extractDriveFileId\(raw\.folderRef\)/u);
  assert.match(appSource, /buildingDocsFolderId: folderId/u);
});

test("폴더가 없거나 연결이 없으면 올리기 버튼을 내지 않는다", () => {
  const view = appSource.slice(
    appSource.indexOf("function renderBuildingDocuments"),
    appSource.indexOf("function buildingDocsFolderEditor"),
  );
  assert.match(view, /const canUpload = canWriteCRM\(\) && selected && Boolean\(rootFolderId\)/u);
  assert.match(view, /canUpload && driveState\.connected/u);
  // 대신 무엇이 빠졌는지 한 줄로 알려 준다.
  assert.match(view, /Drive 폴더가 아직 없습니다/u);
  assert.match(view, /Drive 에 연결되지 않았습니다/u);
});
