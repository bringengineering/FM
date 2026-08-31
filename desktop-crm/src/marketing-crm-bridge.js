(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.BringCore;
  const marketingCore = typeof module === 'object' && module.exports ? require('./marketing-core.js') : root.MarketingCore;
  const api = factory(core, marketingCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketingCrmBridge = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, MarketingCore) {
  'use strict';

  const done = (record, step) => record && record.status && record.status[`c${step}`] === 'done';
  const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  const id = value => String(value == null ? '' : value).trim().slice(0, 120);
  const text = (value, limit) => String(value == null ? '' : value).trim().slice(0, limit || 200);
  const values = value => value && typeof value === 'object' ? Object.values(value).filter(Boolean) : [];
  const has = (record, field) => Object.prototype.hasOwnProperty.call(record || {}, field);

  function safeMoney(value, field) {
    if (value == null || value === '') return 0;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(number)) throw new TypeError(`${field} must be a nonnegative safe integer`);
    return number;
  }

  function addMoney(records, fields, label) {
    return records.reduce((total, record) => {
      const field = fields.find(name => has(record, name));
      return MarketingCore.checkedIntegerAdd(total, field ? safeMoney(record[field], field) : 0, label);
    }, 0);
  }

  function normalizeMarketing(value) {
    return Core.normalizeMarketingAttribution ? Core.normalizeMarketingAttribution(value) : Object.assign({}, value || {});
  }

  function dateOf(record, marketing) {
    return text(marketing.inquiryAt || record.receivedAt || record.createdAt || record.updatedAt).slice(0, 10);
  }

  function explicitCaseContracts(store, workflowCase, customerId, allowCustomerLink) {
    const caseId = id(workflowCase.id || workflowCase.firebaseKey);
    return list(store.contracts).filter(contract => {
      const linkedCase = id(contract.workflowCaseId || contract.caseId);
      if (linkedCase) return linkedCase === caseId;
      return allowCustomerLink && !linkedCase && customerId && id(contract.customerId) === customerId;
    });
  }

  function caseActivities(store, workflowCase, customerId, allowCustomerLink) {
    const caseId = id(workflowCase.id || workflowCase.firebaseKey);
    return list(store.activities).filter(activity => {
      const linkedCase = id(activity.workflowCaseId || activity.caseId);
      return linkedCase ? linkedCase === caseId : Boolean(allowCustomerLink && customerId && id(activity.customerId) === customerId);
    });
  }

  function contractState(contracts) {
    const states = contracts.map(contract => text(contract.contractStatus || contract.status).toLowerCase());
    if (states.some(state => ['invalid', '무효'].includes(state))) return 'invalid';
    if (states.some(state => ['cancelled', 'canceled', '취소'].includes(state))) return 'cancelled';
    return states.length ? 'active' : '';
  }

  function makeFact(store, workflowCase, customer, sourceType, allowCustomerLink) {
    const marketing = normalizeMarketing((workflowCase && workflowCase.marketing) || (customer && customer.marketing));
    const customerId = id(workflowCase && workflowCase.crmCustomerId || customer && customer.id);
    const caseId = sourceType === 'case' ? id(workflowCase.firebaseKey || workflowCase.id) : '';
    const contracts = sourceType === 'case' ? explicitCaseContracts(store, workflowCase, customerId, allowCustomerLink) : [];
    const activities = sourceType === 'case' ? caseActivities(store, workflowCase, customerId, allowCustomerLink) : [];
    const quoteRows = values(workflowCase && workflowCase.quoteFiles);
    const hasConsultation = done(workflowCase, 3) || activities.some(activity => activity.context === 'consultation');
    const hasQuote = done(workflowCase, 6) || quoteRows.length > 0 || safeMoney(workflowCase && workflowCase.quoteAmount, 'quoteAmount') > 0;
    const hasContract = done(workflowCase, 9) || contracts.some(contract => ['진행 중', '종료 예정', '종료', 'active', 'cancelled', 'canceled', 'invalid', '취소', '무효'].includes(contract.status || contract.contractStatus));
    const hasPayment = done(workflowCase, 15) || workflowCase && workflowCase.paymentStatus === 'confirmed' || contracts.some(contract => contract.collectionStatus === '입금 완료' || safeMoney(contract.paidAmount, 'paidAmount') > 0);
    const validLead = marketing.validLead === true ? 1 : 0;
    const explicitNew = contracts.some(contract => ['new', '신규'].includes(contract.contractKind || contract.customerStatus || contract.newRepeatStatus));
    const explicitRepeat = contracts.some(contract => ['repeat', '재계약', '반복'].includes(contract.contractKind || contract.customerStatus || contract.newRepeatStatus));
    const channel = MarketingCore.CHANNELS.includes(marketing.firstSource) ? marketing.firstSource : 'needs_review';
    const lastSource = MarketingCore.CHANNELS.includes(marketing.lastSource) ? marketing.lastSource : 'needs_review';
    const fact = {
      sourceType, customerId, caseId, salesId: id(workflowCase && (workflowCase.salesId || workflowCase.salesOpportunityId)),
      contractIds: contracts.map(contract => id(contract.id)).filter(Boolean), occurredAt: dateOf(workflowCase || customer || {}, marketing),
      inquiryAt: text(marketing.inquiryAt || workflowCase && (workflowCase.receivedAt || workflowCase.createdAt) || customer && customer.createdAt),
      date: dateOf(workflowCase || customer || {}, marketing), channel, lastSource,
      service: MarketingCore.SERVICES.includes(workflowCase && workflowCase.service || marketing.service) ? (workflowCase && workflowCase.service || marketing.service) : 'needs_review',
      region: text(workflowCase && workflowCase.region || customer && customer.region), owner: text(workflowCase && workflowCase.owner || customer && customer.owner),
      customerType: text(customer && (customer.customerType || customer.type)), campaign: text(marketing.campaignName || marketing.campaignId), keyword: text(marketing.keyword),
      customerStatus: text(customer && customer.stage), dataStatus: channel === 'needs_review' || lastSource === 'needs_review' || marketing.validLead == null ? 'needs_review' : 'verified',
      inquiries: 1, validLeads: validLead, consultations: hasConsultation ? 1 : 0, quotes: hasQuote ? 1 : 0, contracts: hasContract ? 1 : 0,
      payments: hasPayment ? 1 : 0, quoteAmount: addMoney(quoteRows, ['amount', 'confirmedAmount', 'totalAmount'], 'quoteAmount') || safeMoney(workflowCase && workflowCase.quoteAmount, 'quoteAmount'),
      contractAmount: addMoney(contracts, ['amount', 'contractAmount'], 'contractAmount'), paidAmount: addMoney(contracts, ['paidAmount'], 'paidAmount') || safeMoney(workflowCase && workflowCase.paymentConfirmedAmount, 'paidAmount'),
      expectedCost: addMoney(contracts, ['vendorCost', 'expectedCost'], 'expectedCost'), lostReason: text(workflowCase && workflowCase.lostReason || customer && customer.lostReason),
      contractStatus: contractState(contracts), workStage: [11, 12, 13, 14].some(step => done(workflowCase, step)), aftercare: done(workflowCase, 17)
    };
    if (explicitNew) fact.newContracts = hasContract ? 1 : 0;
    else if (explicitRepeat) fact.newContracts = 0;
    return fact;
  }

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
    return value;
  }

  function projectFacts(inputStore, options) {
    const store = inputStore && typeof inputStore === 'object' ? inputStore : {};
    const cases = list(options && options.cases).filter(record => !record.deleted && !record.archived);
    const customers = list(store.customers);
    const byId = new Map(customers.map(customer => [id(customer.id), customer]).filter(entry => entry[0]));
    const customerIdsWithCase = new Set(cases.map(record => id(record.crmCustomerId)).filter(Boolean));
    const caseCountByCustomer = cases.reduce((counts, record) => {
      const customerId = id(record.crmCustomerId);
      if (customerId) counts.set(customerId, (counts.get(customerId) || 0) + 1);
      return counts;
    }, new Map());
    const facts = cases.map(record => {
      const customerId = id(record.crmCustomerId);
      return makeFact(store, record, byId.get(customerId) || null, 'case', caseCountByCustomer.get(customerId) === 1);
    });
    customers.forEach(customer => { if (!customerIdsWithCase.has(id(customer.id))) facts.push(makeFact(store, customer, customer, 'customer_fallback')); });
    return freeze(facts);
  }

  return Object.freeze({ projectFacts });
}));
