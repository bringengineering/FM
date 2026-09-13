const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
const vm = require('node:vm');

test('global search and messenger shortcut cannot discard an atlas draft', async () => {
  let handler, rendered=0, selected=0;
  const context={currentView:'buildingAtlas',buildingAtlasView:{requestLeave:async()=>false},render:()=>rendered++,searchEl:{addEventListener:(_event,fn)=>handler=fn},workspaceCoordinator:{select:async()=>selected++}};
  vm.runInNewContext(app.slice(app.indexOf('  searchEl.addEventListener("keydown"'),app.indexOf('  fieldOperatorSelect.addEventListener("change"')),context);
  await handler({key:'Enter'});
  assert.equal(context.currentView,'buildingAtlas');assert.equal(rendered,0);
  vm.runInNewContext(app.slice(app.indexOf('  async function openOfficeMessengerShortcut('),app.indexOf('  api.onShortcut(async action')),context);
  assert.equal(await context.openOfficeMessengerShortcut({peerId:'test-peer'}),false);
  assert.equal(selected,0);assert.equal(context.currentView,'buildingAtlas');
});
test('CRM exposes one atlas navigation entry and a building-context entry', () => {
  assert.equal((html.match(/data-view="buildingAtlas"/g) || []).length, 1);
  assert.match(app, /buildingAtlas:\s*\[/);
  assert.match(app, /data-building-atlas-open/);
  assert.match(app, /currentView === "buildingAtlas"\) renderBuildingAtlas\(\)/);
});
test('CRM loads the native host and isolates auth/navigation lifecycles', () => {
  assert.match(app, /import\("\.\/building-atlas\/crm-host\.mjs"\)/);
  assert.match(app, /buildingAtlasView\.updateBuildings/);
  assert.match(app, /buildingAtlasView\?\.dispose/);
  assert.match(app, /await buildingAtlasView\.requestLeave\(\)/);
  assert.match(app, /previousAtlasIdentity !== atlasIdentity/);
  assert.match(app, /generation !== buildingAtlasGeneration/);
});
