const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.BringMessagePolicy = require("../src/message-policy");
const UI = require("../src/customer-alimtalk-ui");
const props = {customers:[{id:"test",name:"TEST",phone:"01000000000"}],selectedCustomerIds:["test"],category:"workReport",workReportId:"report",workReports:[{id:"report"}],workReportReady:true,writable:true,adminCanSend:true,kakaoReady:true};
test("receipt statuses distinguish request acceptance from actual delivery, with no automatic resend",()=>{
  for(const [status,label] of [["requested","전달 확인 중"],["delivered","전달 완료"],["failed","전달 실패"],["unknown","결과 확인 필요"]]){
    const html=UI.render({...props,receiptMatchesSelection:true,receipt:{status,messageId:"receipt_fixture",label:"<script>TEST</script>"},result:"<img onerror=alert(1)>"});
    assert.match(html,new RegExp(label));assert.match(html,/data-alimtalk-status/);assert.match(html,/data-alimtalk-send[^>]*disabled/);
    assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img/);
    assert.match(html,/자동 재발송하지/);
  }
});
test("receipt querying remains administrator-only and disabled while another action is running",()=>{
  const receipt={status:"requested",messageId:"receipt_fixture"};
  assert.doesNotMatch(UI.render({...props,adminCanSend:false,receipt}),/data-alimtalk-status/);
  assert.match(UI.render({...props,busy:true,receipt}),/data-alimtalk-status disabled/);
});
