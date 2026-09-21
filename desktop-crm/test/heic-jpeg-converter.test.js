const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const converter = require("../src/heic-jpeg-converter");

function heicHeader(brand) {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1")]);
}

test("HEIC 컨테이너 표식만 변환 대상으로 받는다", () => {
  assert.equal(converter.looksLikeHeic(heicHeader("heic")), true);
  assert.equal(converter.looksLikeHeic(heicHeader("mif1")), true);
  assert.equal(converter.looksLikeHeic(Buffer.from("not-an-image")), false);
  assert.equal(converter.MAX_INPUT_BYTES, 12 * 1024 * 1024);
  assert.equal(converter.MAX_OUTPUT_BYTES, 16 * 1024 * 1024);
});

test("변환기는 입력 크기·시간·메모리를 제한하고 원본을 파일로 쓰지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/heic-jpeg-converter.js"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "../src/heic-convert-worker.js"), "utf8");
  assert.match(source, /resourceLimits/u);
  assert.match(source, /setTimeout/u);
  assert.match(source, /worker\.terminate/u);
  assert.doesNotMatch(source + worker, /writeFile|exec\(|spawn\(/u);
});

test("비어 있거나 HEIC가 아닌 입력은 작업 스레드를 만들기 전에 거절한다", async () => {
  await assert.rejects(converter.convertToJpeg(Buffer.alloc(0)), error => error && error.code === "HEIC_INPUT_SIZE");
  await assert.rejects(converter.convertToJpeg(Buffer.from("jpeg")), error => error && error.code === "HEIC_INVALID");
});
