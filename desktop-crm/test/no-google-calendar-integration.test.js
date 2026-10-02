const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');

test('Google calendar integration is removed while native CRM calendar remains', () => {
  for (const name of ['app.js', 'main.js', 'preload.js', 'index.html']) {
    assert.doesNotMatch(read(name), /googleCalendar|google-calendar|GoogleCalendar/);
  }
  assert.match(read('app.js'), /function renderBuildingCalendar/);
  assert.match(read('index.html'), /work-calendar\.js/);
  assert.match(read('work-calendar.js'), /function buildModel/);
});
