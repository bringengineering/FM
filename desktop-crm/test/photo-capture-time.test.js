const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../src/photo-capture-time");

function fixture({ date = "2026:10:02 14:04:14", offset = "+09:00", endian = "II", tag = 0x9003 } = {}) {
  const t = Buffer.alloc(120); t.write(endian);
  const u16 = (n, p) => endian === "II" ? t.writeUInt16LE(n, p) : t.writeUInt16BE(n, p);
  const u32 = (n, p) => endian === "II" ? t.writeUInt32LE(n, p) : t.writeUInt32BE(n, p);
  u16(42, 2); u32(8, 4); u16(1, 8);
  u16(0x8769, 10); u16(4, 12); u32(1, 14); u32(26, 18);
  u16(2, 26);
  u16(tag, 28); u16(2, 30); u32(20, 32); u32(56, 36); t.write(date, 56);
  u16(0x9011, 40); u16(2, 42); u32(offset.length + 1, 44);
  if (offset.length < 4) t.write(offset, 48); else { u32(76, 48); t.write(offset, 76); }
  const payload = Buffer.concat([Buffer.from("Exif\0\0"), t]);
  const segment = Buffer.alloc(4); segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([255, 216]), segment, payload, Buffer.from([255, 217])]);
}
const capture = (time, offset = "+09:00") => ({ local: `2026-10-02T${time}`, offset, source: "exif-original" });

test("JPEG little/big endian original time and timezone survive extraction only as allowlisted fields", () => {
  for (const endian of ["II", "MM"]) assert.deepEqual(C.readOriginal(fixture({ endian })), capture("14:04:14"));
  assert.deepEqual(C.readOriginal(fixture({ offset: "" })), capture("14:04:14", ""));
  assert.equal(C.readOriginal(fixture({ tag: 306 })), null, "modification time is not capture time");
  assert.equal(C.readOriginal(fixture({ tag: 0x9004 })), null, "digitization time is not capture time");
});
test("invalid original timestamps, offsets, non-JPEG and hostile offsets fail closed", () => {
  for (const date of ["2026:02:30 10:00:00", "2026:10:02 25:00:00", "0000:00:00 00:00:00"]) assert.equal(C.readOriginal(fixture({ date })), null);
  assert.equal(C.readOriginal(fixture({ offset: "+99:99" })), null);
  assert.equal(C.readOriginal(Buffer.from("not jpeg")), null);
  assert.equal(C.readOriginal(null), null);
  assert.equal(C.readOriginal(Buffer.alloc(13 * 1024 * 1024)), null);
  const bytes = fixture();
  for (let i = 0; i < bytes.length; i += 1) assert.doesNotThrow(() => C.readOriginal(bytes.subarray(0, i)));
  for (let i = 12; i < bytes.length - 4; i += 1) {
    const malformed = Buffer.from(bytes); malformed.writeUInt32LE(0xffffffff, i);
    assert.doesNotThrow(() => C.readOriginal(malformed));
  }
});
test("only same-day same-offset original timestamps produce relative minutes, never upload dates", () => {
  const files = [{ id: "a", captureTime: capture("14:04:14") }, { id: "b", captureTime: capture("16:40:45") }, { id: "c", createdTime: "2026-10-04T09:16:38Z" }];
  assert.deepEqual([...C.relativeMinutes(files)], [["a", 0], ["b", 156]]);
  assert.equal(C.relativeMinutes([...files, { id: "d", captureTime: { ...capture("18:00:00"), local: "2026-10-03T18:00:00" } }]).size, 0);
  assert.equal(C.relativeMinutes([...files, { id: "d", captureTime: capture("18:00:00", "") }]).size, 0);
  assert.equal(C.normalize({ local: "2026-10-02T14:04:14", source: "drive-upload" }), null);
  assert.match(C.label(capture("14:04:14")), /2026-10-02 14:04:14.*UTC\+09:00/u);
  assert.equal(C.label({ local: "<script>", source: "exif-original" }), "원본 촬영시간 없음");
});
test("capture display works inside sandbox renderer without Buffer or Node", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/photo-capture-time.js"), "utf8"), context);
  assert.equal(context.BringPhotoCaptureTime.label(null), "원본 촬영시간 없음");
});

test("main reads original EXIF before reencoding, reuses stripped JPEG and returns only bounded timing hints", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const functions = source.slice(source.indexOf("async function workReportClassificationSource("), source.indexOf("async function selectBuildingMonthlyReportPhotos("));
  const jpeg = "data:image/jpeg;base64,/9j/4AAB";
  const files = new Map(["a", "b"].map(id => [id, { id, name: `${id}.JPG`, mimeType: "image/jpeg" }]));
  const picker = { files, thumbnails: new Map([["a", "must-not-use-thumbnail"]]) };
  let downloads = 0; let providerInput;
  const context = vm.createContext({
    Buffer, AbortSignal, PhotoCaptureTime: C, MAX_AI_CLASSIFICATION_PHOTOS: 30, CRM_AI_PHOTO_CLASSIFY_URL: "https://gateway.example/v1/photo-classify",
    authState: () => ({ user: {} }), isMarketingOnlySession: () => false,
    remoteClient: { captureSessionGuard: () => ({}), assertSessionGuardActive() {}, ensureIdToken: async () => "fixture" },
    reportDrivePickerId: value => value, reportDrivePickerReady: () => picker, ensureDriveAccessToken: async () => "fixture",
    BuildingDocsDrive: { downloadFile: async (_, options) => { downloads += 1; return { content: fixture({ date: `2026:10:02 ${options.fileId === "a" ? "14:04:14" : "16:40:45"}` }), mimeType: "image/jpeg" }; } },
    HeicJpegConverter: { looksLikeHeic: () => false }, safeClassificationJpeg: () => jpeg,
    fetchReportDriveThumbnail: () => { throw new Error("thumbnail must not replace original"); },
    classifyPhotosWithGateway: async options => { providerInput = options.input; return { ok: true, classifications: [], warnings: [], pairs: [] }; },
  });
  vm.runInContext(functions, context);
  const first = await context.classifySelectedWorkReportPhotos({ kind: "moveIn", fileIds: ["a", "b"] });
  assert.equal(first.captureTimes[0].captureTime.local, "2026-10-02T14:04:14");
  assert.equal(providerInput.images[0].captureMinute, undefined);
  await context.classifySelectedWorkReportPhotos({ kind: "moveIn", fileIds: ["a", "b"], mode: "compare" });
  assert.equal(downloads, 2, "comparison reuses session-owned stripped JPEGs");
  assert.equal(providerInput.images[1].captureMinute, 156);
  assert.doesNotMatch(JSON.stringify(providerInput), /2026|GPS|DateTimeOriginal|\.JPG/u);
  await assert.rejects(() => context.classifySelectedWorkReportPhotos({ kind: "moveIn", fileIds: ["a"], captureTime: capture("09:00:00") }), { code: "INVALID_INPUT" });
  await assert.rejects(() => context.classifySelectedWorkReportPhotos({ kind: "moveIn", fileIds: ["not-listed"] }), { code: "DRIVE_FILE_NOT_LISTED" });
});
