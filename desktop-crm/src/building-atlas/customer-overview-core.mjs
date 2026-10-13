// Read-only customer projection. No reminder rules, inferred links, or mutations.
const value = input => String(input ?? '').trim();
const statusKey = input => value(input).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const closed = new Set(['종료','계약종료','해지','취소','보관','closed','ended','terminated','cancelled','canceled','archived']);
const finished = new Set([...closed, '완료','작업완료','처리완료','완료됨','completed','complete','done']);
const activeContract = new Set(['진행중','종료예정','관리중','계약확정','active','in_progress','confirmed','signed','paid_management']);
const leadStage = new Set(['문의','상담','상담중','견적','견적중','견적전달','견적발송','검토중','계약준비']);
const records = input => (Array.isArray(input) ? input : []).filter(item => item && !item.archivedAt && !item.deletedAt && item.archived !== true && item.deleted !== true);
const unique = input => [...new Map(input.filter(item => value(item.id)).map(item => [value(item.id), item])).values()];

export function belongsToCustomer(record, customer) {
  const customerId = value(record?.customerId);
  const buildingId = value(record?.crmBuildingId || record?.buildingId);
  const buildingIds = new Set((customer?.buildings || []).map(building => value(building.id)).filter(Boolean));
  if (customerId && customerId !== value(customer?.id)) return false;
  if (buildingId && !buildingIds.has(buildingId)) return false;
  return Boolean(customerId && customerId === value(customer?.id) || buildingId && buildingIds.has(buildingId));
}

function workKey(item, type) {
  if (item.serviceRecordId) return `service:${value(item.serviceRecordId)}`;
  if (item.workOrderId) return `order:${value(item.workOrderId)}`;
  return `${type}:${value(item.id)}`;
}

export function buildCustomerOverview({customers=[], contracts=[], activities=[], tasks=[], serviceRecords=[], workOrders=[], cases=[]}={}) {
  const liveCustomers = unique(records(customers));
  const liveContracts = unique(records(contracts)).filter(item => activeContract.has(statusKey(item.status)));
  const liveActivities = unique(records(activities));
  const workSources = [
    ['task', records(tasks)], ['service', records(serviceRecords)],
    ['order', records(workOrders)], ['case', records(cases)],
  ];
  const contractIds = new Set(), workIds = new Set();
  const rows = liveCustomers.map(customer => {
    const linkedContracts = liveContracts.filter(record => belongsToCustomer(record, customer));
    linkedContracts.forEach(item => contractIds.add(value(item.id)));
    const work = new Map();
    for (const [type, source] of workSources) for (const record of unique(source)) {
      if (!belongsToCustomer(record, customer) || record.done === true || record.completed === true || record.complete === true
        || finished.has(statusKey(record.status)) || (type === 'order' && Number(record.progress) >= 100)) continue;
      const key = workKey(record, type);
      if (work.has(key)) continue;
      work.set(key, {id:value(record.id), type, title:value(record.title || record.issueType || record.summary) || '업무 내용 미입력'});
      workIds.add(key);
    }
    const consultations = liveActivities.filter(record => belongsToCustomer(record, customer))
      .sort((left, right) => value(right.occurredAt || right.createdAt).localeCompare(value(left.occurredAt || left.createdAt)));
    const latest = consultations[0];
    const status = value(customer.managementStatus || customer.status) || '관리 예정';
    const prospect = !linkedContracts.length && statusKey(status)!=='관리종료' && (leadStage.has(statusKey(customer.stage))
      || ['관리예정','상담중','견적중','상담','견적','계약준비'].includes(statusKey(status)));
    return {
      id:value(customer.id), name:value(customer.name) || '고객명 미입력',
      phone:value(customer.phone), owner:value(customer.owner) || '담당자 미배정',
      buildings:records(customer.buildings).map(building => ({id:value(building.id), name:value(building.name) || '건물명 미입력', address:value(building.address || building.roadAddress)})),
      status, contractCount:linkedContracts.length, workCount:work.size, works:[...work.values()], prospect,
      request:value(customer.currentIssue || latest?.summary) || '등록된 요청 없음',
      nextAction:value(customer.nextAction || latest?.nextAction),
      consultationCount:consultations.length,
      lastConsultation:value(latest?.occurredAt || latest?.createdAt),
      lastUpdated:value(customer.updatedAt || customer.createdAt),
    };
  });
  return {rows, totals:{contracts:contractIds.size, work:workIds.size, prospects:rows.filter(row => row.prospect).length, customers:rows.length}};
}

export function filterCustomerOverview(rows, {filter='all', sort='recent', visibleIds=null}={}) {
  const visible = visibleIds ? new Set(visibleIds.map(value)) : null;
  return rows.filter(row => (!visible || visible.has(row.id)) && (filter==='all'
    || filter==='contracts' && row.contractCount>0 || filter==='work' && row.workCount>0 || filter==='prospects' && row.prospect))
    .sort((left, right) => sort==='name' ? left.name.localeCompare(right.name, 'ko')
      : sort==='status' ? left.status.localeCompare(right.status, 'ko')
      : (right.lastConsultation || right.lastUpdated).localeCompare(left.lastConsultation || left.lastUpdated));
}
