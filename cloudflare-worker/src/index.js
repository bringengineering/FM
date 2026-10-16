const SERVICE_NAME = "bring-care-kakao-intake";
const SERVICE_VERSION = "2026-07-27-v2";
const KAKAO_SKILL_PATH = "/kakao/intake";
const MAX_REQUEST_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 4800;
const KEEPALIVE_TIMEOUT_MS = 15000;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function kakaoTextResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text
          }
        }
      ]
    }
  };
}

function temporaryFailureResponse() {
  return jsonResponse(
    kakaoTextResponse(
      "민원 접수 연결이 잠시 원활하지 않습니다. 잠시 후 다시 시도해 주세요."
    )
  );
}

function isKakaoSkillPayload(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      payload.bot &&
      typeof payload.bot === "object" &&
      payload.action &&
      typeof payload.action === "object" &&
      payload.userRequest &&
      typeof payload.userRequest === "object" &&
      payload.userRequest.user &&
      typeof payload.userRequest.user === "object"
  );
}

function isKakaoSkillResponse(payload) {
  return Boolean(
    payload &&
      payload.version === "2.0" &&
      payload.template &&
      Array.isArray(payload.template.outputs)
  );
}

async function readKakaoPayload(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return { error: jsonResponse({ ok: false, error: "payload_too_large" }, 413) };
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return { error: jsonResponse({ ok: false, error: "payload_too_large" }, 413) };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_error) {
    return { error: jsonResponse({ ok: false, error: "invalid_json" }, 400) };
  }

  if (!isKakaoSkillPayload(payload)) {
    return { error: jsonResponse({ ok: false, error: "invalid_kakao_payload" }, 400) };
  }

  return { rawBody };
}

async function forwardKakaoRequest(request, env) {
  if (!env.APPS_SCRIPT_SKILL_URL) {
    return temporaryFailureResponse();
  }

  const parsed = await readKakaoPayload(request);
  if (parsed.error) return parsed.error;

  try {
    const upstream = await fetch(env.APPS_SCRIPT_SKILL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "user-agent": "BRING-Care-Kakao-Intake/1.0"
      },
      body: parsed.rawBody,
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });

    if (!upstream.ok) return temporaryFailureResponse();

    const responseText = await upstream.text();
    let responsePayload;
    try {
      responsePayload = JSON.parse(responseText);
    } catch (_error) {
      return temporaryFailureResponse();
    }

    if (!isKakaoSkillResponse(responsePayload)) {
      return temporaryFailureResponse();
    }

    return jsonResponse(responsePayload);
  } catch (_error) {
    return temporaryFailureResponse();
  }
}

async function keepAppsScriptWarm(env) {
  if (!env.APPS_SCRIPT_SKILL_URL) return;
  const payload = {
    version: "2.0",
    bot: { id: "bring-care-keepalive" },
    action: {
      id: "bring-care-keepalive",
      name: "__bringcare_keepalive__",
      params: {},
      detailParams: {},
      clientExtra: {}
    },
    userRequest: {
      block: { id: "bring-care-keepalive", name: "keepalive" },
      user: {
        id: "bring-care-keepalive",
        type: "botUserKey",
        properties: { botUserKey: "bring-care-keepalive" }
      },
      utterance: "",
      lang: "ko",
      timezone: "Asia/Seoul"
    }
  };

  try {
    await fetch(env.APPS_SCRIPT_SKILL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "user-agent": "BRING-Care-Kakao-Keepalive/1.0"
      },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: AbortSignal.timeout(KEEPALIVE_TIMEOUT_MS)
    });
  } catch (_error) {
    // The next scheduled run retries automatically. No secret or payload is logged.
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({
        ok: true,
        service: SERVICE_NAME,
        version: SERVICE_VERSION
      });
    }

    if (url.pathname !== KAKAO_SKILL_PATH) {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    return forwardKakaoRequest(request, env);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(keepAppsScriptWarm(env));
  }
};
