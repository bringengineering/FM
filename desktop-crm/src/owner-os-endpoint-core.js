// 대표OS 로 보고를 보낼 주소와 비밀키를 다루는 규칙.
//
// 비밀키가 사용자 PC 에 남고 네트워크로 나가는 값이라, 이 파일이 지키는 선이
// 몇 개 있다. 전부 테스트로 박아 뒀다.
//
//  1. https 아니면 받지 않는다. http 로 보내면 키가 그대로 흘러간다.
//     예외는 localhost 하나뿐이고, 그건 개발 중 확인용이다.
//  2. 비밀키를 화면으로 돌려주지 않는다. 화면은 "설정됨/안 됨" 과 끝 네 자리만
//     알면 된다. 돌려주는 순간 렌더러 메모리와 개발자도구에 남는다.
//  3. 오류 문구에 키를 넣지 않는다. 로그와 화면에 남는 경로다.
(function attachOwnerOsEndpointCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOwnerOsEndpointCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createOwnerOsEndpointCore() {
  "use strict";

  const MIN_SECRET_LENGTH = 16;
  const MAX_SECRET_LENGTH = 200;
  const REPORT_PATH = "/api/ingest/field-report";

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function fail(message, code) {
    return Object.assign(new Error(message), { code });
  }

  // 개발 중 확인용으로만 http 를 연다. 그 외에는 https 만 받는다.
  function isLocalhost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  }

  function normalizeEndpointUrl(input) {
    const raw = text(input);
    if (!raw) throw fail("대표OS 주소를 입력해 주세요.", "ENDPOINT_REQUIRED");
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw fail("대표OS 주소 형식이 올바르지 않습니다.", "ENDPOINT_INVALID");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
      throw fail("대표OS 주소는 https 여야 합니다. http 로 보내면 비밀키가 그대로 노출됩니다.", "ENDPOINT_INSECURE");
    }
    if (url.username || url.password) {
      // 주소에 박힌 자격증명은 로그·히스토리에 남는다.
      throw fail("주소에 아이디·비밀번호를 넣지 말아 주세요.", "ENDPOINT_INVALID");
    }
    if (url.search || url.hash) throw fail("주소에 물음표·해시 없이 넣어 주세요.", "ENDPOINT_INVALID");

    // 사용자가 홈 주소만 넣어도, 보고 경로까지 넣어도 같은 곳을 가리키게 한다.
    const base = url.pathname.replace(/\/+$/, "");
    const pathname = base.endsWith(REPORT_PATH) ? base : `${base}${REPORT_PATH}`;
    return `${url.origin}${pathname}`;
  }

  function normalizeSecret(input) {
    const secret = text(input);
    if (!secret) throw fail("대표OS 비밀키를 입력해 주세요.", "SECRET_REQUIRED");
    if (secret.length < MIN_SECRET_LENGTH) {
      throw fail(`비밀키는 ${MIN_SECRET_LENGTH}자 이상이어야 합니다.`, "SECRET_TOO_SHORT");
    }
    if (secret.length > MAX_SECRET_LENGTH) throw fail("비밀키가 너무 깁니다.", "SECRET_TOO_LONG");
    // 헤더로 나가는 값이라 줄바꿈·제어문자가 섞이면 헤더가 쪼개진다.
    if (/[^\x21-\x7E]/.test(secret)) {
      throw fail("비밀키에는 공백·줄바꿈·한글을 넣을 수 없습니다.", "SECRET_INVALID");
    }
    return secret;
  }

  // 화면에 보여줄 수 있는 만큼만. 앞은 가리고 끝 네 자리만 남긴다.
  function maskSecret(secret) {
    const value = text(secret);
    if (!value) return "";
    return value.length <= 4 ? "•".repeat(value.length) : `${"•".repeat(4)}${value.slice(-4)}`;
  }

  /** 저장할 값으로 다듬는다. 저장은 부르는 쪽이 safeStorage 로 암호화해서 한다. */
  function normalizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      endpoint: normalizeEndpointUrl(source.endpoint),
      secret: normalizeSecret(source.secret),
      companyId: text(source.companyId) || "bring",
    };
  }

  /**
   * 화면으로 돌려줄 모양. **비밀키 자체는 절대 넣지 않는다.**
   * 화면은 설정됐는지와 끝 네 자리만 알면 된다.
   */
  function toPublicView(settings) {
    const source = settings && typeof settings === "object" ? settings : null;
    if (!source || !text(source.endpoint) || !text(source.secret)) {
      return { configured: false, endpoint: "", secretHint: "", companyId: "" };
    }
    return {
      configured: true,
      endpoint: text(source.endpoint),
      secretHint: maskSecret(source.secret),
      companyId: text(source.companyId) || "bring",
    };
  }

  /** 보낼 요청의 모양. 부르는 쪽은 이걸 그대로 fetch 에 넘긴다. */
  function buildRequest(settings, envelope) {
    const normalized = normalizeSettings(settings);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw fail("보낼 보고 내용이 없습니다.", "ENVELOPE_REQUIRED");
    }
    return {
      url: normalized.endpoint,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bring-report-key": normalized.secret,
      },
      body: JSON.stringify(envelope),
    };
  }

  /**
   * 받는 쪽 응답을 사람이 읽을 말로 바꾼다.
   * 미리보기 주소로 보내면 Vercel 이 앞에서 401 을 주는데, 그때 "키가 틀렸다"
   * 로만 안내하면 맞는 키를 계속 의심하게 된다. 그 경우를 따로 짚는다.
   */
  function describeResponse(status, body, endpoint) {
    const code = Number(status);
    if (code === 200) return { ok: true, message: "대표OS 에 보고를 올렸습니다." };
    if (code === 401) {
      const looksLikeVercelGate = typeof body === "string" && /vercel_auth|Protected deployment/i.test(body);
      const preview = /\bgit-[a-z0-9-]+.*\.vercel\.app$/i.test(hostOf(endpoint));
      if (looksLikeVercelGate || preview) {
        return {
          ok: false,
          message: "미리보기 주소는 Vercel 이 앞에서 막습니다. 대표OS 운영 주소로 바꿔 주세요.",
          code: "ENDPOINT_PREVIEW_BLOCKED",
        };
      }
      return { ok: false, message: "대표OS 비밀키가 맞지 않거나 대표OS 쪽 설정이 비어 있습니다.", code: "UNAUTHORIZED" };
    }
    if (code === 400) {
      const reason = typeof body === "string" && body.length < 300 ? body : "";
      return { ok: false, message: `대표OS 가 보고 형식을 거절했습니다.${reason ? ` (${reason})` : ""}`, code: "REJECTED" };
    }
    if (code === 405) return { ok: false, message: "대표OS 주소가 보고 경로가 아닙니다.", code: "ENDPOINT_INVALID" };
    if (code >= 500) return { ok: false, message: "대표OS 가 보고를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "STORE_FAILED" };
    return { ok: false, message: `대표OS 가 응답을 거절했습니다. (HTTP ${code})`, code: "UNEXPECTED" };
  }

  function hostOf(endpoint) {
    try {
      return new URL(text(endpoint)).hostname;
    } catch {
      return "";
    }
  }

  return Object.freeze({
    normalizeSettings,
    normalizeEndpointUrl,
    normalizeSecret,
    maskSecret,
    toPublicView,
    buildRequest,
    describeResponse,
    REPORT_PATH,
    MIN_SECRET_LENGTH,
  });
});
