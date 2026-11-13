const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const atlasRoot = path.join(__dirname, '../src/building-atlas');
const upstreamRoot = path.join(atlasRoot, 'upstream');

test('preserves the upstream runtime entry points without enabling the module', () => {
  for (const file of ['index.html', 'app.mjs', 'app.css', 'model.mjs', 'viewer.mjs', 'vendor/three.module.js']) {
    assert.ok(fs.existsSync(path.join(upstreamRoot, file)), `missing preserved upstream file: ${file}`);
  }
});

test('records the exact upstream provenance and inactive storage boundary', () => {
  const readmePath = path.join(atlasRoot, 'README.md');
  assert.ok(fs.existsSync(readmePath), 'missing upstream provenance README');
  const readme = fs.readFileSync(readmePath, 'utf8');
  for (const required of [
    'bringengineering1008-pixel/FM',
    'https://github.com/bringengineering1008-pixel/FM/pull/2',
    'f5f43f7971bd7043435ad149dea9b1eab341a188',
    'building-operations/',
    'preserved upstream',
    'not enabled',
    'no production storage',
  ]) assert.ok(readme.includes(required), `missing provenance or boundary: ${required}`);
});

test('retains the vendor MIT license', () => {
  const licensePath = path.join(upstreamRoot, 'vendor/LICENSE');
  assert.ok(fs.existsSync(licensePath), 'missing vendor license');
  const license = fs.readFileSync(licensePath, 'utf8');
  assert.match(license, /The MIT License/);
  assert.match(license, /three\.js authors/);
  assert.match(license, /Permission is hereby granted/);
});

test('loads all ten original categories and validates the preserved demo', async () => {
  const modelPath = path.join(upstreamRoot, 'model.mjs');
  assert.ok(fs.existsSync(modelPath), 'missing preserved upstream model');
  const { categories, demo, validate } = await import(pathToFileURL(modelPath).href);
  assert.equal(categories.length, 10);
  const data = demo();
  assert.equal(validate(data), data);
  assert.equal(data.records.length, 10);
});
