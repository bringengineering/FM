"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const convert = require("heic-convert");

(async () => {
  try {
    const input = Buffer.from(workerData);
    const output = await convert({ buffer: input, format: "JPEG", quality: 0.84 });
    parentPort.postMessage({ ok: true, content: Buffer.from(output) });
  } catch (_error) {
    // 파일명이나 원본 바이트 같은 현장 자료를 오류에 싣지 않는다.
    parentPort.postMessage({ ok: false });
  }
})();
