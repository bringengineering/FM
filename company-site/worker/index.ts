/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

const CONSULT_EMAIL = "bringengineering1008@gmail.com";
const CONSULT_PROVIDER_URL = `https://formsubmit.co/ajax/${CONSULT_EMAIL}`;
const CONSULT_CANONICAL_ORIGIN = "https://bring-fm-hj.web.app";
const CONSULT_ALLOWED_ORIGINS = new Set([
  CONSULT_CANONICAL_ORIGIN,
  "https://bring-care-fm.bringengineering1008.chatgpt.site",
]);
const CONSULT_ALLOWED_FIELDS = [
  "_subject",
  "_template",
  "_captcha",
  "_honey",
  "성명",
  "연락처",
  "이메일",
  "건물 유형",
  "건물 위치",
  "관심 서비스",
  "문의 내용",
  "접수 시각",
  "email",
] as const;

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function consultCorsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function consultJson(
  origin: string,
  body: { success: boolean; message: string },
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: consultCorsHeaders(origin),
  });
}

async function handleConsultRequest(request: Request) {
  const origin = request.headers.get("Origin") || "";

  if (!CONSULT_ALLOWED_ORIGINS.has(origin)) {
    return consultJson(
      "",
      {
        success: false,
        message: "허용되지 않은 홈페이지에서 전송된 요청입니다.",
      },
      403,
    );
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: consultCorsHeaders(origin),
    });
  }

  if (request.method !== "POST") {
    return consultJson(
      origin,
      {
        success: false,
        message: "지원하지 않는 요청 방식입니다.",
      },
      405,
    );
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 32_000) {
    return consultJson(
      origin,
      {
        success: false,
        message: "입력 내용이 너무 깁니다. 내용을 줄여 다시 신청해 주세요.",
      },
      413,
    );
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return consultJson(
      origin,
      {
        success: false,
        message: "상담 신청 내용을 확인할 수 없습니다.",
      },
      400,
    );
  }

  if (String(incoming.get("_honey") || "").trim()) {
    return consultJson(origin, {
      success: true,
      message: "상담 신청이 전송되었습니다.",
    });
  }

  const requiredFields = ["성명", "연락처", "건물 유형", "문의 내용"];
  const missingRequired = requiredFields.some(
    (field) => !String(incoming.get(field) || "").trim(),
  );
  if (missingRequired) {
    return consultJson(
      origin,
      {
        success: false,
        message: "필수 입력 항목을 모두 작성해 주세요.",
      },
      400,
    );
  }

  const outgoing = new FormData();
  for (const field of CONSULT_ALLOWED_FIELDS) {
    const value = incoming.get(field);
    if (typeof value !== "string") continue;
    outgoing.append(field, value.slice(0, field === "문의 내용" ? 4000 : 500));
  }
  outgoing.set("_captcha", "false");

  try {
    const providerResponse = await fetch(CONSULT_PROVIDER_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Origin: CONSULT_CANONICAL_ORIGIN,
        Referer: `${CONSULT_CANONICAL_ORIGIN}/consult`,
      },
      body: outgoing,
    });
    const providerResult = (await providerResponse.json()) as {
      success?: boolean | string;
    };
    const succeeded =
      providerResponse.ok &&
      (providerResult.success === true || providerResult.success === "true");

    if (!succeeded) {
      return consultJson(
        origin,
        {
          success: false,
          message:
            "메일 전송 서비스가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.",
        },
        502,
      );
    }

    return consultJson(origin, {
      success: true,
      message: "상담 신청이 이메일로 전송되었습니다.",
    });
  } catch {
    return consultJson(
      origin,
      {
        success: false,
        message:
          "메일 전송 중 연결 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      502,
    );
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/consult") {
      return handleConsultRequest(request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
