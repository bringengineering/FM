const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const functions = source.slice(source.indexOf("async function workReportClassificationSource("), source.indexOf("async function selectBuildingMonthlyReportPhotos("));
const jpeg = "data:image/jpeg;base64,/9j/AA==";
function fixture({ failReview = false, staleReview = false } = {}) {
  const ids = Array.from({ length: 10 }, (_, i) => `a${i}`), calls = [];
  const picker = { files: new Map(ids.map(id => [id, { id, workReviewJpeg: jpeg, workReviewDetailJpeg: jpeg }])), thumbnails: new Map() };
  let active = true;
  const context = vm.createContext({
    Buffer, AbortSignal, PhotoCaptureTime: require("../src/photo-capture-time"), PhotoReviewRefinement: require("../src/photo-review-refinement"), MAX_AI_CLASSIFICATION_PHOTOS: 30,
    CRM_AI_PHOTO_CLASSIFY_URL: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify",
    authState: () => ({ user: {} }), isMarketingOnlySession: () => false,
    remoteClient: { captureSessionGuard: () => ({}), assertSessionGuardActive() { if (!active) throw new Error("session changed"); }, ensureIdToken: async () => "synthetic" },
    reportDrivePickerId: id => id, reportDrivePickerReady: () => picker, ensureDriveAccessToken: async () => "synthetic",
    classifyPhotosWithGateway: async ({ input, timeoutMs }) => {
      calls.push({ input, timeoutMs });
      if (input.mode === "review") { if (staleReview) active = false; if (failReview) throw new Error("synthetic upstream failure"); }
      return { ok: true, classifications: input.images.map(image => ({ id: image.id, analysisVersion: 2,
        category: input.mode === "review" ? "aircon" : "review", target: "aircon", space: "unknown", phase: "unknown",
        needsReview: input.mode !== "review", reason: "검증용", issues: [] })), warnings: [], usage: { inputTokens: 10, outputTokens: 5 } };
    },
  });
  vm.runInContext(functions, context);
  return { ids, calls, picker, run: () => context.classifySelectedWorkReportPhotos({ kind: "moveIn", fileIds: ids }) };
}
test("main runs one six-photo refinement with overview+detail, sums usage and keeps remaining four", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].input.images.length, 6); assert.equal(f.calls[1].timeoutMs, 30000);
  assert.ok(f.calls[0].input.images.every(i => !i.detailDataUrl)); assert.ok(f.calls[1].input.images.every(i => i.detailDataUrl === jpeg));
  assert.equal(result.classifications.filter(row => row.category === "aircon").length, 6);
  assert.equal(result.classifications.filter(row => row.needsReview).length, 4); assert.equal(result.usage.inputTokens, 20);
});
test("refinement failure retains first-pass data while account switch cannot return it", async () => {
  const f = fixture({ failReview: true }); const result = await f.run();
  assert.equal(f.calls.length, 2); assert.equal(result.classifications.length, 10); assert.ok(result.classifications.every(row => row.category === "review"));
  assert.match(result.warnings[0], /1차 분류/);
  await assert.rejects(() => fixture({ staleReview: true }).run(), /session changed/);
});
test("too-small originals without usable detail are not repeatedly paid for in refinement", async () => {
  const f = fixture(); for (const file of f.picker.files.values()) file.workReviewDetailJpeg = "";
  await f.run(); assert.equal(f.calls.length, 1);
});
test("monthly analysis rejects tiny thumbnails and downloads a bounded original", async () => {
  let downloads = 0, encoded = 0;
  const context = vm.createContext({ Buffer, AbortSignal,
    fetchReportDriveThumbnail: async () => ({ dataUrl: jpeg }), nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 120, height: 90 }) }) },
    BuildingDocsDrive: { downloadFile: async () => { downloads++; return { content: Buffer.from("original"), mimeType: "image/jpeg" }; } },
    HeicJpegConverter: { looksLikeHeic: () => false }, safeClassificationJpeg: () => { encoded++; return jpeg; },
  });
  vm.runInContext(source.slice(source.indexOf("async function workReportClassificationSource("), source.indexOf("async function classifySelectedWorkReportPhotos(")), context);
  await context.workReportClassificationSource({ id: "a" }, { thumbnails: new Map([["a", "synthetic-thumbnail"]]) }, "synthetic", "monthly");
  assert.equal(downloads, 1); assert.equal(encoded, 1);
});
