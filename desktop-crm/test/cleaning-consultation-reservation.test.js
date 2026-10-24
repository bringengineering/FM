const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../src/cleaning-consultation-reservation-ui");

test("reservation modal matches the reference fields and lists existing canonical CRM reservations", () => {
  const html = UI.render({
    customer: { id: "customer-1", name: "김민수", phone: "010-1234-5678" },
    staff: [{ id: "staff-1", name: "김민지" }], selectedStaffId: "staff-1", canWrite: true,
    reservations: [{ id: "activity-1", scheduledAt: "2026-09-29T01:00:00.000Z", reservationType: "site_check", owner: "김민지", reminderChannels: ["phone"], nextAction: "현장 상황 재확인", reservationStatus: "scheduled" }]
  });
  for (const label of ["상담 예약 등록", "예약 일시", "담당 상담원", "상담 유형", "고객 콜백", "현장 확인", "견적 후속 안내", "알림 설정", "전화", "문자", "기존 상담 예약", "현장 상황 재확인"]) {
    assert.ok(html.includes(label), `reservation UI includes ${label}`);
  }
  assert.match(html, /name="customerId" value="customer-1"/);
  assert.match(html, /name="reminderChannels" value="phone" checked/);
  assert.match(html, /data-reservation-id="activity-1"/);
  assert.match(html, /name="scheduledDate"/);
  assert.match(html, /name="scheduledTime"/);
  assert.match(html, /type="submit"[^>]*>예약 등록/);
});

test("reservation modal is safe for guest names and read-only users cannot save", () => {
  const html = UI.render({
    customer: { id: "customer-2", name: "<img src=x onerror=alert(1)>", phone: "010-9999-1111" },
    staff: [], canWrite: false, reservations: []
  });
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /예약 등록[^<]*<\/button>/);
  assert.match(html, /disabled/);
  assert.match(html, /기존 상담 예약이 없습니다/);
  assert.match(html, /알림은 CRM에 기록되며 전화·문자 자동 발송은 되지 않습니다/);
});

test("existing CRM customer detail and save handler own the reservation flow", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  assert.match(shell, /cleaning-consultation-reservation-ui\.js/);
  assert.match(app, /data-action="new-consultation-reservation"/);
  assert.match(app, /cleaningConsultationReservationForm/);
  assert.match(app, /reservationStatus:\s*["']scheduled["']/);
  assert.match(app, /reservationType:/);
  assert.match(app, /reminderChannels[:,]/);
  assert.match(app, /store\.activities\.push\(activity\)/);
});
