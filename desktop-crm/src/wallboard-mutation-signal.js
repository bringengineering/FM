'use strict';

async function saveAndSignalWallboard(save, signal) {
  const result = await save();
  try {
    signal();
  } catch (_) {
    // A confirmed server write must not appear to the user as a failed save.
  }
  return result;
}

async function saveWeeklyReportAndSignalWallboard(input, save, signal) {
  const result = await save();
  if (input?.action === 'approve' && result?.status === 'approved') {
    try { signal(); } catch (_) {
      // A confirmed approval remains saved even when TV refresh is unavailable.
    }
  }
  return result;
}

module.exports = { saveAndSignalWallboard, saveWeeklyReportAndSignalWallboard };
