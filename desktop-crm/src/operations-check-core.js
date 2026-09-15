(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BringOperationsCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const text = value => String(value == null ? '' : value).trim();
  function rows(value) {
    if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).filter(([,item]) => item && typeof item === 'object')
      .map(([id,item]) => ({...item,id:text(item.id) || id}));
  }
  function validDate(value) {
    const date = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date;
  }
  function buildOperationsCheck(input, options) {
    const store = input || {};
    const config = options || {};
    const today = text(config.today);
    if (!validDate(today)) throw new Error('today must be a valid YYYY-MM-DD date');
    const available = config.availability || {};
    const can = name => available[name] === true;
    const buildings = can('buildings') ? rows(store.buildings) : [];
    const activeBuildings = new Map(buildings.filter(b => text(b.id) && !b.archivedAt).map(b => [text(b.id), b]));
    const allBuildings = new Map(buildings.filter(b => text(b.id)).map(b => [text(b.id), b]));
    const customers = new Set(can('customers') ? rows(store.customers).map(c => text(c.id)) : []);
    const contracts = can('contracts') ? rows(store.contracts) : [];
    const serviceContracts = can('serviceContracts') ? rows(store.serviceContracts) : [];
    const records = can('serviceRecords') ? rows(store.serviceRecords) : [];
    const issues = [];
    const managed = new Set();
    const cleaning = new Set();
    const held = new Set();
    const evidence = new Set();
    const contractIds = new Set([...contracts,...serviceContracts].map(c => text(c.id)).filter(Boolean));
    const add = (source, item, category, code, reason) => {
      const id = text(item.id);
      const buildingId = text(item.buildingId || item.crmBuildingId);
      const building = allBuildings.get(buildingId);
      issues.push({key:`${source}:${id}:${code}`,source,id,buildingId,
        buildingName:text(building && building.name),owner:text(item.owner || (building && building.manager)),
        title:text(item.title || item.name || (building && building.name)) || '이름 미입력',
        category,code,reason,detailTarget:{source,id,buildingId}});
    };
    function assessContract(item, source) {
      const service = source === 'serviceContracts';
      const status = text(item.status);
      if (['종료','취소','ended','cancelled','canceled','terminated'].includes(status)) return;
      const problems = [];
      if (!text(item.id)) problems.push('계약 식별자 확인 필요');
      const start = text(item.startDate), end = text(item.endDate);
      if (!validDate(start)) problems.push('시작일 확인 필요');
      if (end && !validDate(end)) problems.push('종료일 확인 필요');
      if (validDate(start) && validDate(end) && end < start) problems.push('계약 기간 순서 확인 필요');
      const validStatuses = service ? ['active','planned','ending'] : ['진행 중','종료 예정','계약 준비'];
      if (!validStatuses.includes(status)) problems.push('계약 상태 확인 필요');
      let types;
      if (service) {
        types = ({stair_cleaning:['청소'],cleaning:['청소'],grounds_cutting:['청소']})[text(item.serviceType)];
      } else {
        types = Array.isArray(item.types) && item.types.length ? item.types.map(text) : [text(item.type)];
      }
      if (!types || !types.length || types.some(type => !['청소','건물관리','부동산관리'].includes(type))) problems.push('계약 유형 확인 필요');
      const cycle = text(service ? item.cadence : item.billingCycle);
      const regular = service ? ['weekly','monthly','yearly','annual','daily','biweekly'].includes(cycle) : ['월 정기','연간'].includes(cycle);
      const oneOff = ['건별','단건 계약','one_off','once'].includes(cycle);
      if (!regular && !oneOff) problems.push('납부 방식·주기 확인 필요');
      const buildingId = text(item.buildingId);
      if (can('buildings') && !allBuildings.has(buildingId)) problems.push('연결 건물 확인 필요');
      if (problems.length) {
        held.add(`${source}:${text(item.id)}`);
        add(source,item,'contracts','held',problems.join(' · '));
        return;
      }
      if (!regular || !['진행 중','종료 예정','active','ending'].includes(status) || start > today || (end && end < today) || !activeBuildings.has(buildingId)) return;
      if (types.includes('건물관리') || types.includes('부동산관리')) managed.add(buildingId);
      if (types.includes('청소')) cleaning.add(buildingId);
    }
    contracts.forEach(c => assessContract(c,'contracts'));
    serviceContracts.forEach(c => assessContract(c,'serviceContracts'));
    for (const record of records) {
      const customerId = text(record.customerId), buildingId = text(record.buildingId);
      if (!customerId) {
        const owner = allBuildings.get(buildingId);
        const indirect = can('customers') && owner && customers.has(text(owner.ownerCustomerId));
        add('serviceRecords',record,'links','customer-missing',`고객 직접 연결 없음${indirect ? ' · 건물주 간접 연결 있음(발주 고객과 다를 수 있음)' : ''}`);
      } else if (can('customers') && !customers.has(customerId)) add('serviceRecords',record,'links','customer-unresolved','조회 범위에서 고객을 찾을 수 없습니다 · 연결 확인 필요');
      if (!text(record.contractId)) add('serviceRecords',record,'links','contract-missing','계약 연결 없음 — 단건이면 정상일 수 있음');
      else if (can('contracts') && can('serviceContracts') && !contractIds.has(text(record.contractId))) add('serviceRecords',record,'links','contract-unresolved','조회 범위에서 계약 연결 확인 필요');
      if (can('buildings') && !allBuildings.has(buildingId)) add('serviceRecords',record,'links','building-unresolved','조회 범위에서 건물 연결 확인 필요');
      const status = text(record.status);
      const done = ['completed','완료'].includes(status);
      const hasCompletedAt = Boolean(text(record.completedAt));
      if (hasCompletedAt && status && !done) add('serviceRecords',record,'status','completion-conflict','완료일과 작업 상태가 다릅니다 · 작업 상태 확인 필요');
      if (done || hasCompletedAt) {
        // Links are evidence references, not proof that remote files are accessible.
        const hasEvidence = Boolean(text(record.evidenceUrl) || text(record.driveFileId));
        if (!hasEvidence) {
          evidence.add(text(record.id));
          add('serviceRecords',record,'evidence','evidence-unconfirmed','증빙 연결 확인 필요 · 별도 보고서/사진은 상세 화면에서 확인');
        }
      }
    }
    const contractsReady = can('buildings') && can('contracts') && can('serviceContracts');
    return {
      metrics:{registeredBuildings:can('buildings') ? activeBuildings.size : null,
        managedBuildings:contractsReady ? managed.size : null,
        cleaningOnlyBuildings:contractsReady ? [...cleaning].filter(id => !managed.has(id)).length : null,
        evidenceTasks:can('serviceRecords') ? evidence.size : null,
        heldContracts:contractsReady ? held.size : null},
      issues,buildings:[...activeBuildings.values()].map(b => ({id:text(b.id),name:text(b.name),owner:text(b.manager || b.owner),managed:managed.has(text(b.id)),cleaningOnly:cleaning.has(text(b.id))&&!managed.has(text(b.id))})),
      sourceState:{...available},today
    };
  }
  // Explicit allowlist: no access codes, contact details, or unrelated raw fields.
  function projectOperationsSource(input) {
    const fields = {
      buildings:['id','name','archivedAt','manager','owner','ownerCustomerId'],
      customers:['id'],
      contracts:['id','name','title','buildingId','types','type','billingCycle','status','startDate','endDate','owner'],
      serviceContracts:['id','name','title','buildingId','serviceType','cadence','status','startDate','endDate','owner'],
      serviceRecords:['id','title','name','buildingId','customerId','contractId','status','completedAt','evidenceUrl','driveFileId','owner']
    };
    return Object.fromEntries(Object.entries(fields).map(([key,keys])=>[key,rows((input||{})[key]).map(row=>Object.fromEntries(keys.filter(k=>Object.prototype.hasOwnProperty.call(row,k)).map(k=>[k,JSON.parse(JSON.stringify(row[k]))])))]));
  }
  return {buildOperationsCheck,projectOperationsSource};
});
