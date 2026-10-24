(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringPhotoCaptureTime = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  // Only original capture time crosses into the renderer. Never expose GPS,
  // camera serial numbers, arbitrary EXIF text, upload time or modification time.
  function normalize(value) {
    if (!value || value.source !== "exif-original") return null;
    const local = typeof value.local === "string" ? value.local : "";
    const offset = typeof value.offset === "string" ? value.offset : "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(local)) return null;
    const at = Date.parse(`${local}Z`);
    if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 19) !== local || Number(local.slice(0, 4)) < 1970) return null;
    if (offset && !/^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/u.test(offset)) return null;
    return { local, offset, source: "exif-original" };
  }

  function readTiff(tiff) {
    if (tiff.length < 8) return null;
    const endian = tiff.toString("ascii", 0, 2);
    if (!["II", "MM"].includes(endian)) return null;
    const u16 = offset => endian === "II" ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const u32 = offset => endian === "II" ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
    if (u16(2) !== 42) return null;
    const visited = new Set(); const values = new Map();
    function readIfd(offset, depth) {
      if (depth > 1 || visited.has(offset) || offset < 8 || offset + 2 > tiff.length) return;
      visited.add(offset);
      const count = u16(offset);
      if (count > 2048 || offset + 2 + count * 12 > tiff.length) return;
      for (let i = 0; i < count; i += 1) {
        const entry = offset + 2 + i * 12, tag = u16(entry), type = u16(entry + 2), size = u32(entry + 4);
        if (tag === 0x8769 && type === 4 && size === 1) { readIfd(u32(entry + 8), depth + 1); continue; }
        if (![0x9003, 0x9011].includes(tag) || type !== 2 || size < 1 || size > 32) continue;
        const start = size <= 4 ? entry + 8 : u32(entry + 8);
        if (start < 8 || start + size > tiff.length || values.has(tag)) continue;
        values.set(tag, tiff.toString("ascii", start, start + size).replace(/\0+$/u, ""));
      }
    }
    readIfd(u32(4), 0);
    const original = values.get(0x9003) || "";
    if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/u.test(original)) return null;
    return normalize({ local: original.slice(0, 10).replace(/:/gu, "-") + "T" + original.slice(11), offset: values.get(0x9011) || "", source: "exif-original" });
  }

  function readOriginal(buffer) {
    if (typeof Buffer === "undefined" || !Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.length > 12 * 1024 * 1024) return null;
    // JPEG APP1 only; unsupported/stripped originals remain explicitly unknown.
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    for (let segments = 0; segments < 2048 && offset + 4 <= buffer.length; segments += 1) {
      if (buffer[offset++] !== 0xff) return null;
      while (buffer[offset] === 0xff) offset += 1;
      if (offset + 3 > buffer.length) return null;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) return null;
      const payload = buffer.subarray(offset + 2, offset + length);
      if (marker === 0xe1 && payload.subarray(0, 6).equals(Buffer.from("Exif\0\0", "ascii"))) {
        const capture = readTiff(payload.subarray(6));
        if (capture) return capture;
      }
      offset += length;
    }
    return null;
  }

  function comparable(left, right) {
    const a = normalize(left), b = normalize(right);
    // Unknown offsets are not silently assumed to be the current PC timezone.
    return !!a && !!b && a.offset === b.offset && a.local.slice(0, 10) === b.local.slice(0, 10);
  }
  function differenceMinutes(left, right) {
    return comparable(left, right) ? (Date.parse(`${right.local}Z`) - Date.parse(`${left.local}Z`)) / 60000 : NaN;
  }
  function relativeMinutes(files) {
    const dated = files.map(file => ({ id: file.id, time: normalize(file.captureTime) })).filter(row => row.time);
    if (!dated.length || dated.some(row => !comparable(dated[0].time, row.time))) return new Map();
    const origin = Math.min(...dated.map(row => Date.parse(`${row.time.local}Z`)));
    return new Map(dated.map(row => [row.id, Math.floor((Date.parse(`${row.time.local}Z`) - origin) / 60000)]));
  }
  function label(value) {
    const time = normalize(value);
    return time ? `촬영 ${time.local.replace("T", " ")} (${time.offset ? `UTC${time.offset}` : "시간대 미기록"})` : "원본 촬영시간 없음";
  }
  return Object.freeze({ normalize, readOriginal, comparable, differenceMinutes, relativeMinutes, label });
});
