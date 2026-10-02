// No credentials, DOM, or browser storage here. The authenticated host owns IO.
const clone = value => structuredClone(value);
const fail = (message, code) => Object.assign(new Error(message), { code });
const initial = () => ({ buildingId: null, status: 'idle', record: null, draft: null, etag: null, canWrite: false, error: null });
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function createAtlasController({ read, write, validate, onChange = () => {} }) {
  if ([read, write, validate, onChange].some(fn => typeof fn !== 'function')) throw new TypeError('Atlas adapters must be functions');
  let state = initial();
  let generation = 0;
  let disposed = false;
  let loaded = false;
  const snapshot = () => clone(state);
  const publish = () => onChange(snapshot());
  const active = epoch => !disposed && epoch === generation;
  const requireActive = () => { if (disposed) throw fail('지도 화면이 닫혔습니다.', 'ATLAS_DISPOSED'); };
  function checkResponse(value, id, expectedRevision) {
    if (!value || typeof value.etag !== 'string' || !value.etag || value.etag.length > 256 || /[\r\n]/.test(value.etag)) throw fail('저장 확인값을 받지 못했습니다.', 'ATLAS_INVALID_RESPONSE');
    if (value.record === null && expectedRevision === undefined) return;
    const record = value.record;
    if (!record || record.buildingId !== id || !Number.isSafeInteger(record.revision) || record.revision < 1 || (expectedRevision !== undefined && record.revision !== expectedRevision)) throw fail('건물·저장 버전이 일치하지 않습니다.', 'ATLAS_INVALID_RESPONSE');
    validate(record.model);
  }
  function showFailure(error) {
    state.status = error?.code === 'ATLAS_CONFLICT' ? 'conflict' : 'error';
    state.error = { code: error?.code || 'ATLAS_ERROR', message: error?.message || '지도를 처리하지 못했습니다.' };
    publish();
  }
  async function open(buildingId, { discardChanges = false } = {}) {
    requireActive();
    if (typeof buildingId !== 'string' || !buildingId.trim() || /[.#$\[\]/\u0000-\u001f\u007f]/.test(buildingId) || buildingId.length > 150) throw fail('건물 ID를 확인해 주세요.', 'ATLAS_INVALID_ID');
    if (state.draft !== null && !discardChanges) throw fail('저장하지 않은 내용을 먼저 확인해 주세요.', 'ATLAS_UNSAVED');
    const epoch = ++generation;
    loaded = false;
    state = { ...initial(), buildingId, status: 'loading' };
    publish();
    if (!active(epoch)) return;
    try {
      const result = clone(await read(buildingId));
      if (!active(epoch)) return;
      checkResponse(result, buildingId);
      state.record = result.record;
      state.etag = result.etag;
      state.canWrite = result.canWrite === true;
      state.status = result.record === null ? 'empty' : 'ready';
      loaded = true;
      publish();
    } catch (error) {
      if (!active(epoch)) return;
      showFailure(error);
      throw error;
    }
  }
  async function save(model) {
    requireActive();
    if (!loaded) throw fail('건물 지도 조회를 먼저 완료해 주세요.', 'ATLAS_NOT_LOADED');
    if (!state.canWrite) throw fail('이 계정은 조회만 할 수 있습니다.', 'ATLAS_READ_ONLY');
    if (state.status === 'saving') throw fail('저장이 진행 중입니다.', 'ATLAS_BUSY');
    const draft = clone(model);
    validate(draft);
    const epoch = generation;
    const expectedRevision = state.record?.revision ?? 0;
    const buildingId = state.buildingId;
    const etag = state.etag;
    state.draft = draft;
    state.status = 'saving';
    state.error = null;
    publish();
    if (!active(epoch)) return;
    try {
      const result = clone(await write({ buildingId, model: clone(draft), expectedRevision, etag }));
      if (!active(epoch)) return;
      checkResponse(result, buildingId, expectedRevision + 1);
      // A mismatched acknowledgement is not proof that this draft was saved.
      if (canonical(result.record.model) !== canonical(draft)) throw fail('서버 확인 내용이 작성 내용과 다릅니다.', 'ATLAS_INVALID_RESPONSE');
      state.record = result.record;
      state.etag = result.etag;
      state.canWrite = result.canWrite === true;
      state.draft = null;
      state.status = 'saved';
      publish();
    } catch (error) {
      if (!active(epoch)) return;
      showFailure(error);
      throw error;
    }
  }
  function reset() {
    generation++;
    loaded = false;
    state = initial();
    publish();
  }
  function dispose() { reset(); disposed = true; }
  return Object.freeze({ open, save, snapshot, reset, dispose });
}
