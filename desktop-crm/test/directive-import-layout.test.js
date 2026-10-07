const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('directive panel header and body occupy full editor width',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/styles.css'),'utf8');
 assert.match(css,/\.di-panel\s*>\s*header\s*,\s*\.di-panel\s*>\s*\.panel-body\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});
