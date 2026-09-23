'use strict';

const { project } = require('./company-wallboard');
const { validatePublication } = require('./wallboard-publication-schema');

const defaultPlaylist = [
  ['roadmap', 40],
  ['portfolio', 25],
  ['weeklyTrend', 20],
  ['health', 20],
  ['milestones', 25],
  ['scheduleToday', 30],
  ['scheduleWeek', 30],
  ['people', 25],
  ['issues', 20],
  ['notice', 30]
].map(([key, seconds]) => ({ key, enabled: true, seconds }));

function createWallboardLiveSync({
  getIdentity,
  load,
  list,
  publish,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onStatus = () => {}
}) {
  let active = false;
  let busy = false;
  let intervalHandle = null;
  let debounceHandle = null;
  let fingerprint = '';
  let version = null;
  let publishedAt = null;
  let error = '';

  const status = () => ({ active, busy, version, publishedAt, error });
  const emit = () => {
    const value = status();
    onStatus(value);
    return value;
  };

  function stop(code = '') {
    active = false;
    if (intervalHandle !== null) clearIntervalFn(intervalHandle);
    if (debounceHandle !== null) clearTimeoutFn(debounceHandle);
    intervalHandle = null;
    debounceHandle = null;
    error = code;
    return emit();
  }

  async function buildSnapshot(presentation) {
    const data = await load();
    const date = now();
    const dataDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
    return validatePublication({
      model: project(data, dataDate),
      playlist: presentation?.playlist || defaultPlaylist,
      notice: presentation?.notice || '',
      dataDate
    });
  }

  async function reconcile() {
    if (!active || busy) return status();
    const owner = getIdentity();
    if (!owner) return stop('AUTH_REQUIRED');
    busy = true;
    emit();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await list(owner);
        const snapshot = await buildSnapshot(current.presentation);
        const nextFingerprint = JSON.stringify(snapshot);
        if (nextFingerprint === fingerprint) {
          error = '';
          break;
        }
        try {
          const result = await publish({
            action: 'publish',
            snapshot,
            expectedVersion: current.version
          }, owner);
          fingerprint = nextFingerprint;
          version = result.version;
          publishedAt = result.publishedAt;
          error = '';
          break;
        } catch (publishError) {
          if (publishError?.code !== 'VERSION_CONFLICT' || attempt === 1) throw publishError;
        }
      }
    } catch (cause) {
      error = ['AUTH_REQUIRED', 'FORBIDDEN', 'VERSION_CONFLICT'].includes(cause?.code)
        ? cause.code
        : 'SOURCE_OR_SERVER_UNAVAILABLE';
      if (['AUTH_REQUIRED', 'FORBIDDEN'].includes(error)) stop(error);
    } finally {
      busy = false;
      emit();
    }
    return status();
  }

  function notify() {
    if (!active) return status();
    if (debounceHandle !== null) clearTimeoutFn(debounceHandle);
    debounceHandle = setTimeoutFn(() => {
      debounceHandle = null;
      void reconcile();
    }, 300);
    return status();
  }

  function start() {
    if (active) return status();
    if (!getIdentity()) {
      error = 'AUTH_REQUIRED';
      return emit();
    }
    active = true;
    error = '';
    intervalHandle = setIntervalFn(() => void reconcile(), 60000);
    intervalHandle?.unref?.();
    void reconcile();
    return emit();
  }

  return { start, stop, notify, reconcile, status };
}

module.exports = { createWallboardLiveSync, defaultPlaylist };
