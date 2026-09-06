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
