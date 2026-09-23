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

module.exports = { saveAndSignalWallboard };
