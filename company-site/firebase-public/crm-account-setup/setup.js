(() => {
  "use strict";

  const FUNCTION_BASE = "https://asia-northeast3-bring-fm.cloudfunctions.net";
  const form = document.getElementById("setupForm");
  const displayName = document.getElementById("setupDisplayName");
  const email = document.getElementById("setupEmail");
  const password = document.getElementById("setupPassword");
  const passwordConfirm = document.getElementById("setupPasswordConfirm");
  const submit = document.getElementById("setupSubmit");
  const message = document.getElementById("setupMessage");
  let actionCode = "";
  let inviteUid = "";
  let inviteToken = "";
  let completed = false;

  function setMessage(text, tone) {
    message.textContent = String(text || "");
    message.className = `setup-message${tone ? ` is-${tone}` : ""}`;
  }

  function showInvalidInvite() {
    form.hidden = true;
    actionCode = "";
    inviteUid = "";
    inviteToken = "";
    document.getElementById("setupTitle").textContent = "유효한 초대 링크가 아닙니다";
    document.getElementById("setupDescription").textContent = "관리자에게 새 이메일 인증 링크를 요청해 주세요.";
    setMessage("링크가 만료되었거나 올바르지 않습니다.", "error");
  }

  function readActionCode() {
    const params = new URLSearchParams(window.location.search);
    const direct = params.get("oobCode");
    const mode = params.get("mode");
    if (direct && mode) return window.BringCrmAccountSetup.parseSignInActionLink(window.location.href);
    const nested = params.get("link") || params.get("deep_link_id");
    return nested ? window.BringCrmAccountSetup.parseSignInActionLink(nested) : null;
  }

  async function boundedJson(response) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > 16 * 1024)) {
      try { await response.body?.cancel(); } catch (_) {}
      throw new Error("response_too_large");
    }
    if (!response.body || typeof response.body.getReader !== "function") throw new Error("response_invalid");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16 * 1024) {
          await reader.cancel();
          throw new Error("response_too_large");
        }
        chunks.push(part.value);
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  async function callSetupFunction(name, data) {
    const response = await fetch(`${FUNCTION_BASE}/${name}`, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ data }),
    });
    const payload = await boundedJson(response);
    if (!response.ok || !payload?.result) throw new Error("account_setup_failed");
    return payload.result;
  }

  async function initializeAccountSetup() {
    const action = readActionCode();
    try { window.history.replaceState(null, "", window.location.pathname); } catch (_) {}
    if (!action || action.mode !== "signIn") {
      showInvalidInvite();
      return;
    }

    actionCode = action.actionCode;
    inviteUid = action.uid;
    inviteToken = action.setupToken;
    setMessage("초대받은 이메일 주소를 확인하고 있습니다…");
    try {
      const invite = await callSetupFunction("getCrmAccountSetupInvite", {
        uid: inviteUid,
        setupToken: inviteToken,
      });
      if (typeof invite.maskedEmail !== "string" || invite.maskedEmail.length > 320) {
        throw new Error("account_setup_failed");
      }
      email.textContent = invite.maskedEmail;
      form.hidden = false;
      setMessage("초대받은 주소가 확인되었습니다. 이름과 새 비밀번호를 입력해 주세요.");
    } catch (_) {
      showInvalidInvite();
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (completed || submit.disabled || !form.reportValidity()) return;
    if (password.value !== passwordConfirm.value) {
      passwordConfirm.setCustomValidity("비밀번호가 서로 다릅니다.");
      passwordConfirm.reportValidity();
      passwordConfirm.setCustomValidity("");
      return;
    }
    if (!/[A-Za-z]/u.test(password.value) || !/[0-9]/u.test(password.value)) {
      password.setCustomValidity("영문과 숫자를 포함해 주세요.");
      password.reportValidity();
      password.setCustomValidity("");
      return;
    }

    submit.disabled = true;
    setMessage("이메일 인증과 비밀번호 설정을 처리하고 있습니다…");
    try {
      const result = await callSetupFunction("completeCrmAccountSetup", {
        uid: inviteUid,
        setupToken: inviteToken,
        displayName: displayName.value,
        password: password.value,
        oobCode: actionCode,
      });
      if (result?.ok !== true) throw new Error("account_setup_failed");
      completed = true;
      actionCode = "";
      inviteUid = "";
      inviteToken = "";
      password.value = "";
      passwordConfirm.value = "";
      form.hidden = true;
      document.getElementById("setupTitle").textContent = "계정 설정이 완료되었습니다";
      document.getElementById("setupDescription").textContent = "이메일 인증과 새 비밀번호 설정을 마쳤습니다.";
      setMessage("초대 메일이 발송된 주소와 새 비밀번호로 BRING CRM에 로그인해 주세요.", "success");
    } catch (_) {
      setMessage("링크가 만료되었거나 정보를 확인할 수 없습니다. CRM 관리자에게 새 인증 링크를 요청해 주세요.", "error");
      submit.disabled = false;
    }
  });

  void initializeAccountSetup();
})();
