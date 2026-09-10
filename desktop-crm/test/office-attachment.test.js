const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const Attachment = require("../src/office-attachment");

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(rows) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const source of rows) {
    const name = Buffer.from(source.name, "utf8");
    const data = Buffer.from(source.data || "");
    const compressed = source.compressedData === undefined ? data : Buffer.from(source.compressedData);
    const flags = source.flags === undefined ? 0x0800 : source.flags;
    const method = source.method === undefined ? 0 : source.method;
    const compressedSize = source.compressedSize === undefined ? compressed.length : source.compressedSize;
    const uncompressedSize = source.uncompressedSize === undefined ? data.length : source.uncompressedSize;
    const checksum = source.crc === undefined ? crc32(data) : source.crc >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(source.externalAttributes >>> 0 || 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(rows.length, 8);
  end.writeUInt16LE(rows.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const contentType = extension => Buffer.from(`<?xml version="1.0"?><Types><Override ContentType="${{
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
}[extension]}"/></Types>`);

function ooxml(extension, extra) {
  const folder = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" }[extension];
  return makeZip([
    { name: "[Content_Types].xml", data: contentType(extension) },
    { name: folder, data: "<root/>" },
    ...(extra || []),
  ]);
}

function hwpx(extra, mimetype = "application/hwp+zip") {
  return makeZip([
    { name: "mimetype", data: mimetype },
    { name: "Contents/content.hpf", data: "<opf/>" },
    { name: "version.xml", data: "<version/>" },
    { name: "Contents/header.xml", data: "<header/>" },
    { name: "Contents/section0.xml", data: "<section/>" },
    { name: "META-INF/container.xml", data: "<container/>" },
    { name: "META-INF/manifest.xml", data: "<manifest/>" },
    ...(extra || []),
  ]);
}

const CFB_FREESECT = 0xffffffff;
const CFB_FATSECT = 0xfffffffd;
const CFB_ENDOFCHAIN = 0xfffffffe;
const CFB_NOSTREAM = 0xffffffff;

function writeCfbDirectoryEntry(directory, index, input) {
  const offset = index * 128;
  if (!input) return;
  directory.writeUInt32LE(CFB_NOSTREAM, offset + 68);
  directory.writeUInt32LE(CFB_NOSTREAM, offset + 72);
  directory.writeUInt32LE(CFB_NOSTREAM, offset + 76);
  directory.writeUInt32LE(CFB_ENDOFCHAIN, offset + 116);
  const name = Buffer.from(`${input.name}\u0000`, "utf16le");
  assert.ok(name.length <= 64);
  name.copy(directory, offset);
  directory.writeUInt16LE(name.length, offset + 64);
  directory[offset + 66] = input.type;
  directory[offset + 67] = 1;
  directory.writeUInt32LE(input.left === undefined ? CFB_NOSTREAM : input.left, offset + 68);
  directory.writeUInt32LE(input.right === undefined ? CFB_NOSTREAM : input.right, offset + 72);
  directory.writeUInt32LE(input.child === undefined ? CFB_NOSTREAM : input.child, offset + 76);
  directory.writeUInt32LE(input.start === undefined ? CFB_ENDOFCHAIN : input.start, offset + 116);
  directory.writeUInt32LE(input.size || 0, offset + 120);
  directory.writeUInt32LE(input.sizeHigh >>> 0 || 0, offset + 124);
}

function hwpFileHeader(flags = 0, version = 0x05000300, options = {}) {
  const header = Buffer.alloc(256);
  header.write("HWP Document File", 0, "ascii");
  header.writeUInt32LE(version >>> 0, 32);
  header.writeUInt32LE(flags >>> 0, 36);
  header.writeUInt32LE(options.licenseFlags >>> 0 || 0, 40);
  header.writeUInt32LE(options.encryptionVersion >>> 0 || 0, 44);
  header[48] = options.country >>> 0 || 0;
  return header;
}

const SAFE_HWP_SCRIPT_VERSION = Buffer.from("AQAAAAAAAAA=", "base64");
const SAFE_HWP_DEFAULT_SCRIPT = Buffer.from(
  "TwAAAHYAYQByACAARABvAGMAdQBtAGUAbgB0AHMAIAA9ACAAWABIAHcAcABEAG8AYwB1AG0AZQBuAHQAcwA7AA0ACgB2AGEAcgAgAEQAbwBjAHUAbQBlAG4AdAAgAD0AIABEAG8AYwB1AG0AZQBuAHQAcwAuAEEAYwB0AGkAdgBlAF8AWABIAHcAcABEAG8AYwB1AG0AZQBuAHQAOwANAAoALwAAAGYAdQBuAGMAdABpAG8AbgAgAE8AbgBEAG8AYwB1AG0AZQBuAHQAXwBOAGUAdwAoACkADQAKAHsADQAKAAkALwAvAHQAbwBkAG8AIAA6ACAADQAKAH0ADQAKAA0ACgAAAAAAAAAAAP////8=",
  "base64",
);

function hwp(options = {}) {
  const sectorSize = 512;
  const header = Buffer.alloc(sectorSize);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(0, 40);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(1, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(3, 60);
  header.writeUInt32LE(1, 64);
  header.writeUInt32LE(CFB_ENDOFCHAIN, 68);
  header.writeUInt32LE(0, 72);
  for (let index = 0; index < 109; index += 1) header.writeUInt32LE(index === 0 ? 0 : CFB_FREESECT, 76 + index * 4);

  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeUInt32LE(CFB_FATSECT, 0);
  fat.writeUInt32LE(2, 4);
  fat.writeUInt32LE(CFB_ENDOFCHAIN, 8);
  fat.writeUInt32LE(CFB_ENDOFCHAIN, 12);
  fat.writeUInt32LE(CFB_ENDOFCHAIN, 16);

  const directories = Buffer.alloc(sectorSize * 2);
  for (let index = 0; index < directories.length / 128; index += 1) writeCfbDirectoryEntry(directories, index);
  const includeFileHeader = options.includeFileHeader !== false;
  const embeddedOle = options.embeddedOle === true;
  const includeScripts = options.includeScripts === true;
  const standardScaffold = options.standardScaffold === true;
  const linkDocScaffold = options.linkDocScaffold === true;
  const scriptVersionPlain = options.scriptVersionBytes ? Buffer.from(options.scriptVersionBytes) : SAFE_HWP_SCRIPT_VERSION;
  const defaultScriptPlain = options.defaultScriptBytes ? Buffer.from(options.defaultScriptBytes) : SAFE_HWP_DEFAULT_SCRIPT;
  function withLegacyHwpTrailer(compressed, plain) {
    if (!options.legacyScriptTrailer) return compressed;
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(crc32(plain), 0);
    trailer.writeUInt32LE(plain.length, 4);
    return Buffer.concat([compressed, trailer]);
  }
  const scriptVersionData = options.flags & 1
    ? withLegacyHwpTrailer(zlib.deflateRawSync(scriptVersionPlain), scriptVersionPlain)
    : scriptVersionPlain;
  const defaultScriptBody = options.flags & 1
    ? withLegacyHwpTrailer(zlib.deflateRawSync(defaultScriptPlain), defaultScriptPlain)
    : defaultScriptPlain;
  const defaultScriptData = options.defaultScriptTrailingBytes
    ? Buffer.concat([defaultScriptBody, Buffer.from(options.defaultScriptTrailingBytes)])
    : defaultScriptBody;
  const linkDocData = options.linkDocBytes ? Buffer.from(options.linkDocBytes) : Buffer.alloc(524);
  assert.ok(scriptVersionData.length > 0 && scriptVersionData.length <= 64);
  const binDataBytes = options.binDataBytes
    ? Buffer.from(options.binDataBytes)
    : embeddedOle
      ? Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      : null;
  assert.ok(!binDataBytes || binDataBytes.length <= 128);
  const docInfoData = options.validCompressed ? zlib.deflateRawSync(Buffer.from("doc-info")) : Buffer.from([1]);
  const sectionData = options.validCompressed ? zlib.deflateRawSync(Buffer.from("section")) : Buffer.from([1]);
  const rootChild = 1;
  const lastRootEntry = binDataBytes || includeScripts || standardScaffold || linkDocScaffold ? 5 : 3;
  const rootMiniStreamSize = standardScaffold
    ? 7 * 64 + defaultScriptData.length
    : linkDocScaffold
      ? 6 * 64 + linkDocData.length
      : binDataBytes
        ? 6 * 64 + binDataBytes.length
        : 384;
  assert.ok(rootMiniStreamSize <= sectorSize * 2);
  if (rootMiniStreamSize > sectorSize) {
    fat.writeUInt32LE(5, 16);
    fat.writeUInt32LE(CFB_ENDOFCHAIN, 20);
  }
  writeCfbDirectoryEntry(directories, 0, { name: "Root Entry", type: 5, child: rootChild, start: 4, size: rootMiniStreamSize });
  writeCfbDirectoryEntry(directories, 1, {
    name: includeFileHeader ? "FileHeader" : "WordDocument",
    type: 2,
    right: 2,
    start: 0,
    size: 256,
    sizeHigh: options.fileHeaderSizeHigh,
  });
  writeCfbDirectoryEntry(directories, 2, { name: "DocInfo", type: 2, right: 3, start: 4, size: docInfoData.length });
  writeCfbDirectoryEntry(directories, 3, { name: "BodyText", type: 1, right: lastRootEntry === 3 ? CFB_NOSTREAM : lastRootEntry, child: 4, start: 0 });
  writeCfbDirectoryEntry(directories, 4, { name: "Section0", type: 2, start: 5, size: sectionData.length });
  if (standardScaffold) {
    writeCfbDirectoryEntry(directories, 5, { name: "Scripts", type: 1, child: 6, start: 0 });
    writeCfbDirectoryEntry(directories, 6, { name: "JScriptVersion", type: 2, right: 7, start: 6, size: scriptVersionData.length });
    writeCfbDirectoryEntry(directories, 7, { name: "DefaultJScript", type: 2, start: 7, size: defaultScriptData.length });
  } else if (linkDocScaffold) {
    writeCfbDirectoryEntry(directories, 5, { name: "DocOptions", type: 1, child: 6, start: 0 });
    writeCfbDirectoryEntry(directories, 6, { name: "_LinkDoc", type: 2, start: 6, size: linkDocData.length });
  } else if (includeScripts) writeCfbDirectoryEntry(directories, 5, { name: "Scripts", type: 1, start: 0 });
  if (binDataBytes) {
    writeCfbDirectoryEntry(directories, 5, { name: "BinData", type: 1, child: 6, start: 0 });
    writeCfbDirectoryEntry(directories, 6, {
      name: options.binDataName || (embeddedOle ? "BIN0001.OLE" : "BIN0001.PNG"),
      type: 2,
      start: 6,
      size: binDataBytes.length,
    });
  }

  const miniFat = Buffer.alloc(sectorSize, 0xff);
  for (let index = 0; index < 3; index += 1) miniFat.writeUInt32LE(index + 1, index * 4);
  miniFat.writeUInt32LE(CFB_ENDOFCHAIN, 3 * 4);
  miniFat.writeUInt32LE(CFB_ENDOFCHAIN, 4 * 4);
  miniFat.writeUInt32LE(CFB_ENDOFCHAIN, 5 * 4);
  function writeMiniChain(start, size) {
    const count = Math.ceil(size / 64);
    for (let index = 0; index < count; index += 1) {
      miniFat.writeUInt32LE(index + 1 < count ? start + index + 1 : CFB_ENDOFCHAIN, (start + index) * 4);
    }
  }
  if (standardScaffold) {
    writeMiniChain(6, scriptVersionData.length);
    writeMiniChain(7, defaultScriptData.length);
  } else if (linkDocScaffold) {
    writeMiniChain(6, linkDocData.length);
  } else if (binDataBytes) {
    writeMiniChain(6, binDataBytes.length);
  }

  const miniStream = Buffer.alloc(rootMiniStreamSize > sectorSize ? sectorSize * 2 : sectorSize);
  const firstStream = includeFileHeader
    ? hwpFileHeader(options.flags || 0, options.version === undefined ? 0x05000300 : options.version, options)
    : Buffer.concat([Buffer.from("WordDocument legacy payload\nHWP Document File", "ascii"), Buffer.alloc(212)]).subarray(0, 256);
  firstStream.copy(miniStream, 0);
  docInfoData.copy(miniStream, 4 * 64);
  sectionData.copy(miniStream, 5 * 64);
  if (standardScaffold) {
    scriptVersionData.copy(miniStream, 6 * 64);
    defaultScriptData.copy(miniStream, 7 * 64);
  } else if (linkDocScaffold) {
    linkDocData.copy(miniStream, 6 * 64);
  } else if (binDataBytes) binDataBytes.copy(miniStream, 6 * 64);
  return Buffer.concat([header, fat, directories, miniFat, miniStream]);
}

function png() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from("IHDR"),
    Buffer.alloc(17),
  ]);
}

function webp() {
  const value = Buffer.alloc(16);
  value.write("RIFF", 0, "ascii");
  value.writeUInt32LE(8, 4);
  value.write("WEBP", 8, "ascii");
  value.write("VP8 ", 12, "ascii");
  return value;
}

const fixtures = {
  pdf: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"),
  xlsx: ooxml("xlsx"),
  csv: Buffer.from("name,amount\n테스트,1000\n"),
  docx: ooxml("docx"),
  hwp: hwp(),
  hwpx: hwpx(),
  pptx: ooxml("pptx"),
  txt: Buffer.from("안전한 UTF-8 텍스트\n"),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xd9]),
  png: png(),
  webp: webp(),
};

function errorCode(code) {
  return error => error instanceof Attachment.AttachmentValidationError && error.code === code;
}

test("every allow-listed extension is validated by bytes and receives canonical metadata", () => {
  assert.deepEqual(Attachment.ALLOWED_EXTENSIONS, ["pdf", "xlsx", "csv", "docx", "hwp", "hwpx", "pptx", "txt", "jpg", "jpeg", "png", "webp"]);
  for (const extension of Attachment.ALLOWED_EXTENSIONS) {
    const payload = Attachment.prepareAttachment({ fileName: `업무자료.${extension}`, bytes: fixtures[extension] });
    assert.equal(payload.mimeType, Attachment.MIME_BY_EXTENSION[extension]);
    assert.equal(payload.extension, extension);
    assert.equal(payload.size, fixtures[extension].length);
    assert.match(payload.sha256, /^[a-f0-9]{64}$/);
    const revalidated = Attachment.revalidateAttachmentPayload(payload);
    assert.deepEqual({ ...revalidated, bytes: undefined }, { ...payload, bytes: undefined });
    assert.deepEqual(revalidated.bytes, fixtures[extension]);
    const metadata = Attachment.attachmentMetadata(payload);
    assert.equal(metadata.extension, extension);
    assert.equal(Object.hasOwn(metadata, "fileBody"), false);
  }
});

test("safe basenames are NFC-normalized while paths, ADS, controls, reserved names, and legacy Office types are rejected", () => {
  const normalized = Attachment.prepareAttachment({ fileName: "cafe\u0301.txt", bytes: fixtures.txt });
  assert.equal(normalized.fileName, "café.txt");
  for (const fileName of ["../safe.txt", "folder\\safe.txt", "safe.txt:payload", "safe\u0000.txt", "CON.txt", "LPT1.csv", "trailing .txt ", "report.txt."]) {
    assert.throws(() => Attachment.prepareAttachment({ fileName, bytes: fixtures.txt }), /파일 이름|확장자/);
  }
  for (const fileName of ["legacy.doc", "legacy.xls", "legacy.ppt", "program.exe"]) {
    assert.throws(() => Attachment.prepareAttachment({ fileName, bytes: fixtures.txt }), errorCode("ATTACHMENT_TYPE_UNSUPPORTED"));
  }
  assert.throws(() => Attachment.revalidateAttachmentPayload({ ...normalized, fileName: "cafe\u0301.txt" }), errorCode("ATTACHMENT_FILENAME_INVALID"));
});

test("extension, canonical MIME, magic, and OOXML family must agree", () => {
  assert.throws(() => Attachment.prepareAttachment({ fileName: "renamed.pdf", bytes: fixtures.png }), errorCode("ATTACHMENT_MAGIC_MISMATCH"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "sheet.xlsx", bytes: fixtures.xlsx, mimeType: "application/pdf" }), errorCode("ATTACHMENT_MIME_MISMATCH"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "renamed.xlsx", bytes: fixtures.docx }), errorCode("ATTACHMENT_MAGIC_MISMATCH"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "wrong.hwpx", bytes: hwpx([], "application/zip") }), errorCode("ATTACHMENT_MAGIC_MISMATCH"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "fake.hwp", bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) }), errorCode("ATTACHMENT_MAGIC_MISMATCH"));
});

test("HWP validation requires a bounded CFB graph and exact HWP 5.x streams", () => {
  assert.doesNotThrow(() => Attachment.prepareAttachment({ fileName: "valid.hwp", bytes: hwp() }));
  assert.doesNotThrow(() => Attachment.prepareAttachment({ fileName: "valid-compressed.hwp", bytes: hwp({ flags: 1, validCompressed: true }) }));
  const looseMarker = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64),
    Buffer.from("HWP Document File"),
  ]);
  assert.throws(() => Attachment.prepareAttachment({ fileName: "marker-only.hwp", bytes: looseMarker }), errorCode("ATTACHMENT_MAGIC_MISMATCH"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "legacy-doc-disguise.hwp", bytes: hwp({ includeFileHeader: false }) }), errorCode("ATTACHMENT_MAGIC_MISMATCH"));

  const fatCycle = Buffer.from(hwp());
  fatCycle.writeUInt32LE(1, 512 + 2 * 4);
  assert.throws(() => Attachment.prepareAttachment({ fileName: "fat-cycle.hwp", bytes: fatCycle }), errorCode("ATTACHMENT_CFB_INVALID"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "old-version.hwp", bytes: hwp({ version: 0x04000300 }) }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "invalid-compressed.hwp", bytes: hwp({ flags: 1 }) }), errorCode("ATTACHMENT_HWP_UNSAFE"));
});

test("common Hancom HWP 5 metadata, inert scaffolds, and raw image BinData remain compatible", () => {
  const common = hwp({
    flags: 1 | (1 << 5),
    validCompressed: true,
    standardScaffold: true,
    legacyScriptTrailer: true,
    encryptionVersion: 4,
    fileHeaderSizeHigh: 0xdeadbeef,
  });
  const commonPayload = Attachment.prepareAttachment({ fileName: "한글-표준구조.hwp", bytes: common });
  assert.deepEqual(Attachment.revalidateAttachmentPayload(commonPayload).bytes, common);
  assert.doesNotThrow(() => Attachment.prepareAttachment({
    fileName: "한글-연결문서정보.hwp",
    bytes: hwp({ flags: 1, validCompressed: true, linkDocScaffold: true }),
  }));

  const rawPng = Buffer.alloc(48);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(rawPng);
  Buffer.from("IHDR", "ascii").copy(rawPng, 12);
  Buffer.from("MZ", "ascii").copy(rawPng, 24);
  assert.doesNotThrow(() => Attachment.prepareAttachment({
    fileName: "이미지포함.hwp",
    bytes: hwp({ flags: 1, validCompressed: true, binDataBytes: rawPng }),
  }));
  const simulatedLimitFailure = hwp({ flags: 1, validCompressed: true, binDataBytes: rawPng });
  const originalInflateRawSync = zlib.inflateRawSync;
  zlib.inflateRawSync = (bytes, options) => {
    if (Buffer.from(bytes).equals(rawPng)) {
      const error = new RangeError("simulated maxOutputLength breach");
      error.code = "ERR_BUFFER_TOO_LARGE";
      throw error;
    }
    return originalInflateRawSync(bytes, options);
  };
  try {
    assert.throws(
      () => Attachment.prepareAttachment({ fileName: "압축한도초과.hwp", bytes: simulatedLimitFailure }),
      errorCode("ATTACHMENT_HWP_UNSAFE"),
    );
  } finally {
    zlib.inflateRawSync = originalInflateRawSync;
  }
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "unknown-encryption-version.hwp", bytes: hwp({ encryptionVersion: 5 }) }),
    errorCode("ATTACHMENT_HWP_UNSAFE"),
  );
});

test("HWP and HWPX active content, scripts, and embedded OLE are rejected", () => {
  assert.throws(() => Attachment.prepareAttachment({ fileName: "script-flag.hwp", bytes: hwp({ flags: 1 << 3 }) }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "script-storage.hwp", bytes: hwp({ includeScripts: true }) }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  const modifiedDefaultScript = Buffer.from(SAFE_HWP_DEFAULT_SCRIPT);
  modifiedDefaultScript[4] ^= 1;
  assert.throws(() => Attachment.prepareAttachment({
    fileName: "modified-default-script.hwp",
    bytes: hwp({ flags: 1, validCompressed: true, standardScaffold: true, defaultScriptBytes: modifiedDefaultScript }),
  }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  assert.throws(() => Attachment.prepareAttachment({
    fileName: "script-trailing-data.hwp",
    bytes: hwp({ flags: 1, validCompressed: true, standardScaffold: true, defaultScriptTrailingBytes: [0xde, 0xad, 0xbe, 0xef] }),
  }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  const activeLinkDoc = Buffer.alloc(524);
  activeLinkDoc.writeUInt16LE(1, 0);
  assert.throws(() => Attachment.prepareAttachment({
    fileName: "active-link-document.hwp",
    bytes: hwp({ flags: 1, validCompressed: true, linkDocScaffold: true, linkDocBytes: activeLinkDoc }),
  }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  assert.throws(() => Attachment.prepareAttachment({
    fileName: "invalid-link-document-size.hwp",
    bytes: hwp({ flags: 1, validCompressed: true, linkDocScaffold: true, linkDocBytes: Buffer.alloc(523) }),
  }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "embedded-ole.hwp", bytes: hwp({ embeddedOle: true }) }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  const disguisedPe = Buffer.alloc(80);
  disguisedPe.write("MZ", 0, "ascii");
  disguisedPe.writeUInt32LE(64, 0x3c);
  disguisedPe.write("PE\u0000\u0000", 64, "binary");
  assert.throws(() => Attachment.prepareAttachment({
    fileName: "embedded-pe.hwp",
    bytes: hwp({ binDataName: "BIN0001.PNG", binDataBytes: disguisedPe }),
  }), errorCode("ATTACHMENT_HWP_UNSAFE"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "script.hwpx", bytes: hwpx([{ name: "Scripts/sourceScripts.xml", data: "<script/>" }]) }), errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"));
  assert.throws(() => Attachment.prepareAttachment({
    fileName: "embedded-ole.hwpx",
    bytes: hwpx([{ name: "BinData/BIN0001.OLE", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) }]),
  }), errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"));
});

test("HWPX package structure and structural XML entity references fail closed", () => {
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "missing-structure.hwpx", bytes: makeZip([{ name: "mimetype", data: "application/hwp+zip" }, { name: "Contents/content.hpf", data: "<opf/>" }]) }),
    errorCode("ATTACHMENT_MAGIC_MISMATCH"),
  );
  assert.throws(
    () => Attachment.prepareAttachment({
      fileName: "entity.hwpx",
      bytes: makeZip([
        { name: "mimetype", data: "application/hwp+zip" },
        { name: "Contents/content.hpf", data: "<opf href=\"BinData/item&#x2E;ole\"/>" },
        { name: "version.xml", data: "<version/>" },
        { name: "Contents/header.xml", data: "<header/>" },
        { name: "Contents/section0.xml", data: "<section/>" },
        { name: "META-INF/container.xml", data: "<container/>" },
        { name: "META-INF/manifest.xml", data: "<manifest/>" },
      ]),
    }),
    errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
  );
});

test("ZIP inspection rejects traversal, encrypted entries, symlinks, and macro payloads", () => {
  const base = [
    { name: "[Content_Types].xml", data: contentType("docx") },
    { name: "word/document.xml", data: "<root/>" },
  ];
  assert.throws(() => Attachment.prepareAttachment({ fileName: "traversal.docx", bytes: makeZip([...base, { name: "../outside.txt", data: "x" }]) }), errorCode("ATTACHMENT_ZIP_TRAVERSAL"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "encrypted.docx", bytes: makeZip([{ ...base[0], flags: 0x0801 }, base[1]]) }), errorCode("ATTACHMENT_ZIP_ENCRYPTED"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "macro.docx", bytes: makeZip([...base, { name: "word/vbaProject.bin", data: "macro" }]) }), errorCode("ATTACHMENT_ZIP_MACRO"));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "link.docx", bytes: makeZip([...base, { name: "word/link.xml", data: "target", externalAttributes: 0xa000 << 16 }]) }), errorCode("ATTACHMENT_ZIP_TRAVERSAL"));
});

test("ZIP entry, expanded-size, and expansion-ratio limits reject bombs before extraction", () => {
  const tooMany = Array.from({ length: Attachment.MAX_ZIP_ENTRIES + 1 }, (_, index) => ({ name: `word/item-${index}.xml`, data: "" }));
  assert.throws(() => Attachment.prepareAttachment({ fileName: "many.docx", bytes: makeZip(tooMany) }), errorCode("ATTACHMENT_ZIP_LIMIT"));

  const base = [
    { name: "[Content_Types].xml", data: contentType("docx") },
    { name: "word/document.xml", data: "<root/>" },
  ];
  const ratioBomb = { name: "word/bomb.bin", method: 8, compressedData: Buffer.from([0]), compressedSize: 1, uncompressedSize: 201, crc: 0 };
  assert.throws(() => Attachment.prepareAttachment({ fileName: "ratio.docx", bytes: makeZip([...base, ratioBomb]) }), errorCode("ATTACHMENT_ZIP_LIMIT"));
  const sizeBomb = { ...ratioBomb, uncompressedSize: Attachment.MAX_ZIP_UNCOMPRESSED_BYTES + 1 };
  assert.throws(() => Attachment.prepareAttachment({ fileName: "expanded.docx", bytes: makeZip([...base, sizeBomb]) }), errorCode("ATTACHMENT_ZIP_LIMIT"));
});

test("every ZIP file entry is inflated and checked against actual size and CRC", () => {
  const ordinary = Buffer.from("ordinary deflated OOXML part");
  assert.doesNotThrow(() => Attachment.prepareAttachment({
    fileName: "ordinary.docx",
    bytes: ooxml("docx", [{
      name: "word/media/ordinary.bin",
      data: ordinary,
      method: 8,
      compressedData: zlib.deflateRawSync(ordinary),
    }]),
  }));

  const expanded = Buffer.alloc(512 * 1024, 0x41);
  const lyingBomb = {
    name: "word/media/hidden.bin",
    data: expanded,
    method: 8,
    compressedData: zlib.deflateRawSync(expanded),
    uncompressedSize: 1,
  };
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "lying.docx", bytes: ooxml("docx", [lyingBomb]) }),
    errorCode("ATTACHMENT_ZIP_LIMIT"),
  );

  const badCrc = { name: "word/media/image.bin", data: "not-required", crc: 0 };
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "bad-crc.docx", bytes: ooxml("docx", [badCrc]) }),
    errorCode("ATTACHMENT_ZIP_INVALID"),
  );
});

test("OOXML embedded objects, ActiveX, customUI, and unsafe content types are rejected", () => {
  for (const entry of [
    { name: "word/embeddings/oleObject1.bin", data: "ole" },
    { name: "word/embeddings/package1.xlsx", data: "package" },
    { name: "word/activeX/activeX1.bin", data: "activex" },
    { name: "customUI/customUI.xml", data: "<customUI/>" },
  ]) {
    assert.throws(
      () => Attachment.prepareAttachment({ fileName: "active.docx", bytes: ooxml("docx", [entry]) }),
      errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
    );
  }

  const macroContentTypes = Buffer.from(`${contentType("docx").toString("utf8").replace("</Types>", "")}<Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>`);
  assert.throws(
    () => Attachment.prepareAttachment({
      fileName: "macro-content-type.docx",
      bytes: makeZip([
        { name: "[Content_Types].xml", data: macroContentTypes },
        { name: "word/document.xml", data: "<root/>" },
      ]),
    }),
    errorCode("ATTACHMENT_ZIP_MACRO"),
  );

  const packageContentTypes = Buffer.from(`${contentType("docx").toString("utf8").replace("</Types>", "")}<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.package"/></Types>`);
  assert.throws(
    () => Attachment.prepareAttachment({
      fileName: "package-content-type.docx",
      bytes: makeZip([
        { name: "[Content_Types].xml", data: packageContentTypes },
        { name: "word/document.xml", data: "<root/>" },
      ]),
    }),
    errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
  );
});

test("OOXML relationships cannot target external resources or unsafe embedded object types", () => {
  const external = Buffer.from("<?xml version=\"1.0\"?><Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.invalid\" TargetMode=\"External\"/></Relationships>");
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "external.docx", bytes: ooxml("docx", [{ name: "word/_rels/document.xml.rels", data: external }]) }),
    errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
  );

  const embedded = Buffer.from("<?xml version=\"1.0\"?><Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject\" Target=\"object.bin\"/></Relationships>");
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "ole-rel.docx", bytes: ooxml("docx", [{ name: "word/_rels/document.xml.rels", data: embedded }]) }),
    errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
  );

  const encodedOle = Buffer.from("<?xml version=\"1.0\"?><Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObj&#x65;ct\" Target=\"media/object.bin\"/></Relationships>");
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "encoded-ole-rel.docx", bytes: ooxml("docx", [{ name: "word/_rels/document.xml.rels", data: encodedOle }]) }),
    errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
  );

  const encodedMacroType = Buffer.from(`${contentType("docx").toString("utf8").replace("</Types>", "")}<Override ContentType=\"application/vnd.ms-word.document.macro&#x45;nabled.main+xml\"/></Types>`);
  assert.throws(
    () => Attachment.prepareAttachment({ fileName: "encoded-macro.docx", bytes: makeZip([{ name: "[Content_Types].xml", data: encodedMacroType }, { name: "word/document.xml", data: "<root/>" }]) }),
    errorCode("ATTACHMENT_ZIP_UNSAFE_CONTENT"),
  );
});

test("actual bytes enforce the 5MiB limit", () => {
  const exactlyFiveMiB = Buffer.alloc(Attachment.MAX_FILE_BYTES, 0x61);
  assert.equal(Attachment.prepareAttachment({ fileName: "limit.txt", bytes: exactlyFiveMiB }).size, Attachment.MAX_FILE_BYTES);
  assert.throws(() => Attachment.prepareAttachment({ fileName: "too-large.txt", bytes: Buffer.alloc(Attachment.MAX_FILE_BYTES + 1, 0x61) }), errorCode("ATTACHMENT_SIZE_INVALID"));
});

test("payload revalidation requires canonical base64, exact size, canonical MIME, and matching SHA-256", () => {
  const payload = Attachment.prepareAttachment({ fileName: "notes.txt", bytes: fixtures.txt });
  assert.throws(() => Attachment.revalidateAttachmentPayload({ ...payload, fileBody: `${payload.fileBody}\n` }), errorCode("ATTACHMENT_BASE64_INVALID"));
  assert.throws(() => Attachment.revalidateAttachmentPayload({ ...payload, size: payload.size + 1 }), errorCode("ATTACHMENT_SIZE_INVALID"));
  assert.throws(() => Attachment.revalidateAttachmentPayload({ ...payload, extension: "pdf" }), errorCode("ATTACHMENT_TYPE_UNSUPPORTED"));
  assert.throws(() => Attachment.revalidateAttachmentPayload({ ...payload, mimeType: "application/octet-stream" }), errorCode("ATTACHMENT_MIME_MISMATCH"));
  assert.throws(() => Attachment.revalidateAttachmentPayload({ ...payload, sha256: "0".repeat(64) }), errorCode("ATTACHMENT_HASH_MISMATCH"));
});
