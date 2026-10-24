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
  const ISSUE_TYPE_SERVICES = Object.freeze({
    '토목': 'civil_engineering', '건축': 'architecture', '측량': 'surveying', '설계': 'design',
    '시설 점검': 'inspection', '시설점검': 'inspection', '누수': 'inspection', '전기·조명': 'inspection',
    '고객 상담': 'consulting', '상담': 'consulting', '청소': 'other'
  });

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

  function explicitCaseContracts(store, workflowCase, customerId, allowCustomerLink, acceptCaseLink) {
    const caseId = caseKey(workflowCase);
    return list(store.contracts).filter(contract => {
      const linkedCase = id(contract.workflowCaseId || contract.caseId);
      if (linkedCase) return acceptCaseLink && linkedCase === caseId;
      return allowCustomerLink && !linkedCase && customerId && id(contract.customerId) === customerId;
    });
  }

  function caseActivities(store, workflowCase, customerId, allowCustomerLink, acceptCaseLink) {
    const caseId = caseKey(workflowCase);
    return list(store.activities).filter(activity => {
      const linkedCase = id(activity.workflowCaseId || activity.caseId);
      return linkedCase ? Boolean(acceptCaseLink && linkedCase === caseId) : Boolean(allowCustomerLink && customerId && id(activity.customerId) === customerId);
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
    const field = ['confirmedTotalAmount', 'bringQuoteTotalAmount', 'quoteAmount', 'estimateAmount', 'totalAmount', 'total', 'amount'].find(name => has(quote, name));
    return field ? safeMoney(quote[field], field) : 0;
  }

  function authoritativeQuoteAmount(workflowCase, quoteRows) {
    for (const field of ['confirmedTotalAmount', 'bringQuoteTotalAmount', 'quoteAmount', 'estimateAmount']) {
      if (has(workflowCase, field)) {
        const amount = safeMoney(workflowCase[field], field);
        if (amount > 0) return amount;
      }
    }
    const selectedId = id(workflowCase && (workflowCase.selectedQuoteId || workflowCase.recommendedQuoteId || workflowCase.confirmedQuoteId || workflowCase.recommendation && workflowCase.recommendation.quoteId));
    if (selectedId) {
      const selected = quoteRows.find(quote => id(quote.storedId || quote.id) === selectedId);
      return selected ? quoteMoney(selected) : 0;
    }
    const marked = quoteRows.filter(quote => quote.selected === true || quote.recommended === true || quote.confirmed === true);
    if (marked.length === 1) return quoteMoney(marked[0]);
    return quoteRows.length === 1 ? quoteMoney(quoteRows[0]) : 0;
  }

  function actualPaidAmount(contracts) {
    return contracts.reduce((total, contract) => {
      const amount = has(contract, 'paidAmount') ? safeMoney(contract.paidAmount, 'paidAmount') : contract.collectionStatus === '입금 완료' ? safeMoney(contract.amount, 'amount') : 0;
      return MarketingCore.checkedIntegerAdd(total, amount, 'paidAmount');
    }, 0);
  }

  function hasSettlementEvidence(workflowCase) {
    const settlement = workflowCase && (workflowCase.settlement || workflowCase.settlementEvidence) || {};
    return Boolean(text(settlement.status) || settlement.settledAt || settlement.date || values(workflowCase && workflowCase.evidenceFiles || settlement.files).length);
  }

  function recordTime(record, fields) {
    for (const field of fields) if (text(record && record[field])) return text(record[field]);
    return '';
  }
  function newestRecord(records, fields) {
    return records.slice().sort((left,right) => {
      const leftTime=recordTime(left,fields), rightTime=recordTime(right,fields);
      const leftMs=Date.parse(leftTime), rightMs=Date.parse(rightTime);
      const timeOrder=(Number.isFinite(rightMs)?rightMs:-Infinity)-(Number.isFinite(leftMs)?leftMs:-Infinity);
      return timeOrder || id(left.storedId||left.id).localeCompare(id(right.storedId||right.id));
    })[0] || null;
  }

  function makeFact(store, workflowCase, customer, sourceType, allowCustomerLink) {
    const caseMarketing = workflowCase && workflowCase.marketing;
    const marketing = normalizeMarketing(caseMarketing && Object.keys(caseMarketing).length ? caseMarketing : customer && customer.marketing);
    const customerId = id(workflowCase && workflowCase.crmCustomerId || customer && customer.id);
    const caseId = sourceType === 'case' ? caseKey(workflowCase) : '';
    const contracts = sourceType === 'case' || sourceType === 'customer_fallback' ? explicitCaseContracts(store, workflowCase, customerId, allowCustomerLink, sourceType === 'case') : [];
    const activeContracts = contracts.filter(activeContract);
    const reviewContracts = contracts.filter(contract => ['계약 준비', 'needs_review', 'review', 'pending'].includes(text(contract.status || contract.contractStatus)));
    const currentReviewContract = newestRecord(reviewContracts, ['reviewAt','updatedAt','createdAt']);
    const cancelledContracts = contracts.filter(cancelledContract);
    const invalidContracts = contracts.filter(invalidContract);
    const nonActiveFinalContracts = cancelledContracts.concat(invalidContracts);
    const activities = sourceType === 'case' || sourceType === 'customer_fallback' ? caseActivities(store, workflowCase, customerId, allowCustomerLink, sourceType === 'case') : [];
    const quoteRows = workflowCase && workflowCase.quoteFiles && typeof workflowCase.quoteFiles === 'object' ? Object.entries(workflowCase.quoteFiles).map(([storedId, quote]) => Object.assign({ storedId }, quote || {})) : [];
    const hasConsultation = done(workflowCase, 3) || activities.some(activity => activity.context === 'consultation');
    const hasQuote = done(workflowCase, 6) || quoteRows.length > 0 || safeMoney(workflowCase && workflowCase.quoteAmount, 'quoteAmount') > 0;
    const selectedQuoteId = id(workflowCase && (workflowCase.selectedQuoteId || workflowCase.recommendedQuoteId || workflowCase.confirmedQuoteId || workflowCase.recommendation && workflowCase.recommendation.quoteId));
    const currentQuoteCandidates = selectedQuoteId ? quoteRows.filter(quote=>id(quote.storedId||quote.id)===selectedQuoteId) : quoteRows.filter(quote=>quote.selected===true||quote.recommended===true||quote.confirmed===true);
    const currentQuote = newestRecord(currentQuoteCandidates.length?currentQuoteCandidates:quoteRows, ['sentAt','uploadedAt','createdAt','updatedAt']);
    const quoteSentAt = currentQuote ? recordTime(currentQuote,['sentAt','uploadedAt','createdAt','updatedAt']) : text(workflowCase && (workflowCase.quoteSentAt || workflowCase.quotedAt));
    const consultationAt = recordTime(newestRecord(activities.filter(activity=>activity.context==='consultation'),['occurredAt','consultedAt','contactedAt','createdAt','updatedAt']),['occurredAt','consultedAt','contactedAt','createdAt','updatedAt']);
    const directContactAt = [workflowCase&&workflowCase.lastContactAt,workflowCase&&workflowCase.contactedAt,workflowCase&&workflowCase.consultedAt,consultationAt].filter(Boolean).sort((a,b)=>(Date.parse(b)||0)-(Date.parse(a)||0))[0] || '';
    const respondedAt = [workflowCase&&workflowCase.respondedAt,workflowCase&&workflowCase.responseAt].filter(Boolean).sort((a,b)=>(Date.parse(b)||0)-(Date.parse(a)||0))[0] || '';
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
      service: ISSUE_TYPE_SERVICES[text(workflowCase && workflowCase.issueType)] || (MarketingCore.SERVICES.includes(workflowCase && workflowCase.service || marketing.service) ? (workflowCase && workflowCase.service || marketing.service) : 'needs_review'),
      region: text(workflowCase && workflowCase.region || customer && customer.region), owner: text(workflowCase && workflowCase.owner || customer && customer.owner),
      customerType: text(customer && (customer.customerType || customer.type)), campaign: text(marketing.campaignName || marketing.campaignId), keyword: text(marketing.keyword),
      customerStatus: ['보류·거절','보류','거절','실패','lost','rejected','closed'].includes(text(customer && customer.stage).toLowerCase()) ? 'lost' : text(customer && customer.stage), dataStatus: channel === 'needs_review' || lastSource === 'needs_review' || marketing.validLead == null ? 'needs_review' : 'verified',
      inquiries: 1, validLeads: validLead, consultations: hasConsultation ? 1 : 0, quotes: hasQuote ? 1 : 0, contracts: hasContract ? 1 : 0,
      payments: hasPayment ? 1 : 0, quoteAmount: authoritativeQuoteAmount(workflowCase, quoteRows),
      contractAmount: hasContract ? addMoney(activeContracts, ['amount', 'contractAmount'], 'contractAmount') : 0,
      paidAmount: MarketingCore.checkedIntegerAdd(actualPaidAmount(activeContracts), actualPaidAmount(nonActiveFinalContracts), 'paidAmount') || (workflowCase && workflowCase.paymentStatus === 'confirmed' ? safeMoney(workflowCase.paymentConfirmedAmount || workflowCase.paymentExpectedAmount, 'paidAmount') : 0),
      expectedCost: MarketingCore.checkedIntegerAdd(hasContract ? addMoney(activeContracts, ['vendorCost', 'expectedCost'], 'expectedCost') : 0, actualIncurredCost(nonActiveFinalContracts), 'expectedCost'), lostReason: text(workflowCase && (workflowCase.lostReason || workflowCase.failureReason || workflowCase.rejectReason || workflowCase.holdReason) || customer && (customer.lostReason || customer.failureReason || customer.rejectReason || customer.holdReason)),
      quoteId: currentQuote ? id(currentQuote.id || currentQuote.storedId) : '', quoteSentAt, lastContactAt:text(directContactAt), respondedAt:text(respondedAt), contractId: currentReviewContract ? id(currentReviewContract.id) : '',
      contractReviewAt: currentReviewContract ? recordTime(currentReviewContract,['reviewAt','updatedAt','createdAt']) : '',
      contractStatus: reviewContracts.length ? 'needs_review' : activeContracts.length || caseOnlyContractEvidence ? 'active' : cancelledContracts.length ? 'cancelled' : invalidContracts.length ? 'invalid' : '', workStage: [11, 12, 13, 14].some(step => done(workflowCase, step)), aftercare: done(workflowCase, 17)
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
    customers.forEach(customer => { if (!customerIdsWithCase.has(id(customer.id))) facts.push(makeFact(store, customer, customer, 'customer_fallback', true)); });
    return freeze(facts);
  }

  const REVISION_COLLECTIONS = Object.freeze(['customers', 'contracts', 'activities']);
  const REVISION_PRIVATE_KEY = /phone|private|secret|token|password|credential|photo|(^|_)note$/i;
  function revisionValue(value, depth) {
    if (depth > 6 || value == null) return value == null ? null : '';
    if (typeof value === 'string') return value.slice(0, 500);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 500).map(item => revisionValue(item, depth + 1));
    if (typeof value !== 'object') return '';
    return Object.fromEntries(Object.keys(value).filter(key => !REVISION_PRIVATE_KEY.test(key)).sort().slice(0, 500).map(key => [key, revisionValue(value[key], depth + 1)]));
  }
  function sourceRevision(inputStore, options) {
    const store = inputStore && typeof inputStore === 'object' ? inputStore : {};
    const source = Object.fromEntries(REVISION_COLLECTIONS.map(name => [name, list(store[name])]));
    source.cases = list(options && options.cases);
    return JSON.stringify(revisionValue(source, 0));
  }

  return Object.freeze({ caseKey, normalizeCaseMarketing, projectFacts, sourceRevision });
}));
