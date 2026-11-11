import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkDocumentDelivery, requireApprovedDocumentDelivery, summarizeBindings } from "../scripts/check-document-delivery.mjs";

test("configuration diagnostics expose only presence and explicit approval flags", () => {
  const bindings = [
    { name: "DOCUMENT_DELIVERY", type: "kv_namespace", namespace_id: "private-storage" },
    ...["NCP_ACCESS_KEY", "NCP_SECRET_KEY", "NCP_BIZ_MESSAGE_SERVICE_ID", "KAKAO_CHANNEL_ID"].map(name => ({ name, type: "secret_text", text: "must-not-leak" })),
    { name: "CRM_ADMIN_EMAILS", type: "plain_text", text: "private-account" },
    { name: "DOCUMENT_DELIVERY_ENABLED", type: "plain_text", text: "true" },
    { name: "KAKAO_DOCUMENT_TEMPLATES_APPROVED", type: "plain_text", text: "false" },
    { name: "KAKAO_MONTHLY_REPORT_ENABLED", type: "secret_text" },
  ];
  assert.deepEqual(summarizeBindings(bindings), {
    storagePresent: true, accessKeyPresent: true, secretKeyPresent: true, serviceIdPresent: true, channelIdPresent: true,
    deliveryEnabled: true, documentTemplatesApprovedFlag: false, monthlyReportEnabledFlag: null, monthlyBrandEnabledFlag: false,
  });
  assert.doesNotMatch(JSON.stringify(summarizeBindings(bindings)), /must-not-leak|private-account|private-storage/);
  assert.ok(Object.values(summarizeBindings([])).every(value => value === false));
  assert.throws(() => summarizeBindings(null), /SETTINGS_INVALID/);
});

test("production diagnostics use one fixed bounded read with no redirects or mutations", async () => {
  const calls = [];
  await checkDocumentDelivery({ token: "test-token", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, result: { bindings: [] } });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/3c3bcd08bb6ed3a7a8f98c292386c327/workers/scripts/bring-crm-ai-gateway/settings");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.body, undefined);
  assert.ok(calls[0].options.signal);
  await assert.rejects(checkDocumentDelivery({}), /CLOUDFLARE_AUTH_REQUIRED/);
  await assert.rejects(checkDocumentDelivery({ token: "test", fetchImpl: async () => new Response("secret-error", { status: 403 }) }), /SETTINGS_READ_FAILED/);
  await assert.rejects(checkDocumentDelivery({ token: "test", fetchImpl: async () => new Response("x".repeat(1024 * 1024 + 1)) }), /SETTINGS_TOO_LARGE/);
});

test("manual diagnostic workflow runs only the reviewed release branch and never deploys", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/crm-document-delivery-check.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github.ref == 'refs\/heads\/codex\/bring-field-platform'/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /contents: write|pull_request_target|wrangler deploy|secret put/);
});

test("release readiness requires every binding, approved documents, and monthly provider-checked AlimTalk enabled and brand disabled", () => {
  const ready = {
    storagePresent: true, accessKeyPresent: true, secretKeyPresent: true, serviceIdPresent: true, channelIdPresent: true,
    deliveryEnabled: true, documentTemplatesApprovedFlag: true, monthlyReportEnabledFlag: true, monthlyBrandEnabledFlag: false,
  };
  assert.equal(requireApprovedDocumentDelivery(ready), ready);
  for (const key of Object.keys(ready).filter(key => key !== "monthlyBrandEnabledFlag")) {
    for (const value of [false, null, undefined, "true"]) {
      assert.throws(() => requireApprovedDocumentDelivery({ ...ready, [key]: value }), /NOT_READY/);
    }
  }
  for (const value of [true, null, undefined, "false"]) {
    assert.throws(() => requireApprovedDocumentDelivery({ ...ready, monthlyBrandEnabledFlag: value }), /NOT_READY/);
  }
  assert.throws(() => requireApprovedDocumentDelivery(null), /NOT_READY/);
});

test("formal release checks actual document delivery settings before publication", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/crm-release.yml", import.meta.url), "utf8");
  const deployment = workflow.slice(workflow.indexOf("  deploy-ai-worker:"), workflow.indexOf("  stage-release:"));
  assert.match(deployment, /node crm-ai-worker\/scripts\/check-document-delivery\.mjs --require-approved-documents/);
  assert.ok(deployment.indexOf("scripts/deploy-with-weekly-secrets.mjs") < deployment.indexOf("--require-approved-documents"));
});
