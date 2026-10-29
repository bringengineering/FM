import path from "node:path";
import { fileURLToPath } from "node:url";

// Read the existing production configuration; never change it or retrieve secret values.
const SETTINGS_URL = "https://api.cloudflare.com/client/v4/accounts/3c3bcd08bb6ed3a7a8f98c292386c327/workers/scripts/bring-crm-ai-gateway/settings";
const MAX_BYTES = 1024 * 1024;

export function summarizeBindings(bindings) {
  if (!Array.isArray(bindings)) throw new Error("SETTINGS_INVALID");
  const find = name => bindings.find(binding => binding?.name === name);
  const configured = name => {
    const binding = find(name);
    return Boolean(binding && (binding.type === "secret_text" || (binding.type === "plain_text" && typeof binding.text === "string" && binding.text.trim())));
  };
  const flag = name => {
    const binding = find(name);
    return !binding ? false : binding.type === "plain_text" ? binding.text === "true" : null;
  };
  return {
    storagePresent: find("DOCUMENT_DELIVERY")?.type === "kv_namespace",
    accessKeyPresent: configured("NCP_ACCESS_KEY"),
    secretKeyPresent: configured("NCP_SECRET_KEY"),
    serviceIdPresent: configured("NCP_BIZ_MESSAGE_SERVICE_ID"),
    channelIdPresent: configured("KAKAO_CHANNEL_ID"),
    deliveryEnabled: flag("DOCUMENT_DELIVERY_ENABLED"),
    documentTemplatesApprovedFlag: flag("KAKAO_DOCUMENT_TEMPLATES_APPROVED"),
    monthlyReportEnabledFlag: flag("KAKAO_MONTHLY_REPORT_ENABLED"),
    monthlyBrandEnabledFlag: flag("KAKAO_MONTHLY_BRAND_ENABLED"),
  };
}

export async function checkDocumentDelivery({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || !token.trim()) throw new Error("CLOUDFLARE_AUTH_REQUIRED");
  const response = await fetchImpl(SETTINGS_URL, {
    method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("SETTINGS_READ_FAILED"); }
  let total = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw new Error("SETTINGS_TOO_LARGE");
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("SETTINGS_INVALID"); }
  if (value?.success !== true) throw new Error("SETTINGS_READ_FAILED");
  return summarizeBindings(value.result?.bindings);
}

export function requireApprovedDocumentDelivery(status) {
  const required = ["storagePresent", "accessKeyPresent", "secretKeyPresent", "serviceIdPresent", "channelIdPresent", "deliveryEnabled", "documentTemplatesApprovedFlag", "monthlyReportEnabledFlag"];
  if (!status || required.some(name => status[name] !== true) || status.monthlyBrandEnabledFlag !== false) {
    throw new Error("APPROVED_DOCUMENT_DELIVERY_NOT_READY");
  }
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--require-approved-documents")) throw new Error("INVALID_ARGUMENT");
    const status = await checkDocumentDelivery({ token: process.env.CLOUDFLARE_API_TOKEN });
    if (args.length === 1) requireApprovedDocumentDelivery(status);
    console.log(JSON.stringify(status, null, 2));
    console.log("Read-only configuration check. Flags do not prove provider approval or message delivery.");
  } catch {
    // API errors may contain sensitive configuration. Do not print their body or stack.
    console.error("Document delivery configuration could not be checked. No settings were changed.");
    process.exitCode = 1;
  }
}
