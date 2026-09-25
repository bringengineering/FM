const ID=/^[A-Za-z0-9_-]{1,150}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RESERVED=new Set(['__proto__','prototype','constructor']);
const META=['revision','updatedAt','updatedBy','approvedAt','approvedBy','voidedAt','voidedBy','lastRequestId','returnPending','returnHistory'];
const INVOICE=['id','contractId','contractType','occurrenceId','billingMonth','dueDate','amount','status','voidReason'];
const RECEIPT=['id','invoiceId','receivedAt','amount','transactionRef','evidenceRef','status','voidReason'];
const fail=()=>{throw new Error('WALLBOARD_UNAVAILABLE');};
const map=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 && (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const id=value=>typeof value==='string'&&ID.test(value)&&!RESERVED.has(value);
const date=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(`${value}T00:00:00.000Z`);
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
const timestamp=value=>typeof value==='string'&&TIME.test(value)&&Number.isFinite(Date.parse(value))
 &&new Date(value).toISOString()===value;
function returnMetadata(item){
 if(item.returnPending!==undefined&&typeof item.returnPending!=='boolean')fail();
 if(item.returnHistory===undefined)return;
 if(!map(item.returnHistory))fail();
 for(const [requestId,entry] of Object.entries(item.returnHistory)){
  if(!id(requestId)||!map(entry)||Object.keys(entry).some(key=>!['reason','returnedBy','returnedAt','revision'].includes(key))
   ||typeof entry.reason!=='string'||entry.reason.trim()!==entry.reason||entry.reason.length<5||entry.reason.length>500
   ||!id(entry.returnedBy)||!timestamp(entry.returnedAt)||!Number.isSafeInteger(entry.revision)||entry.revision<2)fail();
 }
}
function record(key,item,kind){
 const fields=kind==='invoice'?INVOICE:RECEIPT;
 if(!id(key)||!map(item)||item.id!==key||Object.keys(item).some(field=>![...fields,...META].includes(field))
  ||!Number.isSafeInteger(item.amount)||item.amount<=0||!['draft','approved','void'].includes(item.status)
  ||!Number.isSafeInteger(item.revision)||item.revision<1||!id(item.updatedBy)||!timestamp(item.updatedAt))fail();
 if(kind==='invoice'){
  if(!id(item.contractId)||typeof item.billingMonth!=='string'||!MONTH.test(item.billingMonth)||!date(item.dueDate)
   ||(item.contractType!==undefined&&!['regular','one_off'].includes(item.contractType))
   ||(item.contractType==='one_off'&&!id(item.occurrenceId))
   ||(item.occurrenceId!==undefined&&(item.contractType!=='one_off'||!id(item.occurrenceId))))fail();
 }else if(!id(item.invoiceId)||!date(item.receivedAt)||typeof item.transactionRef!=='string'||item.transactionRef.length>160
  ||typeof item.evidenceRef!=='string'||item.evidenceRef.length>500
  ||(item.status==='approved'&&(!item.transactionRef.trim()||!item.evidenceRef.trim())))fail();
 if(item.status==='void'&&(typeof item.voidReason!=='string'||!item.voidReason.trim()||item.voidReason.length>500))fail();
 if(['approved','void'].includes(item.status)&&(!id(item.approvedBy)||!timestamp(item.approvedAt)))fail();
 if(item.status==='void'&&(!id(item.voidedBy)||!timestamp(item.voidedAt)))fail();
 if(item.lastRequestId!==undefined&&!id(item.lastRequestId))fail();
 returnMetadata(item);
 return item;
}

export function validateWallboardBillingLedger(raw) {
 if(raw===null)return {invoices:[],receipts:[]};
 if(!map(raw)||Object.keys(raw).some(key=>!['invoices','receipts'].includes(key)))fail();
 const invoiceMap=raw.invoices===undefined?{}:raw.invoices;
 const receiptMap=raw.receipts===undefined?{}:raw.receipts;
 if(!map(invoiceMap)||!map(receiptMap))fail();
 if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>1024*1024)fail();
 const invoices=Object.entries(invoiceMap).map(([key,item])=>record(key,item,'invoice'));
 const receipts=Object.entries(receiptMap).map(([key,item])=>record(key,item,'receipt'));
 const invoiceKeys=new Set();let invoiceTotal=0;
 for(const item of invoices){
  if(item.status!=='void'){
   const key=item.contractType==='one_off'?`one_off:${item.contractId}:${item.occurrenceId}`:`regular:${item.contractId}:${item.billingMonth}`;
   if(invoiceKeys.has(key))fail();invoiceKeys.add(key);
  }
  if(item.status==='approved'){invoiceTotal+=item.amount;if(!Number.isSafeInteger(invoiceTotal))fail();}
 }
 const byInvoice=new Map(invoices.map(item=>[item.id,item]));
 const receiptKeys=new Set();let receiptTotal=0;
 for(const item of receipts){
  const parent=byInvoice.get(item.invoiceId);
  if(!parent||item.status==='approved'&&parent.status!=='approved')fail();
  if(item.status==='approved'){
   const key=`${item.invoiceId}\u0000${item.transactionRef}`;
   if(receiptKeys.has(key))fail();receiptKeys.add(key);
   receiptTotal+=item.amount;if(!Number.isSafeInteger(receiptTotal))fail();
  }
 }
 return {invoices,receipts};
}
