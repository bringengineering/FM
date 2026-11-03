"use strict";
// 휴대폰은 세로 사진을 가로로 저장하고 EXIF Orientation 으로 "돌려서 보라"고만 적는다.
// Electron nativeImage 는 이 표시를 무시하고 toJPEG 는 EXIF 를 버리므로, 그대로 두면
// 보고서 PDF 와 AI 에 보내는 사진이 옆으로 누운다(2026-11-03 실사진 33장 중 4장).
// 여기서 표시를 읽어 화소를 직접 돌린다. 메타데이터는 다시 넣지 않는다.

// JPEG APP1(Exif) 의 Orientation(0x0112) 값. 없거나 읽을 수 없으면 1(그대로).
function readOrientation(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= buffer.length && buffer[offset] === 0xff) {
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // 영상 데이터 시작 전에서만 찾는다.
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if (marker === 0xe1 && buffer.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      const tiff = offset + 10;
      const end = offset + 2 + length;
      if (tiff + 8 > end) return 1;
      const order = buffer.toString("latin1", tiff, tiff + 2);
      if (order !== "II" && order !== "MM") return 1;
      const little = order === "II";
      const u16 = at => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
      const u32 = at => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > end) return 1;
      const count = u16(ifd);
      for (let i = 0; i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > end) break;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

// 4바이트 화소 배열(BGRA/RGBA 무관)을 EXIF 방향대로 돌린다.
function orientBitmap(bitmap, width, height, orientation) {
  if (!(orientation >= 2 && orientation <= 8)) return { bitmap, width, height };
  const swap = orientation >= 5;
  const outWidth = swap ? height : width;
  const outHeight = swap ? width : height;
  const out = Buffer.alloc(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let sx, sy;
      switch (orientation) {
        case 2: sx = width - 1 - x; sy = y; break;
        case 3: sx = width - 1 - x; sy = height - 1 - y; break;
        case 4: sx = x; sy = height - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = height - 1 - x; break;
        case 7: sx = width - 1 - y; sy = height - 1 - x; break;
        default: sx = width - 1 - y; sy = x; break; // 8
      }
      bitmap.copy(out, (y * outWidth + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
    }
  }
  return { bitmap: out, width: outWidth, height: outHeight };
}

// 이미 줄인 nativeImage 를 원본의 EXIF 방향대로 세운다. 방향 표시가 없으면 그대로 돌려준다.
function uprightImage(nativeImage, image, orientation) {
  if (!(orientation >= 2 && orientation <= 8) || !image || image.isEmpty()) return image;
  const { width, height } = image.getSize();
  const turned = orientBitmap(image.toBitmap(), width, height, orientation);
  return nativeImage.createFromBitmap(turned.bitmap, { width: turned.width, height: turned.height });
}

module.exports = { readOrientation, orientBitmap, uprightImage };
