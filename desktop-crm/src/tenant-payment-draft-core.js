"use strict";

// AI 연결 통로로 들어온 세입자·납부 일정 초안을 검사한다.
// 세입자를 새 저장소로 만들지 않는다 — CRM에서 세입자 정보는 이미
// 건물주 입금캘린더의 납부 일정(paymentCalendars/shared/schedules)에 산다.
// 여기서는 화면의 '＋ 납부 일정'과 같은 값만 만들고, 저장은 기존
// remoteClient.savePaymentSchedule 경로가 그대로 한다.

const DRAFT_KEYS = Object.freeze(["buildingId", "unit", "tenantName", "tenantPhone", "payerName", "amount", "dueDay", "startMonth", "endMonth"]);
const MAX_AMOUNT = 100000000;
const MAX_MATCHES = 10;

function text(value, limit) {
  return String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, limit || 120);
}

function rows(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") return Object.entries(value).map(([id, item]) => item && typeof item === "object" ? Object.assign({ id }, item, { id: item.id || id }) : null).filter(Boolean);
  return [];
}

function searchKey(value) {
  return String(value == null ? "" : value).toLowerCase().replace(/[^0-9a-zㄱ-ㅣ가-힣]/gu, "");
}

// '202호', '202 호', '202'를 같은 호실로 본다.
function unitKey(value) {
  return String(value == null ? "" : value).replace(/\s+/gu, "").replace(/호$/u, "").toLowerCase();
}

function validMonth(value) {
  const match = /^(\d{4})-(\d{2})$/u.exec(String(value || ""));
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function monthSpan(startMonth, endMonth) {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

function formatPhone(digits) {
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 9 && digits.startsWith("02")) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return digits;
}

function scheduleBelongsToBuilding(schedule, building) {
  const id = String(schedule && schedule.buildingId || "");
  if (!id) return false;
  if (id === String(building.id)) return true;
  const refs = building.externalRefs && Array.isArray(building.externalRefs.paymentBuildingIds) ? building.externalRefs.paymentBuildingIds : [];
  return refs.map(String).includes(id);
}

function unitsForBuilding(units, building) {
  return rows(units).filter(unit => !unit.archivedAt && String(unit.crmBuildingId || unit.buildingId || "") === String(building.id));
}

function schedulesForBuilding(schedules, building) {
  return rows(schedules).filter(schedule => scheduleBelongsToBuilding(schedule, building));
}

// 대표가 말한 건물 이름으로 후보를 찾는다. 세입자 연락처는 돌려주지 않는다.
function buildTenantContext(source, query) {
  const keyword = searchKey(query);
  if (!keyword) return { ok: false, error: "찾을 건물 이름을 알려 주세요." };
  const buildings = rows(source && source.buildings).filter(building => !building.archivedAt && !building.deletedAt);
  const matches = buildings.filter(building => [building.name, building.address, building.roadAddress, building.jibunAddress]
    .some(value => searchKey(value).includes(keyword)));
  return {
    ok: true,
    truncated: matches.length > MAX_MATCHES,
    buildings: matches.slice(0, MAX_MATCHES).map(building => ({
      id: String(building.id),
      name: text(building.name, 120),
      address: text(building.roadAddress || building.address || building.jibunAddress, 240),
      units: unitsForBuilding(source.buildingUnits, building).slice(0, 300).map(unit => ({
        label: text(unit.label || unit.unitLabel, 80),
        floor: text(unit.floorLabel, 40),
        status: text(unit.status, 30),
      })),
      tenants: schedulesForBuilding(source.schedules, building).slice(0, 300).map(schedule => ({
        scheduleId: String(schedule.id),
        unit: text(schedule.unit, 80),
        tenantName: text(schedule.tenantName, 80),
        hasPhone: !!text(schedule.tenantPhone, 40),
        amount: Math.round(Number(schedule.amount) || 0),
        dueDay: Number(schedule.dueDay) || 0,
        startMonth: text(schedule.startMonth, 7),
        endMonth: text(schedule.endMonth, 7),
        active: schedule.active !== false,
      })),
    })),
  };
}

function normalizeTenantDraft(input, source) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "세입자 정보 형식이 올바르지 않습니다." };
  const unknown = Object.keys(input).filter(key => !DRAFT_KEYS.includes(key));
  if (unknown.length) return { ok: false, error: `지원하지 않는 항목이 있습니다: ${unknown.join(", ")}` };

  const building = rows(source && source.buildings).find(item => String(item.id) === String(input.buildingId || ""));
  if (!building) return { ok: false, error: "CRM에 등록된 건물을 찾지 못했습니다. 먼저 건물 찾기로 건물 번호를 확인해 주세요." };

  const unit = text(input.unit, 80);
  const tenantName = text(input.tenantName, 80);
  if (!unit) return { ok: false, error: "호실을 알려 주세요. 예: 202호" };
  if (!tenantName) return { ok: false, error: "세입자 이름을 알려 주세요." };

  let tenantPhone = "";
  if (input.tenantPhone != null && String(input.tenantPhone).trim()) {
    const digits = String(input.tenantPhone).replace(/[^0-9]/gu, "");
    if (!/^0\d{8,10}$/u.test(digits)) return { ok: false, error: "세입자 연락처를 확인해 주세요. 예: 010-1234-5678" };
    tenantPhone = formatPhone(digits);
  }

  const amount = typeof input.amount === "number" ? input.amount : Number(String(input.amount == null ? "" : input.amount).replace(/[^0-9.]/gu, ""));
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) return { ok: false, error: "월 납부금액을 원 단위 숫자로 확인해 주세요. 예: 330000" };
  const dueDay = Number(input.dueDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return { ok: false, error: "매월 납부일은 1~31 사이 숫자로 알려 주세요." };

  const startMonth = text(input.startMonth, 7);
  const endMonth = text(input.endMonth, 7);
  if (!validMonth(startMonth)) return { ok: false, error: "시작 월을 YYYY-MM 형식으로 알려 주세요. 예: 2026-11" };
  if (endMonth && !validMonth(endMonth)) return { ok: false, error: "종료 월을 YYYY-MM 형식으로 알려 주세요. 예: 2027-10" };
  if (endMonth && endMonth < startMonth) return { ok: false, error: "종료 월이 시작 월보다 앞섭니다." };

  const warnings = [];
  const key = unitKey(unit);
  const units = unitsForBuilding(source.buildingUnits, building);
  if (units.length && !units.some(item => unitKey(item.label || item.unitLabel) === key)) {
    warnings.push(`${building.name || "이 건물"}에 '${unit}' 호실이 아직 등록되어 있지 않습니다. 납부 일정은 저장되지만 건물 호실 목록에는 따로 추가해야 합니다.`);
  }
  const sameUnit = schedulesForBuilding(source.schedules, building)
    .filter(schedule => schedule.active !== false && unitKey(schedule.unit) === key);
  if (sameUnit.length) {
    warnings.push(`같은 호실에 사용 중인 납부 일정이 이미 있습니다: ${sameUnit.map(item => text(item.tenantName, 80) || "이름 없음").join(", ")}. 새로 등록하면 이 호실의 납부 일정이 ${sameUnit.length + 1}개가 됩니다.`);
  }
  const months = endMonth ? monthSpan(startMonth, endMonth) : null;

  return {
    ok: true,
    warnings,
    months,
    schedule: {
      buildingId: String(building.id),
      buildingName: text(building.name, 120) || "건물명 미입력",
      buildingAddress: text(building.roadAddress || building.address || building.jibunAddress, 240),
      unit,
      tenantName,
      tenantPhone,
      payerName: text(input.payerName, 80) || tenantName,
      amount,
      dueDay,
      startMonth,
      endMonth,
      active: true,
    },
  };
}

module.exports = { DRAFT_KEYS, buildTenantContext, normalizeTenantDraft, unitKey, monthSpan };
