const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const file = path.join(__dirname, '../src/building-atlas/controller.mjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const envelope = (id, revision = 1) => ({ record: { buildingId: id, revision, model: { name: 'same-name' } }, etag: `"${revision}"`, canWrite: true });
async function setup(overrides = {}) {
  assert.ok(fs.existsSync(file), 'controller module must exist');
  const { createAtlasController } = await import(pathToFileURL(file).href);
  let writes = 0;
  const controller = createAtlasController({
    read: async id => envelope(id),
    write: async input => { writes++; return { ...envelope(input.buildingId, input.expectedRevision + 1), record: { buildingId: input.buildingId, revision: input.expectedRevision + 1, model: input.model } }; },
    validate: model => { if (!model || typeof model.name !== 'string') throw Error('invalid model'); },
    ...overrides,
  });
  return { controller, writes: () => writes };
}
test('opening and switching same-name buildings uses IDs without writing', async () => {
  const { controller: c, writes } = await setup();
  await c.open('A'); await c.open('B');
  assert.equal(c.snapshot().buildingId, 'B'); assert.equal(writes(), 0);
  const copy = c.snapshot(); copy.record.model.name = 'changed';
  assert.equal(c.snapshot().record.model.name, 'same-name');
});
test('null read is empty but a failed read is not an empty model', async () => {
  const { controller: c } = await setup({ read: async id => { if (id === 'B') throw Error('offline'); return { record: null, etag: '"null_etag"', canWrite: true }; } });
  await c.open('A'); assert.equal(c.snapshot().status, 'empty');
  await assert.rejects(c.open('B'), /offline/); assert.equal(c.snapshot().status, 'error');
  await assert.rejects(c.save({ name: 'new' }), /load|조회/);
});
test('successful save waits for response and sends expected revision and ETag', async () => {
  const pending = deferred(); let sent;
  const { controller: c } = await setup({ write: input => { sent = input; return pending.promise; } });
  await c.open('A'); const model = { name: 'edited' }; const work = c.save(model);
  model.name = 'outside'; assert.equal(c.snapshot().status, 'saving');
  assert.deepEqual(sent, { buildingId: 'A', model: { name: 'edited' }, expectedRevision: 1, etag: '"1"' });
  await assert.rejects(c.save({ name: 'second' }), { code: 'ATLAS_BUSY' });
  pending.resolve({ ...envelope('A', 2), record: { buildingId: 'A', revision: 2, model: { name: 'edited' } } });
  await work; assert.equal(c.snapshot().status, 'saved'); assert.equal(c.snapshot().draft, null);
});
for (const code of ['NETWORK', 'ATLAS_CONFLICT']) test(`${code} preserves draft and prevents silent building switch`, async () => {
  const { controller: c } = await setup({ write: async () => { throw Object.assign(Error('not saved'), { code }); } });
  await c.open('A'); await assert.rejects(c.save({ name: 'draft' }));
  assert.equal(c.snapshot().draft.name, 'draft'); assert.equal(c.snapshot().record.revision, 1);
  assert.equal(c.snapshot().status, code === 'ATLAS_CONFLICT' ? 'conflict' : 'error');
  await assert.rejects(c.open('B'), { code: 'ATLAS_UNSAVED' });
  await c.open('B', { discardChanges: true }); assert.equal(c.snapshot().buildingId, 'B');
});
test('viewer cannot write and invalid models do not reach persistence', async () => {
  const { controller: c, writes } = await setup({ read: async id => ({ ...envelope(id), canWrite: false }) });
  await c.open('A'); await assert.rejects(c.save({ name: 'x' }), { code: 'ATLAS_READ_ONLY' }); assert.equal(writes(), 0);
  const other = await setup(); await other.controller.open('A'); await assert.rejects(other.controller.save({}), /invalid/); assert.equal(other.writes(), 0);
});
for (const method of ['reset', 'dispose']) test(`${method} drops pending read without resurrecting previous account`, async () => {
  const pending = deferred(); const { controller: c } = await setup({ read: () => pending.promise });
  const work = c.open('A'); c[method](); pending.resolve(envelope('A')); await work;
  assert.equal(c.snapshot().buildingId, null); assert.equal(c.snapshot().record, null);
});
test('reset drops pending save and draft', async () => {
  const pending = deferred(); const { controller: c } = await setup({ write: () => pending.promise });
  await c.open('A'); const work = c.save({ name: 'private' }); c.reset(); pending.resolve(envelope('A', 2)); await work;
  assert.equal(c.snapshot().record, null); assert.equal(c.snapshot().draft, null);
});
test('out-of-order reads cannot replace a newer building', async () => {
  const pending = deferred(); const { controller: c } = await setup({ read: id => id === 'A' ? pending.promise : Promise.resolve(envelope(id)) });
  const work = c.open('A'); await c.open('B'); pending.resolve(envelope('A')); await work;
  assert.equal(c.snapshot().record.buildingId, 'B');
});
for (const invalid of [envelope('B', 2), envelope('A', 4), { ...envelope('A', 2), etag: '' }]) test('invalid save acknowledgement preserves draft', async () => {
  const { controller: c } = await setup({ write: async () => invalid });
  await c.open('A'); await assert.rejects(c.save({ name: 'draft' }), { code: 'ATLAS_INVALID_RESPONSE' });
  assert.equal(c.snapshot().draft.name, 'draft'); assert.equal(c.snapshot().record.revision, 1);
});
test('a successful response containing different content cannot clear the draft', async () => {
  const { controller: c } = await setup({ write: async () => envelope('A', 2) });
  await c.open('A'); await assert.rejects(c.save({ name: 'my draft' }), { code: 'ATLAS_INVALID_RESPONSE' });
  assert.equal(c.snapshot().draft.name, 'my draft');
});
test('reset from the saving notification prevents stale write dispatch', async () => {
  let c;
  const fixture = await setup({ onChange: state => { if (state.status === 'saving') c.reset(); } });
  c = fixture.controller; await c.open('A'); await c.save({ name: 'private' });
  assert.equal(fixture.writes(), 0); assert.equal(c.snapshot().status, 'idle');
});
test('same JSON model with reordered keys is a valid acknowledgement', async () => {
  const { controller: c } = await setup({ write: async () => ({ ...envelope('A', 2), record: { buildingId: 'A', revision: 2, model: { nested: { b: 2, a: 1 }, name: 'draft' } } }) });
  await c.open('A'); await c.save({ name: 'draft', nested: { a: 1, b: 2 } });
  assert.equal(c.snapshot().status, 'saved'); assert.equal(c.snapshot().draft, null);
});
test('non-Error rejection retains the draft and releases saving state', async () => {
  const { controller: c } = await setup({ write: async () => { throw null; } });
  await c.open('A'); await assert.rejects(c.save({ name: 'draft' }));
  assert.equal(c.snapshot().status, 'error'); assert.equal(c.snapshot().draft.name, 'draft');
});
