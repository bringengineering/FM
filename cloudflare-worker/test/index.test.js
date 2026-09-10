import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const skillPayload = {
  version: "2.0",
  bot: { id: "bringcare-bot" },
  action: {
    id: "complaint-intake",
    name: "브링케어 민원 접수",
    params: {},
    detailParams: {},
    clientExtra: {}
  },
  userRequest: {
    block: { id: "complaint-block", name: "민원 접수" },
    user: {
      id: "bot-user-key-001",
      type: "botUserKey",
      properties: { botUserKey: "bot-user-key-001" }
    },
    utterance: "민원 접수",
    lang: "ko",
    timezone: "Asia/Seoul"
  }
};

const upstreamResponse = {
  version: "2.0",
  template: {
    outputs: [{ simpleText: { text: "건물명을 입력해 주세요." } }]
  }
};

test("health endpoint returns the deployed service identity", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/health"),
    {}
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "bring-care-kakao-intake",
    version: "2026-07-27-v2"
  });
});

test("only the Kakao intake path accepts POST requests", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/kakao/intake", { method: "GET" }),
    {}
  );

  assert.equal(response.status, 405);
  assert.equal((await response.json()).error, "method_not_allowed");
});

test("invalid Kakao payloads are rejected before reaching Apps Script", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/kakao/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "healthCheck" })
    }),
    { APPS_SCRIPT_SKILL_URL: "https://script.example/skill" }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_kakao_payload");
});

test("valid requests are relayed to Apps Script with redirects enabled", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify(upstreamResponse), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example/kakao/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(skillPayload)
      }),
      { APPS_SCRIPT_SKILL_URL: "https://script.example/skill?token=secret" }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), upstreamResponse);
    assert.equal(captured.url, "https://script.example/skill?token=secret");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.redirect, "follow");
    assert.deepEqual(JSON.parse(captured.options.body), skillPayload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstream failures return a valid Kakao message without leaking details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("upstream secret and internal failure");
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example/kakao/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(skillPayload)
      }),
      { APPS_SCRIPT_SKILL_URL: "https://script.example/skill?token=secret" }
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.version, "2.0");
    assert.match(payload.template.outputs[0].simpleText.text, /잠시 후 다시/);
    assert.doesNotMatch(JSON.stringify(payload), /secret|internal failure/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled keepalive warms Apps Script without creating a complaint session", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  let pending;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify(upstreamResponse), { status: 200 });
  };

  try {
    await worker.scheduled(
      { cron: "* * * * *" },
      { APPS_SCRIPT_SKILL_URL: "https://script.example/skill?token=secret" },
      {
        waitUntil(promise) {
          pending = promise;
        }
      }
    );
    await pending;

    assert.equal(captured.url, "https://script.example/skill?token=secret");
    assert.equal(captured.options.method, "POST");
    const payload = JSON.parse(captured.options.body);
    assert.equal(payload.action.name, "__bringcare_keepalive__");
    assert.equal(payload.userRequest.user.id, "bring-care-keepalive");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
