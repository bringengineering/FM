const assert = require("node:assert/strict");
const test = require("node:test");
const { createMcpServer } = require("../src/crm-mcp-server");

function harness(options = {}) {
  const calls = [];
  const server = createMcpServer({
    requestBridge: async (method, pathname, body) => {
      calls.push({ method, pathname, body });
      if (options.unavailable) throw new Error("CRM_BRIDGE_UNAVAILABLE");
      if (pathname === "/v1/status") return { connected: true, email: "boss@example.com", role: "admin", admin: true };
      if (pathname === "/v1/context") return { members: [{ uid: "u1", displayName: "김현진" }], orders: [] };
      if (pathname === "/v1/preview") return { valid: true, previewId: "preview-1", approvalPhrase: "CRM 발행 승인", writesPerformed: false, workOrders: body.workOrders };
      if (pathname === "/v1/publish") return { complete: true, results: [{ id: "wo-1", title: "테스트", ok: true }] };
      throw new Error("unexpected path");
    },
  });
  return { server, calls };
}

test("MCP initializes and advertises narrow CRM tools", async () => {
  const { server } = harness();
  const result = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(result.result.protocolVersion, "2025-06-18");
  const tools = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(tools.result.tools.map(item => item.name), ["crm_connection_status", "crm_work_order_context", "crm_preview_work_order_draft", "crm_publish_work_order_draft"]);
  assert.match(tools.result.tools[3].description, /승인/u);
});

test("tool calls pass through to the CRM bridge and return MCP text content", async () => {
  const { server, calls } = harness();
  const status = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "crm_connection_status", arguments: {} } });
  assert.match(status.result.content[0].text, /boss@example.com/u);
  const draft = { workOrders: [{ title: "테스트" }] };
  const preview = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "crm_preview_work_order_draft", arguments: draft } });
  assert.match(preview.result.content[0].text, /preview-1/u);
  const publish = await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crm_publish_work_order_draft", arguments: { previewId: "preview-1", approvalPhrase: "CRM 발행 승인" } } });
  assert.match(publish.result.content[0].text, /wo-1/u);
  assert.equal(calls.length, 3);
});

test("unsupported methods and tools return JSON-RPC errors", async () => {
  const { server } = harness();
  const method = await server.handle({ jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
  assert.equal(method.error.code, -32601);
  const tool = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "firebase_admin", arguments: {} } });
  assert.equal(tool.result.isError, true);
});

test("bridge outages return a safe actionable tool error", async () => {
  const { server } = harness({ unavailable: true });
  const result = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "crm_connection_status", arguments: {} } });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /BRING CRM/u);
});
