'use strict';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createCleaningOrderIpcHandlers({ getRemoteClient, isLocalTestMode }) {
  if (typeof getRemoteClient !== 'function' || typeof isLocalTestMode !== 'function') {
    throw new TypeError('Cleaning Order IPC dependencies are required.');
  }

  function remoteMethod(name, errorMessage) {
    const client = getRemoteClient();
    if (!client || typeof client[name] !== 'function') throw new Error(errorMessage);
    return client[name].bind(client);
  }

  return Object.freeze({
    load(cursor) {
      if (isLocalTestMode()) return { orders: [], hasMore: false, nextCursor: null, localOnly: true };
      return remoteMethod('loadCleaningOrders', '로그인 후 청소 주문을 확인해 주세요.')(cursor);
    },
    loadById(orderId) {
      if (typeof orderId !== 'string' || !UUID.test(orderId)) throw new Error('주문 ID를 확인해 주세요.');
      if (isLocalTestMode()) return { order: null, localOnly: true };
      return remoteMethod('loadCleaningOrderById', '로그인 후 청소 요청을 확인해 주세요.')(orderId);
    },
    create(input) {
      if (!isRecord(input)) throw new Error('주문 입력을 확인해 주세요.');
      if (isLocalTestMode()) throw new Error('로컬 미리보기에서는 회사 주문을 등록할 수 없습니다.');
      return remoteMethod('createCleaningOrder', '로그인 후 청소 주문을 등록해 주세요.')(input);
    },
    transition(input) {
      if (!isRecord(input)) throw new Error('상태 변경 내용을 확인해 주세요.');
      if (isLocalTestMode()) throw new Error('로컬 미리보기에서는 회사 주문을 변경할 수 없습니다.');
      return remoteMethod('transitionCleaningOrder', '로그인 후 청소 주문을 변경해 주세요.')(input);
    },
    loadQuotes(orderId) {
      if (typeof orderId !== 'string' || !UUID.test(orderId)) throw new Error('주문 ID를 확인해 주세요.');
      if (isLocalTestMode()) return { revisions: [], localOnly: true };
      return remoteMethod('loadCleaningQuoteSet', '로그인 후 연결된 견적을 확인해 주세요.')(orderId);
    },
    createQuoteRevision(input) {
      if (!isRecord(input) || !UUID.test(String(input.orderId || '')) || !UUID.test(String(input.requestId || ''))) throw new Error('견적 입력과 주문 ID를 확인해 주세요.');
      if (isLocalTestMode()) throw new Error('로컬 미리보기에서는 회사 견적을 저장할 수 없습니다.');
      return remoteMethod('createCleaningQuoteRevision', '로그인 후 견적을 저장해 주세요.')(input);
    },
    reviewQuote(input) {
      if (!isRecord(input) || !UUID.test(String(input.orderId || '')) || !UUID.test(String(input.quoteId || '')) || !UUID.test(String(input.requestId || ''))) throw new Error('견적 검수 입력을 확인해 주세요.');
      if (isLocalTestMode()) throw new Error('로컬 미리보기에서는 회사 견적을 검수할 수 없습니다.');
      return remoteMethod('reviewCleaningQuote', '관리자 계정으로 로그인해 주세요.')(input);
    },
  });
}

module.exports = { createCleaningOrderIpcHandlers };
