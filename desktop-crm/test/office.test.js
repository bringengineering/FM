const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const Office = require("../src/office-core");
const { FirebaseRemoteClient } = require("../src/remote");
const MutationPolicy = require("../src/mutation-policy");
const { createAttendanceWorkbook, excelDateSerial, safeFileSegment } = require("../src/attendance-xlsx");

const source = name => fs.readFile(path.join(__dirname, "..", "src", name), "utf8");

test("workDate uses the Asia/Seoul business date", () => {
  assert.equal(Office.workDate("2026-08-30T15:30:00.000Z"), "2026-08-31");
});

test("attendance normalization, monthly totals, and missing checkout review are stable", () => {
  const rows = Office.flattenAttendance({
    "uid-1": {
      "2026-08-31": { id: "uid-1_2026-08-31", userId: "uid-1", workDate: "2026-08-31", checkInAt: "2026-08-31T00:02:00.000Z", checkOutAt: "" },
      "2026-08-28": { id: "uid-1_2026-08-28", userId: "uid-1", workDate: "2026-08-28", checkInAt: "2026-08-28T00:01:00.000Z", checkOutAt: "2026-08-28T09:00:00.000Z" },
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(Office.attendanceStatus(rows[0]), "근무 중");
  assert.equal(Office.attendanceStatus(rows[1]), "퇴근 완료");
  const summary = Office.monthlyAttendanceSummary(rows, "uid-1", "2026-08", "2026-09-01T03:00:00.000Z");
  assert.equal(summary.attendedDays, 2);
  assert.equal(summary.completedDays, 1);
  assert.equal(summary.missingCheckoutDays, 1);
});

test("mailbox normalization de-duplicates mirrored messages and counts unread by sender", () => {
  const message = { id: "msg-1", senderId: "uid-2", receiverId: "uid-1", message: "확인 부탁드립니다", readAt: "", createdAt: "2026-08-31T01:00:00.000Z" };
  const rows = Office.flattenMailbox({ "uid-2": { "msg-1": message }, duplicate: { "msg-1": message } });
  assert.equal(rows.length, 1);
  assert.equal(Office.unreadByUser(rows, "uid-1").get("uid-2"), 1);
});

test("mailbox normalization keeps only bounded attachment metadata", () => {
  const attachment = {
    fileId: "msg_attachment_12345678",
    fileName: "업무보고.xlsx",
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 2048,
    sha256: "a".repeat(64),
  };
  assert.deepEqual(Office.normalizeMessage({ id: "msg_attachment_12345678", senderId: "one", receiverId: "two", message: "[파일] 업무보고.xlsx", attachment }).attachment, attachment);
  assert.equal(Office.normalizeMessage({ attachment: { ...attachment, fileName: "../업무보고.xlsx" } }).attachment, null);
  assert.equal(Office.normalizeMessage({ attachment: { ...attachment, fileName: "업무\u202E보고.xlsx" } }).attachment, null);
  assert.equal(Office.normalizeMessage({ attachment: { ...attachment, fileName: "CON.xlsx" } }).attachment, null);
  assert.equal(Office.normalizeMessage({ attachment: { ...attachment, fileName: "업무보고.pdf" } }).attachment, null);
  assert.equal(Office.normalizeMessage({ attachment: { ...attachment, mimeType: "application/pdf" } }).attachment, null);
  assert.equal(Office.normalizeMessage({ attachment: { ...attachment, size: 6 * 1024 * 1024 } }).attachment, null);
});

test("plain Enter sends while Shift+Enter and Korean IME confirmation stay in the editor", () => {
  assert.equal(Office.shouldSendMessageKey({ key: "Enter" }), true);
  assert.equal(Office.shouldSendMessageKey({ key: "Enter", shiftKey: true }), false);
  assert.equal(Office.shouldSendMessageKey({ key: "Enter", isComposing: true }), false);
  assert.equal(Office.shouldSendMessageKey({ key: "Enter", keyCode: 229 }), false);
  assert.equal(Office.shouldSendMessageKey({ key: "Enter", ctrlKey: true }), false);
  assert.equal(Office.shouldSendMessageKey({ key: "a" }), false);
});

test("office users prefer direct names and otherwise use their active linked worker profile", () => {
  const access = {
    "uid-direct": { email: "hwj1896@example.com", displayName: " 황우중 ", role: "member", enabled: true, operatorId: "operator_shared", officeProfileId: "operator_kim" },
    "uid-shared-operator": { email: "second1896@example.com", role: "member", enabled: true, operatorId: "operator_shared" },
    "uid-explicit-profile": { email: "dpvld858@example.com", role: "admin", enabled: true, officeProfileId: "operator_kim" },
    "uid-legacy-profile": { email: "legacy@example.com", role: "member", enabled: true, profileId: "operator_kim" },
    "uid-inactive": { email: "inactive@example.com", role: "member", enabled: true, officeProfileId: "operator_inactive" },
    "uid-invalid-name": { email: "invalid@example.com", displayName: "이름\n변조", name: "신뢰하지 않는 별칭", role: "member", enabled: true },
    "uid-reserved": { email: "reserved@example.com", role: "member", enabled: true, operatorId: "__proto__" },
    "uid-invalid-role": { email: "invalid-role@example.com", role: "owner", enabled: true },
    "uid-disabled": { email: "disabled@example.com", role: "member", enabled: false },
    "uid-password-reset": { email: "reset@example.com", role: "member", enabled: true, mustChangePassword: true },
  };
  const profiles = JSON.parse(`{
    "operator_shared":{"displayName":"같은 운영 라벨","active":true,"sortOrder":10},
    "operator_kim":{"displayName":"김현진","active":true,"sortOrder":20},
    "operator_inactive":{"displayName":"퇴사자","active":false,"sortOrder":30},
    "__proto__":{"displayName":"오염","active":true,"sortOrder":0}
  }`);

  const merged = Office.mergeOfficeUsers(access, profiles);
  assert.equal(merged["uid-direct"].displayName, "황우중");
  assert.equal(merged["uid-explicit-profile"].displayName, "김현진");
  assert.equal(Office.normalizeUser("uid-shared-operator", merged["uid-shared-operator"]).displayName, "같은 운영 라벨");
  assert.equal(Office.normalizeUser("uid-legacy-profile", merged["uid-legacy-profile"]).displayName, "김현진");
  assert.equal(Office.normalizeUser("uid-inactive", merged["uid-inactive"]).displayName, "inactive");
  assert.equal(Office.normalizeUser("uid-invalid-name", merged["uid-invalid-name"]).displayName, "invalid");
  assert.equal(Office.normalizeUser("uid-reserved", merged["uid-reserved"]).displayName, "reserved");
  assert.equal(merged["uid-invalid-role"], undefined);
  assert.equal(merged["uid-disabled"], undefined);
  assert.equal(merged["uid-password-reset"], undefined);
  assert.equal(access["uid-direct"].displayName, " 황우중 ");
  assert.equal(Object.getPrototypeOf(merged), null);
});

test("office user profile merge fails closed for malformed maps and oversized names", () => {
  const oversizedName = "가".repeat(81);
  const users = Office.mergeOfficeUsers({ uid: { email: "fallback@example.com", displayName: oversizedName, officeProfileId: "operator_long", role: "member", enabled: true }, "unsafe/user": { email: "unsafe@example.com", role: "member", enabled: true } }, {
    operator_long: { displayName: oversizedName, active: true },
  });
  assert.equal(Office.normalizeUser("uid", users.uid).displayName, "fallback");
  assert.equal(users["unsafe/user"], undefined);
  assert.deepEqual(Object.keys(Office.mergeOfficeUsers([], {})), []);
  assert.deepEqual(Object.keys(Office.mergeOfficeUsers({}, [])), []);
});

test("office display names and target UIDs are normalized at the trust boundary", () => {
  assert.equal(Office.normalizeOfficeDisplayName("  김현진  "), "김현진");
  assert.equal(Office.normalizeOfficeDisplayName(""), "");
  assert.equal(Office.normalizeOfficeDisplayName("김\n현진"), "");
  assert.equal(Office.normalizeOfficeDisplayName("김\u202E현진"), "");
  assert.equal(Office.normalizeOfficeDisplayName("김\u200D현진"), "");
  assert.equal(Office.normalizeOfficeDisplayName("김\u0600현진"), "");
  assert.equal(Office.normalizeOfficeDisplayName("가".repeat(81)), "");
  assert.equal(Office.normalizeOfficeDisplayName("😀".repeat(61)), "");
  assert.equal(Office.normalizeOfficeUserId(" uid.member-1 "), "uid.member-1");
  assert.equal(Office.normalizeOfficeUserId("unsafe/user"), "");
  assert.equal(Office.normalizeOfficeUserId("__proto__"), "");
});

test("office UI is wired to the production CRM navigation, auth context, and canonical IPC boundary", async () => {
  const [html, app, preload, main, remote, ui] = await Promise.all([
    source("index.html"), source("app.js"), source("preload.js"), source("main.js"), source("remote.js"), source("office.js"),
  ]);
  assert.match(html, /data-nav-folder="office"/);
  assert.match(html, /data-view="officeHome"/);
  assert.match(html, /data-view="officeAttendance"/);
  assert.match(html, />근태관리</);
  assert.match(html, /data-view="officeMessenger"/);
  assert.match(html, /id="navOfficeAdmin"/);
  assert.match(app, /user\.officeAdmin !== true/);
  assert.match(app, /window\.BringOffice\.render/);
  assert.match(preload, /crm:office-load/);
  assert.match(preload, /crm:office-attendance-save/);
  assert.match(preload, /crm:office-display-name-save/);
  assert.match(preload, /crm:office-attendance-export/);
  assert.match(preload, /crm:office-message-send/);
  assert.match(preload, /crm:office-attachment-pick/);
  assert.match(preload, /crm:office-attachment-open/);
  assert.match(main, /secureCanonicalHandle\("crm:office-messages-read"/);
  assert.match(main, /secureCanonicalHandle\("crm:office-display-name-save"/);
  assert.match(main, /secureCanonicalHandle\("crm:office-attachment-pick"/);
  assert.match(main, /secureCanonicalHandle\("crm:office-attachment-open"/);
  assert.match(main, /BRING_CRM_SCREENSHOT_ACTION === "office-messenger-smoke"/);
  assert.match(main, /actor\.officeAdmin !== true/);
  assert.doesNotMatch(main, /userId === actor\.uid/);
  assert.match(remote, /this\.dbRequest\("crmAccess"/);
  assert.match(remote, /this\.dbRequest\("teamProfiles"/);
  assert.match(remote, /OfficeCore\.mergeOfficeUsers\(users, teamProfiles\)/);
  assert.match(remote, /crmAccess\/\$\{userId\}\/displayName/);
  assert.match(remote, /sessionRef\.officeAdmin = access\.officeAdmin === true/);
  assert.match(remote, /session\.officeAdmin === true \? "officeAttendance" : `officeAttendance\/\$\{session\.uid\}`/);
  assert.match(remote, /officeMailbox/);
  assert.match(remote, /officeMessageFiles/);
  assert.doesNotMatch(remote, /userId === session\.uid/);
  assert.match(ui, /브링의 업무를 한 곳에서/);
  assert.match(ui, /office-admin-calendar/);
  assert.match(ui, /근태 보기/);
  assert.match(ui, /퇴근 미기록/);
  assert.match(ui, /엑셀 다운로드/);
  assert.match(ui, /Core\.shouldSendMessageKey\(event\)/);
  assert.match(ui, /requestSubmit\(\)/);
  assert.match(ui, /data-office-display-name-form/);
  assert.match(ui, /data-office-display-name-surface="attendance"/);
  assert.match(ui, /전체 근태관리와 모든 사용자의 메신저에 같은 이름/);
  assert.match(ui, /saveOfficeDisplayName/);
  assert.match(ui, /data-office-attachment-pick/);
  assert.match(ui, /data-office-attachment-open/);
});

test("office display-name persistence writes only the validated target leaf", async () => {
  assert.equal(MutationPolicy.classification("crm:office-display-name-save"), "mutation");
  const calls = [];
  const fake = {
    requireOfficeSession: () => ({ uid: "crm-admin", role: "admin", officeAdmin: true }),
    captureSessionGuard: () => ({ generation: 1 }),
    assertSessionGuardActive: () => true,
    dbRequest: async (location, options) => {
      calls.push({ location, options });
      return options.method === "GET" ? { enabled: true, role: "viewer" } : null;
    },
    loadOffice: async () => ({ users: {}, attendance: [], messages: [] }),
  };
  await FirebaseRemoteClient.prototype.saveOfficeDisplayName.call(fake, {
    userId: "crm-viewer",
    displayName: "  황우중  ",
  });
  await FirebaseRemoteClient.prototype.saveOfficeDisplayName.call(fake, {
    userId: "crm-admin",
    displayName: "  김현진  ",
  });
  assert.deepEqual(calls.map(call => [call.location, call.options.method, call.options.body]), [
    ["crmAccess/crm-viewer", "GET", undefined],
    ["crmAccess/crm-viewer/displayName", "PUT", "황우중"],
    ["crmAccess/crm-admin", "GET", undefined],
    ["crmAccess/crm-admin/displayName", "PUT", "김현진"],
  ]);
  await assert.rejects(
    FirebaseRemoteClient.prototype.saveOfficeDisplayName.call(fake, { userId: "crm-viewer", displayName: "정상", role: "admin" }),
    /요청이 올바르지/,
  );
  await assert.rejects(
    FirebaseRemoteClient.prototype.saveOfficeDisplayName.call({
      requireOfficeSession: () => ({ uid: "crm-member", role: "member", officeAdmin: false }),
    }, { userId: "crm-viewer", displayName: "변조" }),
    /지정된 근태 관리자/,
  );
  await assert.rejects(
    FirebaseRemoteClient.prototype.saveOfficeDisplayName.call({
      requireOfficeSession: () => ({ uid: "crm-admin", role: "admin", officeAdmin: true }),
      captureSessionGuard: () => ({ generation: 1 }),
      assertSessionGuardActive: () => true,
      dbRequest: async () => ({ enabled: true, role: "owner" }),
    }, { userId: "crm-owner", displayName: "권한없음" }),
    /활성 구성원/,
  );
  await assert.rejects(
    FirebaseRemoteClient.prototype.saveOfficeDisplayName.call({
      requireOfficeSession: () => ({ uid: "crm-admin", role: "admin", officeAdmin: true }),
      captureSessionGuard: () => ({ generation: 1 }),
      assertSessionGuardActive: () => true,
      dbRequest: async () => ({ enabled: true, mustChangePassword: true, role: "member" }),
    }, { userId: "crm-pending", displayName: "대기 사용자" }),
    /활성 구성원/,
  );
});

test("office message transport refuses enabled accounts with an unsupported role", async () => {
  await assert.rejects(
    FirebaseRemoteClient.prototype.sendOfficeMessage.call({
      requireOfficeSession: () => ({ uid: "crm-member", role: "member" }),
      captureSessionGuard: () => ({ generation: 1 }),
      assertSessionGuardActive: () => true,
      dbRequest: async (location, options) => {
        assert.equal(location, "crmAccess/crm-owner");
        assert.equal(options.method, "GET");
        return { enabled: true, role: "owner" };
      },
    }, { receiverId: "crm-owner", message: "보내지면 안 됨" }),
    /받을 수 없는 사용자/,
  );
});

test("attendance Excel export is a styled XLSX with typed dates, formulas, and review status", () => {
  const user = { uid: "uid-1", displayName: "테스트 직원", department: "운영", title: "매니저" };
  const rows = [
    { userId: "uid-1", workDate: "2026-08-28", checkInAt: "2026-08-28T00:02:00.000Z", checkOutAt: "2026-08-28T09:10:00.000Z" },
    { userId: "uid-1", workDate: "2026-08-29", checkInAt: "2026-08-29T00:05:00.000Z", checkOutAt: "" },
  ];
  const workbook = createAttendanceWorkbook({ user, month: "2026-08", rows, now: "2026-08-31T03:00:00.000Z" });
  assert.equal(workbook.subarray(0, 2).toString(), "PK");
  assert.ok(workbook.length > 5000);
  assert.ok(workbook.includes(Buffer.from("월별 근태현황")));
  assert.ok(workbook.includes(Buffer.from("퇴근 미기록")));
  assert.ok(workbook.includes(Buffer.from("COUNT(B7:B8)")));
  assert.equal(excelDateSerial("2026-08-28"), 46262);
  assert.equal(safeFileSegment("테스트:/직원*"), "테스트__직원_");
});

test("production database rules deny team attendance to ordinary CRM administrators", async () => {
  const rules = JSON.parse(await fs.readFile(path.join(__dirname, "..", "..", "database.rules.json"), "utf8"));
  const company = rules.rules.crmCompany;
  assert.match(company.officeAttendance[".read"], /child\('officeAdmin'\)\.val\(\) === true/);
  assert.match(company.officeAttendance.$uid.$workDate[".write"], /auth\.uid === \$uid/);
  assert.match(company.officeAttendance.$uid.$workDate[".write"], /!data\.exists\(\)/);
  assert.match(company.officeMailbox.$ownerUid[".read"], /auth\.uid === \$ownerUid/);
  assert.equal(company.officeMailbox[".read"], false);
  assert.equal(company.officeMailbox[".write"], false);
  assert.equal(company.officeMessageFiles[".read"], false);
  assert.equal(company.officeMessageFiles[".write"], false);
  assert.match(company.officeMessageFiles.$messageId[".read"], /senderId/);
  assert.match(company.officeMessageFiles.$messageId[".read"], /receiverId/);
  assert.match(company.officeMessageFiles.$messageId[".write"], /!data\.exists\(\)/);
  assert.match(company.officeMailbox.$ownerUid.$peerUid.$messageId[".write"], /attachment/);
  assert.match(company.access.$uid.displayName[".write"], /officeAdmin/);
  assert.doesNotMatch(company.access.$uid.displayName[".write"], /auth\.uid !== \$uid/);
  assert.match(company.access.$uid.displayName[".write"], /child\(\$uid\)\.child\('mustChangePassword'\)/);
  assert.match(company.access.$uid.displayName[".validate"], /length <= 80/);
});
