const assert = require("node:assert/strict");
const test = require("node:test");

const Hr = require("../src/hr-core");

test("주민등록번호처럼 생긴 값은 저장을 거부한다", () => {
  // 칸을 안 만들어도 사람은 비고란에 적는다. 그래서 자유 입력칸 전부를 본다.
  for (const value of ["900101-1234567", "9001011234567", "900101 1234567", "담당자 900101-2345678 확인"]) {
    const result = Hr.validateRecord({ userId: "u1", note: value });
    assert.equal(result.ok, false, value);
    assert.equal(result.code, "RESIDENT_NUMBER_FORBIDDEN", value);
  }
  for (const field of ["phone", "emergencyContact", "department", "position"]) {
    assert.equal(Hr.validateRecord({ userId: "u1", [field]: "880303-1234567" }).ok, false, field);
  }
});

test("전화번호와 사업자번호는 막지 않는다", () => {
  // 너무 많이 잡으면 사람이 검사를 껐다 켜 달라고 하게 된다.
  for (const value of ["010-1234-5678", "02-555-1234", "123-45-67890", "2024-03-01 입사"]) {
    assert.equal(Hr.validateRecord({ userId: "u1", note: value }).ok, true, value);
  }
});

test("계좌·카드번호처럼 긴 숫자도 막는다", () => {
  // 칸을 안 만들어도 사람은 비고란에 적는다. 주민번호만 막으면 계좌번호가 들어온다.
  for (const value of ["1234567890123", "4111111111111111"]) {
    assert.equal(Hr.validateRecord({ userId: "u1", note: value }).ok, false, value);
  }
});

test("근로계약서 보관 위치는 https 만 받는다", () => {
  assert.equal(Hr.validateRecord({ userId: "u1", contractFileUrl: "http://drive.google.com/x" }).ok, false);
  assert.equal(Hr.validateRecord({ userId: "u1", contractFileUrl: "https://drive.google.com/x" }).ok, true);
});

test("날짜 앞뒤가 뒤집히면 거부한다", () => {
  const base = { userId: "u1", hireDate: "2024-03-01" };
  assert.equal(Hr.validateRecord({ ...base, contractEndDate: "2024-02-01" }).code, "CONTRACT_END_BEFORE_HIRE");
  assert.equal(Hr.validateRecord({ ...base, resignedDate: "2024-02-01" }).code, "RESIGNED_BEFORE_HIRE");
  assert.equal(Hr.validateRecord({ ...base, insuranceStartDate: "2024-02-01" }).code, "INSURANCE_BEFORE_HIRE");
});

test("법으로 걸리는 것과 그냥 빈 것을 갈라 준다", () => {
  const missing = Hr.checklist({ userId: "u1" }, "2026-09-06");
  const required = missing.filter(item => item.level === "required").map(item => item.key);
  // 입사일이 없으면 연차를 못 세고, 계약서가 없으면 교부·보관 의무를 못 지킨다.
  assert.ok(required.includes("hireDate"));
  assert.ok(required.includes("contractFileUrl"));
  // 4대보험은 CRM 에서 신고하지 않으므로 경고까지만이다.
  assert.equal(missing.find(item => item.key === "insuranceStartDate").level, "warn");
});

test("계약직인데 종료일이 없으면 필수로 잡는다", () => {
  const keys = Hr.checklist({ userId: "u1", employmentType: "contract" }, "2026-09-06")
    .filter(item => item.level === "required").map(item => item.key);
  assert.ok(keys.includes("contractEndDate"));
  const regular = Hr.checklist({ userId: "u1", employmentType: "regular" }, "2026-09-06").map(item => item.key);
  assert.ok(!regular.includes("contractEndDate"));
});

test("계약 만료가 다가오면 알리고, 지났으면 필수로 올린다", () => {
  const soon = Hr.checklist({ userId: "u1", employmentType: "contract", hireDate: "2024-01-01", contractEndDate: "2026-09-20" }, "2026-09-06");
  assert.equal(soon.find(item => item.key === "contractEnding").level, "warn");
  const over = Hr.checklist({ userId: "u1", employmentType: "contract", hireDate: "2024-01-01", contractEndDate: "2026-08-01" }, "2026-09-06");
  assert.equal(over.find(item => item.key === "contractExpired").level, "required");
});

test("퇴사자는 회사 전체 알림에서 빠진다", () => {
  const rows = [
    { userId: "u1", hireDate: "2024-01-01" },
    { userId: "u2", hireDate: "2023-01-01", resignedDate: "2025-12-31" },
  ];
  const owners = new Set(Hr.alerts(rows, "2026-09-06").map(item => item.userId));
  assert.ok(owners.has("u1"));
  assert.ok(!owners.has("u2"), "퇴사자를 계속 채우라고 하면 목록이 쓸모없어진다");
});

test("퇴사일을 적어도 기록은 남는다", () => {
  // 근로계약서는 3년 보관 의무가 있다. 지우는 길을 만들지 않았다.
  const record = Hr.normalizeRecord({ userId: "u1", hireDate: "2024-01-01", resignedDate: "2025-12-31" });
  assert.equal(Hr.statusOf(record, "2026-09-06"), "resigned");
  assert.equal(record.hireDate, "2024-01-01");
});

test("모르는 칸은 조용히 버린다", () => {
  const record = Hr.normalizeRecord({ userId: "u1", residentNumber: "900101-1234567", salary: 3000000 });
  assert.ok(!("residentNumber" in record));
  assert.ok(!("salary" in record));
});
