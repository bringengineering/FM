const assert = require("node:assert/strict");
const test = require("node:test");

const MarketingLeadsUI = require("../src/marketing-leads-ui");

test("renders newest advertising leads with safe call actions and escaped needs", () => {
  const html = MarketingLeadsUI.renderInbox([
    {
      requestId: "lead_new",
      name: "김건물<script>",
      phone: "010-1234-5678",
      location: "원주시 단계동",
      needs: "<img src=x onerror=alert(1)>",
      service: "계단·공용부 청소",
      status: "new",
      submittedAt: 1_777_000_000_000,
    },
    {
      requestId: "lead_old",
      name: "이관리",
      phone: "010-9999-8888",
      location: "원주시 무실동",
      needs: "건물관리 상담",
      service: "건물관리",
      status: "processing",
      submittedAt: 1_776_000_000_000,
    },
  ]);

  assert.match(html, /광고 신규 문의/);
  assert.match(html, /2건/);
  assert.ok(html.indexOf("lead_new") < html.indexOf("lead_old"));
  assert.match(html, /href="tel:01012345678"/);
  assert.match(html, /김건물&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
});

test("renders a calm empty state when no advertising leads exist", () => {
  const html = MarketingLeadsUI.renderInbox([]);
  assert.match(html, /아직 접수된 광고 문의가 없습니다/);
});
