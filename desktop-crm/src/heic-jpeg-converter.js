"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function looksLikeHeic(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (content.length < 12 || content.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brandEnd = Math.min(content.length, 64);
  for (let offset = 8; offset + 4 <= brandEnd; offset += 4) {
    if (HEIC_BRANDS.has(content.subarray(offset, offset + 4).toString("ascii").toLowerCase())) return true;
  }
  return false;
}

function conversionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function convertToJpeg(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!content.length || content.length > MAX_INPUT_BYTES) {
    return Promise.reject(conversionError("HEIC_INPUT_SIZE", "HEIC 사진 크기가 허용 범위를 벗어났습니다."));
  }
  if (!looksLikeHeic(content)) {
    return Promise.reject(conversionError("HEIC_INVALID", "올바른 HEIC 사진이 아닙니다."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(path.join(__dirname, "heic-convert-worker.js"), {
      workerData: content,
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
    });
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      finish(conversionError("HEIC_TIMEOUT", "HEIC 사진 변환 시간이 너무 오래 걸립니다."));
    }, TIMEOUT_MS);

    worker.once("message", message => {
      if (!message || message.ok !== true || !message.content) {
        finish(conversionError("HEIC_CONVERSION_FAILED", "HEIC 사진을 JPG로 변환하지 못했습니다."));
        return;
      }
      const output = Buffer.from(message.content);
      if (!output.length || output.length > MAX_OUTPUT_BYTES || output[0] !== 0xff || output[1] !== 0xd8 || output[2] !== 0xff) {
        finish(conversionError("HEIC_OUTPUT_INVALID", "변환된 JPG 사진을 확인하지 못했습니다."));
        return;
      }
      finish(null, output);
    });
    worker.once("error", () => finish(conversionError("HEIC_WORKER_FAILED", "HEIC 사진 변환기를 실행하지 못했습니다.")));
    worker.once("exit", () => {
      if (!settled) finish(conversionError("HEIC_WORKER_EXIT", "HEIC 사진 변환이 중단되었습니다."));
    });
  });
}

module.exports = Object.freeze({
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  TIMEOUT_MS,
  looksLikeHeic,
  convertToJpeg,
});
