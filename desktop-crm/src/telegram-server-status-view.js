(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BringTelegramServerStatusView = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function render(state = {}) {
    const checking = state.loading === true || state.loaded !== true;
    const connected = !checking && state.status === "connected";
    const status = checking ? "checking" : connected ? "connected" : "unavailable";
    const label = checking ? "서버 연결 확인 중…" : connected ? "서버 연결 정상" : "서버 연결 확인 필요";
    return `<section class="setting-card tg-server-card" aria-label="텔레그램 서버 자동발송 연결 상태">
      <div class="tg-server-heading"><div><h3>서버 자동발송</h3><p>회사 업무방으로 오늘의 업무와 입금 일정을 공유합니다.</p></div>
        <span class="tg-server-status is-${status}" role="status" aria-live="polite">${label}</span></div>
      <dl class="tg-server-info">
        <div><dt>발송 시간</dt><dd>매일 오전 6시 · 한국시간</dd></div>
        <div><dt>발송 업무방</dt><dd>브링엔지니어링 업무방</dd></div>
        <div><dt>공유 내용</dt><dd>오늘 업무일정 · 오늘 계약 입금일</dd></div>
        <div><dt>발송 조건</dt><dd>등록된 항목이 있는 날만 발송</dd></div>
      </dl>
      <div class="tg-server-note">컴퓨터와 CRM을 꺼도 서버에서 자동으로 발송합니다.<br><small>봇 키는 서버에 보관하며, PC에서 입력하거나 저장하지 않습니다.</small></div>
    </section>`;
  }
  return { render };
});
