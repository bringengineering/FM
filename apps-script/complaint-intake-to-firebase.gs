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
  QUOTE_DRIVE_FOLDER_ID: "11QX5F-KRQvvYNc0hso3QACuMS7lMZw4r",
  QUOTE_TEMPLATE_SPREADSHEET_ID: "1JXP8NEaU0I_96ZMAZFn2GlYQHkLsbhSJCawsdMgqH7w",
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

  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  const quoteFolderId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_DRIVE_FOLDER_ID);
  if (quoteFolderId) {
    const quoteFolder = DriveApp.getFolderById(quoteFolderId);
    Logger.log("견적서 저장 폴더 확인 완료: " + quoteFolder.getName() + " / https://drive.google.com/drive/folders/" + quoteFolderId);
  }

  if (templateId) {
    const templateFile = DriveApp.getFileById(templateId);
    Logger.log("견적서 템플릿 확인 완료: " + templateFile.getName() + " / " + templateFile.getUrl());
  } else {
    Logger.log("견적서 템플릿 미설정: QUOTE_TEMPLATE_SPREADSHEET_ID에 Google Sheets 템플릿 ID를 넣으면 ⑥에서 브링 양식 견적서를 자동 생성합니다.");
  }
}

function onComplaintFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : getResponseSheet_();
  const row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  processResponseRow_(sheet, row);
}

function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (payload.action === "sendVendorEstimateMms") {
      return jsonResponse_(handleVendorEstimateMms_(payload));
    }
    if (payload.action === "uploadQuoteFile") {
      return jsonResponse_(handleQuoteFileUpload_(payload));
    }
    if (payload.action === "confirmQuoteAmount") {
      return jsonResponse_(handleConfirmQuoteAmount_(payload));
    }
    return jsonResponse_({ ok: false, message: "지원하지 않는 action입니다." });
  } catch (err) {
    try {
      recordAutomationError_(payload, err);
    } catch (recordErr) {
      Logger.log("자동화 오류 기록 실패: " + recordErr.message);
    }
    return jsonResponse_({ ok: false, message: err.message });
  }
}

function recordAutomationError_(payload, err) {
  const action = String(payload && payload.action || "");
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return;

  const message = err && err.message ? err.message : String(err || "알 수 없는 오류");
  const now = new Date().toISOString();
  const casePayload = readCaseFromFirebase_(caseId) || {};
  const log = Array.isArray(casePayload.log) ? casePayload.log : [];

  if (action === "uploadQuoteFile") {
    const fileName = payload && payload.file && payload.file.fileName ? String(payload.file.fileName) : "파일명 미확인";
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "견적 파일 업로드 실패: " + fileName + " / " + message });
    log.unshift("견적 파일 업로드 실패: " + fileName + " / " + message);
  } else if (action === "confirmQuoteAmount") {
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "견적 합계금액 확정 실패: " + message });
    log.unshift("견적 합계금액 확정 실패: " + message);
  } else if (action === "sendVendorEstimateMms") {
    patchCaseChildToFirebase_(caseId, "status", { c5: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c5: "업체 MMS 발송 실패: " + message });
    log.unshift("업체 MMS 발송 실패: " + message);
  } else {
    return;
  }

  if (log.length > 30) log.length = 30;
  patchCaseToFirebase_(caseId, { log: log, updatedAt: now });
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
  putCaseChildToFirebase_(caseId, "vendorEstimateMms", result);
  patchCaseChildToFirebase_(caseId, "status", {
    c5: casePayload.status.c5,
    c6: casePayload.status.c6
  });
  patchCaseChildToFirebase_(caseId, "note", { c5: casePayload.note.c5 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: casePayload.updatedAt
  });
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

function handleQuoteFileUpload_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const filePayload = payload.file || {};
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const validation = validateQuoteUpload_(filePayload);
  if (!validation.ok) {
    return updateQuoteUploadFailure_(caseId, casePayload, validation.message);
  }

  const initialVendorName = resolveInitialQuoteVendorName_(payload, filePayload.fileName);
  const vendor = normalizeQuoteVendor_(payload.vendor, initialVendorName);
  const uploadedAt = new Date().toISOString();
  const quoteId = "q" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + "-" + Utilities.getUuid().slice(0, 8);
  const folder = getQuoteDriveFolder_(casePayload);
  const originalFolder = getOrCreateChildFolder_(folder, "원본 견적서");
  const bringFolder = getOrCreateChildFolder_(folder, "브링 양식 견적서");
  const analysisFolder = getOrCreateChildFolder_(folder, "문서 분석 결과");
  const savedName = makeQuoteDriveFileName_(casePayload, initialVendorName, filePayload.fileName);
  const bytes = Utilities.base64Decode(String(filePayload.fileBody || "").replace(/^data:[^,]+,/, ""));
  const mimeType = filePayload.mimeType || inferQuoteMimeType_(filePayload.fileName);
  const blob = Utilities.newBlob(bytes, mimeType, savedName);
  const driveFile = originalFolder.createFile(blob);

  const quote = {
    id: quoteId,
    vendorId: String(payload.vendorId || ""),
    vendorName: initialVendorName,
    vendor: vendor,
    amount: String(payload.amount || "").trim(),
    memo: String(payload.memo || "").trim(),
    fileName: driveFile.getName(),
    fileUrl: driveFile.getUrl(),
    driveFileId: driveFile.getId(),
    originalFileName: driveFile.getName(),
    originalFileUrl: driveFile.getUrl(),
    originalDriveFileId: driveFile.getId(),
    mimeType: mimeType,
    size: Number(filePayload.size || bytes.length),
    uploadedAt: uploadedAt
  };

  const bringQuote = createBringQuoteFromUpload_(casePayload, quote, blob, payload, bringFolder, analysisFolder);
  Object.keys(bringQuote).forEach(key => {
    quote[key] = bringQuote[key];
  });
  applyQuoteAmountState_(quote);
  if (isGenericQuoteVendorName_(quote.vendorName) && quote.extractedVendorName) {
    quote.vendorName = quote.extractedVendorName;
    quote.vendor = quote.vendor || {};
    quote.vendor.name = quote.extractedVendorName;
  }
  const finalVendorName = quote.vendorName || initialVendorName;
  if (!isGenericQuoteVendorName_(finalVendorName)) {
    const renamed = makeQuoteDriveFileName_(casePayload, finalVendorName, filePayload.fileName);
    if (driveFile.getName() !== renamed) {
      driveFile.setName(renamed);
      quote.fileName = driveFile.getName();
      quote.originalFileName = driveFile.getName();
    }
  }

  casePayload.quoteFiles = casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  casePayload.quoteFiles[quoteId] = quote;
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("견적 파일 업로드: " + finalVendorName + " / " + driveFile.getName());
  if (quote.bringQuoteSheetUrl) {
    casePayload.log.unshift("브링 양식 견적서 초안 생성: " + finalVendorName + " / " + (quote.extractionStatus || "확인필요"));
  } else {
    casePayload.log.unshift("브링 양식 견적서 생성 보류: " + finalVendorName + " / " + (quote.extractionMemo || "템플릿 설정 확인 필요"));
  }
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = uploadedAt;
  putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: uploadedAt
  });

  return { ok: true, caseId: caseId, quote: quote, message: "견적 파일 업로드 및 브링 양식 처리 완료" };
}

function applyQuoteAmountState_(quote) {
  quote = quote || {};
  if (Number(quote.confirmedTotalAmount || 0)) {
    quote.amountStatus = "확정";
    quote.amountSource = "admin_confirmed";
    return quote;
  }
  if (Number(quote.bringQuoteTotalAmount || 0) || quote.amountSource === "bring_sheet") {
    quote.amountStatus = "확인필요";
    quote.amountSource = "bring_sheet";
    return quote;
  }
  if (Number(quote.totalAmount || 0)) {
    quote.amountStatus = "확인필요";
    quote.amountSource = "auto_extracted";
    return quote;
  }
  quote.amountStatus = "확인필요";
  quote.amountSource = "missing";
  return quote;
}

function handleConfirmQuoteAmount_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const quoteId = String(payload.quoteId || "").trim();
  const totalAmount = parseMoneyValue_(payload.totalAmount);
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  if (!quoteId) return { ok: false, message: "quoteId가 없습니다." };
  if (!totalAmount || totalAmount < 1000) return { ok: false, caseId: caseId, quoteId: quoteId, message: "확정할 합계금액을 1,000원 이상으로 입력해주세요." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  casePayload.quoteFiles = casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  const quote = casePayload.quoteFiles[quoteId];
  if (!quote) return { ok: false, caseId: caseId, quoteId: quoteId, message: "견적 파일을 찾지 못했습니다." };

  const amounts = confirmedQuoteAmounts_(totalAmount);
  const confirmedAt = new Date().toISOString();
  quote.confirmedTotalAmount = amounts.totalAmount;
  quote.confirmedSupplyAmount = amounts.supplyAmount;
  quote.confirmedVatAmount = amounts.vatAmount;
  quote.amountStatus = "확정";
  quote.amountSource = "admin_confirmed";
  quote.amountConfirmedAt = confirmedAt;
  quote.amount = formatMoney_(amounts.totalAmount);
  quote.totalAmount = amounts.totalAmount;
  quote.supplyAmount = amounts.supplyAmount;
  quote.vatAmount = amounts.vatAmount;
  quote.extractionMemo = removeQuoteMemo_(quote.extractionMemo, "금액 확인 필요");

  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  let rewriteMessage = "";
  if (!templateId) {
    quote.bringQuoteStatus = "template_missing";
    quote.bringQuoteType = "missing";
    quote.extractionStatus = quote.extractionStatus || "확인필요";
    quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "브링 양식 템플릿 설정 필요");
    rewriteMessage = "브링 양식 템플릿 설정 필요";
  } else {
    const folder = getQuoteDriveFolder_(casePayload);
    const bringFolder = getOrCreateChildFolder_(folder, "브링 양식 견적서");
    const extraction = makeConfirmedQuoteExtraction_(quote, casePayload, amounts);
    let sheetId = extractDriveId_(quote.bringQuoteSheetId || quote.bringQuoteSheetUrl);
    let sheetFile = null;
    if (sheetId) {
      sheetFile = DriveApp.getFileById(sheetId);
    } else {
      const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
      sheetFile = DriveApp.getFileById(templateId).makeCopy(fileNameBase, bringFolder);
      sheetId = sheetFile.getId();
    }

    const ss = SpreadsheetApp.openById(sheetId);
    fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
    SpreadsheetApp.flush();
    const sheetAmounts = readBringQuoteAmounts_(ss);
    if (sheetAmounts.totalAmount && !Number(quote.confirmedTotalAmount || 0)) {
      quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
      quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
      quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
      quote.bringQuoteAmountSyncedAt = confirmedAt;
    }

    quote.bringQuoteStatus = "confirmed_rewritten";
    quote.bringQuoteType = "confirmed";
    quote.bringQuoteSheetName = sheetFile.getName();
    quote.bringQuoteSheetUrl = sheetFile.getUrl();
    quote.bringQuoteSheetId = sheetId;
    quote.extractionStatus = "추출완료";
    quote.extractionMemo = appendQuoteMemo_(removeQuoteMemo_(quote.extractionMemo, "금액 확인 필요"), "관리자 확정 금액으로 브링 양식 재작성");
    quote.extractedItems = extraction.items;

    const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
    const exported = exportBringQuoteXlsx_(sheetId, fileNameBase + ".xlsx", bringFolder);
    if (exported.ok) {
      quote.bringQuoteXlsxName = exported.fileName;
      quote.bringQuoteXlsxUrl = exported.fileUrl;
      quote.bringQuoteXlsxId = exported.fileId;
    } else {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "XLSX 내보내기 실패: " + exported.message);
    }
    rewriteMessage = "브링 양식 재작성 완료";
  }

  casePayload.quoteFiles[quoteId] = quote;
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("견적 합계금액 확정: " + (quote.vendorName || "업체") + " / " + formatCurrencyText_(amounts.totalAmount) + " / " + rewriteMessage);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = confirmedAt;

  putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: confirmedAt
  });

  return { ok: true, caseId: caseId, quoteId: quoteId, quote: quote, message: rewriteMessage };
}

function confirmedQuoteAmounts_(totalAmount) {
  const total = Number(totalAmount || 0);
  const supply = total ? Math.round(total / 1.1) : 0;
  return {
    totalAmount: total,
    supplyAmount: supply,
    vatAmount: total ? total - supply : 0
  };
}

function makeConfirmedQuoteExtraction_(quote, casePayload, amounts) {
  return {
    status: "추출완료",
    memo: "관리자 확정 금액",
    vendorName: quote.extractedVendorName || quote.vendorName || "",
    supplyAmount: amounts.supplyAmount,
    vatAmount: amounts.vatAmount,
    totalAmount: amounts.totalAmount,
    items: [{
      product: [(casePayload.issueType || casePayload.vendorType || "현장"), "점검 및 공사 견적"].join(" "),
      unit: "식",
      unitPrice: amounts.supplyAmount,
      vat: amounts.vatAmount,
      total: amounts.totalAmount,
      note: "관리자 확정 금액",
      fallback: true
    }]
  };
}

function appendQuoteMemo_(memo, message) {
  const current = String(memo || "").trim();
  const next = String(message || "").trim();
  if (!next || current.indexOf(next) !== -1) return current;
  return [current, next].filter(Boolean).join(" / ");
}

function removeQuoteMemo_(memo, phrase) {
  const target = String(phrase || "").trim();
  if (!target) return String(memo || "").trim();
  return String(memo || "")
    .split(/\s+\/\s+/)
    .map(part => part.trim())
    .filter(part => part && part !== target)
    .join(" / ");
}

function validateQuoteUpload_(filePayload) {
  const fileName = String(filePayload.fileName || "").trim();
  const mimeType = String(filePayload.mimeType || "").trim();
  const body = String(filePayload.fileBody || "").replace(/^data:[^,]+,/, "");
  const size = Number(filePayload.size || 0);
  const maxSize = 5 * 1024 * 1024;
  const ext = fileName.split(".").pop().toLowerCase();
  const allowedExts = ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "hwp", "hwpx"];
  const allowedMimes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/x-hwp",
    "application/haansofthwp",
    "application/vnd.hancom.hwp",
    "application/vnd.hancom.hwpx"
  ];

  if (!fileName) return { ok: false, message: "파일명이 없습니다." };
  if (!body) return { ok: false, message: "파일 내용이 없습니다." };
  if (size > maxSize) return { ok: false, message: "파일 용량이 5MB를 초과했습니다." };
  if (!allowedExts.includes(ext) && !allowedMimes.includes(mimeType)) {
    return { ok: false, message: "지원하지 않는 견적 파일 형식입니다. PDF, JPG, PNG, DOC/DOCX, XLS/XLSX, HWP/HWPX만 업로드할 수 있습니다." };
  }
  return { ok: true };
}

function updateQuoteUploadFailure_(caseId, casePayload, message) {
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = "견적 파일 업로드 실패: " + message;
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("견적 파일 업로드 실패: " + message);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = new Date().toISOString();
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: casePayload.updatedAt
  });
  return { ok: false, caseId: caseId, message: message };
}

function getQuoteDriveFolder_(casePayload) {
  const configured = extractDriveId_(COMPLAINT_CONFIG.QUOTE_DRIVE_FOLDER_ID);
  if (!configured) throw new Error("QUOTE_DRIVE_FOLDER_ID가 비어 있어 견적서 저장 폴더를 찾을 수 없습니다.");
  const quoteRoot = DriveApp.getFolderById(configured);
  const caseName = safeDriveName_((casePayload.ticketNo || casePayload.id || "case") + "_" + (casePayload.building || "건물"));
  return getOrCreateChildFolder_(quoteRoot, caseName);
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function makeQuoteDriveFileName_(casePayload, vendorName, originalName) {
  const extMatch = String(originalName || "").match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = [
    casePayload.ticketNo || casePayload.id || "case",
    vendorName || "업체",
    "견적"
  ].join("_");
  return safeDriveName_(base).slice(0, 120 - ext.length) + ext.toLowerCase();
}

function resolveInitialQuoteVendorName_(payload, originalName) {
  const selected = String(payload.vendorName || "").trim();
  if (selected && !isGenericQuoteVendorName_(selected)) return selected;
  const fromFile = extractQuoteVendorNameFromFileName_(originalName);
  if (fromFile) return fromFile;
  return selected && !isGenericQuoteVendorName_(selected) ? selected : "업체 확인 필요";
}

function extractQuoteVendorNameFromFileName_(fileName) {
  const raw = String(fileName || "").replace(/\.[^.]+$/, "");
  if (!raw) return "";
  const withoutCase = raw
    .replace(/^BR-\d{4}-\d{4}[_\-\s]*/i, "")
    .replace(/^\d{1,3}[_\-\s]*/, "");
  const parts = withoutCase.split(/[_\-]+/).map(part => part.trim()).filter(Boolean);
  const filtered = parts.filter(part => !/^(견적서?|견적|최종|수정|업로드|회신|원본|브링|양식|확인|필요)$/i.test(part));
  const candidate = filtered[0] || withoutCase;
  const cleaned = cleanExtractedVendorName_(candidate);
  return isGenericQuoteVendorName_(cleaned) ? "" : cleaned;
}

function normalizeQuoteVendor_(vendor, fallbackName) {
  vendor = vendor || {};
  const fallback = isGenericQuoteVendorValue_(fallbackName) ? "" : fallbackName;
  return {
    id: String(vendor.id || ""),
    category: String(vendor.category || ""),
    no: String(vendor.no || ""),
    type: String(vendor.type || ""),
    name: String(isGenericQuoteVendorValue_(vendor.name) ? fallback || "업체 미지정" : vendor.name || fallback || "업체 미지정"),
    address: String(vendor.address || ""),
    phone: String(vendor.phone || ""),
    email: String(vendor.email || vendor.mail || ""),
    businessNo: String(vendor.businessNo || vendor.bizNo || vendor.no || ""),
    ceo: String(vendor.ceo || vendor.owner || ""),
    note: String(vendor.note || "")
  };
}

function isGenericQuoteVendorName_(value) {
  return isGenericQuoteVendorValue_(value);
}

function isGenericQuoteVendorValue_(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return true;
  const compact = raw.replace(/\s+/g, "").toLowerCase();
  if (/^(test|sample|quote|vendor|company)$/i.test(raw)) return true;
  if (/^(테스트|샘플|견적|견적서|업체|업체명|업체미지정|업체확인필요|확인필요|미지정|자동|수동|원본|브링|양식)$/.test(compact)) return true;
  if (/업체(미지정|확인|자동|명없음)/.test(compact)) return true;
  if (/^br-\d{4}-\d{4}$/i.test(raw)) return true;
  if (/^\d+$/.test(compact)) return true;
  return false;
}

function extractQuoteVendorInfo_(text, mineruResult, fileName) {
  const structured = extractQuoteVendorInfoFromObject_(mineruResult || {});
  const fromText = extractQuoteVendorInfoFromText_(text || "");
  const merged = mergeVendorInfoObjects_(structured, fromText);
  const cleaned = cleanVendorInfo_(merged);
  cleaned.source = Object.keys(cleanVendorInfo_(fromText)).some(key => key !== "source" && cleanVendorInfo_(fromText)[key])
    ? "quote_text"
    : Object.keys(cleanVendorInfo_(structured)).some(key => key !== "source" && cleanVendorInfo_(structured)[key])
      ? "mineru_structured"
      : "";
  cleaned.fileNameVendorName = extractQuoteVendorNameFromFileName_(fileName);
  return cleaned;
}

function extractQuoteVendorInfoFromText_(text) {
  const source = String(text || "");
  return {
    name: extractQuoteVendorName_(source),
    phone: extractQuotePhone_(source),
    businessNo: extractQuoteBusinessNo_(source),
    ceo: extractFieldNearLabels_(source, ["대표자", "대표", "성명"]),
    address: extractFieldNearLabels_(source, ["주소", "사업장주소", "소재지"]),
    type: extractFieldNearLabels_(source, ["업태"]),
    category: extractFieldNearLabels_(source, ["업종", "종목"]),
    email: extractQuoteEmail_(source),
    source: "quote_text"
  };
}

function extractQuoteVendorInfoFromObject_(data) {
  const roots = [
    data && data.vendorInfo,
    data && data.supplier,
    data && data.company,
    data && data.vendor,
    data && data.provider,
    data && data.json,
    data
  ].filter(Boolean);
  const root = { roots: roots };
  return cleanVendorInfo_({
    name: deepFindValueByKeys_(root, ["vendorName", "supplierName", "companyName", "corpName", "businessName", "상호", "회사명", "업체명", "공급자"]),
    phone: deepFindValueByKeys_(root, ["phone", "tel", "telephone", "mobile", "contact", "전화", "연락처", "TEL"]),
    businessNo: deepFindValueByKeys_(root, ["businessNo", "bizNo", "registrationNo", "사업자번호", "사업자등록번호", "등록번호"]),
    ceo: deepFindValueByKeys_(root, ["ceo", "owner", "representative", "대표", "대표자"]),
    address: deepFindValueByKeys_(root, ["address", "addr", "소재지", "주소", "사업장주소"]),
    type: deepFindValueByKeys_(root, ["businessType", "업태"]),
    category: deepFindValueByKeys_(root, ["businessCategory", "industry", "업종", "종목"]),
    email: deepFindValueByKeys_(root, ["email", "mail", "이메일"]),
    source: "mineru_structured"
  });
}

function mergeQuoteVendorInfo_(fileInfo, selectedVendor, fileNameCandidate) {
  const file = cleanVendorInfo_(fileInfo || {});
  const selected = cleanVendorInfo_(normalizeQuoteVendor_(selectedVendor || {}, ""));
  const fileNameInfo = cleanVendorInfo_({ name: fileNameCandidate || "" });
  const merged = mergeVendorInfoObjects_(selected, file);
  const quoteName = file.name || fileNameInfo.name || "";
  const matchedVendorListAddress = resolveVendorListAddress_(quoteName, selected);
  merged.name = quoteName || "";
  merged.address = file.address || "";
  merged.addressFromVendorList = matchedVendorListAddress;
  merged.source = file.name || file.phone || file.businessNo || file.ceo || file.address || file.type || file.category || file.email
    ? (file.source || "quote_text")
    : fileNameInfo.name
      ? "file_name"
      : selected.phone || selected.businessNo || selected.ceo || selected.type || selected.category || selected.email || matchedVendorListAddress
        ? "vendor_list"
        : "missing";
  return {
    vendor: cleanVendorInfo_(merged),
    source: merged.source
  };
}

function resolveVendorListAddress_(quoteVendorName, selectedVendor) {
  const selected = cleanVendorInfo_(selectedVendor || {});
  if (!selected.address) return "";
  if (!quoteVendorName || !isSimilarVendorName_(quoteVendorName, selected.name)) return "";
  return selected.address;
}

function isSimilarVendorName_(left, right) {
  const a = vendorMatchKey_(left);
  const b = vendorMatchKey_(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
}

function mergeVendorInfoObjects_(base, override) {
  base = cleanVendorInfo_(base || {});
  override = cleanVendorInfo_(override || {});
  return {
    id: override.id || base.id || "",
    category: override.category || base.category || "",
    no: override.no || base.no || "",
    type: override.type || base.type || "",
    name: override.name || base.name || "",
    address: override.address || base.address || "",
    addressFromVendorList: override.addressFromVendorList || base.addressFromVendorList || "",
    phone: override.phone || base.phone || "",
    email: override.email || base.email || "",
    businessNo: override.businessNo || base.businessNo || "",
    ceo: override.ceo || base.ceo || "",
    note: override.note || base.note || "",
    source: override.source || base.source || ""
  };
}

function cleanVendorInfo_(info) {
  info = info || {};
  const name = cleanExtractedVendorName_(info.name || info.vendorName || info.companyName || "");
  return {
    id: String(info.id || ""),
    category: cleanSimpleVendorField_(info.category || info.industry || ""),
    no: String(info.no || ""),
    type: cleanSimpleVendorField_(info.type || info.businessType || ""),
    name: isGenericQuoteVendorValue_(name) ? "" : name,
    address: cleanQuoteAddress_(info.address || ""),
    addressFromVendorList: cleanQuoteAddress_(info.addressFromVendorList || ""),
    phone: cleanQuotePhone_(info.phone || info.tel || info.mobile || ""),
    email: cleanQuoteEmail_(info.email || info.mail || ""),
    businessNo: cleanBusinessNo_(info.businessNo || info.bizNo || info.registrationNo || ""),
    ceo: cleanSimpleVendorField_(info.ceo || info.owner || info.representative || ""),
    note: String(info.note || "").trim(),
    source: String(info.source || "")
  };
}

function chooseQuoteSelectedVendor_(payload, fileInfo, initialName, fileName) {
  const vendors = Array.isArray(payload.vendors) ? payload.vendors.map(v => normalizeQuoteVendor_(v, "")).filter(v => v.name || v.phone) : [];
  const fallback = normalizeQuoteVendor_(payload.vendor || {}, initialName);
  const targetNames = [
    fileInfo && fileInfo.name,
    initialName,
    extractQuoteVendorNameFromFileName_(fileName)
  ].map(cleanExtractedVendorName_).filter(name => name && !isGenericQuoteVendorName_(name));
  for (const target of targetNames) {
    const key = vendorMatchKey_(target);
    const exact = vendors.filter(v => vendorMatchKey_(v.name) === key);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) continue;
    const loose = vendors.filter(v => {
      const vk = vendorMatchKey_(v.name);
      return vk && key && (vk.indexOf(key) !== -1 || key.indexOf(vk) !== -1);
    });
    if (loose.length === 1) return loose[0];
  }
  if (vendors.length === 1) return vendors[0];
  return fallback;
}

function vendorMatchKey_(value) {
  return String(value || "")
    .replace(/주식회사|\(주\)|㈜/g, "")
    .replace(/[^가-힣a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function extractFieldNearLabels_(text, labels) {
  const lines = normalizeQuoteTextLines_(text);
  const normalizedLabels = labels.map(label => String(label).replace(/\s+/g, ""));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const compact = line.replace(/\s+/g, "");
    for (let j = 0; j < labels.length; j++) {
      if (compact.indexOf(normalizedLabels[j]) === -1) continue;
      const value = cleanFieldValueAfterLabel_(line, labels[j]);
      if (value) return value;
      const next = cleanFieldValueAfterLabel_(lines[i + 1] || "", "");
      if (next && !labels.some(label => (lines[i + 1] || "").indexOf(label) !== -1)) return next;
    }
  }
  return "";
}

function cleanFieldValueAfterLabel_(line, label) {
  let value = String(line || "").trim();
  if (label) value = value.replace(new RegExp("^.*?" + escapeRegex_(label) + "\\s*[:：=\\-]?\\s*"), "");
  value = value
    .replace(/^[\s:：=\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return value.slice(0, 140);
}

function extractQuoteBusinessNo_(text) {
  const source = String(text || "");
  const labeled = source.match(/(?:사업자\s*(?:등록)?\s*번호|등록번호)\s*[:：]?\s*([0-9]{3}[-.\s]?[0-9]{2}[-.\s]?[0-9]{5})/);
  return cleanBusinessNo_(labeled ? labeled[1] : "");
}

function extractQuotePhone_(text) {
  const labeled = extractFieldNearLabels_(text, ["전화번호", "전화", "연락처", "TEL", "Tel", "tel"]);
  return cleanQuotePhone_(labeled) || cleanQuotePhone_(text);
}

function extractQuoteEmail_(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function cleanQuotePhone_(value) {
  const phones = extractPhones_(value);
  const digits = phones.find(phone => /^01[016789]\d{7,8}$/.test(phone)) || phones[0] || "";
  if (!digits) return "";
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
  if (digits.length === 10 && digits.indexOf("02") === 0) return digits.replace(/(\d{2})(\d{4})(\d{4})/, "$1-$2-$3");
  if (digits.length === 10) return digits.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return digits;
}

function cleanBusinessNo_(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 10) return "";
  return digits.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3");
}

function cleanQuoteEmail_(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function cleanQuoteAddress_(value) {
  const cleaned = String(value || "")
    .replace(/^[\s:：=\-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(전화|TEL|Tel|tel|연락처|대표자|대표|사업자|이메일|업태|업종|종목)\s*[:：]?.*$/g, "")
    .trim();
  if (!cleaned || isGenericQuoteVendorValue_(cleaned)) return "";
  return cleaned.slice(0, 120);
}

function cleanSimpleVendorField_(value) {
  const cleaned = String(value || "")
    .replace(/^[\s:：=\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || isGenericQuoteVendorValue_(cleaned)) return "";
  return cleaned
    .replace(/\s*(사업자등록번호|사업자번호|전화번호|전화|TEL|이메일|주소)\s*[:：]?.*$/g, "")
    .trim()
    .slice(0, 80);
}

function deepFindValueByKeys_(obj, keys) {
  const wanted = keys.map(key => String(key).replace(/[\s_\-]/g, "").toLowerCase());
  const queue = [obj];
  let visited = 0;
  while (queue.length && visited < 300) {
    const current = queue.shift();
    visited++;
    if (!current || typeof current !== "object") continue;
    for (const key in current) {
      const normalized = String(key).replace(/[\s_\-]/g, "").toLowerCase();
      const value = current[key];
      if (wanted.some(item => normalized === item || normalized.indexOf(item) !== -1)) {
        if (value !== null && value !== undefined && typeof value !== "object") return String(value);
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return "";
}

function makeBringQuoteFileNameBase_(quote, extraction) {
  const rawVendor = !isGenericQuoteVendorName_(quote.vendorName)
    ? quote.vendorName
    : extraction.vendorName;
  const vendorName = String(rawVendor || "").trim() || "업체확인필요";
  const dateSource = quote.uploadedAt ? new Date(quote.uploadedAt) : new Date();
  const date = Utilities.formatDate(dateSource, "Asia/Seoul", "yyyyMMdd");
  return safeDriveName_(vendorName + "_" + date);
}

function createBringQuoteFromUpload_(casePayload, quote, blob, payload, bringFolder, analysisFolder) {
  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  const extraction = extractQuoteDataFromUpload_(blob, quote.mimeType, quote.fileName, payload.amount, casePayload, analysisFolder);
  const selectedVendor = chooseQuoteSelectedVendor_(payload, extraction.vendorInfo, quote.vendorName, quote.fileName);
  const resolvedVendor = mergeQuoteVendorInfo_(extraction.vendorInfo, selectedVendor, extraction.fileNameVendorName || extractQuoteVendorNameFromFileName_(quote.fileName));
  quote.vendor = resolvedVendor.vendor;
  quote.resolvedVendorInfo = resolvedVendor.vendor;
  quote.vendorInfoSource = resolvedVendor.source;
  quote.vendorName = resolvedVendor.vendor.name || "업체 확인 필요";
  const result = {
    extractionStatus: extraction.status,
    extractionMemo: extraction.memo,
    extractionTextPreview: extraction.textPreview,
    amount: quote.amount || formatMoney_(extraction.totalAmount),
    supplyAmount: extraction.supplyAmount || "",
    vatAmount: extraction.vatAmount || "",
    totalAmount: extraction.totalAmount || "",
    extractedVendorName: extraction.vendorName || "",
    extractedVendorInfo: extraction.vendorInfo || {},
    resolvedVendorInfo: resolvedVendor.vendor,
    vendorInfoSource: resolvedVendor.source,
    extractedItems: extraction.items || [],
    analysisEngine: extraction.analysisEngine || "",
    analysisStatus: extraction.analysisStatus || "",
    analysisStatusCode: extraction.analysisStatusCode || "",
    analysisConfidence: extraction.analysisConfidence || "",
    analysisWarnings: extraction.analysisWarnings || [],
    analysisMarkdownUrl: extraction.analysisMarkdownUrl || "",
    analysisMarkdownFileId: extraction.analysisMarkdownFileId || "",
    analysisJsonUrl: extraction.analysisJsonUrl || "",
    analysisJsonFileId: extraction.analysisJsonFileId || ""
  };

  if (!templateId) {
    result.extractionStatus = extraction.status === "추출실패" ? "추출실패" : "확인필요";
    result.extractionMemo = [result.extractionMemo, "QUOTE_TEMPLATE_SPREADSHEET_ID가 비어 있어 브링 양식 파일은 생성하지 않았습니다."].filter(Boolean).join(" / ");
    result.bringQuoteStatus = "template_missing";
    result.bringQuoteType = "missing";
    return result;
  }

  try {
    const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
    const templateFile = DriveApp.getFileById(templateId);
    const copied = templateFile.makeCopy(fileNameBase, bringFolder);
    const ss = SpreadsheetApp.openById(copied.getId());
    fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
    SpreadsheetApp.flush();
    const sheetAmounts = readBringQuoteAmounts_(ss);

    result.bringQuoteStatus = "draft_created";
    result.bringQuoteType = "draft";
    result.bringQuoteSheetName = copied.getName();
    result.bringQuoteSheetUrl = copied.getUrl();
    result.bringQuoteSheetId = copied.getId();
    if (sheetAmounts.totalAmount) {
      result.totalAmount = sheetAmounts.totalAmount;
      result.supplyAmount = sheetAmounts.supplyAmount || "";
      result.vatAmount = sheetAmounts.vatAmount || "";
      result.bringQuoteTotalAmount = sheetAmounts.totalAmount;
      result.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
      result.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
      result.amount = formatMoney_(sheetAmounts.totalAmount);
      result.amountSource = "bring_sheet";
      result.amountStatus = "확인필요";
      result.bringQuoteAmountSyncedAt = new Date().toISOString();
      result.extractionMemo = removeQuoteMemo_(result.extractionMemo, "금액 확인 필요");
    }

    const exported = exportBringQuoteXlsx_(copied.getId(), fileNameBase + ".xlsx", bringFolder);
    if (exported.ok) {
      result.bringQuoteXlsxName = exported.fileName;
      result.bringQuoteXlsxUrl = exported.fileUrl;
      result.bringQuoteXlsxId = exported.fileId;
    } else {
      result.extractionMemo = [result.extractionMemo, "XLSX 내보내기 실패: " + exported.message].filter(Boolean).join(" / ");
    }
  } catch (err) {
    result.bringQuoteStatus = "template_failed";
    result.bringQuoteType = "failed";
    result.extractionStatus = result.extractionStatus === "추출완료" ? "확인필요" : result.extractionStatus;
    result.extractionMemo = [result.extractionMemo, "브링 양식 생성 실패: " + err.message].filter(Boolean).join(" / ");
  }
  return result;
}

function extractQuoteDataFromUpload_(blob, mimeType, fileName, fallbackAmount, casePayload, analysisFolder) {
  const mineruResult = analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder);
  if (mineruResult.ok) {
    const text = mineruResult.markdown || mineruResult.text || "";
    const amounts = extractQuoteAmountsFromMinerU_(mineruResult, fallbackAmount, text);
    const items = extractQuoteItemsFromMinerU_(mineruResult, amounts, casePayload, text);
    const vendorInfo = extractQuoteVendorInfo_(text, mineruResult, fileName);
    const vendorName = vendorInfo.name || cleanExtractedVendorName_(mineruResult.vendorName) || extractQuoteVendorName_(text);
    let status = "확인필요";
    if (amounts.totalAmount && items.length && !amounts.usedFallbackOnly) status = "추출완료";

    const memo = [
      "MinerU 분석완료",
      mineruResult.warnings && mineruResult.warnings.length ? "주의: " + mineruResult.warnings.join(", ") : "",
      amounts.usedFallbackOnly ? "분석 결과에서 금액을 확정하지 못해 입력 금액을 사용했습니다." : "",
      !amounts.totalAmount ? "금액 확인 필요" : "",
      items.length && items[0].fallback ? "품목 추출이 어려워 기본 품목 1줄로 생성했습니다." : ""
    ].filter(Boolean).join(" / ");

    return {
      status: status,
      memo: memo,
      text: text,
      textPreview: text.replace(/\s+/g, " ").trim().slice(0, 500),
      vendorName: vendorName,
      vendorInfo: vendorInfo,
      fileNameVendorName: vendorInfo.fileNameVendorName || extractQuoteVendorNameFromFileName_(fileName),
      supplyAmount: amounts.supplyAmount || "",
      vatAmount: amounts.vatAmount || "",
      totalAmount: amounts.totalAmount || "",
      items: items,
      analysisEngine: "mineru",
      analysisStatus: "MinerU 분석완료",
      analysisStatusCode: "mineru_ok",
      analysisConfidence: mineruResult.confidence || "",
      analysisWarnings: mineruResult.warnings || [],
      analysisMarkdownUrl: mineruResult.markdownUrl || "",
      analysisMarkdownFileId: mineruResult.markdownFileId || "",
      analysisJsonUrl: mineruResult.jsonUrl || "",
      analysisJsonFileId: mineruResult.jsonFileId || ""
    };
  }

  const textResult = extractQuoteText_(blob, mimeType, fileName);
  const text = textResult.text || "";
  const amounts = extractQuoteAmounts_(text, fallbackAmount);
  const items = extractQuoteItems_(text, amounts, casePayload);
  const vendorInfo = extractQuoteVendorInfo_(text, mineruResult, fileName);
  const vendorName = vendorInfo.name || extractQuoteVendorName_(text);
  let status = "확인필요";
  if (!textResult.ok) {
    status = "추출실패";
  } else if (amounts.totalAmount && items.length && !amounts.usedFallbackOnly) {
    status = "추출완료";
  }

  const memo = [
    mineruResult.message || "",
    textResult.message || "",
    amounts.usedFallbackOnly ? "파일에서 금액을 찾지 못해 입력 금액을 사용했습니다." : "",
    !amounts.totalAmount ? "금액 확인 필요" : "",
    items.length && items[0].fallback ? "품목 추출이 어려워 기본 품목 1줄로 생성했습니다." : ""
  ].filter(Boolean).join(" / ");
  const fallbackSucceeded = !!(textResult.ok && (vendorName || amounts.totalAmount || (items.length && !items[0].fallback)));
  const fallbackStatus = mineruResult.manual
    ? "수동확인"
    : fallbackSucceeded || mineruResult.skipped
      ? "기본 분석"
      : "MinerU 분석실패";
  const fallbackStatusCode = mineruResult.manual
    ? "manual_required"
    : fallbackSucceeded || mineruResult.skipped
      ? "local_fallback"
      : (mineruResult.statusCode || "mineru_failed");

  return {
    status: status,
    memo: memo,
    text: text,
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 500),
    vendorName: vendorName,
    vendorInfo: vendorInfo,
    fileNameVendorName: vendorInfo.fileNameVendorName || extractQuoteVendorNameFromFileName_(fileName),
    supplyAmount: amounts.supplyAmount || "",
    vatAmount: amounts.vatAmount || "",
    totalAmount: amounts.totalAmount || "",
    items: items,
    analysisEngine: mineruResult.skipped ? "local_fallback" : "mineru_fallback",
    analysisStatus: fallbackStatus,
    analysisStatusCode: fallbackStatusCode,
    analysisConfidence: "",
    analysisWarnings: mineruResult.message ? [mineruResult.message] : [],
    analysisMarkdownUrl: "",
    analysisMarkdownFileId: "",
    analysisJsonUrl: "",
    analysisJsonFileId: ""
  };
}

function getMineruConfig_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = String(props.getProperty("MINERU_API_KEY") || "").trim();
  const apiUrl = String(props.getProperty("MINERU_API_URL") || (apiKey ? "https://mineru.net" : "")).trim().replace(/\/$/, "");
  const modelVersion = String(props.getProperty("MINERU_MODEL_VERSION") || "vlm").trim();
  const language = String(props.getProperty("MINERU_LANGUAGE") || "korean").trim();
  const maxWaitSeconds = Number(props.getProperty("MINERU_MAX_WAIT_SECONDS") || 75);
  return {
    apiUrl: apiUrl,
    apiKey: apiKey,
    modelVersion: modelVersion,
    language: language,
    maxWaitSeconds: maxWaitSeconds,
    enabled: !!apiUrl
  };
}

function isMineruNetEndpoint_(apiUrl) {
  return /(^https:\/\/)?([^\/]+\.)?mineru\.net$/i.test(String(apiUrl || "").replace(/\/$/, ""));
}

function mineruNetUrl_(config, path) {
  return String(config.apiUrl || "https://mineru.net").replace(/\/$/, "") + path;
}

function mineruNetFetchJson_(url, method, token, payload) {
  const options = {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "*/*"
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) {
    options.contentType = "application/json; charset=utf-8";
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText() || "{}";
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = { code: -1, msg: text.slice(0, 300) };
  }
  data.httpCode = code;
  return data;
}

function safeMineruDataId_(value) {
  return String(value || Utilities.getUuid())
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 120) || Utilities.getUuid();
}

function isOcrFriendlyFile_(fileName, mimeType) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  return ["pdf", "jpg", "jpeg", "png", "bmp", "webp"].includes(ext) || /^image\//.test(String(mimeType || ""));
}

function analyzeQuoteWithMineruNet_(blob, mimeType, fileName, casePayload, analysisFolder, config) {
  if (!config.apiKey) {
    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 토큰 미설정: MINERU_API_KEY를 스크립트 속성에 넣어주세요."
    };
  }

  try {
    const dataId = safeMineruDataId_((casePayload.ticketNo || casePayload.id || "case") + "_" + Utilities.getUuid().slice(0, 8));
    const createPayload = {
      files: [{
        name: fileName,
        data_id: dataId,
        is_ocr: isOcrFriendlyFile_(fileName, mimeType)
      }],
      model_version: config.modelVersion || "vlm",
      language: config.language || "korean",
      enable_table: true,
      enable_formula: false
    };
    const created = mineruNetFetchJson_(mineruNetUrl_(config, "/api/v4/file-urls/batch"), "post", config.apiKey, createPayload);
    if (created.httpCode < 200 || created.httpCode >= 300 || created.code !== 0) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 업로드 URL 생성 실패: " + (created.msg || ("HTTP " + created.httpCode))
      };
    }

    const batchId = created.data && created.data.batch_id;
    const uploadUrl = created.data && created.data.file_urls && created.data.file_urls[0];
    if (!batchId || !uploadUrl) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 업로드 URL 응답이 비어 있습니다."
      };
    }

    const uploadBlob = blob.copyBlob()
      .setContentType("application/octet-stream")
      .setName(fileName || "quote");
    const putResponse = UrlFetchApp.fetch(uploadUrl, {
      method: "put",
      contentType: "application/octet-stream",
      payload: uploadBlob,
      muteHttpExceptions: true
    });
    const putCode = putResponse.getResponseCode();
    if (putCode < 200 || putCode >= 300) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 파일 업로드 실패: HTTP " + putCode
      };
    }

    const started = Date.now();
    const maxWaitMs = Math.max(15, Number(config.maxWaitSeconds || 75)) * 1000;
    let lastState = "";
    let lastMessage = "";
    while (Date.now() - started < maxWaitMs) {
      Utilities.sleep(3500);
      const checked = mineruNetFetchJson_(mineruNetUrl_(config, "/api/v4/extract-results/batch/" + encodeURIComponent(batchId)), "get", config.apiKey);
      if (checked.httpCode < 200 || checked.httpCode >= 300 || checked.code !== 0) {
        lastMessage = checked.msg || ("HTTP " + checked.httpCode);
        continue;
      }
      const results = checked.data && checked.data.extract_result;
      const result = Array.isArray(results) ? results[0] : results;
      if (!result) {
        lastMessage = "결과가 아직 비어 있습니다.";
        continue;
      }
      lastState = result.state || "";
      if (lastState === "failed") {
        return {
          ok: false,
          statusCode: "mineru_failed",
          message: "MinerU 분석 실패: " + (result.err_msg || "분석 실패")
        };
      }
      if (lastState === "done" && result.full_zip_url) {
        const parsed = downloadMineruNetZipResult_(result.full_zip_url);
        const data = {
          markdown: parsed.markdown,
          json: parsed.json,
          tables: parsed.tables || [],
          vendorName: "",
          items: [],
          supplyAmount: "",
          vatAmount: "",
          totalAmount: "",
          confidence: parsed.markdown ? "mineru-net" : "",
          warnings: parsed.warnings || [],
          mineruNet: {
            batchId: batchId,
            dataId: dataId,
            fullZipUrl: result.full_zip_url,
            state: lastState
          }
        };
        const saved = saveMineruAnalysisFiles_(analysisFolder, fileName, casePayload, data);
        return {
          ok: true,
          markdown: parsed.markdown,
          json: parsed.json,
          tables: parsed.tables || [],
          vendorName: "",
          items: [],
          supplyAmount: "",
          vatAmount: "",
          totalAmount: "",
          confidence: "mineru.net",
          warnings: parsed.warnings || [],
          markdownUrl: saved.markdownUrl || "",
          markdownFileId: saved.markdownFileId || "",
          jsonUrl: saved.jsonUrl || "",
          jsonFileId: saved.jsonFileId || ""
        };
      }
    }

    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 분석 대기 시간 초과: " + (lastState || lastMessage || "처리중")
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 직접 연결 실패: " + err.message
    };
  }
}

function downloadMineruNetZipResult_(zipUrl) {
  const result = { markdown: "", json: {}, tables: [], warnings: [] };
  try {
    const response = UrlFetchApp.fetch(zipUrl, { method: "get", muteHttpExceptions: true });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      result.warnings.push("MinerU 결과 ZIP 다운로드 실패: HTTP " + code);
      return result;
    }
    const files = Utilities.unzip(response.getBlob());
    const mdFiles = files
      .filter(file => /\.md$/i.test(file.getName()))
      .sort((a, b) => b.getBytes().length - a.getBytes().length);
    if (mdFiles.length) {
      result.markdown = mdFiles[0].getDataAsString("UTF-8");
    }

    const jsonFiles = files.filter(file => /\.json$/i.test(file.getName()));
    const parsedJson = {};
    jsonFiles.forEach(file => {
      try {
        parsedJson[file.getName()] = JSON.parse(file.getDataAsString("UTF-8"));
      } catch (err) {
        parsedJson[file.getName()] = file.getDataAsString("UTF-8").slice(0, 1000);
      }
    });
    result.json = parsedJson;
    return result;
  } catch (err) {
    result.warnings.push("MinerU 결과 ZIP 처리 실패: " + err.message);
    return result;
  }
}

function analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "hwp") {
    return {
      ok: false,
      manual: true,
      statusCode: "manual_required",
      message: "HWP는 MinerU 자동 분석 미지원 파일입니다. 원본 확인이 필요합니다."
    };
  }

  const config = getMineruConfig_();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      statusCode: "mineru_not_configured",
      message: "MinerU API URL 미설정"
    };
  }
  if (isMineruNetEndpoint_(config.apiUrl) && ext === "hwpx") {
    return {
      ok: false,
      skipped: true,
      statusCode: "mineru_not_supported",
      message: "mineru.net API는 HWPX 직접 업로드를 지원하지 않아 HWPX 텍스트 추출로 처리합니다."
    };
  }
  if (isMineruNetEndpoint_(config.apiUrl)) {
    return analyzeQuoteWithMineruNet_(blob, mimeType, fileName, casePayload, analysisFolder, config);
  }

  try {
    const payload = {
      fileName: fileName,
      mimeType: mimeType || inferQuoteMimeType_(fileName),
      fileBase64: Utilities.base64Encode(blob.getBytes()),
      caseId: casePayload.ticketNo || casePayload.id || ""
    };
    const headers = {};
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;

    const endpoint = /\/analyze-quote$/i.test(config.apiUrl)
      ? config.apiUrl
      : config.apiUrl + "/analyze-quote";
    const response = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText() || "{}";
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 분석실패: HTTP " + code + " / " + body.slice(0, 180)
      };
    }

    const data = JSON.parse(body);
    if (data && data.ok === false) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 분석실패: " + (data.message || "응답 실패")
      };
    }

    const saved = saveMineruAnalysisFiles_(analysisFolder, fileName, casePayload, data);
    return {
      ok: true,
      markdown: String(data.markdown || data.text || ""),
      json: data.json || data.result || data,
      tables: Array.isArray(data.tables) ? data.tables : [],
      vendorName: data.vendorName || "",
      items: Array.isArray(data.items) ? data.items : [],
      supplyAmount: data.supplyAmount || data.supply || "",
      vatAmount: data.vatAmount || data.vat || "",
      totalAmount: data.totalAmount || data.total || data.amount || "",
      confidence: data.confidence || "",
      warnings: Array.isArray(data.warnings) ? data.warnings.map(String).filter(Boolean) : [],
      markdownUrl: saved.markdownUrl || "",
      markdownFileId: saved.markdownFileId || "",
      jsonUrl: saved.jsonUrl || "",
      jsonFileId: saved.jsonFileId || ""
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 분석실패: " + err.message
    };
  }
}

function saveMineruAnalysisFiles_(folder, fileName, casePayload, data) {
  if (!folder) return {};
  const ticketNo = casePayload.ticketNo || casePayload.id || "case";
  const base = safeDriveName_(ticketNo + "_" + String(fileName || "quote").replace(/\.[^.]+$/, "") + "_mineru");
  const result = {};
  const markdown = String(data.markdown || data.text || "").trim();
  if (markdown) {
    const mdFile = folder.createFile(Utilities.newBlob(markdown, "text/markdown", base + ".md"));
    result.markdownUrl = mdFile.getUrl();
    result.markdownFileId = mdFile.getId();
  }
  const jsonText = JSON.stringify(data.json || data.result || data, null, 2);
  const jsonFile = folder.createFile(Utilities.newBlob(jsonText, "application/json", base + ".json"));
  result.jsonUrl = jsonFile.getUrl();
  result.jsonFileId = jsonFile.getId();
  return result;
}

function extractQuoteAmountsFromMinerU_(mineruResult, fallbackAmount, text) {
  let supply = parseMoneyValue_(mineruResult.supplyAmount);
  let vat = parseMoneyValue_(mineruResult.vatAmount);
  let total = parseMoneyValue_(mineruResult.totalAmount);
  const local = extractQuoteAmounts_(text, fallbackAmount);

  if (!total && supply && vat) total = supply + vat;
  if (!total) total = local.totalAmount || "";
  if (!supply) supply = local.supplyAmount || "";
  if (!vat) vat = local.vatAmount || "";
  if (!supply && total && vat) supply = total - vat;
  if (!vat && total && supply) vat = total - supply;
  if (!supply && !vat && total) {
    supply = Math.round(total / 1.1);
    vat = total - supply;
  }

  return {
    supplyAmount: supply || "",
    vatAmount: vat || "",
    totalAmount: total || "",
    usedFallbackOnly: !parseMoneyValue_(mineruResult.totalAmount) && !!local.usedFallbackOnly
  };
}

function extractQuoteItemsFromMinerU_(mineruResult, amounts, casePayload, text) {
  const rawItems = Array.isArray(mineruResult.items) ? mineruResult.items : [];
  const items = rawItems
    .map(item => normalizeMineruItem_(item))
    .filter(item => item.product)
    .slice(0, 12);
  if (items.length) return items;
  return extractQuoteItems_(text, amounts, casePayload);
}

function normalizeMineruItem_(item) {
  if (!item || typeof item !== "object") return {};
  const total = parseMoneyValue_(item.total || item.totalAmount || item.amount || item.price);
  const unitPrice = parseMoneyValue_(item.unitPrice || item.supplyAmount || item.supply || "");
  const vat = parseMoneyValue_(item.vat || item.vatAmount || "");
  return {
    product: String(item.product || item.name || item.item || item.description || "").replace(/\s+/g, " ").trim().slice(0, 80),
    unit: String(item.unit || item.quantity || item.qty || "식").replace(/\s+/g, " ").trim().slice(0, 20),
    unitPrice: unitPrice || (total ? Math.round(total / 1.1) : ""),
    vat: vat || (total ? total - Math.round(total / 1.1) : ""),
    total: total || "",
    note: String(item.note || "MinerU 자동추출").slice(0, 60)
  };
}

function extractQuoteText_(blob, mimeType, fileName) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const text = extractXlsxText_(blob);
    return text
      ? { ok: true, text: text, message: "XLSX 텍스트 추출 완료" }
      : { ok: false, text: "", message: "XLSX 텍스트를 추출하지 못했습니다." };
  }
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const text = extractDocxTextFromBlob_(blob);
    return text
      ? { ok: true, text: text, message: "DOCX 텍스트 추출 완료" }
      : { ok: false, text: "", message: "DOCX 텍스트를 추출하지 못했습니다." };
  }
  if (ext === "hwpx" || mimeType === "application/vnd.hancom.hwpx") {
    const text = extractHwpxText_(blob);
    return text
      ? { ok: true, text: text, message: "HWPX 텍스트 추출 완료" }
      : { ok: false, text: "", message: "HWPX 텍스트를 추출하지 못했습니다. 원본 확인이 필요합니다." };
  }
  if (ext === "hwp" || ["application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp"].includes(mimeType)) {
    return { ok: true, text: "", message: "HWP는 자동 추출 미지원 파일입니다. 원본을 저장했고 견적 내용은 수동 확인이 필요합니다." };
  }
  if (["pdf", "jpg", "jpeg", "png"].includes(ext) || /^image\//.test(mimeType) || mimeType === "application/pdf") {
    return extractTextWithDriveOcr_(blob, fileName);
  }
  return { ok: false, text: "", message: "이 파일 형식은 자동 텍스트 추출을 지원하지 않아 원본만 저장했습니다." };
}

function extractXlsxText_(blob) {
  try {
    const blobs = unzipOfficeBlob_(blob);
    return blobs
      .filter(item => /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/.test(item.getName()))
      .map(item => decodeSpreadsheetXmlText_(item.getDataAsString("UTF-8")))
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    Logger.log("XLSX 텍스트 추출 실패: " + err.message);
    return "";
  }
}

function extractDocxTextFromBlob_(blob) {
  try {
    const blobs = unzipOfficeBlob_(blob);
    const xml = blobs
      .filter(item => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(item.getName()))
      .map(item => item.getDataAsString("UTF-8"))
      .join("\n");
    return decodeXmlText_(xml);
  } catch (err) {
    Logger.log("업로드 DOCX 본문 추출 실패: " + err.message);
    return "";
  }
}

function extractHwpxText_(blob) {
  try {
    const blobs = unzipOfficeBlob_(blob);
    const previewText = blobs
      .filter(item => /^Preview\/PrvText\.txt$/i.test(item.getName()))
      .map(item => item.getDataAsString("UTF-8"))
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
    if (previewText) return previewText;

    const xml = blobs
      .filter(item => /^Contents\/(?:section\d+|header\d*|footer\d*)\.xml$/i.test(item.getName()))
      .map(item => item.getDataAsString("UTF-8"))
      .join("\n");
    return decodeXmlText_(xml);
  } catch (err) {
    Logger.log("HWPX 텍스트 추출 실패: " + err.message);
    return "";
  }
}

function unzipOfficeBlob_(blob) {
  const name = typeof blob.getName === "function" && blob.getName()
    ? blob.getName()
    : "office-file.zip";
  return Utilities.unzip(Utilities.newBlob(blob.getBytes(), "application/zip", name));
}

function decodeSpreadsheetXmlText_(xml) {
  return String(xml || "")
    .replace(/<row[^>]*>/g, "\n")
    .replace(/<\/c>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractTextWithDriveOcr_(blob, fileName) {
  if (typeof Drive === "undefined" || !Drive.Files || !Drive.Files.create) {
    return {
      ok: false,
      text: "",
      message: "PDF/이미지 추출에는 Apps Script 고급 Google 서비스의 Drive API(v3)가 필요합니다."
    };
  }

  let tempId = "";
  try {
    const resource = {
      name: "BRING OCR " + safeDriveName_(fileName || "quote"),
      mimeType: "application/vnd.google-apps.document"
    };
    const copiedBlob = blob.copyBlob().setName(fileName || "quote");
    const created = Drive.Files.create(resource, copiedBlob, { fields: "id" });
    tempId = created && created.id ? created.id : "";
    if (!tempId) return { ok: false, text: "", message: "Drive OCR 임시 문서 ID를 받지 못했습니다." };
    const text = DocumentApp.openById(tempId).getBody().getText();
    return text
      ? { ok: true, text: text, message: "Drive OCR 텍스트 추출 완료" }
      : { ok: false, text: "", message: "Drive OCR 결과 텍스트가 비어 있습니다." };
  } catch (err) {
    return { ok: false, text: "", message: "Drive OCR 추출 실패: " + err.message };
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (err) {}
    }
  }
}

function extractQuoteAmounts_(text, fallbackAmount) {
  let supply = extractAmountNearLabels_(text, ["공급가액", "공급가", "공급 금액", "공급가격"]);
  let vat = extractAmountNearLabels_(text, ["부가세", "VAT", "세액", "부가 가치세"]);
  let total = extractTotalQuoteAmount_(text);
  const fallback = parseMoneyValue_(fallbackAmount);
  let usedFallbackOnly = false;

  if (!total && supply && vat) total = supply + vat;
  if (!total) total = bestQuoteAmountCandidate_(text);
  if (!total && fallback) {
    total = fallback;
    usedFallbackOnly = true;
  }
  if (total && total < 1000) total = 0;
  if (!supply && total && vat) supply = total - vat;
  if (!vat && total && supply) vat = total - supply;
  if (!supply && !vat && total) {
    supply = Math.round(total / 1.1);
    vat = total - supply;
  }
  if (!total && supply && vat) total = supply + vat;

  return {
    supplyAmount: supply || "",
    vatAmount: vat || "",
    totalAmount: total || "",
    usedFallbackOnly: usedFallbackOnly
  };
}

function extractTotalQuoteAmount_(text) {
  const totalLabels = ["합계금액", "합계 금액", "총 합계", "총계", "총액", "견적금액", "견적 금액", "청구금액", "청구 금액", "총 견적", "합계", "합 계"];
  const lines = normalizeQuoteTextLines_(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const compactLine = line.replace(/\s+/g, "");
    if (!totalLabels.some(label => compactLine.indexOf(label.replace(/\s+/g, "")) !== -1)) continue;

    const value = bestMoneyValueFromSegment_(line);
    if (value >= 1000) return value;

    for (let offset = 1; offset <= 2; offset++) {
      const nextLine = lines[i + offset] || "";
      if (!nextLine || isNonTotalAmountLine_(nextLine)) continue;
      const nextValue = bestMoneyValueFromSegment_(nextLine);
      if (nextValue >= 1000) return nextValue;
    }
  }

  return extractAmountNearLabels_(text, totalLabels);
}

function normalizeQuoteTextLines_(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[|｜]/g, " ")
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function bestMoneyValueFromSegment_(segment) {
  const candidates = extractMoneyCandidates_(segment);
  if (!candidates.length) return 0;
  return candidates.reduce((best, item) => item.value > best.value ? item : best, candidates[0]).value;
}

function isNonTotalAmountLine_(line) {
  const compact = String(line || "").replace(/\s+/g, "");
  if (/공급가|공급금액|부가세|VAT|세액|단가|수량|규격|품목|사업자|전화|연락처/.test(compact)) return true;
  return false;
}

function extractAmountNearLabels_(text, labels) {
  const source = String(text || "").replace(/\s+/g, " ");
  for (const label of labels) {
    const pattern = new RegExp(escapeRegex_(label) + "[^0-9]{0,40}((?:\\d{1,3}(?:,\\d{3})+|\\d{4,})(?:\\.\\d+)?\\s*(?:만원|만|원)?)", "i");
    const match = source.match(pattern);
    const value = match ? parseMoneyValue_(match[1]) : 0;
    if (value >= 1000) return value;
  }
  return 0;
}

function extractMoneyValues_(text) {
  return extractMoneyCandidates_(text).map(item => item.value);
}

function bestQuoteAmountCandidate_(text) {
  const candidates = extractMoneyCandidates_(text);
  if (!candidates.length) return 0;
  return candidates.reduce((best, item) => item.value > best.value ? item : best, candidates[0]).value;
}

function extractMoneyCandidates_(text) {
  const source = String(text || "");
  const pattern = /(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|만|원)?/g;
  const results = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0];
    const value = parseMoneyValue_(raw);
    if (value < 1000 || value > 300000000) continue;
    const start = Math.max(0, match.index - 18);
    const end = Math.min(source.length, pattern.lastIndex + 18);
    const context = source.slice(start, end);
    if (isNonMoneyContext_(raw, context, value)) continue;
    results.push({ raw: raw, value: value, context: context });
  }
  return results;
}

function isNonMoneyContext_(raw, context, value) {
  const compactRaw = String(raw || "").replace(/\s+/g, "");
  const compactContext = String(context || "").replace(/\s+/g, "");
  if (isLikelyYmdDateNumber_(compactRaw)) return true;
  if (/^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/.test(compactRaw)) return true;
  if (/^\d{6,8}$/.test(compactRaw) && /일자|날짜|작성|발행|견적일/.test(compactContext)) return true;
  if (/BR-\d{4}-\d{4}/i.test(compactContext)) return true;
  if (value < 10000 && !/원|만원|만|금액|합계|견적|공급|부가|세액|총액|청구/.test(compactContext)) return true;
  if (/수량|규격|호실|전화|연락처|사업자|등록번호|팩스|우편|페이지|No\.?/i.test(compactContext) && !/원|만원|만/.test(compactRaw)) return true;
  return false;
}

function isLikelyYmdDateNumber_(value) {
  const raw = String(value || "").replace(/[^\d]/g, "");
  if (!/^20\d{6}$/.test(raw)) return false;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (year < 2020 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function extractQuoteVendorName_(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const patterns = [
    /(?:상호|업체명|회사명|공급자|견적업체)\s*[:：]?\s*([가-힣A-Za-z0-9㈜주식회사\.\-\s]{2,30})/,
    /([가-힣A-Za-z0-9㈜주식회사\.\-\s]{2,30})\s*(?:귀하|대표자|사업자번호)/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const name = match ? cleanExtractedVendorName_(match[1]) : "";
    if (name) return name;
  }
  return "";
}

function cleanExtractedVendorName_(value) {
  const name = String(value || "")
    .replace(/^(주식회사|\(주\)|㈜)\s*/g, "")
    .replace(/\s*(대표자|대표|사업자등록번호|사업자번호|등록번호|주소|전화번호|전화|연락처|TEL|Tel|tel|이메일|업태|업종|종목|견적|공급자).*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length < 2 || /견적서|합계|공급가액|부가세|주소|전화|이메일/.test(name) || isGenericQuoteVendorValue_(name)) return "";
  return name.slice(0, 30);
}

function parseMoneyValue_(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const compact = raw.replace(/,/g, "").replace(/\s+/g, "");
  const match = compact.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  let amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  if (/만원|만$/.test(compact)) amount *= 10000;
  return Math.round(amount);
}

function extractQuoteItems_(text, amounts, casePayload) {
  const lines = String(text || "")
    .split(/\n| {2,}/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (items.length >= 12) break;
    if (!/[가-힣A-Za-z]/.test(line)) continue;
    if (/합계|총액|부가세|공급가액|사업자|대표자|전화|주소|이메일|견적\s*일자/i.test(line)) continue;
    const moneyMatch = line.match(/(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|만|원)?(?!.*(?:\d{1,3}(?:,\d{3})+|\d{4,}))/);
    const total = moneyMatch ? parseMoneyValue_(moneyMatch[0]) : 0;
    if (!total) continue;
    const supply = Math.round(total / 1.1);
    const vat = total - supply;
    const product = line
      .replace(moneyMatch[0], "")
      .replace(/^\d+[\).\-]?\s*/, "")
      .replace(/단가|금액|합계|원/g, "")
      .trim();
    if (product.length < 2) continue;
    items.push({
      product: product.slice(0, 80),
      unit: "식",
      unitPrice: supply,
      vat: vat,
      total: total,
      note: "원본 자동추출"
    });
  }

  if (items.length) return items;

  const totalAmount = Number(amounts.totalAmount || 0);
  const supplyAmount = Number(amounts.supplyAmount || (totalAmount ? Math.round(totalAmount / 1.1) : 0));
  const vatAmount = Number(amounts.vatAmount || (totalAmount ? totalAmount - supplyAmount : 0));
  return [{
    product: [(casePayload.issueType || casePayload.vendorType || "현장"), "점검 및 공사 견적"].join(" "),
    unit: "식",
    unitPrice: supplyAmount || "",
    vat: vatAmount || "",
    total: totalAmount || "",
    note: "추출 확인 필요",
    fallback: true
  }];
}

function fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction) {
  const sheet = ss.getSheets()[0];
  const vendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
  if (!vendor.name) vendor.name = cleanExtractedVendorName_(quote.vendorName || extraction.vendorName || "");
  const vendorName = cleanExtractedVendorName_(vendor.name || quote.vendorName || extraction.vendorName || "");
  const vendorListAddress = cleanQuoteAddress_(vendor.addressFromVendorList || "");
  const total = Number(quote.confirmedTotalAmount || extraction.totalAmount || parseMoneyValue_(quote.amount) || 0);
  const supply = Number(quote.confirmedSupplyAmount || extraction.supplyAmount || (total ? Math.round(total / 1.1) : 0));
  const vat = Number(quote.confirmedVatAmount || extraction.vatAmount || (total ? total - supply : 0));
  setSheetValue_(sheet, "D5", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"));
  setSheetValue_(sheet, "D6", vendor.businessNo || "");
  setSheetValue_(sheet, "D7", vendorName || "");
  setSheetValue_(sheet, "I7", vendor.ceo || "");
  setSheetValue_(sheet, "D8", vendorListAddress || "");
  setSheetValue_(sheet, "D9", vendor.type || vendor.category || "");
  setSheetValue_(sheet, "I9", vendor.category || "");
  setSheetValue_(sheet, "D10", vendor.phone || "");
  setSheetValue_(sheet, "I10", vendor.email || "");
  setSheetValue_(sheet, "D11", vendorName || "");
  setSheetNumber_(sheet, "D13", supply);
  setSheetNumber_(sheet, "I13", vat);
  setSheetNumber_(sheet, "D15", total);

  for (let row = 18; row <= 29; row++) {
    ["C", "E", "G", "H", "I", "K"].forEach(col => setSheetValue_(sheet, col + row, ""));
  }
  const items = extraction.items || [];
  items.slice(0, 12).forEach((item, index) => {
    const row = 18 + index;
    setSheetValue_(sheet, "C" + row, item.product || "");
    setSheetValue_(sheet, "E" + row, item.unit || "식");
    setSheetNumber_(sheet, "G" + row, item.unitPrice || "");
    setSheetNumber_(sheet, "H" + row, item.vat || "");
    setSheetNumber_(sheet, "I" + row, item.total || "");
    setSheetValue_(sheet, "K" + row, item.note || "");
  });
  setSheetValue_(sheet, "C30", items.length || 1);
  setSheetNumber_(sheet, "E30", supply);
  setSheetNumber_(sheet, "H30", vat);
  setSheetNumber_(sheet, "J30", total);
}

function readBringQuoteAmounts_(ss) {
  const sheet = ss.getSheets()[0];
  const supply = readBringSheetMoney_(sheet, "D13") || readBringSheetMoney_(sheet, "E30");
  const vat = readBringSheetMoney_(sheet, "I13") || readBringSheetMoney_(sheet, "H30");
  let total = readBringSheetMoney_(sheet, "D15") || readBringSheetMoney_(sheet, "J30");
  if (!total && supply && vat) total = normalizeBringSheetMoney_(supply + vat);
  if (!total) return { supplyAmount: "", vatAmount: "", totalAmount: "" };
  const finalSupply = supply || Math.round(total / 1.1);
  const finalVat = vat || (total - finalSupply);
  return {
    supplyAmount: finalSupply,
    vatAmount: finalVat,
    totalAmount: total
  };
}

function readBringSheetMoney_(sheet, a1) {
  try {
    const range = sheet.getRange(a1);
    return normalizeBringSheetMoney_(range.getDisplayValue()) || normalizeBringSheetMoney_(range.getValue());
  } catch (err) {
    return 0;
  }
}

function normalizeBringSheetMoney_(value) {
  if (isLikelyDateText_(value)) return 0;
  const amount = parseMoneyValue_(value);
  if (!amount || amount < 1000) return 0;
  if (isLikelyYmdDateNumber_(String(amount))) return 0;
  return amount;
}

function isLikelyDateText_(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^20\d{2}[-./년\s]+\d{1,2}[-./월\s]+\d{1,2}/.test(raw)) return true;
  return isLikelyYmdDateNumber_(raw);
}

function setSheetValue_(sheet, a1, value) {
  try { sheet.getRange(a1).setValue(value); } catch (err) {}
}

function setSheetNumber_(sheet, a1, value) {
  try {
    const range = sheet.getRange(a1);
    if (value === "" || value == null || Number(value) === 0) {
      range.setValue(value === 0 ? 0 : "");
    } else {
      range.setValue(Number(value)).setNumberFormat("#,##0");
    }
  } catch (err) {}
}

function exportBringQuoteXlsx_(spreadsheetId, fileName, folder) {
  try {
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(spreadsheetId) +
      "/export?mimeType=" + encodeURIComponent(mime);
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return { ok: false, message: "HTTP " + code + " / " + response.getContentText().slice(0, 160) };
    }
    const file = folder.createFile(response.getBlob().setName(fileName));
    return { ok: true, fileName: file.getName(), fileUrl: file.getUrl(), fileId: file.getId() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function formatMoney_(value) {
  const num = Number(value || 0);
  return num ? String(num) : "";
}

function formatCurrencyText_(value) {
  const num = Number(value || 0);
  return num ? Utilities.formatString("%s원", String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",")) : "금액 미입력";
}

function escapeRegex_(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDriveName_(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|#{}\[\]%~&]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "file";
}

function inferQuoteMimeType_(fileName) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  const map = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    hwp: "application/x-hwp",
    hwpx: "application/vnd.hancom.hwpx"
  };
  return map[ext] || "application/octet-stream";
}

function makeQuoteComparisonNote_(casePayload) {
  const quotes = Object.values(casePayload.quoteFiles || {}).filter(Boolean);
  if (!quotes.length) return "";
  const lines = ["[견적 비교]", "업로드 견적: " + quotes.length + "건", ""];
  quotes.forEach(quote => {
    const confirmed = Number(quote.confirmedTotalAmount || 0);
    const bringSheetAmount = Number(quote.bringQuoteTotalAmount || 0);
    const extracted = Number(quote.totalAmount || 0);
    const bringLabel = quote.bringQuoteType === "confirmed" || quote.bringQuoteStatus === "confirmed_rewritten"
      ? "브링 양식 확정"
      : quote.bringQuoteSheetUrl
        ? "브링 양식 초안"
        : "브링 양식 확인 필요";
    const amountLabel = confirmed
      ? "확정합계 " + formatCurrencyText_(confirmed)
      : bringSheetAmount
        ? "브링양식 " + formatCurrencyText_(bringSheetAmount)
        : extracted
        ? "자동추출 " + formatCurrencyText_(extracted)
        : quote.amount ? "금액 " + quote.amount : "금액 미입력";
    lines.push("- " + [
      quote.vendorName || "업체 미지정",
      amountLabel,
      quote.fileName || "파일명 없음",
      quote.extractionStatus ? "추출 " + quote.extractionStatus : "",
      bringLabel
    ].join(" / "));
  });
  lines.push("");
  lines.push("비교 후 ⑥ 단계를 직접 완료하면 ⑦ 최적 추천으로 넘어갑니다.");
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

  const filePathMatch = v.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (filePathMatch) return filePathMatch[1];

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
    const blobs = unzipOfficeBlob_(DriveApp.getFileById(driveFileId).getBlob());
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

function firebaseCaseUrl_(caseId, childPath) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const path = COMPLAINT_CONFIG.FIREBASE_CASES_PATH.replace(/^\/|\/$/g, "");
  const child = childPath
    ? "/" + String(childPath).split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/")
    : "";
  return base + "/" + path + "/" + encodeURIComponent(caseId) + child + ".json";
}

function firebaseWriteRequest_(url, method, payload, label) {
  const response = UrlFetchApp.fetch(url, {
    method: method,
    contentType: "application/json; charset=utf-8",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(label + ": HTTP " + code + " / " + response.getContentText());
  }
  return response;
}

function patchCaseToFirebase_(caseId, patch) {
  return firebaseWriteRequest_(firebaseCaseUrl_(caseId), "patch", patch || {}, "Firebase 부분 저장 실패");
}

function patchCaseChildToFirebase_(caseId, childPath, patch) {
  return firebaseWriteRequest_(firebaseCaseUrl_(caseId, childPath), "patch", patch || {}, "Firebase 부분 저장 실패");
}

function putCaseChildToFirebase_(caseId, childPath, payload) {
  return firebaseWriteRequest_(firebaseCaseUrl_(caseId, childPath), "put", payload || {}, "Firebase 필드 저장 실패");
}

function mergeCasePayloadForFirebase_(existing, payload) {
  if (!existing || typeof existing !== "object") return payload;
  const merged = Object.assign({}, existing, payload);

  merged.status = Object.assign({}, payload.status || {}, existing.status || {});
  merged.note = Object.assign({}, payload.note || {}, existing.note || {});

  ["log", "quoteFiles", "vendorSelections", "vendorEstimateMms", "selectedVendors"].forEach(key => {
    if (existing[key] !== undefined) merged[key] = existing[key];
  });

  if (existing.archived === true) {
    merged.archived = true;
    merged.archivedAt = existing.archivedAt || merged.archivedAt;
    merged.archivedBy = existing.archivedBy || merged.archivedBy;
  }

  return merged;
}

function writeCaseToFirebase_(caseId, payload) {
  const existing = readCaseFromFirebase_(caseId);
  const merged = mergeCasePayloadForFirebase_(existing, payload || {});
  merged.updatedAt = new Date().toISOString();
  patchCaseToFirebase_(caseId, merged);
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
