"use strict";
const { createHash } = require("node:crypto");

// Only decoded, bounded CRM thumbnails enter this helper. Fingerprints are local
// selection metadata, never authorization or proof that an activity completed.
function fingerprint(dataUrl, nativeImage) {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("PHOTO_PREVIEW_FAILED");
  const size = image.getSize();
  const bytes = image.resize({ width: 9, height: 8, quality: "good" }).toBitmap();
  if (bytes.length !== 9 * 8 * 4) throw new Error("PHOTO_PREVIEW_FAILED");
  const tone = [0, 0, 0];
  const gray = [];
  for (let at = 0; at < bytes.length; at += 4) {
    gray.push(bytes[at] * .114 + bytes[at + 1] * .587 + bytes[at + 2] * .299);
    for (let c = 0; c < 3; c += 1) tone[c] += bytes[at + c];
  }
  let sceneHash = "";
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) sceneHash += gray[y * 9 + x] > gray[y * 9 + x + 1] ? "1" : "0";
  return { imageHash: createHash("sha256").update(dataUrl).digest("hex"), sceneHash,
    sceneTone: tone.map(value => Math.round(value / 72)), sceneRatio: size.width / size.height };
}
module.exports = { fingerprint };
