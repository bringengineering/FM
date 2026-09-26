const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const native=path.join(__dirname,'../src/building-atlas/native');
const helper=path.join(native,'visual-style.mjs');
async function load(){assert.ok(fs.existsSync(helper),'pure visual-style helper exists');return import(pathToFileURL(helper).href);}
test('light palette is immutable and uses approved architectural colors',async()=>{
 const {palette}=await load();assert.ok(Object.isFrozen(palette));
 for(const [key,value] of Object.entries({background:0xf2f6fa,slab:0xf8f5ed,outline:0xa6bbc8,grid:0xdbe4eb,selection:0x247dd5}))assert.equal(palette[key],value);
});
test('selection preserves every equipment category color',async()=>{
 const {equipmentStyle,palette}=await load();const {colors}=await import(pathToFileURL(path.join(native,'../upstream/model.mjs')).href);
 const snapshot=JSON.stringify(colors);
 for(const color of Object.values(colors)){assert.equal(equipmentStyle(color,false).color,color);assert.equal(equipmentStyle(color,true).color,color);assert.equal(equipmentStyle(color,true).ringColor,palette.selection);}
 assert.equal(JSON.stringify(colors),snapshot);
});
test('only directly incident routes are emphasized, with verification semantics unchanged',async()=>{
 const {routeStyle}=await load();
 for(const verified of [true,false]){
  const normal=routeStyle('a','b',null,verified),selected=routeStyle('a','b','a',verified),reverse=routeStyle('a','b','b',verified),other=routeStyle('b','c','a',verified);
  assert.equal(selected.opacity,reverse.opacity);assert.ok(selected.opacity>other.opacity);assert.ok(other.opacity>=.35);assert.ok(normal.opacity>other.opacity);
  for(const style of [normal,selected,reverse,other])assert.equal(style.dashed,!verified);
 }
});
test('viewer consumes light styles and releases decorative resources through the scene lifecycle',()=>{
 const source=fs.readFileSync(path.join(native,'viewer.mjs'),'utf8');
 assert.match(source,/from '\.\/visual-style\.mjs'/);assert.match(source,/palette\.slab/);assert.match(source,/equipmentStyle\(/);assert.match(source,/routeStyle\(/);
 assert.match(source,/createRadialGradient/);assert.match(source,/release\(root\)/);assert.match(source,/release\(scene\)/);assert.doesNotMatch(source,/EffectComposer|UnrealBloomPass/);
 assert.match(source,/verified\?new T\.LineBasicMaterial/);assert.match(source,/new T\.LineDashedMaterial/);
});
test('generic equipment does not acquire blue emissive tint when selected',()=>{
 const source=fs.readFileSync(path.join(native,'viewer.mjs'),'utf8');
 assert.doesNotMatch(source,/emissive:selected\?/);
});
