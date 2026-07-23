import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: {
        accept: "text/html",
        host: "localhost",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Bring Care company website", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"/i);
  assert.match(html, /Bring Care \| 브링엔지니어링 시설관리/);
  assert.match(html, /관리의 모든 흐름을/);
  assert.match(html, /건물의 오늘을 돌보고/);
  assert.match(html, /hero-fm\.png/);
  assert.match(html, /브링엔지니어링/);
  assert.match(html, /748-28-01935/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  assert.doesNotMatch(html, /365일|24시간 출동/);
});

test("server-renders the consultation page with direct contacts", async () => {
  const response = await render("/consult");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /상담 신청 \| Bring Care/);
  assert.match(html, /010-6566-3606/);
  assert.match(html, /bringengineering1008@gmail\.com/);
  assert.match(html, /상담 신청 전송/);
  assert.match(html, /전송 대행 서비스/);
});

test("server-renders the consultation completion page", async () => {
  const response = await render("/consult/complete");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /상담 신청 발송 완료 \| Bring Care/);
  assert.match(html, /발송 완료되었습니다/);
  assert.match(html, /담당 이메일로 전달되었습니다/);
  assert.match(html, /010-6566-3606/);
});

test("consultation API allows only the published Bring Care sites", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  };

  const rejected = await worker.fetch(
    new Request("http://localhost/api/consult", {
      method: "POST",
      headers: {
        origin: "https://example.com",
      },
      body: new FormData(),
    }),
    env,
    ctx,
  );
  assert.equal(rejected.status, 403);

  const preflight = await worker.fetch(
    new Request("http://localhost/api/consult", {
      method: "OPTIONS",
      headers: {
        origin: "https://bring-fm-hj.web.app",
      },
    }),
    env,
    ctx,
  );
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://bring-fm-hj.web.app",
  );
});
