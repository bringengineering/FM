'use strict';

function createOfficeAttachmentStageGate(options = {}) {
  const maxInFlight = Number.isInteger(options.maxInFlight) && options.maxInFlight > 0 ? options.maxInFlight : 2;
  const maxTotal = Number.isInteger(options.maxTotal) && options.maxTotal >= maxInFlight ? options.maxTotal : 8;
  const getPendingCount = typeof options.getPendingCount === 'function' ? options.getPendingCount : () => 0;
  const beforeCheck = typeof options.beforeCheck === 'function' ? options.beforeCheck : () => {};
  let inFlight = 0;

  async function run(task) {
    if (typeof task !== 'function') throw new TypeError('attachment stage task is required');
    beforeCheck();
    const pendingCount = Math.max(0, Number(getPendingCount()) || 0);
    if (inFlight >= maxInFlight || pendingCount + inFlight >= maxTotal) {
      throw new Error('다른 첨부파일을 확인 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    inFlight += 1;
    try {
      return await task();
    } finally {
      inFlight = Math.max(0, inFlight - 1);
    }
  }

  return Object.freeze({
    run,
    snapshot: () => Object.freeze({ inFlight, maxInFlight, maxTotal }),
  });
}

module.exports = Object.freeze({ createOfficeAttachmentStageGate });
