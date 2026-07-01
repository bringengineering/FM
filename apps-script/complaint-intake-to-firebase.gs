/**
 * BRING Care 민원접수 자동 분석 -> FM GitHub.io 케이스 등록
 *
 * 설치 위치: Google Sheets 응답 시트의 확장 프로그램 > Apps Script
 * 최초 1회 실행: setupComplaintAutomation()
 */

const COMPLAINT_CONFIG = {
  SPREADSHEET_ID: "1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA",
  SHEET_NAME: "설문지 응답 시트1",
  CONTRACT_DRIVE_FOLDER_ID: "1818MusPDfVV6znALkWDMGK99NXAlAj8g",
  FIREBASE_DATABASE_URL: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_CASES_PATH: "cases",
  RESPONSE_SHEET_URL: "https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit"
};

const OUTPUT_HEADERS = [
  "접수번호",
  "긴급도",
  "민원 요약",
  "업체 분류",
  "상태값",
  "온보딩 매칭 상태",
  "온보딩 파일명",
  "온보딩 확인 메모",
  "문자 발송 상태",
  "문자 발송 메모",
  "Firebase Case ID",
  "분석 처리일시"
];

function setupComplaintAutomation() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "onComplaintFormSubmit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("onComplaintFormSubmit")
    .forSpreadsheet(COMPLAINT_CONFIG.SPREADSHEET_ID)
    .onFormSubmit()
    .create();

  ensureFormAddressQuestion_();
  processExistingResponses();
}

function authorizeDriveAccess() {
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  if (!folderId) throw new Error("CONTRACT_DRIVE_FOLDER_ID가 비어 있습니다.");

  const folder = DriveApp.getFolderById(folderId);
  Logger.log("Drive 권한 확인 대상 폴더: " + folder.getName() + " / https://drive.google.com/drive/folders/" + folderId);

  const directFiles = folder.getFiles();
  const fileLogs = [];
  while (directFiles.hasNext() && fileLogs.length < 20) {
    const file = directFiles.next();
    fileLogs.push(file.getName() + " / " + file.getMimeType());
  }
  Logger.log(fileLogs.length
    ? "폴더 직접 파일 목록: " + fileLogs.join(" | ")
    : "폴더 직접 파일 목록: 비어 있음");

  const query = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
  ].join(" and ");
  const files = DriveApp.searchFiles(query);
  Logger.log(files.hasNext()
    ? "Drive 권한 확인 완료: " + files.next().getName()
    : "Drive 권한 확인 완료: 폴더 안에 DOCX 파일이 아직 없습니다.");
}

function onComplaintFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : getResponseSheet_();
  const row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  processResponseRow_(sheet, row);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (payload.action === "sendVendorEstimateMms") {
      return jsonResponse_(handleVendorEstimateMms_(payload));
    }
    return jsonResponse_({ ok: false, message: "지원하지 않는 action입니다." });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message });
  }
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleVendorEstimateMms_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const selectedVendors = Array.isArray(payload.vendors) ? payload.vendors.map(normalizeVendorForMms_).filter(v => v.name || v.phone) : [];

  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  if (!selectedVendors.length) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "선택된 업체가 없어 MMS 발송을 보류했습니다.",
      sent: [],
      failed: [],
      skipped: []
    });
  }

  const record = readResponseRecordForCase_(casePayload);
  const photo = firstJpegPhotoFromRecord_(record);
  if (!photo.ok) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: photo.message,
      sent: [],
      failed: [],
      skipped: selectedVendors.map(v => ({ name: v.name, reason: "사진 미확인" }))
    });
  }

  const config = getSensConfig_();
  if (!config.enabled) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "NCP SENS 설정 또는 승인된 발신번호가 없어 MMS 발송을 보류했습니다.",
      photoName: photo.fileName,
      sent: [],
      failed: [],
      skipped: selectedVendors.map(v => ({ name: v.name, reason: "SENS 설정 필요" }))
    });
  }

  const upload = uploadSensMmsAttachment_(photo, config);
  if (!upload.ok) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: upload.message,
      photoName: photo.fileName,
      sent: [],
      failed: [],
      skipped: selectedVendors.map(v => ({ name: v.name, reason: "사진 업로드 실패" }))
    });
  }

  const content = String(payload.message || "").trim() || makeVendorEstimateMmsContent_(casePayload, record);
  const result = {
    ok: false,
    status: "failed",
    statusText: "",
    photoName: photo.fileName,
    sensFileId: upload.fileId,
    sent: [],
    failed: [],
    skipped: []
  };

  selectedVendors.forEach(vendor => {
    const to = vendorSmsPhone_(vendor);
    if (!to) {
      result.skipped.push({ name: vendor.name || "업체명 없음", reason: "발송 가능한 전화번호 없음" });
      return;
    }

    const sendResult = sendSensMms_(to, content, upload.fileId, vendor.name || "업체", config);
    const item = {
      name: vendor.name || "업체명 없음",
      category: vendor.category || "",
      phoneMasked: maskPhone_(to),
      message: sendResult.message
    };
    if (sendResult.ok) {
      result.sent.push(item);
    } else {
      result.failed.push(item);
    }
  });

  result.ok = result.sent.length > 0 && result.failed.length === 0;
  result.status = result.ok ? "sent" : "failed";
  result.statusText = result.ok
    ? "업체 MMS 발송 완료: " + result.sent.length + "곳"
    : "업체 MMS 발송 보류/실패: 성공 " + result.sent.length + "곳, 실패 " + result.failed.length + "곳, 제외 " + result.skipped.length + "곳";

  return updateVendorMmsCase_(caseId, casePayload, result);
}

function readCaseFromFirebase_(caseId) {
  const response = UrlFetchApp.fetch(firebaseCaseUrl_(caseId), {
    method: "get",
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    throw new Error("Firebase 조회 실패: HTTP " + code + " / " + response.getContentText());
  }
  const body = response.getContentText();
  return body && body !== "null" ? JSON.parse(body) : null;
}

function readResponseRecordForCase_(casePayload) {
  const row = Number(casePayload && casePayload.sheetRow);
  if (!row || row < 2) return {};
  const sheet = getResponseSheet_();
  const headers = ensureOutputHeaders_(sheet);
  const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  return recordFromRow_(headers, values);
}

function firstJpegPhotoFromRecord_(record) {
  const photoValue = readField_(record, ["사진 첨부", "첨부 사진", "사진", "사진첨부"]);
  if (!photoValue) return { ok: false, message: "구글폼 사진 첨부가 없어 MMS 발송을 보류했습니다." };

  const ids = extractDriveFileIdsFromText_(photoValue);
  if (!ids.length) return { ok: false, message: "사진 첨부에서 Drive 파일 ID를 찾지 못했습니다." };

  const errors = [];
  for (const id of ids) {
    try {
      const file = DriveApp.getFileById(id);
      const blob = file.getBlob();
      const name = file.getName() || "photo.jpg";
      const contentType = blob.getContentType() || "";
      const isJpeg = /jpe?g$/i.test(name) || /jpeg/i.test(contentType);
      if (!isJpeg) {
        errors.push(name + ": JPG/JPEG 파일이 아님");
        continue;
      }

      const bytes = blob.getBytes();
      if (bytes.length > 300 * 1024) {
        errors.push(name + ": SENS MMS 첨부 제한 300KB 초과");
        continue;
      }

      return {
        ok: true,
        driveFileId: id,
        fileName: makeSensImageName_(name),
        fileBody: Utilities.base64Encode(bytes),
        byteSize: bytes.length
      };
    } catch (err) {
      errors.push(id + ": " + err.message);
    }
  }

  return { ok: false, message: "MMS로 보낼 수 있는 JPG/JPEG 사진을 찾지 못했습니다. " + errors.join(" / ") };
}

function extractDriveFileIdsFromText_(value) {
  const text = String(value || "");
  const ids = [];
  const patterns = [
    /\/d\/([A-Za-z0-9_-]{20,})/g,
    /[?&]id=([A-Za-z0-9_-]{20,})/g,
    /open\?id=([A-Za-z0-9_-]{20,})/g
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) ids.push(match[1]);
  });
  const generic = text.match(/[A-Za-z0-9_-]{25,}/g) || [];
  generic.forEach(id => ids.push(id));
  return [...new Set(ids)];
}

function makeSensImageName_(name) {
  const ext = /\.jpeg$/i.test(name) ? ".jpeg" : ".jpg";
  return ("bring_photo_" + Utilities.formatDate(new Date(), "Asia/Seoul", "MMddHHmmss")).slice(0, 40 - ext.length) + ext;
}

function uploadSensMmsAttachment_(photo, config) {
  const uri = "/sms/v2/services/" + encodeURIComponent(config.serviceId) + "/files";
  const response = sensPostJson_(uri, {
    fileName: photo.fileName,
    fileBody: photo.fileBody
  }, config);

  if (!response.ok) return { ok: false, message: "MMS 사진 업로드 실패: " + response.message };

  const fileId = findSensFileId_(response.json);
  if (!fileId) return { ok: false, message: "MMS 사진 업로드 응답에서 fileId를 찾지 못했습니다: " + response.body.slice(0, 200) };
  return { ok: true, fileId: fileId };
}

function sendSensMms_(to, content, fileId, label, config) {
  if (!config || !config.enabled) config = getSensConfig_();
  if (!config.enabled) return { ok: false, message: "SENS 설정필요" };
  if (!fileId) return { ok: false, message: "MMS 첨부 fileId 없음" };
  if (byteLength_(content) > 2000) return { ok: false, message: "MMS 문구 2000바이트 초과" };

  const uri = "/sms/v2/services/" + encodeURIComponent(config.serviceId) + "/messages";
  const payload = {
    type: "MMS",
    contentType: "COMM",
    countryCode: "82",
    from: config.from,
    subject: "BRING Care",
    content: content,
    messages: [{ to: to, content: content }],
    files: [{ fileId: fileId }]
  };
  const response = sensPostJson_(uri, payload, config);
  return response.ok
    ? { ok: true, message: "MMS 발송요청 완료(" + label + ")" }
    : { ok: false, message: "MMS 발송실패(" + label + "): " + response.message };
}

function sensPostJson_(uri, payload, config) {
  const timestamp = String(Date.now());
  const signature = makeNcpSignature_("POST", uri, timestamp, config.accessKey, config.secretKey);
  try {
    const response = UrlFetchApp.fetch("https://sens.apigw.ntruss.com" + uri, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: {
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": config.accessKey,
        "x-ncp-apigw-signature-v2": signature
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch (err) {}
    if (code >= 200 && code < 300) return { ok: true, code: code, body: body, json: json };
    return { ok: false, code: code, body: body, json: json, message: "HTTP " + code + " / " + body.slice(0, 200) };
  } catch (err) {
    return { ok: false, code: 0, body: "", json: {}, message: err.message };
  }
}

function findSensFileId_(value) {
  if (!value || typeof value !== "object") return "";
  if (value.fileId) return value.fileId;
  if (Array.isArray(value.files)) {
    for (const file of value.files) {
      const id = findSensFileId_(file);
      if (id) return id;
    }
  }
  for (const key in value) {
    if (value[key] && typeof value[key] === "object") {
      const id = findSensFileId_(value[key]);
      if (id) return id;
    }
  }
  return "";
}

function normalizeVendorForMms_(vendor) {
  vendor = vendor || {};
  return {
    id: String(vendor.id || ""),
    category: String(vendor.category || ""),
    no: String(vendor.no || ""),
    type: String(vendor.type || ""),
    name: String(vendor.name || ""),
    address: String(vendor.address || ""),
    phone: String(vendor.phone || ""),
    map: String(vendor.map || ""),
    promo: String(vendor.promo || ""),
    note: String(vendor.note || "")
  };
}

function vendorSmsPhone_(vendor) {
  const raw = [vendor.phone, vendor.mobile, vendor.tel].filter(Boolean).join("\n");
  const phones = extractPhones_(raw);
  return phones.find(phone => /^01[016789]\d{7,8}$/.test(phone)) || phones[0] || "";
}

function extractPhones_(value) {
  const matches = String(value || "").match(/(?:\+?82[-.\s]?)?0?\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || [];
  return [...new Set(matches.map(normalizePhoneForSms_).filter(phone => phone.length >= 9 && phone.length <= 11))];
}

function makeVendorEstimateMmsContent_(casePayload, record) {
  const building = casePayload.building || readField_(record, ["건물명", "건물"]) || "건물 미입력";
  const address = casePayload.address || readField_(record, ["건물 주소", "주소"]) || "주소 미입력";
  const room = readField_(record, ["호실"]) || casePayload.room || "호실 미입력";
  const issueType = casePayload.issueType || readField_(record, ["문제 유형"]) || "문제 유형 미입력";
  const vendorType = casePayload.vendorType || "업체 분류 미확인";
  const visitTime = casePayload.visitTime || readField_(record, ["방문 가능 시간"]) || "협의 필요";
  const ticketNo = casePayload.ticketNo || casePayload.id || "";
  return [
    "[BRING Care 견적요청]",
    building + " / " + room,
    "주소: " + address,
    "문제: " + issueType + " / " + vendorType,
    "방문 가능: " + visitTime,
    "",
    "첨부 사진 확인 후 현장 확인 가능 여부와 견적 회신 부탁드립니다.",
    "접수번호: " + ticketNo
  ].join("\n");
}

function updateVendorMmsCase_(caseId, casePayload, result) {
  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.vendorEstimateMms = result;
  casePayload.note.c5 = makeVendorMmsNote_(result);
  casePayload.status.c5 = result.ok ? "done" : "doing";
  if (result.ok && casePayload.status.c6 !== "done") {
    casePayload.status.c6 = "doing";
  }
  casePayload.updatedAt = new Date().toISOString();
  casePayload.log.unshift("업체 MMS " + (result.ok ? "발송완료" : "발송보류") + " / " + (result.statusText || ""));
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  writeCaseToFirebase_(caseId, casePayload);
  return Object.assign({ caseId: caseId }, result);
}

function makeVendorMmsNote_(result) {
  const lines = [
    "[업체 MMS 견적 요청]",
    "상태: " + (result.ok ? "발송완료" : "진행중/보류"),
    result.statusText || "",
    result.photoName ? "사진: " + result.photoName : "",
    result.sensFileId ? "SENS 파일 ID: " + result.sensFileId : ""
  ].filter(Boolean);

  if (result.sent && result.sent.length) {
    lines.push("");
    lines.push("[발송 완료]");
    result.sent.forEach(item => lines.push("- " + item.name + " / " + item.phoneMasked + " / " + item.message));
  }
  if (result.failed && result.failed.length) {
    lines.push("");
    lines.push("[발송 실패]");
    result.failed.forEach(item => lines.push("- " + item.name + " / " + item.phoneMasked + " / " + item.message));
  }
  if (result.skipped && result.skipped.length) {
    lines.push("");
    lines.push("[제외]");
    result.skipped.forEach(item => lines.push("- " + item.name + " / " + item.reason));
  }
  return lines.join("\n");
}

function processExistingResponses() {
  const sheet = getResponseSheet_();
  ensureOutputHeaders_(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  for (let row = 2; row <= lastRow; row++) {
    processResponseRow_(sheet, row);
  }
}

function getResponseSheet_() {
  const ss = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  return ss.getSheetByName(COMPLAINT_CONFIG.SHEET_NAME) || ss.getSheets()[0];
}

function getLinkedForm_() {
  const ss = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  const formUrl = ss.getFormUrl();
  return formUrl ? FormApp.openByUrl(formUrl) : null;
}

function ensureFormAddressQuestion_() {
  const form = getLinkedForm_();
  if (!form) return;

  const items = form.getItems();
  const existing = items.find(item => isAddressQuestionTitle_(item.getTitle()));
  if (existing) {
    try {
      existing.asTextItem().setRequired(true);
    } catch (err) {}
    return;
  }

  const addressItem = form.addTextItem()
    .setTitle("건물 주소")
    .setHelpText("계약 건물 확인을 위해 도로명 또는 지번 주소를 입력해주세요.")
    .setRequired(true);

  const refreshed = form.getItems();
  const buildingItem = refreshed.find(item => String(item.getTitle() || "").trim() === "건물명");
  if (buildingItem) {
    try {
      form.moveItem(addressItem.getIndex(), buildingItem.getIndex() + 1);
    } catch (err) {}
  }
}

function isAddressQuestionTitle_(title) {
  const key = normalizeText_(title);
  return key === "건물주소" || key === "주소";
}

function extractDriveId_(value) {
  const v = String(value || "").trim();
  if (!v) return "";

  const folderMatch = v.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  const idMatch = v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];

  return v;
}

function processResponseRow_(sheet, row) {
  if (row < 2) return;

  const headers = ensureOutputHeaders_(sheet);
  const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  const record = recordFromRow_(headers, values);

  if (!readField_(record, ["건물명", "건물"]) && !readField_(record, ["증상 설명", "민원 내용", "내용"])) {
    return;
  }

  const ticketNo = readField_(record, ["접수번호"]) || makeTicketNo_(row, record);
  const analysis = analyzeComplaint_(record);
  const contractMatch = matchDriveOnboardingFile_(record);
  const casePayload = buildCasePayload_(ticketNo, record, analysis, contractMatch, row, sheet);
  const smsResult = sendComplaintSms_(ticketNo, record, analysis, contractMatch);
  applySmsResultToCase_(casePayload, smsResult);

  writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch, smsResult);
  writeCaseToFirebase_(ticketNo, casePayload);
}

function ensureOutputHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());

  OUTPUT_HEADERS.forEach(header => {
    if (!headers.includes(header)) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });

  return headers;
}

function recordFromRow_(headers, values) {
  const record = {};
  headers.forEach((header, index) => {
    if (header) record[header] = values[index];
  });
  return record;
}

function readField_(record, names) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && String(record[name]).trim() !== "") {
      return String(record[name]).trim();
    }
  }
  return "";
}

function readRawField_(record, names) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && String(record[name]).trim() !== "") {
      return record[name];
    }
  }
  return "";
}

function dateFromValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/강원특별자치도/g, "강원")
    .replace(/강원도/g, "강원")
    .replace(/\s+/g, "")
    .replace(/[()\[\]{}.,·ㆍ-]/g, "")
    .trim();
}

function normalizeAddress_(value) {
  return normalizeText_(value)
    .replace(/번지/g, "")
    .replace(/층/g, "f");
}

function matchDriveOnboardingFile_(record) {
  const inputBuilding = readField_(record, ["건물명", "건물"]);
  const inputAddress = readField_(record, ["건물 주소", "주소"]);
  const buildingKey = normalizeText_(inputBuilding);
  const addressKey = normalizeAddress_(inputAddress);
  const base = {
    inputBuilding: inputBuilding,
    inputAddress: inputAddress,
    matchKey: buildingKey + "|" + addressKey,
    source: "drive_fulltext",
    status: "unmatched",
    statusText: "Drive 온보딩 수집서 매칭을 확인하지 못했습니다.",
    candidateCount: 0,
    contract: null
  };

  if (!buildingKey) {
    return Object.assign(base, {
      statusText: "건물명이 없어 Drive 온보딩 수집서를 검색하지 못했습니다."
    });
  }

  const buildingTerms = makeDriveSearchTerms_(inputBuilding);
  const buildingResult = searchDriveOnboardingFiles_(buildingTerms);
  if (!buildingResult.ok) {
    return Object.assign(base, {
      statusText: buildingResult.error || "Drive 폴더 접근 실패: 폴더 공유 권한 또는 폴더 ID를 확인하세요."
    });
  }

  const buildingCandidates = buildingResult.files;
  if (buildingCandidates.length === 1) {
    return makeDriveMatchPayload_(buildingCandidates[0], inputBuilding, inputAddress, {
      matchKey: buildingKey + "|" + addressKey,
      candidateCount: 1,
      statusText: "Drive DOCX 본문에서 건물명이 정확히 1건 매칭되었습니다."
    });
  }

  if (buildingCandidates.length === 0) {
    return Object.assign(base, {
      statusText: "Drive 폴더에서 건물명이 포함된 DOCX 온보딩 수집서를 찾지 못했습니다."
    });
  }

  if (!addressKey) {
    return Object.assign(base, {
      status: "address_missing",
      statusText: "건물명 후보가 여러 개지만 건물 주소가 없어 수동 확인이 필요합니다.",
      candidateCount: buildingCandidates.length,
      candidates: buildingCandidates.slice(0, 5).map(makeDriveCandidate_)
    });
  }

  const addressTerms = makeDriveSearchTerms_(inputAddress);
  const narrowedResult = searchDriveOnboardingFiles_(buildingTerms.concat(addressTerms));
  if (!narrowedResult.ok) {
    return Object.assign(base, {
      status: "multiple",
      statusText: narrowedResult.error || "건물명 후보는 여러 개이나 주소 검색 중 Drive 오류가 발생했습니다.",
      candidateCount: buildingCandidates.length,
      candidates: buildingCandidates.slice(0, 5).map(makeDriveCandidate_)
    });
  }

  const narrowedCandidates = narrowedResult.files;
  if (narrowedCandidates.length === 1) {
    return makeDriveMatchPayload_(narrowedCandidates[0], inputBuilding, inputAddress, {
      matchKey: buildingKey + "|" + addressKey,
      candidateCount: 1,
      statusText: "Drive DOCX 본문에서 건물명 후보를 주소로 좁혀 1건 매칭되었습니다."
    });
  }

  return Object.assign(base, {
    status: narrowedCandidates.length === 0 ? "unmatched" : "multiple",
    statusText: narrowedCandidates.length === 0
      ? "건물명 후보는 여러 개였지만 주소까지 포함된 DOCX 온보딩 수집서를 찾지 못했습니다."
      : "건물명과 주소를 함께 검색해도 복수 후보가 남아 수동 확인이 필요합니다.",
    candidateCount: narrowedCandidates.length,
    candidates: (narrowedCandidates.length ? narrowedCandidates : buildingCandidates).slice(0, 5).map(makeDriveCandidate_)
  });
}

function makeDriveSearchTerms_(value) {
  const text = String(value || "")
    .replace(/[(){}\[\],·ㆍ/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  const terms = text.split(" ")
    .map(item => item.trim())
    .filter(item => item && (item.length >= 2 || /\d/.test(item)));
  return terms.length ? Array.from(new Set(terms)) : [text];
}

function searchDriveOnboardingFiles_(terms) {
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  const cleanTerms = (terms || []).map(term => String(term || "").trim()).filter(Boolean);
  if (!folderId) {
    return { ok: false, files: [], error: "Drive 폴더 ID가 설정되지 않았습니다." };
  }
  if (!cleanTerms.length) {
    return { ok: true, files: [] };
  }

  const queryParts = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
  ];
  cleanTerms.forEach(term => {
    queryParts.push("fullText contains '" + escapeDriveQueryValue_(term) + "'");
  });

  const files = [];
  try {
    const iterator = DriveApp.searchFiles(queryParts.join(" and "));
    while (iterator.hasNext()) {
      files.push(iterator.next());
      if (files.length >= 50) break;
    }
    return { ok: true, files: files };
  } catch (err) {
    Logger.log("Drive 온보딩 검색 실패: " + err.message);
    return {
      ok: false,
      files: [],
      error: "Drive 온보딩 검색 실패: 폴더 공유 권한 또는 DOCX 본문 검색 가능 여부를 확인하세요. " + err.message
    };
  }
}

function escapeDriveQueryValue_(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function makeDriveMatchPayload_(file, inputBuilding, inputAddress, options) {
  const fileName = file.getName();
  const fileUrl = file.getUrl();
  const driveFileId = file.getId();
  return {
    inputBuilding: inputBuilding,
    inputAddress: inputAddress,
    matchKey: options.matchKey,
    source: "drive_fulltext",
    status: "matched",
    statusText: options.statusText,
    fileName: fileName,
    fileUrl: fileUrl,
    driveFileId: driveFileId,
    candidateCount: options.candidateCount,
    contract: {
      building: inputBuilding,
      address: inputAddress,
      contractFileName: fileName,
      contractFileUrl: fileUrl,
      driveFileId: driveFileId
    }
  };
}

function makeDriveCandidate_(file) {
  return {
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    driveFileId: file.getId()
  };
}

function sendComplaintSms_(ticketNo, record, analysis, contractMatch) {
  const existingStatus = readField_(record, ["문자 발송 상태"]);
  if (/발송완료|일부발송/.test(existingStatus)) {
    return {
      status: existingStatus,
      statusText: readField_(record, ["문자 발송 메모"]) || "이미 발송된 문자 기록이 있어 재발송하지 않았습니다.",
      skipped: true
    };
  }

  const config = getSensConfig_();
  if (!config.enabled) {
    return { status: "설정필요", statusText: "NCP SENS Script Properties 설정 후 문자 발송이 가능합니다.", skipped: true };
  }

  const tenantPhone = normalizePhoneForSms_(readField_(record, ["연락처", "전화번호", "휴대폰"]));
  const ownerPhone = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  const building = readField_(record, ["건물명", "건물"]);
  const room = readField_(record, ["호실"]);
  const issueType = readField_(record, ["문제 유형"]);
  const tenantContent = [
    "[BRING Care]",
    "민원이 접수되었습니다.",
    "접수번호: " + ticketNo,
    building ? "건물: " + building : "",
    issueType ? "문제: " + issueType : "",
    "확인 후 안내드리겠습니다."
  ].filter(Boolean).join("\n");
  const ownerContent = [
    "[BRING Care]",
    "건물 민원이 접수되었습니다.",
    "접수번호: " + ticketNo,
    building ? "건물: " + building : "",
    room ? "호실: " + maskRoom_(room) : "",
    issueType ? "문제: " + issueType : "",
    analysis && analysis.urgency ? "긴급도: " + analysis.urgency : ""
  ].filter(Boolean).join("\n");

  const logs = [];
  let tenantSent = false;
  let ownerSent = false;

  if (tenantPhone) {
    const tenantResult = sendSensSms_(tenantPhone, tenantContent, "세입자");
    tenantSent = tenantResult.ok;
    logs.push("세입자 " + maskPhone_(tenantPhone) + " " + tenantResult.message);
  } else {
    logs.push("세입자 연락처 없음");
  }

  if (ownerPhone) {
    const ownerResult = sendSensSms_(ownerPhone, ownerContent, "건물주");
    ownerSent = ownerResult.ok;
    logs.push("건물주 " + maskPhone_(ownerPhone) + " " + ownerResult.message);
  } else {
    logs.push("건물주 연락처 미확인: 온보딩 수집서 본문에 '건물주 연락처: 010-0000-0000' 형식으로 넣어주세요.");
  }

  const status = tenantSent && ownerSent ? "발송완료" : tenantSent || ownerSent ? "일부발송" : "발송보류";
  return {
    status: status,
    statusText: logs.join(" / "),
    tenantSent: tenantSent,
    ownerSent: ownerSent,
    tenantPhoneMasked: tenantPhone ? maskPhone_(tenantPhone) : "",
    ownerPhoneMasked: ownerPhone ? maskPhone_(ownerPhone) : ""
  };
}

function applySmsResultToCase_(casePayload, smsResult) {
  if (!smsResult) return;
  casePayload.sms = smsResult;
  casePayload.note = casePayload.note || {};
  casePayload.note.c2 = smsResult.statusText || "";
  casePayload.status = casePayload.status || {};
  if (smsResult.status === "발송완료") {
    casePayload.status.c2 = "done";
    if (casePayload.status.c3 !== "done") {
      casePayload.status.c3 = "doing";
    }
  } else if (smsResult.status === "일부발송" || smsResult.status === "발송보류") {
    casePayload.status.c2 = "doing";
  }
  if (casePayload.log) {
    casePayload.log.push("문자 " + smsResult.status + " / " + (smsResult.statusText || ""));
  }
}

function getSensConfig_() {
  const props = PropertiesService.getScriptProperties();
  const enabled = String(props.getProperty("SMS_ENABLED") || "true").toLowerCase() !== "false";
  const config = {
    enabled: enabled,
    serviceId: props.getProperty("NCP_SENS_SERVICE_ID") || "",
    accessKey: props.getProperty("NCP_ACCESS_KEY") || "",
    secretKey: props.getProperty("NCP_SECRET_KEY") || "",
    from: normalizePhoneForSms_(props.getProperty("NCP_SENS_FROM") || "")
  };
  config.enabled = Boolean(config.enabled && config.serviceId && config.accessKey && config.secretKey && config.from);
  return config;
}

function sendSensSms_(to, content, label) {
  const config = getSensConfig_();
  if (!config.enabled) return { ok: false, message: "SENS 설정필요" };

  const uri = "/sms/v2/services/" + encodeURIComponent(config.serviceId) + "/messages";
  const timestamp = String(Date.now());
  const signature = makeNcpSignature_("POST", uri, timestamp, config.accessKey, config.secretKey);
  const type = byteLength_(content) > 90 ? "LMS" : "SMS";
  const payload = {
    type: type,
    contentType: "COMM",
    countryCode: "82",
    from: config.from,
    content: content,
    messages: [{ to: to, content: content }]
  };
  if (type === "LMS") payload.subject = "BRING Care";

  try {
    const response = UrlFetchApp.fetch("https://sens.apigw.ntruss.com" + uri, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: {
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": config.accessKey,
        "x-ncp-apigw-signature-v2": signature
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code >= 200 && code < 300) {
      return { ok: true, message: "발송요청 완료(" + label + ")" };
    }
    return { ok: false, message: "발송실패(" + label + " HTTP " + code + "): " + body.slice(0, 200) };
  } catch (err) {
    return { ok: false, message: "발송오류(" + label + "): " + err.message };
  }
}

function makeNcpSignature_(method, uri, timestamp, accessKey, secretKey) {
  const message = method + " " + uri + "\n" + timestamp + "\n" + accessKey;
  const signature = Utilities.computeHmacSha256Signature(message, secretKey);
  return Utilities.base64Encode(signature);
}

function extractOwnerPhoneFromOnboarding_(contractMatch) {
  if (!contractMatch || contractMatch.status !== "matched" || !contractMatch.driveFileId) return "";
  const text = extractDocxText_(contractMatch.driveFileId);
  if (!text) return "";

  const labelMatch = text.match(/건물주\s*(?:연락처|전화번호|휴대폰|번호)\s*[:：]?\s*((?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/);
  if (labelMatch) return labelMatch[1];

  const anyPhone = text.match(/(?:\+?82[-.\s]?)?0?(?:10|11|16|17|18|19)[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  return anyPhone ? anyPhone[0] : "";
}

function extractDocxText_(driveFileId) {
  try {
    const blobs = Utilities.unzip(DriveApp.getFileById(driveFileId).getBlob());
    const xml = blobs
      .filter(blob => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(blob.getName()))
      .map(blob => blob.getDataAsString("UTF-8"))
      .join("\n");
    return decodeXmlText_(xml);
  } catch (err) {
    Logger.log("DOCX 본문 추출 실패: " + err.message);
    return "";
  }
}

function decodeXmlText_(xml) {
  return String(xml || "")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhoneForSms_(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.indexOf("82") === 0) digits = "0" + digits.slice(2);
  return digits;
}

function byteLength_(value) {
  return Utilities.newBlob(String(value || "")).getBytes().length;
}

function testSensSmsSetup() {
  const props = PropertiesService.getScriptProperties();
  const to = normalizePhoneForSms_(props.getProperty("NCP_SENS_TEST_TO") || "");
  if (!to) throw new Error("Script Properties에 NCP_SENS_TEST_TO를 테스트 수신번호로 넣어주세요.");
  const result = sendSensSms_(to, "[BRING Care]\nSENS 문자 연동 테스트입니다.", "테스트");
  Logger.log(JSON.stringify(result));
}

function makeTicketNo_(row, record) {
  const ts = readRawField_(record, ["타임스탬프", "Timestamp"]) || new Date();
  const year = Utilities.formatDate(dateFromValue_(ts), "Asia/Seoul", "yyyy");
  return "BR-" + year + "-" + String(row - 1).padStart(4, "0");
}

function analyzeComplaint_(record) {
  const issueType = readField_(record, ["문제 유형"]);
  const description = readField_(record, ["증상 설명", "민원 내용", "내용"]);
  const photo = readField_(record, ["사진 첨부"]);
  const extra = readField_(record, ["추가 요청사항"]);
  const haystack = [issueType, description, extra].join(" ").toLowerCase();

  const urgentKeywords = [
    "누수", "물샘", "물 샘", "물이 떨어", "물이 샘", "천장 물", "천장에서 물",
    "침수", "역류", "스파크", "탄 냄새", "타는 냄새", "차단기", "정전",
    "감전", "화재", "문이 안 열", "출입 불가", "갇힘", "가스", "동파"
  ];
  const reviewKeywords = ["기타", "모르겠", "확인 필요", "애매", "불명", "소리", "냄새"];

  const isUrgentType = ["누수", "전기", "도어락", "보일러"].includes(issueType);
  const hasUrgentKeyword = urgentKeywords.some(keyword => haystack.includes(keyword));
  const needsReview = issueType === "기타" || !photo || description.replace(/\s/g, "").length < 12 ||
    reviewKeywords.some(keyword => haystack.includes(keyword));

  let urgency = "보통";
  let reason = "즉시 위험 신호는 확인되지 않았습니다.";

  if (hasUrgentKeyword || (isUrgentType && /안 ?됨|고장|멈춤|불가|누수|물|스파크|냄새|차단기/.test(haystack))) {
    urgency = "긴급";
    reason = "누수/전기/출입불가 등 즉시 확인이 필요한 표현이 감지되었습니다.";
  } else if (needsReview) {
    urgency = "확인필요";
    reason = "사진 누락, 짧은 설명, 기타/애매한 표현으로 관리자 확인이 필요합니다.";
  }

  const vendorType = classifyVendor_(issueType, haystack);
  const summary = makeSummary_(record, issueType, description);
  const statusValue = urgency === "긴급" ? "긴급확인필요" : urgency === "확인필요" ? "관리자확인중" : "접수완료";

  return { urgency, reason, vendorType, summary, statusValue };
}

function classifyVendor_(issueType, haystack) {
  const typeMap = {
    "배관": "배관",
    "누수": "누수·방수",
    "전기": "전기",
    "도어락": "도어락·출입",
    "보일러": "보일러·난방",
    "에어컨": "에어컨·냉난방",
    "창문·문": "창호·문",
    "청소·방역": "청소·방역",
    "공용부 문제": "공용부 관리"
  };
  if (typeMap[issueType]) return typeMap[issueType];
  if (/누수|방수|물|천장|배수|역류/.test(haystack)) return "누수·배관";
  if (/전기|차단기|스파크|정전|조명/.test(haystack)) return "전기";
  if (/보일러|난방|온수/.test(haystack)) return "보일러·난방";
  if (/에어컨|냉방|실외기/.test(haystack)) return "에어컨·냉난방";
  if (/문|창문|도어락|잠금|출입/.test(haystack)) return "창호·출입";
  if (/청소|방역|벌레|곰팡이/.test(haystack)) return "청소·방역";
  return "관리자 확인";
}

function makeSummary_(record, issueType, description) {
  const building = readField_(record, ["건물명", "건물"]);
  const room = readField_(record, ["호실"]);
  const cleanDescription = String(description || "").replace(/\s+/g, " ").trim();
  const preview = cleanDescription ? cleanDescription.slice(0, 70) : "상세 설명 확인 필요";
  return [building, room, issueType].filter(Boolean).join(" / ") + " - " + preview;
}

function makeConsultationNote_(ticketNo, record, analysis, sheetUrl) {
  const building = readField_(record, ["건물명", "건물"]) || "건물 미입력";
  const room = readField_(record, ["호실"]) || "호실 미입력";
  const issueType = readField_(record, ["문제 유형"]) || "문제 유형 미입력";
  const description = readField_(record, ["증상 설명", "민원 내용", "내용"]);
  const photo = readField_(record, ["사진 첨부"]);
  const visitTime = readField_(record, ["방문 가능 시간"]);
  const extra = readField_(record, ["추가 요청사항"]);
  const questions = consultationQuestions_(issueType, [issueType, description, extra].join(" "));
  const warnings = consultationWarnings_(description, photo, visitTime, analysis);

  return [
    "[상담 요약]",
    analysis.summary || makeSummary_(record, issueType, description),
    "",
    "[접수 정보]",
    "접수번호: " + ticketNo,
    "건물/호실: " + building + " / " + room,
    "문제 유형: " + issueType,
    "방문 가능 시간: " + (visitTime || "미입력"),
    "사진/원본: " + (sheetUrl ? "응답 시트에서 확인" : (photo ? "첨부됨" : "미확인")),
    "",
    "[추가 확인 질문]",
    questions.map(item => "- " + item).join("\n"),
    "",
    "[누락/주의]",
    warnings.map(item => "- " + item).join("\n"),
    "",
    "[다음 액션]",
    "- ④ 민원·요청 분류에서 업체 분류 확인: " + (analysis.vendorType || "관리자 확인"),
    "- 긴급도 확인: " + (analysis.urgency || "미확인"),
    sheetUrl ? "- 개인정보/사진 원본 링크: " + sheetUrl : ""
  ].filter(line => line !== "").join("\n");
}

function consultationQuestions_(issueType, haystack) {
  const text = String(haystack || "").toLowerCase();
  if (issueType === "전기" || /전기|차단기|정전|스파크|조명/.test(text)) {
    return ["전체 정전인지 해당 호실만 문제인지 확인", "차단기가 반복해서 내려가는지 확인", "타는 냄새나 스파크가 있었는지 확인"];
  }
  if (issueType === "누수" || issueType === "배관" || /누수|배관|물|천장|배수|역류/.test(text)) {
    return ["물이 떨어지는 위치와 범위 확인", "계속 새는지 간헐적으로 새는지 확인", "아래층 피해나 전기 설비 근처 누수 여부 확인"];
  }
  if (issueType === "도어락" || /도어락|문|잠금|출입/.test(text)) {
    return ["현재 출입 가능 여부 확인", "배터리 교체 여부 확인", "문틀/잠금장치 물리적 걸림 여부 확인"];
  }
  if (issueType === "보일러" || /보일러|난방|온수/.test(text)) {
    return ["온수와 난방 중 어떤 기능 문제인지 확인", "에러코드 표시 여부 확인", "가스 밸브와 전원 상태 확인"];
  }
  if (issueType === "에어컨" || /에어컨|냉방|실외기/.test(text)) {
    return ["전원이 켜지는지 확인", "냉방이 안 되는지 누수/소음 문제인지 확인", "실외기 작동 여부 확인"];
  }
  return ["현장 확인이 필요한 증상인지 확인", "사진 추가 요청 필요 여부 확인", "방문 가능 시간 재확인"];
}

function consultationWarnings_(description, photo, visitTime, analysis) {
  const warnings = [];
  if (!photo) warnings.push("사진 첨부 없음: 현장 판단 전 사진 요청 권장");
  if (!description || String(description).replace(/\s/g, "").length < 12) warnings.push("설명이 짧음: 증상 세부 확인 필요");
  if (!visitTime) warnings.push("방문 가능 시간 미입력: 일정 조율 전 확인 필요");
  if (analysis && analysis.urgency === "긴급") warnings.push("긴급 표현 감지: 관리자 우선 확인");
  if (!warnings.length) warnings.push("필수 상담 정보는 1차로 확보됨");
  return warnings;
}

function makeClassificationNote_(ticketNo, record, analysis) {
  const issueType = readField_(record, ["문제 유형"]) || "문제 유형 미입력";
  const vendorType = analysis.vendorType || "관리자 확인";
  const urgency = analysis.urgency || "미확인";
  const siteVisit = classificationSiteVisit_(issueType, vendorType, urgency);
  const quoteNeed = classificationQuoteNeed_(vendorType);
  const reasons = classificationReasonLines_(analysis);

  return [
    "[민원·요청 분류]",
    "업체 분류: " + vendorType,
    "긴급도: " + urgency,
    "현장/견적: " + siteVisit + " / " + quoteNeed,
    "근거: " + reasons[0],
    "접수번호: " + ticketNo + " · 문제: " + issueType
  ].join("\n").replace(/\n+$/, "");
}

function classificationSiteVisit_(issueType, vendorType, urgency) {
  const text = [issueType, vendorType].join(" ");
  if (urgency === "긴급") return "필요";
  if (/전기|누수|배관|보일러|에어컨|도어락|출입|창호|문|청소|방역|공용부/.test(text)) return "필요";
  return "확인 필요";
}

function classificationQuoteNeed_(vendorType) {
  return vendorType === "관리자 확인" ? "확인 필요" : "필요";
}

function classificationReasonLines_(analysis) {
  const lines = [];
  if (analysis && analysis.reason) lines.push(analysis.reason);
  if (analysis && analysis.urgency === "긴급") lines.push("긴급도 우선 확인 후 업체 연결이 필요합니다.");
  if (analysis && analysis.vendorType === "관리자 확인") lines.push("업체 분류가 명확하지 않아 관리자 확인이 필요합니다.");
  if (!lines.length) lines.push("구글폼 접수 내용과 상담카드 기준으로 1차 분류했습니다.");
  return lines;
}

function buildCasePayload_(ticketNo, record, analysis, contractMatch, row, sheet) {
  const timestamp = readRawField_(record, ["타임스탬프", "Timestamp"]);
  const receivedAt = dateFromValue_(timestamp).toISOString();
  const building = readField_(record, ["건물명", "건물"]);
  const address = readField_(record, ["건물 주소", "주소"]);
  const room = readField_(record, ["호실"]);
  const name = readField_(record, ["이름", "성명"]);
  const phone = readField_(record, ["연락처", "전화번호", "휴대폰"]);
  const issueType = readField_(record, ["문제 유형"]);
  const visitTime = readField_(record, ["방문 가능 시간"]);
  const sheetUrl = COMPLAINT_CONFIG.RESPONSE_SHEET_URL + "#gid=" + sheet.getSheetId();
  const isContractHold = contractMatch && (contractMatch.status === "unmatched" || contractMatch.status === "multiple" || contractMatch.status === "address_missing");
  const statusValue = isContractHold ? "계약확인보류" : analysis.statusValue;
  const status = isContractHold ? { c1: "doing" } : { c1: "done", c2: "doing" };
  const c1Note = contractMatch && contractMatch.status === "matched"
    ? "구글폼 자동 접수. Drive 온보딩 수집서와 연결되었습니다. 개인정보/사진 원본은 응답 시트에서 확인하세요."
    : isContractHold
      ? "온보딩 파일 미매칭. Drive 폴더의 DOCX 본문에 건물명/주소가 있는지 확인한 뒤 진행하세요."
      : "구글폼 자동 접수. 개인정보/사진 원본은 응답 시트에서 확인하세요.";

  return {
    id: ticketNo,
    ticketNo: ticketNo,
    source: "google_form",
    createdAt: new Date().toISOString(),
    receivedAt: receivedAt,
    sheetUrl: sheetUrl,
    sheetRow: row,
    name: maskName_(name) || "세입자",
    phone: maskPhone_(phone),
    email: "",
    building: building,
    address: address,
    room: maskRoom_(room),
    grade: contractMatch && contractMatch.contract && contractMatch.contract.grade ? contractMatch.contract.grade : "스탠다드",
    issueType: issueType,
    urgency: analysis.urgency,
    vendorType: analysis.vendorType,
    summary: analysis.summary,
    analysisReason: analysis.reason,
    visitTime: visitTime,
    statusValue: statusValue,
    contractMatch: contractMatch,
    status: status,
    note: {
      c1: c1Note,
      c3: makeConsultationNote_(ticketNo, record, analysis, sheetUrl),
      c4: makeClassificationNote_(ticketNo, record, analysis),
      c11: visitTime ? "방문 가능 시간: " + visitTime : ""
    },
    log: [
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + " 구글폼 자동 접수",
      "긴급도 " + analysis.urgency + " / 업체분류 " + analysis.vendorType,
      contractMatch ? "온보딩매칭 " + contractMatch.status + " / " + contractMatch.statusText : "온보딩매칭 미확인"
    ]
  };
}

function writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch, smsResult) {
  const headerMap = {};
  headers.forEach((header, index) => headerMap[header] = index + 1);
  const contract = contractMatch && contractMatch.contract ? contractMatch.contract : {};
  const fileName = (contractMatch && contractMatch.fileName) || contract.contractFileName || "";
  const statusText = contractMatch ? contractMatch.statusText : "";
  const matchStatus = contractMatch ? contractMatch.status : "미확인";
  const smsStatus = smsResult ? smsResult.status : "미확인";
  const smsText = smsResult ? smsResult.statusText : "";

  setCellByHeader_(sheet, row, headerMap, "접수번호", ticketNo);
  setCellByHeader_(sheet, row, headerMap, "긴급도", analysis.urgency);
  setCellByHeader_(sheet, row, headerMap, "민원 요약", analysis.summary);
  setCellByHeader_(sheet, row, headerMap, "업체 분류", analysis.vendorType);
  setCellByHeader_(sheet, row, headerMap, "상태값", casePayload.statusValue);
  setCellByHeader_(sheet, row, headerMap, "온보딩 매칭 상태", matchStatus);
  setCellByHeader_(sheet, row, headerMap, "온보딩 파일명", fileName);
  setCellByHeader_(sheet, row, headerMap, "온보딩 확인 메모", statusText);
  setCellByHeader_(sheet, row, headerMap, "계약 매칭 상태", matchStatus);
  setCellByHeader_(sheet, row, headerMap, "계약 건물주", contract.ownerName || "");
  setCellByHeader_(sheet, row, headerMap, "계약 파일명", fileName);
  setCellByHeader_(sheet, row, headerMap, "계약 확인 메모", statusText);
  setCellByHeader_(sheet, row, headerMap, "문자 발송 상태", smsStatus);
  setCellByHeader_(sheet, row, headerMap, "문자 발송 메모", smsText);
  setCellByHeader_(sheet, row, headerMap, "Firebase Case ID", casePayload.id);
  setCellByHeader_(sheet, row, headerMap, "분석 처리일시", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"));
}

function setCellByHeader_(sheet, row, headerMap, header, value) {
  if (headerMap[header]) sheet.getRange(row, headerMap[header]).setValue(value);
}

function firebaseCaseUrl_(caseId) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const path = COMPLAINT_CONFIG.FIREBASE_CASES_PATH.replace(/^\/|\/$/g, "");
  return base + "/" + path + "/" + encodeURIComponent(caseId) + ".json";
}

function writeCaseToFirebase_(caseId, payload) {
  const response = UrlFetchApp.fetch(firebaseCaseUrl_(caseId), {
    method: "put",
    contentType: "application/json; charset=utf-8",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firebase 저장 실패: HTTP " + code + " / " + response.getContentText());
  }
}

function maskName_(name) {
  const v = String(name || "").trim();
  if (!v) return "";
  if (v.length <= 1) return v;
  if (v.length === 2) return v[0] + "*";
  return v[0] + "*".repeat(v.length - 2) + v[v.length - 1];
}

function maskPhone_(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return phone ? "***" : "";
  return digits.slice(0, 3) + "-****-" + digits.slice(-4);
}

function maskRoom_(room) {
  const v = String(room || "").trim();
  if (!v) return "";
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 3) return digits[0] + "**호";
  return "호실 비공개";
}

function testAnalyzeSample() {
  const sample = {
    "건물명": "테스트빌딩",
    "건물 주소": "강원 원주시 테스트로 1",
    "호실": "302",
    "이름": "홍길동",
    "연락처": "010-1234-5678",
    "문제 유형": "누수",
    "증상 설명": "화장실 천장에서 물이 떨어지고 있습니다.",
    "사진 첨부": "https://example.com/photo",
    "방문 가능 시간": "오늘 오후 가능"
  };
  const analysis = analyzeComplaint_(sample);
  const contractMatch = matchDriveOnboardingFile_(sample);
  Logger.log(JSON.stringify(buildCasePayload_("BR-TEST-0001", sample, analysis, contractMatch, 2, getResponseSheet_()), null, 2));
}
