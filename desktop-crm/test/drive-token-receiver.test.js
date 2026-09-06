const assert = require("node:assert/strict");
const test = require("node:test");

const { FirebaseRemoteClient } = require("../src/remote");

// 브라우저 콜백을 흉내 낸다. 실제 창을 열지 않고, 열린 주소와 돌려준 값만 본다.
function harness({ post, openFails = false } = {}) {
  const opened = [];
  const client = Object.create(FirebaseRemoteClient.prototype);
  client.firebase = { authPageUrl: "https://bring-fm.web.app/crm-auth/" };
  client.openGoogleAuth = async url => {
    opened.push(url);
    if (openFails) throw new Error("browser missing");
    const target = new URL(url);
    const port = Number(target.searchParams.get("port"));
    const state = target.searchParams.get("state") || "";
    const body = new URLSearchParams(post(state)).toString();
    // 브라우저가 하듯 로컬 콜백으로 POST 한다.
    const response = await fetch(`http://127.0.0.1:${port}/callback`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    await response.text();
  };
  return { client, opened };
}

const rejectsCode = async (promise, code) => {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code, `기대한 코드 ${code}, 실제 ${error && error.code}`);
    return true;
  });
};

test("Drive 연결은 로그인과 다른 페이지를 연다", async () => {
  // 로그인 페이지에 Drive 를 얹지 않았다. 여기가 깨져도 로그인은 멀쩡해야 한다.
  const { client, opened } = harness({
    post: state => ({ state, drive_access_token: "ya29.token", drive_token_expires_in: "3599" }),
  });
  await client.receiveDriveToken();
  assert.equal(opened.length, 1);
  assert.match(opened[0], /\/crm-drive-auth\//u);
  assert.doesNotMatch(opened[0], /\/crm-auth\//u);
});

test("접근 토큰과 만료 시각을 함께 돌려준다", async () => {
  const { client } = harness({
    post: state => ({
      state,
      drive_access_token: "ya29.token",
      drive_token_expires_in: "3599",
      drive_account_email: "bringengineering1008@gmail.com",
    }),
  });
  const result = await client.receiveDriveToken();
  assert.equal(result.accessToken, "ya29.token");
  assert.equal(result.email, "bringengineering1008@gmail.com");
  const remaining = Date.parse(result.expiresAt) - Date.now();
  assert.ok(remaining > 3_500_000 && remaining <= 3_600_000, `만료까지 ${remaining}ms`);
});

test("만료 시간을 안 주면 한 시간으로 본다", async () => {
  const { client } = harness({ post: state => ({ state, drive_access_token: "ya29.token" }) });
  const result = await client.receiveDriveToken();
  const remaining = Date.parse(result.expiresAt) - Date.now();
  assert.ok(remaining > 3_500_000, "기본값이 있어야 한다");
});

test("확인값이 다르면 받지 않는다", async () => {
  // 다른 창에서 온 응답을 받아들이면 안 된다.
  const { client } = harness({
    post: () => ({ state: "다른값".padEnd(40, "x"), drive_access_token: "ya29.token" }),
  });
  await rejectsCode(client.receiveDriveToken(), "DRIVE_CONNECT_FAILED");
});

test("로그인 토큰이 이 길로 들어오면 거절한다", async () => {
  // 두 길이 섞이면 Drive 연결만 한 사람이 로그인한 것처럼 보일 수 있다.
  const { client } = harness({
    post: state => ({ state, drive_access_token: "ya29.token", provider_token: "id-token" }),
  });
  await rejectsCode(client.receiveDriveToken(), "DRIVE_CONNECT_FAILED");
});

test("토큰이 없거나 지나치게 길면 거절한다", async () => {
  const empty = harness({ post: state => ({ state, drive_access_token: "" }) });
  await rejectsCode(empty.client.receiveDriveToken(), "DRIVE_CONNECT_FAILED");

  const huge = harness({ post: state => ({ state, drive_access_token: "x".repeat(12001) }) });
  await rejectsCode(huge.client.receiveDriveToken(), "DRIVE_CONNECT_FAILED");
});

test("페이지가 오류를 돌려주면 그대로 알린다", async () => {
  const { client } = harness({ post: state => ({ state, error: "DRIVE_SCOPE_DECLINED" }) });
  await assert.rejects(client.receiveDriveToken(), error => {
    assert.equal(error.code, "DRIVE_CONNECT_FAILED");
    assert.match(error.message, /DRIVE_SCOPE_DECLINED/u);
    return true;
  });
});

test("브라우저를 못 열면 그 자리에서 알린다", async () => {
  const { client } = harness({ post: state => ({ state }), openFails: true });
  await rejectsCode(client.receiveDriveToken(), "DRIVE_CONNECT_FAILED");
});

test("취소하면 취소로 끝난다", async () => {
  const controller = new AbortController();
  const client = Object.create(FirebaseRemoteClient.prototype);
  client.firebase = { authPageUrl: "https://bring-fm.web.app/crm-auth/" };
  client.openGoogleAuth = async () => { controller.abort(); };
  await rejectsCode(client.receiveDriveToken({ signal: controller.signal }), "DRIVE_CONNECT_CANCELLED");
});

// --- 창을 여는 쪽 ---
// 이 파일의 다른 테스트들은 openGoogleAuth 를 가짜로 바꿔치기해서 돌린다.
// 그래서 "응답을 잘 받는지" 는 검사했지만 "진짜 창 여는 코드가 이 주소를
// 허용하는지" 는 검사하지 않았다. 대표가 실제로 눌렀을 때 창이 아예 안 열려서
// 알게 됐다. 여기서 그 구멍을 막는다.
const { crmAuthPageKind } = require("../src/field-view-policy");
const fs = require("node:fs");
const path = require("node:path");
const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

const authUrl = (pathname, port = 51234) =>
  `https://bring-fm.web.app${pathname}?port=${port}&state=${"a".repeat(43)}`;

test("Drive 연결 페이지도 창을 열 수 있다", () => {
  assert.equal(crmAuthPageKind(authUrl("/crm-drive-auth/")), "drive");
  assert.equal(crmAuthPageKind(authUrl("/crm-auth/")), "login");
});

test("그 둘 말고는 창을 열지 않는다", () => {
  for (const bad of [
    authUrl("/crm-drive-auth"),            // 슬래시 없는 형태는 CRM 이 만들지 않는다
    authUrl("/"),
    authUrl("/crm-auth/../evil/"),
    "https://evil.example.com/crm-drive-auth/?port=51234",
    "https://bring-fm.web.app.evil.com/crm-drive-auth/?port=51234",
    "http://bring-fm.web.app/crm-drive-auth/?port=51234",
    "https://user:pw@bring-fm.web.app/crm-drive-auth/?port=51234",
    "not a url",
    "",
  ]) assert.equal(crmAuthPageKind(bad), "", `${bad} 가 통과했다`);
});

test("돌아올 포트가 없거나 이상하면 열지 않는다", () => {
  // 열어 봐야 응답을 받을 곳이 없다.
  assert.equal(crmAuthPageKind("https://bring-fm.web.app/crm-drive-auth/"), "");
  assert.equal(crmAuthPageKind(authUrl("/crm-drive-auth/", 80)), "");
  assert.equal(crmAuthPageKind(authUrl("/crm-drive-auth/", 70000)), "");
  assert.equal(crmAuthPageKind(authUrl("/crm-drive-auth/", "abc")), "");
});

test("이메일 로그인은 Drive 페이지로 못 간다", () => {
  // 두 길이 섞이면 안 된다.
  const emailOpener = mainSource.slice(
    mainSource.indexOf("async function openCrmEmailAuth"),
    mainSource.indexOf("async function openCrmEmailAuth") + 400,
  );
  assert.match(emailOpener, /crmAuthPageKind\(target\.toString\(\)\) !== "login"/u);
});

test("Drive 가 여는 주소와 허용 목록이 실제로 맞는다", () => {
  // 받는 쪽이 만드는 주소를 그대로 허용 목록에 넣어 본다. 두 곳이 따로
  // 움직이면 또 같은 일이 난다.
  const client = Object.create(FirebaseRemoteClient.prototype);
  client.firebase = { authPageUrl: "https://bring-fm.web.app/crm-auth/" };
  let openedUrl = "";
  client.openGoogleAuth = async url => { openedUrl = url; throw new Error("stop here"); };
  return client.receiveDriveToken().catch(() => {
    assert.ok(openedUrl, "주소를 만들어 열려고는 해야 한다");
    assert.equal(crmAuthPageKind(openedUrl), "drive", `허용 목록이 ${openedUrl} 를 거절한다`);
  });
});

test("창을 닫으면 Drive 연결도 그 자리에서 끝난다", () => {
  // 창만 닫히고 기다리는 쪽이 살아 있으면, 콜백을 받는 로컬 서버가 3분 동안
  // 남고 다시 누를수록 쌓인다. 사용자는 멈춘 줄도 모른다.
  const connect = mainSource.slice(
    mainSource.indexOf("async function connectDrive"),
    mainSource.indexOf("async function connectDrive") + 900,
  );
  assert.match(connect, /receiveDriveToken\(\{ signal: controller\.signal \}\)/u, "신호를 넘겨야 한다");
  // 다시 누르면 앞선 시도를 먼저 끊는다.
  assert.match(connect, /if \(driveConnectAbortController\) driveConnectAbortController\.abort\(\)/u);
  // 끝나면 치운다.
  assert.match(connect, /finally \{[\s\S]*driveConnectAbortController = null/u);

  // 창이 닫힐 때 실제로 그 신호를 끊는지.
  const opener = mainSource.slice(
    mainSource.indexOf("async function openCrmGoogleAuth"),
    mainSource.indexOf("async function openCrmEmailAuth"),
  );
  assert.match(opener, /const driveAbortController = driveConnectAbortController;/u);
  assert.match(opener, /driveConnectAbortController === driveAbortController[\s\S]*driveAbortController\.abort\(\)/u);
});
