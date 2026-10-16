const MESSAGES = Object.freeze({
  SESSION_CHANGED: "로그인 상태가 바뀌었습니다. 진행률은 저장되지 않았습니다. 다시 로그인해 주세요.",
  WORK_ORDER_FORBIDDEN: "현재 계정은 진행률을 수정할 권한이 없습니다.",
  NOT_ASSIGNEE: "담당자로 지정된 업무만 진행률을 수정할 수 있습니다.",
  WORK_ORDER_NOT_FOUND: "업무를 찾지 못했습니다. 최신 목록을 다시 불러와 주세요.",
  WORK_ORDER_CONFLICT: "다른 사용자가 먼저 업무를 변경했습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.",
  PROGRESS_NOTE_REQUIRED: "진행 내용을 입력해 주세요. 입력한 내용은 창에 유지됩니다.",
  PROGRESS_HISTORY_FULL: "진행 기록 한도에 도달했습니다. 관리자에게 기록 확인을 요청해 주세요.",
  WORK_ORDER_DONE: "완료된 업무는 수정할 수 없습니다.",
  WORK_ORDER_WRITE_FORBIDDEN: "서버가 저장을 거부했습니다. 로그인 상태와 이 업무의 수정 권한을 확인해 주세요.",
  WORK_ORDER_WRITE_REJECTED: "서버가 진행률 변경을 거부했습니다. 저장 권한 또는 업무 데이터 형식을 확인해 주세요.",
  WORK_ORDER_WRITE_UNCONFIRMED: "저장 결과를 확인하지 못했습니다. 중복 저장을 막기 위해 새로고침 후 진행률을 먼저 확인해 주세요.",
  WORK_ORDER_WRITE_FAILED: "진행률을 저장하지 못했습니다. 입력 내용은 유지됩니다. 연결 상태를 확인하고 다시 시도해 주세요.",
});

function safeWorkOrderProgressError(error) {
  const sourceCode = String(error && error.code || "");
  const status = Number(error && error.status) || 0;
  let code = sourceCode;

  if (code === "BUILDING_SCHEDULE_CONFLICT") code = "WORK_ORDER_CONFLICT";
  if (code === "BUILDING_SCHEDULE_WRITE_UNCONFIRMED") code = "WORK_ORDER_WRITE_UNCONFIRMED";
  if (code === "BUILDING_SCHEDULE_WRITE_FAILED") {
    code = status === 401 || status === 403
      ? "WORK_ORDER_WRITE_FORBIDDEN"
      : status === 404
        ? "WORK_ORDER_NOT_FOUND"
        : "WORK_ORDER_WRITE_REJECTED";
  }
  if (["AUTH_REQUIRED", "SESSION_CHANGED"].includes(code)) code = "SESSION_CHANGED";

  if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) code = "WORK_ORDER_WRITE_FAILED";
  return { ok: false, code, error: MESSAGES[code] };
}

module.exports = { safeWorkOrderProgressError };
