'use strict';

function evaluate(rows){
 if(!Array.isArray(rows)||rows.length<30)throw new Error('at least 30 saves required');
 const ids=new Set();
 const delays=[];
 for(const row of rows){
  if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(row.id))throw new Error('invalid save id');
  if(ids.has(row.id))throw new Error('duplicate save id');
  ids.add(row.id);
  const {savedAt,publishedAt,receivedAt}=row;
  if(![savedAt,publishedAt,receivedAt].every(value=>Number.isSafeInteger(value)&&value>=0))throw new Error('invalid timestamp');
  if(savedAt>publishedAt||publishedAt>receivedAt)throw new Error('invalid event order');
  delays.push(receivedAt-savedAt);
 }
 delays.sort((a,b)=>a-b);
 const middle=Math.floor(delays.length/2);
 const medianMs=delays.length%2?delays[middle]:(delays[middle-1]+delays[middle])/2;
 const p95Ms=delays[Math.ceil(delays.length*.95)-1];
 const withinTenSeconds=delays.filter(ms=>ms<=10000).length;
 return {count:delays.length,medianMs,p95Ms,maxMs:delays.at(-1),withinTenSeconds,latencyTargetMet:withinTenSeconds===delays.length,evidenceStatus:'TIMING_ONLY'};
}

if(require.main===module){
 try{
  if(process.argv.length!==3)throw new Error('usage: node scripts/wallboard-field-acceptance.js observations.json');
  const fs=require('node:fs');
  const rows=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  console.log(JSON.stringify(evaluate(rows),null,2));
 }catch(error){
  console.error(`TV field acceptance failed: ${error.message}`);
  process.exitCode=1;
 }
}

module.exports={evaluate};
