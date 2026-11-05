(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./contract-schedule-core') : root.BringContractSchedule);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BringContractBuildingMapCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Schedule) {
  'use strict';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const id = value => value === text(value) && /^[A-Za-z0-9_-]{1,120}$/.test(text(value)) && !['__proto__', 'prototype', 'constructor'].includes(value);
  const live = item => item && typeof item === 'object' && !Array.isArray(item) && !item.archivedAt && !item.deletedAt && !item.archived && !item.deleted && !item.isArchived && !['archived', 'deleted', 'cancelled', 'canceled', '취소', '무효'].includes(item.status);
  const list = value => Array.isArray(value) ? value : [];
  const states = Object.freeze({ active: { label: '계약 중', symbol: '★', rank: 0 }, planned: { label: '계약 예정', symbol: '○', rank: 1 }, ended: { label: '계약 종료', symbol: '●', rank: 2 }, unknown: { label: '상태 확인 필요', symbol: '?', rank: 3 } });
  function status(contract) {
    if (['진행 중', '종료 예정'].includes(contract.status)) return 'active';
    if (contract.status === '계약 준비') return 'planned';
    return contract.status === '종료' ? 'ended' : 'unknown';
  }
  function project(store, today = '') {
    const buildings = new Map(list(store?.buildings).filter(item => live(item) && id(item.id)).map(item => [item.id, item]));
    const customers = new Map(list(store?.customers).filter(item => live(item) && id(item.id)).map(item => [item.id, item]));
    const groups = new Map(), seen = new Set(), activeContracts = []; let unlinked = 0;
    for (const contract of list(store?.contracts)) {
      if (!live(contract) || !id(contract.id) || seen.has(contract.id)) continue;
      seen.add(contract.id);
      const building = buildings.get(contract.buildingId), customer = customers.get(contract.customerId);
      if (!building || !customer) { unlinked++; continue; }
      const road = text(building.roadAddress), parcel = text(building.jibunAddress), generic = text(building.address);
      if (!groups.has(building.id)) groups.set(building.id, { id: building.id, name: text(building.name) || '이름 없는 건물', address: road || parcel || generic, parcelAddress: parcel, addressType: road ? 'ROAD' : parcel ? 'PARCEL' : /(?:로|길)\s*[\d-]+/.test(generic) ? 'ROAD' : 'PARCEL', contracts: [], customerIds: [], customerNames: [], status: 'unknown', nextDate: '' });
      const row = groups.get(building.id), state = status(contract);
      row.contracts.push({ id: contract.id, name: text(contract.name) || '계약명 미입력', customerId: customer.id, status: text(contract.status), startDate: text(contract.startDate), endDate: text(contract.endDate) });
      if (!row.customerIds.includes(customer.id)) { row.customerIds.push(customer.id); row.customerNames.push(text(customer.name) || text(customer.company) || '고객명 미입력'); }
      if (states[state].rank < states[row.status].rank) row.status = state;
      if (state === 'active') activeContracts.push(contract);
    }
    if (Schedule.isDate(today)) {
      const start = new Date(today.slice(0, 7) + '-01T00:00:00Z');
      const months = Array.from({length: 12}, (_, offset) => { const date = new Date(start); date.setUTCMonth(start.getUTCMonth() + offset); return date.toISOString().slice(0, 7); });
      const end = new Date(start); end.setUTCMonth(start.getUTCMonth() + 12);
      const limit = end.toISOString().slice(0, 10);
      const eligible = record => live(record) && !['completed', 'done', '완료'].includes(record.status) && Schedule.isDate(record.scheduledDate) && record.scheduledDate >= today && record.scheduledDate < limit;
      const consider = record => { const row = groups.get(record.buildingId); if (row?.status === 'active' && eligible(record) && (!row.nextDate || record.scheduledDate < row.nextDate)) row.nextDate = record.scheduledDate; };
      for (const record of list(store?.serviceRecords)) consider(record);
      const projectionStore = { contracts: activeContracts, serviceRecords: list(store?.serviceRecords) };
      for (const month of months) for (const occurrence of Schedule.contractWorkOccurrences(projectionStore, month)) {
        // Weekly schedules are bounded to four dates, and may cross months.
        if (occurrence.scheduledDate.startsWith(month)) consider(occurrence);
      }
    }
    const rows = [...groups.values()].sort((a, b) => states[a.status].rank - states[b.status].rank || a.name.localeCompare(b.name, 'ko'));
    return { rows, unlinked, counts: Object.fromEntries(Object.keys(states).map(state => [state, rows.filter(row => row.status === state).length])) };
  }
  function point(lon, lat, zoom = 13) {
    const x = Number(lon), y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 122 || x > 134 || y < 30 || y > 41 || !Number.isInteger(zoom) || zoom < 6 || zoom > 19) return null;
    const size = 256 * 2 ** zoom, radians = y * Math.PI / 180;
    return { x: (x + 180) / 360 * size, y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * size };
  }
  return Object.freeze({ states, project, point, validId: id });
});
