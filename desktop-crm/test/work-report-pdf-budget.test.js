const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../src/main.js"), "utf8");
function harness({ width = 3000, height = 2000, empty = false, bytes = 2048 } = {}) {
  const calls = [];
  const picture = { isEmpty: () => empty, getSize: () => ({ width, height }), resize: size => { calls.push(size); return picture; }, toJPEG: quality => { calls.push(quality); return Buffer.alloc(bytes); } };
  const context = { Buffer, nativeImage: { createFromBuffer: () => picture } };
  vm.runInNewContext(source.slice(source.indexOf("function workReportPdfJpeg("), source.indexOf("async function createWorkReportPdfArtifact(")), context);
  return { run: context.workReportPdfJpeg, calls };
}
test("다중 사진 PDF는 최대 1280px JPEG로 정규화하고 사진당 1MB 이내로 제한한다", () => {
  const h = harness();
  assert.equal(h.run(Buffer.alloc(10)).length, 2048);
  assert.equal(h.calls[0].width, 1280); assert.equal(h.calls[1], 80);
  const portrait = harness({ width: 2000, height: 3000 }); portrait.run(Buffer.alloc(10));
  assert.equal(portrait.calls[0].height, 1280);
  assert.throws(() => harness({ empty: true }).run(Buffer.alloc(10)));
  assert.throws(() => harness({ width: 50000, height: 50000 }).run(Buffer.alloc(10)));
  assert.throws(() => harness({ bytes: 1024 * 1024 + 1 }).run(Buffer.alloc(10)));
  assert.throws(() => h.run(Buffer.alloc(24 * 1024 * 1024 + 1)));
});
test("저장·발송 PDF 양쪽 모두 40장 잘라내기 없이 검증한 전체 사진을 처리한다", () => {
  for (const name of ["createWorkReportPdfArtifact", "exportWorkReport"]) {
    const start = source.indexOf(`async function ${name}(`);
    const end = source.indexOf("\nasync function ", start + 1);
    const body = source.slice(start, end);
    assert.match(body, /const photos = workReportPdfPhotos\(report\)/);
    assert.match(body, /for \(const photo of photos\)/);
    assert.match(body, /workReportPdfJpeg\(/);
    assert.doesNotMatch(body, /photos\.slice\(0, 40\)/);
  }
});
