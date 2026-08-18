/**
 * BRING Care 민원접수 자동 분석 -> FM GitHub.io 케이스 등록
 *
 * 설치 위치: Google Sheets 응답 시트의 확장 프로그램 > Apps Script
 * 최초 1회 실행: setupComplaintAutomation()
 */

const COMPLAINT_CONFIG = {
  SPREADSHEET_ID: "1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA",
  SHEET_NAME: "설문지 응답 시트1",
  CONTRACT_DRIVE_FOLDER_ID: "1GKI8oc4iicdEw7MnPKpfZrwKd4ZGKnBZ",
  QUOTE_DRIVE_FOLDER_ID: "11QX5F-KRQvvYNc0hso3QACuMS7lMZw4r",
  QUOTE_TEMPLATE_SPREADSHEET_ID: "1JXP8NEaU0I_96ZMAZFn2GlYQHkLsbhSJCawsdMgqH7w",
  VENDOR_QUOTE_REPLY_EMAIL: "bringengineering1008@gmail.com",
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbxGAdtEDoNifxkM-e_Jm7dBkCnjM4oPJqz8RxZXoMoSKod5M_m9Yj2b11-nI97zmfd6Jw/exec",
  OWNER_DECISION_SHORT_URL: "https://bringengineering.github.io/FM/approve.html?c=",
  FIREBASE_DATABASE_URL: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_CASES_PATH: "cases",
  FIREBASE_CASE_SETTINGS_PATH: "caseSettings",
  FIREBASE_PAYMENT_CALENDARS_PATH: "crmCompany/paymentCalendars",
  RESPONSE_SHEET_URL: "https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit",
  PAYMENT_SCHEDULE_DRIVE_FOLDER_ID: "1q1uKquSngjyi0upoCRmjnRxm_CD1sAcN",
  PAYMENT_SCHEDULE_SPREADSHEET_NAME: "BRING CARE 세입자 월세 관리대장"
};
const PAYMENT_SCHEDULE_SHEET_NAME = "세입자 월세 관리대장";
const PAYMENT_SCHEDULE_HEADERS = [
  "관리번호",
  "건물명",
  "호실",
  "세입자명",
  "연락처",
  "입금자명",
  "월 납부금액",
  "매월 납부일",
  "계약 시작일",
  "계약 종료일",
  "상태",
  "비고"
];
const AUTOMATION_BUILD = "complaint-workflow-20260803-v53";
const OWNER_RECOMMENDATION_IMAGE_VERSION = "owner-summary-v4";
const OWNER_DECISION_VIEW = "owner-decision";
const PAYMENT_NOTIFICATION_CONFIG_PROPERTY = "PAYMENT_NOTIFICATION_AUTOMATION_CONFIG";
const PAYMENT_NOTIFICATION_LEDGER_PREFIX = "PAYMENT_NOTIFICATION_LEDGER_";
const PAYMENT_NOTIFICATION_CONFIRMED_BASELINE_PROPERTY = "PAYMENT_NOTIFICATION_CONFIRMED_BASELINE";
const PAYMENT_DUE_ALERT_HOUR = 9;
const PAYMENT_OVERDUE_ALERT_HOUR = 13;
const OWNER_PAYMENT_ACCOUNT = {
  accountNumber: "123-456-789012",
  accountHolder: "브링케어"
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
  "분석 처리일시",
  "접수 경로",
  "카카오 사용자 키 해시",
  "카카오 처리 상태",
  "카카오 처리 메모"
];
const KAKAO_INTAKE_INPUT_HEADERS = [
  "타임스탬프",
  "건물명",
  "건물 주소",
  "호실",
  "이름",
  "연락처",
  "문제 유형",
  "증상 설명",
  "추가 요청사항",
  "방문 가능 시간",
  "사진 첨부",
  "카카오 사진 원본 URL"
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

  ensureKakaoComplaintQueueTrigger_();
  ensureFormAddressQuestion_();
  syncPaymentBuildingsFromOnboarding_();
  setupPaymentScheduleSheet_();
  ensurePaymentScheduleEditTrigger_();
  ensurePaymentNotificationTrigger_();
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
    Logger.log("사업자등록증은 견적서 저장 폴더의 케이스 폴더 안에 바로 저장됩니다: {접수번호}_{건물명}/사업자등록증/BR-..._{업체명}_사업자등록증.pdf");
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

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (String(params.view || "") === OWNER_DECISION_VIEW) {
    return renderOwnerDecisionPage_(params);
  }
  return HtmlService.createHtmlOutput(
    "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>BRING Care</title></head><body style=\"font-family:Arial,sans-serif;padding:32px\">" +
    "<h1 style=\"font-size:22px\">BRING Care 자동화</h1><p>서비스가 정상 작동 중입니다.</p></body></html>"
  ).setTitle("BRING Care");
}

function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (isKakaoChatbotSkillPayload_(payload)) {
      return jsonResponse_(handleKakaoChatbotSkill_(payload, e));
    }
    if (payload.action === "healthCheck") {
      return jsonResponse_({ ok: true, build: AUTOMATION_BUILD, time: new Date().toISOString() });
    }
    if (payload.action === "submitOwnerDecision") {
      return jsonResponse_(submitOwnerDecision(
        payload.caseId,
        payload.token,
        payload.decision
      ));
    }
    if (payload.action === "confirmCasePayment") {
      return jsonResponse_(handleConfirmCasePayment_(payload));
    }
    if (payload.action === "syncPaymentBuildings") {
      return jsonResponse_(syncPaymentBuildingsFromOnboarding_());
    }
    if (payload.action === "approveDriveImport") {
      return jsonResponse_(handleApproveDriveImport_(payload));
    }
    if (payload.action === "rejectDriveImport") {
      return jsonResponse_(handleRejectDriveImport_(payload));
    }
    if (payload.action === "syncPaymentSchedules") {
      return jsonResponse_(syncPaymentSchedulesFromSheet_(payload));
    }
    if (payload.action === "syncPopbillBankTransactions") {
      return jsonResponse_(syncPopbillBankTransactions_(payload));
    }
    if (payload.action === "sendPaymentReminderSms") {
      return jsonResponse_(handlePaymentReminderSms_(payload));
    }
    if (payload.action === "getPaymentReminderDeliveryStatus") {
      return jsonResponse_(handlePaymentReminderDeliveryStatus_(payload));
    }
    if (payload.action === "sendComplaintReceiptSms") {
      return jsonResponse_(handleComplaintReceiptSms_(payload));
    }
    if (payload.action === "sendVendorEstimateMms") {
      return jsonResponse_(handleVendorEstimateMms_(payload));
    }
    if (payload.action === "getOwnerRecommendationPreview") {
      return jsonResponse_(handleOwnerRecommendationPreview_(payload));
    }
    if (payload.action === "ensureOwnerDecisionLink") {
      return jsonResponse_(handleEnsureOwnerDecisionLink_(payload));
    }
    if (payload.action === "sendOwnerRecommendationMms") {
      return jsonResponse_(handleOwnerRecommendationMms_(payload));
    }
    if (payload.action === "confirmOwnerRecommendationMms") {
      return jsonResponse_(handleOwnerRecommendationMmsConfirmation_(payload));
    }
    if (payload.action === "uploadQuoteFile") {
      return jsonResponse_(handleQuoteFileUpload_(payload));
    }
    if (payload.action === "uploadBusinessRegistration") {
      return jsonResponse_(handleBusinessRegistrationUpload_(payload));
    }
    if (payload.action === "uploadWorkPhoto") {
      return jsonResponse_(handleWorkPhotoUpload_(payload));
    }
    if (payload.action === "confirmQuoteAmount") {
      return jsonResponse_(handleConfirmQuoteAmount_(payload));
    }
    if (payload.action === "applyBusinessRegistrationToQuote") {
      return jsonResponse_(handleApplyBusinessRegistrationToQuote_(payload));
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

function isKakaoChatbotSkillPayload_(payload) {
  return !!(
    payload &&
    payload.userRequest &&
    payload.userRequest.user &&
    payload.action &&
    typeof payload.action === "object" &&
    payload.bot &&
    typeof payload.bot === "object"
  );
}

function getKakaoChatbotIntakeConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(props.getProperty("KAKAO_CHATBOT_INTAKE_ENABLED") || "")),
    token: String(props.getProperty("KAKAO_CHATBOT_SKILL_TOKEN") || "").trim(),
    botId: String(props.getProperty("KAKAO_CHATBOT_BOT_ID") || "").trim(),
    photoBlockId: String(props.getProperty("KAKAO_CHATBOT_PHOTO_BLOCK_ID") || "").trim(),
    sessionSeconds: 30 * 60
  };
}

function setupKakaoComplaintIntake() {
  const props = PropertiesService.getScriptProperties();
  let token = String(props.getProperty("KAKAO_CHATBOT_SKILL_TOKEN") || "").trim();
  if (!token) {
    token = [Utilities.getUuid(), Utilities.getUuid()].join("").replace(/-/g, "");
    props.setProperty("KAKAO_CHATBOT_SKILL_TOKEN", token);
  }
  if (!props.getProperty("KAKAO_CHATBOT_INTAKE_ENABLED")) {
    props.setProperty("KAKAO_CHATBOT_INTAKE_ENABLED", "false");
  }
  ensureKakaoIntakeHeaders_(getResponseSheet_());
  ensureKakaoComplaintQueueTrigger_();
  const skillUrl = ownerDecisionWebAppUrl_() + "?kakaoSkillToken=" + encodeURIComponent(token);
  Logger.log("카카오 챗봇 스킬 URL: " + skillUrl);
  Logger.log("챗봇 연결과 테스트를 마친 뒤 KAKAO_CHATBOT_INTAKE_ENABLED=true 로 변경하세요.");
  return {
    ok: true,
    enabled: getKakaoChatbotIntakeConfig_().enabled,
    skillUrl: skillUrl,
    queueTrigger: true
  };
}

function ensureKakaoComplaintQueueTrigger_() {
  const handler = "processPendingKakaoComplaintIntakes";
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (exists) return false;
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
  return true;
}

function handleKakaoChatbotSkill_(payload, event) {
  const config = getKakaoChatbotIntakeConfig_();
  const suppliedToken = String(event && event.parameter && event.parameter.kakaoSkillToken || "").trim();
  if (!config.token || suppliedToken !== config.token) {
    return kakaoChatbotTextResponse_(
      "브링케어 연결 인증에 실패했습니다. 채널 관리자에게 문의해 주세요."
    );
  }
  if (!config.enabled) {
    return kakaoChatbotTextResponse_(
      [
        "브링케어 카카오 민원 접수를 준비 중입니다.",
        "현재는 기존 민원 접수 폼을 이용해 주세요.",
        "",
        "https://docs.google.com/forms/d/e/1FAIpQLSfzi-H-abXT-dgsU5rF8vgkWuKtbltr9acgWClVeQ5W297DiA/viewform"
      ].join("\n")
    );
  }
  if (String(payload.action && payload.action.name || "") === "__bringcare_keepalive__") {
    return kakaoChatbotTextResponse_("ok");
  }

  const request = payload.userRequest || {};
  const user = request.user || {};
  const userKey = String(user.id || user.properties && (user.properties.botUserKey || user.properties.plusfriendUserKey) || "").trim();
  if (!userKey) {
    return kakaoChatbotTextResponse_("카카오 사용자 정보를 확인하지 못했습니다. 채팅방을 다시 열어 주세요.");
  }
  if (config.botId && String(payload.bot && payload.bot.id || "") !== config.botId) {
    return kakaoChatbotTextResponse_("등록되지 않은 브링케어 챗봇 요청입니다.");
  }

  const userHash = kakaoChatbotUserHash_(userKey);
  const utterance = kakaoChatbotCleanText_(request.utterance, 1000);
  const command = normalizeText_(utterance).replace(/^[^0-9a-z가-힣]+/i, "");

  if (/^(취소|접수취소|민원취소)$/.test(command)) {
    kakaoChatbotDeleteSession_(userHash);
    return kakaoChatbotTextResponse_(
      "민원 접수를 취소했습니다.",
      kakaoChatbotHomeQuickReplies_()
    );
  }
  if (/^(내민원조회|민원조회|접수조회|진행상황)$/.test(command)) {
    return kakaoChatbotCaseStatusResponse_(userHash);
  }
  if (/^(상담|상담신청|상담연결|상담원연결|직원상담)$/.test(command)) {
    return kakaoChatbotConsultationResponse_();
  }
  if (/^(민원접수|민원접수시작|접수시작|새민원)$/.test(command)) {
    const freshSession = {
      step: "building",
      values: { name: "세입자" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    kakaoChatbotWriteSession_(userHash, freshSession, config.sessionSeconds);
    return kakaoChatbotPromptResponse_("building", config);
  }

  let session = kakaoChatbotReadSession_(userHash);
  if (!session) {
    return kakaoChatbotTextResponse_(
      "안녕하세요. 브링케어입니다.\n카카오톡에서 민원을 접수하고 기존 계약 건물의 케이스로 연결할 수 있습니다.",
      kakaoChatbotHomeQuickReplies_()
    );
  }
  if (session.completedTicketNo) {
    return kakaoChatbotTextResponse_(
      "최근 접수번호는 " + session.completedTicketNo + "입니다.",
      kakaoChatbotHomeQuickReplies_()
    );
  }

  if (/^(건물명다시입력|건물다시입력)$/.test(command)) {
    session.step = "building";
    session.values = Object.assign({}, session.values || {}, { name: "세입자" });
    delete session.values.building;
    delete session.values.address;
    session.updatedAt = new Date().toISOString();
    kakaoChatbotWriteSession_(userHash, session, config.sessionSeconds);
    return kakaoChatbotPromptResponse_("building", config);
  }
  if (/^(주소다시입력|주소재입력)$/.test(command)) {
    session.step = "address";
    session.values = Object.assign({}, session.values || {}, { name: "세입자" });
    delete session.values.address;
    session.updatedAt = new Date().toISOString();
    kakaoChatbotWriteSession_(userHash, session, config.sessionSeconds);
    return kakaoChatbotPromptResponse_("address", config);
  }

  const step = String(session.step || "building");
  if (step === "photo") {
    const photoUrls = kakaoChatbotExtractPhotoUrls_(payload);
    const skipPhoto = /^(사진없이접수|사진건너뛰기|사진생략|건너뛰기)$/.test(command);
    if (!photoUrls.length && !skipPhoto) {
      return kakaoChatbotPromptResponse_("photo", config);
    }

    session.values = Object.assign({}, session.values || {});
    if (photoUrls.length) {
      session.values.photoUrls = photoUrls;
      session.values.photoCount = photoUrls.length;
      session.values.photoSkipped = false;
    } else {
      delete session.values.photoUrls;
      delete session.values.photoUrl;
      session.values.photoCount = 0;
      session.values.photoSkipped = true;
    }
    session.step = kakaoChatbotNextStep_(step);
    session.updatedAt = new Date().toISOString();
    kakaoChatbotWriteSession_(userHash, session, config.sessionSeconds);
    return kakaoChatbotPromptResponse_(session.step, config);
  }

  const validation = validateKakaoChatbotAnswer_(step, utterance);
  if (!validation.ok) {
    return kakaoChatbotTextResponse_(
      validation.message,
      kakaoChatbotQuickRepliesForStep_(step, config)
    );
  }

  if (step === "consent") {
    if (!validation.value) {
      kakaoChatbotDeleteSession_(userHash);
      return kakaoChatbotTextResponse_(
        "개인정보 수집·이용에 동의하지 않아 접수를 종료했습니다.",
        kakaoChatbotHomeQuickReplies_()
      );
    }
    try {
      const result = enqueueKakaoComplaintIntake_(session.values || {}, userHash, payload);
      session.completedTicketNo = result.ticketNo;
      session.step = "completed";
      session.updatedAt = new Date().toISOString();
      kakaoChatbotWriteSession_(userHash, session, 6 * 60 * 60);
      return kakaoChatbotTextResponse_(
        [
          "민원이 정상 접수되었습니다.",
          "",
          "접수번호: " + result.ticketNo,
          "건물: " + result.building,
          "호실: " + formatRoomForCase_(result.room),
          "문제 유형: " + result.issueType,
          "",
          "브링케어 케이스와 연결 중이며 보통 1분 이내 처리됩니다."
        ].join("\n"),
        kakaoChatbotHomeQuickReplies_()
      );
    } catch (err) {
      Logger.log("카카오 민원 접수 실패: " + err.message);
      if (err && err.kakaoPhotoRetry) {
        session.step = "photo";
        session.values = Object.assign({}, session.values || {});
        delete session.values.photoUrls;
        delete session.values.photoUrl;
        delete session.values.photoCount;
        session.updatedAt = new Date().toISOString();
        kakaoChatbotWriteSession_(userHash, session, config.sessionSeconds);
        return kakaoChatbotTextResponse_(
          "현장 사진의 보관 시간이 지나 저장하지 못했습니다.\n사진을 다시 등록하거나 '사진 없이 접수'를 선택해 주세요.",
          kakaoChatbotQuickRepliesForStep_("photo", config)
        );
      }
      return kakaoChatbotTextResponse_(
        "접수 처리 중 오류가 발생했습니다. 잠시 후 '동의합니다'를 다시 눌러 주세요."
      );
    }
  }

  session.values = Object.assign({}, session.values || {});
  if (step === "address") {
    const contractCheck = verifyKakaoContractBuilding_(
      session.values.building || "",
      validation.value
    );
    if (!contractCheck.matched) {
      session.step = "address";
      session.values.name = "세입자";
      session.updatedAt = new Date().toISOString();
      kakaoChatbotWriteSession_(userHash, session, config.sessionSeconds);
      return kakaoChatbotTextResponse_(
        [
          "입력한 건물명과 주소로 확인되는 브링케어 계약 건물이 없습니다.",
          "건물명과 주소를 다시 확인해 주세요.",
          "",
          "계약 중인 건물인데 계속 확인되지 않으면 브링케어 관리자에게 문의해 주세요."
        ].join("\n"),
        kakaoChatbotContractMismatchQuickReplies_()
      );
    }
    session.values.contractBuildingId = contractCheck.id || "";
    session.values.contractBuilding = contractCheck.building || session.values.building || "";
    session.values.contractAddress = contractCheck.address || validation.value;
  }
  session.values[step] = validation.value;
  const photoUrl = kakaoChatbotExtractPhotoUrl_(payload);
  if (photoUrl) session.values.photoUrl = photoUrl;
  session.step = kakaoChatbotNextStep_(step);
  session.updatedAt = new Date().toISOString();
  kakaoChatbotWriteSession_(userHash, session, config.sessionSeconds);
  return kakaoChatbotPromptResponse_(session.step, config);
}

function kakaoChatbotTextResponse_(text, quickReplies) {
  const template = {
    outputs: [{ simpleText: { text: String(text || "").slice(0, 1000) } }]
  };
  if (quickReplies && quickReplies.length) {
    template.quickReplies = quickReplies.slice(0, 10);
  }
  return { version: "2.0", template: template };
}

function kakaoChatbotConsultationResponse_() {
  return {
    version: "2.0",
    template: {
      outputs: [{
        basicCard: {
          title: "💬 브링케어 상담 연결",
          description: "궁금한 점을 편하게 말씀해 주세요.\n아래 버튼을 누르면 상담원과 1:1 상담을 시작합니다.",
          buttons: [{
            label: "💬 상담원 연결",
            action: "operator"
          }]
        }
      }],
      quickReplies: kakaoChatbotHomeQuickReplies_()
    }
  };
}

function kakaoChatbotHomeQuickReplies_() {
  return [
    { label: "🛠 민원 접수", action: "message", messageText: "민원 접수" },
    { label: "🔎 내 민원 조회", action: "message", messageText: "내 민원 조회" },
    { label: "💬 상담 연결", action: "message", messageText: "상담 연결" }
  ];
}

function kakaoChatbotQuickRepliesForStep_(step, config) {
  if (step === "issueType") {
    return ["누수", "배관", "전기", "도어락", "보일러", "에어컨", "기타"].map(value => ({
      label: value,
      action: "message",
      messageText: value
    }));
  }
  if (step === "photo") {
    const replies = [];
    const photoBlockId = String(config && config.photoBlockId || "").trim();
    if (photoBlockId) {
      replies.push({
        label: "현장 사진 등록",
        action: "block",
        messageText: "현장 사진 등록",
        blockId: photoBlockId
      });
    }
    replies.push({
      label: "사진 없이 접수",
      action: "message",
      messageText: "사진 없이 접수"
    });
    replies.push({ label: "접수 취소", action: "message", messageText: "접수 취소" });
    return replies;
  }
  if (step === "visitTime") {
    return [
      { label: "일정 협의", action: "message", messageText: "일정 협의" },
      { label: "평일 오전", action: "message", messageText: "평일 오전" },
      { label: "평일 오후", action: "message", messageText: "평일 오후" }
    ];
  }
  if (step === "consent") {
    return [
      { label: "동의합니다", action: "message", messageText: "동의합니다" },
      { label: "동의하지 않습니다", action: "message", messageText: "동의하지 않습니다" }
    ];
  }
  return [{ label: "접수 취소", action: "message", messageText: "접수 취소" }];
}

function kakaoChatbotContractMismatchQuickReplies_() {
  return [
    { label: "주소 다시 입력", action: "message", messageText: "주소 다시 입력" },
    { label: "건물명 다시 입력", action: "message", messageText: "건물명 다시 입력" },
    { label: "접수 취소", action: "message", messageText: "접수 취소" }
  ];
}

function kakaoChatbotPromptResponse_(step, config) {
  const prompts = {
    building: "민원을 접수할 건물명을 입력해 주세요.\n예: 브링타워",
    address: "계약 건물 확인을 위해 건물 주소를 입력해 주세요.\n예: 서울시 강남구 테헤란로 123",
    room: "호실을 입력해 주세요.\n예: 301",
    phone: "접수 안내를 받을 휴대폰 번호를 입력해 주세요.\n예: 010-1234-5678",
    issueType: "문제 유형을 선택하거나 직접 입력해 주세요.",
    description: "현재 증상을 자세히 입력해 주세요.\n언제부터, 어디에서, 어떤 문제가 발생했는지 적어 주세요.",
    photo: [
      "문제가 발생한 현장 사진을 등록해 주세요.",
      "카메라로 바로 촬영하거나 앨범에서 선택할 수 있습니다.",
      "가능하면 전체 모습과 문제 부위를 1~3장 보내 주세요.",
      "",
      "사진이 없으면 '사진 없이 접수'를 선택해 주세요."
    ].join("\n"),
    visitTime: "방문 가능한 날짜와 시간대를 입력해 주세요.\n예: 7월 28일 오후 2시 이후\n정해지지 않았다면 '일정 협의'를 선택해 주세요.",
    consent: [
      "민원 처리와 계약 확인을 위해 입력한 연락처, 주소, 민원 내용을 수집·이용합니다.",
      "수집 정보는 민원 처리 및 업체 연결 목적으로만 사용합니다.",
      "",
      "동의하시겠습니까?"
    ].join("\n")
  };
  return kakaoChatbotTextResponse_(
    prompts[step] || prompts.building,
    kakaoChatbotQuickRepliesForStep_(step, config)
  );
}

function kakaoChatbotNextStep_(step) {
  const steps = ["building", "address", "room", "phone", "issueType", "description", "photo", "visitTime", "consent"];
  const index = steps.indexOf(step);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : "consent";
}

function validateKakaoChatbotAnswer_(step, value) {
  const text = kakaoChatbotCleanText_(value, step === "description" ? 1000 : 240);
  if (!text) return { ok: false, message: "내용을 입력해 주세요." };
  if (step === "building" && text.length < 2) {
    return { ok: false, message: "건물명을 두 글자 이상 입력해 주세요." };
  }
  if (step === "address" && text.length < 5) {
    return { ok: false, message: "계약 건물과 매칭할 수 있도록 주소를 조금 더 자세히 입력해 주세요." };
  }
  if (step === "room" && !/[0-9가-힣A-Za-z]/.test(text)) {
    return { ok: false, message: "호실을 다시 입력해 주세요. 예: 301" };
  }
  if (step === "phone") {
    const phone = normalizePhoneForSms_(text);
    if (!/^01[016789]\d{7,8}$/.test(phone)) {
      return { ok: false, message: "휴대폰 번호를 다시 입력해 주세요. 예: 010-1234-5678" };
    }
    return { ok: true, value: phone };
  }
  if (step === "description" && text.replace(/\s/g, "").length < 5) {
    return { ok: false, message: "증상을 다섯 글자 이상 자세히 입력해 주세요." };
  }
  if (step === "consent") {
    if (/동의하지|비동의|거부/.test(text)) return { ok: true, value: false };
    if (/동의|확인|예|네/.test(text)) return { ok: true, value: true };
    return { ok: false, message: "민원 접수를 계속하려면 '동의합니다'를 선택해 주세요." };
  }
  return { ok: true, value: text };
}

function kakaoChatbotCleanText_(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, Number(maxLength || 500));
}

function kakaoChatbotUserHash_(userKey) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(userKey || ""),
    Utilities.Charset.UTF_8
  );
  return digest.map(value => ("0" + ((value + 256) % 256).toString(16)).slice(-2)).join("");
}

function kakaoChatbotSessionCacheKey_(userHash) {
  return "bringcare:kakao:intake:" + String(userHash || "").slice(0, 64);
}

function kakaoChatbotReadSession_(userHash) {
  const raw = CacheService.getScriptCache().get(kakaoChatbotSessionCacheKey_(userHash));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    kakaoChatbotDeleteSession_(userHash);
    return null;
  }
}

function kakaoChatbotWriteSession_(userHash, session, expirationSeconds) {
  CacheService.getScriptCache().put(
    kakaoChatbotSessionCacheKey_(userHash),
    JSON.stringify(session || {}),
    Math.min(Math.max(Number(expirationSeconds || 1800), 60), 21600)
  );
}

function kakaoChatbotDeleteSession_(userHash) {
  CacheService.getScriptCache().remove(kakaoChatbotSessionCacheKey_(userHash));
}

function kakaoChatbotExtractPhotoUrls_(payload) {
  const action = payload && payload.action || {};
  const params = Object.assign({}, action.params || {});
  const detailParams = Object.assign({}, action.detailParams || {});
  const candidates = [
    params.photoUrl,
    params.photo,
    params.imageUrl,
    params.secureImage,
    params.secureimage,
    detailParams.photoUrl && (detailParams.photoUrl.value || detailParams.photoUrl.origin),
    detailParams.photo && (detailParams.photo.value || detailParams.photo.origin),
    detailParams.imageUrl && (detailParams.imageUrl.value || detailParams.imageUrl.origin),
    detailParams.secureImage && (detailParams.secureImage.value || detailParams.secureImage.origin),
    detailParams.secureimage && (detailParams.secureimage.value || detailParams.secureimage.origin)
  ];
  const urls = [];
  candidates.forEach(candidate => {
    kakaoChatbotPhotoUrlsFromValue_(candidate).forEach(url => {
      if (!urls.includes(url)) urls.push(url);
    });
  });
  return urls.slice(0, 10);
}

function kakaoChatbotPhotoUrlsFromValue_(candidate) {
  if (candidate === null || candidate === undefined) return [];
  if (Array.isArray(candidate)) {
    return candidate.reduce((all, item) => all.concat(kakaoChatbotPhotoUrlsFromValue_(item)), []);
  }
  if (typeof candidate === "object") {
    const nested = candidate.secureUrls || candidate.urls || candidate.url || candidate.value || candidate.origin;
    return kakaoChatbotPhotoUrlsFromValue_(nested);
  }

  const value = String(candidate || "").trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed !== value) return kakaoChatbotPhotoUrlsFromValue_(parsed);
  } catch (err) {
    // The secureimage plugin also returns a List(url) string, so plain-text parsing continues.
  }

  const matches = value.match(/https?:\/\/[^,\s<>\\)]+/gi) || [];
  return matches
    .map(url => url.split("\"")[0].split("'")[0].replace(/[,\]]+$/, "").slice(0, 3000))
    .filter(url => /^https?:\/\//i.test(url));
}

function kakaoChatbotExtractPhotoUrl_(payload) {
  return kakaoChatbotExtractPhotoUrls_(payload)[0] || "";
}

function isTrustedKakaoPhotoUrl_(url) {
  return /^https?:\/\/(?:[A-Za-z0-9-]+\.)*kakaocdn\.net(?::\d+)?\//i.test(String(url || ""));
}

function saveKakaoComplaintPhotosToDrive_(photoUrls, ticketNo) {
  const trustedUrls = (photoUrls || [])
    .map(url => String(url || "").trim())
    .filter(isTrustedKakaoPhotoUrl_)
    .slice(0, 10);
  if (!trustedUrls.length) {
    const error = new Error("카카오 현장 사진 URL이 없거나 허용된 주소가 아닙니다.");
    error.kakaoPhotoRetry = true;
    throw error;
  }

  const responses = UrlFetchApp.fetchAll(trustedUrls.map(url => ({
    url: url,
    method: "get",
    followRedirects: true,
    muteHttpExceptions: true,
    headers: { "User-Agent": "BRING-Care-Kakao-Photo/1.0" }
  })));
  const root = getOrCreateChildFolder_(getQuoteDriveRootFolder_(), "카카오 민원 사진");
  const folder = getOrCreateChildFolder_(root, safeDriveName_(ticketNo));
  const driveUrls = [];
  const fileIds = [];
  const errors = [];

  responses.forEach((response, index) => {
    const status = Number(response.getResponseCode());
    if (status < 200 || status >= 300) {
      errors.push("사진 " + (index + 1) + " HTTP " + status);
      return;
    }
    const blob = response.getBlob();
    const contentType = String(blob.getContentType() || "").toLowerCase();
    if (!/^image\/(jpeg|jpg|png|gif|webp)$/.test(contentType)) {
      errors.push("사진 " + (index + 1) + " 지원하지 않는 형식 " + (contentType || "알 수 없음"));
      return;
    }
    if (blob.getBytes().length > 15 * 1024 * 1024) {
      errors.push("사진 " + (index + 1) + " 15MB 초과");
      return;
    }
    const extensionMap = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp"
    };
    const fileName = safeDriveName_(
      ticketNo + "_현장사진_" + String(index + 1).padStart(2, "0")
    ) + (extensionMap[contentType] || ".jpg");
    const file = folder.createFile(blob.setName(fileName));
    fileIds.push(file.getId());
    driveUrls.push("https://drive.google.com/open?id=" + file.getId());
  });

  if (!fileIds.length) {
    const error = new Error("카카오 현장 사진을 Drive에 저장하지 못했습니다. " + errors.join(" / "));
    error.kakaoPhotoRetry = true;
    throw error;
  }
  return {
    count: fileIds.length,
    fileIds: fileIds,
    driveUrls: driveUrls,
    errors: errors
  };
}

function verifyKakaoContractBuilding_(building, address) {
  let registry = null;
  try {
    registry = firebaseOauthRequest_(
      firebaseCaseSettingsUrl_("paymentBuildings"),
      "get",
      undefined,
      "카카오 계약 건물 목록 조회 실패"
    );
  } catch (err) {
    Logger.log("카카오 계약 건물 Firebase 조회 실패: " + err.message);
  }

  const records = Object.keys(registry || {}).map(key => {
    const item = registry[key] || {};
    return {
      id: String(item.id || item.driveFileId || key),
      building: String(item.building || item.name || "").trim(),
      address: String(item.address || "").trim(),
      text: [item.building || item.name || "", item.address || ""].join(" ")
    };
  }).filter(item => item.id && item.building);

  if (records.length) {
    const ranked = records.map(item => rankDriveOnboardingCandidate_(item, building, address));
    ranked.sort((a, b) => {
      if (a.matchRank !== b.matchRank) return b.matchRank - a.matchRank;
      if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
      return b.addressScore - a.addressScore;
    });
    const winner = ranked[0];
    return {
      matched: isPlausibleOnboardingCandidate_(winner, building, address),
      id: winner.id || "",
      building: winner.building || "",
      address: winner.address || "",
      matchScore: winner.matchScore || 0
    };
  }

  const driveMatch = matchDriveOnboardingFile_({
    "건물명": building,
    "건물 주소": address
  });
  return {
    matched: driveMatch && driveMatch.status === "matched",
    id: driveMatch && driveMatch.driveFileId || "",
    building: driveMatch && driveMatch.matchedBuilding || "",
    address: driveMatch && driveMatch.matchedAddress || "",
    matchScore: driveMatch && driveMatch.matchScore || 0
  };
}

function kakaoChatbotCaseStatusResponse_(userHash) {
  try {
    const link = firebaseOauthRequest_(
      firebaseCaseSettingsUrl_("kakaoChatbotIntake/users/" + userHash),
      "get",
      undefined,
      "카카오 민원 연결 조회 실패"
    );
    const caseId = String(link && link.lastCaseId || "").trim();
    if (!caseId) {
      return kakaoChatbotTextResponse_(
        "이 카카오 계정으로 접수한 민원이 없습니다.",
        kakaoChatbotHomeQuickReplies_()
      );
    }
    const casePayload = readCaseFromFirebase_(caseId);
    if (!casePayload) {
      return kakaoChatbotTextResponse_(
        "최근 접수번호는 " + caseId + "이지만 케이스 정보를 확인하지 못했습니다.",
        kakaoChatbotHomeQuickReplies_()
      );
    }
    return kakaoChatbotTextResponse_(
      [
        "최근 민원 진행 상황입니다.",
        "",
        "접수번호: " + (casePayload.ticketNo || caseId),
        "건물: " + (casePayload.building || "확인 중"),
        "호실: " + (casePayload.room || "확인 중"),
        "문제 유형: " + (casePayload.issueType || "확인 중"),
        "현재 상태: " + (casePayload.statusValue || "접수 처리 중")
      ].join("\n"),
      kakaoChatbotHomeQuickReplies_()
    );
  } catch (err) {
    Logger.log("카카오 민원 상태 조회 실패: " + err.message);
    return kakaoChatbotTextResponse_(
      "민원 진행 상황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      kakaoChatbotHomeQuickReplies_()
    );
  }
}

function enqueueKakaoComplaintIntake_(values, userHash, payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) throw new Error("접수 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
  try {
    const sheet = getResponseSheet_();
    const headers = ensureKakaoIntakeHeaders_(sheet);
    const now = new Date();
    const photoUrls = kakaoChatbotExtractPhotoUrls_(payload)
      .concat(Array.isArray(values.photoUrls) ? values.photoUrls : [])
      .concat(values.photoUrl ? [values.photoUrl] : [])
      .filter((url, index, all) => url && all.indexOf(url) === index)
      .slice(0, 10);
    const record = {
      "타임스탬프": now,
      "건물명": kakaoChatbotCleanText_(values.building, 120),
      "건물 주소": kakaoChatbotCleanText_(values.address, 240),
      "호실": kakaoChatbotCleanText_(values.room, 60),
      "이름": kakaoChatbotCleanText_(values.name || "세입자", 80),
      "연락처": normalizePhoneForSms_(values.phone),
      "문제 유형": kakaoChatbotCleanText_(values.issueType, 80),
      "증상 설명": kakaoChatbotCleanText_(values.description, 1000),
      "추가 요청사항": "카카오톡 브링케어 채널 접수",
      "방문 가능 시간": kakaoChatbotCleanText_(values.visitTime, 240),
      "사진 첨부": "",
      "카카오 사진 원본 URL": photoUrls.length ? JSON.stringify(photoUrls) : "",
      "접수 경로": "kakao_chatbot",
      "카카오 사용자 키 해시": userHash,
      "카카오 처리 상태": "대기",
      "카카오 처리 메모": "챗봇 접수 후 자동 처리 대기"
    };
    const headerMap = kakaoComplaintHeaderMap_(headers);
    const row = sheet.getLastRow() + 1;
    const ticketNo = makeTicketNo_(row, record);
    if (photoUrls.length) {
      record["카카오 처리 메모"] =
        "현장 사진 " + photoUrls.length + "장 비동기 저장 대기 / 챗봇 접수 후 자동 처리 대기";
    } else if (values.photoSkipped) {
      record["카카오 처리 메모"] = "사용자가 사진 없이 접수 / 챗봇 접수 후 자동 처리 대기";
    }
    record["접수번호"] = ticketNo;
    const rowValues = headers.map(header => Object.prototype.hasOwnProperty.call(record, header) ? record[header] : "");
    if (headerMap["연락처"]) {
      sheet.getRange(row, headerMap["연락처"]).setNumberFormat("@");
    }
    sheet.getRange(row, 1, 1, headers.length).setValues([rowValues]);

    const pendingCase = makeKakaoPendingCase_(ticketNo, record, row, sheet);
    writeKakaoPendingCaseLink_(ticketNo, pendingCase, userHash, now);
    return {
      ok: true,
      ticketNo: ticketNo,
      building: record["건물명"],
      room: record["호실"],
      issueType: record["문제 유형"],
      photoCount: photoUrls.length,
      row: row
    };
  } finally {
    lock.releaseLock();
  }
}

function writeKakaoPendingCaseLink_(ticketNo, pendingCase, userHash, now) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const casesPath = COMPLAINT_CONFIG.FIREBASE_CASES_PATH.replace(/^\/|\/$/g, "");
  const updates = {};
  updates[casesPath + "/" + ticketNo] = pendingCase;
  const caseSettingsPath = String(COMPLAINT_CONFIG.FIREBASE_CASE_SETTINGS_PATH || "caseSettings").replace(/^\/|\/$/g, "");
  updates[caseSettingsPath + "/kakaoChatbotIntake/users/" + userHash] = {
    lastCaseId: ticketNo,
    updatedAt: now.toISOString()
  };
  return firebaseWriteRequest_(
    base + "/.json",
    "patch",
    updates,
    "카카오 접수 대기 케이스와 사용자 연결 저장 실패"
  );
}

function ensureKakaoIntakeHeaders_(sheet) {
  let headers = ensureOutputHeaders_(sheet);
  KAKAO_INTAKE_INPUT_HEADERS.forEach(header => {
    if (!headers.includes(header)) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });
  OUTPUT_HEADERS.forEach(header => {
    if (!headers.includes(header)) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });
  return headers;
}

function kakaoComplaintHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach((header, index) => {
    if (header) map[header] = index + 1;
  });
  return map;
}

function makeKakaoPendingCase_(ticketNo, record, row, sheet) {
  const photoFileIds = extractDriveFileIdsFromText_(record["사진 첨부"] || "");
  const queuedPhotoCount = kakaoChatbotPhotoUrlsFromValue_(
    record["카카오 사진 원본 URL"] || ""
  ).length;
  return {
    id: ticketNo,
    ticketNo: ticketNo,
    source: "kakao_chatbot",
    createdAt: new Date().toISOString(),
    receivedAt: dateFromValue_(record["타임스탬프"]).toISOString(),
    sheetUrl: COMPLAINT_CONFIG.RESPONSE_SHEET_URL + "#gid=" + sheet.getSheetId(),
    sheetRow: row,
    name: maskName_(record["이름"]) || "세입자",
    phone: maskPhone_(record["연락처"]),
    email: "",
    building: record["건물명"],
    address: record["건물 주소"],
    room: formatRoomForCase_(record["호실"]),
    issueType: record["문제 유형"],
    summary: [record["건물명"], formatRoomForCase_(record["호실"]), record["문제 유형"]].filter(Boolean).join(" / "),
    visitTime: record["방문 가능 시간"],
    photos: photoFileIds.map((fileId, index) => ({
      id: fileId,
      name: "현장 사진 " + (index + 1),
      driveUrl: "https://drive.google.com/open?id=" + fileId
    })),
    photoCount: photoFileIds.length || queuedPhotoCount,
    statusValue: "접수처리중",
    status: { c1: "doing" },
    kakao: {
      userKeyHash: record["카카오 사용자 키 해시"],
      linkedAt: new Date().toISOString()
    },
    note: {
      c1: "카카오톡 브링케어 채널에서 접수되었습니다. 계약 건물 매칭과 자동 분석을 진행 중입니다."
    },
    log: [
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + " 카카오톡 민원 접수",
      "자동 분석 대기"
    ]
  };
}

function saveQueuedKakaoComplaintPhotos_(sheet, row, headerMap, record) {
  const queuedPhotoValue = readField_(record, ["카카오 사진 원본 URL"]);
  if (!queuedPhotoValue) {
    return { count: 0, fileIds: [], driveUrls: [], errors: [] };
  }

  const photoUrls = kakaoChatbotPhotoUrlsFromValue_(queuedPhotoValue)
    .filter((url, index, all) => url && all.indexOf(url) === index)
    .slice(0, 10);
  const ticketNo = readField_(record, ["접수번호"]);
  const savedPhotos = saveKakaoComplaintPhotosToDrive_(photoUrls, ticketNo);
  const driveUrlText = savedPhotos.driveUrls.join("\n");

  setCellByHeader_(sheet, row, headerMap, "사진 첨부", driveUrlText);
  setCellByHeader_(sheet, row, headerMap, "카카오 사진 원본 URL", "");
  record["사진 첨부"] = driveUrlText;
  record["카카오 사진 원본 URL"] = "";
  return savedPhotos;
}

function processPendingKakaoComplaintIntakes() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const sheet = getResponseSheet_();
    const headers = ensureKakaoIntakeHeaders_(sheet);
    const headerMap = kakaoComplaintHeaderMap_(headers);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const firstRow = Math.max(2, lastRow - 49);
    const rows = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, headers.length).getValues();
    let processed = 0;
    for (let index = 0; index < rows.length && processed < 5; index++) {
      const row = firstRow + index;
      const record = recordFromRow_(headers, rows[index]);
      if (readField_(record, ["접수 경로"]) !== "kakao_chatbot") continue;
      const queueStatus = readField_(record, ["카카오 처리 상태"]);
      const analyzedAt = readField_(record, ["분석 처리일시"]);
      if (queueStatus === "완료" || analyzedAt) continue;
      setCellByHeader_(sheet, row, headerMap, "카카오 처리 상태", "처리중");
      setCellByHeader_(sheet, row, headerMap, "카카오 처리 메모", "자동 분석 및 계약 매칭 진행 중");
      SpreadsheetApp.flush();
      try {
        const savedPhotos = saveQueuedKakaoComplaintPhotos_(sheet, row, headerMap, record);
        if (savedPhotos.count) {
          setCellByHeader_(
            sheet,
            row,
            headerMap,
            "카카오 처리 메모",
            "현장 사진 " + savedPhotos.count + "장 저장 완료 / 자동 분석 및 계약 매칭 진행 중"
          );
          SpreadsheetApp.flush();
        }
        processResponseRow_(sheet, row);
        setCellByHeader_(sheet, row, headerMap, "카카오 처리 상태", "완료");
        setCellByHeader_(
          sheet,
          row,
          headerMap,
          "카카오 처리 메모",
          Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss") +
            " 케이스 연결 완료" +
            (savedPhotos.count ? " / 현장 사진 " + savedPhotos.count + "장 저장" : "")
        );
      } catch (err) {
        setCellByHeader_(sheet, row, headerMap, "카카오 처리 상태", "오류");
        setCellByHeader_(sheet, row, headerMap, "카카오 처리 메모", String(err.message || err).slice(0, 500));
        Logger.log("카카오 민원 대기열 처리 실패 " + row + "행: " + err.message);
      }
      processed++;
    }
  } finally {
    lock.releaseLock();
  }
}

function ownerDecisionWebAppUrl_() {
  const configured = String(COMPLAINT_CONFIG.WEB_APP_URL || "").trim();
  if (configured) return configured;
  return String(ScriptApp.getService().getUrl() || "").trim();
}

function ensureOwnerDecisionShortLink_(caseId, state) {
  const current = Object.assign({}, state || {});
  const shortCode = String(caseId || "").trim().replace(/^BR-/i, "");
  if (!/^\d{4}-\d{4,}$/.test(shortCode)) {
    throw new Error("승인 짧은 링크용 접수번호가 올바르지 않습니다.");
  }
  const shortDecisionUrl = String(current.decisionUrl || "").trim();
  if (!shortDecisionUrl) {
    throw new Error("Secure owner decision URL is missing.");
  }
  const now = new Date().toISOString();
  return Object.assign({}, current, {
    shortCode: shortCode,
    shortDecisionUrl: shortDecisionUrl,
    shortLinkUpdatedAt: now
  });
}

function ensureOwnerDecisionLink_(caseId, casePayload, quoteId, supplier, amounts) {
  const existing = casePayload && casePayload.ownerDecision || {};
  if (
    existing.status === "pending" &&
    existing.token &&
    existing.decisionUrl &&
    String(existing.quoteId || "") === String(quoteId || "")
  ) {
    const linkedExisting = ensureOwnerDecisionShortLink_(caseId, existing);
    putCaseChildToFirebase_(caseId, "ownerDecision", linkedExisting);
    casePayload.ownerDecision = linkedExisting;
    return linkedExisting;
  }

  const baseUrl = ownerDecisionWebAppUrl_();
  if (!baseUrl) throw new Error("Apps Script 웹 앱 URL을 확인하지 못했습니다.");
  const now = new Date().toISOString();
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const decisionUrl = baseUrl +
    "?view=" + encodeURIComponent(OWNER_DECISION_VIEW) +
    "&caseId=" + encodeURIComponent(caseId) +
    "&token=" + encodeURIComponent(token);
  let state = {
    status: "pending",
    statusText: "건물주 응답 대기",
    token: token,
    decisionUrl: decisionUrl,
    quoteId: String(quoteId || ""),
    vendorName: String(supplier && supplier.name || ""),
    bringTotalAmount: Number(amounts && amounts.totalAmount || 0),
    createdAt: now,
    updatedAt: now
  };
  state = ensureOwnerDecisionShortLink_(caseId, state);
  putCaseChildToFirebase_(caseId, "ownerDecision", state);
  casePayload.ownerDecision = state;
  return state;
}

function ownerDecisionUrlParameter_(url, name) {
  const match = String(url || "").match(new RegExp("[?&]" + name + "=([^&#]*)"));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch (err) {
    return "";
  }
}

function validateOwnerDecisionLink_(decisionUrl, caseId, token) {
  const url = String(decisionUrl || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\?/i.test(url)) {
    return { ok: false, statusCode: 0, message: "승인 링크 형식이 올바르지 않습니다." };
  }
  const urlView = ownerDecisionUrlParameter_(url, "view");
  const urlCaseId = ownerDecisionUrlParameter_(url, "caseId");
  const urlToken = ownerDecisionUrlParameter_(url, "token");
  if (
    urlView !== OWNER_DECISION_VIEW ||
    urlCaseId !== String(caseId || "") ||
    urlToken !== String(token || "")
  ) {
    return { ok: false, statusCode: 0, message: "승인 링크의 케이스 또는 보안 토큰이 일치하지 않습니다." };
  }
  try {
    const latestCase = readCaseFromFirebase_(caseId);
    const latestDecision = latestCase && latestCase.ownerDecision || {};
    const stateValid = !!(
      latestCase &&
      latestDecision.token &&
      String(latestDecision.token) === String(token || "") &&
      String(latestDecision.decisionUrl || "") === url
    );
    const rendered = stateValid
      ? String(renderOwnerDecisionPage_({ caseId: caseId, token: token }).getContent() || "")
      : "";
    const renderedValid = rendered.indexOf('data-owner-decision-valid="1"') >= 0;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true
    });
    const statusCode = Number(response.getResponseCode() || 0);
    const body = String(response.getContentText() || "");
    // Apps Script 웹앱을 서버에서 다시 호출하면 Google 래퍼 HTML이 반환될 수
    // 있으므로 본문 마커만으로 실패 처리하지 않는다. 저장된 토큰과 직접 렌더한
    // 승인 화면을 우선 검증하고, 외부 URL이 오류 응답이나 명시적 무효 화면이
    // 아닌지 함께 확인한다.
    const explicitInvalid = body.indexOf('data-owner-decision-valid="0"') >= 0 ||
      body.indexOf("유효하지 않거나 만료된 링크") >= 0;
    const validPage = stateValid && renderedValid && !explicitInvalid;
    return {
      ok: statusCode >= 200 && statusCode < 400 && validPage,
      statusCode: statusCode,
      message: validPage
        ? "승인 링크 열림 확인 완료"
        : "승인 링크가 유효한 승인 화면을 반환하지 않았습니다."
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 0,
      message: "승인 링크 열림 확인 실패: " + err.message
    };
  }
}

function prepareOwnerDecisionLinkForCase_(caseId, casePayload, quoteId, quote) {
  const supplier = ownerRecommendationSupplier_(quote);
  const amounts = ownerRecommendationAmounts_(quote);
  let state = ensureOwnerDecisionLink_(caseId, casePayload, quoteId, supplier, amounts);
  if (
    state.linkValidated === true &&
    state.linkValidatedAt &&
    String(state.quoteId || "") === String(quoteId || "") &&
    state.decisionUrl
  ) {
    return { ok: true, state: state, supplier: supplier, amounts: amounts, reused: true };
  }

  const validation = validateOwnerDecisionLink_(state.decisionUrl, caseId, state.token);
  state = Object.assign({}, state, {
    linkValidated: validation.ok === true,
    linkStatus: validation.ok ? "ready" : "failed",
    linkStatusText: validation.message || "",
    linkStatusCode: validation.statusCode || 0,
    linkValidatedAt: validation.ok ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString()
  });
  putCaseChildToFirebase_(caseId, "ownerDecision", state);
  casePayload.ownerDecision = state;
  return {
    ok: validation.ok === true,
    state: state,
    supplier: supplier,
    amounts: amounts,
    message: validation.message || ""
  };
}

function handleEnsureOwnerDecisionLink_(payload) {
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };
  const selected = selectOwnerRecommendationQuote_(casePayload, payload && payload.quoteId);
  if (!selected.quote) return { ok: false, message: "승인 링크에 연결할 추천 견적이 없습니다." };

  const prepared = prepareOwnerDecisionLinkForCase_(caseId, casePayload, selected.quoteId, selected.quote);
  const response = {
    ok: prepared.ok === true,
    caseId: caseId,
    quoteId: selected.quoteId,
    decisionUrl: prepared.state && prepared.state.decisionUrl || "",
    shortDecisionUrl: prepared.state && prepared.state.shortDecisionUrl || "",
    decisionStatus: prepared.state && prepared.state.status || "",
    linkValidated: prepared.state && prepared.state.linkValidated === true,
    linkStatusText: prepared.state && prepared.state.linkStatusText || prepared.message || "",
    reused: prepared.reused === true
  };
  const workflow = advanceCaseWorkflow_(caseId, {
    source: "owner_decision_link",
    skipOwnerAutoSend: prepared.ok !== true
  });
  response.workflow = workflow;
  return response;
}

function appendOwnerDecisionLink_(message, decisionUrl) {
  const content = String(message || "").trim();
  const url = String(decisionUrl || "").trim();
  if (!url || content.indexOf(url) >= 0) return content;
  const guide = [
    "추천 견적으로 진행을 원하시면 아래 링크에서",
    "'승인하고 입금 진행' 버튼을 눌러주세요."
  ].join("\n");
  const lines = [content];
  if (content.indexOf("승인하고 입금 진행") < 0) lines.push("", guide);
  lines.push("", "승인 링크:", url);
  return lines.join("\n");
}

function ownerDecisionEscapeHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ownerDecisionStatusText_(status) {
  if (status === "approved_payment") return "승인하고 입금 진행";
  if (status === "request_other_quote") return "다른 견적 요청";
  return "응답 대기";
}

function ownerDecisionPaymentHtml_(amount) {
  return [
    "<section class=\"payment\">",
    "<div class=\"payment-head\"><span>입금 계좌</span><b>승인 완료</b></div>",
    "<p>아래 계좌로 입금을 진행해 주세요.</p>",
    "<dl><div><dt>계좌번호</dt><dd id=\"accountNumber\">" +
      ownerDecisionEscapeHtml_(OWNER_PAYMENT_ACCOUNT.accountNumber) +
      "</dd></div><div><dt>예금주</dt><dd>" +
      ownerDecisionEscapeHtml_(OWNER_PAYMENT_ACCOUNT.accountHolder) +
      "</dd></div><div><dt>입금금액</dt><dd>" +
      ownerDecisionEscapeHtml_(ownerRecommendationAmountText_(amount)) +
      "</dd></div></dl>",
    "<button type=\"button\" class=\"copy\" onclick=\"copyAccountNumber()\">계좌번호 복사</button>",
    "</section>"
  ].join("");
}

function renderOwnerDecisionPage_(params) {
  const caseId = String(params && params.caseId || "").trim();
  const token = String(params && params.token || "").trim();
  const casePayload = caseId ? readCaseFromFirebase_(caseId) : null;
  const state = casePayload && casePayload.ownerDecision || {};
  const valid = !!(casePayload && token && state.token && token === String(state.token));
  const selected = valid ? selectOwnerRecommendationQuote_(casePayload, state.quoteId) : { quoteId: "", quote: null };
  const supplier = selected.quote ? ownerRecommendationSupplier_(selected.quote) : { name: state.vendorName || "" };
  const amounts = selected.quote ? ownerRecommendationAmounts_(selected.quote) : { totalAmount: Number(state.bringTotalAmount || 0) };
  const workLines = selected.quote ? ownerRecommendationWorkLines_(selected.quote) : [];
  const decided = valid && state.status && state.status !== "pending";
  const title = valid ? "추천 견적 승인" : "링크 확인 필요";
  const description = valid
    ? "추천 내용을 확인하고 아래 두 항목 중 하나를 선택해 주세요."
    : "유효하지 않거나 만료된 링크입니다. BRING Care 담당자에게 문의해 주세요.";
  const workHtml = workLines.length
    ? workLines.slice(0, 4).map(line => "<li>" + ownerDecisionEscapeHtml_(line) + "</li>").join("")
    : "<li>견적서의 작업 내용을 확인해 주세요.</li>";
  const statusHtml = decided
    ? "<div class=\"result " + (state.status === "approved_payment" ? "approved" : "other") + "\">" +
      "<strong>" + ownerDecisionEscapeHtml_(ownerDecisionStatusText_(state.status)) + "</strong>" +
      "<span>응답이 정상적으로 접수되었습니다.</span></div>" +
      (state.status === "approved_payment" ? ownerDecisionPaymentHtml_(amounts.totalAmount) : "")
    : "";
  const buttons = valid && !decided
    ? "<div class=\"actions\"><button class=\"approve\" onclick=\"submitDecision('approve_payment')\">승인하고 입금 진행</button>" +
      "<button class=\"other\" onclick=\"submitDecision('request_other_quote')\">다른 견적 요청</button></div>"
    : "";
  const caseIdJs = JSON.stringify(caseId).replace(/</g, "\\u003c");
  const tokenJs = JSON.stringify(token).replace(/</g, "\\u003c");
  const paymentHtmlJs = JSON.stringify(ownerDecisionPaymentHtml_(amounts.totalAmount)).replace(/</g, "\\u003c");
  const accountNumberJs = JSON.stringify(OWNER_PAYMENT_ACCOUNT.accountNumber).replace(/</g, "\\u003c");
  const html = [
    "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
    "<title>BRING Care 추천 견적 승인</title>",
    "<style>",
    "*{box-sizing:border-box}html{background:#eef3f9}body{margin:0;color:#162033;font-family:Arial,'Noto Sans KR',sans-serif;-webkit-font-smoothing:antialiased}",
    ".page{width:100%;max-width:480px;min-height:100dvh;margin:0 auto;padding:max(22px,env(safe-area-inset-top)) 16px max(32px,env(safe-area-inset-bottom))}",
    ".brand{display:flex;align-items:center;gap:9px;font-weight:900;color:#173a70;font-size:18px;margin:2px 2px 18px}.brand:before{content:'';width:12px;height:12px;border-radius:50%;background:#2f80ed;box-shadow:8px 0 0 #28b779}",
    ".card{background:#fff;border:1px solid #dbe3ef;border-radius:8px;padding:24px 18px;box-shadow:0 10px 28px rgba(31,57,91,.09)}",
    "h1{font-size:25px;line-height:1.3;margin:0 0 8px;letter-spacing:0}p{font-size:14px;line-height:1.6;color:#667085;margin:0 0 20px}",
    ".amount{background:#eaf2ff;border:1px solid #b8cff2;border-radius:8px;padding:20px 18px;margin:0 0 18px}",
    ".amount span{display:block;font-size:13px;font-weight:700;color:#52606f;margin-bottom:6px}.amount strong{display:block;font-size:34px;line-height:1.15;color:#123568;letter-spacing:0;word-break:keep-all}",
    ".info{display:grid;grid-template-columns:88px minmax(0,1fr);gap:12px;padding:16px 0;border-top:1px solid #e7edf5}",
    ".info b{font-size:13px;color:#667085}.info span{font-size:15px;font-weight:800;line-height:1.45;word-break:keep-all;overflow-wrap:anywhere}",
    ".work{border-top:1px solid #e7edf5;padding-top:16px}.work b{font-size:14px}.work ul{margin:10px 0 0;padding-left:20px}.work li{font-size:15px;line-height:1.55;margin:5px 0;word-break:keep-all}",
    ".actions{display:grid;gap:10px;margin-top:24px}.actions button{width:100%;min-height:56px;border-radius:8px;font-size:16px;font-weight:900;cursor:pointer;touch-action:manipulation}",
    ".approve{border:1px solid #173a70;background:#173a70;color:#fff}.other{border:1px solid #aebbc9;background:#fff;color:#27364a}",
    ".actions button:disabled{opacity:.55;cursor:wait}.result{display:flex;flex-direction:column;gap:6px;margin-top:22px;padding:18px;border-radius:8px}",
    ".result.approved{background:#eaf8ef;border:1px solid #9cd9b0;color:#116329}.result.other{background:#fff7e8;border:1px solid #f1c879;color:#8a5300}",
    ".result strong{font-size:18px}.result span{font-size:14px}.message{margin-top:14px;font-size:13px;color:#667085;text-align:center}",
    ".payment{margin-top:14px;padding:18px;background:#f7f9fc;border:1px solid #dbe3ef;border-radius:8px}.payment-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.payment-head span{font-size:18px;font-weight:900}.payment-head b{font-size:12px;color:#116329;background:#dcf7e6;border:1px solid #a9dfba;border-radius:999px;padding:5px 8px}.payment>p{margin:8px 0 14px}.payment dl{margin:0}.payment dl div{display:grid;grid-template-columns:82px 1fr;gap:10px;padding:11px 0;border-top:1px solid #e1e7ef}.payment dt{font-size:13px;color:#667085}.payment dd{margin:0;font-size:16px;font-weight:900;word-break:break-all}.copy{width:100%;min-height:48px;margin-top:14px;border:1px solid #173a70;background:#fff;color:#173a70;border-radius:8px;font-size:15px;font-weight:900}",
    "@media(max-width:360px){.page{padding-left:10px;padding-right:10px}.card{padding:20px 14px}.amount strong{font-size:30px}}",
    "</style></head><body data-owner-decision-valid=\"" + (valid ? "1" : "0") + "\"><main class=\"page\"><div class=\"brand\">BRING Care</div><section class=\"card\">",
    "<h1>" + ownerDecisionEscapeHtml_(title) + "</h1><p>" + ownerDecisionEscapeHtml_(description) + "</p>",
    valid ? "<div class=\"amount\"><span>추천 최종금액</span><strong>" + ownerDecisionEscapeHtml_(ownerRecommendationAmountText_(amounts.totalAmount)) + "</strong></div>" : "",
    valid ? "<div class=\"info\"><b>추천 업체</b><span>" + ownerDecisionEscapeHtml_(supplier.name || "업체 확인 필요") + "</span><b>접수번호</b><span>" + ownerDecisionEscapeHtml_(casePayload.ticketNo || caseId) + "</span></div>" : "",
    valid ? "<div class=\"work\"><b>주요 작업</b><ul>" + workHtml + "</ul></div>" : "",
    "<div id=\"result\">" + statusHtml + "</div>" + buttons + "<div class=\"message\" id=\"message\"></div>",
    "</section></main><script>",
    "var CASE_ID=" + caseIdJs + ";var TOKEN=" + tokenJs + ";var PAYMENT_HTML=" + paymentHtmlJs + ";var ACCOUNT_NUMBER=" + accountNumberJs + ";var running=false;",
    "function copyAccountNumber(){var value=ACCOUNT_NUMBER.replace(/[^0-9]/g,'');if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(function(){var b=document.querySelector('.copy');if(b){b.textContent='복사 완료';setTimeout(function(){b.textContent='계좌번호 복사'},1400)}});return;}var t=document.createElement('textarea');t.value=value;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}",
    "function submitDecision(decision){if(running)return;running=true;var buttons=document.querySelectorAll('button');buttons.forEach(function(b){b.disabled=true});",
    "document.getElementById('message').textContent='응답을 저장하고 있습니다...';",
    "google.script.run.withSuccessHandler(function(result){running=false;if(!result||!result.ok){document.getElementById('message').textContent=result&&result.message||'응답 저장에 실패했습니다.';buttons.forEach(function(b){b.disabled=false});return;}",
    "document.getElementById('message').textContent='';document.querySelector('.actions').remove();var cls=decision==='approve_payment'?'approved':'other';",
    "var label=decision==='approve_payment'?'승인하고 입금 진행':'다른 견적 요청';document.getElementById('result').innerHTML='<div class=\"result '+cls+'\"><strong>'+label+'</strong><span>응답이 정상적으로 접수되었습니다.</span></div>'+(decision==='approve_payment'?PAYMENT_HTML:'');",
    "}).withFailureHandler(function(err){running=false;document.getElementById('message').textContent=err&&err.message||'응답 저장에 실패했습니다.';buttons.forEach(function(b){b.disabled=false});}).submitOwnerDecision(CASE_ID,TOKEN,decision);}",
    "</script></body></html>"
  ].join("");
  return HtmlService.createHtmlOutput(html).setTitle("BRING Care 추천 견적 승인");
}

function submitOwnerDecision(caseId, token, decision) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: "다른 응답을 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  try {
    return submitOwnerDecisionLocked_(caseId, token, decision);
  } finally {
    lock.releaseLock();
  }
}

function submitOwnerDecisionLocked_(caseId, token, decision) {
  caseId = String(caseId || "").trim();
  token = String(token || "").trim();
  decision = String(decision || "").trim();
  if (!caseId || !token) return { ok: false, message: "승인 링크 정보가 없습니다." };
  if (decision !== "approve_payment" && decision !== "request_other_quote") {
    return { ok: false, message: "지원하지 않는 응답입니다." };
  }
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "케이스를 찾지 못했습니다." };
  const current = Object.assign({}, casePayload.ownerDecision || {});
  if (!current.token || current.token !== token) return { ok: false, message: "유효하지 않거나 만료된 승인 링크입니다." };
  if (current.status && current.status !== "pending") {
    return current.status === (decision === "approve_payment" ? "approved_payment" : "request_other_quote")
      ? {
        ok: true,
        skipped: true,
        status: current.status,
        payment: current.status === "approved_payment" ? Object.assign({}, OWNER_PAYMENT_ACCOUNT) : null
      }
      : { ok: false, message: "이미 다른 응답이 접수된 링크입니다." };
  }

  const now = new Date().toISOString();
  const resolved = Object.assign({}, current, {
    status: decision === "approve_payment" ? "approved_payment" : "request_other_quote",
    statusText: decision === "approve_payment" ? "승인하고 입금 진행" : "다른 견적 요청",
    decidedAt: now,
    updatedAt: now
  });
  putCaseChildToFirebase_(caseId, "ownerDecision", resolved);

  if (decision === "approve_payment") {
    const automationState = Object.assign({}, casePayload.automationState || {});
    workflowStepState_(automationState, "c9", "done", now, { decision: decision, source: "owner_mobile_link" });
    workflowStepState_(automationState, "c10", "doing", now, { mode: "payment_confirmation" });
    const log = Array.isArray(casePayload.log) ? casePayload.log.slice() : [];
    log.unshift("건물주 승인 완료 · 입금 진행");
    if (log.length > 30) log.length = 30;
    patchCaseChildToFirebase_(caseId, "status", { c9: "done", c10: "doing" });
    patchCaseChildToFirebase_(caseId, "note", {
      c9: "건물주가 추천 견적을 승인하고 입금 진행을 선택했습니다.",
      c10: "건물주 승인 완료 · 입금 확인 대기 중"
    });
    patchCaseToFirebase_(caseId, {
      automationState: automationState,
      paymentStatus: "awaiting_payment",
      paymentAccount: Object.assign({}, OWNER_PAYMENT_ACCOUNT),
      paymentExpectedAmount: Number(current.bringTotalAmount || 0),
      log: log,
      updatedAt: now
    });
    return {
      ok: true,
      status: resolved.status,
      nextStep: "c10",
      payment: Object.assign({}, OWNER_PAYMENT_ACCOUNT)
    };
  }

  reopenCaseForAnotherQuote_(caseId, casePayload, resolved, now);
  return { ok: true, status: resolved.status, nextStep: "c5" };
}

function handleConfirmCasePayment_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: "다른 입금 확인을 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  try {
    return confirmCasePaymentLocked_(
      payload && payload.caseId,
      payload && payload.adminEmail,
      payload && payload.adminUid
    );
  } finally {
    lock.releaseLock();
  }
}

function confirmCasePaymentLocked_(caseId, adminEmail, adminUid) {
  caseId = String(caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "케이스를 찾지 못했습니다." };
  const status = Object.assign({}, casePayload.status || {});
  const ownerDecision = Object.assign({}, casePayload.ownerDecision || {});
  if (status.c10 === "done" && String(casePayload.paymentStatus || "") === "confirmed") {
    return {
      ok: true,
      skipped: true,
      status: "confirmed",
      nextStep: "c11",
      confirmedAt: casePayload.paymentConfirmedAt || ""
    };
  }
  if (status.c9 !== "done" || ownerDecision.status !== "approved_payment") {
    return { ok: false, message: "건물주 승인 완료 후 입금을 확인할 수 있습니다." };
  }

  const now = new Date().toISOString();
  const automationState = Object.assign({}, casePayload.automationState || {});
  workflowStepState_(automationState, "c10", "done", now, {
    mode: "manual_admin_confirmation",
    confirmedBy: String(adminEmail || adminUid || "관리자")
  });
  workflowStepState_(automationState, "c11", "doing", now, { mode: "vendor_schedule" });

  const priced = workflowPricedQuote_(casePayload);
  const amounts = priced ? ownerRecommendationAmounts_(priced.quote) : { totalAmount: Number(casePayload.paymentExpectedAmount || ownerDecision.bringTotalAmount || 0) };
  const confirmation = {
    status: "confirmed",
    statusText: "관리자 입금 확인 완료",
    amount: Number(amounts.totalAmount || 0),
    accountNumber: String(casePayload.paymentAccount && casePayload.paymentAccount.accountNumber || OWNER_PAYMENT_ACCOUNT.accountNumber),
    accountHolder: String(casePayload.paymentAccount && casePayload.paymentAccount.accountHolder || OWNER_PAYMENT_ACCOUNT.accountHolder),
    confirmedAt: now,
    confirmedBy: String(adminEmail || adminUid || "관리자")
  };
  const log = Array.isArray(casePayload.log) ? casePayload.log.slice() : [];
  log.unshift("관리자 입금 확인 완료 · ⑪ 업체 연결·일정 시작");
  if (log.length > 30) log.length = 30;

  patchCaseChildToFirebase_(caseId, "status", { c10: "done", c11: "doing" });
  patchCaseChildToFirebase_(caseId, "note", {
    c10: "관리자가 실제 사업자계좌 입금 내역을 확인했습니다.",
    c11: "입금 확인 완료 · 업체 연결 및 일정 조율을 진행해 주세요."
  });
  patchCaseToFirebase_(caseId, {
    automationState: automationState,
    paymentStatus: "confirmed",
    paymentConfirmation: confirmation,
    paymentConfirmedAt: now,
    paymentConfirmedBy: confirmation.confirmedBy,
    log: log,
    updatedAt: now
  });
  return {
    ok: true,
    status: "confirmed",
    nextStep: "c11",
    confirmedAt: now,
    amount: confirmation.amount
  };
}

function reopenCaseForAnotherQuote_(caseId, casePayload, ownerDecision, now) {
  const currentRound = Math.max(1, Number(casePayload.quoteRequestRound || 1));
  const roundKey = "round-" + currentRound;
  const roundSnapshot = {
    round: currentRound,
    ownerDecision: ownerDecision,
    vendorSelections: casePayload.vendorSelections || {},
    selectedVendors: casePayload.selectedVendors || [],
    vendorEstimateMms: casePayload.vendorEstimateMms || {},
    quoteFiles: casePayload.quoteFiles || {},
    businessRegistrationFiles: casePayload.businessRegistrationFiles || {},
    recommendation: casePayload.recommendation || {},
    ownerRecommendationMms: casePayload.ownerRecommendationMms || {},
    archivedAt: now
  };
  putCaseChildToFirebase_(caseId, "quoteRequestRounds/" + roundKey, roundSnapshot);

  const automationState = Object.assign({}, casePayload.automationState || {});
  delete automationState.vendorEstimateMms;
  delete automationState.ownerRecommendationMms;
  delete automationState.uploadBatch;
  automationState.workflow = Object.assign({}, automationState.workflow || {});
  ["c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c14", "c15", "c16", "c17"].forEach(key => delete automationState.workflow[key]);
  workflowStepState_(automationState, "c5", "doing", now, { mode: "manual_vendor_selection", reason: "owner_requested_other_quote" });

  const log = Array.isArray(casePayload.log) ? casePayload.log.slice() : [];
  log.unshift("건물주가 다른 견적 요청을 선택했습니다. ⑤ 업체 견적 요청을 다시 시작합니다.");
  if (log.length > 30) log.length = 30;
  const statusPatch = { c5: "doing" };
  const notePatch = { c5: "건물주가 다른 견적 요청을 선택했습니다. 새 업체를 선택해 견적을 요청해 주세요." };
  for (let i = 6; i <= 17; i += 1) {
    statusPatch["c" + i] = null;
    notePatch["c" + i] = null;
  }
  patchCaseChildToFirebase_(caseId, "status", statusPatch);
  patchCaseChildToFirebase_(caseId, "note", notePatch);
  patchCaseToFirebase_(caseId, {
    quoteRequestRound: currentRound + 1,
    vendorSelections: null,
    selectedVendors: null,
    vendorEstimateMms: null,
    quoteFiles: null,
    businessRegistrationFiles: null,
    recommendation: null,
    ownerRecommendationMms: null,
    automationState: automationState,
    log: log,
    updatedAt: now
  });
}

function recordAutomationError_(payload, err) {
  const action = String(payload && payload.action || "");
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return;

  const message = err && err.message ? err.message : String(err || "알 수 없는 오류");
  const now = new Date().toISOString();
  const casePayload = readCaseFromFirebase_(caseId) || {};
  const log = Array.isArray(casePayload.log) ? casePayload.log : [];

  if (action === "sendComplaintReceiptSms") {
    patchCaseChildToFirebase_(caseId, "status", { c2: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c2: "접수확인 문자 발송 실패: " + message });
    log.unshift("접수확인 문자 발송 실패: " + message);
  } else if (action === "uploadQuoteFile") {
    const fileName = payload && payload.file && payload.file.fileName ? String(payload.file.fileName) : "파일명 미확인";
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "견적 파일 업로드 실패: " + fileName + " / " + message });
    log.unshift("견적 파일 업로드 실패: " + fileName + " / " + message);
  } else if (action === "uploadBusinessRegistration") {
    const fileName = payload && payload.file && payload.file.fileName ? String(payload.file.fileName) : "파일명 미확인";
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "사업자등록증 업로드 실패: " + fileName + " / " + message });
    log.unshift("사업자등록증 업로드 실패: " + fileName + " / " + message);
  } else if (action === "uploadWorkPhoto") {
    const fileName = payload && payload.file && payload.file.fileName ? String(payload.file.fileName) : "파일명 미확인";
    patchCaseChildToFirebase_(caseId, "status", { c13: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c13: "작업 사진 업로드 실패: " + fileName + " / " + message });
    log.unshift("작업 사진 업로드 실패: " + fileName + " / " + message);
  } else if (action === "confirmQuoteAmount") {
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "견적 합계금액 확정 실패: " + message });
    log.unshift("견적 합계금액 확정 실패: " + message);
  } else if (action === "sendVendorEstimateMms") {
    patchCaseChildToFirebase_(caseId, "status", { c5: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c5: "업체 MMS 발송 실패: " + message });
    log.unshift("업체 MMS 발송 실패: " + message);
  } else if (action === "sendOwnerRecommendationMms") {
    patchCaseChildToFirebase_(caseId, "status", { c8: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c8: "건물주 추천 MMS 발송 실패: " + message });
    log.unshift("건물주 추천 MMS 발송 실패: " + message);
  } else if (action === "confirmCasePayment") {
    patchCaseChildToFirebase_(caseId, "status", { c10: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c10: "관리자 입금 확인 처리 실패: " + message });
    log.unshift("관리자 입금 확인 처리 실패: " + message);
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

function handleComplaintReceiptSms_(payload) {
  const caseId = String(payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const existingStatus = String(casePayload.sms && casePayload.sms.status || "");
  if (!payload.force && isSmsSentStatus_(existingStatus)) {
    const skippedResult = {
      status: existingStatus,
      statusText: (casePayload.note && casePayload.note.c2) || "이미 발송된 문자 기록이 있어 재발송하지 않았습니다.",
      skipped: true
    };
    return Object.assign({ ok: true, caseId: caseId, message: skippedResult.statusText }, skippedResult);
  }

  const record = readResponseRecordForCase_(casePayload);
  const smsRecord = Object.keys(record).length ? record : casePayloadToSmsRecord_(casePayload, payload);
  const ticketNo = casePayload.ticketNo || casePayload.id || caseId;
  const analysis = {
    urgency: casePayload.urgency || "",
    vendorType: casePayload.vendorType || "",
    summary: casePayload.summary || "",
    reason: casePayload.analysisReason || ""
  };
  const smsResult = sendComplaintSms_(ticketNo, smsRecord, analysis, casePayload.contractMatch || {}, {
    force: payload.force === true,
    existingSms: casePayload.sms || {}
  });

  const normalizedTenantPhone = normalizePhoneForSms_(
    readField_(smsRecord, ["연락처", "전화번호", "휴대폰"])
  );
  if (
    casePayload.source === "kakao_chatbot" &&
    isSendableSmsPhone_(normalizedTenantPhone)
  ) {
    casePayload.phone = maskPhone_(normalizedTenantPhone);
    writeNormalizedKakaoPhoneToSheetForCase_(casePayload, normalizedTenantPhone);
  }

  applySmsResultToCase_(casePayload, smsResult);
  if (!smsResult.skipped) writeSmsResultToSheetForCase_(casePayload, smsResult);
  writeCaseToFirebase_(caseId, casePayload);
  putCaseChildToFirebase_(caseId, "complaintReceiptSms", smsResult);
  putCaseChildToFirebase_(caseId, "automationState/receiptSms", casePayload.automationState.receiptSms);
  putCaseChildToFirebase_(caseId, "note/c2", casePayload.note.c2 || "");
  if (casePayload.source === "kakao_chatbot" && casePayload.phone) {
    putCaseChildToFirebase_(caseId, "phone", casePayload.phone);
  }
  const workflow = advanceCaseWorkflow_(caseId, { source: "receipt_sms", skipOwnerAutoSend: true });

  const ok = isSmsSentStatus_(smsResult.status);
  return Object.assign({
    ok: ok,
    caseId: caseId,
    message: smsResult.statusText || smsResult.status || "",
    workflow: workflow
  }, smsResult);
}

function casePayloadToSmsRecord_(casePayload, payload) {
  const contact = payload && payload.contact || {};
  return {
    "건물명": casePayload.building || contact.building || "",
    "건물 주소": casePayload.address || contact.address || "",
    "호실": casePayload.room || contact.room || "",
    "이름": casePayload.name || contact.name || "",
    "연락처": contact.phone || casePayload.phone || "",
    "문제 유형": casePayload.issueType || contact.issueType || "",
    "방문 가능 시간": formatKoreanDateTimeForCase_(
      casePayload.visitTime || contact.visitTime || "",
      casePayload.visitDate || contact.visitDate || casePayload.receivedAt || casePayload.createdAt
    ),
    "민원 내용": casePayload.summary || contact.summary || ""
  };
}

function writeSmsResultToSheetForCase_(casePayload, smsResult) {
  const row = Number(casePayload && casePayload.sheetRow);
  if (!row || row < 2) return;

  const sheet = getResponseSheet_();
  const headers = ensureOutputHeaders_(sheet);
  const headerMap = {};
  headers.forEach((header, index) => headerMap[header] = index + 1);
  setCellByHeader_(sheet, row, headerMap, "문자 발송 상태", smsResult.status || "");
  setCellByHeader_(sheet, row, headerMap, "문자 발송 메모", smsResult.statusText || "");
}

function writeNormalizedKakaoPhoneToSheetForCase_(casePayload, phone) {
  const row = Number(casePayload && casePayload.sheetRow);
  if (!row || row < 2 || !isSendableSmsPhone_(phone)) return;

  const sheet = getResponseSheet_();
  const headers = ensureKakaoIntakeHeaders_(sheet);
  const headerMap = kakaoComplaintHeaderMap_(headers);
  const column = headerMap["연락처"];
  if (!column) return;
  sheet.getRange(row, column).setNumberFormat("@").setValue(String(phone));
}

function handleVendorEstimateMms_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const selectedVendors = Array.isArray(payload.vendors) ? payload.vendors.map(normalizeVendorForMms_).filter(v => v.name || v.phone) : [];

  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const requestKey = "vendor-mms:" + caseId + ":" + selectedVendors.map(vendor => [
    vendor.id || "",
    vendor.name || "",
    vendorSmsPhone_(vendor) || ""
  ].join("|")).sort().join(";");
  const previous = casePayload.vendorEstimateMms || {};
  if (payload.force !== true && previous.ok === true && previous.requestKey === requestKey) {
    const workflow = advanceCaseWorkflow_(caseId, { source: "vendor_mms", skipOwnerAutoSend: true });
    return Object.assign({ caseId: caseId, skipped: true, workflow: workflow }, previous);
  }

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
    requestKey: requestKey,
    photoName: photo.fileName,
    sensFileId: upload.fileId,
    sent: [],
    failed: [],
    skipped: []
  };

  selectedVendors.forEach(vendor => {
    const to = vendorSmsPhone_(vendor);
    if (!to) {
      result.skipped.push({ name: vendor.name || "업체명 없음", reason: "MMS 가능한 휴대폰 번호 없음" });
      return;
    }

    const sendResult = sendSensMms_(to, content, upload.fileId, vendor.name || "업체", config);
    const item = {
      name: vendor.name || "업체명 없음",
      category: vendor.category || "",
      phoneMasked: maskPhone_(to),
      message: sendResult.message,
      requestId: sendResult.requestId || "",
      statusCode: sendResult.statusCode || "",
      statusName: sendResult.statusName || "",
      responseCode: sendResult.responseCode || ""
    };
    if (sendResult.ok) {
      result.sent.push(item);
    } else {
      result.failed.push(item);
    }
  });

  result.ok = selectedVendors.length > 0 &&
    result.sent.length === selectedVendors.length &&
    result.failed.length === 0 &&
    result.skipped.length === 0;
  result.status = result.ok ? "sent" : "failed";
  result.statusText = result.ok
    ? "업체 MMS 발송 완료: " + result.sent.length + "곳"
    : "업체 MMS 발송 보류/실패: 성공 " + result.sent.length + "곳, 실패 " + result.failed.length + "곳, 제외 " + result.skipped.length + "곳";

  return updateVendorMmsCase_(caseId, casePayload, result);
}

function handleOwnerRecommendationPreview_(payload) {
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const selected = selectOwnerRecommendationQuote_(casePayload, payload.quoteId);
  if (!selected.quote) {
    return { ok: false, message: "추천할 수 있는 금액 확인 견적이 없습니다." };
  }

  const ownerPhone = extractOwnerRecommendationPhone_(casePayload);
  const preparedDecision = prepareOwnerDecisionLinkForCase_(caseId, casePayload, selected.quoteId, selected.quote);
  const supplier = preparedDecision.supplier;
  const amounts = preparedDecision.amounts;
  const ownerDecision = preparedDecision.state || {};
  if (!preparedDecision.ok || !ownerDecision.decisionUrl) {
    return {
      ok: false,
      status: "blocked",
      message: preparedDecision.message || ownerDecision.linkStatusText || "승인 링크가 열리는지 확인하지 못해 미리보기를 만들지 않았습니다.",
      caseId: caseId,
      quoteId: selected.quoteId,
      decisionUrl: ownerDecision.decisionUrl || "",
      linkValidated: false
    };
  }
  const message = appendOwnerDecisionLink_(
    String(payload.message || "").trim() || makeOwnerRecommendationMmsContent_(casePayload, supplier, amounts),
    ownerDecision.shortDecisionUrl || ownerDecision.decisionUrl
  );
  let image = null;
  try {
    image = createOwnerRecommendationImage_(casePayload, selected.quoteId, selected.quote, supplier, amounts);
  } catch (err) {
    Logger.log("건물주 추천 이미지 미리 생성 실패: " + err.message);
  }

  const preview = {
    quoteId: selected.quoteId,
    vendorName: supplier.name,
    ownerPhoneMasked: maskPhone_(ownerPhone),
    ownerPhoneAvailable: !!ownerPhone,
    bringTotalAmount: amounts.totalAmount,
    bringSupplyAmount: amounts.supplyAmount,
    bringVatAmount: amounts.vatAmount,
    message: message,
    decisionUrl: ownerDecision.decisionUrl,
    shortDecisionUrl: ownerDecision.shortDecisionUrl || "",
    decisionStatus: ownerDecision.status,
    decisionLinkValidated: true,
    imageFileId: image && image.fileId || "",
    imageFileUrl: image && image.fileUrl || "",
    imageFileName: image && image.fileName || "",
    imageDesignVersion: image && image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION,
    updatedAt: new Date().toISOString()
  };
  try {
    patchCaseChildToFirebase_(caseId, "ownerRecommendationMms/preview", preview);
  } catch (err) {
    Logger.log("건물주 추천 미리보기 저장 실패: " + err.message);
  }

  return {
    ok: true,
    caseId: caseId,
    quoteId: selected.quoteId,
    vendorName: supplier.name,
    ownerPhoneMasked: maskPhone_(ownerPhone),
    ownerPhoneAvailable: !!ownerPhone,
    bringTotalAmount: amounts.totalAmount,
    bringSupplyAmount: amounts.supplyAmount,
    bringVatAmount: amounts.vatAmount,
    message: message,
    decisionUrl: ownerDecision.decisionUrl,
    shortDecisionUrl: ownerDecision.shortDecisionUrl || "",
    decisionStatus: ownerDecision.status,
    decisionLinkValidated: true,
    imageFileId: image && image.fileId || "",
    imageFileUrl: image && image.fileUrl || "",
    imageFileName: image && image.fileName || "",
    imageDesignVersion: image && image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION
  };
}

function handleOwnerRecommendationMms_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, status: "blocked", statusText: "다른 건물주 추천 MMS 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  }
  try {
    return handleOwnerRecommendationMmsLocked_(payload || {});
  } finally {
    lock.releaseLock();
  }
}

function handleOwnerRecommendationMmsConfirmation_(payload) {
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const existing = casePayload.ownerRecommendationMms || {};
  if (ownerMmsResultComplete_(casePayload, existing)) {
    return Object.assign({ caseId: caseId, skipped: true }, existing);
  }
  if (
    existing.deliveryAccepted !== true &&
    existing.status !== "sent_pending_confirmation" &&
    existing.status !== "sending"
  ) {
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "먼저 건물주 추천 MMS 발송을 요청해야 합니다.",
      requestKey: existing.requestKey || "",
      quoteId: existing.quoteId || "",
      vendorName: existing.vendorName || ""
    });
  }

  const result = Object.assign({}, existing, {
    ok: true,
    status: "sent",
    deliveryAccepted: true,
    deliveryConfirmed: true,
    confirmedAt: new Date().toISOString(),
    statusText: "건물주 문자 수신 확인 완료"
  });
  return updateOwnerRecommendationMmsCase_(caseId, casePayload, result);
}

function handleOwnerRecommendationMmsLocked_(payload) {
  const caseId = String(payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const selected = selectOwnerRecommendationQuote_(casePayload, payload.quoteId);
  if (!selected.quote) {
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "추천할 수 있는 금액 확인 견적이 없습니다."
    });
  }

  const existing = casePayload.ownerRecommendationMms || {};
  const requestKey = caseId + ":" + selected.quoteId;
  if (
    ownerMmsResultComplete_(casePayload, existing) &&
    existing.requestKey === requestKey &&
    payload.force !== true
  ) {
    const normalizedExisting = Object.assign({}, existing, {
      ok: true,
      status: "sent",
      deliveryAccepted: true,
      deliveryConfirmed: true,
      confirmedAt: existing.confirmedAt || new Date().toISOString(),
      statusText: "건물주 추천 알림 발송 완료. ⑨ 승인·입금 단계로 전환했습니다."
    });
    return Object.assign({ skipped: true }, updateOwnerRecommendationMmsCase_(caseId, casePayload, normalizedExisting));
  }

  const ownerPhone = extractOwnerRecommendationPhone_(casePayload);
  const preparedDecision = prepareOwnerDecisionLinkForCase_(caseId, casePayload, selected.quoteId, selected.quote);
  const supplier = preparedDecision.supplier;
  const amounts = preparedDecision.amounts;
  const ownerDecision = preparedDecision.state || {};
  if (!preparedDecision.ok || !ownerDecision.decisionUrl) {
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: preparedDecision.message || ownerDecision.linkStatusText || "승인 링크가 열리는지 확인하지 못해 추천 알림 발송을 보류했습니다.",
      requestKey: requestKey,
      quoteId: selected.quoteId,
      vendorName: supplier.name,
      originalTotalAmount: ownerQuoteOriginalAmount_(selected.quote),
      bringTotalAmount: amounts.totalAmount,
      ownerPhoneMasked: maskPhone_(ownerPhone),
      decisionUrl: ownerDecision.decisionUrl || "",
      shortDecisionUrl: ownerDecision.shortDecisionUrl || "",
      decisionStatus: ownerDecision.status || "",
      decisionLinkValidated: false,
      updatedAt: new Date().toISOString()
    });
  }
  const message = appendOwnerDecisionLink_(
    String(payload.message || "").trim() || makeOwnerRecommendationMmsContent_(casePayload, supplier, amounts),
    ownerDecision.shortDecisionUrl || ownerDecision.decisionUrl
  );
  const baseResult = {
    ok: false,
    status: "failed",
    statusText: "",
    requestKey: requestKey,
    quoteId: selected.quoteId,
    vendorName: supplier.name,
    originalTotalAmount: ownerQuoteOriginalAmount_(selected.quote),
    bringTotalAmount: amounts.totalAmount,
    ownerPhoneMasked: maskPhone_(ownerPhone),
    decisionUrl: ownerDecision.decisionUrl,
    shortDecisionUrl: ownerDecision.shortDecisionUrl || "",
    decisionStatus: ownerDecision.status,
    decisionLinkValidated: true,
    updatedAt: new Date().toISOString()
  };

  if (!ownerPhone) {
    baseResult.status = "blocked";
    baseResult.statusText = "온보딩 수집서에서 건물주 연락처를 찾지 못했습니다.";
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
  }

  const kakaoConfig = getKakaoAlimTalkConfig_();
  if (kakaoConfig.enabled && kakaoConfig.templates.ownerQuote) {
    const approvalUrl = ownerDecision.shortDecisionUrl || ownerDecision.decisionUrl;
    const alimTalkContent = makeOwnerRecommendationAlimTalkContent_(casePayload, supplier, amounts);
    const fallbackContent = appendOwnerDecisionLink_(alimTalkContent, approvalUrl);
    checkpointOwnerRecommendationMmsCase_(caseId, casePayload, Object.assign({}, baseResult, {
      provider: "kakao_alimtalk",
      templateCode: kakaoConfig.templates.ownerQuote
    }));
    const send = sendKakaoAlimTalkOrSms_(ownerPhone, alimTalkContent, "건물주 추천 견적", {
      templateCode: kakaoConfig.templates.ownerQuote,
      fallbackContent: fallbackContent,
      buttons: [{
        type: "WL",
        name: "추천 견적 확인",
        linkMobile: approvalUrl,
        linkPc: approvalUrl
      }]
    });
    baseResult.provider = send.provider || "kakao_alimtalk";
    baseResult.templateCode = send.templateCode || kakaoConfig.templates.ownerQuote;
    baseResult.requestId = send.requestId || "";
    baseResult.messageId = send.messageId || "";
    baseResult.responseCode = send.responseCode || "";
    baseResult.statusText = send.ok
      ? (send.provider === "kakao_alimtalk"
        ? "카카오 알림톡 발송 완료. ⑨ 승인·입금 단계로 전환했습니다."
        : "알림톡 실패 후 문자 대체 발송 완료. ⑨ 승인·입금 단계로 전환했습니다.")
      : send.message;
    baseResult.deliveryAccepted = send.ok === true;
    baseResult.deliveryConfirmed = send.ok === true;
    baseResult.confirmedAt = send.ok ? new Date().toISOString() : "";
    baseResult.ok = send.ok === true;
    baseResult.status = send.ok ? "sent" : "failed";
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
  }

  const config = getSensConfig_();
  if (!config.enabled) {
    baseResult.status = "blocked";
    baseResult.statusText = "NCP SENS 설정 또는 승인된 발신번호가 없어 MMS 발송을 보류했습니다.";
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
  }

  let image = null;
  try {
    const requestedImageId = String(payload.imageFileId || existing.imageFileId || "").trim();
    const requestedImageVersion = String(
      payload.imageDesignVersion || existing.imageDesignVersion ||
      existing.preview && existing.preview.imageDesignVersion || ""
    ).trim();
    if (requestedImageId && requestedImageVersion === OWNER_RECOMMENDATION_IMAGE_VERSION) {
      try {
        const requestedFile = DriveApp.getFileById(requestedImageId);
        image = {
          fileId: requestedFile.getId(),
          fileUrl: requestedFile.getUrl(),
          fileName: requestedFile.getName(),
          file: requestedFile
        };
      } catch (err) {
        Logger.log("건물주 추천 기존 이미지 확인 실패: " + err.message);
      }
    }
    if (!image) image = createOwnerRecommendationImage_(casePayload, selected.quoteId, selected.quote, supplier, amounts);
    const imagePayload = driveImageToMmsPayload_(image.file);
    const upload = uploadSensMmsAttachment_(imagePayload, config);
    if (!upload.ok) {
      baseResult.statusText = upload.message;
      baseResult.imageFileId = image.fileId;
      baseResult.imageFileUrl = image.fileUrl;
      baseResult.imageFileName = image.fileName;
      baseResult.imageDesignVersion = image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION;
      return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
    }

    baseResult.sensFileId = upload.fileId;
    baseResult.imageFileId = image.fileId;
    baseResult.imageFileUrl = image.fileUrl;
    baseResult.imageFileName = image.fileName;
    baseResult.imageDesignVersion = image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION;
    checkpointOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);

    const send = sendSensMms_(ownerPhone, message, upload.fileId, "건물주", config);
    baseResult.requestId = send.requestId || "";
    baseResult.responseCode = send.responseCode || "";
    baseResult.statusText = send.ok
      ? "SENS MMS 발송 완료. ⑨ 승인·입금 단계로 전환했습니다."
      : send.message;
    baseResult.deliveryAccepted = send.ok === true;
    baseResult.deliveryConfirmed = send.ok === true;
    baseResult.confirmedAt = send.ok ? new Date().toISOString() : "";
    baseResult.ok = send.ok === true;
    baseResult.status = send.ok ? "sent" : "failed";
  } catch (err) {
    baseResult.statusText = "건물주 추천 MMS 처리 실패: " + err.message;
  }

  return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
}

function selectOwnerRecommendationQuote_(casePayload, requestedQuoteId) {
  const quoteFiles = casePayload && casePayload.quoteFiles && typeof casePayload.quoteFiles === "object"
    ? casePayload.quoteFiles
    : {};
  const candidates = Object.keys(quoteFiles).map(quoteId => {
    const quote = quoteFiles[quoteId] || {};
    return { quoteId: quoteId, quote: quote, amount: ownerQuoteOriginalAmount_(quote) };
  }).filter(item => item.amount >= 1000 && !isBusinessRegistrationLikeQuote_(item.quote));

  const requested = candidates.find(item => item.quoteId === String(requestedQuoteId || ""));
  if (requested) return requested;
  candidates.sort((a, b) => {
    if (a.amount !== b.amount) return a.amount - b.amount;
    const aApplied = a.quote.businessRegistrationAppliedAt ? 1 : 0;
    const bApplied = b.quote.businessRegistrationAppliedAt ? 1 : 0;
    if (aApplied !== bApplied) return bApplied - aApplied;
    return String(a.quote.vendorName || "").localeCompare(String(b.quote.vendorName || ""), "ko");
  });
  return candidates[0] || { quoteId: "", quote: null, amount: 0 };
}

function ownerQuoteOriginalAmount_(quote) {
  quote = quote || {};
  return Math.round(Number(
    quote.confirmedTotalAmount ||
    quote.bringQuoteBaseTotalAmount ||
    quote.totalAmount ||
    parseMoneyValue_(quote.amount) ||
    0
  ));
}

function ownerRecommendationSupplier_(quote) {
  const sources = [quote && quote.resolvedVendorInfo, quote && quote.vendor, quote && quote.extractedVendorInfo, quote || {}];
  const pick = keys => {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const key of keys) {
        const value = String(source[key] || "").trim();
        if (value && !isGenericQuoteVendorValue_(value)) return value;
      }
    }
    return "";
  };
  return {
    name: pick(["name", "vendorName"]) || "업체 확인 필요",
    businessNo: pick(["businessNo", "bizNo", "businessNumber"]),
    ceo: pick(["ceo", "owner", "representative", "representativeName"]),
    address: pick(["address", "addressFromVendorList"]),
    type: pick(["type", "businessType"]),
    category: pick(["category", "businessCategory", "industry"]),
    phone: pick(["phone", "tel", "telephone"]),
    email: pick(["email", "mail"])
  };
}

function ownerRecommendationAmounts_(quote) {
  const base = ownerQuoteOriginalAmount_(quote);
  const calculated = calculateBringQuoteAmounts_(base);
  const total = Number(quote && quote.bringQuoteTotalAmount || calculated.totalAmount || 0);
  const supply = Number(quote && quote.bringQuoteSupplyAmount || calculated.supplyAmount || (total ? Math.round(total / 1.1) : 0));
  const vat = Number(quote && quote.bringQuoteVatAmount || calculated.vatAmount || (total ? total - supply : 0));
  return { baseTotalAmount: base, supplyAmount: supply, vatAmount: vat, totalAmount: total };
}

function ownerRecommendationAmountText_(amount) {
  return Number(amount || 0) ? Number(amount).toLocaleString("ko-KR") + "원" : "금액 미입력";
}

function makeOwnerRecommendationMmsContent_(casePayload, supplier, amounts) {
  return [
    "[BRING Care 추천 견적 안내]",
    "",
    "안녕하세요. BRING Care입니다.",
    "추천 업체: " + (supplier.name || "업체 확인 필요"),
    "추천 금액: " + ownerRecommendationAmountText_(amounts.totalAmount),
    "",
    "첨부된 브링 견적서를 확인해 주세요.",
    "추천 견적으로 진행을 원하시면 문자 하단의 승인 링크에서",
    "'승인하고 입금 진행' 버튼을 눌러주세요.",
    "접수번호: " + (casePayload.ticketNo || casePayload.id || "")
  ].join("\n");
}

function safeAlimTalkVariable_(value, fallback) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return (text || String(fallback || "미입력")).slice(0, 200);
}

function makeComplaintReceiptTenantAlimTalkContent_(ticketNo, record) {
  const tenantName = safeAlimTalkVariable_(readField_(record, ["이름", "성명", "세입자명"]), "고객");
  const building = safeAlimTalkVariable_(readField_(record, ["건물명", "건물"]), "미입력");
  const room = safeAlimTalkVariable_(formatRoomForCase_(readField_(record, ["호실"])), "미입력");
  const issueType = safeAlimTalkVariable_(readField_(record, ["문제 유형"]), "미입력");
  return [
    "[브링케어 민원 접수 안내]",
    tenantName + "님, 민원이 정상 접수되었습니다.",
    "",
    "접수번호: " + safeAlimTalkVariable_(ticketNo, "미입력"),
    "건물: " + building,
    "호실: " + room,
    "문제 유형: " + issueType,
    "",
    "담당자가 내용을 확인한 후 진행 상황을 안내드리겠습니다."
  ].join("\n");
}

function makeComplaintReceiptOwnerAlimTalkContent_(ticketNo, record) {
  const building = safeAlimTalkVariable_(readField_(record, ["건물명", "건물"]), "미입력");
  const room = safeAlimTalkVariable_(formatRoomForCase_(readField_(record, ["호실"])), "미입력");
  const issueType = safeAlimTalkVariable_(readField_(record, ["문제 유형"]), "미입력");
  return [
    "[브링케어 건물 민원 접수 안내]",
    "관리 중인 건물에 민원이 접수되었습니다.",
    "",
    "접수번호: " + safeAlimTalkVariable_(ticketNo, "미입력"),
    "건물: " + building,
    "호실: " + room,
    "문제 유형: " + issueType,
    "",
    "접수 내용을 확인한 후 필요한 업체 견적을 진행하겠습니다."
  ].join("\n");
}

function makeOwnerRecommendationAlimTalkContent_(casePayload, supplier, amounts) {
  return [
    "[브링케어 추천 견적 안내]",
    "",
    "본 알림은 고객님께서 브링케어 관리 서비스 계약 시 신청하고 수신에 동의하신 건물 민원 견적 안내입니다.",
    "계약 건물의 민원에 새로운 추천 견적이 등록될 때마다 발송됩니다.",
    "",
    "건물 민원에 대한 추천 견적이 준비되었습니다.",
    "",
    "접수번호: " + safeAlimTalkVariable_(casePayload && (casePayload.ticketNo || casePayload.id), "미입력"),
    "건물: " + safeAlimTalkVariable_(casePayload && casePayload.building, "미입력"),
    "호실: " + safeAlimTalkVariable_(formatRoomForCase_(casePayload && casePayload.room), "미입력"),
    "추천 업체: " + safeAlimTalkVariable_(supplier && supplier.name, "업체 확인 필요"),
    "추천 금액: " + ownerRecommendationAmountText_(amounts && amounts.totalAmount),
    "",
    "아래 버튼에서 세부 작업 내용과 금액을 확인한 후 진행 여부를 선택해 주세요.",
    "",
    "알림 관련 문의 및 수신 중단 요청",
    "브링케어 고객센터: 033-748-8919"
  ].join("\n");
}

function extractOwnerRecommendationPhone_(casePayload) {
  const direct = [casePayload && casePayload.ownerPhone, casePayload && casePayload.ownerContact,
    casePayload && casePayload.owner && casePayload.owner.phone].filter(Boolean).join(" ");
  const directPhone = extractPhones_(direct).find(phone => isSendableSmsPhone_(phone));
  if (directPhone) return directPhone;
  const contractMatch = casePayload && casePayload.contractMatch || {};
  const onboardingPhone = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  return isSendableSmsPhone_(onboardingPhone) ? onboardingPhone : "";
}

function ownerRecommendationWorkLines_(quote) {
  const items = Array.isArray(quote && quote.bringQuoteItems) && quote.bringQuoteItems.length
    ? quote.bringQuoteItems
    : (Array.isArray(quote && quote.extractedItems) ? quote.extractedItems : []);
  const names = items.map(item => String(
    item && (item.product || item.name || item.itemName || item.description || item.title) || ""
  ).trim()).filter(Boolean);
  if (!names.length) return ["현장 확인 및 작업 견적"];
  const lines = names.slice(0, 4);
  if (names.length > 4) lines.push("외 " + String(names.length - 4) + "건");
  return lines;
}

function workflowStatusRank_(value) {
  if (value === "done") return 2;
  if (value === "doing") return 1;
  return 0;
}

function promoteWorkflowStatus_(status, key, value) {
  status = status || {};
  if (workflowStatusRank_(value) > workflowStatusRank_(status[key])) status[key] = value;
  return status;
}

function receiptSmsWorkflowComplete_(casePayload) {
  const candidates = [
    casePayload && casePayload.complaintReceiptSms,
    casePayload && casePayload.sms,
    casePayload && casePayload.automationState && casePayload.automationState.receiptSms
  ];
  return candidates.some(item => item && (
    item.ok === true || item.deliveryAccepted === true || isSmsCompleteStatus_(item.status)
  ));
}

function vendorMmsWorkflowComplete_(casePayload) {
  const candidates = [
    casePayload && casePayload.vendorEstimateMms,
    casePayload && casePayload.automationState && casePayload.automationState.vendorEstimateMms
  ];
  return candidates.some(item => item && item.ok === true && (item.status === "sent" || item.deliveryAccepted === true || (item.sent || []).length > 0));
}

function ownerDecisionLinkReady_(casePayload, result) {
  const state = casePayload && casePayload.ownerDecision || {};
  const item = result || {};
  if (
    state.status !== "pending" ||
    state.linkValidated !== true ||
    !state.token ||
    !state.decisionUrl
  ) {
    return false;
  }
  if (
    item.decisionLinkValidated !== true ||
    String(item.decisionUrl || "") !== String(state.decisionUrl || "")
  ) {
    return false;
  }
  if (item.quoteId && state.quoteId && String(item.quoteId) !== String(state.quoteId)) return false;
  return true;
}

function ownerMmsResultComplete_(casePayload, item) {
  return !!(item && ownerDecisionLinkReady_(casePayload, item) && (
    item.deliveryConfirmed === true ||
    item.deliveryAccepted === true ||
    (item.ok === true && item.status === "sent")
  ));
}

function ownerMmsWorkflowComplete_(casePayload) {
  const candidates = [
    casePayload && casePayload.ownerRecommendationMms,
    casePayload && casePayload.automationState && casePayload.automationState.ownerRecommendationMms
  ];
  return candidates.some(item => ownerMmsResultComplete_(casePayload, item));
}

function workflowPricedQuote_(casePayload) {
  const selected = selectOwnerRecommendationQuote_(casePayload || {}, "");
  return selected && selected.quote && Number(selected.amount || 0) >= 1000 ? selected : null;
}

function workflowStepState_(automationState, key, status, now, extra) {
  automationState.workflow = Object.assign({}, automationState.workflow || {});
  const current = Object.assign({}, automationState.workflow[key] || {}, extra || {});
  current.status = status;
  current.updatedAt = now;
  if (status === "done" && !current.completedAt) current.completedAt = now;
  automationState.workflow[key] = current;
}

function recordUploadBatchProgress_(caseId, payload) {
  const batchId = String(payload && payload.uploadBatchId || "").trim();
  if (!batchId) return;
  const casePayload = readCaseFromFirebase_(caseId) || {};
  const automationState = Object.assign({}, casePayload.automationState || {});
  automationState.uploadBatch = Object.assign({}, automationState.uploadBatch || {}, {
    id: batchId,
    processed: Number(payload.uploadBatchIndex || 0),
    total: Number(payload.uploadBatchTotal || 0),
    complete: payload.uploadBatchComplete === true,
    updatedAt: new Date().toISOString()
  });
  if (payload.uploadBatchComplete === true) automationState.uploadBatch.completedAt = automationState.uploadBatch.completedAt || new Date().toISOString();
  patchCaseChildToFirebase_(caseId, "automationState", automationState);
}

/**
 * 서버에서만 단계 상태를 올리는 중앙 진행 함수.
 * 완료 상태는 절대 낮추지 않으며 status/cN 경로만 부분 업데이트한다.
 */
function advanceCaseWorkflow_(caseId, context) {
  context = context || {};
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };
  if (casePayload.deleted === true) return { ok: false, skipped: true, message: "삭제된 케이스는 자동 진행하지 않습니다: " + caseId };

  const now = new Date().toISOString();
  const before = Object.assign({}, casePayload.status || {});
  const status = Object.assign({}, before);
  const automationState = Object.assign({}, casePayload.automationState || {});
  let pricedQuote = null;
  let ownerDecisionPreparation = null;
  const match = casePayload.contractMatch || {};
  const matched = match.status === "matched";
  const ownerMmsComplete = ownerMmsWorkflowComplete_(casePayload);

  // 과거 MMS 성공 기록만 있고 현재 승인 링크가 검증되지 않았거나 서로 다른
  // 링크인 경우에는 ⑨를 열지 않는다. 잘못 진행된 기존 케이스도 여기서 복구한다.
  if (
    status.c8 === "done" &&
    status.c9 !== "done" &&
    !ownerMmsComplete
  ) {
    status.c8 = "doing";
    status.c9 = "wait";
    workflowStepState_(automationState, "c8", "doing", now, {
      mode: "automatic_owner_mms",
      reason: "decision_link_not_verified_for_sent_mms"
    });
    workflowStepState_(automationState, "c9", "wait", now, {
      reason: "waiting_for_verified_owner_mms"
    });
  }

  if (!matched) {
    promoteWorkflowStatus_(status, "c1", "doing");
    workflowStepState_(automationState, "c1", "doing", now, { reason: match.statusText || "온보딩 매칭 대기" });
  } else {
    promoteWorkflowStatus_(status, "c1", "done");
    promoteWorkflowStatus_(status, "c2", "doing");
    workflowStepState_(automationState, "c1", "done", now, {
      matchKey: match.matchKey || "",
      driveFileId: match.driveFileId || "",
      matchLevel: match.matchLevel || ""
    });
    workflowStepState_(automationState, "c2", "doing", now, {
      retryState: "waiting_or_processing"
    });

    if (receiptSmsWorkflowComplete_(casePayload)) {
      ["c2", "c3", "c4"].forEach(key => promoteWorkflowStatus_(status, key, "done"));
      promoteWorkflowStatus_(status, "c5", "doing");
      workflowStepState_(automationState, "c2", "done", now, {
        tenantRequestId: casePayload.sms && casePayload.sms.tenantRequestId || "",
        ownerRequestId: casePayload.sms && casePayload.sms.ownerRequestId || "",
        retryState: "completed"
      });
      workflowStepState_(automationState, "c3", "done", now, { mode: "rules" });
      workflowStepState_(automationState, "c4", "done", now, { vendorType: casePayload.vendorType || "" });
      workflowStepState_(automationState, "c5", "doing", now, { mode: "manual_vendor_selection" });
    }

    if (vendorMmsWorkflowComplete_(casePayload)) {
      promoteWorkflowStatus_(status, "c5", "done");
      promoteWorkflowStatus_(status, "c6", "doing");
      workflowStepState_(automationState, "c5", "done", now, {
        requestKey: casePayload.vendorEstimateMms && casePayload.vendorEstimateMms.requestKey || ""
      });
      workflowStepState_(automationState, "c6", "doing", now, { mode: "manual_document_upload" });
    }

    const batchComplete = context.uploadBatchComplete === true || (!context.uploadBatchId && context.source !== "quote_upload" && context.source !== "business_registration_upload");
    pricedQuote = workflowPricedQuote_(casePayload);
    if (status.c5 === "done" && pricedQuote && batchComplete) {
      promoteWorkflowStatus_(status, "c6", "done");
      promoteWorkflowStatus_(status, "c7", "done");
      promoteWorkflowStatus_(status, "c8", "doing");
      workflowStepState_(automationState, "c6", "done", now, { pricedQuoteCount: Object.keys(casePayload.quoteFiles || {}).length });
      workflowStepState_(automationState, "c7", "done", now, {
        quoteId: pricedQuote.quoteId,
        vendorName: ownerRecommendationSupplier_(pricedQuote.quote).name,
        originalTotalAmount: pricedQuote.amount,
        criterion: "lowest_original_amount"
      });
      workflowStepState_(automationState, "c8", "doing", now, { mode: "automatic_owner_mms" });
      if (status.c8 === "doing" && !ownerMmsComplete) {
        ownerDecisionPreparation = prepareOwnerDecisionLinkForCase_(
          caseId,
          casePayload,
          pricedQuote.quoteId,
          pricedQuote.quote
        );
        workflowStepState_(automationState, "c8", "doing", now, {
          mode: "automatic_owner_mms",
          decisionLinkStatus: ownerDecisionPreparation.ok ? "ready" : "failed",
          decisionUrl: ownerDecisionPreparation.state && ownerDecisionPreparation.state.decisionUrl || "",
          decisionLinkMessage: ownerDecisionPreparation.message || ""
        });
      }
    }

    if (ownerMmsComplete) {
      promoteWorkflowStatus_(status, "c8", "done");
      promoteWorkflowStatus_(status, "c9", "doing");
      workflowStepState_(automationState, "c8", "done", now, {
        requestId: casePayload.ownerRecommendationMms && casePayload.ownerRecommendationMms.requestId || ""
      });
      workflowStepState_(automationState, "c9", "doing", now, { mode: "manual_approval_payment" });
    }
  }

  const statusPatch = {};
  Object.keys(status).forEach(key => {
    if (status[key] !== before[key]) statusPatch[key] = status[key];
  });
  if (Object.keys(statusPatch).length) patchCaseChildToFirebase_(caseId, "status", statusPatch);
  patchCaseChildToFirebase_(caseId, "automationState", automationState);
  patchCaseToFirebase_(caseId, { updatedAt: now });

  const shouldSendOwner = matched && status.c7 === "done" && status.c8 === "doing" && !ownerMmsComplete;
  if (shouldSendOwner && context.skipOwnerAutoSend !== true) {
    const priced = pricedQuote || workflowPricedQuote_(readCaseFromFirebase_(caseId) || {});
    if (priced) {
      const latestCase = readCaseFromFirebase_(caseId) || casePayload;
      const prepared = ownerDecisionPreparation || prepareOwnerDecisionLinkForCase_(
        caseId,
        latestCase,
        priced.quoteId,
        priced.quote
      );
      if (!prepared.ok) {
        return {
          ok: false,
          status: status,
          ownerDecisionPreparation: {
            ok: false,
            decisionUrl: prepared.state && prepared.state.decisionUrl || "",
            message: prepared.message || prepared.state && prepared.state.linkStatusText || "승인 링크 확인 실패"
          }
        };
      }
      const ownerResult = handleOwnerRecommendationMms_({ caseId: caseId, quoteId: priced.quoteId });
      return { ok: ownerResult && ownerResult.ok === true, status: status, ownerResult: ownerResult };
    }
  }
  return { ok: true, status: status };
}

function ownerRecommendationVisitTime_(casePayload) {
  const source = casePayload || {};
  return formatKoreanDateTimeForCase_(
    source.visitTime || "",
    source.visitDate || source.receivedAt || source.createdAt || ""
  ) || "미입력";
}

function ownerRecommendationWrapText_(value, maxChars) {
  const text = String(value || "").trim() || "미입력";
  const lines = [];
  text.split(/\n/).forEach(part => {
    let rest = part.trim() || "미입력";
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    lines.push(rest);
  });
  return lines.join("\n");
}

function createOwnerRecommendationImage_(casePayload, quoteId, quote, supplier, amounts) {
  const date = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
  const fileName = safeDriveName_((casePayload.ticketNo || casePayload.id || "case") + "_" + (supplier.name || "업체확인필요") + "_" + date + "_브링추천견적.jpg");
  const folder = getOrCreateChildFolder_(getQuoteDriveFolder_(casePayload), "건물주 추천 발송");
  let file = null;
  let tempSpreadsheetFile = null;
  let tempPdfFile = null;
  try {
    const spreadsheet = SpreadsheetApp.create("BRING 추천 견적 이미지 임시 파일");
    tempSpreadsheetFile = DriveApp.getFileById(spreadsheet.getId());
    buildOwnerRecommendationSheet_(spreadsheet, casePayload, quote, supplier, amounts);
    const pdfBlob = exportOwnerRecommendationSheetPdf_(spreadsheet);
    tempPdfFile = folder.createFile(pdfBlob.setName(fileName.replace(/\.jpg$/i, ".pdf")));
    const rendered = renderDriveImageFile_(tempPdfFile.getId(), fileName);
    file = folder.createFile(rendered);
  } catch (err) {
    Logger.log("추천 견적 한글 이미지 생성 실패, 기본 이미지로 대체: " + err.message);
    file = createOwnerRecommendationFallbackImage_(folder, fileName, casePayload, quote, supplier, amounts);
  } finally {
    try { if (tempPdfFile) tempPdfFile.setTrashed(true); } catch (err) {}
    try { if (tempSpreadsheetFile) tempSpreadsheetFile.setTrashed(true); } catch (err) {}
  }
  return {
    file: file,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    fileName: file.getName(),
    quoteId: quoteId,
    imageDesignVersion: OWNER_RECOMMENDATION_IMAGE_VERSION
  };
}

function buildOwnerRecommendationSheet_(spreadsheet, casePayload, quote, supplier, amounts) {
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName("추천 견적");
  sheet.clear();
  sheet.setHiddenGridlines(true);
  const font = "Noto Sans KR";
  const all = sheet.getRange("A1:H19");
  all.setBackground("#f3f6fb").setFontFamily(font).setFontColor("#17233a").setVerticalAlignment("middle");
  [56, 118, 118, 92, 92, 108, 108, 56].forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.setRowHeights(1, 19, 38);
  sheet.setRowHeights(1, 2, 54);
  sheet.setRowHeight(3, 34);
  sheet.setRowHeights(4, 3, 55);
  sheet.setRowHeights(7, 3, 46);
  sheet.setRowHeight(10, 42);
  sheet.setRowHeights(11, 5, 42);
  sheet.setRowHeights(16, 3, 48);
  sheet.setRowHeight(19, 32);

  sheet.getRange("A1:H2").merge().setValue("BRING Care 추천 견적서")
    .setBackground("#17386f").setFontColor("#ffffff").setFontSize(28).setFontWeight("bold")
    .setHorizontalAlignment("left").setWrap(true);
  sheet.getRange("A3:H3").merge().setValue("검토를 마친 추천 견적 요약입니다")
    .setBackground("#17386f").setFontColor("#cfe0ff").setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("left");

  sheet.getRange("A4:C6").merge().setValue("최종 합계금액")
    .setBackground("#e1edff").setFontColor("#52606d").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, true, false, false, false, "#aac8f3", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange("D4:H6").merge().setValue(ownerRecommendationAmountText_(amounts.totalAmount))
    .setBackground("#e1edff").setFontColor("#12346b").setFontSize(34).setFontWeight("bold")
    .setHorizontalAlignment("right").setBorder(true, false, true, true, false, false, "#aac8f3", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  ownerRecommendationSheetCard_(sheet, "A7:D7", "A8:D9", "추천 업체", supplier.name || "업체 확인 필요");
  ownerRecommendationSheetCard_(sheet, "E7:H7", "E8:H9", "방문 가능 시간", ownerRecommendationVisitTime_(casePayload));

  sheet.getRange("A10:H10").merge().setValue("작업 내용")
    .setBackground("#ffffff").setFontColor("#52606d").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, false, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  const workLines = ownerRecommendationWorkLines_(quote);
  for (let row = 11; row <= 15; row++) {
    const value = workLines[row - 11] ? "• " + workLines[row - 11] : "";
    sheet.getRange("A" + row + ":H" + row).merge().setValue(value)
      .setBackground("#ffffff").setFontSize(17).setFontWeight("bold").setHorizontalAlignment("left")
      .setWrap(true).setBorder(false, true, row === 15, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  }

  ownerRecommendationSheetMoney_(sheet, "A16:D16", "A17:D18", "공급가액", amounts.supplyAmount);
  ownerRecommendationSheetMoney_(sheet, "E16:H16", "E17:H18", "부가세", amounts.vatAmount);
  sheet.getRange("A19:H19").merge().setValue("BRING Care · 건물 유지보수 추천 견적")
    .setFontColor("#7b8798").setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center");
  SpreadsheetApp.flush();
}

function ownerRecommendationSheetCard_(sheet, labelRange, valueRange, label, value) {
  sheet.getRange(labelRange).merge().setValue(label)
    .setBackground("#ffffff").setFontColor("#52606d").setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, false, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(valueRange).merge().setValue(String(value || "미입력"))
    .setBackground("#ffffff").setFontColor("#17233a").setFontSize(18).setFontWeight("bold")
    .setHorizontalAlignment("left").setWrap(true).setBorder(false, true, true, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
}

function ownerRecommendationSheetMoney_(sheet, labelRange, valueRange, label, amount) {
  sheet.getRange(labelRange).merge().setValue(label)
    .setBackground("#ffffff").setFontColor("#52606d").setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, false, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(valueRange).merge().setValue(ownerRecommendationAmountText_(amount))
    .setBackground("#ffffff").setFontColor("#17233a").setFontSize(24).setFontWeight("bold")
    .setHorizontalAlignment("right").setBorder(false, true, true, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
}

function exportOwnerRecommendationSheetPdf_(spreadsheet) {
  SpreadsheetApp.flush();
  Utilities.sleep(250);
  const sheet = spreadsheet.getSheets()[0];
  const params = [
    "format=pdf", "size=letter", "portrait=true", "scale=4", "sheetnames=false", "printtitle=false",
    "pagenumbers=false", "gridlines=false", "fzr=false", "top_margin=0.20", "bottom_margin=0.20",
    "left_margin=0.20", "right_margin=0.20", "gid=" + sheet.getSheetId(), "range=A1:H19"
  ].join("&");
  const response = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + spreadsheet.getId() + "/export?" + params, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
    followRedirects: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("추천 견적 PDF 생성 실패: HTTP " + response.getResponseCode());
  }
  return response.getBlob().getAs("application/pdf");
}

function renderDriveImageFile_(fileId, outputName) {
  const headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
  const fallbackUrl = "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w1600-h1600";
  for (let attempt = 0; attempt < 8; attempt++) {
    const urls = [];
    try {
      const metadata = Drive.Files.get(fileId, { fields: "thumbnailLink" });
      if (metadata && metadata.thumbnailLink) {
        urls.push(String(metadata.thumbnailLink).replace(/=s\d+$/, "=s1600"));
      }
    } catch (err) {
      Logger.log("추천 PDF 썸네일 링크 확인 실패: " + err.message);
    }
    urls.push(fallbackUrl + "&retry=" + attempt);
    for (let index = 0; index < urls.length; index++) {
      try {
        const response = UrlFetchApp.fetch(urls[index], { headers: headers, muteHttpExceptions: true, followRedirects: true });
        const responseHeaders = response.getHeaders();
        const type = String(responseHeaders["Content-Type"] || responseHeaders["content-type"] || response.getBlob().getContentType() || "").toLowerCase();
        if (response.getResponseCode() >= 200 && response.getResponseCode() < 300 && type.indexOf("image/") === 0) {
          const blob = response.getBlob().getAs("image/jpeg");
          blob.setName(outputName);
          return blob;
        }
      } catch (err) {
        Logger.log("추천 PDF 이미지 변환 시도 실패: " + err.message);
      }
    }
    Utilities.sleep(500);
  }
  throw new Error("한글 추천 견적 이미지를 렌더링하지 못했습니다.");
}

function createOwnerRecommendationFallbackImage_(folder, fileName, casePayload, quote, supplier, amounts) {
  const rows = [
    ["최종 합계금액", ownerRecommendationAmountText_(amounts.totalAmount)],
    ["추천 업체", ownerRecommendationWrapText_(supplier.name || "업체 확인 필요", 28)],
    ["방문 가능 시간", ownerRecommendationWrapText_(ownerRecommendationVisitTime_(casePayload), 32)]
  ];
  ownerRecommendationWorkLines_(quote).forEach((line, index) => rows.push([
    index === 0 ? "작업 내용" : "",
    ownerRecommendationWrapText_(line, 32)
  ]));
  rows.push(
    ["공급가액", ownerRecommendationAmountText_(amounts.supplyAmount)],
    ["부가세", ownerRecommendationAmountText_(amounts.vatAmount)]
  );
  const table = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, "항목")
    .addColumn(Charts.ColumnType.STRING, "내용");
  rows.forEach(row => table.addRow(row));
  const chart = Charts.newTableChart()
    .setDataTable(table)
    .setDimensions(800, 1000)
    .setOption("page", "disable")
    .setOption("alternatingRowStyle", false)
    .setOption("showRowNumber", false)
    .build();
  let blob = chart.getAs("image/png");
  try { blob = blob.getAs("image/jpeg"); } catch (err) {}
  blob.setName(fileName);
  return folder.createFile(blob);
}

function driveImageToMmsPayload_(file) {
  if (!file) throw new Error("건물주 추천 이미지 파일이 없습니다.");
  const thumbnail = makeOwnerRecommendationMmsBlob_(file.getId(), file.getName());
  if (!thumbnail || !thumbnail.blob) {
    throw new Error("추천 이미지를 MMS 허용 해상도(최대 800px)로 축소하지 못했습니다.");
  }
  const blob = thumbnail.blob;
  const bytes = blob.getBytes();
  if (bytes.length > 300 * 1024) throw new Error("생성된 추천 이미지가 SENS MMS 첨부 제한 300KB를 초과했습니다.");
  return {
    fileName: thumbnail.name || makeSensImageName_(file.getName()),
    fileBody: Utilities.base64Encode(bytes),
    byteSize: bytes.length
  };
}

function makeOwnerRecommendationMmsBlob_(fileId, originalName) {
  try {
    const metadata = Drive.Files.get(fileId, { fields: "thumbnailLink,name" });
    const thumbnailLink = String(metadata && metadata.thumbnailLink || "").trim();
    const thumbnailLinks = [
      thumbnailLink,
      "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w800-h800"
    ].filter(Boolean);
    const sizes = [800, 720, 640, 560, 480];
    const requestOptions = [
      { method: "get", headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true },
      { method: "get", muteHttpExceptions: true, followRedirects: true }
    ];
    for (const size of sizes) {
      for (const baseUrl of thumbnailLinks) {
        let url = baseUrl;
        if (/=s\d+/.test(url)) url = url.replace(/=s\d+[^&]*/, "=s" + size);
        else if (/sz=w\d+-h\d+/.test(url)) url = url.replace(/sz=w\d+-h\d+/, "sz=w" + size + "-h" + size);
        for (const options of requestOptions) {
          const response = UrlFetchApp.fetch(url, options);
          if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) continue;
          const source = response.getBlob();
          const type = String(source.getContentType() || "").toLowerCase();
          if (type.indexOf("image/") !== 0) continue;
          let blob = source;
          try { blob = source.getAs("image/jpeg"); } catch (err) { continue; }
          if (blob.getBytes().length <= 300 * 1024) {
            blob.setName(makeSensImageName_(originalName));
            return { blob: blob, name: blob.getName(), maxDimension: size };
          }
        }
      }
    }
  } catch (err) {
    Logger.log("추천 견적 MMS 이미지 축소 실패: " + err.message);
  }
  return null;
}

function updateOwnerRecommendationMmsCase_(caseId, casePayload, result) {
  const timestamp = new Date().toISOString();
  result = result || {};
  const previousResult = casePayload.ownerRecommendationMms || {};
  if (!result.preview && previousResult.preview) result.preview = previousResult.preview;
  const deliveryAccepted = result.deliveryAccepted === true || result.status === "sent_pending_confirmation";
  const deliveryConfirmed = deliveryAccepted || result.deliveryConfirmed === true || (result.ok === true && result.status === "sent");
  const safeCompletion = deliveryConfirmed && ownerDecisionLinkReady_(casePayload, result);
  if (safeCompletion) {
    result.ok = true;
    result.status = "sent";
    result.deliveryAccepted = true;
    result.deliveryConfirmed = true;
    result.confirmedAt = result.confirmedAt || timestamp;
  }
  result.updatedAt = timestamp;
  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.ownerRecommendationMms = result;
  casePayload.status.c8 = safeCompletion ? "done" : "doing";
  if (safeCompletion && casePayload.status.c9 !== "done") {
    casePayload.status.c9 = "doing";
  } else if (!safeCompletion && casePayload.status.c9 !== "done") {
    casePayload.status.c9 = "wait";
  }
  if (deliveryConfirmed && !safeCompletion) {
    result.sensDeliveryAccepted = true;
    result.ok = false;
    result.status = "blocked";
    result.deliveryAccepted = false;
    result.deliveryConfirmed = false;
    result.statusText = "추천 알림 발송 기록과 검증된 승인 링크가 일치하지 않아 ⑧ 단계에서 다시 확인합니다.";
  }
  casePayload.note.c8 = makeOwnerRecommendationMmsNote_(result);
  casePayload.log.unshift("건물주 추천 알림 " + (result.ok ? "발송완료" : "발송보류") + " / " + (result.statusText || ""));
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  putCaseChildToFirebase_(caseId, "ownerRecommendationMms", result);
  patchCaseChildToFirebase_(caseId, "status", {
    c8: casePayload.status.c8,
    c9: casePayload.status.c9 || null
  });
  patchCaseChildToFirebase_(caseId, "note", { c8: casePayload.note.c8 });
  putCaseChildToFirebase_(caseId, "recommendation", {
    quoteId: result.quoteId || "",
    vendorName: result.vendorName || "",
    selectionAmount: result.originalTotalAmount || 0,
    criterion: "lowest_original_amount",
    updatedAt: timestamp
  });
  patchCaseToFirebase_(caseId, { log: casePayload.log, updatedAt: timestamp });
  {
    const automationState = Object.assign({}, casePayload.automationState || {});
    automationState.ownerRecommendationMms = {
      ok: safeCompletion,
      status: safeCompletion ? "sent" : (result.status || "blocked"),
      deliveryAccepted: safeCompletion,
      deliveryConfirmed: safeCompletion,
      requestId: result.requestId || "",
      messageId: result.messageId || "",
      provider: result.provider || "",
      templateCode: result.templateCode || "",
      requestKey: result.requestKey || "",
      quoteId: result.quoteId || "",
      vendorName: result.vendorName || "",
      originalTotalAmount: result.originalTotalAmount || 0,
      bringTotalAmount: result.bringTotalAmount || 0,
      ownerPhoneMasked: result.ownerPhoneMasked || "",
      imageFileId: result.imageFileId || "",
      imageFileUrl: result.imageFileUrl || "",
      imageFileName: result.imageFileName || "",
      decisionUrl: result.decisionUrl || "",
      decisionStatus: result.decisionStatus || "",
      decisionLinkValidated: result.decisionLinkValidated === true,
      statusText: result.statusText || (safeCompletion ? "건물주 추천 알림 발송 완료" : "승인 링크 확인 필요"),
      confirmedAt: safeCompletion ? (result.confirmedAt || timestamp) : "",
      updatedAt: timestamp,
      build: AUTOMATION_BUILD
    };
    patchCaseChildToFirebase_(caseId, "automationState", automationState);
  }
  const workflow = advanceCaseWorkflow_(caseId, { source: "owner_mms", skipOwnerAutoSend: true });
  return Object.assign({ caseId: caseId, workflow: workflow }, result);
}

function checkpointOwnerRecommendationMmsCase_(caseId, casePayload, result) {
  const timestamp = new Date().toISOString();
  const previousResult = casePayload.ownerRecommendationMms || {};
  const checkpoint = Object.assign({}, result, {
    ok: false,
    status: "sending",
    statusText: "건물주 추천 알림 발송 요청을 처리하고 있습니다.",
    deliveryAccepted: false,
    deliveryConfirmed: false,
    sendAttemptedAt: timestamp,
    updatedAt: timestamp
  });
  if (!checkpoint.preview && previousResult.preview) checkpoint.preview = previousResult.preview;

  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.status.c8 = "doing";
  casePayload.note.c8 = "건물주 추천 알림 발송을 처리하고 있습니다.";
  casePayload.ownerRecommendationMms = checkpoint;

  putCaseChildToFirebase_(caseId, "ownerRecommendationMms", checkpoint);
  patchCaseChildToFirebase_(caseId, "status", { c8: "doing" });
  patchCaseChildToFirebase_(caseId, "note", { c8: casePayload.note.c8 });
  patchCaseToFirebase_(caseId, { updatedAt: timestamp });
  return checkpoint;
}

function patchOwnerRecommendationCaseWithRetry_(caseId, patch) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      patchCaseToFirebase_(caseId, patch);
      return;
    } catch (err) {
      lastError = err;
      Logger.log("건물주 추천 MMS Firebase 저장 재시도 " + attempt + "/3: " + err.message);
      if (attempt < 3) Utilities.sleep(attempt * 500);
    }
  }
  throw lastError || new Error("건물주 추천 MMS Firebase 저장 실패");
}

function makeOwnerRecommendationMmsNote_(result) {
  const deliveryConfirmed = result.deliveryConfirmed === true || (result.ok === true && result.status === "sent");
  const deliveryAccepted = result.deliveryAccepted === true || result.status === "sent_pending_confirmation";
  const lines = [
    "[건물주 추천 알림]",
    "상태: " + (deliveryConfirmed ? "발송완료" : deliveryAccepted ? "발송 요청 완료 · 수신 확인 필요" : "진행중/보류"),
    result.statusText || "",
    result.vendorName ? "추천 업체: " + result.vendorName : "",
    result.bringTotalAmount ? "브링 추천금액: " + ownerRecommendationAmountText_(result.bringTotalAmount) : "",
    result.ownerPhoneMasked ? "건물주 연락처: " + result.ownerPhoneMasked : "",
    result.imageFileUrl ? "첨부 이미지: " + result.imageFileUrl : "",
    result.ok ? "다음 단계: ⑨ 승인·입금 진행중" : ""
  ];
  return lines.filter(Boolean).join("\n");
}

function readCaseFromFirebase_(caseId) {
  const response = UrlFetchApp.fetch(firebaseCaseUrl_(caseId), {
    method: "get",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
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
      const contentType = String(blob.getContentType() || "").toLowerCase();
      const isImage = /^image\//i.test(contentType);
      const isJpeg = /jpe?g$/i.test(name) || /jpeg/i.test(contentType);
      if (!isImage && !isJpeg) {
        errors.push(name + ": 이미지 파일이 아님");
        continue;
      }

      const originalBytes = blob.getBytes();
      const thumbnail = !isJpeg || originalBytes.length > 300 * 1024
        ? makeSensThumbnailBlob_(id, name)
        : null;
      if (!isJpeg && !thumbnail) {
        errors.push(name + ": MMS용 JPG 이미지로 변환하지 못함");
        continue;
      }
      const bytes = thumbnail ? thumbnail.blob.getBytes() : originalBytes;
      const outputName = thumbnail ? thumbnail.name : makeSensImageName_(name);
      if (bytes.length > 300 * 1024) {
        errors.push(name + ": SENS MMS 첨부 제한 300KB 초과");
        continue;
      }

      return {
        ok: true,
        driveFileId: id,
        fileName: outputName,
        fileBody: Utilities.base64Encode(bytes),
        byteSize: bytes.length
      };
    } catch (err) {
      errors.push(id + ": " + err.message);
    }
  }

  return { ok: false, message: "MMS로 보낼 수 있는 현장 사진을 찾지 못했습니다. " + errors.join(" / ") };
}

function makeSensThumbnailBlob_(fileId, originalName) {
  try {
    // DriveApp's thumbnail is a reliable fallback when the Advanced Drive
    // Service does not expose a usable thumbnailLink for a form upload.
    const driveFile = DriveApp.getFileById(fileId);
    const directThumbnail = driveFile.getThumbnail();
    if (directThumbnail) {
      const directType = String(directThumbnail.getContentType() || "").toLowerCase();
      const directBytes = directThumbnail.getBytes();
      if (directBytes.length <= 300 * 1024 && /jpe?g/.test(directType)) {
        return { blob: directThumbnail, name: makeSensImageName_(originalName) };
      }
    }

    if (typeof Drive === "undefined" || !Drive.Files || !Drive.Files.get) return null;
    const metadata = Drive.Files.get(fileId, { fields: "thumbnailLink,name" });
    const thumbnailLink = String(metadata && metadata.thumbnailLink || "").trim();
    const thumbnailLinks = [
      thumbnailLink,
      "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w800-h800"
    ].filter(Boolean);
    if (!thumbnailLinks.length) return null;

    const sizes = [640, 480, 360, 240, 180, 120];
    for (const size of sizes) {
      for (const baseUrl of thumbnailLinks) {
        let url = baseUrl;
        if (/=s\d+$/.test(url)) url = url.replace(/=s\d+$/, "=s" + size);
        else if (/sz=w\d+-h\d+/.test(url)) url = url.replace(/sz=w\d+-h\d+/, "sz=w" + size + "-h" + size);
        const requestOptions = [
          { method: "get", headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true },
          { method: "get", muteHttpExceptions: true }
        ];
        for (const options of requestOptions) {
          const response = UrlFetchApp.fetch(url, options);
          const code = response.getResponseCode();
          if (code < 200 || code >= 300) continue;
          const blob = response.getBlob();
          const contentType = String(blob.getContentType() || "").toLowerCase();
          if (contentType && contentType.indexOf("jpeg") < 0 && contentType.indexOf("jpg") < 0) continue;
          if (blob.getBytes().length <= 300 * 1024) {
            return { blob: blob, name: makeSensImageName_(originalName) };
          }
        }
      }
    }
  } catch (err) {
    Logger.log("SENS MMS photo resize failed: " + err.message);
  }
  return null;
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
  if (!response.ok) return { ok: false, message: "MMS 발송실패(" + label + "): " + response.message };
  const receipt = sensResponseReceipt_(response.json);
  return {
    ok: true,
    message: "MMS 발송요청 완료(" + label + ")",
    requestId: receipt.requestId,
    statusCode: receipt.statusCode,
    statusName: receipt.statusName,
    responseCode: response.code
  };
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

function sensGetJson_(uri, config) {
  const timestamp = String(Date.now());
  const signature = makeNcpSignature_("GET", uri, timestamp, config.accessKey, config.secretKey);
  try {
    const response = UrlFetchApp.fetch("https://sens.apigw.ntruss.com" + uri, {
      method: "get",
      headers: {
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": config.accessKey,
        "x-ncp-apigw-signature-v2": signature
      },
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

function sensResponseReceipt_(json) {
  json = json && typeof json === "object" ? json : {};
  return {
    requestId: String(json.requestId || json.requestID || ""),
    statusCode: String(json.statusCode || ""),
    statusName: String(json.statusName || json.status || "")
  };
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
    mobile: String(vendor.mobile || ""),
    tel: String(vendor.tel || ""),
    map: String(vendor.map || ""),
    promo: String(vendor.promo || ""),
    note: String(vendor.note || "")
  };
}

function vendorSmsPhone_(vendor) {
  const raw = [vendor.phone, vendor.mobile, vendor.tel].filter(Boolean).join("\n");
  const phones = extractPhones_(raw);
  return phones.find(phone => /^01[016789]\d{7,8}$/.test(phone)) || "";
}

function extractPhones_(value) {
  const matches = String(value || "").match(/(?:\+?82[-.\s]?)?0?\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || [];
  return [...new Set(matches.map(normalizePhoneForSms_).filter(phone => phone.length >= 9 && phone.length <= 11))];
}

function getVendorQuoteReplyEmail_() {
  const props = PropertiesService.getScriptProperties();
  return String(
    props.getProperty("VENDOR_QUOTE_REPLY_EMAIL") ||
    COMPLAINT_CONFIG.VENDOR_QUOTE_REPLY_EMAIL ||
    ""
  ).trim();
}

function vendorQuoteSymptom_(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const marker = text.indexOf(" - ");
  return marker >= 0 ? text.slice(marker + 3).trim() : text;
}

function makeVendorEstimateMmsContent_(casePayload, record) {
  const replyEmail = getVendorQuoteReplyEmail_() || "회신 이메일 미설정";
  const building = readField_(record, ["건물명", "건물"]) || casePayload.building || "건물 미입력";
  const room = readField_(record, ["호실"]) || casePayload.room || "";
  const issueType = readField_(record, ["문제 유형"]) || casePayload.issueType || casePayload.vendorType || "시설";
  const subject = [building, room, issueType, "유지보수 민원 건"].filter(Boolean).join(" ");
  const symptom = readField_(record, ["증상 설명", "민원 내용", "내용"]) || vendorQuoteSymptom_(casePayload.summary) || "미입력";
  const visitTime = formatVisitTimeFromRecord_(record) || casePayload.visitTime || "미입력";
  return [
    "[BRING Care 견적서 회신 요청]",
    "",
    "안녕하세요. BRING Care입니다.",
    "",
    "첨부된 현장 사진과 아래 내용을 확인하신 후,",
    "작업 가능 여부와 견적서를 아래 이메일로 회신 부탁드립니다.",
    "",
    "회신 이메일: " + replyEmail,
    "",
    "■ 민원 내용",
    "- 증상: " + symptom,
    "- 방문 가능 시간대: " + visitTime,
    "",
    "■ 회신 요청 내용",
    "- 작업 가능 여부",
    "- 예상 작업 내용",
    "- 총 견적금액",
    "- 방문 가능 일정",
    "",
    "■ 첨부 요청",
    "- 견적서",
    "- 사업자등록증 사본",
    "",
    "확인 후 회신 부탁드립니다.",
    "감사합니다."
  ].join("\n");
}

function updateVendorMmsCase_(caseId, casePayload, result) {
  const timestamp = new Date().toISOString();
  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  if (result.ok === true) {
    result.completedAt = result.completedAt || timestamp;
    result.stepTransition = {
      completed: "c5",
      opened: "c6",
      completedAt: result.completedAt
    };
  }
  casePayload.vendorEstimateMms = result;
  casePayload.note.c5 = makeVendorMmsNote_(result);
  casePayload.status.c5 = result.ok === true ? "done" : "doing";
  if (result.ok === true && casePayload.status.c6 !== "done") {
    casePayload.status.c6 = "doing";
  }
  casePayload.updatedAt = timestamp;
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
  const automationState = Object.assign({}, casePayload.automationState || {});
  automationState.vendorEstimateMms = {
    ok: result.ok === true,
    status: result.status || "",
    requestKey: result.requestKey || "",
    requestIds: (result.sent || []).map(item => item.requestId || "").filter(Boolean),
    sentCount: (result.sent || []).length,
    failedCount: (result.failed || []).length,
    skippedCount: (result.skipped || []).length,
    completedAt: result.ok === true ? (result.completedAt || timestamp) : "",
    updatedAt: timestamp,
    build: AUTOMATION_BUILD
  };
  patchCaseChildToFirebase_(caseId, "automationState", automationState);
  const workflow = advanceCaseWorkflow_(caseId, { source: "vendor_mms", skipOwnerAutoSend: true });
  return Object.assign({ caseId: caseId, workflow: workflow }, result);
}

function makeVendorMmsNote_(result) {
  const lines = [
    "[업체 MMS 견적 요청]",
    "상태: " + (result.ok ? "발송완료" : "진행중/보류"),
    result.statusText || "",
    result.ok ? "다음 단계: ⑥ 견적 비교 진행중" : "",
    result.photoName ? "사진: " + result.photoName : "",
    result.sensFileId ? "SENS 파일 ID: " + result.sensFileId : ""
  ].filter(Boolean);

  if (result.sent && result.sent.length) {
    lines.push("");
    lines.push("[발송 완료]");
    result.sent.forEach(item => {
      const tracking = item.requestId ? " / 요청ID: " + item.requestId : "";
      const sensStatus = item.statusCode || item.statusName ? " / SENS: " + [item.statusCode, item.statusName].filter(Boolean).join(" ") : "";
      lines.push("- " + item.name + " / " + item.phoneMasked + " / " + item.message + tracking + sensStatus);
    });
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
  const analysisFolder = null;
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
  if (quote.bringQuoteXlsxUrl) {
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
  recordUploadBatchProgress_(caseId, payload);
  const workflow = advanceCaseWorkflow_(caseId, {
    source: "quote_upload",
    uploadBatchId: String(payload.uploadBatchId || ""),
    uploadBatchComplete: payload.uploadBatchId ? payload.uploadBatchComplete === true : true
  });

  return { ok: true, caseId: caseId, quote: quote, workflow: workflow, message: "견적 파일 업로드 및 브링 양식 처리 완료" };
}

function handleBusinessRegistrationUpload_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const filePayload = payload.file || {};
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const validation = validateBusinessRegistrationUpload_(filePayload);
  if (!validation.ok) {
    return updateBusinessRegistrationUploadFailure_(caseId, casePayload, validation.message);
  }

  const uploadedAt = new Date().toISOString();
  const docId = "br" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + "-" + Utilities.getUuid().slice(0, 8);
  const bytes = Utilities.base64Decode(String(filePayload.fileBody || "").replace(/^data:[^,]+,/, ""));
  const mimeType = filePayload.mimeType || inferQuoteMimeType_(filePayload.fileName);
  const blob = Utilities.newBlob(bytes, mimeType, safeDriveName_(filePayload.fileName || "business-registration"));
  const analysis = extractBusinessRegistrationData_(blob, mimeType, filePayload.fileName, casePayload, null);
  const vendorInfo = cleanVendorInfo_(analysis.vendorInfo || {});
  const match = matchBusinessRegistrationVendor_(vendorInfo, payload, casePayload);
  const finalVendorName = vendorInfo.name || match.vendorName || "";
  const folder = getBusinessRegistrationDriveFolder_(casePayload, finalVendorName);
  const savedName = makeBusinessRegistrationDriveFileName_(casePayload, finalVendorName, filePayload.fileName);
  const driveFile = folder.createFile(blob.setName(savedName));

  const doc = {
    id: docId,
    vendorId: match.vendorId || "",
    vendorName: finalVendorName,
    matchedVendorName: match.vendorName || "",
    matchStatus: match.status,
    matchMemo: match.memo,
    statusText: match.status === "matched" ? "업체 자동 연결" : match.status === "multiple" ? "업체 연결 확인 필요" : "업체 연결 확인 필요",
    businessNo: vendorInfo.businessNo || "",
    ceo: vendorInfo.ceo || "",
    address: vendorInfo.address || "",
    type: vendorInfo.type || "",
    category: vendorInfo.category || "",
    phone: vendorInfo.phone || "",
    email: vendorInfo.email || "",
    extractionStatus: analysis.status,
    extractionMemo: analysis.memo,
    extractionTextPreview: analysis.textPreview || "",
    analysisEngine: analysis.analysisEngine || "",
    analysisStatus: analysis.analysisStatus || "",
    analysisStatusCode: analysis.analysisStatusCode || "",
    analysisWarnings: analysis.analysisWarnings || [],
    analysisMarkdownUrl: analysis.analysisMarkdownUrl || "",
    analysisMarkdownFileId: analysis.analysisMarkdownFileId || "",
    analysisJsonUrl: analysis.analysisJsonUrl || "",
    analysisJsonFileId: analysis.analysisJsonFileId || "",
    mineruSupplementAttempted: !!analysis.mineruSupplementMessage,
    mineruSupplementUsed: !!analysis.mineruSupplementUsed,
    mineruSupplementMessage: analysis.mineruSupplementMessage || "",
    supplierMissingFields: analysis.supplierMissingFields || [],
    fileName: driveFile.getName(),
    fileUrl: driveFile.getUrl(),
    driveFileId: driveFile.getId(),
    originalFileName: String(filePayload.fileName || driveFile.getName()),
    mimeType: mimeType,
    size: Number(filePayload.size || bytes.length),
    uploadedAt: uploadedAt
  };

  casePayload.businessRegistrationFiles = casePayload.businessRegistrationFiles && typeof casePayload.businessRegistrationFiles === "object" && !Array.isArray(casePayload.businessRegistrationFiles)
    ? casePayload.businessRegistrationFiles
    : {};
  casePayload.businessRegistrationFiles[docId] = doc;
  const refreshResult = refreshBringQuotesFromBusinessRegistration_(caseId, casePayload, doc, uploadedAt);
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("사업자등록증 업로드: " + (finalVendorName || "업체 연결 확인 필요") + " / " + driveFile.getName());
  if (refreshResult.updated) {
    casePayload.log.unshift("사업자등록증 정보로 브링 엑셀 보충: " + refreshResult.updated + "건");
  }
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = uploadedAt;

  putCaseChildToFirebase_(caseId, "businessRegistrationFiles/" + docId, doc);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: uploadedAt
  });
  recordUploadBatchProgress_(caseId, payload);
  const workflow = advanceCaseWorkflow_(caseId, {
    source: "business_registration_upload",
    uploadBatchId: String(payload.uploadBatchId || ""),
    uploadBatchComplete: payload.uploadBatchId ? payload.uploadBatchComplete === true : true
  });

  return { ok: true, caseId: caseId, businessRegistration: doc, refreshedQuotes: refreshResult.updated, workflow: workflow, message: "사업자등록증 업로드 및 업체 정보 분석 완료" };
}

function handleWorkPhotoUpload_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const phase = String(payload.phase || "").trim().toLowerCase();
  const filePayload = payload.file || {};
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  if (phase !== "before" && phase !== "after") return { ok: false, message: "작업 사진 구분이 올바르지 않습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const validation = validateWorkPhotoUpload_(filePayload);
  if (!validation.ok) return updateWorkPhotoUploadFailure_(caseId, casePayload, validation.message);

  const now = new Date();
  const uploadedAt = now.toISOString();
  const phaseText = phase === "after" ? "작업 후" : "작업 전";
  const photoId = "wp" + Utilities.formatDate(now, "Asia/Seoul", "yyyyMMddHHmmss") + "-" + Utilities.getUuid().slice(0, 8);
  const bytes = Utilities.base64Decode(String(filePayload.fileBody || "").replace(/^data:[^,]+,/, ""));
  const mimeType = String(filePayload.mimeType || "").trim() || inferWorkPhotoMimeType_(filePayload.fileName);
  const savedName = makeWorkPhotoDriveFileName_(casePayload, phaseText, filePayload.fileName, now);
  const blob = Utilities.newBlob(bytes, mimeType, savedName);
  const folder = getWorkPhotoDriveFolder_(casePayload, phase);
  const driveFile = folder.createFile(blob);

  const photo = {
    id: photoId,
    phase: phase,
    phaseText: phaseText,
    fileName: driveFile.getName(),
    originalFileName: String(filePayload.fileName || driveFile.getName()),
    fileUrl: driveFile.getUrl(),
    driveFileId: driveFile.getId(),
    mimeType: mimeType,
    size: Number(filePayload.size || bytes.length),
    uploadedAt: uploadedAt
  };

  casePayload.workPhotoFiles = casePayload.workPhotoFiles && typeof casePayload.workPhotoFiles === "object" && !Array.isArray(casePayload.workPhotoFiles)
    ? casePayload.workPhotoFiles
    : {};
  casePayload.workPhotoFiles[photoId] = photo;
  const photos = Object.keys(casePayload.workPhotoFiles).map(key => casePayload.workPhotoFiles[key]).filter(Boolean);
  const beforeCount = photos.filter(item => item.phase === "before").length;
  const afterCount = photos.filter(item => item.phase === "after").length;

  casePayload.status = casePayload.status || {};
  if (casePayload.status.c13 !== "done") casePayload.status.c13 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c13 = [
    "[작업 사진]",
    "작업 전: " + beforeCount + "장",
    "작업 후: " + afterCount + "장",
    "⑭ B/A 보고서에서 자동 참조됩니다."
  ].join("\n");
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift(phaseText + " 사진 업로드: " + driveFile.getName());
  if (casePayload.log.length > 30) casePayload.log.length = 30;

  putCaseChildToFirebase_(caseId, "workPhotoFiles/" + photoId, photo);
  patchCaseChildToFirebase_(caseId, "status", { c13: casePayload.status.c13 });
  patchCaseChildToFirebase_(caseId, "note", { c13: casePayload.note.c13 });
  patchCaseToFirebase_(caseId, { log: casePayload.log, updatedAt: uploadedAt });

  return {
    ok: true,
    caseId: caseId,
    photo: photo,
    counts: { before: beforeCount, after: afterCount },
    message: phaseText + " 사진 저장 완료"
  };
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
    const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
    SpreadsheetApp.flush();
    if (fillResult && fillResult.vendor && fillResult.vendor.name) {
      quote.vendor = fillResult.vendor;
      quote.resolvedVendorInfo = fillResult.vendor;
      quote.vendorName = fillResult.vendor.name;
      quote.vendorInfoSource = fillResult.businessApplied ? "business_registration" : quote.vendorInfoSource;
    }
    const sheetAmounts = readBringQuoteAmounts_(ss);
    if (sheetAmounts.totalAmount) {
      quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
      quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
      quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
      quote.bringQuoteBaseTotalAmount = Number(quote.confirmedTotalAmount || quote.bringQuoteBaseTotalAmount || quote.totalAmount || amounts.totalAmount || 0);
      quote.bringQuoteBaseSupplyAmount = Number(quote.confirmedSupplyAmount || quote.bringQuoteBaseSupplyAmount || quote.supplyAmount || amounts.supplyAmount || 0);
      quote.bringQuoteBaseVatAmount = Number(quote.confirmedVatAmount || quote.bringQuoteBaseVatAmount || quote.vatAmount || amounts.vatAmount || 0);
      quote.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
      quote.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - quote.bringQuoteBaseTotalAmount);
      quote.bringQuoteItems = fillResult && fillResult.bringItems || quote.bringQuoteItems || [];
      quote.bringQuoteAmountSyncedAt = confirmedAt;
    }

    quote.bringQuoteStatus = "confirmed_rewritten";
    quote.bringQuoteType = "confirmed";
    quote.bringQuoteSheetName = "";
    quote.bringQuoteSheetUrl = "";
    quote.bringQuoteSheetId = "";
    quote.extractionStatus = "추출완료";
    quote.extractionMemo = appendQuoteMemo_(removeQuoteMemo_(quote.extractionMemo, "금액 확인 필요"), "관리자 확정 금액으로 브링 양식 재작성");
    if (fillResult && fillResult.businessApplied) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보로 브링 엑셀 빈칸 보충");
      quote.businessRegistrationAppliedAt = confirmedAt;
      quote.businessRegistrationDocId = fillResult.businessVendor && fillResult.businessVendor.docId || quote.businessRegistrationDocId || "";
    }
    if (fillResult && fillResult.mineruSupplementApplied) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
    }
    quote.extractedItems = extraction.items;

    const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
    const exported = exportBringQuoteXlsx_(sheetId, fileNameBase + ".xlsx", bringFolder);
    if (exported.ok) {
      quote.bringQuoteXlsxName = exported.fileName;
      quote.bringQuoteXlsxUrl = exported.fileUrl;
      quote.bringQuoteXlsxId = exported.fileId;
    } else {
      quote.bringQuoteStatus = "xlsx_failed";
      quote.bringQuoteType = "failed";
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "XLSX 내보내기 실패: " + exported.message);
    }
    trashDriveFileQuietly_(sheetFile);
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

  const workflow = advanceCaseWorkflow_(caseId, {
    source: "quote_amount_confirm",
    uploadBatchComplete: true
  });
  return { ok: true, caseId: caseId, quoteId: quoteId, quote: quote, workflow: workflow, message: rewriteMessage };
}

function handleApplyBusinessRegistrationToQuote_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const quoteId = String(payload.quoteId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  if (!quoteId) return { ok: false, message: "quoteId가 없습니다." };

  const timestamp = new Date().toISOString();
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  casePayload.quoteFiles = casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  const quote = casePayload.quoteFiles[quoteId];
  if (!quote) return { ok: false, caseId: caseId, quoteId: quoteId, message: "견적 파일을 찾지 못했습니다." };

  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  let message = "사업자등록증 정보 반영 완료";
  if (!templateId) {
    quote.bringQuoteStatus = "template_missing";
    quote.bringQuoteType = "missing";
    quote.extractionStatus = quote.extractionStatus || "확인필요";
    quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "브링 양식 템플릿 설정 필요");
    message = "브링 양식 템플릿 설정 필요";
  } else {
    const businessVendor = findBusinessRegistrationForQuote_(casePayload, quote, quote.vendorName || quote.extractedVendorName || "");
    if (!(businessVendor && (businessVendor.docId || businessVendor.name || businessVendor.businessNo))) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 매칭 없음");
      message = "사업자등록증 매칭 없음";
    } else {
      const folder = getQuoteDriveFolder_(casePayload);
      const bringFolder = getOrCreateChildFolder_(folder, "브링 양식 견적서");
      const extraction = makeQuoteRewriteExtraction_(quote, casePayload);
      const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
      const previousXlsxId = String(quote.bringQuoteXlsxId || "");
      let sheetFile = null;
      try {
        sheetFile = DriveApp.getFileById(templateId).makeCopy(fileNameBase, bringFolder);
        const ss = SpreadsheetApp.openById(sheetFile.getId());
        const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
        SpreadsheetApp.flush();

        if (fillResult && fillResult.vendor && fillResult.vendor.name) {
          quote.vendor = fillResult.vendor;
          quote.resolvedVendorInfo = fillResult.vendor;
          quote.vendorName = fillResult.vendor.name;
          quote.vendorInfoSource = fillResult.businessApplied ? "business_registration" : quote.vendorInfoSource;
        }

        const exported = exportBringQuoteXlsx_(sheetFile.getId(), fileNameBase + ".xlsx", bringFolder);
        if (exported.ok) {
          quote.bringQuoteXlsxName = exported.fileName;
          quote.bringQuoteXlsxUrl = exported.fileUrl;
          quote.bringQuoteXlsxId = exported.fileId;
          if (previousXlsxId && previousXlsxId !== exported.fileId) trashDriveFileByIdQuietly_(previousXlsxId);
        } else {
          quote.bringQuoteStatus = "xlsx_failed";
          quote.bringQuoteType = "failed";
          quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 반영 XLSX 내보내기 실패: " + exported.message);
          message = "XLSX 내보내기 실패";
        }

        const sheetAmounts = readBringQuoteAmounts_(ss);
        if (sheetAmounts.totalAmount) {
          quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
          quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
          quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
          quote.bringQuoteBaseTotalAmount = Number(quote.confirmedTotalAmount || quote.bringQuoteBaseTotalAmount || quote.totalAmount || extraction.totalAmount || 0);
          quote.bringQuoteBaseSupplyAmount = Number(quote.confirmedSupplyAmount || quote.bringQuoteBaseSupplyAmount || quote.supplyAmount || extraction.supplyAmount || 0);
          quote.bringQuoteBaseVatAmount = Number(quote.confirmedVatAmount || quote.bringQuoteBaseVatAmount || quote.vatAmount || extraction.vatAmount || 0);
          quote.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
          quote.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - quote.bringQuoteBaseTotalAmount);
          quote.bringQuoteItems = fillResult && fillResult.bringItems || quote.bringQuoteItems || [];
          quote.bringQuoteAmountSyncedAt = timestamp;
        }

        if (quote.bringQuoteStatus !== "xlsx_failed") {
          quote.bringQuoteStatus = "business_registration_rewritten";
          quote.bringQuoteType = Number(quote.confirmedTotalAmount || 0) ? "confirmed" : "draft";
        }
        quote.extractionMemo = appendQuoteMemo_(removeQuoteMemo_(quote.extractionMemo, "사업자등록증 매칭 없음"), "사업자등록증 정보 반영 완료");
        quote.businessRegistrationAppliedAt = timestamp;
        quote.businessRegistrationDocId = fillResult && fillResult.businessVendor && fillResult.businessVendor.docId || businessVendor.docId || quote.businessRegistrationDocId || "";
        if (fillResult && fillResult.mineruSupplementApplied) {
          quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
        }
        quote.extractedItems = extraction.items;
      } catch (err) {
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보 반영 실패: " + err.message);
        message = "사업자등록증 정보 반영 실패: " + err.message;
      } finally {
        trashDriveFileQuietly_(sheetFile);
      }
    }
  }

  quote.updatedAt = timestamp;
  applyQuoteAmountState_(quote);
  casePayload.quoteFiles[quoteId] = quote;
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("사업자등록증 정보 반영: " + (quote.vendorName || "업체") + " / " + message);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = timestamp;

  putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: timestamp
  });

  return { ok: message.indexOf("실패") === -1 && message.indexOf("없음") === -1, caseId: caseId, quoteId: quoteId, quote: quote, message: message };
}

const BRING_QUOTE_MARKUP_RATE = 0.05;

function roundToHundred_(value) {
  const number = Number(value || 0);
  return number ? Math.round(number / 100) * 100 : 0;
}

function getBringQuoteBaseAmounts_(quote, extraction) {
  quote = quote || {};
  extraction = extraction || {};
  const total = Math.round(Number(
    quote.confirmedTotalAmount ||
    quote.bringQuoteBaseTotalAmount ||
    quote.totalAmount ||
    extraction.totalAmount ||
    parseMoneyValue_(quote.amount) ||
    0
  ));
  const supply = Math.round(Number(
    quote.confirmedSupplyAmount ||
    quote.bringQuoteBaseSupplyAmount ||
    quote.supplyAmount ||
    extraction.supplyAmount ||
    (total ? Math.round(total / 1.1) : 0)
  ));
  const vat = Math.round(Number(
    quote.confirmedVatAmount ||
    quote.bringQuoteBaseVatAmount ||
    quote.vatAmount ||
    extraction.vatAmount ||
    (total ? total - supply : 0)
  ));
  return { totalAmount: total, supplyAmount: supply, vatAmount: vat };
}

function calculateBringQuoteAmounts_(baseTotalAmount) {
  const baseTotal = Math.round(Number(baseTotalAmount || 0));
  if (!baseTotal || baseTotal < 1000) {
    return { baseTotalAmount: 0, totalAmount: 0, supplyAmount: 0, vatAmount: 0, markupRate: BRING_QUOTE_MARKUP_RATE, markupAmount: 0 };
  }
  const total = roundToHundred_(baseTotal * (1 + BRING_QUOTE_MARKUP_RATE));
  const supply = roundToHundred_(total / 1.1);
  const vat = total - supply;
  return {
    baseTotalAmount: baseTotal,
    totalAmount: total,
    supplyAmount: supply,
    vatAmount: vat,
    markupRate: BRING_QUOTE_MARKUP_RATE,
    markupAmount: total - baseTotal
  };
}

function scaleBringQuoteItems_(items, casePayload, baseAmounts, bringAmounts) {
  const sourceItems = normalizeBringQuoteItems_(items, casePayload, baseAmounts.totalAmount, baseAmounts.supplyAmount, baseAmounts.vatAmount);
  const usableItems = sourceItems.filter(item => item && !item.fallback && Number(item.total || 0));
  if (!bringAmounts.totalAmount || !usableItems.length) {
    return normalizeBringQuoteItems_([], casePayload, bringAmounts.totalAmount, bringAmounts.supplyAmount, bringAmounts.vatAmount);
  }

  const sourceTotal = usableItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  if (!sourceTotal) return normalizeBringQuoteItems_([], casePayload, bringAmounts.totalAmount, bringAmounts.supplyAmount, bringAmounts.vatAmount);

  let usedTotal = 0;
  let usedSupply = 0;
  return usableItems.map((item, index) => {
    const isLast = index === usableItems.length - 1;
    const ratio = Number(item.total || 0) / sourceTotal;
    const total = isLast ? bringAmounts.totalAmount - usedTotal : roundToHundred_(bringAmounts.totalAmount * ratio);
    const supply = isLast ? bringAmounts.supplyAmount - usedSupply : roundToHundred_(bringAmounts.supplyAmount * ratio);
    const vat = total - supply;
    usedTotal += total;
    usedSupply += supply;
    return {
      product: item.product || "",
      unit: item.unit || "식",
      unitPrice: supply || "",
      vat: vat || "",
      total: total || "",
      note: item.note || "원본 자동추출"
    };
  });
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
  const items = getQuoteItemsForRewrite_(quote, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);
  return {
    status: "추출완료",
    memo: "관리자 확정 금액",
    vendorName: quote.extractedVendorName || quote.vendorName || "",
    supplyAmount: amounts.supplyAmount,
    vatAmount: amounts.vatAmount,
    totalAmount: amounts.totalAmount,
    items: items
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

function validateBusinessRegistrationUpload_(filePayload) {
  const validation = validateQuoteUpload_(filePayload || {});
  if (validation.ok) return validation;
  return {
    ok: false,
    message: String(validation.message || "사업자등록증 파일을 확인해주세요.")
      .replace(/견적\s*파일/g, "사업자등록증 파일")
      .replace(/견적/g, "사업자등록증")
  };
}

function validateWorkPhotoUpload_(filePayload) {
  const fileName = String(filePayload.fileName || "").trim();
  const mimeType = String(filePayload.mimeType || "").trim().toLowerCase();
  const body = String(filePayload.fileBody || "").replace(/^data:[^,]+,/, "");
  const size = Number(filePayload.size || 0);
  const ext = fileName.split(".").pop().toLowerCase();
  if (!fileName) return { ok: false, message: "작업 사진 파일명이 없습니다." };
  if (!body) return { ok: false, message: "작업 사진 내용이 없습니다." };
  if (size > 5 * 1024 * 1024) return { ok: false, message: "작업 사진 용량이 5MB를 초과했습니다." };
  if (["jpg", "jpeg", "png", "webp"].indexOf(ext) === -1 && ["image/jpeg", "image/png", "image/webp"].indexOf(mimeType) === -1) {
    return { ok: false, message: "작업 사진은 JPG, PNG, WEBP 형식만 업로드할 수 있습니다." };
  }
  return { ok: true };
}

function updateWorkPhotoUploadFailure_(caseId, casePayload, message) {
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c13 !== "done") casePayload.status.c13 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c13 = "작업 사진 업로드 실패: " + message;
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("작업 사진 업로드 실패: " + message);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  const updatedAt = new Date().toISOString();
  patchCaseChildToFirebase_(caseId, "status", { c13: casePayload.status.c13 });
  patchCaseChildToFirebase_(caseId, "note", { c13: casePayload.note.c13 });
  patchCaseToFirebase_(caseId, { log: casePayload.log, updatedAt: updatedAt });
  return { ok: false, caseId: caseId, message: message };
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

function updateBusinessRegistrationUploadFailure_(caseId, casePayload, message) {
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = "사업자등록증 업로드 실패: " + message;
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("사업자등록증 업로드 실패: " + message);
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
  const quoteRoot = getQuoteDriveRootFolder_();
  return getOrCreateChildFolder_(quoteRoot, makeCaseDriveFolderName_(casePayload));
}

function getBusinessRegistrationDriveFolder_(casePayload, vendorName) {
  const caseFolder = getQuoteDriveFolder_(casePayload);
  return getOrCreateChildFolder_(caseFolder, "사업자등록증");
}

function getWorkPhotoDriveFolder_(casePayload, phase) {
  const caseFolder = getQuoteDriveFolder_(casePayload);
  const workFolder = getOrCreateChildFolder_(caseFolder, "작업 사진");
  return getOrCreateChildFolder_(workFolder, phase === "after" ? "작업 후" : "작업 전");
}

function getQuoteDriveRootFolder_() {
  const configured = extractDriveId_(COMPLAINT_CONFIG.QUOTE_DRIVE_FOLDER_ID);
  if (!configured) throw new Error("QUOTE_DRIVE_FOLDER_ID가 비어 있어 견적서 저장 폴더를 찾을 수 없습니다.");
  return DriveApp.getFolderById(configured);
}

function makeCaseDriveFolderName_(casePayload) {
  return safeDriveName_((casePayload.ticketNo || casePayload.id || "case") + "_" + (casePayload.building || "건물"));
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

function makeBusinessRegistrationDriveFileName_(casePayload, vendorName, originalName) {
  const extMatch = String(originalName || "").match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = [
    casePayload.ticketNo || casePayload.id || "case",
    vendorName || "업체확인필요",
    "사업자등록증"
  ].join("_");
  return safeDriveName_(base).slice(0, 120 - ext.length) + ext.toLowerCase();
}

function makeWorkPhotoDriveFileName_(casePayload, phaseText, originalName, date) {
  const extMatch = String(originalName || "").match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : ".jpg";
  const originalBase = String(originalName || "photo").replace(/\.[^.]+$/, "");
  const timestamp = Utilities.formatDate(date || new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
  const base = [
    casePayload.ticketNo || casePayload.id || "case",
    phaseText,
    timestamp,
    originalBase
  ].join("_");
  return safeDriveName_(base).slice(0, 150 - ext.length) + ext;
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
  const quoteName = chooseBestVendorName_(file.name, fileNameInfo.name, selected.name);
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

function chooseBestVendorName_() {
  const names = Array.prototype.slice.call(arguments)
    .map(cleanExtractedVendorName_)
    .filter(Boolean)
    .filter(name => !isGenericQuoteVendorName_(name));
  if (!names.length) return "";
  const unique = [];
  names.forEach(name => {
    if (!unique.some(item => vendorMatchKey_(item) === vendorMatchKey_(name))) unique.push(name);
  });
  const sorted = unique.slice().sort((a, b) => a.length - b.length);
  for (const shortName of sorted) {
    const shortKey = vendorMatchKey_(shortName);
    if (!shortKey) continue;
    const contained = unique.some(name => {
      const key = vendorMatchKey_(name);
      return key && key !== shortKey && key.indexOf(shortKey) !== -1;
    });
    if (contained) return shortName;
  }
  return unique[0];
}

function mergeVendorInfoObjects_(base, override) {
  base = cleanVendorInfo_(base || {});
  override = cleanVendorInfo_(override || {});
  return {
    id: override.id || base.id || "",
    docId: override.docId || base.docId || "",
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
    docId: String(info.docId || ""),
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

function vendorMatchKey_(value) {
  return String(value || "")
    .replace(/(\(\s*\uC8FC\s*\)|\u3231|\uC8FC\uC2DD\uD68C\uC0AC|\uC720\uD55C\uD68C\uC0AC|\uD569\uC790\uD68C\uC0AC|\uD569\uBA85\uD68C\uC0AC)/g, "")
    .replace(/[^\uAC00-\uD7A3a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function vendorNameLooseMatch_(left, right) {
  const a = vendorMatchKey_(left);
  const b = vendorMatchKey_(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
  return isSimilarVendorName_(left, right);
}

function extractBusinessRegistrationVendorNameFromFileName_(fileName) {
  let value = String(fileName || "").replace(/\.[^.]+$/, "");
  value = value
    .replace(/^BR-\d{4}-\d{4}[_\s-]*/i, "")
    .replace(/^\d+[_\s.-]*/, "")
    .replace(/\s*\uC0AC\uC5C5\uC790\s*\uB4F1\uB85D\uC99D.*$/g, "")
    .replace(/\s*\uC0AC\uC5C5\uC790\uB4F1\uB85D.*$/g, "")
    .replace(/\s*business\s*registration.*$/ig, "")
    .replace(/[_-]+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanExtractedVendorName_(value);
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

function extractBusinessRegistrationVendorInfoFromText_(text) {
  const source = String(text || "");
  const typeAndCategory = extractBusinessRegistrationTypeCategory_(source);
  return cleanVendorInfo_({
    name: extractBusinessRegistrationField_(source, ["상호", "상호명", "법인명", "회사명", "업체명", "사업체명"]),
    phone: extractBusinessRegistrationPhone_(source),
    businessNo: extractBusinessRegistrationBusinessNo_(source),
    ceo: extractBusinessRegistrationField_(source, ["대표자", "대표자명", "대표", "성명"]),
    address: extractBusinessRegistrationAddress_(source),
    type: typeAndCategory.type || extractBusinessRegistrationField_(source, ["업태"]),
    category: typeAndCategory.category || extractBusinessRegistrationField_(source, ["종목", "업종"]),
    email: extractQuoteEmail_(source),
    source: "business_registration"
  });
}

function extractBusinessRegistrationBusinessNo_(text) {
  const source = String(text || "");
  const labeled = extractBusinessRegistrationField_(source, ["사업자등록번호", "사업자 번호", "등록번호"]);
  const cleaned = cleanBusinessNo_(labeled);
  if (cleaned) return cleaned;
  const match = source.match(/[0-9]{3}[-.\s]?[0-9]{2}[-.\s]?[0-9]{5}/);
  return cleanBusinessNo_(match ? match[0] : "");
}

function extractBusinessRegistrationPhone_(text) {
  const labeled = extractBusinessRegistrationField_(text, ["전화번호", "전화", "연락처", "TEL", "Tel", "tel"]);
  return cleanQuotePhone_(labeled) || cleanQuotePhone_(text);
}

function extractBusinessRegistrationAddress_(text) {
  const value = extractBusinessRegistrationField_(text, ["사업장 소재지", "사업장 주소", "사업장소재지", "사업장주소", "본점 소재지", "본점소재지", "소재지", "주소"]);
  return cleanQuoteAddress_(value);
}

function extractBusinessRegistrationTypeCategory_(text) {
  const lines = normalizeQuoteTextLines_(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const type = restoreBusinessTypeSuffix_(extractBusinessRegistrationValueFromLine_(line, ["업태"], ["종목", "업종"]), line);
    const category = extractBusinessRegistrationValueFromLine_(line, ["종목", "업종"], ["업태"]);
    if (type || category) {
      return {
        type: cleanSimpleVendorField_(type),
        category: cleanSimpleVendorField_(category)
      };
    }
  }
  return { type: "", category: "" };
}

function restoreBusinessTypeSuffix_(type, line) {
  const cleaned = cleanSimpleVendorField_(type);
  if (!cleaned || /업$/.test(cleaned)) return cleaned;
  const compactLine = String(line || "").replace(/\s+/g, "");
  const compactType = cleaned.replace(/\s+/g, "");
  if (compactType && (compactLine.indexOf(compactType + "업종목") !== -1 || compactLine.indexOf(compactType + "업업종") !== -1)) {
    return cleaned + "업";
  }
  return cleaned;
}

function extractBusinessRegistrationField_(text, labels) {
  const lines = normalizeQuoteTextLines_(text);
  const labelsArray = sortBusinessRegistrationLabels_(Array.isArray(labels) ? labels : [labels]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const value = extractBusinessRegistrationValueFromLine_(line, labelsArray);
    if (value) return cleanBusinessRegistrationFieldValue_(value);
    if (!lineHasBusinessRegistrationLabel_(line, labelsArray)) continue;
    const next = lines[i + 1] || "";
    if (next && !lineHasBusinessRegistrationLabel_(next, businessRegistrationStopLabels_())) {
      const nextValue = cleanBusinessRegistrationFieldValue_(next);
      if (nextValue) return nextValue;
    }
  }
  return "";
}

function extractBusinessRegistrationValueFromLine_(line, labels, extraStopLabels) {
  const labelsArray = sortBusinessRegistrationLabels_(Array.isArray(labels) ? labels : [labels]);
  for (let i = 0; i < labelsArray.length; i++) {
    const label = labelsArray[i];
    const pattern = flexibleLabelPattern_(label);
    const regex = new RegExp(pattern + "\\s*[:：=\\-]?\\s*([\\s\\S]*)", "i");
    const match = String(line || "").match(regex);
    if (!match) continue;
    const stopLabels = businessRegistrationStopLabels_()
      .concat(extraStopLabels || [])
      .filter(stop => businessRegistrationLabelKey_(stop) !== businessRegistrationLabelKey_(label));
    const trimmed = trimBusinessRegistrationValueAtNextLabel_(match[1], stopLabels);
    const cleaned = cleanBusinessRegistrationFieldValue_(trimmed);
    if (cleaned) return cleaned;
  }
  return "";
}

function lineHasBusinessRegistrationLabel_(line, labels) {
  const compact = String(line || "").replace(/\s+/g, "");
  return (Array.isArray(labels) ? labels : [labels]).some(label => compact.indexOf(businessRegistrationLabelKey_(label)) !== -1);
}

function sortBusinessRegistrationLabels_(labels) {
  return (labels || []).slice().sort((a, b) => businessRegistrationLabelKey_(b).length - businessRegistrationLabelKey_(a).length);
}

function trimBusinessRegistrationValueAtNextLabel_(value, stopLabels) {
  let result = String(value || "");
  let cutAt = result.length;
  (stopLabels || []).forEach(label => {
    const pattern = businessRegistrationStopLabelPattern_(label);
    const regex = new RegExp(pattern + "\\s*[:：=\\-]?", "i");
    const match = result.match(regex);
    if (match && typeof match.index === "number" && match.index >= 0) {
      cutAt = Math.min(cutAt, match.index);
    }
  });
  return result.slice(0, cutAt);
}

function cleanBusinessRegistrationFieldValue_(value) {
  return String(value || "")
    .replace(/^[\s:：=\-·ㆍ|/\\]+/, "")
    .replace(/[□■✓✔]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function businessRegistrationStopLabels_() {
  return [
    "사업자등록번호", "사업자 번호", "등록번호", "상호", "상호명", "법인명", "회사명", "업체명",
    "대표자", "대표자명", "대표", "성명", "사업장 소재지", "사업장 주소", "사업장소재지",
    "사업장주소", "본점 소재지", "본점소재지", "소재지", "주소", "사업의 종류", "업태",
    "종목", "업종", "전화번호", "전화", "연락처", "TEL", "Tel", "tel", "팩스", "이메일",
    "전자우편", "개업연월일", "발급사유", "공동사업자"
  ];
}

function businessRegistrationLabelKey_(label) {
  return String(label || "").replace(/\s+/g, "");
}

function flexibleLabelPattern_(label) {
  return businessRegistrationLabelKey_(label).split("").map(escapeRegex_).join("\\s*");
}

function businessRegistrationStopLabelPattern_(label) {
  return escapeRegex_(String(label || "").trim()).replace(/\s+/g, "\\s*");
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
  extraction.items = normalizeBringQuoteItems_(extraction.items, casePayload, extraction.totalAmount, extraction.supplyAmount, extraction.vatAmount);
  const baseAmounts = getBringQuoteBaseAmounts_(quote, extraction);
  quote.vendor = resolvedVendor.vendor;
  quote.resolvedVendorInfo = resolvedVendor.vendor;
  quote.vendorInfoSource = resolvedVendor.source;
  quote.vendorName = resolvedVendor.vendor.name || "업체 확인 필요";
  const result = {
    extractionStatus: extraction.status,
    extractionMemo: extraction.memo,
    extractionTextPreview: extraction.textPreview,
    amount: formatMoney_(baseAmounts.totalAmount),
    sourceTotalAmount: baseAmounts.totalAmount || "",
    supplyAmount: baseAmounts.supplyAmount || "",
    vatAmount: baseAmounts.vatAmount || "",
    totalAmount: baseAmounts.totalAmount || "",
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

  let copied = null;
  try {
    const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
    const templateFile = DriveApp.getFileById(templateId);
    copied = templateFile.makeCopy(fileNameBase, bringFolder);
    const ss = SpreadsheetApp.openById(copied.getId());
    const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
    SpreadsheetApp.flush();
    const sheetAmounts = readBringQuoteAmounts_(ss);

    result.bringQuoteStatus = "draft_created";
    result.bringQuoteType = "draft";
    result.bringQuoteSheetName = "";
    result.bringQuoteSheetUrl = "";
    result.bringQuoteSheetId = "";
    if (sheetAmounts.totalAmount) {
      result.bringQuoteTotalAmount = sheetAmounts.totalAmount;
      result.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
      result.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
      result.bringQuoteBaseTotalAmount = baseAmounts.totalAmount || "";
      result.bringQuoteBaseSupplyAmount = baseAmounts.supplyAmount || "";
      result.bringQuoteBaseVatAmount = baseAmounts.vatAmount || "";
      result.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
      result.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - baseAmounts.totalAmount);
      result.bringQuoteItems = fillResult && fillResult.bringItems || [];
      result.amountSource = "bring_sheet";
      result.amountStatus = "확인필요";
      result.bringQuoteAmountSyncedAt = new Date().toISOString();
      result.extractionMemo = removeQuoteMemo_(result.extractionMemo, "금액 확인 필요");
    }
    if (fillResult && fillResult.businessApplied) {
      if (fillResult.vendor && fillResult.vendor.name) {
        result.vendor = fillResult.vendor;
        result.resolvedVendorInfo = fillResult.vendor;
        result.vendorName = fillResult.vendor.name;
        result.vendorInfoSource = "business_registration";
      }
      result.businessRegistrationAppliedAt = new Date().toISOString();
      result.businessRegistrationDocId = fillResult.businessVendor && fillResult.businessVendor.docId || "";
      result.extractionMemo = appendQuoteMemo_(result.extractionMemo, "사업자등록증 정보로 브링 엑셀 빈칸 보충");
    }
    if (fillResult && fillResult.mineruSupplementApplied) {
      result.extractionMemo = appendQuoteMemo_(result.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
    }

    const exported = exportBringQuoteXlsx_(copied.getId(), fileNameBase + ".xlsx", bringFolder);
    if (exported.ok) {
      result.bringQuoteXlsxName = exported.fileName;
      result.bringQuoteXlsxUrl = exported.fileUrl;
      result.bringQuoteXlsxId = exported.fileId;
    } else {
      result.bringQuoteStatus = "xlsx_failed";
      result.bringQuoteType = "failed";
      result.extractionMemo = [result.extractionMemo, "XLSX 내보내기 실패: " + exported.message].filter(Boolean).join(" / ");
    }
  } catch (err) {
    result.bringQuoteStatus = "template_failed";
    result.bringQuoteType = "failed";
    result.extractionStatus = result.extractionStatus === "추출완료" ? "확인필요" : result.extractionStatus;
    result.extractionMemo = [result.extractionMemo, "브링 양식 생성 실패: " + err.message].filter(Boolean).join(" / ");
  } finally {
    trashDriveFileQuietly_(copied);
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
      textPreview: text.replace(/\s+/g, " ").trim().slice(0, 5000),
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
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 5000),
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

function extractBusinessRegistrationData_(blob, mimeType, fileName, casePayload, analysisFolder) {
  const mineruResult = analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder);
  let text = "";
  let textMessage = "";
  let analysisEngine = mineruResult.skipped ? "local_fallback" : "mineru_fallback";
  let analysisStatus = mineruResult.ok ? "MinerU 분석완료" : (mineruResult.manual ? "수동확인" : "기본 분석");
  let analysisStatusCode = mineruResult.ok ? "mineru_ok" : (mineruResult.statusCode || "local_fallback");

  if (mineruResult.ok) {
    text = mineruResult.markdown || mineruResult.text || "";
    analysisEngine = "mineru";
  } else {
    const textResult = extractQuoteText_(blob, mimeType, fileName);
    text = textResult.text || "";
    textMessage = textResult.message || "";
    if (!textResult.ok && !mineruResult.message) analysisStatus = "추출실패";
  }

  let vendorInfo = extractBusinessRegistrationVendorInfo_(text, mineruResult, fileName);
  const mineruSupplement = analyzeBusinessRegistrationWithMinerUIfNeeded_(blob, mimeType, fileName, casePayload, vendorInfo, mineruResult);
  if (mineruSupplement && mineruSupplement.vendorInfo) {
    vendorInfo = mineruSupplement.vendorInfo;
  }
  const hasImportantInfo = !!(vendorInfo.name || vendorInfo.businessNo || vendorInfo.ceo || vendorInfo.address || vendorInfo.type || vendorInfo.category || vendorInfo.phone);
  const status = hasImportantInfo ? "추출완료" : "확인필요";
  const memo = [
    mineruResult.ok ? "MinerU 분석완료" : (mineruResult.message || ""),
    mineruSupplement && mineruSupplement.message ? mineruSupplement.message : "",
    textMessage,
    hasImportantInfo ? "" : "사업자등록증 핵심 정보를 자동 확인하지 못했습니다."
  ].filter(Boolean).join(" / ");

  return {
    status: status,
    memo: memo,
    text: text,
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 5000),
    vendorInfo: vendorInfo,
    analysisEngine: analysisEngine,
    analysisStatus: analysisStatus,
    analysisStatusCode: analysisStatusCode,
    analysisWarnings: (mineruResult.warnings || (mineruResult.message ? [mineruResult.message] : [])).concat(mineruSupplement && mineruSupplement.warnings || []),
    analysisMarkdownUrl: mineruResult.markdownUrl || "",
    analysisMarkdownFileId: mineruResult.markdownFileId || "",
    analysisJsonUrl: mineruResult.jsonUrl || "",
    analysisJsonFileId: mineruResult.jsonFileId || "",
    mineruSupplementUsed: !!(mineruSupplement && mineruSupplement.used),
    mineruSupplementMessage: mineruSupplement && mineruSupplement.message || "",
    supplierMissingFields: getMissingBringSupplierFields_(vendorInfo)
  };
}

function extractBusinessRegistrationVendorInfo_(text, mineruResult, fileName) {
  const source = String(text || "");
  const quoteInfo = extractQuoteVendorInfo_(source, mineruResult || {}, fileName);
  const structuredInfo = extractQuoteVendorInfoFromObject_(mineruResult || {});
  const businessInfo = extractBusinessRegistrationVendorInfoFromText_(source);
  const fileNameInfo = cleanVendorInfo_({
    name: extractBusinessRegistrationVendorNameFromFileName_(fileName) || extractQuoteVendorNameFromFileName_(fileName)
  });
  let merged = mergeVendorInfoObjects_(quoteInfo, structuredInfo);
  merged = mergeVendorInfoObjects_(merged, businessInfo);
  if (!merged.name) merged.name = fileNameInfo.name || "";
  merged.source = businessInfo.name || businessInfo.businessNo || businessInfo.ceo || businessInfo.address || businessInfo.type || businessInfo.category || businessInfo.phone
    ? "business_registration"
    : structuredInfo.name || structuredInfo.businessNo || structuredInfo.ceo || structuredInfo.address || structuredInfo.type || structuredInfo.category || structuredInfo.phone
      ? "mineru_structured"
      : quoteInfo.source || (fileNameInfo.name ? "file_name" : "");
  return cleanVendorInfo_(merged);
}

function getMissingBringSupplierFields_(vendorInfo) {
  vendorInfo = cleanVendorInfo_(vendorInfo || {});
  const missing = [];
  if (!vendorInfo.businessNo) missing.push("businessNo");
  if (!vendorInfo.name) missing.push("name");
  if (!vendorInfo.ceo) missing.push("ceo");
  if (!vendorInfo.address && !vendorInfo.addressFromVendorList) missing.push("address");
  if (!vendorInfo.type) missing.push("type");
  if (!vendorInfo.category) missing.push("category");
  if (!vendorInfo.phone) missing.push("phone");
  if (!vendorInfo.email) missing.push("email");
  return missing;
}

function hasMissingSupplierFields_(vendorInfo) {
  return getMissingBringSupplierFields_(vendorInfo).length > 0;
}

function fillVendorInfoMissingFields_(base, supplement) {
  return mergeVendorInfoObjects_(cleanVendorInfo_(supplement || {}), cleanVendorInfo_(base || {}));
}

function analyzeBusinessRegistrationWithMinerUIfNeeded_(blob, mimeType, fileName, casePayload, vendorInfo, currentMineruResult) {
  const current = cleanVendorInfo_(vendorInfo || {});
  const missingBefore = getMissingBringSupplierFields_(current);
  if (!missingBefore.length) {
    return { vendorInfo: current, used: false, message: "", warnings: [] };
  }
  if (currentMineruResult && currentMineruResult.ok) {
    return { vendorInfo: current, used: false, message: "", warnings: [] };
  }

  const config = getMineruConfig_();
  if (!config.enabled || !config.apiKey) {
    return {
      vendorInfo: current,
      used: false,
      message: "MinerU 토큰 없음",
      warnings: ["MinerU 토큰 없음"],
      missingFields: missingBefore
    };
  }

  const mineruResult = analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, null, { forceSync: true });
  if (!mineruResult.ok) {
    const message = mineruResult.message ? "MinerU OCR 보충 실패: " + mineruResult.message : "MinerU OCR 보충 실패";
    return {
      vendorInfo: current,
      used: false,
      message: message,
      warnings: [message],
      missingFields: missingBefore
    };
  }

  const ocrText = mineruResult.markdown || mineruResult.text || "";
  const ocrInfo = extractBusinessRegistrationVendorInfo_(ocrText, mineruResult, fileName);
  const merged = fillVendorInfoMissingFields_(current, ocrInfo);
  const missingAfter = getMissingBringSupplierFields_(merged);
  const filledFields = missingBefore.filter(field => missingAfter.indexOf(field) === -1);
  if (!filledFields.length) {
    return {
      vendorInfo: merged,
      used: false,
      message: "MinerU OCR 보충값 없음",
      warnings: mineruResult.warnings || [],
      missingFields: missingAfter
    };
  }

  merged.source = current.source || "business_registration";
  return {
    vendorInfo: cleanVendorInfo_(merged),
    used: true,
    message: "MinerU OCR로 사업자등록증 빈칸 보충",
    warnings: mineruResult.warnings || [],
    filledFields: filledFields,
    missingFields: missingAfter
  };
}

function matchBusinessRegistrationVendor_(vendorInfo, payload, casePayload) {
  const targetName = cleanExtractedVendorName_(vendorInfo && vendorInfo.name || "");
  const targetBusinessNo = cleanBusinessNo_(vendorInfo && vendorInfo.businessNo || "");
  const candidates = collectBusinessRegistrationVendorCandidates_(payload, casePayload);
  if (!targetName && !targetBusinessNo) {
    return { status: "unmatched", vendorId: "", vendorName: "", memo: "업체명/사업자번호를 찾지 못했습니다." };
  }

  const businessMatches = targetBusinessNo
    ? candidates.filter(v => cleanBusinessNo_(v.businessNo || "") === targetBusinessNo)
    : [];
  if (businessMatches.length === 1) return businessRegistrationMatchResult_(businessMatches[0], "사업자번호 일치");
  if (businessMatches.length > 1) return { status: "multiple", vendorId: "", vendorName: targetName, memo: "사업자번호가 같은 후보가 여러 개입니다." };

  const targetKey = vendorMatchKey_(targetName);
  const exact = targetKey ? candidates.filter(v => vendorMatchKey_(v.name) === targetKey) : [];
  if (exact.length === 1) return businessRegistrationMatchResult_(exact[0], "업체명 일치");
  if (exact.length > 1) return { status: "multiple", vendorId: "", vendorName: targetName, memo: "같은 업체명 후보가 여러 개입니다." };

  const similar = targetName ? candidates.filter(v => vendorNameLooseMatch_(targetName, v.name)) : [];
  if (similar.length === 1) return businessRegistrationMatchResult_(similar[0], "유사 업체명 일치");
  if (similar.length > 1) return { status: "multiple", vendorId: "", vendorName: targetName, memo: "유사 업체명 후보가 여러 개입니다." };

  return { status: "unmatched", vendorId: "", vendorName: targetName, memo: "일치하는 업체 후보를 찾지 못했습니다." };
}

function collectBusinessRegistrationVendorCandidates_(payload, casePayload) {
  const rows = [];
  if (Array.isArray(payload && payload.vendors)) {
    payload.vendors.forEach(v => rows.push(normalizeQuoteVendor_(v, "")));
  }
  Object.values((casePayload && casePayload.quoteFiles) || {}).filter(Boolean).forEach(quote => {
    const vendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
    if (!vendor.name) vendor.name = cleanExtractedVendorName_(quote.vendorName || "");
    if (vendor.name || vendor.businessNo || vendor.phone) rows.push(vendor);
  });
  const seen = {};
  return rows
    .map(v => cleanVendorInfo_(v))
    .filter(v => v.name || v.businessNo || v.phone)
    .filter(v => {
      const key = [v.id, vendorMatchKey_(v.name), v.businessNo, v.phone].join("|");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function businessRegistrationMatchResult_(candidate, memo) {
  return {
    status: "matched",
    vendorId: candidate.id || "",
    vendorName: candidate.name || "",
    memo: memo || "자동 연결"
  };
}

function getMineruConfig_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = String(props.getProperty("MINERU_API_KEY") || "").trim();
  const apiUrl = String(props.getProperty("MINERU_API_URL") || (apiKey ? "https://mineru.net" : "")).trim().replace(/\/$/, "");
  const modelVersion = String(props.getProperty("MINERU_MODEL_VERSION") || "vlm").trim();
  const language = String(props.getProperty("MINERU_LANGUAGE") || "korean").trim();
  const syncEnabled = String(props.getProperty("MINERU_SYNC_ENABLED") || "").toLowerCase() === "true";
  const maxWaitSeconds = Number(props.getProperty("MINERU_MAX_WAIT_SECONDS") || 20);
  return {
    apiUrl: apiUrl,
    apiKey: apiKey,
    modelVersion: modelVersion,
    language: language,
    maxWaitSeconds: maxWaitSeconds,
    syncEnabled: syncEnabled,
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

function analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder, options) {
  options = options || {};
  const forceSync = !!options.forceSync;
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
  if (!config.syncEnabled && !forceSync) {
    return {
      ok: false,
      skipped: true,
      statusCode: "mineru_sync_disabled",
      message: "빠른 업로드 모드: MinerU 실시간 분석 생략"
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
  return {};
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
  let name = String(value || "")
    .replace(/^(주식회사|\(주\)|㈜)\s*/g, "")
    .replace(/\s*(대표자|대표|사업자등록번호|사업자번호|등록번호|주소|전화번호|전화|연락처|TEL|Tel|tel|이메일|업태|업종|종목|견적|공급자).*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  name = trimQuoteVendorNoise_(name);
  if (!name || name.length < 2 || /견적서|합계|공급가액|부가세|주소|전화|이메일/.test(name) || isGenericQuoteVendorValue_(name)) return "";
  return name.slice(0, 30);
}

function trimQuoteVendorNoise_(value) {
  let name = String(value || "").replace(/\s+/g, " ").trim();
  [
    /\s*(?:대상\s*건물|대상건물|건물명|현장명|현장|민원|호실|호수|객실).*/i,
    /\s+(?:강원도|강원|서울특별시|서울|경기도|경기|인천|부산|대구|대전|광주|울산|세종|충북|충남|전북|전남|경북|경남|제주|원주시|춘천시|강릉시|흥업면|단구동|무실동|문막읍|상지대).*/i,
    /\s+(?:[A-Za-z]?\s*상가|[A-Za-z]?\s*원룸|[A-Za-z]?\s*호실|\d+\s*호).*/i
  ].forEach(pattern => {
    name = name.replace(pattern, "").trim();
  });
  return name;
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
  const tableItems = extractQuoteTableItems_(text, amounts, casePayload);
  if (tableItems.length && !tableItems[0].fallback) return tableItems;

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

  if (items.length) return normalizeBringQuoteItems_(items, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);

  const totalAmount = Number(amounts.totalAmount || 0);
  const supplyAmount = Number(amounts.supplyAmount || (totalAmount ? Math.round(totalAmount / 1.1) : 0));
  const vatAmount = Number(amounts.vatAmount || (totalAmount ? totalAmount - supplyAmount : 0));
  return [makeFallbackQuoteItem_(casePayload, supplyAmount, vatAmount, totalAmount, "추출 확인 필요")];
}

function extractQuoteTableItems_(text, amounts, casePayload) {
  const source = String(text || "").replace(/\r/g, "\n");
  if (!source || !/(품\s*명|품목|내역|규격|수량|단가|금액)/i.test(source)) return [];

  const sections = buildQuoteItemCandidateSections_(source);
  for (const section of sections) {
    const rows = parseQuoteItemRowsFromSection_(section);
    if (!rows.length) continue;
    const items = buildQuoteItemsFromParsedRows_(rows, amounts);
    const normalized = normalizeBringQuoteItems_(items, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);
    if (normalized.length && !normalized[0].fallback) return normalized;
  }
  return [];
}

function buildQuoteItemCandidateSections_(source) {
  const compact = String(source || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return [];

  const sections = [];
  const headerPattern = /(품\s*명\s*\(?\s*규격\s*\)?|품목|내역|규격)\s*(?:수량|단위)?\s*(?:단위|수량)?\s*(?:단가)?\s*(?:금액|합계)?\s*(?:비고)?/gi;
  let match;
  while ((match = headerPattern.exec(compact)) !== null) {
    let section = compact.slice(match.index + match[0].length);
    const stop = section.search(/(?:공급\s*가액|공급가|부가\s*세|부가세|합계\s*금액|총\s*액|총액|견적\s*유효|입금|사업자\s*등록|사업자번호|대표자|주소|전화|이메일|상호\s*:|회사명\s*:)/i);
    if (stop > 0) section = section.slice(0, stop);
    if (section.trim()) sections.push(section.trim());
  }

  if (!sections.length) {
    let section = compact;
    const firstHeader = section.search(/(?:품\s*명|품목|내역|규격)/i);
    if (firstHeader >= 0) section = section.slice(firstHeader);
    const stop = section.search(/(?:공급\s*가액|부가\s*세|합계\s*금액|총\s*액|견적\s*유효|사업자\s*등록|대표자|주소|전화|이메일)/i);
    if (stop > 0) section = section.slice(0, stop);
    sections.push(section);
  }
  return sections;
}

function parseQuoteItemRowsFromSection_(section) {
  let text = String(section || "")
    .replace(/품\s*명\s*\(?\s*규격\s*\)?|품목|내역|규격|수량|단위|단가|금액|합계|비고/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const rows = [];
  const money = "(?:\\d{1,3}(?:,\\d{3})+|\\d{4,})(?:\\.\\d+)?";
  const formula = "(?:[A-Z]{1,3}\\d+\\s*[*+\\-/]\\s*[A-Z]{1,3}\\d+)";
  const rowPattern = new RegExp("([^\\d]{1}[^\\n]{1,90}?)\\s+(\\d+(?:\\.\\d+)?)\\s+(" + money + ")(?:\\s*원)?(?:\\s+" + formula + ")?(?:\\s+(" + money + ")(?:\\s*원)?)?", "g");
  let match;
  while ((match = rowPattern.exec(text)) !== null) {
    if (rows.length >= 12) break;
    const product = cleanQuoteItemProduct_(match[1]);
    if (!product) continue;
    const qty = Number(match[2] || 1) || 1;
    const unitPrice = parseMoneyValue_(match[3]);
    const lineAmount = parseMoneyValue_(match[4] || match[3]);
    if (!lineAmount || lineAmount < 1000) continue;
    rows.push({ product: product, qty: qty, unitPrice: unitPrice, lineAmount: lineAmount });
  }
  return rows;
}

function cleanQuoteItemProduct_(value) {
  let product = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^\d+[\).\-]?\s*/, "")
    .replace(/^(No|NO|no)\s*\d+\s*/i, "")
    .replace(/^[\s:;,\-–—·ㆍ|()[\]{}]+|[\s:;,\-–—·ㆍ|()[\]{}]+$/g, "")
    .trim();
  product = product.replace(/^(품\s*명\s*\(?\s*규격\s*\)?|품목|내역|규격|수량|단위|단가|금액|합계|비고)\s*/i, "").trim();
  if (product.length < 2) return "";
  if (!/[가-힣A-Za-z]/.test(product)) return "";
  if (/공급\s*가액|부가\s*세|합계|총액|사업자|대표자|주소|전화|이메일|견적\s*일자/i.test(product)) return "";
  return product.slice(0, 80);
}

function buildQuoteItemsFromParsedRows_(rows, amounts) {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return [];
  const totalAmount = Number(amounts && amounts.totalAmount || 0);
  const supplyAmount = Number(amounts && amounts.supplyAmount || (totalAmount ? Math.round(totalAmount / 1.1) : 0));
  const vatAmount = Number(amounts && amounts.vatAmount || (totalAmount ? totalAmount - supplyAmount : 0));
  const rowSum = rows.reduce((sum, row) => sum + Number(row.lineAmount || 0), 0);
  const tolerance = Math.max(1000, Math.round((totalAmount || rowSum) * 0.08));
  const rowAmountsAreSupply = supplyAmount && Math.abs(rowSum - supplyAmount) <= tolerance;
  const rowAmountsAreTotal = totalAmount && Math.abs(rowSum - totalAmount) <= tolerance;
  if (totalAmount && !rowAmountsAreSupply && !rowAmountsAreTotal) return [];

  let remainingVat = vatAmount || Math.round(rowSum * 0.1);
  let remainingTotal = totalAmount || (rowAmountsAreSupply ? rowSum + remainingVat : rowSum);
  return rows.map((row, index) => {
    let supply;
    let vat;
    let total;
    if (rowAmountsAreSupply) {
      supply = Number(row.lineAmount || 0);
      vat = index === rows.length - 1
        ? remainingVat
        : Math.round(supply * (vatAmount || Math.round(rowSum * 0.1)) / Math.max(1, rowSum));
      total = supply + vat;
    } else {
      total = Number(row.lineAmount || 0);
      supply = Math.round(total / 1.1);
      vat = total - supply;
    }
    remainingVat -= vat;
    remainingTotal -= total;
    if (index === rows.length - 1 && totalAmount && Math.abs(remainingTotal) <= 1000) {
      total += remainingTotal;
      vat = total - supply;
    }
    return {
      product: row.product,
      unit: "식",
      unitPrice: supply || "",
      vat: vat || "",
      total: total || "",
      note: "표 자동추출"
    };
  });
}

function makeFallbackQuoteItem_(casePayload, supplyAmount, vatAmount, totalAmount, note) {
  return {
    product: [(casePayload.issueType || casePayload.vendorType || "현장"), "점검 및 공사 견적"].join(" "),
    unit: "식",
    unitPrice: supplyAmount || "",
    vat: vatAmount || "",
    total: totalAmount || "",
    note: note || "추출 확인 필요",
    fallback: true
  };
}

function normalizeBringQuoteItems_(items, casePayload, totalAmount, supplyAmount, vatAmount) {
  const total = Number(totalAmount || 0);
  const supply = Number(supplyAmount || (total ? Math.round(total / 1.1) : 0));
  const vat = Number(vatAmount || (total ? total - supply : 0));
  const fallback = [makeFallbackQuoteItem_(casePayload, supply, vat, total, "추출 확인 필요")];
  const rawItems = Array.isArray(items) ? items : [];
  if (!rawItems.length) return fallback;

  const normalized = rawItems.map(item => {
    item = item || {};
    const itemTotal = parseMoneyValue_(item.total || item.totalAmount || item.amount || "");
    const itemSupply = parseMoneyValue_(item.unitPrice || item.supplyAmount || item.supply || "");
    const itemVat = parseMoneyValue_(item.vat || item.vatAmount || "");
    let finalTotal = itemTotal || (itemSupply && itemVat ? itemSupply + itemVat : 0);
    let finalSupply = itemSupply || (finalTotal ? Math.round(finalTotal / 1.1) : 0);
    let finalVat = itemVat || (finalTotal ? finalTotal - finalSupply : 0);
    if (!finalTotal && finalSupply && finalVat) finalTotal = finalSupply + finalVat;
    const product = String(item.product || item.name || item.item || item.description || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return {
      product: product,
      unit: String(item.unit || "식").replace(/\s+/g, " ").trim().slice(0, 20) || "식",
      unitPrice: finalSupply || "",
      vat: finalVat || "",
      total: finalTotal || "",
      note: String(item.note || "원본 자동추출").replace(/\s+/g, " ").trim().slice(0, 60)
    };
  }).filter(item => {
    if (!item.product || item.product.length < 2) return false;
    if (/합계|총액|공급가액|부가세|사업자|대표자|전화|주소|이메일|견적일자/i.test(item.product)) return false;
    if (!Number(item.total || 0)) return false;
    if (total && Number(item.total || 0) > Math.round(total * 1.05)) return false;
    return true;
  }).slice(0, 12);

  if (!normalized.length) return fallback;
  if (total) {
    const sum = normalized.reduce((acc, item) => acc + Number(item.total || 0), 0);
    const tolerance = Math.max(1000, Math.round(total * 0.08));
    if (!sum || Math.abs(sum - total) > tolerance) return fallback;
  }
  return normalized;
}

function findBusinessRegistrationForQuote_(casePayload, quote, vendorName) {
  const docs = Object.values((casePayload && casePayload.businessRegistrationFiles) || {})
    .filter(Boolean)
    .map(businessRegistrationVendorInfoFromDoc_)
    .filter(v => v.name || v.businessNo || v.phone);
  if (!docs.length) return {};

  const quoteVendor = cleanVendorInfo_(quote && (quote.resolvedVendorInfo || quote.vendor) || {});
  const targetNames = [
    vendorName,
    quoteVendor.name,
    quote && quote.vendorName,
    quote && quote.extractedVendorName,
    quote && quote.extractedVendorInfo && quote.extractedVendorInfo.name,
    quote && extractQuoteVendorNameFromFileName_(quote.fileName || quote.originalFileName || "")
  ].map(cleanExtractedVendorName_).filter(Boolean);
  const targetBusinessNo = cleanBusinessNo_(quoteVendor.businessNo || (quote && quote.businessNo) || (quote && quote.extractedVendorInfo && quote.extractedVendorInfo.businessNo) || "");

  if (targetBusinessNo) {
    const businessMatches = docs.filter(doc => cleanBusinessNo_(doc.businessNo || "") === targetBusinessNo);
    const selectedByBusinessNo = selectBusinessRegistrationMatch_(businessMatches);
    if (selectedByBusinessNo) return selectedByBusinessNo;
  }

  for (const target of targetNames) {
    const exact = docs.filter(doc => vendorMatchKey_(doc.name) === vendorMatchKey_(target));
    const selectedExact = selectBusinessRegistrationMatch_(exact);
    if (selectedExact) return selectedExact;
  }
  for (const target of targetNames) {
    const similar = docs.filter(doc => vendorNameLooseMatch_(target, doc.name));
    const selectedSimilar = selectBusinessRegistrationMatch_(similar);
    if (selectedSimilar) return selectedSimilar;
  }
  return {};
}

function selectBusinessRegistrationMatch_(matches) {
  matches = (matches || []).filter(Boolean);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const nameKeys = new Set(matches.map(item => vendorMatchKey_(item.name || "")).filter(Boolean));
  const businessNos = new Set(matches.map(item => cleanBusinessNo_(item.businessNo || "")).filter(Boolean));
  if (nameKeys.size > 1 && businessNos.size > 1) return null;
  return matches.slice().sort((a, b) => {
    const scoreDiff = businessRegistrationCompletenessScore_(b) - businessRegistrationCompletenessScore_(a);
    if (scoreDiff) return scoreDiff;
    return String(b.uploadedAt || b.updatedAt || "").localeCompare(String(a.uploadedAt || a.updatedAt || ""));
  })[0];
}

function businessRegistrationCompletenessScore_(info) {
  info = info || {};
  return ["businessNo", "ceo", "address", "type", "category", "phone", "email"].reduce((score, key) => {
    return score + (String(info[key] || "").trim() ? 1 : 0);
  }, 0);
}

function businessRegistrationVendorInfoFromDoc_(doc) {
  const fileNameVendorName = extractBusinessRegistrationVendorNameFromFileName_(doc.originalFileName || doc.fileName || "");
  const info = cleanVendorInfo_({
    docId: doc.id || "",
    id: doc.vendorId || "",
    name: doc.vendorName || doc.matchedVendorName || fileNameVendorName || "",
    businessNo: doc.businessNo || "",
    ceo: doc.ceo || "",
    address: doc.address || "",
    type: doc.type || "",
    category: doc.category || "",
    phone: doc.phone || "",
    email: doc.email || "",
    source: "business_registration"
  });
  info.driveFileId = doc.driveFileId || "";
  info.fileName = doc.fileName || "";
  info.originalFileName = doc.originalFileName || doc.fileName || "";
  info.mimeType = doc.mimeType || "";
  info.extractionStatus = doc.extractionStatus || "";
  info.extractionMemo = doc.extractionMemo || "";
  info.uploadedAt = doc.uploadedAt || "";
  info.updatedAt = doc.updatedAt || "";
  info.mineruSupplementAttempted = !!doc.mineruSupplementAttempted || !!doc.mineruSupplementMessage;
  info.mineruSupplementUsed = !!doc.mineruSupplementUsed;
  info.mineruSupplementMessage = doc.mineruSupplementMessage || "";
  info.supplierMissingFields = doc.supplierMissingFields || [];
  return info;
}

function supplementBusinessRegistrationVendorFromDriveIfNeeded_(casePayload, businessVendor) {
  businessVendor = businessVendor || {};
  const current = cleanVendorInfo_(businessVendor);
  current.docId = businessVendor.docId || current.docId || "";
  if (!hasMissingSupplierFields_(current)) {
    return { vendorInfo: current, used: false, message: "" };
  }
  if (businessVendor.mineruSupplementAttempted) {
    return { vendorInfo: current, used: false, message: businessVendor.mineruSupplementMessage || "" };
  }

  const docId = businessVendor.docId || "";
  const docs = casePayload && casePayload.businessRegistrationFiles || {};
  const doc = docId && docs[docId] ? docs[docId] : null;
  const driveFileId = businessVendor.driveFileId || (doc && doc.driveFileId) || "";
  if (!driveFileId) {
    return { vendorInfo: current, used: false, message: "" };
  }

  try {
    const file = DriveApp.getFileById(driveFileId);
    const blob = file.getBlob();
    const fileName = businessVendor.originalFileName || businessVendor.fileName || (doc && (doc.originalFileName || doc.fileName)) || file.getName();
    const mimeType = businessVendor.mimeType || (doc && doc.mimeType) || blob.getContentType();
    const result = analyzeBusinessRegistrationWithMinerUIfNeeded_(blob, mimeType, fileName, casePayload, current, null);
    if (result && result.vendorInfo) {
      result.vendorInfo.docId = current.docId || docId;
      result.vendorInfo.driveFileId = driveFileId;
      result.vendorInfo.fileName = businessVendor.fileName || (doc && doc.fileName) || file.getName();
      result.vendorInfo.originalFileName = fileName;
      result.vendorInfo.mimeType = mimeType;
      if (doc) {
        doc.mineruSupplementAttempted = true;
        doc.mineruSupplementUsed = !!result.used;
        doc.mineruSupplementMessage = result.message || "";
        doc.supplierMissingFields = result.missingFields || getMissingBringSupplierFields_(result.vendorInfo);
        ["businessNo", "ceo", "address", "type", "category", "phone", "email"].forEach(field => {
          if (!doc[field] && result.vendorInfo[field]) doc[field] = result.vendorInfo[field];
        });
        if (!doc.vendorName && result.vendorInfo.name) doc.vendorName = result.vendorInfo.name;
      }
    }
    return result || { vendorInfo: current, used: false, message: "" };
  } catch (err) {
    return {
      vendorInfo: current,
      used: false,
      message: "MinerU OCR 보충 실패: " + err.message,
      warnings: ["MinerU OCR 보충 실패: " + err.message]
    };
  }
}

function resolveBringQuoteVendorInfo_(casePayload, quote, extraction) {
  quote = quote || {};
  extraction = extraction || {};
  const quoteVendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
  if (!quoteVendor.name) quoteVendor.name = cleanExtractedVendorName_(quote.vendorName || extraction.vendorName || "");
  let businessVendor = findBusinessRegistrationForQuote_(casePayload, quote, quoteVendor.name || quote.vendorName || extraction.vendorName || "");
  const mineruSupplement = supplementBusinessRegistrationVendorFromDriveIfNeeded_(casePayload, businessVendor);
  if (mineruSupplement && mineruSupplement.vendorInfo) {
    businessVendor = mineruSupplement.vendorInfo;
  }
  const vendor = mergeVendorInfoObjects_(businessVendor, quoteVendor);
  const businessName = cleanExtractedVendorName_(businessVendor.name || "");
  if (businessName && (!quoteVendor.name || vendorNameLooseMatch_(quoteVendor.name, businessName))) {
    vendor.name = businessName;
  }
  if (!vendor.name) vendor.name = cleanExtractedVendorName_(quote.vendorName || extraction.vendorName || businessVendor.name || "");

  const businessFields = ["name", "businessNo", "ceo", "address", "type", "category", "phone", "email"];
  let businessApplied = businessFields.some(field => {
    const businessValue = String(businessVendor[field] || "").trim();
    if (!businessValue) return false;
    const quoteValue = String(quoteVendor[field] || "").trim();
    const finalValue = String(vendor[field] || "").trim();
    if (field === "name") return finalValue === businessValue && finalValue !== quoteValue;
    return !quoteValue && finalValue === businessValue;
  });
  businessApplied = businessApplied || !!(mineruSupplement && mineruSupplement.used);

  return {
    vendor: cleanVendorInfo_(vendor),
    quoteVendor: quoteVendor,
    businessVendor: businessVendor,
    businessApplied: businessApplied,
    mineruSupplementApplied: !!(mineruSupplement && mineruSupplement.used),
    mineruSupplementMessage: mineruSupplement && mineruSupplement.message || ""
  };
}

function refreshBringQuotesFromBusinessRegistration_(caseId, casePayload, businessDoc, timestamp) {
  const result = { updated: 0, skipped: 0 };
  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  if (!templateId) return result;
  const quoteFiles = casePayload && casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  const quoteIds = Object.keys(quoteFiles);
  if (!quoteIds.length) return result;

  const businessVendor = businessRegistrationVendorInfoFromDoc_(businessDoc);
  const bringFolder = getOrCreateChildFolder_(getQuoteDriveFolder_(casePayload), "브링 양식 견적서");

  quoteIds.forEach(quoteId => {
    const quote = quoteFiles[quoteId];
    if (!businessRegistrationMatchesQuote_(businessVendor, quote)) {
      result.skipped++;
      return;
    }

    let sheetFile = null;
    try {
      const extraction = makeQuoteRewriteExtraction_(quote, casePayload);
      const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
      sheetFile = DriveApp.getFileById(templateId).makeCopy(fileNameBase, bringFolder);
      const ss = SpreadsheetApp.openById(sheetFile.getId());
      const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
      SpreadsheetApp.flush();
      if (fillResult && fillResult.vendor && fillResult.vendor.name) {
        quote.vendor = fillResult.vendor;
        quote.resolvedVendorInfo = fillResult.vendor;
        quote.vendorName = fillResult.vendor.name;
        quote.vendorInfoSource = fillResult.businessApplied ? "business_registration" : quote.vendorInfoSource;
      }

      const previousXlsxId = String(quote.bringQuoteXlsxId || "");
      const exported = exportBringQuoteXlsx_(sheetFile.getId(), fileNameBase + ".xlsx", bringFolder);
      if (exported.ok) {
        quote.bringQuoteXlsxName = exported.fileName;
        quote.bringQuoteXlsxUrl = exported.fileUrl;
        quote.bringQuoteXlsxId = exported.fileId;
        if (previousXlsxId && previousXlsxId !== exported.fileId) trashDriveFileByIdQuietly_(previousXlsxId);
      } else {
        quote.bringQuoteStatus = "xlsx_failed";
        quote.bringQuoteType = "failed";
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 반영 XLSX 내보내기 실패: " + exported.message);
      }

      const sheetAmounts = readBringQuoteAmounts_(ss);
      if (sheetAmounts.totalAmount) {
        quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
        quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
        quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
        quote.bringQuoteBaseTotalAmount = Number(quote.confirmedTotalAmount || quote.bringQuoteBaseTotalAmount || quote.totalAmount || extraction.totalAmount || 0);
        quote.bringQuoteBaseSupplyAmount = Number(quote.confirmedSupplyAmount || quote.bringQuoteBaseSupplyAmount || quote.supplyAmount || extraction.supplyAmount || 0);
        quote.bringQuoteBaseVatAmount = Number(quote.confirmedVatAmount || quote.bringQuoteBaseVatAmount || quote.vatAmount || extraction.vatAmount || 0);
        quote.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
        quote.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - quote.bringQuoteBaseTotalAmount);
        quote.bringQuoteItems = fillResult && fillResult.bringItems || quote.bringQuoteItems || [];
        quote.bringQuoteAmountSyncedAt = timestamp;
      }
      quote.bringQuoteStatus = quote.bringQuoteStatus === "xlsx_failed" ? quote.bringQuoteStatus : "business_registration_rewritten";
      quote.bringQuoteType = Number(quote.confirmedTotalAmount || 0) ? "confirmed" : "draft";
      if (fillResult && fillResult.businessApplied) {
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보 반영 완료");
        quote.businessRegistrationAppliedAt = timestamp;
        quote.businessRegistrationDocId = businessDoc.id || "";
      }
      if (fillResult && fillResult.mineruSupplementApplied) {
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
      }
      quote.extractedItems = extraction.items;
      quote.updatedAt = timestamp;
      applyQuoteAmountState_(quote);

      casePayload.quoteFiles[quoteId] = quote;
      putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
      result.updated++;
    } catch (err) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보 반영 실패: " + err.message);
      casePayload.quoteFiles[quoteId] = quote;
      putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
    } finally {
      trashDriveFileQuietly_(sheetFile);
    }
  });

  return result;
}

function businessRegistrationMatchesQuote_(businessVendor, quote) {
  businessVendor = cleanVendorInfo_(businessVendor || {});
  quote = quote || {};
  const quoteVendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
  const businessNo = cleanBusinessNo_(businessVendor.businessNo || "");
  const quoteBusinessNo = cleanBusinessNo_(quoteVendor.businessNo || quote.businessNo || (quote.extractedVendorInfo && quote.extractedVendorInfo.businessNo) || "");
  if (businessNo && quoteBusinessNo && businessNo === quoteBusinessNo) return true;

  const businessName = cleanExtractedVendorName_(businessVendor.name || "");
  if (!businessName) return false;
  const quoteNames = [
    quoteVendor.name,
    quote.vendorName,
    quote.extractedVendorName,
    quote.extractedVendorInfo && quote.extractedVendorInfo.name,
    extractQuoteVendorNameFromFileName_(quote.fileName || quote.originalFileName || "")
  ].map(cleanExtractedVendorName_).filter(Boolean);
  if (!quoteNames.length) return false;
  return quoteNames.some(name => vendorNameLooseMatch_(name, businessName));
}

function makeQuoteRewriteExtraction_(quote, casePayload) {
  quote = quote || {};
  const baseAmounts = getBringQuoteBaseAmounts_(quote, {});
  const total = baseAmounts.totalAmount;
  const supply = baseAmounts.supplyAmount;
  const vat = baseAmounts.vatAmount;
  const items = getQuoteItemsForRewrite_(quote, casePayload, total, supply, vat);
  return {
    status: quote.extractionStatus || "확인필요",
    memo: quote.extractionMemo || "",
    vendorName: quote.extractedVendorName || quote.vendorName || "",
    supplyAmount: supply,
    vatAmount: vat,
    totalAmount: total,
    items: items
  };
}

function getQuoteItemsForRewrite_(quote, casePayload, total, supply, vat) {
  quote = quote || {};
  const amounts = {
    totalAmount: Number(total || 0),
    supplyAmount: Number(supply || (total ? Math.round(total / 1.1) : 0)),
    vatAmount: Number(vat || (total ? total - Math.round(total / 1.1) : 0))
  };
  const text = getQuoteTextForRewrite_(quote);
  if (text) {
    const fromText = extractQuoteItems_(text, amounts, casePayload);
    if (hasUsableQuoteItems_(fromText)) return fromText;
  }
  const existing = normalizeBringQuoteItems_(quote.extractedItems, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);
  if (hasUsableQuoteItems_(existing)) return existing;
  return [makeFallbackQuoteItem_(casePayload, amounts.supplyAmount, amounts.vatAmount, amounts.totalAmount, "추출 확인 필요")];
}

function hasUsableQuoteItems_(items) {
  items = Array.isArray(items) ? items : [];
  return items.some(item => item && !item.fallback && String(item.product || "").trim().length >= 2);
}

function getQuoteTextForRewrite_(quote) {
  quote = quote || {};
  const storedText = [
    quote.extractionText || "",
    quote.extractionTextPreview || "",
    quote.textPreview || "",
    quote.analysisText || ""
  ].filter(Boolean).join(" ");
  if (storedText && /(품\s*명|품목|내역|규격|수량|단가|금액)/i.test(storedText)) return storedText;

  const fileId = extractDriveId_(quote.originalDriveFileId || quote.driveFileId || quote.originalFileUrl || quote.fileUrl || "");
  if (!fileId) return storedText;
  try {
    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName();
    const blob = file.getBlob();
    const mimeType = quote.mimeType || blob.getContentType() || inferQuoteMimeType_(fileName);
    const result = extractQuoteText_(blob, mimeType, fileName);
    const freshText = result && result.text ? String(result.text) : "";
    return [storedText, freshText].filter(Boolean).join(" ");
  } catch (err) {
    return storedText;
  }
}

function fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction) {
  const sheet = ss.getSheets()[0];
  extraction = extraction || {};
  const vendorResult = resolveBringQuoteVendorInfo_(casePayload, quote, extraction);
  const vendor = vendorResult.vendor;
  const vendorName = cleanExtractedVendorName_(vendor.name || quote.vendorName || extraction.vendorName || "");
  const vendorAddress = cleanQuoteAddress_(vendor.address || vendor.addressFromVendorList || "");
  const baseAmounts = getBringQuoteBaseAmounts_(quote, extraction);
  const bringAmounts = calculateBringQuoteAmounts_(baseAmounts.totalAmount);
  const total = bringAmounts.totalAmount;
  const supply = bringAmounts.supplyAmount;
  const vat = bringAmounts.vatAmount;
  if (quote && bringAmounts.totalAmount) {
    quote.sourceTotalAmount = baseAmounts.totalAmount;
    quote.bringQuoteBaseTotalAmount = baseAmounts.totalAmount;
    quote.bringQuoteBaseSupplyAmount = baseAmounts.supplyAmount;
    quote.bringQuoteBaseVatAmount = baseAmounts.vatAmount;
    quote.bringQuoteMarkupRate = bringAmounts.markupRate;
    quote.bringQuoteMarkupAmount = bringAmounts.markupAmount;
  }
  setSheetValue_(sheet, "D5", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"));
  setSheetValue_(sheet, "D6", vendor.businessNo || "");
  setSheetValue_(sheet, "D7", vendorName || "");
  setSheetValue_(sheet, "I7", vendor.ceo || "");
  setSheetValue_(sheet, "D8", vendorAddress || "");
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
  const items = scaleBringQuoteItems_(extraction.items || [], casePayload, baseAmounts, bringAmounts);
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
  vendorResult.bringAmounts = bringAmounts;
  vendorResult.bringItems = items;
  return vendorResult;
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

function trashDriveFileQuietly_(file) {
  if (!file) return;
  try {
    file.setTrashed(true);
  } catch (err) {
    Logger.log("임시 브링 양식 Google Sheet 정리 실패: " + err.message);
  }
}

function trashDriveFileByIdQuietly_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {
    Logger.log("이전 브링 엑셀 파일 정리 실패: " + err.message);
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
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    hwp: "application/x-hwp",
    hwpx: "application/vnd.hancom.hwpx"
  };
  return map[ext] || "application/octet-stream";
}

function isBusinessRegistrationLikeQuote_(quote) {
  const text = [
    quote && quote.fileName,
    quote && quote.originalFileName
  ].filter(Boolean).join(" ");
  return /사업자\s*등록|사업자등록증|business[-_\s]*registration|biz[-_\s]*reg/i.test(text);
}

function makeQuoteComparisonNote_(casePayload) {
  const quotes = Object.values(casePayload.quoteFiles || {}).filter(quote => quote && !isBusinessRegistrationLikeQuote_(quote));
  if (!quotes.length) return "";
  const lines = ["[견적 비교]", "업로드 견적: " + quotes.length + "건", ""];
  quotes.forEach(quote => {
    const confirmed = Number(quote.confirmedTotalAmount || 0);
    const baseAmount = confirmed || Number(quote.bringQuoteBaseTotalAmount || 0) || Number(quote.totalAmount || 0) || parseMoneyValue_(quote.amount);
    const bringSheetAmount = Number(quote.bringQuoteTotalAmount || 0);
    const bringLabel = quote.bringQuoteType === "confirmed" || quote.bringQuoteStatus === "confirmed_rewritten"
      ? "브링 엑셀 확정"
      : quote.bringQuoteXlsxUrl
        ? "브링 엑셀 초안"
        : "브링 엑셀 확인 필요";
    const amountLabel = baseAmount
      ? "원본합계 " + formatCurrencyText_(baseAmount) + (bringSheetAmount ? " / 브링양식 " + formatCurrencyText_(bringSheetAmount) : "")
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
  const deletedCase = readCaseFromFirebase_(ticketNo);
  if (deletedCase && deletedCase.deleted === true) {
    Logger.log("삭제된 케이스 재처리 생략: " + ticketNo);
    return;
  }
  const analysis = analyzeComplaint_(record);
  const contractMatch = matchDriveOnboardingFile_(record);
  const casePayload = buildCasePayload_(ticketNo, record, analysis, contractMatch, row, sheet);
  writeCaseToFirebase_(ticketNo, casePayload);

  const existingCase = readCaseFromFirebase_(ticketNo) || {};
  let smsResult;
  if (contractMatch.status !== "matched") {
    smsResult = {
      ok: false,
      status: "매칭대기",
      statusText: "온보딩 수집서 매칭이 완료되지 않아 접수확인 문자를 발송하지 않았습니다.",
      skipped: true
    };
  } else if (isSmsCompleteStatus_(existingCase.sms && existingCase.sms.status)) {
    smsResult = Object.assign({ skipped: true }, existingCase.sms);
  } else {
    smsResult = sendComplaintSms_(ticketNo, record, analysis, contractMatch);
  }
  applySmsResultToCase_(casePayload, smsResult);

  writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch, smsResult);
  writeCaseToFirebase_(ticketNo, casePayload);
  advanceCaseWorkflow_(ticketNo, { source: "form_submit" });
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

function formatEnglishDateTextForCase_(raw) {
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const match = String(raw || "").trim().match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const month = months[String(match[1]).toLowerCase()];
  if (!month) return "";
  return match[3] + "년 " + month + "월 " + Number(match[2]) + "일 " + String(match[4]).padStart(2, "0") + ":" + match[5];
}

function formatKoreanDateOnlyForCase_(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const raw = String(value).trim();
  const korean = raw.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korean && Number(korean[1]) > 1901) {
    return Number(korean[1]) + "년 " + Number(korean[2]) + "월 " + Number(korean[3]) + "일";
  }
  const parsed = value instanceof Date ? value : new Date(raw);
  if (isNaN(parsed.getTime())) return "";
  const year = Number(Utilities.formatDate(parsed, "Asia/Seoul", "yyyy"));
  return year > 1901 ? Utilities.formatDate(parsed, "Asia/Seoul", "yyyy년 M월 d일") : "";
}

function timeOnlyPartsForCase_(value) {
  const raw = String(value || "").trim();
  const english = raw.match(/^(?:[A-Za-z]{3}\s+)?[A-Za-z]{3}\s+\d{1,2}\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (english && Number(english[1]) <= 1901) {
    return { hour: String(english[2]).padStart(2, "0"), minute: english[3] };
  }
  const korean = raw.match(/^(\d{4})년\s*\d{1,2}월\s*\d{1,2}일\s*(\d{1,2}):(\d{2})/);
  if (korean && Number(korean[1]) <= 1901) {
    return { hour: String(korean[2]).padStart(2, "0"), minute: korean[3] };
  }
  const parsed = value instanceof Date ? value : new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  const year = Number(Utilities.formatDate(parsed, "Asia/Seoul", "yyyy"));
  if (year > 1901) return null;
  return {
    hour: Utilities.formatDate(parsed, "Asia/Seoul", "HH"),
    minute: Utilities.formatDate(parsed, "Asia/Seoul", "mm")
  };
}

function formatKoreanDateTimeForCase_(value, fallbackDate) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const timeOnly = timeOnlyPartsForCase_(value);
  if (timeOnly) {
    const dateText = formatKoreanDateOnlyForCase_(fallbackDate);
    return (dateText ? dateText + " " : "") + timeOnly.hour + ":" + timeOnly.minute;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy년 M월 d일 HH:mm");
  }
  const raw = String(value).trim();
  const englishDate = formatEnglishDateTextForCase_(raw);
  if (englishDate) return englishDate;
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "Asia/Seoul", "yyyy년 M월 d일 HH:mm");
  }
  return raw;
}

function formatVisitTimeFromRecord_(record, fallbackDate) {
  const visitTime = readRawField_(record, ["방문 가능 시간"]);
  const visitDate = readRawField_(record, ["방문 가능 날짜", "방문 날짜", "방문일"]);
  const submittedAt = readRawField_(record, ["타임스탬프", "Timestamp"]);
  return formatKoreanDateTimeForCase_(visitTime, visitDate || fallbackDate || submittedAt);
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
    source: "drive_ranked",
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

  const candidatesResult = listDriveOnboardingCandidates_();
  if (!candidatesResult.ok) {
    return Object.assign(base, {
      statusText: candidatesResult.error || "Drive 폴더 접근 실패: 폴더 공유 권한 또는 폴더 ID를 확인하세요."
    });
  }
  if (!candidatesResult.candidates.length) {
    return Object.assign(base, {
      statusText: "Drive 폴더에 매칭할 DOCX 온보딩 수집서가 없습니다."
    });
  }
  const ranked = candidatesResult.candidates.map(candidate => rankDriveOnboardingCandidate_(candidate, inputBuilding, inputAddress));
  ranked.sort((a, b) => {
    if (a.matchRank !== b.matchRank) return b.matchRank - a.matchRank;
    if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
    if (a.addressScore !== b.addressScore) return b.addressScore - a.addressScore;
    return b.lastUpdatedMs - a.lastUpdatedMs;
  });
  const winner = ranked[0];
  if (!isPlausibleOnboardingCandidate_(winner, inputBuilding, inputAddress)) {
    return Object.assign(base, {
      statusText: "입력한 건물명과 주소에 일치하는 계약 건물을 찾지 못했습니다.",
      candidateCount: ranked.length,
      candidates: ranked.slice(0, 5).map(candidate => ({
        fileName: candidate.file.getName(),
        fileUrl: candidate.file.getUrl(),
        driveFileId: candidate.file.getId(),
        building: candidate.building,
        address: candidate.address,
        ownerName: candidate.ownerName,
        matchScore: candidate.matchScore
      }))
    });
  }
  const levelText = winner.matchRank === 3
    ? "건물명과 주소 정확 일치"
    : winner.matchRank === 2
      ? "정규화 건물명 일치"
      : "건물명 60%·주소 40% 유사도 최고 후보";
  return makeDriveMatchPayload_(winner.file, inputBuilding, inputAddress, {
    matchKey: buildingKey + "|" + addressKey,
    candidateCount: ranked.length,
    statusText: levelText + "로 자동 매칭했습니다.",
    source: "drive_ranked",
    matchLevel: levelText,
    matchScore: winner.matchScore,
    buildingScore: winner.buildingScore,
    addressScore: winner.addressScore,
    matchedBuilding: winner.building,
    matchedAddress: winner.address,
    ownerName: winner.ownerName,
    candidates: ranked.slice(0, 5).map(candidate => ({
      fileName: candidate.file.getName(),
      fileUrl: candidate.file.getUrl(),
      driveFileId: candidate.file.getId(),
      building: candidate.building,
      address: candidate.address,
      ownerName: candidate.ownerName,
      matchScore: candidate.matchScore
    }))
  });
}

function listDriveOnboardingCandidates_() {
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  if (!folderId) return { ok: false, candidates: [], error: "Drive 폴더 ID가 설정되지 않았습니다." };
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const candidates = [];
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed() || !isSupportedDriveImportMime_(file.getMimeType())) continue;
      let text = "";
      try {
        text = file.getMimeType() === "application/pdf"
          ? extractPdfTextForReview_(file.getId())
          : extractDocxText_(file.getId());
      } catch (err) {
        Logger.log("온보딩 문서 본문 추출 실패: " + file.getName() + " / " + err.message);
      }
      candidates.push({
        file: file,
        text: text,
        building: extractOnboardingField_(text, ["건물명", "건물"]) || onboardingBuildingFromFileName_(file.getName()),
        address: extractOnboardingField_(text, ["건물 주소", "주소", "소재지"]),
        ownerName: extractOnboardingOwnerName_(text),
        lastUpdatedMs: file.getLastUpdated().getTime()
      });
    }
    return { ok: true, candidates: candidates };
  } catch (err) {
    return { ok: false, candidates: [], error: "Drive 온보딩 목록 조회 실패: " + err.message };
  }
}

function isSupportedDriveImportMime_(mimeType) {
  return [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ].indexOf(String(mimeType || "")) >= 0;
}

function buildDriveImportCandidate_(input) {
  input = input && typeof input === "object" ? input : {};
  const text = String(input.text || "");
  const extractedName = extractOnboardingField_(text, ["건물명", "건물"]);
  const fileNameFallback = onboardingBuildingFromFileName_(input.fileName)
    .replace(/[_-]*(?:통합\s*)?건물\s*체크리스트.*$/i, "")
    .replace(/[_-]*체크리스트.*$/i, "")
    .trim();
  const name = String(extractedName || fileNameFallback || "").slice(0, 120).trim();
  const address = String(extractOnboardingField_(text, ["건물 주소", "주소", "소재지"]) || "").slice(0, 240).trim();
  const manager = String(extractOnboardingField_(text, ["담당자", "담당자명"]) || "").slice(0, 60).trim();
  const warnings = [];
  if (input.extractionWarning) warnings.push(String(input.extractionWarning).slice(0, 240));
  if (!text.trim()) warnings.push("문서 본문을 확인하지 못해 파일명만 제안했습니다.");
  if (/손글씨|필기/i.test(text)) warnings.push("손글씨 값은 Drive 원본 확인이 필요합니다.");
  return {
    id: String(input.driveFileId || ""),
    driveFileId: String(input.driveFileId || ""),
    fileName: String(input.fileName || "").slice(0, 240),
    fileUrl: String(input.fileUrl || "").slice(0, 500),
    mimeType: String(input.mimeType || ""),
    sourceFolderId: String(input.sourceFolderId || ""),
    sourceModifiedAt: String(input.sourceModifiedAt || ""),
    sourceHash: String(input.sourceHash || ""),
    suggested: {
      name: name,
      address: address,
      manager: manager,
      type: "다가구",
      status: "영업후보",
      unitCount: 0,
      memo: "Drive 원본: " + String(input.fileName || "").slice(0, 180)
    },
    confidence: {
      name: extractedName ? "high" : (name ? "medium" : "low"),
      address: address ? "medium" : "low",
      manager: manager ? "medium" : "low"
    },
    warnings: Array.from(new Set(warnings)),
    status: "pending",
    createdAt: String(input.now || input.sourceModifiedAt || ""),
    updatedAt: String(input.now || input.sourceModifiedAt || ""),
    approvedAt: null,
    approvedByUid: null,
    crmBuildingId: null,
    rejectionReason: null
  };
}

function mergeDriveImportCandidate_(existing, incoming) {
  const previous = existing && typeof existing === "object" ? existing : null;
  const next = incoming && typeof incoming === "object" ? incoming : {};
  if (!previous) return { changed: true, candidate: next };
  if (String(previous.sourceHash || "") === String(next.sourceHash || "")) {
    return { changed: false, candidate: previous };
  }
  const reviewed = previous.status === "approved" || previous.status === "rejected";
  return {
    changed: true,
    candidate: Object.assign({}, next, {
      status: reviewed ? "stale" : "pending",
      createdAt: previous.createdAt || next.createdAt,
      approvedAt: previous.approvedAt || null,
      approvedByUid: previous.approvedByUid || null,
      crmBuildingId: previous.crmBuildingId || null,
      rejectionReason: previous.rejectionReason || null
    })
  };
}

function driveImportSourceHash_(file) {
  const checksum = typeof file.getMd5Checksum === "function" ? String(file.getMd5Checksum() || "") : "";
  if (checksum) return checksum;
  const raw = [file.getId(), file.getLastUpdated().toISOString(), file.getSize()].join("|");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return digest.map(value => (value + 256).toString(16).slice(-2)).join("");
}

function crmCompanyImportUrl_(childPath) {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty("CRM_FIREBASE_DATABASE_URL") || "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const child = String(childPath || "").split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  return base + "/crmCompany" + (child ? "/" + child : "") + ".json";
}

function firebaseOauthRequest_(url, method, payload, label) {
  const options = {
    method: method,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.contentType = "application/json; charset=utf-8";
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(label + ": HTTP " + code + " / " + response.getContentText());
  const body = response.getContentText();
  return body && body !== "null" ? JSON.parse(body) : null;
}

function syncDriveCrmImportCandidates_() {
  const listed = listDriveOnboardingCandidates_();
  if (!listed.ok) throw new Error(listed.error || "Drive 검토 후보를 읽지 못했습니다.");
  const existing = firebaseOauthRequest_(crmCompanyImportUrl_("driveImportCandidates"), "get", undefined, "CRM 검토 후보 조회 실패") || {};
  const now = new Date().toISOString();
  const patch = {};
  listed.candidates.forEach(item => {
    const file = item.file;
    const incoming = buildDriveImportCandidate_({
      driveFileId: file.getId(),
      fileName: file.getName(),
      fileUrl: file.getUrl(),
      mimeType: file.getMimeType(),
      sourceFolderId: extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID),
      sourceModifiedAt: file.getLastUpdated().toISOString(),
      sourceHash: driveImportSourceHash_(file),
      text: item.text,
      extractionWarning: item.text ? "" : "문서 본문 추출 실패",
      now: now
    });
    const merged = mergeDriveImportCandidate_(existing[incoming.driveFileId], incoming);
    if (merged.changed) patch[incoming.driveFileId] = merged.candidate;
  });
  if (Object.keys(patch).length) {
    firebaseOauthRequest_(crmCompanyImportUrl_("driveImportCandidates"), "patch", patch, "CRM 검토 후보 저장 실패");
  }
  return { ok: true, scanned: listed.candidates.length, changed: Object.keys(patch).length, syncedAt: now };
}

function assertDriveImportApprover_(access, identity) {
  access = access && typeof access === "object" ? access : {};
  identity = identity && typeof identity === "object" ? identity : {};
  if (access.enabled !== true) throw new Error("비활성 CRM 계정입니다.");
  if (String(access.role || "") !== "admin") throw new Error("관리자만 Drive 자료를 승인할 수 있습니다.");
  const accessEmail = String(access.email || "").trim().toLowerCase();
  const identityEmail = String(identity.email || "").trim().toLowerCase();
  if (!accessEmail || !identityEmail || accessEmail !== identityEmail) throw new Error("로그인 이메일과 CRM 허용 이메일이 일치하지 않습니다.");
  return true;
}

function normalizeDriveImportKey_(value) {
  return String(value || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function buildDriveImportApprovalPatch_(input) {
  input = input && typeof input === "object" ? input : {};
  const requestId = String(input.requestId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("승인 요청 ID가 올바르지 않습니다.");
  if (input.receipt && typeof input.receipt === "object") {
    if (String(input.receipt.requestId || "") !== requestId) throw new Error("승인 요청 영수증이 올바르지 않습니다.");
    return { patch: {}, result: Object.assign({}, input.receipt, { repeated: true }) };
  }
  const candidate = input.candidate && typeof input.candidate === "object" ? input.candidate : {};
  if (candidate.status !== "pending") throw new Error("검토 대기 상태의 후보만 승인할 수 있습니다.");
  const driveFileId = String(candidate.driveFileId || "");
  if (!driveFileId || driveFileId !== String(candidate.id || "")) throw new Error("Drive 후보 식별자가 올바르지 않습니다.");
  const approved = input.approved && typeof input.approved === "object" ? input.approved : {};
  const name = String(approved.name || "").trim().slice(0, 120);
  const address = String(approved.address || "").trim().slice(0, 240);
  if (!name || !address) throw new Error("건물명과 주소를 확인해 주세요.");
  const nameKey = normalizeDriveImportKey_(name);
  const addressKey = normalizeDriveImportKey_(address);
  Object.keys(input.buildings || {}).forEach(key => {
    const building = input.buildings[key] || {};
    const sameDrive = ((building.externalRefs && building.externalRefs.driveFileIds) || []).indexOf(driveFileId) >= 0;
    const sameNameAddress = normalizeDriveImportKey_(building.name) === nameKey && normalizeDriveImportKey_(building.address) === addressKey;
    if (sameDrive || sameNameAddress) throw new Error("중복 건물입니다. 같은 Drive 자료 또는 이름·주소의 건물이 이미 존재합니다.");
  });
  const now = String(input.now || new Date().toISOString());
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const safeFileKey = String(driveFileId).toLowerCase().replace(/[^0-9a-z_-]/g, "-").slice(0, 100);
  const crmBuildingId = "building_drive_" + safeFileKey;
  const auditId = "drive_building_" + requestId.replace(/-/g, "");
  const building = {
    id: crmBuildingId,
    name: name,
    address: address,
    manager: String(approved.manager || "").trim().slice(0, 60),
    type: String(approved.type || "다가구").trim().slice(0, 40),
    status: String(approved.status || "영업후보").trim().slice(0, 40),
    unitCount: Math.max(0, Math.min(10000, Number(approved.unitCount) || 0)),
    memo: String(approved.memo || "").trim().slice(0, 500),
    externalRefs: { driveFileIds: [driveFileId] },
    entityVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: String(actor.uid || ""),
    updatedBy: String(actor.uid || "")
  };
  const approvedCandidate = Object.assign({}, candidate, {
    status: "approved",
    approvedAt: now,
    approvedByUid: String(actor.uid || ""),
    crmBuildingId: crmBuildingId,
    rejectionReason: null,
    updatedAt: now
  });
  const result = {
    requestId: requestId,
    crmBuildingId: crmBuildingId,
    auditId: auditId,
    approvedAt: now,
    repeated: false
  };
  const receipt = Object.assign({}, result);
  delete receipt.repeated;
  const patch = {};
  patch["data/buildings/" + crmBuildingId] = building;
  patch["driveImportCandidates/" + driveFileId] = approvedCandidate;
  patch["driveImportAuditLogs/" + auditId] = {
    id: auditId,
    action: "drive_building_approved",
    requestId: requestId,
    driveFileId: driveFileId,
    crmBuildingId: crmBuildingId,
    actorUid: String(actor.uid || ""),
    occurredAt: now
  };
  patch["driveImportRequestReceipts/" + requestId] = receipt;
  return { patch: patch, result: result };
}

function buildDriveImportRejectionPatch_(input) {
  input = input && typeof input === "object" ? input : {};
  const requestId = String(input.requestId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("반려 요청 ID가 올바르지 않습니다.");
  if (input.receipt && typeof input.receipt === "object") return { patch: {}, result: Object.assign({}, input.receipt, { repeated: true }) };
  const candidate = input.candidate && typeof input.candidate === "object" ? input.candidate : {};
  if (["pending", "stale"].indexOf(candidate.status) < 0) throw new Error("검토 대기 또는 재검토 상태만 반려할 수 있습니다.");
  const driveFileId = String(candidate.driveFileId || "");
  if (!driveFileId || driveFileId !== String(candidate.id || "")) throw new Error("Drive 후보 식별자가 올바르지 않습니다.");
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (!reason) throw new Error("반려 사유를 입력해 주세요.");
  const now = String(input.now || new Date().toISOString());
  const actorUid = String(input.actor && input.actor.uid || "");
  const auditId = "drive_reject_" + requestId.replace(/-/g, "");
  const result = { requestId: requestId, driveFileId: driveFileId, auditId: auditId, rejectedAt: now, repeated: false };
  const receipt = Object.assign({}, result);
  delete receipt.repeated;
  const patch = {};
  patch["driveImportCandidates/" + driveFileId] = Object.assign({}, candidate, {
    status: "rejected",
    rejectionReason: reason,
    approvedAt: null,
    approvedByUid: null,
    updatedAt: now
  });
  patch["driveImportAuditLogs/" + auditId] = {
    id: auditId,
    action: "drive_building_rejected",
    requestId: requestId,
    driveFileId: driveFileId,
    actorUid: actorUid,
    reason: reason,
    occurredAt: now
  };
  patch["driveImportRequestReceipts/" + requestId] = receipt;
  return { patch: patch, result: result };
}

function verifyFirebaseIdTokenForDriveImport_(idToken) {
  const token = String(idToken || "").trim();
  if (!token || token.length > 4096) throw new Error("로그인 인증정보가 올바르지 않습니다.");
  const apiKey = String(PropertiesService.getScriptProperties().getProperty("CRM_FIREBASE_WEB_API_KEY") || "").trim();
  if (!apiKey) throw new Error("CRM Firebase 인증 설정이 없습니다.");
  const response = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
    method: "post",
    contentType: "application/json; charset=utf-8",
    payload: JSON.stringify({ idToken: token }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
  const body = JSON.parse(response.getContentText() || "{}");
  const user = body.users && body.users[0];
  if (!user || !user.localId || !user.email || user.emailVerified !== true) throw new Error("확인된 Firebase 이메일 계정이 필요합니다.");
  return { uid: String(user.localId), email: String(user.email).trim().toLowerCase() };
}

function handleApproveDriveImport_(payload) {
  payload = payload && typeof payload === "object" ? payload : {};
  const identity = verifyFirebaseIdTokenForDriveImport_(payload.idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const root = firebaseOauthRequest_(crmCompanyImportUrl_(""), "get", undefined, "CRM 승인 자료 조회 실패") || {};
    const access = root.access && root.access[identity.uid];
    assertDriveImportApprover_(access, identity);
    const requestId = String(payload.requestId || "");
    const receipt = root.driveImportRequestReceipts && root.driveImportRequestReceipts[requestId];
    const driveFileId = String(payload.driveFileId || "");
    const candidate = root.driveImportCandidates && root.driveImportCandidates[driveFileId];
    const built = buildDriveImportApprovalPatch_({
      requestId: requestId,
      now: new Date().toISOString(),
      actor: identity,
      candidate: candidate,
      approved: payload.approved,
      buildings: root.data && root.data.buildings || {},
      receipt: receipt
    });
    if (Object.keys(built.patch).length) {
      firebaseOauthRequest_(crmCompanyImportUrl_(""), "patch", built.patch, "Drive 자료 CRM 승인 실패");
    }
    return { ok: true, result: built.result };
  } finally {
    lock.releaseLock();
  }
}

function handleRejectDriveImport_(payload) {
  payload = payload && typeof payload === "object" ? payload : {};
  const identity = verifyFirebaseIdTokenForDriveImport_(payload.idToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const root = firebaseOauthRequest_(crmCompanyImportUrl_(""), "get", undefined, "CRM 반려 자료 조회 실패") || {};
    assertDriveImportApprover_(root.access && root.access[identity.uid], identity);
    const requestId = String(payload.requestId || "");
    const driveFileId = String(payload.driveFileId || "");
    const built = buildDriveImportRejectionPatch_({
      requestId: requestId,
      now: new Date().toISOString(),
      actor: identity,
      candidate: root.driveImportCandidates && root.driveImportCandidates[driveFileId],
      reason: payload.reason,
      receipt: root.driveImportRequestReceipts && root.driveImportRequestReceipts[requestId]
    });
    if (Object.keys(built.patch).length) firebaseOauthRequest_(crmCompanyImportUrl_(""), "patch", built.patch, "Drive 자료 CRM 반려 실패");
    return { ok: true, result: built.result };
  } finally {
    lock.releaseLock();
  }
}

function extractOnboardingField_(text, labels) {
  const source = String(text || "").replace(/\r/g, "\n").replace(/[\t ]+/g, " ").replace(/\n+/g, " ").trim();
  const stopLabels = "(?:건물명|건물 주소|주소|소재지|담당자명|담당자|건물주명|건물주 성명|건물주|소유자명|소유자|임대인명|임대인|대표자|연락처|전화번호|전화|휴대폰|등급|비고)";
  const isInstruction = value => /(?:주소로\s*계약\s*건물을?\s*확인|계약\s*건물\s*인덱스|확인하기\s*위한|간단\s*기록용|응답\s*시트|동일하게\s*입력|입력하면|자동\s*매칭)/i.test(String(value || ""));
  for (const label of labels || []) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const separator = "(?:\\s*[:：]\\s*|[ \\t]+)";
    const matcher = new RegExp("(?:^|\\s)" + escaped + separator + "(.{2,120}?)(?=\\s+" + stopLabels + "(?:\\s*[:：]|[ \\t]+)|$)", "ig");
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const value = String(match[1] || "").trim();
      if (!isInstruction(value)) return value;
    }
  }
  return "";
}

function extractOnboardingOwnerName_(text) {
  const value = extractOnboardingField_(text, ["건물주명", "건물주 성명", "소유자명", "임대인명", "건물주", "소유자", "임대인"]);
  if (!value || /(?:연락처|전화|휴대폰|번호)/.test(value) || /\d{2,}[-.\s]?\d{3,}/.test(value)) return "";
  return value.slice(0, 60).trim();
}

function onboardingBuildingFromFileName_(fileName) {
  return String(fileName || "")
    .replace(/(?:\.(?:docx?|hwp|hwpx|pdf))+$/i, "")
    .replace(/[_-]*(온보딩|수집서|계약|계약서).*$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function syncPaymentBuildings() {
  const result = syncPaymentBuildingsFromOnboarding_();
  Logger.log(JSON.stringify(result));
  return result;
}

function setupPaymentScheduleSheet() {
  const result = setupPaymentScheduleSheet_();
  const trigger = ensurePaymentScheduleEditTrigger_();
  const output = Object.assign({}, result, { autoSync: true, trigger: trigger });
  Logger.log(JSON.stringify(output));
  return output;
}

function paymentScheduleSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty("PAYMENT_SCHEDULE_SPREADSHEET_ID")
    || COMPLAINT_CONFIG.SPREADSHEET_ID;
}

function ensurePaymentScheduleEditTrigger_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "onPaymentScheduleSheetEdit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  const trigger = ScriptApp.newTrigger("onPaymentScheduleSheetEdit")
    .forSpreadsheet(paymentScheduleSpreadsheetId_())
    .onEdit()
    .create();
  return {
    handler: trigger.getHandlerFunction(),
    spreadsheetId: paymentScheduleSpreadsheetId_()
  };
}

function setupPaymentScheduleAutoSync() {
  const result = setupPaymentScheduleSheet_();
  const trigger = ensurePaymentScheduleEditTrigger_();
  const output = Object.assign({}, result, { autoSync: true, trigger: trigger });
  Logger.log(JSON.stringify(output));
  return output;
}

function ensurePaymentNotificationTrigger_() {
  const handler = "processPaymentNotificationAutomation";
  const exists = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === handler
  );
  if (!exists) {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyHours(1)
      .create();
  }
  return { handler: handler, created: !exists, cadence: "hourly" };
}

function setupPaymentNotificationAutomation() {
  const trigger = ensurePaymentNotificationTrigger_();
  const configured = !!PropertiesService.getScriptProperties()
    .getProperty(PAYMENT_NOTIFICATION_CONFIG_PROPERTY);
  const output = {
    ok: true,
    configured: configured,
    dueAlertAfter: String(PAYMENT_DUE_ALERT_HOUR).padStart(2, "0") + ":00",
    overdueAlertAfter: String(PAYMENT_OVERDUE_ALERT_HOUR).padStart(2, "0") + ":00",
    trigger: trigger,
    build: AUTOMATION_BUILD
  };
  Logger.log(JSON.stringify(output));
  return output;
}

function onPaymentScheduleSheetEdit(e) {
  const range = e && e.range;
  if (!range) return;
  const sheet = range.getSheet();
  if (!sheet || sheet.getName() !== PAYMENT_SCHEDULE_SHEET_NAME) return;
  if (sheet.getParent().getId() !== paymentScheduleSpreadsheetId_()) return;
  if (range.getLastRow() < 2 || range.getColumn() > PAYMENT_SCHEDULE_HEADERS.length) return;

  firebaseWriteRequest_(
    firebaseCaseSettingsUrl_("paymentScheduleSheet"),
    "patch",
    {
      lastEditedAt: new Date().toISOString(),
      autoSyncEnabled: true,
      build: AUTOMATION_BUILD
    },
    "세입자 월세 관리대장 자동 반영 신호 저장 실패"
  );
}

function movePaymentScheduleSheetToBringCareFolder() {
  const props = PropertiesService.getScriptProperties();
  const currentId = props.getProperty("PAYMENT_SCHEDULE_SPREADSHEET_ID");
  let targetSpreadsheet;
  if (currentId) {
    targetSpreadsheet = SpreadsheetApp.openById(currentId);
  } else {
    targetSpreadsheet = SpreadsheetApp.create(COMPLAINT_CONFIG.PAYMENT_SCHEDULE_SPREADSHEET_NAME);
    const targetFile = DriveApp.getFileById(targetSpreadsheet.getId());
    const targetFolder = DriveApp.getFolderById(COMPLAINT_CONFIG.PAYMENT_SCHEDULE_DRIVE_FOLDER_ID);
    targetFile.moveTo(targetFolder);

    const sourceSpreadsheet = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
    const sourceSheet = sourceSpreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
    if (sourceSheet) {
      const copiedSheet = sourceSheet.copyTo(targetSpreadsheet).setName(PAYMENT_SCHEDULE_SHEET_NAME);
      targetSpreadsheet.getSheets().forEach(sheet => {
        if (sheet.getSheetId() !== copiedSheet.getSheetId() && targetSpreadsheet.getSheets().length > 1) {
          targetSpreadsheet.deleteSheet(sheet);
        }
      });
    } else {
      targetSpreadsheet.getSheets()[0].setName(PAYMENT_SCHEDULE_SHEET_NAME);
    }
    props.setProperty("PAYMENT_SCHEDULE_SPREADSHEET_ID", targetSpreadsheet.getId());
  }

  const result = setupPaymentScheduleSheet_();
  ensurePaymentScheduleEditTrigger_();
  const sourceSpreadsheet = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  const sourceSheet = sourceSpreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  const targetSheet = targetSpreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  if (sourceSheet && targetSheet && targetSpreadsheet.getId() !== sourceSpreadsheet.getId()) {
    const sourceHeaders = sourceSheet.getRange(1, 1, 1, PAYMENT_SCHEDULE_HEADERS.length).getDisplayValues()[0];
    const targetHeaders = targetSheet.getRange(1, 1, 1, PAYMENT_SCHEDULE_HEADERS.length).getDisplayValues()[0];
    if (JSON.stringify(sourceHeaders) !== JSON.stringify(targetHeaders)) {
      throw new Error("새 관리대장 파일의 열을 확인하지 못해 기존 탭을 유지했습니다.");
    }
    sourceSpreadsheet.deleteSheet(sourceSheet);
  }
  const output = Object.assign({}, result, {
    moved: true,
    spreadsheetId: targetSpreadsheet.getId(),
    folderId: COMPLAINT_CONFIG.PAYMENT_SCHEDULE_DRIVE_FOLDER_ID,
    fileName: targetSpreadsheet.getName()
  });
  Logger.log(JSON.stringify(output));
  return output;
}

function setupPaymentScheduleSheet_() {
  const spreadsheet = SpreadsheetApp.openById(paymentScheduleSpreadsheetId_());
  let sheet = spreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(PAYMENT_SCHEDULE_SHEET_NAME);

  const existingHeaderCount = Math.max(sheet.getLastColumn(), PAYMENT_SCHEDULE_HEADERS.length - 1);
  const existingHeaders = sheet.getRange(1, 1, 1, existingHeaderCount).getDisplayValues()[0]
    .map(value => String(value || "").trim());
  if (existingHeaders.indexOf("연락처") === -1 && existingHeaders[4] === "입금자명") {
    sheet.insertColumnAfter(4);
  }

  const headerCount = PAYMENT_SCHEDULE_HEADERS.length;
  if (sheet.getMaxColumns() < headerCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headerCount - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headerCount).setValues([PAYMENT_SCHEDULE_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.setTabColor("#1b335f");
  sheet.getRange(1, 1, 1, headerCount)
    .setBackground("#1b335f")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 34);

  const widths = [120, 190, 90, 110, 135, 110, 120, 105, 115, 115, 90, 240];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.getRange("E2:E").setNumberFormat("@");
  sheet.getRange("G2:G").setNumberFormat("#,##0").setHorizontalAlignment("right");
  sheet.getRange("H2:H").setNumberFormat("0").setHorizontalAlignment("center");
  sheet.getRange("I2:J").setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center");
  sheet.getRange("K2:K").setHorizontalAlignment("center");
  sheet.getRange("L2:L").setWrap(true);

  const statusValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(["계약중", "종료", "보류"], true)
    .setAllowInvalid(false)
    .setHelpText("계약중, 종료, 보류 중 하나를 선택하세요.")
    .build();
  sheet.getRange("K2:K").setDataValidation(statusValidation);

  const buildingNames = paymentBuildingRegistryRecords_().map(item => item.name);
  if (buildingNames.length) {
    const buildingValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList(buildingNames, true)
      .setAllowInvalid(false)
      .setHelpText("입금확인 캘린더에 등록된 건물을 선택하세요.")
      .build();
    sheet.getRange("B2:B").setDataValidation(buildingValidation);
  }

  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), headerCount).createFilter();
  sheet.getRange("A2:A").setBackground("#f3f6fb").setFontColor("#6b7686");
  sheet.getRange("A1").setNote("자동 동기화용 번호입니다. 직접 수정하지 마세요.");
  sheet.getRange("E1").setNote("납부 당일·미입금 안내 문자를 받을 세입자 휴대폰 번호를 입력하세요.");
  sheet.getRange("F1").setNote("은행 통장에 실제로 표시되는 입금자명을 입력하세요. 세입자명과 다를 수 있습니다.");
  sheet.getRange("H1").setNote("매월 납부일을 1~31 사이 숫자로 입력하세요. 31일이 없는 달은 말일로 표시됩니다.");

  const sheetUrl = spreadsheet.getUrl() + "#gid=" + sheet.getSheetId();
  firebaseWriteRequest_(
    firebaseCaseSettingsUrl_("paymentScheduleSheet"),
    "patch",
    { name: PAYMENT_SCHEDULE_SHEET_NAME, url: sheetUrl, updatedAt: new Date().toISOString(), autoSyncEnabled: true, build: AUTOMATION_BUILD },
    "세입자 월세 관리대장 연결정보 저장 실패"
  );
  return { ok: true, sheetName: PAYMENT_SCHEDULE_SHEET_NAME, sheetUrl: sheetUrl, build: AUTOMATION_BUILD };
}

function paymentBuildingRegistryRecords_() {
  const registry = firebaseOauthRequest_(
    firebaseCaseSettingsUrl_("paymentBuildings"),
    "get",
    undefined,
    "입금 캘린더 건물 조회 실패"
  ) || {};
  return Object.keys(registry).map(key => {
    const item = registry[key] || {};
    return {
      id: String(item.id || item.driveFileId || key),
      name: String(item.building || item.name || "").trim(),
      address: String(item.address || "").trim()
    };
  }).filter(item => item.id && item.name);
}

function paymentScheduleSheetText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM-dd");
  }
  return String(value == null ? "" : value).trim();
}

function paymentScheduleSheetMonth_(value, fallbackMonth) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM");
  }
  const text = paymentScheduleSheetText_(value);
  const match = text.match(/^(\d{4})[-./년\s]+(\d{1,2})/);
  if (!match) return fallbackMonth || "";
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? match[1] + "-" + String(month).padStart(2, "0") : (fallbackMonth || "");
}

function paymentScheduleSheetNumber_(value) {
  if (typeof value === "number" && isFinite(value)) return Math.round(value);
  const digits = paymentScheduleSheetText_(value).replace(/[^0-9.-]/g, "");
  const number = Number(digits);
  return isFinite(number) ? Math.round(number) : 0;
}

function paymentScheduleSheetId_() {
  return "sheet_" + Utilities.getUuid().replace(/-/g, "").slice(0, 20);
}

function paymentScheduleHeaderMap_(headers) {
  const out = {};
  (headers || []).forEach((header, index) => { out[paymentScheduleSheetText_(header)] = index; });
  return out;
}

function paymentScheduleRowValue_(row, headerMap, header) {
  const index = headerMap[header];
  return index === undefined ? "" : row[index];
}

function paymentScheduleRecordFromSheetRow_(row, headerMap, byName, currentMonth, id, rowNumber, requestedAt) {
  const buildingName = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "건물명"));
  const unit = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "호실"));
  const tenantName = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "세입자명"));
  const tenantPhoneRaw = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "연락처"));
  const tenantPhone = tenantPhoneRaw.replace(/\D/g, "");
  const payerName = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "입금자명")) || tenantName;
  const amount = paymentScheduleSheetNumber_(paymentScheduleRowValue_(row, headerMap, "월 납부금액"));
  const dueDay = paymentScheduleSheetNumber_(paymentScheduleRowValue_(row, headerMap, "매월 납부일"));
  const startMonth = paymentScheduleSheetMonth_(paymentScheduleRowValue_(row, headerMap, "계약 시작일"), currentMonth);
  const endMonth = paymentScheduleSheetMonth_(paymentScheduleRowValue_(row, headerMap, "계약 종료일"), "");
  const status = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "상태")) || "계약중";
  const note = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "비고"));
  const matches = byName[normalizeText_(buildingName)] || [];
  const problems = [];
  if (!buildingName) problems.push("건물명");
  else if (!matches.length) problems.push("등록된 건물명과 불일치");
  else if (matches.length > 1) problems.push("같은 이름의 건물이 여러 곳임");
  if (!unit) problems.push("호실");
  if (!tenantName) problems.push("세입자명");
  if (tenantPhoneRaw && !/^01[016789]\d{7,8}$/.test(tenantPhone)) problems.push("연락처(휴대폰 번호)");
  if (!payerName) problems.push("입금자명");
  if (amount <= 0) problems.push("월 납부금액");
  if (dueDay < 1 || dueDay > 31) problems.push("매월 납부일(1~31)");
  if (endMonth && endMonth < startMonth) problems.push("계약 종료일");
  if (["계약중", "종료", "보류"].indexOf(status) === -1) problems.push("상태");
  if (problems.length) return { id: id, problems: problems, schedule: null };

  const building = matches[0];
  return {
    id: id,
    problems: [],
    schedule: {
      id: id,
      buildingId: building.id,
      buildingName: building.name,
      unit: unit,
      tenantName: tenantName,
      tenantPhone: tenantPhone,
      payerName: payerName,
      amount: amount,
      dueDay: dueDay,
      startMonth: startMonth,
      endMonth: endMonth,
      active: status === "계약중" || (status === "종료" && !!endMonth),
      contractStatus: status,
      note: note,
      source: "tenant_sheet",
      sourceSheetName: PAYMENT_SCHEDULE_SHEET_NAME,
      sourceSheetRow: rowNumber,
      updatedAt: requestedAt
    }
  };
}

function firebasePaymentCalendarUrl_(uid, childPath, idToken) {
  const safeUid = String(uid || "").trim();
  if (!/^[A-Za-z0-9:_-]{6,160}$/.test(safeUid)) throw new Error("로그인 사용자 ID가 올바르지 않습니다.");
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const calendarsPath = String(COMPLAINT_CONFIG.FIREBASE_PAYMENT_CALENDARS_PATH || "crmCompany/paymentCalendars").replace(/^\/|\/$/g, "");
  const child = String(childPath || "").split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  const token = String(idToken || "").trim();
  if (!token) throw new Error("로그인 인증정보가 없습니다. 다시 로그인해 주세요.");
  return base + "/" + calendarsPath + "/" + encodeURIComponent(safeUid) + (child ? "/" + child : "") + ".json?auth=" + encodeURIComponent(token);
}

function firebaseReadJson_(url, label) {
  const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(label + ": HTTP " + code + " / " + response.getContentText());
  const body = response.getContentText();
  return body && body !== "null" ? JSON.parse(body) : null;
}

function writePaymentSheetSyncStatus_(payload, status) {
  try {
    firebaseAuthorizedWriteRequest_(
      firebasePaymentCalendarUrl_(payload.uid, "sheetSync", payload.idToken),
      "put",
      status,
      "세입자 자료 동기화 상태 저장 실패"
    );
  } catch (err) {
    Logger.log("세입자 자료 동기화 상태 저장 실패: " + err.message);
  }
}

function firebaseAuthorizedWriteRequest_(url, method, payload, label) {
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

function syncPaymentSchedulesFromSheet_(payload) {
  payload = payload || {};
  const requestedAt = new Date().toISOString();
  const currentMonth = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM");
  try {
    const sheet = SpreadsheetApp.openById(paymentScheduleSpreadsheetId_()).getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
    if (!sheet) throw new Error("세입자 월세 관리대장 탭을 찾지 못했습니다.");
    const lastRow = sheet.getLastRow();
    const lastColumn = Math.max(sheet.getLastColumn(), PAYMENT_SCHEDULE_HEADERS.length);
    const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastColumn).getValues();
    const headerMap = paymentScheduleHeaderMap_(values[0] || []);
    const missingHeaders = PAYMENT_SCHEDULE_HEADERS.filter(header => headerMap[header] === undefined);
    if (missingHeaders.length) throw new Error("관리대장 필수 열이 없습니다: " + missingHeaders.join(", "));

    const buildings = paymentBuildingRegistryRecords_();
    const byName = {};
    buildings.forEach(building => {
      const key = normalizeText_(building.name);
      byName[key] = byName[key] || [];
      byName[key].push(building);
    });

    const schedules = {};
    const errors = [];
    const errorIds = {};
    for (let index = 1; index < values.length; index += 1) {
      const row = values[index];
      const rowNumber = index + 1;
      const hasContent = row.slice(1, PAYMENT_SCHEDULE_HEADERS.length).some(value => paymentScheduleSheetText_(value));
      if (!hasContent) continue;

      let id = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "관리번호"));
      if (!id) {
        id = paymentScheduleSheetId_();
        sheet.getRange(rowNumber, headerMap["관리번호"] + 1).setValue(id);
      }
      const parsed = paymentScheduleRecordFromSheetRow_(row, headerMap, byName, currentMonth, id, rowNumber, requestedAt);
      if (parsed.problems.length) {
        errors.push({ row: rowNumber, message: parsed.problems.join(" · ") });
        errorIds[id] = true;
        continue;
      }
      schedules[id] = parsed.schedule;
    }

    const schedulesUrl = firebasePaymentCalendarUrl_(payload.uid, "schedules", payload.idToken);
    const existing = firebaseReadJson_(schedulesUrl, "기존 월 납부 일정 조회 실패") || {};
    const merged = {};
    Object.keys(existing).forEach(id => {
      const item = existing[id] || {};
      if (item.source !== "tenant_sheet" || (errors.length && errorIds[id])) merged[id] = item;
    });
    Object.keys(schedules).forEach(id => {
      schedules[id].createdAt = existing[id] && existing[id].createdAt || requestedAt;
      merged[id] = schedules[id];
    });
    firebaseAuthorizedWriteRequest_(schedulesUrl, "put", merged, "세입자 월 납부 일정 저장 실패");

    const status = {
      ok: true,
      count: Object.keys(schedules).length,
      errorCount: errors.length,
      errors: errors.slice(0, 20),
      updatedAt: new Date().toISOString(),
      requestedBy: String(payload.adminEmail || ""),
      build: AUTOMATION_BUILD
    };
    writePaymentSheetSyncStatus_(payload, status);
    return status;
  } catch (err) {
    const status = {
      ok: false,
      count: 0,
      errorCount: 1,
      errors: [{ row: 0, message: err.message }],
      updatedAt: new Date().toISOString(),
      requestedBy: String(payload.adminEmail || ""),
      build: AUTOMATION_BUILD
    };
    writePaymentSheetSyncStatus_(payload, status);
    throw err;
  }
}

function paymentReminderDueDate_(month, dueDay) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("납부월이 올바르지 않습니다.");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("납부월이 올바르지 않습니다.");
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Number(dueDay) || 1), lastDay);
  return match[1] + "-" + match[2] + "-" + String(day).padStart(2, "0");
}

function paymentReminderSmsContent_(schedule, dueDate, reminderType) {
  const dateParts = String(dueDate || "").split("-");
  const displayDate = Number(dateParts[0]) + "년 " + Number(dateParts[1]) + "월 " + Number(dateParts[2]) + "일";
  const amount = Number(schedule.amount) || 0;
  return [
    "[BRING Care]",
    schedule.tenantName ? schedule.tenantName + "님, 안녕하세요." : "안녕하세요.",
    reminderType === "due" ? "오늘은 월세 납부일입니다." : "월세 입금이 아직 확인되지 않아 안내드립니다.",
    schedule.buildingName ? "건물: " + schedule.buildingName : "",
    schedule.unit ? "호실: " + schedule.unit : "",
    amount ? "납부금액: " + Math.round(amount).toLocaleString("ko-KR") + "원" : "",
    "납부일: " + displayDate
  ].filter(Boolean).concat(paymentTenantInquiryLines_(reminderType)).join("\n");
}

function paymentTenantInquiryLines_(reminderType) {
  return reminderType === "due" ? [] : [
    "",
    "월세 납부와 관련한 문의사항은 아래 연락처로 연락해 주세요.",
    "문의: 033-748-8919"
  ];
}

function paymentReminderAlimTalkContent_(schedule, dueDate, reminderType) {
  const dateParts = String(dueDate || "").split("-");
  const displayDate = Number(dateParts[0]) + "년 " + Number(dateParts[1]) + "월 " + Number(dateParts[2]) + "일";
  const tenantName = safeAlimTalkVariable_(schedule.tenantName || "고객", 80);
  const buildingName = safeAlimTalkVariable_(schedule.buildingName || "등록 건물", 120);
  const unit = safeAlimTalkVariable_(schedule.unit || "등록 호실", 60);
  const amount = Math.round(Number(schedule.amount) || 0).toLocaleString("ko-KR");
  const notice = reminderType === "due"
    ? "오늘은 월세 납부일입니다."
    : "월세 입금이 아직 확인되지 않아 안내드립니다.";
  return [
    "[BRING Care 월세 납부 안내]",
    tenantName + "님, 안녕하세요.",
    "",
    notice,
    "건물: " + buildingName,
    "호실: " + unit,
    "납부금액: " + amount + "원",
    "납부일: " + displayDate
  ].concat(paymentTenantInquiryLines_(reminderType)).join("\n");
}

function handlePaymentReminderSms_(payload) {
  payload = payload || {};
  const scheduleId = String(payload.scheduleId || "").trim();
  const month = String(payload.month || "").trim();
  if (!/^[A-Za-z0-9_-]{6,160}$/.test(scheduleId)) throw new Error("월 납부 일정 ID가 올바르지 않습니다.");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("납부월이 올바르지 않습니다.");

  const scheduleUrl = firebasePaymentCalendarUrl_(payload.uid, "schedules/" + scheduleId, payload.idToken);
  const schedule = firebaseReadJson_(scheduleUrl, "월 납부 일정 조회 실패");
  if (!schedule || schedule.active === false) throw new Error("발송할 월 납부 일정을 찾지 못했습니다.");

  const tenantPhone = normalizePhoneForSms_(schedule.tenantPhone || "");
  if (!isSendableSmsPhone_(tenantPhone)) throw new Error("관리대장의 세입자 연락처를 확인해 주세요.");
  const dueDate = paymentReminderDueDate_(month, schedule.dueDay);
  const today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  const status = String(payload.status || "");
  const reminderType = dueDate === today ? "due" : "unpaid";
  if (reminderType !== "due" && ["overdue", "manual_unpaid"].indexOf(status) === -1) {
    throw new Error("납부 당일 또는 미입금 일정에만 안내 문자를 보낼 수 있습니다.");
  }

  const recordUrl = firebasePaymentCalendarUrl_(payload.uid, "rentSms/" + month + "/" + scheduleId, payload.idToken);
  const existing = firebaseReadJson_(recordUrl, "기존 월세 안내 문자 기록 조회 실패") || {};
  if (existing.ok === true && payload.force !== true) {
    return Object.assign({}, existing, { skipped: true, message: "이미 발송된 기록이 있습니다." });
  }

  const smsContent = paymentReminderSmsContent_(schedule, dueDate, reminderType);
  const alimTalkContent = paymentReminderAlimTalkContent_(schedule, dueDate, reminderType);
  const kakaoConfig = getKakaoAlimTalkConfig_();
  const templateCode = reminderType === "due"
    ? kakaoConfig.templates.paymentReminder
    : kakaoConfig.templates.paymentReminderOverdue;
  const result = sendKakaoAlimTalkOrSms_(tenantPhone, alimTalkContent, "월세 납부 안내", {
    templateCode: templateCode,
    fallbackContent: smsContent,
    allowSmsFallback: false
  });
  const record = {
    ok: result.ok === true,
    status: result.ok === true
      ? (result.provider === "kakao_alimtalk" ? "카카오 알림톡 요청 완료" : "문자 요청 완료")
      : "발송실패",
    message: result.message || "",
    requestId: result.requestId || "",
    messageId: result.messageId || "",
    provider: result.provider || "",
    templateCode: result.templateCode || "",
    reminderType: reminderType,
    scheduleId: scheduleId,
    month: month,
    dueDate: dueDate,
    phoneMasked: maskPhone_(tenantPhone),
    sentAt: new Date().toISOString(),
    sentBy: String(payload.adminEmail || ""),
    build: AUTOMATION_BUILD
  };
  firebaseAuthorizedWriteRequest_(recordUrl, "put", record, "월세 안내 문자 기록 저장 실패");
  if (!result.ok) throw new Error(result.message || "월세 안내 문자 발송에 실패했습니다.");
  return record;
}

function handlePaymentReminderDeliveryStatus_(payload) {
  payload = payload || {};
  const scheduleId = String(payload.scheduleId || "").trim();
  const month = String(payload.month || "").trim();
  if (!/^[A-Za-z0-9_-]{6,160}$/.test(scheduleId)) throw new Error("월 납부 일정 ID가 올바르지 않습니다.");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("납부 월이 올바르지 않습니다.");

  const recordUrl = firebasePaymentCalendarUrl_(payload.uid, "rentSms/" + month + "/" + scheduleId, payload.idToken);
  const record = firebaseReadJson_(recordUrl, "카카오 알림톡 발송 기록 조회 실패") || {};
  if (record.provider !== "kakao_alimtalk" || !record.messageId) {
    throw new Error("조회할 카카오 알림톡 메시지 ID가 없습니다.");
  }

  const config = getKakaoAlimTalkConfig_();
  if (!config.enabled) throw new Error("카카오 알림톡 설정이 완료되지 않았습니다.");
  const uri = "/alimtalk/v2/services/" + encodeURIComponent(config.serviceId) +
    "/messages/" + encodeURIComponent(String(record.messageId));
  const response = sensGetJson_(uri, config);
  if (!response.ok) throw new Error("카카오 알림톡 전달 결과 조회 실패: " + response.message);

  const result = response.json && typeof response.json === "object" ? response.json : {};
  const messageStatusName = String(result.messageStatusName || "processing").toLowerCase();
  const messageStatusCode = String(result.messageStatusCode || "");
  const delivered = messageStatusName === "success" && messageStatusCode === "0000";
  const processing = messageStatusName === "processing" || (!messageStatusCode && messageStatusName !== "fail");
  const deliveryStatus = delivered ? "delivered" : (processing ? "processing" : "failed");
  const safeResult = {
    ok: true,
    delivered: delivered,
    deliveryStatus: deliveryStatus,
    requestStatusCode: String(result.requestStatusCode || ""),
    requestStatusName: String(result.requestStatusName || ""),
    requestStatusDesc: String(result.requestStatusDesc || ""),
    messageStatusCode: messageStatusCode,
    messageStatusName: messageStatusName,
    messageStatusDesc: String(result.messageStatusDesc || ""),
    completeTime: String(result.completeTime || ""),
    templateCode: String(result.templateCode || record.templateCode || ""),
    checkedAt: new Date().toISOString(),
    build: AUTOMATION_BUILD
  };
  const updatedRecord = Object.assign({}, record, {
    deliveryStatus: safeResult.deliveryStatus,
    deliveryCode: safeResult.messageStatusCode,
    deliveryMessage: safeResult.messageStatusDesc,
    deliveryCheckedAt: safeResult.checkedAt,
    deliveredAt: delivered ? (safeResult.completeTime || safeResult.checkedAt) : String(record.deliveredAt || "")
  });
  firebaseAuthorizedWriteRequest_(recordUrl, "put", updatedRecord, "카카오 알림톡 전달 결과 저장 실패");
  return safeResult;
}

function paymentNotificationSafeBindings_(bankBindings) {
  const safe = {};
  Object.keys(bankBindings || {}).forEach(buildingId => {
    const binding = bankBindings[buildingId] || {};
    const id = String(buildingId || "").trim();
    const accountRef = String(binding.accountRef || "").trim();
    if (!/^[A-Za-z0-9_-]{6,160}$/.test(id)) return;
    if (!/^pb_[A-Za-z0-9_-]{12,40}$/.test(accountRef)) return;
    safe[id] = {
      buildingId: id,
      buildingName: String(binding.buildingName || "").slice(0, 120),
      ownerName: String(binding.ownerName || "").slice(0, 80),
      accountRef: accountRef,
      bankCode: String(binding.bankCode || "").slice(0, 12),
      accountLast4: String(binding.accountLast4 || "").replace(/\D/g, "").slice(-4)
    };
  });
  return safe;
}

function rememberPaymentNotificationAutomation_(payload, bankBindings) {
  const uid = String(payload && payload.uid || "").trim();
  if (!/^[A-Za-z0-9:_-]{6,160}$/.test(uid)) {
    throw new Error("입금 알림 자동화 사용자 ID가 올바르지 않습니다.");
  }
  const safeBindings = paymentNotificationSafeBindings_(bankBindings);
  const config = {
    uid: uid,
    adminEmail: String(payload && payload.adminEmail || "").trim().slice(0, 160),
    bankBindings: safeBindings,
    updatedAt: new Date().toISOString(),
    build: AUTOMATION_BUILD
  };
  PropertiesService.getScriptProperties().setProperty(
    PAYMENT_NOTIFICATION_CONFIG_PROPERTY,
    JSON.stringify(config)
  );
  ensurePaymentNotificationTrigger_();
  return {
    configured: Object.keys(safeBindings).length > 0,
    linkedBuildingCount: Object.keys(safeBindings).length
  };
}

function paymentNotificationConfig_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(PAYMENT_NOTIFICATION_CONFIG_PROPERTY);
  if (!raw) return null;
  try {
    const config = JSON.parse(raw);
    if (!config || !/^[A-Za-z0-9:_-]{6,160}$/.test(String(config.uid || ""))) return null;
    config.bankBindings = paymentNotificationSafeBindings_(config.bankBindings);
    return config;
  } catch (error) {
    return null;
  }
}

function paymentNotificationDateKey_(date, offsetDays) {
  const base = new Date((date || new Date()).getTime() + Number(offsetDays || 0) * 86400000);
  return Utilities.formatDate(base, "Asia/Seoul", "yyyy-MM-dd");
}

function paymentNotificationHour_(date) {
  return Number(Utilities.formatDate(date || new Date(), "Asia/Seoul", "H"));
}

function paymentNotificationSheetSchedules_(now) {
  const sheet = SpreadsheetApp.openById(paymentScheduleSpreadsheetId_())
    .getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  if (!sheet) throw new Error("세입자 월세 관리대장 탭을 찾지 못했습니다.");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const lastColumn = Math.max(sheet.getLastColumn(), PAYMENT_SCHEDULE_HEADERS.length);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headerMap = paymentScheduleHeaderMap_(values[0] || []);
  const missingHeaders = PAYMENT_SCHEDULE_HEADERS.filter(header => headerMap[header] === undefined);
  if (missingHeaders.length) throw new Error("관리대장 필수 열이 없습니다: " + missingHeaders.join(", "));

  const buildings = paymentBuildingRegistryRecords_();
  const byName = {};
  buildings.forEach(building => {
    const key = normalizeText_(building.name);
    byName[key] = byName[key] || [];
    byName[key].push(building);
  });
  const currentMonth = Utilities.formatDate(now || new Date(), "Asia/Seoul", "yyyy-MM");
  const schedules = {};
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    const rowNumber = index + 1;
    const hasContent = row.slice(1, PAYMENT_SCHEDULE_HEADERS.length)
      .some(value => paymentScheduleSheetText_(value));
    if (!hasContent) continue;
    const id = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "관리번호"));
    if (!id) continue;
    const parsed = paymentScheduleRecordFromSheetRow_(
      row,
      headerMap,
      byName,
      currentMonth,
      id,
      rowNumber,
      new Date().toISOString()
    );
    if (parsed.problems.length || !parsed.schedule || parsed.schedule.active === false) continue;
    schedules[id] = parsed.schedule;
  }
  return schedules;
}

function paymentNotificationMatchedPayment_(transaction, match, accountRef) {
  const tid = String(transaction && transaction.tid || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 120);
  const date = popbillBankIsoDate_(transaction && transaction.trdate);
  const amount = Number(String(transaction && transaction.accIn || "0").replace(/,/g, "")) || 0;
  const scheduleId = String(match && match.matchedScheduleId || "");
  const buildingId = String(match && match.buildingId || "");
  if (!tid || !date || amount <= 0 || !scheduleId || !buildingId) return null;
  return {
    id: [String(accountRef || ""), tid].join("_"),
    accountRef: String(accountRef || ""),
    transactionId: tid,
    date: date,
    transactionAt: String(transaction && transaction.trdt || "").slice(0, 40),
    payerName: String(match && match.payerName || "").slice(0, 120),
    amount: amount,
    scheduleId: scheduleId,
    buildingId: buildingId,
    buildingName: String(match && match.buildingName || "").slice(0, 120)
  };
}

function paymentNotificationTransactionState_(schedules, bankBindings, now) {
  const bindings = paymentNotificationSafeBindings_(bankBindings);
  const allAccounts = popbillApiRequest_("get", "/EasyFin/Bank/ListBankAccount");
  const activeAccounts = (Array.isArray(allAccounts) ? allAccounts : [])
    .filter(account => Number(account && account.state) === 1);
  const requiredRefs = {};
  Object.keys(bindings).forEach(buildingId => {
    requiredRefs[String(bindings[buildingId].accountRef || "")] = true;
  });

  const endDate = popbillBankCompactDate_(now || new Date());
  const startDate = popbillBankAddDays_(endDate, -POPBILL_BANK_SYNC_DAYS);
  const paidScheduleIds = {};
  const matchedPayments = [];
  const availableAccountRefs = {};
  const errors = [];
  activeAccounts.forEach(account => {
    const accountRef = popbillBankAccountRef_(account);
    if (!requiredRefs[accountRef]) return;
    const accountSchedules = popbillBankSchedulesForAccount_(schedules, bindings, accountRef);
    try {
      const collected = popbillBankCollectAccount_(account, startDate, endDate);
      if (collected.pending) return;
      availableAccountRefs[accountRef] = true;
      (collected.list || []).forEach(transaction => {
        const match = popbillBankResolveTransactionMatch_(transaction, accountSchedules);
        if (match.matchStatus === "matched" && match.matchedScheduleId) {
          paidScheduleIds[match.matchedScheduleId] = true;
          const payment = paymentNotificationMatchedPayment_(transaction, match, accountRef);
          if (payment) matchedPayments.push(payment);
        }
      });
    } catch (error) {
      errors.push({
        accountRef: accountRef,
        message: popbillBankSafeError_(error)
      });
    }
  });
  return {
    paidScheduleIds: paidScheduleIds,
    matchedPayments: matchedPayments,
    availableAccountRefs: availableAccountRefs,
    errors: errors
  };
}

function paymentNotificationPlan_(schedules, bankBindings, transactionState, now) {
  const bindings = paymentNotificationSafeBindings_(bankBindings);
  const state = transactionState || {};
  const paid = state.paidScheduleIds || {};
  const available = state.availableAccountRefs || {};
  const current = now || new Date();
  const today = paymentNotificationDateKey_(current, 0);
  const yesterday = paymentNotificationDateKey_(current, -1);
  const hour = paymentNotificationHour_(current);
  const plan = {
    today: today,
    tenantDue: [],
    ownerDue: {},
    tenantOverdue: [],
    ownerOverdue: {},
    skippedUnlinked: 0,
    skippedUnavailable: 0
  };

  Object.keys(schedules || {}).forEach(id => {
    const schedule = Object.assign({ id: id }, schedules[id] || {});
    const binding = bindings[String(schedule.buildingId || "")] || {};
    const accountRef = String(binding.accountRef || "");
    if (!accountRef) {
      plan.skippedUnlinked += 1;
      return;
    }
    if (!available[accountRef]) {
      plan.skippedUnavailable += 1;
      return;
    }
    if (paid[id]) return;

    const monthKeys = Array.from(new Set([today.slice(0, 7), yesterday.slice(0, 7)]));
    monthKeys.forEach(monthKey => {
      if (!popbillBankScheduleActiveInMonth_(schedule, monthKey)) return;
      const dueDate = paymentReminderDueDate_(monthKey, schedule.dueDay);
      if (hour >= PAYMENT_DUE_ALERT_HOUR && dueDate === today) {
        plan.tenantDue.push({ schedule: schedule, dueDate: dueDate });
        plan.ownerDue[schedule.buildingId] = plan.ownerDue[schedule.buildingId] || [];
        plan.ownerDue[schedule.buildingId].push({ schedule: schedule, dueDate: dueDate });
      }
      if (hour >= PAYMENT_OVERDUE_ALERT_HOUR && dueDate === yesterday) {
        plan.tenantOverdue.push({ schedule: schedule, dueDate: dueDate });
        plan.ownerOverdue[schedule.buildingId] = plan.ownerOverdue[schedule.buildingId] || [];
        plan.ownerOverdue[schedule.buildingId].push({ schedule: schedule, dueDate: dueDate });
      }
    });
  });
  return plan;
}

function paymentNotificationOwnerContacts_() {
  const result = listDriveOnboardingCandidates_();
  if (!result.ok) throw new Error(result.error || "온보딩 건물주 연락처를 읽지 못했습니다.");
  const contacts = {};
  result.candidates.forEach(candidate => {
    const id = candidate && candidate.file && candidate.file.getId();
    if (!id) return;
    const text = String(candidate.text || "");
    const labelMatch = text.match(/건물주\s*(?:연락처|전화번호|휴대폰|번호)\s*[:：]?\s*((?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/);
    const phone = normalizePhoneForSms_(labelMatch ? labelMatch[1] : "");
    contacts[id] = {
      ownerName: String(candidate.ownerName || "").trim(),
      buildingName: String(candidate.building || "").trim(),
      phone: isSendableSmsPhone_(phone) ? phone : ""
    };
  });
  return contacts;
}

function paymentNotificationConfirmedEventId_(payment) {
  const paymentId = String(payment && payment.id || "");
  if (!paymentId) return "";
  return ["owner", "confirmed", paymentId]
    .join("_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 220);
}

function paymentNotificationConfirmedGroups_(schedules, matchedPayments, seenEntries) {
  const groups = {};
  const seen = seenEntries || {};
  const seenInRun = {};
  let duplicateSkipped = 0;
  let invalidSkipped = 0;
  (matchedPayments || []).forEach(payment => {
    const eventId = paymentNotificationConfirmedEventId_(payment);
    const schedule = schedules && schedules[String(payment && payment.scheduleId || "")];
    const buildingId = String(payment && payment.buildingId || "");
    if (!eventId || !schedule || !buildingId || String(schedule.buildingId || "") !== buildingId) {
      invalidSkipped += 1;
      return;
    }
    if (seen[eventId] || seenInRun[eventId]) {
      duplicateSkipped += 1;
      return;
    }
    seenInRun[eventId] = true;
    groups[buildingId] = groups[buildingId] || [];
    groups[buildingId].push({
      schedule: Object.assign({ id: String(payment.scheduleId || "") }, schedule),
      payment: payment,
      eventId: eventId
    });
  });
  return {
    groups: groups,
    duplicateSkipped: duplicateSkipped,
    invalidSkipped: invalidSkipped
  };
}

function paymentOwnerSummaryDetail_(rows, reminderType) {
  const items = (rows || []).slice().sort((left, right) =>
    String(left.schedule && left.schedule.unit || "")
      .localeCompare(String(right.schedule && right.schedule.unit || ""), "ko")
  );
  const total = items.reduce((sum, row) => sum + (Number(row.schedule && row.schedule.amount) || 0), 0);
  const label = reminderType === "overdue" ? "미입금" : "예정";
  let detail = label + " " + items.length + "건 / 총 " +
    Math.round(total).toLocaleString("ko-KR") + "원";
  let included = 0;
  items.forEach(row => {
    const schedule = row.schedule || {};
    const item = [
      safeAlimTalkVariable_(schedule.unit || "호실 미입력", "호실 미입력"),
      safeAlimTalkVariable_(schedule.tenantName || "세입자 미입력", "세입자 미입력"),
      Math.round(Number(schedule.amount) || 0).toLocaleString("ko-KR") + "원"
    ].join(" ");
    if ((detail + " · " + item).length > 520) return;
    detail += " · " + item;
    included += 1;
  });
  if (included < items.length) detail += " · 외 " + (items.length - included) + "건";
  return detail;
}

function paymentOwnerPhoneGroups_(buildingRows, ownerContacts) {
  const grouped = {};
  Object.keys(buildingRows || {}).sort().forEach(buildingId => {
    const rows = Array.isArray(buildingRows[buildingId]) ? buildingRows[buildingId] : [];
    if (!rows.length) return;
    const contact = ownerContacts && ownerContacts[buildingId] || {};
    const schedule = rows[0] && rows[0].schedule || {};
    const normalizedPhone = normalizePhoneForSms_(contact.phone || "");
    const sendable = isSendableSmsPhone_(normalizedPhone);
    const key = sendable ? normalizedPhone : "missing_" + buildingId;
    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        phone: sendable ? normalizedPhone : "",
        ownerName: contact.ownerName || schedule.ownerName || "건물주",
        buildings: []
      };
    }
    grouped[key].buildings.push({
      buildingId: String(buildingId),
      buildingName: contact.buildingName || schedule.buildingName || "등록 건물",
      rows: rows
    });
  });
  return Object.keys(grouped).sort().map(key => {
    grouped[key].buildings.sort((left, right) =>
      String(left.buildingName || "").localeCompare(String(right.buildingName || ""), "ko")
    );
    return grouped[key];
  });
}

function paymentOwnerSummaryBuildingsDetail_(buildings, reminderType) {
  const groups = Array.isArray(buildings) ? buildings : [];
  const label = reminderType === "overdue" ? "미입금" : "예정";
  const allRows = groups.reduce((rows, building) =>
    rows.concat(Array.isArray(building && building.rows) ? building.rows : []), []);
  const totalAmount = allRows.reduce((sum, row) =>
    sum + (Number(row.schedule && row.schedule.amount) || 0), 0);
  const overall = "전체 " + label + " " + allRows.length + "건 / 총 " +
    Math.round(totalAmount).toLocaleString("ko-KR") + "원";
  const lines = [];
  let omitted = 0;
  groups.forEach(building => {
    const rows = (building.rows || []).slice().sort((left, right) =>
      String(left.schedule && left.schedule.unit || "")
        .localeCompare(String(right.schedule && right.schedule.unit || ""), "ko")
    );
    const buildingTotal = rows.reduce((sum, row) =>
      sum + (Number(row.schedule && row.schedule.amount) || 0), 0);
    const sectionHeader = [
      "건물: " + safeAlimTalkVariable_(building.buildingName || "등록 건물", "등록 건물"),
      label + " " + rows.length + "건 / 총 " +
        Math.round(buildingTotal).toLocaleString("ko-KR") + "원"
    ];
    const separator = lines.length ? [""] : [];
    const headerCandidate = lines.concat(separator, sectionHeader, groups.length > 1 ? ["", overall] : [])
      .join("\n");
    if (headerCandidate.length > 720) {
      omitted += rows.length;
      return;
    }
    lines.push.apply(lines, separator.concat(sectionHeader));
    rows.forEach(row => {
      const schedule = row.schedule || {};
      const item = "· " + [
        safeAlimTalkVariable_(schedule.unit || "호실 미입력", "호실 미입력"),
        safeAlimTalkVariable_(schedule.tenantName || "세입자 미입력", "세입자 미입력"),
        Math.round(Number(schedule.amount) || 0).toLocaleString("ko-KR") + "원"
      ].join(" ");
      const candidate = lines.concat([item], groups.length > 1 ? ["", overall] : []).join("\n");
      if (candidate.length > 720) {
        omitted += 1;
        return;
      }
      lines.push(item);
    });
  });
  if (omitted) lines.push("· 세부내역 외 " + omitted + "건");
  if (groups.length > 1) lines.push("", overall);
  return lines.join("\n");
}

function paymentOwnerSummaryAlimTalkContent_(ownerName, buildings, reminderType) {
  const firstRows = buildings && buildings[0] && buildings[0].rows || [];
  const dueDate = String(firstRows[0] && firstRows[0].dueDate || "");
  const dateParts = dueDate.split("-");
  const displayDate = dateParts.length === 3 && dateParts.every(part => /^\d+$/.test(part))
    ? Number(dateParts[0]) + "년 " + Number(dateParts[1]) + "월 " + Number(dateParts[2]) + "일"
    : "";
  const notice = reminderType === "overdue"
    ? "납부일 다음 날 13시까지 입금이 확인되지 않은 내역입니다."
    : (displayDate ? displayDate + " 입금 예정 내역을 안내드립니다." : "입금 예정 내역을 안내드립니다.");
  return [
    "[BRING Care 월세 입금 안내]",
    safeAlimTalkVariable_(ownerName || "건물주", "건물주") + "님, 안녕하세요.",
    "",
    "본 알림은 BRING Care가 관리하는 임대차 계약의 월세 납부 예정 또는 미입금 현황을 계약 건물주에게 안내하는 정보성 알림입니다.",
    "",
    notice,
    paymentOwnerSummaryBuildingsDetail_(buildings, reminderType)
  ].join("\n");
}

function paymentOwnerConfirmedDetail_(rows) {
  const items = (rows || []).slice().sort((left, right) => {
    const leftDate = String(left.payment && left.payment.date || "");
    const rightDate = String(right.payment && right.payment.date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left.schedule && left.schedule.unit || "")
      .localeCompare(String(right.schedule && right.schedule.unit || ""), "ko");
  });
  const total = items.reduce((sum, row) =>
    sum + (Number(row.payment && row.payment.amount) || 0), 0);
  let detail = "입금완료 " + items.length + "건 / 총 " +
    Math.round(total).toLocaleString("ko-KR") + "원";
  let included = 0;
  items.forEach(row => {
    const schedule = row.schedule || {};
    const payment = row.payment || {};
    const dateParts = String(payment.date || "").split("-");
    const dateText = dateParts.length === 3
      ? Number(dateParts[1]) + "월 " + Number(dateParts[2]) + "일"
      : "입금일 미확인";
    const payerText = payment.payerName
      ? "(입금자 " + safeAlimTalkVariable_(payment.payerName, "미확인") + ")"
      : "";
    const item = [
      safeAlimTalkVariable_(schedule.unit || "호실 미입력", "호실 미입력"),
      safeAlimTalkVariable_(schedule.tenantName || "세입자 미입력", "세입자 미입력") + payerText,
      Math.round(Number(payment.amount) || 0).toLocaleString("ko-KR") + "원",
      dateText
    ].join(" ");
    if ((detail + " · " + item).length > 520) return;
    detail += " · " + item;
    included += 1;
  });
  if (included < items.length) detail += " · 외 " + (items.length - included) + "건";
  return detail;
}

function paymentOwnerConfirmedBuildingsDetail_(buildings) {
  const groups = Array.isArray(buildings) ? buildings : [];
  const allRows = groups.reduce((rows, building) =>
    rows.concat(Array.isArray(building && building.rows) ? building.rows : []), []);
  const totalAmount = allRows.reduce((sum, row) =>
    sum + (Number(row.payment && row.payment.amount) || 0), 0);
  const overall = "전체 입금완료 " + allRows.length + "건 / 총 " +
    Math.round(totalAmount).toLocaleString("ko-KR") + "원";
  const lines = [];
  let omitted = 0;
  groups.forEach(building => {
    const rows = (building.rows || []).slice().sort((left, right) => {
      const leftDate = String(left.payment && left.payment.date || "");
      const rightDate = String(right.payment && right.payment.date || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return String(left.schedule && left.schedule.unit || "")
        .localeCompare(String(right.schedule && right.schedule.unit || ""), "ko");
    });
    const buildingTotal = rows.reduce((sum, row) =>
      sum + (Number(row.payment && row.payment.amount) || 0), 0);
    const sectionHeader = [
      "건물: " + safeAlimTalkVariable_(building.buildingName || "등록 건물", "등록 건물"),
      "입금완료 " + rows.length + "건 / 총 " +
        Math.round(buildingTotal).toLocaleString("ko-KR") + "원"
    ];
    const separator = lines.length ? [""] : [];
    const headerCandidate = lines.concat(separator, sectionHeader, groups.length > 1 ? ["", overall] : [])
      .join("\n");
    if (headerCandidate.length > 720) {
      omitted += rows.length;
      return;
    }
    lines.push.apply(lines, separator.concat(sectionHeader));
    rows.forEach(row => {
      const schedule = row.schedule || {};
      const payment = row.payment || {};
      const dateParts = String(payment.date || "").split("-");
      const dateText = dateParts.length === 3
        ? Number(dateParts[1]) + "월 " + Number(dateParts[2]) + "일"
        : "입금일 미확인";
      const payerText = payment.payerName
        ? "(입금자 " + safeAlimTalkVariable_(payment.payerName, "미확인") + ")"
        : "";
      const item = "· " + [
        safeAlimTalkVariable_(schedule.unit || "호실 미입력", "호실 미입력"),
        safeAlimTalkVariable_(schedule.tenantName || "세입자 미입력", "세입자 미입력") + payerText,
        Math.round(Number(payment.amount) || 0).toLocaleString("ko-KR") + "원",
        dateText
      ].join(" ");
      const candidate = lines.concat([item], groups.length > 1 ? ["", overall] : []).join("\n");
      if (candidate.length > 720) {
        omitted += 1;
        return;
      }
      lines.push(item);
    });
  });
  if (omitted) lines.push("· 세부내역 외 " + omitted + "건");
  if (groups.length > 1) lines.push("", overall);
  return lines.join("\n");
}

function paymentOwnerConfirmedAlimTalkContent_(ownerName, buildings) {
  return [
    "[BRING Care 월세 입금 완료 안내]",
    safeAlimTalkVariable_(ownerName || "건물주", "건물주") + "님, 안녕하세요.",
    "",
    "월세 입금이 확인되었습니다.",
    paymentOwnerConfirmedBuildingsDetail_(buildings)
  ].join("\n");
}

function kakaoAlimTalkTemplateState_(templateCode, config) {
  const resolved = config || getKakaoAlimTalkConfig_();
  if (!resolved.enabled) {
    return { ready: false, templateCode: templateCode, message: "카카오 알림톡 설정 필요" };
  }
  const uri = "/alimtalk/v2/services/" + encodeURIComponent(resolved.serviceId) +
    "/templates?channelId=" + encodeURIComponent(resolved.plusFriendId) +
    "&templateCode=" + encodeURIComponent(String(templateCode || ""));
  const response = sensGetJson_(uri, resolved);
  if (!response.ok) {
    return { ready: false, templateCode: templateCode, message: response.message || "템플릿 조회 실패" };
  }
  const list = Array.isArray(response.json)
    ? response.json
    : (response.json && Array.isArray(response.json.templates) ? response.json.templates : []);
  const template = list.find(item => String(item && item.templateCode || "") === String(templateCode || ""));
  return {
    ready: !!template &&
      String(template.templateInspectionStatus || "") === "COMPLETE" &&
      String(template.templateStatus || "") === "ACTIVE",
    templateCode: String(templateCode || ""),
    inspectionStatus: String(template && template.templateInspectionStatus || ""),
    templateStatus: String(template && template.templateStatus || "")
  };
}

function paymentNotificationLedger_(dateKey) {
  const propertyKey = PAYMENT_NOTIFICATION_LEDGER_PREFIX + String(dateKey || "").replace(/\D/g, "");
  const props = PropertiesService.getScriptProperties();
  let entries = {};
  try {
    entries = JSON.parse(props.getProperty(propertyKey) || "{}") || {};
  } catch (error) {
    entries = {};
  }
  return {
    propertyKey: propertyKey,
    entries: entries,
    save: function() {
      props.setProperty(propertyKey, JSON.stringify(entries));
    }
  };
}

function cleanupPaymentNotificationLedgers_(todayKey) {
  const cutoff = paymentNotificationDateKey_(new Date(todayKey + "T12:00:00+09:00"), -62)
    .replace(/\D/g, "");
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(key => {
    if (key.indexOf(PAYMENT_NOTIFICATION_LEDGER_PREFIX) !== 0) return;
    const datePart = key.slice(PAYMENT_NOTIFICATION_LEDGER_PREFIX.length);
    if (/^\d{8}$/.test(datePart) && datePart < cutoff) props.deleteProperty(key);
  });
}

function paymentNotificationConfirmedBaselineRefs_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(PAYMENT_NOTIFICATION_CONFIRMED_BASELINE_PROPERTY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.accountRefs &&
      typeof parsed.accountRefs === "object"
      ? parsed.accountRefs
      : {};
  } catch (error) {
    return {};
  }
}

function savePaymentNotificationConfirmedBaselineRefs_(accountRefs) {
  PropertiesService.getScriptProperties().setProperty(
    PAYMENT_NOTIFICATION_CONFIRMED_BASELINE_PROPERTY,
    JSON.stringify({
      accountRefs: accountRefs || {},
      updatedAt: new Date().toISOString(),
      build: AUTOMATION_BUILD
    })
  );
}

function processPaymentNotificationAutomation() {
  const config = paymentNotificationConfig_();
  const now = new Date();
  if (!config) return { ok: true, configured: false, build: AUTOMATION_BUILD };
  if (paymentNotificationHour_(now) < PAYMENT_DUE_ALERT_HOUR) {
    return { ok: true, configured: true, skipped: "before_notification_window", build: AUTOMATION_BUILD };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    return { ok: true, configured: true, skipped: "already_running", build: AUTOMATION_BUILD };
  }
  try {
    const schedules = paymentNotificationSheetSchedules_(now);
    if (!Object.keys(schedules).length) {
      return { ok: true, configured: true, scheduleCount: 0, build: AUTOMATION_BUILD };
    }
    const transactionState = paymentNotificationTransactionState_(
      schedules,
      config.bankBindings,
      now
    );
    const plan = paymentNotificationPlan_(
      schedules,
      config.bankBindings,
      transactionState,
      now
    );
    const confirmedLedgers = {};
    const confirmedSeenEntries = {};
    function confirmedLedgerForDate(dateKey) {
      const key = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))
        ? String(dateKey)
        : plan.today;
      if (!confirmedLedgers[key]) confirmedLedgers[key] = paymentNotificationLedger_(key);
      return confirmedLedgers[key];
    }
    (transactionState.matchedPayments || []).forEach(payment => {
      const eventId = paymentNotificationConfirmedEventId_(payment);
      const paymentLedger = confirmedLedgerForDate(payment && payment.date);
      if (eventId && paymentLedger.entries[eventId]) confirmedSeenEntries[eventId] = true;
    });

    const confirmedBaselineRefs = paymentNotificationConfirmedBaselineRefs_();
    const newConfirmedBaselineRefs = {};
    Object.keys(config.bankBindings || {}).forEach(buildingId => {
      const accountRef = String(config.bankBindings[buildingId] &&
        config.bankBindings[buildingId].accountRef || "");
      if (!accountRef || !transactionState.availableAccountRefs[accountRef] ||
          confirmedBaselineRefs[accountRef]) return;
      newConfirmedBaselineRefs[accountRef] = true;
      confirmedBaselineRefs[accountRef] = new Date().toISOString();
    });
    let confirmedBaselineCount = 0;
    if (Object.keys(newConfirmedBaselineRefs).length) {
      (transactionState.matchedPayments || []).forEach(payment => {
        if (!newConfirmedBaselineRefs[String(payment && payment.accountRef || "")]) return;
        const eventId = paymentNotificationConfirmedEventId_(payment);
        if (!eventId) return;
        const paymentLedger = confirmedLedgerForDate(payment && payment.date);
        if (!paymentLedger.entries[eventId]) {
          paymentLedger.entries[eventId] = true;
          confirmedBaselineCount += 1;
        }
      });
      Object.keys(confirmedLedgers).forEach(dateKey => confirmedLedgers[dateKey].save());
      savePaymentNotificationConfirmedBaselineRefs_(confirmedBaselineRefs);
    }

    const confirmedEligiblePayments = (transactionState.matchedPayments || [])
      .filter(payment => confirmedBaselineRefs[String(payment && payment.accountRef || "")] &&
        !newConfirmedBaselineRefs[String(payment && payment.accountRef || "")]);
    const confirmedPlan = paymentNotificationConfirmedGroups_(
      schedules,
      confirmedEligiblePayments,
      confirmedSeenEntries
    );
    const kakaoConfig = getKakaoAlimTalkConfig_();
    const ownerBuildingEventCount =
      Object.keys(plan.ownerDue).length +
      Object.keys(plan.ownerOverdue).length +
      Object.keys(confirmedPlan.groups).length;
    const ownerContacts = ownerBuildingEventCount
      ? paymentNotificationOwnerContacts_()
      : {};
    const ownerDueGroups = paymentOwnerPhoneGroups_(plan.ownerDue, ownerContacts);
    const ownerOverdueGroups = paymentOwnerPhoneGroups_(plan.ownerOverdue, ownerContacts);
    const ownerConfirmedGroups = paymentOwnerPhoneGroups_(confirmedPlan.groups, ownerContacts);
    const ownerEventCount = ownerDueGroups.length + ownerOverdueGroups.length;
    const ownerConfirmedEventCount = ownerConfirmedGroups.length;
    const tenantDueTemplate = plan.tenantDue.length
      ? kakaoAlimTalkTemplateState_(kakaoConfig.templates.paymentReminder, kakaoConfig)
      : { ready: false };
    const tenantOverdueTemplate = plan.tenantOverdue.length
      ? kakaoAlimTalkTemplateState_(kakaoConfig.templates.paymentReminderOverdue, kakaoConfig)
      : { ready: false };
    const ownerTemplate = ownerEventCount
      ? kakaoAlimTalkTemplateState_(kakaoConfig.templates.paymentOwnerGroup, kakaoConfig)
      : { ready: false };
    const ownerConfirmedTemplate = ownerConfirmedEventCount
      ? kakaoAlimTalkTemplateState_(kakaoConfig.templates.paymentOwnerConfirmedGroup, kakaoConfig)
      : { ready: false };
    const ledger = paymentNotificationLedger_(plan.today);
    const stats = {
      tenantDueSent: 0,
      tenantOverdueSent: 0,
      ownerDueSent: 0,
      ownerOverdueSent: 0,
      ownerConfirmedSent: 0,
      ownerConfirmedPaymentCount: 0,
      confirmedBaselineCount: confirmedBaselineCount,
      duplicateSkipped: confirmedPlan.duplicateSkipped,
      invalidPaymentSkipped: confirmedPlan.invalidSkipped,
      missingPhoneSkipped: 0,
      templatePendingSkipped: 0,
      sendFailed: 0
    };

    function sendTenant(row, reminderType) {
      const schedule = row.schedule || {};
      const eventId = ["tenant", reminderType, schedule.id, row.dueDate].join("_");
      if (ledger.entries[eventId]) {
        stats.duplicateSkipped += 1;
        return;
      }
      const tenantTemplate = reminderType === "due" ? tenantDueTemplate : tenantOverdueTemplate;
      if (!tenantTemplate.ready) {
        stats.templatePendingSkipped += 1;
        return;
      }
      const phone = normalizePhoneForSms_(schedule.tenantPhone || "");
      if (!isSendableSmsPhone_(phone)) {
        stats.missingPhoneSkipped += 1;
        return;
      }
      const result = sendKakaoAlimTalkOrSms_(
        phone,
        paymentReminderAlimTalkContent_(schedule, row.dueDate, reminderType),
        "월세 자동 안내",
        {
          templateCode: reminderType === "due"
            ? kakaoConfig.templates.paymentReminder
            : kakaoConfig.templates.paymentReminderOverdue,
          allowSmsFallback: false
        }
      );
      if (!result.ok) {
        stats.sendFailed += 1;
        return;
      }
      ledger.entries[eventId] = true;
      ledger.save();
      if (reminderType === "due") stats.tenantDueSent += 1;
      else stats.tenantOverdueSent += 1;
    }

    function sendOwner(group, reminderType) {
      const buildings = group && group.buildings || [];
      const rows = buildings.reduce((all, building) => all.concat(building.rows || []), []);
      const buildingIds = buildings.map(building => building.buildingId).sort().join("-");
      const eventId = [
        "owner",
        reminderType,
        group && group.key || "unknown",
        rows[0] && rows[0].dueDate || "",
        buildingIds
      ].join("_");
      if (ledger.entries[eventId]) {
        stats.duplicateSkipped += 1;
        return;
      }
      if (!ownerTemplate.ready) {
        stats.templatePendingSkipped += 1;
        return;
      }
      if (!isSendableSmsPhone_(group && group.phone || "")) {
        stats.missingPhoneSkipped += buildings.length || 1;
        return;
      }
      const result = sendKakaoAlimTalkOrSms_(
        group.phone,
        paymentOwnerSummaryAlimTalkContent_(
          group.ownerName || "건물주",
          buildings,
          reminderType
        ),
        "건물주 월세 입금 현황",
        {
          templateCode: kakaoConfig.templates.paymentOwnerGroup,
          allowSmsFallback: false
        }
      );
      if (!result.ok) {
        stats.sendFailed += 1;
        return;
      }
      ledger.entries[eventId] = true;
      ledger.save();
      if (reminderType === "due") stats.ownerDueSent += 1;
      else stats.ownerOverdueSent += 1;
    }

    function sendOwnerConfirmed(group) {
      const buildings = group && group.buildings || [];
      const rows = buildings.reduce((all, building) => all.concat(building.rows || []), []);
      if (!ownerConfirmedTemplate.ready) {
        stats.templatePendingSkipped += rows.length;
        return;
      }
      if (!isSendableSmsPhone_(group && group.phone || "")) {
        stats.missingPhoneSkipped += rows.length;
        return;
      }
      const result = sendKakaoAlimTalkOrSms_(
        group.phone,
        paymentOwnerConfirmedAlimTalkContent_(
          group.ownerName || "건물주",
          buildings
        ),
        "건물주 월세 입금 완료",
        {
          templateCode: kakaoConfig.templates.paymentOwnerConfirmedGroup,
          allowSmsFallback: false
        }
      );
      if (!result.ok) {
        stats.sendFailed += 1;
        return;
      }
      const savedDates = {};
      rows.forEach(row => {
        const paymentLedger = confirmedLedgerForDate(row.payment && row.payment.date);
        paymentLedger.entries[row.eventId] = true;
        savedDates[paymentLedger.propertyKey] = paymentLedger;
      });
      Object.keys(savedDates).forEach(propertyKey => savedDates[propertyKey].save());
      stats.ownerConfirmedSent += 1;
      stats.ownerConfirmedPaymentCount += rows.length;
    }

    plan.tenantDue.forEach(row => sendTenant(row, "due"));
    plan.tenantOverdue.forEach(row => sendTenant(row, "overdue"));
    ownerDueGroups.forEach(group => sendOwner(group, "due"));
    ownerOverdueGroups.forEach(group => sendOwner(group, "overdue"));
    ownerConfirmedGroups.forEach(group => sendOwnerConfirmed(group));
    cleanupPaymentNotificationLedgers_(plan.today);
    const output = {
      ok: stats.sendFailed === 0,
      configured: true,
      date: plan.today,
      scheduleCount: Object.keys(schedules).length,
      linkedBuildingCount: Object.keys(config.bankBindings || {}).length,
      transactionErrorCount: transactionState.errors.length,
      tenantTemplateReady:
        (!plan.tenantDue.length || tenantDueTemplate.ready === true) &&
        (!plan.tenantOverdue.length || tenantOverdueTemplate.ready === true),
      tenantDueTemplateReady: tenantDueTemplate.ready === true,
      tenantOverdueTemplateReady: tenantOverdueTemplate.ready === true,
      ownerTemplateReady: ownerTemplate.ready === true,
      ownerConfirmedTemplateReady: ownerConfirmedTemplate.ready === true,
      stats: stats,
      build: AUTOMATION_BUILD
    };
    Logger.log(JSON.stringify(output));
    return output;
  } finally {
    lock.releaseLock();
  }
}

const POPBILL_EASYFINBANK_SCOPE = ["180", "member"];
const POPBILL_API_VERSION = "2.0";
const POPBILL_BANK_SYNC_DAYS = 30;
const POPBILL_BANK_SYNC_FRESH_MINUTES = 25;

function popbillBoolean_(value, fallback) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) return !!fallback;
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function popbillConfigFromValues_(values) {
  const source = values || {};
  const isTest = popbillBoolean_(source.POPBILL_IS_TEST, true);
  const linkId = String(source.POPBILL_LINK_ID || "").trim();
  const secretKey = String(source.POPBILL_SECRET_KEY || "").trim();
  const corpNum = String(source.POPBILL_CORP_NUM || "").replace(/\D/g, "");
  const userId = String(source.POPBILL_USER_ID || "").trim();
  const missing = [];
  if (!linkId) missing.push("POPBILL_LINK_ID");
  if (!secretKey) missing.push("POPBILL_SECRET_KEY");
  if (!/^\d{10}$/.test(corpNum)) missing.push("POPBILL_CORP_NUM");
  if (missing.length) {
    throw new Error("팝빌 스크립트 속성을 확인해 주세요: " + missing.join(", "));
  }
  return {
    isTest: isTest,
    linkId: linkId,
    secretKey: secretKey,
    corpNum: corpNum,
    userId: userId,
    serviceId: isTest ? "POPBILL_TEST" : "POPBILL",
    apiBaseUrl: isTest
      ? "https://popbill-test.linkhub.co.kr"
      : "https://popbill.linkhub.co.kr"
  };
}

function popbillConfig_() {
  return popbillConfigFromValues_(PropertiesService.getScriptProperties().getProperties());
}

function popbillUtcTimestamp_(date) {
  return Utilities.formatDate(
    date || new Date(),
    "UTC",
    "yyyy-MM-dd'T'HH:mm:ss'Z'"
  );
}

function popbillTokenRequestBody_(corpNum) {
  return JSON.stringify({
    access_id: String(corpNum || "").replace(/\D/g, ""),
    scope: POPBILL_EASYFINBANK_SCOPE.slice()
  });
}

function popbillStringToSign_(serviceId, bodyDigest, requestDate, forwardedIp) {
  return [
    "POST",
    bodyDigest,
    requestDate,
    forwardedIp || "*",
    POPBILL_API_VERSION,
    "/" + serviceId + "/Token"
  ].join("\n");
}

function popbillFetchJson_(url, options, errorLabel) {
  const response = UrlFetchApp.fetch(url, Object.assign({
    muteHttpExceptions: true
  }, options || {}));
  const status = response.getResponseCode();
  const body = response.getContentText() || "";
  let parsed = {};
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch (error) {
    parsed = {};
  }
  if (status < 200 || status >= 300) {
    const message = String(parsed.message || parsed.Message || "").trim();
    throw new Error((errorLabel || "팝빌 API 요청 실패") +
      " (" + status + ")" + (message ? ": " + message : ""));
  }
  return parsed;
}

function popbillSessionToken_(forceRefresh) {
  const config = popbillConfig_();
  const cache = CacheService.getScriptCache();
  const cacheKey = "popbill-token-" + config.serviceId + "-" + config.corpNum;
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const body = popbillTokenRequestBody_(config.corpNum);
  const digestBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    body,
    Utilities.Charset.UTF_8
  );
  const bodyDigest = Utilities.base64Encode(digestBytes);
  const requestDate = popbillUtcTimestamp_(new Date());
  const forwardedIp = "*";
  const stringToSign = popbillStringToSign_(
    config.serviceId,
    bodyDigest,
    requestDate,
    forwardedIp
  );
  const signatureBytes = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(stringToSign).getBytes(),
    Utilities.base64Decode(config.secretKey)
  );
  const signature = Utilities.base64Encode(signatureBytes);
  const tokenResult = popbillFetchJson_(
    "https://auth.linkhub.co.kr/" + config.serviceId + "/Token",
    {
      method: "post",
      contentType: "application/json",
      payload: body,
      headers: {
        Authorization: "LINKHUB " + config.linkId + " " + signature,
        "X-LH-Version": POPBILL_API_VERSION,
        "X-LH-Date": requestDate,
        "X-LH-Forwarded": forwardedIp
      }
    },
    "팝빌 인증 실패"
  );
  const token = String(tokenResult.session_token || "").trim();
  if (!token) throw new Error("팝빌 인증 응답에 세션 토큰이 없습니다.");
  cache.put(cacheKey, token, 25 * 60);
  return token;
}

function popbillApiRequest_(method, resourcePath, payload) {
  const config = popbillConfig_();
  const headers = {
    Authorization: "Bearer " + popbillSessionToken_(false),
    "Accept-Language": "ko-KR"
  };
  if (config.userId) headers["X-PB-UserID"] = config.userId;
  const options = {
    method: String(method || "get").toLowerCase(),
    headers: headers
  };
  if (payload != null) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  return popbillFetchJson_(
    config.apiBaseUrl + resourcePath,
    options,
    "팝빌 계좌조회 API 요청 실패"
  );
}

function verifyPopbillEasyFinBankConnection() {
  const config = popbillConfig_();
  const accounts = popbillApiRequest_("get", "/EasyFin/Bank/ListBankAccount");
  const safeAccounts = (Array.isArray(accounts) ? accounts : []).map(account => {
    const number = String(account && account.accountNumber || "").replace(/\D/g, "");
    return {
      bankCode: String(account && account.bankCode || ""),
      accountName: String(account && account.accountName || ""),
      accountLast4: number.slice(-4),
      state: Number(account && account.state || 0)
    };
  });
  const result = {
    ok: true,
    environment: config.isTest ? "test" : "production",
    accountCount: safeAccounts.length,
    accounts: safeAccounts
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function getPopbillBankAccountManagerUrl() {
  const config = popbillConfig_();
  if (!config.isTest) {
    throw new Error("현재 운영환경으로 설정되어 있습니다. 테스트 계좌 등록 시 POPBILL_IS_TEST=true를 사용하세요.");
  }
  const result = popbillApiRequest_(
    "get",
    "/EasyFin/Bank?TG=BankAccount"
  );
  const url = String(result && result.url || "").trim();
  if (!/^https:\/\/test\.popbill\.com\//.test(url)) {
    throw new Error("팝빌 테스트 계좌등록 URL을 받지 못했습니다.");
  }
  Logger.log("POPBILL_BANK_ACCOUNT_MANAGER_URL=" + url);
  return url;
}

function popbillBankCompactDate_(date) {
  return Utilities.formatDate(date || new Date(), "Asia/Seoul", "yyyyMMdd");
}

function popbillBankAddDays_(compactDate, days) {
  const match = String(compactDate || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) throw new Error("팝빌 계좌조회 날짜가 올바르지 않습니다.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}

function popbillBankIsoDate_(compactDate) {
  const match = String(compactDate || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? [match[1], match[2], match[3]].join("-") : "";
}

function popbillBankShiftMonth_(monthKey, offset) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(offset || 0), 1));
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
}

function popbillBankNormalizePayer_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function popbillBankAccountRef_(account, config) {
  const resolvedConfig = config || popbillConfig_();
  const raw = [
    String(account && account.bankCode || ""),
    String(account && account.accountNumber || "").replace(/\D/g, "")
  ].join(":");
  if (!raw.replace(":", "")) throw new Error("팝빌 등록계좌 식별정보가 올바르지 않습니다.");
  const signature = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(raw).getBytes(),
    Utilities.base64Decode(resolvedConfig.secretKey)
  );
  return "pb_" + Utilities.base64EncodeWebSafe(signature)
    .replace(/=+$/g, "")
    .slice(0, 24);
}

function popbillBankSchedulesForAccount_(schedules, bankBindings, accountRef) {
  const bindings = bankBindings || {};
  const ref = String(accountRef || "");
  if (!ref) return {};
  const out = {};
  Object.keys(schedules || {}).forEach(id => {
    const schedule = schedules[id] || {};
    const buildingId = String(schedule.buildingId || "");
    const binding = bindings[buildingId] || {};
    if (String(binding.accountRef || "") !== ref) return;
    out[id] = schedule;
  });
  return out;
}

function popbillBankRemarkCandidates_(transaction) {
  const source = transaction || {};
  const seen = {};
  return [source.remark1, source.remark3, source.remark2]
    .map(value => String(value || "").trim())
    .filter(value => {
      const key = popbillBankNormalizePayer_(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function popbillBankScheduleActiveInMonth_(schedule, monthKey) {
  if (!schedule || schedule.active === false) return false;
  if (schedule.startMonth && String(monthKey) < String(schedule.startMonth)) return false;
  if (schedule.endMonth && String(monthKey) > String(schedule.endMonth)) return false;
  return true;
}

function popbillBankTransactionScheduleMatches_(transaction, schedule) {
  const amount = Number(String(transaction && transaction.accIn || "0").replace(/,/g, "")) || 0;
  if (!schedule || amount <= 0 || Number(schedule.amount) !== amount) return false;
  const payerKey = popbillBankNormalizePayer_(schedule.payerName);
  if (!payerKey) return false;
  const remarks = popbillBankRemarkCandidates_(transaction)
    .map(popbillBankNormalizePayer_);
  if (remarks.indexOf(payerKey) === -1) return false;

  const transactionDate = popbillBankIsoDate_(transaction.trdate);
  if (!transactionDate) return false;
  const transactionMonth = transactionDate.slice(0, 7);
  return [transactionMonth, popbillBankShiftMonth_(transactionMonth, -1)].some(monthKey => {
    if (!popbillBankScheduleActiveInMonth_(schedule, monthKey)) return false;
    const dueDate = paymentReminderDueDate_(monthKey, schedule.dueDay);
    return transactionDate >= popbillBankIsoDate_(popbillBankAddDays_(dueDate.replace(/-/g, ""), -3)) &&
      transactionDate <= popbillBankIsoDate_(popbillBankAddDays_(dueDate.replace(/-/g, ""), 7));
  });
}

function popbillBankResolveTransactionMatch_(transaction, schedules) {
  const rows = Object.keys(schedules || {}).map(id =>
    Object.assign({ id: id }, schedules[id] || {})
  );
  const matches = rows.filter(schedule =>
    popbillBankTransactionScheduleMatches_(transaction, schedule)
  );
  const remarks = popbillBankRemarkCandidates_(transaction);
  const fallbackPayer = remarks[0] || "";
  if (matches.length === 1) {
    return {
      matchStatus: "matched",
      payerName: String(matches[0].payerName || fallbackPayer),
      buildingId: String(matches[0].buildingId || ""),
      buildingName: String(matches[0].buildingName || ""),
      matchedScheduleId: String(matches[0].id || ""),
      reviewScheduleIds: [],
      buildingIds: matches[0].buildingId ? [String(matches[0].buildingId)] : []
    };
  }
  if (matches.length > 1) {
    const buildingIds = Array.from(new Set(matches
      .map(schedule => String(schedule.buildingId || ""))
      .filter(Boolean)));
    return {
      matchStatus: "review",
      payerName: String(matches[0].payerName || fallbackPayer),
      buildingId: "",
      buildingName: "",
      matchedScheduleId: "",
      reviewScheduleIds: matches.map(schedule => String(schedule.id || "")).filter(Boolean),
      buildingIds: buildingIds
    };
  }
  return {
    matchStatus: "unmatched",
    payerName: fallbackPayer,
    buildingId: "",
    buildingName: "",
    matchedScheduleId: "",
    reviewScheduleIds: [],
    buildingIds: []
  };
}

function popbillBankTransactionRecord_(transaction, account, schedules, syncedAt, accountRef) {
  const amount = Number(String(transaction && transaction.accIn || "0").replace(/,/g, "")) || 0;
  const date = popbillBankIsoDate_(transaction && transaction.trdate);
  const tid = String(transaction && transaction.tid || "").replace(/[.#$\[\]\/]/g, "");
  if (!tid || !date || amount <= 0) return null;
  const accountNumber = String(account && account.accountNumber || "").replace(/\D/g, "");
  const bankCode = String(account && account.bankCode || "");
  const safeAccountRef = String(accountRef || popbillBankAccountRef_(account));
  const match = popbillBankResolveTransactionMatch_(transaction, schedules);
  return {
    id: ["pb", bankCode, accountNumber.slice(-4), tid].join("_"),
    date: date,
    transactionAt: String(transaction && transaction.trdt || ""),
    payerName: match.payerName,
    amount: amount,
    direction: "deposit",
    source: "popbill",
    provider: "popbill",
    bankCode: bankCode,
    accountLast4: accountNumber.slice(-4),
    accountRef: safeAccountRef,
    buildingId: match.buildingId,
    buildingName: match.buildingName,
    matchedScheduleId: match.matchedScheduleId,
    reviewScheduleIds: match.reviewScheduleIds,
    buildingIds: match.buildingIds,
    matchStatus: match.matchStatus,
    active: true,
    providerRegisteredAt: String(transaction && transaction.regDT || ""),
    syncedAt: syncedAt
  };
}

function popbillBankJobPropertyKey_(account) {
  const raw = [
    String(account && account.bankCode || ""),
    String(account && account.accountNumber || "").replace(/\D/g, "")
  ].join(":");
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return "POPBILL_BANK_JOB_" +
    Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "").slice(0, 20);
}

function popbillBankRequestJob_(account, startDate, endDate) {
  const query = [
    "BankCode=" + encodeURIComponent(String(account.bankCode || "")),
    "AccountNumber=" + encodeURIComponent(String(account.accountNumber || "").replace(/\D/g, "")),
    "SDate=" + encodeURIComponent(startDate),
    "EDate=" + encodeURIComponent(endDate)
  ].join("&");
  const result = popbillApiRequest_("post", "/EasyFin/Bank/BankAccount?" + query);
  const jobId = String(result && (result.jobID || result.jobId) || result || "").trim();
  if (!/^\d{18}$/.test(jobId)) throw new Error("팝빌 거래수집 작업번호를 받지 못했습니다.");
  return jobId;
}

function popbillBankJobState_(jobId) {
  return popbillApiRequest_(
    "get",
    "/EasyFin/Bank/" + encodeURIComponent(String(jobId || "")) + "/State"
  );
}

function popbillBankSearchTransactions_(jobId) {
  return popbillApiRequest_(
    "get",
    "/EasyFin/Bank/" + encodeURIComponent(String(jobId || "")) +
      "?TradeType=I&Page=1&PerPage=1000&Order=A"
  );
}

function popbillBankSafeError_(error) {
  return String(error && error.message || error || "알 수 없는 오류")
    .replace(/\d{6,}/g, "••••")
    .slice(0, 240);
}

function popbillBankCollectAccount_(account, startDate, endDate) {
  const props = PropertiesService.getScriptProperties();
  const propertyKey = popbillBankJobPropertyKey_(account);
  let pending = null;
  try {
    pending = JSON.parse(props.getProperty(propertyKey) || "null");
  } catch (error) {
    pending = null;
  }
  if (pending && (
    pending.startDate !== startDate ||
    pending.endDate !== endDate ||
    Date.now() - Number(pending.requestedAt || 0) > 50 * 60 * 1000
  )) {
    pending = null;
    props.deleteProperty(propertyKey);
  }

  const jobId = pending && pending.jobId ||
    popbillBankRequestJob_(account, startDate, endDate);
  if (!pending) {
    props.setProperty(propertyKey, JSON.stringify({
      jobId: jobId,
      startDate: startDate,
      endDate: endDate,
      requestedAt: Date.now()
    }));
  }

  let state = {};
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      state = popbillBankJobState_(jobId) || {};
    } catch (error) {
      if (attempt === 7) throw error;
    }
    if (Number(state.jobState) === 3) break;
    if (attempt < 7) Utilities.sleep(1000);
  }
  if (Number(state.jobState) !== 3) {
    return { pending: true, jobId: jobId, state: Number(state.jobState || 0), list: [] };
  }
  props.deleteProperty(propertyKey);
  if (Number(state.errorCode) !== 1) {
    throw new Error(String(state.errorReason || "팝빌 거래내역 수집에 실패했습니다."));
  }
  const search = popbillBankSearchTransactions_(jobId) || {};
  return {
    pending: false,
    jobId: jobId,
    state: 3,
    list: Array.isArray(search.list) ? search.list : [],
    lastScrapDT: String(search.lastScrapDT || "")
  };
}

function popbillBankSyncIsFresh_(status, nowMillis) {
  if (!status || status.ok !== true || status.status !== "completed") return false;
  const timestamp = Date.parse(status.lastSuccessfulAt || status.updatedAt || "");
  if (!isFinite(timestamp)) return false;
  return Number(nowMillis == null ? Date.now() : nowMillis) - timestamp <
    POPBILL_BANK_SYNC_FRESH_MINUTES * 60 * 1000;
}

function syncPopbillBankTransactions_(payload) {
  payload = payload || {};
  const requestedAt = new Date().toISOString();
  const bankSyncUrl = firebasePaymentCalendarUrl_(payload.uid, "bankSync", payload.idToken);
  const existingStatus = firebaseReadJson_(bankSyncUrl, "기존 팝빌 동기화 상태 조회 실패") || {};
  const bankBindingsUrl = firebasePaymentCalendarUrl_(payload.uid, "bankBindings", payload.idToken);
  const bankBindings = firebaseReadJson_(bankBindingsUrl, "건물별 팝빌 계좌 연결정보 조회 실패") || {};
  rememberPaymentNotificationAutomation_(payload, bankBindings);
  if (payload.force !== true && popbillBankSyncIsFresh_(existingStatus, Date.now())) {
    return Object.assign({}, existingStatus, { skipped: true });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) {
    return { ok: true, skipped: true, status: "running", updatedAt: requestedAt };
  }
  try {
    const schedulesUrl = firebasePaymentCalendarUrl_(payload.uid, "schedules", payload.idToken);
    const transactionsUrl = firebasePaymentCalendarUrl_(payload.uid, "transactions", payload.idToken);
    const schedules = firebaseReadJson_(schedulesUrl, "월 납부 일정 조회 실패") || {};
    const allAccounts = popbillApiRequest_("get", "/EasyFin/Bank/ListBankAccount");
    const accounts = (Array.isArray(allAccounts) ? allAccounts : [])
      .filter(account => Number(account && account.state) === 1);
    if (!accounts.length) throw new Error("팝빌에서 사용 가능한 등록 계좌를 찾지 못했습니다.");

    const endDate = popbillBankCompactDate_(new Date());
    const startDate = popbillBankAddDays_(endDate, -POPBILL_BANK_SYNC_DAYS);
    const transactionPatch = {};
    const accountResults = [];
    const errors = [];
    let pendingCount = 0;
    let lastScrapDT = "";

    accounts.forEach(account => {
      const accountNumber = String(account && account.accountNumber || "").replace(/\D/g, "");
      const accountRef = popbillBankAccountRef_(account);
      const accountSchedules = popbillBankSchedulesForAccount_(schedules, bankBindings, accountRef);
      const linkedBuildingIds = Array.from(new Set(Object.keys(accountSchedules)
        .map(id => String(accountSchedules[id] && accountSchedules[id].buildingId || ""))
        .filter(Boolean)));
      const safeAccount = {
        accountRef: accountRef,
        bankCode: String(account && account.bankCode || ""),
        accountName: String(account && account.accountName || ""),
        accountLast4: accountNumber.slice(-4),
        linkedBuildingCount: linkedBuildingIds.length
      };
      try {
        const collected = popbillBankCollectAccount_(account, startDate, endDate);
        if (collected.pending) pendingCount += 1;
        lastScrapDT = String(collected.lastScrapDT || lastScrapDT);
        let depositCount = 0;
        (collected.list || []).forEach(transaction => {
          const record = popbillBankTransactionRecord_(
            transaction,
            account,
            accountSchedules,
            requestedAt,
            accountRef
          );
          if (!record) return;
          transactionPatch[record.id] = record;
          depositCount += 1;
        });
        accountResults.push(Object.assign({}, safeAccount, {
          pending: collected.pending === true,
          depositCount: depositCount
        }));
      } catch (error) {
        errors.push(Object.assign({}, safeAccount, {
          message: popbillBankSafeError_(error)
        }));
      }
    });

    if (Object.keys(transactionPatch).length) {
      firebaseAuthorizedWriteRequest_(
        transactionsUrl,
        "patch",
        transactionPatch,
        "팝빌 입금내역 저장 실패"
      );
    }
    const records = Object.keys(transactionPatch).map(id => transactionPatch[id]);
    const status = {
      ok: errors.length === 0,
      status: pendingCount ? "pending" : (errors.length ? "error" : "completed"),
      environment: popbillConfig_().isTest ? "test" : "production",
      accountCount: accounts.length,
      linkedBuildingCount: Object.keys(bankBindings).filter(buildingId =>
        String(bankBindings[buildingId] && bankBindings[buildingId].accountRef || "")
      ).length,
      completedAccountCount: accountResults.filter(item => !item.pending).length,
      pendingAccountCount: pendingCount,
      transactionCount: records.length,
      matchedCount: records.filter(item => item.matchStatus === "matched").length,
      reviewCount: records.filter(item => item.matchStatus === "review").length,
      unmatchedCount: records.filter(item => item.matchStatus === "unmatched").length,
      accounts: accountResults,
      errors: errors,
      rangeStart: popbillBankIsoDate_(startDate),
      rangeEnd: popbillBankIsoDate_(endDate),
      lastScrapDT: lastScrapDT,
      updatedAt: requestedAt,
      lastSuccessfulAt: errors.length || pendingCount
        ? String(existingStatus.lastSuccessfulAt || "")
        : requestedAt,
      requestedBy: String(payload.adminEmail || ""),
      build: AUTOMATION_BUILD
    };
    firebaseAuthorizedWriteRequest_(bankSyncUrl, "put", status, "팝빌 동기화 상태 저장 실패");
    Logger.log(JSON.stringify({
      ok: status.ok,
      status: status.status,
      accountCount: status.accountCount,
      transactionCount: status.transactionCount,
      matchedCount: status.matchedCount,
      reviewCount: status.reviewCount,
      unmatchedCount: status.unmatchedCount
    }));
    return status;
  } catch (error) {
    const failed = {
      ok: false,
      status: "error",
      accountCount: 0,
      transactionCount: 0,
      errors: [{ message: popbillBankSafeError_(error) }],
      updatedAt: requestedAt,
      lastSuccessfulAt: String(existingStatus.lastSuccessfulAt || ""),
      requestedBy: String(payload.adminEmail || ""),
      build: AUTOMATION_BUILD
    };
    try {
      firebaseAuthorizedWriteRequest_(bankSyncUrl, "put", failed, "팝빌 동기화 오류 상태 저장 실패");
    } catch (writeError) {
      Logger.log("팝빌 동기화 오류 상태 저장 실패");
    }
    return failed;
  } finally {
    lock.releaseLock();
  }
}

function testPopbillBankTransactionCollection() {
  const allAccounts = popbillApiRequest_("get", "/EasyFin/Bank/ListBankAccount");
  const accounts = (Array.isArray(allAccounts) ? allAccounts : [])
    .filter(account => Number(account && account.state) === 1);
  const endDate = popbillBankCompactDate_(new Date());
  const startDate = popbillBankAddDays_(endDate, -POPBILL_BANK_SYNC_DAYS);
  const results = accounts.map(account => {
    const number = String(account && account.accountNumber || "").replace(/\D/g, "");
    try {
      const collected = popbillBankCollectAccount_(account, startDate, endDate);
      return {
        bankCode: String(account && account.bankCode || ""),
        accountLast4: number.slice(-4),
        pending: collected.pending === true,
        depositCount: (collected.list || []).filter(item =>
          (Number(String(item && item.accIn || "0").replace(/,/g, "")) || 0) > 0
        ).length
      };
    } catch (error) {
      return {
        bankCode: String(account && account.bankCode || ""),
        accountLast4: number.slice(-4),
        error: popbillBankSafeError_(error)
      };
    }
  });
  const output = {
    ok: results.every(item => !item.error),
    accountCount: accounts.length,
    rangeStart: popbillBankIsoDate_(startDate),
    rangeEnd: popbillBankIsoDate_(endDate),
    accounts: results
  };
  Logger.log(JSON.stringify(output));
  return output;
}

function syncPaymentBuildingsFromOnboarding_() {
  const result = listDriveOnboardingCandidates_();
  if (!result.ok) throw new Error(result.error || "온보딩 건물 목록을 읽지 못했습니다.");

  const syncedAt = new Date().toISOString();
  const registry = {};
  result.candidates.forEach(candidate => {
    const file = candidate.file;
    const driveFileId = file.getId();
    const building = String(candidate.building || onboardingBuildingFromFileName_(file.getName()) || "").trim();
    if (!building) return;
    registry[driveFileId] = {
      id: driveFileId,
      driveFileId: driveFileId,
      building: building,
      address: String(candidate.address || "").trim(),
      ownerName: String(candidate.ownerName || "").trim(),
      fileName: file.getName(),
      fileUrl: file.getUrl(),
      source: "onboarding_drive",
      lastUpdatedAt: file.getLastUpdated().toISOString(),
      syncedAt: syncedAt
    };
  });

  firebaseWriteRequest_(
    firebaseCaseSettingsUrl_("paymentBuildings"),
    "put",
    registry,
    "입금 캘린더 건물 동기화 실패"
  );
  return { ok: true, count: Object.keys(registry).length, syncedAt: syncedAt, build: AUTOMATION_BUILD };
}

function diceSimilarity_(left, right) {
  left = String(left || "");
  right = String(right || "");
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const counts = {};
  for (let i = 0; i < left.length - 1; i += 1) {
    const pair = left.slice(i, i + 2);
    counts[pair] = (counts[pair] || 0) + 1;
  }
  let overlap = 0;
  for (let i = 0; i < right.length - 1; i += 1) {
    const pair = right.slice(i, i + 2);
    if (counts[pair]) { overlap += 1; counts[pair] -= 1; }
  }
  return (2 * overlap) / ((left.length - 1) + (right.length - 1));
}

function rankDriveOnboardingCandidate_(candidate, inputBuilding, inputAddress) {
  const buildingKey = normalizeText_(inputBuilding);
  const addressKey = normalizeAddress_(inputAddress);
  const candidateBuildingKey = normalizeText_(candidate.building);
  const candidateAddressKey = normalizeAddress_(candidate.address);
  const fullTextKey = normalizeText_(candidate.text);
  const fullAddressKey = normalizeAddress_(candidate.text);
  const buildingExact = candidateBuildingKey === buildingKey || (!!buildingKey && fullTextKey.indexOf(buildingKey) >= 0);
  const addressExact = !!addressKey && (candidateAddressKey === addressKey || fullAddressKey.indexOf(addressKey) >= 0);
  const buildingScore = buildingExact ? 1 : Math.max(diceSimilarity_(buildingKey, candidateBuildingKey), diceSimilarity_(buildingKey, fullTextKey.slice(0, Math.max(buildingKey.length * 3, 80))));
  const addressScore = addressExact ? 1 : diceSimilarity_(addressKey, candidateAddressKey);
  candidate.matchRank = buildingExact && addressExact ? 3 : buildingExact ? 2 : 1;
  candidate.buildingScore = Math.round(buildingScore * 1000) / 1000;
  candidate.addressScore = Math.round(addressScore * 1000) / 1000;
  candidate.matchScore = Math.round((buildingScore * 0.6 + addressScore * 0.4) * 1000) / 1000;
  return candidate;
}

function isPlausibleOnboardingCandidate_(candidate, inputBuilding, inputAddress) {
  if (!candidate) return false;
  const buildingKey = normalizeText_(inputBuilding);
  const candidateBuildingKey = normalizeText_(candidate.building);
  const addressKey = normalizeAddress_(inputAddress);
  const candidateAddressKey = normalizeAddress_(candidate.address);
  if (!buildingKey || !candidateBuildingKey || !addressKey || !candidateAddressKey) return false;

  const buildingMatches = (
    buildingKey === candidateBuildingKey ||
    candidate.buildingScore >= 0.82
  );
  const addressContains = (
    addressKey.indexOf(candidateAddressKey) >= 0 ||
    candidateAddressKey.indexOf(addressKey) >= 0
  );
  const inputNumbers = addressKey.match(/\d+/g) || [];
  const candidateNumbers = candidateAddressKey.match(/\d+/g) || [];
  const sharesAddressNumber = inputNumbers.some(value => candidateNumbers.indexOf(value) >= 0);
  const addressMatches = addressContains || (
    candidate.addressScore >= 0.5 &&
    sharesAddressNumber
  );
  return buildingMatches && addressMatches;
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
    source: options.source || "drive_ranked",
    status: "matched",
    statusText: options.statusText,
    fileName: fileName,
    fileUrl: fileUrl,
    driveFileId: driveFileId,
    candidateCount: options.candidateCount,
    matchLevel: options.matchLevel || "",
    matchScore: Number(options.matchScore || 0),
    buildingScore: Number(options.buildingScore || 0),
    addressScore: Number(options.addressScore || 0),
    matchedBuilding: options.matchedBuilding || inputBuilding,
    matchedAddress: options.matchedAddress || inputAddress,
    ownerName: options.ownerName || "",
    candidates: options.candidates || [],
    contract: {
      building: options.matchedBuilding || inputBuilding,
      address: options.matchedAddress || inputAddress,
      ownerName: options.ownerName || "",
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

function isSmsCompleteStatus_(status) {
  return /발송\s*완료/.test(String(status || ""));
}

function isSmsPartialStatus_(status) {
  return /일부\s*발송/.test(String(status || ""));
}

function isSmsSentStatus_(status) {
  return isSmsCompleteStatus_(status) || isSmsPartialStatus_(status);
}

function sendComplaintSms_(ticketNo, record, analysis, contractMatch, options) {
  const force = options && options.force === true;
  const previous = options && options.existingSms && typeof options.existingSms === "object"
    ? options.existingSms
    : {};
  const existingStatus = readField_(record, ["문자 발송 상태"]);
  if (!force && isSmsSentStatus_(existingStatus)) {
    return {
      status: existingStatus,
      statusText: readField_(record, ["문자 발송 메모"]) || "이미 발송된 문자 기록이 있어 재발송하지 않았습니다.",
      skipped: true
    };
  }

  const smsConfig = getSensConfig_();
  const kakaoConfig = getKakaoAlimTalkConfig_();
  if (!smsConfig.enabled && !kakaoConfig.enabled) {
    return { status: "설정필요", statusText: "NCP SENS SMS 또는 카카오 알림톡 Script Properties 설정 후 발송이 가능합니다.", skipped: true };
  }

  const tenantPhoneRaw = normalizePhoneForSms_(readField_(record, ["연락처", "전화번호", "휴대폰"]));
  const ownerPhoneRaw = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  const tenantPhone = isSendableSmsPhone_(tenantPhoneRaw) ? tenantPhoneRaw : "";
  const ownerPhone = isSendableSmsPhone_(ownerPhoneRaw) ? ownerPhoneRaw : "";
  const tenantContent = makeComplaintReceiptTenantAlimTalkContent_(ticketNo, record);
  const ownerContent = makeComplaintReceiptOwnerAlimTalkContent_(ticketNo, record);

  const logs = [];
  let tenantSent = previous.tenantSent === true;
  let ownerSent = previous.ownerSent === true;
  let tenantReceipt = {
    requestId: previous.tenantRequestId || "",
    provider: previous.tenantProvider || "",
    templateCode: previous.tenantTemplateCode || ""
  };
  let ownerReceipt = {
    requestId: previous.ownerRequestId || "",
    provider: previous.ownerProvider || "",
    templateCode: previous.ownerTemplateCode || ""
  };

  if (tenantSent) {
    logs.push("세입자 " + (previous.tenantPhoneMasked || maskPhone_(tenantPhone)) + " 기존 발송 완료");
  } else if (tenantPhone) {
    const tenantResult = sendKakaoAlimTalkOrSms_(tenantPhone, tenantContent, "세입자", {
      templateCode: kakaoConfig.templates.receiptTenant,
      fallbackContent: tenantContent
    });
    tenantReceipt = tenantResult;
    tenantSent = tenantResult.ok;
    logs.push("세입자 " + maskPhone_(tenantPhone) + " " + tenantResult.message);
  } else if (tenantPhoneRaw) {
    logs.push("세입자 연락처 형식 확인 필요");
  } else {
    logs.push("세입자 연락처 없음");
  }

  if (ownerSent) {
    logs.push("건물주 " + (previous.ownerPhoneMasked || maskPhone_(ownerPhone)) + " 기존 발송 완료");
  } else if (ownerPhone) {
    const ownerResult = sendKakaoAlimTalkOrSms_(ownerPhone, ownerContent, "건물주", {
      templateCode: kakaoConfig.templates.receiptOwner,
      fallbackContent: ownerContent
    });
    ownerReceipt = ownerResult;
    ownerSent = ownerResult.ok;
    logs.push("건물주 " + maskPhone_(ownerPhone) + " " + ownerResult.message);
  } else {
    logs.push("건물주 연락처 미확인: 온보딩 수집서 본문에 '건물주 연락처: 010-0000-0000' 형식으로 넣어주세요.");
  }

  const status = tenantSent && ownerSent ? "발송완료" : tenantSent || ownerSent ? "일부발송" : "발송보류";
  const statusSummary = logs.join(" / ");
  return {
    ok: status === "발송완료",
    status: status,
    statusSummary: statusSummary,
    statusText: statusSummary + "\n\n" + makeComplaintSmsPreview_(tenantContent, ownerContent),
    tenantSent: tenantSent,
    ownerSent: ownerSent,
    tenantPhoneMasked: tenantPhone ? maskPhone_(tenantPhone) : "",
    ownerPhoneMasked: ownerPhone ? maskPhone_(ownerPhone) : "",
    tenantRequestId: tenantReceipt.requestId || "",
    ownerRequestId: ownerReceipt.requestId || "",
    tenantProvider: tenantReceipt.provider || "",
    ownerProvider: ownerReceipt.provider || "",
    tenantTemplateCode: tenantReceipt.templateCode || "",
    ownerTemplateCode: ownerReceipt.templateCode || "",
    requestIds: Array.from(new Set(
      []
        .concat(previous.requestIds || [])
        .concat([tenantReceipt.requestId, ownerReceipt.requestId])
        .filter(Boolean)
    )),
    deliveryAccepted: status === "발송완료",
    completedAt: status === "발송완료" ? (previous.completedAt || new Date().toISOString()) : ""
  };
}

function makeComplaintSmsPreview_(tenantContent, ownerContent) {
  return [
    "[발송 예시 - 세입자]",
    tenantContent || "세입자 발송 문구 없음",
    "",
    "[발송 예시 - 건물주]",
    ownerContent || "건물주 발송 문구 없음"
  ].join("\n");
}

function applySmsResultToCase_(casePayload, smsResult) {
  if (!smsResult) return;
  casePayload.sms = smsResult;
  casePayload.complaintReceiptSms = smsResult;
  casePayload.automationState = Object.assign({}, casePayload.automationState || {});
  casePayload.automationState.receiptSms = {
    ok: isSmsCompleteStatus_(smsResult.status),
    status: smsResult.status || "",
    requestIds: smsResult.requestIds || [],
    tenantRequestId: smsResult.tenantRequestId || "",
    ownerRequestId: smsResult.ownerRequestId || "",
    tenantProvider: smsResult.tenantProvider || "",
    ownerProvider: smsResult.ownerProvider || "",
    tenantTemplateCode: smsResult.tenantTemplateCode || "",
    ownerTemplateCode: smsResult.ownerTemplateCode || "",
    deliveryAccepted: isSmsCompleteStatus_(smsResult.status),
    completedAt: smsResult.completedAt || "",
    updatedAt: new Date().toISOString(),
    build: AUTOMATION_BUILD
  };
  casePayload.note = casePayload.note || {};
  casePayload.note.c2 = smsResult.statusText || "";
  casePayload.status = casePayload.status || {};
  if (isSmsCompleteStatus_(smsResult.status)) {
    casePayload.status.c2 = "done";
  } else if (isSmsPartialStatus_(smsResult.status) || smsResult.status === "발송보류") {
    casePayload.status.c2 = "doing";
  } else if (smsResult.status) {
    casePayload.status.c2 = "doing";
  }
  if (casePayload.log) {
    casePayload.log.push("문자 " + smsResult.status + " / " + (smsResult.statusSummary || smsResult.statusText || ""));
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

function getKakaoAlimTalkConfig_() {
  const props = PropertiesService.getScriptProperties();
  const enabled = String(props.getProperty("KAKAO_ALIMTALK_ENABLED") || "false").toLowerCase() === "true";
  const plusFriendIdRaw = String(props.getProperty("KAKAO_CHANNEL_ID") || "").trim();
  const config = {
    enabled: enabled,
    serviceId: String(props.getProperty("NCP_BIZ_MESSAGE_SERVICE_ID") || "").trim(),
    plusFriendId: plusFriendIdRaw && plusFriendIdRaw.charAt(0) !== "@" ? "@" + plusFriendIdRaw : plusFriendIdRaw,
    accessKey: String(props.getProperty("NCP_ACCESS_KEY") || "").trim(),
    secretKey: String(props.getProperty("NCP_SECRET_KEY") || "").trim(),
    smsFrom: normalizePhoneForSms_(props.getProperty("NCP_SENS_FROM") || ""),
    useSmsFailover: String(props.getProperty("KAKAO_SMS_FAILOVER_ENABLED") || "false").toLowerCase() === "true",
    templates: {
      receiptTenant: String(props.getProperty("KAKAO_TEMPLATE_RECEIPT_TENANT") || "BRINGRECEIPTTENANTV1").trim(),
      receiptOwner: String(props.getProperty("KAKAO_TEMPLATE_RECEIPT_OWNER") || "BRINGRECEIPTOWNERV1").trim(),
      ownerQuote: String(props.getProperty("KAKAO_TEMPLATE_OWNER_QUOTE") || "BRINGOWNERQUOTEV1").trim(),
      paymentReminder: String(props.getProperty("KAKAO_TEMPLATE_PAYMENT_REMINDER") || "BRINGRENTREMINDERV1").trim(),
      paymentReminderOverdue: String(props.getProperty("KAKAO_TEMPLATE_PAYMENT_REMINDER_OVERDUE") || "BRINGRENTOVERDUEV1").trim(),
      paymentOwnerSummary: String(props.getProperty("KAKAO_TEMPLATE_PAYMENT_OWNER_SUMMARY") || "BRINGRENTOWNERSUMMARYV1").trim(),
      paymentOwnerConfirmed: String(props.getProperty("KAKAO_TEMPLATE_PAYMENT_OWNER_CONFIRMED") || "BRINGRENTOWNERPAIDV1").trim(),
      paymentOwnerGroup: String(props.getProperty("KAKAO_TEMPLATE_PAYMENT_OWNER_GROUP") || "BRINGRENTOWNERGROUPV1").trim(),
      paymentOwnerConfirmedGroup: String(props.getProperty("KAKAO_TEMPLATE_PAYMENT_OWNER_CONFIRMED_GROUP") || "BRINGRENTOWNERPAIDGROUPV1").trim()
    }
  };
  config.enabled = Boolean(
    config.enabled &&
    config.serviceId &&
    config.plusFriendId &&
    config.accessKey &&
    config.secretKey
  );
  return config;
}

function sendSensAlimTalk_(to, content, label, templateCode, options, config) {
  options = options || {};
  if (!config || !config.enabled) config = getKakaoAlimTalkConfig_();
  if (!config.enabled) return { ok: false, provider: "kakao_alimtalk", message: "카카오 알림톡 설정필요" };
  to = normalizePhoneForSms_(to);
  if (!isSendableSmsPhone_(to)) {
    return { ok: false, provider: "kakao_alimtalk", message: "수신번호 확인필요(" + label + ")" };
  }
  templateCode = String(templateCode || "").trim();
  if (!templateCode) {
    return { ok: false, provider: "kakao_alimtalk", message: "알림톡 템플릿 코드 확인필요(" + label + ")" };
  }
  content = String(content || "");
  if (!content || content.length > 1000) {
    return { ok: false, provider: "kakao_alimtalk", message: "알림톡 본문은 1~1000자로 입력해야 합니다(" + label + ")" };
  }

  const message = {
    countryCode: "82",
    to: to,
    content: content
  };
  if (Array.isArray(options.buttons) && options.buttons.length) {
    message.buttons = options.buttons.map(button => ({
      type: String(button.type || "WL"),
      name: String(button.name || ""),
      linkMobile: String(button.linkMobile || ""),
      linkPc: String(button.linkPc || button.linkMobile || "")
    }));
  }
  if (config.useSmsFailover && config.smsFrom) {
    const fallbackContent = String(options.fallbackContent || content);
    message.useSmsFailover = true;
    message.failoverConfig = {
      type: byteLength_(fallbackContent) > 90 ? "LMS" : "SMS",
      from: config.smsFrom,
      content: fallbackContent
    };
    if (message.failoverConfig.type === "LMS") message.failoverConfig.subject = "BRING Care";
  } else {
    message.useSmsFailover = false;
  }

  const uri = "/alimtalk/v2/services/" + encodeURIComponent(config.serviceId) + "/messages";
  const response = sensPostJson_(uri, {
    plusFriendId: config.plusFriendId,
    templateCode: templateCode,
    messages: [message]
  }, config);
  if (!response.ok) {
    return {
      ok: false,
      provider: "kakao_alimtalk",
      templateCode: templateCode,
      responseCode: response.code || 0,
      message: "알림톡 발송실패(" + label + "): " + response.message
    };
  }

  const receipt = sensResponseReceipt_(response.json);
  const responseMessages = Array.isArray(response.json && response.json.messages) ? response.json.messages : [];
  const firstMessage = responseMessages[0] || {};
  return {
    ok: true,
    provider: "kakao_alimtalk",
    templateCode: templateCode,
    message: "카카오 알림톡 발송요청 완료(" + label + ")",
    requestId: receipt.requestId,
    messageId: String(firstMessage.messageId || ""),
    statusCode: receipt.statusCode,
    statusName: receipt.statusName,
    responseCode: response.code
  };
}

function sendKakaoAlimTalkOrSms_(to, content, label, options) {
  options = options || {};
  const kakaoConfig = getKakaoAlimTalkConfig_();
  if (kakaoConfig.enabled && options.templateCode) {
    const alimTalkResult = sendSensAlimTalk_(
      to,
      content,
      label,
      options.templateCode,
      options,
      kakaoConfig
    );
    if (alimTalkResult.ok) return alimTalkResult;
    if (options.allowSmsFallback === false) return alimTalkResult;

    const smsConfig = getSensConfig_();
    if (!smsConfig.enabled) return alimTalkResult;
    const smsResult = sendSensSms_(to, String(options.fallbackContent || content), label);
    smsResult.provider = smsResult.ok ? "sens_sms_fallback" : "kakao_alimtalk";
    smsResult.templateCode = options.templateCode;
    smsResult.alimTalkError = alimTalkResult.message || "";
    if (smsResult.ok) {
      smsResult.message = "알림톡 실패 후 문자 대체 발송요청 완료(" + label + ")";
    } else {
      smsResult.message = (alimTalkResult.message || "알림톡 발송실패") + " / " + (smsResult.message || "문자 대체 발송실패");
    }
    return smsResult;
  }

  const smsResult = sendSensSms_(to, content, label);
  smsResult.provider = "sens_sms";
  return smsResult;
}

function sendSensSms_(to, content, label) {
  const config = getSensConfig_();
  if (!config.enabled) return { ok: false, message: "SENS 설정필요" };
  to = normalizePhoneForSms_(to);
  if (!isSendableSmsPhone_(to)) return { ok: false, message: "수신번호 확인필요(" + label + ")" };

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
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch (err) {}
    if (code >= 200 && code < 300) {
      const receipt = sensResponseReceipt_(json);
      return {
        ok: true,
        message: "발송요청 완료(" + label + ")",
        requestId: receipt.requestId,
        statusCode: receipt.statusCode,
        statusName: receipt.statusName,
        responseCode: code
      };
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

function extractPdfTextForReview_(driveFileId) {
  let convertedId = "";
  try {
    const sourceFile = DriveApp.getFileById(driveFileId);
    const converted = Drive.Files.insert({
      title: "CRM 검토 OCR " + driveFileId,
      mimeType: "application/vnd.google-apps.document"
    }, sourceFile.getBlob(), {
      convert: true,
      ocr: true,
      ocrLanguage: "ko"
    });
    convertedId = String(converted && converted.id || "");
    if (!convertedId) throw new Error("OCR 변환 문서 ID가 없습니다.");
    return String(DocumentApp.openById(convertedId).getBody().getText() || "").replace(/\s+/g, " ").trim();
  } finally {
    if (convertedId) {
      try { DriveApp.getFileById(convertedId).setTrashed(true); } catch (cleanupError) {
        Logger.log("임시 OCR 문서 정리 실패: " + cleanupError.message);
      }
    }
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
  if (/^1[016789]\d{7,8}$/.test(digits)) digits = "0" + digits;
  return digits;
}

function isSendableSmsPhone_(phone) {
  return /^0\d{8,10}$/.test(String(phone || ""));
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

function testKakaoAlimTalkSetup() {
  const props = PropertiesService.getScriptProperties();
  const to = normalizePhoneForSms_(props.getProperty("NCP_SENS_TEST_TO") || "");
  if (!to) throw new Error("Script Properties에 NCP_SENS_TEST_TO를 테스트 수신번호로 넣어주세요.");
  const config = getKakaoAlimTalkConfig_();
  if (!config.enabled) {
    throw new Error("KAKAO_ALIMTALK_ENABLED, NCP_BIZ_MESSAGE_SERVICE_ID, KAKAO_CHANNEL_ID와 NCP 인증키 설정을 확인해 주세요.");
  }
  const content = [
    "[브링케어 민원 접수 안내]",
    "테스트고객님, 민원이 정상 접수되었습니다.",
    "",
    "접수번호: BR-2026-0000",
    "건물: 브링케어 테스트 건물",
    "호실: 101호",
    "문제 유형: 알림톡 연동 테스트",
    "",
    "담당자가 내용을 확인한 후 진행 상황을 안내드리겠습니다."
  ].join("\n");
  const result = sendSensAlimTalk_(
    to,
    content,
    "알림톡 테스트",
    config.templates.receiptTenant,
    { fallbackContent: content },
    config
  );
  Logger.log(JSON.stringify(result));
  if (!result.ok) throw new Error(result.message || "카카오 알림톡 테스트 발송 실패");
  return result;
}

function testKakaoOwnerReceiptAlimTalkSetup() {
  const props = PropertiesService.getScriptProperties();
  const to = normalizePhoneForSms_(props.getProperty("NCP_SENS_TEST_TO") || "");
  if (!to) throw new Error("Script Properties에 NCP_SENS_TEST_TO를 테스트 수신번호로 넣어주세요.");
  const config = getKakaoAlimTalkConfig_();
  if (!config.enabled) {
    throw new Error("카카오 알림톡과 NCP 인증 설정을 확인해 주세요.");
  }

  const record = {
    "건물명": "브링케어 테스트 건물",
    "호실": "101",
    "문제 유형": "건물주 알림톡 연동 테스트"
  };
  const content = makeComplaintReceiptOwnerAlimTalkContent_("BR-2026-0000", record);
  const result = sendSensAlimTalk_(
    to,
    content,
    "건물주 접수 알림 테스트",
    config.templates.receiptOwner,
    { fallbackContent: content },
    config
  );
  Logger.log(JSON.stringify(result));
  if (!result.ok) throw new Error(result.message || "건물주 접수 알림톡 테스트 발송 실패");
  return result;
}

function testKakaoOwnerRecommendationAlimTalkSetup() {
  const props = PropertiesService.getScriptProperties();
  const to = normalizePhoneForSms_(props.getProperty("NCP_SENS_TEST_TO") || "");
  if (!to) throw new Error("Script Properties에 NCP_SENS_TEST_TO를 테스트 수신번호로 넣어주세요.");
  const config = getKakaoAlimTalkConfig_();
  if (!config.enabled) {
    throw new Error("카카오 알림톡과 NCP 인증 설정을 확인해 주세요.");
  }

  const caseId = "BR-2099-9999";
  const quoteId = "owner_quote_alimtalk_test";
  const now = new Date().toISOString();
  const quote = {
    id: quoteId,
    vendorName: "원주빛전기",
    resolvedVendorInfo: {
      name: "원주빛전기",
      phone: "010-1111-0001"
    },
    confirmedTotalAmount: 130900,
    bringQuoteBaseTotalAmount: 130900,
    bringQuoteSupplyAmount: 130900,
    bringQuoteVatAmount: 13100,
    bringQuoteTotalAmount: 144000,
    bringQuoteItems: [
      { product: "현관 센서등 교체" },
      { product: "공용부 LED 램프 교체" }
    ],
    uploadedAt: now
  };
  const casePayload = {
    id: caseId,
    ticketNo: caseId,
    building: "브링케어 테스트 건물",
    room: "101호",
    archived: true,
    archivedAt: now,
    archivedBy: "alimtalk-test",
    status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "done", c8: "doing" },
    quoteFiles: {}
  };
  casePayload.quoteFiles[quoteId] = quote;
  patchCaseToFirebase_(caseId, casePayload);
  putCaseChildToFirebase_(caseId, "ownerDecision", {});

  const latestCase = readCaseFromFirebase_(caseId) || casePayload;
  const prepared = prepareOwnerDecisionLinkForCase_(caseId, latestCase, quoteId, quote);
  if (!prepared.ok || !prepared.state || !prepared.state.shortDecisionUrl) {
    throw new Error(prepared.message || "테스트 승인 링크 생성에 실패했습니다.");
  }
  const supplier = prepared.supplier;
  const amounts = prepared.amounts;
  const approvalUrl = prepared.state.shortDecisionUrl;
  const content = makeOwnerRecommendationAlimTalkContent_(latestCase, supplier, amounts);
  const fallbackContent = appendOwnerDecisionLink_(content, approvalUrl);
  const testConfig = Object.assign({}, config, { useSmsFailover: false });
  const result = sendSensAlimTalk_(
    to,
    content,
    "건물주 추천 견적 테스트",
    config.templates.ownerQuote,
    {
      fallbackContent: fallbackContent,
      buttons: [{
        type: "WL",
        name: "추천 견적 확인",
        linkMobile: approvalUrl,
        linkPc: approvalUrl
      }]
    },
    testConfig
  );
  Logger.log(JSON.stringify(result));
  if (!result.ok) throw new Error(result.message || "건물주 추천 견적 알림톡 테스트 발송 실패");
  const saved = {
    sentAt: now,
    caseId: caseId,
    quoteId: quoteId,
    decisionUrl: prepared.state.decisionUrl,
    shortDecisionUrl: approvalUrl,
    requestId: result.requestId || "",
    messageId: result.messageId || "",
    templateCode: result.templateCode || config.templates.ownerQuote
  };
  props.setProperty("LAST_OWNER_RECOMMENDATION_ALIMTALK_TEST", JSON.stringify(saved));
  return Object.assign({}, result, saved);
}

function checkKakaoOwnerRecommendationAlimTalkTestStatus() {
  const props = PropertiesService.getScriptProperties();
  const saved = JSON.parse(props.getProperty("LAST_OWNER_RECOMMENDATION_ALIMTALK_TEST") || "{}");
  if (!saved.messageId) {
    throw new Error("먼저 testKakaoOwnerRecommendationAlimTalkSetup을 실행해 주세요.");
  }
  const config = getKakaoAlimTalkConfig_();
  if (!config.enabled) throw new Error("카카오 알림톡과 NCP 인증 설정을 확인해 주세요.");
  const uri = "/alimtalk/v2/services/" + encodeURIComponent(config.serviceId) +
    "/messages/" + encodeURIComponent(String(saved.messageId));
  const response = sensGetJson_(uri, config);
  const status = response.json && typeof response.json === "object" ? response.json : {};
  const result = {
    ok: response.ok === true,
    caseId: saved.caseId || "",
    messageId: saved.messageId,
    requestStatusCode: String(status.requestStatusCode || ""),
    requestStatusName: String(status.requestStatusName || ""),
    messageStatusCode: String(status.messageStatusCode || ""),
    messageStatusName: String(status.messageStatusName || ""),
    messageStatusDesc: String(status.messageStatusDesc || ""),
    completeTime: String(status.completeTime || ""),
    shortDecisionUrl: saved.shortDecisionUrl || "",
    decisionUrl: saved.decisionUrl || ""
  };
  Logger.log(JSON.stringify(result));
  return result;
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
  const visitTime = formatVisitTimeFromRecord_(record);
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
  const visitDateRaw = readRawField_(record, ["방문 가능 날짜", "방문 날짜", "방문일"]);
  const visitTime = formatVisitTimeFromRecord_(record, timestamp);
  const sheetUrl = COMPLAINT_CONFIG.RESPONSE_SHEET_URL + "#gid=" + sheet.getSheetId();
  const ownerPhone = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  const source = readField_(record, ["접수 경로"]) || "google_form";
  const sourceLabel = source === "kakao_chatbot" ? "카카오톡" : "구글폼";
  const kakaoUserKeyHash = readField_(record, ["카카오 사용자 키 해시"]);
  const photoFileIds = extractDriveFileIdsFromText_(readField_(record, ["사진 첨부", "첨부 사진", "사진", "사진첨부"]));
  const isContractHold = contractMatch && (contractMatch.status === "unmatched" || contractMatch.status === "multiple" || contractMatch.status === "address_missing");
  const statusValue = isContractHold ? "계약확인보류" : analysis.statusValue;
  const status = isContractHold ? { c1: "doing" } : { c1: "done", c2: "doing" };
  const c1Note = contractMatch && contractMatch.status === "matched"
    ? sourceLabel + " 자동 접수. Drive 온보딩 수집서와 연결되었습니다. 개인정보/사진 원본은 응답 시트에서 확인하세요."
    : isContractHold
      ? "온보딩 파일 미매칭. Drive 폴더의 DOCX 본문에 건물명/주소가 있는지 확인한 뒤 진행하세요."
      : sourceLabel + " 자동 접수. 개인정보/사진 원본은 응답 시트에서 확인하세요.";

  return {
    id: ticketNo,
    ticketNo: ticketNo,
    source: source,
    createdAt: new Date().toISOString(),
    receivedAt: receivedAt,
    sheetUrl: sheetUrl,
    sheetRow: row,
    name: maskName_(name) || "세입자",
    phone: maskPhone_(phone),
    email: "",
    building: building,
    address: address,
    room: formatRoomForCase_(room),
    grade: contractMatch && contractMatch.contract && contractMatch.contract.grade ? contractMatch.contract.grade : "스탠다드",
    issueType: issueType,
    urgency: analysis.urgency,
    vendorType: analysis.vendorType,
    summary: analysis.summary,
    analysisReason: analysis.reason,
    visitDate: formatKoreanDateOnlyForCase_(visitDateRaw || timestamp),
    visitTime: visitTime,
    photos: photoFileIds.map((fileId, index) => ({
      id: fileId,
      name: "현장 사진 " + (index + 1),
      driveUrl: "https://drive.google.com/open?id=" + fileId
    })),
    photoCount: photoFileIds.length,
    statusValue: statusValue,
    contractMatch: contractMatch,
    ownerPhoneMasked: ownerPhone ? maskPhone_(ownerPhone) : "",
    status: status,
    kakao: source === "kakao_chatbot" ? {
      userKeyHash: kakaoUserKeyHash,
      linkedAt: new Date().toISOString()
    } : {},
    note: {
      c1: c1Note,
      c3: makeConsultationNote_(ticketNo, record, analysis, sheetUrl),
      c4: makeClassificationNote_(ticketNo, record, analysis),
      c11: visitTime ? "방문 가능 시간: " + visitTime : ""
    },
    log: [
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + " " + sourceLabel + " 자동 접수",
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

function firebaseCaseSettingsUrl_(childPath) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const path = String(COMPLAINT_CONFIG.FIREBASE_CASE_SETTINGS_PATH || "caseSettings").replace(/^\/|\/$/g, "");
  const child = String(childPath || "").split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  return base + "/" + path + (child ? "/" + child : "") + ".json";
}

function firebaseWriteRequest_(url, method, payload, label) {
  const response = UrlFetchApp.fetch(url, {
    method: method,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
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
  if (existing.deleted === true) {
    return Object.assign({}, existing, {
      archived: true,
      deleted: true,
      deletedAt: existing.deletedAt || new Date().toISOString(),
      updatedAt: existing.updatedAt || new Date().toISOString()
    });
  }
  const merged = Object.assign({}, existing, payload);

  const incomingStatus = Object.assign({}, payload.status || {});
  const existingStatus = Object.assign({}, existing.status || {});
  merged.status = {};
  const statusKeys = Object.keys(Object.assign({}, incomingStatus, existingStatus));
  statusKeys.forEach(key => {
    const incoming = incomingStatus[key];
    const current = existingStatus[key];
    merged.status[key] = workflowStatusRank_(incoming) > workflowStatusRank_(current) ? incoming : current;
  });
  merged.note = Object.assign({}, payload.note || {}, existing.note || {});

  [
    "log",
    "quoteFiles",
    "businessRegistrationFiles",
    "workPhotoFiles",
    "vendorSelections",
    "vendorEstimateMms",
    "ownerRecommendationMms",
    "ownerDecision",
    "quoteRequestRounds",
    "quoteRequestRound",
    "automationState",
    "complaintReceiptSms",
    "selectedVendors"
  ].forEach(key => {
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
  if (existing && existing.deleted === true) {
    Logger.log("삭제된 케이스 저장 생략: " + caseId);
    return;
  }
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
  const digits = normalizePhoneForSms_(phone);
  if (digits.length < 7) return phone ? "***" : "";
  return digits.slice(0, 3) + "-****-" + digits.slice(-4);
}

function formatRoomForCase_(room) {
  const v = String(room || "").trim();
  if (!v) return "";
  return /호$/.test(v) ? v : v + "호";
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
