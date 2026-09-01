"use strict";

const crypto = require("node:crypto");
const zlib = require("node:zlib");

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_EXPANSION_RATIO = 200;
const MAX_OOXML_XML_PART_BYTES = 2 * 1024 * 1024;
const CFB_FREESECT = 0xffffffff;
const CFB_DIFSECT = 0xfffffffc;
const CFB_FATSECT = 0xfffffffd;
const CFB_ENDOFCHAIN = 0xfffffffe;
const CFB_NOSTREAM = 0xffffffff;
const CFB_MINI_STREAM_CUTOFF = 4096;
const CFB_MINI_SECTOR_SIZE = 64;

const MIME_BY_EXTENSION = Object.freeze({
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

const ALLOWED_EXTENSIONS = Object.freeze(Object.keys(MIME_BY_EXTENSION));
const ZIP_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "hwpx"]);
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;
const INVALID_WINDOWS_CHARACTERS = /[<>:"/\\|?*]/;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

const OOXML_MAIN_CONTENT_TYPE = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
});

class AttachmentValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AttachmentValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AttachmentValidationError(code, message);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  fail("ATTACHMENT_BYTES_INVALID", "첨부 파일 바이트를 확인할 수 없습니다.");
}

function validateWindowsSegment(segment, code) {
  if (!segment || segment === "." || segment === "..") fail(code, "안전하지 않은 파일 이름입니다.");
  if (segment !== segment.normalize("NFC")) fail(code, "파일 이름은 NFC 형식이어야 합니다.");
  if (segment !== segment.trim() || /[ .]$/.test(segment)) fail(code, "파일 이름 앞뒤의 공백과 마침표는 사용할 수 없습니다.");
  if (CONTROL_OR_FORMAT_CHARACTER.test(segment) || INVALID_WINDOWS_CHARACTERS.test(segment)) fail(code, "파일 이름에 사용할 수 없는 문자가 있습니다.");
  if (WINDOWS_RESERVED_NAME.test(segment)) fail(code, "Windows 예약 파일 이름은 사용할 수 없습니다.");
}

function normalizeSafeBaseName(value, options) {
  if (typeof value !== "string") fail("ATTACHMENT_FILENAME_INVALID", "파일 이름을 확인해 주세요.");
  const normalized = value.normalize("NFC");
  if (options && options.requireCanonical && normalized !== value) {
    fail("ATTACHMENT_FILENAME_INVALID", "파일 이름이 정규화된 형식이 아닙니다.");
  }
  if (!normalized || normalized.length > 180 || [...normalized].length > 180) {
    fail("ATTACHMENT_FILENAME_INVALID", "파일 이름은 1자 이상 180자 이하여야 합니다.");
  }
  validateWindowsSegment(normalized, "ATTACHMENT_FILENAME_INVALID");
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) fail("ATTACHMENT_TYPE_UNSUPPORTED", "지원하는 파일 확장자가 필요합니다.");
  const extension = normalized.slice(dot + 1).toLowerCase();
  if (!Object.hasOwn(MIME_BY_EXTENSION, extension)) fail("ATTACHMENT_TYPE_UNSUPPORTED", "지원하지 않는 파일 형식입니다.");
  return { fileName: normalized, extension, mimeType: MIME_BY_EXTENSION[extension] };
}

function decodeUtf8Strict(bytes, code, message) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_error) {
    fail(code, message);
  }
}

function validateTextFile(buffer) {
  const text = decodeUtf8Strict(buffer, "ATTACHMENT_MAGIC_MISMATCH", "텍스트 파일은 UTF-8 형식이어야 합니다.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(text)) {
    fail("ATTACHMENT_MAGIC_MISMATCH", "텍스트 파일에 허용되지 않는 제어 문자가 있습니다.");
  }
}

function startsWithBytes(buffer, signature) {
  if (buffer.length < signature.length) return false;
  return signature.every((value, index) => buffer[index] === value);
}

function validatePdf(buffer) {
  const header = buffer.subarray(0, 8).toString("ascii");
  if (!/^%PDF-(?:1\.[0-9]|2\.0)/.test(header)) fail("ATTACHMENT_MAGIC_MISMATCH", "PDF 파일 서명이 올바르지 않습니다.");
  const tailStart = Math.max(0, buffer.length - 2048);
  if (buffer.lastIndexOf(Buffer.from("%%EOF", "ascii")) < tailStart) fail("ATTACHMENT_MAGIC_MISMATCH", "PDF 종료 서명을 확인할 수 없습니다.");
}

function validateJpeg(buffer) {
  if (buffer.length < 6 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    fail("ATTACHMENT_MAGIC_MISMATCH", "JPEG 파일 서명이 올바르지 않습니다.");
  }
}

function validatePng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!startsWithBytes(buffer, signature) || buffer.length < 33 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    fail("ATTACHMENT_MAGIC_MISMATCH", "PNG 파일 서명이 올바르지 않습니다.");
  }
}

function validateWebp(buffer) {
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (buffer.length < 16
    || buffer.subarray(0, 4).toString("ascii") !== "RIFF"
    || buffer.subarray(8, 12).toString("ascii") !== "WEBP"
    || !["VP8 ", "VP8L", "VP8X"].includes(chunk)
    || buffer.readUInt32LE(4) + 8 !== buffer.length) {
    fail("ATTACHMENT_MAGIC_MISMATCH", "WebP 파일 서명이 올바르지 않습니다.");
  }
}

function safeCfbStreamSize(buffer, offset, majorVersion) {
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  // CFB v3 stream sizes are 32-bit. Older writers commonly leave the upper
  // DWORD uninitialised, so readers must ignore it instead of rejecting an
  // otherwise valid legacy HWP document. CFB v4 uses the full 64-bit field.
  if (majorVersion === 3) return low;
  if (high !== 0) fail("ATTACHMENT_CFB_INVALID", "복합 문서 스트림 크기가 허용 범위를 초과했습니다.");
  return low;
}

function cfbSectorId(value, sectorCount) {
  return Number.isSafeInteger(value) && value >= 0 && value < sectorCount;
}

function parseCfbDirectoryName(entryBytes, type) {
  const nameLength = entryBytes.readUInt16LE(64);
  if (type === 0) {
    if (nameLength !== 0) fail("ATTACHMENT_CFB_INVALID", "사용하지 않는 복합 문서 항목 이름이 올바르지 않습니다.");
    return "";
  }
  if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0 || entryBytes.readUInt16LE(nameLength - 2) !== 0) {
    fail("ATTACHMENT_CFB_INVALID", "복합 문서 항목 이름 길이가 올바르지 않습니다.");
  }
  const name = entryBytes.subarray(0, nameLength - 2).toString("utf16le");
  const nameWithoutSummaryPrefix = name.startsWith("\u0005") ? name.slice(1) : name;
  if (!name
    || !nameWithoutSummaryPrefix
    || name.includes("\u0000")
    || /[\ud800-\udfff]/u.test(name)
    || /[\\/:!]/u.test(nameWithoutSummaryPrefix)
    || /[\p{Cc}\p{Cf}]/u.test(nameWithoutSummaryPrefix)) {
    fail("ATTACHMENT_CFB_INVALID", "복합 문서 항목 이름이 올바르지 않습니다.");
  }
  return name;
}

function parseCompoundFile(buffer) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!startsWithBytes(buffer, signature) || buffer.length < 1536) {
    fail("ATTACHMENT_MAGIC_MISMATCH", "HWP 복합 파일 서명이 올바르지 않습니다.");
  }
  if (buffer.subarray(8, 24).some(value => value !== 0)) fail("ATTACHMENT_CFB_INVALID", "복합 파일 헤더 CLSID가 올바르지 않습니다.");
  const minorVersion = buffer.readUInt16LE(24);
  const majorVersion = buffer.readUInt16LE(26);
  const byteOrder = buffer.readUInt16LE(28);
  const sectorShift = buffer.readUInt16LE(30);
  const miniSectorShift = buffer.readUInt16LE(32);
  if (minorVersion !== 0x003e
    || ![3, 4].includes(majorVersion)
    || byteOrder !== 0xfffe
    || sectorShift !== (majorVersion === 3 ? 9 : 12)
    || miniSectorShift !== 6
    || buffer.subarray(34, 40).some(value => value !== 0)) {
    fail("ATTACHMENT_CFB_INVALID", "복합 파일 헤더 버전 또는 섹터 설정이 올바르지 않습니다.");
  }
  const sectorSize = 1 << sectorShift;
  if (buffer.length % sectorSize !== 0 || buffer.length < sectorSize * 3) {
    fail("ATTACHMENT_CFB_INVALID", "복합 파일 전체 크기가 섹터 경계와 일치하지 않습니다.");
  }
  const sectorCount = buffer.length / sectorSize - 1;
  const directorySectorCount = buffer.readUInt32LE(40);
  const fatSectorCount = buffer.readUInt32LE(44);
  const firstDirectorySector = buffer.readUInt32LE(48);
  const miniStreamCutoff = buffer.readUInt32LE(56);
  const firstMiniFatSector = buffer.readUInt32LE(60);
  const miniFatSectorCount = buffer.readUInt32LE(64);
  const firstDifatSector = buffer.readUInt32LE(68);
  const difatSectorCount = buffer.readUInt32LE(72);
  if ((majorVersion === 3 && directorySectorCount !== 0)
    || (majorVersion === 4 && directorySectorCount < 1)
    || !fatSectorCount || fatSectorCount > 109 || fatSectorCount > sectorCount
    || !cfbSectorId(firstDirectorySector, sectorCount)
    || miniStreamCutoff !== CFB_MINI_STREAM_CUTOFF
    || (miniFatSectorCount === 0 ? firstMiniFatSector !== CFB_ENDOFCHAIN : !cfbSectorId(firstMiniFatSector, sectorCount))
    || firstDifatSector !== CFB_ENDOFCHAIN
    || difatSectorCount !== 0) {
    // A file capped at 5 MiB never needs a DIFAT sector: even 512-byte CFB
    // sectors need fewer than the 109 FAT locations available in the header.
    fail("ATTACHMENT_CFB_INVALID", "복합 파일 내부 스트림 위치가 올바르지 않습니다.");
  }

  const sectorBytes = id => {
    if (!cfbSectorId(id, sectorCount)) fail("ATTACHMENT_CFB_INVALID", "복합 파일 섹터 번호가 범위를 벗어났습니다.");
    const offset = (id + 1) * sectorSize;
    return buffer.subarray(offset, offset + sectorSize);
  };
  const fatSectorIds = [];
  const fatSectorSet = new Set();
  for (let index = 0; index < 109; index += 1) {
    const id = buffer.readUInt32LE(76 + index * 4);
    if (index < fatSectorCount) {
      if (!cfbSectorId(id, sectorCount) || fatSectorSet.has(id)) fail("ATTACHMENT_CFB_INVALID", "복합 파일 FAT 섹터 목록이 올바르지 않습니다.");
      fatSectorIds.push(id);
      fatSectorSet.add(id);
    } else if (id !== CFB_FREESECT) {
      fail("ATTACHMENT_CFB_INVALID", "사용하지 않는 DIFAT 헤더 항목이 비어 있지 않습니다.");
    }
  }
  const fat = [];
  fatSectorIds.forEach(id => {
    const bytes = sectorBytes(id);
    for (let offset = 0; offset < bytes.length; offset += 4) fat.push(bytes.readUInt32LE(offset));
  });
  if (fat.length < sectorCount) fail("ATTACHMENT_CFB_INVALID", "복합 파일 FAT가 전체 섹터를 포함하지 않습니다.");
  fatSectorIds.forEach(id => {
    if (fat[id] !== CFB_FATSECT) fail("ATTACHMENT_CFB_INVALID", "복합 파일 FAT 자체 표시가 올바르지 않습니다.");
  });
  for (let index = sectorCount; index < fat.length; index += 1) {
    if (fat[index] !== CFB_FREESECT) fail("ATTACHMENT_CFB_INVALID", "복합 파일 FAT 여유 항목이 비어 있지 않습니다.");
  }
  for (let index = 0; index < sectorCount; index += 1) {
    const next = fat[index];
    if (!cfbSectorId(next, sectorCount) && ![CFB_FREESECT, CFB_DIFSECT, CFB_FATSECT, CFB_ENDOFCHAIN].includes(next)) {
      fail("ATTACHMENT_CFB_INVALID", "복합 파일 FAT 연결 값이 올바르지 않습니다.");
    }
    if (next === CFB_DIFSECT) fail("ATTACHMENT_CFB_INVALID", "허용 크기에서 불필요한 DIFAT 섹터가 발견되었습니다.");
  }

  const sectorOwners = new Map(fatSectorIds.map(id => [id, "FAT"]));
  function readFatChain(start, owner, expectedCount) {
    if (expectedCount === 0) {
      if (start !== CFB_ENDOFCHAIN) fail("ATTACHMENT_CFB_INVALID", `${owner} 빈 스트림 시작 위치가 올바르지 않습니다.`);
      return [];
    }
    if (!cfbSectorId(start, sectorCount)) fail("ATTACHMENT_CFB_INVALID", `${owner} 시작 섹터가 올바르지 않습니다.`);
    const ids = [];
    const seen = new Set();
    let current = start;
    while (current !== CFB_ENDOFCHAIN) {
      if (!cfbSectorId(current, sectorCount) || seen.has(current) || sectorOwners.has(current)) {
        fail("ATTACHMENT_CFB_INVALID", `${owner} 섹터 연결이 순환하거나 겹칩니다.`);
      }
      seen.add(current);
      sectorOwners.set(current, owner);
      ids.push(current);
      if (ids.length > sectorCount || expectedCount != null && ids.length > expectedCount) {
        fail("ATTACHMENT_CFB_INVALID", `${owner} 섹터 수가 허용 범위를 초과했습니다.`);
      }
      current = fat[current];
      if (![CFB_ENDOFCHAIN].includes(current) && !cfbSectorId(current, sectorCount)) {
        fail("ATTACHMENT_CFB_INVALID", `${owner} FAT 연결이 올바르지 않습니다.`);
      }
    }
    if (expectedCount != null && ids.length !== expectedCount) fail("ATTACHMENT_CFB_INVALID", `${owner} 섹터 수가 표시 크기와 다릅니다.`);
    return ids;
  }

  const directoryIds = readFatChain(firstDirectorySector, "Directory", majorVersion === 4 ? directorySectorCount : null);
  if (!directoryIds.length) fail("ATTACHMENT_CFB_INVALID", "복합 파일 디렉터리 스트림이 비어 있습니다.");
  const directoryBytes = Buffer.concat(directoryIds.map(sectorBytes));
  if (directoryBytes.length % 128 !== 0) fail("ATTACHMENT_CFB_INVALID", "복합 파일 디렉터리 크기가 올바르지 않습니다.");
  const entries = [];
  for (let offset = 0, index = 0; offset < directoryBytes.length; offset += 128, index += 1) {
    const bytes = directoryBytes.subarray(offset, offset + 128);
    const type = bytes[66];
    const color = bytes[67];
    if (![0, 1, 2, 5].includes(type) || (type !== 0 && ![0, 1].includes(color))) {
      fail("ATTACHMENT_CFB_INVALID", "복합 파일 디렉터리 항목 유형이 올바르지 않습니다.");
    }
    const entry = {
      index,
      name: parseCfbDirectoryName(bytes, type),
      type,
      color,
      left: bytes.readUInt32LE(68),
      right: bytes.readUInt32LE(72),
      child: bytes.readUInt32LE(76),
      start: bytes.readUInt32LE(116),
      size: safeCfbStreamSize(bytes, 120, majorVersion),
      path: "",
      parent: -1,
    };
    // CFB permits unused directory slots to contain writer-specific residual
    // metadata. They can never be referenced below and allocated sectors are
    // still rejected by the ownership checks, so only live entries need a
    // stream-size limit.
    if (type !== 0 && entry.size > MAX_FILE_BYTES) {
      fail("ATTACHMENT_CFB_INVALID", "복합 문서 사용자 스트림이 최대 파일 크기를 초과했습니다.");
    }
    entries.push(entry);
  }
  const root = entries[0];
  if (!root || root.type !== 5 || root.name !== "Root Entry" || root.left !== CFB_NOSTREAM || root.right !== CFB_NOSTREAM) {
    fail("ATTACHMENT_CFB_INVALID", "복합 파일 루트 디렉터리가 올바르지 않습니다.");
  }
  entries.slice(1).forEach(entry => {
    if (entry.type === 5) fail("ATTACHMENT_CFB_INVALID", "복합 파일에 루트 디렉터리가 중복되었습니다.");
  });

  const assigned = new Set([0]);
  function childIndex(value, owner) {
    if (value === CFB_NOSTREAM) return -1;
    if (!Number.isSafeInteger(value) || value <= 0 || value >= entries.length || entries[value].type === 0) {
      fail("ATTACHMENT_CFB_INVALID", `${owner} 디렉터리 참조가 올바르지 않습니다.`);
    }
    return value;
  }
  function attachSiblingTree(indexValue, parent, parentPath, stack, siblingNames) {
    const index = childIndex(indexValue, "복합 파일");
    if (index < 0) return;
    if (stack.has(index)) fail("ATTACHMENT_CFB_INVALID", "복합 파일 디렉터리 트리가 순환합니다.");
    stack.add(index);
    const entry = entries[index];
    attachSiblingTree(entry.left, parent, parentPath, stack, siblingNames);
    if (assigned.has(index)) fail("ATTACHMENT_CFB_INVALID", "복합 파일 디렉터리 항목이 여러 위치에 연결되었습니다.");
    const foldedName = entry.name.toLocaleLowerCase("en-US");
    if (siblingNames.has(foldedName)) fail("ATTACHMENT_CFB_INVALID", "복합 파일에 대소문자만 다른 중복 항목이 있습니다.");
    siblingNames.add(foldedName);
    assigned.add(index);
    entry.parent = parent;
    entry.path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.type === 1) {
      if (entry.size !== 0) fail("ATTACHMENT_CFB_INVALID", "복합 파일 스토리지 크기가 0이 아닙니다.");
      attachSiblingTree(entry.child, index, entry.path, new Set(), new Set());
    } else if (entry.type === 2 && entry.child !== CFB_NOSTREAM) {
      fail("ATTACHMENT_CFB_INVALID", "복합 파일 스트림에 하위 항목이 연결되었습니다.");
    }
    attachSiblingTree(entry.right, parent, parentPath, stack, siblingNames);
    stack.delete(index);
  }
  attachSiblingTree(root.child, 0, "", new Set(), new Set());
  if (entries.some(entry => entry.type !== 0 && !assigned.has(entry.index))) {
    fail("ATTACHMENT_CFB_INVALID", "복합 파일 디렉터리에 연결되지 않은 항목이 있습니다.");
  }

  const miniFatIds = readFatChain(firstMiniFatSector, "MiniFAT", miniFatSectorCount);
  const miniFat = [];
  miniFatIds.forEach(id => {
    const bytes = sectorBytes(id);
    for (let offset = 0; offset < bytes.length; offset += 4) miniFat.push(bytes.readUInt32LE(offset));
  });
  const rootSectorCount = root.size ? Math.ceil(root.size / sectorSize) : 0;
  const rootMiniIds = readFatChain(root.start, "MiniStream", rootSectorCount);
  const rootMiniStream = Buffer.concat(rootMiniIds.map(sectorBytes)).subarray(0, root.size);
  const miniSectorCount = Math.ceil(rootMiniStream.length / CFB_MINI_SECTOR_SIZE);
  if (miniFatSectorCount === 0 && miniSectorCount !== 0) fail("ATTACHMENT_CFB_INVALID", "MiniStream에 필요한 MiniFAT가 없습니다.");
  if (miniFat.length < miniSectorCount) fail("ATTACHMENT_CFB_INVALID", "MiniFAT가 MiniStream 전체를 포함하지 않습니다.");
  for (let index = miniSectorCount; index < miniFat.length; index += 1) {
    if (miniFat[index] !== CFB_FREESECT) fail("ATTACHMENT_CFB_INVALID", "MiniFAT 여유 항목이 비어 있지 않습니다.");
  }
  const miniOwners = new Map();
  function readMiniStream(entry) {
    const expectedCount = Math.ceil(entry.size / CFB_MINI_SECTOR_SIZE);
    if (!expectedCount) {
      if (entry.start !== CFB_ENDOFCHAIN) fail("ATTACHMENT_CFB_INVALID", `${entry.path} 빈 MiniStream 위치가 올바르지 않습니다.`);
      return Buffer.alloc(0);
    }
    if (!Number.isSafeInteger(entry.start) || entry.start < 0 || entry.start >= miniSectorCount) {
      fail("ATTACHMENT_CFB_INVALID", `${entry.path} MiniStream 시작 위치가 올바르지 않습니다.`);
    }
    const chunks = [];
    const seen = new Set();
    let current = entry.start;
    while (current !== CFB_ENDOFCHAIN) {
      if (!Number.isSafeInteger(current) || current < 0 || current >= miniSectorCount || seen.has(current) || miniOwners.has(current)) {
        fail("ATTACHMENT_CFB_INVALID", `${entry.path} MiniStream 연결이 순환하거나 겹칩니다.`);
      }
      seen.add(current);
      miniOwners.set(current, entry.path);
      chunks.push(rootMiniStream.subarray(current * CFB_MINI_SECTOR_SIZE, (current + 1) * CFB_MINI_SECTOR_SIZE));
      if (chunks.length > expectedCount) fail("ATTACHMENT_CFB_INVALID", `${entry.path} MiniStream 크기가 표시 크기를 초과했습니다.`);
      current = miniFat[current];
      if (current !== CFB_ENDOFCHAIN && (!Number.isSafeInteger(current) || current < 0 || current >= miniSectorCount)) {
        fail("ATTACHMENT_CFB_INVALID", `${entry.path} MiniFAT 연결이 올바르지 않습니다.`);
      }
    }
    if (chunks.length !== expectedCount) fail("ATTACHMENT_CFB_INVALID", `${entry.path} MiniStream 크기가 표시 크기와 다릅니다.`);
    return Buffer.concat(chunks).subarray(0, entry.size);
  }
  const streamCache = new Map();
  function readStream(entry) {
    if (!entry || entry.type !== 2) fail("ATTACHMENT_CFB_INVALID", "복합 파일 스트림 항목이 아닙니다.");
    if (streamCache.has(entry.index)) return Buffer.from(streamCache.get(entry.index));
    let bytes;
    if (entry.size < CFB_MINI_STREAM_CUTOFF) bytes = readMiniStream(entry);
    else {
      const ids = readFatChain(entry.start, entry.path, Math.ceil(entry.size / sectorSize));
      bytes = Buffer.concat(ids.map(sectorBytes)).subarray(0, entry.size);
    }
    streamCache.set(entry.index, bytes);
    return Buffer.from(bytes);
  }
  entries.filter(entry => entry.type === 2).forEach(readStream);
  for (let index = 0; index < sectorCount; index += 1) {
    if (fat[index] !== CFB_FREESECT && !sectorOwners.has(index)) fail("ATTACHMENT_CFB_INVALID", "복합 파일에 소유자가 없는 할당 섹터가 있습니다.");
  }
  for (let index = 0; index < miniSectorCount; index += 1) {
    if (miniFat[index] !== CFB_FREESECT && !miniOwners.has(index)) fail("ATTACHMENT_CFB_INVALID", "MiniStream에 소유자가 없는 할당 섹터가 있습니다.");
  }
  return { entries, readStream };
}

function hwpLooksLikePeExecutable(bytes) {
  if (!bytes || bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false;
  const peOffset = bytes.readUInt32LE(0x3c);
  return Number.isSafeInteger(peOffset)
    && peOffset >= 64
    && peOffset + 4 <= bytes.length
    && bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]));
}

function hwpUnsafeEmbeddedBytes(bytes) {
  if (!bytes || !bytes.length) return false;
  const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return startsWithBytes(bytes, oleSignature)
    || hwpLooksLikePeExecutable(bytes)
    || /^\s*(?:<script\b|<\?php\b|#!)/i.test(bytes.subarray(0, 1024).toString("latin1"));
}

const HWP_INERT_SCRIPT_DECLARATIONS = "var Documents = XHwpDocuments;\r\nvar Document = Documents.Active_XHwpDocument;\r\n";
const HWP_INERT_SCRIPT_EVENT = "function OnDocument_New()\r\n{\r\n\t//todo : \r\n}\r\n\r\n";
const HWP_INERT_SCRIPT_VERSION = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);

function hwpHasOnlyInertDefaultScript(bytes) {
  if (!bytes || bytes.length !== 272 || bytes.readUInt32LE(0) !== 79) return false;
  const declarations = Buffer.from(HWP_INERT_SCRIPT_DECLARATIONS, "utf16le");
  const declarationsEnd = 4 + declarations.length;
  if (declarations.length !== 79 * 2 || !bytes.subarray(4, declarationsEnd).equals(declarations)) return false;
  if (bytes.readUInt32LE(declarationsEnd) !== 47) return false;
  const event = Buffer.from(HWP_INERT_SCRIPT_EVENT, "utf16le");
  const eventStart = declarationsEnd + 4;
  const eventEnd = eventStart + event.length;
  return event.length === 47 * 2
    && bytes.subarray(eventStart, eventEnd).equals(event)
    && bytes.readUInt32LE(eventEnd) === 0
    && bytes.readUInt32LE(eventEnd + 4) === 0
    && bytes.readInt32LE(eventEnd + 8) === -1
    && eventEnd + 12 === bytes.length;
}

function validateHwp(buffer) {
  const compound = parseCompoundFile(buffer);
  const rootEntries = compound.entries.filter(entry => entry.parent === 0);
  const fileHeaders = rootEntries.filter(entry => entry.type === 2 && entry.name === "FileHeader");
  const docInfo = rootEntries.filter(entry => entry.type === 2 && entry.name === "DocInfo");
  const bodyText = rootEntries.filter(entry => entry.type === 1 && entry.name === "BodyText");
  const sections = bodyText.length === 1
    ? compound.entries.filter(entry => entry.parent === bodyText[0].index && entry.type === 2 && /^Section(?:0|[1-9][0-9]*)$/.test(entry.name))
    : [];
  if (fileHeaders.length !== 1 || docInfo.length !== 1 || bodyText.length !== 1 || !sections.some(entry => entry.name === "Section0")) {
    fail("ATTACHMENT_MAGIC_MISMATCH", "HWP 필수 FileHeader·DocInfo·BodyText 구조를 확인할 수 없습니다.");
  }
  const header = compound.readStream(fileHeaders[0]);
  if (header.length !== 256
    || header.subarray(0, 17).toString("ascii") !== "HWP Document File"
    || header.subarray(17, 32).some(value => value !== 0)) {
    fail("ATTACHMENT_MAGIC_MISMATCH", "HWP FileHeader 서명이 올바르지 않습니다.");
  }
  const version = header.readUInt32LE(32);
  const flags = header.readUInt32LE(36);
  const licenseFlags = header.readUInt32LE(40);
  const encryptionVersion = header.readUInt32LE(44);
  const country = header[48];
  const hwpMajorVersion = version >>> 24;
  const unsupportedFlags = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 8) | (1 << 10) | (1 << 13) | (1 << 16);
  if (hwpMajorVersion !== 5
    || (flags & 0xfffc0000) !== 0
    || (flags & unsupportedFlags) !== 0
    || (licenseFlags & 0xfffffff8) !== 0
    || ![0, 1, 2, 3, 4].includes(encryptionVersion)
    || ![0, 6, 15].includes(country)
    || header.subarray(49).some(value => value !== 0)) {
    fail("ATTACHMENT_HWP_UNSAFE", "암호화·스크립트·활성 콘텐츠가 없고 정상적인 HWP 5.x 문서만 첨부할 수 있습니다.");
  }
  const documentCompressed = (flags & 1) !== 0;
  let totalInflatedBytes = 0;
  function inflateHwpStreamForInspection(bytes, allowRawFallback = false) {
    if (!documentCompressed) return bytes;
    let inflated;
    try {
      inflated = zlib.inflateRawSync(bytes, { maxOutputLength: MAX_ZIP_UNCOMPRESSED_BYTES - totalInflatedBytes + 1 });
    } catch (error) {
      if (allowRawFallback) return bytes;
      fail("ATTACHMENT_HWP_UNSAFE", "압축된 HWP 내부 스트림을 제한 범위에서 검증할 수 없습니다.");
    }
    totalInflatedBytes += inflated.length;
    if (totalInflatedBytes > MAX_ZIP_UNCOMPRESSED_BYTES
      || inflated.length > Math.max(1, bytes.length) * MAX_ZIP_EXPANSION_RATIO) {
      fail("ATTACHMENT_HWP_UNSAFE", "HWP 내부 스트림의 압축 해제 크기 또는 확장률이 허용 범위를 초과했습니다.");
    }
    return inflated;
  }

  const allowedScriptEntryIndexes = new Set();
  const scriptStorages = rootEntries.filter(entry => entry.type === 1 && entry.name.toLocaleLowerCase("en-US") === "scripts");
  if (scriptStorages.length > 1) fail("ATTACHMENT_HWP_UNSAFE", "HWP 스크립트 저장소 구조가 올바르지 않습니다.");
  if (scriptStorages.length === 1) {
    const scriptStorage = scriptStorages[0];
    const children = compound.entries.filter(entry => entry.parent === scriptStorage.index);
    const names = children.map(entry => entry.name).sort();
    if (scriptStorage.name !== "Scripts"
      || children.some(entry => entry.type !== 2)
      || names.length !== 2
      || names[0] !== "DefaultJScript"
      || names[1] !== "JScriptVersion") {
      fail("ATTACHMENT_HWP_UNSAFE", "실행 가능한 스크립트 구조가 포함된 HWP 문서는 첨부할 수 없습니다.");
    }
    const versionEntry = children.find(entry => entry.name === "JScriptVersion");
    const defaultEntry = children.find(entry => entry.name === "DefaultJScript");
    const versionBytes = inflateHwpStreamForInspection(compound.readStream(versionEntry));
    const defaultBytes = inflateHwpStreamForInspection(compound.readStream(defaultEntry));
    if (!versionBytes.equals(HWP_INERT_SCRIPT_VERSION) || !hwpHasOnlyInertDefaultScript(defaultBytes)) {
      fail("ATTACHMENT_HWP_UNSAFE", "실행 가능한 스크립트가 포함된 HWP 문서는 첨부할 수 없습니다.");
    }
    allowedScriptEntryIndexes.add(scriptStorage.index);
    allowedScriptEntryIndexes.add(versionEntry.index);
    allowedScriptEntryIndexes.add(defaultEntry.index);
  }

  const allowedLinkDocEntryIndexes = new Set();
  const linkDocEntries = compound.entries.filter(entry => entry.path
    && entry.path.split("/").some(segment => segment.toLocaleLowerCase("en-US") === "_linkdoc"));
  if (linkDocEntries.length) {
    if (linkDocEntries.length !== 1 || linkDocEntries[0].type !== 2 || linkDocEntries[0].path !== "DocOptions/_LinkDoc") {
      fail("ATTACHMENT_HWP_UNSAFE", "외부 연결 문서 정보가 포함된 HWP 문서는 첨부할 수 없습니다.");
    }
    const linkDocBytes = compound.readStream(linkDocEntries[0]);
    if (linkDocBytes.length !== 524 || linkDocBytes.readUInt16LE(0) !== 0) {
      fail("ATTACHMENT_HWP_UNSAFE", "활성화된 외부 연결 문서 정보가 포함된 HWP 문서는 첨부할 수 없습니다.");
    }
    allowedLinkDocEntryIndexes.add(linkDocEntries[0].index);
  }

  for (const entry of compound.entries) {
    if (!entry.path) continue;
    const segments = entry.path.split("/").map(segment => segment.toLocaleLowerCase("en-US"));
    const scriptNamedEntry = segments.some(segment => ["scripts", "defaultjscript", "jscriptversion"].includes(segment));
    const linkDocNamedEntry = segments.includes("_linkdoc");
    if ((scriptNamedEntry && !allowedScriptEntryIndexes.has(entry.index))
      || (linkDocNamedEntry && !allowedLinkDocEntryIndexes.has(entry.index))
      || segments.some(segment => ["xmltemplate", "drmlicense", "objectpool", "activex", "macros", "vba"].includes(segment))) {
      fail("ATTACHMENT_HWP_UNSAFE", "스크립트·외부 연결·활성 콘텐츠가 포함된 HWP 문서는 첨부할 수 없습니다.");
    }
    if (entry.type !== 2) continue;
    const bytes = compound.readStream(entry);
    let inspectedBytes = bytes;
    const mustBeCompressed = documentCompressed
      && (entry === docInfo[0] || segments.includes("bodytext") || segments.includes("dochistory"));
    const mayBeCompressedBinData = documentCompressed && segments.includes("bindata");
    if (mustBeCompressed || mayBeCompressedBinData) {
      // HWP BinData has its own per-item compression mode. A document can be
      // globally compressed while a JPEG/PNG BinData stream is stored raw.
      inspectedBytes = inflateHwpStreamForInspection(bytes, mayBeCompressedBinData);
    }
    if (!segments.includes("bindata")) continue;
    const name = segments[segments.length - 1];
    if (/\.(?:ole|exe|dll|com|scr|js|jse|vbs|vbe|ps1|bat|cmd|msi)$/i.test(name)
      || hwpUnsafeEmbeddedBytes(bytes)
      || hwpUnsafeEmbeddedBytes(inspectedBytes)) {
      fail("ATTACHMENT_HWP_UNSAFE", "실행 파일 또는 OLE 개체가 포함된 HWP 문서는 첨부할 수 없습니다.");
    }
  }
}

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

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  fail("ATTACHMENT_ZIP_INVALID", "ZIP 중앙 디렉터리를 찾을 수 없습니다.");
}

function parseZipExtra(extra) {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) fail("ATTACHMENT_ZIP_INVALID", "ZIP 추가 필드가 손상되었습니다.");
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > extra.length) fail("ATTACHMENT_ZIP_INVALID", "ZIP 추가 필드 길이가 올바르지 않습니다.");
    if (id === 0x0001) fail("ATTACHMENT_ZIP_INVALID", "ZIP64 형식은 지원하지 않습니다.");
    offset += size;
  }
}

function normalizeZipEntryName(name) {
  if (!name || name.length > 1024 || name !== name.normalize("NFC")) fail("ATTACHMENT_ZIP_TRAVERSAL", "ZIP 항목 이름이 안전하지 않습니다.");
  if (name.startsWith("/") || name.startsWith("\\") || name.includes("\\") || /^[A-Za-z]:/.test(name) || CONTROL_OR_FORMAT_CHARACTER.test(name)) {
    fail("ATTACHMENT_ZIP_TRAVERSAL", "ZIP 절대 경로나 제어 문자는 허용되지 않습니다.");
  }
  const isDirectory = name.endsWith("/");
  const body = isDirectory ? name.slice(0, -1) : name;
  const segments = body.split("/");
  if (!body || segments.some(segment => !segment || segment === "." || segment === "..")) {
    fail("ATTACHMENT_ZIP_TRAVERSAL", "ZIP 경로 이동 항목은 허용되지 않습니다.");
  }
  segments.forEach(segment => validateWindowsSegment(segment, "ATTACHMENT_ZIP_TRAVERSAL"));
  return { name, isDirectory };
}

function isMacroEntry(name) {
  const lower = name.toLowerCase();
  return /(^|\/)vbaproject\.bin$/.test(lower)
    || /(^|\/)vbadata\.xml$/.test(lower)
    || /(^|\/)macros?(?:\/|$)/.test(lower)
    || /(^|\/)wordbasic(?:\/|$)/.test(lower);
}

function isUnsafeOoxmlEntry(name) {
  const lower = name.toLowerCase();
  return /(^|\/)(?:embeddings|activex)(?:\/|$)/.test(lower)
    || /^customui(?:\/|$)/.test(lower);
}

function exceedsZipExpansionLimit(uncompressedSize, compressedSize) {
  return uncompressedSize > 0
    && (compressedSize === 0 || uncompressedSize > compressedSize * MAX_ZIP_EXPANSION_RATIO);
}

function readZipEntry(buffer, entry, maximumBytes) {
  if (entry.uncompressedSize > maximumBytes) fail("ATTACHMENT_ZIP_LIMIT", "ZIP 압축 해제 크기는 최대 50MiB입니다.");
  const compressed = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let output;
  if (entry.method === 0) output = Buffer.from(compressed);
  else {
    try {
      output = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, maximumBytes + 1) });
    } catch (error) {
      if (error && (error.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|larger than/i.test(String(error.message || "")))) {
        fail("ATTACHMENT_ZIP_LIMIT", "ZIP 압축 해제 크기는 최대 50MiB입니다.");
      }
      fail("ATTACHMENT_ZIP_INVALID", "ZIP 항목의 압축을 해제할 수 없습니다.");
    }
  }
  if (output.length > maximumBytes) fail("ATTACHMENT_ZIP_LIMIT", "ZIP 압축 해제 크기는 최대 50MiB입니다.");
  if (exceedsZipExpansionLimit(output.length, entry.compressedSize)) {
    fail("ATTACHMENT_ZIP_LIMIT", "ZIP 압축 확장률은 최대 200배입니다.");
  }
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) fail("ATTACHMENT_ZIP_INVALID", "ZIP 항목의 크기 또는 체크섬이 다릅니다.");
  return output;
}

function inspectZip(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) fail("ATTACHMENT_MAGIC_MISMATCH", "ZIP 파일 서명이 올바르지 않습니다.");
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) fail("ATTACHMENT_ZIP_INVALID", "분할 ZIP 파일은 지원하지 않습니다.");
  if (!totalEntries || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail("ATTACHMENT_ZIP_INVALID", "ZIP 항목 수 또는 크기가 올바르지 않습니다.");
  if (totalEntries > MAX_ZIP_ENTRIES) fail("ATTACHMENT_ZIP_LIMIT", `ZIP 항목은 최대 ${MAX_ZIP_ENTRIES}개까지 허용됩니다.`);
  if (centralOffset + centralSize !== eocdOffset || centralOffset < 4) fail("ATTACHMENT_ZIP_INVALID", "ZIP 중앙 디렉터리 위치가 올바르지 않습니다.");

  const entries = [];
  const names = new Set();
  const localOffsets = new Set();
  let cursor = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocdOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) fail("ATTACHMENT_ZIP_INVALID", "ZIP 중앙 디렉터리 항목이 손상되었습니다.");
    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const diskStart = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || end > eocdOffset || diskStart !== 0) fail("ATTACHMENT_ZIP_INVALID", "ZIP 중앙 디렉터리 길이가 올바르지 않습니다.");
    if (flags & 0x0001 || flags & 0x0040 || flags & 0x2000) fail("ATTACHMENT_ZIP_ENCRYPTED", "암호화된 ZIP 항목은 허용되지 않습니다.");
    if (![0, 8].includes(method)) fail("ATTACHMENT_ZIP_INVALID", "지원하지 않는 ZIP 압축 방식입니다.");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) fail("ATTACHMENT_ZIP_INVALID", "ZIP64 형식은 지원하지 않습니다.");
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeUtf8Strict(nameBytes, "ATTACHMENT_ZIP_TRAVERSAL", "ZIP 항목 이름은 UTF-8이어야 합니다.");
    const normalized = normalizeZipEntryName(name);
    const uniqueName = name.toLocaleLowerCase("en-US");
    if (names.has(uniqueName) || localOffsets.has(localOffset)) fail("ATTACHMENT_ZIP_INVALID", "중복된 ZIP 항목은 허용되지 않습니다.");
    names.add(uniqueName);
    localOffsets.add(localOffset);
    if (isMacroEntry(name)) fail("ATTACHMENT_ZIP_MACRO", "매크로가 포함된 문서는 첨부할 수 없습니다.");
    const madeBySystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (madeBySystem === 3 && (unixMode & 0xf000) === 0xa000) fail("ATTACHMENT_ZIP_TRAVERSAL", "ZIP 심볼릭 링크는 허용되지 않습니다.");
    const centralExtra = buffer.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    parseZipExtra(centralExtra);

    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) fail("ATTACHMENT_ZIP_INVALID", "ZIP 로컬 항목 위치가 올바르지 않습니다.");
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localMethod !== method || dataOffset > centralOffset || dataOffset + compressedSize > centralOffset) fail("ATTACHMENT_ZIP_INVALID", "ZIP 로컬 항목 정보가 일치하지 않습니다.");
    const localName = decodeUtf8Strict(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength), "ATTACHMENT_ZIP_TRAVERSAL", "ZIP 로컬 항목 이름이 올바르지 않습니다.");
    if (localName !== name) fail("ATTACHMENT_ZIP_INVALID", "ZIP 중앙·로컬 항목 이름이 일치하지 않습니다.");
    parseZipExtra(buffer.subarray(localOffset + 30 + localNameLength, dataOffset));
    if (!(flags & 0x0008)) {
      if (buffer.readUInt32LE(localOffset + 14) !== crc
        || buffer.readUInt32LE(localOffset + 18) !== compressedSize
        || buffer.readUInt32LE(localOffset + 22) !== uncompressedSize) {
        fail("ATTACHMENT_ZIP_INVALID", "ZIP 중앙·로컬 항목 크기가 일치하지 않습니다.");
      }
    }
    if (normalized.isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) fail("ATTACHMENT_ZIP_INVALID", "ZIP 폴더 항목의 크기가 올바르지 않습니다.");

    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (uncompressedSize > MAX_ZIP_UNCOMPRESSED_BYTES || totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      fail("ATTACHMENT_ZIP_LIMIT", "ZIP 압축 해제 크기는 최대 50MiB입니다.");
    }
    if (exceedsZipExpansionLimit(uncompressedSize, compressedSize)) {
      fail("ATTACHMENT_ZIP_LIMIT", "ZIP 압축 확장률은 최대 200배입니다.");
    }
    entries.push({ name, method, flags, crc, compressedSize, uncompressedSize, localOffset, dataOffset, isDirectory: normalized.isDirectory });
    cursor = end;
  }
  if (cursor !== eocdOffset || totalUncompressed > Math.max(1, totalCompressed) * MAX_ZIP_EXPANSION_RATIO) {
    fail("ATTACHMENT_ZIP_LIMIT", "ZIP 중앙 디렉터리 또는 전체 압축 확장률이 올바르지 않습니다.");
  }
  const localOrder = entries.slice().sort((left, right) => left.localOffset - right.localOffset);
  for (let index = 0; index < localOrder.length; index += 1) {
    const entry = localOrder[index];
    const nextOffset = index + 1 < localOrder.length ? localOrder[index + 1].localOffset : centralOffset;
    if (entry.localOffset < 0 || entry.dataOffset + entry.compressedSize > nextOffset) {
      fail("ATTACHMENT_ZIP_INVALID", "ZIP 로컬 항목 범위가 서로 겹칩니다.");
    }
  }

  const contents = new Map();
  let actualTotalUncompressed = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const remainingBytes = MAX_ZIP_UNCOMPRESSED_BYTES - actualTotalUncompressed;
    const output = readZipEntry(buffer, entry, remainingBytes);
    actualTotalUncompressed += output.length;
    contents.set(entry.name, output);
  }
  if (actualTotalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES
    || actualTotalUncompressed > Math.max(1, totalCompressed) * MAX_ZIP_EXPANSION_RATIO) {
    fail("ATTACHMENT_ZIP_LIMIT", "ZIP 실제 압축 해제 크기 또는 전체 압축 확장률이 올바르지 않습니다.");
  }
  return { entries, contents };
}

function validateStructuralXml(xml, label) {
  if (/<!DOCTYPE\b|<!ENTITY\b|<!\[CDATA\[|<!--|-->|&/i.test(xml)) {
    fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", `${label} XML에는 엔터티·DTD·CDATA·주석을 사용할 수 없습니다.`);
  }
}

function validateOoxmlRelationship(xml) {
  validateStructuralXml(xml, "OOXML 관계");
  const relationshipTags = xml.match(/<\s*(?:[A-Za-z_][\w.-]*:)?Relationship\b[^>]*>/gi) || [];
  for (const tag of relationshipTags) {
    const targetMode = tag.match(/\bTargetMode\s*=\s*(["'])(.*?)\1/i);
    if (/\bTargetMode\b/i.test(tag) && (!targetMode || targetMode[2].trim().toLowerCase() !== "internal")) {
      fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "외부 대상으로 연결되는 OOXML 관계는 허용되지 않습니다.");
    }
    const type = tag.match(/\bType\s*=\s*(["'])(.*?)\1/i);
    const relationshipType = type ? type[2].trim().toLowerCase() : "";
    if (/(?:\/oleobject|\/package|\/activex|\/customui)(?:$|[?#])/.test(relationshipType)) {
      fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "삽입 개체 또는 활성 콘텐츠가 포함된 OOXML 문서는 허용되지 않습니다.");
    }
    const target = tag.match(/\bTarget\s*=\s*(["'])(.*?)\1/i);
    const targetValue = target ? target[2].trim() : "";
    if (!targetValue || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(targetValue) || targetValue.startsWith("//") || targetValue.includes("\\")) {
      fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "OOXML 관계 대상 경로가 안전하지 않습니다.");
    }
  }
}

function validateOoxmlContentTypes(xml) {
  validateStructuralXml(xml, "OOXML 콘텐츠 형식");
  const lower = xml.toLowerCase();
  if (lower.includes("macroenabled") || lower.includes("vbaproject") || lower.includes("vbadata")) {
    fail("ATTACHMENT_ZIP_MACRO", "매크로 콘텐츠 형식이 포함된 문서는 첨부할 수 없습니다.");
  }
  if (lower.includes("activex") || lower.includes("customui") || lower.includes("oleobject")
    || lower.includes("application/vnd.openxmlformats-officedocument.package")) {
    fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "삽입 개체 또는 활성 콘텐츠가 포함된 OOXML 문서는 허용되지 않습니다.");
  }
}

function validateZipDocument(buffer, extension) {
  const { entries, contents } = inspectZip(buffer);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  if (extension === "hwpx") {
    const requiredFiles = [
      "version.xml",
      "Contents/content.hpf",
      "Contents/header.xml",
      "Contents/section0.xml",
      "META-INF/container.xml",
      "META-INF/manifest.xml",
    ];
    if (requiredFiles.some(name => !byName.has(name) || byName.get(name).isDirectory)) {
      fail("ATTACHMENT_MAGIC_MISMATCH", "HWPX 필수 패키지 구조를 확인할 수 없습니다.");
    }
    const mimetype = byName.get("mimetype");
    if (!mimetype || mimetype.isDirectory || mimetype.localOffset !== 0 || mimetype.method !== 0) {
      fail("ATTACHMENT_MAGIC_MISMATCH", "HWPX mimetype 항목은 첫 번째 비압축 파일이어야 합니다.");
    }
    const value = contents.get(mimetype.name).toString("ascii");
    if (value.length > 256) fail("ATTACHMENT_MAGIC_MISMATCH", "HWPX mimetype 항목이 지나치게 큽니다.");
    if (value !== "application/hwp+zip") fail("ATTACHMENT_MAGIC_MISMATCH", "HWPX mimetype이 올바르지 않습니다.");
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const lowerName = entry.name.toLowerCase();
      if (/^scripts\//.test(lowerName)
        || /(^|\/)(?:activex|embeddings|objectpool)(?:\/|$)/.test(lowerName)
        || /^bindata\/.*\.(?:ole|exe|dll|com|scr|js|jse|vbs|vbe|ps1|bat|cmd|msi)$/.test(lowerName)
        || lowerName.startsWith("bindata/") && hwpUnsafeEmbeddedBytes(contents.get(entry.name))) {
        fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "스크립트·실행 파일 또는 OLE 개체가 포함된 HWPX 문서는 첨부할 수 없습니다.");
      }
    }
    for (const name of ["version.xml", "Contents/content.hpf", "META-INF/container.xml", "META-INF/manifest.xml"]) {
      const xmlBytes = contents.get(name);
      if (xmlBytes.length > MAX_OOXML_XML_PART_BYTES) fail("ATTACHMENT_ZIP_LIMIT", "HWPX 패키지 XML 항목이 지나치게 큽니다.");
      const xml = decodeUtf8Strict(xmlBytes, "ATTACHMENT_ZIP_INVALID", "HWPX 패키지 XML은 UTF-8이어야 합니다.");
      validateStructuralXml(xml, "HWPX 패키지");
      if (/<\s*(?:[A-Za-z_][\w.-]*:)?(?:encryption|encryptedKey|script|object)\b/i.test(xml)) {
        fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "암호화·스크립트·삽입 개체가 선언된 HWPX 문서는 첨부할 수 없습니다.");
      }
    }
    return;
  }

  const folder = { docx: "word/", xlsx: "xl/", pptx: "ppt/" }[extension];
  if (!entries.some(entry => !entry.isDirectory && entry.name.startsWith(folder))) fail("ATTACHMENT_MAGIC_MISMATCH", `${extension.toUpperCase()} 문서 구조를 확인할 수 없습니다.`);
  if (entries.some(entry => !entry.isDirectory && isUnsafeOoxmlEntry(entry.name))) {
    fail("ATTACHMENT_ZIP_UNSAFE_CONTENT", "삽입 개체 또는 활성 콘텐츠가 포함된 OOXML 문서는 허용되지 않습니다.");
  }
  const contentTypes = byName.get("[Content_Types].xml");
  if (!contentTypes || contentTypes.isDirectory) fail("ATTACHMENT_MAGIC_MISMATCH", "OOXML Content Types 항목을 찾을 수 없습니다.");
  const contentTypesBytes = contents.get(contentTypes.name);
  if (contentTypesBytes.length > MAX_OOXML_XML_PART_BYTES) fail("ATTACHMENT_ZIP_LIMIT", "OOXML XML 항목이 지나치게 큽니다.");
  const xml = decodeUtf8Strict(contentTypesBytes, "ATTACHMENT_MAGIC_MISMATCH", "OOXML Content Types는 UTF-8이어야 합니다.");
  validateOoxmlContentTypes(xml);
  const contentTypeTags = xml.match(/<\s*(?:[A-Za-z_][\w.-]*:)?(?:Default|Override)\b[^>]*>/gi) || [];
  const mainTypeDeclared = contentTypeTags.some(tag => {
    const value = tag.match(/\bContentType\s*=\s*(["'])(.*?)\1/i);
    return value && value[2].trim() === OOXML_MAIN_CONTENT_TYPE[extension];
  });
  if (!mainTypeDeclared) fail("ATTACHMENT_MAGIC_MISMATCH", `${extension.toUpperCase()} 기본 콘텐츠 형식이 올바르지 않습니다.`);
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.toLowerCase().endsWith(".rels")) continue;
    const relationshipBytes = contents.get(entry.name);
    if (relationshipBytes.length > MAX_OOXML_XML_PART_BYTES) fail("ATTACHMENT_ZIP_LIMIT", "OOXML 관계 XML 항목이 지나치게 큽니다.");
    const relationshipXml = decodeUtf8Strict(relationshipBytes, "ATTACHMENT_ZIP_INVALID", "OOXML 관계 파일은 UTF-8이어야 합니다.");
    validateOoxmlRelationship(relationshipXml);
  }
}

function validateMagic(buffer, extension) {
  if (extension === "pdf") validatePdf(buffer);
  else if (extension === "jpg" || extension === "jpeg") validateJpeg(buffer);
  else if (extension === "png") validatePng(buffer);
  else if (extension === "webp") validateWebp(buffer);
  else if (extension === "hwp") validateHwp(buffer);
  else if (extension === "txt" || extension === "csv") validateTextFile(buffer);
  else if (ZIP_EXTENSIONS.has(extension)) validateZipDocument(buffer, extension);
  else fail("ATTACHMENT_TYPE_UNSUPPORTED", "지원하지 않는 파일 형식입니다.");
}

function validateAttachmentBytes(input) {
  if (!isPlainRecord(input)) fail("ATTACHMENT_INPUT_INVALID", "첨부 파일 요청이 올바르지 않습니다.");
  const name = normalizeSafeBaseName(input.fileName, { requireCanonical: input.requireCanonicalName === true });
  const buffer = safeBuffer(input.bytes);
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) fail("ATTACHMENT_SIZE_INVALID", "첨부 파일은 1바이트 이상 5MiB 이하여야 합니다.");
  if (input.mimeType !== undefined && input.mimeType !== name.mimeType) fail("ATTACHMENT_MIME_MISMATCH", "파일 확장자와 MIME 형식이 일치하지 않습니다.");
  validateMagic(buffer, name.extension);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return Object.freeze({ fileName: name.fileName, extension: name.extension, mimeType: name.mimeType, size: buffer.length, sha256 });
}

function prepareAttachment(input) {
  if (!isPlainRecord(input)) fail("ATTACHMENT_INPUT_INVALID", "첨부 파일 요청이 올바르지 않습니다.");
  const buffer = safeBuffer(input.bytes);
  const metadata = validateAttachmentBytes({ fileName: input.fileName, bytes: buffer, mimeType: input.mimeType });
  return Object.freeze({
    fileName: metadata.fileName,
    extension: metadata.extension,
    mimeType: metadata.mimeType,
    size: metadata.size,
    sha256: metadata.sha256,
    fileBody: buffer.toString("base64"),
  });
}

function decodeCanonicalBase64(value) {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0 || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !STRICT_BASE64.test(value)) {
    fail("ATTACHMENT_BASE64_INVALID", "첨부 파일 본문이 canonical base64 형식이 아닙니다.");
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) fail("ATTACHMENT_BASE64_INVALID", "첨부 파일 본문이 canonical base64 형식이 아닙니다.");
  return buffer;
}

function revalidateAttachmentPayload(payload) {
  if (!isPlainRecord(payload)) fail("ATTACHMENT_INPUT_INVALID", "첨부 파일 요청이 올바르지 않습니다.");
  if (!Number.isSafeInteger(payload.size) || payload.size < 1 || payload.size > MAX_FILE_BYTES) fail("ATTACHMENT_SIZE_INVALID", "첨부 파일 크기가 올바르지 않습니다.");
  if (typeof payload.sha256 !== "string" || !SHA256_HEX.test(payload.sha256)) fail("ATTACHMENT_HASH_MISMATCH", "첨부 파일 SHA-256 형식이 올바르지 않습니다.");
  const buffer = decodeCanonicalBase64(payload.fileBody);
  if (buffer.length !== payload.size) fail("ATTACHMENT_SIZE_INVALID", "첨부 파일의 실제 크기와 표시 크기가 다릅니다.");
  const metadata = validateAttachmentBytes({ fileName: payload.fileName, bytes: buffer, mimeType: payload.mimeType, requireCanonicalName: true });
  if (payload.extension !== metadata.extension) fail("ATTACHMENT_TYPE_UNSUPPORTED", "첨부 파일 확장자 메타데이터가 파일 이름과 일치하지 않습니다.");
  const expected = Buffer.from(metadata.sha256, "hex");
  const supplied = Buffer.from(payload.sha256, "hex");
  if (!crypto.timingSafeEqual(expected, supplied)) fail("ATTACHMENT_HASH_MISMATCH", "첨부 파일 SHA-256이 일치하지 않습니다.");
  return Object.freeze({
    fileName: metadata.fileName,
    extension: metadata.extension,
    mimeType: metadata.mimeType,
    size: metadata.size,
    sha256: metadata.sha256,
    fileBody: payload.fileBody,
    bytes: Buffer.from(buffer),
  });
}

function attachmentMetadata(payload) {
  const valid = revalidateAttachmentPayload(payload);
  return Object.freeze({ fileName: valid.fileName, extension: valid.extension, mimeType: valid.mimeType, size: valid.size, sha256: valid.sha256 });
}

module.exports = Object.freeze({
  ALLOWED_EXTENSIONS,
  MIME_BY_EXTENSION,
  MAX_FILE_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  MAX_ZIP_EXPANSION_RATIO,
  AttachmentValidationError,
  normalizeSafeBaseName,
  validateAttachmentBytes,
  prepareAttachment,
  revalidateAttachmentPayload,
  attachmentMetadata,
});
