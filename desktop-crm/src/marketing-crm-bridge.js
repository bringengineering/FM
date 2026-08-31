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
  const caseKey = record => id(record && (record.firebaseKey || record.id));

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

  function normalizeCaseMarketing(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? Object.assign({}, value) : {};
    record.marketing = normalizeMarketing(record.marketing);
    return record;
  }

  function dateOf(record, marketing) {
    return text(marketing.inquiryAt || record.receivedAt || record.createdAt || record.updatedAt).slice(0, 10);
  }

  function explicitCaseContracts(store, workflowCase, customerId, allowCustomerLink) {
    const caseId = caseKey(workflowCase);
    return list(store.contracts).filter(contract => {
      const linkedCase = id(contract.workflowCaseId || contract.caseId);
      if (linkedCase) return linkedCase === caseId;
      return allowCustomerLink && !linkedCase && customerId && id(contract.customerId) === customerId;
    });
  }

  function caseActivities(store, workflowCase, customerId, allowCustomerLink) {
    const caseId = caseKey(workflowCase);
    return list(store.activities).filter(activity => {
      const linkedCase = id(activity.workflowCaseId || activity.caseId);
      return linkedCase ? linkedCase === caseId : Boolean(allowCustomerLink && customerId && id(activity.customerId) === customerId);
    });
  }

  function activeContract(contract) {
    return ['진행 중', '종료 예정', '종료', 'active', 'confirmed'].includes(contract.status || contract.contractStatus);
  }

  function cancelledContract(contract) { return ['cancelled', 'canceled', '취소'].includes(text(contract.contractStatus || contract.status).toLowerCase()); }
  function invalidContract(contract) { return ['invalid', '무효'].includes(text(contract.contractStatus || contract.status).toLowerCase()); }
  function actualIncurredCost(contracts) {
    return contracts.reduce((total, contract) => MarketingCore.checkedIntegerAdd(total, contract.vendorPaymentStatus === '지급 완료' ? safeMoney(contract.vendorCost, 'vendorCost') : 0, 'actualIncurredCost'), 0);
  }

  function quoteMoney(quote) {
    const field = ['bringQuoteTotalAmount', 'confirmedTotalAmount', 'totalAmount', 'total', 'amount'].find(name => has(quote, name));
    return field ? safeMoney(quote[field], field) : 0;
  }

  function hasSettlementEvidence(workflowCase) {
    const settlement = workflowCase && (workflowCase.settlement || workflowCase.settlementEvidence) || {};
    return Boolean(text(settlement.status) || settlement.settledAt || settlement.date || values(workflowCase && workflowCase.evidenceFiles || settlement.files).length);
  }

  function makeFact(store, workflowCase, customer, sourceType, allowCustomerLink) {
    const caseMarketing = workflowCase && workflowCase.marketing;
    const marketing = normalizeMarketing(caseMarketing && Object.keys(caseMarketing).length ? caseMarketing : customer && customer.marketing);
    const customerId = id(workflowCase && workflowCase.crmCustomerId || customer && customer.id);
    const caseId = sourceType === 'case' ? caseKey(workflowCase) : '';
    const contracts = sourceType === 'case' ? explicitCaseContracts(store, workflowCase, customerId, allowCustomerLink) : [];
    const activeContracts = contracts.filter(activeContract);
    const cancelledContracts = contracts.filter(cancelledContract);
    const invalidContracts = contracts.filter(invalidContract);
    const nonActiveFinalContracts = cancelledContracts.concat(invalidContracts);
    const activities = sourceType === 'case' ? caseActivities(store, workflowCase, customerId, allowCustomerLink) : [];
    const quoteRows = values(workflowCase && workflowCase.quoteFiles);
    const hasConsultation = done(workflowCase, 3) || activities.some(activity => activity.context === 'consultation');
    const hasQuote = done(workflowCase, 6) || quoteRows.length > 0 || safeMoney(workflowCase && workflowCase.quoteAmount, 'quoteAmount') > 0;
    const caseOnlyContractEvidence = contracts.length === 0 && done(workflowCase, 9);
    const hasContract = activeContracts.length > 0 || caseOnlyContractEvidence;
    const hasPayment = done(workflowCase, 15) || workflowCase && workflowCase.paymentStatus === 'confirmed' || hasSettlementEvidence(workflowCase) || activeContracts.concat(nonActiveFinalContracts).some(contract => contract.collectionStatus === '입금 완료' || safeMoney(contract.paidAmount, 'paidAmount') > 0);
    const validLead = marketing.validLead === true ? 1 : 0;
    const explicitNew = activeContracts.some(contract => ['new', '신규'].includes(contract.contractKind || contract.customerStatus || contract.newRepeatStatus));
    const explicitRepeat = activeContracts.some(contract => ['repeat', '재계약', '반복'].includes(contract.contractKind || contract.customerStatus || contract.newRepeatStatus));
    const channel = MarketingCore.CHANNELS.includes(marketing.firstSource) ? marketing.firstSource : 'needs_review';
    const lastSource = MarketingCore.CHANNELS.includes(marketing.lastSource) ? marketing.lastSource : 'needs_review';
    const fact = {
      sourceType, customerId, caseId, salesId: id(workflowCase && (workflowCase.salesId || workflowCase.salesOpportunityId)),
      contractIds: contracts.map(contract => id(contract.id)).filter(Boolean), occurredAt: dateOf(workflowCase || customer || {}, marketing),
      inquiryAt: text(marketing.inquiryAt || workflowCase && (workflowCase.receivedAt || workflowCase.createdAt) || customer && customer.createdAt),
      date: dateOf(workflowCase || customer || {}, marketing), channel, firstSource: channel, lastSource,
      subChannel: text(marketing.subChannel), campaignId: text(marketing.campaignId), campaignName: text(marketing.campaignName),
      contentId: text(marketing.contentId), contentTitle: text(marketing.contentTitle), inquiryMethod: text(marketing.inquiryMethod),
      firstTouchAt: text(marketing.firstTouchAt), invalidReason: text(marketing.invalidReason), attributionNote: text(marketing.attributionNote, 1000),
      service: MarketingCore.SERVICES.includes(workflowCase && workflowCase.service || marketing.service) ? (workflowCase && workflowCase.service || marketing.service) : 'needs_review',
      region: text(workflowCase && workflowCase.region || customer && customer.region), owner: text(workflowCase && workflowCase.owner || customer && customer.owner),
      customerType: text(customer && (customer.customerType || customer.type)), campaign: text(marketing.campaignName || marketing.campaignId), keyword: text(marketing.keyword),
      customerStatus: text(customer && customer.stage), dataStatus: channel === 'needs_review' || lastSource === 'needs_review' || marketing.validLead == null ? 'needs_review' : 'verified',
      inquiries: 1, validLeads: validLead, consultations: hasConsultation ? 1 : 0, quotes: hasQuote ? 1 : 0, contracts: hasContract ? 1 : 0,
      payments: hasPayment ? 1 : 0, quoteAmount: quoteRows.reduce((sum, quote) => MarketingCore.checkedIntegerAdd(sum, quoteMoney(quote), 'quoteAmount'), 0) || safeMoney(workflowCase && workflowCase.quoteAmount, 'quoteAmount'),
      contractAmount: hasContract ? addMoney(activeContracts, ['amount', 'contractAmount'], 'contractAmount') : 0,
      paidAmount: MarketingCore.checkedIntegerAdd(addMoney(activeContracts, ['paidAmount'], 'paidAmount'), addMoney(nonActiveFinalContracts, ['paidAmount'], 'paidAmount'), 'paidAmount') || (workflowCase && workflowCase.paymentStatus === 'confirmed' ? safeMoney(workflowCase.paymentConfirmedAmount || workflowCase.paymentExpectedAmount, 'paidAmount') : 0),
      expectedCost: MarketingCore.checkedIntegerAdd(hasContract ? addMoney(activeContracts, ['vendorCost', 'expectedCost'], 'expectedCost') : 0, actualIncurredCost(nonActiveFinalContracts), 'expectedCost'), lostReason: text(workflowCase && workflowCase.lostReason || customer && customer.lostReason),
      contractStatus: activeContracts.length || caseOnlyContractEvidence ? 'active' : cancelledContracts.length ? 'cancelled' : invalidContracts.length ? 'invalid' : '', workStage: [11, 12, 13, 14].some(step => done(workflowCase, step)), aftercare: done(workflowCase, 17)
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
    const cases = list(options && options.cases).map(normalizeCaseMarketing).filter(record => !record.deleted && !record.archived);
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

  return Object.freeze({ caseKey, normalizeCaseMarketing, projectFacts });
}));
