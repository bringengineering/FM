import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('CRM gateway is pinned to the verified existing company account',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 assert.match(config,/^account_id = "3c3bcd08bb6ed3a7a8f98c292386c327"$/m);
 const main=readFileSync(new URL('../../desktop-crm/src/main.js',import.meta.url),'utf8');
 const tv=readFileSync(new URL('../../desktop-crm/src/wallboard-tv-main.js',import.meta.url),'utf8');
 for(const source of [main,tv])assert.ok(source.includes('https://bring-crm-ai-gateway.bringengineering1008.workers.dev/'));
});
test('TV production storage is dedicated SQLite with bounded request rate',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 assert.match(config,/WALLBOARD_ENABLED = "true"/);
 assert.match(config,/\[\[durable_objects.bindings\]\]\s+name = "WALLBOARD_DEVICES"\s+class_name = "WallboardDevices"/);
 assert.match(config,/new_sqlite_classes = \["WallboardDevices"\]/);
 assert.match(config,/name = "WALLBOARD_RATE_LIMITER"\s+namespace_id = "10082"/);
});
